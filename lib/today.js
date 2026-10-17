'use strict';
// Today (hebrew-today-one): a page of daily drills that brings Dan's material
// back to him. A set is ten items, eight words and two fresh passages; one is
// made each day (the day in Asia/Tokyo), and since hebrew-today-two another on
// Dan's "Another set" tap, as many as he likes. Pull-only, with Dan's one
// exception: the server may make the day's set ahead of time so the page
// opens at once; an unfinished set simply stays. Nothing here notifies,
// counts days or sets, or asks him back.
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
const spine = require('./spine');
const { saveStatus } = require('./lookup-page');

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
      if (found) { fromLessons.push({ surface: t.surface, sentence: found.sentence, gapped: found.gapped, from: 'lesson', id: lesson.id, title: lesson.title }); break; }
    }
  }
  const fromArticles = [];
  for (const t of db.articleTouches(spot.id)) {
    let article;
    try { article = db.getArticle(t.article_id); } catch { continue; }
    const found = demand.findSurface(asRead(article), t.surface);
    if (found && tok.words(found.sentence).length > 1) fromArticles.push({ surface: t.surface, sentence: found.sentence, gapped: found.gapped, from: 'article', id: article.id, title: article.title });
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

// The line under an item whose sentence is one Dan read: where that sentence
// is, which may be an older lesson, or an article for a lesson word.
function sourceOfRead(read) {
  return read.from === 'lesson'
    ? { source: `From Guy's lesson ${read.title}`, lesson_id: read.id, article_id: null }
    : { source: `From ${read.title}`, lesson_id: null, article_id: read.id };
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
When a preposition is given, the word is followed directly by it: a one-letter preposition written as "ל-" is the first letter of the next word, any other is the next word itself.
Answer with ONE JSON object and nothing else: {"sentence": "<the Hebrew sentence, no nikud>"}. If you cannot, answer {"error": "<one short reason>"}.`;

// One sentence the model writes around the word (and, for Which preposition,
// the preposition it governs right after it): { sentence, gapped } with the
// word blanked, or with the preposition blanked when `preposition` is given.
// Null when the model does not answer, or its sentence does not hold them.
async function madeUpSentence(surface, card, { preposition = null } = {}) {
  let raw;
  try {
    raw = await lookup.chat({ system: SENTENCE_SYSTEM, user: `Sentence request\nWord: ${surface}\nMeaning: ${card.meaning_en || ''}${preposition ? `\nPreposition: ${preposition}` : ''}`, maxTokens: 300, what: 'A sentence could not be made' });
  } catch (e) {
    console.error(`today: ${e.message}`);
    return null;
  }
  const sentence = raw && typeof raw.sentence === 'string' ? raw.sentence.trim() : '';
  let out = null;
  if (sentence && preposition) { const g = gapPreposition(sentence, surface, preposition); out = g ? { sentence, gapped: g } : null; }
  else if (sentence) { const f = demand.findSurface(sentence, surface); out = f ? { sentence: f.sentence, gapped: f.gapped } : null; }
  if (!out) console.log(`today: no made-up sentence for ${surface}${preposition ? ' ' + preposition : ''}${raw && raw.error ? ' (' + String(raw.error).trim() + ')' : ' holding it'}`);
  return out;
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
// The same, pointed, for showing the right one once answered (a card has no
// pointed form for the preposition it governs).
const PREPOSITIONS_POINTED = { 'ב-': 'בְּ-', 'ל-': 'לְ-', 'מ-': 'מִ-', 'על': 'עַל', 'עם': 'עִם', 'את': 'אֶת', 'אל': 'אֶל', 'אצל': 'אֵצֶל' };

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
    ...base, ...(read ? sourceOfRead(read) : {}), kind: 'form', word: surface, sentence: gapped, answer: surface, made_up: madeUp,
    translation_en: await demand.translate(gapped),
    hint: { root: spot.root || c.root || null, binyan: spot.binyan || c.binyan || null, tense: c.tense || null, person_gender_number: c.person_gender_number || null },
  };
}

// Which preposition: a sentence Dan read with the governed preposition
// blanked; else one the model writes with the word and its preposition ("a
// made-up sentence"); only when the model gives none, the word alone with a
// blank after it.
async function prepositionItem(base, spot, card, reads) {
  const prep = prepositionOf(card.governs) || prepositionOf((db.cardForSurface(base.word, spot.id, null) || {}).governs);
  if (!prep) return null;
  let sentence = null, used = null, madeUp = false;
  for (const r of reads) { sentence = gapPreposition(r.sentence, r.surface, prep); if (sentence) { used = r; break; } }
  if (!sentence) {
    const made = await madeUpSentence(base.word, card, { preposition: prep });
    if (made) { sentence = made.gapped; madeUp = true; }
  }
  const others = order(PREPOSITIONS.filter((p) => p !== prep), spot.id).slice(0, 2);
  return { ...base, ...(used ? sourceOfRead(used) : {}), kind: 'preposition', sentence: sentence || `${base.word} …`, in_sentence: Boolean(sentence), made_up: madeUp, choices: order([prep, ...others], spot.id + 'choices'), answer: prep };
}

// Which spelling: the word blanked in a sentence Dan read (else one the model
// writes, "a made-up sentence"), the word as it stands there and one
// misspelling of it to choose between. No sentence and none made up: the
// next exercise.
async function spellingItem(base, spot, card, category, reads) {
  const read = reads.find((r) => r.surface === base.word) || reads[0];
  let surface = read ? read.surface : base.word, gapped = read ? read.gapped : null, madeUp = false;
  if (!read) {
    const made = await madeUpSentence(surface, card);
    if (!made) return null;
    gapped = made.gapped; madeUp = true;
  }
  const word = letters(surface);
  if (word.length < 3 || word !== surface) return null;
  const m = await misspelling(word, category);
  if (!m) return null;
  return { ...base, ...(read ? sourceOfRead(read) : {}), kind: 'spelling', word, sentence: gapped, made_up: madeUp, meaning_en: card.meaning_en || '', choices: order([word, m.misspelling], spot.id), answer: word, misspelling_by: m.by };
}

function knowItem(base, spot, card, reads) {
  const read = reads.find((r) => r.surface === base.word) || reads[0];
  return { ...base, ...(read ? sourceOfRead(read) : {}), kind: 'know', word: read ? read.surface : base.word, sentence: read ? read.sentence : base.word };
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
  if (cats.includes('preposition-government')) { const it = await prepositionItem(base, spot, card, reads); if (it) return it; }
  const spell = ['letter-order', 'homophonous-spelling'].find((c) => cats.includes(c));
  if (spell) { const it = await spellingItem(base, spot, card, spell, reads); if (it) return it; }
  return knowItem(base, spot, card, reads);
}

// --- choosing the day's words ------------------------------------------------------

// Takes items from a list of spots in order, skipping a spot no item can be
// made for; remembers where it stopped so a later take goes on from there.
// `group`: the items' group, or a function giving it for each spot.
function pool(spots, group) {
  let i = 0;
  return {
    async take(n) {
      const out = [];
      while (out.length < n && i < spots.length) {
        const s = spots[i++];
        const it = await itemFor(s, typeof group === 'function' ? group(s) : group);
        if (it) out.push(it);
      }
      return out;
    },
  };
}

// --- is a new word worth drilling? -----------------------------------------------------
// Every single-word item of Guy's lessons lands on the map, ordinals,
// colours and days included ("ראשון and צבעי were too easy", Dan, 16 Oct
// 2026). A word Dan only met (new) is judged once by the model — would an
// advanced reader of Israeli news know it cold? — in one call per set build
// over the words not yet judged, and the judgment is kept on the spot
// (spots.easy). A word judged easy is not drilled. When the model does not
// answer, nothing is kept and the set is chosen as before.

const JUDGE_MAX = 40;
const JUDGE_SYSTEM = `You judge Hebrew words for an advanced reader of Israeli news and business Hebrew who reads newspapers daily.
For each word given (its dictionary form, meaning and the reader's weakness categories), say whether such a reader would already know it cold: basic vocabulary, ordinals, numbers, colours, days and months, the commonest nouns, verbs and adjectives are "easy"; anything a reader of this level could still stumble on (register, rarer roots, tricky forms, prepositions it governs, spelling traps) is not.
Answer with ONE JSON object and nothing else: {"words": [{"id": "<the id given>", "easy": true or false}, ...]}, one entry per word given.`;

async function judgeNew(spots) {
  const todo = spots.filter((s) => s.status === 'new' && (s.easy === null || s.easy === undefined)).slice(0, JUDGE_MAX);
  if (!todo.length) return 0;
  const lines = todo.map((s) => {
    const c = (db.newestCardOfSpot(s.id) || {}).card || {};
    return JSON.stringify({ id: s.id, word: s.lemma || c.surface || '', meaning: c.meaning_en || '', categories: s.categories || [] });
  });
  let raw;
  try {
    raw = await lookup.chat({ system: JUDGE_SYSTEM, user: `Difficulty request\nWords, one per line:\n${lines.join('\n')}`, maxTokens: 60 + 30 * todo.length, what: 'The words could not be judged', retryParse: true });
  } catch (e) {
    console.error(`today: ${e.message}; new words drilled unjudged`);
    return 0;
  }
  const ids = new Set(todo.map((s) => s.id));
  let n = 0;
  for (const w of (raw && Array.isArray(raw.words) ? raw.words : [])) {
    if (!w || !ids.has(w.id) || typeof w.easy !== 'boolean') continue;
    db.setEasy(w.id, w.easy);
    const s = todo.find((x) => x.id === w.id);
    s.easy = w.easy ? 1 : 0;
    ids.delete(w.id);
    n++;
  }
  console.log(`today: ${n} of ${todo.length} new words judged (${todo.filter((s) => s.easy === 1).map((s) => s.lemma).join(', ') || 'none'} easy)`);
  return n;
}

// hebrew-today-two: a set never runs dry. When the words due (above, with
// the rest of the solid words due after the one) do not fill the eight word
// slots, the set draws on words not yet due: first the shaky ones (and new
// ones still being learnt: a new word answered right stays new, with a due
// day), then the solid ones, each earliest due first, the least recently
// touched first on the same day. A word already in an unfinished set is
// skipped. The set's note then says so.
const NOTE_LATER = 'Nothing more is due; this set draws on words not yet due.';

async function chooseWords(day) {
  const busy = db.spotsInUnfinishedSets();
  const free = (s) => !busy.has(s.id);
  const due = db.dueSpots(day).filter(free);
  // a word Dan saved (shaky) is drilled whatever it was judged while new;
  // the judgment only keeps easy new words out
  const learning = (s) => s.status === 'shaky' || (s.status === 'new' && s.easy !== 1);
  // shaky (saved) words before new (only met), each group in the order dueSpots gives
  const shakyFirst = (list) => [...list.filter((s) => s.status === 'shaky'), ...list.filter((s) => s.status !== 'shaky')];
  const solid = due.filter((s) => s.status === 'solid' && s.due_on).sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id));
  const fromLessons = shakyFirst(due.filter((s) => (s.status === 'shaky' || s.status === 'new') && s.from_lesson));
  const fromArticles = shakyFirst(due.filter((s) => (s.status === 'shaky' || s.status === 'new') && !s.from_lesson && s.from_article));
  await judgeNew([...fromLessons, ...fromArticles]);
  const lessons = pool(fromLessons.filter(learning), 'lesson');
  const articles = pool(fromArticles.filter(learning), 'article');
  const solids = pool(solid, 'solid');
  const a = await solids.take(1);
  const bCap = WORDS - 2 - a.length;
  const b = await lessons.take(bCap);
  const cWant = 2 + (bCap - b.length);
  const c = await articles.take(cWant);
  b.push(...await lessons.take(cWant - c.length));
  // words not yet due, from a lesson or an article as the words due are
  const later = db.laterSpots(day).filter(free).filter((s) => s.from_lesson || s.from_article);
  const groupOf = (s) => (s.from_lesson ? 'lesson' : 'article');
  const laterShaky = pool(later.filter(learning), groupOf);
  const laterSolid = pool(later.filter((s) => s.status === 'solid'), 'solid');
  const notDue = [];
  // up to n more words, from the first source that has any, in order: the
  // words due (lesson, article, solid), then shaky not yet due, then solid
  // not yet due
  const fill = async (n) => {
    for (const [src, into] of [[lessons, b], [articles, c], [solids, a], [laterShaky, notDue], [laterSolid, notDue]]) {
      if (n <= 0) break;
      const got = await src.take(n);
      into.push(...got);
      n -= got.length;
    }
  };
  await fill(WORDS - a.length - b.length - c.length);
  return { a, b, c, notDue, fill };
}

// --- fresh passages -------------------------------------------------------------------
// Three to five sentences on one subject (in turn), written around four to
// six of Dan's shaky words, with at most two new words, one question
// (alternating: a verb blanked, or a comprehension question in Hebrew with
// three choices) and an English rendering. Made when the set is made, one
// model call each, never on a tap.

const SUBJECTS = [
  'energy and electricity markets (batteries, the grid, tenders)',
  'business and markets',
  'aviation',
  'Israeli politics and society',
  'twentieth-century history',
];
const MIN_FOUND = 3;
// Verbs too basic to blank in a passage: by dictionary form (the model names
// it), and their commonest past forms, should the model not.
const BASIC_VERBS = new Set(['היה', 'אמר', 'עשה', 'הלך', 'בא', 'נתן', 'לקח', 'ראה', 'יצא', 'ידע', 'רצה', 'יכול', 'יכל', 'שם', 'קם', 'ישב', 'אכל', 'שתה', 'דיבר', 'חשב', 'עבד', 'התחיל', 'נשאר', 'חזר', 'שאל', 'ענה', 'קרא', 'כתב', 'הגיע', 'מצא', 'שמע', 'נכנס', 'אהב', 'גר', 'קנה', 'עמד', 'הביא']);
const BASIC_FORMS = new Set(['היה', 'הייתה', 'היתה', 'היו', 'יהיה', 'תהיה', 'יהיו', 'אמר', 'אמרה', 'אמרו', 'עשה', 'עשתה', 'עשו', 'הלך', 'הלכה', 'הלכו', 'בא', 'באה', 'באו', 'נתן', 'נתנה', 'נתנו', 'לקח', 'לקחה', 'לקחו', 'ראה', 'ראתה', 'ראו', 'יצא', 'יצאה', 'יצאו', 'ידע', 'ידעה', 'ידעו', 'רצה', 'רצתה', 'רצו', 'יכול', 'יכולה', 'יכולים']);

const PASSAGE_SYSTEM = `You write short reading passages for an advanced reader of Israeli news and business Hebrew.
Write ONE passage of three to five sentences of Israeli-news or business Hebrew on the subject given, without nikud.
Use at least four of the reader's words given (all of them when there are four or fewer), each in exactly one of the forms listed for it, letter for letter (a prefix such as ו, ה, ב, ל, מ, ש in front is allowed).
You may use at most two words an advanced reader would likely not know; list them in "new_words" exactly as they stand in the passage, with their meaning.
"english" is a faithful English rendering of the whole passage.
"used" lists each of the reader's words you used, with the form as it stands in the passage.
For the question kind "verb": "verb" is the verb of the passage to be blanked, exactly as it stands in it (prefixes included): one of the reader's words that is a verb, where you used one; else the least common verb in the passage, never a basic verb (such as היה, אמר, עשה, הלך, בא, נתן, לקח, ראה, יצא, רצה); "verb_lemma" is its dictionary form; "question_he" is "", "choices" is ["", "", ""], "answer_index" is 0.
For the question kind "comprehension": "verb" and "verb_lemma" are ""; "question_he" is one question in Hebrew about the passage's content; "choices" are three short Hebrew answers, exactly one right; "answer_index" is the right one's index (0, 1 or 2).
Answer with ONE JSON object and nothing else.`;

const PASSAGE_SCHEMA = {
  name: 'today_passage',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['hebrew', 'english', 'used', 'new_words', 'verb', 'verb_lemma', 'question_he', 'choices', 'answer_index'],
    properties: {
      hebrew: { type: 'string' },
      english: { type: 'string' },
      used: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['word', 'form'], properties: { word: { type: 'string' }, form: { type: 'string' } } } },
      new_words: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['surface', 'meaning_en'], properties: { surface: { type: 'string' }, meaning_en: { type: 'string' } } } },
      verb: { type: 'string' },
      verb_lemma: { type: 'string' },
      question_he: { type: 'string' },
      choices: { type: 'array', items: { type: 'string' } },
      answer_index: { type: 'integer' },
    },
  },
};

// The forms a shaky word may stand in: its dictionary form and every form it
// was met as, nikud stripped.
function formsOf(spot) {
  return [...new Set([spot.lemma, ...db.surfacesOfSpot(spot.id)].map(letters).filter(Boolean))];
}

// The given words found in the text: a word of the text (nikud stripped)
// that is one of a word's forms, alone or after one prefix the reader knows.
function wordsFound(text, given) {
  const tokens = tok.words(text).map((w) => ({ surface: w.surface, k: letters(w.surface) }));
  const found = [];
  for (const g of given) {
    const hit = tokens.find((t) => g.forms.some((f) => t.k === f || tok.READING_PREFIXES.some((p) => t.k === p + f)));
    if (hit) found.push({ spot_id: g.spot_id, lemma: g.lemma, surface: hit.surface });
  }
  return found;
}

// How many sentences a text holds: the stretches between . ! ? (and line
// breaks) that hold a Hebrew word.
const SENTENCES = { min: 3, max: 5 };
function sentenceCount(text) {
  return String(text || '').split(/[.!?\n]+/).filter((s) => tok.words(s).length > 0).length;
}

// One passage, or { failed: 'model' | 'length' | 'words' | 'question', why }.
async function onePassage({ given, subject, question }) {
  const list = given.map((g) => `- ${g.lemma}: ${g.forms.join(', ')}`).join('\n');
  let raw;
  try {
    raw = await lookup.chat({
      system: PASSAGE_SYSTEM, user: `Passage request\nSubject: ${subject}\nQuestion kind: ${question}\nThe reader's words (dictionary form: forms you may use):\n${list}`,
      model: lookup.GUIDE_MODEL, schema: PASSAGE_SCHEMA, maxTokens: 1600, timeoutMs: 90000, retryParse: true, what: 'A passage could not be made',
    });
  } catch (e) {
    return { failed: 'model', why: e.message };
  }
  if (!raw || raw.error || typeof raw.hebrew !== 'string' || !raw.hebrew.trim()) return { failed: 'model', why: raw && raw.error ? String(raw.error) : 'no passage in the answer' };
  const text = bare(raw.hebrew).trim();
  const n = sentenceCount(text);
  if (n < SENTENCES.min || n > SENTENCES.max) return { failed: 'length', why: `it has ${n} sentences (${SENTENCES.min} to ${SENTENCES.max} kept)` };
  const found = wordsFound(text, given);
  if (found.length < MIN_FOUND) return { failed: 'words', why: `${found.length} of the ${given.length} words given are in it (${MIN_FOUND} needed)` };
  const newWords = (Array.isArray(raw.new_words) ? raw.new_words : [])
    .map((w) => ({ surface: bare(w && w.surface).trim(), meaning_en: String((w && w.meaning_en) || '').trim() }))
    .filter((w) => w.surface && tok.words(text).some((t) => t.surface === w.surface)).slice(0, 2);
  let q;
  if (question === 'verb') {
    // one of Dan's own shaky verbs where the passage has one; else the
    // model's verb, never a basic one
    const own = found.find((f) => (db.getSpot(f.spot_id) || {}).kind === 'verb');
    const verb = own ? own.surface : bare(raw.verb).trim();
    const v = letters(verb);
    const basicForm = [v, ...tok.PROCLITICS.filter((p) => v.startsWith(p)).map((p) => v.slice(p.length))].some((x) => BASIC_FORMS.has(x));
    if (!own && (BASIC_VERBS.has(letters(raw.verb_lemma)) || basicForm)) return { failed: 'question', why: `the verb to blank (${verb}, ${raw.verb_lemma || 'no dictionary form given'}) is a basic verb` };
    const at = demand.findSurface(text, verb);
    if (!at) return { failed: 'question', why: `the verb to blank (${verb || 'none'}) is not a word of the passage` };
    q = { type: 'form', text: text.slice(0, at.start) + '…' + text.slice(at.end), answer: text.slice(at.start, at.end) };
  } else {
    const choices = Array.isArray(raw.choices) ? raw.choices.map((c) => String(c || '').trim()) : [];
    const i = Number(raw.answer_index);
    if (!String(raw.question_he || '').trim() || choices.length !== 3 || choices.some((c) => !c) || new Set(choices).size !== 3 || ![0, 1, 2].includes(i)) {
      return { failed: 'question', why: 'the comprehension question did not come with three different choices and the right one' };
    }
    q = { type: 'choice', question_he: String(raw.question_he).trim(), choices, answer: choices[i] };
  }
  return { kind: 'passage', group: 'passage', spot_id: null, subject, text, english: String(raw.english || '').trim(), words_used: found, new_words: newWords, question: q, source: `A fresh passage: ${subject}` };
}

