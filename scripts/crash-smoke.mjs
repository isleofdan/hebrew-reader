// Server checks for hebrew-crash-one: crash reporting to Sentry. With no DSN
// lib/crash.js loads no SDK and does nothing, and the server starts and
// serves as before; the scrub both sides share drops the request, the user,
// the transaction name and the breadcrumbs that carry addresses, logs or page
// text, and keeps the exception; POST /crash-test answers 401 signed out and
// 500 signed in; every page in public/ loads /sentry.min.js and /crash.js
// before its own scripts; the committed bundle is what `npm run build` makes;
// and, with a DSN pointing at a local stand-in for Sentry
// (scripts/mock-sentry.mjs), the crash arrives with its message and code
// location and nothing of the request (no address, no query, no cookie, no
// log line).
//   node scripts/crash-smoke.mjs   (npm test runs it; about 3 s)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { sentryBundle } from './build-sentry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8930, DSN_PORT = 8931, SENTRY_PORT = 8932;
const PASS = 'open-sesame';
const DSN = `http://publickey@127.0.0.1:${SENTRY_PORT}/1`;
const require = createRequire(import.meta.url);
const dirs = [];

const kids = [];
function start(cmd, args, env = {}) {
  const k = spawn(cmd, args, { cwd: root, env: { ...process.env, SENTRY_DSN: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  k.log = '';
  k.stdout.on('data', (d) => k.log += d);
  k.stderr.on('data', (d) => k.log += d);
  kids.push(k);
  return k;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { await fetch(url); return; } catch { await wait(100); } }
  throw new Error(`nothing answered at ${url}`);
}
let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}
function reader(port, env = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'hr-crash-'));
  dirs.push(dataDir);
  return start('node', ['server.js'], { PORT: String(port), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'c'.repeat(64), COOKIE_INSECURE: '1', ...env });
}
async function signIn(base) {
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  return login.headers.get('set-cookie').split(';')[0];
}
const J = { accept: 'application/json' };
const PAGES = readdirSync(join(root, 'public')).filter((f) => f.endsWith('.html')).sort();

