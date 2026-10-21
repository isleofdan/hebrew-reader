'use strict';
// Walks with the guide to Jewish thought (hebrew-walks-one): Dan asks a
// question in his own words (or starts at a passage), and the guide walks him
// through primary texts one stop at a time. He picks one of the directions it
// offers, or pushes back, and the next stop follows.
//
// A stop is two model calls on the `thought` desk (lib/ask-desks.js), both
// through the ask surface (lib/ask.js) with the walk as the subject, so the
// chain and the refusals are the ask surface's:
//   choose  short, no search: the guide names ONE reference Sefaria knows for
//           the stop, or declines a move outside what it does. The server
//           fetches the passage (lib/sefaria.js); a reference Sefaria does not
//           know is sent back once, with Sefaria's message, for one more
//           choice. Not recorded. A walk started from a reference skips it.
//   teach   with the search limited to Sefaria: given the passage's Hebrew
//           and English, the stop itself as one JSON object. Recorded in
//           `asks` (its parent the previous stop, its walk, the passage's
//           reference, and the time both calls took together).
// The model never writes the passage and never writes an address: the text
// comes from Sefaria, "Full passage" is built from the reference
// (lib/references.js), and the links under the argument are the pages the
// search cited (grow.js `linksFrom`).
//
// Nothing here runs unless Dan pressed Start, a direction or Go; reading a
// walk (get, list) makes no model call and no request to Sefaria.

const db = require('./db');
const { ReaderError } = db;
const askSurface = require('./ask');
const desks = require('./ask-desks');
const sefaria = require('./sefaria');
const deskStore = require('./desk');

const DESK = 'thought';
const QUESTION_MAX = deskStore.QUESTION_MAX;
const FAILED = 'The stop could not be made';
const NEXT_MAX = 3;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

const CHOOSE_FORMAT = `Now choose the next stop. Answer with ONE JSON object and nothing else:
{"ref": "<one reference Sefaria knows, in Sefaria's English form: a book and a place in it, such as Shabbat 112b, Genesis 1:1-3, Pirkei Avot 1:1, Guide for the Perplexed, Part 3 32>", "title": "<the text and the place, in English>", "declined": ""}
Name a short passage — a few verses, a few lines of a page, one paragraph — never a whole book or chapter, and never a stop the walk has already made.
When the reader's move is outside what you do, answer {"declined": "<one line saying why>"} instead.`;

const TEACH_FORMAT = `The passage for this stop is given above, fetched from Sefaria; the reader sees it beside your words, so never write it out. You may search Sefaria for where the tradition argues with itself about it; the pages you cite are shown under that part.
Answer with ONE JSON object and nothing else:
{"why_here": "<one or two sentences: why this is the stop>",
 "transliteration": "<the Hebrew of the passage in Latin letters, line for line as it is given>",
 "explanation": "<what it says, plainly; every term, name and text explained the first time>",
 "argues": "<where the tradition argues with itself about it, naming the sides; \\"\\" when it does not>",
 "opinion": "<your own opinion, in the first person, inviting him to disagree>",
 "next": [{"label": "<a few words>", "why": "<one sentence>"}, … two or three of them]}`;

// --- the guide's answers ---------------------------------------------------------

// choose: { ref, title } or { declined }, kept as JSON text.
function readChoice(raw) {
  const declined = text(raw.declined);
  if (declined) return JSON.stringify({ declined });
  const ref = text(raw.ref);
  if (!ref) return '';
  return JSON.stringify({ ref, title: text(raw.title) });
}

// teach: the stop, every part as text and two or three directions; kept as
// JSON text. A stop missing its explanation, its opinion or its directions
// is no stop.
function readStop(raw) {
  // declined at the teaching call: nothing is recorded (read runs before the write)
  if (text(raw.declined)) throw Object.assign(new ReaderError(200, text(raw.declined)), { declined: text(raw.declined) });
  const next = (Array.isArray(raw.next) ? raw.next : [])
    .map((d) => ({ label: text(d && d.label), why: text(d && d.why) })).filter((d) => d.label).slice(0, NEXT_MAX);
  const stop = {
    why_here: text(raw.why_here), transliteration: text(raw.transliteration), explanation: text(raw.explanation),
    argues: text(raw.argues), opinion: text(raw.opinion), next,
  };
  if (!stop.explanation && !stop.opinion && !next.length) return '';
  if (!stop.explanation || !stop.opinion || !next.length) {
    const missing = [!stop.explanation && 'the explanation', !stop.opinion && 'the opinion', !next.length && 'the directions'].filter(Boolean);
    throw new ReaderError(502, `${FAILED}: the guide's answer had no ${missing.join(' and no ')}.`);
  }
  return JSON.stringify(stop);
}

