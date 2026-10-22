'use strict';
// Walks with the guide to Jewish thought (hebrew-walks-one): Dan asks a
// question in his own words (or starts at a passage), and the guide walks him
// through primary texts one stop at a time. He picks one of the directions it
// offers, or pushes back, and the next stop follows.
//
// A stop is two model calls on the `thought` desk (lib/ask-desks.js), both
// through the ask surface (lib/ask.js) with the walk as the subject, so the
// chain and the refusals are the ask surface's:
//   choose  no search, with room to think: the guide says how it reads the
//           move (`reading`, hebrew-guide-one), then names ONE reference
//           Sefaria knows that serves that reading, or declines a move
//           outside what it does. The reading goes to teach, which must
//           answer it, and is kept in the stop's JSON. The server
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
//
// A stop takes up to three minutes, longer than a phone or a proxy keeps one
// request open ("Failed to fetch", 21 Oct 2026). So Start and a step answer
// at once, with the walk marked `pending`, and make the stop in the
// background; the page reads the walk every few seconds until `pending` is
// off and the new stop is there, or `failure` says why there is none (the
// failure line, or `declined`). A reload, a cut connection or a switch to
// another app loses nothing. `?wait=1` on either POST waits for the stop
// and answers as before (the checks use it).

const db = require('./db');
const { ReaderError } = db;
const askSurface = require('./ask');
const desks = require('./ask-desks');
const sefaria = require('./sefaria');
const deskStore = require('./desk');
const library = require('./library');

const DESK = 'thought';
const QUESTION_MAX = deskStore.QUESTION_MAX; // a pushback or a question on a walk
const WALK_QUESTION_MAX = 4000; // the question a walk starts from: Dan types these at length (public/walks.js QUESTION_MAX)
const FAILED = 'The stop could not be made';
const NEXT_MAX = 3;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// The guide's web search leaves its citation markers inline in what it
// writes, `<cite index="7-8">…</cite>` as Dan saw them on a live stop (22 Oct
// 2026): the `<cite …>` tags and their closing tags go, the words between
// them stay, nothing else is touched. Only the tag named exactly `cite`, so
// prose such as "(cite the source) when x > y" and other tags
// (`<cite-note>`) stay. Sefaria's text has its own stripper
// (lib/sefaria.js `plain`).
// (any attributes: double or single quotes, unquoted, spaces around "=")
const CITE_OPEN = /<cite(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/gi;
const uncite = (s) => s.replace(CITE_OPEN, '').replace(/<\/cite\s*>/gi, '');
// One of the guide's fields, as text with no cite markers.
const said = (v) => uncite(text(v)).trim();

const CHOOSE_FORMAT = `Now choose the next stop. First read the reader's move closely: what is he really asking, at its full depth — beneath the words he used, and in the light of the walk so far? Then choose the one passage that best serves that reading. Answer with ONE JSON object and nothing else, the reading first:
{"reading": "<one or two sentences, in your own voice, addressed to him: what you take his move to be asking, at its full depth>", "ref": "<one reference Sefaria knows, in Sefaria's English form: a book and a place in it, such as Shabbat 112b, Genesis 1:1-3, Pirkei Avot 1:1, Guide for the Perplexed, Part 3 32>", "title": "<the text and the place, in English>", "declined": ""}
The passage must serve the reading. Name a short passage — a few verses, a few lines of a page, one paragraph — never a whole book or chapter, and never a stop the walk has already made.
When the reader's move asks you to answer him rather than open a passage — to reflect, to say what you think his question means, to answer a question of understanding, to take up his pushback — answer {"reply": "<your answer, in the first person, every term explained the first time>", "next": [{"label": "<a few words>", "why": "<one sentence>"}, … two or three directions]} instead and name no passage.
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

// Two or three explained directions, at most NEXT_MAX.
const readNext = (raw) => (Array.isArray(raw) ? raw : [])
  .map((d) => ({ label: said(d && d.label), why: said(d && d.why) })).filter((d) => d.label && d.why).slice(0, NEXT_MAX);

// choose: { reading, ref, title } (reading: what the guide takes the move to
// be asking, hebrew-guide-one; '' when it gave none), { reply, next } (the
// guide answers the move itself, with no passage: a reflection, a reading of
// the question, an answer to a pushback) or { declined }, kept as JSON text.
function readChoice(raw) {
  const declined = text(raw.declined);
  if (declined) return JSON.stringify({ declined });
  const ref = text(raw.ref);
  if (ref) return JSON.stringify({ reading: said(raw.reading), ref, title: text(raw.title) });
  const reply = said(raw.reply) || said(raw.answer);
  if (reply) return JSON.stringify({ reply, next: readNext(raw.next) });
  return '';
}

// The teaching call is told the reading its passage was chosen for, and must
// answer it (hebrew-guide-one).
const teachFormat = (reading) => (reading
  ? `${TEACH_FORMAT}\nWhen you chose this passage you read the reader's move as asking: ${reading}\nThe stop must answer that reading.`
  : TEACH_FORMAT);

