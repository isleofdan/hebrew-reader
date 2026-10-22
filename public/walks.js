'use strict';
// Walks (hebrew-walks-one): walks with the guide to Jewish thought.
//   /walks        a box for a question and "Start", then the saved walks,
//                 newest first; /walks?ref=<reference> starts from that
//                 passage instead (the door the later study tool will use)
//   /walks/<id>   one walk: its stops oldest first, each a passage from
//                 Sefaria with the guide's words; under the last, the
//                 directions it offers, "Push back, or ask…" and "Go"
// Opening a page or a walk draws it from the record and asks the model
// nothing; Start, a direction and Go each make one stop (lib/walks.js).
// Pressing a direction or Go keeps Dan's place: "Thinking…" takes the
// buttons' place, and when the stop arrives the line "You chose: …" (or "You
// wrote: …") stands where the pressed button stood, with the new stop below.
// A stop takes up to three minutes, longer than a phone keeps one request
// open: Start and a move answer at once with the walk marked pending, and
// the page reads the walk every few seconds until the stop is there or a
// failure line says why there is none. Reopening a pending walk shows the
// wait and goes on reading.
// A question typed into the box is kept in this browser as Dan types (a
// phone that reloads the page during the wait for the first stop would
// otherwise lose it); it is cleared when the walk opens with its stop. A
// first stop that fails or is declined keeps the question in the box, and
// the walk it was saved as is linked so nothing typed is lost.

const $ = (s) => document.querySelector(s);

// { ok, status, data }; signed out goes to the sign-in page
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dayOf = (iso) => { try { return DAY.format(new Date(iso)); } catch { return ''; } };
const state = (text) => { $('#state').textContent = text || ''; };

// the question as typed, kept in this browser (storage can be refused: a
// private window, cleared site data; the page works without it)
const DRAFT = 'walks.draft';
const draft = {
  read() { try { return localStorage.getItem(DRAFT) || ''; } catch { return ''; } },
  write(v) { try { if (v) localStorage.setItem(DRAFT, v); else localStorage.removeItem(DRAFT); } catch { /* storage refused */ } },
};
const QUESTION_MAX = 4000; // lib/walks.js WALK_QUESTION_MAX

// --- /walks ---------------------------------------------------------------------------

