// Page checks for hebrew-speech-one: Speak on the Look up page — Chromium's
// fake microphone playing scripts/fixtures/speech/he-emet.wav (אמת): the
// round button, "Stop · 0:04" with its meter, "Writing it down…", the word in
// the box and its card with "Heard: <word> · Play your recording", the
// recording attached to its row and played from the row and the card, two
// recordings and their list, delete with its confirm, an English word, the
// nothing-heard and failure lines, the microphone stopped after Stop, at 30
// seconds and when the app goes to the background, the microphone refused,
// and no button without MediaRecorder — at phone (390×844) and computer
// (1280×800) size, light and dark, against the local stand-ins for
// OpenRouter, the spine and the reference sites; screenshots into
// docs/screenshots/speech-*.png. Run by `npm run screenshots`, or alone:
//   node scripts/speech-pages.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const WAV = join(here, 'fixtures', 'speech', 'he-emet.wav');

const PORT = 8925, OR_PORT = 8926, SPINE_PORT = 8927, REF_PORT = 8928;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-speech-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;
const spineUrl = `http://127.0.0.1:${SPINE_PORT}`;
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'p'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `${mock}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: spineUrl, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };
const nfc = (s) => String(s).normalize('NFC');
const recFiles = () => (existsSync(join(dataDir, 'recordings')) ? readdirSync(join(dataDir, 'recordings')).length : 0);

let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const control = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
const speechAsks = async () => (await (await fetch(`${mock}/calls`)).json()).speech_asks.length;
const spinePuts = async () => Object.values((await (await fetch(`${spineUrl}/puts`)).json()).puts).reduce((n, v) => n + v, 0);
const rowOf = async (key) => (await api('GET', '/lookups')).body.items.find((i) => i.key === key);

try {
  await up(`${base}/health`); await up(`${standin}/calls`); await up(`${mock}/calls`); await up(`${spineUrl}/api/health`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const [cname, cvalue] = cookie.split('=');
  // `init`: a script run before the page's own (the microphone refused, no MediaRecorder)
  const context = async (viewport, isMobile, init) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    await ctx.route(/^https?:\/\/(?!fonts\.)[^/]*\.(co\.il|com|org|org\.il)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>live site</p>' }));
    // every stream the page is given is kept, so a check can see its tracks end
    await ctx.addInitScript(() => {
      window.__streams = [];
      const md = navigator.mediaDevices;
      if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await g(c); window.__streams.push(s); return s; }; }
    });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.played = [];
    page.on('response', (r) => { if (/\/recordings\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET') page.played.push({ id: Number(r.url().split('/').pop()), status: r.status(), type: r.headers()['content-type'], range: r.request().headers().range || null }); });
    page.words = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      // rule 5: none of these words shown to Dan
      const hits = visible.match(/\b(transcri\w*|audio|model|API|blob|query|spots?)\b/gi);
      if (hits) page.words.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `speech-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const topOf = (locator) => locator.evaluate((e) => e.getBoundingClientRect().top);
  const narrow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const live = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState !== 'ended').length);
  const streams = (page) => page.evaluate(() => window.__streams.length);
  const label = (page) => page.locator('.btn.mic .mic-label').innerText();
  const line = (page) => page.locator('#mic-line').innerText();

  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    const phone = name === 'phone';
    const mic = page.locator('.btn.mic');
    await page.goto(`${base}/lookup`);
    await page.evaluate(() => document.fonts.ready);

    // --- idle: the round Speak button beside "Look up" --------------------------------------------
    const box = await mic.boundingBox(), go = await page.locator('#go').boundingBox(), word = await page.locator('#word').boundingBox();
    check(`${name}: a round "Speak" button stands beside "Look up" (${Math.round(box.width)}×${Math.round(box.height)} px)`,
      (await label(page)) === 'Speak' && Math.abs(box.y - go.y) < 1 && box.x > go.x && box.height >= 44 && (await mic.evaluate((e) => parseFloat(getComputedStyle(e).borderRadius))) >= box.height / 2 - 1,
      JSON.stringify({ box, go }));
    if (phone) check(`${name}: on the phone the box takes the first line and "Look up" and Speak share the second, in thumb's reach (Speak's foot at ${Math.round(box.y + box.height)} px)`, box.y >= word.y + word.height && Math.abs(box.width - go.width) < 2);
    check(`${name}: nothing opens the microphone until Speak is tapped`, (await streams(page)) === 0);
    check(`${name}: the page is no wider than the screen`, await narrow(page));
    const top0 = await topOf(mic);
    await both(page, `idle-${name}`);

    // --- recording at 0:04 ---------------------------------------------------------------------------
    const spots0 = (await api('GET', '/spots')).body.items.length;
    const puts0 = await spinePuts();
    await control({ speech: 'hebrew', speech_delay_ms: 1500 });
    await mic.click();
    await page.waitForFunction(() => document.querySelector('.btn.mic .mic-label').textContent === 'Stop · 0:04', null, { timeout: 9000 });
    const top1 = await topOf(mic);
    const meter = await page.locator('.btn.mic .mic-meter').evaluate((e) => getComputedStyle(e).visibility);
    check(`${name}: tapped, it asks for the microphone and records: "Stop · 0:04" counting up, a level meter, "Listening…"`,
      (await label(page)) === 'Stop · 0:04' && meter === 'visible' && (await line(page)) === 'Listening…' && (await live(page)) === 1 && (await mic.getAttribute('aria-pressed')) === 'true');
    check(`${name}: the button keeps its width while recording (${Math.round(box.width)} -> ${Math.round((await mic.boundingBox()).width)} px)`, Math.abs((await mic.boundingBox()).width - box.width) < 1);
    await both(page, `recording-${name}`);

    // --- Stop: "Writing it down…" --------------------------------------------------------------------
    await mic.click();
    await page.waitForFunction(() => document.querySelector('#mic-line').textContent === 'Writing it down…', null, { timeout: 5000 });
    const top2 = await topOf(mic);
    check(`${name}: Stop ends the microphone's tracks at once`, (await live(page)) === 0 && (await streams(page)) === 1);
    check(`${name}: "Writing it down…" while the recording goes up`, (await line(page)) === 'Writing it down…' && (await label(page)) === 'Speak');
    await both(page, `writing-${name}`);

    // --- verify 1: the word in the box, its card, "Heard:" --------------------------------------------
    await page.locator('#card-lookup:not(.idle) .meaning').waitFor({ timeout: 8000 });
    await page.locator('#card-rec .rec-play').waitFor({ timeout: 5000 });
    const top3 = await topOf(mic);
    console.log(`     ${name}: the Speak button's top — idle ${top0.toFixed(1)}, recording ${top1.toFixed(1)}, writing ${top2.toFixed(1)}, done ${top3.toFixed(1)} px: ${(top1 - top0).toFixed(1)}, ${(top2 - top0).toFixed(1)}, ${(top3 - top0).toFixed(1)} px`);
    check(`${name}: the Speak button stays where it was across idle, recording, writing and done (${(top1 - top0).toFixed(1)}, ${(top2 - top0).toFixed(1)}, ${(top3 - top0).toFixed(1)} px)`,
      Math.abs(top1 - top0) < 0.5 && Math.abs(top2 - top0) < 0.5 && Math.abs(top3 - top0) < 0.5);
    const card = await page.evaluate(() => window.Lookup.current);
    check(`${name}: the word heard (אמת) fills the box and its card opens at once ("truth"), with "Heard: אמת · Play your recording" under the box`,
      nfc(await page.locator('#word').inputValue()) === nfc('אמת') && (await page.locator('#card-lookup .meaning').innerText()) === 'truth'
      && nfc(await line(page)) === nfc('Heard: אמת · Play your recording') && (await page.locator('#tabs button.ref').count()) === 7, await line(page));
    const row = await rowOf(card.key);
    check(`${name}: the recording is attached to the row its look-up made (${card.key}) and listed on GET /lookups`, row && row.recordings.length === (phone ? 2 : 1) && /^word:\d+$/.test(card.key), JSON.stringify(row));
    const spots1 = (await api('GET', '/spots')).body.items.length, puts1 = await spinePuts();
    if (!phone) {
      check(`${name}: speaking a new word saved what typing one saves: one spot (the word, saved as his) and one mark to the spine`, spots1 === spots0 + 1 && puts1 === puts0 + 1, JSON.stringify([spots0, spots1, puts0, puts1]));
    } else {
      // the word is already his: the same word typed, for comparison
      await api('POST', '/lookup', { surface: 'אמת', origin: 'lookup' });
      const puts2 = await spinePuts(), spots2 = (await api('GET', '/spots')).body.items.length;
      check(`${name}: speaking a word already his sent exactly what typing it sends (spoken: ${puts1 - puts0} spine write, the look-up's touch; typed: ${puts2 - puts1}), and made no spot`,
        spots1 === spots0 && spots2 === spots1 && puts1 - puts0 === puts2 - puts1, JSON.stringify([spots0, spots1, spots2, puts0, puts1, puts2]));
    }
    check(`${name}: the card carries a play button beside the word`, (await page.locator('#card-lookup .head #card-rec .rec-play').count()) === 1);
    check(`${name}: the page is no wider than the screen with the card open`, await narrow(page));
    await both(page, `heard-${name}`);

    // --- verify 2: playback from the card, the line and the row ----------------------------------------
    const playedId = row.recordings[0].id;
    const cardPlay = page.locator('#card-rec .rec-play');
    const cpTop = await topOf(cardPlay);
    await cardPlay.click();
    await page.waitForTimeout(400);
    check(`${name}: the card's play button plays the newest recording (GET /recordings/${playedId}, audio/webm), not moving (${(await topOf(cardPlay) - cpTop).toFixed(1)} px)`,
      page.played.some((p) => p.id === playedId && (p.status === 200 || p.status === 206) && p.type === 'audio/webm') && Math.abs((await topOf(cardPlay)) - cpTop) < 0.5, JSON.stringify(page.played));
    const ranged = page.played.filter((p) => p.range);
    if (ranged.length) console.log(`     ${name}: the player asked ${ranged.map((p) => `${p.range} -> ${p.status}`).join(', ')}`);
    check(`${name}: the player's ranged request is answered 206`, ranged.length > 0 && ranged.every((p) => p.status === 206), JSON.stringify(page.played));
    page.played.length = 0;
    await page.locator('#mic-line .mic-play').click();
    await page.waitForTimeout(400);
    check(`${name}: "Play your recording" plays it too`, page.played.some((p) => p.id === playedId));
    const li = page.locator(`#looked-list li[data-key="${card.key}"]`);
    await li.locator('.rec-play').waitFor({ timeout: 5000 });
    page.played.length = 0;
    await li.locator('.rec-play').click();
    await page.waitForTimeout(400);
    check(`${name}: the "Looked up" row's play button plays it`, page.played.some((p) => p.id === playedId));

    // --- a second recording of the same word: two on the row, their list ---------------------------------
    await page.evaluate(() => window.scrollTo(0, 0));
    await control({ speech_delay_ms: 0 });
    await mic.click();
    await page.waitForTimeout(1300);
    await mic.click();
    await page.waitForFunction((n) => document.querySelector('#card-rec .rec-count')?.textContent === String(n), phone ? 3 : 2, { timeout: 8000 });
    await page.waitForFunction((args) => document.querySelector(`#looked-list li[data-key="${args[0]}"] .rec-count`)?.textContent === String(args[1]), [card.key, phone ? 3 : 2], { timeout: 5000 });
    check(`${name}: spoken again, the word's row has ${phone ? 3 : 2} recordings, its count shown on the row and on the card`, (await rowOf(card.key)).recordings.length === (phone ? 3 : 2));
    await li.scrollIntoViewIfNeeded();
    const liTop = await topOf(li);
    const more = li.locator('.rec-more');
    const moreTop = await topOf(more);
    await more.click();
    await li.locator('ul.rec-list').waitFor();
    const items = li.locator('li.rec-item');
    check(`${name}: "…" opens the list of the row's recordings, newest first, each with its day, Play and "Delete recording" — the row and "…" not moving (${(await topOf(li) - liTop).toFixed(1)}, ${(await topOf(more) - moreTop).toFixed(1)} px)`,
      (await items.count()) === (phone ? 3 : 2) && /\d{4}, \d\d:\d\d · 0:0\d$/.test(await items.first().locator('.rec-when').innerText()) && (await items.first().locator('.rec-item-play').innerText()) === 'Play'
      && (await items.first().locator('.rec-delete').innerText()) === 'Delete recording' && Math.abs((await topOf(li)) - liTop) < 0.5 && Math.abs((await topOf(more)) - moreTop) < 0.5,
      await li.innerText());
    check(`${name}: the page is no wider than the screen with the list open`, await narrow(page));
    await li.locator('ul.rec-list').evaluate((e) => e.scrollIntoView({ block: 'end' }));
    await both(page, `two-recordings-${name}`);
    await more.click();
    check(`${name}: "…" again closes the list`, (await li.locator('ul.rec-list').count()) === 0);
    // a long press on play opens it too
    const lp = li.locator('.rec-play');
    const lpBox = await lp.boundingBox();
    await page.mouse.move(lpBox.x + lpBox.width / 2, lpBox.y + lpBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    check(`${name}: a long press on the row's play button opens the list too`, (await li.locator('ul.rec-list').count()) === 1);

    // --- verify 7: delete asks first; Keep removes nothing ------------------------------------------------
    const first = items.first();
    const delId = Number(await first.getAttribute('data-id'));
    const files0 = recFiles();
    const del = first.locator('.rec-delete');
    await del.scrollIntoViewIfNeeded();
    const delTop = await topOf(del);
    await del.click();
    check(`${name}: "Delete recording" asks first, in the page: "Delete this recording? Saved words stay." — the button not moving (${(await topOf(del) - delTop).toFixed(1)} px)`,
      (await first.locator('.confirm-text').innerText()) === 'Delete this recording? Saved words stay.' && (await first.locator('.confirm-bar').isVisible()) && Math.abs((await topOf(del)) - delTop) < 0.5);
    await both(page, `delete-confirm-${name}`);
    await first.locator('[data-act=keep]').click();
    check(`${name}: "Keep" removes nothing (the row, its file and the list stay)`, (await first.locator('.confirm-bar').isHidden()) && recFiles() === files0 && (await rowOf(card.key)).recordings.some((r) => r.id === delId) && (await items.count()) === (phone ? 3 : 2));
    await del.click();
    await first.locator('[data-act=delete]').click();
    await page.waitForFunction((args) => !document.querySelector(`#looked-list li[data-key="${args[0]}"] li.rec-item[data-id="${args[1]}"]`), [card.key, delId], { timeout: 5000 });
    check(`${name}: "Delete" removes the recording's row and its file, the list keeps the rest open, the word stays`,
      recFiles() === files0 - 1 && !(await rowOf(card.key)).recordings.some((r) => r.id === delId) && (await items.count()) === (phone ? 2 : 1) && (await rowOf(card.key)).kind === 'word');
    check(`${name}: …and the card's count follows`, (await page.locator('#card-rec .rec-play').innerText()) === (phone ? '2' : ''));

    // --- the text edited and looked up again: the recording stays on its first row --------------------------
    if (!phone) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.fill('#word', 'רפורמה');
      await page.press('#word', 'Enter');
      await page.waitForFunction(() => document.querySelector('#card-lookup .meaning')?.textContent === 'a reform', null, { timeout: 8000 });
      const reform = await page.evaluate(() => window.Lookup.current.key);
      await page.waitForTimeout(300);
      check(`${name}: the text edited (רפורמה) and looked up again: its card shows no play button, its row has no recording, אמת's row keeps its own`,
        (await page.locator('#card-rec .rec-play').count()) === 0 && (await rowOf(reform)).recordings.length === 0 && (await rowOf(card.key)).recordings.length === 1);
    }

    // --- verify 3: an English word spoken ------------------------------------------------------------
    await page.evaluate(() => window.scrollTo(0, 0));
    await control({ speech: 'english' });
    await mic.click();
    await page.waitForTimeout(1200);
    await mic.click();
    await page.waitForFunction(() => document.querySelector('#en-text')?.textContent === 'run' && document.querySelector('.en-pealim'), null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#looked-list li[data-key="english:run"] .rec-play'), null, { timeout: 5000 });
    const enRow = await rowOf('english:run');
    check(`${name}: an English word spoken ("run") opens its list of Hebrew words, "Heard: run · Play your recording", and the recording hangs off the english:run row`,
      (await page.locator('#english .en-title').innerText()) === 'Hebrew words for run' && (await line(page)) === 'Heard: run · Play your recording' && enRow.recordings.length === (phone ? 2 : 1), JSON.stringify(enRow));
    check(`${name}: the page is no wider than the screen`, await narrow(page));
    await both(page, `english-${name}`);

    // --- verify 4: nothing heard, the model down -----------------------------------------------------
    const filesE = recFiles();
    await control({ speech: 'empty' });
    await mic.click(); await page.waitForTimeout(900); await mic.click();
    await page.waitForFunction(() => document.querySelector('#mic-line').textContent === 'Nothing was heard. Try again.', null, { timeout: 5000 });
    check(`${name}: nothing heard: "Nothing was heard. Try again.", and no recording kept`, recFiles() === filesE && (await page.locator('#word').inputValue()) === 'run');
    await both(page, `nothing-heard-${name}`);
    await control({ speech: 'down' });
    await mic.click(); await page.waitForTimeout(900); await mic.click();
    await page.waitForFunction(() => document.querySelector('#mic-line.error'), null, { timeout: 8000 });
    check(`${name}: the model down: "The recording could not be written down; try again or type it.", and no recording kept`,
      (await line(page)) === 'The recording could not be written down; try again or type it.' && recFiles() === filesE);
    check(`${name}: the microphone's tracks all ended after each recording`, (await live(page)) === 0);
    await control({ speech: 'hebrew' });

    // --- verify 6: the app going to the background stops it ----------------------------------------------
    const asks0 = await speechAsks();
    await mic.click();
    await page.waitForFunction(() => document.querySelector('.btn.mic.recording'), null, { timeout: 5000 });
    await page.waitForTimeout(500);
    check(`${name}: (recording: one live track)`, (await live(page)) === 1);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(400);
    check(`${name}: the app going to the background (visibilitychange to hidden) stops the recording and ends its tracks; nothing is sent`,
      (await live(page)) === 0 && (await label(page)) === 'Speak' && (await speechAsks()) === asks0 && /^Stopped: the reader went to the background/.test(await line(page)));
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });

    // --- verify 6: 30 seconds stops it (once, on the computer) --------------------------------------------
    if (!phone) {
      const t0 = Date.now();
      await mic.click();
      await page.waitForFunction(() => document.querySelector('.btn.mic.recording'), null, { timeout: 5000 });
      await page.waitForFunction(() => !document.querySelector('.btn.mic.recording'), null, { timeout: 40000 });
      const took = (Date.now() - t0) / 1000;
      await page.waitForFunction(() => /^Heard: /.test(document.querySelector('#mic-line').textContent), null, { timeout: 8000 });
      console.log(`     ${name}: left recording, it stopped by itself after ${took.toFixed(1)} s`);
      check(`${name}: left recording, it stops by itself at 30 seconds (${took.toFixed(1)} s), its tracks ended, and is written down as any other`, took >= 29.5 && took < 33 && (await live(page)) === 0);
    }
    check(`${name}: no screen shows "transcribe", "audio", "model", "API", "blob" or the reader's inside words`, page.words.length === 0, page.words.join(' | '));
    await ctx.close();

    // --- the microphone refused; no MediaRecorder -------------------------------------------------------
    const refused = await context(viewport, mobile, () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
    await refused.page.goto(`${base}/lookup`);
    await refused.page.locator('.btn.mic').click();
    await refused.page.locator('#mic-line.error').waitFor({ timeout: 5000 });
    check(`${name}: the microphone refused: "The reader may not use the microphone. Allow it in the browser's site settings for hebrew-reader-dan.fly.dev, then tap Speak again."`,
      (await refused.page.locator('#mic-line').innerText()) === "The reader may not use the microphone. Allow it in the browser's site settings for hebrew-reader-dan.fly.dev, then tap Speak again." && (await refused.page.locator('.btn.mic .mic-label').innerText()) === 'Speak');
    await both(refused.page, `refused-${name}`);
    await refused.ctx.close();
    const bare = await context(viewport, mobile, () => { delete window.MediaRecorder; window.MediaRecorder = undefined; });
    await bare.page.goto(`${base}/lookup`);
    await bare.page.locator('#word').waitFor();
    check(`${name}: with no MediaRecorder, the Speak button is not shown and the box works as before`, (await bare.page.locator('.btn.mic').count()) === 0 && (await bare.page.locator('#go').isVisible()));
    await bare.ctx.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} speech page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} speech page checks passed`);
