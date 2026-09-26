// Page checks for session thirteen, a card grows: the opened card with its
// layers and action row, Ask here, Find more examples and keeping one, Note
// here, the seven lookups, branching and cutting on the desk, Find's chips
// and Threads column, and the past desk in the corner. Against the local
// mocks, at computer (1280×800) and phone (412×915) size, light and dark;
// screenshots into docs/screenshots/grow-*.png. Run by `npm run screenshots`,
// or alone:
//   node scripts/grow-pages.mjs
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

const PORT = 8810, OR_PORT = 8811, SPINE_PORT = 8812;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-grow-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'g'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
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
// the background a node actually sits on: the first ancestor with one
const ground = (locator) => locator.evaluate((el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return 'rgb(255,255,255)'; });

let cookie = '';
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

try {
  await up(`${base}/health`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const [cname, cvalue] = cookie.split('=');
  const opened = []; // reference pages the lookups opened
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', ignoreHTTPSErrors: true, colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    // the reference sites and the example sources are never reached: a tab
    // that opens one is answered with a blank page and noted
    await ctx.route(/^https:\/\/(?!fonts\.)[^/]*\.(co\.il|com|org|org\.il)\//, (route) => { opened.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/html', body: '<p>reference</p>' }); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    // no exclusions: the Threads line reads "last worked on" (session fourteen)
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(/\b(maps?|mapped|met|touch(es|ed)?|spots?)\b/gi);
      if (hits) page.jargon.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const both = async (page, name) => {
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(120);
      await page.screenshot({ path: join(out, `grow-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  // --- the data: Guy's lesson, להמר and הסלמה met in it, both on the desk -------------
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  for (const w of ['להמר', 'הסלמה']) { await api('POST', '/lookup', { surface: w, sentence: w, lesson_id: lesson.id }); await api('POST', '/desks/put', { surface: w, sentence: w }); }
  let desk = (await api('GET', '/desks/current')).body;
  const W = desk.cards.find((c) => c.card.surface === 'להמר').key;
  const S = desk.cards.find((c) => c.card.surface === 'הסלמה').key;
  // להמר grows three kinds of layer before the page opens it: a kept example,
  // an answer, a note — and a lookup
  const ex = (await api('POST', `/card/${W}/examples`)).body;
  await api('POST', `/card/${ex.added[0].key}/keep`, { kept: true });
  await api('POST', `/card/${W}/ask`, { question: 'What is the difference between להמר and לסכן?' });
  const note = (await api('POST', `/card/${W}/notes`, { text: 'bet ON something: להמר על' })).body.layer;
  await api('POST', `/card/${W}/lookup`, { reference: 'milog' });

  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(viewport, mobile);
    const phone = name === 'phone';
    await page.goto(`${base}/desk`);
    await page.locator(phone ? '.ditem' : '.dcard').first().waitFor({ timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    const openCard = async (key) => {
      if (phone) await page.locator(`.ditem[data-key="${key}"] .ditem-open`).click();
      else { await page.locator(`.dcard[data-key="${key}"]`).hover(); await page.locator(`.dcard[data-key="${key}"] .dacts button`, { hasText: 'open' }).click(); }
      await page.locator('#grow .layers-line').waitFor({ timeout: 5000 });
    };

    // --- step 2: a card with no layers says so, with the action row ----------------
    await openCard(S);
    const g = page.locator('#grow');
    check(`${name}: a card with no layers says "No layers yet", plainly, with the action row`,
      (await g.locator('.layers-line').innerText()) === 'No layers yet' && (await g.locator('.grow-acts button', { hasText: 'Ask here' }).count()) === 1, await g.innerText());
    await both(page, `empty-${name}`);
    await page.locator('#full-card .close').click();

    // --- the card, opened, with three layer kinds --------------------------------
    await openCard(W);
    const text = await g.innerText();
    check(`${name}: the opened card: the header as the reader's card (pointed headword, root, binyan, meaning, "confirmed" line when so), then the layers`,
      (await page.locator('#full-card .surface').innerText()).includes('הִימֵּר') && /Pi'el/.test(await page.locator('#full-card .grammar').innerText()) && (await page.locator('#full-card #grow').count()) === 1);
    // the phone opens the same card after the computer grew it further
    const v = (await api('GET', `/card/${W}`)).body;
    const want = phone ? v.layers_line : '4 layers, oldest first';
    check(`${name}: "N layers, oldest first", counting kept examples, the answer, the note and the lookup`, (await g.locator('.layers-line').innerText()) === want && v.layers_line === want, await g.locator('.layers-line').innerText());
    const groupHead = await g.locator('.examples-group > .layer-kind').innerText();
    const [k, m] = phone ? [v.counts.examples_kept, v.counts.examples_found] : [1, 4];
    check(`${name}: examples grouped: "examples you kept · K of M found on <date>", each with its source and an arrow to it`,
      new RegExp(`^examples you kept · ${k} of ${m} found on \\d{1,2} [A-Z][a-z]{2}$`).test(groupHead) && (await g.locator('.examples-group .examples:not(.others) .layer').count()) === k
      && (await g.locator('.examples-group .src-link').first().getAttribute('href')) === ex.added[0].url && /ynet · news site, 18 Sep/.test(await g.locator('.examples-group .src-link').first().innerText()), `${k} of ${m} ` + groupHead + ' ' + await g.locator('.examples-group .src-link').first().innerText() + ' ' + await g.locator('.examples-group .src-link').first().getAttribute('href'));
    check(`${name}: an asked layer shows the question, the answer and the links it leaned on`,
      /asked · \d/.test(await g.locator('.layer.answer .layer-kind').first().innerText()) && (await g.locator('.layer.answer .q').first().innerText()).includes('לסכן') && (await g.locator('.layer.answer').first().locator('.src-link').count()) === 2
      && (await g.locator('.layer.answer .src-link').first().getAttribute('href')).startsWith('https://www.pealim.com/'));
    check(`${name}: a note layer shows its text and date; a lookup layer is one line`,
      (await g.locator('.layer.note textarea').first().inputValue()) === 'bet ON something: להמר על' && /^note · \d/.test(await g.locator('.layer.note .layer-kind').first().innerText())
      && /^looked up in Milog, \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(await g.locator('.layer.lookup .lookup-line').first().innerText()));
    // "Draw here" (session fourteen, computer only) is left out of thirteen's order
    const actions = (await g.locator('.grow-acts').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('button, a, .refs-label')].map((b) => b.textContent.trim())).flat())).filter((t) => t !== 'Draw here');
    check(`${name}: the action row, in the brief's order: Ask here · Note here · Find more examples · Look up in the seven · Branch · Cut`,
      actions.join('|') === 'Ask here|Note here|Find more examples|Look up in|Morfix|Pealim|Wiktionary|Milog|the Academy|Kizur|Sefaria|Branch a new card from here|Cut this card in two', actions.join('|'));
    const foot = await g.locator('.grow-foot').innerText();
    check(`${name}: the footer: born from Guy's lesson, the desks it is on, the cards branched from it`,
      new RegExp(`^Born from Guy's lesson of 24 Feb 2026 · on 1 desk: .+ · ${phone ? v.footer.branched : 0} cards? branched from it$`).test(foot), foot);
    check(`${name}: the layers' small text is legible`, contrast(await paint(g.locator('.layers-line'), 'color'), await ground(g.locator('.layers-line'))) >= 4.5
      && contrast(await paint(g.locator('.ex-sentence').first(), 'color'), await ground(g.locator('.ex-sentence').first())) >= 7);
    await both(page, `card-${name}`);
    if (phone) {
      const sheet = await page.locator('#full-card').evaluate((e) => ({ scroll: e.scrollHeight > e.clientHeight, overflow: getComputedStyle(e).overflowY, w: e.getBoundingClientRect().width }));
      check('phone: the opened card is the same view, as a page that scrolls, the full width of the phone', sheet.scroll && sheet.overflow === 'auto' && sheet.w >= 400, JSON.stringify(sheet));
      await g.locator('.grow-acts').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, 'grow-card-actions-phone-light.png') });
    }

    // --- found examples, one kept; keep another ------------------------------------
    await g.locator('.others-toggle').click();
    check(`${name}: the rest fold under "show the others", each with a "keep"`, (await g.locator('.examples.others .layer').count()) === m - k && (await g.locator('.examples.others button.keep').count()) === m - k);
    await both(page, `examples-${name}`);
    if (!phone) {
      await g.locator('.examples.others button.keep').first().click();
      await page.waitForFunction(() => /2 of 4 found/.test(document.querySelector('#grow .examples-group > .layer-kind')?.textContent || ''), null, { timeout: 5000 });
      check('desktop: "keep" moves an example up under "examples you kept", and the count follows (2 of 4)', (await g.locator('.examples-group .examples:not(.others) .layer').count()) === 2);
      // Find more examples: one more found, the list says so
      await g.locator('.grow-acts button', { hasText: 'Find more examples' }).click();
      await page.waitForFunction(() => /2 of 5 found/.test(document.querySelector('#grow .examples-group > .layer-kind')?.textContent || ''), null, { timeout: 8000 });
      check('desktop: "Find more examples" adds what is new and says what was left out and why', /Found 1 new example; keep the ones you want\. Left out 1: no source link\./.test(await g.locator('.grow-msg').innerText()), await g.locator('.grow-msg').innerText());
    }

    // --- Ask here: an answer with its links; one with none is refused, said plainly --
    await g.locator('.grow-acts button', { hasText: 'Ask here' }).click();
    const q = phone ? 'Answer without a link, please.' : 'Is להמר formal?';
    await g.locator('.ask-input').fill(q);
    await g.locator('.ask-here button[type=submit]').click();
    if (phone) {
      await g.locator('.grow-msg.bad').waitFor({ timeout: 5000 });
      check('phone: an answer that came back without a link is refused, and the card says so plainly', /could not be answered with a link to a reference, so it was not kept/.test(await g.locator('.grow-msg').innerText()), await g.locator('.grow-msg').innerText());
      await both(page, 'ask-refused-phone');
    } else {
      await page.waitForFunction(() => document.querySelectorAll('#grow .layer.answer').length === 2, null, { timeout: 5000 });
      check('desktop: Ask here saves the answer as a new layer, with the question and its links', (await g.locator('.layer.answer .q').last().innerText()) === 'Is להמר formal?' && (await g.locator('.layer.answer').last().locator('.src-link').count()) === 2);
      await g.locator('.layer.answer').last().scrollIntoViewIfNeeded();
      await both(page, 'ask-desktop');
    }

    // --- Note here: a note layer, text box focused, saved as typed ------------------
    const before = (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind === 'note').length;
    await g.locator('.grow-acts button', { hasText: 'Note here' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('#grow .layer.note textarea').length === n, before + 1, { timeout: 5000 });
    await page.waitForTimeout(50);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('layer-note'));
    const typed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/notes\//.test(r.url()) && r.ok(), { timeout: 5000 });
    await page.keyboard.type(`note from the ${name}`);
    await typed;
    const notes = (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind === 'note');
    check(`${name}: "Note here" adds a note as a layer of this card, its text box focused, saved as typed, and not put on the desk`,
      focused && notes.length === before + 1 && notes.at(-1).text === `note from the ${name}` && !(await api('GET', '/desks/current')).body.cards.some((c) => c.key === notes.at(-1).key));

    // --- the seven lookups: each opens its page and records a lookup ------------------
    if (!phone) {
      const n0 = (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind === 'lookup').length;
      const hrefs = await g.locator('a.ref').evaluateAll((as) => as.map((a) => [a.dataset.ref, a.href, a.target]));
      const enc = encodeURIComponent('להמר');
      check('desktop: each "Look up in" is a link to that site\'s page for the unpointed headword, opening in a new tab',
        hrefs.map((h) => h[1]).join(' ') === [`https://www.morfix.co.il/en/${enc}`, `https://www.pealim.com/search/?q=${enc}`, `https://he.wiktionary.org/w/index.php?search=${enc}`, `https://milog.co.il/${enc}`, `https://hebrew-academy.org.il/?s=${enc}`, `https://www.kizur.co.il/search_word.php?abbr=${enc}`, `https://www.sefaria.org/search?q=${enc}`].join(' ') && hrefs.every((h) => h[2] === '_blank'), JSON.stringify(hrefs));
      const popup = page.waitForEvent('popup');
      const recorded = page.waitForResponse((r) => /\/lookup$/.test(r.url()) && r.status() === 201);
      await g.locator('a.ref[data-ref=pealim]').click();
      const tab = await popup; await recorded;
      await tab.close();
      await page.waitForFunction((n) => document.querySelectorAll('#grow .layer.lookup').length === n, n0 + 1, { timeout: 5000 });
      check('desktop: a tap opens the reference in a new tab and records a lookup layer', opened.some((u) => u.startsWith('https://www.pealim.com/search/?q=')) && /^looked up in Pealim/.test(await g.locator('.layer.lookup .lookup-line').last().innerText()));
    }

    // --- branch from the kept example: a new card beside להמר, a grey line ----------------
    const kept = g.locator('.examples-group .examples:not(.others) .layer').first();
    const sentence = await kept.locator('.ex-sentence').innerText();
    await kept.locator('.layer-acts button', { hasText: 'Branch a new card from here' }).click();
    await page.locator('#full').waitFor({ state: 'hidden', timeout: 5000 });
    desk = (await api('GET', '/desks/current')).body;
    const br = desk.cards.filter((c) => c.kind === 'note' && c.text === sentence).at(-1);
    if (phone) {
      await page.locator(`.ditem[data-key="${br.key}"]`).waitFor({ timeout: 5000 });
      check('phone: a branched card lands on the desk not yet placed, in the list under the card it grew from',
        br.place.x === null && Number(await page.locator(`.ditem[data-key="${br.key}"]`).evaluate((e) => getComputedStyle(e).getPropertyValue('--depth'))) >= 1);
      await both(page, 'branched-phone');
    } else {
      await page.locator(`.dcard[data-key="${br.key}"]`).waitFor({ timeout: 5000 });
      const line = page.locator(`#lines line[data-child="${br.key}"][data-parent="${W}"]`);
      const pw = desk.cards.find((c) => c.key === W).place;
      check('desktop: branching makes a new card carrying the sentence, beside להמר, with a grey line to it, and says so',
        (await line.count()) === 1 && Math.abs(br.place.y - pw.y) < 300 && /A new card beside להמר\./.test(await page.locator('#desk-msg').innerText()), JSON.stringify({ pw, bp: br.place, msg: await page.locator('#desk-msg').innerText() }));
      await both(page, 'branched-desktop');
    }

    // --- cut: choose a layer; it and the ones after it go to a new card --------------------
    if (!phone) {
      await openCard(W);
      const layersBefore = (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind !== 'example' || l.kept);
      await g.locator('.grow-acts button', { hasText: 'Cut this card in two' }).click();
      await g.locator('.cut-bar').waitFor();
      check('desktop: "Cut this card in two" asks which layer to cut at, with "Cut here" on each layer', (await g.locator('.cut-here').count()) === layersBefore.length && /Choose the layer to cut at/.test(await g.locator('.cut-bar').innerText()));
      await both(page, 'cut-choose-desktop');
      const last = layersBefore.at(-1);
      await g.locator(`.layer[data-key="${last.key}"] .cut-here`).click();
      await page.locator('#full').waitFor({ state: 'hidden', timeout: 5000 });
      const after = (await api('GET', `/card/${W}`)).body;
      desk = (await api('GET', '/desks/current')).body;
      const cutCard = desk.cards.find((c) => c.kind === 'note' && desk.links.some((l) => l.child === c.key && l.kind === 'cut-from'));
      check('desktop: cutting at the last layer moves it to a new card beside the word; the word keeps the rest and its entry',
        cutCard && after.layers.every((l) => l.key !== last.key) && (await api('GET', `/card/${cutCard.key}`)).body.layers[0].key === last.key && after.card.card.surface === 'להמר'
        && /The cut-off layers are on a new card beside להמר\./.test(await page.locator('#desk-msg').innerText()));
    }

    // --- races: a slow answer arriving after another card is opened; a double press ---
    if (!phone) {
      await page.route(/\/card\/[a-z]+:\d+\/ask$/, async (route) => { await wait(1500); await route.continue(); });
      await openCard(W);
      await g.locator('.grow-acts button', { hasText: 'Ask here' }).click();
      await g.locator('.ask-input').fill('A slow question?');
      await g.locator('.ask-here button[type=submit]').click();
      await page.locator('#full-card .close').click();
      await openCard(S);
      await page.waitForTimeout(2500);
      check('desktop: an answer that arrives after another card was opened never draws into that card', (await g.locator('.layers-line').innerText()) === 'No layers yet' && (await g.locator('.layer.answer').count()) === 0
        && (await api('GET', `/card/${W}`)).body.layers.some((l) => l.kind === 'answer' && l.question === 'A slow question?'));
      await page.unroute(/\/card\/[a-z]+:\d+\/ask$/);
      await page.locator('#full-card .close').click();
      await openCard(W);
      const n0 = (await api('GET', `/card/${W}`)).body.layers.length;
      await g.locator('.grow-acts button', { hasText: 'Note here' }).dblclick();
      await page.waitForTimeout(800);
      check('desktop: "Note here" pressed twice at once makes one note', (await api('GET', `/card/${W}`)).body.layers.length === n0 + 1);
      await page.locator('#full-card .close').click();
    }

    // --- Find: threads, the chips ------------------------------------------------------
    await page.fill('#find', 'המר');
    await page.locator('#results-threads .result-thread').first().waitFor({ timeout: 5000 });
    const thread = page.locator(`#results-threads .result-thread[data-key="${W}"]`);
    const tl = await thread.innerText();
    check(`${name}: Find shows Cards, Threads, Desks; להמר under Threads with its counts line and where it is`,
      (await page.locator('#results .list-title').allTextContents()).join('|') === 'Cards|Threads|Desks'
      && /^להמר: word → \d examples? kept → \d questions? → \d notes? → looked up \d+ times? · \d+ branch(es)?\nlast worked on \d{1,2} [A-Z][a-z]{2} \d{4} · on 1 desk$/.test(tl), tl);
    check(`${name}: each card result says what it is and where it came from`, /^word · from Guy's lesson of 24 Feb 2026$/.test(await page.locator(`#results-cards .result-card.word .origin`).first().innerText())
      && /^example · found online \d{1,2} [A-Z][a-z]{2} \d{4} · on להמר$/.test(await page.locator('#results-cards .result-card.example .origin').first().innerText()));
    await both(page, `find-${name}`);
    await page.locator('#find-chips button[data-source=online]').click();
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('#results-cards .result-card')]; return r.length && r.every((x) => x.classList.contains('example')); }, null, { timeout: 5000 });
    check(`${name}: the chip "found online" narrows the cards to examples`, (await page.locator('#results-cards .result-card.word').count()) === 0);
    await page.locator('#find-chips button[data-source=everything]').click();
    await page.waitForFunction(() => document.querySelectorAll('#results-cards .result-card.word').length > 0, null, { timeout: 5000 });
    await thread.click();
    await page.locator('#grow .layers-line').waitFor({ timeout: 5000 });
    check(`${name}: a thread result opens the card's full view`, (await page.locator('#full-card .surface').innerText()).includes('הִימֵּר'));
    await page.locator('#full-card .close').click();
    await page.fill('#find', '');
    await page.keyboard.press('Escape');

    // --- the past desk in the corner ------------------------------------------------------
    if (!phone) {
      const before = (await api('GET', '/desks/current')).body.desk;
      await page.locator('#new-desk').click();
      await page.locator('#past:not(.hidden)').waitFor({ timeout: 5000 });
      check('desktop: after "New desk", the corner shows the past desk, small, with its name', (await page.locator('#past .past-name').innerText()) === before.name && (await page.locator('#past svg.thumb rect.th-word').count()) >= 1, await page.locator('#past').innerText());
      await both(page, 'corner-desktop');
      const reopened = page.waitForResponse((r) => new RegExp(`/desks/${before.id}/open$`).test(r.url()) && r.ok());
      await page.locator('#past .thumb-open').click();
      await reopened;
      await page.waitForTimeout(300);
      check('desktop: tapping it makes it the current desk, as it was left; the corner then shows another desk or nothing',
        (await api('GET', '/desks/current')).body.desk.id === before.id && ((await page.locator('#past').isHidden()) || (await page.locator('#past').getAttribute('data-id')) !== String(before.id)));
    } else {
      check('phone: no corner at phone width', await page.locator('#past').isHidden());
    }
    check(`${name}: no screen of this session shows "map", "met", "touch" or "spot"`, page.jargon.length === 0, page.jargon.join(' | '));
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
if (failed) { console.log(`\n${failed} grow page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} grow page checks passed`);
