// Page checks for hebrew-save-one: the forgiving card and "Save it" on the
// Look up page — a card marked "Likely" with its other readings, "A best
// guess", a slang card, a misspelling read as the word meant, a refused word
// with "Did you mean", a phrase with its meaning, a phrase whose meaning was
// refused, a failed single word, the note box open, after "Save it", and a
// word of a phrase looked up with the phrase folded — and the same card's
// new lines on the reader's word card; at phone (390×844) and computer
// (1280×800) size, light and dark, against the local stand-ins for
// OpenRouter, the spine and the reference sites. Each pressed control, or
// what took its place, is measured against where it was before the press,
// and the numbers printed. Screenshots into docs/screenshots/save-*.png. Run
// by `npm run screenshots`, or alone:
//   node scripts/save-pages.mjs
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

const PORT = 8870, OR_PORT = 8871, SPINE_PORT = 8872, REF_PORT = 8873;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-save-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 's'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };
const measured = [];
const measure = (line) => { console.log(`     ${line}`); measured.push(line); };

let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const modelCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json());

// words Dan should never see on these screens (rule 7), and the reader's inside words
const NEVER = /\b(fragment|surface form|card could not be built|422|note card|unknown word|in this mock|maps?|mapped|met|touch(es|ed)?|spots?)\b/gi;

