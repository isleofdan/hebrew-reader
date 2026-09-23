'use strict';
// Lessons from Guy: a PDF in, its lines out as the lesson's items.
//
// Guy's PDFs are text PDFs: one word, phrase or sentence per line, no
// explanations. The text comes out through unpdf (pdf.js, pure JavaScript),
// which already turns right-to-left runs into reading order; this file puts
// the runs of one printed line together and the lines into items.

const { ReaderError } = require('./db');
const db = require('./db');
const lookup = require('./lookup');
const spine = require('./spine');
const prompt = require('./guy-lesson-prompt');
const checks = require('./guide-checks');
const tok = require('../public/tokenize.js');

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_ITEMS = 5;
const HEBREW = /[א-ת]/;

// The item rule. One item per non-empty printed line. A line is joined to the
// next one only when the PDF itself wrapped a sentence there: the line runs
// the full width of the text block (at least 90% of the block, and at least
// 60% of the page, so the longest short item on a page is never taken for a
// wrapped one) and does not end in . ! ? or :. Lines with no Hebrew letter
// (a header, a date, a name) are left out and counted.
const FULL_OF_BLOCK = 0.9;
const FULL_OF_PAGE = 0.6;

let unpdf = null;
function pdfLib() {
  if (!unpdf) unpdf = require('unpdf');
  return unpdf;
}

// Printed lines of one page: [{ text, left, right }], top to bottom.
function pageLines(items) {
  const runs = items.filter((it) => it.str && it.str.trim()).map((it) => ({
    str: it.str, dir: it.dir, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height) || Math.abs(it.transform[3]) || 10,
  }));
  runs.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const r of runs) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= Math.max(2, r.h * 0.4));
    if (line) line.runs.push(r); else lines.push({ y: r.y, runs: [r] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => {
    const rtl = l.runs.filter((r) => r.dir === 'rtl').length >= l.runs.length / 2;
    const ordered = [...l.runs].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let text = '';
    let prev = null;
    for (const r of ordered) {
      if (prev) {
        const gap = rtl ? prev.x - (r.x + r.w) : r.x - (prev.x + prev.w);
        if (gap > r.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(r.str)) text += ' ';
      }
      text += r.str;
      prev = r;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      left: Math.min(...l.runs.map((r) => r.x)),
      right: Math.max(...l.runs.map((r) => r.x + r.w)),
    };
  }).filter((l) => l.text);
}

// { items, other, chars } from the PDF bytes. Throws a ReaderError naming what
// was wrong with the file.
async function extract(buf, name) {
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ReaderError(400, `${name} is not a PDF.`);
  }
  let doc;
  try {
    doc = await pdfLib().getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new ReaderError(422, `${name} could not be read as a PDF: ${e.message}`);
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const width = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const pl = pageLines(content.items);
    if (!pl.length) continue;
    const blockLeft = Math.min(...pl.map((l) => l.left));
    const blockRight = Math.max(...pl.map((l) => l.right));
    for (const l of pl) {
      const extent = l.right - l.left;
      l.wrapped = extent >= FULL_OF_BLOCK * (blockRight - blockLeft) && extent >= FULL_OF_PAGE * width && !/[.!?:]$/.test(l.text);
      lines.push(l);
    }
  }
  const joined = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].text;
    while (lines[i].wrapped && i + 1 < lines.length) text += ' ' + lines[++i].text;
    joined.push(text);
  }
  const items = joined.filter((t) => HEBREW.test(t));
  return { items, other: joined.length - items.length, chars: joined.join('').length };
}

// --- title and date from the file name --------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Guy's file names: "Daniel HEB 15jun26", "Daniel Hebrew 24feb26",
// "Daniel Guy 10FEB2025", "Daniel Guy 21oct2024".
const NAME_PATTERN = /^Daniel\s+(?:HEB|Hebrew|Guy)\s+(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{4}|\d{2})$/i;

// The date as Hebrew writes it (15.6.2026): an English month name inside a
// right-to-left line is reordered by the browser into "Jun 2026 15".
function lessonTitle(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `שיעור עם גיא — ${d}.${m}.${y}`;
}

// { title, lesson_date, from } where from is 'file name pattern' or 'file name'.
function nameAndDate(fileName, today = new Date().toISOString().slice(0, 10)) {
  const base = String(fileName || 'lesson.pdf').replace(/\.pdf$/i, '').trim();
  const m = NAME_PATTERN.exec(base);
  if (m) {
    const day = Number(m[1]), month = MONTHS[m[2].toLowerCase()];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(year, (month || 1) - 1, day));
    if (month && date.getUTCDate() === day && date.getUTCMonth() === month - 1) {
      const iso = date.toISOString().slice(0, 10);
      return { title: lessonTitle(iso), lesson_date: iso, from: 'file name pattern' };
    }
  }
  return { title: base || 'Lesson', lesson_date: today, from: 'file name' };
}

// --- upload -----------------------------------------------------------------

