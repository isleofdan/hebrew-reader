// Page checks for hebrew-crash-one: crash reporting in the browser, against
// a local stand-in for Sentry (scripts/mock-sentry.mjs). Every page, with the
// server's DSN, loads /sentry.min.js and /crash.js from this site and sends
// an uncaught error to Sentry with its message and code location; nothing
// of the page goes with it (not its address or query, not a word it showed or
// logged or fetched, not the cookie). With no DSN a page sends nothing.
// An inline script's frames, named by the page's own address, go without its query.
//   node scripts/crash-pages.mjs   (npm run screenshots runs it; about 15 s)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8935, PLAIN_PORT = 8936, SENTRY_PORT = 8937, PROBE_PORT = 8938;
const PASS = 'open-sesame';
const DSN = `http://publickey@127.0.0.1:${SENTRY_PORT}/1`;
const WORD = 'שלום';
const dirs = [];
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, SENTRY_DSN: '', ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const reader = (port, env = {}) => { const d = mkdtempSync(join(tmpdir(), 'hr-crash-pages-')); dirs.push(d); return start(['server.js'], { PORT: String(port), DATA_DIR: d, APP_PASSWORD: PASS, COOKIE_SECRET: 'p'.repeat(64), COOKIE_INSECURE: '1', ...env }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };
const sentryUrl = `http://127.0.0.1:${SENTRY_PORT}`;
const events = async () => (await (await fetch(`${sentryUrl}/envelopes`)).json()).filter((e) => e.text.includes('"type":"event"'));
const eventFor = async (message) => {
  for (let i = 0; i < 50; i++) {
    const hit = (await events()).filter((e) => e.text.includes(message));
    if (hit.length) return hit;
    await wait(100);
  }
  return [];
};

// every HTML page in public/, by the address the reader serves it at
const PAGES = [
  ['login.html', '/login'], ['index.html', '/'], ['desk.html', '/desk'], ['phone.html', '/phone'], ['lookup.html', '/lookup'],
  ['today.html', '/today'], ['walks.html', '/walks'], ['study.html', '/study'], ['desk-sheet.html', '/desk/sheet/1'],
  ['guide.html', '/guide/1'], ['cards.html', '/cards.html'], ['lesson.html', '/lesson.html'], ['read.html', '/read.html'], ['sheet.html', '/sheet.html'],
];

let browser;
try {
  start(['scripts/mock-sentry.mjs', String(SENTRY_PORT)]);
  reader(PORT, { SENTRY_DSN: DSN });
  reader(PLAIN_PORT);
  const base = `http://127.0.0.1:${PORT}`, plainBase = `http://127.0.0.1:${PLAIN_PORT}`;
  await up(`${base}/health`); await up(`${plainBase}/health`); await up(`${sentryUrl}/envelopes`);
  const signIn = async (b) => (await fetch(`${b}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) })).headers.get('set-cookie').split(';')[0];
  browser = await chromium.launch({ executablePath: exe });
  const context = async (b, signedIn = true) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (signedIn) { const [n, v] = (await signIn(b)).split('='); await ctx.addCookies([{ name: n, value: v, domain: '127.0.0.1', path: '/' }]); }
    await ctx.route(/^https:\/\/fonts\./, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    return ctx;
  };

  // each page: both scripts from this site, answered 200, then an uncaught error reaching Sentry
  const ctx = await context(base);
  const page = await ctx.newPage();
  const loads = [];
  page.on('response', (r) => { const p = new URL(r.url()).pathname; if (p === '/sentry.min.js' || p === '/crash.js') loads.push(`${p} ${r.status()}`); });
  page.on('pageerror', () => {});
  const missed = [], unloaded = [];
  for (const [file, path] of PAGES) {
    loads.length = 0;
    await page.goto(base + path, { waitUntil: 'load' });
    if ([...loads].sort().join() !== '/crash.js 200,/sentry.min.js 200') unloaded.push(`${file}: ${loads.join(' ') || 'nothing'}`);
    const message = `page crash on ${file}`;
    await page.evaluate((m) => setTimeout(() => { throw new Error(m); }, 0), message);
    if ((await eventFor(message)).length !== 1) missed.push(file);
  }
  check(`every page (${PAGES.length}) loads /sentry.min.js and /crash.js from this site, each once, answered 200 (their order in the page: crash-smoke.mjs)`, unloaded.length === 0, unloaded.join('; '));
  check('…and on every page an uncaught error reaches Sentry as one event', missed.length === 0, `missed: ${missed.join(', ')}`);

  // what one page's crash carries: the error and its place, nothing of the page
  await page.goto(`${base}/lookup?q=${encodeURIComponent(WORD)}`, { waitUntil: 'load' });
  await page.evaluate(async (w) => {
    console.log(`looked up ${w}`);
    await fetch(`/health?w=${encodeURIComponent(w)}`);
    document.body.insertAdjacentHTML('beforeend', `<button id="probe" aria-label="${w}" title="${w}">${w}</button>`);
    document.getElementById('probe').click();
    history.pushState({}, '', `/lookup?again=${encodeURIComponent(w)}`);
    setTimeout(() => { throw new Error('page crash-test: the reader reports crashes'); }, 0);
  }, WORD);
  const [hit] = await eventFor('page crash-test: the reader reports crashes');
  const text = hit ? hit.text : '';
  const item = (() => { try { return JSON.parse(text.split('\n')[2]); } catch { return {}; } })();
  const ex = item.exception?.values?.[0] || {};
  check('a page\'s crash arrives with its message and code location (a stack frame in a script of this site)',
    ex.value === 'page crash-test: the reader reports crashes' && (ex.stacktrace?.frames || []).some((f) => (f.filename || '').startsWith(base)), JSON.stringify(ex).slice(0, 300));
  check('…environment production, and no request, user, transaction or extra', item.environment === 'production' && !('request' in item) && !('user' in item) && !('transaction' in item) && !('extra' in item), Object.keys(item).join());
  check('…and nothing of the page anywhere in what was sent: not the word it showed, logged, fetched or put in its address (plain or encoded), not a query, not the cookie',
    !!text && !text.includes(WORD) && !text.includes(encodeURIComponent(WORD)) && !text.includes('?q=') && !text.includes('?again=') && !text.includes('?w=') && !text.includes('hr_auth'));
  const crumbs = (item.breadcrumbs || []).map((b) => b.category);
  check('…its breadcrumbs carry no http, fetch, xhr, console, navigation or ui.* entry', !crumbs.some((c) => ['http', 'fetch', 'xhr', 'console', 'navigation'].includes(c) || String(c).startsWith('ui.')), crumbs.join());
  await ctx.close();

  // an inline script's error, on a page opened with a query: Chromium names its frames by the page's
  // own address (dev-check's finding on 15d54e2); they go without the query. The page is served by a
  // probe server of its own with this site's two scripts (a page fulfilled by Playwright's route
  // never got its envelope out), since no page of the reader throws from inline code on purpose
  const probeBase = `http://127.0.0.1:${PROBE_PORT}`;
  const probe = createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/sentry.min.js' || p === '/crash.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync(join(root, 'public', p))); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head>\n<meta name="sentry-dsn" content="${DSN}"><script src="/sentry.min.js"></script><script src="/crash.js"></script></head>`
      + '<body><script>\nfunction inlineGo() { throw new Error("inline crash-test"); }\nsetTimeout(inlineGo, 0);\n</script></body></html>');
  });
  await new Promise((r) => probe.listen(PROBE_PORT, '127.0.0.1', r));
  const ictx = await browser.newContext();
  const ipage = await ictx.newPage();
  ipage.on('pageerror', () => {});
  await ipage.goto(`${probeBase}/crash-probe.html?private=${encodeURIComponent(WORD)}&lesson=3#frag`, { waitUntil: 'load' });
  const [ihit] = await eventFor('inline crash-test');
  const itext = ihit ? ihit.text : '';
  const iframes = (() => { try { return JSON.parse(itext.split('\n')[2]).exception.values[0].stacktrace.frames; } catch { return []; } })();
  check('an inline script\'s crash on a page opened with a query arrives with its frame named by the page\'s address without the query or fragment, line kept',
    iframes.some((f) => f.filename === `${probeBase}/crash-probe.html` && f.lineno > 0) && !iframes.some((f) => /[?#]/.test(f.filename || '')), JSON.stringify(iframes));
  check('…and nothing of the query anywhere in what was sent (not the word, plain or encoded, not "private", not "lesson=")',
    !!itext && !itext.includes(WORD) && !itext.includes(encodeURIComponent(WORD)) && !itext.includes('private') && !itext.includes('lesson=') && !itext.includes('#frag'));
  await ictx.close();
  probe.close();

  // with no DSN the page sends nothing
  const before = (await events()).length;
  const pctx = await context(plainBase);
  const plain = await pctx.newPage();
  plain.on('pageerror', () => {});
  await plain.goto(`${plainBase}/desk`, { waitUntil: 'load' });
  const state = await plain.evaluate(() => ({ meta: !!document.querySelector('meta[name="sentry-dsn"]'), sdk: typeof window.Sentry }));
  await plain.evaluate(() => setTimeout(() => { throw new Error('page crash with no DSN'); }, 0));
  await wait(1500);
  check('with no DSN a page has no sentry-dsn tag, and its uncaught error sends nothing', !state.meta && state.sdk === 'object' && (await events()).length === before, JSON.stringify(state));
  await pctx.close();
} catch (e) {
  check('crash page checks ran to the end', false, e.stack);
} finally {
  if (browser) await browser.close();
  for (const k of kids) k.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(failed ? `${failed} crash page check(s) failed, ${passed} passed` : `all ${passed} crash page checks passed`);
process.exit(failed ? 1 : 0);
