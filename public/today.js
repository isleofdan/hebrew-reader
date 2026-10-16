'use strict';
// Today: the day's drills, one item at a time. Pull-only: the page shows the
// set the server made and nothing else; it never reminds, counts days or
// asks Dan back. "3 of 10" is a place in today's set, not a streak.

const $ = (s) => document.querySelector(s);
const UI = window.CardUI;
const tok = window.HebrewTokenize;

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

const KIND = { form: 'Give the form', preposition: 'Which preposition', spelling: 'Which spelling', know: 'Do you know it', passage: 'A fresh passage' };

let view = null; // the set as GET /today/set gave it, kept fresh by every answer
let at = null; // the item on screen

// --- the card under an item ---------------------------------------------------------
const cardEl = $('#card-today');
const slot = { current: null };
UI.wire(cardEl, {
  onStatus: (status) => UI.saveStatus(cardEl, api, slot.current, status),
  getCurrent: () => slot.current,
});
function showCard(data, sentence) {
  const current = slot.current = { card: data.card, spot: data.spot, sentence: sentence || '' };
  UI.fill(cardEl, data);
  UI.addPoints(cardEl, data, { api, sentence, isCurrent: () => slot.current === current });
}
function hideCard() { cardEl.classList.add('idle'); slot.current = null; }

// --- drawing ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A Hebrew text with its one gap (…) drawn as a blank to fill.
function drawGapped(box, text) {
  box.innerHTML = '';
  String(text || '').split('…').forEach((part, i) => {
    if (i) box.append(el('span', 'gap'));
    box.append(document.createTextNode(part));
  });
}

function setGap(mode, text) {
  const gap = $('#sentence .gap');
  if (!gap) return;
  gap.className = 'gap' + (mode ? ' ' + mode : '');
  gap.textContent = mode ? text : '';
}

// A passage: Dan's words in it tinted shaky, its new words light blue; a new
// word taps open its card (the reader's own, so it can be saved).
function drawPassage(box, it, text) {
  box.innerHTML = '';
  const used = new Set((it.words_used || []).map((w) => w.surface));
  const fresh = new Set((it.new_words || []).map((w) => w.surface));
  const parts = String(text).split('…');
  parts.forEach((part, i) => {
    if (i) box.append(el('span', 'gap'));
    let last = 0;
    for (const w of tok.words(part)) {
      box.append(document.createTextNode(part.slice(last, w.start)));
      const span = el('span', 'w' + (fresh.has(w.surface) ? ' new' : used.has(w.surface) ? ' shaky' : ''), w.surface);
      if (fresh.has(w.surface)) {
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.addEventListener('click', () => openWord(w.surface, tok.sentenceAt(it.text, Math.max(0, it.text.indexOf(w.surface)))));
      }
      box.append(span);
      last = w.end;
    }
    box.append(document.createTextNode(part.slice(last)));
  });
}

async function openWord(surface, sentence) {
  UI.setLoading(cardEl, surface);
  try {
    const data = await api('POST', '/lookup', { surface, sentence });
    showCard(data, sentence);
  } catch (e) {
    UI.setError(cardEl, surface, e.message);
  }
}

function place() {
  const n = view.total;
  const i = at === null ? n : at;
  $('#place').classList.remove('hidden');
  $('#place-text').textContent = view.done ? `${n} of ${n}` : `${i + 1} of ${n}`;
  $('#place-bar').style.width = `${Math.round(((view.done ? n : i) / n) * 100)}%`;
}

function hideAll() {
  for (const id of ['typed', 'choices', 'reveal', 'self', 'flash', 'after', 'english', 'question', 'english-show']) $('#' + id).classList.add('hidden');
  $('#answer-msg').textContent = '';
  $('#answer-msg').className = 'msg';
}

