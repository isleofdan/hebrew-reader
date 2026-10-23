'use strict';
// The Look up page (hebrew-lookup-one): one box for a word; on Enter, the
// word's card (the reader's own, drawn by card-ui.js), saved as Dan's word
// and the search recorded on it; under it the seven references as tabs, each
// opening inside the page only when tapped (pull only) and recorded as a
// lookup on the card.

const $ = (s) => document.querySelector(s);
const UI = window.CardUI;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'accept': 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

const cardEl = $('#card-lookup');
const pane = $('#pane');
const tabs = $('#tabs');
let current = null; // { card, spot, sentence, key, references }
let searching = 0;

UI.wire(cardEl, {
  onStatus: (status) => UI.saveStatus(cardEl, api, current, status).then(() => drawSaved()),
  getCurrent: () => current,
  onSetVerb: async ({ root, binyan }) => {
    const data = await api('POST', '/lookup/confirm', { surface: current.card.surface, sentence: current.sentence, root, binyan });
    current.card = data.card; current.spot = data.spot;
    return data;
  },
  onPut: () => api('POST', '/desks/put', { card_id: current.card_id }),
  api,
});

// "Saved to your words." — or what the word already was.
function drawSaved(saved) {
  const line = $('#saved-line');
  const s = current && current.spot;
  if (!s) { line.textContent = 'This word has no entry to save (the card names no dictionary form).'; return; }
  if (saved && !saved.already) line.textContent = 'Saved to your words.';
  else line.textContent = s.status === 'solid' ? 'In your words, marked solid.' : 'In your words.';
}

// At phone width the tabs stand as a list and a tab's pane opens under it;
// on a computer they are one row and the pane opens under the row.
const narrow = window.matchMedia('(max-width: 699px)');

// The tabs are drawn once per word; the pane may sit among them (phone).
function drawTabs() {
  closePane();
  tabs.innerHTML = '';
  for (const r of current.references) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small ref';
    b.dataset.ref = r.id;
    b.textContent = r.label;
    b.addEventListener('click', () => openTab(r, b));
    tabs.append(b);
  }
  markTabs();
}

