'use strict';
// Turning what Dan pastes or links into an article: title, source, text.

const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { ReaderError } = require('./db');

const MIN_CHARS = 200;
const FETCH_TIMEOUT_MS = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

// The article as the reader lays it out: the headline as its own first line,
// then the text. The reader draws the headline with the same tokenizer as the
// body, so a headline word is a word of the piece everywhere else too, and
// because `sentenceSpan` stops at a line break, its sentence is the headline.
function asRead(article) {
  return `${article.title}\n${article.text}`;
}

function normalize(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A pasted article: the first line is the headline when it is short and
// something follows it; otherwise the headline is the first few words.
function fromText(raw) {
  const text = normalize(raw);
  if (!text) throw new ReaderError(400, 'text is empty. Paste the article text, or give a url.');
  const lines = text.split('\n').filter((l) => l.trim());
  let title, body;
  if (lines.length > 1 && lines[0].length <= 120) {
    title = lines[0].trim();
    body = normalize(text.slice(text.indexOf(lines[0]) + lines[0].length));
  } else {
    const words = text.split(/\s+/);
    title = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
    body = text;
  }
  return { title, source_url: null, text: body, thin: false };
}

async function fetchHtml(url) {
  let u;
  try { u = new URL(url); } catch { throw new ReaderError(400, `url is not a valid address: ${JSON.stringify(url)}.`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ReaderError(400, 'url must start with http:// or https://.');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(u, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hebrew-reader/0.1',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'he-IL,he;q=0.9,en;q=0.5',
      },
    });
  } catch (e) {
    throw new ReaderError(502, `Could not fetch ${u.href}: ${e.name === 'AbortError' ? 'timed out' : e.message}. Paste the text instead.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ReaderError(502, `Could not fetch ${u.href}: the site answered ${res.status}. Paste the text instead.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ReaderError(502, `The page at ${u.href} is over ${MAX_BYTES} bytes; paste the text instead.`);
  return { html: buf.toString('utf8'), finalUrl: res.url || u.href };
}

// Readability's main text; under MIN_CHARS the raw page text is kept and the
// answer is flagged `thin` so the page can say so.
async function fromUrl(url) {
  const { html, finalUrl } = await fetchHtml(url);
  const dom = new JSDOM(html, { url: finalUrl });
  const doc = dom.window.document;
  const pageTitle = (doc.querySelector('meta[property="og:title"]')?.content || doc.title || '').trim();
  let article = null;
  try { article = new Readability(doc.cloneNode(true)).parse(); } catch { article = null; }
  let text = article ? normalize(article.textContent) : '';
  let title = (article?.title || pageTitle || finalUrl).trim();
  let thin = false;
  if (text.length < MIN_CHARS) {
    thin = true;
    for (const el of doc.querySelectorAll('script, style, noscript, nav, header, footer, svg')) el.remove();
    text = normalize(doc.body ? doc.body.textContent : '');
    if (!text) throw new ReaderError(422, `Nothing readable was found at ${finalUrl}. Paste the text instead.`);
  }
  return { title, source_url: finalUrl, text, thin };
}

module.exports = { fromText, fromUrl, normalize, MIN_CHARS, asRead };
