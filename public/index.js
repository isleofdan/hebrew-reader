'use strict';
const $ = (s) => document.querySelector(s);

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

function host(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } }

async function load() {
  const { items, state } = await api('GET', '/articles');
  const list = $('#list');
  list.innerHTML = '';
  $('#empty').classList.toggle('hidden', state !== 'no data');
  for (const a of items) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/read.html?id=${a.id}`;
    const t = document.createElement('div'); t.className = 'title'; t.textContent = a.title;
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = `${a.source_url ? host(a.source_url) : 'pasted'} · ${new Date(a.added_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${a.chars.toLocaleString()} characters`;
    link.append(t);
    if (a.origin === 'found') {
      const f = document.createElement('div'); f.className = 'found';
      f.textContent = `Found on ${day(a.found_at)} from ${a.source_name}${a.has_guide ? ' · Study guide' : ''}`;
      link.append(f);
    }
    link.append(m);
    if (a.thin) {
      const thin = document.createElement('div'); thin.className = 'thin';
      const mark = document.createElement('i'); mark.setAttribute('aria-hidden', 'true');
      thin.append(mark, document.createTextNode('thin — the page gave little text; paste the article instead'));
      link.append(thin);
    }
    li.append(link); list.append(li);
  }
}

function day(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }

// "Find an article": the server answers a line at a time; the last line
// says where it ended. Leaving the page does not stop it.
$('#find').addEventListener('click', async () => {
  const msg = $('#find-msg');
  msg.className = 'msg';
  msg.textContent = 'Starting…';
  $('#find').disabled = true;
  let done = null;
  try {
    const res = await fetch('/articles/find', { method: 'POST', headers: { accept: 'application/json' } });
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `The server answered ${res.status}.`); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const o = JSON.parse(line);
        if (o.progress) msg.textContent = o.progress;
        if (o.done) done = o;
      }
      if (end) break;
    }
    if (!done) throw new Error('The search stopped before it said where it ended.');
    if (done.error) throw new Error(done.error);
    if (done.nothing) { msg.textContent = done.nothing; await loadLast(); return; }
    msg.textContent = `Found: ${done.title}`;
    location.href = `/read.html?id=${done.article_id}`;
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
    await loadLast().catch(() => {});
  } finally {
    $('#find').disabled = false;
  }
});

// The last search, for reading why without a terminal: when, each article
// tried and why it was left, the last model call, and the sites left out.
async function loadLast() {
  const { hunt: h, left_out: left } = await api('GET', '/articles/find/last');
  const box = $('#last-find');
  box.classList.toggle('hidden', !h);
  if (!h) return;
  const when = new Date(h.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#last-find-summary').textContent = `Last search: ${when} — ${h.outcome || 'still running'}`;
  const ul = $('#last-find-tried');
  ul.innerHTML = '';
  for (const t of h.tried) {
    const li = document.createElement('li');
    const what = document.createElement('span'); what.dir = 'auto'; what.textContent = t.title || host(t.url);
    li.append(document.createTextNode(`${t.source} · `), what, document.createTextNode(`${t.words ? ` (${t.words} words)` : ''} — ${t.outcome}`));
    ul.append(li);
  }
  $('#last-find-model').textContent = h.model_status ? `Last model call: ${h.model_status} — ${h.model_message}` : 'No model call in this search.';
  $('#last-find-left').textContent = `Not searched: ${left.map((s) => `${s.name} (${s.why})`).join('; ')}.`;
}

function dateOf(iso) {
  return new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function loadLessons() {
  const { items, state } = await api('GET', '/lessons');
  const list = $('#lessons');
  list.innerHTML = '';
  $('#lessons-empty').classList.toggle('hidden', state !== 'no data');
  for (const l of items) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/lesson.html?id=${l.id}`;
    const t = document.createElement('div'); t.className = 'title'; t.textContent = l.title;
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = `${l.lesson_date ? dateOf(l.lesson_date) : ''} · ${l.items} items · ${l.source_name}${l.guide ? '' : ' · guide not built yet'}`;
    link.append(t, m);
    li.append(link); list.append(li);
  }
}

$('#add-lesson').addEventListener('click', async () => {
  const input = $('#lesson-file');
  const msg = $('#lesson-msg');
  msg.className = 'msg';
  const file = input.files && input.files[0];
  if (!file) { msg.className = 'msg error'; msg.textContent = 'Choose a PDF first.'; return; }
  const form = new FormData();
  form.append('file', file, file.name);
  $('#add-lesson').disabled = true;
  msg.textContent = 'Reading the PDF…';
  try {
    const res = await fetch('/lessons', { method: 'POST', headers: { accept: 'application/json' }, body: form });
    if (res.status === 401) { location.href = '/login'; return; }
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
    if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
    msg.textContent = `${data.created ? 'Added' : 'Already here'}: ${data.title} · ${data.items.length} items. ${data.note}`;
    input.value = '';
    await loadLessons();
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
  } finally {
    $('#add-lesson').disabled = false;
  }
});

$('#add').addEventListener('click', async () => {
  const url = $('#url').value.trim();
  const text = $('#text').value.trim();
  const msg = $('#add-msg');
  msg.className = 'msg';
  if (!url && !text) { msg.className = 'msg error'; msg.textContent = 'Give an address or paste the text.'; return; }
  $('#add').disabled = true;
  msg.textContent = url ? 'Fetching…' : 'Saving…';
  try {
    const a = await api('POST', '/articles', text ? { text } : { url });
    msg.textContent = a.thin ? `Saved, but the page gave little readable text (${a.text.length} characters); the raw page text was kept.` : `Saved: ${a.title}`;
    $('#url').value = ''; $('#text').value = '';
    await load();
    if (!a.thin) location.href = `/read.html?id=${a.id}`;
  } catch (e) {
    msg.className = 'msg error'; msg.textContent = e.message;
  } finally {
    $('#add').disabled = false;
  }
});

load().catch((e) => { $('#add-msg').className = 'msg error'; $('#add-msg').textContent = e.message; });
loadLessons().catch((e) => { $('#lesson-msg').className = 'msg error'; $('#lesson-msg').textContent = e.message; });
loadLast().catch(() => {});
