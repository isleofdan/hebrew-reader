'use strict';
// The word card: one call to OpenRouter (OpenAI-compatible), JSON only, cached
// by a hash of surface + sentence. Never invents: a card the model could not
// build is an error naming why.

const { createHash } = require('node:crypto');
const db = require('./db');
const spine = require('./spine');
const { IDS: CATEGORY_IDS } = require('./categories');

// Two models. The card model answers the word card, the phone page's
// translation and the Ask box. The guide model builds a lesson's study guide
// and reviews it; GUIDE_MODEL in the environment overrides it. The guide
// model's id could not be checked against OpenRouter's list when it was
// chosen, so a model-not-found answer is retried once with the card model
// (see chat()).
const MODEL = 'anthropic/claude-sonnet-4.6';
const GUIDE_MODEL = process.env.GUIDE_MODEL || 'anthropic/claude-opus-4.6';
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 30000;
const BINYANIM = ['paal', 'nifal', 'piel', 'pual', 'hifil', 'hufal', 'hitpael'];

const SYSTEM = `You are a Hebrew morphology reference for an advanced reader of Israeli news and business Hebrew.
Given one word as it appears (the surface) and the sentence it came from, answer with ONE JSON object and nothing else:
{
  "surface": the word exactly as given,
  "lemma": the dictionary form, without nikud (verbs: 3rd person masculine singular past; nouns: singular absolute; adjectives: masculine singular),
  "lemma_pointed": the same dictionary form with full nikud (vowel points, dagesh, the shin/sin dot), or null when there is no lemma,
  "surface_pointed": the word exactly as given, prefixes included, with full nikud as it is read in this sentence,
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
// Nikud on a word, taken only when it is that word: Hebrew letters and
// points, at least one point, and the same letters as the unpointed word once
// the vowel letters ו and י are set aside (a pointed form may drop them, as
// dictionaries write it). Anything else is null: the card shows the word
// unpointed rather than a pointed form of some other word. Display only —
// ids, tints and matching never read it.
const POINT = /[\u0591-\u05BD\u05BF-\u05C2\u05C4\u05C5\u05C7]/;
function pointedAs(pointed, word) {
  if (typeof pointed !== 'string' || !word) return null;
  const p = pointed.normalize('NFC').trim();
  if (!p || !POINT.test(p) || /[^\u0591-\u05F4\s\-'"]/.test(p)) return null;
  const letters = (s) => bare(s).replace(/[^א-ת]/g, '').replace(/[וי]/g, '');
  return letters(p) && letters(p) === letters(word) ? p : null;
}

// A card with at least one usable pointed form. One without (never asked, or
// every form refused) is asked again when next opened: nikud wherever a word
// is selected (Dan, 23 Sep 2026).
const hasPoints = (card) => Boolean(card.pointed && (card.pointed.lemma || card.pointed.surface));

// The card's pointed forms: its headword (the lemma) and the word as selected.
function pointedPair(raw, lemma, surface) {
  return { lemma: pointedAs(raw && raw.lemma_pointed, lemma), surface: pointedAs(raw && raw.surface_pointed, surface) };
}

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
  card.pointed = pointedPair(raw, card.lemma, surface);
  if (!card.meaning_en) throw new db.ReaderError(502, 'Card could not be built: the model gave no meaning.');
  if (card.pos !== 'verb') card.binyan = null;
  return card;
}

// The first complete JSON object in a model's answer: the answer whole, one
// inside a code fence, or one after a line of prose. A '{' that never closes
// is an answer cut off at the length limit, and is refused rather than read
// for an inner object. Answers { value, truncated }; value is null when there
// is no object to take.
function firstJsonObject(text) {
  const t = String(text || '').trim();
  try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return { value: v, truncated: false }; } catch { /* look inside */ }
  let from = t.indexOf('{');
  while (from >= 0) {
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let i = from; i < t.length; i++) {
      const ch = t[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = i; break; }
    }
    if (end < 0) return { value: null, truncated: true };
    try {
      const v = JSON.parse(t.slice(from, end + 1));
      if (v && typeof v === 'object') return { value: v, truncated: false };
    } catch { /* prose in braces: try the next '{' */ }
    from = t.indexOf('{', from + 1);
  }
  return { value: null, truncated: false };
}

// How much of an answer that was not JSON goes to the server log, and is kept
// with a lesson whose review it was, so a later look can see what came back.
const RAW_HEAD = 2000;

// The follow-up asked once when an answer was not JSON (`retryParse`).
function askAgain(truncated) {
  return truncated
    ? 'Your answer was cut off before the JSON object closed. Answer again with only the JSON object, complete, and keep each "why" to a few words.'
    : 'Return only the JSON object: no prose before or after it, no code fence.';
}

// One POST to OpenRouter; answers { ok, status, text }, throws a ReaderError
// when OpenRouter cannot be reached or does not answer in time.
async function post({ key, model, messages, maxTokens, format, timeoutMs, what }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'authorization': `Bearer ${key}`,
        'content-type': 'application/json',
        'http-referer': 'https://hebrew-reader-dan.fly.dev',
        'x-title': 'hebrew-reader',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: format,
        // with a schema, only a provider that honors it may answer
        ...(format.type === 'json_schema' ? { provider: { require_parameters: true } } : {}),
        messages,
      }),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    throw new db.ReaderError(502, `${what}: OpenRouter ${e.name === 'AbortError' ? 'timed out' : 'is unreachable (' + e.message + ')'}.`);
  } finally {
    clearTimeout(timer);
  }
}

const errorDetail = (text) => { try { return JSON.parse(text)?.error?.message || ''; } catch { return ''; } };

// The model's words and why it stopped ("length" when cut off).
function contentOf(text, what) {
  try {
    const choice = JSON.parse(text).choices[0];
    return { content: String(choice.message.content || ''), finish: choice.finish_reason || choice.native_finish_reason || null };
  } catch {
    throw new db.ReaderError(502, `${what}: OpenRouter returned an unexpected shape.`);
  }
}

function logRaw(what, model, finish, content, attempt) {
  console.error(`${what}: the answer from ${model} was not JSON (${attempt}; finish ${finish || 'not given'}, ${content.length} characters). Its first ${RAW_HEAD} characters:\n${content.slice(0, RAW_HEAD)}`);
}

// One call to the model: `system` and `user` in, the parsed JSON object out.
// Throws a ReaderError starting with `what` when the model cannot be reached
// or answers nothing usable, and the message names which. With
// `textFallback`, a reply that is not JSON but does carry text comes back as
// { text } instead of being thrown away — the ask surface treats that text as
// the answer. `timeoutMs` is for the long answers, the lesson guide and its
// review. `model` defaults to the card model. When another model is asked
// for and OpenRouter answers that it has no such model, the same call is made
// once more with the card model; `info`, when given, is filled with the model
// that answered and `fallback: true`.
// `schema` ({ name, schema }) asks for structured output against that JSON
// schema; a provider that refuses it gets the same call once more in JSON
// mode (`info.json` says which was used). `retryParse` asks once more, and
// only once, when the answer is not JSON; a second answer that is not JSON
// throws, and the error carries `rawHead`, the first answer's opening.
// Every model call in the app goes through here.
async function chat({ system, user, maxTokens = 600, what = 'Card could not be built', textFallback = false, timeoutMs = TIMEOUT_MS, model = MODEL, info = null, schema = null, retryParse = false }) {
  if (info) { info.model = model; info.fallback = info.fallback || false; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new db.ReaderError(503, `${what}: OPENROUTER_API_KEY is unset.`);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let format = schema ? { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } : { type: 'json_object' };
  let r = await post({ key, model, messages, maxTokens, format, timeoutMs, what });
  if (!r.ok && schema && schemaRefused(r.status, errorDetail(r.text))) {
    console.error(`${what}: ${model} refused structured output (${errorDetail(r.text) || r.status}); asking once more in JSON mode`);
    format = { type: 'json_object' };
    r = await post({ key, model, messages, maxTokens, format, timeoutMs, what });
  }
  if (info) info.json = format.type;
  if (!r.ok) {
    const detail = errorDetail(r.text);
    if (model !== MODEL && modelMissing(r.status, detail)) {
      console.error(`model ${model} not found at OpenRouter (${detail || r.status}); retrying once with ${MODEL}`);
      if (info) info.fallback = true;
      return chat({ system, user, maxTokens, what, textFallback, timeoutMs, model: MODEL, info, schema, retryParse });
    }
    throw new db.ReaderError(502, `${what}: OpenRouter answered ${r.status}${detail ? ' (' + detail + ')' : ''}.`);
  }
  const { content, finish } = contentOf(r.text, what);
  const got = firstJsonObject(content);
  if (got.value) return got.value;
  const plain = content.trim();
  if (!plain && !retryParse) throw new db.ReaderError(502, `${what}: the model returned nothing.`);
  if (textFallback && plain) return { text: plain };
  logRaw(what, model, finish, content, 'first answer');
  const cut = got.truncated || finish === 'length';
  const why = (c) => (c ? `the model did not return JSON (its answer was cut off${finish === 'length' ? ` at the ${maxTokens}-token limit` : ''})` : 'the model did not return JSON');
  if (retryParse) {
    if (info) info.retried = true;
    const again = [...messages, { role: 'assistant', content: plain || '(no answer)' }, { role: 'user', content: askAgain(cut) }];
    const r2 = await post({ key, model, messages: again, maxTokens, format, timeoutMs, what });
    if (!r2.ok) {
      const detail = errorDetail(r2.text);
      throw Object.assign(new db.ReaderError(502, `${what}: ${why(cut)}, and the second ask was answered ${r2.status}${detail ? ' (' + detail + ')' : ''}.`), { rawHead: content.slice(0, RAW_HEAD) });
    }
    const second = contentOf(r2.text, what);
    const got2 = firstJsonObject(second.content);
    if (got2.value) {
      console.log(`${what.replace(/ could not.*$/, '')}: the second ask answered JSON`);
      return got2.value;
    }
    logRaw(what, model, second.finish, second.content, 'second answer');
    throw Object.assign(new db.ReaderError(502, `${what}: ${why(cut)}, and asked once more it still did not.`), { rawHead: content.slice(0, RAW_HEAD) });
  }
  throw Object.assign(new db.ReaderError(502, `${what}: ${why(cut)}.`), { rawHead: content.slice(0, RAW_HEAD) });
}

// OpenRouter's answer when no provider of the model takes the structured
// output asked for: 400 naming response_format or json_schema, or 404 "No
// endpoints found that can handle the requested parameters".
function schemaRefused(status, detail) {
  return (status === 400 || status === 404)
    && /response_format|json_schema|structured output|requested parameters|support(ed)? parameters/i.test(detail || '');
}

// OpenRouter's answer to a model id it does not know: 400 "<id> is not a
// valid model ID", or 404 "No endpoints found for <id>".
function modelMissing(status, detail) {
  return (status === 400 || status === 404) && !/parameters/i.test(detail || '')
    && /not a valid model|no endpoints found|model[^.]*(not found|does not exist)|invalid model|unknown model/i.test(detail || '');
}

function askModel(surface, sentence) {
  return chat({ system: SYSTEM, user: `Surface: ${surface}\nSentence: ${sentence || '(none given)'}`, maxTokens: 600 });
}

// The card alone, cached, with no spot and no touch: the lesson's word cards
// made before its review reads them. The later lookup of the same word is a
// cache hit and records the spot and the touch then. Answers the card; throws
// as lookup does (a failed card is never cached).
async function cardOnly({ surface, sentence }) {
  surface = String(surface || '').trim();
  sentence = String(sentence || '').trim();
  const hash = contextHash(surface, sentence);
  const hit = db.getCard(hash);
  if (hit) return hit.card;
  const t0 = Date.now();
  const card = shape(await askModel(surface, sentence), surface);
  const spot = spotFor(card);
  db.putCard({ surface, contextHash: hash, spotId: spot ? spot.id : null, card });
  console.log(`lookup: built card for "${surface}" via ${MODEL} in ${Date.now() - t0} ms${spot ? ' -> ' + spot.id : ' (no spot)'}, for the lesson review`);
  return card;
}

// A card cached before cards carried nikud gets its pointed forms the first
// time it is opened: one small call that answers only those, saved back into
// the cached card, and not again once the card has a usable pointed form (a
// card whose forms were all refused is asked again next time). No bulk
// backfill. The same holds for a new card whose own call gave no usable
// nikud. The lookup answers
// the card at once, unpointed, with `points_missing`; the page then asks here
// with the same word and sentence and updates the card in place. Answers
// { pointed, called }.
const POINTS_SYSTEM = `You add nikud to a Hebrew word for an advanced reader's dictionary card.
Given the word as it appears (the surface), the sentence it came from, and its dictionary form (the lemma), answer with ONE JSON object and nothing else:
{ "lemma_pointed": the dictionary form with full nikud (vowel points, dagesh, the shin/sin dot), or "" when no lemma is given,
  "surface_pointed": the word exactly as given, prefixes included, with full nikud as it is read in this sentence }`;
const pointing = new Map(); // card hash -> the call under way, so two opens make one call

async function addPoints({ surface, sentence }) {
  surface = String(surface || '').trim();
  sentence = String(sentence || '').trim();
  const key = contextHash(surface, sentence);
  const hit = surface ? db.getCard(key) : null;
  if (!hit) throw new db.ReaderError(404, `No saved card for "${surface}" in that sentence: look the word up first.`);
  if (hasPoints(hit.card)) return { pointed: hit.card.pointed, called: false };
  if (pointing.has(key)) return pointing.get(key);
  const run = (async () => {
    const c = hit.card;
    const raw = await chat({
      system: POINTS_SYSTEM,
      user: `Surface: ${c.surface}\nLemma: ${c.lemma || '(none)'}\nSentence: ${sentence || '(none given)'}`,
      // JSON mode, as the card call itself uses live; not the strict schema,
      // which the card model never ran with live (Dan, 23 Sep 2026: lesson
      // words, all cached before nikud, showed none)
      maxTokens: 300, what: 'Nikud could not be added', retryParse: true,
    });
    const pointed = pointedPair(raw, c.lemma, c.surface);
    // read again: a lesson review may have corrected the card meanwhile
    const now = db.getCard(key);
    db.putCard({ surface: now.surface, contextHash: key, spotId: now.spot_id, card: { ...now.card, pointed } });
    console.log(`lookup: pointed forms added to the cached card for "${c.surface}" (${pointed.lemma || 'no headword'}, ${pointed.surface || 'no surface'})`);
    return { pointed, called: true };
  })().finally(() => pointing.delete(key));
  pointing.set(key, run);
  return run;
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
  return { card, spot, cached: fromCache, spine: recorded, ...(hasPoints(card) ? {} : { points_missing: true }) };
}

module.exports = { lookup, cardOnly, addPoints, pointedAs, chat, firstJsonObject, schemaRefused, contextHash, normalizeRoot, spotFor, shape, modelMissing, MODEL, GUIDE_MODEL, BINYANIM };
