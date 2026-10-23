'use strict';
// A reference shown inside the reader (hebrew-lookup-one): the pane under a
// card's "Look up in" row and the tabs of the Look up page. A reference
// whose site allows being framed (`embed: 'frame'` in lib/references.js) is
// framed directly; one that refuses (`embed: 'copy'`) is fetched by this
// server when Dan taps — pull only, never ahead — cleaned, kept seven days in
// `reference_pages`, and shown in a sandboxed frame.
//
// The cleaned copy keeps text, headings, tables and images; it loses every
// script, inline event handler and form control (a <form> is unwrapped so
// what it holds stays), and every link is made absolute and opens the live
// site in a new tab — the one place the reader opens a new tab.

const { JSDOM, VirtualConsole } = require('jsdom');
const db = require('./db');
const { ReaderError } = db;
const refs = require('./references');

const FETCH_MS = 20000;               // the fetch of a reference page stops here
const KEEP_MS = 7 * 24 * 3600 * 1000; // a stored copy is served for seven days
const MAX_BYTES = 3 * 1024 * 1024;
const TERM_MAX = 100;
// Local checks only: every reference is fetched (and framed) from this
// stand-in instead of the live site, at <STANDIN>/<reference id>/<term>.
const STANDIN = process.env.REFERENCE_STANDIN || '';

const DROP = 'script, noscript, iframe, frame, frameset, object, embed, applet, base, meta[http-equiv], input, button, select, textarea, option, datalist, output, dialog, template, portal';

// The cleaned copy of a page fetched from `pageUrl`: links and images
// absolute, links opening the live site in a new tab, nothing that runs.
function clean(html, pageUrl) {
  // the page's own stylesheets are not read here, so their parse errors are not ours to log
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  for (const e of doc.querySelectorAll(DROP)) e.remove();
  // comments go too (Kizur keeps an old ad script inside one)
  const it = doc.createNodeIterator(doc, dom.window.NodeFilter.SHOW_COMMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.remove();
  // a form's controls go; what it holds (often the whole page) stays
  for (const f of doc.querySelectorAll('form')) f.replaceWith(...f.childNodes);
  for (const e of doc.querySelectorAll('*')) {
    for (const a of [...e.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'formaction' || n === 'srcdoc' || n === 'ping') e.removeAttribute(a.name);
      else if (['href', 'src', 'action', 'poster', 'background', 'xlink:href'].includes(n) && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) e.removeAttribute(a.name);
    }
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    let abs;
    try { abs = new URL(a.getAttribute('href'), pageUrl).href; } catch { a.removeAttribute('href'); continue; }
    if (!/^https?:/.test(abs)) { if (!abs.startsWith('mailto:')) a.removeAttribute('href'); continue; }
    a.setAttribute('href', abs);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  for (const img of doc.querySelectorAll('img[src], source[src], img[srcset], source[srcset]')) {
    if (img.getAttribute('src')) { try { img.setAttribute('src', new URL(img.getAttribute('src'), pageUrl).href); } catch { img.removeAttribute('src'); } }
    if (img.getAttribute('srcset')) {
      img.setAttribute('srcset', img.getAttribute('srcset').split(',').map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        try { return [new URL(u, pageUrl).href, ...rest].join(' '); } catch { return ''; }
      }).filter(Boolean).join(', '));
    }
  }
  for (const l of doc.querySelectorAll('link')) {
    const rel = (l.getAttribute('rel') || '').toLowerCase();
    if (rel.split(/\s+/).includes('stylesheet') && l.getAttribute('href')) {
      try { l.setAttribute('href', new URL(l.getAttribute('href'), pageUrl).href); } catch { l.remove(); }
    } else l.remove();
  }
  const text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
  const out = dom.serialize();
  dom.window.close();
  if (!text) throw new Error('its page held no text (a bot check, not the entry)');
  return out;
}

