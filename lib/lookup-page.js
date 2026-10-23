'use strict';
// The Look up page (hebrew-lookup-one): a word typed or pasted, its card, the
// word saved as Dan's, and the search recorded on the card as a lookup on the
// Look up page — the record the page's "Looked up" list is read from.
//
// One card, one truth: the card is the reader's own. A word Dan already has a
// card for comes back as that card (the same `lookup.lookup` call, a cache
// hit, so its touch is recorded as for any open); only a word with no card
// asks the model, as POST /lookup always has (the word and an empty
// sentence). A card Dan confirmed is never written: nothing here touches a
// card's record, only its spot's status and its layers.

const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');
const spine = require('./spine');
const desk = require('./desk');
const english = require('./english');
const phrase = require('./phrase');
const tok = require('../public/tokenize.js');

const WORD_MAX = 60;
const bare = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '');

// The reader's "save": a spot's status set, and the mark sent to the spine
// (POST /spots/<id> calls this too). Answers { spot, spine }.
async function saveStatus(id, status) {
  const spot = db.setSpotStatus(id, status);
  console.log(`spot ${spot.id}: ${spot.status}`);
  const recorded = await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) });
  return { spot, spine: recorded };
}

// A stored card the lookup can reach again by its own word and sentence
// (a card from before cards kept their sentence cannot be, and is passed by).
function reachable(row) {
  if (!row || row.sentence === null) return null;
  const again = db.getCard(lookup.contextHash(row.surface, row.sentence));
  return again && again.id === row.id ? { surface: row.surface, sentence: row.sentence } : null;
}

// Which card the typed word is: the card looked up before with this word and
// no sentence (POST /lookup's own cache); else the newest card met as this
// word, pointed or not; else the reader's own matching (lib/desk.js and the
// tints use it): a saved dictionary form, or any form met, alone or after one
// prefix. Answers { surface, sentence, by } or null (a new card).
function findCard(typed) {
  if (db.getCard(lookup.contextHash(typed, ''))) return { surface: typed, sentence: '', by: 'the word looked up before' };
  const plain = bare(typed);
  for (const s of [...new Set([typed, plain])]) {
    const at = reachable(db.newestCardFor(s));
    if (at) return { ...at, by: 'a card of this word' };
  }
  const mark = tok.markFor(plain, db.marksForSurfaces(), db.marksForLemmas());
  if (mark) {
    const at = reachable(db.newestCardOfSpot(mark.spot_id));
    if (at) return { ...at, by: 'the reader’s matching' };
  }
  return null;
}

