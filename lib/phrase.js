'use strict';
// A Hebrew phrase on the Look up page, and "Save it" (hebrew-save-one).
//
// A phrase (Hebrew with a space in it, or Hebrew and Latin letters together,
// as Israelis write "לעשות check") gets no word card: it answers its words
// in order — each Hebrew one to be looked up on its own, a Latin one shown as
// it is — and its meaning, from one call to the card model, kept by the
// phrase's bare text so the same phrase asks the model once. The meaning is
// the model's own and the page says so; nothing is saved by looking.
//
// "Save it" keeps a look-up Dan wants to keep — a phrase, or a word the card
// model refused — as a note card, the record a line shared from the phone
// becomes (lib/desk.js catchCard): on the desk worked on last, not yet
// placed, and recorded as looked up on the Look up page (a lookup layer with
// the reference 'page', as a word's search is), which is what puts it in the
// "Looked up" list.

const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');
const desk = require('./desk');

const TEXT_MAX = 60; // as the Look up box takes (lib/lookup-page.js WORD_MAX)
const LATIN = /\p{Script=Latin}/u;
const LETTER = /[\p{L}]/u;
const squash = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();

const PHRASE_SYSTEM = `You explain a Hebrew phrase or expression to an advanced reader of Israeli Hebrew.
Given the phrase, answer with ONE JSON object and nothing else:
{
  "meaning_en": what the expression means as Israelis use it, short, in English,
  "literal_en": its word-for-word sense, in English,
  "note": one short line on its register or use (e.g. "slang", "formal, news", "army slang"), or null
}
The phrase may mix Hebrew and English words, as Israelis write, may be slang, and may be misspelled: answer what it most likely means.
Answer {"error": "<one short reason>"} only when the text is no Hebrew you can connect to anything.`;

// The phrase's key: its bare text (nikud and cantillation marks stripped),
// one space between words.
const keyOf = (text) => squash(lookup.bare(text));

// The phrase's words in order, each bare: { word, latin }. Punctuation at a
// word's edges goes (a geresh or gershayim inside it stays); a token with no
// letter at all is left out.
function wordsOf(text) {
  const out = [];
  for (const token of squash(text).split(' ')) {
    const word = lookup.bare(token).replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}'"׳״]+$/u, '');
    if (!word || !LETTER.test(word)) continue;
    out.push({ word, latin: LATIN.test(word) });
  }
  return out;
}

const textOf = (v) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);

// The meaning: the kept one, else one call to the card model. Answers
// { meaning, cached } or { meaning: null, meaning_error } — a refusal or a
// failed call is said in plain words, logged in full, and not kept.
async function meaningOf(text) {
  const key = keyOf(text);
  const kept = db.getPhraseMeaning(key);
  if (kept) return { meaning: kept.meaning, cached: true };
  let raw;
  try {
    raw = await lookup.chat({ system: PHRASE_SYSTEM, user: `Phrase meaning request\nPhrase: ${text}`, maxTokens: 400, what: 'The phrase meaning could not be given' });
  } catch (e) {
    console.error(`phrase "${text}": ${e.message}`);
    return { meaning: null, meaning_error: 'The model did not answer.', cached: false };
  }
  const meaning = raw && !raw.error && textOf(raw.meaning_en)
    ? { meaning_en: textOf(raw.meaning_en), literal_en: textOf(raw.literal_en), note: textOf(raw.note) }
    : null;
  if (!meaning) {
    console.log(`phrase "${text}": the model gave no meaning${raw && raw.error ? ` (${String(raw.error).trim()})` : ''}`);
    return { meaning: null, meaning_error: 'The model gave no meaning for this phrase.', cached: false };
  }
  db.putPhraseMeaning(key, meaning);
  return { meaning, cached: false };
}

// POST /lookup with a phrase: { mode: 'phrase', text, words, meaning, at },
// `meaning_error` when there is no meaning; `keepable` (it can be saved).
// Nothing is saved, no card made, no mark sent.
async function find(rawText) {
  const text = squash(rawText);
  const words = wordsOf(text);
  const got = await meaningOf(text);
  console.log(`look up "${text}" (a phrase): ${words.length} word(s), ${got.meaning ? `meaning ${got.cached ? 'kept before' : 'from the model'}` : 'no meaning'}`);
  return { mode: 'phrase', text, words, meaning: got.meaning, ...(got.meaning ? {} : { meaning_error: got.meaning_error }), cached: got.cached, keepable: true, at: nowIso() };
}

// A kept look-up of `text` already made today (Tokyo's day, as the desk
// names days): its note card's key, or null.
function keptToday(text) {
  const today = desk.day(nowIso());
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  for (const r of db.keptLookupsSince(since)) {
    if (desk.day(r.at) !== today) continue;
    let n;
    try { n = db.getNote(desk.parseKey(r.card).id); } catch (e) { if (e.status === 404) continue; throw e; }
    if (n.text.split('\n')[0] === text) return r.card;
  }
  return null;
}

// POST /lookup/keep with { text, note? }: "Save it". One note card holding
// the text, on its second line the phrase's kept meaning when there is one,
// then Dan's note; on the desk worked on last, not yet placed; recorded as
// looked up on the Look up page. The same text kept again the same day keeps
// the one card and answers it again (already: true). Like a look-up, it
// answers its "Looked up" row's key and recordings (hebrew-speech-one): a
// spoken phrase's recording is attached to that row by the page.
function keep({ text: rawText, note: rawNote } = {}) {
  const text = squash(rawText);
  if (!text) throw new ReaderError(400, 'Nothing to save: look up a word or a phrase first.');
  if (text.length > TEXT_MAX) throw new ReaderError(400, `Save it keeps a word or a phrase of at most ${TEXT_MAX} characters; this has ${text.length}.`);
  const note = squash(rawNote);
  const kept = db.getPhraseMeaning(keyOf(text));
  const meaning = kept ? kept.meaning.meaning_en : null;
  const lines = [text, meaning, note].filter(Boolean);
  const body = lines.join('\n');
  if (body.length > desk.NOTE_MAX) {
    const room = desk.NOTE_MAX - (body.length - note.length);
    throw new ReaderError(400, `A note is at most ${room} characters here (${desk.NOTE_MAX} with the text and its meaning); this one has ${note.length}.`);
  }
  const was = keptToday(text);
  if (was) {
    console.log(`save "${text}" from the Look up page: kept already today (${was})`);
    const d = db.desksHolding(was)[0] || null;
    return { already: true, key: was, card: desk.content(was), desk: d ? db.getDesk(d.id) : null, recordings: db.recordingsOf(was) };
  }
  return db.together(() => {
    const d = db.latestDesk() || desk.newDesk().desk;
    const out = desk.addNote({ text: desk.noteText(body), desk_id: d.id, unplaced: true });
    const layer = desk.lookupLayer(out.card.key, desk.PAGE, { origin: 'lookup' });
    console.log(`save "${text}" from the Look up page: ${out.card.key} on desk ${d.id}, not yet placed${meaning ? ', with its meaning' : ''}${note ? ', with a note' : ''}`);
    return { already: false, key: out.card.key, card: desk.content(out.card.key), desk: db.getDesk(d.id), layer, recordings: [] };
  });
}

module.exports = { find, keep, wordsOf, keyOf, PHRASE_SYSTEM, TEXT_MAX };
