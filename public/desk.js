'use strict';
// The desk: word cards and note cards laid out freely, moved, resized,
// grouped by placing them near each other; found again one card at a time
// or a whole desk as it was left. Every change is sent to the server as it
// happens (there is no Save button); this page keeps no copy of its own.
// At phone width the desk is a list, grouped by which card grew from which.

const $ = (s) => document.querySelector(s);
const UI = window.CardUI;
const Grow = window.GrowUI;
const LIST = window.matchMedia('(max-width: 699px)');
const MIN_W = 140, MIN_H = 90;

let desk = null;              // { id, name, ... }
let cards = new Map();        // key -> { data (as the server gave it), el }
let links = [];               // [{ child, parent, kind, sentence? }]
let topZ = 0;
let sheets = null;            // { count, last, line }: how often this desk went to the reMarkable
const Ink = window.InkUI;

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
function he(text, cls) { const s = el('span', cls ? `he ${cls}` : 'he', text); s.dir = 'rtl'; return s; }

// A quiet line under the strip: what did not save, or a put that did nothing.
let msgTimer = null;
function say(text, bad = false, stay = false) {
  const m = $('#desk-msg');
  m.textContent = text || '';
  m.classList.toggle('bad', bad);
  clearTimeout(msgTimer);
  if (text && !bad && !stay) msgTimer = setTimeout(() => { m.textContent = ''; }, 5000);
}
const notSaved = (e) => say(`Not saved: ${e.message}`, true);

// --- what a card shows ----------------------------------------------------------

const bare = (s) => String(s || '').replace(/[֑-ׇ]/g, '');

// A word card as the reader draws it, small: the pointed headword with the
// plain spelling beside it, the word as it stands in the text, root · binyan
// · meaning, and how it stands ("shaky · seen 4 times").
function wordFace(box, c) {
  box.innerHTML = '';
  const k = c.card;
  const word = k.lemma || k.surface;
  const pointed = k.pointed ? (k.lemma ? k.pointed.lemma : k.pointed.surface) : null;
  const head = el('div', 'dhead');
  head.append(he(pointed || word, 'pointed'));
  if (pointed) head.append(he(word, 'plain'));
  box.append(head);
  if (k.lemma && bare(k.lemma) !== bare(k.surface)) {
    const t = el('div', 'dintext', 'in the text ');
    t.append(he((k.pointed && k.pointed.surface) || k.surface, 'pointed'));
    box.append(t);
  }
  const line = el('div', 'dline');
  const bits = [];
  if (k.root) bits.push(he(k.root));
  if (k.binyan) bits.push(document.createTextNode(UI.BINYAN[k.binyan] || k.binyan));
  else if (k.pos) bits.push(document.createTextNode(k.pos));
  if (k.meaning_en) bits.push(document.createTextNode(k.meaning_en));
  bits.forEach((b, i) => { if (i) line.append(document.createTextNode(' · ')); line.append(b); });
  box.append(line);
  const st = el('div', 'dstatus');
  if (c.spot) {
    st.append(el('i', `dot ${c.spot.status}`));
    st.append(document.createTextNode(`${UI.STATUS_TEXT[c.spot.status] || c.spot.status} · ${UI.seen(c.spot.touches)}`));
  }
  box.append(st);
}

function noteFace(box, c) {
  box.innerHTML = '';
  const t = el('div', 'dnote-text', c.text || 'An empty note');
  t.dir = 'auto';
  if (!c.text) t.classList.add('empty-note');
  box.append(t);
  if (c.link && c.link.title) box.append(linkLine(c));
}

// A caught link's page title, under the note that holds the link.
function linkLine(c) {
  const d = el('div', 'note-link', '');
  const a = el('a', '', c.link.title);
  a.href = c.link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.dir = 'auto';
  a.addEventListener('click', (e) => e.stopPropagation());
  d.append(a);
  return d;
}

function face(box, c) { return c.kind === 'word' ? wordFace(box, c) : noteFace(box, c); }

// The name a card goes by in a line: the word as met, or the note's start.
function label(c) {
  if (c.kind === 'word') return c.card.surface || c.card.lemma;
  const t = (c.text || '').replace(/\s+/g, ' ').trim();
  return t.length > 30 ? t.slice(0, 29) + '…' : t || 'an empty note';
}

// --- drawing the desk -------------------------------------------------------------

function count(n) { return n === 0 ? 'no cards' : n === 1 ? '1 card' : `${n} cards`; }

// The cards that hang together: joined by a grey line or a link Dan drew.
// A group is two cards or more.
function groupCount() {
  const up = new Map([...cards.keys()].map((k) => [k, k]));
  const find = (k) => { while (up.get(k) !== k) k = up.get(k); return k; };
  for (const l of links) if (up.has(l.child) && up.has(l.parent)) up.set(find(l.child), find(l.parent));
  const size = new Map();
  for (const k of up.keys()) size.set(find(k), (size.get(find(k)) || 0) + 1);
  return [...size.values()].filter((n) => n > 1).length;
}

// The cards lying outside the part of the desk on screen now (computer).
function outOfView() {
  if (LIST.matches) return [];
  const top = Math.max(0, $('#surface').getBoundingClientRect().top);
  const out = [];
  for (const entry of cards.values()) {
    if (!entry.el || entry.data.place.x === null) continue;
    const r = entry.el.getBoundingClientRect();
    if (r.bottom <= top || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) out.push(entry.data.key);
  }
  return out;
}

