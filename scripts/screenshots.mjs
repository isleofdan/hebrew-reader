// Captures the pages at phone (412×915) and desktop (1280×800) into
// docs/screenshots/, against the local mocks: login, index, the reader with
// the card and after a save, the index with a thin article, and the phone
// page in its three states (gap open, after a right Check, after Show).
//   node scripts/screenshots.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const tok = (await import('../public/tokenize.js')).default;

const PORT = 8795, OR_PORT = 8796, SPINE_PORT = 8797;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-shots-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 50; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

try {
  await up(`${base}/health`);
  const browser = await chromium.launch({ executablePath: exe });
  const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');

  // each viewport works a different Nif'al verb so the second run does not find the first run's mark
  for (const [name, viewport, isMobile, target, rootRe] of [['desktop', { width: 1280, height: 800 }, false, 'שנאלצה', /א\.ל\.צ/], ['phone', { width: 412, height: 915 }, true, 'ייקבעו', /ק\.ב\.ע/]]) {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.on('console', (m) => { if (m.type() === 'error') { console.log('console error:', m.text()); } });

    await page.goto(`${base}/login`);
    await page.screenshot({ path: join(out, `login-${name}.png`) });
    await page.fill('#passphrase', PASS);
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/`);

    // the index, empty, then with an article
    await page.waitForSelector('#empty:not(.hidden), .articles li');
    if (name === 'desktop') {
      await page.fill('#text', sample);
      await page.click('#add');
      await page.waitForURL(/read\.html\?id=/);
      await page.goto(`${base}/`);
    }
    await page.waitForSelector('.articles li');
    await page.waitForTimeout(600); // fonts
    await page.screenshot({ path: join(out, `index-${name}.png`), fullPage: false });

    // the reader
    await page.click('.articles li a');
    await page.waitForSelector('.body .w');
    const onScreen = await page.locator('.body .w').count();
    const stored = await (await ctx.request.get(`${base}/articles/1`)).json();
    const inText = tok.count(stored.text);
    check(`${name}: on-screen word count matches stored text within ±2%`, Math.abs(onScreen - inText) / inText <= 0.02, `${onScreen} on screen, ${inText} in text`);
    const rtl = await page.locator('.body').evaluate((el) => getComputedStyle(el).direction);
    check(`${name}: article is right-to-left`, rtl === 'rtl');

    // open the card on the Nif'al verb
    const word = page.locator('.body .w', { hasText: target }).first();
    await word.scrollIntoViewIfNeeded();
    if (isMobile) await word.tap(); else { await word.hover(); await page.waitForTimeout(500); }
    const card = page.locator(isMobile ? '#card-phone' : '#card-desktop');
    await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    const text = await card.innerText();
    check(`${name}: card shows root, binyan, meaning, category`, rootRe.test(text) && /Nif'al/.test(text) && /conjugation/.test(text), text.replace(/\s+/g, ' ').slice(0, 160));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `reader-card-${name}.png`) });

    // save to vocab -> amber, persists across reload
    await card.locator('[data-act=shaky]').click();
    await card.locator('.foot', { hasText: /recorded on the spine|saved/ }).waitFor({ timeout: 5000 });
    const foot = await card.locator('.foot').innerText();
    check(`${name}: card footer names the spine outcome`, /recorded on the spine/.test(foot), foot);
    check(`${name}: word tinted amber after save`, await word.evaluate((el) => el.classList.contains('shaky')));
    await page.reload();
    await page.waitForSelector('.body .w.shaky');
    check(`${name}: still amber after reload`, await page.locator('.body .w.shaky', { hasText: target }).count() > 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `reader-marked-${name}.png`) });

    // the index with one thin article: the grey mark on that row only
    const thin = await (await ctx.request.post(`${base}/articles`, { data: { text: 'כותרת קצרה\nטקסט קצר מאוד.' } })).json();
    await page.goto(`${base}/`);
    await page.waitForSelector('.articles li .thin');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `index-thin-${name}.png`) });
    const thinRows = await page.locator('.articles li:has(.thin)').count();
    const thinText = await page.locator('.articles li .thin').first().innerText();
    check(`${name}: index marks the thin article only, with the words`, thinRows === 1 && await page.locator('.articles li').count() >= 2 && /thin — the page gave little text; paste the article instead/.test(thinText), thinText);
    check(`${name}: index header has the phone link${isMobile ? ', shown first' : ''}`, await page.locator('.topbar nav a.phone').count() === 1
      && (!isMobile || (await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().left)))[1] < (await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().left)))[0]));
    await ctx.request.delete(`${base}/articles/${thin.id}`);

    // the phone page: gap open -> wrong Check -> right Check -> Next -> Show
    if (name === 'desktop') {
      // a second and third verb so Next has somewhere to go
      for (const w of ['להתמודד', 'ייקבעו']) {
        const at = stored.text.indexOf(w);
        await ctx.request.post(`${base}/lookup`, { data: { surface: w, sentence: tok.sentenceAt(stored.text, at), article_id: stored.id } });
      }
    }
    await page.goto(`${base}/phone`);
    await page.waitForSelector('#demand-sentence .gap');
    await page.waitForTimeout(400);
    const item1 = await page.evaluate(() => window.Phone.item);
    const formLine = await page.locator('#demand-form-line').innerText();
    check(`${name}: phone shows the sentence with its gap and the root/binyan/tense/person line`, item1 && await page.locator('#demand-sentence .gap:empty').count() === 1 && /root .+ · (Nif'al|Hitpa'el|Pa'al)/.test(formLine), formLine);
    check(`${name}: phone sentence is right-to-left`, (await page.locator('#demand-sentence').evaluate((el) => getComputedStyle(el).direction)) === 'rtl');
    const fits = async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check(`${name}: phone page fits the viewport width (nothing clipped)`, await fits());
    await page.screenshot({ path: join(out, `phone-gap-${name}.png`) });
    await page.fill('#answer', 'שגוי');
    await page.click('#check');
    await page.locator('#answer-msg', { hasText: 'not that' }).waitFor({ timeout: 5000 });
    check(`${name}: wrong form -> "not that — try again or Show", text kept`, (await page.locator('#answer').inputValue()) === 'שגוי' && await page.locator('#demand-sentence .gap:empty').count() === 1);
    await page.fill('#answer', item1.surface);
    await page.click('#check');
    await page.locator('#card-demand:not(.idle) .meaning:not(:empty)').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    check(`${name}: right form -> green fill with the surface, the card under it`, (await page.locator('#demand-sentence .gap.right').innerText()) === item1.surface && /root/.test(await page.locator('#card-demand').innerText()));
    check(`${name}: phone page still fits after the card opened`, await fits());
    await page.screenshot({ path: join(out, `phone-check-${name}.png`) });
    await page.click('#next');
    await page.waitForFunction((prev) => window.Phone.item && window.Phone.item.spot_id !== prev, item1.spot_id, { timeout: 5000 });
    const item2 = await page.evaluate(() => window.Phone.item);
    check(`${name}: Next -> a different spot with its gap open`, item2.spot_id !== item1.spot_id && await page.locator('#demand-sentence .gap:empty').count() === 1, `${item1.spot_id} -> ${item2.spot_id}`);
    await page.click('#show');
    await page.locator('#card-demand:not(.idle) .meaning:not(:empty)').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    check(`${name}: Show -> plain fill with the surface, the card under it`, (await page.locator('#demand-sentence .gap.shown').innerText()) === item2.surface);
    await page.screenshot({ path: join(out, `phone-show-${name}.png`) });

    // the ask surface in the reader
    await page.goto(`${base}/read.html?id=${stored.id}`);
    await page.waitForSelector('.body .w');
    await page.fill('#ask-q', "Which Nif'al forms are in this piece?");
    await page.click('#ask-go');
    await page.locator('#ask-answer:not(.hidden)').waitFor({ timeout: 10000 });
    const askLinks = await page.locator('#ask-links a').evaluateAll((as) => as.map((a) => a.href));
    check(`${name}: ask box answers under itself with a reference link per claim`, /Nif'al/.test(await page.locator('#ask-text').innerText()) && askLinks.length >= 1 && askLinks.every((h) => h.startsWith('https://www.pealim.com/')), askLinks.join(' '));
    const askBox = await page.locator('#ask').boundingBox();
    const articleBox = await page.locator('.article-col').boundingBox();
    check(`${name}: ask box sits ${isMobile ? 'below the article' : 'in the right column'}`, isMobile ? askBox.y >= articleBox.y + articleBox.height - 1 : askBox.x >= articleBox.x + articleBox.width - 1);
    await page.locator('#ask').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `reader-ask-${name}.png`) });

    // the print sheet: no chrome, Nif'al first
    await page.goto(`${base}/sheet.html?articles=5`);
    await page.waitForSelector('.item, #none:not(.hidden)');
    await page.waitForTimeout(400);
    const h2s = await page.locator('h2').evaluateAll((hs) => hs.map((h) => h.textContent));
    check(`${name}: print sheet has no chrome and lists Nif'al first`, await page.locator('.topbar, nav, button').count() === 0 && h2s[0] === "Nif'al" && await page.locator('.item').count() >= 2, h2s.join(', '));
    check(`${name}: print sheet fits the viewport width`, await fits());
    await page.screenshot({ path: join(out, `sheet-${name}.png`), fullPage: true });
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  failed++;
  console.error('FAIL', e);
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall screenshot checks passed');
process.exit(failed ? 1 : 0);
