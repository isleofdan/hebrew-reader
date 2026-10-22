'use strict';
// Study (hebrew-study-one): a way into the library itself, beside the walks.
//   /study          today's daf (and this week's portion), "Continue" at the
//                   page last opened, then the Tanakh and the Talmud as
//                   Sefaria orders them; a book's row opens in place to its
//                   chapters, a tractate's to its pages (each daf once, with
//                   its a and b sides). ?book=<title> opens that book.
//   /study/<page>   one chapter or one side of a daf, every line in Hebrew
//                   and English, Previous and Next; tapping a line marks it,
//                   a second marks the run between, a marked one clears; the
//                   bar at the foot starts a walk at what is marked (or at
//                   the page) through /walks?ref=…, the Walks page's own door.
// The structure and the text come from the server, which has them from
// Sefaria. Nothing here calls a model, counts or badges anything. Opening a
// book's row or marking a line keeps what Dan touched at the same height.

const $ = (s) => document.querySelector(s);

// { ok, status, data }; signed out goes to the sign-in page
async function api(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
  return { ok: res.ok, status: res.status, data };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function link(text, href, cls) {
  const a = el('a', cls, text);
  a.href = href;
  return a;
}

const state = (text) => { $('#state').textContent = text || ''; };

// A page's address, as the server writes it (lib/library.js studyPath, after
// the sefaria.org rule in lib/references.js): "I Samuel 3" -> /study/I_Samuel.3
const pathOf = (title, place) => `/study/${encodeURIComponent(title.replace(/ /g, '_'))}.${place}`;

// Scroll so `node` sits at `top` on the screen (where Dan's finger was).
function keepAt(node, top) {
  const now = node.getBoundingClientRect().top;
  if (Math.abs(now - top) >= 0.5) window.scrollBy(0, now - top);
}

// --- /study --------------------------------------------------------------------------

async function contentsPage() {
  const wanted = new URLSearchParams(location.search).get('book');
  const [today, places, contents] = await Promise.all([api('/study/data/today'), api('/study/data/places'), api('/study/data/contents')]);
  state('');
  $('#doors').classList.remove('hidden');
  drawToday(today);
  drawPlaces(places);
  if (!contents.ok) { state(contents.data.error); return; }
  drawBooks($('#tanakh'), contents.data.tanakh.groups, 'Tanakh');
  drawBooks($('#talmud'), contents.data.talmud.groups, 'Talmud');
  $('#tanakh').classList.remove('hidden');
  $('#talmud').classList.remove('hidden');
  if (wanted) {
    const row = [...document.querySelectorAll('.study-book')].find((b) => b.dataset.title === wanted);
    if (row) { toggle(row); row.scrollIntoView({ block: 'start' }); }
  }
}

function door(node, label, text, href, outside) {
  node.textContent = '';
  node.append(el('span', 'study-door-label', `${label}: `));
  const a = link(text, href);
  if (outside) { a.target = '_blank'; a.rel = 'noopener'; }
  node.append(a);
  if (outside) node.append(el('span', 'study-door-note', ' (on sefaria.org)'));
  node.classList.remove('hidden');
}

function drawToday(r) {
  if (!r.ok) { $('#daf').textContent = `Today's daf could not be fetched: ${r.data.error}`; return; }
  const { daf, portion } = r.data;
  door($('#daf'), "Today's daf", daf.name, daf.study || daf.url, !daf.study);
  if (portion) door($('#portion'), "This week's portion", portion.name, portion.study || portion.url, !portion.study);
}

function drawPlaces(r) {
  if (!r.ok || !r.data.items.length) return;
  const [newest, ...rest] = r.data.items;
  door($('#continue'), 'Continue', newest.ref, newest.path);
  const others = rest.slice(0, 5);
  if (!others.length) return;
  const ul = $('#others-list');
  for (const p of others) { const li = el('li'); li.append(link(p.ref, p.path)); ul.append(li); }
  $('#others').classList.remove('hidden');
}

function drawBooks(section, groups, corpus) {
  for (const g of groups) {
    const part = el('div', 'study-group');
    part.append(el('h3', 'study-group-name', g.name));
    const ul = el('ul', 'study-book-list');
    for (const b of g.books) {
      const li = el('li');
      const row = el('button', 'study-book');
      row.type = 'button';
      row.dataset.title = b.title;
      row.setAttribute('aria-expanded', 'false');
      const he = el('span', 'study-book-he', b.he); he.lang = 'he'; he.dir = 'rtl';
      row.append(el('span', 'study-book-title', b.title), he,
        el('span', 'study-book-size', corpus === 'Tanakh' ? `${b.chapters} ${b.chapters === 1 ? 'chapter' : 'chapters'}` : `${b.first} – ${b.last}`));
      row.book = { ...b, corpus };
      row.addEventListener('click', () => toggle(row));
      const fold = el('div', 'study-fold hidden');
      li.append(row, fold);
      ul.append(li);
    }
    part.append(ul);
    section.append(part);
  }
}

// A book's row opens (or closes) its fold in place; the row stays where it was.
function toggle(row) {
  const top = row.getBoundingClientRect().top;
  const fold = row.nextElementSibling;
  if (!fold.children.length) fold.append(row.book.corpus === 'Tanakh' ? chapters(row.book) : pages(row.book));
  const open = fold.classList.contains('hidden');
  fold.classList.toggle('hidden', !open);
  row.setAttribute('aria-expanded', String(open));
  keepAt(row, top);
}

function chapters(b) {
  const grid = el('div', 'study-grid');
  for (let n = 1; n <= b.chapters; n++) grid.append(link(String(n), pathOf(b.title, n), 'study-cell'));
  return grid;
}

// Each daf once, with its a and b sides; a side with no text is left blank.
function pages(b) {
  const grid = el('div', 'study-dafs');
  const firstDaf = parseInt(b.first, 10), lastDaf = parseInt(b.last, 10);
  const at = (d, s) => (d - 1) * 2 + (s === 'b' ? 1 : 0);
  const from = at(firstDaf, b.first.slice(-1)), to = at(lastDaf, b.last.slice(-1));
  for (let d = firstDaf; d <= lastDaf; d++) {
    const cell = el('div', 'study-daf');
    cell.append(el('span', 'study-daf-n', String(d)));
    for (const s of ['a', 'b']) {
      const i = at(d, s);
      if (i < from || i > to || b.missing.includes(`${d}${s}`)) cell.append(el('span', 'study-cell study-side none'));
      else {
        const a = link(s, pathOf(b.title, `${d}${s}`), 'study-cell study-side');
        a.setAttribute('aria-label', `${b.title} ${d}${s}`);
        cell.append(a);
      }
    }
    grid.append(cell);
  }
  return grid;
}

// --- /study/<page> --------------------------------------------------------------------

let page = null;   // the page as the server gave it
let marked = null; // { from, to }: line indexes, or null

async function textPage(address) {
  const r = await api(`/study/data/page/${address}`);
  $('#text').classList.remove('hidden');
  if (!r.ok) {
    state(r.data.error);
    for (const n of document.querySelectorAll('.study-turn, #title')) n.classList.add('hidden');
    return;
  }
  state('');
  page = r.data;
  document.title = `Hebrew reader · ${page.title}`;
  $('#title-en').textContent = page.title;
  $('#title-he').textContent = page.he_title;
  $('#back').href = page.contents;
  for (const a of document.querySelectorAll('[data-turn]')) {
    const to = page[a.dataset.turn];
    if (to) { a.href = to.path; a.title = to.ref; } else { a.removeAttribute('href'); a.classList.add('off'); a.setAttribute('aria-disabled', 'true'); }
  }
  const ol = $('#lines');
  page.lines.forEach((line, i) => {
    const li = el('li', 'study-line');
    li.dataset.i = i;
    li.tabIndex = 0;
    li.append(el('span', 'study-line-n', line.ref.split(':').pop()));
    const he = el('div', 'study-he', line.he); he.lang = 'he'; he.dir = 'rtl';
    const en = el('div', 'study-en', line.en); en.lang = 'en';
    li.append(he, en);
    li.addEventListener('click', () => mark(i));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mark(i); } });
    ol.append(li);
  });
  $('#bar').classList.remove('hidden');
  document.body.classList.add('study-reading');
  drawMarks();
}

