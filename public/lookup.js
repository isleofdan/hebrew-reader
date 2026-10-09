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

window.Lookup = { api, get current() { return current; } };
