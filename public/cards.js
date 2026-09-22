'use strict';
// The flashcards for one lesson from Guy, as the שיעורי גיא instructions
// describe them: the card's face is the Hebrew (nikud on or off), tap to
// flip to the meaning, root, binyan, example and the notes (difficulty flags
// behind "Notes"); a category filter; transliteration kept in the data and
// shown only when asked for. "Know it" and "Not yet" only move on: nothing is
// scored or scheduled here — the phone page owns practice.

const $ = (s) => document.querySelector(s);
const LESSON_ID = Number(new URLSearchParams(location.search).get('lesson'));
// The card's fields, in the instructions' order.
const F = { pointed: 0, plain: 1, translit: 2, meaning: 3, root: 4, binyan: 5, category: 6, pos: 7, example: 8, exampleEn: 9, notes: 10 };
const ACCENTS = 4; // one of the palette's four line colors per category

let all = [];
let deck = [];
let at = 0;
let flipped = false;
let nikud = true;
let translit = false;
const accentOf = {};

async function api(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (res.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

function hebrew(c) { return (nikud ? c[F.pointed] : c[F.plain]) || c[F.plain] || c[F.pointed]; }

function draw() {
  const flash = $('#flash');
  const empty = !deck.length;
  flash.classList.toggle('hidden', empty);
  $('#nav').classList.toggle('hidden', empty);
  $('#counter').textContent = empty ? '' : `${at + 1} / ${deck.length}`;
  if (empty) return;
  const c = deck[at];
  flash.dataset.accent = String(accentOf[c[F.category]] ?? 0);
  $('#f-cat').textContent = c[F.category];
  $('#f-word').textContent = hebrew(c);
  $('#b-cat').textContent = c[F.category];
  $('#b-word').textContent = hebrew(c);
  $('#b-meaning').textContent = c[F.meaning];
  $('#b-grammar').textContent = [c[F.root] && `root ${c[F.root]}`, c[F.binyan], c[F.pos]].filter(Boolean).join(' · ');
  $('#b-translit').textContent = c[F.translit];
  $('#b-translit').classList.toggle('hidden', !translit || !c[F.translit]);
  $('#b-example').textContent = c[F.example];
  $('#b-example-en').textContent = c[F.exampleEn];
  $('#b-notes-text').textContent = c[F.notes];
  $('#b-notes').classList.toggle('hidden', !c[F.notes]);
  $('#b-notes').open = false;
  flash.querySelector('.front').classList.toggle('hidden', flipped);
  flash.querySelector('.back').classList.toggle('hidden', !flipped);
  $('#prev').disabled = at === 0;
}

function move(step) {
  if (!deck.length) return;
  at = Math.min(deck.length - 1, Math.max(0, at + step));
  flipped = false;
  draw();
}

function filter() {
  const cat = $('#cat').value;
  deck = all.filter((c) => !cat || c[F.category] === cat);
  at = 0; flipped = false;
  draw();
}

function shuffle() {
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  at = 0; flipped = false;
  draw();
}

function toggle(btn, on) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }

async function main() {
  if (!LESSON_ID) { $('#msg').textContent = 'No lesson chosen. Go back to the list and pick one.'; return; }
  $('#lesson-link').href = `/lesson.html?id=${LESSON_ID}`;
  let v;
  try { v = await api(`/lessons/${LESSON_ID}`); } catch (e) { $('#msg').className = 'msg error'; $('#msg').textContent = e.message; return; }
  document.title = `Flashcards — ${v.title}`;
  $('#title').textContent = v.title;
  if (!v.guide || !v.guide.cards.length) {
    $('#msg').textContent = v.guide ? 'The guide for this lesson has no cards.' : 'The study guide for this lesson is not built yet; open the lesson first.';
    return;
  }
  all = v.guide.cards;
  const cats = [...new Set(all.map((c) => c[F.category]).filter(Boolean))];
  cats.forEach((c, i) => {
    accentOf[c] = i % ACCENTS;
    const o = document.createElement('option'); o.value = c; o.textContent = c; $('#cat').append(o);
  });
  deck = all.slice();
  draw();
}

$('#flash').addEventListener('click', (e) => {
  if (e.target.closest('details')) return;
  flipped = !flipped;
  draw();
});
$('#flash').addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipped = !flipped; draw(); } });
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select, input, textarea')) return;
  if (e.key === 'ArrowRight') move(1);
  if (e.key === 'ArrowLeft') move(-1);
});
$('#prev').addEventListener('click', () => move(-1));
$('#next').addEventListener('click', () => move(1));
$('#know').addEventListener('click', () => move(1));
$('#notyet').addEventListener('click', () => move(1));
$('#shuffle').addEventListener('click', shuffle);
$('#cat').addEventListener('change', filter);
$('#nikud').addEventListener('click', () => { nikud = !nikud; toggle($('#nikud'), nikud); draw(); });
$('#translit').addEventListener('click', () => { translit = !translit; toggle($('#translit'), translit); draw(); });

main();
