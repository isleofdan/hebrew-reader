// Server checks for hebrew-lookup-one: a reference shown inside the reader
// (GET /reference/<id>: framed, or a cleaned copy kept seven days, or the
// failure), and the Look up page's routes — against local stand-ins for
// OpenRouter, the spine and the seven reference sites.
//   node scripts/lookup-smoke.mjs   (npm test runs it; not in the fast set:
//   the 20-second fetch limit is checked for real, so it takes about 25 s)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8850, OR_PORT = 8851, SPINE_PORT = 8852, REF_PORT = 8853;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-lookup-'));

const kids = [];
function start(cmd, args, env = {}) {
  const k = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start('node', ['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;

try {
  await up(`${base}/health`); await up(`http://127.0.0.1:${OR_PORT}/calls`); await up(`http://127.0.0.1:${SPINE_PORT}/api/health`); await up(`${standin}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const control = (c) => fetch(`${standin}/control`, { method: 'POST', body: JSON.stringify(c) });
  const refCalls = async () => (await fetch(`${standin}/calls`)).json();
  const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const enc = encodeURIComponent;

  // --- step 2: GET /reference/<id> ---------------------------------------------------------
  const signedOut = await fetch(`${base}/reference/pealim?term=x`, { headers: { accept: 'application/json' } });
  check('the reference route is behind the passphrase (401 signed out)', signedOut.status === 401);
  const frame = await api('GET', `/reference/wiktionary?term=${enc('להמר')}`);
  check('a framed reference answers { mode: frame, url } with the live link, and fetches nothing',
    frame.status === 200 && frame.body.mode === 'frame' && frame.body.url === `https://he.wiktionary.org/w/index.php?search=${enc('להמר')}` && !(await refCalls()).wiktionary, JSON.stringify(frame.body));
  const modes = {};
  for (const id of ['morfix', 'pealim', 'wiktionary', 'milog', 'academy', 'kizur', 'sefaria']) {
    if (['wiktionary', 'milog', 'sefaria'].includes(id)) modes[id] = (await api('GET', `/reference/${id}?term=${enc('להמר')}`)).body.mode;
  }
  check('Wiktionary, Milog and Sefaria are framed (step 1\'s embed)', Object.values(modes).every((m) => m === 'frame'), JSON.stringify(modes));

  const copy = await api('GET', `/reference/pealim?term=${enc('להמר')}`);
  const h = copy.body.html || '';
  check('a copy reference answers { mode: copy, html, fetched_at, url }, url the live page',
    copy.status === 200 && copy.body.mode === 'copy' && /^\d{4}-\d{2}-\d{2}T/.test(copy.body.fetched_at) && copy.body.url === `https://www.pealim.com/search/?q=${enc('להמר')}` && copy.body.stored === false, JSON.stringify({ ...copy.body, html: h.length }));
  check('the copy keeps the text, the headings and the table', h.includes('<h1>להמר</h1>') && h.includes('<h2>Conjugation</h2>') && /<table class="forms">[\s\S]*יהמר/.test(h));
  check('the copy has no script tag, inline or linked', !/<script/i.test(h), h.slice(0, 300));
  check('the copy has no inline event handler (onload, onclick, onmouseover)', !/\son(load|click|mouseover)=/i.test(h));
  check('the copy has no form controls, no frame, no javascript: link, no comment (a script kept in one included)', !/<(input|button|iframe|form)\b/i.test(h) && !/javascript:/i.test(h) && !h.includes('<!--') && !h.includes('google_ad_client'));
  check('false-rejection: text inside a form is kept when the form is stripped', h.includes('kept text inside a form: להמר means to bet'));
  check('links are absolute on the live site and open in a new tab; images absolute',
    h.includes('href="https://www.pealim.com/word/2" target="_blank" rel="noopener noreferrer"') && h.includes('src="https://www.pealim.com/img/logo.png"'), (h.match(/<a [^>]*class="rel"[^>]*>/) || [''])[0]);
  check('false-rejection: the span that carried the handlers keeps its text', /<span class="handler">tap me<\/span>/.test(h));
  check('the copy is stored in reference_pages (reference, term, html, fetched_at)',
    peek('SELECT reference, term, fetched_at FROM reference_pages').map((r) => `${r.reference}:${r.term}`).join() === 'pealim:להמר');
  const before = (await refCalls()).pealim;
  const again = await api('GET', `/reference/pealim?term=${enc('להמר')}`);
  check('a stored copy is served again without a second fetch', again.body.mode === 'copy' && again.body.stored === true && again.body.html === h && (await refCalls()).pealim === before, JSON.stringify({ before, after: (await refCalls()).pealim }));
  // eight days old: fetched again, and the row replaced
  { const Dw = new Database(join(dataDir, 'reader.db')); Dw.prepare("UPDATE reference_pages SET fetched_at = ? WHERE reference = 'pealim'").run(new Date(Date.now() - 8 * 86400000).toISOString()); Dw.close(); }
  const stale = await api('GET', `/reference/pealim?term=${enc('להמר')}`);
  check('a copy older than seven days is fetched again (once) and replaces the stored one',
    stale.body.stored === false && (await refCalls()).pealim === before + 1 && peek("SELECT COUNT(*) AS n FROM reference_pages WHERE reference = 'pealim'")[0].n === 1);
  const six = await (async () => { const Dw = new Database(join(dataDir, 'reader.db')); Dw.prepare("UPDATE reference_pages SET fetched_at = ? WHERE reference = 'pealim'").run(new Date(Date.now() - 6 * 86400000).toISOString()); Dw.close(); return api('GET', `/reference/pealim?term=${enc('להמר')}`); })();
  check('a copy six days old is still served from the database', six.body.stored === true && (await refCalls()).pealim === before + 1);

  await control({ academy: 'status:403', kizur: 'reset' });
  const refused = await api('GET', `/reference/academy?term=${enc('להמר')}`);
  check('a site that answers 403 -> { mode: failed, url, reason }, nothing stored',
    refused.body.mode === 'failed' && refused.body.url === `https://hebrew-academy.org.il/?s=${enc('להמר')}` && /403/.test(refused.body.reason) && !peek("SELECT * FROM reference_pages WHERE reference = 'academy'").length, JSON.stringify(refused.body));
  const reset = await api('GET', `/reference/kizur?term=${enc('צה"ל')}`);
  check('a dropped connection -> failed, and the live link is http for Kizur', reset.body.mode === 'failed' && reset.body.url === `http://www.kizur.co.il/search_word.php?abbr=${enc('צה"ל')}`, JSON.stringify(reset.body));
  await control({ milog: 'status:202', morfix: 'blank' });
  const w202 = await api('GET', `/reference/pealim?term=${enc('לזנק')}`);
  await control({ pealim: 'status:202' });
  const c202 = await api('GET', `/reference/pealim?term=${enc('לזנק2')}`);
  const blank = await api('GET', `/reference/morfix?term=${enc('לזנק')}`);
  check('a 202 (Morfix\'s bot check) and a 200 with no text are failures, not copies; nothing stored',
    w202.body.mode === 'copy' && c202.body.mode === 'failed' && /202/.test(c202.body.reason) && blank.body.mode === 'failed' && /no text/.test(blank.body.reason)
    && !peek("SELECT * FROM reference_pages WHERE term IN ('לזנק2') OR reference = 'morfix'").length, JSON.stringify([c202.body, blank.body]));
  await control({ kizur: 'page', pealim: 'page', morfix: 'page', milog: 'page' });
  const retry = await api('GET', `/reference/kizur?term=${enc('צה"ל')}`);
  check('a failure is not kept: the next tap fetches again, and a word with gershayim (צה"ל) is fetched and stored as typed',
    retry.body.mode === 'copy' && retry.body.html.includes('<h1>צה"ל</h1>') && peek("SELECT term FROM reference_pages WHERE reference = 'kizur'")[0].term === 'צה"ל');

  // the 20-second limit: a hang fails within it, a slow healthy answer (10 s) is kept
  await control({ morfix: 'hang', academy: 'slow', slow_ms: 10000 });
  const t0 = Date.now();
  const [hung, slow] = await Promise.all([
    api('GET', `/reference/morfix?term=${enc('להמר')}`).then((r) => ({ ...r, s: (Date.now() - t0) / 1000 })),
    api('GET', `/reference/academy?term=${enc('להמר')}`).then((r) => ({ ...r, s: (Date.now() - t0) / 1000 })),
  ]);
  check('a stand-in that hangs returns failed at the 20-second limit (not before 19 s, not after 23 s)',
    hung.body.mode === 'failed' && /20 s/.test(hung.body.reason) && hung.s >= 19 && hung.s < 23, JSON.stringify({ ...hung.body, s: hung.s }));
  check('false-rejection: a stand-in that answers after 10 s still returns the copy (the limit stays quiet on a slow healthy answer)',
    slow.body.mode === 'copy' && slow.s >= 9.5 && slow.s < 15 && slow.body.html.includes('<h1>להמר</h1>'), JSON.stringify({ mode: slow.body.mode, reason: slow.body.reason, s: slow.s }));
  check('the pane line the page shows on failure has the reason in plain words', /^The site did not answer: /.test(hung.body.reason));
  await control({ morfix: 'page', academy: 'page' });

  // two taps at once make one fetch
  const n0 = (await refCalls()).morfix || 0;
  const [p1, p2] = await Promise.all([api('GET', `/reference/morfix?term=${enc('לסכן')}`), api('GET', `/reference/morfix?term=${enc('לסכן')}`)]);
  check('two taps on the same reference and word at once make one fetch', p1.body.mode === 'copy' && p2.body.mode === 'copy' && (await refCalls()).morfix === n0 + 1, JSON.stringify({ n0, n: (await refCalls()).morfix }));
  const bad = await api('GET', '/reference/google?term=x'), noTerm = await api('GET', '/reference/pealim?term=%20'), long = await api('GET', `/reference/pealim?term=${'א'.repeat(101)}`);
  check('an unknown reference, an empty word and a word over 100 characters are refused (400, says why)',
    bad.status === 400 && /morfix/.test(bad.body.error) && noTerm.status === 400 && long.status === 400, JSON.stringify([bad.body, noTerm.body, long.body]));
  check('nothing was fetched ahead: each reference was asked only on a tap',
    JSON.stringify(await refCalls()) === JSON.stringify({ pealim: 4, academy: 2, kizur: 2, morfix: 3 }), JSON.stringify(await refCalls()));
  check('the server log names each copy fetched and each failure', /reference pealim "להמר": copy fetched in \d+ ms/.test(server.log) && /reference morfix "להמר": not fetched after \d+ ms: no answer in 20 s/.test(server.log));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(server.log.split('\n').slice(-30).join('\n')); console.log(`\n${failed} lookup check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} lookup checks passed`);