try {
  await up(`${base}/health`); await up(`${standin}/calls`); await up(`http://127.0.0.1:${OR_PORT}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const [cname, cvalue] = cookie.split('=');
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    await ctx.route(/^https?:\/\/(?!fonts\.)[^/]*\.(co\.il|com|org|org\.il)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>live site</p>' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.lookups = [];
    page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/lookup') page.lookups.push(JSON.parse(r.postData() || '{}').surface); });
    page.never = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(NEVER);
      if (hits) page.never.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `save-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const topOf = (locator) => locator.evaluate((e) => e.getBoundingClientRect().top);
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const lookUp = async (page, text) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.fill('#word', text);
    await page.press('#word', 'Enter');
  };
  const cardShown = (page) => page.locator('#card-lookup:not(.idle) .meaning:not(:empty)').waitFor({ timeout: 8000 });

  for (const [size, viewport, mobile] of [['computer', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    const card = page.locator('#card-lookup');
    // each size saves its own word and phrase, so each shows a fresh save
    // (the same text kept twice the same day is one card: scripts/save-smoke.mjs)
    const FW = mobile ? 'זזזז' : 'תירלול';
    const P = mobile ? { text: 'בית ספר', meaning: 'a school' } : { text: 'דו או פרד', meaning: 'do or die; now or never' };
    await page.goto(`${base}/lookup`);
    await page.evaluate(() => document.fonts.ready);

    // --- אלפית: "Likely", with its other readings as buttons ------------------------------
    await lookUp(page, 'אלפית');
    await cardShown(page);
    check(`${size}: אלפית shows its reading, marked "Likely", and "Other readings" under the meaning: two words, each a button`,
      (await card.locator('.meaning .qualify').innerText()) === 'Likely' && /a thousandth/.test(await card.locator('.meaning').innerText())
      && (await card.locator('.readings-title').innerText()) === 'Other readings' && (await card.locator('.readings button.reading').count()) === 2
      && /אֲלוּפִית/.test(await card.locator('.readings').innerText()), await card.innerText());
    check(`${size}: the page is no wider than the screen`, await fits(page));
    await card.scrollIntoViewIfNeeded();
    await both(page, `likely-${size}`);
    const n0 = page.lookups.length;
    await card.locator('.readings button.reading').first().click();
    await page.locator('#card-lookup .error:not(:empty), #card-lookup:not(.idle) .meaning:not(:empty)').first().waitFor({ timeout: 8000 });
    check(`${size}: an other reading tapped looks that word up (אלופית)`, page.lookups.length === n0 + 1 && page.lookups.at(-1) === 'אלופית' && (await page.locator('#word').inputValue()) === 'אלופית', JSON.stringify(page.lookups.slice(n0)));

    // --- חרצובות: "A best guess" ---------------------------------------------------------------
    await lookUp(page, 'חרצובות');
    await cardShown(page);
    check(`${size}: a rare word (חרצובות) is answered, marked "A best guess", labelled literary`,
      (await card.locator('.meaning .qualify').innerText()) === 'A best guess' && (await card.locator('.meaning .register').innerText()) === 'literary');
    await card.scrollIntoViewIfNeeded();
    await both(page, `guess-${size}`);

    // --- סבבה: slang ------------------------------------------------------------------------------
    await lookUp(page, 'סבבה');
    await cardShown(page);
    check(`${size}: סבבה is a card labelled "slang", no "Likely" or "A best guess" (the model was sure)`,
      (await card.locator('.meaning .register').innerText()) === 'slang' && (await card.locator('.meaning .qualify').count()) === 0 && /fine, great, cool/.test(await card.locator('.meaning').innerText()));
    await card.scrollIntoViewIfNeeded();
    await both(page, `slang-${size}`);

    // --- טלפום: the word meant ---------------------------------------------------------------------
    await lookUp(page, 'טלפום');
    await cardShown(page);
    check(`${size}: a misspelling (טלפום) shows the card of טלפון with "You typed טלפום"`,
      (await card.locator('.typed').innerText()) === 'You typed טלפום' && (await card.locator('.surface .pointed').innerText()) === 'טֶלֶפוֹן' && (await card.locator('.meaning').innerText()).startsWith('a telephone'));
    await card.scrollIntoViewIfNeeded();
    await both(page, `corrected-${size}`);

    // --- תירלול: no card, "Did you mean", "Save it" ------------------------------------------------
    for (let i = 0; i < 3; i++) {
      await lookUp(page, 'תירלול');
      await page.locator('#refused:not(.hidden) .dym-word').first().waitFor({ timeout: 8000 });
      if (i === 0) {
        const entry = await page.locator('#entry').innerText();
        check(`${size}: a refused word shows "No card for this word", then "Did you mean" with three words, then "Save it" and "Add a note"; never the refusal itself`,
          (await card.locator('.error').innerText()) === 'No card for this word' && (await page.locator('#dym-title').innerText()) === 'Did you mean' && (await page.locator('.dym-word').count()) === 3
          && (await page.locator('#word-keep .keep-save').innerText()) === 'Save it' && (await page.locator('#word-keep .keep-open').innerText()) === 'Add a note'
          && !/could not be built|no Hebrew word|422/i.test(entry), entry);
        check(`${size}: the suggestion buttons are at least 44 px high`, (await page.locator('.dym-word').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height))).every((h) => h >= 44));
        await page.locator('#refused').scrollIntoViewIfNeeded();
        await both(page, `refused-${size}`);
      }
      const want = ['תרגול', 'תלתול', 'טרלול'][i];
      const n1 = page.lookups.length;
      await page.locator('.dym-word').nth(i).click();
      await page.waitForFunction((n) => document.querySelector('#card-lookup .status')?.textContent !== 'looking up…', null, { timeout: 8000 });
      await page.waitForTimeout(150);
      check(`${size}: "Did you mean" ${want} runs the ordinary look-up of ${want}`, page.lookups.length === n1 + 1 && page.lookups.at(-1) === want, JSON.stringify(page.lookups.slice(n1)));
    }

    // a failed single word kept: "Save it" in place, measured
    const deskBefore = (await api('GET', '/desks/current')).body;
    await lookUp(page, FW);
    await page.locator('#word-keep .keep-save').waitFor({ timeout: 8000 });
    await page.locator('#word-keep').scrollIntoViewIfNeeded();
    await both(page, `failed-word-${size}`);
    const saveTop = await topOf(page.locator('#word-keep .keep-save'));
    await page.locator('#word-keep .keep-save').click();
    await page.locator('#word-keep .keep-done').waitFor({ timeout: 8000 });
    const doneTop = await topOf(page.locator('#word-keep .keep-done'));
    measure(`${size}: failed word: "Save it" top ${saveTop} px before the press, "Saved to Looked up" ${doneTop} px after (${Math.abs(doneTop - saveTop)} px)`);
    check(`${size}: after "Save it" on a word with no card, "Saved to Looked up" stands where the button was (0 px: ${saveTop} / ${doneTop})`,
      Math.abs(doneTop - saveTop) < 0.5 && (await page.locator('#word-keep .keep-done').innerText()).startsWith('Saved to Looked up'));
    await page.locator('#looked-list li').first().locator('.he', { hasText: FW }).waitFor({ timeout: 8000 });
    const deskAfter = (await api('GET', '/desks/current')).body;
    const keptWord = deskAfter.cards.find((c) => c.kind === 'note' && c.text === FW);
    check(`${size}: …kept as one note on the desk worked on last, not yet placed, first in "Looked up" with its tick box`,
      keptWord && keptWord.place.x === null && deskAfter.desk.id === deskBefore.desk.id && (await page.locator('#looked-list li').first().locator('input[type=checkbox]').count()) === 1);

    // --- a phrase with its meaning (דו או פרד; בית ספר on the phone) ------------------------------
    const calls0 = (await modelCalls()).phrase_calls;
    await lookUp(page, P.text);
    await page.locator('#phrase:not(.hidden) #ph-text').waitFor({ timeout: 8000 });
    const phraseText = await page.locator('#phrase').innerText();
    check(`${size}: a phrase (${P.text}) shows itself large, right to left; "What it means" with the meaning, the word-for-word sense and the note; the model's line; "Look up each word", a button per word; "Save it"`,
      (await page.locator('#ph-text').innerText()) === P.text && (await page.locator('#ph-text').evaluate((e) => getComputedStyle(e).direction)) === 'rtl'
      && (await page.locator('#ph-meaning').innerText()) === P.meaning && /^Word for word: /.test(await page.locator('#ph-literal').innerText())
      && (await page.locator('#ph-source').innerText()) === 'Meaning from the model; no dictionary was asked'
      && (await page.locator('#ph-words .ph-word').allInnerTexts()).join(' ') === P.text && (await page.locator('#ph-keep .keep-save').isVisible())
      && (await page.locator('#entry').isHidden()), phraseText);
    check(`${size}: the phrase is drawn large, in the app's serif (at least 28 px)`,
      await page.locator('#ph-text').evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 28 && /Frank Ruhl Libre/.test(getComputedStyle(e).fontFamily)));
    check(`${size}: the phrase's word buttons are at least 44 px square`, (await page.locator('.ph-word').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()))).every((r) => r.height >= 44 && r.width >= 44));
    check(`${size}: the page is no wider than the screen with the phrase shown`, await fits(page));
    await page.locator('#phrase').scrollIntoViewIfNeeded();
    await both(page, `phrase-${size}`);
    // the note box opens in the button's own place
    const openTop = await topOf(page.locator('#ph-keep .keep-open'));
    await page.locator('#ph-keep .keep-open').click();
    const noteTop = await topOf(page.locator('#ph-keep .keep-note'));
    measure(`${size}: "Add a note" top ${openTop} px before the press, the note box ${noteTop} px after (${Math.abs(noteTop - openTop)} px)`);
    check(`${size}: "Add a note" opens a one-line box where the button was (0 px: ${openTop} / ${noteTop}), focused`,
      Math.abs(noteTop - openTop) < 0.5 && (await page.locator('#ph-keep .keep-note').evaluate((e) => e === document.activeElement)));
    await page.locator('#ph-keep .keep-note').fill('heard on the radio');
    await both(page, `note-open-${size}`);
    // nothing saved before the tap
    check(`${size}: …and nothing is saved before "Save it": no note of the phrase on the desk, none in "Looked up"`,
      !(await api('GET', '/desks/current')).body.cards.some((c) => c.kind === 'note' && c.text.startsWith(P.text)) && !(await api('GET', '/lookups')).body.items.some((i) => i.surface === P.text));
    const keepTop = await topOf(page.locator('#ph-keep .keep-save'));
    await page.locator('#ph-keep .keep-save').click();
    await page.locator('#ph-keep .keep-done').waitFor({ timeout: 8000 });
    const keptTop = await topOf(page.locator('#ph-keep .keep-done'));
    measure(`${size}: phrase: "Save it" top ${keepTop} px before the press, "Saved to Looked up" ${keptTop} px after (${Math.abs(keptTop - keepTop)} px)`);
    check(`${size}: after "Save it", "Saved to Looked up" stands where the button was (0 px: ${keepTop} / ${keptTop})`, Math.abs(keptTop - keepTop) < 0.5);
    await page.locator('#looked-list li').first().locator('.he', { hasText: P.text }).waitFor({ timeout: 8000 });
    const firstRow = page.locator('#looked-list li').first();
    check(`${size}: the kept phrase is first in "Looked up", its meaning and note beside it, with its tick box`,
      (await firstRow.locator('.gloss').innerText()) === `${P.meaning} · heard on the radio` && (await firstRow.locator('input[type=checkbox]').count()) === 1, await firstRow.innerText());
    await both(page, `saved-${size}`);
    // "Put on a desk" with it ticked, on a desk made since
    const fresh = (await api('POST', '/desks')).body.desk;
    await firstRow.locator('input[type=checkbox]').check();
    await page.locator('#put').click();
    await page.locator('#put-msg a').first().waitFor({ timeout: 8000 });
    const onFresh = (await api('GET', `/desks/${fresh.id}`)).body.cards.find((c) => c.kind === 'note' && c.text.startsWith(`${P.text}\n`));
    check(`${size}: the kept phrase ticked goes on the desk with "Put on a desk", not yet placed`,
      /^1 card put on tonight's desk/.test(await page.locator('#put-msg').innerText()) && onFresh && onFresh.place.x === null, await page.locator('#put-msg').innerText());
    // the same phrase again: its meaning kept, no model call
    await lookUp(page, P.text);
    await page.locator('#phrase:not(.hidden) #ph-meaning').waitFor({ timeout: 8000 });
    check(`${size}: the same phrase looked up again asks the model nothing`, (await modelCalls()).phrase_calls === calls0 + (size === 'computer' ? 1 : 0), JSON.stringify({ calls0, now: (await modelCalls()).phrase_calls }));

    // --- a phrase whose meaning was refused -----------------------------------------------------
    await lookUp(page, 'קשקוש בלבוש');
    await page.locator('#phrase:not(.hidden) #ph-meaning.none').waitFor({ timeout: 8000 });
    check(`${size}: a phrase whose meaning was refused says "No meaning came back; you can still save it", with its words and "Save it", and no model line`,
      (await page.locator('#ph-meaning').innerText()) === 'No meaning came back; you can still save it' && (await page.locator('#ph-words .ph-word').count()) === 2
      && (await page.locator('#ph-keep .keep-save').isVisible()) && (await page.locator('#ph-source').isHidden()) && !/in this mock|no meaning for/i.test(await page.locator('#phrase').innerText()));
    await page.locator('#phrase').scrollIntoViewIfNeeded();
    await both(page, `phrase-no-meaning-${size}`);

    // --- mixed text: the Latin word shown as it is ------------------------------------------------
    await lookUp(page, 'לעשות check');
    await page.locator('#phrase:not(.hidden) .ph-latin').waitFor({ timeout: 8000 });
    check(`${size}: mixed text goes the phrase way: לעשות a button, "check" plain text with no button`,
      (await page.locator('#ph-words .ph-word').allInnerTexts()).join() === 'לעשות' && (await page.locator('#ph-words .ph-latin').innerText()) === 'check');

    // --- a word of the phrase looked up, the phrase folded ------------------------------------------
    await lookUp(page, 'בית ספר');
    await page.locator('#phrase:not(.hidden) #ph-meaning:not(.none)').waitFor({ timeout: 8000 });
    const wordBtn = page.locator('#ph-words .ph-word', { hasText: 'ספר' });
    await wordBtn.scrollIntoViewIfNeeded();
    const wordTop = await topOf(wordBtn);
    await wordBtn.click();
    await cardShown(page);
    const foldTop = await topOf(page.locator('#ph-fold'));
    measure(`${size}: the word ספר top ${wordTop} px before the press, the folded phrase ${foldTop} px after (${Math.abs(foldTop - wordTop)} px)`);
    check(`${size}: a word of the phrase tapped: the phrase folds to one line where the word was (0 px: ${wordTop} / ${foldTop}), "Back to the phrase", the word's card under it`,
      Math.abs(foldTop - wordTop) < 0.5 && /בית ספר · Back to the phrase/.test(await page.locator('#ph-fold').innerText()) && (await card.locator('.meaning').innerText()).startsWith('a book')
      && (await card.locator('.readings button.reading').count()) === 3);
    check(`${size}: the page is no wider than the screen with the phrase folded`, await fits(page));
    await both(page, `phrase-word-${size}`);
    const backTop = await topOf(page.locator('#ph-fold'));
    await page.locator('#ph-fold').click();
    const againTop = await topOf(wordBtn);
    measure(`${size}: "Back to the phrase" top ${backTop} px before the press, the word ספר ${againTop} px after (${Math.abs(againTop - backTop)} px)`);
    check(`${size}: "Back to the phrase" unfolds it with the tapped word where the line was (0 px: ${backTop} / ${againTop})`, Math.abs(againTop - backTop) < 0.5);

    check(`${size}: no screen shows "fragment", "surface form", "card could not be built", "422", "note card" or the reader's inside words`, page.never.length === 0, page.never.join(' | '));
    await ctx.close();
  }

  // --- the reader's word card: the same lines, other readings as plain lines ----------------------
  const article = (await api('POST', '/articles', { text: 'מילים חדשות\nסבבה אמר השר. המדד עלה אלפית אחת השבוע. הוא שכח טלפום בבית.' })).body;
  for (const [size, viewport, mobile] of [['computer', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    await page.goto(`${base}/read.html?id=${article.id}`);
    await page.waitForSelector('.body .w');
    const rcard = page.locator(mobile ? '#card-phone' : '#card-desktop');
    const open = async (w) => {
      if (mobile) await page.locator('#card-phone .close').click().catch(() => {});
      const word = page.locator('.body .w', { hasText: w }).first();
      await word.scrollIntoViewIfNeeded();
      if (mobile) await word.tap(); else { await word.click(); }
      await rcard.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
      await page.waitForFunction(([sel, t]) => (document.querySelector(`${sel} .surface`)?.textContent || '').length > 0 && !/looking up/.test(document.querySelector(`${sel} .status`)?.textContent || '') && (document.querySelector(`${sel} .meaning`)?.textContent || '').includes(t), [mobile ? '#card-phone' : '#card-desktop', w === 'אלפית' ? 'thousandth' : w === 'סבבה' ? 'cool' : 'telephone'], { timeout: 10000 });
    };
    await open('אלפית');
    check(`reader ${size}: the reader's card for אלפית says "Likely" and lists "Other readings" as plain lines, not buttons`,
      (await rcard.locator('.meaning .qualify').innerText()) === 'Likely' && (await rcard.locator('.readings li').count()) === 2 && (await rcard.locator('.readings button').count()) === 0);
    await both(page, `reader-card-${size}`);
    await open('סבבה');
    check(`reader ${size}: the reader's card for סבבה is labelled "slang"`, (await rcard.locator('.meaning .register').innerText()) === 'slang');
    await open('טלפום');
    check(`reader ${size}: the reader's card for טלפום says "You typed טלפום"`, (await rcard.locator('.typed').innerText()) === 'You typed טלפום');
    check(`reader ${size}: no screen shows the words Dan should not see`, page.never.length === 0, page.never.join(' | '));
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
for (const line of measured) console.log(`measured: ${line}`);
if (failed) { console.log(`\n${failed} save page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} save page checks passed`);
