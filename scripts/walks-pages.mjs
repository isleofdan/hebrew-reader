// Page checks for hebrew-walks-one: the walks page and a walk's page at
// phone (390×844) and computer (1280×800) size, light and dark — empty, with
// walks, a walk with one stop, "Thinking…", after a pick, after a pushback,
// after a failed stop — against the stand-in model and the stand-in Sefaria;
// screenshots into docs/screenshots/walks-*.png. Also: the pressed
// direction's top on the screen before and the "You chose" line's top after
// (0 px apart), the buttons' height on the phone, the passage in three
// columns on the computer and stacked on the phone, and a walk reopened with
// no request to either stand-in.
// Run by `npm run screenshots`, or alone:
//   node scripts/walks-pages.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const PORT = 8895, OR_PORT = 8896, SEF_PORT = 8897;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-walks-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-sefaria.mjs', String(SEF_PORT)]);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'p'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`, SEFARIA_URL: `http://127.0.0.1:${SEF_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const control = (c) => fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify(c) });
const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).calls;
const sefCalls = async () => (await (await fetch(`http://127.0.0.1:${SEF_PORT}/calls`)).json()).count;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
// words Dan should never see on these pages (Dan's standing rule)
const JARGON = /\b(desk|subject|chain|parent|ref|thread|ask_id|walk_id)\b/i;