function drawItem(it) {
  at = it.index;
  hideAll();
  hideCard();
  $('#done').classList.add('hidden');
  $('#item').classList.remove('hidden');
  $('#item').dataset.kind = it.kind;
  $('#kind').textContent = KIND[it.kind] || it.kind;
  $('#translation').textContent = it.kind === 'form' ? it.translation_en || '' : it.kind === 'spelling' ? it.meaning_en || '' : '';
  const s = $('#sentence');
  if (it.kind === 'passage') drawPassage(s, it, it.question.type === 'form' ? it.question.text : it.text);
  else if (it.kind === 'know') {
    s.innerHTML = '';
    const sentence = it.sentence || it.word;
    const i = sentence.indexOf(it.word);
    if (i >= 0) s.append(document.createTextNode(sentence.slice(0, i)), el('mark', 'w shaky', it.word), document.createTextNode(sentence.slice(i + it.word.length)));
    else s.textContent = sentence;
  } else drawGapped(s, it.sentence);
  const q = $('#question');
  if (it.kind === 'passage' && it.question.type === 'choice') { q.textContent = it.question.question_he; q.classList.remove('hidden'); }
  const hint = $('#hint');
  hint.innerHTML = '';
  if (it.kind === 'form' && it.hint) {
    const bits = [];
    if (it.hint.root) bits.push(['root ', el('span', 'he', it.hint.root)]);
    if (it.hint.binyan) bits.push([UI.BINYAN[it.hint.binyan] || it.hint.binyan]);
    if (it.hint.tense) bits.push([it.hint.tense]);
    if (it.hint.person_gender_number) bits.push([it.hint.person_gender_number]);
    if (it.made_up) bits.push(['a made-up sentence']);
    bits.forEach((b, i) => { if (i) hint.append(document.createTextNode(' · ')); for (const x of b) hint.append(typeof x === 'string' ? document.createTextNode(x) : x); });
  }
  if (it.kind === 'preposition' && !it.in_sentence) hint.textContent = 'the preposition this word takes';
  if ((it.kind === 'preposition' || it.kind === 'spelling') && it.made_up) hint.textContent = 'a made-up sentence';
  mixed($('#source'), it.source || '');
  $('#english').textContent = it.english || '';
  if (it.answered) return drawAnswered(it);
  if (it.kind === 'form' || (it.kind === 'passage' && it.question.type === 'form')) {
    $('#typed').classList.remove('hidden');
    $('#answer').value = '';
    $('#check').disabled = false; $('#show').disabled = false;
    if (it.shown) return revealed(it, null);
  } else if (it.kind === 'know') {
    if (it.shown) return revealed(it, null);
    $('#reveal').classList.remove('hidden');
  } else {
    const box = $('#choices');
    box.innerHTML = '';
    const choices = it.kind === 'passage' ? it.question.choices : it.choices;
    box.dataset.count = choices.length;
    for (const c of choices) {
      const b = el('button', 'btn choice', c);
      b.type = 'button'; b.lang = 'he';
      b.addEventListener('click', () => send({ answer: c }, b));
      box.append(b);
    }
    box.classList.remove('hidden');
  }
  place();
}

// An item answered before (a reload, or after Undo of a later one): its
// result, and Next.
function drawAnswered(it) {
  const a = it.answered;
  $('#answer-msg').textContent = `Answered: ${a.result}${a.answer ? ` (${a.answer})` : ''}`;
  $('#after').classList.remove('hidden');
  if (it.kind === 'passage') $('#english-show').classList.remove('hidden');
  place();
}

// Show was tapped (now or before a reload): the answer and the card revealed,
// then Dan's own two taps.
async function revealed(it, data) {
  $('#typed').classList.add('hidden');
  $('#reveal').classList.add('hidden');
  if (it.kind === 'form' || (it.kind === 'passage' && it.question.type === 'form')) setGap('shown', it.kind === 'passage' ? it.question.answer : it.answer);
  $('#self').classList.remove('hidden');
  place();
  try {
    const got = data || await api('POST', '/today/show', { set_id: view.set.id, item_index: it.index });
    if (got.view) view = got.view;
    if (got.card) showCard({ card: got.card, spot: got.spot, cached: true }, got.sentence);
    if (it.kind === 'passage') $('#english').classList.remove('hidden');
  } catch (e) {
    $('#answer-msg').className = 'msg error'; $('#answer-msg').textContent = e.message;
  }
}

async function showNow() {
  const it = view.items[at];
  $('#show').disabled = true; $('#check').disabled = true; $('#reveal-show').disabled = true;
  try {
    const data = await api('POST', '/today/show', { set_id: view.set.id, item_index: it.index });
    view = data.view;
    await revealed(it, data);
  } catch (e) {
    $('#answer-msg').className = 'msg error'; $('#answer-msg').textContent = e.message;
    $('#show').disabled = false; $('#check').disabled = false; $('#reveal-show').disabled = false;
  } finally {
    $('#reveal-show').disabled = false;
  }
}

// One answer: a typed form, a choice, or Dan's own tap. The flash names the
// word and the result, with Undo; Next goes on.
async function send(body, button) {
  const it = view.items[at];
  const msg = $('#answer-msg');
  msg.className = 'msg'; msg.textContent = '';
  for (const b of document.querySelectorAll('#answer-zone button')) b.disabled = true;
  try {
    const data = await api('POST', '/today/answer', { set_id: view.set.id, item_index: it.index, ...body });
    view = data.view;
    hideAll();
    if (it.kind === 'form' || it.kind === 'preposition' || it.kind === 'spelling' || (it.kind === 'passage' && it.question.type === 'form')) setGap(data.result === 'right' ? 'right' : 'shown', it.kind === 'passage' ? it.question.answer : it.kind === 'preposition' ? it.answer.replace(/-$/, '') : it.answer);
    for (const b of document.querySelectorAll('#choices .choice')) {
      const right = b.textContent === (it.kind === 'passage' ? it.question.answer : it.answer);
      b.classList.toggle('right', right);
      b.classList.toggle('wrong', !right && b.textContent === body.answer);
    }
    if (it.kind !== 'form' && it.kind !== 'know' && !(it.kind === 'passage' && it.question.type === 'form')) $('#choices').classList.remove('hidden');
    flash(data.flash.text, data.result, true);
    $('#after').classList.remove('hidden');
    if (it.kind === 'passage') $('#english-show').classList.remove('hidden');
    else if (!slot.current) {
      // the word's card, as Show reveals it
      const got = await api('POST', '/today/show', { set_id: view.set.id, item_index: it.index });
      if (got.card) showCard({ card: got.card, spot: data.spot || got.spot, cached: true, spine: data.spine }, got.sentence);
    } else if (data.spot) UI.fill(cardEl, { card: slot.current.card, spot: data.spot, cached: true, spine: data.spine });
    place();
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
  } finally {
    for (const b of document.querySelectorAll('#answer-zone button')) b.disabled = false;
  }
}

