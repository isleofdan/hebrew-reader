// Captures the pages at phone (412×915) and desktop (1280×800) into
// docs/screenshots/, against the local mocks, and checks the on-screen word
// count against the stored text.
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
