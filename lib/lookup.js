'use strict';
// The word card: one call to OpenRouter (OpenAI-compatible), JSON only, cached
// by a hash of surface + sentence. Never invents: a card the model could not
// build is an error naming why.

const { createHash } = require('node:crypto');
const db = require('./db');
const spine = require('./spine');
const { IDS: CATEGORY_IDS } = require('./categories');

const MODEL = 'anthropic/claude-sonnet-4.6';
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 30000;
const BINYANIM = ['paal', 'nifal', 'piel', 'pual', 'hifil', 'hufal', 'hitpael'];

const SYSTEM = `You are a Hebrew morphology reference for an advanced reader of Israeli news and business Hebrew.
Given one word as it appears (the surface) and the sentence it came from, answer with ONE JSON object and nothing else:
{
  "surface": the word exactly as given,
  "lemma": the dictionary form, without nikud (verbs: 3rd person masculine singular past; nouns: singular absolute; adjectives: masculine singular),
  "pos": one of "verb", "noun", "adjective", "adverb", "preposition", "conjunction", "pronoun", "particle", "proper-noun", "number", "other",
  "root": the root as Hebrew letters separated by dots, e.g. "א.ל.צ", or null when the word has no root (particles, loanwords, names),
  "binyan": for verbs one of "paal", "nifal", "piel", "pual", "hifil", "hufal", "hitpael"; null for anything that is not a verb,
  "tense": for verbs "past", "present", "future", "imperative", "infinitive"; null otherwise,
  "person_gender_number": e.g. "3fs", "1p", "ms", "fp"; null when not applicable,
  "meaning_en": the meaning in this sentence, short, in English,
  "governs": the preposition this word takes in this use (e.g. "ל-", "ב-", "עם", "מ-", "על"), or null,
  "categories": a subset of ${JSON.stringify(CATEGORY_IDS)} naming the kinds of difficulty this word is likely to pose to such a reader; [] when none apply,
  "note": one short sentence of what is worth noticing about this form, or null
}
Separate any attached prefixes (ו, ה, ב, ל, מ, כ, ש) from the word before analyzing it; the lemma and root are of the base word.
If you cannot identify the word with confidence, answer {"error": "<one short reason>"} instead. Never guess a root or a meaning.`;

function contextHash(surface, sentence) {
  return createHash('sha256').update(`${surface}\n${sentence || ''}`).digest('hex');
}

// Nikud and cantillation marks stripped; used for ids.
function bare(s) {
  return String(s || '').normalize('NFC').replace(/[֑-ֽֿ-ׇ]/g, '').trim();
}

// "אלצ", "א-ל-צ", "א.ל.צ", "א ל צ" -> "א.ל.צ"; anything not Hebrew letters -> null.
function normalizeRoot(root) {
  if (root === null || root === undefined) return null;
  const letters = bare(root).replace(/[^א-ת]/g, '');
  if (letters.length < 2 || letters.length > 5) return null;
  return letters.split('').join('.');
}

// The spot id: v:<root>:<binyan> for a verb with both, w:<lemma> otherwise.
function spotFor(card) {
  if (card.pos === 'verb' && card.root && card.binyan) {
    return { id: `v:${card.root}:${card.binyan}`, kind: 'verb', root: card.root, binyan: card.binyan, lemma: card.lemma || null };
  }
  const lemma = bare(card.lemma);
  if (lemma) return { id: `w:${lemma}`, kind: 'word', root: card.root || null, binyan: null, lemma };
  return null;
}

// Shapes and checks what the model returned. Throws on a card that could not
// be built; never fills in a root or a meaning.
function shape(raw, surface) {
  if (!raw || typeof raw !== 'object') throw new db.ReaderError(502, 'Card could not be built: the model did not return a JSON object.');
  if (raw.error) throw new db.ReaderError(422, `Card could not be built: ${String(raw.error).trim()}`);
  const card = {
    surface,
    lemma: bare(raw.lemma) || null,
    pos: typeof raw.pos === 'string' ? raw.pos.trim().toLowerCase() : 'other',
    root: normalizeRoot(raw.root),
    binyan: BINYANIM.includes(raw.binyan) ? raw.binyan : null,
    tense: typeof raw.tense === 'string' ? raw.tense : null,
    person_gender_number: typeof raw.person_gender_number === 'string' ? raw.person_gender_number : null,
    meaning_en: typeof raw.meaning_en === 'string' ? raw.meaning_en.trim() : '',
    governs: typeof raw.governs === 'string' && raw.governs.trim() ? raw.governs.trim() : null,
    categories: Array.isArray(raw.categories) ? raw.categories.filter((c) => CATEGORY_IDS.includes(c)) : [],
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : null,
  };
  if (!card.meaning_en) throw new db.ReaderError(502, 'Card could not be built: the model gave no meaning.');
  if (card.pos !== 'verb') card.binyan = null;
  return card;
}