try {
  await up(`${base}/health`); await up(`http://127.0.0.1:${OR_PORT}/calls`); await up(`http://127.0.0.1:${SEF_PORT}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const [cname, cvalue] = login.headers.get('set-cookie').split(';')[0].split('=');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `walks-${name}-${theme}.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const words = async (page) => page.locator('main').innerText();

  const SIZES = [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]];
  const pages = {};
  for (const [name, viewport, mobile] of SIZES) pages[name] = await context(viewport, mobile);

  // --- empty --------------------------------------------------------------------------
  for (const [name] of SIZES) {
    const { page } = pages[name];
    await page.goto(`${base}/walks`);
    await page.locator('.walk-none').waitFor();
    check(`${name}: /walks empty: the box with "a question to walk with…", "Start", "No walks yet", Walks marked in the navigation after Today`,
      (await page.locator('#question').getAttribute('placeholder')) === 'a question to walk with…' && (await page.locator('#start-go').innerText()) === 'Start'
      && (await page.locator('.walk-none').innerText()) === 'No walks yet.' && (await page.locator('.topbar nav a.active').innerText()) === 'Walks'
      && /Today=\/today Walks=\/walks$/.test(await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute('href')}`).join(' '))));
    await both(page, `empty-${name}`);
  }

  for (const [name, , mobile] of SIZES) {
    const { page } = pages[name];
    const tag = (s) => `${s}-${name}`;

    // --- a walk with one stop, started from the box -------------------------------------
    await page.goto(`${base}/walks`);
    await page.locator('#question').fill('Does Jewish thought see humanity on a trajectory of progress?');
    await page.locator('#start-go').click();
    await page.waitForURL(/\/walks\/\d+$/);
    await page.locator('.walk-stop').first().waitFor();
    const s1 = page.locator('.walk-stop').first();
    check(`${name}: Start opens the walk: its title, "Stop 1 · Talmud, Shabbat 112b", "Full passage" to sefaria.org, the passage, Why here, the explanation, the argument with its cited pages, My opinion, "answered in … s"`,
      (await page.locator('#walk-title').innerText()) === 'Does Jewish thought see humanity on a trajectory of progress?'
      && (await s1.locator('.walk-stop-title').innerText()).toLowerCase() === 'stop 1 · talmud, shabbat 112b'
      && (await s1.locator('.walk-full').getAttribute('href')) === 'https://www.sefaria.org/Shabbat.112b' && (await s1.locator('.walk-full').innerText()) === 'Full passage'
      && /זֵירָא/.test(await s1.locator('.walk-he').innerText()) && (await s1.locator('.walk-he').getAttribute('dir')) === 'rtl'
      && /Rabbi Zeira said/.test(await s1.locator('.walk-en').innerText()) && (await s1.locator('.walk-translit').innerText()).length > 10
      && (await s1.locator('.walk-part h3').allInnerTexts()).join('|') === 'Why here|What it says, plainly|Where the tradition argues with itself|My opinion'
      && (await s1.locator('.walk-argues .links a').count()) === 2 && /^answered in \d+ s$/.test(await s1.locator('.walk-took').innerText()),
      await s1.innerText());
    check(`${name}: under the last stop: three directions, the box "Push back, or ask…" and "Go"`,
      (await page.locator('.walk-dir').count()) === 3 && (await page.locator('.walk-push').getAttribute('placeholder')) === 'Push back, or ask…' && (await page.locator('.walk-move .walk-go').innerText()) === 'Go');
    const cols = await s1.locator('.walk-passage > div').evaluateAll((ds) => ds.map((d) => { const r = d.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; }));
    check(mobile ? `${name}: the passage stacked: Hebrew, transliteration, English, one under another` : `${name}: the passage in three columns: Hebrew, transliteration, English side by side`,
      mobile ? cols[0].top < cols[1].top && cols[1].top < cols[2].top && cols.every((c) => c.left === cols[0].left)
        : cols.every((c) => c.top === cols[0].top) && cols[0].left < cols[1].left && cols[1].left < cols[2].left, JSON.stringify(cols));
    if (mobile) {
      const heights = await page.locator('.walk-dir, .walk-move .walk-go').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
      const widths = await page.locator('.walk-dir, .walk-move .walk-go').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().width)));
      const zone = await page.locator('.walk-move').evaluate((z) => Math.round(z.getBoundingClientRect().width));
      check(`${name}: the directions and Go are full width and at least 56 px high (${heights.join(', ')} px)`, heights.every((h) => h >= 56) && widths.every((w) => w === zone), JSON.stringify({ heights, widths, zone }));
      // six links in the top navigation once overflowed the phone (425 px), so
      // the browser zoomed the page out and a kept place drifted 192 px
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`${name}: the page is no wider than the phone (${pageWidth} px at 390 px), the top navigation wrapped`, pageWidth <= 390, String(pageWidth));
    }
    const noJargon = !JARGON.test(await words(page));
    check(`${name}: no "desk", "subject", "chain", "parent", "ref" or "thread" on the walk's page`, noJargon, (await words(page)).match(JARGON));
    await both(page, tag('one-stop'));

    // --- Thinking…, then after a pick: the line where the button was ------------------
    await control({ walk_teach_ms: 2500 });
    const dir = page.locator('.walk-dir').nth(1);
    await dir.scrollIntoViewIfNeeded();
    const before = await dir.evaluate((b) => b.getBoundingClientRect().top);
    await dir.click();
    await page.locator('.walk-thinking').waitFor();
    const thinkingTop = await page.locator('.walk-thinking').evaluate((t) => t.getBoundingClientRect().top);
    check(`${name}: pressing a direction shows "Thinking…" in place of the buttons, at the pressed button's height (${Math.round(before)} px → ${Math.round(thinkingTop)} px)`,
      (await page.locator('.walk-thinking').innerText()) === 'Thinking…' && Math.abs(thinkingTop - before) < 1 && (await page.locator('.walk-dir:visible').count()) === 0);
    await both(page, tag('thinking'));
    await page.locator('.walk-chose').waitFor();
    await page.locator('.walk-stop').nth(1).waitFor();
    const after = await page.locator('.walk-chose').last().evaluate((l) => l.getBoundingClientRect().top);
    const delta = Math.round((after - before) * 100) / 100;
    console.log(`     ${name}: the pressed direction's top ${before.toFixed(2)} px before, the "You chose" line's top ${after.toFixed(2)} px after: ${delta} px apart`);
    check(`${name}: after a pick the buttons are replaced by "You chose: The denial of any line" at the same height (${delta} px apart), and Stop 2 below it`,
      (await page.locator('.walk-chose').last().innerText()) === 'You chose: The denial of any line' && Math.abs(delta) < 1
      && (await page.locator('.walk-stop').count()) === 2 && /^Stop 2 · Tanakh, Genesis 1:1-3$/i.test(await page.locator('.walk-stop').nth(1).locator('.walk-stop-title').innerText()),
      JSON.stringify({ before, after }));
    await control({ walk_teach_ms: 0 });
    await both(page, tag('after-pick'));

    // --- after a pushback ---------------------------------------------------------------
    const box = page.locator('.walk-push');
    await box.fill('I am not convinced: is the descent not just nostalgia?');
    const go = page.locator('.walk-move .walk-go');
    await go.scrollIntoViewIfNeeded();
    const goTop = await go.evaluate((b) => b.getBoundingClientRect().top);
    await go.click();
    await page.locator('.walk-stop').nth(2).waitFor();
    const wroteTop = await page.locator('.walk-chose').last().evaluate((l) => l.getBoundingClientRect().top);
    check(`${name}: after a pushback "You wrote: …" stands where Go was (${Math.round((wroteTop - goTop) * 100) / 100} px apart), Stop 3 below`,
      (await page.locator('.walk-chose').last().innerText()) === 'You wrote: I am not convinced: is the descent not just nostalgia?' && Math.abs(wroteTop - goTop) < 1 && (await page.locator('.walk-stop').count()) === 3,
      JSON.stringify({ goTop, wroteTop }));
    await both(page, tag('after-pushback'));

    // --- after a failed stop ------------------------------------------------------------
    await control({ walk_teach_down: true });
    const d0 = page.locator('.walk-dir').first();
    await d0.scrollIntoViewIfNeeded();
    const d0Top = await d0.evaluate((b) => b.getBoundingClientRect().top);
    await d0.click();
    await page.locator('.walk-failed').waitFor();
    const failTop = await page.locator('.walk-failed').evaluate((l) => l.getBoundingClientRect().top);
    check(`${name}: a failed stop shows its line where the buttons were, says which (the guide unreachable), and the buttons come back`,
      /^The stop could not be made: OpenRouter is unreachable/.test(await page.locator('.walk-failed').innerText()) && Math.abs(failTop - d0Top) < 1
      && (await page.locator('.walk-dir:visible').count()) === 3 && (await page.locator('.walk-stop').count()) === 3,
      JSON.stringify({ text: await page.locator('.walk-failed').innerText(), d0Top, failTop }));
    await control({ walk_teach_down: false });
    await both(page, tag('failed'));

    // --- reopened from the record --------------------------------------------------------
    const url = page.url();
    const [o1, s1c] = [await orCalls(), await sefCalls()];
    await page.goto(url);
    await page.locator('.walk-stop').nth(2).waitFor();
    check(`${name}: reopening the walk draws all three stops and the two lines between them with no request to the stand-in model or Sefaria`,
      (await page.locator('.walk-stop').count()) === 3 && (await page.locator('.walk-chose').allInnerTexts()).join('|') === 'You chose: The denial of any line|You wrote: I am not convinced: is the descent not just nostalgia?'
      && (await orCalls()) === o1 && (await sefCalls()) === s1c, JSON.stringify({ or: [o1, await orCalls()], sef: [s1c, await sefCalls()] }));

    // --- the list with walks -------------------------------------------------------------
    await page.goto(`${base}/walks`);
    await page.locator('.walk-line').first().waitFor();
    const lines = await page.locator('.walk-line').count();
    check(`${name}: /walks lists the saved walks, newest first, each with its title and the day it started, opening the walk`,
      lines >= 1 && /trajectory of progress/.test(await page.locator('.walk-line-title').first().innerText()) && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(await page.locator('.walk-line-day').first().innerText())
      && /^\/walks\/\d+$/.test(await page.locator('.walk-line').first().getAttribute('href')));
    await both(page, tag('with-walks'));
  }

  // --- the address door and a declined first stop (phone) --------------------------------
  const { page } = pages.phone;
  await page.goto(`${base}/walks?ref=Ecclesiastes.1.9`);
  check('phone: /walks?ref=… shows "Start from <reference>" in place of the box', (await page.locator('#from').innerText()) === 'Start from Ecclesiastes.1.9' && (await page.locator('#question').isHidden()));
  await page.locator('#start-go').click();
  await page.waitForURL(/\/walks\/\d+$/);
  await page.locator('.walk-stop').first().waitFor();
  check('phone: Start from a reference opens a walk whose first stop is that passage', /Stop 1 · Tanakh, Ecclesiastes 1:9/i.test(await page.locator('.walk-stop-title').first().innerText()));
  await page.goto(`${base}/walks`);
  await page.locator('#question').fill('What should be done about current Israeli politics?');
  await page.locator('#start-go').click();
  await page.locator('#start-msg').filter({ hasText: 'outside' }).waitFor();
  check('phone: a declined first stop shows the decline line and offers the box again',
    /Current Israeli politics is outside what I do here/.test(await page.locator('#start-msg').innerText()) && (await page.locator('#question').isVisible()) && (await page.locator('#start-go').isVisible()) && /\/walks$/.test(page.url()));

  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} walks page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} walks page checks passed`);
