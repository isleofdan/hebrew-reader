'use strict';
// The lesson page: every item of one lesson from Guy, each word tappable
// exactly as in the reader (same tint, same card, a touch recorded against
// the lesson), then the study guide built from Dan's שיעורי גיא instructions.
// The guide is built on first open, in the background; this page asks for
// its state until it is there, then draws it. A guide that could not be
// built leaves the items and one line saying why.

const $ = (s) => document.querySelector(s);
const LESSON_ID = Number(new URLSearchParams(location.search).get('id'));
const DESKTOP = window.matchMedia('(min-width: 900px)');
const HOVER = window.matchMedia('(hover: hover) and (pointer: fine)');
const POLL_MS = 3000;

let lesson = null;
let marks = {};
let spans = [];

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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function he(tag, text, cls) { const e = el(tag, cls ? `he ${cls}` : 'he', text); e.dir = 'rtl'; return e; }
function auto(tag, text, cls) { const e = el(tag, cls, text); e.dir = 'auto'; return e; }

function dateOf(iso) {
  return new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// --- the items: words as in the reader ---------------------------------------

// Every word of `text` as its own span, with the sentence it stands in; the
// reader's routine, so a lesson word carries the same markup, tint and card.
function fillWords(node, text) {
  let last = 0;
  for (const w of HebrewTokenize.words(text)) {
    if (w.start > last) node.append(document.createTextNode(text.slice(last, w.start)));
    const s = el('span', 'w', w.surface);
    s.dataset.surface = w.surface;
    s.dataset.sentence = HebrewTokenize.sentenceAt(text, w.start);
    node.append(s);
    spans.push(s);
    last = w.end;
  }
  if (last < text.length) node.append(document.createTextNode(text.slice(last)));
  return node;
}

function drawHead() {
  document.title = `${lesson.title} — Hebrew reader`;
  $('#title').textContent = lesson.title;
  const meta = $('#meta');
  meta.innerHTML = '';
  meta.append(el('span', '', lesson.lesson_date ? dateOf(lesson.lesson_date) : ''), el('span', '', `· ${lesson.items.length} items`), el('span', '', `· ${lesson.source_name}`));
}

function drawItems() {
  spans = [];
  const list = $('#items');
  list.innerHTML = '';
  for (const item of lesson.items) {
    const li = el('li');
    li.dir = 'rtl';
    list.append(fillWords(li, item));
  }
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
    const row = el('div');
    row.append(el('span', 'he', surface), el('span', 'hint', m.hint || m.status));
    row.addEventListener('click', () => { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); open(s); });
    list.append(row);
  }
  $('#side-empty').classList.toggle('hidden', seen.size > 0);
}

function open(span) {
  for (const s of spans) s.classList.remove('active');
  span.classList.add('active');
  if (typeof window.showCard === 'function') window.showCard(span);
}

function wireWords() {
  let hoverTimer = null;
  const box = $('#items');
  box.addEventListener('click', (e) => { const s = e.target.closest('.w'); if (s) open(s); });
  if (!HOVER.matches) return;
  box.addEventListener('mouseover', (e) => {
    const s = e.target.closest('.w');
    if (!s) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => open(s), 350);
  });
  box.addEventListener('mouseout', () => clearTimeout(hoverTimer));
}

async function loadMarks() {
  const data = await api('GET', `/marks-for-lesson/${LESSON_ID}`);
  marks = data.surfaces || {};
  applyTints();
}

// --- the study guide ---------------------------------------------------------

function drawGuide(guide) {
  const box = $('#guide');
  box.innerHTML = '';
  window.GuideUI.render(box, guide);
  const d = guide.dropped || {};
  const left = [];
  if (d.cards) left.push(`${d.cards} card${d.cards === 1 ? '' : 's'}`);
  if (d.vocabulary) left.push(`${d.vocabulary} vocabulary row${d.vocabulary === 1 ? '' : 's'}`);
  if (d.expressions) left.push(`${d.expressions} expression${d.expressions === 1 ? '' : 's'}`);
  const notes = [];
  if (left.length) notes.push(`Left out as not in the lesson: ${left.join(', ')}.`);
  if (d.over_cap) notes.push(`${d.over_cap} card${d.over_cap === 1 ? '' : 's'} over the 35-card cap left out.`);
  if (guide.built_with === 'fallback') notes.push('Built with the fallback model.');
  notes.push(`Built ${new Date(guide.built_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`);
  box.append(el('p', 'caption', notes.join(' ')));
  drawReview(box, guide.review);
  $('#links').classList.remove('hidden');
  const n = guide.cards.length;
  const cards = $('#cards-link');
  cards.textContent = `Flashcards (${n})`;
  cards.href = `/cards.html?lesson=${LESSON_ID}`;
  cards.classList.toggle('hidden', !n);
  const sheet = $('#sheet-link');
  sheet.href = `/sheet.html?lesson=${LESSON_ID}`;
  sheet.classList.remove('hidden');
}

