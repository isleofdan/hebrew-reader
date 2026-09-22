'use strict';
// A lesson sheet made from recent reading: every spot touched two or more
// times across the N most recent articles, Nif'al first, then the other
// binyanim, then non-verbs. Served as Markdown (a download) and as data for
// the print page. Nothing qualifies -> one line saying so.

const db = require('./db');
const demand = require('./demand');

const DEFAULT_ARTICLES = 5;
const MAX_ARTICLES = 50;
const MIN_TOUCHES = 2;

function articleCount(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_ARTICLES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ARTICLES) {
    throw new db.ReaderError(400, `articles must be a whole number from 1 to ${MAX_ARTICLES}; got ${JSON.stringify(raw)}.`);
  }
  return n;
}

function groupOf(spot) {
  if (spot.kind !== 'verb') return 2;
  return spot.binyan === 'nifal' ? 0 : 1;
}

const GROUP_TITLES = ["Nif'al", 'Other binyanim', 'Not verbs'];

function dateOf(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// { articles: [{id,title,added_at}], groups: [{title, items}], state }
function build(rawN) {
  const n = articleCount(rawN);
  const articles = db.recentArticles(n);
  const ids = articles.map((a) => a.id);
  const items = [];
  for (const row of db.touchesAcross(ids)) {
    if (row.touches < MIN_TOUCHES) continue;
    const spot = db.getSpot(row.spot_id);
    if (!spot) continue;
    const surfaces = row.surfaces.split('\n').filter(Boolean);
    let sentence = null, sentenceArticle = null, card = null;
    for (const s of surfaces) {
      for (const a of articles) {
        const found = demand.findSurface(a.text, s);
        if (found) { sentence = found.sentence; sentenceArticle = a.title; break; }
      }
      if (!card) card = db.cardForSurface(s, spot.id, null);
      if (sentence && card) break;
    }
    items.push({
      spot_id: spot.id, kind: spot.kind, group: groupOf(spot),
      surfaces, root: spot.root, binyan: spot.binyan, lemma: spot.lemma,
      binyan_label: spot.binyan ? (db.BINYAN_NAMES[spot.binyan] || spot.binyan) : null,
      meaning_en: card ? card.meaning_en : null, governs: card ? card.governs : null,
      sentence, sentence_article: sentenceArticle,
      status: spot.status, touches: row.touches,
    });
  }
  items.sort((a, b) => a.group - b.group || (a.binyan || '').localeCompare(b.binyan || '') || b.touches - a.touches || a.spot_id.localeCompare(b.spot_id));
  const groups = GROUP_TITLES.map((title, g) => ({ title, items: items.filter((i) => i.group === g) })).filter((g) => g.items.length);
  return {
    articles: articles.map((a) => ({ id: a.id, title: a.title, added_at: a.added_at, date: dateOf(a.added_at) })),
    asked_for: n,
    min_touches: MIN_TOUCHES,
    groups,
    count: items.length,
    state: items.length ? 'ok' : 'no data',
    made_at: new Date().toISOString(),
  };
}

function markdown(sheet) {
  const lines = [];
  const titles = sheet.articles.map((a) => `“${a.title}” (${a.date})`).join(', ');
  lines.push(`# Lesson sheet — from ${sheet.articles.length} recent article${sheet.articles.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push(sheet.articles.length ? `Articles: ${titles}.` : 'Articles: none stored yet.');
  lines.push('');
  if (!sheet.count) {
    lines.push(`Nothing qualifies: no word was touched ${sheet.min_touches} or more times across these articles.`);
    return lines.join('\n') + '\n';
  }
  lines.push(`Words touched ${sheet.min_touches} or more times, Nif'al first.`);
  for (const g of sheet.groups) {
    lines.push('');
    lines.push(`## ${g.title}`);
    for (const i of g.items) {
      lines.push('');
      lines.push(`### ${i.surfaces.join(' · ')}`);
      const bits = [];
      if (i.lemma) bits.push(`lemma ${i.lemma}`);
      if (i.root) bits.push(`root ${i.root}`);
      if (i.binyan_label) bits.push(i.binyan_label);
      if (i.governs) bits.push(`governs ${i.governs}`);
      lines.push(`- ${bits.join(' · ')}`);
      lines.push(`- meaning: ${i.meaning_en || '(no card on record)'}`);
      lines.push(`- seen in: ${i.sentence ? `${i.sentence}` : '(no sentence on record)'}${i.sentence_article ? ` — ${i.sentence_article}` : ''}`);
      lines.push(`- status: ${i.status} · touches: ${i.touches}`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { build, markdown, articleCount, DEFAULT_ARTICLES, MAX_ARTICLES, MIN_TOUCHES };