// The PDF in, the lesson stored. Answers { lesson, created, note }.
async function add({ fileName, bytes }) {
  const name = String(fileName || '').trim() || 'lesson.pdf';
  if (bytes.length > MAX_BYTES) throw new ReaderError(413, `${name} is over 5 MB; a lesson PDF is a few dozen KB.`);
  const { items, other, chars } = await extract(bytes, name);
  if (!items.length) {
    throw new ReaderError(422, chars
      ? `No Hebrew text was found in ${name}: ${other} line${other === 1 ? '' : 's'} of other text only.`
      : `No text was found in ${name}; it may be a scan, and this app reads text PDFs only.`);
  }
  if (items.length < MIN_ITEMS) {
    throw new ReaderError(422, `Only ${items.length} Hebrew item${items.length === 1 ? ' was' : 's were'} found in ${name}; a lesson needs at least ${MIN_ITEMS}.`);
  }
  const text = items.join('\n');
  const existing = db.lessonByText(text);
  if (existing) return { lesson: existing, created: false, note: `This lesson is already here, as "${existing.title}".` };
  const named = nameAndDate(name);
  const lesson = db.addLesson({ title: named.title, lesson_date: named.lesson_date, source_name: name, text, items });
  const notes = [named.from === 'file name pattern'
    ? 'Title and date read from the file name.'
    : 'The file name is not one of Guy\'s patterns, so the title is the file name and the date is today\'s.'];
  if (other) notes.push(`${other} line${other === 1 ? '' : 's'} with no Hebrew left out.`);
  console.log(`lesson ${lesson.id}: "${lesson.title}" from ${name}, ${items.length} items (${named.from})`);
  return { lesson, created: true, from: named.from, note: notes.join(' ') };
}

// --- the study guide and the cards ------------------------------------------

const GUIDE_WHAT = 'The study guide could not be built';
// The build writes the whole guide (the model's longest answer): live builds
// of the 39-line June lesson finished inside five minutes, with little room.
const GUIDE_TIMEOUT_MS = 10 * 60 * 1000;
// The review reads the whole guide and writes it back whole, corrected: on the
// guide model a 39-line lesson took longer than five minutes (first live run,
// 22 Sep 2026, "OpenRouter timed out"), so it gets fifteen.
const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const GUIDE_MAX_TOKENS = 32000; // room for 35 cards of Hebrew and the guide; a cut-off answer is not JSON and fails whole
const KIND_ORDER = ['topics', 'grammar', 'drills', 'paper', 'vocabulary', 'questions', 'expressions'];

const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const strs = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

// Hebrew compared without nikud, punctuation or spacing differences, so a
// card's word can be found in the lesson whichever way the model points it.
const { plain } = checks;

function inLesson(lessonPlain, he) {
  const p = plain(he);
  return Boolean(p) && lessonPlain.includes(p);
}