// The review pass under the guide: its corrections behind one tap, and what
// it tried to add, refused. A review that did not run says why in one line.
function drawReview(box, rv) {
  if (!rv) return;
  if (rv.state === 'not run') { box.append(el('p', 'caption review-line', `Not reviewed: ${rv.reason}`)); return; }
  const n = rv.changes.length;
  const d = el('details', 'review');
  d.append(el('summary', '', rv.state === 'applied'
    ? `Reviewed: ${n} correction${n === 1 ? '' : 's'}`
    : `Reviewed, not applied: ${n} correction${n === 1 ? '' : 's'} proposed`));
  if (rv.state === 'discarded') d.append(el('p', 'caption', rv.reason));
  if (n) { const ol = el('ol', 'review-changes'); for (const c of rv.changes) ol.append(auto('li', c)); d.append(ol); }
  else d.append(el('p', 'caption', 'The review found nothing to correct.'));
  if (rv.refused.length) d.append(el('p', 'caption', `Refused as additions: ${rv.refused.join(', ')}.`));
  box.append(d);
}

// The footer: what the lesson put on the map, and the spine outcome in the
// card footer's own wording.
function drawSaved(v) {
  const line = $('#saved-line');
  if (v.saving) { line.textContent = "Saving the lesson's words to your map…"; return; }
  const s = v.saved;
  if (!s) { line.textContent = ''; return; }
  const bits = [`${s.words} word${s.words === 1 ? '' : 's'} saved`, `${s.phrases} phrase${s.phrases === 1 ? '' : 's'} kept in the guide only`];
  if (s.touched) bits.push(`${s.touched} already on your map, touched`);
  if (s.failed.length) bits.push(`${s.failed.length} could not be looked up (${s.failed.map((f) => f.surface).join(', ')})`);
  const outcome = ['unreachable', 'not configured', 'recorded'].find((o) => s.spine[o]);
  if (outcome) bits.push(window.CardUI.spineLine(outcome));
  line.textContent = bits.join(' · ');
}

let pollTimer = null;

// Draws whatever state the guide is in, and asks again while it is building.
function showGuideState(v) {
  lesson = v;
  clearTimeout(pollTimer);
  const msg = $('#guide-msg');
  msg.className = 'msg';
  const rebuild = $('#rebuild');
  rebuild.disabled = v.guide_state === 'building';
  if (v.guide) drawGuide(v.guide);
  if (v.guide_state === 'building') {
    msg.textContent = v.guide
      ? 'Rebuilding the study guide… the one below is replaced when the new one is done.'
      : "Building the study guide from Guy's lesson and your instructions… this takes a minute or two.";
    pollTimer = setTimeout(refresh, POLL_MS);
  } else if (v.guide_state === 'failed') {
    msg.className = 'msg error';
    msg.textContent = `${v.guide_error} The items above still open their cards.`;
    $('#links').classList.remove('hidden');
    $('#cards-link').classList.add('hidden');
    $('#sheet-link').classList.add('hidden');
    rebuild.textContent = 'Try again';
  } else if (v.guide_error) {
    msg.className = 'msg error';
    msg.textContent = `The rebuild did not finish: ${v.guide_error} The guide below is the previous one.`;
  } else {
    msg.textContent = '';
    rebuild.textContent = 'Rebuild guide';
  }
  drawSaved(v);
  if (v.saving && v.guide_state !== 'building') pollTimer = setTimeout(refresh, POLL_MS);
}

// Asks the server for the guide's state. A missed answer (the phone dropped
// its connection, the server restarting) does not stop the asking: the page
// says so and tries again. A build the server no longer knows about (it
// restarted mid-build) is started again.
async function refresh() {
  let v;
  try {
    v = await api('GET', `/lessons/${LESSON_ID}`);
  } catch (e) {
    if (e.status) { $('#guide-msg').className = 'msg error'; $('#guide-msg').textContent = e.message; return; }
    $('#guide-msg').className = 'msg';
    $('#guide-msg').textContent = 'Lost touch with the server for a moment; trying again…';
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, POLL_MS);
    return;
  }
  if (v.guide_state === 'none') { await build(false); return; }
  showGuideState(v);
  if (v.guide_state !== 'building' && !v.saving) await loadMarks().catch(() => {});
}

async function build(rebuild) {
  try {
    showGuideState(await api('POST', `/lessons/${LESSON_ID}/guide`, { rebuild }));
  } catch (e) {
    if (!e.status) {
      $('#guide-msg').className = 'msg';
      $('#guide-msg').textContent = 'Lost touch with the server for a moment; trying again…';
      clearTimeout(pollTimer);
      pollTimer = setTimeout(refresh, POLL_MS);
      return;
    }
    $('#guide-msg').className = 'msg error';
    $('#guide-msg').textContent = e.message;
  }
}

async function main() {
  if (!LESSON_ID) { $('#page-msg').textContent = 'No lesson chosen. Go back to the list and pick one.'; return; }
  let v;
  try {
    v = await api('GET', `/lessons/${LESSON_ID}`);
  } catch (e) {
    $('#page-msg').className = 'msg error';
    $('#page-msg').textContent = e.message;
    return;
  }
  lesson = v;
  drawHead();
  drawItems();
  wireWords();
  $('#rebuild').addEventListener('click', () => build(true));
  await loadMarks();
  if (v.guide_state === 'none') await build(false);
  else showGuideState(v);
}

window.Reader = {
  api, DESKTOP, HOVER, applyTints, loadMarks,
  get marks() { return marks; }, set marks(v) { marks = v; },
  get article() { return null; },
  source: () => ({ lesson_id: LESSON_ID }),
  spans: () => spans,
};
main();