// hebrew-english-one: what the box takes. Text with Latin letters is an
// English look-up — letters, spaces, hyphens and apostrophes only, up to
// six words since hebrew-save-one ("take it for granted") — answered by
// lib/english.js. Since hebrew-save-one, Hebrew with a space in it, or Hebrew
// and Latin letters together ("לעשות check", once refused), is a phrase
// (lib/phrase.js); any other text goes the Hebrew way, as before.
const LATIN = /\p{Script=Latin}/u;
const HEBREW = /[א-ת]/;
const ENGLISH_TEXT = /^[\p{Script=Latin}\p{M}]+(?:[ '’\-‐][\p{Script=Latin}\p{M}]*)*$/u;
const ENGLISH_WORDS = 6;

// Which way a typed text goes: 'hebrew', 'phrase' or 'english'; refused
// (400) with what the box takes otherwise.
function scriptOf(typed) {
  if (HEBREW.test(typed) && (LATIN.test(typed) || typed.includes(' '))) {
    if (typed.length > WORD_MAX) throw new ReaderError(400, `Look up a word or a phrase of at most ${WORD_MAX} characters; this has ${typed.length}.`);
    return 'phrase';
  }
  if (!LATIN.test(typed)) return 'hebrew';
  if (typed.length > WORD_MAX) throw new ReaderError(400, `Look up an English word or a phrase of up to ${ENGLISH_WORDS} words (at most ${WORD_MAX} characters); this has ${typed.length}.`);
  const bad = [...typed].find((ch) => !/[\p{Script=Latin}\p{M} '’\-‐]/u.test(ch));
  if (bad || !ENGLISH_TEXT.test(typed)) throw new ReaderError(400, `An English look-up takes letters, spaces, hyphens and apostrophes${bad ? `; this has “${bad}”` : ''}.`);
  const n = typed.split(' ').length;
  if (n > ENGLISH_WORDS) throw new ReaderError(400, `Look up an English word or a phrase of up to ${ENGLISH_WORDS} words; this has ${n}.`);
  return 'english';
}

// POST /lookup with { surface, origin: 'lookup' }: the card, the word saved,
// the search recorded. Answers what POST /lookup answers, plus { key,
// card_id, saved: { status, spine, already }, layer, references, found_by }.
// English text answers { mode: 'english', text, groups, at } instead
// (lib/english.js find): no card, nothing saved, nothing recorded on a card.
async function search({ surface }) {
  const typed = String(surface || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!typed) throw new ReaderError(400, 'Type a word to look up.');
  const way = scriptOf(typed);
  if (way === 'english') return english.find(typed);
  if (way === 'phrase') return phrase.find(typed);
  if (typed.length > WORD_MAX) throw new ReaderError(400, `Look up one word (at most ${WORD_MAX} characters); this has ${typed.length}.`);
  const found = findCard(typed);
  const at = found || { surface: typed, sentence: '', by: 'a new card' };
  let answer;
  try {
    answer = await lookup.lookup({ surface: at.surface, sentence: at.sentence });
  } catch (e) {
    // a word the card model refused: the same 422 and wording, with the
    // words the text may have meant beside it, and keepable: "Save it" can
    // keep it (lib/phrase.js keep); nothing was saved
    if (e.status !== 422) throw e;
    console.log(`look up "${typed}": no card (${e.message}); ${(e.did_you_mean || []).length} word(s) it may have meant`);
    throw Object.assign(new ReaderError(422, e.message), { extra: { keepable: true, text: typed, did_you_mean: e.did_you_mean || [] } });
  }
  const row = db.getCard(lookup.contextHash(at.surface, at.sentence));
  const key = `word:${row.id}`;
  // saved as Dan's word at once, as the reader's save does; a word already
  // saved or marked solid keeps its status
  let saved = null;
  if (answer.spot) {
    if (answer.spot.status === 'new') {
      const s = await saveStatus(answer.spot.id, 'shaky');
      answer.spot = s.spot;
      saved = { status: s.spot.status, spine: s.spine, already: false };
    } else saved = { status: answer.spot.status, spine: null, already: true };
  }
  const layer = desk.lookupLayer(key, desk.PAGE, { origin: 'lookup' });
  console.log(`look up "${typed}": ${key} (${at.by})${saved ? `, ${saved.already ? `already ${saved.status}` : 'saved'}` : ', no spot to save'}`);
  const lookups = desk.layersOf(key).filter((l) => l.kind === 'lookup').length;
  return { ...answer, key, card_id: row.id, sentence: at.sentence, saved, layer, lookups, references: desk.full(key).references, found_by: at.by };
}

// GET /lookups?limit=200&before=<time>&before_key=<card>: the "Looked up" list — every card
// with a search recorded from the Look up page, newest search first, read
// from the lookup layers and the cards (no table of its own). Each with its
// key, headword, gloss, the day, and the tabs opened on it from the page.
// `next` and `next_key` are the `before` and `before_key` for the next page
// (null at the end): the key keeps two words searched in the same
// millisecond apart at a page's edge.
const LIST_MAX = 200;
const refs = require('./references');
function list({ limit, before, before_key: beforeKey } = {}) {
  const n = limit === undefined || limit === null || limit === '' ? LIST_MAX : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > LIST_MAX) throw new ReaderError(400, `limit is a whole number from 1 to ${LIST_MAX}; got ${JSON.stringify(limit)}.`);
  if (before && Number.isNaN(Date.parse(before))) throw new ReaderError(400, `before is a time (ISO 8601); got ${JSON.stringify(before)}.`);
  if (beforeKey && !before) throw new ReaderError(400, 'before_key goes with before: the time and the card the last page ended at.');
  if (beforeKey && !beforeKey.startsWith('english:')) desk.parseKey(beforeKey);
  const rows = db.pageLookups({ limit: n + 1, before: before || null, beforeKey: beforeKey || null });
  const items = [];
  for (const r of rows.slice(0, n)) {
    // hebrew-english-one: an English look-up, its newest answer's word count
    if (r.card.startsWith('english:')) {
      const e = db.latestEnglishLookup(r.card.slice('english:'.length));
      if (e) items.push({ key: r.card, kind: 'english', text: e.text, count: english.count(e.answer), at: r.last, day: desk.day(r.last) });
      continue;
    }
    let c;
    try { c = desk.content(r.card); } catch (e) { if (e.status === 404) continue; throw e; }
    const opened = new Set(db.tabLookupsOf(r.card).map((x) => x.reference));
    const item = { key: r.card, kind: c.kind, at: r.last, day: desk.day(r.last), opened: refs.REFERENCES.filter((x) => opened.has(x.id)).map((x) => ({ id: x.id, label: x.label })) };
    if (c.kind === 'word') {
      const k = c.card;
      const word = k.lemma || k.surface;
      Object.assign(item, { word, headword: (k.pointed && (k.lemma ? k.pointed.lemma : k.pointed.surface)) || word, surface: k.surface, gloss: k.meaning_en || '', status: c.spot ? c.spot.status : null });
    } else if (c.kind === 'note') {
      // a look-up kept with "Save it" (hebrew-save-one): its text on the
      // first line, the phrase's meaning and Dan's note after it
      const [first, ...rest] = c.text.split('\n');
      Object.assign(item, { word: desk.label(c), headword: desk.label({ kind: 'note', text: first }), surface: first, gloss: rest.map((l) => l.trim()).filter(Boolean).join(' · ') });
    } else Object.assign(item, { word: desk.label(c), headword: desk.label(c), gloss: '' });
    items.push(item);
  }
  const more = rows.length > n;
  return { items, more, next: more ? rows[n - 1].last : null, next_key: more ? rows[n - 1].card : null, state: items.length ? 'ok' : 'no data' };
}

module.exports = { search, saveStatus, findCard, list, scriptOf, LIST_MAX };
