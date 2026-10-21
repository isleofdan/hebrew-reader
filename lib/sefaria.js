'use strict';
// A passage from Sefaria, the open library of Jewish texts (hebrew-walks-one).
// The walks' guide never writes a text out: it names a reference, and the
// server fetches the Hebrew and the English here, keeps them in `passages`,
// and gives them to the guide and to Dan.
//
// The interface is Sefaria's Texts API, version 3 (developers.sefaria.org,
// "Texts (v3)"): GET /api/v3/texts/<reference>?version=hebrew&version=english
// answers the canonical reference (`ref`), its book's category, and
// `versions`, one per language asked for, each with `text` — one segment, or
// a list of segments (lists inside lists for a range across sections), with
// HTML inside (<b>, <i>, <big>, and footnotes as a <sup class="footnote-marker">
// followed by an <i class="footnote">). A reference it does not know answers
// 404 with {"error": "Could not find title in reference: …"}.
// The address of the passage's page on sefaria.org is built from the
// canonical reference by lib/references.js (the Sefaria entry's `passage`).

const db = require('./db');
const { ReaderError } = db;
const refs = require('./references');

// The base address, the real one by default; the checks point it at the
// stand-in (scripts/mock-sefaria.mjs), as OPENROUTER_URL does for the model.
const SEFARIA_URL = (process.env.SEFARIA_URL || 'https://www.sefaria.org').replace(/\/+$/, '');
const FETCH_MS = 20000;   // the time limit of the server's other outside fetches
const REF_MAX = 200;
const SEGMENTS_MAX = 40;  // a long reference (a whole chapter) is cut here; "Full passage" has the rest
const UNREACHABLE = 'Sefaria could not be reached';

// "Shabbat 112b": one space between words, nothing around.
function cleanRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) throw new ReaderError(400, 'ref is required: a text reference Sefaria knows, such as Shabbat 112b or Genesis 1:1-3.');
  const t = ref.normalize('NFC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > REF_MAX) throw new ReaderError(400, `ref is at most ${REF_MAX} characters; this one has ${t.length}.`);
  return t;
}

// Every segment of a text, in order: a string, or lists of them at any depth.
function segments(text) {
  if (typeof text === 'string') return [text];
  if (!Array.isArray(text)) return [];
  return text.flatMap(segments);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ' };

// One segment as plain text: footnotes (marker and note) gone, every other
// tag dropped with its words kept, entities read, spaces tidied.
function plain(html) {
  let s = String(html || '');
  s = s.replace(/<sup\b[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '');
  // a footnote is an <i class="footnote"> that may hold <i> of its own
  for (let at = s.search(/<i\b[^>]*class="[^"]*footnote[^"]*"[^>]*>/i); at >= 0; at = s.search(/<i\b[^>]*class="[^"]*footnote[^"]*"[^>]*>/i)) {
    const tag = /<\/?i\b[^>]*>/gi;
    tag.lastIndex = at;
    let depth = 0, end = s.length;
    for (let m = tag.exec(s); m; m = tag.exec(s)) {
      depth += m[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    }
    s = s.slice(0, at) + s.slice(end);
  }
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s.replace(/[ \t ]+/g, ' ').trim();
}

// The text of one language as lines, one per segment (verse, line of the
// page), the empty ones left out.
function textOf(versions, language) {
  const v = (versions || []).find((x) => x && x.language === language);
  if (!v) return '';
  return segments(v.text).map(plain).filter(Boolean).slice(0, SEGMENTS_MAX).join('\n');
}

// The passage's title in English: its kind of book and its reference, as the
// guide names a passage ("Talmud, Shabbat 112b").
function titleOf(body, ref) {
  const cat = typeof body.primary_category === 'string' ? body.primary_category.trim() : '';
  return cat ? `${cat}, ${ref}` : ref;
}

// One GET to Sefaria: { status, body } or a 502 when it cannot be reached
// or does not answer in time.
async function ask(ref) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(`${SEFARIA_URL}/api/v3/texts/${encodeURIComponent(ref)}?version=hebrew&version=english`, {
      signal: ac.signal,
      headers: { accept: 'application/json', 'user-agent': 'hebrew-reader/0.1 (one reader; https://hebrew-reader-dan.fly.dev)' },
    });
    const raw = await res.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { body = null; }
    return { status: res.status, body };
  } catch (e) {
    throw new ReaderError(502, `${UNREACHABLE} (${e.name === 'AbortError' ? `no answer in ${FETCH_MS / 1000} s` : e.cause ? e.cause.code || e.cause.message : e.message}).`);
  } finally {
    clearTimeout(timer);
  }
}

const running = new Map(); // reference -> the fetch under way, so two asks make one fetch

// passage(ref) -> { ref, title, he, en, url }: the canonical reference as
// Sefaria gives it back, the title, the Hebrew and the English as plain text
// (a line per segment), and the page on sefaria.org. Kept passages are served
// from `passages` with no request. A reference Sefaria does not know answers
// 404 naming it; Sefaria down or slow, 502.
async function passage(rawRef) {
  const asked = cleanRef(rawRef);
  const page = refs.byId('sefaria').passage(asked);
  const kept = db.getPassage(asked, page);
  if (kept) return shape(kept);
  if (!running.has(asked)) {
    running.set(asked, (async () => {
      const t0 = Date.now();
      const { status, body } = await ask(asked);
      const said = body && typeof body.error === 'string' ? body.error.trim() : '';
      if (status === 404 || status === 400 || (status === 200 && said)) {
        console.log(`sefaria: "${asked}" not known (${status}${said ? `: ${said}` : ''})`);
        throw new ReaderError(404, `Sefaria does not know the reference "${asked}"${said ? ` (${said})` : ''}. A reference is a book and a place in it, such as Shabbat 112b, Genesis 1:1-3 or Pirkei Avot 1:1.`);
      }
      if (status !== 200 || !body || typeof body.ref !== 'string') throw new ReaderError(502, `${UNREACHABLE} (it answered ${status}).`);
      const he = textOf(body.versions, 'he');
      const en = textOf(body.versions, 'en');
      if (!he && !en) throw new ReaderError(404, `Sefaria has no Hebrew or English text for "${body.ref}".`);
      const ref = body.ref.trim();
      const row = db.putPassage({ ref, title: titleOf(body, ref), he, en, url: refs.byId('sefaria').passage(ref) });
      console.log(`sefaria: "${asked}" -> ${ref} fetched in ${Date.now() - t0} ms, kept`);
      return shape(row);
    })().finally(() => running.delete(asked)));
  }
  return running.get(asked);
}

function shape(row) {
  return { ref: row.ref, title: row.title, he: row.he, en: row.en, url: row.url };
}

module.exports = { passage, plain, segments, cleanRef, FETCH_MS, UNREACHABLE };