// The day's passages, and the plain line the page shows when there are fewer
// than two. `prefer`: spot ids of the set's own words, given first.
async function makePassages(prefer = []) {
  const shaky = db.shakyForPassages();
  const first = new Set(prefer);
  const words = [...shaky.filter((s) => first.has(s.id)), ...shaky.filter((s) => !first.has(s.id))]
    .map((s) => ({ spot_id: s.id, lemma: letters(s.lemma), forms: formsOf(s) })).filter((g) => g.lemma);
  if (words.length < MIN_FOUND) return { passages: [], note: `No fresh passages today; they need at least ${MIN_FOUND} of your shaky words.` };
  const turn = db.passagesBuilt();
  const passages = [];
  const failed = [];
  for (let p = 0; p < PASSAGES; p++) {
    const given = Array.from({ length: Math.min(6, words.length) }, (_, k) => words[(p * 6 + k) % words.length]);
    const subject = SUBJECTS[(turn + p) % SUBJECTS.length];
    const question = (turn + p) % 2 === 0 ? 'verb' : 'comprehension';
    const out = await onePassage({ given, subject, question });
    if (out.failed) { failed.push(out.failed); console.error(`today: passage on ${subject} not kept: ${out.why}`); }
    else passages.push(out);
  }
  let note = null;
  if (passages.length < PASSAGES) {
    const WHY = { model: 'the model did not answer', length: 'the passages written were not three to five sentences', words: 'the passages written did not use your words', question: 'the passages written came without a usable question' };
    const why = WHY[['model', 'length', 'words', 'question'].find((k) => failed.includes(k))];
    note = passages.length ? `One fresh passage today; for the other ${why}.` : `No fresh passages today; ${why}.`;
  }
  return { passages, note };
}

