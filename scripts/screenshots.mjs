// Captures the pages at phone (412×915) and desktop (1280×800) into
// docs/screenshots/, against the local mocks: login, index, the reader with
// the card and after a save, a card opened from the headline, the index with
// a thin article, the phone page in its three states (gap open, after a right
// Check, after Show), the ask box with and without links, and every page on
// both grounds, light and dark; and the lessons from Guy: the index with a
// lesson, the lesson page with its guide, the flashcards front and back.
//   node scripts/screenshots.mjs
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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

// A card cached before cards carried nikud (session seven, step 4): the phone
// quick lookup of דם opens it unpointed and fills it in place, once.
{
  const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
  const seed = new Database(join(dataDir, 'reader.db'));
  seed.exec('CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, surface TEXT NOT NULL, context_hash TEXT NOT NULL UNIQUE, spot_id TEXT, json TEXT NOT NULL, built_at TEXT NOT NULL)');
  seed.prepare('INSERT INTO cards (surface, context_hash, spot_id, json, built_at) VALUES (?, ?, ?, ?, ?)').run('דם', createHash('sha256').update('דם\n').digest('hex'), 'w:דם',
    JSON.stringify({ surface: 'דם', lemma: 'דם', pos: 'noun', root: 'ד.מ.מ', binyan: null, tense: null, person_gender_number: 'ms', meaning_en: 'blood', governs: null, categories: [], note: null }), '2026-09-22T00:00:00.000Z');
  seed.close();
}
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

// What the browser actually painted, measured. Text against its ground is
// WCAG contrast; one tint against another is a perceived difference
// (CIEDE2000), because amber and blue differ by hue, not by lightness.
const rgb = (css) => (css.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number).map((c) => c / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function contrast(a, b) {
  const L = (css) => { const [r, g, bl] = rgb(css).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function lab(css) {
  const [r, g, b] = rgb(css).map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function dE2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))) || 0);
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) * deg + 360) % 360, h2p = (Math.atan2(b2, a2p) * deg + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  const dhp = C1p * C2p === 0 ? 0 : ((h2p - h1p + 180) % 360) - 180;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2)) * rad) * 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}
const paint = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);