// A failure line that says which: the model, Sefaria, or the time limit.
function failure(e, limits) {
  if (e.status === 502 && /OpenRouter timed out/.test(e.message)) {
    return new ReaderError(504, `${FAILED}: the guide did not answer within the time limit of ${Math.round(limits.timeoutMs / 1000)} s.`);
  }
  if (e.status === 502 && e.message.startsWith(sefaria.UNREACHABLE)) return new ReaderError(502, `${FAILED}: ${e.message}`);
  return e;
}

// --- the walk as the page reads it -------------------------------------------------

function walkId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || String(id).trim() !== String(n)) throw new ReaderError(400, `A walk is named by its whole number id; got ${JSON.stringify(id)}. GET /walks/list lists the walks.`);
  return n;
}

function requireWalk(id) {
  const n = walkId(id);
  const w = db.getWalk(n);
  if (!w) {
    const ids = db.listWalks().map((x) => x.id);
    throw new ReaderError(404, `No walk with id ${n}. ${ids.length ? `The walks are ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}.` : 'There are no walks yet.'}`);
  }
  return w;
}

// The move of a pick, as the guide reads it and the asks row keeps it.
const pickText = (d) => `I choose: ${d.label}${d.why ? ` — ${d.why}` : ''}`;

// A stop as the page draws it: Stop N, the passage, the guide's parts, the
// cited pages, the time it took, and what Dan did to reach it ("You chose" /
// "You wrote", or the question or passage the walk began with).
function stopOf(row, n, prev, walk) {
  let s = {};
  try { s = JSON.parse(row.answer); } catch { s = { explanation: row.answer }; }
  const passage = row.ref ? db.getPassage(row.ref) : null;
  let move;
  if (n === 1 && !prev) move = walk.question ? { kind: 'question', text: walk.question } : { kind: 'start', text: walk.title };
  else {
    const picked = prev && (prev.next || []).find((d) => pickText(d) === row.question);
    move = picked ? { kind: 'pick', text: picked.label } : { kind: 'text', text: row.question };
  }
  return {
    n, ask_id: row.id, ref: row.ref, passage: passage ? { ref: passage.ref, title: passage.title, he: passage.he, en: passage.en, url: passage.url } : null,
    why_here: s.why_here || '', transliteration: s.transliteration || '', explanation: s.explanation || '', argues: s.argues || '', opinion: s.opinion || '',
    next: Array.isArray(s.next) ? s.next : [], links: row.links || [], took_ms: row.took_ms, asked_at: row.asked_at, move,
  };
}

// GET /walks/:id/stops: the walk and its stops, oldest first, each with its
// passage — from the record only.
function get(id) {
  const w = requireWalk(id);
  const stops = [];
  for (const row of db.stopsOfWalk(w.id)) stops.push(stopOf(row, stops.length + 1, stops.at(-1), w));
  return { id: w.id, title: w.title, question: w.question, start_ref: w.start_ref, started_at: w.started_at, stops, state: stops.length ? 'ok' : 'no data' };
}

