// Server checks for hebrew-study-one: Study, the library from Sefaria
// (lib/library.js) — the contents, today's daf, a page, Dan's places, the
// refusals — against the real server with a stand-in Sefaria
// (scripts/mock-sefaria.mjs) and the stand-in model
// (scripts/mock-openrouter.mjs, which no Study route may reach). The walk
// stop's line count is checked here too, on a database made before the
// count existed. What turns on the clock (the contents refreshed after 30
// days, the Tokyo day) calls lib/library.js in this process with the clock
// set from here. About 3 s.
//   node scripts/study-smoke.mjs      (npm run smoke runs it)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8900, OR_PORT = 8901, SEF_PORT = 8902;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-study-'));
const libDir = mkdtempSync(join(tmpdir(), 'hr-study-lib-'));
const require = createRequire(import.meta.url);
const Database = require(join(root, 'node_modules', 'better-sqlite3'));

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

// A database as it stood before this session: a passage kept with no line
// count (the walks' table as hebrew-walks-one made it).
{
  const old = new Database(join(dataDir, 'reader.db'));
  old.exec('CREATE TABLE passages (ref TEXT PRIMARY KEY, title TEXT NOT NULL, he TEXT NOT NULL, en TEXT NOT NULL, url TEXT NOT NULL, fetched_at TEXT NOT NULL)');
  old.prepare('INSERT INTO passages VALUES (?, ?, ?, ?, ?, ?)').run('Ecclesiastes 1:9', 'Tanakh, Ecclesiastes 1:9', 'מַה־שֶּֽׁהָיָה֙', 'Only that shall happen', 'https://www.sefaria.org/Ecclesiastes.1.9', '2026-10-21T00:00:00.000Z');
  old.close();
}

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-sefaria.mjs', String(SEF_PORT)]);
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 's'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SEFARIA_URL: `http://127.0.0.1:${SEF_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const sef = `http://127.0.0.1:${SEF_PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;