// --- the day's set ------------------------------------------------------------------

// The items of a new set: { items, note }, shown in the order lesson words,
// article words, solid words, words not yet due, passages; or { state: 'no
// data', reason } when not one item could be made.
async function build(day) {
  const { a, b, c, notDue, fill } = await chooseWords(day);
  const { passages, note: passageNote } = await makePassages([...b, ...c, ...a, ...notDue].map((it) => it.spot_id));
  if (passages.length < PASSAGES) await fill(PASSAGES - passages.length);
  const items = [...b, ...c, ...a, ...notDue, ...passages].map((it, index) => ({ index, ...it }));
  if (!items.length) {
    return { state: 'no data', reason: db.hasSpots() ? 'None of your words can be drilled just now: each is in an unfinished set, or is one you know cold.' : 'You have no words yet; save words as you read, or bring in a lesson from Guy.' };
  }
  const note = [notDue.length ? NOTE_LATER : null, passageNote].filter(Boolean).join(' ') || null;
  return { items, note };
}

// --- when the set is made ---------------------------------------------------------------
// Sets are numbered (drill_sets.seq), as many a day as Dan likes. The current
// set is the newest unfinished one. ensureSet (the page's open, the 05:00
// build) makes a set only when there is no unfinished set at all and none was
// built that day yet: an unfinished set from an earlier day keeps being served
// until it is done (its unanswered words stay due, so nothing is lost), and a
// finished set shows its "Done" screen until the next day's build or Dan's
// "Another set" tap. newSet (that tap) builds another set regardless. Both
// share one guard: two calls at once share one build. Answers { set, built }
// or { state: 'no data', reason }.