// The model's answer, checked and put in the instructions' order. Anything the
// model added that is not in the lesson is dropped and counted; a guide with
// nothing usable is refused. Throws a ReaderError starting with GUIDE_WHAT.
function shapeGuide(raw, lesson) {
  if (!raw || typeof raw !== 'object') throw new ReaderError(502, `${GUIDE_WHAT}: the model did not return a JSON object.`);
  if (raw.error) throw new ReaderError(422, `${GUIDE_WHAT}: the model declined — ${str(raw.error)}`);
  if (raw.text) throw new ReaderError(502, `${GUIDE_WHAT}: the model did not return JSON.`);
  const lessonPlain = ` ${plain(lesson.text)} `;
  const lessonLines = new Set((lesson.items || []).map(plain));
  const dropped = { cards: 0, vocabulary: 0, expressions: 0, over_cap: 0 };
  const sections = [];
  const seen = new Set();
  for (const sec of list(raw.sections)) {
    const kind = str(sec.kind);
    if (!KIND_ORDER.includes(kind) || (kind !== 'grammar' && seen.has(kind))) continue;
    let out = null;
    if (kind === 'topics') {
      const items = strs(sec.items);
      if (items.length) out = { kind, items };
    } else if (kind === 'grammar') {
      const g = { kind, topic: str(sec.topic),
        guys_lines: strs(sec.guys_lines).filter((l) => lessonLines.has(plain(l))),
        explanation: str(sec.explanation),
        examples: list(sec.examples).map((e) => ({ he: str(e.he), en: str(e.en) })).filter((e) => e.he),
        // No "for Guy" explanation: Dan's decision, 22 Sep 2026 — dropped here
        // even when the model writes one.
        verb_claims: list(sec.verb_claims).map((c) => ({ verb: str(c.verb), takes_object: checks.objectValue(c.takes_object) })).filter((c) => c.verb) };
      if (g.topic || g.explanation) out = g;
    } else if (kind === 'drills') {
      const verbs = list(sec.verbs).slice(0, prompt.MAX_DRILL_VERBS).map((v) => ({
        verb: str(v.verb), root: str(v.root), binyan: str(v.binyan), deviation: str(v.deviation).toLowerCase() || null,
        takes_object: checks.objectValue(v.takes_object), why: str(v.why),
        table: list(v.table).map((t) => ({ tense: str(t.tense), forms: list(t.forms).map((f) => ({ person: str(f.person), he: str(f.he) })).filter((f) => f.he) })).filter((t) => t.forms.length),
        deviations: str(v.deviations) || null, paal_comparison: str(v.paal_comparison) || null,
        exercises: list(v.exercises).slice(0, 4).map((x) => ({ sentence: str(x.sentence), cue: str(x.cue), answer: str(x.answer) })).filter((x) => x.sentence),
      })).filter((v) => v.verb);
      if (verbs.length) out = { kind, verbs };
    } else if (kind === 'paper') {
      const prompts = list(sec.prompts).slice(0, prompt.MAX_PAPER_PROMPTS).map((x) => ({
        type: str(x.type), anchor: str(x.anchor), prompt: str(x.prompt), categories: strs(x.categories) })).filter((x) => x.prompt);
      if (prompts.length) out = { kind, prompts };
    } else if (kind === 'vocabulary') {
      const all = list(sec.rows).map((r) => ({ he: str(r.he), pointed: str(r.pointed), en: str(r.en), root: str(r.root), binyan: str(r.binyan), category: str(r.category), flags: str(r.flags) })).filter((r) => r.he);
      const rows = all.filter((r) => inLesson(lessonPlain, r.he));
      dropped.vocabulary += all.length - rows.length;
      if (rows.length) out = { kind, rows };
    } else if (kind === 'questions') {
      const items = strs(sec.items);
      if (items.length) out = { kind, items };
    } else if (kind === 'expressions') {
      const all = list(sec.items).map((x) => ({ he: str(x.he), en: str(x.en), usage: str(x.usage), flags: str(x.flags) })).filter((x) => x.he);
      const items = all.filter((x) => inLesson(lessonPlain, x.he));
      dropped.expressions += all.length - items.length;
      if (items.length) out = { kind, items };
    }
    if (out) { sections.push(out); seen.add(kind); }
  }
  sections.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const width = prompt.CARD_FIELDS.length;
  const allCards = (Array.isArray(raw.cards) ? raw.cards : []).filter(Array.isArray)
    .map((c) => Array.from({ length: width }, (_, i) => str(c[i])));
  const kept = allCards.filter((c) => inLesson(lessonPlain, c[1] || c[0]));
  dropped.cards = allCards.length - kept.length;
  dropped.over_cap = Math.max(0, kept.length - prompt.MAX_CARDS);
  const cards = kept.slice(0, prompt.MAX_CARDS);
  if (!sections.length && !cards.length) throw new ReaderError(502, `${GUIDE_WHAT}: the model's answer held no section and no card.`);
  return {
    title: str(raw.title) || lesson.title, date: str(raw.date) || lesson.lesson_date,
    sections, cards, dropped, model: lookup.GUIDE_MODEL, built_with: 'guide model', built_at: new Date().toISOString(),
  };
}

// --- the lesson's words onto the map ------------------------------------------

// The word rule: an item that is one token after the shared tokenizer is a
// word; anything else is a phrase and stays in the guide and the cards only.
// A word goes through the reader's own card path (same cache, same spot id,
// its sentence being the item itself, as the lesson page cuts it). A spot not
// yet on the map (absent, or only met) is saved shaky and sent to the spine;
// a shaky or solid spot is touched and keeps its status.
// One word of the lesson onto the map: its card through the reader's own path
// (cache, spot, touch), then saved shaky when it was not yet on the map.
// Answers 'saved', 'touched' or 'same spot', plus the spine outcome; throws
// the card's own error when the word could not be identified.
async function saveOne(lesson, surface, item, start, done, tally) {
  const r = await lookup.lookup({ surface, sentence: tok.sentenceAt(item, start), lesson_id: lesson.id });
  if (!r.spot) throw new ReaderError(422, 'No spot for this word.');
  if (done.has(r.spot.id)) return 'same spot';
  done.add(r.spot.id);
  if (r.spot.status === 'new') {
    const spot = db.setSpotStatus(r.spot.id, 'shaky');
    tally(await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) }));
    return 'saved';
  }
  tally(r.spine);
  return 'touched';
}

function spineTally(out) {
  return (o) => { if (o && o !== 'not on spine') out.spine[o] = (out.spine[o] || 0) + 1; };
}