function drawStrip() {
  const name = $('#desk-name');
  if (document.activeElement !== name) name.value = desk.name;
  const away = outOfView().length;
  $('#desk-count').textContent = `${LIST.matches ? '' : '· '}${count(cards.size)}${away ? ` (${away} out of view)` : ''}`;
  $('#bring-in').classList.toggle('hidden', !away);
  const g = groupCount();
  $('#desk-groups').textContent = g ? `· ${g === 1 ? '1 group' : `${g} groups`}` : '';
  $('#desk-sheets').textContent = sheets ? `· ${sheets.line}` : '';
  document.title = `${desk.name} — Desk`;
  $('#empty').classList.toggle('hidden', cards.size > 0);
}

// "bring every card into view": each card outside the part of the desk on
// screen moves to the next free spot inside it, saved as any move.
async function bringIn() {
  const away = new Set(outOfView());
  if (!away.size) return drawStrip();
  const plane = $('#plane').getBoundingClientRect();
  const top = Math.max(0, $('#surface').getBoundingClientRect().top);
  const findOpen = !$('#results').classList.contains('hidden') && !LIST.matches;
  const right = findOpen ? $('#results').getBoundingClientRect().left : window.innerWidth;
  const vis = { x0: Math.max(0, -plane.left), y0: Math.max(0, top - plane.top), x1: right - plane.left, y1: window.innerHeight - plane.top };
  const GAP = 16, STEP = 20;
  const taken = [...cards.values()].filter((e) => !away.has(e.data.key) && e.data.place.x !== null).map((e) => e.data.place);
  const hits = (r) => taken.some((t) => r.x < t.x + t.w + GAP && t.x < r.x + r.w + GAP && r.y < t.y + t.h + GAP && t.y < r.y + r.h + GAP);
  let n = 0;
  for (const key of away) {
    const entry = cards.get(key), p = entry.data.place;
    let spot = null;
    for (let y = vis.y0 + 24; !spot && y + p.h <= vis.y1; y += STEP) {
      for (let x = vis.x0 + 24; x + p.w <= vis.x1; x += STEP) { if (!hits({ x, y, w: p.w, h: p.h })) { spot = { x, y }; break; } }
    }
    // no free room on screen: laid a little apart, top left of the view
    if (!spot) { spot = { x: Math.round(vis.x0 + 24 + n * 24), y: Math.round(vis.y0 + 24 + n * 24) }; n++; }
    p.x = Math.round(spot.x); p.y = Math.round(spot.y);
    taken.push(p);
    position(entry);
    await patch(key, { x: p.x, y: p.y });
  }
  sizePlane();
  drawLines();
  drawStrip();
  say(away.size === 1 ? 'The card out of view is back in view.' : `The ${away.size} cards out of view are back in view.`);
}
$('#bring-in').addEventListener('click', bringIn);
let viewTimer = null;
const viewChanged = () => { clearTimeout(viewTimer); viewTimer = setTimeout(() => { if (desk) drawStrip(); }, 120); };
window.addEventListener('scroll', viewChanged, { passive: true });
$('#surface').addEventListener('scroll', viewChanged, { passive: true });

// --- the past desk in a corner ---------------------------------------------------------
// One past desk drawn small, with its name: the desk not opened for the
// longest time that holds a card, never the one open now. Nothing dismisses
// it; it changes as desks get opened. Not at phone width.
let pastSeq = 0;
async function drawPast() {
  const box = $('#past');
  const my = ++pastSeq;
  if (LIST.matches) { box.classList.add('hidden'); return; }
  let got;
  try { got = await api('GET', '/desks/past'); } catch { return; }
  if (my !== pastSeq) return;
  box.innerHTML = '';
  if (!got.desk) { box.classList.add('hidden'); return; }
  const d = got.desk;
  box.dataset.id = d.id;
  const pic = el('button', 'thumb-open');
  pic.type = 'button';
  pic.setAttribute('aria-label', `Open ${d.name}`);
  pic.append(thumb(d.shapes, 150, 92));
  pic.addEventListener('click', () => openDesk(d.id));
  const name = el('div', 'past-name', d.name);
  const row = el('div', 'past-row');
  row.append(el('span', 'result-meta', count(d.count)));
  const open = el('button', 'linklike', 'open');
  open.type = 'button';
  open.addEventListener('click', () => openDesk(d.id));
  row.append(open);
  box.append(pic, name, row);
  box.classList.remove('hidden');
}

function load(view) {
  desk = view.desk;
  links = view.links || [];
  sheets = view.sheets || null;
  cards = new Map();
  topZ = 0;
  for (const c of view.cards) {
    cards.set(c.key, { data: c, el: null });
    topZ = Math.max(topZ, c.place.z || 0);
  }
  draw();
  fillPoints();
  drawPast();
}

function draw() {
  drawStrip();
  const plane = $('#plane');
  for (const n of [...plane.querySelectorAll('.dcard')]) n.remove();
  $('#list').innerHTML = '';
  if (LIST.matches) return drawList();
  for (const entry of cards.values()) {
    entry.el = deskCard(entry.data);
    plane.append(entry.el);
  }
  placeUnplaced();
  sizePlane();
  drawLines();
  drawStrip();
}

function position(entry) {
  const p = entry.data.place, e = entry.el;
  e.style.left = `${p.x || 0}px`; e.style.top = `${p.y || 0}px`;
  e.style.width = `${p.w}px`; e.style.height = `${p.h}px`;
  e.style.zIndex = String(10 + (p.z || 0));
  e.classList.toggle('unplaced', p.x === null || p.y === null);
}