let building = null;
function guarded(fn) {
  if (building) return building;
  building = fn().finally(() => { building = null; });
  return building;
}

async function buildAndStore(day) {
  const t0 = Date.now();
  const made = await build(day);
  if (made.state === 'no data') { console.log(`today: no set built on ${day}: ${made.reason}`); return made; }
  const set = db.addDrillSet({ day, items: made.items, note: made.note });
  const kinds = made.items.map((it) => it.kind).join(', ');
  console.log(`today: set ${set.id} (number ${set.seq}, ${set.for_day}), ${made.items.length} items (${kinds}) in ${Date.now() - t0} ms${made.note ? '; ' + made.note : ''}`);
  return { set, built: true };
}

function ensureSet(day = dayOf()) {
  return guarded(async () => {
    const open = db.newestUnfinishedSet();
    if (open) return { set: open, built: false };
    const there = db.newestSetOfDay(day);
    if (there) return { set: there, built: false };
    return buildAndStore(day);
  });
}

function newSet(day = dayOf()) {
  return guarded(() => buildAndStore(day));
}

// The next 05:00 in Tokyo after `now` (Japan keeps no summer time: 05:00
// there is always 20:00 UTC the day before).
function nextBuildAt(now = new Date()) {
  const day = dayOf(now);
  const t = Date.parse(`${day}T05:00:00+09:00`);
  return new Date(t > now.getTime() ? t : Date.parse(`${addDays(day, 1)}T05:00:00+09:00`));
}