// A tap marks a line; a second, the run between them; a marked line clears.
function mark(i) {
  if (marked && i >= marked.from && i <= marked.to) marked = null;
  else if (marked && marked.from === marked.to) marked = { from: Math.min(marked.from, i), to: Math.max(marked.from, i) };
  else marked = { from: i, to: i };
  drawMarks();
}

// What is marked, as Sefaria names it: "Berakhot 2a:3", "Berakhot 2a:3-5",
// or the page when nothing is.
function markedRef() {
  if (!marked) return page.ref;
  const a = page.lines[marked.from].ref, b = page.lines[marked.to].ref;
  return a === b ? a : `${a}-${b.split(':').pop()}`;
}

function drawMarks() {
  for (const li of document.querySelectorAll('.study-line')) {
    const i = Number(li.dataset.i);
    const on = Boolean(marked) && i >= marked.from && i <= marked.to;
    li.classList.toggle('marked', on);
    li.setAttribute('aria-pressed', String(on));
  }
  const ref = markedRef();
  $('#walk-here').href = `/walks?ref=${encodeURIComponent(ref)}`;
  $('#bar-where').textContent = ref.replace('-', '–');
}

// --- which page ----------------------------------------------------------------------

const m = /^\/study\/(.+)$/.exec(location.pathname);
(m ? textPage(m[1]) : contentsPage()).catch((e) => state(e.message));
