// Page checks for "Find an article" (hebrew-hunt-build): the button on the
// Articles screen, a tap through to the found article with its "Found on"
// line, "Study guide" link and the reader's own word cards, the study guide
// page, and the last search's block. Against a local news page and the
// OpenRouter stand-in, at computer (1280×800) and phone (412×915) size,
// light and dark; screenshots into docs/screenshots/hunt-*.png. Run by
// `npm run screenshots`, or alone:
//   node scripts/hunt-pages.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const PORT = 8840, OR_PORT = 8841, NEWS_PORT = 8842;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-hunt-pages-'));
const news = `http://127.0.0.1:${NEWS_PORT}`;

// one news site: a feed of two articles, the newest too short
const SENTENCES = [
  'הממשלה הודיעה כי מחיר החשמל נקבע מחדש לקראת החורף הקרוב.',
  'חברת החשמל פנתה לשוק עם תוכנית חדשה לרכבים חשמליים ולאגירה.',
  'רשות החשמל נאלצה לדחות את ההחלטה על התעריפים בשל לחץ ציבורי.',
  'המשקיעים חוששים מפני עלייה נוספת בריבית ובמחירי האנרגיה במשק.',
  'הוועדה נדרשה להכריע בשאלת המכסות לפני סוף השנה הנוכחית.',
];
const body = (n) => Array.from({ length: n }, (_, i) => SENTENCES[i % SENTENCES.length]);
const ARTICLES = {
  '/a/short': { title: 'ידיעה קצרה על הגז', paras: body(12) },
  '/a/good': { title: 'רפורמה במשק החשמל יוצאת לדרך', paras: body(85) },
};
const html = (a) => `<!doctype html><html lang="he"><head><meta charset="utf-8"><title>${a.title}</title></head><body><article><h1>${a.title}</h1>${a.paras.reduce((g, s, i) => { if (i % 5 === 0) g.push([]); g[g.length - 1].push(s); return g; }, []).map((p) => `<p>${p.join(' ')}</p>`).join('')}</article></body></html>`;
const newsServer = http.createServer((req, res) => {
  if (req.url === '/feed') {
    const item = (p, ago) => `<item><title>${ARTICLES[p].title}</title><link>${news}${p}</link><pubDate>${new Date(Date.now() - ago).toUTCString()}</pubDate></item>`;
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(`<?xml version="1.0"?><rss><channel>${item('/a/short', 3600e3)}${item('/a/good', 7200e3)}</channel></rss>`);
  }
  const a = ARTICLES[req.url];
  if (a) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html(a)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => newsServer.listen(NEWS_PORT, r));

const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'h'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`, SPINE_TOKEN: '',
  HUNT_SOURCES: JSON.stringify([{ name: 'Globes', kind: 'rss', urls: [`${news}/feed`] }]),
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };

try {
  await up(`${base}/health`); await up(`http://127.0.0.1:${OR_PORT}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const [cname, cvalue] = cookie.split('=');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(/\b(maps?|mapped|met|touch(es|ed)?|hunt(s|ed|ing)?)\b/gi);
      if (hits) page.jargon.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const both = async (page, name, full = false) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `hunt-${name}-${theme}.png`), fullPage: full });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  let foundId = null;
  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    // --- the Articles screen: "Find an article" beside "Add an article" -----------------
    await page.goto(`${base}/`);
    await page.evaluate(() => document.fonts.ready);
    const btn = page.locator('#find');
    const head = page.locator('.panel-head h2', { hasText: 'Add an article' });
    const [bb, hb] = [await btn.boundingBox(), await head.boundingBox()];
    check(`${name}: "Find an article" beside "Add an article", on screen, and the page fits`,
      (await btn.innerText()) === 'Find an article' && bb && hb && bb.y < hb.y + hb.height && bb.y + bb.height > hb.y && bb.x + bb.width <= viewport.width && await fits(page), JSON.stringify({ bb, hb }));
    await both(page, `articles-${name}`);

    // --- the tap: progress, then the found article (the first size finds it) -----------------
    if (!foundId) {
      const lines = [];
      const seen = page.locator('#find-msg');
      const watch = setInterval(async () => { const t = await seen.innerText().catch(() => ''); if (t && !lines.includes(t)) lines.push(t); }, 20);
      await btn.click();
      await page.waitForURL(/\/read\.html\?id=\d+/, { timeout: 20000 });
      clearInterval(watch);
      foundId = Number(new URL(page.url()).searchParams.get('id'));
      check(`${name}: a tap shows a plain progress line and ends on the found article`, lines.length > 0 && lines.every((l) => !/error/i.test(l)) && foundId > 0, lines.join(' | '));
    } else {
      await page.goto(`${base}/read.html?id=${foundId}`);
    }
    await page.locator('#body .w').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const line = page.locator('#found-line');
    const lineText = await line.innerText();
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    check(`${name}: under the title, one line "Found on <date> from Globes" with a "Study guide" link`,
      await line.isVisible() && lineText.startsWith(`Found on ${today} from Globes`) && (await line.locator('a#guide-link').innerText()) === 'Study guide'
        && (await line.boundingBox()).y > (await page.locator('#headline').boundingBox()).y, lineText);
    const rtl = await page.locator('#body').evaluate((el) => getComputedStyle(el).direction);
    check(`${name}: the found article reads right-to-left and fits`, rtl === 'rtl' && await fits(page));
    await both(page, `found-${name}`);
    // the reader's own word card, unchanged
    const word = page.locator('#body .w', { hasText: 'נאלצה' }).first();
    await word.scrollIntoViewIfNeeded();
    if (mobile) await word.tap(); else { await word.hover(); await page.waitForTimeout(500); }
    const card = page.locator(mobile ? '#card-phone' : '#card-desktop');
    await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    check(`${name}: a word of the found article opens the reader's card, with "Save to vocab" and "Mark solid"`,
      /was forced to/.test(await card.locator('.meaning').innerText()) && (await card.locator('[data-act=shaky]').innerText()) === 'Save to vocab' && (await card.locator('[data-act=solid]').innerText()) === 'Mark solid');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `hunt-found-card-${name}.png`) });
    if (mobile) await page.locator('#card-phone .close').click().catch(() => {});

    // --- the study guide -----------------------------------------------------------------
    await page.goto(`${base}/read.html?id=${foundId}`);
    await page.locator('#guide-link').click();
    await page.waitForURL(new RegExp(`/guide/${foundId}$`));
    await page.evaluate(() => document.fonts.ready);
    const kinds = await page.locator('.guide [data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind));
    check(`${name}: the study guide opens from the link, eight parts in order`, kinds.join(',') === 'header,excerpts,vocabulary,paper,drills,questions,expressions,relevance', kinds.join(','));
    const heDir = await page.locator('.guide .vocab td.he').first().evaluate((el) => getComputedStyle(el).direction);
    const qDir = await page.locator('.guide .questions li').first().evaluate((el) => getComputedStyle(el).direction);
    check(`${name}: its Hebrew is right-to-left, it links the original, and the page fits`,
      heDir === 'rtl' && qDir === 'rtl' && (await page.locator(`.g-header a[href="${news}/a/good"]`).count()) === 1 && await fits(page));
    const vocab = await page.locator('.guide .vocab tr').count() - 1;
    check(`${name}: 25-35 words in the core vocabulary, 1-2 Thinking on Paper prompts`, vocab >= 25 && vocab <= 35 && [1, 2].includes(await page.locator('.guide .paper-prompt').count()), String(vocab));
    await both(page, `guide-${name}`);
    await page.screenshot({ path: join(out, `hunt-guide-full-${name}.png`), fullPage: true });

    // --- the last search, on the Articles screen ------------------------------------------
    await page.goto(`${base}/`);
    const last = page.locator('#last-find');
    await last.locator('summary').waitFor();
    await last.locator('summary').click();
    const lastText = await last.innerText();
    check(`${name}: the last search is on the Articles screen: when, what was tried and why, the last model call, the sites not searched`,
      /^Last search: .* — found, with its study guide/.test(lastText) && /under 600/.test(lastText) && /— chosen/.test(lastText) && /Last model call: ok/.test(lastText) && /Not searched: TheMarker/.test(lastText) && await fits(page), lastText);
    await last.scrollIntoViewIfNeeded();
    await both(page, `last-${name}`);
    check(`${name}: no screen says "map", "met", "touch" or "hunt"`, page.jargon.length === 0, page.jargon.join('; '));
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  newsServer.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} passed`);
process.exit(failed ? 1 : 0);
