'use strict';
// The ask surface (hebrew-ask-one): the one place a question is answered.
// The reader's Ask box (POST /ask), "Ask here" on a desk card (POST
// /card/:key/ask) and "Ask about this root" on a word card (POST /ask) all
// come through `ask` here.
//
// An ask has three parts:
//   subject  what is asked about: { kind: 'article', article_id? } (the
//            piece's mapped words go into the question, so "which Nif'al
//            forms are in this piece" is answered from data), { kind: 'card',
//            key } (a desk card, its entry and its layers), or { kind: 'root',
//            root?, lemma, … } (a word card as the page holds it)
//   desk     who answers and what it may search (lib/ask-desks.js)
//   parent   the earlier ask this one follows, when it is a follow-up: the
//            model is given the chain's earlier questions and answers, oldest
//            first, the last six turns, before the new question
//
// One model call with the web search limited to the desk's sites; the links
// are the pages the search cited (grow.js `linksFrom`), never an address the
// model wrote. Whether an answer the search cited nothing for is kept is the
// caller's choice, not the desk's: the reader's Ask box and the root ask keep
// it (session three: "no Nif'al form here" is data, not a failure); the
// desk's "Ask here" refuses it (session thirteen: 422, nothing kept). Every
// accepted answer is recorded in `asks`; a refused one writes nothing.
//
// The failure line is only for the model being unreachable, timing out,
// declining, or answering nothing usable, and it says which.

const db = require('./db');
const lookup = require('./lookup');
const grow = require('./grow');
const desks = require('./ask-desks');
const deskStore = require('./desk');
const tok = require('../public/tokenize.js');
const { asRead } = require('./articles');

const QUESTION_MAX = deskStore.QUESTION_MAX;
const KINDS = ['article', 'card', 'root'];
const TURNS = 6; // the earlier turns a follow-up carries
const FIELD_MAX = 300; // a root subject's field; its sentence takes SENTENCE_MAX
const SENTENCE_MAX = 1000;
const FAILED = 'The references could not be asked';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// What the question is about, per kind, in one line of the system text.
const ABOUT = {
  article: 'The question is asked while reading an article; the words of it the reader has looked up or saved are listed with it.',
  card: "The question is about one card from the reader's study desk: its entry and what the reader has added to it.",
  root: "The question is about one Hebrew root or word, as the reader's word card gives it.",
};

const FORMAT = `Answer with ONE JSON object and nothing else: {"answer": "<the brief answer>"}
When the true answer is that there is none — no such form appears, nothing in the reader's list matches — that IS the answer: say so plainly. Never call that an error.
Answer {"error": "<one short reason>"} only when you will not answer at all: the question is outside what you answer, or you decline it.`;

function systemFor(desk, kind) {
  return `${desk.persona}\n${ABOUT[kind]}\n${FORMAT}`;
}

// --- the subject, as the model is given it -------------------------------------------

function articleSubject(articleId) {
  if (articleId === undefined || articleId === null || articleId === '') {
    return { text: 'The article: none named.', word: null, label: '' };
  }
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) throw new db.ReaderError(400, 'subject.article_id, when given, is the whole number id of an article.');
  const article = db.getArticle(id);
  const marks = db.marksForSurfaces();
  const seen = new Set();
  const lines = [];
  for (const w of tok.words(asRead(article))) {
    const m = marks[w.surface];
    if (!m || seen.has(m.spot_id)) continue;
    seen.add(m.spot_id);
    const spot = db.getSpot(m.spot_id);
    if (!spot) continue;
    lines.push(`- ${w.surface}: ${spot.kind === 'verb' ? `root ${spot.root}, ${spot.binyan}` : `lemma ${spot.lemma}${spot.root ? ', root ' + spot.root : ''}`}, status ${spot.status}`);
  }
  return {
    text: `The article: "${article.title}"\nThe words in it the reader has looked up or saved (surface: root/lemma, binyan, status):\n${lines.length ? lines.join('\n') : '(none yet)'}`,
    word: null, label: ` on "${article.title}"`,
  };
}

