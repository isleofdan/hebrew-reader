'use strict';
// A card grows (session thirteen): "Ask here" and "Find more examples", the
// two layers that take a model call with OpenRouter's web search. Each runs
// only because Dan pressed it on that card; nothing here runs on its own.
// What comes back is saved through lib/desk.js, the one path for desk
// writes.
//
// An answer without a link is a failure: an answer on a card is kept only
// when the web search cited at least one page, and an example only when it
// carries its source's address and uses the card's word.

const db = require('./db');
const lookup = require('./lookup');
const refs = require('./references');
const desk = require('./desk');

const ASK_FAILED = 'The question could not be answered';
const FIND_FAILED = 'No examples could be found';

// Time limits from what each call writes: an answer of up to 900 tokens and
// five examples of up to 1,500, at about 50 tokens a second, plus up to three
// searches of about 8 seconds each, and room for a slow start.
const ASK = { maxTokens: 900, timeoutMs: 60000 };
const FIND = { maxTokens: 1500, timeoutMs: 90000 };
const SEARCH = { max_uses: 3, max_total_results: 15 };

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// The card as the model is told it: its entry, then its layers.
function context(key) {
  const c = desk.cardContent(key);
  const lines = [];
  if (c.kind === 'word') {
    const k = c.card;
    lines.push(`The word: ${k.lemma || k.surface}${k.surface && k.surface !== k.lemma ? ` (met as ${k.surface})` : ''}`);
    if (k.root) lines.push(`Root: ${k.root}`);
    if (k.binyan) lines.push(`Binyan: ${k.binyan}`);
    else if (k.pos) lines.push(`Part of speech: ${k.pos}`);
    if (k.meaning_en) lines.push(`Meaning: ${k.meaning_en}`);
    if (k.governs) lines.push(`Governs: ${k.governs}`);
    if (k.note) lines.push(`Card note: ${k.note}`);
    if (c.sentence) lines.push(`The sentence it was met in: ${c.sentence}`);
  } else {
    lines.push(`A note card: ${c.text || '(empty)'}`);
  }
  const layers = desk.layersOf(key).filter((l) => l.kind !== 'example' || l.kept);
  if (layers.length) {
    lines.push('', 'What the reader has added to this card, oldest first:');
    for (const l of layers) {
      if (l.kind === 'example') lines.push(`- an example kept: ${l.sentence} (${l.source_name})`);
      else if (l.kind === 'answer') lines.push(`- asked: ${l.question} — answered: ${l.answer}`);
      else if (l.kind === 'note') lines.push(`- a note: ${l.text}`);
      else if (l.kind === 'lookup') lines.push(`- looked up in ${l.label}`);
    }
  }
  return { c, text: lines.join('\n') };
}

// --- Ask here ------------------------------------------------------------------------

const ASK_SYSTEM = `You are a Hebrew reference desk for an advanced reader of Israeli news and business Hebrew, answering a question about one card from the reader's study desk.
Search the references before you answer; you may search only these sites: ${refs.REFERENCES.map((r) => `${r.label} (${r.domain}: ${r.hint})`).join('; ')}.
Answer briefly, in English (Hebrew words in Hebrew letters), in at most five short sentences, and base each claim on a page you found. Mark anything you are not sure of with "(not sure)" right after the claim; never present a guess as a fact.
Answer with ONE JSON object and nothing else: {"answer": "<the brief answer>"}
Answer {"error": "<one short reason>"} only when you will not answer at all: the question is not about Hebrew, or you decline it.`;

function searchTool(extra = {}) {
  return [{ type: 'openrouter:web_search', parameters: { ...SEARCH, ...extra } }];
}

