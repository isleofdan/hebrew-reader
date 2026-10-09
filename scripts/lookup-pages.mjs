// Page checks for hebrew-lookup-one: the Look up page — the search, the card
// saved, the seven tabs opening inside the page, the "Looked up" list and
// "Put on a desk" — at computer (1280×800) and phone (412×915) size, light
// and dark, against the local stand-ins for OpenRouter, the spine and the
// reference sites; screenshots into docs/screenshots/lookup-*.png. Run by
// `npm run screenshots`, or alone:
//   node scripts/lookup-pages.mjs
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

const PORT = 8860, OR_PORT = 8861, SPINE_PORT = 8862, REF_PORT = 8863;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-lookup-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'l'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };

// WCAG contrast of what the browser painted
const rgb = (css) => (css.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number).map((c) => c / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function contrast(a, b) {
  const L = (css) => { const [r, g, bl] = rgb(css).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const paint = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);
const ground = (locator) => locator.evaluate((el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; });

let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const enc = encodeURIComponent;

try {
  await up(`${base}/health`); await up(`${standin}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const [cname, cvalue] = cookie.split('=');
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    // the live sites are never reached: the copy's images and links answer blank
    await ctx.route(/^https?:\/\/(?!fonts\.)[^/]*\.(co\.il|com|org|org\.il)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>live site</p>' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.popups = [];
    page.on('popup', (p) => page.popups.push(p.url()));
    page.refAsks = [];
    page.on('request', (r) => { if (/\/reference\//.test(r.url())) page.refAsks.push(r.url()); });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(/\b(maps?|mapped|met|touch(es|ed)?|spots?|satellite)\b/gi);
      if (hits) page.jargon.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `lookup-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  // --- the data: Guy's lesson, with להמר met in it -----------------------------------------
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  await api('POST', '/lookup', { surface: 'להמר', sentence: 'לא כדאי להמר על העתיד של החברה.', lesson_id: lesson.id });
  const W = `word:${(await api('POST', '/lookup', { surface: 'להמר', sentence: 'לא כדאי להמר על העתיד של החברה.', lesson_id: lesson.id })).body.card ? 1 : 0}`;

  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    const phone = name === 'phone';

    // --- the navigation: "Look up" beside Desk on the articles page, the desk and the phone page
    if (!phone) {
      const navs = {};
      for (const p of ['/', '/desk', '/phone']) {
        await page.goto(base + p);
        navs[p] = await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute('href')}`).join(' '));
      }
      check('desktop: "Look up" is in the top navigation beside Desk on the articles page, the desk and the phone page',
        Object.values(navs).every((n) => /Desk=\/desk Look up=\/lookup$/.test(n)), JSON.stringify(navs));
    }

    // --- step 4: the search, the card, saved ----------------------------------------------
    await page.goto(`${base}/lookup`);
    await page.evaluate(() => document.fonts.ready);
    check(`${name}: the Look up page: one search box, "Look up" marked in the navigation, nothing else until a word is looked up`,
      (await page.locator('#word').count()) === 1 && (await page.locator('.topbar nav a.active').innerText()) === 'Look up' && (await page.locator('#entry').isHidden()));
    await both(page, `empty-${name}`);
    await page.fill('#word', phone ? 'ולהמר' : 'להמר');
    await page.press('#word', 'Enter');
    await page.locator('#card-lookup:not(.idle) .surface .pointed').waitFor({ timeout: 8000 });
    const card = page.locator('#card-lookup');
    check(`${name}: Enter draws the card: the pointed headword, root and binyan, the meaning (typed ${phone ? 'ולהמר, with a prefix' : 'להמר'})`,
      (await card.locator('.surface .pointed').innerText()) === 'הִימֵּר' && /ה\.מ\.ר/.test(await card.locator('.grammar').innerText()) && /Pi'el/.test(await card.locator('.grammar').innerText())
      && (await card.locator('.meaning').innerText()) === 'to gamble, to bet');
    check(`${name}: the word is saved at once, and the page says so (${phone ? '"In your words." — the computer saved it' : '"Saved to your words."'}); the card's status line says shaky`,
      (await page.locator('#saved-line').innerText()) === (phone ? 'In your words.' : 'Saved to your words.') && /^shaky · seen/.test(await card.locator('.status').innerText()), await page.locator('#saved-line').innerText());
    check(`${name}: the saved line is legible`, contrast(await paint(page.locator('#saved-line'), 'color'), await ground(page.locator('#saved-line'))) >= 4.5);
    const tabs = await page.locator('#tabs button.ref').allTextContents();
    check(`${name}: the seven tabs under the card, in the references' order; no reference asked for before a tap`,
      tabs.join('|') === 'Morfix|Pealim|Wiktionary|Milog|the Academy|Kizur|Sefaria' && page.refAsks.length === 0 && (await page.locator('#pane').isHidden()), tabs.join('|') + ' ' + page.refAsks.join(' '));
    check(`${name}: the card's "Ask about this root" (two new tabs) is not on this page; the tabs do it inside`, await card.locator('[data-act=ask]').isHidden());
    const n0 = Number((/(\d+) times|once/.exec(await page.locator('#looked-line').innerText()) || [])[1] || 1);
    await both(page, `entry-${name}`);

    // --- the tabs: each opens inside the page and is recorded -----------------------------------
    const tapped = [];
    for (const id of ['morfix', 'pealim', 'milog']) {
      const rec = page.waitForResponse((r) => /\/card\/word:\d+\/lookup$/.test(r.url()) && r.status() === 201);
      await page.locator(`#tabs button.ref[data-ref=${id}]`).click();
      await rec;
      await page.locator(`#pane[data-ref=${id}] iframe`).waitFor({ timeout: 8000 });
      tapped.push(`${id}:${await page.locator('#pane').getAttribute('data-mode')}`);
    }
    const n1 = Number((/(\d+) times/.exec(await page.locator('#looked-line').innerText()) || [])[1]);
    check(`${name}: Morfix, Pealim, Milog each open inside the page (a copy, a copy, the framed page), one pane at a time`,
      tapped.join() === 'morfix:copy,pealim:copy,milog:frame' && (await page.locator('.ref-pane').count()) === 1 && (await page.locator('#pane iframe').getAttribute('src')) === `${standin}/milog/${enc('להמר')}`, tapped.join());
    check(`${name}: the card's lookup count rises by three, and each tap is a lookup layer with origin lookup`,
      n1 === n0 + 3 && (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind === 'lookup' && l.origin === 'lookup' && l.reference !== 'page').length === (phone ? 7 : 3), `${n0} -> ${n1}`);
    check(`${name}: no tab opened a new tab`, page.popups.length === 0, page.popups.join(' '));
    await page.locator('#pane').scrollIntoViewIfNeeded();
    await both(page, `tab-frame-${name}`);
    await page.locator('#tabs button.ref[data-ref=pealim]').click();
    await page.locator('#pane[data-ref=pealim] iframe.copy').waitFor({ timeout: 8000 });
    check(`${name}: a copy says so above it, with the live site's link opening a new tab`,
      (await page.locator('#pane .ref-line').innerText()).startsWith('Shown from a copy fetched by the reader; open the site for the live page') && (await page.locator('#pane .ref-line a').getAttribute('target')) === '_blank');
    await page.locator('#pane').scrollIntoViewIfNeeded();
    await both(page, `tab-copy-${name}`);

    // a word the stand-in does not know: said on the card, nothing saved
    await page.fill('#word', 'מילהלאידועה');
    await page.press('#word', 'Enter');
    await page.locator('#card-lookup .error:not(:empty)').waitFor({ timeout: 8000 });
    check(`${name}: a word that cannot be identified says why on the card, with no tabs`, /Card could not be built/.test(await card.locator('.error').innerText()) && (await page.locator('#tabs button').count()) === 0);
    check(`${name}: no screen of this page shows "map", "met", "touch", "spot" or "satellite"`, page.jargon.length === 0, page.jargon.join(' | '));
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} lookup page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} lookup page checks passed`);
