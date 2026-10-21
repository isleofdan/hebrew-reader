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

async function start(ref) {
  const question = $('#question').value.trim();
  const msg = $('#start-msg');
  msg.classList.remove('error');
  if (!ref && !question) { msg.textContent = 'Write a question to walk with first.'; return; }
  const row = $('#start-row');
  const held = row.offsetHeight;
  row.style.minHeight = `${held}px`;
  $('#start-go').classList.add('hidden');
  const thinking = el('p', 'walk-thinking', 'Thinking…');
  row.append(thinking);
  msg.textContent = '';
  const r = await api('POST', '/walks/start', ref ? { ref } : { question }).catch((e) => ({ ok: false, data: { error: e.message } }));
  thinking.remove();
  row.style.minHeight = '';
  if (r.ok && !r.data.declined) { location.href = `/walks/${r.data.id}`; return; }
  $('#start-go').classList.remove('hidden');
  if (r.ok) { msg.textContent = r.data.declined; return; }
  msg.classList.add('error');
  msg.textContent = r.data.error;
}

// --- /walks/<id> --------------------------------------------------------------------

let walk = null; // the walk as the server last gave it

async function walkPage(id) {
  const r = await api('GET', `/walks/${id}/stops`);
  if (!r.ok) { state(r.data.error); return; }
  state('');
  walk = r.data;
  document.title = `Hebrew reader · ${walk.title}`;
  $('#walk-title').textContent = walk.title;
  const box = $('#stops');
  box.innerHTML = '';
  walk.stops.forEach((s, i) => {
    box.append(stopPanel(s));
    const after = walk.stops[i + 1];
    if (after) box.append(moveLine(after.move));
  });
  box.append(movePanel());
  $('#walk').classList.remove('hidden');
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
  const h = el('h2', 'walk-stop-title', `Stop ${s.n} · ${s.passage ? s.passage.title : s.ref}`);
  head.append(h);
  if (s.passage) {
    const a = el('a', 'walk-full', 'Full passage'); a.href = s.passage.url; a.target = '_blank'; a.rel = 'noopener';
    head.append(a);
  }
  panel.append(head);
  if (s.passage) {
    const block = el('div', 'walk-passage');
    const he = el('div', 'walk-he', s.passage.he); he.lang = 'he'; he.dir = 'rtl';
    const tr = el('div', 'walk-translit', s.transliteration);
    const en = el('div', 'walk-en', s.passage.en); en.lang = 'en';
    block.append(he, tr, en);
    panel.append(block);
  }
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
  if (!last) zone.append(el('p', 'walk-none', 'No stop yet. Ask again, in other words if you like.'));
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

// One step: "Thinking…" where the controls were, then the line saying what
// Dan did at the height of the button he pressed, and the new stop below. A
// failed or declined step shows its line there and the controls come back.
async function send(body, pressed, label) {
  if (sending) return;
  sending = true;
  const zone = $('#move');
  const top = pressed.getBoundingClientRect().top;
  for (const old of zone.querySelectorAll('.walk-failed')) old.remove();
  zone.querySelector('.walk-msg').textContent = '';
  zone.style.minHeight = `${zone.offsetHeight}px`;
  const kept = [...zone.children];
  for (const c of kept) c.classList.add('hidden');
  const thinking = el('p', 'walk-thinking', 'Thinking…');
  zone.prepend(thinking);
  keepAt(thinking, top);
  const r = await api('POST', `/walks/${walk.id}/step`, body).catch((e) => ({ ok: false, data: { error: e.message } }));
  sending = false;
  thinking.remove();
  if (r.ok && !r.data.declined) {
    walk = r.data;
    const line = moveLine(body.pick !== undefined ? { kind: 'pick', text: label } : { kind: 'text', text: label });
    const box = $('#stops');
    zone.replaceWith(line);
    box.append(stopPanel(walk.stops.at(-1)), movePanel());
    keepAt(line, top);
    return;
  }
  zone.style.minHeight = '';
  for (const c of kept) c.classList.remove('hidden');
  const line = el('p', `walk-failed${r.ok ? ' declined' : ''}`, r.ok ? r.data.declined : r.data.error);
  line.setAttribute('role', 'status');
  zone.prepend(line);
  keepAt(line, top);
}

// Scroll so `node` sits at `top` on the screen (the height of what Dan pressed).
function keepAt(node, top) {
  const now = node.getBoundingClientRect().top;
  if (Math.abs(now - top) >= 0.5) window.scrollBy(0, now - top);
}

// --- which page ----------------------------------------------------------------------

const m = /^\/walks\/(\d+)$/.exec(location.pathname);
(m ? walkPage(Number(m[1])) : listPage()).catch((e) => state(e.message));
