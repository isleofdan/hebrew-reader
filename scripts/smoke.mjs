// End-to-end check against local mocks of OpenRouter and the spine.
//   node scripts/smoke.mjs
// Starts the two mocks and the server on free ports, then walks the brief's
// verify list: the gate and its lock, an article by paste and by url (a local
// page), the card, the cache, the marks, the spine record.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tok = (await import('../public/tokenize.js')).default;

const PORT = 8790, OR_PORT = 8791, SPINE_PORT = 8792, PAGE_PORT = 8793;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-smoke-'));

// A database in session one's shape (no spots.on_spine), with one shaky and
// one new spot already in it, so the migration on start can be checked.
{
  const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
  const old = new Database(join(dataDir, 'reader.db'));
  old.exec(`CREATE TABLE spots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, root TEXT, binyan TEXT, lemma TEXT,
              status TEXT NOT NULL CHECK (status IN ('new','shaky','solid')), categories_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
            INSERT INTO spots VALUES ('v:ק.ב.ע:nifal', 'verb', 'ק.ב.ע', 'nifal', 'נקבע', 'shaky', '["conjugation"]', '2026-09-22T00:00:00.000Z');
            INSERT INTO spots VALUES ('w:ישן', 'word', null, null, 'ישן', 'new', '[]', '2026-09-22T00:00:00.000Z');`);
  old.close();
}
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
async function up(url, tries = 40) {
  for (let i = 0; i < tries; i++) { try { await fetch(url); return; } catch { await wait(100); } }
  throw new Error(`nothing answered at ${url}`);
}

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

// a local page that stands in for a news site
const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');
const [sampleTitle, ...sampleParas] = sample.trim().split('\n');
const page = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="he"><head><title>${sampleTitle} - מעריב</title><meta property="og:title" content="${sampleTitle}"></head>
<body><nav><a href="/">בית</a><a href="/x">כלכלה</a></nav><header>מעריב · כלכלה</header>
<article><h1>${sampleTitle}</h1>${sampleParas.map((p) => `<p>${p}</p>`).join('')}</article>
<footer>כל הזכויות שמורות</footer></body></html>`);
}).listen(PAGE_PORT);

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, LOGIN_WINDOW_MS: '3000',
});
const base = `http://127.0.0.1:${PORT}`;