async function saveWords(lesson) {
  const out = { words: 0, touched: 0, phrases: 0, failed: [], spine: {} };
  const done = new Set();
  const tally = spineTally(out);
  let unreachable = 0;
  for (const item of lesson.items) {
    const words = tok.words(item);
    if (words.length !== 1) { out.phrases++; continue; }
    const surface = words[0].surface;
    let result;
    try {
      result = await saveOne(lesson, surface, item, words[0].start, done, tally);
    } catch (e) {
      if ((e.status || 500) >= 500) unreachable++;
      out.failed.push({ surface, error: e.message });
      continue;
    }
    if (result === 'saved') out.words++;
    else if (result === 'touched') out.touched++;
  }
  const singles = out.words + out.touched + out.failed.length;
  // The model or the network was down for every word: nothing is recorded as
  // done, so the next build of the guide tries the words again.
  if (singles && unreachable === singles) {
    console.error(`lesson ${lesson.id}: no word could be looked up (${out.failed[0].error}); words not saved`);
    return null;
  }
  console.log(`lesson ${lesson.id}: ${out.words} words saved shaky, ${out.touched} touched, ${out.phrases} phrases kept in the guide only`
    + (out.failed.length ? `, ${out.failed.length} could not be looked up` : ''));
  return out;
}

// "Try again" on a word the card could not identify: one lookup (one model
// call; a failure is never cached). On success the word is saved shaky like
// the others and leaves the list; on failure it stays, with the new reason.
async function retryWord(id, surface) {
  const lesson = db.getLesson(id);
  surface = str(surface);
  if (!surface) throw new ReaderError(400, 'surface is required: the word to try again.');
  const saved = lesson.saved;
  const entry = saved && saved.failed.find((f) => f.surface === surface);
  if (!entry) throw new ReaderError(404, `${surface} is not among this lesson's words the card could not identify.`);
  const item = lesson.items.find((i) => { const w = tok.words(i); return w.length === 1 && w[0].surface === surface; });
  if (!item) throw new ReaderError(404, `${surface} is not a single-word item of this lesson.`);
  const start = tok.words(item)[0].start;
  let result;
  try {
    result = await saveOne(lesson, surface, item, start, new Set(), spineTally(saved));
  } catch (e) {
    entry.error = e.message;
    db.setLessonSaved(lesson.id, saved);
    console.error(`lesson ${lesson.id}: try again on ${surface} failed, ${e.message}`);
    throw e;
  }
  saved.failed = saved.failed.filter((f) => f !== entry);
  if (result === 'saved') saved.words++;
  else saved.touched++;
  db.setLessonSaved(lesson.id, saved);
  console.log(`lesson ${lesson.id}: try again on ${surface}: ${result}`);
  return { surface, result, saved };
}

// Builds in the background; the lesson page asks for the state until it is
// done. One build per lesson at a time. A failure is remembered here, not in
// the database, so the next open tries again; nothing partial is saved. The
// lesson's words are saved after the first guide that builds.
const building = new Map();
const saving = new Map();
const failures = new Map();

function startSaving(id) {
  if (saving.has(id)) return;
  const run = saveWords(db.getLesson(id))
    .then(async (saved) => { if (saved) { db.setLessonSaved(id, saved); await fixCards(id); } })
    .catch((e) => console.error(`lesson ${id}: words not saved, ${e.message}`))
    .finally(() => saving.delete(id));
  saving.set(id, run);
}

// The lesson's cached word cards: the card of each single-word item, under
// the key the word save uses (its sentence is the item itself). Answers
// [{ surface, hit }] where hit is the cards row with its parsed card.
function lessonCards(lesson) {
  const out = [];
  for (const item of lesson.items) {
    const words = tok.words(item);
    if (words.length !== 1) continue;
    const hit = db.getCard(lookup.contextHash(words[0].surface, tok.sentenceAt(item, words[0].start)));
    if (hit) out.push({ surface: words[0].surface, hit });
  }
  return out;
}

// What the server already knows about the lesson's verbs, for the drill
// check: the cached card of each single-word item (cached under the key the
// word save uses), else the guide's own vocabulary rows that name a binyan.
function knownVerbs(lesson, guide) {
  const out = [];
  const seen = new Set();
  for (const { surface, hit } of lessonCards(lesson)) {
    if (hit.card.pos !== 'verb' || !hit.card.binyan) continue;
    out.push({ surface, lemma: hit.card.lemma, root: hit.card.root, binyan: hit.card.binyan, from: 'card' });
    seen.add(plain(surface));
  }
  const vocab = guide.sections.find((x) => x.kind === 'vocabulary');
  for (const r of vocab ? vocab.rows : []) {
    const binyan = checks.binyanKey(r.binyan);
    if (binyan && !seen.has(plain(r.he))) out.push({ surface: r.he, lemma: null, root: r.root, binyan, from: 'vocabulary' });
  }
  return out;
}

// One guide from the model, shaped and checked. `failed` names what the
// previous answer failed, for the one rebuild.
async function askGuide(lesson, system, info, failed) {
  const raw = await lookup.chat({
    system,
    user: prompt.userMessage({ title: lesson.title, lessonDate: lesson.lesson_date, items: lesson.items, failed }),
    maxTokens: GUIDE_MAX_TOKENS, timeoutMs: GUIDE_TIMEOUT_MS, what: GUIDE_WHAT,
    model: info.fallback ? lookup.MODEL : lookup.GUIDE_MODEL, info,
  });
  const guide = shapeGuide(raw, lesson);
  return { guide, failures: checks.check(guide, lesson, knownVerbs(lesson, guide)) };
}