function deskCard(c) {
  const card = el('article', `dcard ${c.kind}`);
  card.dataset.key = c.key;
  const body = el('div', 'dface');
  if (c.kind === 'note') {
    card.append(el('div', 'dnote-bar', 'note'));
    const ta = el('textarea', 'dnote-edit');
    ta.dir = 'auto';
    ta.value = c.text || '';
    ta.placeholder = 'Type here — עברית or English';
    ta.setAttribute('aria-label', 'Note card text');
    ta.addEventListener('input', () => saveNoteSoon(c, ta.value));
    ta.addEventListener('blur', () => flushNote(c));
    body.append(ta);
    if (c.link && c.link.title) body.append(linkLine(c));
  } else {
    wordFace(body, c);
  }
  card.append(body);
  if (c.ink && c.ink.strokes.length) { const pic = Ink.picture(c.ink.strokes); pic.classList.add('dink'); card.append(pic); }
  const acts = el('div', 'dacts');
  const act = (text, fn) => { const b = el('button', 'linklike', text); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); acts.append(b); return b; };
  act('open', () => openFull(c.key));
  act('note on a new card', () => noteFrom(c.key));
  if (!LIST.matches) act('draw here', () => inkOn(c.key));
  act('remove from the desk', () => removeCard(c.key));
  card.append(acts);
  const grip = el('span', 'grip');
  grip.setAttribute('aria-hidden', 'true');
  card.append(grip);
  wireDrag(card, c.key);
  wireResize(grip, c.key);
  const entry = cards.get(c.key);
  entry.el = card;
  position(entry);
  return card;
}

// The plane is as large as the cards on it need, and never smaller than the view.
function sizePlane() {
  const s = $('#surface'), plane = $('#plane');
  let w = s.clientWidth, h = s.clientHeight;
  for (const { data: { place: p } } of cards.values()) {
    if (p.x === null) continue;
    w = Math.max(w, p.x + p.w + 120);
    h = Math.max(h, p.y + p.h + 160);
  }
  plane.style.width = `${w}px`; plane.style.height = `${h}px`;
  const svg = $('#lines');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
}

// Thin grey lines join a card to the cards made from it, behind the cards;
// a blue line joins two cards Dan linked himself, his sentence beside it.
function drawLines() {
  const svg = $('#lines');
  svg.innerHTML = '';
  for (const c of [...$('#plane').querySelectorAll('.link-caption')]) c.remove();
  for (const l of links) {
    const a = cards.get(l.parent), b = cards.get(l.child);
    if (!a || !b || a.data.place.x === null || b.data.place.x === null) continue;
    const pa = a.data.place, pb = b.data.place;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const ha = a.el && a.el.classList.contains('inking') ? a.el.offsetHeight : pa.h, hb = b.el && b.el.classList.contains('inking') ? b.el.offsetHeight : pb.h;
    const x1 = pa.x + pa.w / 2, y1 = pa.y + ha / 2, x2 = pb.x + pb.w / 2, y2 = pb.y + hb / 2;
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.dataset.child = l.child; line.dataset.parent = l.parent;
    if (l.kind === 'linked') {
      line.classList.add('dan-link');
      const cap = el('div', 'link-caption', `you linked these: ${l.sentence}`);
      cap.dataset.child = l.child; cap.dataset.parent = l.parent;
      // beside the part of the line that runs between the two cards
      const ra = { x: pa.x, y: pa.y, w: pa.w, h: ha }, rb = { x: pb.x, y: pb.y, w: pb.w, h: hb };
      const t0 = exitAt(x1, y1, x2, y2, ra), t1 = 1 - exitAt(x2, y2, x1, y1, rb);
      const tm = t1 > t0 ? (t0 + t1) / 2 : 0.5;
      cap.style.left = `${Math.round(x1 + (x2 - x1) * tm)}px`; cap.style.top = `${Math.round(y1 + (y2 - y1) * tm)}px`;
      $('#plane').append(cap);
    }
    svg.append(line);
  }
}

// Where a line from (x1, y1) inside rectangle r toward (x2, y2) leaves it,
// as a fraction of the line (0 at its start, 1 at its end).
function exitAt(x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1;
  let t = 1;
  if (dx > 0) t = Math.min(t, (r.x + r.w - x1) / dx); else if (dx < 0) t = Math.min(t, (r.x - x1) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - y1) / dy); else if (dy < 0) t = Math.min(t, (r.y - y1) / dy);
  return Math.max(0, t);
}

// A card typed on the phone is on the desk but not yet placed: here it
// takes the next free spot, which is saved.
async function placeUnplaced() {
  for (const entry of cards.values()) {
    if (entry.data.place.x !== null) continue;
    try {
      const got = await api('PATCH', `/desks/${desk.id}/cards/${entry.data.key}`, { free: true });
      entry.data.place = got.place;
      if (entry.el) position(entry);
    } catch (e) { notSaved(e); }
  }
  sizePlane();
  drawLines();
}

// --- moving, resizing, the stack ------------------------------------------------------

async function patch(key, body) {
  const entry = cards.get(key);
  try {
    const got = await api('PATCH', `/desks/${desk.id}/cards/${key}`, body);
    if (entry) { entry.data.place = got.place; topZ = Math.max(topZ, got.place.z); }
  } catch (e) { notSaved(e); }
}

// Clicked or picked up: the card comes to the front, and that is saved.
function toFront(key) {
  const entry = cards.get(key);
  if (!entry || entry.data.place.z >= topZ && [...cards.values()].filter((x) => x.data.place.z === topZ).length === 1) return;
  topZ += 1;
  entry.data.place.z = topZ;
  position(entry);
  patch(key, { front: true });
}

function wireDrag(card, key) {
  card.addEventListener('pointerdown', (e) => {
    if (linking) { e.preventDefault(); if (!e.target.closest('button, a')) pickForLink(key); return; }
    if (e.button !== 0 || e.target.closest('button, textarea, input, a, .grip, .ink-area')) return;
    const entry = cards.get(key);
    toFront(key);
    const start = { x: e.clientX, y: e.clientY, px: entry.data.place.x, py: entry.data.place.y };
    let moved = false;
    card.setPointerCapture(e.pointerId);
    card.classList.add('lifted');
    const onMove = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      entry.data.place.x = Math.max(0, Math.round(start.px + dx));
      entry.data.place.y = Math.max(0, Math.round(start.py + dy));
      position(entry);
      drawLines();
    };
    const onUp = () => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      card.classList.remove('lifted');
      if (moved) { sizePlane(); patch(key, { x: entry.data.place.x, y: entry.data.place.y }); }
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  });
}

