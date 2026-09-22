'use strict';
// The reader page: draws the article right-to-left, tints each word from the
// map, and opens the card on hover (desktop) or tap (phone).

const $ = (s) => document.querySelector(s);
const ARTICLE_ID = Number(new URLSearchParams(location.search).get('id'));
const DESKTOP = window.matchMedia('(min-width: 900px)');
const HOVER = window.matchMedia('(hover: hover) and (pointer: fine)');

let article = null;
let marks = {};          // surface -> { spot_id, status, hint }
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

function renderParagraph(text) {
  const p = document.createElement('p');
  let last = 0;
  for (const w of HebrewTokenize.words(text)) {
    if (w.start > last) p.append(document.createTextNode(text.slice(last, w.start)));
    const s = document.createElement('span');
    s.className = 'w';
    s.dataset.surface = w.surface;
    s.dataset.sentence = HebrewTokenize.sentenceAt(text, w.start);
    s.textContent = w.surface;
    p.append(s);
    spans.push(s);
    last = w.end;
  }
  if (last < text.length) p.append(document.createTextNode(text.slice(last)));
  return p;
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
    meta.append(document.createTextNode('pasted'));
  }
  meta.append(document.createTextNode(`· added ${when}`));
  $('#headline').textContent = article.title;
  const body = $('#body');
  body.innerHTML = '';
  spans = [];
  for (const para of article.text.split(/\n+/)) {
    if (para.trim()) body.append(renderParagraph(para));
  }
  const counter = document.createElement('span');
  counter.textContent = `· ${spans.length} words`;
  meta.append(counter);
  applyTints();
}

function applyTints() {
  for (const s of spans) {
    const m = marks[s.dataset.surface];
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
    const m = marks[surface];
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
  $('#body').addEventListener('click', (e) => {
    const s = e.target.closest('.w');
    if (s) open(s);
  });
  if (HOVER.matches) {
    $('#body').addEventListener('mouseover', (e) => {
      const s = e.target.closest('.w');
      if (!s) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => open(s), 350);
    });
    $('#body').addEventListener('mouseout', () => clearTimeout(hoverTimer));
  }
}

async function loadMarks() {
  const data = await api('GET', `/marks-for-article/${ARTICLE_ID}`);
  marks = data.surfaces || {};
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

window.Reader = { api, get article() { return article; }, get marks() { return marks; }, set marks(v) { marks = v; }, applyTints, loadMarks, spans: () => spans, DESKTOP, HOVER };
main();