// One in-process scheduler, started by server.js at boot: wait for the next
// 05:00 Tokyo, make the day's set, arm again. A chain of timeouts, so a slow
// build never overlaps the next; a failed build is logged and the page's own
// call makes the set on the first open.
function startScheduler() {
  let timer = null;
  const arm = () => {
    const at = nextBuildAt();
    timer = setTimeout(fire, Math.max(0, at.getTime() - Date.now()));
    if (timer.unref) timer.unref();
    console.log(`today: the next set is made at ${at.toISOString()} (05:00 Tokyo)`);
  };
  const fire = () => {
    ensureSet(dayOf()).catch((e) => console.error(`today: the day's set could not be made: ${e.message}`)).finally(arm);
  };
  arm();
  return { stop: () => clearTimeout(timer) };
}

// --- the set as the page reads it -----------------------------------------------------

// Each item with its answer (right or wrong) and whether it was shown; where
// the page starts (the first item not answered); done when every item is.
// --- niqud on what is revealed ------------------------------------------------------
// An answer, once revealed or confirmed, is shown with its niqud, from the
// word's card as it stands now: the pointed word when the card is the one for
// this very form, else the pointed dictionary form, else the word plain. The
// question and the choices stay plain, so niqud gives nothing away.

function pointedWord(spotId, surface) {
  if (!spotId || !surface) return null;
  const exact = db.cardForSurface(surface, spotId, null);
  const c = exact || (db.newestCardOfSpot(spotId) || {}).card;
  if (!c || !c.pointed) return null;
  const same = exact && bare(exact.surface) === bare(surface);
  return (same && c.pointed.surface) || c.pointed.lemma || null;
}

