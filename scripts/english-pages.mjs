// Page checks for hebrew-english-one: an English word on the Look up page —
// "Hebrew words for <text>" in its groups, a Hebrew word tapped (its card,
// saved, the list folded above it to one line) and "Back to the list", each
// keeping Dan's place (the numbers printed), the source labels opening
// inside the page, the model's group under its own heading, and an English
// look-up in "Looked up" reopened with no request — at phone (390×844) and
// computer (1280×800) size, light and dark, against the local stand-ins
// for OpenRouter, the spine and the reference sites (Pealim's and
// Wiktionary's saved pages); screenshots into docs/screenshots/english-*.png.
// Run by `npm run screenshots`, or alone:
//   node scripts/english-pages.mjs
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

const PORT = 8915, OR_PORT = 8916, SPINE_PORT = 8917, REF_PORT = 8918;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-english-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'g'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `${mock}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); if (ok) passed++; else failed++; };
const nfc = (s) => String(s).normalize('NFC');

let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const asked = async () => ((await (await fetch(`${standin}/calls`)).json()).english_asked || []).length;
const modelCalls = async () => (await (await fetch(`${mock}/calls`)).json()).english_calls;

try {
  await up(`${base}/health`); await up(`${standin}/calls`); await up(`${mock}/calls`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  // Dan's own cards meaning "run", and the card a tap on לָרוּץ makes
  await fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify({ extra_cards: {
    'מרוץ': { surface: 'מרוץ', lemma: 'מרוץ', lemma_pointed: 'מֵרוֹץ', surface_pointed: 'מֵרוֹץ', pos: 'noun', root: 'ר.ו.ץ', binyan: null, tense: null, person_gender_number: 'ms', meaning_en: 'a race, a run', governs: null, categories: [], note: null },
    'ריצה': { surface: 'ריצה', lemma: 'ריצה', lemma_pointed: 'רִיצָה', surface_pointed: 'רִיצָה', pos: 'noun', root: 'ר.ו.ץ', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'running; a run', governs: null, categories: [], note: null },
    'לרוץ': { surface: 'לרוץ', lemma: 'רץ', lemma_pointed: 'רָץ', surface_pointed: 'לָרוּץ', pos: 'verb', root: 'ר.ו.ץ', binyan: 'paal', tense: 'infinitive', person_gender_number: null, meaning_en: 'to run', governs: null, categories: [], note: null },
  } }) });
  for (const w of ['מרוץ', 'ריצה']) await api('POST', '/lookup', { surface: w, sentence: '' });
  await api('POST', `/spots/${encodeURIComponent('w:מרוץ')}`, { status: 'shaky' });

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
    page.words = [];
    const shoot = page.screenshot.bind(page);
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      // rule 5: no word Dan should not see
      const hits = visible.match(/\b(query|queries|source|sources|API|candidates?|maps?|mapped|met|touch(es|ed)?|spots?|satellite)\b/gi);
      if (hits) page.words.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `english-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const topOf = (locator) => locator.evaluate((e) => e.getBoundingClientRect().top);
  const narrow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    const phone = name === 'phone';
    await page.goto(`${base}/lookup`);
    await page.evaluate(() => document.fonts.ready);
    check(`${name}: the box's hint reads "A Hebrew word, or an English one"`, (await page.locator('#word').getAttribute('placeholder')) === 'A Hebrew word, or an English one');

    // --- an English look-up with all groups: "run" ------------------------------------------
    await page.fill('#word', 'run');
    await page.press('#word', 'Enter');
    await page.locator('#english:not(.hidden) .en-group').first().waitFor({ timeout: 10000 });
    const heads = await page.locator('#en-groups .en-heading').allTextContents();
    check(`${name}: "Hebrew words for run", then Yours, From Pealim, From Wiktionary, in that order; no card`,
      (await page.locator('#english .en-title').textContent()) === 'Hebrew words for run' && heads.join('|') === 'Yours|From Pealim|From Wiktionary' && (await page.locator('#entry').isHidden()),
      JSON.stringify([await page.locator('#english .en-title').innerText(), heads.join('|'), await page.locator('#entry').isHidden()]));
    const pealimRows = page.locator('.en-pealim li.en-row');
    const larutz = page.locator('.en-pealim li.en-row').nth(1);
    check(`${name}: Pealim's rows, לָרוּץ second: pointed, right to left, in the pointed serif; its transliteration, "Verb – pa'al", "to run", and a Pealim label`,
      (await pealimRows.count()) === 10 && nfc(await larutz.locator('.en-word .he').innerText()) === nfc('לָרוּץ') && (await larutz.locator('.he').getAttribute('dir')) === 'rtl'
      && /Noto Serif Hebrew/.test(await larutz.locator('.he').evaluate((e) => getComputedStyle(e).fontFamily)) && (await larutz.locator('.en-translit').innerText()) === 'larutz'
      && (await larutz.locator('.en-pos').innerText()) === "Verb – pa'al" && (await larutz.locator('.en-meaning').innerText()) === 'to run' && (await larutz.locator('button.en-src').allTextContents()).join() === 'Pealim');
    // the phone round comes after the computer round tapped לָרוּץ: Dan's card רָץ ("to run") is his now
    const yoursRows = await page.locator('.en-yours li.en-row .en-word .he').allTextContents();
    const yourLabels = await page.locator('.en-yours li.en-row').evaluateAll((lis) => lis.map((li) => [...li.querySelectorAll('.en-src')].map((s) => s.textContent).join('+')));
    check(`${name}: Yours: Dan's ${phone ? 'רָץ (tapped on the computer, and Wiktionary\'s too), ' : ''}ריצה (with a Wiktionary label too) and מרוץ, newest first, each marked "Yours" and its status`,
      yoursRows.map(nfc).join() === nfc(phone ? 'רָץ,רִיצָה,מֵרוֹץ' : 'רִיצָה,מֵרוֹץ')
      && yourLabels.join('|') === (phone ? 'Yours · shaky+Wiktionary|Yours · new+Wiktionary|Yours · shaky' : 'Yours · new+Wiktionary|Yours · shaky'), JSON.stringify([yoursRows, yourLabels]));
    const senses = await page.locator('.en-wiktionary .en-sense').allTextContents();
    check(`${name}: Wiktionary's words under each sense's gloss${phone ? ' (רָץ now in Yours)' : ''}`,
      senses.join('|') === `${phone ? '' : 'to move quickly on two feet|'}to be in charge of|instance or period of fleeing`, senses.join('|'));
    const heights = await page.locator('.en-row .en-word').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    check(`${name}: every Hebrew word is a button at least 44 px high (${Math.min(...heights)}–${Math.max(...heights)} px)`, heights.every((h) => h >= 44), heights.join());
    check(`${name}: the page is no wider than the screen`, await narrow(page));
    await both(page, `all-groups-${name}`);

    // a source label: Pealim's entry as a copy inside the page, Wiktionary's page framed
    // (each element measured centred on the screen, where a finger can reach it)
    await larutz.locator('button.en-src.pealim').evaluate((b) => b.scrollIntoView({ block: 'center' }));
    const labelTop = await topOf(larutz.locator('button.en-src.pealim'));
    await larutz.locator('button.en-src.pealim').click();
    await page.locator('#en-pane[data-ref=pealim] iframe.copy').waitFor({ timeout: 8000 });
    const labelAfter = await topOf(larutz.locator('button.en-src.pealim'));
    check(`${name}: the Pealim label opens Pealim's entry inside the page, under its row, as a copy (as the Pealim tab), the label not moving (${labelTop.toFixed(1)} -> ${labelAfter.toFixed(1)} px)`,
      (await larutz.locator('#en-pane').count()) === 1 && /Shown from a copy/.test(await page.locator('#en-pane .ref-line').innerText()) && Math.abs(labelAfter - labelTop) < 0.5 && page.popups.length === 0);
    await larutz.locator('#en-pane').scrollIntoViewIfNeeded();
    await both(page, `pealim-label-${name}`);
    const wrow = page.locator('.en-wiktionary li.en-row').first();
    await wrow.locator('button.en-src.wiktionary').click();
    await page.locator('#en-pane[data-ref=wiktionary] iframe.ref-frame').waitFor({ timeout: 8000 });
    check(`${name}: the Wiktionary label frames its English page (run/translations) under its row`,
      (await wrow.locator('#en-pane').count()) === 1 && (await page.locator('#en-pane iframe').getAttribute('src')) === `${standin}/site/https/en.wiktionary.org/wiki/${encodeURIComponent('run/translations')}` && page.popups.length === 0);
    await page.locator('#en-pane .ref-close').click();

    // --- a Hebrew word tapped: its card, the list folded to one line in its place ----------------
    const btn = larutz.locator('.en-word');
    await btn.evaluate((b) => b.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const before = await topOf(btn);
    const spots0 = (await api('GET', '/lookups')).body.items.filter((i) => i.kind === 'word').length;
    await btn.click();
    await page.locator('#card-lookup:not(.idle) .surface .pointed').waitFor({ timeout: 8000 });
    const foldTop = await topOf(page.locator('#en-fold'));
    console.log(`     ${name}: tap — לָרוּץ's row at ${before.toFixed(1)} px, the folded line at ${foldTop.toFixed(1)} px: ${(foldTop - before).toFixed(1)} px`);
    check(`${name}: tapping לָרוּץ folds the list to one line, "Hebrew words for run · Back to the list", at the tapped row's height (${(foldTop - before).toFixed(1)} px)`,
      (await page.locator('#en-fold').innerText()) === 'Hebrew words for run · Back to the list' && (await page.locator('#en-list').isHidden()) && Math.abs(foldTop - before) < 0.5);
    check(`${name}: …and looks it up as a Hebrew word: its card (רָץ, "to run"), ${phone ? 'already in his words' : 'saved'}, its seven tabs, "Ask about this root"`,
      nfc(await page.locator('#card-lookup .surface .pointed').innerText()) === nfc('רָץ') && (await page.locator('#card-lookup .meaning').innerText()) === 'to run'
      && (await page.locator('#saved-line').innerText()) === (phone ? 'In your words.' : 'Saved to your words.') && (await page.locator('#tabs button.ref').count()) === 7 && (await page.locator('#card-lookup [data-act=ask]').isVisible()));
    const items = (await api('GET', '/lookups')).body.items;
    check(`${name}: exactly one word joined "Looked up" as a card (the tapped one)${phone ? ' — on the phone it was already there' : ''}`, items.filter((i) => i.kind === 'word').length === spots0 + (phone ? 0 : 1) && items.find((i) => i.kind === 'word').word === 'רץ');
    check(`${name}: the page is no wider than the screen with the card open`, await narrow(page));
    await both(page, `tapped-${name}`);

    // --- "Back to the list": the tapped row where the line was ------------------------------------
    const lineTop = await topOf(page.locator('#en-fold'));
    await page.locator('#en-fold').click();
    await page.waitForTimeout(50);
    const rowTop = await topOf(btn);
    console.log(`     ${name}: back — the folded line at ${lineTop.toFixed(1)} px, לָרוּץ's row at ${rowTop.toFixed(1)} px: ${(rowTop - lineTop).toFixed(1)} px`);
    check(`${name}: "Back to the list" unfolds the list with the tapped row at the line's height (${(rowTop - lineTop).toFixed(1)} px)`, (await page.locator('#en-list').isVisible()) && Math.abs(rowTop - lineTop) < 0.5);
    await both(page, `back-${name}`);

    // a row near the top (Yours) tapped with the page at its top: the line still takes its place
    await page.evaluate(() => window.scrollTo(0, 0));
    const ybtn = page.locator('.en-yours li.en-row').nth(1).locator('.en-word');
    const yBefore = await topOf(ybtn);
    await ybtn.click();
    await page.locator('#card-lookup:not(.idle) .meaning').waitFor({ timeout: 8000 });
    const yFold = await topOf(page.locator('#en-fold'));
    console.log(`     ${name}: tap from the top — מֵרוֹץ's row at ${yBefore.toFixed(1)} px, the folded line at ${yFold.toFixed(1)} px: ${(yFold - yBefore).toFixed(1)} px`);
    check(`${name}: tapping a word with the page at its top keeps the folded line at the row's height too (${(yFold - yBefore).toFixed(1)} px)`, Math.abs(yFold - yBefore) < 0.5);
    const yLine = await topOf(page.locator('#en-fold'));
    await page.locator('#en-fold').click();
    await page.waitForTimeout(50);
    const yRow = await topOf(ybtn);
    check(`${name}: …and back again, the row at the line's height (${(yRow - yLine).toFixed(1)} px)`, Math.abs(yRow - yLine) < 0.5);

    // --- only the model's group: "reliability" ------------------------------------------------
    const m0 = await modelCalls();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.fill('#word', 'reliability');
    await page.press('#word', 'Enter');
    await page.waitForFunction(() => document.querySelector('#en-text')?.textContent === 'reliability' && document.querySelector('.en-model'), null, { timeout: 10000 });
    const rheads = await page.locator('#en-groups .en-heading').allTextContents();
    check(`${name}: "reliability": Pealim and Wiktionary say they list no word; the model's words stand last under "Suggested by the model; no dictionary listed it"`,
      rheads.join('|') === 'From Pealim|From Wiktionary|Suggested by the model; no dictionary listed it' && (await page.locator('.en-pealim .en-note').innerText()) === 'Pealim lists no Hebrew word for “reliability”.'
      && (await page.locator('.en-model li.en-row .he').allTextContents()).map(nfc).join() === nfc('אֲמִינוּת,מְהֵימָנוּת') && (await page.locator('.en-model .en-src').count()) === 0
      && (await modelCalls()) === m0 + 1, JSON.stringify([rheads, await modelCalls(), m0]));
    check(`${name}: the page is no wider than the screen`, await narrow(page));
    await both(page, `model-only-${name}`);

    // --- "Looked up": the English look-up, reopened from its kept answer ----------------------------
    const n0 = await asked(), mm = await modelCalls();
    const runRow = page.locator('#looked-list li[data-key="english:run"]');
    await runRow.waitFor({ timeout: 5000 });
    check(`${name}: "Looked up" lists "run" with "15 Hebrew words" and its day, no tick`,
      (await runRow.locator('.en-text').innerText()) === 'run' && (await runRow.locator('.gloss').innerText()) === '15 Hebrew words' && /\d{4}$/.test(await runRow.locator('.meta').innerText()) && (await runRow.locator('input').count()) === 0, await runRow.innerText());
    await runRow.locator('.looked-word').click();
    await page.waitForFunction(() => document.querySelector('#en-text')?.textContent === 'run', null, { timeout: 5000 });
    check(`${name}: tapping it reopens "Hebrew words for run" from the kept answer, with no request to the stand-ins or the model`,
      (await page.locator('.en-pealim li.en-row').count()) === 10 && (await asked()) === n0 && (await modelCalls()) === mm && (await page.locator('#word').inputValue()) === 'run');
    await page.locator('#looked').scrollIntoViewIfNeeded();
    await both(page, `looked-up-${name}`);

    // a refusal says what the box takes
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.fill('#word', 'run to the hills');
    await page.press('#word', 'Enter');
    await page.locator('#search-msg.error').waitFor({ timeout: 5000 });
    check(`${name}: four English words are refused under the box, saying what it takes`, (await page.locator('#search-msg').innerText()) === 'Look up an English word or a phrase of up to 3 words; this has 4.');
    // Hebrew typed still opens its card, and the English list goes
    await page.fill('#word', 'רפורמה');
    await page.press('#word', 'Enter');
    await page.locator('#card-lookup:not(.idle) .meaning').waitFor({ timeout: 8000 });
    check(`${name}: a Hebrew word typed still opens its card, and the English list goes`, (await page.locator('#card-lookup .meaning').innerText()) === 'a reform' && (await page.locator('#english').isHidden()));
    check(`${name}: no screen shows "query", "source", "API", "candidate" or the reader's inside words`, page.words.length === 0, page.words.join(' | '));
    check(`${name}: nothing opened a new tab`, page.popups.length === 0, page.popups.join(' '));
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
if (failed) { console.log(`\n${failed} english page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} english page checks passed`);
