'use strict';
// The Hebrew reader: one plain Node server.
//   /login (GET, POST), /logout, /health  — open
//   everything else                        — behind the passphrase cookie
// Fail closed: with APP_PASSWORD or COOKIE_SECRET unset, only the login page
// serves, and it says the server is not configured.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const auth = require('./lib/auth');
const db = require('./lib/db');
const articles = require('./lib/articles');
const lookup = require('./lib/lookup');
const spine = require('./lib/spine');
const demand = require('./lib/demand');
const askRefs = require('./lib/ask');
const lesson = require('./lib/lesson');
const guyLesson = require('./lib/guy-lesson');
const { CATEGORIES } = require('./lib/categories');
const ratelimit = require('./lib/ratelimit');
const { sendJson, sendHtml, redirect, readJson, readFile, serveStatic } = require('./lib/http');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const { APP_PASSWORD, COOKIE_SECRET } = process.env;
const SECURE_COOKIE = process.env.COOKIE_INSECURE !== '1';
const CONFIGURED = Boolean(APP_PASSWORD && COOKIE_SECRET);

if (!CONFIGURED) {
  const missing = ['APP_PASSWORD', 'COOKIE_SECRET'].filter((k) => !process.env[k]);
  console.error(`not configured: ${missing.join(', ')} unset. Only the login page will serve.`);
}

const LOGIN_TEMPLATE = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(res, status, message = '') {
  sendHtml(res, status, LOGIN_TEMPLATE.replace('{{MESSAGE}}', escapeHtml(message)));
}

const NOT_CONFIGURED = 'This server is not configured: APP_PASSWORD or COOKIE_SECRET is unset. Set both and restart.';

function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json')
    || (req.headers['content-type'] || '').includes('application/json');
}

async function handleLogin(req, res) {
  if (!CONFIGURED) {
    return wantsJson(req) ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  }
  const wait = ratelimit.lockedFor(req);
  if (wait > 0) {
    const msg = `Too many wrong passphrases. Wait ${Math.ceil(wait / 60)} minute(s) and try again.`;
    return wantsJson(req) ? sendJson(res, 429, { error: msg, retry_after_s: wait }, { 'retry-after': String(wait) })
      : loginPage(res, 429, msg);
  }
  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  if (!auth.passwordOk(body.passphrase, APP_PASSWORD)) {
    ratelimit.recordFailure(req);
    const msg = `Wrong passphrase. ${ratelimit.MAX_ATTEMPTS} wrong tries in ${Math.round(ratelimit.WINDOW_MS / 60000)} minutes lock this address.`;
    return wantsJson(req) ? sendJson(res, 401, { error: msg }) : loginPage(res, 401, msg);
  }
  ratelimit.clear(req);
  const headers = { 'set-cookie': auth.issueCookie(COOKIE_SECRET, { secure: SECURE_COOKIE }) };
  return wantsJson(req) ? sendJson(res, 200, { ok: true }, headers) : redirect(res, '/', headers);
}

// Routes that need the cookie.
const api = [];
function route(method, pattern, run) { api.push({ method, pattern, run }); }

// --- the map against an article --------------------------------------------

// surface -> { spot_id, status, hint } for every surface the cards cache has
// a spot for. The client tints the words it finds. An article no card was
// ever opened in gets an empty map: every word plain, nothing said.
route('GET', /^\/marks-for-article\/(?<id>\d+)$/, (req, res, { id }) => {
  db.getArticle(id);
  const surfaces = db.marksForSurfaces();
  return sendJson(res, 200, { article_id: Number(id), surfaces, lemmas: db.marksForLemmas(), state: Object.keys(surfaces).length ? 'ok' : 'no data' });
});

// --- the card ---------------------------------------------------------------

// { surface, sentence, article_id | lesson_id } -> { card, spot, cached }.
route('POST', /^\/lookup$/, async (req, res) => {
  const body = await readJson(req);
  const articleId = body.article_id ? Number(body.article_id) : null;
  if (articleId) db.getArticle(articleId);
  const lessonId = body.lesson_id ? Number(body.lesson_id) : null;
  if (lessonId) db.getLesson(lessonId);
  const answer = await lookup.lookup({ surface: body.surface, sentence: body.sentence, article_id: articleId, lesson_id: lessonId });
  return sendJson(res, 200, answer);
});

