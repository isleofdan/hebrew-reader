// Server checks for hebrew-lookup-one: a reference shown inside the reader
// (GET /reference/<id>: framed, or a cleaned copy kept seven days, or the
// failure), and the Look up page's routes — against local stand-ins for
// OpenRouter, the spine and the seven reference sites.
//   node scripts/lookup-smoke.mjs   (npm test runs it; not in the fast set:
//   the 20-second fetch limit is checked for real, so it takes about 25 s)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  check('the reason a fetch failed is said in plain words', hung.body.reason === 'no answer in 20 s' && refused.body.reason === 'it answered 403', JSON.stringify([hung.body.reason, refused.body.reason]));
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

  // --- the redirect gate (hebrew-lookup-one follow-on): a copy is taken only from the reference's own site
  {
    const { sameSite } = createRequire(import.meta.url)(join(root, 'lib', 'reference-pages.js'));
    const { byId } = createRequire(import.meta.url)(join(root, 'lib', 'references.js'));
    const pe = byId('pealim'), kz = byId('kizur');
    check('the gate, by itself: false-rejection — the reference\'s own site is accepted www and non-www, and Kizur over http with or without www',
      sameSite(pe, 'https://www.pealim.com/search/?q=x') && sameSite(pe, 'https://pealim.com/search/?q=x') && sameSite(pe, 'http://pealim.com/')
      && sameSite(kz, `http://www.kizur.co.il/search_word.php?abbr=${enc('צה"ל')}`) && sameSite(kz, 'http://kizur.co.il/search_word.php?abbr=x'));
    check('the gate, by itself: another site, a look-alike host, another reference\'s site and a malformed address are refused',
      !sameSite(pe, 'https://evil.example/pealim.com') && !sameSite(pe, 'https://pealim.com.evil.example/') && !sameSite(pe, 'https://notpealim.com/')
      && !sameSite(pe, 'https://www.morfix.co.il/en/x') && !sameSite(pe, 'not an address') && !sameSite(kz, 'http://kizur.co.il.example/'));
    // end to end: the stand-in redirects, the server follows and the gate reads where it ended
    await control({ pealim: `redirect:/site/https/pealim.com/search/?q=${enc('להמר')}`, morfix: `redirect:/site/https/www.morfix.co.il/en/${enc('לזנק')}`, kizur: `redirect:/site/http/kizur.co.il/search_word.php?abbr=${enc('צה"ל')}` });
    const toBare = await api('GET', `/reference/pealim?term=${enc('לגנוב')}`);
    const toWww = await api('GET', `/reference/morfix?term=${enc('לגנוב')}`);
    const toHttp = await api('GET', `/reference/kizur?term=${enc('צה"ל2')}`);
    check('false-rejection: a redirect within the reference\'s own site still gives the copy — www.pealim.com -> pealim.com, to www.morfix.co.il, Kizur to http://kizur.co.il',
      toBare.body.mode === 'copy' && toWww.body.mode === 'copy' && toHttp.body.mode === 'copy', JSON.stringify([toBare.body.reason, toWww.body.reason, toHttp.body.reason]));
    check('…and the copy\'s links are made absolute on the address it was redirected to', toBare.body.html.includes('href="https://pealim.com/word/2"') && toHttp.body.html.includes('href="http://kizur.co.il/word/2"'));
    await control({ academy: 'redirect:/site/https/evil.example/landing', pealim: 'redirect:/site/https/pealim.com.evil.example/search/' });
    const away = await api('GET', `/reference/academy?term=${enc('לגנוב')}`);
    const lookalike = await api('GET', `/reference/pealim?term=${enc('לסחוב')}`);
    check('a redirect to another site is refused: { mode: failed } with the live link and the reason, the pane\'s failure line; nothing stored',
      away.body.mode === 'failed' && away.body.url === `https://hebrew-academy.org.il/?s=${enc('לגנוב')}` && away.body.reason === 'it sent the request on to another site (evil.example)'
      && !peek("SELECT * FROM reference_pages WHERE reference = 'academy' AND term = ?", 'לגנוב').length, JSON.stringify(away.body));
    check('a redirect to a look-alike host (pealim.com.evil.example) is refused the same way', lookalike.body.mode === 'failed' && /another site \(pealim\.com\.evil\.example\)/.test(lookalike.body.reason), JSON.stringify(lookalike.body));
    await control({ pealim: 'page', morfix: 'page', kizur: 'page', academy: 'page' });
  }

  // --- step 4: the Look up page, its search and its tabs -------------------------------------
  const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).calls;
  const page = await fetch(`${base}/lookup`, { headers: { cookie } });
  const pageOut = await fetch(`${base}/lookup`, { redirect: 'manual' });
  check('GET /lookup is the Look up page behind the passphrase (signed out: to the sign-in page)',
    page.status === 200 && /<title>Hebrew reader · Look up<\/title>/.test(await page.text()) && pageOut.status === 303 && pageOut.headers.get('location') === '/login');
  // Dan's card for להמר, from Guy's lesson, confirmed by him (session eleven)
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  const sentence = 'לא כדאי להמר על העתיד של החברה.';
  await api('POST', '/lookup', { surface: 'להמר', sentence, lesson_id: lesson.id });
  await api('POST', '/lookup/confirm', { surface: 'להמר', sentence, root: 'ה.מ.ר', binyan: 'piel' });
  const cardId = peek('SELECT id FROM cards WHERE surface = ?', 'להמר')[0].id;
  const W = `word:${cardId}`;
  const entry = peek('SELECT json FROM cards WHERE id = ?', cardId)[0].json;
  const spotBefore = (await api('GET', `/spots/${enc('v:ה.מ.ר:piel')}`)).body;

  // POST /lookup's own matching, unchanged: a word and its sentence, exactly
  const c0 = await orCalls();
  const pointedOld = await api('POST', '/lookup', { surface: 'לְהַמֵּר', sentence: '' });
  const prefixedOld = await api('POST', '/lookup', { surface: 'ולהמר', sentence: '' });
  check('POST /lookup as it was: a pointed or prefixed form with no sentence is not matched to the card; each asks the model (the stand-in knows neither: 422)',
    pointedOld.status === 422 && prefixedOld.status === 422 && (await orCalls()) === c0 + 2, JSON.stringify([pointedOld.body, prefixedOld.body]));

  const c1 = await orCalls();
  const first = await api('POST', '/lookup', { surface: 'להמר', sentence: '', origin: 'lookup' });
  check('the page\'s search finds Dan\'s own card for להמר (the lesson\'s, confirmed), with no model call',
    first.status === 200 && first.body.key === W && first.body.card.confirmed && (await orCalls()) === c1 && first.body.found_by === 'a card of this word', JSON.stringify({ ...first.body, references: undefined }).slice(0, 300));
  check('the word is saved at once, as the reader\'s save does it: the spot shaky, the mark sent to the spine',
    spotBefore.status === 'new' && first.body.saved.status === 'shaky' && first.body.saved.already === false && first.body.saved.spine === 'recorded' && first.body.spot.status === 'shaky'
    && (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/puts`)).json()).puts['v:ה.מ.ר:piel'] >= 1);
  check('the confirmed card\'s entry is untouched by the search and the save (byte for byte)', peek('SELECT json FROM cards WHERE id = ?', cardId)[0].json === entry);
  const pageLayer = peek("SELECT l.* FROM lookups l JOIN card_links k ON k.child = 'lookup:' || l.id WHERE k.parent = ? AND k.kind = 'layer'", W);
  check('one lookup layer is recorded on the card in the same request: reference page, origin lookup, nothing fetched',
    pageLayer.length === 1 && pageLayer[0].reference === 'page' && pageLayer[0].origin === 'lookup' && pageLayer[0].term === 'להמר' && first.body.layer.line === 'looked up on the Look up page', JSON.stringify(pageLayer));
  check('the answer carries the seven tabs in the references\' order, each with the word to ask for',
    first.body.references.map((r) => r.id).join() === 'morfix,pealim,wiktionary,milog,academy,kizur,sefaria' && first.body.references.every((r) => r.term === 'להמר') && first.body.lookups === 1);
  const forms = {};
  for (const w of ['לְהַמֵּר', 'ולהמר', 'הימר', 'וּלְהַמֵּר', 'שלהמר']) forms[w] = (await api('POST', '/lookup', { surface: w, origin: 'lookup' })).body;
  check('false-rejection: the pointed form, a prefixed form, the dictionary form, and pointed after a prefix all find the same card, with no model call',
    Object.values(forms).every((b) => b.key === W) && (await orCalls()) === c1, JSON.stringify(Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, v.key || v.error]))));
  check('…found by the reader\'s own matching (one prefix), the pointed form by its letters',
    forms['ולהמר'].found_by === 'the reader’s matching' && forms['הימר'].found_by === 'the reader’s matching' && forms['לְהַמֵּר'].found_by === 'a card of this word', JSON.stringify(Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, v.found_by]))));
  check('a word already saved stays as it is (already: true), and a search never lowers a word marked solid',
    forms['ולהמר'].saved.already === true && await (async () => { await api('POST', `/spots/${enc('v:ה.מ.ר:piel')}`, { status: 'solid' }); const again = (await api('POST', '/lookup', { surface: 'להמר', origin: 'lookup' })).body; return again.saved.status === 'solid' && again.spot.status === 'solid'; })());
  const pages = peek("SELECT COUNT(*) AS n FROM lookups WHERE reference = 'page'")[0].n;
  const c3 = await orCalls();
  const twice = await api('POST', '/lookup', { surface: 'הימרתי', origin: 'lookup' });
  check('a form never met (הימרתי, "I bet") is past the reader\'s matching: asked of the model as a new word (the stand-in does not know it: 422, nothing recorded)',
    twice.status === 422 && (await orCalls()) === c3 + 1 && peek("SELECT COUNT(*) AS n FROM lookups WHERE reference = 'page'")[0].n === pages, JSON.stringify(twice.body));
  const vs = await api('POST', '/lookup', { surface: 'ושלהמר', origin: 'lookup' });
  check('ו with ש in front (ושלהמר) is one listed prefix, so it finds the card too', vs.body.key === W && vs.body.found_by === 'the reader’s matching');
  const c2 = await orCalls();
  const fresh = await api('POST', '/lookup', { surface: 'רפורמה', sentence: '', origin: 'lookup' });
  check('a word with no card yet: one model call, the card made as POST /lookup makes it (the word, an empty sentence), saved',
    fresh.status === 200 && (await orCalls()) === c2 + 1 && fresh.body.found_by === 'a new card' && fresh.body.saved.status === 'shaky' && peek('SELECT sentence FROM cards WHERE surface = ?', 'רפורמה')[0].sentence === '');
  const refound = await api('POST', '/lookup', { surface: 'רפורמה', origin: 'lookup' });
  check('the same word again is POST /lookup\'s own cache hit (no model call)', refound.body.key === fresh.body.key && (await orCalls()) === c2 + 1 && refound.body.found_by === 'the word looked up before');
  const emptyW = await api('POST', '/lookup', { surface: '  ', origin: 'lookup' }), longW = await api('POST', '/lookup', { surface: 'א'.repeat(61), origin: 'lookup' });
  check('an empty box or a whole passage is refused, saying why', emptyW.status === 400 && /Type a word/.test(emptyW.body.error) && longW.status === 400 && /one word/.test(longW.body.error));

  // a tab: the reference opened, and recorded with origin lookup; the desk's row stays origin desk
  const tab = await api('POST', `/card/${W}/lookup`, { reference: 'pealim', origin: 'lookup' });
  const row = await api('POST', `/card/${W}/lookup`, { reference: 'wiktionary' });
  check('a tab tap is recorded as a lookup layer with origin lookup; the desk\'s row records origin desk, as before',
    tab.status === 201 && row.status === 201 && tab.body.layer.origin === 'lookup' && row.body.layer.origin === 'desk' && tab.body.layer.line === 'looked up in Pealim');
  const badOrigin = await api('POST', `/card/${W}/lookup`, { reference: 'pealim', origin: 'phone' }), deskPage = await api('POST', `/card/${W}/lookup`, { reference: 'page' });
  check('an unknown origin, or a "Look up page" record made from the desk, is refused (400)', badOrigin.status === 400 && deskPage.status === 400, JSON.stringify([badOrigin.body, deskPage.body]));
  const view = (await api('GET', `/card/${W}`)).body;
  check('the card\'s full view lists the page\'s record as "looked up on the Look up page", and counts it in the thread line',
    view.layers.some((l) => l.kind === 'lookup' && l.line === 'looked up on the Look up page') && /looked up \d+ times/.test(view.thread_line), view.thread_line);

  // the origin column on a database made before it: added by ALTER TABLE, old rows back-filled 'desk'
  {
    const oldDir = mkdtempSync(join(tmpdir(), 'hr-lookup-old-'));
    const Old = new Database(join(oldDir, 'reader.db'));
    Old.exec("CREATE TABLE lookups (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL, term TEXT NOT NULL, at TEXT NOT NULL); INSERT INTO lookups (reference, term, at) VALUES ('milog', 'להמר', '2026-09-26T00:00:00.000Z');");
    Old.close();
    const mig = spawn('node', ['-e', `const db = require('./lib/db'); db.open(${JSON.stringify(oldDir)}); console.log(JSON.stringify(db.getLookup(1)));`], { cwd: root });
    let outMig = ''; mig.stdout.on('data', (d) => outMig += d);
    await new Promise((r) => mig.on('close', r));
    const after = JSON.parse(outMig.trim().split('\n').pop());
    check('an existing database gains lookups.origin by ALTER TABLE ADD COLUMN; its rows back-filled as desk, kept as they were',
      after.origin === 'desk' && after.reference === 'milog' && after.term === 'להמר' && after.at === '2026-09-26T00:00:00.000Z' && /added lookups\.origin \(existing rows: desk\)/.test(outMig), outMig);
    rmSync(oldDir, { recursive: true, force: true });
  }
  // --- step 5: the "Looked up" list, and "Put on a desk" ---------------------------------------
  const R = fresh.body.key;
  let list = await api('GET', '/lookups');
  check('GET /lookups: the words looked up on the page, newest search first (רפורמה, then להמר)',
    list.status === 200 && list.body.items.map((i) => i.key).join() === `${R},${W}` && list.body.more === false && list.body.next === null, JSON.stringify(list.body.items.map((i) => i.key)));
  const lr = list.body.items.find((i) => i.key === W), rr = list.body.items.find((i) => i.key === R);
  check('each with its card key, headword (pointed), gloss and day, and the tabs opened from the page (Pealim; not the desk\'s Wiktionary)',
    lr.headword === 'הִימֵּר' && lr.word === 'הימר' && lr.gloss === 'to gamble, to bet' && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(lr.day) && lr.opened.map((o) => o.label).join() === 'Pealim', JSON.stringify(lr));
  check('false-rejection: a word whose tabs were never opened still stands in the list', rr && rr.opened.length === 0 && rr.gloss === 'a reform');
  check('the list is read from the lookup layers and the cards: the only new table is reference_pages (english_sites and english_lookups are hebrew-english-one\'s, recordings hebrew-speech-one\'s)',
    peek("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('articles','cards','spots','touches','lessons','steps','desks','notes','placements','card_links','answers','examples','lookups','inks','ink_strokes','sheets','sheet_cards','demand_translations','hunts','sqlite_sequence','drill_sets','drill_answers','asks','passages','walks','library_contents','library_pages','library_calendar','study_places','english_sites','english_lookups','recordings')").map((r) => r.name).join() === 'reference_pages');
  const pg1 = await api('GET', '/lookups?limit=1'), pg2 = await api('GET', `/lookups?limit=1&before=${enc(pg1.body.next || '')}`);
  check('one at a time: the next page starts where the last ended (before=<time>)', pg1.body.items[0].key === R && pg1.body.more === true && pg2.body.items[0].key === W && pg2.body.more === false, JSON.stringify([pg1.body, pg2.body]).slice(0, 300));
  const badLimits = await Promise.all(['0', '201', 'x'].map((l) => api('GET', `/lookups?limit=${l}`))), badBefore = await api('GET', '/lookups?before=yesterday');
  check('a limit outside 1–200 or a before that is not a time is refused (400)', badLimits.every((b) => b.status === 400) && badBefore.status === 400);
  // 205 more words looked up on the page: 200 a time, every one reachable
  {
    const Dw = new Database(join(dataDir, 'reader.db'));
    const addCard = Dw.prepare("INSERT INTO cards (surface, context_hash, spot_id, json, built_at, sentence) VALUES (?, ?, NULL, ?, ?, '')");
    const addLook = Dw.prepare("INSERT INTO lookups (reference, term, at, origin) VALUES ('page', ?, ?, 'lookup')");
    const addLink = Dw.prepare("INSERT INTO card_links (child, parent, kind, at) VALUES (?, ?, 'layer', ?)");
    Dw.transaction(() => {
      for (let i = 0; i < 205; i++) {
        const at = new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString();
        const id = addCard.run(`מילה${i}`, `hash-${i}`, JSON.stringify({ surface: `מילה${i}`, lemma: `מילה${i}`, pos: 'noun', meaning_en: `word ${i}`, pointed: { lemma: null, surface: null } }), at).lastInsertRowid;
        const lid = addLook.run(`מילה${i}`, at).lastInsertRowid;
        addLink.run(`lookup:${lid}`, `word:${id}`, at);
      }
    })();
    Dw.close();
  }
  const big1 = await api('GET', '/lookups'), big2 = await api('GET', `/lookups?before=${enc(big1.body.next)}`);
  const all = [...big1.body.items, ...big2.body.items].map((i) => i.key);
  check('207 words looked up: 200 on the first page, "more" and the next 7 after it, each once, newest first',
    big1.body.items.length === 200 && big1.body.more === true && big2.body.items.length === 7 && big2.body.more === false && new Set(all).size === 207 && all[0] === R && all[1] === W && big2.body.items.at(-1).gloss === 'word 0',
    JSON.stringify({ a: big1.body.items.length, b: big2.body.items.length, more: big1.body.more }));

  // three words searched in the same millisecond, at a page's edge: none skipped
  {
    const Dw = new Database(join(dataDir, 'reader.db'));
    const same = '2026-08-01T12:00:00.000Z';
    Dw.transaction(() => {
      for (let i = 0; i < 3; i++) {
        const id = Dw.prepare("INSERT INTO cards (surface, context_hash, spot_id, json, built_at, sentence) VALUES (?, ?, NULL, ?, ?, '')").run(`תיקו${i}`, `tie-${i}`, JSON.stringify({ surface: `תיקו${i}`, lemma: `תיקו${i}`, pos: 'noun', meaning_en: `tie ${i}`, pointed: { lemma: null, surface: null } }), same).lastInsertRowid;
        const lid = Dw.prepare("INSERT INTO lookups (reference, term, at, origin) VALUES ('page', ?, ?, 'lookup')").run(`תיקו${i}`, same).lastInsertRowid;
        Dw.prepare("INSERT INTO card_links (child, parent, kind, at) VALUES (?, ?, 'layer', ?)").run(`lookup:${lid}`, `word:${id}`, same);
      }
    })();
    Dw.close();
    // walk the whole list two at a time
    const seen = [];
    let cursor = '';
    for (let n = 0; n < 200; n++) {
      const pg = (await api('GET', `/lookups?limit=2${cursor}`)).body;
      seen.push(...pg.items.map((i) => i.key));
      if (!pg.more) break;
      cursor = `&before=${enc(pg.next)}&before_key=${enc(pg.next_key)}`;
    }
    const ties = seen.filter((k) => peek('SELECT surface FROM cards WHERE id = ?', Number(k.split(':')[1]))[0]?.surface?.startsWith('תיקו'));
    check('false-rejection: words searched in the same millisecond are never skipped at a page\'s edge (two a page, every word once: 210)',
      ties.length === 3 && new Set(seen).size === seen.length && seen.length === 210, JSON.stringify({ ties, n: seen.length }));
    const keyAlone = await api('GET', '/lookups?before_key=word:1');
    check('before_key without before is refused (400)', keyAlone.status === 400);
  }

  // "Put on a desk": the current desk, unplaced, as a caught line lands; a word already there is counted
  const cur = (await api('GET', '/desks/current')).body.desk;
  const putR = await api('POST', `/desks/${cur.id}/cards`, { card: R, unplaced: true });
  const putAgain = await api('POST', `/desks/${cur.id}/cards`, { card: R, unplaced: true });
  const onDesk = (await api('GET', `/desks/${cur.id}`)).body.cards.find((c) => c.key === R);
  check('a ticked word goes on the current desk, not yet placed (x and y empty), as a line caught on the phone does',
    putR.status === 201 && putR.body.already === false && onDesk && onDesk.place.x === null && onDesk.place.y === null, JSON.stringify(putR.body).slice(0, 200));
  check('a word already on that desk is left there and answered "already" (the page counts it)', putAgain.status === 200 && putAgain.body.already === true);
  const caught = await api('POST', '/desks/catch', { text: 'a line from the phone' });
  check('…the same desk a caught line goes to', caught.status === 201 && caught.body.desk.id === cur.id && caught.body.place.x === null);

  const spotSave = await api('POST', `/spots/${enc('w:רפורמה')}`, { status: 'solid' });
  check('the reader\'s own save (POST /spots) answers as before, through the same code', spotSave.status === 200 && spotSave.body.spot.status === 'solid' && spotSave.body.spine === 'recorded');
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(server.log.split('\n').slice(-30).join('\n')); console.log(`\n${failed} lookup check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} lookup checks passed`);
