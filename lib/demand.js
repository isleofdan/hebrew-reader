'use strict';
// The demand: one sentence from something Dan has read, with the verb
// blanked, for the phone page. Pull-only: it answers one item when asked and
// another when asked again; it counts nothing and keeps no queue.
//
// Choosing: a verb spot (kind verb, root and binyan present) with status
// shaky first, then new, least recently touched first, skipping `after`; the
// spot must have a touch in an article that still holds that surface as a
// word — the headline counts, as it does in the reader. No such spot ->
// { state: 'no data', reason }.

const { createHash } = require('node:crypto');
const db = require('./db');
const lookup = require('./lookup');
const tok = require('../public/tokenize.js');
const { asRead } = require('./articles');

// Proclitics Dan may leave off when typing the form (the surface שנאלצה is
// accepted as נאלצה). One explicit list, not a morphological analyzer.
const PROCLITICS = ['ו', 'ש', 'ה', 'כש', 'וש', 'וכש', 'מש', 'לכש'];

const TRANSLATE_SYSTEM = `You translate one Hebrew sentence from Israeli news or business writing into English for an advanced reader.
The sentence has exactly one gap written as … where a verb was removed. Keep the gap as … at the same place in the English.
Answer with ONE JSON object and nothing else: {"translation_en": "<the English sentence with the gap>"}.
If you cannot translate it, answer {"error": "<one short reason>"}. Never fill the gap.`;

// Nikud, cantillation, punctuation and spaces stripped; final-form letters
// kept as themselves (ם and מ stay different).
function normalizeForm(s) {
  return String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '').replace(/[^א-ת]/g, '');
}

// True when `typed` is the surface, or the surface with one proclitic
// removed from its front.
function formMatches(surface, typed) {
  const a = normalizeForm(surface), b = normalizeForm(typed);
  if (!b) return false;
  if (a === b) return true;
  return PROCLITICS.some((p) => a.startsWith(p) && a.slice(p.length) === b);
}

// Where `surface` stands as a whole word in `text`: the first occurrence,
// with its sentence. Null when the word is not there.
function findSurface(text, surface) {
  const w = tok.words(text).find((x) => x.surface === surface);
  if (!w) return null;
  const span = tok.sentenceSpan(text, w.start);
  const gapped = span.sentence.slice(0, w.start - span.start) + '…' + span.sentence.slice(w.end - span.start);
  return { start: w.start, end: w.end, sentence: span.sentence, gapped };
}

function sentenceHash(gapped) {
  return createHash('sha256').update(gapped).digest('hex');
}

// English for the gapped sentence, from the cache or one model call; null
// when the model is unreachable or refuses (the page shows the Hebrew alone).
async function translate(gapped) {
  const hash = sentenceHash(gapped);
  const hit = db.getTranslation(hash);
  if (hit) return hit.translation_en;
  let raw;
  try {
    raw = await lookup.chat({ system: TRANSLATE_SYSTEM, user: `Sentence: ${gapped}`, maxTokens: 400, what: 'Translation could not be made' });
  } catch (e) {
    console.error(`demand: ${e.message}`);
    return null;
  }
  if (!raw || typeof raw.translation_en !== 'string' || !raw.translation_en.trim()) {
    console.log(`demand: no translation${raw && raw.error ? ' (' + String(raw.error).trim() + ')' : ''}`);
    return null;
  }
  const translation = raw.translation_en.trim();
  db.putTranslation({ hash, gapped, translation });
  return translation;
}

// The other words of the article that are on the map (shaky or new, as the
// reader's side list shows them), except `except`.
function alsoInArticle(text, except) {
  const marks = db.marksForSurfaces();
  const out = [];
  const seen = new Set();
  for (const w of tok.words(text)) {
    const m = marks[w.surface];
    if (!m || m.status === 'solid' || w.surface === except || seen.has(w.surface)) continue;
    seen.add(w.surface);
    out.push({ surface: w.surface, spot_id: m.spot_id, status: m.status, hint: m.hint, sentence: tok.sentenceAt(text, w.start) });
  }
  return out;
}

