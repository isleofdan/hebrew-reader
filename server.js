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
const ratelimit = require('./lib/ratelimit');
const { sendJson, sendHtml, redirect, readJson, serveStatic } = require('./lib/http');

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

// --- articles ---------------------------------------------------------------

route('GET', /^\/articles$/, (req, res) => sendJson(res, 200, db.listArticles()));

route('GET', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, db.getArticle(id)));

route('DELETE', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, db.deleteArticle(id)));

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

function isApiPath(p) {
  return /^\/(articles|lookup|spots|marks-for-article)(\/|$)/.test(p);
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
