#!/usr/bin/env node
'use strict';
// Imports Guy's lesson PDFs from a folder into the site, one upload each.
//
//   APP_PASSWORD=... node scripts/import-lessons.js <folder> <site-url> [--build-guides-from YYYY-MM-DD] [--dry-run]
//
// Reads the folder itself, not its subfolders. Takes only PDFs named the way
// Guy names them ("Daniel Guy …", "Daniel Hebrew …", "Daniel HEB …"); every
// other file, the StreetWiseHebrew sheets and images included, is skipped and
// said so. A PDF whose file name is already on the site (a lesson's
// source_name) is skipped without uploading. Each of the others goes through
// POST /lessons, the same route as the upload button. One line per file.
//
// --build-guides-from YYYY-MM-DD: then builds the study guide of every lesson
// from those files dated on or after that day that has none yet, one at a
// time, waiting for each to finish. Other lessons build on first open.
// --dry-run: lists what would be imported, logs in, uploads nothing.
//
// Exit code 0 when every file was imported or skipped, 1 when one failed.

const fs = require('node:fs');
const path = require('node:path');
const { nameAndDate } = require('../lib/guy-lesson');

const GUY_FILE = /^Daniel\s+(?:Guy|Hebrew|HEB)\s.*\.pdf$/i;
const POLL_MS = 3000;
const GUIDE_WAIT_MS = 20 * 60 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function usage(msg) {
  console.error(`${msg}\nUsage: APP_PASSWORD=... node scripts/import-lessons.js <folder> <site-url> [--build-guides-from YYYY-MM-DD] [--dry-run]`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { folder: null, site: null, from: null, dry: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--build-guides-from') out.from = argv[++i];
    else if (argv[i] === '--dry-run') out.dry = true;
    else rest.push(argv[i]);
  }
  [out.folder, out.site] = rest;
  if (!out.folder || !out.site) usage('Give the folder and the site address.');
  if (out.from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(out.from || '')) usage('--build-guides-from takes a date as YYYY-MM-DD.');
  if (!fs.existsSync(out.folder) || !fs.statSync(out.folder).isDirectory()) usage(`No folder at ${out.folder}.`);
  out.site = out.site.replace(/\/+$/, '');
  return out;
}

// The site, behind its passphrase: one login, the cookie kept.
async function connect(site, passphrase) {
  const res = await fetch(`${site}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login refused (${res.status}): ${body.error || 'no reason given'}`);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return async function api(method, p, { json, form } = {}) {
    const r = await fetch(`${site}${p}`, {
      method,
      headers: { cookie, accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
    const data = await r.json().catch(() => ({ error: `The site answered ${r.status}.` }));
    return { status: r.status, body: data };
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const passphrase = process.env.APP_PASSWORD;
  if (!passphrase) usage('APP_PASSWORD is unset: put the site passphrase in the environment.');
  const api = await connect(args.site, passphrase);
  const listed = await api('GET', '/lessons');
  if (listed.status !== 200) throw new Error(`The site's lesson list answered ${listed.status}: ${listed.body.error}`);
  const present = new Map(listed.body.items.map((l) => [l.source_name, l]));

  const files = fs.readdirSync(args.folder, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  const mine = []; // lessons from this folder: { id, lesson_date, name, guide }
  let failed = 0;
  const line = (what, name, rest = '') => console.log(`${what.padEnd(9)} ${name}${rest ? '  ' + rest : ''}`);
  for (const name of files) {
    if (!/\.pdf$/i.test(name)) { line('skipped', name, 'not a PDF'); continue; }
    if (!GUY_FILE.test(name)) { line('skipped', name, "not one of Guy's file names"); continue; }
    const named = nameAndDate(name);
    const date = named.from === 'file name pattern' ? named.lesson_date : 'no date in the name';
    const there = present.get(name);
    if (there) {
      line('skipped', name, `${date}  already on the site`);
      mine.push({ id: there.id, lesson_date: there.lesson_date, name, guide: there.guide });
      continue;
    }
    if (args.dry) { line('would add', name, date); continue; }
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(args.folder, name))], { type: 'application/pdf' }), name);
    const up = await api('POST', '/lessons', { form });
    if (up.status === 201) {
      line('imported', name, `${up.body.lesson_date}  ${up.body.items.length} items`);
      mine.push({ id: up.body.id, lesson_date: up.body.lesson_date, name, guide: false });
    } else if (up.status === 200) {
      line('skipped', name, `${up.body.lesson_date}  the same lesson is already on the site as "${up.body.source_name}"`);
      mine.push({ id: up.body.id, lesson_date: up.body.lesson_date, name, guide: up.body.guide !== null && up.body.guide !== undefined });
    } else {
      failed++;
      line('FAILED', name, up.body.error || `the site answered ${up.status}`);
    }
  }

  if (args.from && !args.dry) {
    const todo = mine.filter((l) => l.lesson_date >= args.from && !l.guide);
    console.log(`\nguides: ${todo.length} lesson${todo.length === 1 ? '' : 's'} dated ${args.from} or later without one`);
    for (const l of todo) {
      const t0 = Date.now();
      let v = (await api('POST', `/lessons/${l.id}/guide`, { json: {} })).body;
      while (v.guide_state === 'building' && Date.now() - t0 < GUIDE_WAIT_MS) {
        await wait(POLL_MS);
        const r = await api('GET', `/lessons/${l.id}`);
        if (r.status === 200) v = r.body; // a missed answer is asked again
      }
      const secs = Math.round((Date.now() - t0) / 1000);
      if (v.guide_state === 'built') line('guide', l.name, `built in ${secs} s${v.guide.built_with === 'fallback' ? ', with the fallback model' : ''}`);
      else { failed++; line('GUIDE', l.name, v.guide_state === 'building' ? `still building after ${secs} s; it finishes on the site` : `failed: ${v.guide_error}`); }
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
