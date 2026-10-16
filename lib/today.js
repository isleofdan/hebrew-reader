'use strict';
// Today (hebrew-today-one): a page of daily drills that brings Dan's material
// back to him. One set a day (the day in Asia/Tokyo): ten items, eight words
// and two fresh passages. Pull-only, with Dan's one exception: the server may
// make the day's set ahead of time so the page opens at once; an unfinished
// set simply stays. Nothing here notifies, counts days or asks him back.
//
// Choosing the words (all due: never drilled, or due_on on or before today):
//   (a) one solid word coming due, the longest overdue first;
//   (b) lesson words (a touch carries lesson_id), shaky or new, never drilled
//       before drilled, least recently touched first: up to six, five when
//       (a) filled its slot;
//   (c) article words (an article touch and no lesson), the same rule, up to
//       two; slots (b) leaves go to (c), and slots (c) leaves go back to (b);
//   (d) two fresh passages; a passage the model could not make leaves its slot
//       to (b), then (c).
// Shown in the order lesson words, article words, the solid word, passages.

const { createHash } = require('node:crypto');
const db = require('./db');
const lookup = require('./lookup');
const demand = require('./demand');
const tok = require('../public/tokenize.js');
const { asRead } = require('./articles');

const TZ = 'Asia/Tokyo';
const SET_SIZE = 10;
const PASSAGES = 2;
const WORDS = SET_SIZE - PASSAGES;

// --- days ---------------------------------------------------------------------

// "2026-10-16": the day in Tokyo at `date`.
function dayOf(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// --- small helpers --------------------------------------------------------------

const bare = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '');
const letters = (s) => bare(s).replace(/[^א-ת]/g, '');
// A fixed order that looks shuffled: by a hash of the key and each value.
const order = (values, key) => [...values].sort((a, b) => hash(key + a).localeCompare(hash(key + b)));
const hash = (s) => createHash('sha1').update(String(s)).digest('hex');

// --- where a word was read ---------------------------------------------------------

// Every sentence Dan read the spot's word in that holds more than the word:
// a lesson item of several words (a lesson's single-word item is the word
// alone, so it holds no sentence), or the article's sentence. Lesson
// sentences first for a lesson word, article sentences first for an article
// word. [{ surface, sentence, gapped, from: 'lesson'|'article', title }]
function readsOf(spot, group) {
  const fromLessons = [];
  for (const t of db.lessonTouches(spot.id)) {
    let lesson;
    try { lesson = db.getLesson(t.lesson_id); } catch { continue; }
    for (const item of lesson.items) {
      if (typeof item !== 'string' || tok.words(item).length < 2) continue;
      const found = demand.findSurface(item, t.surface);
      if (found) { fromLessons.push({ surface: t.surface, sentence: found.sentence, gapped: found.gapped, from: 'lesson', title: lesson.title }); break; }
    }
  }
  const fromArticles = [];
  for (const t of db.articleTouches(spot.id)) {
    let article;
    try { article = db.getArticle(t.article_id); } catch { continue; }
    const found = demand.findSurface(asRead(article), t.surface);
    if (found && tok.words(found.sentence).length > 1) fromArticles.push({ surface: t.surface, sentence: found.sentence, gapped: found.gapped, from: 'article', title: article.title });
  }
  return group === 'article' ? [...fromArticles, ...fromLessons] : [...fromLessons, ...fromArticles];
}

// The line under an item: "From Guy's lesson <title>" or "From <article title>".
function sourceOf(spot, group) {
  const { lesson, article } = db.spotSources(spot.id);
  const useLesson = group === 'lesson' || (group === 'solid' && lesson);
  if (useLesson && lesson) return { source: `From Guy's lesson ${lesson.title}`, lesson_id: lesson.id, article_id: null };
  if (article) return { source: `From ${article.title}`, lesson_id: null, article_id: article.id };
  return { source: '', lesson_id: null, article_id: null };
}

// The surface the word was last met as, in its group's touches.
function surfaceOf(spot, group, card) {
  const lessonT = db.lessonTouches(spot.id)[0];
  const articleT = db.articleTouches(spot.id)[0];
  const t = group === 'article' ? (articleT || lessonT) : (lessonT || articleT);
  return (t && t.surface) || card.surface;
}

// --- the model, for a made-up sentence and a misspelling ---------------------------

// The domain the made-up sentences and the passages keep to.
const DOMAIN = 'Israeli news or business Hebrew: energy and electricity markets (batteries, the grid, tenders), business and markets, aviation, Israeli politics and society, or twentieth-century history';

const SENTENCE_SYSTEM = `You write one Hebrew sentence for an advanced reader's drill, in the register of ${DOMAIN}.
The sentence must contain the given word exactly as given, letter for letter, as a word of its own (prefixes included as given), used in its given meaning.
Answer with ONE JSON object and nothing else: {"sentence": "<the Hebrew sentence, no nikud>"}. If you cannot, answer {"error": "<one short reason>"}.`;

