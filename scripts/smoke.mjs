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
      { section: 'word_cards', item: 'התבייש', field: 'root', find: 'ב.ו.ש', replace: 'ב.ו.ש', why: 'the root of התבייש' },
      { section: 'drills', item: 'להיאלץ', find: "Nif'al", replace: "Nif'al (passive)", why: 'the drill binyan named more fully' },
    ] });
    await api('POST', `/lessons/${L2.body.id}/guide`, { rebuild: true });
    const v = await until(L2.body.id, (x) => x.guide_state !== 'building' && !x.saving);
    await control({ review_extra: [] });
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
      && /card להתבייש binyan paal -> hitpael \(the lesson review\), spot v:ב\.ו\.ש:paal -> v:ב\.ו\.ש:hitpael/.test(server.log),
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

  // the model refusing the guide
  await api('POST', `/lessons/${L3.body.id}/guide`, {});
  const failedGuide = await until(L3.body.id, (v) => v.guide_state !== 'building');
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