try {
  await up(`${base}/health`);
  // Through the sandbox's proxy when there is one, so the web fonts (Frank
  // Ruhl Libre, Assistant, Noto Serif Hebrew) load as they do for Dan; the
  // local servers are reached directly.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');

  // each viewport works a different Nif'al verb so the second run does not find the first run's mark
  for (const [name, viewport, isMobile, target, rootRe, headTarget] of [['desktop', { width: 1280, height: 800 }, false, 'שנאלצה', /א\.ל\.צ/, 'מקדם'], ['phone', { width: 412, height: 915 }, true, 'ייקבעו', /ק\.ב\.ע/, 'רפורמה']]) {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    // Every screen shot is also read for the three words Dan called jargon
    // (session seven, step 5): "map", "met" and "touch" in any visible text.
    // Kept: "Root radiation map", the name of a paper exercise in Dan's own
    // lesson instructions, which the guide quotes.
    const jargonSeen = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.replace(/Root radiation map/gi, '').match(/\b(maps?|mapped|met|touch(es|ed)?)\b/gi);
      if (hits) jargonSeen.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
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

    // a word in the headline: same spans, same card, same tint, same touch
    const headWords = await page.locator('.headline .w').count();
    check(`${name}: every headline word is its own span`, headWords === tok.count(stored.title), `${headWords} spans, ${tok.count(stored.title)} words in the headline`);
    const headWord = page.locator('.headline .w', { hasText: headTarget }).first();
    if (isMobile) await headWord.tap(); else { await headWord.hover(); await page.waitForTimeout(500); }
    await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    const headText = await card.innerText();
    check(`${name}: a headline word opens the same card`, headText.replace(/[\u0591-\u05C7]/g, '').includes(headTarget) && /[a-z]/.test(headText), headText.replace(/\s+/g, ' ').slice(0, 120));
    await card.locator('[data-act=shaky]').click();
    await card.locator('.foot', { hasText: /recorded on the spine|saved/ }).waitFor({ timeout: 5000 });
    check(`${name}: headline word tinted amber after save`, await headWord.evaluate((el) => el.classList.contains('shaky')));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `reader-headline-${name}.png`) });
    await page.reload();
    await page.waitForSelector('.headline .w.shaky');
    check(`${name}: headline word still amber after reload`, await page.locator('.headline .w.shaky', { hasText: headTarget }).count() > 0);
    const headSentence = await page.locator('.headline .w', { hasText: headTarget }).first().evaluate((el) => el.dataset.sentence);
    check(`${name}: the touch from the headline carries the headline as its sentence`, headSentence === stored.title, headSentence);
    const headMarks = await (await ctx.request.get(`${base}/marks-for-article/${stored.id}`)).json();
    check(`${name}: the headline word is on the map, saved from the headline`, headMarks.surfaces[headTarget] && headMarks.surfaces[headTarget].status === 'shaky', JSON.stringify(headMarks.surfaces[headTarget]));

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
    check(`${name}: phone shows the sentence with its gap and the root/binyan/tense/person line`, item1 && await page.locator('#demand-sentence .gap:empty').count() === 1 && /root .+ · (Pa'al|Nif'al|Pi'el|Pu'al|Hif'il|Huf'al|Hitpa'el)/.test(formLine), formLine);
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

    // an answer with nothing to link, and one the model sent as plain text:
    // both are answers, and no failure line appears under the button
    const askThis = async (question) => {
      await page.fill('#ask-q', question);
      await page.click('#ask-go');
      await page.locator('#ask-msg', { hasText: 'asking…' }).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      return { shown: await page.locator('#ask-answer:not(.hidden)').count() === 1, answer: await page.locator('#ask-text').innerText().catch(() => ''), msg: await page.locator('#ask-msg').innerText().catch(() => '') };
    };
    const noLinks = await askThis('Which forms are here that need no reference?');
    check(`${name}: an answer with no links draws as an answer, with no failure line`, noLinks.shown && /No Nif'al verb form appears/.test(noLinks.answer) && noLinks.msg.trim() === ''
      && /Nothing here to look up/.test(await page.locator('#ask-links').innerText()), `${noLinks.answer.slice(0, 60)} | msg: ${noLinks.msg}`);
    await page.locator('#ask').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, `reader-ask-no-links-${name}.png`) });
    const plain = await askThis('Answer this one in plain text, please.');
    check(`${name}: a plain-text reply draws as an answer too`, plain.shown && /to be forced/.test(plain.answer) && plain.msg.trim() === '', `${plain.answer.slice(0, 60)} | msg: ${plain.msg}`);
    const down = await askThis('Ask the desk while it is down.');
    check(`${name}: an unreachable model is the only thing that draws the failure line, and it names it`,
      !down.shown && /could not be asked/.test(down.msg) && /unreachable/.test(down.msg), down.msg);

    // light and dark: the device's own setting, then the switch
    const ground = () => paint(page.locator('body'), 'backgroundColor');
    const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const pressed = () => page.locator('.theme button[aria-pressed=true]').innerText();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${base}/read.html?id=${stored.id}`);
    await page.waitForSelector('.body .w');
    const darkGround = await ground();
    check(`${name}: a fresh page follows the device — Device is the active position, dark ground, nothing written`, (await pressed()) === 'Device' && (await attr()) === null && contrast(await paint(page.locator('body'), 'color'), darkGround) >= 7,
      `${darkGround} / text ${(await paint(page.locator('body'), 'color'))} at ${contrast(await paint(page.locator('body'), 'color'), darkGround).toFixed(1)}:1`);
    // the two tints, measured on the dark ground
    await ctx.request.post(`${base}/lookup`, { data: { surface: 'באמינות', sentence: tok.sentenceAt(stored.text, stored.text.indexOf('באמינות')), article_id: stored.id } });
    await page.reload();
    await page.waitForSelector('.body .w.shaky');
    await page.waitForSelector('.body .w.new');
    for (const [where, dark] of [['dark', true], ['light', false]]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.waitForTimeout(200);
      const g = await ground();
      const shaky = await paint(page.locator('.body .w.shaky').first(), 'backgroundColor');
      const met = await paint(page.locator('.body .w.new').first(), 'backgroundColor');
      const ink = await paint(page.locator('.body .w.shaky').first(), 'color');
      check(`${name}: on the ${where} ground the word over each tint stays legible`, contrast(ink, shaky) >= 4.5 && contrast(ink, met) >= 4.5,
        `shaky ${contrast(ink, shaky).toFixed(1)}:1, met ${contrast(ink, met).toFixed(1)}:1`);
      check(`${name}: on the ${where} ground the two tints are apart from each other and from the page`, dE2000(shaky, met) >= 10 && dE2000(shaky, g) >= 10 && dE2000(met, g) >= 10,
        `shaky/met ${dE2000(shaky, met).toFixed(1)}, shaky/ground ${dE2000(shaky, g).toFixed(1)}, met/ground ${dE2000(met, g).toFixed(1)} (dE2000)`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(out, `reader-${where}-${name}.png`) });
      await page.goto(`${base}/phone`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `phone-${where}-${name}.png`) });
      await page.goto(`${base}/read.html?id=${stored.id}`);
      await page.waitForSelector('.body .w');
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('.theme button[data-theme-choice=light]');
    const litGround = await ground();
    check(`${name}: Light holds against a device asking for dark`, (await attr()) === 'light' && contrast('rgb(0,0,0)', litGround) >= 10, litGround);
    await page.reload();
    await page.waitForSelector('.body .w');
    check(`${name}: the choice survives a reload`, (await attr()) === 'light' && (await ground()) === litGround && (await pressed()) === 'Light');
    await page.goto(`${base}/phone`);
    await page.waitForTimeout(400);
    check(`${name}: and carries to the other pages`, (await attr()) === 'light' && (await ground()) === litGround);
    await page.click('.theme button[data-theme-choice=dark]');
    check(`${name}: Dark holds against a device asking for light`, (await attr()) === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(200);
    check(`${name}: Dark stays dark when the device changes its mind`, (await ground()) === darkGround, await ground());
    await page.click('.theme button[data-theme-choice=device]');
    await page.waitForTimeout(200);
    check(`${name}: Device gives the page back to the device`, (await attr()) === null && (await ground()) === litGround && (await pressed()) === 'Device');
    await page.click('.theme button[data-theme-choice=light]');
    await page.waitForTimeout(150);
    const lightScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    const darkScheme = await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); const v = getComputedStyle(document.documentElement).colorScheme; document.documentElement.setAttribute('data-theme', 'light'); return v; });
    check(`${name}: the light ground asks a self-darkening browser to leave it alone, the dark ground says it is dark`,
      /only/.test(lightScheme) && /light/.test(lightScheme) && /dark/.test(darkScheme) && !/light/.test(darkScheme), `light: "${lightScheme}", dark: "${darkScheme}"`);
    await page.click('.theme button[data-theme-choice=device]');
    await page.waitForTimeout(150);
    const chrome = await page.locator('meta[name="theme-color"]').getAttribute('content');
    check(`${name}: the browser's own chrome is told which ground this is`, /^#/.test(chrome || ''), chrome);
    await page.goto(`${base}/read.html?id=${stored.id}`);
    await page.waitForSelector('.body .w');

    // lessons from Guy: the index with a lesson, the lesson page with its
    // guide, the flashcards front and back — light and dark
    if (name === 'desktop') {
      // the June lesson's נחתם card comes back wrong (Pa'al, as לזנק did live),
      // the review does not name it (as it did not name לזנק live), and the
      // verb-card check corrects it, so the lesson's card shows the correction,
      // re-pointed and its note written again (session nine); the check also
      // proposes Pi'el for נאלצה, which the review's guide gives as Nif'al, so
      // that card is left and listed (the נוצץ case); one review correction
      // breaks the drill check and is dropped
      await fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify({
        card_overrides: { 'נחתם': { surface: 'נחתם', lemma: 'נחתם', pos: 'verb', root: 'ח.ת.מ', binyan: 'paal', tense: 'past', person_gender_number: '3ms', meaning_en: 'was signed', governs: null, categories: ['conjugation'], note: 'Pa\'al past of ח.ת.מ.' } },
        review_extra: [{ section: 'drills', item: 'להיאלץ', field: '', find: 'guttural', replace: 'geminate', why: 'The drill verb להיאלץ called geminate.' }],
        verb_fixes: { 'נחתם': { binyan: 'nifal', why: "נחתם is Nif'al past of ח.ת.מ, not Pa'al." }, 'נאלצה': { binyan: 'piel', why: "a wrong claim: Pi'el" } },
        guide_silent: ['נחתם'],
      }) });
      await page.goto(`${base}/`);
      await page.setInputFiles('#lesson-file', join(here, 'fixtures', 'Daniel HEB 15jun26.pdf'));
      await page.click('#add-lesson');
      await page.locator('#lesson-msg', { hasText: 'Added' }).waitFor({ timeout: 10000 });
      check(`${name}: "Add lesson" uploads the PDF and says where the title came from`, /Title and date read from the file name/.test(await page.locator('#lesson-msg').innerText()));
    }
    const lessonId = (await (await ctx.request.get(`${base}/lessons`)).json()).items[0].id;
    if (name === 'desktop') {
      // the connection drops once while the guide is building: the page says
      // so, keeps asking, and draws the guide when it is there
      const form = new FormData();
      form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
      const second = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') }, body: form })).json();
      let gets = 0;
      await page.route(`**/lessons/${second.id}`, (route) => (route.request().method() === 'GET' && ++gets === 2 ? route.abort('internetdisconnected') : route.continue()));
      await page.addInitScript(() => { window.__msgs = []; document.addEventListener('DOMContentLoaded', () => { const m = document.querySelector('#guide-msg'); if (m) new MutationObserver(() => window.__msgs.push(m.textContent)).observe(m, { childList: true, characterData: true, subtree: true }); }); });
      await page.goto(`${base}/lesson.html?id=${second.id}`);
      await page.waitForSelector('.guide section', { timeout: 15000 });
      const msgs = await page.evaluate(() => window.__msgs);
      check(`${name}: a lesson with no guide builds one on first open — "Building the study guide…" shown — and a dropped connection mid-build is said, retried, and the guide still draws`,
        gets >= 3 && msgs.some((m) => /^Building the study guide from Guy's lesson/.test(m)) && msgs.some((m) => /The connection to the server dropped/.test(m)) && !msgs.some((m) => /Failed to fetch/.test(m)) && (await page.locator('#guide-msg').innerText()) === '', JSON.stringify(msgs));
      await page.unroute(`**/lessons/${second.id}`);
    }
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${base}/`);
      await page.waitForSelector('.lessons li');
      await page.waitForTimeout(400);
      const row = await page.locator('.lessons li').first().innerText();
      check(`${name} ${scheme}: index lists the lesson with its title and date`, row.includes('שיעור עם גיא — 15.6.2026') && row.includes('15 Jun 2026') && await fits(), row.replace(/\s+/g, ' '));
      await page.screenshot({ path: join(out, `index-lesson-${scheme}-${name}.png`) });

      await page.goto(`${base}/lesson.html?id=${lessonId}`);
      await page.waitForSelector('.guide section', { timeout: 15000 });
      await page.locator('#saved-line', { hasText: 'saved' }).waitFor({ timeout: 15000 });
      await page.waitForSelector('#items .w.shaky');
      await page.waitForTimeout(400);
      const heads = await page.locator('.guide h3').evaluateAll((hs) => hs.map((h) => h.textContent));
      const firstItem = page.locator('#items li').first().locator('.w');
      const [xFirst, xLast] = [await firstItem.first().boundingBox(), await firstItem.last().boundingBox()];
      check(`${name} ${scheme}: lesson page shows every item right-to-left, first word on the right`, await page.locator('#items li').count() === 10
        && (await page.locator('#items').evaluate((el) => getComputedStyle(el).direction)) === 'rtl' && xFirst.x > xLast.x);
      check(`${name} ${scheme}: the guide draws the instructions' sections`, heads.includes('תרגילי הטיה — Conjugation Drills') && heads.includes('עבודה על נייר — Thinking on Paper')
        && heads.includes('מילים מרכזיות — Core Vocabulary') && heads.includes('שאלות הבנה — Comprehension Questions') && heads.includes('ביטויים חשובים — Key Expressions'), heads.join(' | '));
      const savedLine = await page.locator('#saved-line').innerText();
      check(`${name} ${scheme}: footer says what the lesson saved and the spine outcome`, /\d words? saved · 5 phrases kept in the guide only/.test(savedLine) && /recorded on the spine/.test(savedLine), savedLine);
      check(`${name} ${scheme}: a saved lesson word is tinted amber, and the page fits`, await page.locator('#items .w.shaky', { hasText: 'הסלמה' }).count() > 0 && await fits());
      check(`${name} ${scheme}: no "For Guy" box anywhere on the lesson page`, !/For Guy/i.test(await page.locator('#guide').innerText()));
      check(`${name} ${scheme}: text on the lesson page is legible`, contrast(await paint(page.locator('#items li').first(), 'color'), await ground()) >= 7);
      await page.screenshot({ path: join(out, `lesson-${scheme}-${name}.png`), fullPage: true });
      // the review under the guide, opened (session five), with what it
      // applied and dropped (session eight), and the verb-card check under it
      const review = page.locator('.guide details.review').first();
      const verbLine = page.locator('.guide details.review').nth(1);
      await review.locator('summary').click();
      await verbLine.locator('summary').click();
      await review.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => window.scrollBy(0, -80));
      await page.waitForTimeout(200);
      const reviewText = await review.innerText();
      const verbText = await verbLine.innerText();
      check(`${name} ${scheme}: "Reviewed: 1 applied, 1 dropped" opens to the applied correction and the dropped one with the check it broke, legible, and the page fits`,
        /^Reviewed: 1 applied, 1 dropped\b/.test(reviewText) && /ס\.ל\.ם/.test(reviewText) && /The drill verb להיאלץ called geminate\. — failed the drill check: /.test(reviewText)
        && await review.evaluate((el) => el.open) && contrast(await paint(review.locator('li').first(), 'color'), await ground()) >= 7
        && contrast(await paint(review.locator('.review-dropped li').first(), 'color'), await ground()) >= 7 && await fits(), reviewText.replace(/\s+/g, ' ').slice(0, 400));
      check(`${name} ${scheme}: under it, "Verb cards checked: 2, corrected: 1, not changed: 1" opens to נחתם Pa'al → Nif'al, legible`,
        /^Verb cards checked: 2, corrected: 1, not changed: 1\b/.test(verbText) && /Binyan of \u2068נחתם\u2069: \u2068Pa'al\u2069 → \u2068Nif'al\u2069/.test(verbText) && await verbLine.locator('li').first().evaluate((el) => getComputedStyle(el).direction === 'ltr' || el.matches(':dir(ltr)')) && await verbLine.evaluate((el) => el.open)
        && contrast(await paint(verbLine.locator('li').first(), 'color'), await ground()) >= 7, verbText.replace(/\s+/g, ' ').slice(0, 200));
      const dis = verbLine.locator('.review-disagreed li').first();
      check(`${name} ${scheme}: and the card the two checks disagree on: "Not changed — the two checks disagree: נאלצה: review says Nif'al, verb check says Pi'el", left to right, legible, and the page fits`,
        (await dis.innerText()) === "Not changed — the two checks disagree: \u2068נאלצה\u2069: review says \u2068Nif'al\u2069, verb check says \u2068Pi'el\u2069"
        && await dis.evaluate((el) => getComputedStyle(el).direction === 'ltr' || el.matches(':dir(ltr)')) && contrast(await paint(dis, 'color'), await ground()) >= 7 && await fits(),
        await dis.innerText().catch(() => ''));
      await page.screenshot({ path: join(out, `lesson-review-${scheme}-${name}.png`) });

      if (scheme === 'light') {
        const w = page.locator('#items .w', { hasText: 'נחתם' }).first();
        await w.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const lcard = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await lcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        check(`${name}: a lesson word opens the reader's card`, /was signed/.test(await lcard.innerText()) && /ח\.ת\.מ/.test(await lcard.innerText()));
        await page.screenshot({ path: join(out, `lesson-card-${name}.png`) });
      }

      // the card the lesson review corrected: the line under the card, before and after
      {
        const w = page.locator('#items .w', { hasText: 'נחתם' }).first();
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('.guide section');
        await w.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const lcard = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await lcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        const line = lcard.locator('.corrected');
        const text = (await line.innerText()).replace(/\s+/g, ' ');
        check(`${name} ${scheme}: the corrected card says "Corrected by the verb check: Pa'al → Nif'al", legible, and the card reads Nif'al`,
          /^Corrected by the verb check: Pa'al → Nif'al ?שיעור עם גיא — 15\.6\.2026$/.test(text) && await line.isVisible()
          && /Nif'al/.test(await lcard.locator('.grammar').innerText()) && contrast(await paint(line, 'color'), await paint(line, 'backgroundColor')) >= 4.5 && await fits(), text);
        check(`${name} ${scheme}: the corrected card is re-pointed and its note written again for Nif'al (session nine)`,
          (await lcard.locator('.surface .pointed').innerText()) === 'נֶחְתַּם' && (await lcard.locator('.note').innerText()) === "Nif'al of ח.ת.מ, as corrected.",
          `${await lcard.locator('.surface .pointed').innerText()} / ${await lcard.locator('.note').innerText()}`);
        await lcard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(out, `lesson-card-corrected-${scheme}-${name}.png`) });
        if (isMobile) await page.locator('#card-phone .close').click().catch(() => {});
      }

      // a card put back by the one-time step (session nine): its server answer
      // shaped as the step leaves נוצץ live — the check's change marked undone,
      // the put-back line in its place (the step itself is checked by the smoke)
      {
        await page.route('**/lookup', async (route) => {
          const body = JSON.parse(route.request().postData() || '{}');
          const res = await route.fetch();
          const data = await res.json();
          if (body.surface === 'נאלצה' && data.card) {
            const t = 'שיעור עם גיא — 15.6.2026';
            data.card.corrected = [
              { by: 'lesson review', field: 'binyan', before: 'nifal', after: 'piel', lesson_title: t, undone: true },
              { by: 'restore', restored: true, field: 'binyan', before: 'piel', after: 'nifal', lesson_title: t },
            ];
            data.card.refreshed = { for: 2, at: new Date().toISOString() };
            delete data.refresh_due;
          }
          await route.fulfill({ response: res, json: data });
        });
        const w = page.locator('#items .w', { hasText: 'נאלצה' }).first();
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('.guide section');
        await w.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const lcard = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await lcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        const line = lcard.locator('.corrected');
        const text = (await line.innerText()).replace(/\s+/g, ' ');
        check(`${name} ${scheme}: a restored card says "Restored: the verb check's change was contradicted by the lesson review", the undone change left out, legible, and the card reads Nif'al`,
          /^Restored: the verb check's change was contradicted by the lesson review: Pi'el → Nif'al ?שיעור עם גיא — 15\.6\.2026$/.test(text) && await line.isVisible()
          && /Nif'al/.test(await lcard.locator('.grammar').innerText()) && contrast(await paint(line, 'color'), await paint(line, 'backgroundColor')) >= 4.5 && await fits(), text);
        await lcard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(out, `lesson-card-restored-${scheme}-${name}.png`) });
        if (isMobile) await page.locator('#card-phone .close').click().catch(() => {});
        await page.unroute('**/lookup');
      }

      // a card Dan confirmed (session ten): its server answer shaped as the
      // one-time step leaves לזנק live (the step itself is checked by the smoke)
      {
        await page.route('**/lookup', async (route) => {
          const body = JSON.parse(route.request().postData() || '{}');
          const res = await route.fetch();
          const data = await res.json();
          if (body.surface === 'נאלצה' && data.card) {
            data.card.corrected = [{ by: 'verb-card check', field: 'binyan', before: 'paal', after: 'nifal', lesson_title: 'שיעור עם גיא — 15.6.2026' }];
            data.card.refreshed = { for: 1, at: new Date().toISOString() };
            data.card.confirmed = { on: '2026-09-23', root: data.card.root, binyan: 'nifal' };
            delete data.refresh_due;
          }
          await route.fulfill({ response: res, json: data });
        });
        const w = page.locator('#items .w', { hasText: 'נאלצה' }).first();
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('.guide section');
        await w.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const lcard = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await lcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        const line = lcard.locator('.corrected');
        const text = (await line.innerText()).replace(/\s+/g, ' ');
        const conf = line.locator('.confirmed');
        check(`${name} ${scheme}: a card Dan confirmed says "Confirmed by you, 23 Sep 2026" first, then its correction, legible, and the card reads Nif'al`,
          /^Confirmed by you, 23 Sep 2026 ?Corrected by the verb check: Pa'al → Nif'al ?שיעור עם גיא — 15\.6\.2026$/.test(text) && await conf.isVisible()
          && /Nif'al/.test(await lcard.locator('.grammar').innerText()) && contrast(await paint(conf, 'color'), await paint(line, 'backgroundColor')) >= 4.5 && await fits(), text);
        await lcard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(out, `lesson-card-confirmed-${scheme}-${name}.png`) });
        if (isMobile) await page.locator('#card-phone .close').click().catch(() => {});
        await page.unroute('**/lookup');
      }

      // Dan's own root and binyan (session eleven): the control on a verb card,
      // a root the server refuses said there, and the card after a save (the
      // save's answer shaped as the server's, so the lesson stays as it is for
      // the checks after this; the save itself is checked by the smoke)
      {
        let opened = null;
        await page.route('**/lookup', async (route) => {
          const res = await route.fetch();
          const data = await res.json();
          if (data.card && data.card.surface === 'נחתם') opened = data;
          await route.fulfill({ response: res, json: data });
        });
        const w = page.locator('#items .w', { hasText: 'נחתם' }).first();
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('.guide section');
        await w.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const lcard = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await lcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        const sv = lcard.locator('.setverb');
        await sv.locator('summary').click();
        const sel = sv.locator('select[name=binyan]'), root = sv.locator('input[name=root]'), save = sv.locator('button[type=submit]');
        const names = await sel.locator('option').evaluateAll((os) => os.map((o) => o.textContent));
        await sv.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        const inView = async (loc) => { const b = await loc.boundingBox(); const v = page.viewportSize(); return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width && b.y + b.height <= v.height; };
        check(`${name} ${scheme}: a verb card has "Set root or binyan": the binyan list (the seven, Polel, Polal, Hitpolel) on Nif'al, the root ח.ת.מ, a Save button, all on screen and legible`,
          (await sv.locator('summary').innerText()) === 'Set root or binyan' && names.join() === "Pa'al,Nif'al,Pi'el,Pu'al,Hif'il,Huf'al,Hitpa'el,Polel,Polal,Hitpolel"
          && (await sel.inputValue()) === 'nifal' && (await root.inputValue()) === 'ח.ת.מ' && await inView(sel) && await inView(root) && await inView(save)
          && contrast(await paint(sv.locator('summary'), 'color'), await paint(lcard, 'backgroundColor')) >= 4.5
          && contrast(await paint(sv.locator('.hint'), 'color'), await paint(lcard, 'backgroundColor')) >= 4.5 && await fits(), names.join());
        await page.screenshot({ path: join(out, `lesson-setverb-${scheme}-${name}.png`) });
        // the card drawn again as it is (its nikud arriving): the open control keeps what is typed
        await root.fill('ה.מ');
        await lcard.evaluate((el, data) => window.CardUI.fill(el, data), opened);
        check(`${name} ${scheme}: the card drawn again while the control is open keeps it open with what was typed`,
          await sv.evaluate((el) => el.open && el.isConnected) && (await root.inputValue()) === 'ה.מ', await root.inputValue().catch(() => 'gone'));
        await root.fill('חת');
        await save.click();
        const msg = sv.locator('.setverb-msg.bad');
        await msg.waitFor({ timeout: 5000 });
        check(`${name} ${scheme}: a root of two letters is refused on the card with the reason, legible, and Save stays usable`,
          (await msg.innerText()) === 'A root has 3 or 4 letters; "חת" has 2.' && !(await save.isDisabled())
          && contrast(await paint(msg, 'color'), await paint(lcard, 'backgroundColor')) >= 4.5, await msg.innerText());
        await page.screenshot({ path: join(out, `lesson-setverb-refused-${scheme}-${name}.png`) });
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
        const [y, m, d] = today.split('-').map(Number);
        const shown = `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
        let sent = null;
        await page.route('**/lookup/confirm', async (route) => {
          sent = JSON.parse(route.request().postData() || '{}');
          const card = { ...opened.card, confirmed: { on: today, root: opened.card.root, binyan: opened.card.binyan } };
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ card, spot: opened.spot, spine: 'recorded', changed: [] }) });
        });
        await root.fill('ח.ת.מ');
        await save.click();
        const conf = lcard.locator('.corrected .confirmed');
        await conf.waitFor({ timeout: 5000 });
        await lcard.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        check(`${name} ${scheme}: saved as it stands, the card says "Confirmed by you, ${shown}" and offers "Set root or binyan again"; the word and sentence of the card went with it`,
          (await conf.innerText()) === `Confirmed by you, ${shown}` && (await lcard.locator('.setverb summary').innerText()) === 'Set root or binyan again'
          && sent && sent.surface === 'נחתם' && sent.sentence === 'נחתם' && sent.root === 'ח.ת.מ' && sent.binyan === 'nifal'
          && /recorded on the spine/.test(await lcard.locator('.foot').innerText()) && contrast(await paint(conf, 'color'), await paint(lcard.locator('.corrected'), 'backgroundColor')) >= 4.5 && await fits(),
          `${await conf.innerText()} / ${JSON.stringify(sent)}`);
        await page.screenshot({ path: join(out, `lesson-setverb-saved-${scheme}-${name}.png`) });
        if (isMobile) await page.locator('#card-phone .close').click().catch(() => {});
        await page.unroute('**/lookup/confirm');
        await page.unroute('**/lookup');
      }

      // a check proposing a change to a card Dan confirmed: the lesson page's
      // verb-card lines say it was not changed (the rule itself is in the smoke)
      {
        const lessonRe = new RegExp(`/lessons/${lessonId}$`);
        await page.route(lessonRe, async (route) => {
          const res = await route.fetch();
          const data = await res.json();
          // what each check proposed (session eleven): both, one, and a guide
          // saved before then, which names the word alone
          if (data.guide && data.guide.review && data.guide.review.cards) {
            data.guide.review.cards.kept = [{ word: 'לזנק', review: "Pa'al", check: "Pa'al" }, { word: 'נוצץ', review: null, check: "Pi'el, root נ.צ.ץ" }, 'להמר'];
            // and verb cards the review gave no verdict on (session eleven, step 3)
            data.guide.review.verdicts_missing = ['שוטטות', 'לשוטט'];
          }
          await route.fulfill({ response: res, json: data });
        });
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('.guide section');
        const verbLine = page.locator('.guide details.review').nth(1);
        await verbLine.locator('summary').click();
        await verbLine.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(200);
        const verbText = await verbLine.innerText();
        const kept = verbLine.locator('.review-kept li').first();
        const keptLines = await verbLine.locator('.review-kept li').allInnerTexts();
        check(`${name} ${scheme}: "Verb cards checked: 2, corrected: 1, not changed: 4" opens to "Not changed — you confirmed this card: לזנק — review proposed Pa'al; verb check proposed Pa'al", one side alone, and a word alone for an older guide; left to right, legible, and the page fits`,
          /^Verb cards checked: 2, corrected: 1, not changed: 4\b/.test(verbText)
          && keptLines.join('\n') === ["Not changed — you confirmed this card: \u2068לזנק\u2069 — review proposed \u2068Pa'al\u2069; verb check proposed \u2068Pa'al\u2069",
            "Not changed — you confirmed this card: \u2068נוצץ\u2069 — verb check proposed \u2068Pi'el, root נ.צ.ץ\u2069",
            'Not changed — you confirmed this card: \u2068להמר\u2069'].join('\n')
          && await kept.evaluate((el) => getComputedStyle(el).direction === 'ltr' || el.matches(':dir(ltr)')) && contrast(await paint(kept, 'color'), await ground()) >= 7 && await fits(),
          verbText.replace(/\s+/g, ' ').slice(0, 300));
        await page.screenshot({ path: join(out, `lesson-kept-${scheme}-${name}.png`) });
        const missing = page.locator('.guide .review-missing');
        await missing.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        check(`${name} ${scheme}: under the review, one line without opening anything: "The review gave no verdict on: שוטטות, לשוטט", left to right, legible`,
          await missing.count() === 1 && (await missing.innerText()) === 'The review gave no verdict on: \u2068שוטטות\u2069, \u2068לשוטט\u2069' && await missing.isVisible()
          && await missing.evaluate((el) => getComputedStyle(el).direction === 'ltr' || el.matches(':dir(ltr)')) && contrast(await paint(missing, 'color'), await ground()) >= 4.5 && await fits(),
          await missing.innerText().catch(() => ''));
        await page.screenshot({ path: join(out, `lesson-noverdict-${scheme}-${name}.png`) });
        await page.unroute(lessonRe);
      }

      // a lesson opened with no guide yet: the "being built" state, as the
      // upload shows it (the server's answer held at building so it can be seen)
      {
        const lesson = await (await ctx.request.get(`${base}/lessons/${lessonId}`)).json();
        const held = JSON.stringify({ ...lesson, guide: null, guide_state: 'building', saving: false });
        await page.route(new RegExp(`/lessons/${lessonId}(/guide)?$`), (route) => route.fulfill({ status: 200, contentType: 'application/json', body: held }));
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.locator('#guide-msg', { hasText: 'Building the study guide' }).waitFor({ timeout: 10000 });
        const msg = await page.locator('#guide-msg').innerText();
        check(`${name} ${scheme}: a lesson with no guide shows the upload's "being built" line, legible, with Rebuild held off, and the page fits`,
          /^Building the study guide from Guy's lesson and your instructions/.test(msg) && await page.locator('#rebuild').isDisabled()
          && contrast(await paint(page.locator('#guide-msg'), 'color'), await ground()) >= 4.5 && await fits(), msg);
        await page.screenshot({ path: join(out, `lesson-building-${scheme}-${name}.png`) });
        await page.unroute(new RegExp(`/lessons/${lessonId}(/guide)?$`));
      }

      // the reader: a pasted article with the lesson's words in prefixed forms
      const PREFIXED_TITLE = 'בדיקה של מילים מהשיעור';
      const PREFIXED_TEXT = `${PREFIXED_TITLE}\nהחשש מפני ההסלמה גבר השבוע. הדובר אמר שהממשלה פועלת כדי למנוע את ההסלמה ולהחזיר את השקט, והזכיר את ההסכם שנחתם בשנה שעברה ביו״ש.`;
      const listed = (await (await ctx.request.get(`${base}/articles`)).json()).items;
      const probe = listed.find((a) => a.title === PREFIXED_TITLE) || await (await ctx.request.post(`${base}/articles`, { data: { text: PREFIXED_TEXT } })).json();
      await page.goto(`${base}/read.html?id=${probe.id}`);
      await page.waitForSelector('.body .w.shaky');
      await page.waitForTimeout(300);
      const tinted = await page.locator('.w.shaky').evaluateAll((ws) => ws.map((w) => w.dataset.surface));
      check(`${name} ${scheme}: lesson words tint in prefixed forms — ההסלמה, שנחתם, ביו״ש amber`,
        ['ההסלמה', 'שנחתם', 'ביו״ש'].every((w) => tinted.includes(w)) && !tinted.includes('השבוע') && await fits(), tinted.join(' '));
      await page.screenshot({ path: join(out, `reader-prefixed-${scheme}-${name}.png`) });

      // Delete, and its one confirm
      await page.click('#delete');
      const bar = page.locator('#delete-bar');
      await bar.waitFor({ state: 'visible' });
      const yes = bar.locator('[data-act=delete]');
      check(`${name} ${scheme}: Delete asks once, in the page — "Delete this article? Saved words stay." — legibly`,
        (await bar.locator('.confirm-text').innerText()) === 'Delete this article? Saved words stay.' && contrast(await paint(yes, 'color'), await paint(yes, 'backgroundColor')) >= 4.5
        && contrast(await paint(bar.locator('.confirm-text'), 'color'), await ground()) >= 7 && await fits());
      await page.screenshot({ path: join(out, `reader-delete-confirm-${scheme}-${name}.png`) });
      await bar.locator('[data-act=keep]').click();
      check(`${name} ${scheme}: Keep closes the confirm and deletes nothing`, await bar.isHidden() && (await ctx.request.get(`${base}/articles/${probe.id}`)).status() === 200);
      if (scheme === 'dark' && name === 'phone') {
        await page.click('#delete');
        await yes.click();
        await page.waitForURL(`${base}/`);
        const marks = await (await ctx.request.get(`${base}/marks-for-lesson/${lessonId}`)).json();
        check(`${name}: Delete then Delete removes the article, back on the list; the lesson's words stay amber`,
          (await ctx.request.get(`${base}/articles/${probe.id}`)).status() === 404 && marks.surfaces['הסלמה']?.status === 'shaky');
      } else {
        await ctx.request.delete(`${base}/articles/${probe.id}`); // the next run finds the list as it was
      }
      await page.goto(`${base}/cards.html?lesson=${lessonId}`);
      await page.waitForSelector('#flash:not(.hidden)');
      await page.waitForTimeout(400);
      const front = await page.locator('#flash .front').innerText();
      check(`${name} ${scheme}: cards page shows the capped count, the Hebrew right-to-left, no transliteration on the front`,
        (await page.locator('#counter').innerText()) === '1 / 10' && !/translit-/.test(front) && (await page.locator('#f-word').evaluate((el) => getComputedStyle(el).direction)) === 'rtl' && await fits(), front.replace(/\s+/g, ' '));
      await page.screenshot({ path: join(out, `cards-front-${scheme}-${name}.png`) });
      await page.click('#flash');
      await page.waitForSelector('#flash .back:not(.hidden)');
      const back = await page.locator('#flash .back').innerText();
      check(`${name} ${scheme}: tap flips to the meaning, still no transliteration unless asked`, /meaning of/.test(back) && !/translit-/.test(back) && await fits(), back.replace(/\s+/g, ' ').slice(0, 100));
      await page.screenshot({ path: join(out, `cards-back-${scheme}-${name}.png`) });
      if (scheme === 'light') {
        await page.click('#translit');
        check(`${name}: Transliteration shows it on the back when asked`, /translit-0/.test(await page.locator('#flash .back').innerText()));
        await page.click('#know');
        check(`${name}: Know it only moves on`, (await page.locator('#counter').innerText()) === '2 / 10' && await page.locator('#flash .front:not(.hidden)').count() === 1);
        await page.selectOption('#cat', 'Verbs');
        check(`${name}: the category filter narrows the deck`, /^1 \/ [1-9]$/.test(await page.locator('#counter').innerText()) && (await page.locator('#f-cat').innerText()).toUpperCase() === 'VERBS');
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // the lesson's study guide as a print sheet for the reMarkable
    await page.goto(`${base}/lesson.html?id=${lessonId}`);
    await page.waitForSelector('#sheet-link:not(.hidden)');
    check(`${name}: the lesson page links its reMarkable sheet`, (await page.locator('#sheet-link').getAttribute('href')) === `/sheet.html?lesson=${lessonId}`);
    await page.goto(`${base}/sheet.html?lesson=${lessonId}`);
    await page.waitForSelector('#lesson-guide section');
    await page.waitForTimeout(400);
    const sheetHeads = await page.locator('#lesson-guide h3').evaluateAll((hs) => hs.map((h) => h.textContent));
    check(`${name}: lesson sheet has no chrome, the guide's sections, the drill answers at the end`,
      await page.locator('.topbar, nav, button, details').count() === 0 && sheetHeads.includes('תרגילי הטיה — Conjugation Drills') && sheetHeads.at(-1) === 'Answers to the drills'
      && (await page.locator('#lesson-title').innerText()) === 'שיעור עם גיא — 15.6.2026' && await page.locator('#sheet').isHidden(), sheetHeads.join(' | '));
    check(`${name}: lesson sheet fits the viewport width`, await fits());
    await page.screenshot({ path: join(out, `sheet-lesson-${name}.png`), fullPage: true });

    // the print sheet: no chrome, Nif'al first
    await page.goto(`${base}/sheet.html?articles=5`);
    await page.waitForSelector('.item, #none:not(.hidden)');
    await page.waitForTimeout(400);
    const h2s = await page.locator('h2').evaluateAll((hs) => hs.map((h) => h.textContent));
    check(`${name}: print sheet has no chrome and lists Nif'al first`, await page.locator('.topbar, nav, button').count() === 0 && h2s[0] === "Nif'al" && await page.locator('.item').count() >= 2, h2s.join(', '));
    check(`${name}: print sheet fits the viewport width`, await fits());
    await page.screenshot({ path: join(out, `sheet-${name}.png`), fullPage: true });
    // nikud on the card and the color key (session seven, steps 3 and 5), light and dark
    {
      const POINTS = /[\u0591-\u05C7]/;
      const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());
      const clipped = (loc) => loc.evaluate((el) => {
        const r = el.getBoundingClientRect(), fs = parseFloat(getComputedStyle(el).fontSize);
        let p = el.parentElement, hidden = false;
        while (p && !hidden) { const o = getComputedStyle(p).overflowY; hidden = o === 'hidden' || o === 'clip'; p = p.parentElement; }
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        // a block's own box, or for a word inside a line, the line's height
        return { tall: getComputedStyle(el).display === 'inline' ? lh >= fs * 1.45 : r.height >= fs * 1.45, fits: el.scrollHeight <= el.clientHeight + 1, hidden, family: getComputedStyle(el).fontFamily };
      });
      for (const theme of ['light', 'dark']) {
        // The card is opened and its Hebrew face waited for before anything is
        // measured (session twelve). The check used to flake here: in the cloud
        // sandbox the download of the font from Google Fonts sometimes fails
        // outright (the face ends in "error", or the stylesheet never arrives),
        // which no wait can mend. So the face is asked for with the headword's
        // own letters and waited for, up to 15 seconds; a failed download
        // reloads the page and tries again, at most three times.
        const card = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        let fontTries = 0;
        for (;;) {
          fontTries++;
          await page.goto(`${base}/read.html?id=${stored.id}`);
          await page.waitForSelector('.body .w');
          await page.click(`.theme button[data-theme-choice=${theme}]`);
          const w = page.locator('.body .w', { hasText: 'להתמודד' }).first();
          await w.scrollIntoViewIfNeeded();
          if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
          await card.locator('.surface .pointed').filter({ hasText: POINTS }).waitFor({ timeout: 10000 });
          const fontIn = await page.evaluate(async (text) => {
            const until = Date.now() + 15000;
            const noto = () => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Noto Serif Hebrew');
            const loaded = () => noto().some((f) => f.status === 'loaded');
            while (!loaded() && Date.now() < until) {
              if (!noto().length || noto().some((f) => f.status === 'error')) return false; // the download itself failed
              try { await document.fonts.load('600 30px "Noto Serif Hebrew"', text); } catch { /* asked again below */ }
              if (!loaded()) await new Promise((r) => setTimeout(r, 250));
            }
            await document.fonts.ready;
            return loaded();
          }, await card.locator('.surface .pointed').innerText());
          if (fontIn || fontTries >= 3) break;
          console.log(`${name} ${theme}: the Hebrew web font did not download (try ${fontTries}); the page is loaded again`);
        }
        const legend = (await page.locator('.legend').innerText()).replace(/\s+/g, ' ').trim();
        check(`${name} ${theme}: the color key reads "Shaky · Looked up · Solid and new words have no color."`, legend === 'Shaky Looked up Solid and new words have no color.', legend);
        await page.locator('.legend').screenshot({ path: join(out, `legend-${theme}-${name}.png`) });
        const big = card.locator('.surface .pointed'), small = card.locator('.surface .plain'), inText = card.locator('.grammar .pointed');
        const [bigText, smallText, inTextText] = [await big.innerText(), await small.innerText(), await inText.innerText()];
        const m = await clipped(big), mi = await clipped(inText);
        // loaded, not merely declared: fonts.check() is true for a face nobody declared
        const noto = await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Noto Serif Hebrew' && f.status === 'loaded'));
        check(`${name} ${theme}: the card's headword shows with nikud, large, the plain spelling beside it smaller, and the word in the text pointed`,
          bigText === 'הִתְמוֹדֵד' && smallText === 'התמודד' && inTextText === 'לְהִתְמוֹדֵד'
          && parseFloat(await paint(big, 'fontSize')) > parseFloat(await paint(small, 'fontSize')), `${bigText} / ${smallText} / ${inTextText}`);
        check(`${name} ${theme}: the points are set in Noto Serif Hebrew, loaded, with room above and below (nothing clipped)`,
          noto && /^"?Noto Serif Hebrew/.test(m.family) && m.tall && m.fits && !m.hidden && mi.tall && mi.fits && !mi.hidden, JSON.stringify({ noto, m, mi }));
        check(`${name} ${theme}: the pointed headword is legible on the card`, contrast(await paint(big, 'color'), await paint(card, 'backgroundColor')) >= 7);
        await card.screenshot({ path: join(out, `card-nikud-${theme}-${name}.png`) });
        await page.screenshot({ path: join(out, `reader-card-nikud-${theme}-${name}.png`) });

        // the phone page's quick lookup: דם was cached before cards had nikud
        await page.goto(`${base}/phone`);
        const before = (await orCalls()).points_calls;
        await page.fill('#lookup', 'דם');
        await page.click('#lookup-go');
        const lookCard = page.locator('#card-lookup');
        await lookCard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        await lookCard.locator('.surface .pointed').filter({ hasText: POINTS }).waitFor({ timeout: 10000 });
        const after = (await orCalls()).points_calls;
        const first = name === 'desktop' && theme === 'light';
        check(`${name} ${theme}: the quick lookup shows the pointed headword${first ? '; the old card got its nikud with one call and updated in place' : ', from the cache, with no call'}`,
          (await lookCard.locator('.surface .pointed').innerText()) === 'דָּם' && after - before === (first ? 1 : 0), `points calls ${after - before}`);
        await lookCard.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(out, `phone-lookup-nikud-${theme}-${name}.png`) });
      }
      await page.click('.theme button[data-theme-choice=device]');

      // a lesson word whose card was cached before cards had nikud (Dan, 23 Sep
      // 2026: "Nikud should be available anywhere I select a word")
      {
        const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
        const d = new Database(join(dataDir, 'reader.db'));
        const stripped = d.prepare("UPDATE cards SET json = json_remove(json, '$.pointed') WHERE surface = ?").run('נחתם').changes;
        d.close();
        const target = 'נחתם';
        const before = (await orCalls()).points_calls;
        await page.goto(`${base}/lesson.html?id=${lessonId}`);
        await page.waitForSelector('#items .w');
        const w = page.locator('#items .w', { hasText: target }).first();
        await w.scrollIntoViewIfNeeded();
        if (isMobile) await w.tap(); else { await w.hover(); await page.waitForTimeout(500); }
        const card = page.locator(isMobile ? '#card-phone' : '#card-desktop');
        await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
        const got = await card.locator('.surface .pointed').filter({ hasText: POINTS }).waitFor({ timeout: 8000 }).then(() => true, () => false);
        check(`${name}: a lesson word whose card was cached without nikud gets it on first open, in place, with one call`,
          stripped > 0 && got && (await orCalls()).points_calls - before === 1, `rows stripped ${stripped}, pointed ${got}, headword ${await card.locator('.surface').innerText()}, calls ${(await orCalls()).points_calls - before}`);
        await page.screenshot({ path: join(out, `lesson-card-nikud-${name}.png`) });
      }
    }

    check(`${name}: no screen shows "map", "met" or "touch" in its visible text`, jargonSeen.length === 0, jargonSeen.join('; '));
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