function parseJsonLoose(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

// One call to the model: `system` and `user` in, the parsed JSON object out.
// Throws a ReaderError starting with `what` when the model cannot be reached
// or answers nothing usable, and the message names which. With
// `textFallback`, a reply that is not JSON but does carry text comes back as
// { text } instead of being thrown away — the ask surface treats that text as
// the answer. `timeoutMs` is for the one long answer, the lesson guide.
// Every model call in the app goes through here.
async function chat({ system, user, maxTokens = 600, what = 'Card could not be built', textFallback = false, timeoutMs = TIMEOUT_MS }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new db.ReaderError(503, `${what}: OPENROUTER_API_KEY is unset.`);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'authorization': `Bearer ${key}`,
        'content-type': 'application/json',
        'http-referer': 'https://hebrew-reader-dan.fly.dev',
        'x-title': 'hebrew-reader',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    text = await res.text();
  } catch (e) {
    throw new db.ReaderError(502, `${what}: OpenRouter ${e.name === 'AbortError' ? 'timed out' : 'is unreachable (' + e.message + ')'}.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { /* ignore */ }
    throw new db.ReaderError(502, `${what}: OpenRouter answered ${res.status}${detail ? ' (' + detail + ')' : ''}.`);
  }
  let content;
  try { content = JSON.parse(text).choices[0].message.content; } catch {
    throw new db.ReaderError(502, `${what}: OpenRouter returned an unexpected shape.`);
  }
  const raw = parseJsonLoose(content);
  if (raw) return raw;
  const plain = String(content || '').trim();
  if (!plain) throw new db.ReaderError(502, `${what}: the model returned nothing.`);
  if (textFallback) return { text: plain };
  throw new db.ReaderError(502, `${what}: the model did not return JSON.`);
}

function askModel(surface, sentence) {
  return chat({ system: SYSTEM, user: `Surface: ${surface}\nSentence: ${sentence || '(none given)'}`, maxTokens: 600 });
}

// The whole lookup: cache, else model; then spot + touch, and the touch to
// the spine when the spot is there. Answers { card, spot, cached, spine }.
async function lookup({ surface, sentence, article_id, lesson_id }) {
  surface = String(surface || '').trim();
  if (!surface) throw new db.ReaderError(400, 'surface is required: the word as it appears.');
  sentence = String(sentence || '').trim();
  const hash = contextHash(surface, sentence);
  const hit = db.getCard(hash);
  let card, fromCache;
  if (hit) {
    card = hit.card;
    fromCache = true;
    console.log(`lookup: cache hit for "${surface}"`);
  } else {
    const t0 = Date.now();
    card = shape(await askModel(surface, sentence), surface);
    fromCache = false;
    const spot = spotFor(card);
    db.putCard({ surface, contextHash: hash, spotId: spot ? spot.id : null, card });
    console.log(`lookup: built card for "${surface}" via ${MODEL} in ${Date.now() - t0} ms${spot ? ' -> ' + spot.id : ' (no spot)'}`);
  }
  const spotDef = spotFor(card);
  let spot = null, recorded = 'no spot';
  if (spotDef) {
    db.ensureSpot({ ...spotDef, categories: card.categories });
    db.addTouch({ spotId: spotDef.id, articleId: article_id || null, lessonId: lesson_id || null, surface });
    spot = db.getSpot(spotDef.id);
    recorded = await spine.recordTouch(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) });
  }
  return { card, spot, cached: fromCache, spine: recorded };
}

module.exports = { lookup, chat, contextHash, normalizeRoot, spotFor, shape, MODEL, BINYANIM };