// One item, or { state: 'no data', reason }.
async function next({ after } = {}) {
  const candidates = db.demandCandidates().filter((s) => s.id !== after);
  for (const spot of candidates) {
    for (const t of db.articleTouches(spot.id)) {
      let article;
      try { article = db.getArticle(t.article_id); } catch { continue; }
      const found = findSurface(asRead(article), t.surface);
      if (!found) continue;
      const card = db.cardForSurface(t.surface, spot.id, lookup.contextHash(t.surface, found.sentence));
      const translation_en = await translate(found.gapped);
      return {
        state: 'ok',
        spot_id: spot.id,
        status: spot.status,
        touches: spot.touches,
        article_id: article.id,
        article_title: article.title,
        article_added_at: article.added_at,
        surface: t.surface,
        sentence: found.gapped,
        translation_en,
        root: spot.root,
        binyan: spot.binyan,
        tense: card ? card.tense : null,
        person_gender_number: card ? card.person_gender_number : null,
        meaning_en: card ? card.meaning_en : null,
        also: alsoInArticle(asRead(article), t.surface),
      };
    }
  }
  const verbs = db.demandCandidates().length;
  const reason = verbs === 0
    ? 'No verb on your map is shaky or new yet; open a few verb cards in the reader first.'
    : after && verbs === 1
      ? 'That is the only verb with a sentence on record; open more verb cards in the reader.'
      : 'No verb on your map has a sentence on record in a stored article; open verb cards from the reader.';
  return { state: 'no data', reason };
}

// The fields Check and Show take, checked; refusals name the valid shapes.
function checkFields(body, { needTyped }) {
  const spotId = typeof body.spot_id === 'string' ? body.spot_id.trim() : '';
  if (!spotId) throw new db.ReaderError(400, 'spot_id is required: the spot id the demand gave, e.g. "v:א.ל.צ:nifal".');
  const spot = db.requireSpot(spotId);
  const articleId = Number(body.article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) throw new db.ReaderError(400, 'article_id is required: the whole number id of the article the demand gave.');
  const article = db.getArticle(articleId);
  const surface = typeof body.surface === 'string' ? body.surface.trim() : '';
  if (!surface) throw new db.ReaderError(400, 'surface is required: the word exactly as the demand gave it.');
  const found = findSurface(asRead(article), surface);
  if (!found) throw new db.ReaderError(400, `surface ${JSON.stringify(surface)} is not a word of article ${articleId}.`);
  let typed = null;
  if (needTyped) {
    typed = typeof body.typed === 'string' ? body.typed.trim() : '';
    if (!typed) throw new db.ReaderError(400, 'typed is required: the form as typed, Hebrew letters.');
  }
  return { spot, article, surface, found, typed };
}

// Check: compares the typing against what the article held; records a touch
// either way. Answers { ok, surface, card, spot, spine }.
async function check(body) {
  const { article, surface, found, typed } = checkFields(body, { needTyped: true });
  const ok = formMatches(surface, typed);
  const answer = await lookup.lookup({ surface, sentence: found.sentence, article_id: article.id });
  console.log(`demand: check ${surface} typed ${typed}: ${ok ? 'right' : 'wrong'}`);
  return { ok, surface, card: answer.card, spot: answer.spot, spine: answer.spine };
}

// Show: reveals exactly the surface the article held; records a touch.
async function show(body) {
  const { article, surface, found } = checkFields(body, { needTyped: false });
  const answer = await lookup.lookup({ surface, sentence: found.sentence, article_id: article.id });
  console.log(`demand: show ${surface}`);
  return { surface, card: answer.card, spot: answer.spot, spine: answer.spine };
}

module.exports = { next, check, show, formMatches, normalizeForm, findSurface, PROCLITICS, TRANSLATE_SYSTEM };
