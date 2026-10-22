// Page checks for hebrew-today-one: the Today page — one item at a time, each
// kind of exercise, a right answer, a wrong answer with its flash and Undo,
// "Done for today", and "Nothing is due today" — at computer (1280×800) and
// phone (412×915) size, light and dark, against the local stand-ins for
// OpenRouter and the spine; screenshots into docs/screenshots/today-*.png.
// Run by `npm run screenshots`, or alone:
//   node scripts/today-pages.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seed } from './today-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const db = createRequire(import.meta.url)(join(root, 'lib', 'db.js'));

const OR_PORT = 8871, SPINE_PORT = 8872;
const PORTS = { desktop: 8873, phone: 8874, empty: 8875 };
const PASS = 'open-sesame';
const dirs = [];
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }
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

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
const serverEnv = (port, dir) => ({
  PORT: String(port), DATA_DIR: dir, APP_PASSWORD: PASS, COOKIE_SECRET: 't'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
// one server per width, each with the material written in before it starts;
// one with nothing at all
for (const [name, port] of Object.entries(PORTS)) {
  const dir = mkdtempSync(join(tmpdir(), `hr-today-pages-${name}-`));
  dirs.push(dir);
  if (name === 'empty') db.open(dir); else seed(db, dir);
  start(['server.js'], serverEnv(port, dir));
}
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

async function signIn(base) {
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  return login.headers.get('set-cookie').split(';')[0];
}

try {
  for (const port of Object.values(PORTS)) await up(`http://127.0.0.1:${port}/health`);
  await up(`http://127.0.0.1:${OR_PORT}/calls`); await up(`http://127.0.0.1:${SPINE_PORT}/api/health`);
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const context = async (base, viewport, isMobile) => {
    const cookie = await signIn(base);
    const [cname, cvalue] = cookie.split('=');
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(/\b(maps?|mapped|met|touch(es|ed)?|spots?|demand|satellite|streak)\b/gi);
      if (hits) page.jargon.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    const api = async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    };
    return { ctx, page, api };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `today-${name}-${theme}.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const base = `http://127.0.0.1:${PORTS[name]}`;
    const { ctx, page, api } = await context(base, viewport, mobile);
    const kind = () => page.locator('#item').getAttribute('data-kind');
    const place = () => page.locator('#place-text').innerText();
    const next = async () => { await page.locator('#next').click(); await page.locator('#flash').waitFor({ state: 'hidden' }); };

    // the navigation: "Today" beside "Look up" on every page
    if (!mobile) {
      const navs = {};
      for (const p of ['/', '/desk', '/phone', '/lookup']) {
        await page.goto(base + p);
        navs[p] = await page.locator('.topbar nav a').evaluateAll((as) => as.map((a) => `${a.textContent}=${a.getAttribute('href')}`).join(' '));
      }
      check('desktop: "Today" is in the top navigation beside "Look up" on the articles page, the desk, the phone page and the Look up page',
        Object.values(navs).every((n) => /Look up=\/lookup Today=\/today( Walks=\/walks( Study=\/study)?)?$/.test(n)), JSON.stringify(navs));
    }

    // --- the first item: Give the form, from Guy's lesson --------------------------------
    await page.goto(`${base}/today`);
    await page.locator('#item:not(.hidden)').waitFor({ timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    check(`${name}: "Today" is marked in the navigation; the place line reads "1 of 10"`,
      (await page.locator('.topbar nav a.active').innerText()) === 'Today' && (await place()) === '1 of 10', await place());
    const first = { kind: await kind(), title: await page.locator('#kind').textContent(), sentence: await page.locator('#sentence').innerText(), gaps: await page.locator('#sentence .gap').count(), hint: await page.locator('#hint').innerText(), source: await page.locator('#source').innerText() };
    check(`${name}: the first item is "Give the form": the lesson's sentence with the verb blanked, root and binyan under it, the source "From Guy's lesson …"`,
      first.kind === 'form' && first.title === 'Give the form' && first.sentence.includes('לדחות את ההצבעה') && first.gaps === 1
      && first.hint.includes('א.ל.צ') && first.hint.includes("Nif'al") && first.source.startsWith("From Guy's lesson "), JSON.stringify(first));
    check(`${name}: the source line is muted, and legible`, (await paint(page.locator('#source'), 'color')) === (await paint(page.locator('#translation'), 'color'))
      && contrast(await paint(page.locator('#source'), 'color'), await ground(page.locator('#source'))) >= 4.5);
    const box = await page.locator('#answer-zone').boundingBox();
    check(`${name}: the answer box and Check/Show sit low on the screen, where the thumb rests${mobile ? '' : ' (the same page, wider)'}`,
      !mobile || box.y > viewport.height * 0.5, JSON.stringify(box));
    check(`${name}: no sideways scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await both(page, `form-${name}`);

    // a wrong answer: the flash names the word and the result, with Undo
    await page.fill('#answer', 'נאלץ');
    await page.locator('#check').click();
    await page.locator('#flash:not(.hidden)').waitFor({ timeout: 8000 });
    const flashWrong = await page.locator('#flash-text').innerText();
    check(`${name}: a wrong form: the flash names the word with its niqud, "נֶאֶלְצָה — wrong; next due tomorrow", with Undo and Next under it`,
      flashWrong === 'נֶאֶלְצָה — wrong; next due tomorrow' && (await page.locator('#undo').isVisible()) && (await page.locator('#next').isVisible()), flashWrong);
    check(`${name}: …while the question itself stays without niqud`, !/[ְ-ׇ]/.test(await page.locator('#sentence').innerText().then((t) => t.replace(/נֶאֶלְצָה/, ''))));
    const bidi = await page.locator('#flash-text').evaluate((t) => { const b = t.querySelector('bdi'); return b ? Math.round(b.getBoundingClientRect().left - t.getBoundingClientRect().left) : null; });
    check(`${name}: the flash reads left to right: the Hebrew word first, then "— wrong; …"`, bidi === 0, String(bidi));
    check(`${name}: the flash is legible`, contrast(await paint(page.locator('#flash-text'), 'color'), await ground(page.locator('#flash'))) >= 4.5);
    const spot = (await api('GET', `/spots/${encodeURIComponent('v:א.ל.צ:nifal')}`)).body;
    const tokyo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + 86400000));
    check(`${name}: …and the word is due tomorrow (Tokyo), interval 1, run 0, shaky`, spot.due_on === tokyo && spot.interval_days === 1 && spot.right_run === 0 && spot.status === 'shaky', JSON.stringify(spot));
    await both(page, `wrong-${name}`);
    await page.locator('#undo').click();
    await page.locator('#flash-text', { hasText: 'undone' }).waitFor({ timeout: 8000 });
    const back = (await api('GET', `/spots/${encodeURIComponent('v:א.ל.צ:nifal')}`)).body;
    check(`${name}: Undo: the flash says "נֶאֶלְצָה — undone", the item can be answered again, and the word is as it was`,
      (await page.locator('#flash-text').innerText()) === 'נֶאֶלְצָה — undone' && (await page.locator('#typed').isVisible()) && back.due_on === null && back.interval_days === 0 && back.status === 'shaky', JSON.stringify(back));
    await page.fill('#answer', 'נאלצה');
    await page.locator('#check').click();
    await page.locator('#flash[data-result="right"]').waitFor({ timeout: 8000 });
    check(`${name}: a right form: the gap filled with the word's niqud (נֶאֶלְצָה), the flash "נֶאֶלְצָה — right; next due tomorrow", the word's card under it`,
      (await page.locator('#flash-text').innerText()) === 'נֶאֶלְצָה — right; next due tomorrow' && (await page.locator('#sentence .gap.right').innerText()) === 'נֶאֶלְצָה'
      && (await page.locator('#card-today:not(.idle)').count()) === 1, await page.locator('#flash-text').innerText());
    await both(page, `right-${name}`);
    await next();

    // a made-up sentence; Show, then Dan's own tap
    check(`${name}: a verb no read sentence holds: "a made-up sentence"; "2 of 10"`, (await kind()) === 'form' && /a made-up sentence/.test(await page.locator('#hint').innerText()) && (await place()) === '2 of 10');
    await page.locator('#show').click();
    await page.locator('#self:not(.hidden)').waitFor({ timeout: 8000 });
    check(`${name}: Show reveals the form and offers "I had it" / "I missed it" side by side`,
      (await page.locator('#sentence .gap.shown').innerText()) === 'ייקבעו' /* its card has no niqud: plain */ && (await page.locator('#had').innerText()) === 'I had it' && (await page.locator('#missed').innerText()) === 'I missed it');
    await page.locator('#had').click();
    await page.locator('#flash:not(.hidden)').waitFor();
    await next();

    // Which preposition
    check(`${name}: "Which preposition": the sentence with עם blanked, three choices`,
      (await kind()) === 'preposition' && (await page.locator('#sentence').innerText()).includes('להתמודד') && (await page.locator('#choices .choice').count()) === 3);
    await both(page, `preposition-${name}`);
    await page.locator('#choices .choice', { hasText: /^עם$/ }).click();
    await page.locator('#flash[data-result="right"]').waitFor();
    check(`${name}: the right preposition turns green (the choices stay without niqud), and fills the gap with it: עִם`,
      (await page.locator('#choices .choice.right').innerText()) === 'עם' && (await page.locator('#sentence .gap.right').innerText()) === 'עִם');
    await next();

    // Which spelling
    check(`${name}: "Which spelling": the meaning, a sentence with the word blanked ("a made-up sentence"), and two spellings to choose`, (await kind()) === 'spelling' && (await page.locator('#choices .choice').count()) === 2 && (await page.locator('#translation').innerText()) === 'to be ashamed'
      && (await page.locator('#sentence .gap').count()) === 1 && (await page.locator('#hint').innerText()) === 'a made-up sentence');
    const twoRow = await page.locator('#choices .choice').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)));
    check(`${name}: …${mobile ? 'one under the other, at phone width' : 'side by side, on one row'}`, mobile ? twoRow[1] > twoRow[0] : twoRow[0] === twoRow[1], JSON.stringify(twoRow));
    await both(page, `spelling-${name}`);
    await page.locator('#choices .choice', { hasText: /^לתהבייש$/ }).click();
    await page.locator('#flash[data-result="wrong"]').waitFor();
    const spellGap = await page.locator('#sentence .gap.shown').innerText();
    check(`${name}: a wrong spelling: the gap shows the right one, the word itself (its card points only the dictionary form הִתְבַּיֵּשׁ, another form: so plain); the choices stay plain`,
      spellGap === 'להתבייש' && !(await page.locator('#choices').innerText()).match(/[ְ-ׇ]/), spellGap);
    await next();

    // Do you know it
    check(`${name}: "Do you know it": the word, and Show`, (await kind()) === 'know' && (await page.locator('#sentence mark').innerText()) === 'רפורמה' && (await page.locator('#reveal-show').isVisible()));
    await both(page, `know-${name}`);
    await page.locator('#reveal-show').click();
    await page.locator('#card-today:not(.idle) .meaning').waitFor();
    check(`${name}: Show opens the word's card (its meaning) and the two taps`, (await page.locator('#card-today .meaning').innerText()) === 'a reform' && (await page.locator('#self').isVisible()));
    await both(page, `know-shown-${name}`);
    await page.locator('#missed').click();
    await page.locator('#flash:not(.hidden)').waitFor();
    await next();

    // "Too easy" on a word item (the next is הסלמה, Do you know it)
    check(`${name}: a word item offers a small "Too easy"`, (await kind()) === 'know' && (await page.locator('#easy').isVisible()) && (await page.locator('#easy').innerText()) === 'Too easy');
    await page.locator('#easy').click();
    await page.locator('#flash:not(.hidden)').waitFor();
    const easyFlash = await page.locator('#flash-text').innerText();
    check(`${name}: "Too easy": the flash says "הסלמה — too easy; marked solid", with Undo; "Too easy" is gone`,
      easyFlash === 'הסלמה — too easy; marked solid' && (await page.locator('#undo').isVisible()) && (await page.locator('#easy').isHidden()), easyFlash);
    await both(page, `too-easy-${name}`);
    await next();

    // the rest of the words, quickly
    for (let guard = 0; guard < 4 && (await kind()) !== 'passage'; guard++) {
      const k = await kind();
      if (k === 'know') { await page.locator('#reveal-show').click(); await page.locator('#self:not(.hidden)').waitFor(); await page.locator('#had').click(); }
      else if (k === 'form') { await page.locator('#show').click(); await page.locator('#self:not(.hidden)').waitFor(); await page.locator('#had').click(); }
      else await page.locator('#choices .choice').first().click();
      await page.locator('#flash:not(.hidden)').waitFor();
      await next();
    }

    // a fresh passage, its verb blanked: Dan's words tinted, the new word light blue and tappable
    check(`${name}: a fresh passage: "9 of 10", the source names it, Dan's words tinted, one new word light blue`,
      (await kind()) === 'passage' && (await place()) === '9 of 10' && /^A fresh passage: /.test(await page.locator('#source').innerText())
      && (await page.locator('#sentence .w.shaky').count()) >= 3 && (await page.locator('#sentence .w.new').innerText()) === 'המכרז');
    await both(page, `passage-${name}`);
    await page.locator('#sentence .w.new').click();
    await page.locator('#card-today:not(.idle) .meaning').waitFor({ timeout: 8000 });
    check(`${name}: tapping the new word opens its card, which can be saved`, (await page.locator('#card-today [data-act=shaky]').isVisible()));
    await page.fill('#answer', await page.evaluate(() => window.Today.view.items[window.Today.at].question.answer));
    await page.locator('#check').click();
    await page.locator('#flash[data-result="right"]').waitFor();
    await page.locator('#english-show').click();
    check(`${name}: after the answer, "Show the English" shows the passage in English`, /The government decided/.test(await page.locator('#english').innerText()));
    await next();

    // a comprehension question
    check(`${name}: the second passage asks a question in Hebrew with three choices`, (await kind()) === 'passage' && (await page.locator('#question').innerText()) === 'על מה מדובר בקטע?' && (await page.locator('#choices .choice').count()) === 3);
    // hebrew-today-two: the choices' layout. Each choice's text (the box its
    // letters fill, measured with a Range) must lie inside its own button; at
    // phone width the three stand one under another, full width.
    const boxes = await page.locator('#choices .choice').evaluateAll((bs) => bs.map((b) => {
      const r = document.createRange(); r.selectNodeContents(b);
      const t = r.getBoundingClientRect(), o = b.getBoundingClientRect();
      return { text: b.textContent, inside: t.left >= o.left - 1 && t.right <= o.right + 1 && t.top >= o.top - 1 && t.bottom <= o.bottom + 1, left: Math.round(o.left), top: Math.round(o.top), width: Math.round(o.width) };
    }));
    const zone = await page.locator('#choices').boundingBox();
    check(`${name}: the passage question's choices, the long third one included ("${boxes[2] && boxes[2].text}"): every choice's text inside its own button`,
      boxes.length === 3 && boxes[2].text.length > 30 && boxes.every((b) => b.inside), JSON.stringify(boxes));
    check(`${name}: …${mobile ? 'stacked one under another, each the full width' : 'on one row, each button growing with its text'}`,
      mobile ? boxes.every((b, i) => (i === 0 || b.top > boxes[i - 1].top) && Math.abs(b.width - zone.width) <= 1)
        : boxes.every((b) => b.top === boxes[0].top), JSON.stringify([boxes, zone]));
    await both(page, `passage-question-${name}`);
    await page.locator('#choices .choice').first().click();
    await page.locator('#flash:not(.hidden)').waitFor();
    await page.locator('#next').click();

    // done for today
    await page.locator('#done:not(.hidden)').waitFor();
    const rows = await page.locator('#done-list li').count();
    const firstRow = await page.locator('#done-list li .he').first().innerText();
    check(`${name}: the day's list shows the words with niqud where their cards have it (נֶאֶלְצָה)`, firstRow === 'נֶאֶלְצָה', firstRow);
    check(`${name}: …and a word tapped "Too easy" as too easy`, (await page.locator('#done-list li').nth(5).locator('.res').innerText()) === 'too easy');
    check(`${name}: "Done" and the set's ten items with their results; "10 of 10"`, rows === 10 && (await page.locator('#done h2').textContent()) === 'Done' && (await place()) === '10 of 10', String(rows));
    // hebrew-today-two: "Another set", a large button under the list
    const listBox = await page.locator('#done-list').boundingBox();
    const anotherBox = await page.locator('#another').boundingBox();
    const doneBox = await page.locator('#done').boundingBox();
    check(`${name}: the "Done" screen has a large "Another set" button under the results list, the panel's width${mobile ? ', within the first screen, where the thumb reaches' : ''}`,
      (await page.locator('#another').innerText()) === 'Another set' && anotherBox.y >= listBox.y + listBox.height && anotherBox.height >= 52 && anotherBox.width >= doneBox.width - 40
      && (!mobile || anotherBox.y + anotherBox.height <= viewport.height), JSON.stringify([listBox, anotherBox, doneBox]));
    check(`${name}: …and nothing counts the sets: no number of sets on the screen`, !/\b(sets? (done|today)|\d+ sets?)\b/i.test(await page.locator('main').innerText()));
    await both(page, `done-${name}`);
    await page.reload();
    await page.locator('#done:not(.hidden)').waitFor();
    check(`${name}: a reload keeps it done: answered items do not come back`, (await page.locator('#done-list li').count()) === 10);
    // the tap: "Building…" while the set is made (held back a moment here, so
    // it can be seen), a second tap meanwhile makes nothing, then item 1
    const seqBefore = await page.evaluate(() => window.Today.view.set.seq);
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/today/another', async (route) => { await held; await route.continue(); });
    await page.locator('#another').click();
    await page.locator('#another', { hasText: 'Building…' }).waitFor({ timeout: 4000 });
    const building = { text: await page.locator('#another').innerText(), disabled: await page.locator('#another').isDisabled() };
    await page.locator('#another').click({ force: true }).catch(() => {});
    check(`${name}: while it builds the button says "Building…" and is disabled`, building.text === 'Building…' && building.disabled, JSON.stringify(building));
    await both(page, `building-${name}`);
    release();
    await page.locator('#item:not(.hidden)').waitFor({ timeout: 15000 });
    await page.unroute('**/today/another');
    const opened = await page.evaluate(() => ({ seq: window.Today.view.set.seq, position: window.Today.view.position }));
    check(`${name}: "Another set" opens a new set at item 1: "1 of 10", the next number, one set made for the two taps`,
      (await place()) === '1 of 10' && opened.position === 0 && opened.seq === seqBefore + 1, JSON.stringify([await place(), opened, seqBefore]));
    const noteText = await page.locator('#note').innerText();
    check(`${name}: …its note says plainly that it draws on words not yet due`, noteText.startsWith('Nothing more is due; this set draws on words not yet due.'), noteText);
    await both(page, `another-${name}`);
    const served = (await api('GET', '/today/set')).body;
    check(`${name}: …and the server serves that set on a reload`, served.set.seq === opened.seq && served.position === 0);
    check(`${name}: no screen of this page shows the app's own words ("map", "spot", "touch", "demand") or a streak`, page.jargon.length === 0, page.jargon.join(' | '));
    await ctx.close();
  }

  // nothing due: a set is not made, and the page says so plainly
  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(`http://127.0.0.1:${PORTS.empty}`, viewport, mobile);
    await page.goto(`http://127.0.0.1:${PORTS.empty}/today`);
    await page.locator('#state', { hasText: 'Nothing is due today' }).waitFor({ timeout: 8000 });
    check(`${name}: nothing due: "Nothing is due today", no item and no place line`, (await page.locator('#item').isHidden()) && (await page.locator('#place').isHidden()));
    await both(page, `nothing-${name}`);
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} today page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} today page checks passed`);