// A line of English holding Hebrew: each Hebrew run set apart (<bdi>), so the
// line reads left to right whatever it starts with.
function mixed(box, text) {
  box.innerHTML = '';
  for (const part of String(text || '').split(/([֐-׿][֐-׿\s"'״׳\-–—\d.,]*[֐-׿])/)) {
    if (!part) continue;
    if (/[֐-׿]/.test(part)) { const b = el('bdi', 'he', part); b.dir = 'rtl'; box.append(b); }
    else box.append(document.createTextNode(part));
  }
}

function flash(text, result, canUndo) {
  $('#flash').classList.remove('hidden');
  $('#flash').dataset.result = result;
  mixed($('#flash-text'), text);
  $('#undo').classList.toggle('hidden', !canUndo);
}

async function undoLast() {
  $('#undo').disabled = true;
  try {
    const data = await api('POST', '/today/undo', { set_id: view.set.id, answer_id: view.last_answer ? view.last_answer.id : undefined });
    view = data.view;
    const it = view.items[data.undone.item_index];
    drawItem(it);
    flash(`${data.undone.word || 'the passage'} — undone`, 'undone', false);
  } catch (e) {
    $('#answer-msg').className = 'msg error'; $('#answer-msg').textContent = e.message;
  } finally {
    $('#undo').disabled = false;
  }
}

function next() {
  const it = view.items.find((x) => !x.answered && x.index > at) || view.items.find((x) => !x.answered);
  if (it) drawItem(it); else drawDone();
}

function drawDone() {
  at = null;
  $('#item').classList.add('hidden');
  hideCard();
  const list = $('#done-list');
  list.innerHTML = '';
  for (const it of view.items) {
    const li = el('li', 'result-' + (it.answered ? it.answered.result : 'none'));
    li.append(el('span', 'he', it.kind === 'passage' ? '' : it.word || ''), el('span', 'what', it.kind === 'passage' ? it.source : KIND[it.kind]), el('span', 'res', it.answered ? it.answered.result : ''));
    list.append(li);
  }
  $('#done').classList.remove('hidden');
  place();
}

function drawNoData(reason) {
  $('#place').classList.add('hidden');
  $('#item').classList.add('hidden');
  $('#done').classList.add('hidden');
  $('#state').textContent = reason && reason !== 'Nothing is due today.' ? `Nothing is due today. ${reason}` : 'Nothing is due today.';
}

async function load() {
  try {
    const data = await api('GET', '/today/set');
    if (data.state === 'no data') return drawNoData(data.reason);
    view = data;
    $('#state').textContent = '';
    const note = $('#note');
    note.textContent = view.set.note || '';
    note.classList.toggle('hidden', !view.set.note);
    if (view.done) drawDone(); else drawItem(view.items[view.position]);
  } catch (e) {
    $('#state').textContent = e.message;
  }
}

$('#check').addEventListener('click', () => {
  const typed = $('#answer').value.trim();
  if (!typed) { $('#answer-msg').className = 'msg error'; $('#answer-msg').textContent = 'Type the form first, or Show.'; return; }
  send({ answer: typed });
});
$('#answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#check').click(); } });
$('#show').addEventListener('click', showNow);
$('#reveal-show').addEventListener('click', showNow);
$('#had').addEventListener('click', () => send({ result: 'right' }));
$('#missed').addEventListener('click', () => send({ result: 'wrong' }));
$('#undo').addEventListener('click', undoLast);
$('#next').addEventListener('click', next);
$('#english-show').addEventListener('click', async () => {
  const it = view.items[at];
  $('#english').classList.remove('hidden');
  $('#english-show').classList.add('hidden');
  if (!it.english) {
    try { const got = await api('POST', '/today/show', { set_id: view.set.id, item_index: it.index }); $('#english').textContent = got.english || ''; } catch (e) { $('#english').textContent = e.message; }
  }
});

window.Today = { api, load, get view() { return view; }, get at() { return at; } };
load();