// teach: the stop, every part as text and two or three directions, each with
// its reason; kept as JSON text, with the reading its passage was chosen for
// (`reading`, from choose; none for a walk started at a passage). A stop
// missing any part but the argument (which may be empty), or with fewer than
// two explained directions, is no stop: nothing is recorded (read runs
// before the write).
const NEXT_MIN = 2;
function readStop(raw, reading = '') {
  // declined at the teaching call: nothing is recorded
  if (text(raw.declined)) throw Object.assign(new ReaderError(200, text(raw.declined)), { declined: text(raw.declined) });
  const next = readNext(raw.next);
  const stop = {
    why_here: said(raw.why_here), transliteration: said(raw.transliteration), explanation: said(raw.explanation),
    argues: said(raw.argues), opinion: said(raw.opinion), next,
  };
  if (!stop.why_here && !stop.explanation && !stop.opinion && !next.length) return '';
  const missing = [
    !stop.why_here && 'the reason for the stop', !stop.transliteration && 'the transliteration', !stop.explanation && 'the explanation',
    !stop.opinion && 'the opinion', next.length < NEXT_MIN && `two or three directions each with its reason (it gave ${next.length})`,
  ].filter(Boolean);
  if (missing.length) throw new ReaderError(502, `${FAILED}: the guide's answer was missing ${missing.join(', ')}.`);
  return JSON.stringify(reading ? { reading, ...stop } : stop);
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

// The Study page a passage's first line is on, as an address, or null.
function studyOf(ref) {
  const page = library.pageHolding(ref);
  return page ? library.studyPath(page) : null;
}

// A stop as the page draws it: Stop N, the passage, the guide's parts, the
// cited pages, the time it took, and what Dan did to reach it ("You chose" /
// "You wrote", or the question or passage the walk began with).
function stopOf(row, n, prev, walk) {
  let s = {};
  try { s = JSON.parse(row.answer); } catch { s = { explanation: row.answer }; }
  const passage = row.ref ? db.getPassage(row.ref) : null;
  let move;
  // the first stop's move is the question or the passage the walk began with,
  // unless that first try made no stop and this stop came from the box
  if (n === 1 && !prev && walk.question && row.question === walk.question) move = { kind: 'question', text: walk.question };
  else if (n === 1 && !prev && walk.start_ref && row.question.startsWith('I am starting at ')) move = { kind: 'start', text: walk.title };
  else {
    // (prev's directions are read clean; a pick made before kept them raw)
    const picked = prev && (prev.next || []).find((d) => pickText(d) === said(row.question));
    move = picked ? { kind: 'pick', text: picked.label } : { kind: 'text', text: row.question };
  }
  return {
    // `lines`: the passage's whole length (null when kept before
    // hebrew-study-one), so a cut one says "First 40 of N lines"; `study`:
    // the Study page holding its first line (null outside the Tanakh and the
    // Talmud, and before Study's contents were first fetched)
    n, ask_id: row.id, ref: row.ref, passage: passage ? {
      ref: passage.ref, title: passage.title, he: passage.he, en: passage.en, url: passage.url,
      lines: passage.lines ?? null, shown: sefaria.SEGMENTS_MAX, study: studyOf(passage.ref),
    } : null,
    // a stop saved before hebrew-guide-one, a reply stop and a walk's first
    // stop at a passage have none
    // read clean: a stop stored before the cite markers were stripped shows
    // without them, its row unchanged
    reading: s.reply ? '' : said(s.reading),
    reply: said(s.reply),
    why_here: said(s.why_here), transliteration: said(s.transliteration), explanation: said(s.explanation), argues: said(s.argues), opinion: said(s.opinion),
    next: Array.isArray(s.next) ? s.next.map((d) => ({ ...d, label: said(d && d.label), why: said(d && d.why) })) : [], links: row.links || [], took_ms: row.took_ms, asked_at: row.asked_at, move,
  };
}

// GET /walks/:id/stops: the walk and its stops, oldest first, each with its
// passage — from the record only.
function get(id) {
  const w = requireWalk(id);
  const stops = [];
  for (const row of db.stopsOfWalk(w.id)) stops.push(stopOf(row, stops.length + 1, stops.at(-1), w));
  const p = pending.get(w.id) || null;
  return {
    id: w.id, title: w.title, question: w.question, start_ref: w.start_ref, started_at: w.started_at, stops,
    pending: Boolean(p), pending_since: p ? p.since : null, failure: failures.get(w.id) || null, state: stops.length ? 'ok' : 'no data',
  };
}

// GET /walks/list: newest first.
function list() {
  const items = db.listWalks().map((w) => ({ id: w.id, title: w.title, started_at: w.started_at, stops: w.stops }));
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- a stop ---------------------------------------------------------------------

// One stop after `move` (Dan's question, pick or pushback, as text): choose
// (unless `ref` is given), fetch, teach, record. Answers { stop } or
// { declined }. When the guide answers the move itself instead of naming a
// passage (a reflection, a reading of the question, an answer to a pushback),
// that answer is the stop: recorded with no reference, no teaching call.
async function makeStop(walk, move, { ref = null, parentId = null } = {}) {
  const desk = desks.get(DESK);
  const t0 = Date.now();
  const subject = { kind: 'walk', walk_id: walk.id };
  let passage, reading = '';
  // the limits of the call under way, so a time-out names its own limit
  let limits = desk.limits;
  try {
    if (ref) passage = await sefaria.passage(ref);
    else {
      limits = desk.choose || desk.limits;
      let question = move;
      for (let attempt = 1; ; attempt++) {
        const got = await askSurface.ask({ desk: DESK, subject, question, parent: parentId }, {
          what: FAILED, format: CHOOSE_FORMAT, read: readChoice, record: false, limits, search: false,
        });
        const choice = JSON.parse(got.answer);
        if (choice.declined) {
          console.log(`walk ${walk.id}: the guide declined — ${choice.declined}`);
          return { declined: choice.declined };
        }
        if (choice.reply) {
          const row = db.together(() => {
            const r = db.addAsk({ desk: DESK, subject_kind: 'walk', subject_text: `The walk: ${walk.id} (the guide answered the move itself, no passage)`, word: null, question: move, answer: got.answer, links: [], searches: 0, parent_id: parentId });
            const kept = db.setAskStop(r.id, { walk_id: walk.id, ref: null, took_ms: Date.now() - t0 });
            db.setWalkLast(walk.id, r.id);
            return kept;
          });
          console.log(`walk ${walk.id}: the guide answered the move itself, no passage (ask ${row.id}) in ${Date.now() - t0} ms`);
          return { stop: row.id };
        }
        try {
          passage = await sefaria.passage(choice.ref);
          reading = choice.reading || '';
          break;
        } catch (e) {
          if (e.status !== 404) throw e;
          if (attempt >= 2) throw new ReaderError(502, `${FAILED}: the guide twice named a passage Sefaria does not know (the last, "${choice.ref}").`);
          console.log(`walk ${walk.id}: Sefaria does not know "${choice.ref}"; asking the guide once more`);
          question = `${move}\n\n(You named "${choice.ref}", and Sefaria answered: ${e.message} Name another reference, one Sefaria knows.)`;
        }
      }
    }
    limits = desk.limits;
    const got = await askSurface.ask({ desk: DESK, subject: { ...subject, ref: passage.ref }, question: move, parent: parentId }, {
      what: FAILED, format: teachFormat(reading), read: (raw) => readStop(raw, reading),
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
    throw failure(e, limits);
  }
}

// POST /walks/start: { question } or { ref }.
async function start(body = {}, { wait = false } = {}) {
  const hasQ = body.question !== undefined && body.question !== null && body.question !== '';
  const hasRef = body.ref !== undefined && body.ref !== null && body.ref !== '';
  if (hasQ === hasRef) throw new ReaderError(400, 'A walk starts from { question: <your question, as text> } or { ref: <a text reference Sefaria knows, such as Shabbat 112b> }, one of the two.');
  let walk;
  if (hasQ) {
    const question = text(body.question);
    if (typeof body.question !== 'string' || !question) throw new ReaderError(400, 'question is text: the question to walk with.');
    if (question.length > WALK_QUESTION_MAX) throw new ReaderError(400, `question is at most ${WALK_QUESTION_MAX} characters; this one has ${question.length}.`);
    walk = db.addWalk({ desk: DESK, question, start_ref: null, title: question });
    console.log(`walk ${walk.id}: started from a question`);
    return move(walk, () => makeStop(walk, question), wait);
  }
  if (typeof body.ref !== 'string') throw new ReaderError(400, 'ref is text: a reference Sefaria knows, such as Shabbat 112b.');
  // the passage first: a reference Sefaria does not know makes no walk
  const passage = await sefaria.passage(body.ref);
  walk = db.addWalk({ desk: DESK, question: null, start_ref: passage.ref, title: passage.title });
  console.log(`walk ${walk.id}: started from ${passage.ref}`);
  return move(walk, () => makeStop(walk, `I am starting at ${passage.title}. Walk me into it, and ask me what I notice.`, { ref: passage.ref }), wait);
}

// POST /walks/:id/step: { pick: <index of an offered direction> } or
// { text: <a pushback or a question> }.
async function step(id, body = {}, { wait = false } = {}) {
  const walk = requireWalk(id);
  // one move at a time on a walk: a second tab or device pressing while a
  // stop is on its way would otherwise chain its stop to the same parent
  if (pending.has(walk.id)) throw new ReaderError(409, 'A stop is already being made on this walk; wait for it to arrive, then go on from there.');
  return stepNow(walk, body, wait);
}

const pending = new Map();  // walk id -> { since } while a stop is on its way
const failures = new Map(); // walk id -> { status, error } or { declined }, from the last move that made no stop

// Runs `make` for the walk: waited for (`wait`, the checks) and answered as
// the walk with its new stop, `declined`, or the failure thrown; or started
// in the background and answered at once as the walk marked pending.
async function move(walk, make, wait) {
  pending.set(walk.id, { since: new Date().toISOString() });
  failures.delete(walk.id);
  if (wait) {
    try { return answer(walk.id, await stepOrKeep(walk, make)); } finally { pending.delete(walk.id); }
  }
  (async () => {
    try {
      const out = await stepOrKeep(walk, make);
      if (out.declined) failures.set(walk.id, { status: 200, declined: out.declined });
    } catch (e) {
      failures.set(walk.id, { status: e.status || 500, error: e.message });
    } finally {
      pending.delete(walk.id);
    }
  })();
  return answer(walk.id, { pending: true });
}

async function stepNow(walk, body, wait) {
  const stops = get(walk.id).stops;
  const last = stops.at(-1) || null;
  const hasPick = body.pick !== undefined && body.pick !== null;
  const hasText = body.text !== undefined && body.text !== null;
  const offered = last ? last.next : [];
  const valid = offered.length ? `pick is one of ${offered.map((_, i) => i).join(', ')} (${offered.map((d, i) => `${i}: ${d.label}`).join('; ')})` : 'this walk has no directions to pick from yet';
  if (hasPick === hasText) throw new ReaderError(400, `A step is { pick: <the number of an offered direction> } or { text: <your pushback or question> }, one of the two; ${valid}.`);
  let moveText;
  if (hasPick) {
    const i = Number(body.pick);
    if (!Number.isInteger(i) || i < 0 || i >= offered.length) throw new ReaderError(400, `${valid}; got ${JSON.stringify(body.pick)}.`);
    moveText = pickText(offered[i]);
  } else {
    moveText = text(body.text);
    if (typeof body.text !== 'string' || !moveText) throw new ReaderError(400, 'text is your pushback or question, as text.');
    if (moveText.length > QUESTION_MAX) throw new ReaderError(400, `text is at most ${QUESTION_MAX} characters; this one has ${moveText.length}.`);
  }
  return move(walk, () => makeStop(walk, moveText, { parentId: last ? last.ask_id : null }), wait);
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
  if (out.pending) return walk;
  return { ...walk, ...(out.declined ? { declined: out.declined } : { new_stop: walk.stops.length }) };
}

module.exports = { start, step, get, list, readStop, readChoice, pickText, CHOOSE_FORMAT, TEACH_FORMAT, FAILED, DESK, WALK_QUESTION_MAX };