try {
  await up(`${base}/health`); await up(`${mock}/calls`); await up(`${sef}/calls`);
  const sefCalls = async () => (await fetch(`${sef}/calls`)).json();
  const orCalls = async () => (await (await fetch(`${mock}/calls`)).json()).calls;
  const sefControl = (c) => fetch(`${sef}/control`, { method: 'POST', body: JSON.stringify(c) });
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const count = (table, where = '1=1', ...a) => peek(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a)[0].n;

  // --- signed out: the pages are pages, the data is data ---------------------------------
  const out = async (path) => { const r = await fetch(base + path, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; };
  const so = await Promise.all(['/study', '/study/Genesis.1', '/study/data/contents', '/study/data/page/Genesis.1'].map(out));
  check('signed out, GET /study and GET /study/Genesis.1 redirect to /login (303); /study/data/contents and /study/data/page/… answer 401',
    so[0].status === 303 && so[0].location === '/login' && so[1].status === 303 && so[1].location === '/login' && so[2].status === 401 && /Sign in first/.test(so[2].body) && so[3].status === 401,
    JSON.stringify(so.map((x) => [x.status, x.location])));
  check('…and signed out nothing was asked of Sefaria', (await sefCalls()).count === 0);

  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, accept: 'application/json' };
  const api = async (path) => { const res = await fetch(base + path, { headers: H }); return { status: res.status, body: await res.json() }; };
  const or0 = await orCalls();

  const pg1 = await fetch(`${base}/study`, { headers: { cookie } }), pg2 = await fetch(`${base}/study/Berakhot.2a`, { headers: { cookie } });
  check('signed in, GET /study and GET /study/Berakhot.2a serve the Study page (HTML) and ask Sefaria nothing',
    pg1.status === 200 && /<title>Hebrew reader · Study<\/title>/.test(await pg1.text()) && pg2.status === 200 && (pg2.headers.get('content-type') || '').includes('text/html') && (await sefCalls()).count === 0);
  check('the migration: passages gains `lines`, null for the passage kept before; the four Study tables exist and are empty',
    peek("SELECT lines FROM passages WHERE ref = 'Ecclesiastes 1:9'")[0].lines === null
    && ['library_contents', 'library_pages', 'library_calendar', 'study_places'].every((t) => count(t) === 0));

  // --- verify 1: the contents, in Sefaria's order, the counts from the stand-in -------------
  const places0 = await api('/study/data/places');
  check('no places yet: GET /study/data/places answers an empty list, state no data', places0.status === 200 && places0.body.items.length === 0 && places0.body.state === 'no data');
  const c1 = await api('/study/data/contents');
  const shapeOf = (corpus) => corpus.groups.map((g) => `${g.name}: ${g.books.map((b) => `${b.title}/${b.he}/${b.chapters ?? `${b.first}-${b.last}${b.missing.length ? ` without ${b.missing}` : ''}`}`).join(', ')}`).join(' | ');
  console.log(`     the contents: Tanakh ${shapeOf(c1.body.tanakh)}; Talmud ${shapeOf(c1.body.talmud)}`);
  check('GET /study/data/contents: the Tanakh as the stand-in groups it — Torah: Genesis (50 chapters), Writings: Ecclesiastes (12) — with Hebrew titles',
    c1.status === 200 && shapeOf(c1.body.tanakh) === 'Torah: Genesis/בראשית/50 | Writings: Ecclesiastes/קהלת/12', JSON.stringify(c1.body).slice(0, 400));
  check('…and the Talmud by order: Seder Zeraim: Berakhot 2a to 64a (127 sides from 1a), Seder Moed: Shabbat 2a to 157b with 3a empty',
    shapeOf(c1.body.talmud) === 'Seder Zeraim: Berakhot/ברכות/2a-64a | Seder Moed: Shabbat/שבת/2a-157b without 3a', shapeOf(c1.body.talmud));
  const asked1 = (await sefCalls()).asked;
  check('…from the two shapes (one request each), no other request', JSON.stringify(asked1) === '["shape:Tanakh","shape:Bavli"]', JSON.stringify(asked1));
  const c2 = await api('/study/data/contents');
  check('the contents are fetched once: a second GET makes no request to the stand-in', c2.status === 200 && (await sefCalls()).count === 2 && count('library_contents') === 2);

  // --- verify 1: today's daf ----------------------------------------------------------------
  const t1 = await api('/study/data/today');
  const tokyo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const calAsk = (await sefCalls()).asked.at(-1);
  check(`GET /study/data/today: Daf Yomi "Berakhot 2" as the stand-in names it, its Study page Berakhot 2a, for the Tokyo day (${tokyo})`,
    t1.status === 200 && t1.body.daf.name === 'Berakhot 2' && t1.body.daf.ref === 'Berakhot 2' && t1.body.daf.study === '/study/Berakhot.2a' && t1.body.day === tokyo && t1.body.daf_in_library === true,
    JSON.stringify(t1.body));
  check('…the week\'s portion from the same answer: "Bereshit", its Study page Genesis 1', t1.body.portion && t1.body.portion.name === 'Bereshit' && t1.body.portion.study === '/study/Genesis.1', JSON.stringify(t1.body.portion));
  const [y, mo, d] = tokyo.split('-').map(Number);
  check('…asked of /api/calendars with the timezone Asia/Tokyo and that day', calAsk === `calendars?timezone=Asia%2FTokyo&year=${y}&month=${mo}&day=${d}`, calAsk);
  const n1 = (await sefCalls()).count;
  await api('/study/data/today');
  check('…kept by its day: a second GET makes no request', (await sefCalls()).count === n1 && count('library_calendar') === 1);
  check('reading /study, the contents, today and the places wrote no place', count('study_places') === 0);

  // --- verify 2: a page ---------------------------------------------------------------------
  const p1 = await api('/study/data/page/Genesis.1');
  const L = p1.body.lines || [];
  console.log(`     Genesis 1: ${L.length} lines; line 1 ${JSON.stringify(L[0])}`);
  check('GET /study/data/page/Genesis.1: the canonical reference, the title, every line with its own reference, Hebrew and English',
    p1.status === 200 && p1.body.ref === 'Genesis 1' && p1.body.title === 'Genesis 1' && L.length === 5 && L.map((l) => l.ref).join() === 'Genesis 1:1,Genesis 1:2,Genesis 1:3,Genesis 1:4,Genesis 1:5'
    && L.every((l) => l.he && l.en), JSON.stringify(p1.body).slice(0, 300));
  check('…tags and footnotes stripped: no <big>, <b>, footnote marker or note; the words kept',
    L[0].he.startsWith('בְּרֵאשִׁ֖ית') && L[0].en === 'When God began to create heaven and earth—' && !L.some((l) => /[<>]/.test(l.he + l.en)) && !L.some((l) => /In contrast to others/.test(l.en)),
    JSON.stringify(L.slice(0, 2)));
  check('…uncut and from the stand-in only: "Genesis 1" asked once; prev none (the first book\'s first chapter), next Genesis 2; its sefaria.org page and its contents link',
    (await sefCalls()).asked.filter((a) => a === 'Genesis 1').length === 1 && p1.body.prev === null && p1.body.next.ref === 'Genesis 2' && p1.body.next.path === '/study/Genesis.2'
    && p1.body.url === 'https://www.sefaria.org/Genesis.1' && p1.body.contents === '/study?book=Genesis', JSON.stringify({ prev: p1.body.prev, next: p1.body.next, url: p1.body.url }));
  const n2 = (await sefCalls()).count;
  const p1b = await api('/study/data/page/Genesis%201');
  check('a page is fetched once: opening it again (as "Genesis 1") makes no request to the stand-in', p1b.status === 200 && p1b.body.ref === 'Genesis 1' && (await sefCalls()).count === n2 && count('library_pages') === 1);
  check('opening the page wrote one place, for its book', count('study_places') === 1 && peek('SELECT book, ref FROM study_places')[0].ref === 'Genesis 1');

  const g50 = await api('/study/data/page/Genesis.50');
  check('Next from the book\'s last chapter (Genesis 50, where Sefaria answers no next) is the next book\'s first chapter: Ecclesiastes 1',
    g50.status === 200 && g50.body.next && g50.body.next.ref === 'Ecclesiastes 1' && g50.body.next.path === '/study/Ecclesiastes.1' && g50.body.prev.ref === 'Genesis 49', JSON.stringify([g50.body.prev, g50.body.next]));
  const e1 = await api('/study/data/page/Ecclesiastes.1');
  check('…and Previous from Ecclesiastes 1 is Genesis 50', e1.body.prev && e1.body.prev.ref === 'Genesis 50', JSON.stringify(e1.body.prev));
  const b64 = await api('/study/data/page/Berakhot.64a');
  check('Next from the tractate\'s last page (Berakhot 64a) is the next tractate\'s first page: Shabbat 2a; a line\'s reference is "Berakhot 64a:2"',
    b64.status === 200 && b64.body.next && b64.body.next.ref === 'Shabbat 2a' && b64.body.next.path === '/study/Shabbat.2a' && b64.body.lines[1].ref === 'Berakhot 64a:2' && b64.body.corpus === 'Talmud', JSON.stringify(b64.body.next));
  const s2b = await api('/study/data/page/Shabbat.2b');
  check('…Next as Sefaria names it inside a tractate (Shabbat 2b -> 3b, past the empty 3a); Previous Shabbat 2a', s2b.body.next.ref === 'Shabbat 3b' && s2b.body.prev.ref === 'Shabbat 2a', JSON.stringify([s2b.body.prev, s2b.body.next]));
  const bk = await api('/study/data/page/Berakhot.2');
  check('a daf named whole ("Berakhot 2", as the Daf Yomi names it) opens at its first side, Berakhot 2a; nothing before it', bk.status === 200 && bk.body.ref === 'Berakhot 2a' && bk.body.prev === null, JSON.stringify([bk.status, bk.body.ref, bk.body.prev]));

  // --- verify 3: places -------------------------------------------------------------------
  const pl = await api('/study/data/places');
  check('places: one row per book, the page last opened, newest first (Berakhot 2a, Shabbat 2b, Ecclesiastes 1, Genesis 50)',
    pl.body.items.map((p) => `${p.book}=${p.ref}`).join(', ') === 'Berakhot=Berakhot 2a, Shabbat=Shabbat 2b, Ecclesiastes=Ecclesiastes 1, Genesis=Genesis 50'
    && pl.body.items[0].path === '/study/Berakhot.2a' && count('study_places') === 4, JSON.stringify(pl.body.items));

  // --- verify 5: refusals -----------------------------------------------------------------
  const nSef = (await sefCalls()).count;
  const r1 = await api('/study/data/page/Bereshit.1');
  check('an unknown book: 404 naming the books there are', r1.status === 404 && /There is no book named "Bereshit"/.test(r1.body.error) && /The Tanakh's books are Genesis, Ecclesiastes; the Talmud's tractates are Berakhot, Shabbat\./.test(r1.body.error), r1.body.error);
  const r2 = await api('/study/data/page/Genesis.51');
  check('a chapter past the book\'s end: 404 "Genesis has chapters 1 to 50"', r2.status === 404 && r2.body.error === 'Genesis has chapters 1 to 50; there is no chapter 51.', r2.body.error);
  const r3 = await api('/study/data/page/Berakhot.65a');
  check('a page past the tractate\'s end: 404 "Berakhot has pages 2a to 64a"', r3.status === 404 && r3.body.error === 'Berakhot has pages 2a to 64a; there is no page 65a.', r3.body.error);
  const r4 = await api('/study/data/page/Genesis.1a'), r5 = await api('/study/data/page/Shabbat.3a'), r6 = await api('/study/data/page/Berakhot.1b'), r7 = await api('/study/data/page/Genesis');
  check('a side on a chapter (Genesis 1a) 400, an empty side (Shabbat 3a) 404, a side before the first (Berakhot 1b) 404, a book alone 400 — each naming the valid range',
    r4.status === 400 && /Genesis has chapters 1 to 50/.test(r4.body.error) && r5.status === 404 && /Sefaria has no text for Shabbat 3a; Shabbat has pages 2a to 157b/.test(r5.body.error)
    && r6.status === 404 && /Berakhot has pages 2a to 64a/.test(r6.body.error) && r7.status === 400 && /Genesis has chapters 1 to 50/.test(r7.body.error),
    JSON.stringify([r4, r5, r6, r7].map((r) => [r.status, r.body.error])));
  check('…refused before any request to Sefaria, and no place written by a refusal', (await sefCalls()).count === nSef && count('study_places') === 4);

  // --- verify 4: Sefaria down ----------------------------------------------------------------
  await sefControl({ mode: 'reset' });
  const down1 = await api('/study/data/page/Ecclesiastes.5');
  check('Sefaria down: a page never kept answers 502 "Sefaria could not be reached"', down1.status === 502 && /^Sefaria could not be reached/.test(down1.body.error), JSON.stringify(down1));
  const down2 = await api('/study/data/page/Genesis.50');
  check('…a page kept is served from the record', down2.status === 200 && down2.body.ref === 'Genesis 50' && down2.body.lines.length === g50.body.lines.length);
  const down3 = await api('/study/data/contents');
  check('…the kept contents are served too', down3.status === 200 && down3.body.tanakh.groups.length === 2);
  await sefControl({ mode: 'ok' });
  check('…and the failed page kept nothing', count('library_pages', 'ref = ?', 'Ecclesiastes 5') === 0);

  // --- verify 6: no Study route reaches the model ------------------------------------------
  check(`no Study route made a request to the stand-in model (${or0} before, ${await orCalls()} after)`, (await orCalls()) === or0);

  // --- verify 7: the walk stop's line count and its Study link --------------------------------
  const post = async (path, body) => { const res = await fetch(`${base}${path}?wait=1`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const w1 = await post('/walks/start', { ref: 'Genesis.2' });
  const st1 = w1.body.stops && w1.body.stops[0];
  check('a walk from Genesis 2 (45 lines): the passage kept with its full count, 45; the stop served { lines: 45, shown: 40 } and its Study page /study/Genesis.2',
    w1.status === 200 && peek("SELECT lines FROM passages WHERE ref = 'Genesis 2'")[0].lines === 45 && st1 && st1.passage.lines === 45 && st1.passage.shown === 40 && st1.passage.study === '/study/Genesis.2'
    && st1.passage.he.split('\n').length === 40, JSON.stringify(st1 && { ...st1.passage, he: undefined, en: undefined }));
  const w2 = await post('/walks/start', { ref: 'Ecclesiastes 1:9' });
  const st2 = w2.body.stops && w2.body.stops[0];
  check('a walk from a passage kept before the count (Ecclesiastes 1:9): no count (null), so no "First 40" line, and its Study page /study/Ecclesiastes.1',
    w2.status === 200 && st2 && st2.passage.lines === null && st2.passage.study === '/study/Ecclesiastes.1' && peek("SELECT lines FROM passages WHERE ref = 'Ecclesiastes 1:9'")[0].lines === null,
    JSON.stringify(st2 && { ...st2.passage, he: undefined, en: undefined }));
  const w3 = await post('/walks/start', { ref: 'Shabbat 112b' });
  check('a Talmud passage (Shabbat 112b, 2 lines): its count 2 and its Study page /study/Shabbat.112b', w3.status === 200 && w3.body.stops[0].passage.lines === 2 && w3.body.stops[0].passage.study === '/study/Shabbat.112b', JSON.stringify(w3.body.stops && w3.body.stops[0].passage.study));

  // --- in this process, with the clock set: the 30-day refresh, the day, Sefaria down ----------
  process.env.SEFARIA_URL = sef;
  const db = require(join(root, 'lib', 'db.js'));
  db.open(libDir);
  const library = require(join(root, 'lib', 'library.js'));
  const DAY = 24 * 3600 * 1000;
  let at = Date.parse('2026-10-22T03:00:00Z');
  library.setClock(() => at);
  const before = (await sefCalls()).count;
  const k1 = await library.contents();
  const shapes = async () => (await sefCalls()).asked.slice(before).filter((a) => a.startsWith('shape:')).length;
  check('in this process: the contents fetched on the first ask (two shapes)', (await shapes()) === 2 && k1.tanakh.groups[0].books[0].chapters === 50);
  await sefControl({ lengths: { Genesis: 51 } });
  at += 29 * DAY;
  const k2 = await library.contents();
  check('29 days on: the kept contents, no request (Genesis still 50)', (await shapes()) === 2 && k2.tanakh.groups[0].books[0].chapters === 50);
  at += 2 * DAY;
  const k3 = await library.contents();
  check('31 days on: the next ask refetches them (two more shapes) and the new length shows (Genesis 51)', (await shapes()) === 4 && k3.tanakh.groups[0].books[0].chapters === 51 && Date.parse(k3.tanakh.fetched_at) === at);
  at += 31 * DAY;
  await sefControl({ mode: 'reset' });
  let k4, k4e = null;
  try { k4 = await library.contents(); } catch (e) { k4e = e; }
  check('31 more days with Sefaria down: the kept copy served (Genesis 51), no failure', !k4e && k4.tanakh.groups[0].books[0].chapters === 51, k4e && k4e.message);
  let te = null;
  try { await library.today(); } catch (e) { te = e; }
  check('…today\'s daf for a day never fetched, Sefaria down: 502 "Sefaria could not be reached"', te && te.status === 502 && /^Sefaria could not be reached/.test(te.message), te && te.message);
  await sefControl({ mode: 'ok', lengths: { Genesis: 50 }, daf: 'Mishnah Oholot 11:8' });
  at = Date.parse('2026-12-31T16:00:00Z'); // 1 January in Tokyo, still 31 December in London
  const td = await library.today();
  check('the day is Tokyo\'s (16:00 UTC on 31 Dec is 1 Jan there)', td.day === '2027-01-01', td.day);
  check('a Daf Yomi outside the Tanakh and the Talmud (Mishnah Oholot 11:8) has no Study page and links to its sefaria.org page instead',
    td.daf.study === null && td.daf_in_library === false && td.daf.url === 'https://www.sefaria.org/Mishnah_Oholot.11.8', JSON.stringify(td.daf));
  await sefControl({ daf: 'Berakhot 2' });
  check('pageHolding: a passage\'s first line\'s page (Genesis 1:1-3 -> Genesis 1, Shabbat 112b -> Shabbat 112b, Berakhot 2a:3-5 -> Berakhot 2a), none outside (Pirkei Avot 1:1)',
    library.pageHolding('Genesis 1:1-3') === 'Genesis 1' && library.pageHolding('Shabbat 112b') === 'Shabbat 112b' && library.pageHolding('Berakhot 2a:3-5') === 'Berakhot 2a' && library.pageHolding('Pirkei Avot 1:1') === null);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  if (failed) console.log(server.log.split('\n').slice(-30).join('\n'));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(libDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} study check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} study checks passed`);
