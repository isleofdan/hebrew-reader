'use strict';
// A link on a note card (session fourteen): shared from another app on the
// phone, or pasted into a new card. The note is saved at once with the bare
// link; the page's title is fetched afterwards, once, on the server, and
// kept beside the link when it comes. A failure leaves the bare link and is
// never retried; the save never waits for it.

const dns = require('node:dns').promises;
const net = require('node:net');
const desk = require('./desk');

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;
const MAX_HOPS = 5;

// An address on this machine or a private network (the server's own
// neighbours on Fly among them): a shared link never makes the server reach
// one. CATCH_ALLOW_PRIVATE=1 lets the local checks use a site on 127.0.0.1.
function privateIp(ip) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) ip = v4[1];
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
}

async function guard(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('not a web address');
  if (process.env.CATCH_ALLOW_PRIVATE === '1') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(privateIp)) throw new Error('a private address');
}

// The page at `url`, following at most five redirects, each checked.
async function fetchPage(url) {
  let u = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await guard(u);
    const res = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hebrew-reader/0.1', accept: 'text/html,application/xhtml+xml', 'accept-language': 'he-IL,he;q=0.9,en;q=0.5' },
    });
    const to = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && to) { u = new URL(to, u); continue; }
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, MAX_BYTES).toString('utf8');
  }
  throw new Error('too many redirects');
}

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// The page's own title: its og:title, else its <title>.
function titleOf(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]*>/i.exec(html);
  const content = og && /content=["']([^"']*)["']/i.exec(og[0]);
  const t = content ? content[1] : ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  return decode(t).replace(/\s+/g, ' ').trim();
}

// One try at the title of `url` for note `id`; answers the note, or null.
async function fillTitle(id, url) {
  try {
    const html = await fetchPage(url);
    const title = titleOf(html);
    if (!title) { console.log(`note ${id}: its link's page has no title; the bare link stays`); return null; }
    return desk.setNoteTitle(id, url, title);
  } catch (e) {
    console.log(`note ${id}: the title of its link could not be fetched (${e.name === 'TimeoutError' ? 'timed out' : e.message}); the bare link stays`);
    return null;
  }
}

// --- a shared line from Chrome (hebrew-ask-one) -------------------------------
// Chrome, sharing selected text, sends the page's address twice: plain, and
// with the selection coded into it after "#:~:text=" (a text fragment). The
// line keeps the plain address once, and the selected text itself as its
// text: the text as shared, without the addresses and its quotes, or, when
// only the coded address came, the selection read back from it.

const ADDRESS = /https?:\/\/[^\s<>"]+/gi;
const trim = (u) => u.replace(/[).,;:!?\]'"»]+$/, '');

// The address without its text fragment, or null when it has none.
function plainOf(address) {
  let u;
  try { u = new URL(address); } catch { return null; }
  const at = u.hash.indexOf(':~:');
  if (at < 0) return null;
  const rest = u.hash.slice(0, at);
  u.hash = rest === '#' ? '' : rest;
  return u.href;
}

// The text a fragment selects: "start" or "start … end", without the
// prefix ("…-,") and suffix (",-…") that only place it.
function selectionOf(address) {
  const m = /:~:text=([^&]*)/.exec(address);
  if (!m) return '';
  const parts = m[1].split(',').filter((p) => !p.endsWith('-') && !p.startsWith('-'));
  const dec = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
  return parts.map(dec).join(' … ').replace(/\s+/g, ' ').trim();
}

const same = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };

// { text, url, title } as shared -> the same, the doubled address collapsed.
function share({ text, url, title } = {}) {
  const t = typeof text === 'string' ? text : '';
  const u = typeof url === 'string' ? url.trim() : '';
  const coded = [...t.matchAll(ADDRESS)].map((m) => trim(m[0])).concat(u ? [u] : []).find((a) => plainOf(a));
  if (!coded) return { text, url, title };
  const plain = plainOf(coded);
  // the text without the page's address, coded or plain, and without its quotes
  const rest = t.replace(ADDRESS, (m) => { const a = trim(m); return plainOf(a) || same(a, plain) ? m.slice(a.length) : m; })
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
    .replace(/^["“”„'«»]+|["“”„'«»]+$/g, '').trim();
  const out = { text: rest || selectionOf(coded), url: plain, title };
  console.log(`catch: a shared line with its address twice (plain and with the selection coded in); kept ${plain} once`);
  return out;
}

// Starts the fetch without waiting on it (the save has already answered).
function later(key, url) {
  if (!url) return;
  const id = Number(String(key).split(':')[1]);
  fillTitle(id, url).catch(() => {});
}

module.exports = { titleOf, fillTitle, later, guard, privateIp, share, plainOf, selectionOf };