// Every link the search leaned on, once each.
function linksFrom(citations) {
  const out = [];
  for (const c of citations || []) {
    if (!/^https?:\/\//i.test(c.url) || out.some((o) => o.url === c.url)) continue;
    const ref = refs.forUrl(c.url);
    out.push({ url: c.url, title: c.title || '', reference: ref ? ref.id : null, label: ref ? ref.label : hostOf(c.url) });
  }
  return out;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// { question } on a card -> the answer layer saved, or a refusal saying why.
async function ask(key, { question } = {}) {
  question = text(question);
  if (!question) throw new db.ReaderError(400, 'Type a question first.');
  if (question.length > desk.QUESTION_MAX) throw new db.ReaderError(400, `A question is at most ${desk.QUESTION_MAX} characters; this one has ${question.length}.`);
  const { text: about } = context(key);
  const info = {};
  const raw = await lookup.chat({
    system: ASK_SYSTEM, user: `The card:\n${about}\n\nQuestion: ${question}`,
    ...ASK, what: ASK_FAILED, textFallback: true, info,
    tools: searchTool({ allowed_domains: refs.DOMAINS }),
  });
  const answer = text(raw.answer) || text(raw.text);
  if (!answer) {
    const declined = text(raw.error);
    if (declined) throw new db.ReaderError(422, `${ASK_FAILED}: the model declined — ${declined}`);
    throw new db.ReaderError(502, `${ASK_FAILED}: the model gave no answer.`);
  }
  const links = linksFrom(info.citations);
  if (!links.length) {
    console.log(`card ${key}: answer refused, no link (${info.searches || 0} search(es))`);
    throw new db.ReaderError(422, `${ASK_FAILED} with a link to a reference, so it was not kept. Ask again, or look the word up yourself.`);
  }
  const layer = desk.answerLayer(key, { question, answer, links });
  return { layer, searches: info.searches || 0, state: 'ok' };
}

// --- Find more examples ------------------------------------------------------------

const KINDS = ['news', 'tv', 'blog', 'other'];

const FIND_SYSTEM = `You find real Hebrew sentences that use one word, for an advanced reader of Israeli news and business Hebrew.
Search Hebrew-language sources online — news sites, television or video transcripts, blogs, forums — and give up to five sentences that use the word (any form of it: conjugated, inflected, with a prefix such as ו, ש, ה, ב, ל).
Copy each sentence exactly as it appears on the page you found it on. Never write or change a sentence yourself, and never give a sentence without the address of the page it is on.
Answer with ONE JSON object and nothing else:
{"examples": [ {"sentence": "<the Hebrew sentence as found>", "source_name": "<the site or programme>", "source_kind": one of ${JSON.stringify(KINDS)}, "date": "<YYYY-MM-DD when the page gives it, else null>", "url": "<the page's address>"}, ... ]}
When you find none, answer {"examples": []}.`;

function dateOf(v) {
  const s = text(v);
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : null;
}

// The gate on each example the model gave: a source link, and the card's
// word in the sentence by the reader's own matching. Answers
// { ok: [example], refused: [{ sentence, url, why }] }.
function screen(list, c) {
  const ok = [], refused = [];
  for (const x of Array.isArray(list) ? list : []) {
    const sentence = text(x && x.sentence);
    const url = text(x && x.url);
    if (!sentence) continue;
    let good = false;
    try { good = /^https?:$/.test(new URL(url).protocol); } catch { good = false; }
    if (!good) { refused.push({ sentence, url, why: 'no source link' }); continue; }
    if (!desk.sentenceHasWord(sentence, c)) { refused.push({ sentence, url, why: 'the sentence does not use this word' }); continue; }
    const kind = KINDS.includes(text(x.source_kind).toLowerCase()) ? text(x.source_kind).toLowerCase() : 'other';
    ok.push({ sentence, url, source_name: text(x.source_name) || hostOf(url) || 'a web page', source_kind: kind, source_date: dateOf(x.date) });
  }
  return { ok, refused };
}

// Up to five examples found online, each saved as a layer, not yet kept.
async function findExamples(key) {
  const { c, text: about } = context(key);
  if (c.kind !== 'word') throw new db.ReaderError(400, 'Examples are found for a word card; this is a note card.');
  const word = c.card.lemma || c.card.surface;
  const info = {};
  const raw = await lookup.chat({
    system: FIND_SYSTEM, user: `The word: ${word}${c.card.surface && c.card.surface !== word ? ` (also met as ${c.card.surface})` : ''}\n\n${about}`,
    ...FIND, what: FIND_FAILED, info, tools: searchTool(),
  });
  if (!Array.isArray(raw.examples)) {
    const declined = text(raw.error);
    throw new db.ReaderError(declined ? 422 : 502, `${FIND_FAILED}: ${declined ? `the model declined — ${declined}` : 'the answer held no list of examples.'}`);
  }
  const { ok, refused } = screen(raw.examples, c);
  const added = desk.exampleLayers(key, ok);
  for (const r of refused) console.log(`card ${key}: example refused (${r.why}): ${r.sentence.slice(0, 60)}`);
  const all = desk.layersOf(key).filter((l) => l.kind === 'example');
  return { added, refused, already: ok.length - added.length, found: all.length, searches: info.searches || 0, state: added.length ? 'ok' : 'no data' };
}

module.exports = { ask, findExamples, screen, linksFrom, ASK_SYSTEM, FIND_SYSTEM, ASK, FIND, SEARCH };
