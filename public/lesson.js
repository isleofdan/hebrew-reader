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

const HEADINGS = {
  topics: 'Lesson topics',
  drills: 'תרגילי הטיה — Conjugation Drills',
  paper: 'עבודה על נייר — Thinking on Paper',
  vocabulary: 'מילים מרכזיות — Core Vocabulary',
  questions: 'שאלות הבנה — Comprehension Questions',
  expressions: 'ביטויים חשובים — Key Expressions',
};
// The Thinking-on-Paper template's own opening line.
const PAPER_LEAD = 'Before working through the flashcards, spend 10-20 minutes on one or both of these prompts on the Remarkable. Generative sketching, not copying. Messy is fine.';

function section(kind, heading) {
  const s = el('section', `g-${kind}`);
  s.dataset.kind = kind;
  s.append(auto('h3', heading));
  return s;
}

function drawSection(sec) {
  if (sec.kind === 'topics') {
    const s = section('topics', HEADINGS.topics);
    const ul = el('ul', 'topics');
    for (const t of sec.items) ul.append(auto('li', t));
    s.append(ul);
    return s;
  }
  if (sec.kind === 'grammar') {
    const s = section('grammar', sec.topic || 'Grammar');
    if (sec.explanation) s.append(auto('p', sec.explanation, 'prose'));
    if (sec.examples.length) {
      const ul = el('ul', 'examples');
      for (const x of sec.examples) { const li = el('li'); li.append(he('div', x.he), auto('div', x.en, 'en')); ul.append(li); }
      s.append(ul);
    }
    if (sec.for_guy) { const g = el('div', 'for-guy'); g.append(el('div', 'label', 'For Guy'), auto('p', sec.for_guy, 'prose')); s.append(g); }
    return s;
  }
  if (sec.kind === 'drills') {
    const s = section('drills', HEADINGS.drills);
    for (const v of sec.verbs) {
      const box = el('div', 'drill');
      const head = el('div', 'drill-head');
      head.append(he('span', v.verb, 'drill-verb'), el('span', 'muted', [v.root && `root ${v.root}`, v.binyan].filter(Boolean).join(' · ')));
      box.append(head);
      if (v.why) box.append(auto('p', v.why, 'why'));
      if (v.table.length) {
        const t = el('div', 'conj');
        for (const tense of v.table) {
          const col = el('div', 'tense');
          col.append(el('div', 'label', tense.tense));
          const grid = el('dl', 'forms');
          for (const f of tense.forms) { grid.append(el('dt', '', f.person), he('dd', f.he)); }
          col.append(grid);
          t.append(col);
        }
        box.append(t);
      }
      if (v.deviations) box.append(auto('p', v.deviations, 'note'));
      if (v.paal_comparison) box.append(auto('p', v.paal_comparison, 'note'));
      if (v.exercises.length) {
        const ol = el('ol', 'exercises');
        for (const x of v.exercises) {
          const li = el('li');
          li.append(he('div', x.sentence, 'sentence'), auto('div', x.cue, 'cue'));
          const d = el('details');
          d.append(el('summary', '', 'Answer'), he('span', x.answer));
          li.append(d);
          ol.append(li);
        }
        box.append(ol);
      }
      s.append(box);
    }
    return s;
  }
  if (sec.kind === 'paper') {
    const s = section('paper', HEADINGS.paper);
    s.append(el('p', 'lead', PAPER_LEAD));
    sec.prompts.forEach((p, i) => {
      const box = el('div', 'paper-prompt');
      box.append(auto('div', `${i + 1}. ${[p.type, p.anchor].filter(Boolean).join(': ')}`, 'paper-title'), auto('p', p.prompt, 'prose'));
      if (p.categories.length) box.append(el('div', 'muted', `Register: ${p.categories.join(', ')}`));
      s.append(box);
    });
    return s;
  }
  if (sec.kind === 'vocabulary') {
    const s = section('vocabulary', HEADINGS.vocabulary);
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'vocab');
    const hr = el('tr');
    for (const h of ['Hebrew', 'English', 'Root', 'Binyan', 'Category']) hr.append(el('th', '', h));
    table.append(hr);
    for (const r of sec.rows) {
      const tr = el('tr');
      tr.append(he('td', r.he), auto('td', r.en), he('td', r.root), el('td', '', r.binyan), auto('td', r.category));
      table.append(tr);
    }
    wrap.append(table);
    s.append(wrap);
    return s;
  }
  if (sec.kind === 'questions') {
    const s = section('questions', HEADINGS.questions);
    const ol = el('ol', 'questions');
    ol.dir = 'rtl';
    for (const q of sec.items) ol.append(he('li', q));
    s.append(ol);
    return s;
  }
  if (sec.kind === 'expressions') {
    const s = section('expressions', HEADINGS.expressions);
    for (const x of sec.items) {
      const box = el('div', 'expression');
      const head = el('div', 'expr-head');
      head.append(he('span', x.he, 'expr-he'), auto('span', x.en, 'expr-en'));
      box.append(head);
      if (x.usage) box.append(auto('p', x.usage, 'prose'));
      if (x.flags) box.append(auto('p', x.flags, 'flags'));
      s.append(box);
    }
    return s;
  }
  return null;
}

function drawGuide(guide) {
  const box = $('#guide');
  box.innerHTML = '';
  for (const sec of guide.sections) { const s = drawSection(sec); if (s) box.append(s); }
  const d = guide.dropped || {};
  const left = [];
  if (d.cards) left.push(`${d.cards} card${d.cards === 1 ? '' : 's'}`);
  if (d.vocabulary) left.push(`${d.vocabulary} vocabulary row${d.vocabulary === 1 ? '' : 's'}`);
  if (d.expressions) left.push(`${d.expressions} expression${d.expressions === 1 ? '' : 's'}`);
  const notes = [];
  if (left.length) notes.push(`Left out as not in the lesson: ${left.join(', ')}.`);
  if (d.over_cap) notes.push(`${d.over_cap} card${d.over_cap === 1 ? '' : 's'} over the 35-card cap left out.`);
  notes.push(`Built ${new Date(guide.built_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`);
  box.append(el('p', 'caption', notes.join(' ')));
  $('#links').classList.remove('hidden');
  const n = guide.cards.length;
  const cards = $('#cards-link');
  cards.textContent = `Flashcards (${n})`;
  cards.href = `/cards.html?lesson=${LESSON_ID}`;
  cards.classList.toggle('hidden', !n);
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

async function refresh() {
  try {
    const v = await api('GET', `/lessons/${LESSON_ID}`);
    showGuideState(v);
    if (v.guide_state !== 'building' && !v.saving) await loadMarks();
  } catch (e) {
    $('#guide-msg').className = 'msg error';
    $('#guide-msg').textContent = e.message;
  }
}

async function build(rebuild) {
  try {
    showGuideState(await api('POST', `/lessons/${LESSON_ID}/guide`, { rebuild }));
  } catch (e) {
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