async function madeUpSentence(surface, card) {
  let raw;
  try {
    raw = await lookup.chat({ system: SENTENCE_SYSTEM, user: `Sentence request\nWord: ${surface}\nMeaning: ${card.meaning_en || ''}`, maxTokens: 300, what: 'A sentence could not be made' });
  } catch (e) {
    console.error(`today: ${e.message}`);
    return null;
  }
  const sentence = raw && typeof raw.sentence === 'string' ? raw.sentence.trim() : '';
  const found = sentence ? demand.findSurface(sentence, surface) : null;
  if (!found) console.log(`today: no made-up sentence for ${surface}${raw && raw.error ? ' (' + String(raw.error).trim() + ')' : ' holding it'}`);
  return found;
}

const MISSPELL_SYSTEM = `You help an advanced reader of Hebrew drill spelling. Given one Hebrew word and the kind of slip the reader makes, answer with ONE JSON object and nothing else:
{"misspelling": "<the word written wrongly in that way>"}
For "letter-order": two neighbouring letters swapped. For "homophonous-spelling": one letter exchanged for one that sounds the same (ח/כ/ך, א/ע, ט/ת, ק/כ, ס/ש, ב/ו).
The misspelling must have the same number of letters, must not be a real Hebrew word, and must have no nikud.`;

// Letter pairs that sound alike, and the swap of two neighbours: the
// misspelling made here when the model's is missing or not usable.
const SOUND_ALIKE = [['א', 'ע'], ['ח', 'כ'], ['ח', 'ך'], ['ט', 'ת'], ['ק', 'כ'], ['ס', 'ש'], ['ב', 'ו']];
function madeMisspellings(word, category) {
  const exchanged = [], swapped = [];
  for (let i = 0; i < word.length; i++) {
    for (const [a, b] of SOUND_ALIKE) {
      if (word[i] === a) exchanged.push(word.slice(0, i) + b + word.slice(i + 1));
      else if (word[i] === b) exchanged.push(word.slice(0, i) + a + word.slice(i + 1));
    }
  }
  for (let i = 1; i < word.length - 1; i++) if (word[i] !== word[i + 1]) swapped.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  return category === 'letter-order' ? [...swapped, ...exchanged] : [...exchanged, ...swapped];
}

// One misspelling of `word`: the model's when it is usable (Hebrew letters,
// the same length, not the word, and not a real word on Dan's map), else one
// made here by the same rule. Null when none can be.
async function misspelling(word, category) {
  const surfaces = db.marksForSurfaces(), lemmas = db.marksForLemmas();
  const usable = (w) => /^[א-ת]+$/.test(w) && w !== word && w.length === word.length && !surfaces[w] && !lemmas[w];
  try {
    const raw = await lookup.chat({ system: MISSPELL_SYSTEM, user: `Misspelling request\nWord: ${word}\nCategory: ${category}`, maxTokens: 100, what: 'A misspelling could not be made' });
    const m = raw && typeof raw.misspelling === 'string' ? letters(raw.misspelling) : '';
    if (usable(m)) return { misspelling: m, by: 'model' };
    console.log(`today: the model's misspelling of ${word} is not usable (${m || 'none'}); making one here`);
  } catch (e) {
    console.error(`today: ${e.message}; making the misspelling of ${word} here`);
  }
  const made = madeMisspellings(word, category).find(usable);
  return made ? { misspelling: made, by: 'rule' } : null;
}

// --- the exercise for a word ----------------------------------------------------------

// The prepositions "Which preposition" chooses among: the right one and two of these.
const PREPOSITIONS = ['ב-', 'ל-', 'מ-', 'על', 'עם', 'את', 'אל', 'אצל'];

// "ל" or "ל-" or "-ל" -> "ל-"; a word preposition as it is.
function prepositionOf(governs) {
  const g = letters(governs);
  if (!g) return null;
  return g.length === 1 ? `${g}-` : g;
}

// The sentence with the governed preposition blanked: the word after the
// spot's word when it is the preposition, or that word's first letter when the
// preposition is a one-letter prefix. Null when the sentence does not hold it.
function gapPreposition(sentence, surface, prep) {
  const ws = tok.words(sentence);
  const i = ws.findIndex((w) => w.surface === surface);
  const next = i >= 0 ? ws[i + 1] : null;
  if (!next) return null;
  const p = prep.replace('-', '');
  if (bare(next.surface) === p) return sentence.slice(0, next.start) + '…' + sentence.slice(next.end);
  if (p.length === 1 && letters(next.surface).length > 2 && next.surface[0] === p) {
    let k = next.start + 1;
    while (k < next.end && /[֑-ׇ]/.test(sentence[k])) k++;
    return sentence.slice(0, next.start) + '…' + sentence.slice(k);
  }
  return null;
}