try {
  await up(`${base}/health`);
  await up(`http://127.0.0.1:${OR_PORT}/calls`);
  await up(`http://127.0.0.1:${SPINE_PORT}/api/health`);

  // 1. the gate
  let r = await fetch(`${base}/login`);
  check('login page draws', r.status === 200 && (await r.text()).includes('Passphrase'));
  r = await fetch(`${base}/`, { redirect: 'manual' });
  check('index without cookie redirects to /login', r.status === 303 && r.headers.get('location') === '/login');
  r = await fetch(`${base}/articles`);
  check('api without cookie answers 401', r.status === 401);
  const wrong = (h = {}) => fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ passphrase: 'nope' }) });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await wrong()).status);
  check('wrong passphrase 6x: five 401 then 429', codes.join(',') === '401,401,401,401,401,429', codes.join(','));
  r = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  check('correct passphrase while locked is not checked (429)', r.status === 429);
  await wait(3200);
  r = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `passphrase=${PASS}`, redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  check('correct passphrase after the window lands on the index with a cookie', r.status === 303 && r.headers.get('location') === '/' && cookie.startsWith('hr_auth='));
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };

  // 2. articles
  let a = await api('GET', '/articles');
  check('no articles: state "no data"', a.body.state === 'no data' && a.body.items.length === 0);
  const pasted = await api('POST', '/articles', { text: sample });
  check('article by paste stored with headline', pasted.status === 201 && pasted.body.title === sampleTitle && !pasted.body.thin, pasted.body.error);
  const byUrl = await api('POST', '/articles', { url: `http://127.0.0.1:${PAGE_PORT}/economy/article/1` });
  check('article by url extracted (local page standing in for a news site)', byUrl.status === 201 && byUrl.body.title === sampleTitle && byUrl.body.text.includes('שנאלצה') && !byUrl.body.text.includes('כל הזכויות'), byUrl.body.error || `title=${byUrl.body.title}`);
  const stored = (await api('GET', `/articles/${pasted.body.id}`)).body;
  const wordsStored = tok.count(stored.text);
  check('word count of stored text is known for the page check', wordsStored > 50, `${wordsStored} words`);
  const bad = await api('POST', '/articles', {});
  check('empty add refused with the fix named', bad.status === 400 && /text|url/.test(bad.body.error), bad.body.error);
  const marks0 = await api('GET', `/marks-for-article/${stored.id}`);
  check('article with no marks: empty map, state "no data"', marks0.body.state === 'no data');

  // 3. the card
  const calls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).calls;
  const c0 = await calls();
  const sentence = tok.sentenceAt(stored.text, stored.text.indexOf('נאלצה'));
  const look1 = await api('POST', '/lookup', { surface: 'נאלצה', sentence, article_id: stored.id });
  check('card for נאלצה: root א.ל.צ, nifal, a meaning, a category', look1.status === 200 && look1.body.card.root === 'א.ל.צ' && look1.body.card.binyan === 'nifal' && look1.body.card.meaning_en && look1.body.card.categories.length > 0, JSON.stringify(look1.body).slice(0, 200));
  check('spot derived as v:א.ל.צ:nifal, status new, 1 touch', look1.body.spot?.id === 'v:א.ל.צ:nifal' && look1.body.spot.status === 'new' && look1.body.spot.touches === 1);
  const look2 = await api('POST', '/lookup', { surface: 'נאלצה', sentence, article_id: stored.id });
  const c2 = await calls();
  check('second open served from cache (model called once, cached:true, 2 touches)', c2 - c0 === 1 && look2.body.cached === true && look2.body.spot.touches === 2, `model calls ${c2 - c0}`);
  const unknown = await api('POST', '/lookup', { surface: 'כלשהו', sentence: '' });
  check('a card the model cannot build is refused in one line, nothing invented', unknown.status === 422 && unknown.body.error.startsWith('Card could not be built'), unknown.body.error);
  const noun = await api('POST', '/lookup', { surface: 'באמינות', sentence, article_id: stored.id });
  check('noun gets w:<lemma> spot', noun.body.spot?.id === 'w:אמינות');

  // 4. marks
  const badStatus = await api('POST', '/spots/' + encodeURIComponent('v:א.ל.צ:nifal'), { status: 'known' });
  check('bad status refused naming new, shaky, solid', badStatus.status === 400 && /new, shaky, solid/.test(badStatus.body.error), badStatus.body.error);
  const save = await api('POST', '/spots/' + encodeURIComponent('v:א.ל.צ:nifal'), { status: 'shaky' });
  check('save to vocab -> shaky, recorded on the spine', save.body.spot.status === 'shaky' && save.body.spine === 'recorded', JSON.stringify(save.body));
  const marks1 = await api('GET', `/marks-for-article/${stored.id}`);
  check('marks for article now tint נאלצה shaky and באמינות new', marks1.body.surfaces['נאלצה']?.status === 'shaky' && marks1.body.surfaces['באמינות']?.status === 'new');
  const spots = await api('GET', '/spots');
  check('GET /spots shows shaky', spots.body.items.some((s) => s.id === 'v:א.ל.צ:nifal' && s.status === 'shaky'));
  const solid = await api('POST', '/spots/' + encodeURIComponent('v:א.ל.צ:nifal'), { status: 'solid' });
  check('mark solid persists', solid.body.spot.status === 'solid' && (await api('GET', '/spots?status=solid')).body.items.length === 1);

  // 5. the spine
  const onSpine = await (await fetch(`http://127.0.0.1:${SPINE_PORT}/api/marks?app=hebrew-reader`, { headers: { authorization: 'Bearer test-spine-token' } })).json();
  const mark = onSpine.items.find((m) => m.item_id === 'v:א.ל.צ:nifal');
  check('spine holds the mark with status solid and the fields', mark?.status === 'solid' && mark.fields.root === 'א.ל.צ' && mark.fields.binyan === 'nifal' && mark.fields.last_article_title === sampleTitle && mark.fields.touches === 2, JSON.stringify(mark));
  check('server log proves the cache hit and the spine record', /cache hit for "נאלצה"/.test(server.log) && /spine: recorded v:א\.ל\.צ:nifal as shaky/.test(server.log));

  // 7. touches to the spine (step 1 of session two)
  const spotRow = async (id) => (await api('GET', '/spots/' + encodeURIComponent(id))).body;
  check('migration on start added on_spine and set it for the old shaky spot, not the old new one',
    /added spots\.on_spine/.test(server.log) && (await spotRow('v:ק.ב.ע:nifal')).on_spine === true && (await spotRow('w:ישן')).on_spine === false);
  check('a spot the spine recorded has on_spine; a spot never sent does not', (await spotRow('v:א.ל.צ:nifal')).on_spine === true && (await spotRow('w:אמינות')).on_spine === false);
  const puts = async () => (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/puts`)).json()).puts;
  const p0 = await puts();
  const touch1 = await api('POST', '/lookup', { surface: 'נאלצה', sentence, article_id: stored.id });
  const p1 = await puts();
  const markAfter = (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/api/marks?app=hebrew-reader`, { headers: { authorization: 'Bearer test-spine-token' } })).json()).items.find((m) => m.item_id === 'v:א.ל.צ:nifal');
  check('card opened on a marked spot: exactly one PUT, touches up by one, last_seen_at set, status unchanged, answer says recorded',
    p1['v:א.ל.צ:nifal'] - p0['v:א.ל.צ:nifal'] === 1 && markAfter.fields.touches === 3 && touch1.body.spot.touches === 3 && markAfter.status === 'solid'
    && typeof markAfter.last_seen_at === 'string' && markAfter.last_seen_at > mark.last_seen_at && touch1.body.spine === 'recorded',
    `puts ${JSON.stringify(p1)}, touches ${markAfter.fields.touches}`);
  await api('POST', '/lookup', { surface: 'באמינות', sentence, article_id: stored.id });
  const p2 = await puts();
  check('card opened on an unmarked spot: no PUT', !p2['w:אמינות'] && Object.values(p2).reduce((a, b) => a + b, 0) === Object.values(p1).reduce((a, b) => a + b, 0), JSON.stringify(p2));
  check('server log names the touch on the spine', /spine: recorded touch 3 on v:א\.ל\.צ:nifal/.test(server.log));

  // 8. thin flag on the index (step 2)
  const thinArticle = await api('POST', '/articles', { text: 'כותרת קצרה\nטקסט קצר מאוד.' });
  const list = (await api('GET', '/articles')).body.items;
  check('index lists the short article as thin and the others not', list.find((x) => x.id === thinArticle.body.id)?.thin === true && list.filter((x) => x.id !== thinArticle.body.id).every((x) => x.thin === false), JSON.stringify(list.map((x) => [x.id, x.chars, x.thin])));
  await api('DELETE', `/articles/${thinArticle.body.id}`);

  // 9. the demand (step 3)
  //    at this point: v:א.ל.צ:nifal solid (excluded), v:ק.ב.ע:nifal shaky with no touch, no other verb
  let d = await api('GET', '/demand');
  check('demand with no verb sentence on record: state "no data" in one sentence', d.body.state === 'no data' && /sentence on record/.test(d.body.reason), d.body.reason);
  const sentOf = (w) => tok.sentenceAt(stored.text, stored.text.indexOf(w));
  await api('POST', '/lookup', { surface: 'להתמודד', sentence: sentOf('להתמודד'), article_id: stored.id });   // v:מ.ד.ד:hitpael, new, touched first
  await api('POST', '/lookup', { surface: 'ייקבעו', sentence: sentOf('ייקבעו'), article_id: stored.id });      // v:ק.ב.ע:nifal, shaky, touched later
  d = await api('GET', '/demand');
  check('demand chooses the shaky verb before the new one, though the new one was touched earlier', d.body.state === 'ok' && d.body.spot_id === 'v:ק.ב.ע:nifal' && d.body.surface === 'ייקבעו', JSON.stringify(d.body).slice(0, 200));
  check('demand item: sentence with the gap, root, binyan, tense, person, meaning, article title', d.body.sentence.includes('…') && !d.body.sentence.includes('ייקבעו') && d.body.root === 'ק.ב.ע' && d.body.binyan === 'nifal' && d.body.tense === 'future' && d.body.person_gender_number === '3p' && d.body.meaning_en && d.body.article_title === sampleTitle && d.body.article_id === stored.id);
  check('demand: translation the model refuses -> null, the Hebrew stands alone', d.body.translation_en === null);
  check('demand lists the other mapped words of the piece (shaky and new), not the gap word', d.body.also.some((w) => w.surface === 'להתמודד') && d.body.also.some((w) => w.surface === 'באמינות') && !d.body.also.some((w) => w.surface === 'ייקבעו'), JSON.stringify(d.body.also.map((w) => w.surface)));
  await api('POST', '/spots/' + encodeURIComponent('v:א.ל.צ:nifal'), { status: 'shaky' });
  await api('POST', '/lookup', { surface: 'שנאלצה', sentence: sentOf('שנאלצה'), article_id: stored.id });      // v:א.ל.צ:nifal, shaky, touched now
  await api('POST', '/lookup', { surface: 'ייקבעו', sentence: sentOf('ייקבעו'), article_id: stored.id });      // ק.ב.ע touched again: א.ל.צ is now the least recent shaky
  const c3 = await calls();
  d = await api('GET', '/demand');
  check('demand chooses the least recently touched shaky verb', d.body.spot_id === 'v:א.ל.צ:nifal' && d.body.surface === 'שנאלצה', JSON.stringify(d.body).slice(0, 160));
  check('demand: translation from one model call, with the gap kept', d.body.translation_en?.includes('…') && (await calls()) - c3 === 1, d.body.translation_en);
  const d1 = d.body;
  d = await api('GET', '/demand');
  check('the same item again is served from the translation cache (no model call)', (await calls()) - c3 === 1);
  d = await api('GET', `/demand?after=${encodeURIComponent('v:א.ל.צ:nifal')}`);
  check('demand ?after skips that spot and gives the next', d.body.spot_id === 'v:ק.ב.ע:nifal', d.body.spot_id);
  const item = { spot_id: d1.spot_id, article_id: d1.article_id, surface: d1.surface };
  const pc0 = (await puts())['v:א.ל.צ:nifal'];
  let chk = await api('POST', '/demand/check', { ...item, typed: 'שנאלצה' });
  check('check accepts the bare surface, answers the card', chk.body.ok === true && chk.body.surface === 'שנאלצה' && chk.body.card?.root === 'א.ל.צ' && chk.body.spot?.status === 'shaky');
  chk = await api('POST', '/demand/check', { ...item, typed: ' נֶאֶלְצָה ' });
  check('check accepts the surface minus its ש- proclitic, with nikud and spaces ignored', chk.body.ok === true);
  chk = await api('POST', '/demand/check', { ...item, typed: 'נאלץ' });
  check('check rejects the wrong form (ok false), nothing revealed but the card', chk.body.ok === false && chk.status === 200);
  const shown = await api('POST', '/demand/show', item);
  check('show reveals exactly the surface the article held', shown.body.surface === 'שנאלצה' && shown.body.card?.surface === 'שנאלצה');
  const pc1 = (await puts())['v:א.ל.צ:nifal'];
  check('each Check and the Show recorded a touch, each reaching the spine (four PUTs)', pc1 - pc0 === 4 && shown.body.spot.touches === chk.body.spot.touches + 1, `puts ${pc1 - pc0}`);
  let bad2 = await api('POST', '/demand/check', item);
  check('check without typed refused naming the field', bad2.status === 400 && /typed is required/.test(bad2.body.error), bad2.body.error);
  bad2 = await api('POST', '/demand/check', { ...item, surface: 'אין', typed: 'x' });
  check('check with a surface not in the article refused naming it', bad2.status === 400 && /not a word of article/.test(bad2.body.error), bad2.body.error);
  bad2 = await api('POST', '/demand/show', { spot_id: 'v:אין:paal', article_id: stored.id, surface: 'x' });
  check('show with an unknown spot refused', bad2.status === 404 && /No spot/.test(bad2.body.error), bad2.body.error);
  const quick = await api('POST', '/lookup', { surface: 'להתמודד', sentence: '' });
  check('quick lookup with an empty sentence builds the card and touches the spot', quick.status === 200 && quick.body.card.root === 'מ.ד.ד' && quick.body.spot.touches >= 2, JSON.stringify(quick.body).slice(0, 120));

  // 6. fail closed
  const closed = start('node', ['server.js'], { PORT: '8794', DATA_DIR: dataDir, COOKIE_INSECURE: '1' });
  await up('http://127.0.0.1:8794/health');
  r = await fetch('http://127.0.0.1:8794/');
  check('unconfigured server serves only the login page saying so', r.status === 503 && (await r.text()).includes('not configured'));
  r = await fetch('http://127.0.0.1:8794/articles');
  check('unconfigured server refuses the api with the same line', r.status === 503 && (await r.json()).error.includes('not configured'));
} catch (e) {
  failed++;
  console.error('FAIL', e);
  console.error(server.log);
} finally {
  for (const k of kids) k.kill();
  page.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
