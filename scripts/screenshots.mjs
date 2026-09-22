// Captures the pages at phone (412×915) and desktop (1280×800) into
// docs/screenshots/, against the local mocks: login, index, the reader with
// the card and after a save, a card opened from the headline, the index with
// a thin article, the phone page in its three states (gap open, after a right
// Check, after Show), the ask box with and without links, and every page on
// both grounds, light and dark; and the lessons from Guy: the index with a
// lesson, the lesson page with its guide, the flashcards front and back.
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
  const browser = await chromium.launch({ executablePath: exe });
  const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');

  // each viewport works a different Nif'al verb so the second run does not find the first run's mark
  for (const [name, viewport, isMobile, target, rootRe, headTarget] of [['desktop', { width: 1280, height: 800 }, false, 'שנאלצה', /א\.ל\.צ/, 'מקדם'], ['phone', { width: 412, height: 915 }, true, 'ייקבעו', /ק\.ב\.ע/, 'רפורמה']]) {
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

    // a word in the headline: same spans, same card, same tint, same touch
    const headWords = await page.locator('.headline .w').count();
    check(`${name}: every headline word is its own span`, headWords === tok.count(stored.title), `${headWords} spans, ${tok.count(stored.title)} words in the headline`);
    const headWord = page.locator('.headline .w', { hasText: headTarget }).first();
    if (isMobile) await headWord.tap(); else { await headWord.hover(); await page.waitForTimeout(500); }
    await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    const headText = await card.innerText();
    check(`${name}: a headline word opens the same card`, headText.includes(headTarget) && /[a-z]/.test(headText), headText.replace(/\s+/g, ' ').slice(0, 120));
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
      check(`${name}: a dropped connection mid-build is said, retried, and the guide still draws`,
        gets >= 3 && msgs.some((m) => /Lost touch with the server/.test(m)) && !msgs.some((m) => /Failed to fetch/.test(m)) && (await page.locator('#guide-msg').innerText()) === '', JSON.stringify(msgs));
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
      check(`${name} ${scheme}: text on the lesson page is legible`, contrast(await paint(page.locator('#items li').first(), 'color'), await ground()) >= 7);
      await page.screenshot({ path: join(out, `lesson-${scheme}-${name}.png`), fullPage: true });
      // session five: the review under the guide, opened
      const review = page.locator('.guide details.review');
      await review.locator('summary').click();
      await review.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      const reviewText = await review.innerText();
      check(`${name} ${scheme}: "Reviewed: 1 correction" opens to the correction, legible, and the page fits`,
        /^Reviewed: 1 correction\b/.test(reviewText) && /ס\.ל\.ם/.test(reviewText) && await review.evaluate((el) => el.open)
        && contrast(await paint(review.locator('li').first(), 'color'), await ground()) >= 7 && await fits(), reviewText.replace(/\s+/g, ' ').slice(0, 120));
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
