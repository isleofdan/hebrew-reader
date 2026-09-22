'use strict';
// The reader page: draws the article right-to-left, tints each word from the
// map, and opens the card on hover (desktop) or tap (phone). The headline is
// drawn the same way as the body, so its words tint, open a card and record
// a touch exactly as the body's do.

const $ = (s) => document.querySelector(s);
const ARTICLE_ID = Number(new URLSearchParams(location.search).get('id'));
const DESKTOP = window.matchMedia('(min-width: 900px)');
const HOVER = window.matchMedia('(hover: hover) and (pointer: fine)');

let article = null;
let marks = {};          // surface -> { spot_id, status, hint }
let lemmas = {};         // lemma -> { spot_id, status, hint }, for prefixed forms
let spans = [];          // every word span on the page

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'accept': 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
  if (!res.ok) throw Object.assign(new Error(data.error || `The server answered ${res.status}.`), { status: res.status });
  return data;
}

function host(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } }

// --- drawing ------------------------------------------------------------------

// Every word of `text` as its own span inside `el`, with the sentence it
// stands in. The headline and each paragraph go through here, so a headline
// word carries the same markup, the same tint and the same card as a body
// word, and its sentence is the headline.
function fillWords(el, text) {
  let last = 0;
  for (const w of HebrewTokenize.words(text)) {
    if (w.start > last) el.append(document.createTextNode(text.slice(last, w.start)));
    const s = document.createElement('span');
    s.className = 'w';
    s.dataset.surface = w.surface;
    s.dataset.sentence = HebrewTokenize.sentenceAt(text, w.start);
    s.textContent = w.surface;
    el.append(s);
    spans.push(s);
    last = w.end;
  }
  if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  return el;
}

// "Delete" in the meta line; the confirm is the bar under it.
function deleteButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'linklike';
  b.id = 'delete';
  b.textContent = 'Delete';
  window.DeleteUI.wire({ button: b, bar: $('#delete-bar'), what: 'article', path: () => `/articles/${ARTICLE_ID}` });
  return b;
}

function draw() {
  document.title = `${article.title} — Hebrew reader`;
  const meta = $('#meta');
  meta.innerHTML = '';
  const when = new Date(article.added_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (article.source_url) {
    const a = document.createElement('a'); a.href = article.source_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = host(article.source_url);
    meta.append(a);
  } else {
    const s = document.createElement('span'); s.textContent = 'pasted'; meta.append(s);
  }
  const added = document.createElement('span'); added.textContent = `· added ${when}`; meta.append(added);
  spans = [];
  const headline = $('#headline');
  headline.innerHTML = '';
  fillWords(headline, article.title);
  const body = $('#body');
  body.innerHTML = '';
  for (const para of article.text.split(/\n+/)) {
    if (para.trim()) body.append(fillWords(document.createElement('p'), para));
  }
  const counter = document.createElement('span');
  counter.textContent = `· ${spans.length} words`;
  meta.append(counter);
  meta.append(deleteButton());
  applyTints();
}

function applyTints() {
  for (const s of spans) {
    const m = HebrewTokenize.markFor(s.dataset.surface, marks, lemmas);
    s.classList.remove('shaky', 'new');
    if (m && (m.status === 'shaky' || m.status === 'new')) s.classList.add(m.status);
  }
  drawSideList();
}

function drawSideList() {
  const list = $('#side-list');
  list.innerHTML = '';
  const seen = new Set();
  for (const s of spans) {
    const surface = s.dataset.surface;
    const m = HebrewTokenize.markFor(surface, marks, lemmas);
    if (!m || m.status === 'solid' || seen.has(surface)) continue;
    seen.add(surface);
    const row = document.createElement('div');
    const he = document.createElement('span'); he.className = 'he'; he.textContent = surface;
    const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = m.hint || m.status;
    row.append(he, hint);
    row.addEventListener('click', () => { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); open(s); });
    list.append(row);
  }
  $('#side-empty').classList.toggle('hidden', seen.size > 0);
}

// --- the card (filled in by the lookup step) --------------------------------

function open(span) {
  for (const s of spans) s.classList.remove('active');
  span.classList.add('active');
  if (typeof window.showCard === 'function') window.showCard(span);
}

function wireWords() {
  let hoverTimer = null;
  for (const el of [$('#headline'), $('#body')]) {
    el.addEventListener('click', (e) => {
      const s = e.target.closest('.w');
      if (s) open(s);
    });
    if (!HOVER.matches) continue;
    el.addEventListener('mouseover', (e) => {
      const s = e.target.closest('.w');
      if (!s) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => open(s), 350);
    });
    el.addEventListener('mouseout', () => clearTimeout(hoverTimer));
  }
}

async function loadMarks() {
  const data = await api('GET', `/marks-for-article/${ARTICLE_ID}`);
  marks = data.surfaces || {};
  lemmas = data.lemmas || {};
  applyTints();
}

async function main() {
  if (!ARTICLE_ID) { $('#page-msg').textContent = 'No article chosen. Go back to the list and pick one.'; return; }
  try {
    article = await api('GET', `/articles/${ARTICLE_ID}`);
  } catch (e) {
    $('#page-msg').className = 'msg error';
    $('#page-msg').textContent = e.message;
    return;
  }
  draw();
  wireWords();
  await loadMarks();
}

window.Reader = { api, get article() { return article; }, get marks() { return marks; }, set marks(v) { marks = v; }, get lemmas() { return lemmas; }, applyTints, loadMarks, spans: () => spans, DESKTOP, HOVER };
main();