// GET /walks/list: newest first.
function list() {
  const items = db.listWalks().map((w) => ({ id: w.id, title: w.title, started_at: w.started_at, stops: w.stops }));
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- a stop ---------------------------------------------------------------------

// One stop after `move` (Dan's question, pick or pushback, as text): choose
// (unless `ref` is given), fetch, teach, record. Answers { stop } or
// { declined }.
async function makeStop(walk, move, { ref = null, parentId = null } = {}) {
  const desk = desks.get(DESK);
  const t0 = Date.now();
  const subject = { kind: 'walk', walk_id: walk.id };
  let passage;
  try {
    if (ref) passage = await sefaria.passage(ref);
    else {
      let question = move;
      for (let attempt = 1; ; attempt++) {
        const got = await askSurface.ask({ desk: DESK, subject, question, parent: parentId }, {
          what: FAILED, format: CHOOSE_FORMAT, read: readChoice, record: false, limits: desk.choose || desk.limits, search: false,
        });
        const choice = JSON.parse(got.answer);
        if (choice.declined) {
          console.log(`walk ${walk.id}: the guide declined — ${choice.declined}`);
          return { declined: choice.declined };
        }
        try {
          passage = await sefaria.passage(choice.ref);
          break;
        } catch (e) {
          if (e.status !== 404) throw e;
          if (attempt >= 2) throw new ReaderError(502, `${FAILED}: the guide twice named a passage Sefaria does not know (the last, "${choice.ref}").`);
          console.log(`walk ${walk.id}: Sefaria does not know "${choice.ref}"; asking the guide once more`);
          question = `${move}\n\n(You named "${choice.ref}", and Sefaria answered: ${e.message} Name another reference, one Sefaria knows.)`;
        }
      }
    }
    const got = await askSurface.ask({ desk: DESK, subject: { ...subject, ref: passage.ref }, question: move, parent: parentId }, {
      what: FAILED, format: TEACH_FORMAT, read: readStop,
      alsoWrite: (row) => {
        const kept = db.setAskStop(row.id, { walk_id: walk.id, ref: passage.ref, took_ms: Date.now() - t0 });
        db.setWalkLast(walk.id, row.id);
        return kept;
      },
    });
    console.log(`walk ${walk.id}: stop at ${passage.ref} (ask ${got.id}) in ${Date.now() - t0} ms`);
    return { stop: got.id };
  } catch (e) {
    if (e.declined) {
      console.log(`walk ${walk.id}: the guide declined — ${e.declined}`);
      return { declined: e.declined };
    }
    throw failure(e, desk.limits);
  }
}

// POST /walks/start: { question } or { ref }.
async function start(body = {}) {
  const hasQ = body.question !== undefined && body.question !== null && body.question !== '';
  const hasRef = body.ref !== undefined && body.ref !== null && body.ref !== '';
  if (hasQ === hasRef) throw new ReaderError(400, 'A walk starts from { question: <your question, as text> } or { ref: <a text reference Sefaria knows, such as Shabbat 112b> }, one of the two.');
  let walk;
  if (hasQ) {
    const question = text(body.question);
    if (typeof body.question !== 'string' || !question) throw new ReaderError(400, 'question is text: the question to walk with.');
    if (question.length > QUESTION_MAX) throw new ReaderError(400, `question is at most ${QUESTION_MAX} characters; this one has ${question.length}.`);
    walk = db.addWalk({ desk: DESK, question, start_ref: null, title: question });
    console.log(`walk ${walk.id}: started from a question`);
    const out = await stepOrKeep(walk, () => makeStop(walk, question));
    return answer(walk.id, out);
  }
  if (typeof body.ref !== 'string') throw new ReaderError(400, 'ref is text: a reference Sefaria knows, such as Shabbat 112b.');
  // the passage first: a reference Sefaria does not know makes no walk
  const passage = await sefaria.passage(body.ref);
  walk = db.addWalk({ desk: DESK, question: null, start_ref: passage.ref, title: passage.title });
  console.log(`walk ${walk.id}: started from ${passage.ref}`);
  const out = await stepOrKeep(walk, () => makeStop(walk, `I am starting at ${passage.title}. Walk me into it, and ask me what I notice.`, { ref: passage.ref }));
  return answer(walk.id, out);
}

// POST /walks/:id/step: { pick: <index of an offered direction> } or
// { text: <a pushback or a question> }.
async function step(id, body = {}) {
  const walk = requireWalk(id);
  const stops = get(walk.id).stops;
  const last = stops.at(-1) || null;
  const hasPick = body.pick !== undefined && body.pick !== null;
  const hasText = body.text !== undefined && body.text !== null;
  const offered = last ? last.next : [];
  const valid = offered.length ? `pick is one of ${offered.map((_, i) => i).join(', ')} (${offered.map((d, i) => `${i}: ${d.label}`).join('; ')})` : 'this walk has no directions to pick from yet';
  if (hasPick === hasText) throw new ReaderError(400, `A step is { pick: <the number of an offered direction> } or { text: <your pushback or question> }, one of the two; ${valid}.`);
  let move;
  if (hasPick) {
    const i = Number(body.pick);
    if (!Number.isInteger(i) || i < 0 || i >= offered.length) throw new ReaderError(400, `${valid}; got ${JSON.stringify(body.pick)}.`);
    move = pickText(offered[i]);
  } else {
    move = text(body.text);
    if (typeof body.text !== 'string' || !move) throw new ReaderError(400, 'text is your pushback or question, as text.');
    if (move.length > QUESTION_MAX) throw new ReaderError(400, `text is at most ${QUESTION_MAX} characters; this one has ${move.length}.`);
  }
  const out = await stepOrKeep(walk, () => makeStop(walk, move, { parentId: last ? last.ask_id : null }));
  return answer(walk.id, out);
}

// A stop that fails keeps the walk and its earlier stops; the error carries
// the walk's id so the page can show it.
async function stepOrKeep(walk, run) {
  try {
    return await run();
  } catch (e) {
    e.walk_id = walk.id;
    console.error(`walk ${walk.id}: no stop — ${e.message}`);
    throw e;
  }
}

function answer(id, out) {
  const walk = get(id);
  return { ...walk, ...(out.declined ? { declined: out.declined } : { new_stop: walk.stops.length }) };
}

module.exports = { start, step, get, list, readStop, readChoice, pickText, CHOOSE_FORMAT, TEACH_FORMAT, FAILED, DESK };