function wireResize(grip, key) {
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const entry = cards.get(key);
    toFront(key);
    const start = { x: e.clientX, y: e.clientY, w: entry.data.place.w, h: entry.data.place.h };
    let moved = false;
    grip.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      moved = true;
      entry.data.place.w = Math.max(MIN_W, Math.round(start.w + ev.clientX - start.x));
      entry.data.place.h = Math.max(MIN_H, Math.round(start.h + ev.clientY - start.y));
      position(entry);
      drawLines();
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (moved) { sizePlane(); patch(key, { w: entry.data.place.w, h: entry.data.place.h }); }
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
}

// --- note cards -----------------------------------------------------------------

const noteTimers = new Map();
function saveNoteSoon(c, text) {
  c.text = text;
  clearTimeout(noteTimers.get(c.key));
  noteTimers.set(c.key, setTimeout(() => flushNote(c), 500));
}
async function flushNote(c) {
  if (!noteTimers.has(c.key)) return;
  clearTimeout(noteTimers.get(c.key));
  noteTimers.delete(c.key);
  try { await api('PATCH', `/notes/${c.key.split(':')[1]}`, { text: c.text }); } catch (e) { notSaved(e); }
}

function focusNote(key) {
  const entry = cards.get(key);
  if (!entry) return;
  if (LIST.matches) return openFull(key);
  const ta = entry.el && entry.el.querySelector('textarea');
  if (ta) { entry.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); ta.focus(); }
}

function added(out) {
  const c = { ...out.card, place: out.place };
  cards.set(c.key, { data: c, el: null });
  topZ = Math.max(topZ, c.place.z || 0);
  if (out.born_from) links.push({ child: c.key, parent: out.born_from, kind: 'born-from' });
  return c;
}

async function newCard() {
  try {
    const out = await api('POST', '/notes', { text: '', desk_id: desk.id, unplaced: LIST.matches });
    const c = added(out);
    draw();
    focusNote(c.key);
  } catch (e) { notSaved(e); }
}

// "note on a new card": a note born from this card, beside it, a line between.
async function noteFrom(key) {
  try {
    const out = await api('POST', '/notes', { text: '', desk_id: desk.id, born_from: key, unplaced: LIST.matches && !cards.get(key).data.place.x });
    const c = added(out);
    closeFull();
    draw();
    focusNote(c.key);
  } catch (e) { notSaved(e); }
}

async function removeCard(key) {
  try {
    await api('DELETE', `/desks/${desk.id}/cards/${key}`);
    cards.delete(key);
    closeFull();
    draw();
    say('Removed from the desk. The card itself is kept: Find finds it.');
  } catch (e) { notSaved(e); }
}

// --- nikud for a word card cached before cards carried it --------------------------

async function fillPoints() {
  for (const entry of cards.values()) {
    const c = entry.data;
    if (c.kind !== 'word' || !(c.points_missing || c.refresh_due)) continue;
    try {
      if (c.refresh_due) c.card = (await api('POST', '/lookup/refresh', { card_id: c.card_id })).card;
      else c.card.pointed = (await api('POST', '/lookup/points', { card_id: c.card_id })).pointed;
      delete c.points_missing; delete c.refresh_due;
      const box = entry.el && entry.el.querySelector('.dface');
      if (box) wordFace(box, c);
      else if (LIST.matches) draw();
    } catch (e) { /* the card stays unpointed; its full view says why */ }
  }
}

// --- the phone: a list, grouped by which card grew from which --------------------------

function order(a, b) {
  const pa = a.data.place, pb = b.data.place;
  const ua = pa.x === null, ub = pb.x === null;
  if (ua !== ub) return ua ? -1 : 1;           // not yet placed (typed here) first
  if (ua) return (pb.z || 0) - (pa.z || 0);    // the newest of those first
  return pa.y - pb.y || pa.x - pb.x;           // then as they lie, top to bottom
}

function drawList() {
  const list = $('#list');
  const parentOf = new Map(links.filter((l) => l.kind !== 'linked' && cards.has(l.parent) && cards.has(l.child)).map((l) => [l.child, l.parent]));
  const kids = (key) => [...cards.values()].filter((x) => parentOf.get(x.data.key) === key).sort(order);
  const item = (entry, depth, seen) => {
    const li = el('li', `ditem ${entry.data.kind}`);
    li.dataset.key = entry.data.key;
    li.style.setProperty('--depth', depth);
    const btn = el('button', 'ditem-open');
    btn.type = 'button';
    face(btn, entry.data);
    btn.addEventListener('click', () => openFull(entry.data.key));
    li.append(btn);
    list.append(li);
    for (const k of kids(entry.data.key)) if (!seen.has(k.data.key)) { seen.add(k.data.key); item(k, depth + 1, seen); }
  };
  const seen = new Set();
  for (const entry of [...cards.values()].filter((x) => !parentOf.has(x.data.key)).sort(order)) {
    seen.add(entry.data.key);
    item(entry, 0, seen);
  }
  for (const entry of cards.values()) if (!seen.has(entry.data.key)) item(entry, 0, seen);
}

// --- a card's full view ----------------------------------------------------------------

