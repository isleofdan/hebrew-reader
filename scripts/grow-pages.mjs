// Page checks for session thirteen, a card grows: the opened card with its
// layers and action row, Ask here, Find more examples and keeping one, Note
// here, the seven lookups, branching and cutting on the desk, Find's chips
// and Threads column, and the past desk in the corner; since hebrew-ask-one
// also the ask pane under a word card's action row. Against the local
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

const PORT = 8810, OR_PORT = 8811, SPINE_PORT = 8812, REF_PORT = 8813;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-grow-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
// the seven reference sites, stood in for (hebrew-lookup-one): a copy is
// fetched from here and a framed page is loaded from here
start(['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'g'.repeat(64), COOKIE_INSECURE: '1',
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

    // --- the seven lookups open inside the card (hebrew-lookup-one) -------------------
    // a tap opens the reference in a pane under the row, never a new tab, and
    // records a lookup layer as before: a copy (Pealim), a framed page
    // (Wiktionary), and a site that does not answer (the Academy)
    {
      const enc = encodeURIComponent('להמר');
      const popups = [];
      page.on('popup', (p) => popups.push(p.url()));
      const lookups = async () => (await api('GET', `/card/${W}`)).body.layers.filter((l) => l.kind === 'lookup').length;
      const n0 = await lookups();
      check(`${name}: each "Look up in" is a button, not a link to a new tab`,
        (await g.locator('.refs a').count()) === 0 && (await g.locator('.refs button.ref').count()) === 7);
      const pane = g.locator('.ref-pane');
      const recorded = page.waitForResponse((r) => /\/card\/word:\d+\/lookup$/.test(r.url()) && r.status() === 201);
      await g.locator('.refs button.ref[data-ref=pealim]').click();
      await recorded;
      await pane.locator('iframe.ref-frame.copy').waitFor({ timeout: 8000 });
      await page.waitForFunction((n) => document.querySelectorAll('#grow .layer.lookup').length === n, n0 + 1, { timeout: 5000 });
      const doc = await pane.locator('iframe.ref-frame.copy').getAttribute('srcdoc');
      const frame = page.frameLocator('#grow .ref-pane iframe.ref-frame.copy');
      check(`${name}: Pealim (a copy) opens in a pane under the row: the copy line, a link to the live page, the copy in a sandboxed frame with no script`,
        (await pane.locator('.ref-line').innerText()).startsWith('Shown from a copy fetched by the reader; open the site for the live page')
        && (await pane.locator('.ref-line a').getAttribute('href')) === `https://www.pealim.com/search/?q=${enc}` && (await pane.locator('.ref-line a').getAttribute('target')) === '_blank'
        && (await pane.locator('iframe.copy').getAttribute('sandbox')) === 'allow-popups allow-popups-to-escape-sandbox' && !/<script/i.test(doc)
        && (await frame.locator('h1').innerText()) === 'להמר', await pane.innerText());
      const order = await g.evaluate((box) => [...box.children].map((c) => c.className.split(' ')[0]));
      check(`${name}: the pane sits under the "Look up in" row, and the tap recorded a lookup layer ("looked up in Pealim")`,
        order.join(',') === 'grow-top,ref-pane,grow-bottom' && (await g.locator('.grow-top > .refs').count()) === 1 && /^looked up in Pealim/.test(await g.locator('.layer.lookup .lookup-line').last().innerText()), order.join(','));
      check(`${name}: the open reference's button is marked`, (await g.locator('.refs button.ref.active').getAttribute('data-ref')) === 'pealim');
      await pane.scrollIntoViewIfNeeded();
      await both(page, `ref-copy-${name}`);
      // a framed reference replaces it: one pane at a time
      await g.locator('.refs button.ref[data-ref=wiktionary]').click();
      await pane.locator('iframe.ref-frame:not(.copy)').waitFor({ timeout: 8000 });
      check(`${name}: Wiktionary (framed) replaces the copy in the one pane: the site's page in a frame`,
        (await g.locator('.ref-pane').count()) === 1 && (await pane.locator('iframe').count()) === 1
        && (await pane.locator('iframe').getAttribute('src')) === `${standin}/wiktionary/${enc}` && /Wiktionary's own page/.test(await pane.locator('.ref-line').innerText())
        && (await page.frameLocator('#grow .ref-pane iframe').locator('h1').innerText()) === 'להמר');
      await page.waitForFunction((n) => document.querySelectorAll('#grow .layer.lookup').length === n, n0 + 2, { timeout: 5000 });
      check(`${name}: the frame stays open while the card redraws after the lookup is recorded`, (await pane.locator('iframe').getAttribute('src')) === `${standin}/wiktionary/${enc}` && (await lookups()) === n0 + 2);
      await pane.scrollIntoViewIfNeeded();
      await both(page, `ref-frame-${name}`);
      // a site that does not answer
      await fetch(`${standin}/control`, { method: 'POST', body: JSON.stringify({ academy: 'status:403' }) });
      await g.locator('.refs button.ref[data-ref=academy]').click();
      await pane.locator('.ref-line.bad').waitFor({ timeout: 8000 });
      check(`${name}: a site that does not answer: "The site did not answer; open it directly", with the link`,
        (await pane.locator('.ref-line.bad').innerText()).startsWith('The site did not answer; open it directly.') && (await pane.locator('.ref-line.bad a').getAttribute('href')) === `https://hebrew-academy.org.il/?s=${enc}`
        && (await pane.locator('iframe').count()) === 0, await pane.innerText());
      check(`${name}: the failure line is legible`, contrast(await paint(pane.locator('.ref-line.bad'), 'color'), await ground(pane.locator('.ref-line.bad'))) >= 4.5);
      await pane.scrollIntoViewIfNeeded();
      await both(page, `ref-failed-${name}`);
      await fetch(`${standin}/control`, { method: 'POST', body: JSON.stringify({ academy: 'page' }) });
      await pane.locator('.ref-close').click();
      check(`${name}: Close shuts the pane and unmarks the button`, (await pane.isHidden()) && (await g.locator('.refs button.ref.active').count()) === 0);
      // (the copy's own images load from the live site, in the pane; that is not a tab)
      check(`${name}: no tap opened a new tab`, popups.length === 0, JSON.stringify(popups));
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

  // --- the ask pane: "Ask about this root" inside the page (hebrew-ask-one) ---------------
  // On the reader's card and the phone page's card, at phone (390×844) and
  // computer (1280×800) width, light and dark: closed, open with nothing
  // fetched, after "Ask", after "Ask more", a tab open. The action row's top
  // on the screen is measured before opening, open, and after "Close".
  const tok = (await import('../public/tokenize.js')).default;
  const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');
  const art = (await api('GET', `/articles/${(await api('POST', '/articles', { text: sample })).body.id}`)).body;
  const asRead = `${art.title}\n${art.text}`;
  const sentenceOf = (w) => tok.sentenceAt(asRead, asRead.indexOf(w));
  for (const w of ['שנאלצה', 'ייקבעו']) await api('POST', '/lookup', { surface: w, sentence: sentenceOf(w), article_id: art.id });
  // שנאלצה's card is on the desk, so a tab opened from its pane is recorded on it; ייקבעו's is not
  await api('POST', '/desks/put', { surface: 'שנאלצה', sentence: sentenceOf('שנאלצה') });
  const orCalls = async () => (await (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json()).calls;
  const refCalls = async () => Object.values(await (await fetch(`${standin}/calls`)).json()).reduce((a, b) => a + b, 0);
  const measured = [];
  for (const [vname, viewport, isMobile] of [['phone', { width: 390, height: 844 }, true], ['computer', { width: 1280, height: 800 }, false]]) {
    const { ctx, page } = await context(viewport, isMobile);
    const sent = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.port === String(PORT)) sent.push(`${r.method()} ${u.pathname}`); });
    for (const where of ['reader', 'phone-page']) {
      let card;
      if (where === 'reader') {
        await page.goto(`${base}/read.html?id=${art.id}`);
        await page.waitForSelector('.body .w');
        const w = page.locator('.body .w', { hasText: 'שנאלצה' }).first();
        await w.scrollIntoViewIfNeeded();
        if (isMobile) await w.tap(); else await w.hover();
        card = page.locator(isMobile ? '#card-phone' : '#card-desktop');
      } else {
        await page.goto(`${base}/phone`);
        await page.waitForSelector('#demand-sentence .gap');
        await page.click('#show');
        card = page.locator('#card-demand');
      }
      await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      const onDesk = where === 'reader' || (await page.evaluate(() => window.Phone.item.surface)) === 'שנאלצה';
      const label = `${where} ${vname}`;
      const shots = [];
      const shoot = async (state) => {
        for (const theme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: theme });
          await page.waitForTimeout(120);
          const path = join(out, `ask-pane-${where}-${vname}-${state}-${theme}.png`);
          await page.screenshot({ path });
          shots.push(path.split('/').pop());
        }
        await page.emulateMedia({ colorScheme: 'light' });
      };
      await shoot('closed');
      const row = card.locator('.actions');
      const askBtn = card.locator('[data-act=ask]');
      check(`${label}: the card's button reads "Ask about this root"`, (await askBtn.innerText()).trim() === 'Ask about this root');
      // opening: nothing fetched, the row where it was (the row brought to the
      // middle of the screen first, as Dan would have it, so the click itself
      // need not scroll it into view)
      await row.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      const top0 = (await row.boundingBox()).y;
      const or0 = await orCalls(), ref0 = await refCalls(), sent0 = sent.length;
      const pagesBefore = ctx.pages().length;
      await askBtn.click();
      const pane = card.locator('.ask-pane');
      await pane.waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const top1 = (await row.boundingBox()).y;
      check(`${label}: opening the pane fetches nothing — no request from the page, none to the stand-in model or the stand-in references, no new tab`,
        sent.length === sent0 && (await orCalls()) === or0 && (await refCalls()) === ref0 && ctx.pages().length === pagesBefore, JSON.stringify(sent.slice(sent0)));
      const paneBox = await pane.boundingBox(), cardBox = await card.boundingBox(), rowBox = await row.boundingBox();
      // the root the card shows (the reader's word is שנאלצה, א.ל.צ; the phone page's is the item it gave)
      const root = (await card.locator('.grammar').innerText()).match(/root ([א-ת](?:\.[א-ת])+)/)[1];
      check(`${label}: the pane sits directly under the action row, in the card: the root in Hebrew, Close, the tabs Pealim and Wiktionary, the question box and Ask`,
        paneBox.y >= rowBox.y + rowBox.height - 1 && paneBox.y - (rowBox.y + rowBox.height) <= 16 && (where !== 'reader' || root === 'א.ל.צ')
        && (await pane.locator('.ask-pane-title').innerText()).trim() === root && (await pane.locator('.ask-pane-close').innerText()).trim() === 'Close'
        && (await pane.locator('.ask-pane-tabs button').allInnerTexts()).map((t) => t.trim()).join('|') === 'Pealim|Wiktionary'
        && (await pane.locator('.ask-pane-ask textarea').getAttribute('placeholder')) === 'a question about this root…'
        && (await pane.locator('.ask-pane-ask .ask-pane-go').innerText()).trim() === 'Ask' && await pane.locator('.ask-pane-more').isHidden(),
        JSON.stringify({ paneBox, rowBox }));
      const goBox = await pane.locator('.ask-pane-ask .ask-pane-go').boundingBox();
      if (isMobile) {
        check(`${label}: on the phone the pane is full width (the card's inner width) and "Ask" is at least 56 px high (${goBox.height} px)`,
          paneBox.width >= cardBox.width - 2 * 18 - 4 && goBox.height >= 56, JSON.stringify({ paneBox, cardBox, goBox }));
        measured.push(`${label}: Ask button ${goBox.height} px high`);
      }
      await shoot('open');
      // Close is brought into view first, as Dan would scroll to it (on the
      // phone's sheet only its head shows under the buttons); the row must
      // then stay where it is as Close is tapped
      await pane.locator('.ask-pane-close').scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const topC = (await row.boundingBox()).y;
      await pane.locator('.ask-pane-close').click();
      await page.waitForTimeout(300);
      const top2 = (await row.boundingBox()).y;
      measured.push(`${label}: action row top ${top0} px before opening, ${top1} px open, ${topC} px with Close in view, ${top2} px after Close`);
      console.log(`     ${measured.at(-1)}`);
      check(`${label}: the action row stays at the same height on the screen when the pane opens (${top0} / ${top1} px) and when it closes (${topC} / ${top2} px)`,
        Math.abs(top1 - top0) < 0.5 && Math.abs(top2 - topC) < 0.5 && await card.locator('.ask-pane').count() === 0);
      // Ask, then Ask more
      await askBtn.click();
      await pane.waitFor({ timeout: 5000 });
      await pane.locator('.ask-pane-ask textarea').fill('Which other words come from this root?');
      await pane.locator('.ask-pane-ask .ask-pane-go').click();
      await pane.locator('.ask-turn').first().waitFor({ timeout: 10000 });
      const links = await pane.locator('.ask-turn .links a').evaluateAll((as) => as.map((a) => a.innerText));
      check(`${label}: "Ask" answers under the box with the pages the search cited, and "Ask more" appears`,
        (await pane.locator('.ask-turn .answer').first().innerText()).startsWith(`The root ${root} `) && links.length === 2 && /^Pealim · /.test(links[0]) && /^Wiktionary · /.test(links[1]) && await pane.locator('.ask-pane-more').isVisible(),
        JSON.stringify(links));
      await pane.locator('.ask-turn').first().scrollIntoViewIfNeeded();
      await shoot('after-ask');
      await pane.locator('.ask-pane-more textarea').fill('Is the Pa\'al used at all?');
      await pane.locator('.ask-pane-more .ask-pane-go').click();
      await pane.locator('.ask-turn').nth(1).waitFor({ timeout: 10000 });
      check(`${label}: "Ask more" sends a follow-up: its answer comes after the first, the model having had the earlier turn`,
        /following 1 earlier turn/.test(await pane.locator('.ask-turn').nth(1).locator('.answer').innerText()) && (await pane.locator('.ask-pane-more textarea').inputValue()) === '');
      await pane.locator('.ask-turn').nth(1).scrollIntoViewIfNeeded();
      await shoot('after-ask-more');
      // a tab: Pealim inside the pane, recorded on the desk card only when there is one
      const sent1 = sent.length;
      await pane.locator('.ask-pane-tabs button', { hasText: 'Pealim' }).click();
      await pane.locator('.ref-pane .ref-frame').waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
      const recorded = sent.slice(sent1).filter((s) => /^POST \/card\/word:\d+\/lookup$/.test(s)).length;
      check(`${label}: the Pealim tab opens Pealim inside the pane (the root letters), marked; ${onDesk ? 'recorded as a lookup on the word\'s desk card' : 'nothing recorded for a word with no desk card'}`,
        (await pane.locator('.ref-pane .ref-title').innerText()).includes(root.replace(/\./g, '')) && (await pane.locator('.ask-pane-tabs button.active').innerText()).trim() === 'Pealim'
        && sent.slice(sent1).some((s) => s === 'GET /reference/pealim') && recorded === (onDesk ? 1 : 0) && ctx.pages().length === pagesBefore, JSON.stringify(sent.slice(sent1)));
      await pane.locator('.ref-pane').scrollIntoViewIfNeeded();
      await shoot('tab');
      // Close after the pane was used and the page (or the card) scrolled to
      // bring Close back into view: the row stays where it is at that moment
      await pane.locator('.ask-pane-close').scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const atClose = (await row.boundingBox()).y;
      await pane.locator('.ask-pane-close').click();
      await page.waitForTimeout(300);
      const afterClose = (await row.boundingBox()).y;
      measured.push(`${label}: after use, action row top ${atClose} px as Close is tapped, ${afterClose} px after`);
      console.log(`     ${measured.at(-1)}`);
      check(`${label}: Close after Ask, Ask more and a tab, scrolled back to Close: the action row stays where it was when Close was tapped (${atClose} / ${afterClose} px)`,
        Math.abs(afterClose - atClose) < 0.5 && await card.locator('.ask-pane').count() === 0);
      console.log(`     ${label} screenshots: ${shots.join(', ')}`);
    }
    // a word put on the desk from its card, then a reference opened from its
    // pane without reloading: recorded on the card just placed
    {
      const fresh = vname === 'phone' ? 'באמינות' : 'רפורמה';
      await page.goto(`${base}/read.html?id=${art.id}`);
      await page.waitForSelector('.body .w');
      const w = page.locator('.w', { hasText: fresh }).first();
      await w.scrollIntoViewIfNeeded();
      if (isMobile) await w.tap(); else await w.hover();
      const card = page.locator(isMobile ? '#card-phone' : '#card-desktop');
      await card.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
      await card.locator('[data-act=desk]').click();
      await card.locator('.foot', { hasText: /^On the desk/ }).waitFor({ timeout: 5000 });
      await card.locator('[data-act=ask]').click();
      const pane = card.locator('.ask-pane');
      await pane.waitFor({ timeout: 5000 });
      const sent1 = sent.length;
      await pane.locator('.ask-pane-tabs button', { hasText: 'Pealim' }).click();
      await pane.locator('.ref-pane .ref-frame').waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
      const recorded = sent.slice(sent1).filter((s) => /^POST \/card\/word:\d+\/lookup$/.test(s)).length;
      check(`reader ${vname}: a word just put on the desk (${fresh}) has a reference opened from its pane recorded on its desk card, with no reload`,
        recorded === 1, JSON.stringify(sent.slice(sent1)));
      await pane.locator('.ask-pane-close').click();
    }
    check(`ask pane ${vname}: no screen shows "map", "met", "touch" or "spot"`, page.jargon.length === 0, page.jargon.join(' | '));
    await ctx.close();
  }
  for (const m of measured) console.log(`measured: ${m}`);
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