// the open reference's tab is marked
function markTabs() {
  for (const b of tabs.querySelectorAll('button.ref')) {
    const on = pane.dataset.ref === b.dataset.ref;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function closePane() {
  tabs.after(pane);
  pane.innerHTML = ''; pane.className = 'ref-pane hidden'; delete pane.dataset.ref; delete pane.dataset.mode;
}

function openTab(r, button) {
  const at = current;
  if (narrow.matches) button.after(pane); else tabs.after(pane);
  window.ReferenceUI.open(pane, { api, reference: r.id, term: r.term, label: r.label, onClose: () => { tabs.after(pane); markTabs(); } });
  markTabs();
  // recorded as a lookup on the card, from the Look up page
  api('POST', `/card/${at.key}/lookup`, { reference: r.id, origin: 'lookup' })
    .then(() => { markOpened(at.key, r.id); if (current === at) { current.lookups += 1; drawCount(); } })
    .catch((e) => { if (current === at) $('#search-msg').textContent = `The lookup was not recorded: ${e.message}`; });
}

// How many times this card was looked up: this search, each tab opened, and
// the lookups made from its "Look up in" row on the desk.
function drawCount() {
  const n = current ? current.lookups : 0;
  $('#looked-line').textContent = n ? `Looked up ${n === 1 ? 'once' : `${n} times`}, here and on the desk.` : '';
}

// hebrew-english-one: text with Latin letters is an English look-up (the
// server decides and refuses what the box does not take; this only picks
// what the page shows while it runs).
const LATIN = /\p{Script=Latin}/u;

async function search(ev) {
  if (ev) ev.preventDefault();
  const word = $('#word').value.trim();
  const msg = $('#search-msg');
  msg.className = 'msg';
  if (!word) { msg.className = 'msg error'; msg.textContent = 'Type a word first.'; return; }
  if (LATIN.test(word)) return searchEnglish(word);
  hideEnglish();
  return lookUp(word);
}

// A Hebrew word looked up, as typed — or tapped in an English look-up's list,
// which then stays above the card, folded to one line.
async function lookUp(word) {
  const msg = $('#search-msg');
  msg.className = 'msg';
  const seq = ++searching;
  msg.textContent = 'looking up…';
  $('#go').disabled = true;
  $('#entry').classList.remove('hidden');
  UI.setLoading(cardEl, word);
  $('#saved-line').textContent = '';
  $('#looked-line').textContent = '';
  closePane();
  tabs.innerHTML = '';
  try {
    const data = await api('POST', '/lookup', { surface: word, sentence: '', origin: 'lookup' });
    if (seq !== searching) return;
    // the ask pane's tabs are recorded on the card as this page's own tabs are (desk_key, origin lookup)
    current = { card: data.card, spot: data.spot, sentence: data.sentence || '', key: data.key, card_id: data.card_id, references: data.references, lookups: data.lookups, desk_key: data.key, lookup_origin: 'lookup' };
    msg.textContent = '';
    UI.fill(cardEl, data);
    UI.addPoints(cardEl, data, { api, sentence: current.sentence, isCurrent: () => current && current.key === data.key });
    drawSaved(data.saved);
    drawCount();
    drawTabs();
    document.dispatchEvent(new CustomEvent('looked-up', { detail: data }));
  } catch (e) {
    if (seq !== searching) return;
    current = null;
    msg.textContent = '';
    UI.setError(cardEl, word, e.message);
  } finally {
    if (seq === searching) $('#go').disabled = false;
  }
}

$('#search').addEventListener('submit', search);

// --- an English look-up: "Hebrew words for <text>" ----------------------------------------
// The groups as the server sends them (Yours, From Pealim, From Wiktionary,
// and the model's only when no dictionary had a word). Tapping a Hebrew word
// looks it up as a Hebrew word: its card, saved, its tabs, under the list
// folded to one line, "Hebrew words for <text> · Back to the list". The
// tapped row and the folded line each keep Dan's place on the screen.

const en = { box: $('#english'), list: $('#en-list'), fold: $('#en-fold'), groups: $('#en-groups'), pane: $('#en-pane'), spacer: $('#en-spacer'), tail: $('#en-tail') };
let shownEnglish = null; // the answer drawn
let tapped = null; // the bare word of the row tapped

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

// Scroll so `node` sits at `top` on the screen, where Dan's finger was. When
// the page cannot scroll that far (at its top, or its foot), room is made
// above the list or below the page so it still can.
function keepAt(node, top) {
  let now = node.getBoundingClientRect().top;
  if (Math.abs(now - top) >= 0.5) window.scrollBy(0, now - top);
  now = node.getBoundingClientRect().top;
  if (now < top - 0.5) en.spacer.style.height = `${en.spacer.offsetHeight + (top - now)}px`;
  else if (now > top + 0.5) { en.tail.style.height = `${en.tail.offsetHeight + (now - top)}px`; window.scrollBy(0, now - top); }
}
function resetPlace() { en.spacer.style.height = '0px'; en.tail.style.height = '0px'; }

function closeEnPane() {
  en.box.append(en.pane);
  en.pane.innerHTML = ''; en.pane.className = 'ref-pane hidden'; delete en.pane.dataset.ref; delete en.pane.dataset.word; delete en.pane.dataset.mode;
}

function hideEnglish() {
  closeEnPane();
  resetPlace();
  en.box.classList.add('hidden');
  shownEnglish = null; tapped = null;
}

async function searchEnglish(text) {
  const msg = $('#search-msg');
  const seq = ++searching;
  msg.textContent = 'looking up…';
  $('#go').disabled = true;
  try {
    const data = await api('POST', '/lookup', { surface: text, sentence: '', origin: 'lookup' });
    if (seq !== searching) return;
    msg.textContent = '';
    drawEnglish(data);
    document.dispatchEvent(new CustomEvent('looked-up', { detail: data }));
  } catch (e) {
    if (seq !== searching) return;
    msg.className = 'msg error'; msg.textContent = e.message;
  } finally {
    if (seq === searching) $('#go').disabled = false;
  }
}

function drawEnglish(data) {
  // the Hebrew card, if one was open, goes
  current = null;
  closePane(); tabs.innerHTML = '';
  $('#entry').classList.add('hidden');
  closeEnPane();
  resetPlace();
  shownEnglish = data; tapped = null;
  en.box.classList.remove('hidden');
  en.list.classList.remove('hidden');
  en.fold.classList.add('hidden');
  $('#en-text').textContent = data.text;
  en.fold.querySelector('.en-fold-title').textContent = `Hebrew words for ${data.text}`;
  const n = data.groups.reduce((k, g) => k + g.rows.length, 0);
  $('#en-msg').textContent = n ? '' : `No Hebrew word was found for “${data.text}”.`;
  en.groups.innerHTML = '';
  for (const g of data.groups) {
    if (g.id === 'yours' && !g.rows.length) continue; // none of Dan's words: nothing to say
    const sec = el('section', `en-group en-${g.id}`);
    sec.dataset.group = g.id;
    sec.append(el('h3', 'en-heading', g.heading));
    if (g.message) sec.append(el('p', `en-note${g.state === 'failed' ? ' bad' : ''}`, g.message));
    if (g.rows.length) {
      const ol = el('ol', 'en-rows');
      let sense = null;
      for (const r of g.rows) {
        if (g.id === 'wiktionary' && r.sense && r.sense !== sense) { sense = r.sense; ol.append(el('li', 'en-sense', sense)); }
        ol.append(enRow(r));
      }
      sec.append(ol);
    }
    en.groups.append(sec);
  }
}

function enRow(r) {
  const li = el('li', 'en-row');
  li.dataset.word = r.word;
  const b = el('button', 'en-word');
  b.type = 'button';
  const he = el('span', 'he', r.he); he.dir = 'rtl'; he.lang = 'he';
  b.append(he);
  b.title = `Look up ${r.word}`;
  b.addEventListener('click', () => tapWord(r, b));
  const info = el('div', 'en-info');
  if (r.translit) info.append(el('span', 'en-translit', r.translit));
  if (r.pos) info.append(el('span', 'en-pos', r.pos));
  info.append(el('span', 'en-meaning', r.meaning));
  const src = el('div', 'en-sources');
  for (const s of r.sources) {
    if (s.id === 'yours') { src.append(el('span', 'en-src yours', r.status ? `Yours · ${r.status}` : 'Yours')); continue; }
    const sb = el('button', `en-src ${s.id}`, s.label);
    sb.type = 'button';
    sb.title = `Open ${s.label} here`;
    sb.addEventListener('click', () => openSource(r, s, li));
    src.append(sb);
  }
  li.append(b, info, src);
  return li;
}

// A row's Pealim or Wiktionary label: the entry opened inside the page,
// under the row, as the tabs open (Pealim as a copy, Wiktionary framed).
function openSource(r, s, li) {
  if (en.pane.dataset.ref === s.id && en.pane.dataset.word === r.word) { closeEnPane(); return; }
  li.append(en.pane);
  const request = s.id === 'pealim' ? `/english/entry?site=pealim&path=${encodeURIComponent(s.path)}` : `/english/entry?site=wiktionary&page=${encodeURIComponent(s.page)}`;
  window.ReferenceUI.open(en.pane, { api, reference: s.id, term: s.id === 'pealim' ? r.he : s.page, label: s.label, request, onClose: closeEnPane });
  en.pane.dataset.word = r.word;
}

// Tapping a Hebrew word: the list folds to one line where the word was,
// and the word is looked up as a Hebrew word under it.
function tapWord(r, button) {
  const top = button.getBoundingClientRect().top;
  tapped = r.word;
  closeEnPane();
  en.list.classList.add('hidden');
  en.fold.classList.remove('hidden');
  keepAt(en.fold, top);
  return lookUp(r.word);
}

// "Back to the list": the list unfolds with the tapped row where the line was.
en.fold.addEventListener('click', () => {
  const top = en.fold.getBoundingClientRect().top;
  resetPlace();
  en.fold.classList.add('hidden');
  en.list.classList.remove('hidden');
  const row = tapped && [...en.groups.querySelectorAll('li.en-row')].find((li) => li.dataset.word === tapped);
  const button = row ? row.querySelector('.en-word') : en.list;
  keepAt(button, top);
  if (row) button.focus({ preventScroll: true });
});

// An English look-up reopened from "Looked up": its kept answer, no site asked.
async function reopenEnglish(text) {
  const msg = $('#search-msg');
  msg.className = 'msg';
  const seq = ++searching;
  try {
    const data = await api('GET', `/english?text=${encodeURIComponent(text)}`);
    if (seq !== searching) return;
    $('#word').value = data.text;
    msg.textContent = '';
    drawEnglish(data);
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (seq === searching) { msg.className = 'msg error'; msg.textContent = e.message; }
  }
}

// --- "Looked up": every word looked up here, newest first ------------------------
// 200 at a time, "Show more" for the next 200, so every word stays reachable.

const list = $('#looked-list');
const ticked = new Set();
let next = null, nextKey = null;
const shown = new Map(); // card key -> its item in the list, as drawn

const ORDER = ['morfix', 'pealim', 'wiktionary', 'milog', 'academy', 'kizur', 'sefaria'];
function metaLine(item) {
  return item.day + (item.opened.length ? ` · opened ${item.opened.map((o) => o.label).join(', ')}` : '');
}

// A tab's lookup was recorded: the word's row says so at once, in the
// references' order; ticks and the rows already loaded stay as they are.
// (a tab tapped while the list is being read again is kept until its row is drawn)
const opening = new Map(); // card key -> [{ id, label }] recorded on this page
function markOpened(key, id) {
  const ref = (current && current.key === key ? current.references : []).find((r) => r.id === id);
  const o = { id, label: ref ? ref.label : id };
  opening.set(key, [...(opening.get(key) || []), o]);
  const item = shown.get(key);
  if (!item) return;
  addOpened(item, [o]);
  const li = list.querySelector(`li[data-key="${key}"] .meta`);
  if (li) li.textContent = metaLine(item);
}
function addOpened(item, more) {
  for (const o of more) if (!item.opened.some((x) => x.id === o.id)) item.opened = [...item.opened, o];
  item.opened.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

function row(item) {
  if (item.kind === 'english') return englishRow(item);
  const li = document.createElement('li');
  li.dataset.key = item.key;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = ticked.has(item.key);
  box.setAttribute('aria-label', `Tick ${item.word}`);
  box.addEventListener('change', () => { if (box.checked) ticked.add(item.key); else ticked.delete(item.key); drawPut(); });
  const word = document.createElement('button');
  word.type = 'button'; word.className = 'linklike looked-word';
  const he = document.createElement('span'); he.className = 'he'; he.dir = 'rtl'; he.lang = 'he'; he.textContent = item.headword;
  word.append(he);
  word.title = `Look up ${item.word} again`;
  // the word looked up again, as typed in the box
  word.addEventListener('click', () => { $('#word').value = item.surface || item.word; search(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  const gloss = document.createElement('span'); gloss.className = 'gloss'; gloss.textContent = item.gloss;
  const meta = document.createElement('span'); meta.className = 'meta';
  addOpened(item, opening.get(item.key) || []);
  meta.textContent = metaLine(item);
  shown.set(item.key, item);
  li.append(box, word, gloss, meta);
  return li;
}

// An English look-up in "Looked up": the English text, "<n> Hebrew words",
// the day; tapping it reopens the list from the kept answer. It has no
// card, so no tick for "Put on a desk".
function englishRow(item) {
  const li = el('li', 'english');
  li.dataset.key = item.key;
  const word = el('button', 'linklike looked-word');
  word.type = 'button';
  word.append(el('span', 'en-text', item.text));
  word.title = `Hebrew words for ${item.text}`;
  word.addEventListener('click', () => reopenEnglish(item.text));
  const gloss = el('span', 'gloss', `${item.count} Hebrew word${item.count === 1 ? '' : 's'}`);
  const meta = el('span', 'meta', item.day);
  li.append(el('span', 'no-tick'), word, gloss, meta);
  return li;
}

async function loadList(more) {
  try {
    const got = await api('GET', `/lookups?limit=200${more && next ? `&before=${encodeURIComponent(next)}&before_key=${encodeURIComponent(nextKey)}` : ''}`);
    if (!more) shown.clear();
    if (!more) list.innerHTML = '';
    for (const item of got.items) list.append(row(item));
    next = got.next; nextKey = got.next_key;
    $('#more').hidden = !got.more;
    $('#looked-empty').classList.toggle('hidden', list.children.length > 0);
  } catch (e) {
    $('#put-msg').className = 'msg error'; $('#put-msg').textContent = `The list could not be read: ${e.message}`;
  }
}

function drawPut() {
  $('#put').disabled = ticked.size === 0;
  $('#put').textContent = ticked.size ? `Put on a desk (${ticked.size})` : 'Put on a desk';
}

// The ticked words onto the current desk, not yet placed — as a line caught
// on the phone lands (POST /desks/<id>/cards with unplaced). A word already
// on that desk is left where it is, and counted.
async function putOnDesk() {
  const msg = $('#put-msg');
  msg.className = 'msg'; msg.textContent = 'putting them on the desk…';
  $('#put').disabled = true;
  let put = 0, already = 0;
  const failedWords = [];
  try {
    const desk = (await api('GET', '/desks/current')).desk;
    for (const key of [...ticked]) {
      try {
        const out = await api('POST', `/desks/${desk.id}/cards`, { card: key, unplaced: true });
        if (out.already) already++; else put++;
        ticked.delete(key);
      } catch (e) { failedWords.push(e.message); }
    }
    msg.textContent = '';
    if (put || !already) {
      msg.append(document.createTextNode(`${put} card${put === 1 ? '' : 's'} put on tonight's desk, unplaced — `));
      const a = document.createElement('a'); a.href = '/desk'; a.textContent = 'place them at the desk'; msg.append(a);
    }
    if (already) msg.append(document.createTextNode(`${put || !already ? ' · ' : ''}${already} already there`));
    if (!put && already) { msg.append(document.createTextNode(' — ')); const a = document.createElement('a'); a.href = '/desk'; a.textContent = 'open the desk'; msg.append(a); }
    if (failedWords.length) { msg.className = 'msg error'; msg.append(document.createTextNode(` · not put: ${failedWords.join('; ')}`)); }
    for (const b of list.querySelectorAll('input[type=checkbox]')) b.checked = ticked.has(b.closest('li').dataset.key);
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = `Not put on the desk: ${e.message}`;
  }
  drawPut();
}

$('#put').addEventListener('click', putOnDesk);
$('#more').addEventListener('click', () => loadList(true));
document.addEventListener('looked-up', () => loadList(false));
loadList(false);

window.Lookup = { api, get current() { return current; } };
