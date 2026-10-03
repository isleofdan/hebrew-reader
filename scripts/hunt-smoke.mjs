// Server checks for the article hunt (hebrew-hunt-build): "Find an article"
// against local news pages (a feed, a section page, a source that fails) and
// the local stand-in for OpenRouter. No real news site is reached.
//   node scripts/hunt-smoke.mjs      (npm run smoke runs it after paper-smoke.mjs)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8830, OR_PORT = 8831, NEWS_PORT = 8832;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-hunt-'));
const news = `http://127.0.0.1:${NEWS_PORT}`;

// --- the local news site ------------------------------------------------------
const day = 24 * 3600 * 1000;
const iso = (ago) => new Date(Date.now() - ago).toISOString();
const SENTENCES = [
  'הממשלה הודיעה כי מחיר החשמל נקבע מחדש לקראת החורף הקרוב.',
  'חברת החשמל פנתה לשוק עם תוכנית חדשה לרכבים חשמליים ולאגירה.',
  'לדברי הרגולטור, היצרנים נאלצו להתמודד עם עלויות גבוהות של גז טבעי.',
  'המשקיעים חוששים מפני עלייה נוספת בריבית ובמחירי האנרגיה במשק.',
  'הוועדה נדרשה להכריע בשאלת המכסות לפני סוף השנה הנוכחית.',
];
const body = (n) => Array.from({ length: n }, (_, i) => SENTENCES[i % SENTENCES.length]).join(' ');
const paras = (text) => text.match(/[^.]+\./g).reduce((a, s, i) => { if (i % 5 === 0) a.push(''); a[a.length - 1] += s; return a; }, []);
// `type` is the page's article:type (Globes names its market live blogs
// "סקירת מסחר"); `clock` puts a time line before every paragraph, as a live blog does.
const page = (title, text, published, { type = '', clock = false } = {}) => `<!doctype html><html lang="he"><head><meta charset="utf-8"><title>${title}</title>`
  + (published ? `<meta property="article:published_time" content="${published}">` : '')
  + (type ? `<meta property="article:type" content="${type}">` : '')
  + `</head><body><nav>תפריט</nav><article><h1>${title}</h1>${paras(text).map((p, i) => (clock ? `<p>${String(22 - i).padStart(2, '0')}:${i % 2 ? '35' : '00'}</p>` : '') + `<p>${p}</p>`).join('')}</article><footer>כל הזכויות שמורות</footer></body></html>`;
const TICKER = ['מדד ת"א 35 עלה ב-1.2% ל-2,345 נקודות, מדד הבנקים ירד ב-0.4% ומדד ת"א 90 עלה ב-0.8%.', 'הדולר נסחר ב-3.71 שקלים, האירו ב-4.02 שקלים, ותשואות האג"ח ל-10 שנים ירדו ל-4.1%.', 'מניית טבע עלתה ב-2.3%, מניית אלביט ירדה ב-1.1% ומניות הבנקים עלו ב-0.5%.'];
const ARTICLES = {
  '/a/old': { title: 'כתבה ישנה על משק החשמל', text: body(80), published: iso(20 * day) },
  '/a/short': { title: 'ידיעה קצרה על הגז', text: body(15), published: iso(1 * day) },
  '/a/thin-test': { title: 'כתבה דלה בפעלים', text: body(80), published: iso(1 * day) },
  '/a/good': { title: 'רפורמה במשק החשמל יוצאת לדרך', text: body(85), published: iso(2 * day) },
  '/b/one': { title: 'כתבה מאתר השני על האגירה', text: body(90), published: iso(18 * day) }, // dated only on its page
};
const FEED = [['/a/good', 2 * day], ['/a/old', 20 * day], ['/a/short', 1 * day], ['/a/thin-test', 1 * day]];
const rss = (items) => `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>feed</title>${items.map(([p, ago]) => `<item><title><![CDATA[${ARTICLES[p].title}]]></title><link>${news}${p}#utm_source=RSS</link><pubDate>${new Date(Date.now() - ago).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const newsServer = http.createServer((req, res) => {
  const u = req.url;
  if (u === '/feed') { res.writeHead(200, { 'content-type': 'text/xml' }); return res.end(rss(FEED)); }
  if (u === '/section') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<html><body><a href="${news}/b/one">one</a><a href="${news}/b/one">again</a></body></html>`); }
  const a = ARTICLES[u];
  if (a) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page(a.title, a.text, a.published, a)); }
  res.writeHead(500); res.end('down');
});
await new Promise((r) => newsServer.listen(NEWS_PORT, r));
const SOURCES = [
  { name: 'Feedsite', kind: 'rss', urls: [`${news}/feed`] },
  { name: 'Pagesite', kind: 'page', urls: [`${news}/section`], link: `${news.replace(/[.]/g, '\\.')}/b/[a-z]+` },
  { name: 'Downsite', kind: 'rss', urls: [`${news}/broken`] },
];

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
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: '', HUNT_SOURCES: JSON.stringify(SOURCES),
});
const base = `http://127.0.0.1:${PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;