// The item with word_pointed (the word, for the flash and the day's list) and
// answer_pointed (what fills the gap once answered); null where there is none.
function withPointed(it) {
  if (!it.spot_id) return { ...it, word_pointed: null, answer_pointed: null };
  const word = pointedWord(it.spot_id, it.word);
  // what fills a sentence's gap must be the answer itself with its points:
  // a pointed form of other letters (the dictionary form of an inflected
  // word) would change the answer, so the gap then keeps the answer plain
  const answer = it.kind === 'preposition' ? PREPOSITIONS_POINTED[it.answer] || null
    : it.kind === 'know' || !word || bare(word) !== bare(it.answer) ? null : word;
  return { ...it, word_pointed: word, answer_pointed: answer };
}

function view(set) {
  const rows = db.drillAnswersOf(set.id);
  const items = set.items.map(withPointed).map((it) => {
    const answered = rows.filter((r) => r.item_index === it.index && r.result !== 'shown').at(-1) || null;
    const shown = rows.some((r) => r.item_index === it.index && r.result === 'shown');
    return { ...it, answered: answered ? { id: answered.id, result: answered.result, answer: answered.answer, at: answered.at, too_easy: answered.kind === TOO_EASY } : null, shown };
  });
  const next = items.find((it) => !it.answered);
  const last = rows.filter((r) => r.result !== 'shown').at(-1);
  return {
    state: 'ok', set: { id: set.id, seq: set.seq, for_day: set.for_day, built_at: set.built_at, note: set.note },
    items, total: items.length, position: next ? next.index : items.length, done: !next,
    last_answer: last ? { id: last.id, item_index: last.item_index } : null,
  };
}

// GET /today/set: the newest unfinished set (made first when there is none
// and none was made today), else the newest finished set (its "Done" screen,
// with "Another set"), else { state: 'no data', reason }.
async function current({ now = new Date() } = {}) {
  const day = dayOf(now);
  let made = null, failed = null;
  try { made = await ensureSet(day); } catch (e) { failed = e; console.error(`today: the day's set could not be made: ${e.message}`); }
  const set = db.newestUnfinishedSet() || db.latestDrillSet();
  if (set) return view(set);
  return { state: 'no data', reason: failed ? `Today's set could not be made: ${failed.message}` : (made && made.reason) || 'Nothing is due today.' };
}

// POST /today/another: Dan's "Another set" tap — a new set, opened at item 1.
async function another({ now = new Date() } = {}) {
  const made = await newSet(dayOf(now));
  if (made.state === 'no data') return made;
  return view(made.set);
}

// --- answers --------------------------------------------------------------------------
// Right: right_run + 1; interval_days up the ladder from where it stands (the
// first right after none, or after a wrong, is 1); due in that many days. A
// shaky word whose run of rights is three or more, on three different days,
// becomes solid. Wrong: right_run 0, interval 1, due tomorrow; a solid or new
// word becomes shaky. A status change goes through saveStatus (the spot, then
// the mark to the spine); a word already on the spine whose status stays gets
// its mark again with the new due day. Every answer is one drill_answers row.

const LADDER = [1, 3, 7, 14, 30];
const nextRung = (v) => LADDER.find((x) => x > v) || LADDER.at(-1);
const RESULTS = ['right', 'wrong'];