let fullKey = null;
let fullData = null;    // the card shown, whether or not it is on this desk
let fullCurrent = null; // { card, spot } for CardUI
// A card's full view: its entry as the reader's card (or the note's text),
// then its layers and actions (grow-ui.js). `data` is the card as the server
// gave it, for a card opened from Find that is not on this desk.
function openFull(key, data) {
  const entry = cards.get(key);
  const c = entry ? entry.data : data;
  if (!c) return;
  fullKey = key;
  fullData = c;
  document.body.classList.add('full-open');
  $('#full').classList.remove('hidden');
  $('#full-card').classList.toggle('hidden', c.kind !== 'word');
  $('#full-note').classList.toggle('hidden', c.kind !== 'note');
  const host = c.kind === 'word' ? $('#full-card') : $('#full-note');
  if (c.kind === 'word') {
    fullCurrent = { card: c.card, spot: c.spot ? { ...c.spot } : null };
    UI.fill($('#full-card'), { card: c.card, spot: fullCurrent.spot, cached: true });
    $('#full-card .foot').textContent = '';
    wireFullActions(c, Boolean(entry));
  } else {
    const ta = $('#full-note-text');
    ta.value = c.text || '';
    $('#full-note-foot').textContent = '';
    if (c.link && c.link.title) $('#full-note-foot').append(linkLine(c));
    $('#full-note-remove').classList.toggle('hidden', !entry);
    ta.focus();
  }
  const grow = $('#grow');
  host.append(grow);
  Grow.show(grow, key, {
    api, deskId: desk.id, phone: LIST.matches,
    onNewCard: grown,
    onChange: () => { fullChanged = true; },
  });
}
let fullChanged = false;

// A branch or a cut made a new card: the desk is read again and the new card
// shown beside the one it came from (on the phone, first in the list).
async function grown(out, how) {
  closeFull();
  try { load(await api('GET', `/desks/${desk.id}`)); } catch (e) { return notSaved(e); }
  const from = cards.get(out.owner);
  const what = how === 'cut' ? 'The cut-off layers are on a new card' : 'A new card';
  say(from ? `${what} beside ${label(from.data)}.` : LIST.matches ? `${what}, first in the list.` : `${what} on this desk.`);
  const made = cards.get(out.card.key);
  if (made && made.el) { made.el.classList.add('fresh'); made.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => made.el && made.el.classList.remove('fresh'), 2500); }
}

function wireFullActions(c, onDesk) {
  const acts = $('#full-card .actions');
  for (const b of acts.querySelectorAll('.desk-act')) b.remove();
  const mk = (text, fn) => { const b = el('button', 'btn desk-act', text); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); };
  if (onDesk) mk('Remove from the desk', () => removeCard(c.key));
}

function closeFull() {
  const entry = fullKey && cards.get(fullKey);
  if (entry && entry.data.kind === 'note') flushNote(entry.data);
  else if (fullData && fullData.kind === 'note') flushNote(fullData);
  fullKey = null;
  fullData = null;
  $('#full').classList.add('hidden');
  document.body.classList.remove('full-open');
  // ink drawn on the opened card shows on its desk card too
  if (fullChanged) { fullChanged = false; api('GET', `/desks/${desk.id}`).then((v) => { if (v.desk.id === desk.id && !fullKey) load(v); }).catch(() => {}); }
}

UI.wire($('#full-card'), {
  getCurrent: () => fullCurrent,
  onClose: closeFull,
  onStatus: async (status) => {
    const got = await UI.saveStatus($('#full-card'), api, fullCurrent, status);
    const entry = fullKey && cards.get(fullKey);
    if (got && entry) {
      entry.data.spot = { id: got.spot.id, status: got.spot.status, touches: got.spot.touches };
      // every other card of the same word shows the same status
      for (const other of cards.values()) if (other.data.spot && other.data.spot.id === got.spot.id) other.data.spot = { ...entry.data.spot };
      if (!LIST.matches) for (const other of cards.values()) { const box = other.el && other.data.kind === 'word' && other.el.querySelector('.dface'); if (box) wordFace(box, other.data); }
      else draw();
    }
  },
});
$('#full-note .close').addEventListener('click', closeFull);
$('#full-note-text').addEventListener('input', (e) => {
  const entry = cards.get(fullKey);
  const c = entry ? entry.data : fullData;
  if (!c) return;
  saveNoteSoon(c, e.target.value);
  const ta = entry && entry.el && entry.el.querySelector('textarea');
  if (ta) ta.value = e.target.value;
});
$('#full-note-remove').addEventListener('click', () => removeCard(fullKey));
$('#full').addEventListener('click', (e) => { if (e.target.id === 'full') { closeFull(); if (LIST.matches) draw(); } });
for (const b of document.querySelectorAll('#full .close')) b.addEventListener('click', () => { if (LIST.matches) draw(); });

// --- ink on a desk card ------------------------------------------------------------------------
// "draw here": the card opens an ink area under what it shows, the width of
// the card, growing as needed; each stroke is saved as it ends. "done" puts
// the card back to its size, the drawing shown small on it.
function inkOn(key) {
  const entry = cards.get(key);
  if (!entry || !entry.el) return;
  const card = entry.el;
  if (card.classList.contains('inking')) return;
  for (const other of document.querySelectorAll('.dcard.inking')) inkOff(other.dataset.key);
  card.classList.add('inking');
  const old = card.querySelector('.dink');
  if (old) old.remove();
  const c = entry.data;
  const holder = el('div', 'dink-edit');
  holder.append(Ink.area({
    strokes: c.ink ? c.ink.strokes : [],
    editable: true,
    onStroke: async (points) => { const got = await api('POST', `/card/${key}/ink`, { points }); c.ink = got.layer; drawLines(); },
    onUndo: async () => { const got = await api('DELETE', `/card/${key}/ink/last`); c.ink = got.layer; },
  }));
  const done = el('button', 'btn small', 'done');
  done.type = 'button';
  done.addEventListener('click', (e) => { e.stopPropagation(); inkOff(key); });
  holder.querySelector('.ink-acts').append(done);
  card.insertBefore(holder, card.querySelector('.dacts'));
  toFront(key);
  drawLines();
}

