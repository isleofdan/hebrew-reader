'use strict';
// English to Hebrew on the Look up page (hebrew-english-one): an English word,
// or a phrase of up to three words, answered with the Hebrew words for it.
//
// The Hebrew words come from a dictionary, not the model, wherever one has
// them: Dan's own cards ("Yours", read from their English meaning), Pealim's
// English search (its results table) and English Wiktionary (the Hebrew
// lines of the entry's translation tables, by its API). The model is asked
// only when all three give no word, and its words stand under their own
// heading. Every link is built by lib/references.js; the model writes none.
//
// Nothing here saves a word or makes a spot: tapping a Hebrew word on the
// page looks it up as a Hebrew word (lib/lookup-page.js search), which saves
// that one word, as typing it does.
//
// Each site's parsed answer is kept by site and lower-cased text
// (`english_sites`) and reused for 30 days; a site that is down is answered
// from its kept copy, however old, or said not to have answered. Each look-up
// is kept with its merged answer (`english_lookups`), which the "Looked up"
// list reopens without asking any site.

const { JSDOM, VirtualConsole } = require('jsdom');
const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');
const refs = require('./references');
const pages = require('./reference-pages');

const KEEP_MS = 30 * 24 * 3600 * 1000; // a site's answer is reused for 30 days
const YOURS_MAX = 10;
const MODEL_MAX = 5;
const SITE_NAMES = { pealim: 'Pealim', wiktionary: 'Wiktionary' };
const HEADINGS = { yours: 'Yours', pealim: 'From Pealim', wiktionary: 'From Wiktionary', model: 'Suggested by the model; no dictionary listed it' };

// The checks set the clock (the 30-day reuse).
let clock = () => Date.now();
function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
const nowIso = () => new Date(clock()).toISOString();

const bare = (s) => lookup.bare(s);
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A failure a group is shown with: the site did not answer, or its page has
// changed shape. Kept copies stand in for both.
class SiteFailed extends Error {
  constructor(message) { super(message); this.siteFailed = true; }
}

// --- Yours: Dan's own cards ------------------------------------------------------

// Dan's cards whose English meaning holds every word of the text as a whole
// word, any case; the newest card of each word, newest first, ten at most.
function yours(words) {
  const tests = words.map((w) => new RegExp(`(^|[^\\p{L}])${escapeRe(w)}($|[^\\p{L}])`, 'iu'));
  const out = [];
  const seen = new Set();
  for (const row of db.wordCardsForFind()) {
    const k = row.card;
    const meaning = String(k.meaning_en || '');
    if (!meaning || !tests.every((t) => t.test(meaning))) continue;
    const word = k.lemma || k.surface;
    const b = bare(word);
    if (!b || seen.has(b)) continue;
    seen.add(b);
    const spot = row.spot_id ? db.getSpot(row.spot_id) : null;
    // the headword pointed, as the "Looked up" list shows it
    const he = (k.pointed && (k.lemma ? k.pointed.lemma : k.pointed.surface)) || word;
    out.push({ word: b, he, meaning, pos: k.pos && k.pos !== 'other' ? k.pos : '', root: k.root || '', status: spot ? spot.status : null });
    if (out.length >= YOURS_MAX) break;
  }
  return out;
}

// --- Pealim: its English search's results table ----------------------------------

// The results table (pealim.com, 23 Oct 2026): table.dict-table-t, one
// tr[onclick] per word — the first cell span.dict-lemma a[href=/dict/…]
// span.menukad (the word with nikud) and span.dict-transcription; the
// second the root's link ("ר - ו - ץ"); the third the part of speech and the
// binyan ("Verb – <i>pa'al</i>"); td.dict-meaning the English. A page with
// no table and "No results for" in its h3.page-header lists no word. Any
// other page has changed shape, and is said so rather than read as no words.
function parsePealim(html) {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  try {
    const doc = dom.window.document;
    const table = doc.querySelector('table.dict-table-t');
    if (!table) {
      const head = squash((doc.querySelector('h3.page-header') || {}).textContent);
      if (/^No results for\b/i.test(head)) return { words: [] };
      throw new SiteFailed('Pealim’s page could not be read');
    }
    const words = [];
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = tr.querySelectorAll(':scope > td');
      const a = cells[0] && cells[0].querySelector('.dict-lemma a[href^="/dict/"]');
      const he = a && squash((a.querySelector('.menukad') || {}).textContent);
      const meaning = squash((tr.querySelector('td.dict-meaning') || {}).textContent);
      const path = a && a.getAttribute('href');
      if (!he || !meaning || !refs.ENGLISH.pealim.isEntry(path) || cells.length < 4) throw new SiteFailed('Pealim’s page could not be read');
      const rootLetters = bare(cells[1].textContent).replace(/[^א-ת]/g, '');
      words.push({
        he,
        translit: squash((cells[0].querySelector('.dict-transcription') || {}).textContent),
        root: rootLetters.length >= 2 ? rootLetters.split('').join('.') : '',
        pos: squash(cells[2].textContent),
        meaning,
        path,
      });
    }
    if (!words.length) throw new SiteFailed('Pealim’s page could not be read');
    return { words };
  } finally {
    dom.window.close();
  }
}