try {
  await up(`${base}/health`); await up(`${mock}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, b) => { const res = await fetch(base + path, { method, headers: H, body: b ? JSON.stringify(b) : undefined }); return { status: res.status, body: await res.json() }; };
  const control = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
  const calls = async () => (await fetch(`${mock}/calls`)).json();
  const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  // the hunt's answer: every line, parsed
  const find = async () => {
    const t0 = Date.now();
    const res = await fetch(`${base}/articles/find`, { method: 'POST', headers: H });
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { status: res.status, type: res.headers.get('content-type'), lines, done: lines[lines.length - 1], ms: Date.now() - t0 };
  };

  // --- pull-only: nothing runs until the tap --------------------------------------
  await wait(500);
  check('nothing looks for an article on its own: no search at startup, and the last search is "no data"',
    peek('SELECT COUNT(*) AS n FROM hunts')[0].n === 0 && (await api('GET', '/articles/find/last')).body.state === 'no data' && (await calls()).judge_calls === 0);
  const left = (await api('GET', '/articles/find/last')).body.left_out.map((s) => s.name).join(',');
  check('the sources left out are named: TheMarker and Kan', left === 'TheMarker,Kan', left);
  const pasted = await api('POST', '/articles', { text: 'כותרת מודבקת\nטקסט של כתבה מודבקת עם כמה מילים בעברית.' });
  check('a pasted article is stored as before, origin "pasted", with no guide', pasted.status === 201 && pasted.body.origin === 'pasted' && pasted.body.found_at === null && pasted.body.has_guide === false && pasted.body.why === null);

  // --- one tap: the found article -------------------------------------------------
  const one = await find();
  const progress = one.lines.filter((l) => l.progress).map((l) => l.progress);
  check('the answer is a stream of plain progress lines', one.status === 200 && /ndjson/.test(one.type) && progress.includes('Looking at Feedsite…') && progress.includes('Checking an article from Feedsite…') && progress.some((p) => p.startsWith('Writing the study guide')), progress.join(' | '));
  check('and it ends on the found article', one.done.done === true && Number.isInteger(one.done.article_id) && one.done.guide.ok === true, JSON.stringify(one.done));
  const art = (await api('GET', `/articles/${one.done.article_id}`)).body;
  check('the found article is the good one, stored like any other, origin "found", its site and date', art.source_url === `${news}/a/good` && art.origin === 'found' && art.source_name === 'Feedsite' && /^\d{4}-\d\d-\d\dT/.test(art.found_at) && art.text.length > 2000);
  check('the found article keeps its paragraphs: a line break between them, the headline not run into the text', (art.text.match(/\n/g) || []).length >= 10 && !/לדרךהממשלה|הקרוב\.חברת/.test(art.text), JSON.stringify(art.text.slice(0, 120)));
  check('its "why this one" record holds the words found for the three tests, each in the article',
    art.why && art.why.nifal_or_irregular.length >= 1 && art.why.prepositions.length >= 3 && art.why.family.some((f) => f.forms.length >= 2)
      && [...art.why.nifal_or_irregular, ...art.why.prepositions].every((v) => art.text.includes(v.word)) && art.why.words > 600, JSON.stringify(art.why));
  const last1 = (await api('GET', '/articles/find/last')).body.hunt;
  const outcomes = Object.fromEntries(last1.tried.map((t) => [t.url.replace(news, ''), t.outcome]));
  check('the section page\'s article was dated from its own page and dropped for its date', /published .*more than two weeks ago/.test(outcomes['/b/one']), outcomes['/b/one']);
  check('the short one for its length', /words, under 600/.test(outcomes['/a/short']), outcomes['/a/short']);
  check('the one without a Nif\'al verb by the three tests', /no Nif'al or irregular-root verb/.test(outcomes['/a/thin-test']), outcomes['/a/thin-test']);
  check('the broken source is named, the search went on', last1.tried.some((t) => t.source === 'Downsite' && /could not be read/.test(t.outcome)));
  check('the last search records when, the outcome and the last model call', last1.finished_at && last1.outcome === 'found, with its study guide' && last1.model_status === 'ok' && /answered/.test(last1.model_message) && last1.article_id === art.id);
  const listed = (await api('GET', '/articles')).body.items.find((a) => a.id === art.id);
  check('the article list says found, from which site, with a guide', listed.origin === 'found' && listed.source_name === 'Feedsite' && listed.has_guide === true);

  // --- the study guide ---------------------------------------------------------------
  const guide = await (await fetch(`${base}/guide/${art.id}`, { headers: { cookie } })).text();
  const kinds = [...guide.matchAll(/data-kind="([a-z]+)"/g)].map((m) => m[1]);
  check('the study guide has the eight parts in the note\'s order', kinds.join(',') === 'header,excerpts,vocabulary,paper,drills,questions,expressions,relevance', kinds.join(','));
  const vocab = Number(/data-vocabulary="(\d+)"/.exec(guide)[1]), paper = Number(/data-paper="(\d+)"/.exec(guide)[1]);
  check('25-35 vocabulary words, 1-2 Thinking on Paper prompts (the third one cut)', vocab >= 25 && vocab <= 35 && paper === 2, `${vocab}, ${paper}`);
  check('the drill verb is the Nif\'al verb found', /data-drills="[^"]*Nif&#39;al/.test(guide));
  check('the link to the original is there, and an excerpt not in the article was dropped', guide.includes(`href="${news}/a/good"`) && !guide.includes('משפט שלא מופיע בכתבה בכלל'));
  check('Hebrew is right-to-left, no transliteration, and the page is the reader\'s own', /class="he[^"]*" dir="rtl"/.test(guide) && !/translit/i.test(guide) && guide.includes('/app.css') && guide.includes('Study guide'));
  check('the guide was made by the guide model', (await calls()).last_article_guide_model === 'anthropic/claude-opus-4.6');
  check('a signed-out guide page goes to sign-in', (await fetch(`${base}/guide/${art.id}`, { redirect: 'manual' })).status === 303);

  // --- a second tap: the same story, and the article already here ---------------------------
  await control({ judge_same: true });
  const two = await find();
  check('nothing suitable: one plain sentence naming how many were tried and from where', /^Nothing suitable today — tried \d+ articles? from Feedsite, Pagesite\.$/.test(two.done.nothing || ''), JSON.stringify(two.done));
  const last2 = (await api('GET', '/articles/find/last')).body.hunt;
  const out2 = Object.fromEntries(last2.tried.map((t) => [t.url.replace(news, ''), t.outcome]));
  check('the article already found is not taken twice; the same story is dropped', /already in your articles/.test(out2['/a/good']) && Object.values(out2).some((o) => /same story as the last found article/.test(o)), JSON.stringify(out2));
  check('the old article was dropped for its feed date', /more than two weeks ago/.test(out2['/a/old']), out2['/a/old']);
  await control({ judge_same: false });

  // --- the guide's checks: one rebuild, then the article without a guide ----------------------
  await control({ article_guide_faults: ['few'] });
  ARTICLES['/a/fresh'] = { title: 'כתבה חדשה על הגז הטבעי', text: body(82), published: iso(day / 2) };
  FEED.unshift(['/a/fresh', day / 2]);
  const three = await find();
  check('a guide that fails its checks is asked for once more, and the second passes', three.done.guide && three.done.guide.ok && three.done.guide.counts.tries === 2, JSON.stringify(three.done));
  await control({ article_guide_faults: ['decline'] });
  const before = peek('SELECT COUNT(*) AS n FROM articles')[0].n;
  ARTICLES['/b/two'] = { title: 'עוד כתבה מהאתר השני', text: body(90), published: iso(1 * day) };
  newsServer.removeAllListeners('request');
  newsServer.on('request', (req, res) => {
    if (req.url === '/section') { res.writeHead(200); return res.end(`<a href="${news}/b/two">two</a>`); }
    const a = ARTICLES[req.url];
    if (a) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page(a.title, a.text, a.published, a)); }
    res.writeHead(500); res.end('down');
  });
  const four = await find();
  const noGuide = four.done.article_id && (await api('GET', `/articles/${four.done.article_id}`)).body;
  check('a guide the model declines leaves the article stored, without a guide, and says why', noGuide && noGuide.has_guide === false && four.done.guide.ok === false && /declined/.test(four.done.guide.error) && peek('SELECT COUNT(*) AS n FROM articles')[0].n === before + 1, JSON.stringify(four.done));
  const remade = await api('POST', `/articles/${four.done.article_id}/guide`);
  check('"Make the study guide" makes it on the article', remade.status === 200 && remade.body.ok && (await api('GET', `/articles/${four.done.article_id}`)).body.has_guide === true, JSON.stringify(remade.body));

  // --- a cut-off judgement (the first live trial, 3 Oct 2026) ----------------------------------
  check('the three-test question has room: 6,000 tokens, not 2,500', (await calls()).last_judge_max_tokens === 6000, String((await calls()).last_judge_max_tokens));
  await control({ judge_truncated: 1 });
  ARTICLES['/a/cut'] = { title: 'כתבה על רשת החשמל', text: body(84), published: iso(day / 3) };
  FEED.unshift(['/a/cut', day / 3]);
  newsServer.removeAllListeners('request');
  newsServer.on('request', (req, res) => {
    if (req.url === '/feed') { res.writeHead(200, { 'content-type': 'text/xml' }); return res.end(rss(FEED)); }
    const a = ARTICLES[req.url];
    if (a) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page(a.title, a.text, a.published, a)); }
    res.writeHead(500); res.end('down');
  });
  const judgedBefore = (await calls()).judge_calls;
  const cut = await find();
  const cutArt = cut.done.article_id && (await api('GET', `/articles/${cut.done.article_id}`)).body;
  check('an answer cut off is asked once more, and the article is found', cutArt && cutArt.source_url === `${news}/a/cut` && (await calls()).judge_calls >= judgedBefore + 2, JSON.stringify(cut.done));

  // --- live blogs and tickers are skipped, by a recorded rule (hebrew-hunt-two) ----------------
  const judgedAtSkip = (await calls()).judge_calls;
  ARTICLES['/a/live'] = { title: 'נעילה חיובית בארה"ב; תשואות האג"ח ירדו', text: body(85), published: iso(day / 10), type: 'סקירת מסחר' };
  ARTICLES['/a/clock'] = { title: 'הבורסה היום: המסחר בשעה זו', text: body(85), published: iso(day / 9), clock: true };
  ARTICLES['/a/ticker'] = { title: 'נעילה מעורבת בתל אביב', text: Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? SENTENCES[i % 5] : TICKER[i % 3])).join(' '), published: iso(day / 8) };
  ARTICLES['/a/long'] = { title: 'כתבה ארוכה מאוד על משק האנרגיה', text: body(180), published: iso(day / 7) };
  FEED.unshift(['/a/long', day / 7], ['/a/ticker', day / 8], ['/a/clock', day / 9], ['/a/live', day / 10]);
  const five = await find();
  const out5 = Object.fromEntries((await api('GET', '/articles/find/last')).body.hunt.tried.map((t) => [t.url.replace(news, ''), t.outcome]));
  check('a live blog is skipped and the record says "skipped: live blog": by the page\'s own marker, and by its clock-time lines',
    /^skipped: live blog \(the page calls itself "סקירת מסחר"\)$/.test(out5['/a/live']) && /^skipped: live blog \(\d+ lines open with a clock time\)$/.test(out5['/a/clock']), JSON.stringify([out5['/a/live'], out5['/a/clock']]));
  check('a market ticker is skipped: "skipped: market ticker"', /^skipped: market ticker \([\d.]+% numbers and market names\)$/.test(out5['/a/ticker']), out5['/a/ticker']);
  check('a piece over 1,500 words is skipped by the length window', /^skipped: \d+ words, over 1500$/.test(out5['/a/long']), out5['/a/long']);
  check('none of them was put to the model, and none was stored', !five.done.article_id && !['/a/live', '/a/clock', '/a/ticker', '/a/long'].some((u) => peek('SELECT id FROM articles WHERE source_url = ?', news + u).length)
    && (await calls()).judge_calls - judgedAtSkip <= 1, JSON.stringify(five.done));

  // --- the deploy's trial: the same tests, nothing stored ------------------------------------
  ARTICLES['/a/next'] = { title: 'הרגולטור פרסם תעריף חדש לאגירת חשמל', text: body(88), published: iso(day / 6) };
  FEED.unshift(['/a/next', day / 6]); // older than the four above: the trial meets them first
  const hunts = peek('SELECT COUNT(*) AS n FROM hunts')[0].n, arts = peek('SELECT COUNT(*) AS n FROM articles')[0].n, judged = (await calls()).judge_calls;
  const trial = await api('POST', '/articles/find?trial=1');
  check('?trial=1 puts the first article that passes the tests to the model and stores nothing', trial.status === 200 && trial.body.status === 200 && /\/a\/next|לאגירת חשמל" would be chosen/.test(trial.body.line) && (await calls()).judge_calls === judged + 1
    && peek('SELECT COUNT(*) AS n FROM hunts')[0].n === hunts && peek('SELECT COUNT(*) AS n FROM articles')[0].n === arts, JSON.stringify(trial.body));
  const outT = Object.fromEntries(trial.body.tried.map((t) => [t.url.replace(news, ''), t.outcome]));
  check('the trial lists every candidate with its reason: the live blog "skipped: live blog", the chosen one "would be chosen"',
    /^skipped: live blog/.test(outT['/a/live']) && /^skipped: market ticker/.test(outT['/a/ticker']) && outT['/a/next'] === 'would be chosen', JSON.stringify(outT));

  // --- signed out ----------------------------------------------------------------------------
  check('signed out, the search answers 401', (await fetch(`${base}/articles/find`, { method: 'POST', headers: { accept: 'application/json' } })).status === 401);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  newsServer.close();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) console.log(server.log.split('\n').slice(-30).join('\n'));
console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`);
process.exit(failed ? 1 : 0);