async function listPage() {
  const ref = new URLSearchParams(location.search).get('ref');
  $('#start').classList.remove('hidden');
  if (ref) {
    $('#from').textContent = `Start from ${ref}`;
    $('#from').classList.remove('hidden');
    $('#question').classList.add('hidden');
  }
  $('#start-go').addEventListener('click', () => start(ref));
  $('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start(ref); });
  if (!ref) {
    const q = $('#question');
    if (!q.value && draft.read()) { q.value = draft.read(); $('#start-msg').textContent = 'Your question from before, kept here.'; }
    q.addEventListener('input', () => { draft.write(q.value); countLine(q.value); });
    countLine(q.value);
  }
  const r = await api('GET', '/walks/list');
  state('');
  if (!r.ok) { state(r.data.error); return; }
  const ul = $('#list');
  for (const w of r.data.items) {
    const li = el('li');
    const a = el('a', 'walk-line'); a.href = `/walks/${w.id}`;
    const t = el('span', 'walk-line-title', w.title); t.dir = 'auto';
    a.append(t, el('span', 'walk-line-day', dayOf(w.started_at)));
    li.append(a);
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el('li', 'walk-none', 'No walks yet.'));
  $('#saved').classList.remove('hidden');
}

// "3,850 / 4,000" once the question is long, so the limit is never a surprise
function countLine(value) {
  const n = value.trim().length;
  const c = $('#count');
  c.textContent = n > QUESTION_MAX * 0.75 ? `${n.toLocaleString()} / ${QUESTION_MAX.toLocaleString()}` : '';
  c.classList.toggle('error', n > QUESTION_MAX);
}

// "Thinking… 12 s": the wait, counted, so a long first stop (up to three
// minutes) is not taken for a hang. Returns the stop function.
function ticking(node, label, t0 = Date.now()) {
  const show = () => { const s = Math.round((Date.now() - t0) / 1000); node.textContent = s >= 1 ? `${label}… ${s} s` : `${label}…`; };
  show();
  const id = setInterval(show, 1000);
  return () => clearInterval(id);
}

async function start(ref) {
  const question = $('#question').value.trim();
  const msg = $('#start-msg');
  msg.classList.remove('error');
  msg.textContent = '';
  if (!ref && !question) { msg.textContent = 'Write a question to walk with first.'; return; }
  if (!ref && question.length > QUESTION_MAX) {
    msg.classList.add('error');
    msg.textContent = `The question is ${question.length.toLocaleString()} characters; the most is ${QUESTION_MAX.toLocaleString()}. Shorten it a little; it stays here as you do.`;
    return;
  }
  const row = $('#start-row');
  const held = row.offsetHeight;
  row.style.minHeight = `${held}px`;
  $('#start-go').classList.add('hidden');
  const thinking = el('p', 'walk-thinking');
  const stopTicking = ticking(thinking, 'Thinking');
  row.append(thinking);
  const r = await api('POST', '/walks/start', ref ? { ref } : { question }).catch((e) => ({ ok: false, data: { error: e.message } }));
  stopTicking();
  thinking.remove();
  row.style.minHeight = '';
  if (r.ok) { draft.write(''); location.href = `/walks/${r.data.id}`; return; }
  $('#start-go').classList.remove('hidden');
  msg.classList.add('error');
  msg.textContent = `${r.data.error || 'The server did not answer.'} Your question is kept here; try Start again.`;
}

// --- /walks/<id> --------------------------------------------------------------------

let walk = null; // the walk as the server last gave it

async function walkPage(id) {
  const r = await api('GET', `/walks/${id}/stops`);
  if (!r.ok) { state(r.data.error); return; }
  state('');
  draw(r.data);
  $('#walk').classList.remove('hidden');
  if (walk.pending) await follow(null, null);
}

// The whole walk from the record: its stops oldest first, the line between
// each pair, and under the last the controls (or, while a stop is on its
// way, the wait; or the last move's failure line and the controls).
function draw(data) {
  walk = data;
  document.title = `Hebrew reader · ${walk.title}`;
  $('#walk-title').textContent = walk.title;
  const box = $('#stops');
  box.innerHTML = '';
  // the line saying what Dan did stands above every stop but the one the
  // walk began with (its question or passage is the title)
  walk.stops.forEach((s) => {
    if (s.move.kind === 'pick' || s.move.kind === 'text') box.append(moveLine(s.move));
    box.append(stopPanel(s));
  });
  box.append(movePanel());
  if (walk.failure) showFailure(walk.failure);
}

const POLL_MS = 3000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads the walk every few seconds while a stop is on its way. "Thinking…"
// with the seconds counted (from when the server began) stands in place of
// the controls, at `top` when a pressed control is being replaced. When the
// stop arrives, `label` (what Dan pressed or wrote) becomes the line where
// the control was and the new stop goes below; a failure shows its line and
// the controls come back.
async function follow(label, top) {
  const zone = $('#move');
  const had = walk.stops.length;
  for (const old of zone.querySelectorAll('.walk-failed')) old.remove();
  zone.querySelector('.walk-msg').textContent = '';
  zone.style.minHeight = `${zone.offsetHeight}px`;
  const kept = [...zone.children];
  for (const c of kept) c.classList.add('hidden');
  const thinking = el('p', 'walk-thinking');
  const since = walk.pending_since ? Date.parse(walk.pending_since) : Date.now();
  const stopTicking = ticking(thinking, 'Thinking', since);
  zone.prepend(thinking);
  if (top !== null) keepAt(thinking, top);
  let data = walk;
  while (data.pending) {
    await wait(POLL_MS);
    const r = await api('GET', `/walks/${walk.id}/stops`).catch(() => null);
    if (r && r.ok) data = r.data;
  }
  stopTicking();
  thinking.remove();
  sending = false;
  walk = data;
  if (walk.stops.length > had) {
    const s = walk.stops.at(-1);
    const move = label !== null ? (s.move.kind === 'pick' ? { kind: 'pick', text: label } : { kind: 'text', text: label }) : s.move;
    const box = $('#stops');
    let line = null;
    if (move.kind === 'pick' || move.kind === 'text') { line = moveLine(move); zone.replaceWith(line); } else zone.remove();
    box.append(stopPanel(s), movePanel());
    if (top !== null && line) keepAt(line, top);
    return;
  }
  zone.style.minHeight = '';
  for (const c of kept) c.classList.remove('hidden');
  showFailure(walk.failure || { error: 'The stop did not arrive. Ask again.' }, top);
}

// The last move's failure line (or the guide's decline) where the controls are.
function showFailure(f, top = null) {
  const zone = $('#move');
  for (const old of zone.querySelectorAll('.walk-failed')) old.remove();
  const line = el('p', `walk-failed${f.declined ? ' declined' : ''}`, f.declined || f.error);
  line.setAttribute('role', 'status');
  zone.prepend(line);
  if (top !== null) keepAt(line, top);
}

// "You chose: …" / "You wrote: …", the line a pressed control leaves
function moveLine(move) {
  return el('p', 'walk-chose', move.kind === 'pick' ? `You chose: ${move.text}` : `You wrote: ${move.text}`);
}

function section(title, body, cls) {
  const s = el('div', `walk-part ${cls || ''}`.trim());
  s.append(el('h3', '', title));
  const p = el('p', 'walk-text', body); p.dir = 'auto';
  s.append(p);
  return s;
}

function stopPanel(s) {
  const panel = el('section', 'panel walk-stop');
  panel.dataset.n = s.n;
  const head = el('div', 'walk-stop-head');
  // a stop with no passage: the guide answered the move itself
  const h = el('h2', 'walk-stop-title', `Stop ${s.n} · ${s.passage ? s.passage.title : (s.ref || 'the guide answers')}`);
  head.append(h);
  if (s.reply) panel.classList.add('walk-reply');
  if (s.passage) {
    const links = el('span', 'walk-passage-links');
    // the page in Study holding the passage's first line (hebrew-study-one)
    if (s.passage.study) {
      const st = el('a', 'walk-study', 'Read it in Study'); st.href = s.passage.study;
      links.append(st);
    }
    const a = el('a', 'walk-full', 'Full passage'); a.href = s.passage.url; a.target = '_blank'; a.rel = 'noopener';
    links.append(a);
    head.append(links);
  }
  panel.append(head);
  // how the guide read the move it chose this passage for (none on a stop
  // saved before it was asked, on a reply, or on a walk begun at a passage)
  if (s.reading) {
    const r = el('p', 'walk-reading');
    r.dir = 'auto';
    r.append(el('span', 'walk-reading-label', 'Your question, as I read it: '), s.reading);
    panel.append(r);
  }
  if (s.passage) {
    const block = el('div', 'walk-passage');
    const he = el('div', 'walk-he', s.passage.he); he.lang = 'he'; he.dir = 'rtl';
    const tr = el('div', 'walk-translit', s.transliteration);
    const en = el('div', 'walk-en', s.passage.en); en.lang = 'en';
    block.append(he, tr, en);
    panel.append(block);
    // the guide is given the first 40 lines; say so when there were more (a
    // passage kept before the count was kept says nothing)
    if (s.passage.lines && s.passage.lines > s.passage.shown) panel.append(el('p', 'walk-cut', `First ${s.passage.shown} of ${s.passage.lines} lines`));
  }
  if (s.reply) panel.append(section('The guide answers', s.reply, 'walk-reply-text'));
  if (s.why_here) panel.append(section('Why here', s.why_here, 'walk-why'));
  if (s.explanation) panel.append(section('What it says, plainly', s.explanation, 'walk-explain'));
  if (s.argues) {
    const part = section('Where the tradition argues with itself', s.argues, 'walk-argues');
    if (s.links && s.links.length) {
      const ul = el('ul', 'links');
      window.AskUI.drawLinks(ul, s.links);
      part.append(ul);
    }
    panel.append(part);
  }
  if (s.opinion) panel.append(section('My opinion', s.opinion, 'walk-opinion'));
  if (s.took_ms !== null && s.took_ms !== undefined) panel.append(el('p', 'walk-took', `answered in ${Math.max(1, Math.round(s.took_ms / 1000))} s`));
  return panel;
}

// Under the last stop: its directions, the box and Go. With no stop yet (the
// first stop declined or failed), the box alone.
function movePanel() {
  const zone = el('div', 'walk-move');
  zone.id = 'move';
  const last = walk.stops.at(-1);
  if (!last && !walk.pending && !walk.failure) zone.append(el('p', 'walk-none', 'No stop yet. Ask again, in other words if you like.'));
  const dirs = el('div', 'walk-dirs');
  (last ? last.next : []).forEach((d, i) => {
    const b = el('button', 'btn walk-dir');
    b.type = 'button';
    b.append(el('span', 'walk-dir-label', d.label));
    if (d.why) b.append(el('span', 'walk-dir-why', d.why));
    b.addEventListener('click', () => send({ pick: i }, b, d.label));
    dirs.append(b);
  });
  if (dirs.children.length) zone.append(dirs);
  const ta = el('textarea', 'walk-push');
  ta.rows = 2; ta.placeholder = 'Push back, or ask…'; ta.setAttribute('aria-label', 'Push back, or ask');
  const go = el('button', 'btn primary walk-go', 'Go');
  go.type = 'button';
  go.addEventListener('click', () => { if (ta.value.trim()) send({ text: ta.value.trim() }, go, ta.value.trim()); else msg.textContent = 'Write a pushback or a question first.'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click(); });
  const msg = el('p', 'msg walk-msg');
  msg.setAttribute('role', 'status');
  zone.append(ta, go, msg);
  return zone;
}

let sending = false;

// One move: the POST answers at once (the walk marked pending), then the
// page follows the stop as it is made; `follow` draws the line saying what
// Dan did at the height of the control he pressed, and the new stop below.
async function send(body, pressed, label) {
  if (sending) return;
  sending = true;
  const zone = $('#move');
  const top = pressed.getBoundingClientRect().top;
  const r = await api('POST', `/walks/${walk.id}/step`, body).catch((e) => ({ ok: false, data: { error: e.message } }));
  if (!r.ok) {
    sending = false;
    showFailure({ error: r.data.error || 'The server did not answer.' }, top);
    return;
  }
  walk = r.data;
  await follow(label, top);
}

// Scroll so `node` sits at `top` on the screen (the height of what Dan pressed).
function keepAt(node, top) {
  const now = node.getBoundingClientRect().top;
  if (Math.abs(now - top) >= 0.5) window.scrollBy(0, now - top);
}

// --- which page ----------------------------------------------------------------------

const m = /^\/walks\/(\d+)$/.exec(location.pathname);
(m ? walkPage(Number(m[1])) : listPage()).catch((e) => state(e.message));
