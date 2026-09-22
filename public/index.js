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
    link.append(t, m);
    if (a.thin) {
      const thin = document.createElement('div'); thin.className = 'thin';
      const mark = document.createElement('i'); mark.setAttribute('aria-hidden', 'true');
      thin.append(mark, document.createTextNode('thin — the page gave little text; paste the article instead'));
      link.append(thin);
    }
    li.append(link); list.append(li);
  }
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
