'use strict';
// The phone page: one demand item (a sentence Dan has read with the verb
// blanked), the other mapped words of that piece, and a quick lookup. Pull-
// only: it shows one item when opened and another when Next is asked for;
// no queue, no tally.

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

// One card slot per section; each remembers the word it shows.
const slots = {};
for (const id of ['card-demand', 'card-also', 'card-lookup']) {
  const el = document.getElementById(id);
  const slot = { el, current: null };
  UI.wire(el, {
    onStatus: (status) => UI.saveStatus(el, api, slot.current, status),
    getCurrent: () => slot.current,
    onSetVerb: async ({ root, binyan }) => {
      const cur = slot.current;
      const data = await api('POST', '/lookup/confirm', { surface: cur.card.surface, sentence: cur.sentence || '', root, binyan });
      cur.card = data.card; cur.spot = data.spot;
      return data;
    },
    onPut: () => api('POST', '/desks/put', { surface: slot.current.card.surface, sentence: slot.current.sentence || '' }),
  });
  slots[id] = slot;
}

function showOnSlot(id, data, sentence) {
  const slot = slots[id];
  const current = slot.current = { card: data.card, spot: data.spot, sentence: sentence || '' };
  UI.fill(slot.el, data);
  UI.addPoints(slot.el, data, { api, sentence, isCurrent: () => slot.current === current });
}

async function lookupInto(id, { surface, sentence, article_id }) {
  const slot = slots[id];
  UI.setLoading(slot.el, surface);
  try {
    const data = await api('POST', '/lookup', { surface, sentence: sentence || '', article_id: article_id || null });
    showOnSlot(id, data, sentence || '');
    return data;
  } catch (e) {
    UI.setError(slot.el, surface, e.message);
    return null;
  }
}

// --- the demand -------------------------------------------------------------

let item = null;

function setGap(mode, text) {
  const gap = $('#demand-sentence .gap');
  if (!gap) return;
  gap.className = 'gap' + (mode ? ' ' + mode : '');
  gap.textContent = mode ? text : '';
}

function drawItem(d) {
  item = d;
  $('#demand-state').textContent = '';
  $('#demand-body').classList.remove('hidden');
  const when = d.article_added_at ? new Date(d.article_added_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const from = $('#demand-from');
  from.innerHTML = '';
  const title = document.createElement('span'); title.className = 'he'; title.textContent = d.article_title;
  from.append(document.createTextNode('From '), title, document.createTextNode(when ? ` · ${when}` : ''));
  $('#demand-translation').textContent = d.translation_en || '';
  const s = $('#demand-sentence');
  s.innerHTML = '';
  const parts = d.sentence.split('…');
  parts.forEach((p, i) => {
    if (i) { const gap = document.createElement('span'); gap.className = 'gap'; s.append(gap); }
    s.append(document.createTextNode(p));
  });
  const line = $('#demand-form-line');
  line.innerHTML = '';
  const bits = [];
  if (d.root) { const r = document.createElement('span'); r.className = 'he'; r.textContent = d.root; bits.push(['root ', r]); }
  if (d.binyan) bits.push([UI.BINYAN[d.binyan] || d.binyan]);
  if (d.tense) bits.push([d.tense]);
  if (d.person_gender_number) bits.push([d.person_gender_number]);
  bits.forEach((b, i) => {
    if (i) line.append(document.createTextNode(' · '));
    for (const x of b) line.append(typeof x === 'string' ? document.createTextNode(x) : x);
  });
  $('#answer').value = '';
  $('#answer-msg').className = 'msg';
  $('#answer-msg').textContent = '';
  $('#check').disabled = false; $('#show').disabled = false;
  slots['card-demand'].el.classList.add('idle');
  slots['card-demand'].current = null;
  drawAlso(d.also || []);
}

function drawNoData(reason) {
  item = null;
  $('#demand-body').classList.add('hidden');
  $('#demand-state').textContent = reason || 'Nothing to ask for yet.';
  slots['card-demand'].el.classList.add('idle');
  drawAlso([]);
}

async function loadItem(after) {
  $('#demand-state').textContent = 'finding a sentence…';
  try {
    const d = await api('GET', '/demand' + (after ? `?after=${encodeURIComponent(after)}` : ''));
    if (d.state === 'no data') drawNoData(d.reason); else drawItem(d);
  } catch (e) {
    drawNoData(e.message);
  }
}

async function check() {
  if (!item) return;
  const typed = $('#answer').value.trim();
  const msg = $('#answer-msg');
  msg.className = 'msg';
  if (!typed) { msg.className = 'msg error'; msg.textContent = 'Type the form first, or Show.'; return; }
  $('#check').disabled = true;
  msg.textContent = 'checking…';
  try {
    const data = await api('POST', '/demand/check', { spot_id: item.spot_id, article_id: item.article_id, surface: item.surface, typed });
    if (data.ok) {
      msg.textContent = '';
      setGap('right', data.surface);
      showOnSlot('card-demand', data, data.sentence);
      $('#show').disabled = true;
    } else {
      msg.className = 'msg error';
      msg.textContent = 'not that — try again or Show';
      $('#check').disabled = false;
    }
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
    $('#check').disabled = false;
  }
}

async function show() {
  if (!item) return;
  const msg = $('#answer-msg');
  msg.className = 'msg';
  msg.textContent = '';
  $('#show').disabled = true; $('#check').disabled = true;
  try {
    const data = await api('POST', '/demand/show', { spot_id: item.spot_id, article_id: item.article_id, surface: item.surface });
    setGap('shown', data.surface);
    showOnSlot('card-demand', data, data.sentence);
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
    $('#show').disabled = false; $('#check').disabled = false;
  }
}

// --- also from this piece ---------------------------------------------------

function drawAlso(list) {
  const el = $('#also-list');
  el.innerHTML = '';
  slots['card-also'].el.classList.add('idle');
  slots['card-also'].current = null;
  for (const w of list) {
    const row = document.createElement('div');
    const he = document.createElement('span'); he.className = 'he'; he.textContent = w.surface;
    const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = w.hint || w.status;
    row.append(he, hint);
    row.addEventListener('click', () => lookupInto('card-also', { surface: w.surface, sentence: w.sentence, article_id: item ? item.article_id : null }));
    el.append(row);
  }
  $('#also-empty').classList.toggle('hidden', list.length > 0);
}

// --- quick lookup -----------------------------------------------------------

async function quickLookup() {
  const surface = $('#lookup').value.trim();
  const msg = $('#lookup-msg');
  msg.className = 'msg';
  if (!surface) { msg.className = 'msg error'; msg.textContent = 'Type a word first.'; return; }
  msg.textContent = '';
  $('#lookup-go').disabled = true;
  try {
    await lookupInto('card-lookup', { surface, sentence: '' });
  } finally {
    $('#lookup-go').disabled = false;
  }
}

$('#check').addEventListener('click', check);
$('#show').addEventListener('click', show);
$('#answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
$('#next').addEventListener('click', (e) => { e.preventDefault(); loadItem(item ? item.spot_id : null); });
$('#lookup-go').addEventListener('click', quickLookup);
$('#lookup').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quickLookup(); } });

window.Phone = { api, loadItem, get item() { return item; } };
loadItem(null);