function itemAt(body) {
  const setId = Number(body.set_id);
  if (!Number.isInteger(setId) || setId <= 0) throw new db.ReaderError(400, 'set_id is required: the whole number id of the set GET /today/set gave.');
  const set = db.getDrillSet(setId);
  const index = Number(body.item_index);
  if (!Number.isInteger(index) || !set.items[index]) throw new db.ReaderError(400, `item_index is a whole number from 0 to ${set.items.length - 1}; got ${JSON.stringify(body.item_index)}.`);
  return { set, item: set.items[index], rows: db.drillAnswersOf(set.id) };
}

// What a typed form or a chosen answer makes the result, where the item can
// judge it; null where only Dan's own tap can (Do you know it, or after Show).
function judge(item, answer) {
  if (typeof answer !== 'string' || !answer.trim()) return null;
  const a = answer.trim();
  if (item.kind === 'form') return demand.formMatches(item.answer, a) ? 'right' : 'wrong';
  if (item.kind === 'preposition' || item.kind === 'spelling') return a === item.answer ? 'right' : 'wrong';
  if (item.kind === 'passage') return item.question.type === 'form' ? (demand.formMatches(item.question.answer, a) ? 'right' : 'wrong') : (a === item.question.answer ? 'right' : 'wrong');
  return null;
}

// The mark again for a word whose status stayed (only when the spine already
// has it, as for a touch); a status change goes through saveStatus.
async function markAfter(spotId, status) {
  const spot = db.getSpot(spotId);
  if (spot.status !== status) return saveStatus(spotId, status);
  if (!spot.on_spine) return { spot, spine: 'not on spine' };
  return { spot, spine: await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spotId) }) };
}

const dueText = (n) => (n === 1 ? 'next due tomorrow' : `next due in ${n} days`);

// POST /today/answer { set_id, item_index, result, answer }.
async function answer(body, { now = new Date() } = {}) {
  const { set, item, rows } = itemAt(body);
  const judged = judge(item, body.answer);
  const result = judged || body.result;
  if (!RESULTS.includes(result)) throw new db.ReaderError(400, `result must be one of ${RESULTS.join(', ')}; got ${JSON.stringify(body.result)} (Show is POST /today/show).`);
  const had = rows.find((r) => r.item_index === item.index && r.result !== 'shown');
  if (had) throw new db.ReaderError(409, `Item ${item.index + 1} was already answered ${had.result}; Undo it to answer again.`);
  const at = now.toISOString();
  const typed = typeof body.answer === 'string' && body.answer.trim() ? body.answer.trim() : null;
  const spot = item.spot_id ? db.getSpot(item.spot_id) : null;
  if (!spot) {
    // a passage (or a word no longer on the map): the answer alone
    const id = db.addDrillAnswer({ set_id: set.id, item_index: item.index, spot_id: item.spot_id, kind: item.kind, result, answer: typed, at });
    console.log(`today: set ${set.id} item ${item.index + 1} (${item.kind}): ${result}`);
    return { answer_id: id, result, flash: { word: item.word || null, result, text: `${result === 'right' ? 'Right' : 'Not that one'}` }, spot: null, spine: null, view: view(set) };
  }
  const day = dayOf(now);
  const before = { status: spot.status, due_on: spot.due_on, interval_days: spot.interval_days, right_run: spot.right_run };
  const sched = result === 'right'
    ? { right_run: spot.right_run + 1, interval_days: spot.right_run === 0 ? 1 : nextRung(spot.interval_days) }
    : { right_run: 0, interval_days: 1 };
  sched.due_on = addDays(day, sched.interval_days);
  const id = db.together(() => {
    const n = db.addDrillAnswer({ set_id: set.id, item_index: item.index, spot_id: spot.id, kind: item.kind, result, answer: typed, at, before });
    db.setSchedule(spot.id, sched);
    return n;
  });
  let status = spot.status;
  if (result === 'right' && spot.status === 'shaky' && sched.right_run >= 3) {
    const run = db.spotResults(spot.id, sched.right_run).filter((r) => r.result === 'right');
    if (new Set(run.map((r) => dayOf(new Date(r.at)))).size >= 3) status = 'solid';
  }
  if (result === 'wrong' && (spot.status === 'solid' || spot.status === 'new')) status = 'shaky';
  const marked = await markAfter(spot.id, status);
  const pointed = pointedWord(spot.id, item.word);
  console.log(`today: set ${set.id} item ${item.index + 1} ${spot.id} (${item.kind}): ${result}; interval ${sched.interval_days}, due ${sched.due_on}${status !== before.status ? `, ${before.status} -> ${status}` : ''}`);
  return {
    answer_id: id, result,
    flash: { word: item.word, word_pointed: pointed, result, due_on: sched.due_on, interval_days: sched.interval_days, status, status_was: before.status, text: `${pointed || item.word} — ${result}; ${dueText(sched.interval_days)}` },
    spot: marked.spot, spine: marked.spine, view: view(set),
  };
}