// --- the review pass ---------------------------------------------------------

const REVIEW_WHAT = 'The review pass could not run';
const REVIEW_MAX_TOKENS = 8000; // corrections only, never the guide written out

// The review's corrections, applied to a copy of the checked guide. Each names
// a section and an item and replaces an exact piece of text inside that item
// (any of its fields, nested ones included); "remove" takes an item out. A
// correction that cannot be placed — no such item, or its text not there — is
// refused and listed. Nothing can be added: a correction only edits text that
// is already in the guide. Answers { guide, changes, refused }.
const REVIEW_KEYS = {
  grammar: (x) => x.topic, drills: (x) => x.verb, paper: (x) => x.anchor,
  vocabulary: (x) => x.he, expressions: (x) => x.he,
};
const REVIEW_LISTS = { vocabulary: 'rows', expressions: 'items', drills: 'verbs', paper: 'prompts' };
// Fields a correction may fill when they are empty: a row's flags and vowel
// points, a card's notes (field 10). Only these: filling is never adding an item.
const FILLABLE = { vocabulary: { flags: 'flags', pointed: 'pointed' }, cards: { notes: 10 } };

// Replaces the first exact occurrence of `find` in any string inside `node`;
// answers the node changed, or null when `find` is nowhere in it.
function replaceWithin(node, find, replace) {
  let done = false;
  const walk = (v) => {
    if (done) return v;
    if (typeof v === 'string') { if (v.includes(find)) { done = true; return v.replace(find, () => replace); } return v; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    return v;
  };
  const out = walk(node);
  return done ? out : null;
}

// Where an item's root and binyan sit, and the word it is about, for the
// sections whose items carry them: a correction to either field is also a
// correction to that word's card (see correctCards).
const ROOT_BINYAN = {
  vocabulary: { root: 'root', binyan: 'binyan', word: (x) => x.he },
  drills: { root: 'root', binyan: 'binyan', word: (x) => x.verb },
  cards: { root: 4, binyan: 5, word: (c) => c[1] || c[0] },
};
const CARD_FIELDS_FIXABLE = ['root', 'binyan'];

function rootBinyanFixes(section, before, after, why) {
  const at = ROOT_BINYAN[section];
  if (!at) return [];
  return CARD_FIELDS_FIXABLE.filter((f) => str(before[at[f]]) !== str(after[at[f]]))
    .map((field) => ({ word: str(at.word(after)), field, value: str(after[at[field]]), why, from: 'guide' }));
}

function applyCorrections(checked, raw) {
  const guide = JSON.parse(JSON.stringify(checked));
  const changes = [], refused = [];
  // Root and binyan corrections for the lesson's word cards: named on a card
  // (section "word_cards"), or made in the guide on an item that has a root
  // and a binyan. Applied to the cards by correctCards, never here.
  const cardFixes = [];
  const refuse = (c, why) => refused.push(`${str(c.section) || '?'} ${str(c.item) || '?'}: ${why}`);
  const locate = (section, item) => {
    const want = plain(item);
    if (section === 'cards') { const i = guide.cards.findIndex((c) => plain(c[1] || c[0]) === want); return i < 0 ? null : { list: guide.cards, i }; }
    if (section === 'questions') {
      const q = guide.sections.find((x) => x.kind === 'questions');
      const i = q ? q.items.findIndex((x) => plain(x) === want) : -1;
      return i < 0 ? null : { list: q.items, i };
    }
    if (section === 'grammar') {
      const i = guide.sections.findIndex((x) => x.kind === 'grammar' && plain(x.topic) === want);
      return i < 0 ? null : { list: guide.sections, i };
    }
    const sec = guide.sections.find((x) => x.kind === section);
    if (!sec || !REVIEW_KEYS[section]) return null;
    const list = sec[REVIEW_LISTS[section]];
    const i = list.findIndex((x) => plain(REVIEW_KEYS[section](x)) === want);
    return i < 0 ? null : { list, i };
  };
  for (const c of list(raw.corrections)) {
    const section = str(c.section), find = typeof c.find === 'string' ? c.find : '';
    if (section === 'word_cards') {
      const field = str(c.field);
      if (!CARD_FIELDS_FIXABLE.includes(field)) { refuse(c, `a word card's ${field ? `"${field}"` : 'field'} cannot be corrected; only root and binyan`); continue; }
      if (typeof c.replace !== 'string' || !c.replace.trim()) { refuse(c, 'no corrected value'); continue; }
      cardFixes.push({ word: str(c.item), field, find: str(c.find), value: c.replace.trim(), why: str(c.why), from: 'card' });
      continue;
    }
    const at = locate(section, str(c.item));
    if (!at) { refuse(c, 'no such item in the guide'); continue; }
    if (section === 'drills' && find === 'takes_object') {
      const v = checks.objectValue(c.replace);
      if (v === null) { refuse(c, 'takes_object must be true, false or "both"'); continue; }
      at.list[at.i] = { ...at.list[at.i], takes_object: v };
      changes.push(str(c.why) || `${str(c.item)}: takes_object set to ${v}`);
      continue;
    }
    if (!find && typeof c.replace === 'string' && c.replace.trim() && c.field !== undefined) {
      const field = str(c.field);
      const key = FILLABLE[section] && FILLABLE[section][field];
      if (key === undefined) { refuse(c, `"${field}" cannot be filled in ${section}`); continue; }
      const item = at.list[at.i];
      if (str(item[key])) { refuse(c, `"${field}" is not empty; give the text to find`); continue; }
      at.list[at.i] = Array.isArray(item) ? item.map((v, k) => (k === key ? c.replace : v)) : { ...item, [key]: c.replace };
      cardFixes.push(...rootBinyanFixes(section, item, at.list[at.i], str(c.why)));
      changes.push(str(c.why) || `${str(c.item)}: ${field} filled`);
      continue;
    }
    if (!find || typeof c.replace !== 'string') { refuse(c, 'no text to find, or no replacement'); continue; }
    const changed = replaceWithin(at.list[at.i], find, c.replace);
    if (!changed) { refuse(c, `"${find}" is not in it`); continue; }
    cardFixes.push(...rootBinyanFixes(section, at.list[at.i], changed, str(c.why)));
    at.list[at.i] = changed;
    changes.push(str(c.why) || `${str(c.item)}: "${find}" corrected to "${c.replace}"`);
  }
  for (const r of list(raw.remove)) {
    const section = str(r.section);
    if (!['vocabulary', 'expressions', 'cards'].includes(section)) { refuse(r, 'only vocabulary rows, expressions and cards can be removed'); continue; }
    const at = locate(section, str(r.item));
    if (!at) { refuse(r, 'no such item in the guide'); continue; }
    at.list.splice(at.i, 1);
    changes.push(str(r.why) || `${str(r.item)} removed from ${section}`);
  }
  guide.sections = guide.sections.filter((x) => !REVIEW_LISTS[x.kind] || x[REVIEW_LISTS[x.kind]].length);
  return { guide, changes, refused, cardFixes };
}

// The review's root and binyan corrections, applied to the lesson's cached
// word cards (Personal Shipyard chat, 23 Sep 2026: the card for לזנק said
// Pa'al, and the guide's review never saw it). A fix finds its card by the
// word: the card's surface or its lemma, nikud ignored, among this lesson's
// cards only. Exactly one card: corrected, logged, and the card carries the
// before and after. A card already saying so is left alone. No card or more
// than one: never guessed — refused and listed, except that a guide fix for a
// word with no card (a phrase, a drill verb in another form) changes nothing
// and is not listed. Answers { corrected, unchanged, refused }.
async function correctCards(lesson, fixes) {
  const out = { corrected: [], unchanged: [], refused: [] };
  if (!fixes || !fixes.length) return out;
  const cards = lessonCards(lesson);
  const done = new Set();
  for (const f of fixes) {
    const once = `${plain(f.word)}\n${f.field}\n${plain(f.value) || f.value}`;
    if (done.has(once)) continue; // the same fix made on the vocabulary row and on the flashcard
    done.add(once);
    const want = plain(f.word);
    const byId = new Map();
    for (const c of cards) if (want && (plain(c.surface) === want || plain(c.hit.card.lemma) === want)) byId.set(c.hit.id, c);
    const matches = [...byId.values()];
    const name = `${f.word} (${f.field})`;
    const refuse = (why) => out.refused.push(`${name}: ${why}`);
    if (matches.length > 1) { refuse(`matches ${matches.length} word cards (${matches.map((m) => m.surface).join(', ')}); not guessed`); continue; }
    if (!matches.length) { if (f.from === 'card') refuse('no word card of this lesson has this word'); continue; }
    const { surface, hit } = matches[0];
    const card = hit.card;
    let after;
    if (f.field === 'binyan') {
      if (card.pos !== 'verb') { refuse(`the card is a ${card.pos || 'word'}, not a verb`); continue; }
      after = checks.binyanKey(f.value);
      if (!lookup.BINYANIM.includes(after)) { refuse(`"${f.value}" is not a binyan`); continue; }
    } else {
      after = lookup.normalizeRoot(f.value);
      if (!after) { refuse(`"${f.value}" is not a root`); continue; }
    }
    const before = card[f.field] || null;
    if (before === after) { out.unchanged.push(`${surface}: ${f.field} ${after}`); continue; }
    if (f.from === 'card' && f.find) {
      const said = f.field === 'binyan' ? checks.binyanKey(f.find) : lookup.normalizeRoot(f.find);
      if (said !== before) { refuse(`the card says ${before || 'nothing'}, not ${f.find}`); continue; }
    }
    const entry = { by: 'lesson review', lesson_id: lesson.id, lesson_title: lesson.title, field: f.field, before, after, why: f.why || null, at: new Date().toISOString() };
    const fixed = { ...card, [f.field]: after, corrected: [...(card.corrected || []), entry] };
    const def = lookup.spotFor(fixed);
    const oldSpot = hit.spot_id;
    db.putCard({ surface: hit.surface, contextHash: hit.context_hash, spotId: def ? def.id : null, card: fixed });
    hit.card = fixed; // a second fix on the same card builds on this one
    hit.spot_id = def ? def.id : null;
    let spot = null, recorded = null;
    if (def) {
      spot = db.moveSpot(oldSpot, { ...def, categories: fixed.categories });
      if (spot.status !== 'new') recorded = await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) });
    }
    out.corrected.push({ surface, field: f.field, before, after, spot: def ? def.id : null, replaced: spot && spot.replaced ? spot.replaced : null, spine: recorded });
    console.log(`lesson ${lesson.id}: card ${surface} ${f.field} ${before} -> ${after} (the lesson review)`
      + (spot && spot.replaced ? `, spot ${spot.replaced} -> ${spot.id}${spot.old_kept ? ' (the old spot kept: another card is on it)' : ''}` : '')
      + (recorded ? `, spine ${recorded}` : ''));
  }
  if (out.refused.length) console.log(`lesson ${lesson.id}: card corrections refused: ${out.refused.join('; ')}`);
  return out;
}