route('GET', /^\/categories$/, (req, res) => sendJson(res, 200, { items: CATEGORIES, state: 'ok' }));

// --- spots (the map) --------------------------------------------------------

route('GET', /^\/spots$/, (req, res, g, url) => {
  const status = url.searchParams.get('status');
  return sendJson(res, 200, db.listSpots(status ? { status } : {}));
});

route('GET', /^\/spots\/(?<id>.+)$/, (req, res, { id }) => sendJson(res, 200, db.requireSpot(decodeURIComponent(id))));

// { status } -> the spot. Status must be one of new, shaky, solid.
route('POST', /^\/spots\/(?<id>.+)$/, async (req, res, { id }) => {
  const body = await readJson(req);
  const spot = db.setSpotStatus(decodeURIComponent(id), body.status);
  console.log(`spot ${spot.id}: ${spot.status}`);
  const recorded = await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) });
  return sendJson(res, 200, { spot, spine: recorded });
});

// --- the demand (the phone page) --------------------------------------------

// One item: a sentence Dan has read with the verb blanked. ?after=<spot id>
// skips that spot. No item -> { state: "no data", reason }.
route('GET', /^\/demand$/, async (req, res, g, url) => {
  const after = url.searchParams.get('after') || null;
  return sendJson(res, 200, await demand.next({ after }));
});

// { spot_id, article_id, surface, typed } -> { ok, surface, card, spot, spine }
route('POST', /^\/demand\/check$/, async (req, res) => sendJson(res, 200, await demand.check(await readJson(req))));

// { spot_id, article_id, surface } -> { surface, card, spot, spine }
route('POST', /^\/demand\/show$/, async (req, res) => sendJson(res, 200, await demand.show(await readJson(req))));

// --- the ask surface --------------------------------------------------------

// { question, article_id? } -> { answer, links, references, state }
route('POST', /^\/ask$/, async (req, res) => sendJson(res, 200, await askRefs.ask(await readJson(req))));

// --- make from recent reading -----------------------------------------------