function cardSubject(key) {
  if (typeof key !== 'string' || !key) throw new db.ReaderError(400, 'subject.key is the card asked about, such as word:12.');
  deskStore.parseKey(key);
  const { c, text: about } = grow.context(key);
  const word = c.kind === 'word' ? (c.card.lemma || c.card.surface || null) : null;
  return { text: `The card:\n${about}`, word, label: ` on card ${key}` };
}

// A word card as the page holds it: the root letters, the dictionary form
// with its nikud, the binyan or part of speech, the meaning, and the
// sentence it was met in. A root or a dictionary form is needed.
function rootSubject(s) {
  const field = (name, max = FIELD_MAX) => {
    const v = s[name];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') throw new db.ReaderError(400, `subject.${name}, when given, is text.`);
    const t = v.trim();
    if (t.length > max) throw new db.ReaderError(400, `subject.${name} is at most ${max} characters; this one has ${t.length}.`);
    return t;
  };
  const root = field('root'), lemma = field('lemma'), pointed = field('lemma_pointed'), binyan = field('binyan'), pos = field('pos'), meaning = field('meaning_en'), sentence = field('sentence', SENTENCE_MAX);
  if (!root && !lemma) throw new db.ReaderError(400, 'subject.root or subject.lemma is required: the root letters, or the dictionary form when the word has no root.');
  const lines = [`The root: ${root || 'none (the word has no root)'}`];
  if (lemma) lines.push(`Dictionary form: ${pointed && pointed !== lemma ? `${pointed} (${lemma})` : lemma}`);
  if (binyan) lines.push(`Binyan: ${binyan}`);
  else if (pos) lines.push(`Part of speech: ${pos}`);
  if (meaning) lines.push(`Meaning: ${meaning}`);
  if (sentence) lines.push(`The sentence it was met in: ${sentence}`);
  return { text: lines.join('\n'), word: lemma || null, label: ` on ${root || lemma}` };
}

function subjectOf(subject) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) throw new db.ReaderError(400, `subject is required: { kind, … }, kind one of ${KINDS.join(', ')}.`);
  if (!KINDS.includes(subject.kind)) throw new db.ReaderError(400, `subject.kind must be one of ${KINDS.join(', ')}`);
  if (subject.kind === 'article') return articleSubject(subject.article_id);
  if (subject.kind === 'card') return cardSubject(subject.key);
  return rootSubject(subject);
}

// --- a follow-up's earlier turns -------------------------------------------------------

// The chain an ask ends: the parent, its parent, … oldest first, the last
// TURNS of them. Answers [{ question, answer }].
function chainOf(parentId) {
  const out = [];
  let id = parentId;
  for (let n = 0; id && n < 1000; n++) {
    const row = db.getAsk(id);
    if (!row) break;
    out.unshift({ question: row.question, answer: row.answer });
    id = row.parent_id;
  }
  return out.slice(-TURNS);
}

function parentOf(parent, deskId) {
  if (parent === undefined || parent === null || parent === '') return null;
  const id = Number(parent);
  if (!Number.isInteger(id) || id <= 0) throw new db.ReaderError(400, 'parent, when given, is the whole number id of an earlier ask.');
  const row = db.getAsk(id);
  if (!row) throw new db.ReaderError(404, `No ask with id ${id} to follow.`);
  if (row.desk !== deskId) throw new db.ReaderError(400, `Ask ${id} was answered by the ${row.desk} desk; a follow-up goes to the same desk.`);
  return row;
}

// --- one question ----------------------------------------------------------------------

