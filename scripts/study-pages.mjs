// Page checks for hebrew-study-one: the Study pages at phone (390×844) and
// computer (1280×800) size, light and dark — /study with no places and with
// places, a book folded open, a tractate folded open; a page with nothing
// marked, one line marked, a run marked; a walk stop with "First 40 of N
// lines" and "Read it in Study" — against the stand-in Sefaria and the
// stand-in model; screenshots into docs/screenshots/study-*.png. Also: the
// folded row and a marked line each 0 px from their top before the press
// (the numbers printed), the foot bar never over the last line, the grid's
// links at least 44 px square on the phone, and the page no wider than the
// phone.
// Run by `npm run screenshots`, or alone:
//   node scripts/study-pages.mjs
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

const PORT = 8905, OR_PORT = 8906, SEF_PORT = 8907;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-study-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-sefaria.mjs', String(SEF_PORT)]);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'q'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`, SEFARIA_URL: `http://127.0.0.1:${SEF_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).calls;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
// words Dan should never see on these pages (rule 4)
const JARGON = /\b(ref|refs|segment|segments|index|api|json|null|undefined)\b/i;

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
  // a full-page shot holds the fixed foot bar where the screen ended; a
  // screen-sized shot shows it as Dan sees it
  const both = async (page, name, fullPage = true) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `study-${name}-${theme}.png`), fullPage });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const words = async (page) => page.locator('main').innerText();
  const top = (loc) => loc.evaluate((e) => e.getBoundingClientRect().top);
  const or0 = await orCalls();

  const SIZES = [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 800 }, false]];
  const pages = {};
  for (const [name, viewport, mobile] of SIZES) pages[name] = await context(viewport, mobile);

  // --- /study with no places ---------------------------------------------------------------
  for (const [name] of SIZES) {
    const { page } = pages[name];
    await page.goto(`${base}/study`);
    await page.locator('.study-book').first().waitFor();
    const nav = await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute('href')}`).join(' '));
    check(`${name}: /study with no places: "Today's daf: Berakhot 2" (to its Study page), "This week's portion: Bereshit", no Continue; Study marked in the navigation after Walks`,
      (await page.locator('#daf').innerText()) === "Today's daf: Berakhot 2" && (await page.locator('#daf a').getAttribute('href')) === '/study/Berakhot.2a'
      && (await page.locator('#portion').innerText()) === "This week's portion: Bereshit" && (await page.locator('#continue').isHidden()) && (await page.locator('#others').isHidden())
      && /Walks=\/walks Study=\/study$/.test(nav) && (await page.locator('.topbar nav a.active').innerText()) === 'Study', nav);
    check(`${name}: the Tanakh and the Talmud as Sefaria orders them: group headings, then each book with its Hebrew title and its size`,
      (await page.locator('#tanakh .study-group-name').allInnerTexts()).join('|') === 'Torah|Writings' && (await page.locator('#talmud .study-group-name').allInnerTexts()).join('|') === 'Seder Zeraim|Seder Moed'
      && (await page.locator('.study-book-title').allInnerTexts()).join('|') === 'Genesis|Ecclesiastes|Berakhot|Shabbat'
      && (await page.locator('.study-book-size').allInnerTexts()).join('|') === '50 chapters|12 chapters|2a – 64a|2a – 157b' && (await page.locator('.study-book-he').first().innerText()) === 'בראשית');
    check(`${name}: no "ref", "segment", "index" or "API" on /study`, !JARGON.test(await words(page)), (await words(page)).match(JARGON));
    await both(page, `empty-${name}`);
  }

  for (const [name, , mobile] of SIZES) {
    const { page } = pages[name];
    const tag = (s) => `${s}-${name}`;

    // --- a page: nothing marked ---------------------------------------------------------
    await page.goto(`${base}/study/Genesis.1`);
    await page.locator('.study-line').first().waitFor();
    check(`${name}: /study/Genesis.1: the title with its Hebrew, "← Contents" to /study?book=Genesis, Next to Genesis 2 at the top and the bottom, no Previous (the first chapter)`,
      (await page.locator('#title-en').innerText()) === 'Genesis 1' && (await page.locator('#back').getAttribute('href')) === '/study?book=Genesis' && (await page.locator('#back').innerText()) === '← Contents'
      && (await page.locator('[data-turn="next"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).join())) === '/study/Genesis.2,/study/Genesis.2'
      && (await page.locator('[data-turn="prev"]').evaluateAll((as) => as.every((a) => !a.getAttribute('href') && getComputedStyle(a).visibility === 'hidden'))));
    const cols = await page.locator('.study-line').nth(1).evaluate((li) => ['.study-he', '.study-en'].map((s) => { const r = li.querySelector(s).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; }));
    const heStyle = await page.locator('.study-he').first().evaluate((e) => ({ dir: e.getAttribute('dir'), font: getComputedStyle(e).fontFamily, align: getComputedStyle(e).textAlign }));
    check(mobile ? `${name}: each line's Hebrew above its English (stacked), the Hebrew right to left in the app's serif` : `${name}: each line's Hebrew beside its English, the Hebrew right to left in the app's serif`,
      (mobile ? cols[0].top < cols[1].top && cols[0].left === cols[1].left : cols[0].top === cols[1].top && cols[0].left < cols[1].left)
      && heStyle.dir === 'rtl' && /Noto Serif Hebrew/.test(heStyle.font) && heStyle.align === 'right', JSON.stringify({ cols, heStyle }));
    check(`${name}: nothing marked: the foot bar "Start a walk here" for the whole page (Genesis 1), to /walks?ref=Genesis%201`,
      (await page.locator('#walk-here').innerText()) === 'Start a walk here' && (await page.locator('#bar-where').innerText()) === 'Genesis 1'
      && (await page.locator('#walk-here').getAttribute('href')) === '/walks?ref=Genesis%201' && (await page.locator('.study-line.marked').count()) === 0);
    // the foot bar never covers the last line, scrolled to the end
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(80);
    const foot = await page.evaluate(() => ({ last: document.querySelector('.study-line:last-child').getBoundingClientRect().bottom, turn: [...document.querySelectorAll('.study-turn')].at(-1).getBoundingClientRect().bottom, bar: document.querySelector('#bar').getBoundingClientRect().top }));
    console.log(`     ${name}: scrolled to the end, the last line ends at ${foot.last.toFixed(1)} px, Next at ${foot.turn.toFixed(1)} px, the foot bar begins at ${foot.bar.toFixed(1)} px`);
    check(`${name}: scrolled to the end, the foot bar covers neither the last line nor Next (${(foot.bar - foot.turn).toFixed(1)} px clear)`, foot.last <= foot.bar && foot.turn <= foot.bar, JSON.stringify(foot));
    await page.evaluate(() => window.scrollTo(0, 0));
    if (mobile) {
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`${name}: the page is no wider than the phone (${pageWidth} px at 390 px)`, pageWidth <= 390, String(pageWidth));
    }
    check(`${name}: no "ref", "segment", "index" or "API" on the page`, !JARGON.test(await words(page) + (await page.locator('#bar').innerText())), (await words(page)).match(JARGON));
    await both(page, tag('page'), false);

    // --- one line marked: it stays where it was --------------------------------------------
    const line = page.locator('.study-line').nth(2);
    await page.evaluate(() => window.scrollTo(0, 120));
    const before = await top(line);
    await line.click();
    const after = await top(line);
    console.log(`     ${name}: line 3's top ${before.toFixed(2)} px before the tap, ${after.toFixed(2)} px after: ${(after - before).toFixed(2)} px`);
    check(`${name}: tapping line 3 marks it (a quiet highlight) and it stays at the same height (${(after - before).toFixed(2)} px); the bar names Genesis 1:3`,
      (await page.locator('.study-line.marked').count()) === 1 && (await line.getAttribute('class')).includes('marked') && Math.abs(after - before) < 0.5
      && (await page.locator('#bar-where').innerText()) === 'Genesis 1:3' && (await page.locator('#walk-here').getAttribute('href')) === '/walks?ref=Genesis%201%3A3');
    await both(page, tag('one-marked'), false);

    // --- a run marked, then cleared ------------------------------------------------------
    const l5 = page.locator('.study-line').nth(4);
    const b5 = await top(l5);
    await l5.click();
    const a5 = await top(l5);
    check(`${name}: tapping line 5 marks the run 3 to 5, nothing moving (${(a5 - b5).toFixed(2)} px); the bar names "Genesis 1:3–5" and the walk starts at Genesis 1:3-5`,
      (await page.locator('.study-line.marked').count()) === 3 && Math.abs(a5 - b5) < 0.5 && (await page.locator('#bar-where').innerText()) === 'Genesis 1:3–5'
      && (await page.locator('#walk-here').getAttribute('href')) === '/walks?ref=Genesis%201%3A3-5', await page.locator('#bar-where').innerText());
    await both(page, tag('run-marked'), false);
    const l4 = page.locator('.study-line').nth(3);
    const b4 = await top(l4);
    await l4.click();
    check(`${name}: tapping a marked line clears the mark, nothing moving (${((await top(l4)) - b4).toFixed(2)} px); the bar names the page again`,
      (await page.locator('.study-line.marked').count()) === 0 && Math.abs((await top(l4)) - b4) < 0.5 && (await page.locator('#bar-where').innerText()) === 'Genesis 1');

    // --- Next across books and tractates ------------------------------------------------
    await page.goto(`${base}/study/Genesis.50`);
    await page.locator('.study-line').first().waitFor();
    check(`${name}: Next from Genesis 50 goes to Ecclesiastes 1`, (await page.locator('[data-turn="next"]').first().getAttribute('href')) === '/study/Ecclesiastes.1');
    await page.goto(`${base}/study/Berakhot.64a`);
    await page.locator('.study-line').first().waitFor();
    check(`${name}: Next from Berakhot 64a goes to Shabbat 2a; Previous to Berakhot 63b`,
      (await page.locator('[data-turn="next"]').first().getAttribute('href')) === '/study/Shabbat.2a' && (await page.locator('[data-turn="prev"]').first().getAttribute('href')) === '/study/Berakhot.63b');
    await page.goto(`${base}/study/Genesis.51`);
    await page.locator('#state').filter({ hasText: 'Genesis' }).waitFor();
    check(`${name}: a chapter past the end says what is valid ("Genesis has chapters 1 to 50…") and keeps the way back to the contents`,
      /^Genesis has chapters 1 to 50; there is no chapter 51\.$/.test(await page.locator('#state').innerText()) && (await page.locator('#back').isVisible()));

    // --- /study with places, and a book folded open -----------------------------------------
    await page.goto(`${base}/study`);
    await page.locator('.study-book').first().waitFor();
    check(`${name}: with places: "Continue: Berakhot 64a" (the page opened last), the others under a closed "Other places" fold`,
      /^Continue: Berakhot 64a$/.test(await page.locator('#continue').innerText()) && (await page.locator('#continue a').getAttribute('href')) === '/study/Berakhot.64a'
      && (await page.locator('#others summary').innerText()) === 'Other places' && (await page.locator('#others-list li').allTextContents()).join('|') === 'Genesis 50'
      && !(await page.locator('#others').getAttribute('open')));
    await both(page, tag('places'));
    const row = page.locator('.study-book').first();
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    const rb = await top(row);
    await row.click();
    const ra = await top(row);
    console.log(`     ${name}: Genesis's row top ${rb.toFixed(2)} px before the tap, ${ra.toFixed(2)} px after it opened: ${(ra - rb).toFixed(2)} px`);
    const cells = await page.locator('.study-fold:not(.hidden) .study-cell').evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(`${name}: Genesis's row opens in place to its 50 chapters, the row at the same height (${(ra - rb).toFixed(2)} px)`,
      Math.abs(ra - rb) < 0.5 && cells.length === 50 && (await row.getAttribute('aria-expanded')) === 'true'
      && (await page.locator('.study-fold:not(.hidden) .study-cell').nth(6).getAttribute('href')) === '/study/Genesis.7', JSON.stringify({ rb, ra, n: cells.length }));
    if (mobile) check(`${name}: every chapter link at least 44 px square (smallest ${Math.min(...cells.map((c) => Math.min(...c)))} px)`, cells.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(cells.slice(0, 5)));
    await both(page, tag('book-open'));
    const rc = await top(row);
    await row.click();
    check(`${name}: tapping it again folds it, the row still in place (${((await top(row)) - rc).toFixed(2)} px)`,
      Math.abs((await top(row)) - rc) < 0.5 && (await page.locator('.study-fold:not(.hidden)').count()) === 0);

    // --- a tractate folded open ---------------------------------------------------------
    const trow = page.locator('.study-book').nth(2);
    await trow.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -150));
    const tb = await top(trow);
    await trow.click();
    const ta = await top(trow);
    console.log(`     ${name}: Berakhot's row top ${tb.toFixed(2)} px before the tap, ${ta.toFixed(2)} px after it opened: ${(ta - tb).toFixed(2)} px`);
    const dafs = page.locator('.study-fold:not(.hidden) .study-daf');
    const sides = await page.locator('.study-fold:not(.hidden) .study-side').evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), href: a.getAttribute('href') }; }));
    check(`${name}: Berakhot's row opens in place (${(ta - tb).toFixed(2)} px) to each daf 2 to 64 once, with its a and b sides; 64 has a only`,
      Math.abs(ta - tb) < 0.5 && (await dafs.count()) === 63 && (await dafs.first().locator('.study-daf-n').innerText()) === '2' && (await dafs.last().locator('.study-daf-n').innerText()) === '64'
      && sides.filter((s) => s.href).length === 125 && sides[0].href === '/study/Berakhot.2a' && sides[1].href === '/study/Berakhot.2b' && sides.at(-1).href === null, JSON.stringify({ tb, ta, n: await dafs.count(), linked: sides.filter((s) => s.href).length }));
    if (mobile) check(`${name}: every page link at least 44 px square (smallest ${Math.min(...sides.map((s) => Math.min(s.w, s.h)))} px)`, sides.every((s) => s.w >= 44 && s.h >= 44));
    if (mobile) {
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`${name}: /study with a tractate open is no wider than the phone (${pageWidth} px)`, pageWidth <= 390, String(pageWidth));
    }
    await both(page, tag('tractate-open'));

    // --- Contents from a page opens that book's fold ---------------------------------------
    await page.goto(`${base}/study?book=Ecclesiastes`);
    await page.locator('.study-fold:not(.hidden)').waitFor();
    check(`${name}: "← Contents" from a page (/study?book=Ecclesiastes) opens /study with that book's fold open`,
      (await page.locator('.study-book[aria-expanded="true"]').innerText()).startsWith('Ecclesiastes') && (await page.locator('.study-fold:not(.hidden) .study-cell').count()) === 12);
  }

  // --- the walk stop: "First 40 of N lines" and "Read it in Study" -----------------------------
  check(`no Study page made a request to the stand-in model (${or0} before, ${await orCalls()} after)`, (await orCalls()) === or0);
  for (const [name] of SIZES) {
    const { page } = pages[name];
    await page.goto(`${base}/study/Genesis.2`);
    await page.locator('.study-line').first().waitFor();
    check(`${name}: Genesis 2 in Study shows all its 45 lines`, (await page.locator('.study-line').count()) === 45);
    await page.locator('#walk-here').click();
    await page.waitForURL(/\/walks\?ref=/);
    check(`${name}: "Start a walk here" opens the Walks page at that passage, waiting for Start (no model call yet)`,
      (await page.locator('#from').innerText()) === 'Start from Genesis 2' && (await page.locator('#start-go').isVisible()));
    await page.locator('#start-go').click();
    await page.waitForURL(/\/walks\/\d+$/);
    await page.locator('.walk-stop').first().waitFor();
    const s1 = page.locator('.walk-stop').first();
    check(`${name}: the walk stop shows "First 40 of 45 lines" under the passage and "Read it in Study" beside "Full passage", to /study/Genesis.2`,
      (await s1.locator('.walk-cut').innerText()) === 'First 40 of 45 lines' && (await s1.locator('.walk-study').innerText()) === 'Read it in Study'
      && (await s1.locator('.walk-study').getAttribute('href')) === '/study/Genesis.2' && (await s1.locator('.walk-full').getAttribute('href')) === 'https://www.sefaria.org/Genesis.2'
      && (await s1.locator('.walk-he').innerText()).split('\n').length === 40);
    await s1.scrollIntoViewIfNeeded();
    await both(page, `walk-stop-${name}`);
  }
  // a passage of 2 lines: the link and no count line
  const { page } = pages.phone;
  await page.goto(`${base}/walks?ref=Shabbat.112b`);
  await page.locator('#start-go').click();
  await page.waitForURL(/\/walks\/\d+$/);
  await page.locator('.walk-stop').first().waitFor();
  check('phone: a short passage (Shabbat 112b) shows "Read it in Study" to /study/Shabbat.112b and no "First 40" line',
    (await page.locator('.walk-study').getAttribute('href')) === '/study/Shabbat.112b' && (await page.locator('.walk-cut').count()) === 0);

  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} study page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} study page checks passed`);