// The card corrections of the lesson's saved guide, run straight after the
// review (the cards were made before it), and once more after the first save
// of the words when that did not happen. Recorded on the guide as
// review.cards.
async function fixCards(id) {
  const lesson = db.getLesson(id);
  const guide = lesson.guide;
  if (!guide || !guide.review || !guide.review.card_fixes || guide.review.cards) return;
  guide.review.cards = await correctCards(lesson, guide.review.card_fixes);
  db.setLessonGuide(id, guide);
}

// The lesson's word cards made before the review, so a first build's review
// can check them too (on the import, every 2026 lesson is a first build). The
// same card calls the word save would make, made earlier; a word whose card
// cannot be made is left to the save, which names it.
async function makeCards(lesson) {
  for (const item of lesson.items) {
    const words = tok.words(item);
    if (words.length !== 1) continue;
    try { await lookup.cardOnly({ surface: words[0].surface, sentence: tok.sentenceAt(item, words[0].start) }); } catch { /* the save names it */ }
  }
}

// The lesson's word cards as the review reads them.
function wordCardsForReview(lesson) {
  return lessonCards(lesson).map(({ surface, hit }) => ({ word: surface, lemma: hit.card.lemma, pos: hit.card.pos, root: hit.card.root, binyan: hit.card.binyan }));
}