// ?articles=<N, default 5>: a Markdown download of every spot touched two or
// more times across the N most recent articles; &format=json for the print page.
route('GET', /^\/make\/lesson$/, (req, res, g, url) => {
  const sheet = lesson.build(url.searchParams.get('articles'));
  if (url.searchParams.get('format') === 'json') return sendJson(res, 200, sheet);
  const md = lesson.markdown(sheet);
  const day = sheet.made_at.slice(0, 10);
  res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="lesson-sheet-${day}.md"`,
    'cache-control': 'no-store',
  });
  res.end(md);
  console.log(`lesson: ${sheet.count} word(s) from ${sheet.articles.length} article(s), as markdown`);
});

// --- articles ---------------------------------------------------------------

route('GET', /^\/articles$/, (req, res) => sendJson(res, 200, db.listArticles()));

route('GET', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, db.getArticle(id)));

// The article goes; its touches stay (without the article) and its spots keep
// their status. Nothing is sent to the spine.
route('DELETE', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => {
  const out = db.deleteArticle(id);
  console.log(`article ${id}: deleted (touches and spots kept)`);
  return sendJson(res, 200, out);
});

// { text } (pasted) or { url }. Answers the stored article plus `thin` when a
// url gave under 200 characters of main text and the raw page text was kept.
route('POST', /^\/articles$/, async (req, res) => {
  const body = await readJson(req);
  const hasText = typeof body.text === 'string' && body.text.trim() !== '';
  const hasUrl = typeof body.url === 'string' && body.url.trim() !== '';
  if (!hasText && !hasUrl) throw new db.ReaderError(400, 'Give either text (the pasted article) or url (its address).');
  const drafted = hasText ? articles.fromText(body.text) : await articles.fromUrl(body.url.trim());
  const stored = db.addArticle(drafted);
  console.log(`article ${stored.id}: "${stored.title}" (${stored.text.length} chars${drafted.thin ? ', thin' : ''}${stored.source_url ? ', from ' + stored.source_url : ', pasted'})`);
  return sendJson(res, 201, { ...stored, thin: drafted.thin });
});

// --- lessons from Guy ------------------------------------------------------

route('GET', /^\/lessons$/, (req, res) => sendJson(res, 200, db.listLessons()));

// A PDF as multipart/form-data, field "file", at most 5 MB. Answers 201 with
// the lesson and a note saying where its title and date came from; 200 with
// the lesson already stored when the same items were uploaded before.
route('POST', /^\/lessons$/, async (req, res) => {
  const { fileName, bytes } = await readFile(req, 'file', guyLesson.MAX_BYTES + 64 * 1024);
  const out = await guyLesson.add({ fileName, bytes });
  const { text, ...lessonOut } = out.lesson;
  return sendJson(res, out.created ? 201 : 200, { ...lessonOut, created: out.created, title_from: out.from || null, note: out.note });
});

// The lesson with its items, its guide when built, and the guide's state:
// none, building, built, or failed (with the one-line reason).
route('GET', /^\/lessons\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, guyLesson.view(id)));

// Builds the guide on first open; { rebuild: true } replaces the one there.
// The build runs in the background: 202 while it runs, 200 when the guide was
// already there and no rebuild was asked for.
// The lesson, its items and its guide go; its touches and spots stay.
route('DELETE', /^\/lessons\/(?<id>\d+)$/, (req, res, { id }) => {
  const out = guyLesson.remove(id);
  console.log(`lesson ${id}: deleted (touches and spots kept)`);
  return sendJson(res, 200, out);
});

route('POST', /^\/lessons\/(?<id>\d+)\/guide$/, async (req, res, { id }) => {
  const body = await readJson(req);
  const state = guyLesson.startGuide(id, { rebuild: body.rebuild === true || body.rebuild === 'true' });
  return sendJson(res, state === 'building' ? 202 : 200, guyLesson.view(id));
});

// The same surface map as an article's, for the lesson page's tints.
route('GET', /^\/marks-for-lesson\/(?<id>\d+)$/, (req, res, { id }) => {
  db.getLesson(id);
  const surfaces = db.marksForSurfaces();
  return sendJson(res, 200, { lesson_id: Number(id), surfaces, lemmas: db.marksForLemmas(), state: Object.keys(surfaces).length ? 'ok' : 'no data' });
});

function isApiPath(p) {
  return /^\/(articles|lookup|spots|marks-for-article|marks-for-lesson|categories|demand|ask|make|lessons)(\/|$)/.test(p);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return sendJson(res, 200, { ok: true, configured: CONFIGURED });
  if (p === '/login' && req.method === 'GET') return loginPage(res, CONFIGURED ? 200 : 503, CONFIGURED ? '' : NOT_CONFIGURED);
  if (p === '/login' && req.method === 'POST') return handleLogin(req, res);
  if (p === '/logout') return redirect(res, '/login', { 'set-cookie': auth.clearCookie({ secure: SECURE_COOKIE }) });

  if (!CONFIGURED) return isApiPath(p) ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  if (!auth.cookieOk(req, COOKIE_SECRET)) {
    return isApiPath(p) ? sendJson(res, 401, { error: 'Sign in first: POST /login with the passphrase.' }) : redirect(res, '/login');
  }

  for (const route of api) {
    const m = route.method === req.method && route.pattern.exec(p);
    if (m) {
      try {
        return await route.run(req, res, m.groups || {}, url);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        return sendJson(res, status, { error: e.message });
      }
    }
  }

  if (isApiPath(p)) return sendJson(res, 404, { error: `No route ${req.method} ${p}.` });
  if (p === '/') return serveStatic(res, PUBLIC, '/index.html') || sendJson(res, 404, { error: 'index.html is missing.' });
  if (p === '/login.html') return redirect(res, '/login');
  if (p === '/phone') return serveStatic(res, PUBLIC, '/phone.html') || sendJson(res, 404, { error: 'phone.html is missing.' });
  if (serveStatic(res, PUBLIC, p)) return;
  return sendJson(res, 404, { error: `Nothing at ${p}.` });
}

db.open(DATA_DIR);
console.log(`database: ${path.join(DATA_DIR, 'reader.db')}`);

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  });
});

server.listen(PORT, () => console.log(`hebrew-reader listening on ${PORT}${CONFIGURED ? '' : ' (NOT CONFIGURED)'}`));

module.exports = { api };