try {
  // --- lib/crash.js with no DSN (in this process, SENTRY_DSN unset) ----------------------------
  delete process.env.SENTRY_DSN;
  const crash = require(join(root, 'lib', 'crash.js'));
  const loaded = Object.keys(require.cache).filter((k) => k.includes(`${join('node_modules', '@sentry')}`));
  check('with no SENTRY_DSN, lib/crash.js is off and loads no Sentry module', crash.enabled === false && loaded.length === 0, loaded.join(', '));
  let threw = null, back;
  try { back = crash.captureException(new Error('nothing to send')); await crash.flush(10); } catch (e) { threw = e; }
  check('…and captureException and flush are functions that do nothing (no throw, nothing answered)', typeof crash.captureException === 'function' && typeof crash.flush === 'function' && threw === null && back === undefined, String(threw));

  // --- the scrub (public/crash.js, shared by lib/crash.js) -------------------------------------
  const page = require(join(root, 'public', 'crash.js'));
  check('the server and the pages scrub with the same function (lib/crash.js takes it from public/crash.js)', crash.scrub === page.scrub);
  const crumbs = () => ['http', 'fetch', 'xhr', 'console', 'navigation', 'ui.click', 'ui.input', 'sentry.event', 'custom']
    .map((category) => ({ category, message: `${category}: /lookup?q=שלום` }));
  const exception = { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [{ filename: '/app/server.js', function: 'handle', lineno: 12 }] } }] };
  const event = () => ({
    event_id: 'e1', exception: structuredClone(exception), level: 'error',
    request: { url: 'https://hebrew-reader-dan.fly.dev/lookup?q=שלום', headers: { cookie: 'hr_auth=x' }, data: '{"surface":"שלום"}' },
    user: { ip_address: '1.2.3.4', id: 'dan' }, transaction: 'GET /english/run', extra: { arguments: [{ target: 'שלום' }] }, breadcrumbs: crumbs(),
  });
  const out = page.scrub(event());
  check('the scrub deletes event.request (the address, its query, the headers and cookie, the body)', !('request' in out));
  check('…deletes event.user', !('user' in out));
  check('…deletes event.transaction (a route\'s path can carry a word)', !('transaction' in out));
  check('…deletes event.extra (a wrapped callback\'s arguments)', !('extra' in out));
  check('…drops every breadcrumb of category http, fetch, xhr and console', !out.breadcrumbs.some((b) => ['http', 'fetch', 'xhr', 'console'].includes(b.category)));
  check('…and navigation and ui.* (addresses, and an element\'s labels), keeping the others (sentry.event, custom)',
    out.breadcrumbs.map((b) => b.category).join() === 'sentry.event,custom', out.breadcrumbs.map((b) => b.category).join());
  check('…and keeps the exception whole (type, message, code location) and the event id and level',
    JSON.stringify(out.exception) === JSON.stringify(exception) && out.event_id === 'e1' && out.level === 'error');
  const older = page.scrub({ exception: structuredClone(exception), breadcrumbs: { values: crumbs() } });
  check('…the same for breadcrumbs in the { values } shape', older.breadcrumbs.values.map((b) => b.category).join() === 'sentry.event,custom');
  check('…and an event with no request, user or breadcrumbs passes through with its exception', JSON.stringify(page.scrub({ exception: structuredClone(exception) })) === JSON.stringify({ exception }));
  const S = page.SETTINGS;
  check('the settings both sides pass Sentry.init: environment production, sendDefaultPii false, tracesSampleRate 0, no replay (both replay rates 0), beforeSend the scrub',
    S.environment === 'production' && S.sendDefaultPii === false && S.tracesSampleRate === 0 && S.replaysSessionSampleRate === 0 && S.replaysOnErrorSampleRate === 0 && S.beforeSend === page.scrub);

  // --- public/crash.js in a page (a stand-in window) -------------------------------------------
  const src = readFileSync(join(root, 'public', 'crash.js'), 'utf8');
  const inPage = (dsn) => {
    const inits = [];
    const window = { Sentry: { init: (o) => inits.push(o) } };
    const document = { querySelector: (q) => (q === 'meta[name="sentry-dsn"]' && dsn ? { getAttribute: (a) => (a === 'content' ? dsn : null) } : null) };
    vm.runInNewContext(src, { window, document });
    return inits;
  };
  const inits = inPage(DSN);
  check('in a page with <meta name="sentry-dsn">, crash.js calls Sentry.init once with that DSN and the shared settings',
    inits.length === 1 && inits[0].dsn === DSN && inits[0].sendDefaultPii === false && inits[0].tracesSampleRate === 0 && inits[0].replaysSessionSampleRate === 0 && inits[0].environment === 'production' && typeof inits[0].beforeSend === 'function');
  check('…its beforeSend drops the request, user and breadcrumbs as on the server', (() => { const e = inits[0].beforeSend(event()); return !e.request && !e.user && e.breadcrumbs.length === 2 && e.exception.values[0].value === 'boom'; })());
  check('in a page with no DSN, crash.js does nothing (no Sentry.init)', inPage('').length === 0);
  let noSdk = null;
  try { vm.runInNewContext(src, { window: {}, document: { querySelector: () => ({ getAttribute: () => DSN }) } }); } catch (e) { noSdk = e; }
  check('…and with a DSN but no Sentry on the page (the bundle missing), crash.js does nothing and does not throw', noSdk === null, String(noSdk));

  // --- the bundle --------------------------------------------------------------------------------
  const committed = readFileSync(join(root, 'public', 'sentry.min.js'), 'utf8');
  check('public/sentry.min.js is what `npm run build` makes from the installed @sentry/browser (byte for byte)', committed === await sentryBundle());
  const win = {};
  win.window = win; win.self = win; win.globalThis = win;
  vm.runInNewContext(committed, win);
  check('…and run in a page it sets window.Sentry to { init, captureException } only', Object.keys(win.Sentry || {}).sort().join() === 'captureException,init');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  check('@sentry/node and @sentry/browser are dependencies (major 11), and `npm run build` builds the bundle',
    /^\^11\./.test(pkg.dependencies['@sentry/node'] || '') && /^\^11\./.test(pkg.dependencies['@sentry/browser'] || '') && pkg.scripts.build === 'node scripts/build-sentry.mjs');

  // --- the pages ----------------------------------------------------------------------------------
  const order = PAGES.map((f) => {
    const html = readFileSync(join(root, 'public', f), 'utf8');
    const srcs = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => (/src="([^"]*)"/.exec(m[1]) || [, '(inline)'])[1]);
    return { f, srcs };
  });
  const bad = order.filter(({ srcs }) => srcs[0] !== '/sentry.min.js' || srcs[1] !== '/crash.js' || srcs.filter((s) => s === '/crash.js').length !== 1);
  check(`every HTML page in public/ (${PAGES.length}) loads /sentry.min.js then /crash.js before any script of its own`, PAGES.length >= 14 && bad.length === 0, bad.map((b) => `${b.f}: ${b.srcs.slice(0, 3).join(' ')}`).join('; '));
  const foreign = order.flatMap(({ f, srcs }) => srcs.filter((s) => s !== '(inline)' && !s.startsWith('/')).map((s) => `${f}: ${s}`));
  check('…and every page still loads scripts only from its own paths (no script from another site)', foreign.length === 0, foreign.join('; '));
  const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
  check('public/sw.js still keeps no copy of anything (no cache list to add the new files to)', !/caches\.|addAll|cache\.put/.test(sw));

  // --- the server with no DSN ---------------------------------------------------------------------
  const plain = reader(PORT);
  const base = `http://127.0.0.1:${PORT}`;
  await up(`${base}/health`);
  const health = await (await fetch(`${base}/health`)).json();
  check('with no DSN the server starts as before (/health { ok, configured })', health.ok === true && health.configured === true);
  const loginPage = await (await fetch(`${base}/login`)).text();
  check('…and its pages carry no sentry-dsn meta tag', !loginPage.includes('sentry-dsn'));
  const jsOpen = await fetch(`${base}/crash.js`), bundleOpen = await fetch(`${base}/sentry.min.js`);
  check('/crash.js and /sentry.min.js are served signed out (the login page loads them), as JavaScript',
    jsOpen.status === 200 && bundleOpen.status === 200 && /javascript/.test(jsOpen.headers.get('content-type')) && (await bundleOpen.text()) === committed);
  const out401 = await fetch(`${base}/crash-test`, { method: 'POST', headers: J });
  const out401Page = await fetch(`${base}/crash-test`, { method: 'POST', redirect: 'manual' });
  check('POST /crash-test answers 401 signed out (also without accept: application/json, not a redirect)', out401.status === 401 && out401Page.status === 401);
  const cookie = await signIn(base);
  const out500 = await fetch(`${base}/crash-test`, { method: 'POST', headers: { ...J, cookie } });
  const body500 = await out500.json();
  check('POST /crash-test answers 500 signed in, with the error\'s message', out500.status === 500 && body500.error === 'crash-test: the reader reports crashes', `${out500.status} ${JSON.stringify(body500)}`);
  const getTest = await fetch(`${base}/crash-test`, { headers: { ...J, cookie } });
  check('…and only to POST (GET /crash-test is 404)', getTest.status === 404);
  await wait(100);
  check('…the route catch still logs the error with its stack (console.error kept)', plain.log.includes('Error: crash-test: the reader reports crashes') && plain.log.includes('server.js'));

  // --- the server with a DSN (a local stand-in for Sentry) ----------------------------------------
  start('node', ['scripts/mock-sentry.mjs', String(SENTRY_PORT)]);
  const sentryUrl = `http://127.0.0.1:${SENTRY_PORT}`;
  await up(`${sentryUrl}/envelopes`);
  const live = reader(DSN_PORT, { SENTRY_DSN: DSN });
  const dbase = `http://127.0.0.1:${DSN_PORT}`;
  await up(`${dbase}/health`);
  const dLogin = await (await fetch(`${dbase}/login`)).text();
  check('with a DSN, the login page carries <meta name="sentry-dsn" content="<the DSN>"> right after <head>', dLogin.includes(`<head>\n<meta name="sentry-dsn" content="${DSN}">`));
  const dcookie = await signIn(dbase);
  const desk = await fetch(`${dbase}/desk`, { headers: { cookie: dcookie } });
  const deskHtml = await desk.text();
  check('…and so does a page served from public/ (/desk), with its length right', deskHtml.includes(`<meta name="sentry-dsn" content="${DSN}">`) && Number(desk.headers.get('content-length')) === Buffer.byteLength(deskHtml));
  const word = 'שלום';
  const crashed = await fetch(`${dbase}/crash-test?q=${encodeURIComponent(word)}`, { method: 'POST', headers: { ...J, cookie: dcookie, 'content-type': 'application/json' }, body: JSON.stringify({ surface: word }) });
  check('with a DSN, POST /crash-test still answers 500 signed in', crashed.status === 500);
  let events = [];
  for (let i = 0; i < 50 && events.length === 0; i++) {
    await wait(100);
    events = (await (await fetch(`${sentryUrl}/envelopes`)).json()).filter((e) => e.text.includes('"type":"event"'));
  }
  const text = events.map((e) => e.text).join('\n');
  check('the crash reaches the stand-in Sentry as one event', events.length === 1, `${events.length} events`);
  const item = (() => { try { return JSON.parse(events[0].text.split('\n')[2]); } catch { return {}; } })();
  const ex = item.exception?.values?.[0] || {};
  check('…with its message and code location (an Error, "crash-test: the reader reports crashes", a stack frame in server.js)',
    ex.type === 'Error' && ex.value === 'crash-test: the reader reports crashes' && (ex.stacktrace?.frames || []).some((f) => /server\.js$/.test(f.filename || '')));
  check('…environment production', item.environment === 'production');
  check('…and no request, user, transaction or extra', !('request' in item) && !('user' in item) && !('transaction' in item) && !('extra' in item), Object.keys(item).join());
  check('…nothing of the request anywhere in what was sent: not the word (plain or encoded), the query, the cookie, the body or the path with its query',
    !text.includes(word) && !text.includes(encodeURIComponent(word)) && !text.includes('?q=') && !text.includes('hr_auth') && !text.includes(dcookie.split('=')[1]) && !text.includes('surface'));
  check('…and no console breadcrumb (the server\'s own log lines, such as "database: …", are not sent)', !text.includes('database:') && !text.includes('listening on'));
  check('…while the route catch still logs the error itself', live.log.includes('Error: crash-test: the reader reports crashes'));
  const otherEnvelopes = (await (await fetch(`${sentryUrl}/envelopes`)).json()).filter((e) => !e.text.includes('"type":"event"'));
  check('…and nothing else is sent (no transaction, session or replay envelope)', otherEnvelopes.length === 0, otherEnvelopes.map((e) => e.text.split('\n')[1]).join(' | '));
} catch (e) {
  check('crash checks ran to the end', false, e.stack);
} finally {
  for (const k of kids) k.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log(failed ? `${failed} crash check(s) failed, ${passed} passed` : `all ${passed} crash checks passed`);
process.exit(failed ? 1 : 0);