// A second call reviews the checked guide and answers corrections. The saved
// guide is the corrected one when the review answers and the corrected guide
// still passes every check; otherwise the checked guide is saved as it was,
// and `review` says why. Never throws.
async function reviewGuide(guide, lesson, info, unmet = []) {
  const at = new Date().toISOString();
  const t0 = Date.now();
  let raw;
  try {
    raw = await lookup.chat({
      system: prompt.reviewSystem(),
      user: prompt.reviewMessage({ title: lesson.title, lessonDate: lesson.lesson_date, items: lesson.items, guide, unmet: checks.describe(unmet), wordCards: wordCardsForReview(lesson) }),
      maxTokens: REVIEW_MAX_TOKENS, timeoutMs: REVIEW_TIMEOUT_MS, what: REVIEW_WHAT,
      model: info.fallback ? lookup.MODEL : lookup.GUIDE_MODEL, info,
    });
  } catch (e) {
    return { guide, review: { state: 'not run', reason: e.message, changes: [], refused: [], at }, unmet };
  }
  console.log(`lesson ${lesson.id}: review answered in ${Date.now() - t0} ms`);
  if (raw.error) return { guide, review: { state: 'not run', reason: `${REVIEW_WHAT}: the model declined — ${str(raw.error)}`, changes: [], refused: [], at }, unmet };
  if (!Array.isArray(raw.corrections)) return { guide, review: { state: 'not run', reason: `${REVIEW_WHAT}: the model returned no list of corrections.`, changes: [], refused: [], at }, unmet };
  const { guide: reviewed, changes, refused, cardFixes } = applyCorrections(guide, raw);
  // Kept unless it makes things worse: a check the guide met before and the
  // corrected guide fails.
  const failures = checks.check(reviewed, lesson, knownVerbs(lesson, reviewed));
  const before = new Set(unmet.map((f) => f.check));
  const broken = failures.filter((f) => !before.has(f.check));
  if (broken.length) {
    return { guide, review: { state: 'discarded', reason: `The corrected guide failed ${checkNames(broken)}, which the guide had met — ${broken.map((f) => f.detail).join('; ')}; the guide was kept as built.`, changes, refused, at }, unmet };
  }
  return { guide: reviewed, review: { state: 'applied', changes, refused, card_fixes: cardFixes, at }, unmet: failures };
}

