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