function inkOff(key) {
  const entry = cards.get(key);
  if (!entry || !entry.el) return;
  const card = entry.el;
  card.classList.remove('inking');
  const edit = card.querySelector('.dink-edit');
  if (edit) edit.remove();
  if (entry.data.ink && entry.data.ink.strokes.length) { const pic = Ink.picture(entry.data.ink.strokes); pic.classList.add('dink'); card.insertBefore(pic, card.querySelector('.dacts')); }
  drawLines();
}

// --- Dan's own link: "Link these" ------------------------------------------------------------
// The first card, then the second, then one sentence saying why: a blue line
// between them with the sentence beside it.
let linking = null;           // null, or { first, second }
function linkStep() {
  const bar = $('#link-bar');
  bar.classList.toggle('hidden', !linking);
  document.body.classList.toggle('linking', Boolean(linking));
  $('#link-these').classList.toggle('on', Boolean(linking));
  $('#link-these').setAttribute('aria-pressed', String(Boolean(linking)));
  for (const n of document.querySelectorAll('.dcard.picked')) n.classList.remove('picked');
  if (!linking) return;
  for (const k of [linking.first, linking.second]) { const e = k && cards.get(k); if (e && e.el) e.el.classList.add('picked'); }
  const name = (k) => label(cards.get(k).data);
  const ready = Boolean(linking.first && linking.second);
  $('#link-step').textContent = !linking.first ? 'Link these: choose the first card.'
    : !ready ? `Link these: ${name(linking.first)}, then choose the second card.`
    : `${name(linking.first)} and ${name(linking.second)}:`;
  $('#link-sentence').classList.toggle('hidden', !ready);
  $('#link-save').classList.toggle('hidden', !ready);
  if (ready) $('#link-sentence').focus();
}
function pickForLink(key) {
  if (!linking) return;
  if (!linking.first) linking.first = key;
  else if (key !== linking.first) linking.second = key;
  linkStep();
}
function stopLinking() { linking = null; $('#link-sentence').value = ''; linkStep(); }
$('#link-these').addEventListener('click', () => { if (linking) return stopLinking(); closeFull(); linking = { first: null, second: null }; linkStep(); });
$('#link-cancel').addEventListener('click', stopLinking);
$('#link-bar').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!linking || !linking.first || !linking.second) return;
  const sentence = $('#link-sentence').value.trim();
  if (!sentence) return say('Type one sentence saying why these go together.', true);
  try {
    await api('POST', `/card/${linking.first}/link`, { to: linking.second, sentence });
    stopLinking();
    load(await api('GET', `/desks/${desk.id}`));
    say('Linked. The blue line and your sentence stay while both cards are on this desk.');
  } catch (err) { notSaved(err); }
});

// --- the sheet for the reMarkable ---------------------------------------------------------------
$('#make-sheet').addEventListener('click', async () => {
  const b = $('#make-sheet');
  if (b.disabled) return;
  b.disabled = true;
  const was = b.textContent;
  b.textContent = 'Making the sheet…';
  say('Making the sheet from this desk, with writing prompts for each group… this can take half a minute.');
  try {
    const out = await api('POST', `/desks/${desk.id}/sheets`);
    sheets = out.sheets;
    drawStrip();
    location.href = `/desk/sheet/${out.sheet.id}`;
  } catch (e) { say(`The sheet was not made: ${e.message}`, true); }
  b.disabled = false;
  b.textContent = was;
});

// --- the desk's name, new desks, all desks -------------------------------------------------

$('#desk-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = desk.name; e.target.blur(); } });
$('#desk-name').addEventListener('change', async (e) => {
  try {
    desk = await api('PATCH', `/desks/${desk.id}`, { name: e.target.value });
    drawStrip();
  } catch (err) { e.target.value = desk.name; notSaved(err); }
});

$('#new-card').addEventListener('click', newCard);
$('#new-desk').addEventListener('click', async () => {
  try { load(await api('POST', '/desks')); hidePanels(); say('A new desk. The others are under "Desks".'); } catch (e) { notSaved(e); }
});

// A small drawing of a desk: its cards as rectangles where they lie, notes
// yellow; `shapes` as the server gives them ({ x, y, w, h, kind }).
function thumb(shapes, W = 176, H = 108) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'thumb');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const frame = document.createElementNS(NS, 'rect');
  frame.setAttribute('class', 'th-frame');
  frame.setAttribute('x', 0.5); frame.setAttribute('y', 0.5); frame.setAttribute('width', W - 1); frame.setAttribute('height', H - 1); frame.setAttribute('rx', 6);
  svg.append(frame);
  if (!shapes.length) return svg;
  const minX = Math.min(...shapes.map((s) => s.x)), minY = Math.min(...shapes.map((s) => s.y));
  const maxX = Math.max(...shapes.map((s) => s.x + s.w)), maxY = Math.max(...shapes.map((s) => s.y + s.h));
  const pad = 8;
  const k = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY), 0.25);
  for (const s of shapes) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('class', `th-${s.kind}`);
    r.setAttribute('x', (pad + (s.x - minX) * k).toFixed(2)); r.setAttribute('y', (pad + (s.y - minY) * k).toFixed(2));
    r.setAttribute('width', (s.w * k).toFixed(2)); r.setAttribute('height', (s.h * k).toFixed(2));
    r.setAttribute('rx', 2);
    svg.append(r);
  }
  return svg;
}

function hidePanels() {
  $('#desks-panel').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#show-desks').setAttribute('aria-expanded', 'false');
}