// POST /today/show { set_id, item_index }: records the show once (the item
// then waits for Dan's own tap) and answers what Show reveals: the word's card,
// or a passage's English.
// POST /today/easy { set_id, item_index }: "Too easy" on a word item. The
// word is marked solid through saveStatus (the spot, then the mark to the
// spine); its schedule is left as it was. The tap is one drill_answers row:
// result 'right' (the table takes right, wrong or shown) and kind 'too-easy',
// with the word's fields before it, so Undo puts the word back like any answer.
const TOO_EASY = 'too-easy';
async function tooEasy(body, { now = new Date() } = {}) {
  const { set, item, rows } = itemAt(body);
  if (!item.spot_id) throw new db.ReaderError(400, 'Too easy is for a word; a passage has none to mark.');
  const had = rows.find((r) => r.item_index === item.index && r.result !== 'shown');
  if (had) throw new db.ReaderError(409, `Item ${item.index + 1} was already answered ${had.result}; Undo it first.`);
  const spot = db.requireSpot(item.spot_id);
  const before = { status: spot.status, due_on: spot.due_on, interval_days: spot.interval_days, right_run: spot.right_run };
  const id = db.addDrillAnswer({ set_id: set.id, item_index: item.index, spot_id: spot.id, kind: TOO_EASY, result: 'right', answer: null, at: now.toISOString(), before });
  const marked = await markAfter(spot.id, 'solid');
  const pointed = pointedWord(spot.id, item.word);
  console.log(`today: set ${set.id} item ${item.index + 1} ${spot.id}: too easy, ${before.status} -> solid`);
  return {
    answer_id: id, result: 'right', too_easy: true,
    flash: { word: item.word, word_pointed: pointed, result: 'right', status: 'solid', status_was: before.status, text: `${pointed || item.word} — too easy; marked solid` },
    spot: marked.spot, spine: marked.spine, view: view(set),
  };
}

async function show(body, { now = new Date() } = {}) {
  const { set, item, rows } = itemAt(body);
  const done = rows.some((r) => r.item_index === item.index && r.result !== 'shown');
  if (!done && !rows.some((r) => r.item_index === item.index && r.result === 'shown')) {
    db.addDrillAnswer({ set_id: set.id, item_index: item.index, spot_id: item.spot_id, kind: item.kind, result: 'shown', answer: null, at: now.toISOString() });
  }
  if (item.kind === 'passage') return { english: item.english, answer: item.question.answer, view: view(set) };
  const row = (item.card_id && db.getCardById(item.card_id)) || (item.spot_id && db.newestCardOfSpot(item.spot_id));
  const spot = item.spot_id ? db.getSpot(item.spot_id) : null;
  return { card: row ? row.card : null, sentence: row ? row.sentence || '' : '', spot, answer: item.answer || null, answer_pointed: withPointed(item).answer_pointed, view: view(set) };
}

// POST /today/undo { set_id }: the set's last answer (right or wrong) goes,
// and its word's three scheduling fields and status are put back as they were
// before it (a status put back goes through saveStatus, so the spine has it).
async function undo(body) {
  const setId = Number(body.set_id);
  if (!Number.isInteger(setId) || setId <= 0) throw new db.ReaderError(400, 'set_id is required: the whole number id of the set.');
  const set = db.getDrillSet(setId);
  const last = db.drillAnswersOf(set.id).filter((r) => r.result !== 'shown').at(-1);
  if (!last) throw new db.ReaderError(409, 'Nothing to undo in this set.');
  if (body.answer_id !== undefined && body.answer_id !== null && Number(body.answer_id) !== last.id) {
    throw new db.ReaderError(409, `Only the last answer can be undone; that is answer ${last.id}, not ${body.answer_id}.`);
  }
  // an older page (another tab, the phone left open) must not undo what came
  // after: only the newest answer of all, in a set no newer set has followed;
  // refused before anything is written
  const newest = db.lastDrillAnswer();
  if (newest.id !== last.id) throw new db.ReaderError(409, `Only the last answer can be undone, and a later one was given (item ${newest.item_index + 1} of set ${newest.set_id}); reload the page.`);
  const latest = db.latestDrillSet();
  if (latest && latest.id !== set.id) throw new db.ReaderError(409, `This set is over: a newer set (number ${latest.seq}) has been made since, so its answers stay; reload the page.`);
  const item = set.items[last.item_index];
  let marked = { spot: null, spine: null };
  const spot = last.spot_id ? db.getSpot(last.spot_id) : null;
  db.together(() => {
    db.deleteDrillAnswer(last.id);
    if (spot && last.before) db.setSchedule(spot.id, last.before);
  });
  if (spot && last.before) marked = await markAfter(spot.id, last.before.status);
  console.log(`today: set ${set.id} item ${last.item_index + 1}: ${last.result} undone${spot ? ` (${spot.id} back to ${JSON.stringify(last.before)})` : ''}`);
  return { undone: { answer_id: last.id, item_index: last.item_index, result: last.result, word: item.word || null, word_pointed: withPointed(item).word_pointed }, spot: marked.spot, spine: marked.spine, view: view(set) };
}

module.exports = { dayOf, addDays, ensureSet, newSet, another, nextBuildAt, startScheduler, current, view, answer, show, undo, tooEasy, judge, judgeNew, BASIC_VERBS, LADDER, build, chooseWords, makePassages, onePassage, wordsFound, sentenceCount, SENTENCES, itemFor, readsOf, misspelling, madeMisspellings, gapPreposition, prepositionOf, PREPOSITIONS, SUBJECTS, MIN_FOUND, TZ, SET_SIZE };