function checkNames(failures) {
  const names = failures.map((f) => f.check);
  return names.length === 1 ? `the ${names[0]} check` : `the ${names.slice(0, -1).join(', ')} and ${names.at(-1)} checks`;
}

// The guide: built, checked, rebuilt once if a check failed, then saved. A
// second failure saves nothing and names the check.
async function buildGuide(lesson) {
  const t0 = Date.now();
  let system;
  try { system = prompt.system(); } catch (e) { throw new ReaderError(500, `${GUIDE_WHAT}: ${e.message}`); }
  const info = {};
  // The first answer; one rebuild when it fails a check; then the better of
  // the two (fewer checks unmet) goes on. A guide is never thrown away for a
  // check: what is still unmet goes to the review to fix, and whatever is left
  // is saved with the guide and named on the page (Dan, 23 Sep 2026: "we're
  // going in circles" — every all-or-nothing rebuild tripped another check).
  let best = await askGuide(lesson, system, info, null);
  const failedFirst = best.failures;
  if (best.failures.length) {
    console.error(`lesson ${lesson.id}: the guide failed ${checkNames(best.failures)} — ${checks.describe(best.failures)}; rebuilding once`);
    try {
      const second = await askGuide(lesson, system, info, checks.describe(best.failures));
      if (second.failures.length <= best.failures.length) best = second;
    } catch (e) {
      console.error(`lesson ${lesson.id}: the rebuild did not answer (${e.message}); going on with the first guide`);
    }
  }
  await makeCards(lesson);
  const built = await reviewGuide(best.guide, lesson, info, best.failures);
  let guide = built.guide;
  guide.review = built.review;
  const unmet = built.unmet.map((f) => ({ check: f.check, detail: f.detail }));
  guide.checks = { passed: checks.NAMES.filter((n) => !unmet.some((f) => f.check === n)), failed_first: failedFirst.map((f) => f.check), unmet };
  guide.model = info.model;
  guide.built_with = info.fallback ? 'fallback' : 'guide model';
  db.setLessonGuide(lesson.id, guide);
  const rv = guide.review;
  console.log(`lesson ${lesson.id}: review ${rv.state}, ${rv.changes.length} correction${rv.changes.length === 1 ? '' : 's'}`
    + (rv.refused.length ? `, refused as additions: ${rv.refused.join(', ')}` : '') + (rv.reason ? ` (${rv.reason})` : ''));
  const d = guide.dropped;
  console.log(`lesson ${lesson.id}: guide built via ${info.model}${info.fallback ? ' (the fallback)' : ''} in ${Date.now() - t0} ms, ${guide.sections.length} sections, ${guide.cards.length} cards`
    + (unmet.length ? `, saved with ${checkNames(unmet)} unmet` : failedFirst.length ? `, passing on the rebuild after ${checkNames(failedFirst)}` : ', every check passed')
    + (d.cards + d.vocabulary + d.expressions ? ` (dropped as not in the lesson: ${d.cards} cards, ${d.vocabulary} vocabulary rows, ${d.expressions} expressions)` : ''));
  await fixCards(lesson.id);
  if (!db.getLesson(lesson.id).saved) startSaving(lesson.id);
}

// 'building' when a build is under way or was started now; 'built' when the
// guide is there and no rebuild was asked for.
function startGuide(id, { rebuild = false } = {}) {
  const lesson = db.getLesson(id);
  if (building.has(lesson.id)) return 'building';
  if (lesson.guide && !rebuild) return 'built';
  failures.delete(lesson.id);
  const run = buildGuide(lesson)
    .catch((e) => {
      failures.set(lesson.id, e.message);
      console.error(`lesson ${lesson.id}: ${e.message}`);
    })
    .finally(() => building.delete(lesson.id));
  building.set(lesson.id, run);
  return 'building';
}

// Deleting is Dan's act: the lesson row goes (items, guide, saved words
// record); touches and spots stay. A build still running finds no lesson to
// save into and stops there.
function remove(id) {
  const out = db.deleteLesson(id);
  failures.delete(Number(id));
  return out;
}

// The lesson as the lesson page reads it.
function view(id) {
  const lesson = db.getLesson(id);
  const { text, ...rest } = lesson;
  const busy = building.has(lesson.id);
  return {
    ...rest,
    guide_state: busy ? 'building' : lesson.guide ? 'built' : failures.has(lesson.id) ? 'failed' : 'none',
    guide_error: failures.get(lesson.id) || null,
    saving: saving.has(lesson.id),
  };
}

module.exports = { applyCorrections, correctCards, extract, nameAndDate, add, shapeGuide, startGuide, view, remove, saveWords, retryWord, plain, MIN_ITEMS, MAX_BYTES, NAME_PATTERN, KIND_ORDER };