async function openDesk(id) {
  try { load(await api('POST', `/desks/${id}/open`)); hidePanels(); window.scrollTo(0, 0); } catch (e) { notSaved(e); }
}

async function showDesks() {
  const grid = $('#desks-grid');
  let got;
  try { got = await api('GET', '/desks'); } catch (e) { return say(`The desks could not be listed: ${e.message}`, true); }
  $('#results').classList.add('hidden');
  $('#desks-panel').classList.remove('hidden');
  $('#show-desks').setAttribute('aria-expanded', 'true');
  grid.innerHTML = '';
  for (const d of got.items) {
    const tile = el('div', 'desk-tile');
    tile.dataset.id = d.id;
    const pic = el('button', 'thumb-open');
    pic.type = 'button';
    pic.setAttribute('aria-label', `Open ${d.name}`);
    pic.append(thumb(d.shapes));
    pic.addEventListener('click', () => openDesk(d.id));
    const name = el('input', 'tile-name');
    name.type = 'text'; name.value = d.name; name.maxLength = 80;
    name.setAttribute('aria-label', 'Desk name');
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', async () => {
      try {
        const r = await api('PATCH', `/desks/${d.id}`, { name: name.value });
        name.value = r.name;
        if (desk.id === d.id) { desk = r; drawStrip(); }
      } catch (e) { name.value = d.name; notSaved(e); }
    });
    const meta = el('div', 'tile-meta', count(d.count));
    if (d.id === desk.id) meta.append(el('span', 'tile-here', ' · this desk'));
    tile.append(pic, name, meta);
    grid.append(tile);
  }
  if (!got.items.length) grid.append(el('p', 'empty', 'No desks yet.'));
}
$('#show-desks').addEventListener('click', () => ($('#desks-panel').classList.contains('hidden') ? showDesks() : hidePanels()));
$('#desks-close').addEventListener('click', hidePanels);

// --- Find --------------------------------------------------------------------------------

let findSeq = 0, findTimer = null;
// The chips under Find: where a card came from, and when.
const chipsState = { source: 'everything', time: 'any' };
const SOURCE_CHIPS = [['everything', 'everything'], ['guy', 'from Guy'], ['articles', 'from articles'], ['online', 'found online'], ['notes', 'my notes'], ['asked', 'asked']];
const TIME_CHIPS = [['month', 'this month'], ['year', String(new Date().getFullYear())], ['any', 'any time']];
function drawChips() {
  const box = $('#find-chips');
  box.innerHTML = '';
  const group = (list, name) => {
    const g = el('span', 'chip-group');
    for (const [id, text] of list) {
      const b = el('button', `chip pick${chipsState[name] === id ? ' on' : ''}`, text);
      b.type = 'button';
      b.dataset[name] = id;
      b.setAttribute('aria-pressed', String(chipsState[name] === id));
      b.addEventListener('click', () => { chipsState[name] = id; drawChips(); find($('#find').value); });
      g.append(b);
    }
    box.append(g);
  };
  group(SOURCE_CHIPS, 'source');
  group(TIME_CHIPS, 'time');
}
drawChips();

// A card from Find shown small: a word or note card as on the desk; an
// example or an answer by its text.
function resultFace(box, c) {
  if (c.kind === 'word' || c.kind === 'note') return face(box, c);
  box.innerHTML = '';
  const t = el('div', 'dnote-text', c.kind === 'example' ? c.sentence : c.question);
  t.dir = 'auto';
  box.append(t);
  if (c.kind === 'answer') { const a = el('div', 'result-answer', c.answer); a.dir = 'auto'; box.append(a); }
}

async function openFrom(key) {
  try { const v = await api('GET', `/card/${key}`); openFull(key, v.card); } catch (e) { say(`The card could not be opened: ${e.message}`, true); }
}

