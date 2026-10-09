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
    .then(() => { if (current === at) { current.lookups += 1; drawCount(); } })
    .catch((e) => { if (current === at) $('#search-msg').textContent = `The lookup was not recorded: ${e.message}`; });
}

// How many times this card was looked up: this search, each tab opened, and
// the lookups made from its "Look up in" row on the desk.
function drawCount() {
  const n = current ? current.lookups : 0;
  $('#looked-line').textContent = n ? `Looked up ${n === 1 ? 'once' : `${n} times`}, here and on the desk.` : '';
}

async function search(ev) {
  if (ev) ev.preventDefault();
  const word = $('#word').value.trim();
  const msg = $('#search-msg');
  msg.className = 'msg';
  if (!word) { msg.className = 'msg error'; msg.textContent = 'Type a word first.'; return; }
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
    current = { card: data.card, spot: data.spot, sentence: data.sentence || '', key: data.key, card_id: data.card_id, references: data.references, lookups: data.lookups };
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

// --- "Looked up": every word looked up here, newest first ------------------------
// 200 at a time, "Show more" for the next 200, so every word stays reachable.

const list = $('#looked-list');
const ticked = new Set();
let next = null;

function row(item) {
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
  meta.textContent = item.day + (item.opened.length ? ` · opened ${item.opened.map((o) => o.label).join(', ')}` : '');
  li.append(box, word, gloss, meta);
  return li;
}

async function loadList(more) {
  try {
    const got = await api('GET', `/lookups?limit=200${more && next ? `&before=${encodeURIComponent(next)}` : ''}`);
    if (!more) list.innerHTML = '';
    for (const item of got.items) list.append(row(item));
    next = got.next;
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