async function formItem(base, spot, card, reads) {
  const read = reads.find((r) => r.surface === base.word) || reads[0];
  let gapped, madeUp = false, surface = base.word;
  if (read) { gapped = read.gapped; surface = read.surface; }
  else {
    const made = await madeUpSentence(surface, card);
    if (!made) return null;
    gapped = made.gapped; madeUp = true;
  }
  const c = db.cardForSurface(surface, spot.id, null) || card;
  return {
    ...base, kind: 'form', word: surface, sentence: gapped, answer: surface, made_up: madeUp,
    translation_en: await demand.translate(gapped),
    hint: { root: spot.root || c.root || null, binyan: spot.binyan || c.binyan || null, tense: c.tense || null, person_gender_number: c.person_gender_number || null },
  };
}

function prepositionItem(base, spot, card, reads) {
  const prep = prepositionOf(card.governs) || prepositionOf((db.cardForSurface(base.word, spot.id, null) || {}).governs);
  if (!prep) return null;
  let sentence = null;
  for (const r of reads) { sentence = gapPreposition(r.sentence, r.surface, prep); if (sentence) break; }
  const others = order(PREPOSITIONS.filter((p) => p !== prep), spot.id).slice(0, 2);
  return { ...base, kind: 'preposition', sentence: sentence || `${base.word} …`, in_sentence: Boolean(sentence), choices: order([prep, ...others], spot.id + 'choices'), answer: prep };
}

async function spellingItem(base, spot, card, category) {
  const word = letters(card.lemma || base.word);
  if (word.length < 3) return null;
  const m = await misspelling(word, category);
  if (!m) return null;
  return { ...base, kind: 'spelling', word, meaning_en: card.meaning_en || '', choices: order([word, m.misspelling], spot.id), answer: word, misspelling_by: m.by };
}

function knowItem(base, spot, card, reads) {
  const read = reads.find((r) => r.surface === base.word) || reads[0];
  return { ...base, kind: 'know', word: read ? read.surface : base.word, sentence: read ? read.sentence : base.word };
}

// The exercise for one spot, by its categories, first match wins:
// conjugation -> Give the form; preposition-government -> Which preposition;
// letter-order or homophonous-spelling -> Which spelling; else Do you know
// it. An exercise that cannot be made for the word (no sentence and none
// made up, no preposition on its card, no misspelling) passes to the next.
// Null when the spot has no card.
async function itemFor(spot, group) {
  const row = db.newestCardOfSpot(spot.id);
  if (!row) return null;
  const card = row.card;
  const reads = readsOf(spot, group);
  const base = { group, spot_id: spot.id, card_id: row.id, word: surfaceOf(spot, group, card), lemma: card.lemma || null, status: spot.status, ...sourceOf(spot, group) };
  const cats = spot.categories || [];
  if (cats.includes('conjugation')) { const it = await formItem(base, spot, card, reads); if (it) return it; }
  if (cats.includes('preposition-government')) { const it = prepositionItem(base, spot, card, reads); if (it) return it; }
  const spell = ['letter-order', 'homophonous-spelling'].find((c) => cats.includes(c));
  if (spell) { const it = await spellingItem(base, spot, card, spell); if (it) return it; }
  return knowItem(base, spot, card, reads);
}

// --- choosing the day's words ------------------------------------------------------

// Takes items from a list of spots in order, skipping a spot no item can be
// made for; remembers where it stopped so a later take goes on from there.
function pool(spots, group) {
  let i = 0;
  return {
    async take(n) {
      const out = [];
      while (out.length < n && i < spots.length) {
        const it = await itemFor(spots[i++], group);
        if (it) out.push(it);
      }
      return out;
    },
  };
}

async function chooseWords(day) {
  const due = db.dueSpots(day);
  const learning = (s) => s.status === 'shaky' || s.status === 'new';
  const solid = due.filter((s) => s.status === 'solid' && s.due_on).sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id));
  const lessons = pool(due.filter((s) => learning(s) && s.from_lesson), 'lesson');
  const articles = pool(due.filter((s) => learning(s) && !s.from_lesson && s.from_article), 'article');
  const a = await pool(solid, 'solid').take(1);
  const bCap = WORDS - 2 - a.length;
  const b = await lessons.take(bCap);
  const cWant = 2 + (bCap - b.length);
  const c = await articles.take(cWant);
  b.push(...await lessons.take(cWant - c.length));
  return { a, b, c, lessons, articles };
}

module.exports = { dayOf, addDays, chooseWords, itemFor, readsOf, misspelling, madeMisspellings, gapPreposition, prepositionOf, PREPOSITIONS, TZ, SET_SIZE };
