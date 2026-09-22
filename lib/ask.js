'use strict';
// The ask surface: one question about Hebrew, one model call, a brief answer
// with anything unsure marked, and for each claim a search link into one of
// the references in lib/references.js. With an article, the piece's mapped
// words go into the question so "which Nif'al forms are in this piece" is
// answered from data.
//
// An answer is an answer whether or not anything came with it to link to:
// "no Nif'al form here" is data, not a failure. The failure line is only for
// the model being unreachable, timing out, declining, or answering nothing
// usable, and it says which.

const db = require('./db');
const lookup = require('./lookup');
const refs = require('./references');
const tok = require('../public/tokenize.js');
const { asRead } = require('./articles');

const MAX_QUESTION = 1000;

const SYSTEM = `You are a Hebrew reference desk for an advanced reader of Israeli news and business Hebrew.
Answer the question briefly, in English (Hebrew words in Hebrew letters), in at most five short sentences.
Mark anything you are not sure of with "(not sure)" right after the claim; never present a guess as a fact.
The reader checks your answer against these references: ${refs.REFERENCES.map((r) => `${r.id} (${r.label}: ${r.hint})`).join('; ')}.
Answer with ONE JSON object and nothing else:
{
  "answer": "<the brief answer>",
  "links": [ { "claim": "<one claim from the answer, a few words>", "reference": one of ${JSON.stringify(refs.IDS)}, "term": "<the Hebrew word, root letters or phrase to search for>" }, ... ]
}
Give one link per claim a reference could confirm, choosing the reference that would confirm it (verb forms: pealim; meanings: milog or morfix; usage and etymology: wiktionary; normative rulings: academy). When there is nothing to look up, "links" is [].
When the true answer is that there is none — no such form appears, nothing in the reader's list matches — that IS the answer: say so plainly in "answer" and give "links": []. Never call that an error.
Answer {"error": "<one short reason>"} only when you will not answer at all: the question is not about Hebrew, or you decline it.`;

const FAILED = 'The references could not be asked';

function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function articleContext(articleId) {
  const article = db.getArticle(articleId);
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
  return { article, lines };
}

// { question, article_id? } -> { answer, links: [{ claim, reference, label, term, url }], state }.
async function ask({ question, article_id }) {
  question = typeof question === 'string' ? question.trim() : '';
  if (!question) throw new db.ReaderError(400, 'question is required: one question about Hebrew, as text.');
  if (question.length > MAX_QUESTION) throw new db.ReaderError(400, `question is too long: at most ${MAX_QUESTION} characters.`);
  let user = `Question: ${question}`;
  let articleTitle = null;
  if (article_id !== undefined && article_id !== null && article_id !== '') {
    const id = Number(article_id);
    if (!Number.isInteger(id) || id <= 0) throw new db.ReaderError(400, 'article_id, when given, is the whole number id of an article.');
    const { article, lines } = articleContext(id);
    articleTitle = article.title;
    user += `\n\nThe reader is looking at the article "${article.title}". Its words on the reader's map (surface: root/lemma, binyan, status):\n${lines.length ? lines.join('\n') : '(none yet)'}`;
  }
  const raw = await lookup.chat({ system: SYSTEM, user, maxTokens: 700, what: FAILED, textFallback: true });
  // Anything the model said that reads as an answer is the answer: JSON with
  // an "answer", or plain text it sent instead of JSON. Only a reply with no
  // answer at all reaches the failure line, which names why.
  const answer = text(raw.answer) || text(raw.text);
  if (!answer) {
    const declined = text(raw.error);
    if (declined) throw new db.ReaderError(422, `${FAILED}: the model declined — ${declined}`);
    throw new db.ReaderError(502, `${FAILED}: the model gave no answer.`);
  }
  const links = [];
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    const ref = refs.byId(l && l.reference);
    const term = text(l && l.term);
    if (!ref || !term) continue;
    links.push({ claim: text(l && l.claim), reference: ref.id, label: ref.label, term, url: ref.url(term) });
  }
  console.log(`ask: "${question.slice(0, 60)}"${articleTitle ? ` on "${articleTitle}"` : ''} -> ${links.length} link(s)`);
  return { answer, links, references: refs.REFERENCES.map((r) => ({ id: r.id, label: r.label })), state: 'ok', links_state: links.length ? 'ok' : 'no data' };
}

module.exports = { ask, SYSTEM };