async function fetchPealim(text) {
  const site = refs.ENGLISH.pealim;
  let page;
  try {
    page = await pages.fetchFrom(refs.byId('pealim'), site.search(text), `${pages.STANDIN}/pealim/${encodeURIComponent(text)}`);
  } catch (e) {
    throw new SiteFailed(`Pealim did not answer (${e.message})`);
  }
  return parsePealim(page.html);
}

// --- Wiktionary: the English entry's translation tables ----------------------------

// The English language section of an entry's wikitext ("==English==" to the
// next level-two heading), or null.
function englishSection(wikitext) {
  const w = String(wikitext || '');
  const m = /^==\s*English\s*==[ \t]*$/m.exec(w);
  if (!m) return null;
  const rest = w.slice(m.index + m[0].length);
  const next = /^==[^=].*==[ \t]*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// A template's parameters: positional in order, and named.
function params(inner) {
  const pos = [], named = {};
  for (const p of inner.split('|')) {
    const eq = /^\s*([a-z0-9_-]+)\s*=(.*)$/i.exec(p);
    if (eq) named[eq[1].toLowerCase()] = eq[2].trim();
    else pos.push(p.trim());
  }
  return { pos, named };
}

// A gloss as plain words: links to their text, templates and quotes gone.
function plainGloss(s) {
  return squash(String(s || '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, ''));
}

// The Hebrew words of an English section, under each sense's gloss:
// { senses: [{ gloss, words: [{ word, alt, tr }] }], subpage }. A sense is a
// table opened by {{trans-top|gloss}} (or {{trans-top-see|gloss|…}}) and
// closed by {{trans-bottom}}; its Hebrew line is "* Hebrew: {{t+|he|…}}, …"
// ({{t}}, {{t+}}, {{tt}}, {{tt+}}), each word with its alt= (a pointed form)
// and tr= (a transliteration). Tables of translations still to be checked
// ({{checktrans-top}}) are passed by. `subpage`: the entry points to its
// /translations page ({{see translation subpage|…}}).
function parseWiktionary(section) {
  const senses = [];
  let open = null;
  for (const line of String(section || '').split('\n')) {
    const top = /^\{\{\s*(trans-top|trans-top-see|checktrans-top)\s*(?:\|([^}]*))?\}\}/i.exec(line.trim());
    if (top) {
      if (top[1].toLowerCase() === 'checktrans-top') { open = null; continue; }
      const gloss = plainGloss(params(top[2] || '').pos[0] || '');
      open = { gloss, words: [] };
      senses.push(open);
      continue;
    }
    if (/^\{\{\s*trans-bottom\s*\}\}/i.test(line.trim())) { open = null; continue; }
    if (!open || !/^\*:?\s*Hebrew\s*:/.test(line)) continue;
    for (const m of line.matchAll(/\{\{\s*tt?\+?\s*\|\s*he\s*\|([^{}]*)\}\}/g)) {
      const { pos, named } = params(m[1]);
      const word = squash(pos[0]);
      if (!word || !/[א-ת]/.test(word)) continue;
      open.words.push({ word, alt: named.alt || null, tr: named.tr || null });
    }
  }
  return { senses: senses.filter((s) => s.words.length), subpage: /\{\{\s*see translation subpage\b/i.test(String(section || '')) };
}

// One page's wikitext from the API: { wikitext } or { missing: true }.
async function wiktionaryPage(page) {
  const site = refs.ENGLISH.wiktionary;
  let got;
  try {
    got = await pages.fetchFrom(site, site.api(page), `${pages.STANDIN}/${site.id}/${encodeURIComponent(page)}`, 'application/json');
  } catch (e) {
    throw new SiteFailed(`Wiktionary did not answer (${e.message})`);
  }
  let body;
  try { body = JSON.parse(got.html); } catch { throw new SiteFailed('Wiktionary’s answer could not be read'); }
  if (body && body.error && body.error.code === 'missingtitle') return { missing: true };
  if (!body || !body.parse || typeof body.parse.wikitext !== 'string') throw new SiteFailed('Wiktionary’s answer could not be read');
  return { wikitext: body.parse.wikitext };
}

// The entry for the text lower-cased, else as typed; its /translations
// subpage too when it points there. Answers { words: [{ he, word, tr,
// gloss, page }] } in the entry's order, by sense.
async function fetchWiktionary(text, typed) {
  let page = text;
  let got = await wiktionaryPage(page);
  if (got.missing && typed !== text) { page = typed; got = await wiktionaryPage(page); }
  if (got.missing) return { words: [] };
  const main = parseWiktionary(englishSection(got.wikitext));
  const found = main.senses.map((s) => ({ ...s, page }));
  if (main.subpage) {
    const subPage = `${page}/translations`;
    const sub = await wiktionaryPage(subPage);
    if (!sub.missing) found.push(...parseWiktionary(englishSection(sub.wikitext)).senses.map((s) => ({ ...s, page: subPage })));
  }
  const words = [];
  for (const s of found) for (const w of s.words) words.push({ he: w.alt || w.word, word: w.word, tr: w.tr, gloss: s.gloss, page: s.page });
  return { words };
}

// --- a site's answer, kept 30 days ---------------------------------------------------

const running = new Map(); // site + text -> the fetch under way

// { state: 'ok', words, fetched_at, kept } or { state: 'failed', message }.
async function siteAnswer(site, text, fetchIt) {
  const kept = db.getEnglishSite(site, text);
  if (kept && clock() - Date.parse(kept.fetched_at) < KEEP_MS) return { state: 'ok', words: kept.answer.words, fetched_at: kept.fetched_at, kept: true };
  const k = `${site}\n${text}`;
  if (!running.has(k)) {
    running.set(k, (async () => {
      const t0 = Date.now();
      try {
        const answer = await fetchIt();
        const row = db.putEnglishSite(site, text, answer, nowIso());
        console.log(`english: ${site} "${text}": ${answer.words.length} words, fetched in ${Date.now() - t0} ms, kept 30 days`);
        return { state: 'ok', words: answer.words, fetched_at: row.fetched_at, kept: false };
      } catch (e) {
        if (!e.siteFailed) throw e;
        console.error(`english: ${site} "${text}": ${e.message}${kept ? `; the copy kept on ${kept.fetched_at} shown` : ''}`);
        // a site down, or its page changed: its kept copy, however old, or the failure
        if (kept) return { state: 'ok', words: kept.answer.words, fetched_at: kept.fetched_at, kept: true, stale: e.message.replace(/ \(.*\)$/, '') };
        return { state: 'failed', message: e.message.replace(/ \(.*\)$/, ''), reason: e.message };
      }
    })().finally(() => running.delete(k)));
  }
  return running.get(k);
}

// --- the model, only when no dictionary has a word -------------------------------------

const MODEL_SYSTEM = `You give the Hebrew words for an English word or phrase, for a reader of Israeli news and business Hebrew at an advanced level.

Answer with ONE JSON object and nothing else: {"words": [{"hebrew": "<the Hebrew word, with full nikud>", "meaning": "<a short English meaning>"}]}. At most five words, the most used in Israeli news and business Hebrew first, register words included. Hebrew letters and nikud only in "hebrew". If Hebrew has no word for it, answer {"words": []}.`;

// A Hebrew word as the model may give it: Hebrew letters (at least one),
// nikud, a space, a maqaf, geresh or gershayim — anything else is dropped.
const HEBREW_ONLY = /^[֑-״\s\-־'"׳״]+$/;

async function modelWords(text) {
  let raw;
  try {
    raw = await lookup.chat({ system: MODEL_SYSTEM, user: `English to Hebrew request\nEnglish: ${text}`, maxTokens: 400, what: 'Hebrew words could not be suggested' });
  } catch (e) {
    console.error(`english: "${text}": ${e.message}`);
    return { state: 'failed', message: 'The model did not answer', reason: e.message };
  }
  const words = [];
  const seen = new Set();
  let dropped = 0;
  for (const w of (raw && Array.isArray(raw.words) ? raw.words : [])) {
    const he = w && typeof w.hebrew === 'string' ? squash(w.hebrew.normalize('NFC')) : '';
    const meaning = w && typeof w.meaning === 'string' ? squash(w.meaning) : '';
    if (!he || !HEBREW_ONLY.test(he) || !/[א-ת]/.test(he) || !meaning) { dropped++; continue; }
    const b = bare(he);
    if (seen.has(b)) continue;
    seen.add(b);
    words.push({ he, meaning });
    if (words.length >= MODEL_MAX) break;
  }
  console.log(`english: "${text}": no dictionary word; the model suggested ${words.length}${dropped ? `, ${dropped} dropped (not Hebrew)` : ''}`);
  return { state: words.length ? 'ok' : 'none', words };
}

// --- the merged answer ----------------------------------------------------------------

// One row per Hebrew word (its bare form), its sources listed together; the
// meaning from Pealim first, else the Wiktionary sense's gloss (Yours: Dan's
// own). Order: Yours, then words both sites list, then Pealim's order, then
// Wiktionary's by sense.
function merge({ mine, pealim, wiktionary }) {
  const rows = new Map();
  const pealimSite = refs.ENGLISH.pealim, wikt = refs.ENGLISH.wiktionary;
  const pealimSource = (w) => ({ id: 'pealim', label: 'Pealim', path: w.path, url: pealimSite.entry(w.path) });
  const wiktSource = (w) => ({ id: 'wiktionary', label: 'Wiktionary', page: w.page, url: wikt.url(w.page) });
  for (const w of mine) rows.set(w.word, { group: 'yours', word: w.word, he: w.he, translit: '', pos: w.pos, root: w.root, meaning: w.meaning, status: w.status, sources: [{ id: 'yours', label: 'Yours' }] });
  for (const w of (pealim.state === 'ok' ? pealim.words : [])) {
    const b = bare(w.he);
    const row = rows.get(b);
    if (row) {
      if (!row.sources.some((s) => s.id === 'pealim')) row.sources.push(pealimSource(w));
      row.translit = row.translit || w.translit;
      if (row.group !== 'yours') continue;
      row.pos = row.pos || w.pos; row.root = row.root || w.root;
      continue;
    }
    rows.set(b, { group: 'pealim', word: b, he: w.he, translit: w.translit, pos: w.pos, root: w.root, meaning: w.meaning, sources: [pealimSource(w)] });
  }
  for (const w of (wiktionary.state === 'ok' ? wiktionary.words : [])) {
    const b = bare(w.word);
    const row = rows.get(b);
    if (row) {
      if (!row.sources.some((s) => s.id === 'wiktionary')) row.sources.push(wiktSource(w));
      if (row.group === 'pealim') row.both = true;
      row.translit = row.translit || w.tr || '';
      if (row.group === 'wiktionary' && w.gloss && !row.glosses.includes(w.gloss)) { row.glosses.push(w.gloss); row.meaning = row.glosses.join('; '); }
      continue;
    }
    rows.set(b, { group: 'wiktionary', word: b, he: w.he, translit: w.tr || '', pos: '', root: '', meaning: w.gloss, sense: w.gloss, glosses: [w.gloss], sources: [wiktSource(w)] });
  }
  const all = [...rows.values()];
  const clean = (r) => { const { group, both, glosses, ...rest } = r; return rest; };
  return {
    yours: all.filter((r) => r.group === 'yours').map(clean),
    pealim: [...all.filter((r) => r.group === 'pealim' && r.both), ...all.filter((r) => r.group === 'pealim' && !r.both)].map(clean),
    wiktionary: all.filter((r) => r.group === 'wiktionary').map(clean),
  };
}

// A group as the page draws it: { id, heading, state ('ok' | 'none' |
// 'failed'), message, rows, kept_at? }.
function group(id, answer, rows, text) {
  const g = { id, heading: HEADINGS[id], state: answer.state === 'failed' ? 'failed' : rows.length ? 'ok' : 'none', rows };
  if (answer.state === 'failed') g.message = answer.message;
  else if (!rows.length) g.message = id === 'yours' ? `None of your words means “${text}”.` : `${SITE_NAMES[id]} lists no Hebrew word for “${text}”.`;
  if (answer.stale) { g.message = `${answer.stale}; shown from the copy kept on ${answer.fetched_at.slice(0, 10)}.`; g.kept_at = answer.fetched_at; }
  return g;
}

// --- the look-up ------------------------------------------------------------------------

// english.find(text): { mode: 'english', text, groups, at }. `text` is an
// English word or a phrase of up to three words, already checked by the
// caller (lib/lookup-page.js).
async function find(rawText) {
  const text = squash(String(rawText || '').normalize('NFC'));
  if (!text) throw new ReaderError(400, 'Type a word to look up.');
  const key = text.toLowerCase();
  const words = key.split(' ');
  const mine = yours(words);
  const [pealim, wiktionary] = await Promise.all([
    siteAnswer('pealim', key, () => fetchPealim(key)),
    siteAnswer('wiktionary', key, () => fetchWiktionary(key, text)),
  ]);
  const merged = merge({ mine, pealim, wiktionary });
  const groups = [
    group('yours', { state: 'ok' }, merged.yours, text),
    group('pealim', pealim, merged.pealim, text),
    group('wiktionary', wiktionary, merged.wiktionary, text),
  ];
  // the model only when Yours, Pealim and Wiktionary give no word at all
  if (!merged.yours.length && !merged.pealim.length && !merged.wiktionary.length) {
    const m = await modelWords(text);
    const rows = (m.words || []).map((w) => ({ word: bare(w.he), he: w.he, translit: '', pos: '', root: '', meaning: w.meaning, sources: [] }));
    const g = { id: 'model', heading: HEADINGS.model, state: m.state === 'failed' ? 'failed' : rows.length ? 'ok' : 'none', rows };
    if (m.state === 'failed') g.message = m.message;
    else if (!rows.length) g.message = `The model gave no Hebrew word for “${text}”.`;
    groups.push(g);
  }
  const at = nowIso();
  const answer = { mode: 'english', text, groups, at };
  db.addEnglishLookup(text, at, answer);
  const n = count(answer);
  console.log(`look up "${text}" (English): ${n} Hebrew word${n === 1 ? '' : 's'} (${groups.map((g) => `${g.id} ${g.state === 'ok' ? g.rows.length : g.state}`).join(', ')})`);
  return answer;
}

// How many Hebrew words an answer holds.
function count(answer) {
  return answer.groups.reduce((n, g) => n + g.rows.length, 0);
}

// The kept answer of the newest look-up of `text` (the "Looked up" list
// reopening it): no site and no model is asked.
function kept(rawText) {
  const text = squash(String(rawText || ''));
  if (!text) throw new ReaderError(400, 'text is required: the English word looked up.');
  const row = db.latestEnglishLookup(text);
  if (!row) throw new ReaderError(404, `No English look-up of “${text}” is kept; look it up again.`);
  return { ...row.answer, kept: true };
}

// GET /english/entry: a row's source label, shown inside the page — a Pealim
// entry as a copy (lib/reference-pages.js entryPane), an English Wiktionary
// page framed.
async function entry({ site, path, page }) {
  if (site === 'pealim') return pages.entryPane(path);
  if (site === 'wiktionary') {
    const p = squash(page);
    if (!p || p.length > 120) throw new ReaderError(400, 'page is the Wiktionary page a row names (at most 120 characters).');
    const w = refs.ENGLISH.wiktionary;
    return { reference: w.id, label: w.label, term: p, mode: 'frame', url: w.url(p), ...(pages.STANDIN ? { frame_url: `${pages.STANDIN}/site/https/en.wiktionary.org/wiki/${encodeURIComponent(p)}` } : {}) };
  }
  throw new ReaderError(400, `site must be pealim or wiktionary; got ${JSON.stringify(site)}.`);
}

module.exports = { find, kept, entry, count, setClock, parsePealim, parseWiktionary, englishSection, KEEP_MS, HEADINGS };