// { desk?, subject, question, parent? } -> { id, answer, links, searches, state,
// links_state }, the answer recorded in `asks`. The caller's settings:
//   keepWithoutLink  an answer the search cited nothing for is kept (default)
//                    or refused with 422 and nothing written
//   what             the failure line's opening
//   alsoWrite(row)   one more write in the same transaction as the asks row
//                    (the desk's answer layer); its result comes back as `also`
async function ask({ desk: deskId = 'hebrew', subject, question, parent } = {}, { keepWithoutLink = true, what = FAILED, alsoWrite = null } = {}) {
  const desk = desks.get(deskId);
  if (!desk) throw new db.ReaderError(400, `desk must be one of ${desks.ids().join(', ')}`);
  question = text(question);
  if (!question) throw new db.ReaderError(400, 'question is required: one question, as text.');
  if (question.length > QUESTION_MAX) throw new db.ReaderError(400, `question is at most ${QUESTION_MAX} characters; this one has ${question.length}.`);
  const about = subjectOf(subject);
  const up = parentOf(parent, desk.id);
  const history = [];
  for (const t of up ? chainOf(up.id) : []) {
    history.push({ role: 'user', content: `Question: ${t.question}` }, { role: 'assistant', content: JSON.stringify({ answer: t.answer }) });
  }
  const info = {};
  const raw = await lookup.chat({
    system: systemFor(desk, subject.kind), user: `${about.text}\n\nQuestion: ${question}`, history,
    model: desk.model, ...desk.limits, what, textFallback: true, info,
    tools: grow.searchTool({ allowed_domains: desk.domains }),
  });
  // Anything the model said that reads as an answer is the answer: JSON with
  // an "answer", or plain text it sent instead of JSON.
  const answer = text(raw.answer) || text(raw.text);
  if (!answer) {
    const declined = text(raw.error);
    if (declined) throw new db.ReaderError(422, `${what}: the model declined — ${declined}`);
    throw new db.ReaderError(502, `${what}: the model gave no answer.`);
  }
  const links = grow.linksFrom(info.citations);
  const searches = info.searches || 0;
  const where = `ask (${desk.id}, ${subject.kind}${about.label}${up ? `, after ask ${up.id}` : ''})`;
  if (!links.length && !keepWithoutLink) {
    console.log(`${where}: answer refused, no link (${searches} search(es))`);
    throw new db.ReaderError(422, `${what} with a link to a reference, so it was not kept. Ask again, or look the word up yourself.`);
  }
  let also = null;
  const row = db.together(() => {
    const r = db.addAsk({ desk: desk.id, subject_kind: subject.kind, subject_text: about.text, word: about.word, question, answer, links, searches, parent_id: up ? up.id : null });
    if (alsoWrite) also = alsoWrite(r);
    return r;
  });
  console.log(`${where}: "${question.slice(0, 60)}" -> ask ${row.id}, ${links.length} link(s), ${searches} search(es)`);
  return { id: row.id, answer, links, searches, state: 'ok', links_state: links.length ? 'ok' : 'no data', ...(also ? { also } : {}) };
}

// POST /ask: { desk?, subject, question, parent? }, or the reader's Ask box
// in its first shape, { question, article_id? }, which is the article
// subject on the hebrew desk.
function askRoute(body = {}) {
  if (body.subject === undefined && body.desk === undefined) {
    return ask({ desk: 'hebrew', subject: { kind: 'article', article_id: body.article_id }, question: body.question, parent: body.parent });
  }
  return ask({ desk: body.desk === undefined ? 'hebrew' : body.desk, subject: body.subject, question: body.question, parent: body.parent });
}

// POST /card/:key/ask, the desk's "Ask here": the hebrew desk on the card,
// an answer kept only with a cited link, saved as the card's answer layer
// pointing at its asks row. Answers { layer, ask_id, searches, state }.
async function askCard(key, { question } = {}) {
  deskStore.cardContent(key);
  const q = text(question);
  const out = await ask({ desk: 'hebrew', subject: { kind: 'card', key }, question }, {
    keepWithoutLink: false, what: grow.ASK_FAILED,
    alsoWrite: (row) => deskStore.answerLayer(key, { question: q, answer: row.answer, links: row.links, ask_id: row.id }),
  });
  return { layer: out.also, ask_id: out.id, searches: out.searches, state: 'ok' };
}

module.exports = { ask, askRoute, askCard, chainOf, KINDS, TURNS, FAILED };