// The page's characters: the charset its answer or its <meta> names, else UTF-8.
function decode(buf, contentType) {
  let cs = (/charset=([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

// The redirect gate: a fetched page is taken only when the address it ended
// at (after any redirects) is on the reference's own site, by its host
// (the site's domain or any subdomain of it, so www and non-www alike, http
// or https). Anything else is refused. Read from the reference's own domain
// (as lib/references.js forUrl reads it) so the English sites, which are no
// tab, are gated the same way (hebrew-english-one).
function sameSite(ref, url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return host === ref.domain || host.endsWith(`.${ref.domain}`);
}

// The site address a fetch ended at. Live, the answer's own address. With
// the stand-in (local checks), the stand-in's address is read back as the
// one it stands for: <STANDIN>/site/<scheme>/<host>/<path> is
// <scheme>://<host>/<path>, and <STANDIN>/<id>/<term> the reference's own
// link — so the gate runs on the checks' redirects as it does live.
function siteAddress(finalUrl, live) {
  if (!STANDIN || !String(finalUrl).startsWith(`${STANDIN}/`)) return finalUrl;
  const m = /^\/site\/(https?)\/([^/]+)(\/.*)?$/.exec(finalUrl.slice(STANDIN.length));
  return m ? `${m[1]}://${m[2]}${m[3] || '/'}` : live;
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return String(u); } };

// Fetches the reference's page for a term: { html, url } or throws with a
// short reason. Stops at FETCH_MS, a slow healthy answer included.
function fetchPage(ref, term) {
  return fetchFrom(ref, ref.url(term), `${STANDIN}/${ref.id}/${encodeURIComponent(term)}`);
}

// Any address on a reference's site, with the same browser-like request, the
// same limit and the same redirect gate (hebrew-english-one: Pealim's
// English search and entries, English Wiktionary's API). `standin` is where
// the local checks' stand-in answers for it; `accept` what is asked for.
async function fetchFrom(ref, live, standin, accept = 'text/html,application/xhtml+xml') {
  const from = STANDIN ? standin : live;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(from, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hebrew-reader/0.1',
        'accept': accept,
        'accept-language': 'he-IL,he;q=0.9,en;q=0.5',
      },
    });
    // a redirect may only stay on the reference's own site
    const site = siteAddress(res.url, live);
    if (!sameSite(ref, site)) throw new Error(`it sent the request on to another site (${hostOf(site)})`);
    // only a page itself: a 202 is Morfix's bot check, not its entry
    if (res.status !== 200) throw new Error(`it answered ${res.status}${res.headers.get('x-amzn-waf-action') ? ` (a ${res.headers.get('x-amzn-waf-action')} page)` : ''}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`its page is over ${MAX_BYTES / 1024 / 1024} MB`);
    if (!buf.length) throw new Error('its page was empty');
    return { html: decode(buf, res.headers.get('content-type')), url: site };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `no answer in ${FETCH_MS / 1000} s` : e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const running = new Map(); // reference + term -> the fetch under way, so two taps make one fetch

// GET /reference/<id>?term=<word>:
//   { mode: 'frame', url }                              the site's page, framed
//   { mode: 'copy', html, fetched_at, url, stored }     a cleaned copy (stored: served from the database)
//   { mode: 'failed', url, reason }                     the fetch failed; nothing stored
// `url` is always the live page, for "open the site".
async function pane(id, rawTerm) {
  const ref = refs.byId(id);
  if (!ref) throw new ReaderError(400, `reference must be one of ${refs.REFERENCES.map((r) => r.id).join(', ')}; got ${JSON.stringify(id)}.`);
  const term = String(rawTerm || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!term) throw new ReaderError(400, 'term is required: the word to look up.');
  if (term.length > TERM_MAX) throw new ReaderError(400, `term is at most ${TERM_MAX} characters; this one has ${term.length}.`);
  const live = ref.url(term);
  const base = { reference: ref.id, label: ref.label, term };
  if (ref.embed === 'frame') return { ...base, mode: 'frame', url: live, ...(STANDIN ? { frame_url: `${STANDIN}/${ref.id}/${encodeURIComponent(term)}` } : {}) };
  return copyOf(ref, term, live, () => fetchPage(ref, term), base);
}

// hebrew-english-one: a Pealim entry a row of an English look-up names
// (its path on pealim.com, as the results table links it), shown as a copy
// the way the Pealim tab is: fetched on Dan's tap, kept seven days in
// `reference_pages` under its path (a path starts with "/", so it never
// meets a word). With the stand-in, at <STANDIN>/site/https/www.pealim.com<path>.
async function entryPane(path) {
  const site = refs.ENGLISH.pealim;
  if (!site.isEntry(path)) throw new ReaderError(400, `path is a Pealim entry, as /dict/<number>-<name>/; got ${JSON.stringify(path)}.`);
  const live = site.entry(path);
  const base = { reference: 'pealim', label: 'Pealim', term: path };
  return copyOf(refs.byId('pealim'), path, live, () => fetchFrom(refs.byId('pealim'), live, `${STANDIN}/site/https/www.pealim.com${path}`), base);
}

// A copy: kept, or fetched once (two taps at once make one fetch).
function copyOf(ref, term, live, fetchIt, base) {
  const kept = db.getReferencePage(ref.id, term);
  if (kept && Date.now() - Date.parse(kept.fetched_at) < KEEP_MS) return { ...base, mode: 'copy', html: kept.html, fetched_at: kept.fetched_at, url: live, stored: true };
  const k = `${ref.id}\n${term}`;
  if (!running.has(k)) {
    running.set(k, (async () => {
      const t0 = Date.now();
      try {
        const page = await fetchIt();
        const row = db.putReferencePage({ reference: ref.id, term, html: clean(page.html, page.url) });
        console.log(`reference ${ref.id} "${term}": copy fetched in ${Date.now() - t0} ms, kept seven days`);
        return { ...base, mode: 'copy', html: row.html, fetched_at: row.fetched_at, url: live, stored: false };
      } catch (e) {
        console.error(`reference ${ref.id} "${term}": not fetched after ${Date.now() - t0} ms: ${e.message}`);
        return { ...base, mode: 'failed', url: live, reason: e.message };
      }
    })().finally(() => running.delete(k)));
  }
  return running.get(k);
}

module.exports = { pane, entryPane, fetchFrom, clean, sameSite, siteAddress, FETCH_MS, KEEP_MS, STANDIN };