async function find(q) {
  const my = ++findSeq;
  if (!q.trim()) { $('#results').classList.add('hidden'); return; }
  let got;
  try { got = await api('GET', `/desks/find?q=${encodeURIComponent(q)}&source=${chipsState.source}&time=${chipsState.time}`); } catch (e) { if (my === findSeq) say(`Find did not run: ${e.message}`, true); return; }
  if (my !== findSeq) return;
  $('#desks-panel').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#results-line').textContent = got.state === 'no data'
    ? `Nothing found for "${q}".`
    : `${count(got.cards.length).replace('no cards', 'No cards')}, ${got.threads.length === 1 ? '1 thread' : `${got.threads.length} threads`} and ${got.desks.length === 1 ? '1 desk' : `${got.desks.length} desks`} for "${q}"${got.more ? ` (and ${got.more} more cards)` : ''}.`;
  const cl = $('#results-cards'), tl = $('#results-threads'), dl = $('#results-desks');
  cl.innerHTML = ''; tl.innerHTML = ''; dl.innerHTML = '';
  for (const c of got.cards) {
    const layer = c.owner !== c.key;
    const r = el('div', `result-card ${c.kind}${layer ? ' layer' : ''}`);
    r.dataset.key = c.key;
    if (!layer) {
      r.draggable = true;
      r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-desk-card', c.key); e.dataTransfer.effectAllowed = 'copy'; });
    }
    const f = el('div', 'dface result-open'); resultFace(f, c); r.append(f);
    f.tabIndex = 0; f.setAttribute('role', 'button'); f.setAttribute('aria-label', 'Open this card');
    f.addEventListener('click', () => openFrom(c.owner));
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFrom(c.owner); });
    r.append(el('div', 'result-meta origin', c.origin_line));
    const here = cards.has(c.owner) || (c.spot && [...cards.values()].some((x) => x.data.spot && x.data.spot.id === c.spot.id));
    const meta = el('div', 'result-meta', here ? 'on this desk' : c.desks.length ? `on ${c.desks.map((d) => d.name).join(', ')}` : 'on no desk');
    r.append(meta);
    if (!here) {
      const b = el('button', 'btn small', layer ? 'Put its card on this desk' : 'Put on this desk');
      b.type = 'button';
      b.addEventListener('click', () => putHere(c.owner));
      r.append(b);
    }
    cl.append(r);
  }
  if (!got.cards.length) cl.append(el('p', 'empty', 'No cards.'));
  for (const t of got.threads) {
    const r = el('button', 'result-thread');
    r.type = 'button';
    r.dataset.key = t.key;
    const line = el('div', 'thread-line');
    const [first, ...rest] = t.line.split(' → ');
    line.append(t.card.kind === 'word' ? he(t.label, 'thread-word') : el('span', 'thread-word', `“${t.label}”`));
    line.append(document.createTextNode(`: ${[first, ...rest].join(' → ')}`));
    r.append(line, el('div', 'result-meta', t.where));
    r.addEventListener('click', () => openFull(t.key, t.card));
    tl.append(r);
  }
  if (!got.threads.length) tl.append(el('p', 'empty', 'No threads.'));
  for (const d of got.desks) {
    const r = el('div', 'result-desk');
    r.dataset.id = d.id;
    const pic = el('button', 'thumb-open');
    pic.type = 'button';
    pic.setAttribute('aria-label', `Open ${d.name}`);
    pic.append(thumb(d.shapes));
    pic.addEventListener('click', () => openDesk(d.id));
    const txt = el('div', 'result-desk-text');
    txt.append(el('div', 'tile-name-text', d.name));
    // "holds להמר and 1 card from it": the word in its own direction, the rest in English
    const why = el('div', 'result-meta', '');
    why.append(document.createTextNode(d.by_name ? (d.reasons.length ? 'its name matches; holds ' : 'its name matches') : 'holds '));
    d.reasons.forEach((w, i) => {
      if (i) why.append(document.createTextNode('; '));
      const lab = w.card.startsWith('word:') ? he(w.label) : el('span', '', `“${w.label}”`);
      if (!w.card.startsWith('word:')) lab.dir = 'auto';
      why.append(lab);
      if (w.grown) why.append(document.createTextNode(` and ${w.grown === 1 ? '1 card' : `${w.grown} cards`} from it`));
    });
    why.append(document.createTextNode(` · ${count(d.count)}${d.id === desk.id ? ' · this desk' : ''}`));
    txt.append(why);
    const open = el('button', 'btn small', d.id === desk.id ? 'This desk' : 'Open');
    open.type = 'button';
    open.disabled = d.id === desk.id;
    open.addEventListener('click', () => openDesk(d.id));
    txt.append(open);
    r.append(pic, txt);
    dl.append(r);
  }
  if (!got.desks.length) dl.append(el('p', 'empty', 'No desks.'));
}
$('#find').addEventListener('input', (e) => { clearTimeout(findTimer); findTimer = setTimeout(() => find(e.target.value), 250); });
$('#find').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(findTimer); find(e.target.value); } if (e.key === 'Escape') { e.target.value = ''; hidePanels(); } });
$('#results-close').addEventListener('click', hidePanels);

// A card from Find onto this desk: a placement, never a copy.
async function putHere(key, at) {
  try {
    const got = await api('POST', `/desks/${desk.id}/cards`, { card: key, ...(at || {}), unplaced: LIST.matches && !at });
    if (got.already) return say('Already on this desk.');
    const view = await api('GET', `/desks/${desk.id}`);
    load(view);
    find($('#find').value);
    say(`Put on this desk: ${label(got.card)}.`);
  } catch (e) { notSaved(e); }
}
$('#surface').addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-desk-card')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
$('#surface').addEventListener('drop', (e) => {
  const key = e.dataTransfer.getData('text/x-desk-card');
  if (!key) return;
  e.preventDefault();
  const r = $('#plane').getBoundingClientRect();
  putHere(key, { x: Math.max(0, Math.round(e.clientX - r.left)), y: Math.max(0, Math.round(e.clientY - r.top)) });
});

// --- start ---------------------------------------------------------------------------------

LIST.addEventListener('change', () => { if (desk) { draw(); drawPast(); } });
window.addEventListener('resize', () => { if (desk && !LIST.matches) sizePlane(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && linking) return stopLinking();
  if (e.key === 'Escape' && fullKey) { closeFull(); if (LIST.matches) draw(); }
});

// Catching a card on the phone: what another app shared into the installed
// app arrives at /share; it is saved as a note on the desk worked on last,
// not yet placed, and the address goes back to /desk so a reload saves nothing twice.
const CAUGHT = "Saved to tonight's desk, unplaced. Put it somewhere when you're at the computer.";
async function catchShared() {
  if (location.pathname !== '/share') return null;
  const q = new URLSearchParams(location.search);
  const shared = { title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '' };
  history.replaceState(null, '', '/desk');
  try { return await api('POST', '/desks/catch', shared); } catch (e) { say(`Not saved: ${e.message}`, true); return null; }
}

(async function start() {
  const caught = await catchShared();
  try {
    load(await api('GET', '/desks/current'));
  } catch (e) {
    say(`The desk could not be opened: ${e.message}`, true);
    return;
  }
  if (caught) {
    say(CAUGHT, false, true); // it stays until the next thing is said
    const li = document.querySelector(`#list [data-key="${caught.card.key}"]`);
    if (li) li.classList.add('fresh');
  }
  const q = new URLSearchParams(location.search).get('find');
  if (q) { $('#find').value = q; find(q); }
})();

window.Desk = { get desk() { return desk; }, cards: () => cards, links: () => links, thumb, outOfView };
