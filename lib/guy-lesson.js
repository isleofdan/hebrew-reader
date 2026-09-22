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
const GUIDE_TIMEOUT_MS = 5 * 60 * 1000;
const GUIDE_MAX_TOKENS = 32000; // room for 35 cards of Hebrew and the guide; a cut-off answer is not JSON and fails whole
const KIND_ORDER = ['topics', 'grammar', 'drills', 'paper', 'vocabulary', 'questions', 'expressions'];

const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const strs = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

// Hebrew compared without nikud, punctuation or spacing differences, so a
// card's word can be found in the lesson whichever way the model points it.
function plain(s) {
  return str(s).normalize('NFC').replace(/[֑-ֽֿ-ׇ]/g, '')
    .replace(/[״”“]/g, '"').replace(/[׳’‘]/g, "'").replace(/[^א-ת"']+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
      const g = { kind, topic: str(sec.topic), explanation: str(sec.explanation),
        examples: list(sec.examples).map((e) => ({ he: str(e.he), en: str(e.en) })).filter((e) => e.he), for_guy: str(sec.for_guy) };
      if (g.topic || g.explanation) out = g;
    } else if (kind === 'drills') {
      const verbs = list(sec.verbs).slice(0, prompt.MAX_DRILL_VERBS).map((v) => ({
        verb: str(v.verb), root: str(v.root), binyan: str(v.binyan), why: str(v.why),
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
      const all = list(sec.rows).map((r) => ({ he: str(r.he), en: str(r.en), root: str(r.root), binyan: str(r.binyan), category: str(r.category) })).filter((r) => r.he);
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
    sections, cards, dropped, model: lookup.MODEL, built_at: new Date().toISOString(),
  };
}

// --- the lesson's words onto the map ------------------------------------------

// The word rule: an item that is one token after the shared tokenizer is a
// word; anything else is a phrase and stays in the guide and the cards only.
// A word goes through the reader's own card path (same cache, same spot id,
// its sentence being the item itself, as the lesson page cuts it). A spot not
// yet on the map (absent, or only met) is saved shaky and sent to the spine;
// a shaky or solid spot is touched and keeps its status.
async function saveWords(lesson) {
  const out = { words: 0, touched: 0, phrases: 0, failed: [], spine: {} };
  const done = new Set();
  const tally = (o) => { if (o && o !== 'not on spine') out.spine[o] = (out.spine[o] || 0) + 1; };
  let unreachable = 0;
  for (const item of lesson.items) {
    const words = tok.words(item);
    if (words.length !== 1) { out.phrases++; continue; }
    const surface = words[0].surface;
    let r;
    try {
      r = await lookup.lookup({ surface, sentence: tok.sentenceAt(item, words[0].start), lesson_id: lesson.id });
    } catch (e) {
      if ((e.status || 500) >= 500) unreachable++;
      out.failed.push({ surface, error: e.message });
      continue;
    }
    if (!r.spot) { out.failed.push({ surface, error: 'No spot for this word.' }); continue; }
    if (done.has(r.spot.id)) continue;
    done.add(r.spot.id);
    if (r.spot.status === 'new') {
      const spot = db.setSpotStatus(r.spot.id, 'shaky');
      tally(await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) }));
      out.words++;
    } else {
      tally(r.spine);
      out.touched++;
    }
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
    .then((saved) => { if (saved) db.setLessonSaved(id, saved); })
    .catch((e) => console.error(`lesson ${id}: words not saved, ${e.message}`))
    .finally(() => saving.delete(id));
  saving.set(id, run);
}

async function buildGuide(lesson) {
  const t0 = Date.now();
  let system;
  try { system = prompt.system(); } catch (e) { throw new ReaderError(500, `${GUIDE_WHAT}: ${e.message}`); }
  const raw = await lookup.chat({
    system,
    user: prompt.userMessage({ title: lesson.title, lessonDate: lesson.lesson_date, items: lesson.items }),
    maxTokens: GUIDE_MAX_TOKENS, timeoutMs: GUIDE_TIMEOUT_MS, what: GUIDE_WHAT,
  });
  const guide = shapeGuide(raw, lesson);
  db.setLessonGuide(lesson.id, guide);
  const d = guide.dropped;
  console.log(`lesson ${lesson.id}: guide built via ${lookup.MODEL} in ${Date.now() - t0} ms, ${guide.sections.length} sections, ${guide.cards.length} cards`
    + (d.cards + d.vocabulary + d.expressions ? ` (dropped as not in the lesson: ${d.cards} cards, ${d.vocabulary} vocabulary rows, ${d.expressions} expressions)` : ''));
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

module.exports = { extract, nameAndDate, add, shapeGuide, startGuide, view, saveWords, plain, MIN_ITEMS, MAX_BYTES, NAME_PATTERN, KIND_ORDER };
