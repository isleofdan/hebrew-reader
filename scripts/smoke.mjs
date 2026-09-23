// End-to-end check against local mocks of OpenRouter and the spine.
//   node scripts/smoke.mjs
// Starts the two mocks and the server on free ports, then walks the brief's
// verify list: the gate and its lock, an article by paste and by url (a local
// page), the card, the cache, the marks, the spine record.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
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
  // and a card cached before cards carried nikud (session seven, step 4)
  old.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, surface TEXT NOT NULL, context_hash TEXT NOT NULL UNIQUE, spot_id TEXT, json TEXT NOT NULL, built_at TEXT NOT NULL)`);
  const { createHash } = await import('node:crypto');
  old.prepare('INSERT INTO cards (surface, context_hash, spot_id, json, built_at) VALUES (?, ?, ?, ?, ?)').run('רפורמה', createHash('sha256').update('רפורמה\n').digest('hex'), 'w:רפורמה',
    JSON.stringify({ surface: 'רפורמה', lemma: 'רפורמה', pos: 'noun', root: null, binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'a reform', governs: null, categories: [], note: null }), '2026-09-22T00:00:00.000Z');
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

  // 3b. nikud on the card (session seven, steps 2 and 4)
  {
    const req0 = createRequire(import.meta.url);
    const lk = req0(join(root, 'lib', 'lookup.js'));
    check('a new card carries the pointed headword and the pointed word as selected',
      look1.body.card.pointed?.lemma === 'נֶאֱלַץ' && look1.body.card.pointed?.surface === 'נֶאֶלְצָה' && !look1.body.points_missing, JSON.stringify(look1.body.card.pointed));
    const base = { lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', meaning_en: 'was forced to' };
    const plainCard = lk.shape(base, 'נאלצה');
    const pointedLemma = lk.shape({ ...base, lemma: 'נֶאֱלַץ', lemma_pointed: 'נֶאֱלַץ', surface_pointed: 'נֶאֶלְצָה' }, 'נאלצה');
    check('a pointed form never makes a new spot: the same spot id with or without nikud, even when the model points the lemma itself',
      lk.spotFor(plainCard).id === 'v:א.ל.צ:nifal' && lk.spotFor(pointedLemma).id === 'v:א.ל.צ:nifal' && pointedLemma.lemma === 'נאלץ', JSON.stringify([lk.spotFor(plainCard), lk.spotFor(pointedLemma)]));
    const spotIds = (await api('GET', '/spots')).body.items.map((x) => x.id);
    const marksNow = await api('GET', `/marks-for-article/${stored.id}`);
    const POINTS = /[\u0591-\u05C7]/;
    check('no spot id, lemma or tinted surface carries nikud after pointed cards were made',
      spotIds.length > 0 && !spotIds.some((id) => POINTS.test(id)) && !Object.keys(marksNow.body.surfaces).some((w) => POINTS.test(w))
      && !Object.keys(marksNow.body.lemmas || {}).some((w) => POINTS.test(w)) && marksNow.body.surfaces['נאלצה']?.spot_id === 'v:א.ל.צ:nifal', JSON.stringify(spotIds));
    check('dictionary spelling is taken (קִדֵּם for קידם: a vowel letter dropped), a pointed form of other letters is refused, and so is one with no points (false-rejection check)',
      lk.pointedAs('קִדֵּם', 'קידם') === 'קִדֵּם' && lk.pointedAs('דִּבְּרוּ', 'דיברו') === 'דִּבְּרוּ' && lk.pointedAs('כָּתַב', 'דיבר') === null && lk.pointedAs('דיבר', 'דיבר') === null && lk.pointedAs('שֶׁנֶּאֶלְצָה', 'שנאלצה') === 'שֶׁנֶּאֶלְצָה');

    // a card cached before session seven: filled once, on first open
    const pc = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());
    const p0 = await pc();
    const old1 = await api('POST', '/lookup', { surface: 'רפורמה', sentence: '' });
    const p1 = await pc();
    check('an old cached card opens at once from the cache, unpointed, marked for its nikud, with no model call',
      old1.status === 200 && old1.body.cached === true && old1.body.points_missing === true && old1.body.card.pointed === undefined && p1.calls === p0.calls, JSON.stringify(old1.body).slice(0, 200));
    const [fillA, fillB] = await Promise.all([api('POST', '/lookup/points', { surface: 'רפורמה', sentence: '' }), api('POST', '/lookup/points', { surface: 'רפורמה', sentence: '' })]);
    const p2 = await pc();
    check('its nikud is added by one small call, even when asked twice at once, and saved back to the cache',
      fillA.status === 200 && fillA.body.called === true && fillA.body.pointed.lemma === 'רֵפוֹרְמָה' && fillB.body.pointed.lemma === 'רֵפוֹרְמָה'
      && p2.points_calls - p0.points_calls === 1 && p2.calls - p0.calls === 1 && /pointed forms added to the cached card for "רפורמה"/.test(server.log), JSON.stringify({ a: fillA.body, b: fillB.body, calls: p2.points_calls - p0.points_calls }));
    const old2 = await api('POST', '/lookup', { surface: 'רפורמה', sentence: '' });
    const fill2 = await api('POST', '/lookup/points', { surface: 'רפורמה', sentence: '' });
    const p3 = await pc();
    check('on the second open the card comes pointed from the cache, and no call is made again',
      old2.body.cached === true && !old2.body.points_missing && old2.body.card.pointed?.lemma === 'רֵפוֹרְמָה' && fill2.body.called === false && p3.calls === p2.calls,
      JSON.stringify({ old2: old2.body.card.pointed, fill2: fill2.body, calls: p3.calls - p2.calls }));
    // a card whose pointed forms were all refused is not done: asked again when next opened
    {
      const Database = req0(join(root, 'node_modules', 'better-sqlite3'));
      const d = new Database(join(dataDir, 'reader.db'));
      d.prepare(`UPDATE cards SET json = json_set(json, '$.pointed', json('{"lemma":null,"surface":null}')) WHERE surface = 'רפורמה' AND context_hash = ?`).run(lk.contextHash('רפורמה', ''));
      d.close();
      const q0 = await pc();
      const again = await api('POST', '/lookup', { surface: 'רפורמה', sentence: '' });
      const refill = await api('POST', '/lookup/points', { surface: 'רפורמה', sentence: '' });
      const q1 = await pc();
      check('a card whose nikud was all refused is asked again on its next open (one call), and then has it',
        again.body.points_missing === true && refill.body.called === true && refill.body.pointed.lemma === 'רֵפוֹרְמָה' && q1.points_calls - q0.points_calls === 1,
        JSON.stringify({ missing: again.body.points_missing, refill: refill.body, calls: q1.points_calls - q0.points_calls }));
    }
    const p4 = await pc();
    const none = await api('POST', '/lookup/points', { surface: 'שלא-נפתחה', sentence: '' });
    check('nikud is never fetched for a card that was not looked up: refused in one line, no call', none.status === 404 && /look the word up first/.test(none.body.error) && (await pc()).calls === p4.calls, none.body.error);
  }

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

  // 9b. a headline word is a word of the piece (step 3)
  const asRead = `${stored.title}\n${stored.text}`;
  const headWord = 'מקדם';
  const headSentence = tok.sentenceAt(asRead, asRead.indexOf(headWord));
  check('the headline is its own sentence, so a headline word carries the headline', headSentence === stored.title, headSentence);
  const cHead0 = await calls();
  const headLook = await api('POST', '/lookup', { surface: headWord, sentence: headSentence, article_id: stored.id });
  check('a headline word opens a card and records a touch, as a body word does',
    headLook.status === 200 && headLook.body.card.root === 'ק.ד.מ' && headLook.body.spot.id === 'v:ק.ד.מ:piel' && headLook.body.spot.touches === 1, JSON.stringify(headLook.body.spot));
  const headShow = await api('POST', '/demand/show', { spot_id: 'v:ק.ד.מ:piel', article_id: stored.id, surface: headWord });
  check('the demand accepts that headline word instead of refusing it as not a word of the article',
    headShow.status === 200 && headShow.body.surface === headWord && headShow.body.spot.touches === 2, headShow.body.error || JSON.stringify(headShow.body.spot));
  check('the demand cut the same sentence the reader did (the headline), so the card came from the cache',
    (await calls()) - cHead0 === 1, `${(await calls()) - cHead0} model call(s) for two touches`);
  const askHead = await api('POST', '/ask', { question: 'Please list my map for this piece.', article_id: stored.id });
  check("the headline's mapped words reach the ask surface too, not only the body's", /מקדם/.test(askHead.body.answer) && /שנאלצה/.test(askHead.body.answer), askHead.body.answer);

  // 10. the ask surface (step 6)
  const asked = await api('POST', '/ask', { question: 'What does נאלץ take?' });
  check('ask answers briefly with one link per reference the mock named, every url built from lib/references.js',
    asked.status === 200 && /not sure/.test(asked.body.answer) && asked.body.links.length === 3
    && asked.body.links.map((l) => l.reference).join(',') === 'pealim,wiktionary,academy'
    && asked.body.links[0].url === 'https://www.pealim.com/search/?q=' + encodeURIComponent('אלצ')
    && asked.body.links[1].url === 'https://he.wiktionary.org/wiki/' + encodeURIComponent('נאלץ')
    && asked.body.links[2].url === 'https://hebrew-academy.org.il/?s=' + encodeURIComponent('נאלץ'), JSON.stringify(asked.body).slice(0, 200));
  const askedPiece = await api('POST', '/ask', { question: "Which Nif'al forms are in this piece?", article_id: stored.id });
  check("ask with an article: the piece's mapped words reach the model, so the Nif'al forms are answered from data",
    askedPiece.body.answer.includes('ייקבעו') && askedPiece.body.answer.includes('שנאלצה') && !askedPiece.body.answer.includes('להתמודד') && askedPiece.body.links.every((l) => l.url.startsWith('https://www.pealim.com/')), askedPiece.body.answer);
  const askNone = await api('POST', '/ask', { question: "Which Nif'al forms are here, with no reference to give?", article_id: stored.id });
  check('an answer with nothing to link is an answer, not a failure (links [], state ok)',
    askNone.status === 200 && /No Nif'al verb form appears/.test(askNone.body.answer) && Array.isArray(askNone.body.links) && askNone.body.links.length === 0
    && askNone.body.state === 'ok' && askNone.body.links_state === 'no data', JSON.stringify(askNone.body).slice(0, 160));
  const askPlain = await api('POST', '/ask', { question: 'Answer this one in plain text, please.' });
  check('a plain-text reply (not JSON) is the answer, with no links and no failure line',
    askPlain.status === 200 && /to be forced/.test(askPlain.body.answer) && askPlain.body.links.length === 0 && askPlain.body.state === 'ok', JSON.stringify(askPlain.body).slice(0, 160));
  const askDeclined = await api('POST', '/ask', { question: 'Give me a recipe for shakshuka.' });
  check('the model declining is the failure line and it says declined', askDeclined.status === 422
    && /^The references could not be asked: the model declined — /.test(askDeclined.body.error), askDeclined.body.error);
  const askDown = await api('POST', '/ask', { question: 'Ask the desk while it is down.' });
  check('an unreachable model is the failure line and it names unreachable', askDown.status === 502
    && /^The references could not be asked: OpenRouter is unreachable/.test(askDown.body.error), askDown.body.error);
  bad2 = await api('POST', '/ask', { question: '' });
  check('ask without a question refused naming the field', bad2.status === 400 && /question is required/.test(bad2.body.error), bad2.body.error);
  bad2 = await api('POST', '/ask', { question: 'x', article_id: 'seven' });
  check('ask with a bad article_id refused naming the shape', bad2.status === 400 && /whole number/.test(bad2.body.error), bad2.body.error);

  // 11. the lesson sheet (step 7)
  const sheet = await api('GET', '/make/lesson?articles=5&format=json');
  check("lesson sheet lists the spots touched twice or more, Nif'al first, then non-verbs",
    sheet.body.state === 'ok' && sheet.body.groups[0].title === "Nif'al" && sheet.body.groups[0].items.map((i) => i.spot_id).sort().join(',') === 'v:א.ל.צ:nifal,v:ק.ב.ע:nifal'
    && sheet.body.groups.at(-1).title === 'Not verbs' && sheet.body.groups.at(-1).items.some((i) => i.spot_id === 'w:אמינות')
    && !sheet.body.groups.flatMap((g) => g.items).some((i) => i.spot_id === 'v:מ.ד.ד:hitpael'), JSON.stringify(sheet.body.groups.map((g) => [g.title, g.items.map((i) => [i.spot_id, i.touches])])));
  const first = sheet.body.groups[0].items[0];
  check('each sheet item carries surfaces, root, binyan, meaning, one sentence, status and touches',
    first.surfaces.length >= 1 && first.root && first.binyan === 'nifal' && first.meaning_en && first.sentence && first.status && first.touches >= 2, JSON.stringify(first).slice(0, 200));
  check('sheet header names the articles by title and date', sheet.body.articles.length === 2 && sheet.body.articles.every((a) => a.title && a.date));
  const mdRes = await fetch(`${base}/make/lesson?articles=5`, { headers: H });
  const md = await mdRes.text();
  check('lesson sheet as a Markdown download', mdRes.status === 200 && /text\/markdown/.test(mdRes.headers.get('content-type')) && /attachment; filename="lesson-sheet-\d{4}-\d{2}-\d{2}\.md"/.test(mdRes.headers.get('content-disposition'))
    && md.startsWith('# Lesson sheet') && md.indexOf("## Nif'al") < md.indexOf('## Not verbs') && /root א\.ל\.צ/.test(md), md.slice(0, 120));
  const none = await api('GET', '/make/lesson?articles=1&format=json');
  const noneMd = await (await fetch(`${base}/make/lesson?articles=1`, { headers: H })).text();
  check('nothing qualifies -> state "no data" and a one-line sheet saying so', none.body.state === 'no data' && none.body.count === 0 && /Nothing qualifies/.test(noneMd) && noneMd.trim().split('\n').filter((l) => l.trim()).length === 3, noneMd);
  bad2 = await api('GET', '/make/lesson?articles=0');
  check('lesson with a bad article count refused naming the range', bad2.status === 400 && /1 to 50/.test(bad2.body.error), bad2.body.error);

  {
  // 12. lessons from Guy (session four)
  const req = createRequire(import.meta.url);
  const guy = req(join(root, 'lib', 'guy-lesson.js'));
  const fixtures = join(here, 'fixtures');
  const upload = async (file, as) => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(join(fixtures, file))], { type: 'application/pdf' }), as || file);
    const res = await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie, accept: 'application/json' }, body: form });
    return { status: res.status, body: await res.json() };
  };
  const guideCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).guides;
  const putCounts = async () => (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/puts`)).json()).puts;
  const until = async (id, done) => { for (let i = 0; i < 100; i++) { const v = (await api('GET', `/lessons/${id}`)).body; if (done(v)) return v; await wait(100); } throw new Error(`lesson ${id} never settled`); };
  const L1 = await upload('Daniel HEB 15jun26.pdf');
  check('lesson upload "Daniel HEB 15jun26": title and date from the file name, 10 items',
    L1.status === 201 && L1.body.title === 'שיעור עם גיא — 15.6.2026' && L1.body.lesson_date === '2026-06-15' && L1.body.title_from === 'file name pattern' && L1.body.items.length === 10, JSON.stringify(L1.body).slice(0, 200));
  check('the sentence the PDF wrapped onto two lines is one item',
    L1.body.items.includes('הממשלה נאלצה לדחות את ההצבעה על התקציב לשבוע הבא בגלל מחלוקת חריפה בין שותפות הקואליציה על חלוקת הכספים'), L1.body.items[8]);
  const L2 = await upload('Daniel Hebrew 24feb26.pdf');
  check('lesson upload "Daniel Hebrew 24feb26": 24 Feb 2026, 6 items', L2.status === 201 && L2.body.lesson_date === '2026-02-24' && L2.body.title === 'שיעור עם גיא — 24.2.2026' && L2.body.items.length === 6, JSON.stringify(L2.body).slice(0, 160));
  const L3 = await upload('Daniel Guy 10FEB2025.pdf');
  check('lesson upload "Daniel Guy 10FEB2025": 10 Feb 2025, 5 items', L3.status === 201 && L3.body.lesson_date === '2025-02-10' && L3.body.items.length === 5, JSON.stringify(L3.body).slice(0, 160));
  const other = guy.nameAndDate('Daniel Guy 21oct2024.pdf'), plainName = guy.nameAndDate('my notes.pdf', '2026-09-22');
  check('file-name patterns: "Daniel Guy 21oct2024" read; any other name keeps the file name and today',
    other.lesson_date === '2024-10-21' && plainName.title === 'my notes' && plainName.lesson_date === '2026-09-22' && plainName.from === 'file name', JSON.stringify([other, plainName]));
  const refused = await upload('notes two lines.pdf');
  check('a PDF with two Hebrew lines is refused, naming the count', refused.status === 422 && /^Only 2 Hebrew items were found in notes two lines\.pdf; a lesson needs at least 5\./.test(refused.body.error), refused.body.error);
  const notPdf = await (async () => { const f = new FormData(); f.append('file', new Blob(['hello']), 'notes.pdf'); const r2 = await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: f }); return { status: r2.status, body: await r2.json() }; })();
  check('a file that is not a PDF is refused in one line', notPdf.status === 400 && notPdf.body.error === 'notes.pdf is not a PDF.', notPdf.body.error);
  const again = await upload('Daniel HEB 15jun26.pdf', 'copy.pdf');
  check('the same lesson uploaded again answers the one already there', again.status === 200 && again.body.created === false && again.body.id === L1.body.id);
  const lessons = (await api('GET', '/lessons')).body;
  check('the index lists the lessons newest first', lessons.items.map((l) => l.lesson_date).join(',') === '2026-06-15,2026-02-24,2025-02-10', lessons.items.map((l) => l.lesson_date).join(','));

  // the guide: built once on first open, cached, rebuilt whole
  await api('POST', '/spots/' + encodeURIComponent('v:א.ל.צ:nifal'), { status: 'solid' });
  const alzBefore = await spotRow('v:א.ל.צ:nifal');
  const putsBefore = await putCounts();
  const g0 = await guideCalls();
  const first = await api('POST', `/lessons/${L1.body.id}/guide`, {});
  check('first open starts the guide build (202, building)', first.status === 202 && first.body.guide_state === 'building', JSON.stringify(first.body).slice(0, 120));
  const built = await until(L1.body.id, (v) => v.guide_state !== 'building' && !v.saving);
  const firstReviewCards = (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).last_review_cards;
  const kinds = [...new Set(built.guide.sections.map((x) => x.kind))].join(',');
  check("the guide has the instructions' sections in their order",
    built.guide_state === 'built' && kinds === 'topics,grammar,drills,paper,vocabulary,questions,expressions', kinds);
  check('what the model added outside the lesson is dropped and counted',
    built.guide.dropped.cards === 1 && built.guide.dropped.vocabulary === 1 && built.guide.dropped.expressions === 1 && built.guide.cards.length === 10
    && !built.guide.cards.some((c) => c[1] === 'מומצא'), JSON.stringify(built.guide.dropped));
  check('each card has the eleven fields of the instructions', built.guide.cards.every((c) => c.length === 11));
  check('no "for Guy" explanation is kept, though the model wrote one (Dan, 22 Sep 2026)', built.guide.sections.every((x) => !('for_guy' in x)) && !/for_guy|sharing with Guy"? \}/.test(JSON.stringify(built.guide)));
  const g1 = await guideCalls();
  const second = await api('POST', `/lessons/${L1.body.id}/guide`, {});
  await api('GET', `/lessons/${L1.body.id}`);
  check('second open costs no model call: the guide is served from the lesson', g1 - g0 === 1 && second.status === 200 && second.body.guide_state === 'built' && (await guideCalls()) === g1, `guide calls ${g1 - g0} then ${(await guideCalls()) - g1}`);
  const shaped = guy.shapeGuide({ sections: [], cards: Array.from({ length: 40 }, () => ['הסלמה', 'הסלמה', '', 'escalation', '', '', 'Nouns', 'noun', '', '', '']) }, { text: 'הסלמה', title: 't', lesson_date: null });
  check('at most 35 cards are kept, the rest counted', shaped.cards.length === 35 && shaped.dropped.over_cap === 5);

  // the words
  const saved = built.saved;
  check('single-word items saved, phrases kept in the guide only, the unknown word named',
    saved && saved.words === 3 && saved.touched === 1 && saved.phrases === 5 && saved.failed.length === 1 && saved.failed[0].surface === 'הנהלה' && saved.spine.recorded === 4, JSON.stringify(saved));
  const putsAfter = await putCounts();
  const newPuts = Object.fromEntries(Object.entries(putsAfter).map(([k, n]) => [k, n - (putsBefore[k] || 0)]).filter(([, n]) => n));
  check('one spine PUT per saved word and one for the touched word, none for a phrase',
    JSON.stringify(Object.keys(newPuts).sort()) === JSON.stringify(['v:ח.ת.מ:nifal', 'v:א.ל.צ:nifal', 'w:הסלמה', 'w:יו״ש'].sort()) && Object.values(newPuts).every((n) => n === 1), JSON.stringify(newPuts));
  const hasla = (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/api/marks?app=hebrew-reader`, { headers: { authorization: 'Bearer test-spine-token' } })).json()).items.find((m) => m.item_id === 'w:הסלמה');
  check("a saved word is shaky on the spine with the lesson's title", hasla?.status === 'shaky' && hasla.fields.last_article_title === 'שיעור עם גיא — 15.6.2026', JSON.stringify(hasla));
  const alzAfter = await spotRow('v:א.ל.צ:nifal');
  check('a solid word in the lesson stays solid and is touched once', alzAfter.status === 'solid' && alzAfter.touches === alzBefore.touches + 1, `${alzBefore.status}/${alzBefore.touches} -> ${alzAfter.status}/${alzAfter.touches}`);
  const lm = await api('GET', `/marks-for-lesson/${L1.body.id}`);
  check('the lesson page tints the saved words', lm.body.surfaces['הסלמה']?.status === 'shaky' && lm.body.surfaces['יו״ש']?.status === 'shaky');
  const tap = await api('POST', '/lookup', { surface: 'הסלמה', sentence: 'הסלמה', lesson_id: L1.body.id });
  check('a tap on a lesson word is served from the card the save built', tap.status === 200 && tap.body.cached === true && tap.body.spot.id === 'w:הסלמה');
  bad2 = await api('POST', '/lookup', { surface: 'הסלמה', sentence: 'הסלמה', lesson_id: 999 });
  check('a lookup against a lesson that is not there is refused', bad2.status === 404 && /No lesson with id 999/.test(bad2.body.error), bad2.body.error);

  // rebuild replaces, never merges, and does not save the words again
  const oldBuilt = built.guide.built_at;
  const putsBeforeRebuild = await putCounts();
  const rb = await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
  const rebuilt = await until(L1.body.id, (v) => v.guide_state !== 'building' && !v.saving);
  const topics = rebuilt.guide.sections.find((x) => x.kind === 'topics').items;
  check('rebuild replaces the guide whole', rb.status === 202 && rebuilt.guide.built_at !== oldBuilt && topics.some((t) => /build 2/.test(t)) && !topics.some((t) => /build 1/.test(t)) && rebuilt.guide.sections.length === 8, topics.join(' | '));
  check('rebuild does not save the words again', JSON.stringify(rebuilt.saved) === JSON.stringify(saved) && JSON.stringify(await putCounts()) === JSON.stringify(putsBeforeRebuild));

  // the guide model, and the fallback when OpenRouter does not know it (session five, step 1)
  const lookupLib = req(join(root, 'lib', 'lookup.js'));
  const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());
  const control = (c) => fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify(c) });
  // Two wrong cards for the February lesson's words, before its first build:
  // להתבייש given as Pa'al (as the card model gave לזנק live), and להתייבש given
  // the lemma of להתבייש (the letter-order confusion), so one word matches two
  // cards.
  await control({ card_overrides: {
    'להתבייש': { surface: 'להתבייש', lemma: 'התבייש', pos: 'verb', root: 'ב.ו.ש', binyan: 'paal', tense: 'infinitive', person_gender_number: null, meaning_en: 'to be ashamed', governs: 'ב-', categories: ['letter-order'], note: null },
    'להתייבש': { surface: 'להתייבש', lemma: 'התבייש', pos: 'verb', root: 'י.ב.ש', binyan: 'hitpael', tense: 'infinitive', person_gender_number: null, meaning_en: 'to dry out', governs: null, categories: ['letter-order'], note: null },
  } });
  check('the guide is built by the guide model, not the card model',
    (await orCalls()).last_guide_model === 'anthropic/claude-opus-4.6' && rebuilt.guide.model === 'anthropic/claude-opus-4.6' && rebuilt.guide.built_with === 'guide model' && lookupLib.MODEL === 'anthropic/claude-sonnet-4.6',
    `${(await orCalls()).last_guide_model} / ${rebuilt.guide.built_with}`);
  check("OpenRouter's two model-not-found answers are recognized, other errors are not",
    lookupLib.modelMissing(400, 'anthropic/claude-opus-4.6 is not a valid model ID') && lookupLib.modelMissing(404, 'No endpoints found for anthropic/claude-opus-4.6.')
    && !lookupLib.modelMissing(400, 'max_tokens is too large') && !lookupLib.modelMissing(429, 'Rate limit exceeded'));
  await control({ unknown_models: ['anthropic/claude-opus-4.6'] });
  await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
  const fellBack = await until(L1.body.id, (v) => v.guide_state !== 'building' && !v.saving);
  await control({ unknown_models: [] });
  check('a guide model OpenRouter does not know: the same build retried once with the card model, marked "fallback"',
    fellBack.guide_state === 'built' && !fellBack.guide_error && fellBack.guide.built_with === 'fallback' && fellBack.guide.model === 'anthropic/claude-sonnet-4.6'
    && (await orCalls()).last_guide_model === 'anthropic/claude-sonnet-4.6' && /not a valid model ID\); retrying once with anthropic\/claude-sonnet-4\.6/.test(server.log),
    JSON.stringify({ built_with: fellBack.guide.built_with, model: fellBack.guide.model, error: fellBack.guide_error }));

  // the review pass (session five, step 3)
  check('the review pass ran on the first build: one root corrected, the reviewed guide saved, the change listed',
    built.guide.review && built.guide.review.state === 'applied' && built.guide.review.changes.length === 1 && /ס\.ל\.ם/.test(built.guide.review.changes[0])
    && built.guide.sections.find((x) => x.kind === 'vocabulary').rows.some((r) => r.root === 'ס.ל.ם') && built.guide.review.refused.length === 0, JSON.stringify(built.guide.review));
  {
    await control({ review: 'add-item' });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const v = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const rows = v.guide.sections.find((x) => x.kind === 'vocabulary').rows;
    const phrase = L1.body.items.find((i) => /\s/.test(i));
    check('a review that tries to add: corrections naming items the guide lacks, or text not there, are refused and listed; its real correction kept',
      v.guide.review.state === 'applied' && v.guide.review.changes.length === 1 && v.guide.review.refused.length === 3
      && v.guide.review.refused.some((r) => r.startsWith(`vocabulary ${phrase}: no such item`)) && v.guide.review.refused.some((r) => r.startsWith('cards תוספת: no such item'))
      && v.guide.review.refused.some((r) => /^drills להיאלץ: "טקסט שאינו שם" is not in it/.test(r))
      && !rows.some((r) => r.he === phrase) && rows.some((r) => r.root === 'ס.ל.ם') && v.guide.cards.length === built.guide.cards.length,
      JSON.stringify(v.guide.review));
    await control({ review: 'whole-guide' });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const wg = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    check('a review that writes the guide back instead of corrections is not taken: the checked guide saved, the reason kept',
      wg.guide.review.state === 'not run' && /no list of corrections/.test(wg.guide.review.reason), JSON.stringify(wg.guide.review));
    const gl = req(join(root, 'lib', 'guy-lesson.js'));
    const mini = { sections: [{ kind: 'drills', verbs: [{ verb: 'להסלים', root: 'ס.ל.ם', binyan: "Hif'il", takes_object: false, table: [{ tense: 'future', forms: [{ person: '3ms', he: 'יַסְלִים' }] }], exercises: [{ sentence: 'המצב ___.', cue: '3ms future', answer: 'יסלים' }] }] }, { kind: 'vocabulary', rows: [{ he: 'לזנק', en: 'to leap', root: 'ז.נ.ק', binyan: "Pa'al" }] }], cards: [['לְזַנֵּק', 'לזנק', '', 'to leap', 'ז.נ.ק', "Pa'al", 'Verbs', 'verb', '', '', '']] };
    const applied = gl.applyCorrections(mini, { corrections: [
      { section: 'vocabulary', item: 'לזנק', find: "Pa'al", replace: "Pi'el", why: 'binyan' },
      { section: 'cards', item: 'לזנק', find: "Pa'al", replace: "Pi'el", why: 'card binyan' },
      { section: 'drills', item: 'להסלים', find: 'takes_object', replace: 'both', why: 'objects' },
      { section: 'drills', item: 'להסלים', find: 'יַסְלִים', replace: 'יַסְלִים!', why: 'a nested form' },
    ], remove: [] });
    check("corrections reach any field of an item, nested ones included, and the guide handed in is untouched",
      applied.guide.sections[1].rows[0].binyan === "Pi'el" && applied.guide.cards[0][5] === "Pi'el" && applied.guide.sections[0].verbs[0].takes_object === 'both'
      && applied.guide.sections[0].verbs[0].table[0].forms[0].he === 'יַסְלִים!' && applied.changes.length === 4 && applied.refused.length === 0 && mini.cards[0][5] === "Pa'al",
      JSON.stringify(applied.refused));
    await control({ review: 'decline' });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const w = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    check('a review that does not answer: the checked guide saved as it was, the reason kept',
      w.guide_state === 'built' && w.guide.review.state === 'not run' && /the model declined/.test(w.guide.review.reason) && w.guide.sections.find((x) => x.kind === 'vocabulary').rows.some((r) => r.root === 'ס.ל.מ'),
      JSON.stringify(w.guide.review));
    await control({ review: 'fix-root' });
  }

  // the review answers in a form the server can read (session seven, step 1):
  // live, 23 Sep 2026, "the model did not return JSON", so it never ran
  {
    const lk = req(join(root, 'lib', 'lookup.js'));
    const body = { corrections: [{ section: 'vocabulary', item: 'x', field: '', find: 'a', replace: 'b', why: 'w' }], remove: [] };
    const js = JSON.stringify(body);
    const fenced = lk.firstJsonObject('```json\n' + js + '\n```');
    const prose = lk.firstJsonObject('Here are the corrections I found:\n' + js + '\nThat is all; the "}" above closes it.');
    const cut = lk.firstJsonObject(js.slice(0, js.length - 12));
    const clean = lk.firstJsonObject(js);
    check('the JSON reader: a clean answer, one in a code fence and one after a line of prose are all taken; a cut-off one is refused, never read for an inner object',
      JSON.stringify(clean.value) === js && JSON.stringify(fenced.value) === js && JSON.stringify(prose.value) === js && cut.value === null && cut.truncated === true,
      JSON.stringify({ fenced, prose, cut }));
    check('a schema refusal is told apart from a missing model: "requested parameters" is a refusal of the format, not of the model',
      lk.schemaRefused(404, 'No endpoints found that can handle the requested parameters.') && !lk.modelMissing(404, 'No endpoints found that can handle the requested parameters.')
      && lk.modelMissing(404, 'No endpoints found for anthropic/claude-opus-9.') && !lk.schemaRefused(404, 'No endpoints found for anthropic/claude-opus-9.'));
    const gl = req(join(root, 'lib', 'guy-lesson.js'));
    const mini = { sections: [{ kind: 'vocabulary', rows: [{ he: 'לזנק', en: 'to leap', root: 'ז.נ.ק', binyan: "Pa'al", flags: '' }] }], cards: [] };
    const schemaShaped = gl.applyCorrections(mini, { corrections: [
      { section: 'vocabulary', item: 'לזנק', field: '', find: "Pa'al", replace: "Pi'el", why: 'binyan' },
      { section: 'vocabulary', item: 'לזנק', field: 'flags', find: '', replace: '⚠️ Binyan: Pi\'el', why: 'flag' },
    ], remove: [] });
    check('a correction in the schema\'s shape ("field": "" when it fills nothing) is applied, not refused (false-rejection check)',
      schemaShaped.refused.length === 0 && schemaShaped.changes.length === 2 && schemaShaped.guide.sections[0].rows[0].binyan === "Pi'el" && /Binyan/.test(schemaShaped.guide.sections[0].rows[0].flags),
      JSON.stringify(schemaShaped.refused));

    const asks = async () => (await orCalls()).review_asks.length;
    const rebuildWith = async (c) => {
      await control(c);
      const n0 = await asks();
      await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
      const v = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
      const all = (await orCalls()).review_asks;
      return { v, rv: v.guide.review, mine: all.slice(n0) };
    };
    const hasFix = (v) => v.guide.sections.find((x) => x.kind === 'vocabulary').rows.some((r) => r.root === 'ס.ל.ם');

    let r = await rebuildWith({ review_format: 'clean' });
    const reviewVerbs = ((await orCalls()).last_review_cards || []).filter((c) => c.pos === 'verb').length;
    check('the review asks for structured output against its schema, with room for its answer (16,000, and 150 a verb card for its verdicts): a clean answer is applied on the one ask, no second ask',
      r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 1 && !r.mine[0].follow_up && r.mine[0].type === 'json_schema' && r.mine[0].schema_name === 'lesson_review'
      && r.mine[0].require_parameters && reviewVerbs === 2 && r.mine[0].max_tokens === 16000 + 150 * reviewVerbs && r.rv.json === 'json_schema' && !r.rv.asked_twice, JSON.stringify({ rv: r.rv, mine: r.mine, reviewVerbs }));
    r = await rebuildWith({ review_format: 'fenced' });
    check('a review answer inside a ```json fence is read and applied, with no second ask', r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 1, JSON.stringify({ rv: r.rv, mine: r.mine }));
    r = await rebuildWith({ review_format: 'prose' });
    check('a review answer after a line of prose is read and applied, with no second ask', r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 1, JSON.stringify({ rv: r.rv, mine: r.mine }));
    r = await rebuildWith({ review_format: 'truncated', review_format_again: 'clean' });
    check('a cut-off review answer is refused, asked once more ("cut off"), and the second answer applied; the page notes the second ask',
      r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 2 && r.mine[1].follow_up && /cut off/.test(r.mine[1].last) && r.rv.asked_twice === true
      && /the answer from anthropic\/claude-opus-4\.6 was not JSON \(first answer; finish length/.test(server.log), JSON.stringify({ rv: r.rv, mine: r.mine }));
    r = await rebuildWith({ review_format: 'garbage', review_format_again: 'garbage' });
    const logged = /The review pass could not run: the answer from \S+ was not JSON \(first answer; finish stop, [3-9]\d{3} characters\)\. Its first 2000 characters:\nI reviewed the guide\./.test(server.log);
    check('a review that twice answers no JSON: asked once more and only once, not run, the reason named; the answer\'s first 2,000 characters logged and kept with the lesson',
      r.rv.state === 'not run' && r.mine.length === 2 && r.mine[1].follow_up && /Return only the JSON object/.test(r.mine[1].last)
      && /did not return JSON, and asked once more it still did not/.test(r.rv.reason) && /^I reviewed the guide\./.test(r.rv.raw_head || '') && r.rv.raw_head.length === 2000 && logged && !hasFix(r.v),
      JSON.stringify({ rv: r.rv, mine: r.mine, logged }));
    r = await rebuildWith({ review_format: 'garbage', review_format_again: 'clean' });
    check('an answer that is not JSON, then a clean one on the second ask: applied, two asks in all', r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 2 && r.rv.asked_twice === true, JSON.stringify({ rv: r.rv, mine: r.mine }));
    r = await rebuildWith({ review_format: 'clean', schema_refused: true });
    check('when no provider takes the schema (404 "requested parameters"), the review is asked once in JSON mode and applied; the guide model is kept, not the fallback',
      r.rv.state === 'applied' && hasFix(r.v) && r.mine.length === 2 && r.mine[0].refused && r.mine[1].type === 'json_object' && r.rv.json === 'json_object' && r.v.guide.built_with === 'guide model',
      JSON.stringify({ rv: r.rv, mine: r.mine, built_with: r.v.guide.built_with }));
    await control({ review_format: 'clean', review_format_again: 'clean', schema_refused: false });
  }

  // the review's corrections one at a time (session eight, step 1): a
  // correction that breaks a check the guide passed is dropped on its own
  {
    const gl = req(join(root, 'lib', 'guy-lesson.js'));
    const mini = { sections: [{ kind: 'vocabulary', rows: [{ he: 'לזנק', en: 'to leap', root: 'ז.נ.ק', binyan: "Pa'al", flags: '' }, { he: 'הסלמה', en: 'escalation', root: 'ס.ל.מ', binyan: '', flags: '' }] }], cards: [] };
    const three = { corrections: [
      { section: 'vocabulary', item: 'לזנק', field: '', find: "Pa'al", replace: "Pi'el", why: 'לזנק is Pi\'el' },
      { section: 'vocabulary', item: 'הסלמה', field: '', find: 'ס.ל.מ', replace: 'ס.ל.ם', why: 'root of הסלמה' },
      { section: 'vocabulary', item: 'לזנק', field: '', find: 'to leap', replace: 'to jump', why: 'meaning' },
    ], remove: [] };
    const allGood = gl.applyCorrections(mini, three, () => []);
    check('corrections one at a time: all good, all applied, none dropped',
      allGood.changes.length === 3 && allGood.dropped.length === 0 && allGood.guide.sections[0].rows[0].binyan === "Pi'el" && allGood.guide.sections[0].rows[1].root === 'ס.ל.ם' && allGood.guide.sections[0].rows[0].en === 'to jump',
      JSON.stringify(allGood));
    const seen = [];
    const oneBad = gl.applyCorrections(mini, three, (g) => { seen.push(JSON.stringify(g.sections[0].rows)); return g.sections[0].rows[1].root === 'ס.ל.ם' ? [{ check: 'drill', detail: 'a stand-in failure' }] : []; });
    check('corrections one at a time: each is checked on the guide as the ones before it left it; the breaker is undone and listed with its check, the rest applied after it',
      oneBad.changes.length === 2 && oneBad.dropped.length === 1 && oneBad.dropped[0].change === 'root of הסלמה' && oneBad.dropped[0].checks.join() === 'drill' && oneBad.dropped[0].detail === 'a stand-in failure'
      && oneBad.guide.sections[0].rows[1].root === 'ס.ל.מ' && oneBad.guide.sections[0].rows[0].en === 'to jump' && seen.length === 3 && /Pi'el/.test(seen[2]) && !/ס\.ל\.ם/.test(seen[2]),
      JSON.stringify({ changes: oneBad.changes, dropped: oneBad.dropped }));

    // the same against the server's real checks, through a rebuild
    const drillOf = (v) => v.guide.sections.find((x) => x.kind === 'drills').verbs[0];
    const rowsOf = (v) => v.guide.sections.find((x) => x.kind === 'vocabulary').rows;
    await control({ review: 'none', review_extra: [] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const plainBuild = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const flagged = rowsOf(plainBuild).find((r) => /⚠️ Spelling/.test(r.flags));
    const breaker = { section: 'drills', item: 'להיאלץ', field: '', find: 'guttural', replace: 'geminate', why: 'the drill deviation called geminate' };
    const flagBreaker = { section: 'vocabulary', item: flagged.he, field: '', find: flagged.flags, replace: 'fine', why: `the spelling flag of ${flagged.he} taken out` };
    await control({ review: 'fix-root', review_extra: [
      { section: 'drills', item: 'להיאלץ', field: '', find: 'is rare', replace: 'is rare in modern Hebrew', why: 'the Pa\'al comparison made exact' },
      breaker,
      { section: 'vocabulary', item: flagged.he, field: '', find: `meaning of ${flagged.he}`, replace: `the meaning of ${flagged.he}`, why: `the meaning of ${flagged.he} reworded` },
    ] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const mixed = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const rv = mixed.guide.review;
    check('one breaker among many (a drill deviation the drill check does not accept): that one dropped with the check it broke, the other three applied, the guide passing every check',
      rv.state === 'applied' && rv.changes.length === 3 && rv.dropped.length === 1 && rv.dropped[0].change === 'the drill deviation called geminate' && rv.dropped[0].checks.join() === 'drill'
      && /gives no deviation from/.test(rv.dropped[0].detail) && drillOf(mixed).deviation === 'guttural' && /modern Hebrew/.test(drillOf(mixed).paal_comparison)
      && rowsOf(mixed).some((r) => r.root === 'ס.ל.ם') && mixed.guide.checks.unmet.length === 0 && /review corrections dropped for a check they broke: the drill deviation called geminate \(drill:/.test(server.log),
      JSON.stringify(rv));
    await control({ review: 'none', review_extra: [breaker, flagBreaker] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const allBad = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const rb = allBad.guide.review;
    check('every correction breaks a check: the guide kept as built, all of them listed with their checks',
      rb.state === 'applied' && rb.changes.length === 0 && rb.dropped.length === 2 && rb.dropped.map((d) => d.checks.join()).join('|') === 'drill|flags'
      && JSON.stringify(drillOf(allBad)) === JSON.stringify(drillOf(plainBuild)) && JSON.stringify(rowsOf(allBad)) === JSON.stringify(rowsOf(plainBuild)) && allBad.guide.checks.unmet.length === 0,
      JSON.stringify(rb));

    // step 2: "no change needed" is not a correction
    await control({ review: 'fix-root', review_extra: [
      { section: 'vocabulary', item: flagged.he, field: '', find: `meaning of ${flagged.he}`, replace: `meaning of ${flagged.he}`, why: 'No change needed — the meaning is right.' },
      { section: 'drills', item: 'להיאלץ', field: '', find: 'guttural ', replace: ' guttural', why: 'No change needed on reflection.' },
      { section: 'drills', item: 'להיאלץ', field: '', find: 'takes_object', replace: 'false', why: 'No change needed: it takes no object.' },
      { section: 'word_cards', item: 'נחתם', field: 'binyan', find: 'nifal', replace: 'nifal', why: 'No change needed — the card is right.' },
    ] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const same = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const rs = same.guide.review;
    check('a correction whose find and replace are the same is refused without a line: not applied, not refused, not dropped; the real correction still applied',
      rs.changes.length === 1 && /ס\.ל\.ם/.test(rs.changes[0]) && rs.refused.length === 0 && rs.dropped.length === 0 && !JSON.stringify(rs).includes('No change needed')
      && !(rs.cards && rs.cards.unchanged.some((u) => u.startsWith('נחתם'))),
      JSON.stringify(rs));
    const told = /"No change needed" is not a correction; leave out any correction you are not sure of\./.test(req(join(root, 'lib', 'guy-lesson-prompt.js')).reviewSystem());
    check('the review prompt says "no change needed" is not a correction, and to leave out a correction it is not sure of', told);
    await control({ review: 'fix-root', review_extra: [] });
  }

  // step 3: a deviation naming more than one listed type
  {
    const gc = req(join(root, 'lib', 'guide-checks.js'));
    const nozez = (deviation) => gc.check({ sections: [{ kind: 'drills', verbs: [{ verb: 'נוצץ (לנצוץ)', root: 'נ.צ.צ', binyan: "Pa'al", deviation, takes_object: false, exercises: [] }] }], cards: [] },
      { items: [] }, [{ surface: 'נוצץ', root: 'נ.צ.צ', binyan: 'paal', from: 'card' }]).filter((f) => f.check === 'drill');
    const pass = ['pe-nun, doubled', 'pe-nun and doubled', 'doubled, pe-nun', 'pe-nun', 'doubled'].map((d) => [d, nozez(d)]);
    check('the drill check accepts a combined deviation: נוצץ (נ.צ.צ) "pe-nun, doubled" passes, in either order and with "and" (false-rejection check)',
      pass.every(([, f]) => f.length === 0), JSON.stringify(pass.filter(([, f]) => f.length)));
    const geminate = nozez('pe-nun, geminate'), hollow = nozez('pe-nun, hollow'), none = nozez('none, doubled');
    check('an unlisted type still fails, and so does a listed type the root does not have',
      /gives no deviation from/.test(geminate[0]?.detail) && /calls נוצץ \(לנצוץ\) hollow, which its root נ\.צ\.צ is not/.test(hollow[0]?.detail) && none.length === 1,
      JSON.stringify([geminate, hollow, none]));
    // drill fixes by field (session nine, step 4): set on the data, checked
    // like any other correction
    const gl = req(join(root, 'lib', 'guy-lesson.js'));
    const known = [{ surface: 'נוצץ', root: 'נ.צ.צ', binyan: 'paal', from: 'card' }];
    const drillGuide = (deviation) => ({ sections: [{ kind: 'drills', verbs: [{ verb: 'נוצץ (לנצוץ)', root: 'נ.צ.צ', binyan: "Pa'al", deviation, takes_object: true, exercises: [] }] }], cards: [] });
    const drillFails = (g) => gc.check(g, { items: [] }, known).filter((f) => f.check === 'drill');
    const breaks = (before) => { let cur = drillFails(before); return (next) => { const after = drillFails(next); const broken = cur.length ? [] : after; if (!broken.length) cur = after; return broken; }; };
    const g1 = drillGuide('pe-nun');
    const byField = gl.applyCorrections(g1, { corrections: [
      { section: 'drills', item: 'נוצץ (לנצוץ)', field: 'deviation', find: 'pe-nun', replace: 'pe-nun, doubled', why: 'נ.צ.צ is pe-nun and doubled' },
      { section: 'drills', item: 'נוצץ (לנצוץ)', field: 'takes_object', find: 'true', replace: 'false', why: 'נוצץ takes no object' },
    ], remove: [] }, breaks(g1));
    const v1 = byField.guide.sections[0].verbs[0];
    check('a drill fix by field ("deviation", "takes_object") applies on the data and passes the drill check',
      v1.deviation === 'pe-nun, doubled' && v1.takes_object === false && byField.changes.length === 2 && byField.refused.length === 0 && byField.dropped.length === 0 && drillFails(byField.guide).length === 0,
      JSON.stringify({ v1, refused: byField.refused, dropped: byField.dropped }));
    const breaking = gl.applyCorrections(g1, { corrections: [{ section: 'drills', item: 'נוצץ (לנצוץ)', field: 'deviation', find: '', replace: 'pe-nun, hollow', why: 'wrong' }], remove: [] }, breaks(g1));
    check('a drill fix by field that breaks the drill check is dropped like any other correction',
      breaking.guide.sections[0].verbs[0].deviation === 'pe-nun' && breaking.dropped.length === 1 && breaking.dropped[0].checks.join() === 'drill', JSON.stringify(breaking.dropped));
    const keys = gl.applyCorrections(g1, { corrections: [
      { section: 'drills', item: 'נוצץ (לנצוץ)', field: '', find: '"deviation":"pe-nun"', replace: '"deviation":"pe-nun, doubled"', why: 'as JSON' },
      { section: 'drills', item: 'נוצץ (לנצוץ)', field: '', find: '"takes_object":true', replace: '"takes_object":false', why: 'as JSON' },
      { section: 'drills', item: 'נוצץ (לנצוץ)', field: 'deviation', find: 'none', replace: 'doubled', why: 'the wrong current value' },
    ], remove: [] }, breaks(g1));
    check('a find text that is a JSON key is still refused, and a field fix naming the wrong current value is refused',
      keys.changes.length === 0 && keys.refused.length === 3 && /"deviation":"pe-nun"" is not in it/.test(keys.refused[0]) && /"takes_object":true" is not in it/.test(keys.refused[1])
      && /the drill's deviation is pe-nun, not none/.test(keys.refused[2]) && keys.guide.sections[0].verbs[0].deviation === 'pe-nun',
      JSON.stringify(keys.refused));
    const rs = req(join(root, 'lib', 'guy-lesson-prompt.js')).reviewSystem();
    check('the review prompt says: find text from the guide\'s visible text, never its JSON keys; a drill\'s deviation and takes_object by field',
      /Write "find" from the guide's visible text[^\n]*never from its JSON keys/.test(rs) && /"field": "deviation" or "takes_object"/.test(rs), '');
  }

  // the five rule checks (session five, step 2): each failing once, then passing on the one rebuild
  check('the June guide passes all five checks on the first build: every line covered, first drill Nif\'al, points, flags, objects agree',
    built.guide.checks && built.guide.checks.passed.join(',') === 'coverage,drill,nikud,flags,objects' && built.guide.checks.failed_first.length === 0
    && built.guide.sections.filter((x) => x.kind === 'grammar').flatMap((x) => x.guys_lines).length === L1.body.items.length
    && built.guide.sections.find((x) => x.kind === 'drills').verbs[0].binyan === "Nif'al", JSON.stringify(built.guide.checks));
  for (const fault of ['coverage', 'drill', 'nikud', 'flags', 'objects']) {
    const before = (await orCalls()).guides;
    await control({ guide_faults: [fault] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const v = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    const calls2 = (await orCalls()).guides - before;
    check(`the ${fault} check fails once: one rebuild, the failure named in its prompt, the rebuilt guide saved`,
      v.guide_state === 'built' && !v.guide_error && calls2 === 2 && v.guide.checks.failed_first.join(',') === fault
      && new RegExp(`the ${fault} check`).test((await orCalls()).last_guide_note || '') && new RegExp(`failed the ${fault} check .*rebuilding once`).test(server.log),
      `calls ${calls2}, failed_first ${v.guide && v.guide.checks.failed_first}, note ${((await orCalls()).last_guide_note || '').slice(0, 140)}`);
  }
  {
    const kept = (await api('GET', `/lessons/${L1.body.id}`)).body.guide.built_at;
    await control({ guide_faults: ['drill', 'drill'] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const v = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    check('a check the rebuild still fails no longer throws the guide away: saved, the unmet check named on the guide (23 Sep 2026)',
      v.guide_state === 'built' && !v.guide_error && v.guide.built_at !== kept && v.guide.checks.unmet.map((f) => f.check).join(',') === 'drill'
      && /the first drill is לכתוב/.test(v.guide.checks.unmet[0].detail) && !v.guide.checks.passed.includes('drill') && /saved with the drill check unmet/.test(server.log),
      JSON.stringify(v.guide.checks));
    await control({ guide_faults: ['drill', 'flags'] });
    await api('POST', `/lessons/${L1.body.id}/guide`, { rebuild: true });
    const w1 = await until(L1.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    check('the live failure of 23 Sep (drill, then flags): the rebuild is kept as no worse, and the review, told the flags check is unmet, fills the missing flags',
      w1.guide_state === 'built' && w1.guide.checks.unmet.length === 0 && w1.guide.review.state === 'applied'
      && w1.guide.review.changes.filter((c) => /^Spelling flag added/.test(c)).length >= 5, JSON.stringify({ checks: w1.guide.checks, changes: w1.guide.review.changes.length, refused: w1.guide.review.refused }));
    await control({ guide_faults: ['flags', 'flags'] });
    await api('POST', `/lessons/${L2.body.id}/guide`, {});
    const w = await until(L2.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    check('a first build failing twice still gives a guide; the review fixes what it can, and the words are saved',
      w.guide_state === 'built' && w.guide !== null && w.saved !== null && w.guide.checks.unmet.length === 0 && w.guide.review.changes.length > 1, JSON.stringify(w.guide && w.guide.checks));
    const gc = req(join(root, 'lib', 'guide-checks.js'));
    const live = gc.check({ sections: [{ kind: 'drills', verbs: [{ verb: 'לחשוש', root: 'ח.ש.ש', binyan: "Pa'al", deviation: 'doubled', takes_object: 'both', exercises: [] }] }], cards: [] },
      { items: [] }, [{ surface: 'נוצץ', root: 'נ.צ.צ', binyan: 'paal', from: 'card' }]);
    const clean = gc.check({ sections: [{ kind: 'drills', verbs: [{ verb: 'להסלים', root: 'ס.ל.ם', binyan: "Hif'il", deviation: 'none', takes_object: 'both', exercises: [] }] }], cards: [] },
      { items: [] }, [{ surface: 'נוצץ', root: 'נ.צ.צ', binyan: 'paal', from: 'card' }]);
    const zinek = gc.check({ sections: [{ kind: 'drills', verbs: [{ verb: 'לזנק', root: 'ז.נ.ק', binyan: "Pi'el", deviation: 'none', takes_object: false, exercises: [] }] }], cards: [] },
      { items: [] }, [{ surface: 'לזנק', root: 'ז.נ.ק', binyan: 'paal', from: 'card' }]);
    const fakeNifal = gc.check({ sections: [{ kind: 'drills', verbs: [{ verb: 'לכתוב', root: 'כ.ת.ב', binyan: "Nif'al", deviation: 'none', takes_object: true, exercises: [] }] }], cards: [] },
      { items: [] }, [{ surface: 'לכתוב', root: 'כ.ת.ב', binyan: 'paal', from: 'card' }, { surface: 'נאלצה', root: 'א.ל.צ', binyan: 'nifal', from: 'card' }]);
    check("a card that disagrees is not a failure by itself (לזנק's card says Pa'al), but it stops a false Nif'al claim",
      zinek.length === 0 && fakeNifal.some((f) => f.check === 'drill'), JSON.stringify([zinek, fakeNifal.map((f) => f.detail)]));
    check('the drill check reads irregularity from the root, not the label: לחשוש (ח.ש.ש) labeled "doubled" passes as guttural; להסלים still fails (the live rebuild of 23 Sep 2026)',
      live.length === 0 && clean.some((f) => f.check === 'drill'), JSON.stringify([live, clean.map((f) => f.check)]));
    check('root deviations read from the letters: נ.ק.ז pe-nun, ר.ג.ע guttural, כ.ו.ן hollow, ס.ל.ם none of the three',
      gc.rootDeviations('נ.ק.ז').includes('pe-nun') && gc.rootDeviations('ר.ג.ע').includes('guttural') && gc.rootDeviations('כ.ו.ן').includes('hollow')
      && !gc.irregular({ root: 'ס.ל.ם', binyan: "Hif'il" }) && gc.irregular({ root: 'ק.ב.ע', binyan: 'nifal' }) && gc.binyanKey("Pa'al (present)") === 'paal');
  }

  // "try again" on a word the card could not identify (session five, step 5)
  {
    const c0 = (await orCalls()).calls;
    const miss = await api('POST', `/lessons/${L1.body.id}/retry`, { surface: 'הנהלה' });
    const c1 = (await orCalls()).calls;
    const still = (await api('GET', `/lessons/${L1.body.id}`)).body.saved;
    check('try again that fails again: one model call, the card\'s own error, the word still listed',
      miss.status === 422 && /unknown word הנהלה/.test(miss.body.error) && c1 - c0 === 1 && still.failed.length === 1 && still.failed[0].surface === 'הנהלה', `${miss.status} ${miss.body.error} calls ${c1 - c0}`);
    await control({ extra_cards: { 'הנהלה': { surface: 'הנהלה', lemma: 'הנהלה', pos: 'noun', root: 'נ.ה.ל', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'management, the board', governs: null, categories: [], note: null } } });
    const putsB = await putCounts();
    const hit = await api('POST', `/lessons/${L1.body.id}/retry`, { surface: 'הנהלה' });
    const c2 = (await orCalls()).calls;
    const putsA = await putCounts();
    check('try again that succeeds: one model call, saved shaky and sent to the spine like the others, out of the list',
      hit.status === 200 && hit.body.result === 'saved' && c2 - c1 === 1 && hit.body.saved.failed.length === 0 && hit.body.saved.words === saved.words + 1
      && (await spotRow('w:הנהלה')).status === 'shaky' && (putsA['w:הנהלה'] || 0) - (putsB['w:הנהלה'] || 0) === 1
      && (await api('GET', `/lessons/${L1.body.id}`)).body.saved.failed.length === 0, JSON.stringify(hit.body).slice(0, 200));
    const notListed = await api('POST', `/lessons/${L1.body.id}/retry`, { surface: 'הסלמה' });
    check('try again on a word that is not in the list is refused, naming it', notListed.status === 404 && /הסלמה is not among/.test(notListed.body.error), notListed.body.error);
  }

  // the review corrects the lesson's word cards (session six, step 1)
  {
    const Database = req(join(root, 'node_modules', 'better-sqlite3'));
    const cardsNow = () => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); const rows = d.prepare('SELECT surface, context_hash, spot_id, json FROM cards ORDER BY id').all(); d.close(); return rows; };
    const cardOf = (rows, w) => rows.filter((r) => r.surface === w).map((r) => ({ ...r, card: JSON.parse(r.json) }));
    const first = (await api('GET', `/lessons/${L1.body.id}`)).body;
    const hs = cardOf(cardsNow(), 'הסלמה')[0].card;
    check("on a lesson's first build the cards are made before the review, which sees them; its root fix reaches the card before the save, so the word is saved with the corrected root (הסלמה ס.ל.מ -> ס.ל.ם)",
      hs.root === 'ס.ל.ם' && hs.corrected?.length >= 1 && hs.corrected[0].before === 'ס.ל.מ' && hs.corrected[0].after === 'ס.ל.ם' && hs.corrected[0].by === 'lesson review'
      && (await spotRow('w:הסלמה')).root === 'ס.ל.ם' && /card הסלמה root ס\.ל\.מ -> ס\.ל\.ם \(the lesson review\)/.test(server.log) && Array.isArray(firstReviewCards) && firstReviewCards.map((c) => c.word).sort().join(',') === ['יו״ש', 'הסלמה', 'נאלצה', 'נחתם'].sort().join(',')
      && firstReviewCards.find((c) => c.word === 'הסלמה').root === 'ס.ל.מ' && hasla.fields.root === 'ס.ל.ם' && built.guide.review.cards?.corrected.some((x) => x.surface === 'הסלמה' && x.field === 'root')
      && first.guide.review.cards?.unchanged.includes('הסלמה: root ס.ל.ם'),
      JSON.stringify(hs.corrected));
    const before = cardsNow();
    const wrongSpot = await spotRow('v:ב.ו.ש:paal');
    const putsB = await putCounts();
    await control({ review_extra: [
      { section: 'word_cards', item: 'להתבייש', field: 'binyan', find: "Pa'al", replace: 'hitpael', why: "להתבייש is Hitpa'el (ב.ו.ש), not Pa'al." },
      { section: 'word_cards', item: 'נלחם', field: 'binyan', find: 'nifal', replace: "Nif'al", why: 'checked: right as it is' },
      { section: 'word_cards', item: 'התבייש', field: 'root', find: 'ב.י.ש', replace: 'ב.ו.ש', why: 'the root of התבייש' },
      { section: 'drills', item: 'להיאלץ', find: "Nif'al", replace: "Nif'al (passive)", why: 'the drill binyan named more fully' },
    ], verb_fixes: { 'להתבייש': { binyan: 'hitpael', why: "the verb check agrees: Hitpa'el" } } }); // the two checks agree (session nine)
    await api('POST', `/lessons/${L2.body.id}/guide`, { rebuild: true });
    const v = await until(L2.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    await control({ review_extra: [], verb_fixes: {} });
    const after = cardsNow();
    const rc = v.guide.review.cards || { corrected: [], unchanged: [], refused: [] };
    const seen = (await orCalls()).last_review_cards || [];
    check('the review is given the lesson\'s word cards alongside the guide, the wrong one as it stands',
      seen.length === 4 && seen.some((c) => c.word === 'להתבייש' && c.binyan === 'paal') && seen.every((c) => 'root' in c && 'binyan' in c && 'lemma' in c), JSON.stringify(seen));
    const nl0 = cardOf(before, 'נלחם')[0], nl1 = cardOf(after, 'נלחם')[0];
    check('a correct card is left alone: נלחם already Nif\'al, the card unchanged and not marked corrected',
      nl1.json === nl0.json && !nl1.card.corrected && rc.unchanged.some((u) => /^נלחם: binyan nifal$/.test(u)), JSON.stringify(rc.unchanged));
    const zb = cardOf(after, 'להתבייש')[0];
    const moved = await spotRow('v:ב.ו.ש:hitpael');
    const gone = await api('GET', '/spots/' + encodeURIComponent('v:ב.ו.ש:paal'));
    const putsA = await putCounts();
    check("a wrong card is corrected (its current binyan named as \"Pa'al\", not refused for the spelling): להתבייש Pa'al -> Hitpa'el, logged, the card carrying before and after, its spot moved with its status and touches, the spine told",
      zb.card.binyan === 'hitpael' && zb.spot_id === 'v:ב.ו.ש:hitpael' && zb.card.corrected?.length === 1 && zb.card.corrected[0].before === 'paal' && zb.card.corrected[0].after === 'hitpael'
      && zb.card.corrected[0].lesson_title === 'שיעור עם גיא — 24.2.2026' && rc.corrected.some((x) => x.surface === 'להתבייש' && x.replaced === 'v:ב.ו.ש:paal')
      && wrongSpot.status === 'shaky' && moved.status === 'shaky' && moved.touches >= wrongSpot.touches && gone.status === 404
      && (putsA['v:ב.ו.ש:hitpael'] || 0) - (putsB['v:ב.ו.ש:hitpael'] || 0) === 1
      && /card להתבייש binyan paal -> hitpael \(the lesson review and verb check\), spot v:ב\.ו\.ש:paal -> v:ב\.ו\.ש:hitpael/.test(server.log),
      JSON.stringify({ card: zb.card.binyan, spot: zb.spot_id, moved, wrongSpot: wrongSpot.status, corrected: rc.corrected }));
    const tap = await api('POST', '/lookup', { surface: 'להתבייש', sentence: 'להתבייש', lesson_id: L2.body.id });
    check('a tap on the corrected word opens the corrected card, from the cache',
      tap.status === 200 && tap.body.cached === true && tap.body.card.binyan === 'hitpael' && tap.body.card.corrected?.[0]?.before === 'paal' && tap.body.spot.id === 'v:ב.ו.ש:hitpael');
    const tb0 = cardOf(before, 'להתייבש')[0], tb1 = cardOf(after, 'להתייבש')[0];
    check('a correction matching two cards (התבייש: להתבייש by its lemma, and להתייבש given the same lemma) is refused and listed, neither card touched by it',
      rc.refused.some((r) => /^התבייש \(root\): matches 2 word cards \(להתבייש, להתייבש\); not guessed$/.test(r)) && tb1.json === tb0.json && zb.card.root === 'ב.ו.ש',
      JSON.stringify(rc.refused));
    const drill = v.guide.sections.find((x) => x.kind === 'drills').verbs[0];
    const others = (rows) => JSON.stringify(rows.filter((r) => r.surface !== 'להתבייש').map((r) => [r.context_hash, r.spot_id, r.json]));
    check('a guide correction to a word with no card of this lesson (the drill להיאלץ) changes the guide and no card at all',
      drill.binyan === "Nif'al (passive)" && others(after) === others(before) && !rc.refused.some((r) => r.startsWith('להיאלץ')) && after.length === before.length,
      `${drill.binyan}; refused ${JSON.stringify(rc.refused)}`);
  }

  // the verb-card check (session eight, step 4): after the review, a small
  // call over the lesson's verb cards only
  {
    const Database = req(join(root, 'node_modules', 'better-sqlite3'));
    const cardsNow = () => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); const rows = d.prepare('SELECT surface, spot_id, json FROM cards ORDER BY id').all(); d.close(); return rows.map((r) => ({ ...r, card: JSON.parse(r.json) })); };
    const verbCalls = async () => (await orCalls()).verb_checks;
    const rebuild = async (c) => {
      await control({ verb_fixes: {}, verb_extra: [], verb_decline: false, guide_silent: [], review_extra: [], review_verdicts: {}, review_verdict_extra: [], ...c });
      const n0 = await verbCalls();
      await api('POST', `/lessons/${L2.body.id}/guide`, { rebuild: true });
      const v = await until(L2.body.id, (x) => x.guide_state !== 'building' && !x.saving);
      return { v, vc: v.guide.verb_check, asked: (await verbCalls()) - n0, sent: (await orCalls()).last_verb_cards, ask: (await orCalls()).last_verb_ask };
    };
    const before = cardsNow();
    let r = await rebuild({});
    const verbs = before.filter((x) => x.card.pos === 'verb' && ['להתבייש', 'להתייבש', 'נלחם'].includes(x.surface));
    check('verb cards all correct: one call with only the lesson\'s verb cards (word, lemma, root, binyan), no card changed, "checked 3, corrected 0"',
      r.asked === 1 && r.vc.state === 'checked' && r.vc.checked === 3 && r.vc.corrected.length === 0 && r.vc.refused.length === 0
      && r.sent.map((c) => c.word).sort().join() === ['להתבייש', 'להתייבש', 'נלחם'].sort().join() && r.sent.every((c) => Object.keys(c).join() === 'word,lemma,root,binyan')
      && r.sent.find((c) => c.word === 'להתבייש').binyan === 'hitpael' && JSON.stringify(cardsNow()) === JSON.stringify(before) && verbs.length === 3,
      JSON.stringify({ vc: r.vc, sent: r.sent, asked: r.asked }));
    check('the verb-card check asks for structured output, on the guide model, with a token limit from its expected output (400 + 150 a verb)',
      r.ask.type === 'json_schema' && r.ask.schema_name === 'verb_cards_check' && r.ask.max_tokens === 400 + 150 * 3 && r.ask.model === 'anthropic/claude-opus-4.6', JSON.stringify(r.ask));
    const putsB = await putCounts();
    // the לזנק case (session nine, step 1): the review says nothing of the card
    // (its guide gives no binyan for the word), the check proposes a fix
    r = await rebuild({ guide_silent: ['נלחם'], verb_fixes: { 'נלחם': { binyan: 'piel', why: "נלחם given here as Pi'el (a mock's claim)" } } });
    let nl = cardsNow().find((x) => x.surface === 'נלחם');
    const putsA = await putCounts();
    check('the review silent on a card, the verb check proposing a fix (the לזנק case): applied through the review\'s card path — logged, the card carrying "verb-card check" and before and after, its spot moved, the spine told; "checked 3, corrected 1"',
      r.vc.checked === 3 && r.vc.corrected.length === 1 && r.vc.corrected[0].surface === 'נלחם' && r.vc.corrected[0].before === 'nifal' && r.vc.corrected[0].after === 'piel'
      && r.vc.disagreed.length === 0 && nl.card.binyan === 'piel' && nl.spot_id === 'v:ל.ח.מ:piel' && nl.card.corrected?.at(-1)?.by === 'verb-card check' && nl.card.corrected.at(-1).before === 'nifal'
      && /card נלחם binyan nifal -> piel \(the verb-card check\)/.test(server.log) && /verb cards checked in \d+ ms: 3, fixes proposed 1/.test(server.log)
      && (putsA['v:ל.ח.מ:piel'] || 0) - (putsB['v:ל.ח.מ:piel'] || 0) === 1,
      JSON.stringify({ vc: r.vc, card: nl.card }));
    // the corrected card refreshed (session nine, step 2): re-pointed and its
    // note written again for Pi'el, once, straight after the correction
    const refreshCalls = async () => (await orCalls()).refresh_calls;
    check("a corrected card is re-pointed and its note written again for the corrected binyan, once, after the correction: נִלְחֵם, \"Pi'el of ל.ח.מ\"",
      nl.card.pointed?.lemma === 'נִלְחֵם' && nl.card.note === "Pi'el of ל.ח.מ, as corrected." && nl.card.refreshed?.for === nl.card.corrected.length && !nl.card.refreshed.failed
      && /nikud and note refreshed for the corrected card "נלחם"/.test(server.log), JSON.stringify({ pointed: nl.card.pointed, note: nl.card.note, refreshed: nl.card.refreshed }));
    {
      // a card corrected before this session (לזנק live): corrected, never refreshed
      const unrefresh = () => { const d = new Database(join(dataDir, 'reader.db')); const row = d.prepare("SELECT id, json FROM cards WHERE surface = 'נלחם'").get(); const c = JSON.parse(row.json); delete c.refreshed; c.note = "Nif'al; fights ב- (in), not 'against'."; d.prepare('UPDATE cards SET json = ? WHERE id = ?').run(JSON.stringify(c), row.id); d.close(); };
      unrefresh();
      const n0 = await refreshCalls();
      const open1 = await api('POST', '/lookup', { surface: 'נלחם', sentence: 'נלחם', lesson_id: L2.body.id });
      const got1 = await api('POST', '/lookup/refresh', { surface: 'נלחם', sentence: 'נלחם' });
      const n1 = await refreshCalls();
      const open2 = await api('POST', '/lookup', { surface: 'נלחם', sentence: 'נלחם', lesson_id: L2.body.id });
      const got2 = await api('POST', '/lookup/refresh', { surface: 'נלחם', sentence: 'נלחם' });
      const n2 = await refreshCalls();
      check('a card corrected before this session is refreshed the first time it is opened (one call), and the second open makes no call',
        open1.body.refresh_due === true && !open1.body.points_missing && got1.status === 200 && got1.body.called === true && got1.body.card.note === "Pi'el of ל.ח.מ, as corrected." && n1 - n0 === 1
        && !open2.body.refresh_due && open2.body.card.note === "Pi'el of ל.ח.מ, as corrected." && got2.body.called === false && n2 === n1,
        JSON.stringify({ open1: open1.body.refresh_due, got1: got1.body, open2: open2.body.refresh_due, calls: [n0, n1, n2] }));
      unrefresh();
      await control({ refresh_fail: true });
      const bad = await api('POST', '/lookup/refresh', { surface: 'נלחם', sentence: 'נלחם' });
      await control({ refresh_fail: false });
      const open3 = await api('POST', '/lookup', { surface: 'נלחם', sentence: 'נלחם', lesson_id: L2.body.id });
      check('a refresh that fails is never silent: the card keeps the reason, and it is tried again at the next open',
        bad.status === 200 && bad.body.called === true && /the model declined — the pointer declines/.test(bad.body.failed) && /the model declined/.test(bad.body.card.refreshed?.failed)
        && open3.body.refresh_due === true && /nikud and note not refreshed for the corrected card "נלחם"/.test(server.log), JSON.stringify({ bad: bad.body, open3: open3.body.refresh_due }));
      await api('POST', '/lookup/refresh', { surface: 'נלחם', sentence: 'נלחם' });
    }
    r = await rebuild({ verb_fixes: { 'נלחם': { binyan: "Nif'al", why: "נלחם is Nif'al" } }, verb_extra: [
      { word: 'נִלְחַם', verdict: 'correct', root: 'ל.ח.ם', binyan: "Nif'al", why: '' },
      { word: 'לזנק', verdict: 'fix', root: 'ז.נ.ק', binyan: 'piel', why: 'a word of another lesson' },
      { word: 'שביתה', verdict: 'fix', root: 'ש.ב.ת', binyan: 'paal', why: 'a noun card of this lesson' },
    ] });
    const others = cardsNow().filter((x) => x.surface !== 'נלחם');
    check('answers naming a card that is not one of the lesson\'s verb cards (another lesson\'s word, a noun of this one) are refused and listed, changing nothing; the real fix applied — given as "Nif\'al", and a pointed נִלְחַם with a final-letter root is not refused (false-rejection check)',
      r.vc.refused.length === 2 && r.vc.refused[0] === "לזנק: not one of this lesson's verb cards" && r.vc.refused[1] === "שביתה: not one of this lesson's verb cards"
      && r.vc.corrected.length === 1 && cardsNow().find((x) => x.surface === 'נלחם').card.binyan === 'nifal'
      && JSON.stringify(others) === JSON.stringify(before.filter((x) => x.surface !== 'נלחם').map((x) => ({ ...x }))),
      JSON.stringify(r.vc));
    check('the review\'s guide giving the fix the check proposes (Nif\'al for a Pi\'el card): applied as agreed by both',
      cardsNow().find((x) => x.surface === 'נלחם').card.corrected?.at(-1)?.by === 'lesson review and verb check', JSON.stringify(cardsNow().find((x) => x.surface === 'נלחם').card.corrected));
    // the נוצץ case: the review says the card's own binyan (its guide gives
    // Nif'al, as the card), the check proposes Pi'el
    const beforeDis = cardsNow();
    r = await rebuild({ verb_fixes: { 'נלחם': { binyan: 'piel', why: "a mock's wrong claim" } } });
    check('the review saying the card is right and the check proposing a change (the נוצץ case): the card not changed, listed as "review says Nif\'al, verb check says Pi\'el"',
      r.vc.corrected.length === 0 && r.vc.disagreed.length === 1 && r.vc.disagreed[0].line === "נלחם: review says Nif'al, verb check says Pi'el"
      && JSON.stringify(cardsNow()) === JSON.stringify(beforeDis) && /card נלחם binyan not changed, the two checks disagree/.test(server.log),
      JSON.stringify(r.vc));
    // both propose the same fix: applied
    r = await rebuild({ verb_fixes: { 'נלחם': { binyan: 'piel', why: 'both say so here' } },
      review_extra: [{ section: 'word_cards', item: 'נלחם', field: 'binyan', find: "Nif'al", replace: "Pi'el", why: "the review's card fix" }] });
    nl = cardsNow().find((x) => x.surface === 'נלחם');
    check('the review and the check proposing the same fix: applied, once, as agreed by both, and listed on both sides',
      nl.card.binyan === 'piel' && nl.card.corrected.at(-1).by === 'lesson review and verb check' && r.vc.corrected.length === 1 && r.v.guide.review.cards.corrected.length === 1
      && r.vc.disagreed.length === 0, JSON.stringify({ vc: r.vc, cards: r.v.guide.review.cards }));
    // the review proposing, the check saying the card is right: not changed
    const beforeDis2 = cardsNow();
    r = await rebuild({ review_extra: [{ section: 'word_cards', item: 'נלחם', field: 'binyan', find: "Pi'el", replace: "Nif'al", why: "the review's card fix" }] });
    check('the review proposing a fix and the check saying the card is right: not changed, listed',
      r.vc.disagreed.length === 1 && r.vc.disagreed[0].line === "נלחם: review says Nif'al, verb check says Pi'el" && r.v.guide.review.cards.corrected.length === 0
      && JSON.stringify(cardsNow()) === JSON.stringify(beforeDis2), JSON.stringify({ vc: r.vc, cards: r.v.guide.review.cards }));
    // back to Nif'al: the guide gives Nif'al, the check proposes it
    r = await rebuild({ verb_fixes: { 'נלחם': { binyan: "Nif'al", why: 'back' } } });
    check('put back by agreement (the guide and the check both Nif\'al)', cardsNow().find((x) => x.surface === 'נלחם').card.binyan === 'nifal', JSON.stringify(r.vc));
    r = await rebuild({ verb_decline: true });
    check('a verb-card check that does not answer: the guide saved, the check marked not run with the reason',
      r.v.guide_state === 'built' && r.vc.state === 'not run' && /The verb-card check could not run: the model declined/.test(r.vc.reason) && r.vc.checked === 3, JSON.stringify(r.vc));
    // the review's own verdict on each verb card (session ten, step 3): the
    // agreement rule weighs it against the verb check, never the guide's text
    {
      const nlNow = () => cardsNow().find((x) => x.surface === 'נלחם');
      const v0 = nlNow();
      // the לזנק case: the guide gives the card's value (as the June guide gives
      // לזנק as Pa'al), the review's verdict and the check both say Pi'el
      r = await rebuild({ review_verdicts: { 'נלחם': { verdict: 'fix', root: 'ל.ח.מ', binyan: 'piel', why: "the review's verdict: Pi'el" } }, verb_fixes: { 'נלחם': { binyan: 'piel', why: "the check: Pi'el" } } });
      const gRow = r.v.guide.sections.find((x) => x.kind === 'vocabulary').rows.find((x) => x.he === 'נלחם');
      check("the לזנק case: the guide gives the card's binyan, the review's verdict and the verb check both give Pi'el: applied, as agreed by both",
        v0.card.binyan === 'nifal' && gRow.binyan === "Nif'al" && nlNow().card.binyan === 'piel' && nlNow().card.corrected.at(-1).by === 'lesson review and verb check'
        && r.vc.corrected.length === 1 && r.vc.disagreed.length === 0 && r.v.guide.review.verdicts.some((x) => x.word === 'נלחם' && x.verdict === 'fix' && x.binyan === 'piel' && x.root === ''),
        JSON.stringify({ vc: r.vc, verdicts: r.v.guide.review.verdicts, row: gRow }));
      r = await rebuild({ review_verdicts: { 'נלחם': { verdict: 'fix', root: 'ל.ח.מ', binyan: 'nifal', why: 'back' } }, verb_fixes: { 'נלחם': { binyan: 'nifal', why: 'back' } } });
      const v1 = nlNow();
      // the נוצץ case, with a guide that gives no binyan for the word, so the
      // review's verdict is the only thing it can have said
      r = await rebuild({ guide_silent: ['נלחם'], review_verdicts: { 'נלחם': { verdict: 'correct', root: 'ל.ח.מ', binyan: 'nifal', why: '' } }, verb_fixes: { 'נלחם': { binyan: 'piel', why: "a mock's wrong claim" } } });
      check("the נוצץ case: the review's verdict says the card is right, the verb check proposes Pi'el: not changed, listed as \"review says Nif'al, verb check says Pi'el\" (the guide silent on the word)",
        v1.card.binyan === 'nifal' && JSON.stringify(nlNow()) === JSON.stringify(v1) && r.vc.corrected.length === 0 && r.vc.disagreed.length === 1
        && r.vc.disagreed[0].line === "נלחם: review says Nif'al, verb check says Pi'el", JSON.stringify(r.vc));
      // no verdict on the card: the review said nothing of it, whatever its guide gives
      r = await rebuild({ review_verdicts: { 'נלחם': null }, verb_fixes: { 'נלחם': { binyan: 'piel', why: "the check: Pi'el" } } });
      const gRow2 = r.v.guide.sections.find((x) => x.kind === 'vocabulary').rows.find((x) => x.he === 'נלחם');
      check("a review answer with no verdict on a verb card says nothing of it: the verb check's fix applied, though the guide gives the card's own binyan; the missing verdict named",
        gRow2.binyan === "Nif'al" && nlNow().card.binyan === 'piel' && nlNow().card.corrected.at(-1).by === 'verb-card check' && r.vc.disagreed.length === 0
        && r.v.guide.review.verdicts_missing.includes('נלחם') && /review verdicts on verb cards: 2 of 3, none for נלחם/.test(server.log),
        JSON.stringify({ vc: r.vc, missing: r.v.guide.review.verdicts_missing }));
      // a verdict written with nikud and a binyan spelled "Nif'al" is still read (false-rejection check);
      // one naming another lesson's word or a noun of this one is refused and listed
      r = await rebuild({ review_verdicts: { 'נלחם': { word: 'נִלְחַם', verdict: 'fix', root: 'ל.ח.מ', binyan: "Nif'al", why: "נלחם is Nif'al" } },
        verb_fixes: { 'נלחם': { binyan: 'nifal', why: 'back' } } });
      check("a verdict given as נִלְחַם with nikud and \"Nif'al\" is read as the card's (false-rejection check): with the check, applied as agreed by both",
        nlNow().card.binyan === 'nifal' && nlNow().card.corrected.at(-1).by === 'lesson review and verb check' && !r.v.guide.review.verdicts_refused.length
        && r.v.guide.review.verdicts.some((x) => x.word === 'נלחם' && x.binyan === 'nifal'), JSON.stringify(r.v.guide.review));
      const beforeX = cardsNow();
      r = await rebuild({ review_verdict_extra: [
        { word: 'לזנק', verdict: 'fix', root: 'ז.נ.ק', binyan: 'piel', why: 'a word of another lesson' },
        { word: 'שביתה', verdict: 'fix', root: 'ש.ב.ת', binyan: 'paal', why: 'a noun card of this lesson' },
      ] });
      check("verdicts naming a word that is not one of the lesson's verb cards (another lesson's word, a noun of this one) are refused and listed, changing nothing",
        r.v.guide.review.verdicts_refused.join(' | ') === "לזנק: not one of this lesson's verb cards | שביתה: not one of this lesson's verb cards"
        && JSON.stringify(cardsNow()) === JSON.stringify(beforeX), JSON.stringify(r.v.guide.review.verdicts_refused));
      const lam = cardsNow().filter((x) => x.card.pos === 'verb').map((x) => x.surface);
      await control({ review_verdicts: {}, review_verdict_extra: [] });
      const vp = await import('node:module');
      const lessonMod = vp.createRequire(import.meta.url)(join(root, 'lib', 'guy-lesson-prompt.js'));
      const sys = lessonMod.reviewSystem();
      check('the review prompt asks for a verdict on every verb card, judged from the word and not from the guide, and verb cards corrected by verdict only',
        /"verb_cards" has one entry for every verb card in the card list, none left out/.test(sys) && /judged from the word itself, not from what the guide says of it/.test(sys)
        && /A verb card is corrected by its verdict, never through "word_cards"/.test(sys) && lam.length > 0, '');
    }
    // a card Dan confirmed (session ten, step 1): no check changes it, and
    // the page lists what was proposed
    {
      const setConfirmed = (on) => {
        const d = new Database(join(dataDir, 'reader.db'));
        for (const row of d.prepare("SELECT id, json FROM cards WHERE surface = 'נלחם'").all()) {
          const c = JSON.parse(row.json);
          if (on) c.confirmed = { on: '2026-09-24', root: c.root, binyan: c.binyan }; else delete c.confirmed;
          d.prepare('UPDATE cards SET json = ? WHERE id = ?').run(JSON.stringify(c), row.id);
        }
        d.close();
      };
      setConfirmed(true);
      const conf0 = cardsNow().find((x) => x.surface === 'נלחם');
      const reviewPiel = [{ section: 'word_cards', item: 'נלחם', field: 'binyan', find: "Nif'al", replace: "Pi'el", why: "the review's card fix" }];
      const unchanged = () => JSON.stringify(cardsNow().find((x) => x.surface === 'נלחם')) === JSON.stringify(conf0);
      r = await rebuild({ review_extra: reviewPiel, verb_decline: true });
      check('a card Dan confirmed survives a review fix on its own (the verb check not run): not changed, listed as "you confirmed this card", logged',
        conf0.card.binyan === 'nifal' && unchanged() && r.v.guide.review.cards.kept?.join() === 'נלחם' && r.v.guide.review.cards.corrected.length === 0
        && /card נלחם binyan not changed, Dan confirmed it/.test(server.log), JSON.stringify({ cards: r.v.guide.review.cards, vc: r.vc.state }));
      r = await rebuild({ guide_silent: ['נלחם'], verb_fixes: { 'נלחם': { binyan: 'piel', why: "a mock's claim" } } });
      check('a card Dan confirmed survives a verb-check fix the review is silent on: not changed, listed, "not changed" counted',
        unchanged() && r.vc.corrected.length === 0 && r.vc.disagreed.length === 0 && r.v.guide.review.cards.kept?.join() === 'נלחם', JSON.stringify({ vc: r.vc, cards: r.v.guide.review.cards }));
      r = await rebuild({ review_extra: reviewPiel, verb_fixes: { 'נלחם': { binyan: 'piel', why: 'both say so here' } } });
      check('a card Dan confirmed survives the review and the verb check agreeing on a fix: not changed, listed once',
        unchanged() && r.vc.corrected.length === 0 && r.v.guide.review.cards.corrected.length === 0 && r.v.guide.review.cards.kept?.join() === 'נלחם', JSON.stringify({ vc: r.vc, cards: r.v.guide.review.cards }));
      const tapC = await api('POST', '/lookup', { surface: 'נלחם', sentence: 'נלחם', lesson_id: L2.body.id });
      check('the confirmed card opens with its confirmation on it', tapC.body.card.confirmed?.on === '2026-09-24' && tapC.body.card.binyan === 'nifal', JSON.stringify(tapC.body.card.confirmed));
      r = await rebuild({});
      check('checks proposing nothing for a confirmed card list nothing', unchanged() && !(r.v.guide.review.cards.kept || []).length, JSON.stringify(r.v.guide.review.cards));
      setConfirmed(false);
    }
    await control({ verb_fixes: {}, verb_extra: [], verb_decline: false });
  }

  // the model refusing the guide; opened twice at once, as two tabs would (session six, step 2)
  const gBefore = await guideCalls();
  const [open1, open2] = await Promise.all([api('POST', `/lessons/${L3.body.id}/guide`, {}), api('POST', `/lessons/${L3.body.id}/guide`, {})]);
  const failedGuide = await until(L3.body.id, (v) => v.guide_state !== 'building');
  check('a lesson with no guide opened twice at once starts one build, not two: both answer "building", one guide call',
    open1.status === 202 && open2.status === 202 && open1.body.guide_state === 'building' && open2.body.guide_state === 'building' && (await guideCalls()) - gBefore === 1,
    `${open1.status}/${open2.status}, guide calls ${(await guideCalls()) - gBefore}`);
  check('the model refusing leaves the raw items and one line, nothing saved',
    failedGuide.guide_state === 'failed' && failedGuide.guide === null && failedGuide.saved === null && failedGuide.items.length === 5
    && /^The study guide could not be built: the model declined — /.test(failedGuide.guide_error), failedGuide.guide_error);
  }

  {
  // delete and prefixed tinting (session five, step 4)
  const putCounts = async () => (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/puts`)).json()).puts;
  const touchCount = async () => (await spotRow('w:ממסד')).touches;
  const art = await api('POST', '/articles', { text: 'בדיקה של מילים מהשיעור\nהמצב הוביל להסלמה ולא לשקט.\nהממסד שתק.' });
  await api('POST', '/lookup', { surface: 'הממסד', sentence: 'הממסד שתק.', article_id: art.body.id });
  await api('POST', '/spots/' + encodeURIComponent('w:ממסד'), { status: 'shaky' });
  await api('POST', '/lookup', { surface: 'דם', sentence: 'דם', article_id: art.body.id });
  await api('POST', '/spots/' + encodeURIComponent('w:דם'), { status: 'shaky' });
  const para = 'הממסד שתק, והממסד חשש. לממסד אין תשובה, בממסד יודעים, מהממסד לא יצא דבר, ושהממסד יודע. הדם זרם, והדם נעצר.';
  const art2 = await api('POST', '/articles', { text: `עוד בדיקה\n${para}` });
  const m2 = (await api('GET', `/marks-for-article/${art2.body.id}`)).body;
  const tint = (w) => (tok.markFor(w, m2.surfaces, m2.lemmas) || {}).status || 'plain';
  const forms = ['הממסד', 'והממסד', 'לממסד', 'בממסד', 'מהממסד', 'ושהממסד'];
  check('prefixed tinting: with הממסד saved, its ה/ו/ב/ל/מ/ש forms tint in a pasted paragraph',
    forms.every((w) => tint(w) === 'shaky') && m2.lemmas['ממסד']?.status === 'shaky', forms.map((w) => `${w}:${tint(w)}`).join(' '));
  check('a token of three letters is never stripped (הדם stays plain with דם saved); four letters are (והדם)',
    tint('הדם') === 'plain' && tint('והדם') === 'shaky' && tint('שתק') === 'plain', `הדם:${tint('הדם')} והדם:${tint('והדם')}`);
  check('one prefix only: two stacked prefixes are not stripped (לבממסד)', tint('לבממסד') === 'plain');
  const spotsBefore = (await api('GET', '/spots')).body.items.length;
  const tBefore = await touchCount();
  const putsBefore = JSON.stringify(await putCounts());
  const delArt = await api('DELETE', `/articles/${art.body.id}`);
  const gone = await api('GET', `/articles/${art.body.id}`);
  const m3 = (await api('GET', `/marks-for-article/${art2.body.id}`)).body;
  check('delete an article: gone, its saved words still tinted elsewhere, touches and spots kept, nothing sent to the spine',
    delArt.status === 200 && gone.status === 404 && m3.surfaces['הממסד']?.status === 'shaky' && (await api('GET', '/spots')).body.items.length === spotsBefore
    && (await touchCount()) === tBefore && (await spotRow('w:ממסד')).touches >= 1 && JSON.stringify(await putCounts()) === putsBefore && /article \d+: deleted \(touches and spots kept\)/.test(server.log),
    `${delArt.status} ${gone.status}`);
  const lessonsBefore = (await api('GET', '/lessons')).body.items;
  const L1id = lessonsBefore.find((l) => l.lesson_date === '2026-06-15').id;
  const hBefore = await spotRow('w:הסלמה');
  const delLesson = await api('DELETE', `/lessons/${L1id}`);
  const hAfter = await spotRow('w:הסלמה');
  check('delete a lesson: its guide and items go, the words it saved stay shaky with their touches, nothing sent to the spine',
    delLesson.status === 200 && (await api('GET', `/lessons/${L1id}`)).status === 404 && (await api('GET', '/lessons')).body.items.length === lessonsBefore.length - 1
    && hAfter.status === 'shaky' && hAfter.touches === hBefore.touches && JSON.stringify(await putCounts()) === putsBefore, `${delLesson.status} ${hBefore.touches}->${hAfter.touches}`);
  const again404 = await api('DELETE', `/lessons/${L1id}`);
  check('deleting what is not there answers 404 naming it', again404.status === 404 && /No lesson with id/.test(again404.body.error), again404.body.error);
  }

  {
  // the bulk-import script against a fresh site (session five, step 6)
  const importDir = mkdtempSync(join(tmpdir(), 'hr-import-'));
  const siteDir = mkdtempSync(join(tmpdir(), 'hr-import-site-'));
  for (const f of ['Daniel HEB 15jun26.pdf', 'Daniel Hebrew 24feb26.pdf', 'Daniel Guy 10FEB2025.pdf', 'notes two lines.pdf']) copyFileSync(join(here, 'fixtures', f), join(importDir, f));
  writeFileSync(join(importDir, 'IMG_0412.jpg'), 'not a pdf');
  const site = start('node', ['server.js'], {
    PORT: '8795', DATA_DIR: siteDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'y'.repeat(64), COOKIE_INSECURE: '1',
    OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
    SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
  });
  await up('http://127.0.0.1:8795/health');
  const runImport = (...extra) => new Promise((resolve) => {
    const k = spawn('node', ['scripts/import-lessons.js', importDir, 'http://127.0.0.1:8795', ...extra], { cwd: root, env: { ...process.env, APP_PASSWORD: PASS } });
    let out = '';
    k.stdout.on('data', (d) => out += d); k.stderr.on('data', (d) => out += d);
    k.on('close', (code) => resolve({ code, out }));
  });
  const one = await runImport('--build-guides-from', '2026-01-01');
  const lines = one.out.split('\n');
  const has = (re) => lines.some((l) => re.test(l));
  check("import: Guy's three files imported with the dates from their names, the other PDF and the image skipped",
    one.code === 0 && has(/^imported\s+Daniel HEB 15jun26\.pdf\s+2026-06-15\s+10 items$/) && has(/^imported\s+Daniel Hebrew 24feb26\.pdf\s+2026-02-24\s+6 items$/)
    && has(/^imported\s+Daniel Guy 10FEB2025\.pdf\s+2025-02-10\s+5 items$/) && has(/^skipped\s+notes two lines\.pdf\s+not one of Guy's file names$/) && has(/^skipped\s+IMG_0412\.jpg\s+not a PDF$/), one.out);
  check('import --build-guides-from 2026-01-01: guides built for the two 2026 lessons, one at a time; the 2025 lesson left for first open',
    has(/^guides: 2 lessons dated 2026-01-01 or later without one$/) && has(/^guide\s+Daniel HEB 15jun26\.pdf\s+built in \d+ s$/) && has(/^guide\s+Daniel Hebrew 24feb26\.pdf\s+built in \d+ s$/) && !has(/Daniel Guy 10FEB2025\.pdf\s+built/), one.out);
  const siteApi = async (method, path, body) => {
    const login = await fetch('http://127.0.0.1:8795/login', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
    const c = (login.headers.get('set-cookie') || '').split(';')[0];
    const r2 = await fetch(`http://127.0.0.1:8795${path}`, { method, headers: { cookie: c, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r2.status, body: await r2.json() };
  };
  const listed = (await siteApi('GET', '/lessons')).body.items;
  const older = listed.find((l) => l.lesson_date === '2025-02-10');
  check('import --build-guides-from 2026-01-01 leaves the 2025 lesson with no guide, and the 2026 ones with theirs',
    older && older.guide === false && listed.filter((l) => l.lesson_date >= '2026-01-01').every((l) => l.guide === true), JSON.stringify(listed.map((l) => [l.lesson_date, l.guide])));
  const opened = await siteApi('POST', `/lessons/${older.id}/guide`, {});
  let olderView = opened.body;
  for (let i = 0; i < 100 && olderView.guide_state === 'building'; i++) { await wait(100); olderView = (await siteApi('GET', `/lessons/${older.id}`)).body; }
  check('the older lesson builds its guide when it is first opened, by the same path (it declines here, as its fixture asks the mock to)',
    opened.status === 202 && opened.body.guide_state === 'building' && olderView.guide_state === 'failed' && /the model declined/.test(olderView.guide_error || ''), `${opened.status} ${olderView.guide_state} ${olderView.guide_error}`);
  const uploads = () => (site.log.match(/^lesson \d+: ".*" from /gm) || []).length;
  const uploadsBefore = uploads();
  const two = await runImport();
  const lines2 = two.out.split('\n');
  check('import run twice: the second run skips all three as already on the site, uploads nothing',
    two.code === 0 && lines2.filter((l) => /^skipped\s+Daniel .*already on the site$/.test(l)).length === 3 && !/^imported/m.test(two.out)
    && uploadsBefore === 3 && uploads() === 3, `${two.out} uploads ${uploadsBefore} -> ${uploads()}`);
  copyFileSync(join(here, 'fixtures', 'Daniel Guy 10FEB2025.pdf'), join(importDir, 'Daniel Guy 21oct2024.pdf'));
  const dry = await runImport('--dry-run');
  check('import --dry-run names what it would add, with its date, and uploads nothing',
    dry.code === 0 && /^would add\s+Daniel Guy 21oct2024\.pdf\s+2024-10-21$/m.test(dry.out) && uploads() === 3, dry.out);
  const bad = await new Promise((resolve) => { const k = spawn('node', ['scripts/import-lessons.js', importDir, 'http://127.0.0.1:8795'], { cwd: root, env: { ...process.env, APP_PASSWORD: 'wrong' } }); let o = ''; k.stderr.on('data', (d) => o += d); k.on('close', (code) => resolve({ code, o })); });
  check('import with a wrong passphrase stops at the login and says so', bad.code === 1 && /^Login refused \(401\)/.test(bad.o), bad.o);
  site.kill();
  rmSync(importDir, { recursive: true, force: true });
  rmSync(siteDir, { recursive: true, force: true });
  }

  // the one-time put-back (session nine, step 3): a database shaped as the
  // live one after session eight — the June lesson's verb check turned נוצץ
  // to Pi'el against its review's drill (Pa'al), and לזנק to Pi'el, which
  // its guide agrees with
  {
    check('a fresh database runs the one-time put-back once at start, touching nothing',
      /one-time step done: restore verb-check card fixes the lesson review contradicted \(session nine\): 0 cards restored/.test(server.log), '');
    check("a fresh database runs the one-time לזנק step once at start, after the put-back, touching nothing",
      /one-time step done: put לזנק back to Pi'el, confirmed by Dan \(session ten\): 0 cards set/.test(server.log)
      && server.log.indexOf('one-time step done: restore') < server.log.indexOf("one-time step done: put לזנק"), '');
    const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
    const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());
    const { createHash } = await import('node:crypto');
    const restoreDir = mkdtempSync(join(tmpdir(), 'hr-restore-'));
    const env = { DATA_DIR: restoreDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'z'.repeat(64), COOKIE_INSECURE: '1',
      OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
      SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}` };
    // the tables as the server makes them; then the step taken off again, as
    // on the live database, which has never run it
    const s0 = start('node', ['server.js'], { ...env, PORT: '8796' });
    await up('http://127.0.0.1:8796/health');
    for (let i = 0; i < 50 && !/one-time step done/.test(s0.log); i++) await wait(100);
    s0.kill();
    await wait(300);
    const d = new Database(join(restoreDir, 'reader.db'));
    d.prepare('DELETE FROM steps').run();
    const at = '2026-09-23T15:00:00.000Z';
    // session ten's step taken as run, so this checks session nine's alone
    d.prepare('INSERT INTO steps (name, done_at, result_json) VALUES (?, ?, ?)').run("put לזנק back to Pi'el, confirmed by Dan (session ten)", at, 'null');
    const verbFix = (before, after) => ({ by: 'lesson review', lesson_id: 1, lesson_title: 'שיעור עם גיא — 15.6.2026', field: 'binyan', before, after, why: 'the verb-card check', at });
    const cards = {
      'נוצץ': { surface: 'נוצץ', lemma: 'נצץ', pos: 'verb', root: 'נ.צ.צ', binyan: 'piel', tense: 'present', person_gender_number: 'ms', meaning_en: 'sparkling', governs: null, categories: [], note: "Present of נצץ in paal.", pointed: { lemma: 'נָצַץ', surface: 'נוֹצֵץ' }, corrected: [verbFix('paal', 'piel')] },
      'לזנק': { surface: 'לזנק', lemma: 'זנק', pos: 'verb', root: 'ז.נ.ק', binyan: 'piel', tense: 'infinitive', person_gender_number: null, meaning_en: 'to leap, to soar', governs: null, categories: [], note: 'The prefix ל- marks the infinitive in paal.', pointed: { lemma: 'זָנַק', surface: 'לִזְנֹק' }, corrected: [verbFix('paal', 'piel')] },
    };
    for (const [w, c] of Object.entries(cards)) {
      d.prepare('INSERT INTO cards (surface, context_hash, spot_id, json, built_at) VALUES (?, ?, ?, ?, ?)').run(w, createHash('sha256').update(`${w}\n${w}`).digest('hex'), `v:${c.root}:piel`, JSON.stringify(c), at);
      d.prepare("INSERT INTO spots (id, kind, root, binyan, lemma, status, categories_json, updated_at) VALUES (?, 'verb', ?, 'piel', ?, 'shaky', '[]', ?)").run(`v:${c.root}:piel`, c.root, c.lemma, at);
    }
    const guide = { title: 'שיעור עם גיא — 15.6.2026', date: '2026-06-15', built_at: at, dropped: { cards: 0, vocabulary: 0, expressions: 0 }, checks: { passed: [], failed_first: [], unmet: [] },
      sections: [
        { kind: 'drills', verbs: [{ verb: 'נוצץ (לנצוץ)', root: 'נ.צ.צ', binyan: "Pa'al", deviation: 'pe-nun, doubled', takes_object: false, exercises: [] }] },
        { kind: 'vocabulary', rows: [{ he: 'נוצץ', pointed: 'נוֹצֵץ', en: 'sparkling', root: 'נ.צ.צ', binyan: "Pa'al (present)", category: 'Mood', flags: '' }, { he: 'לזנק', pointed: 'לְזַנֵּק', en: 'to leap', root: 'ז.נ.ק', binyan: "Pi'el", category: 'News', flags: '' }] },
      ],
      cards: [],
      review: { state: 'applied', changes: ['נוצץ is Pa\'al of נ.צ.צ'], refused: [], dropped: [], card_fixes: [], cards: { corrected: [], unchanged: [], refused: [] }, at },
      verb_check: { state: 'checked', checked: 2, corrected: [
        { surface: 'לזנק', field: 'binyan', before: 'paal', after: 'piel', spot: 'v:ז.נ.ק:piel', replaced: 'v:ז.נ.ק:paal', spine: 'recorded' },
        { surface: 'נוצץ', field: 'binyan', before: 'paal', after: 'piel', spot: 'v:נ.צ.צ:piel', replaced: 'v:נ.צ.צ:paal', spine: 'recorded' },
      ], unchanged: [], refused: [], at } };
    d.prepare('INSERT INTO lessons (title, lesson_date, source_name, text, items_json, guide_json, guide_built_at, saved_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('שיעור עם גיא — 15.6.2026', '2026-06-15', 'Daniel HEB 15jun26.pdf', 'נוצץ\nלזנק', JSON.stringify(['נוצץ', 'לזנק']), JSON.stringify(guide), at, JSON.stringify({ words: 2, phrases: 0, touched: 0, failed: [], spine: { recorded: 2 } }), at);
    d.close();
    const r0 = (await orCalls()).refresh_calls;
    const s1 = start('node', ['server.js'], { ...env, PORT: '8796' });
    await up('http://127.0.0.1:8796/health');
    for (let i = 0; i < 50 && !/one-time step done/.test(s1.log); i++) await wait(100);
    for (let i = 0; i < 50 && !/nikud and note refreshed for the corrected card "נוצץ"/.test(s1.log); i++) await wait(100);
    const rows = () => { const x = new Database(join(restoreDir, 'reader.db'), { readonly: true }); const out = Object.fromEntries(x.prepare('SELECT surface, spot_id, json FROM cards').all().map((r) => [r.surface, { spot: r.spot_id, card: JSON.parse(r.json) }])); const g = JSON.parse(x.prepare('SELECT guide_json FROM lessons').get().guide_json); const st = x.prepare('SELECT * FROM steps').all(); x.close(); return { out, g, st }; };
    const { out, g, st } = rows();
    const nz = out['נוצץ'], zn = out['לזנק'];
    check('the one-time put-back restores the verb check\'s change the review contradicted — נוצץ back to Pa\'al, its spot back, logged, the card saying "Restored" — and leaves לזנק Pi\'el; count 1, recorded',
      nz.card.binyan === 'paal' && nz.spot === 'v:נ.צ.צ:paal' && nz.card.corrected.at(-1).restored === true && nz.card.corrected.at(-1).before === 'piel' && nz.card.corrected.at(-1).after === 'paal'
      && nz.card.corrected[0].undone === true && zn.card.binyan === 'piel' && zn.card.corrected.length === 1
      && /one-time step: lesson 1 \(שיעור עם גיא — 15\.6\.2026\): card נוצץ binyan piel -> paal, restored: the verb check's change was contradicted by the lesson review/.test(s1.log)
      && /one-time step done: .*: 1 card restored \(נוצץ\)/.test(s1.log) && st.filter((x) => /session nine/.test(x.name)).length === 1 && JSON.parse(st.find((x) => /session nine/.test(x.name)).result_json).touched === 1
      && g.verb_check.restored?.length === 1 && g.verb_check.restored[0].surface === 'נוצץ',
      JSON.stringify({ nz: nz.card.corrected, spot: nz.spot, zn: zn.card.binyan, steps: st, log: s1.log.split('\n').filter((l) => /one-time/.test(l)) }));
    check('the restored card is refreshed straight after, for Pa\'al: its note written again',
      nz.card.refreshed?.for === 2 && nz.card.note === "Pa'al of נ.צ.צ, as corrected." && (await orCalls()).refresh_calls - r0 === 1, JSON.stringify({ note: nz.card.note, refreshed: nz.card.refreshed }));
    s1.kill();
    await wait(300);
    const s2 = start('node', ['server.js'], { ...env, PORT: '8796' });
    await up('http://127.0.0.1:8796/health');
    for (let i = 0; i < 50 && !/one-time step/.test(s2.log); i++) await wait(100);
    check('the put-back never runs twice: the next start says it already ran and changes nothing',
      /one-time step already run on .*: restore verb-check card fixes/.test(s2.log) && !/one-time step done/.test(s2.log) && JSON.stringify(rows().out) === JSON.stringify(out), s2.log.split('\n').filter((l) => /one-time/.test(l)).join(' | '));
    // the opened card, as the lesson page gets it: לזנק refreshed on its first open
    const login = await fetch('http://127.0.0.1:8796/login', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
    const c2 = (login.headers.get('set-cookie') || '').split(';')[0];
    const call = async (path, body) => { const r2 = await fetch(`http://127.0.0.1:8796${path}`, { method: 'POST', headers: { cookie: c2, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }); return r2.json(); };
    const zOpen = await call('/lookup', { surface: 'לזנק', sentence: 'לזנק', lesson_id: 1 });
    const zGot = await call('/lookup/refresh', { surface: 'לזנק', sentence: 'לזנק' });
    check("לזנק, corrected before this session, is refreshed on its first open: זִנֵּק, לְזַנֵּק in the text, a note that no longer says Pa'al",
      zOpen.refresh_due === true && zGot.called === true && zGot.card.pointed.lemma === 'זִנֵּק' && zGot.card.pointed.surface === 'לְזַנֵּק' && !/pa.?al/i.test(zGot.card.note), JSON.stringify(zGot));
    s2.kill();
    rmSync(restoreDir, { recursive: true, force: true });
  }

  // the one-time לזנק step (session ten, step 2): a database shaped as the
  // live one after session nine — its put-back turned לזנק back to Pa'al
  // (the June guide gives Pa'al), and נוצץ back to Pa'al (right)
  {
    const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
    const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());
    const { createHash } = await import('node:crypto');
    const zDir = mkdtempSync(join(tmpdir(), 'hr-zinek-'));
    const env = { DATA_DIR: zDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'z'.repeat(64), COOKIE_INSECURE: '1',
      OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
      SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}` };
    const s0 = start('node', ['server.js'], { ...env, PORT: '8797' });
    await up('http://127.0.0.1:8797/health');
    for (let i = 0; i < 50 && !/one-time step done: put/.test(s0.log); i++) await wait(100);
    s0.kill();
    await wait(300);
    const d = new Database(join(zDir, 'reader.db'));
    d.prepare('DELETE FROM steps').run();
    const at = '2026-09-23T15:00:00.000Z', at2 = '2026-09-24T01:00:00.000Z';
    d.prepare('INSERT INTO steps (name, done_at, result_json) VALUES (?, ?, ?)').run('restore verb-check card fixes the lesson review contradicted (session nine)', at2, JSON.stringify({ touched: 2 }));
    const title = 'שיעור עם גיא — 15.6.2026';
    const put = (after, extra = {}) => ({ by: 'lesson review', lesson_id: 1, lesson_title: title, field: 'binyan', before: 'paal', after: 'piel', why: 'the verb-card check', at, ...extra });
    const back = { by: 'restore', lesson_id: 1, lesson_title: title, field: 'binyan', before: 'piel', after: 'paal', why: "the verb check's change was contradicted by the lesson review", at: at2, restored: true };
    const cards = {
      'לזנק': { surface: 'לזנק', lemma: 'זנק', pos: 'verb', root: 'ז.נ.ק', binyan: 'paal', tense: 'infinitive', person_gender_number: null, meaning_en: 'to leap, to soar', governs: null, categories: [], note: "Pa'al infinitive construct of a segolate-pattern verb.", pointed: { lemma: 'זָנַק', surface: 'לִזְנֹק' }, corrected: [put('piel', { undone: true }), back], refreshed: { for: 2, at: at2 } },
      'נוצץ': { surface: 'נוצץ', lemma: 'נצץ', pos: 'verb', root: 'נ.צ.צ', binyan: 'paal', tense: 'present', person_gender_number: 'ms', meaning_en: 'sparkling', governs: null, categories: [], note: 'Paal participle of the geminate root נ.צ.צ.', pointed: { lemma: 'נָצַץ', surface: 'נוֹצֵץ' }, corrected: [put('piel', { undone: true }), back], refreshed: { for: 2, at: at2 } },
    };
    for (const [w, c] of Object.entries(cards)) {
      d.prepare('INSERT INTO cards (surface, context_hash, spot_id, json, built_at) VALUES (?, ?, ?, ?, ?)').run(w, createHash('sha256').update(`${w}\n${w}`).digest('hex'), `v:${c.root}:paal`, JSON.stringify(c), at);
      d.prepare("INSERT INTO spots (id, kind, root, binyan, lemma, status, categories_json, updated_at) VALUES (?, 'verb', ?, 'paal', ?, 'shaky', '[]', ?)").run(`v:${c.root}:paal`, c.root, c.lemma, at);
    }
    const restoredLine = (w, root) => ({ surface: w, field: 'binyan', before: 'piel', after: 'paal', by: 'restore', spot: `v:${root}:paal`, replaced: `v:${root}:piel`, spine: 'recorded' });
    const guide = { title, date: '2026-06-15', built_at: at, dropped: { cards: 0, vocabulary: 0, expressions: 0 }, checks: { passed: [], failed_first: [], unmet: [] },
      sections: [{ kind: 'vocabulary', rows: [{ he: 'לזנק', pointed: 'לִזְנֹק', en: 'to leap', root: 'ז.נ.ק', binyan: "Pa'al", category: 'News', flags: '' }] }], cards: [],
      review: { state: 'applied', changes: [], refused: [], dropped: [], card_fixes: [], cards: { corrected: [], unchanged: [], refused: [] }, at },
      verb_check: { state: 'checked', checked: 2, corrected: [], unchanged: [], refused: [], at, restored: [restoredLine('לזנק', 'ז.נ.ק'), restoredLine('נוצץ', 'נ.צ.צ')] } };
    d.prepare('INSERT INTO lessons (title, lesson_date, source_name, text, items_json, guide_json, guide_built_at, saved_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(title, '2026-06-15', 'Daniel HEB 15jun26.pdf', 'נוצץ\nלזנק', JSON.stringify(['נוצץ', 'לזנק']), JSON.stringify(guide), at, JSON.stringify({ words: 2, phrases: 0, touched: 0, failed: [], spine: { recorded: 2 } }), at);
    d.close();
    const r0 = (await orCalls()).refresh_calls;
    const s1 = start('node', ['server.js'], { ...env, PORT: '8797' });
    await up('http://127.0.0.1:8797/health');
    for (let i = 0; i < 50 && !/one-time step done: put/.test(s1.log); i++) await wait(100);
    for (let i = 0; i < 50 && !/nikud and note refreshed for the corrected card "לזנק"/.test(s1.log); i++) await wait(100);
    const rows = () => { const x = new Database(join(zDir, 'reader.db'), { readonly: true }); const out = Object.fromEntries(x.prepare('SELECT surface, spot_id, json FROM cards').all().map((r) => [r.surface, { spot: r.spot_id, card: JSON.parse(r.json) }])); const g = JSON.parse(x.prepare('SELECT guide_json FROM lessons').get().guide_json); const st = x.prepare('SELECT * FROM steps').all(); x.close(); return { out, g, st }; };
    const { out, g, st } = rows();
    const zn = out['לזנק'], nz = out['נוצץ'];
    const mine = st.find((x) => /session ten/.test(x.name));
    check("the one-time step puts לזנק back to Pi'el, root ז.נ.ק, confirmed by Dan (23 Sep 2026): the \"Restored\" line gone from the card and the lesson page, the verb check's correction standing again, its spot moved, logged; count 1, recorded",
      zn.card.binyan === 'piel' && zn.card.root === 'ז.נ.ק' && zn.card.confirmed?.on === '2026-09-23' && zn.card.confirmed.binyan === 'piel'
      && zn.card.corrected.length === 1 && !zn.card.corrected[0].undone && !zn.card.corrected.some((x) => x.restored) && zn.spot === 'v:ז.נ.ק:piel'
      && g.verb_check.restored.length === 1 && g.verb_check.restored[0].surface === 'נוצץ'
      && /one-time step: lesson 1 \(שיעור עם גיא — 15\.6\.2026\): card לזנק binyan paal -> piel, root ז\.נ\.ק -> ז\.נ\.ק, confirmed by Dan 2026-09-23, spot v:ז\.נ\.ק:paal -> v:ז\.נ\.ק:piel/.test(s1.log)
      && /one-time step done: put לזנק back to Pi'el, confirmed by Dan \(session ten\): 1 card set \(לזנק\)/.test(s1.log) && JSON.parse(mine?.result_json || '{}').touched === 1,
      JSON.stringify({ zn: zn.card, spot: zn.spot, restored: g.verb_check.restored, log: s1.log.split('\n').filter((l) => /one-time/.test(l)) }));
    check("…and refreshes it straight after for Pi'el: זִנֵּק, לְזַנֵּק as the word in the text, a note that does not say Pa'al (one call)",
      zn.card.pointed?.lemma === 'זִנֵּק' && zn.card.pointed.surface === 'לְזַנֵּק' && !/pa.?al/i.test(zn.card.note) && zn.card.refreshed?.for === 1 && !zn.card.refreshed.failed
      && (await orCalls()).refresh_calls - r0 === 1, JSON.stringify({ pointed: zn.card.pointed, note: zn.card.note, refreshed: zn.card.refreshed }));
    check("…and leaves נוצץ as it was: Pa'al, its \"Restored\" line kept", JSON.stringify(nz.card) === JSON.stringify(cards['נוצץ']) && nz.spot === 'v:נ.צ.צ:paal', JSON.stringify(nz));
    s1.kill();
    await wait(300);
    const s2 = start('node', ['server.js'], { ...env, PORT: '8797' });
    await up('http://127.0.0.1:8797/health');
    for (let i = 0; i < 50 && !/already run on .*: put לזנק/.test(s2.log); i++) await wait(100);
    check('the לזנק step never runs twice: the next start says it already ran and changes nothing',
      /one-time step already run on .*: put לזנק back to Pi'el/.test(s2.log) && !/one-time step done/.test(s2.log) && JSON.stringify(rows().out) === JSON.stringify(out), s2.log.split('\n').filter((l) => /one-time/.test(l)).join(' | '));
    s2.kill();
    rmSync(zDir, { recursive: true, force: true });
  }

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
