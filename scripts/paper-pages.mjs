// Page checks for session fourteen, the desk with a pen and with paper: the
// repairs (no stray fragments behind an opened card, "last worked on", link
// labels, cards out of view brought back), ink on a card and on a desk card,
// Dan's own link drawn blue with its sentence, the sheet for the reMarkable
// as it prints, and a line shared from another app caught on the phone.
// Against the local mocks, at computer (1280×800) and phone (412×915) size,
// light and dark (the sheet light only: paper is not dark); screenshots into
// docs/screenshots/paper-*.png. Run by `npm run screenshots`, or alone:
//   node scripts/paper-pages.mjs
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

const PORT = 8830, OR_PORT = 8831, SPINE_PORT = 8832;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-paper-pages-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'q'.repeat(64), COOKIE_INSECURE: '1',
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
  const context = async (viewport, isMobile) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', ignoreHTTPSErrors: true, colorScheme: 'light' });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    await ctx.route(/^https:\/\/(?!fonts\.)[^/]*\.(co\.il|com|org|org\.il)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>reference</p>' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    // no exclusions: "last touched" is gone from the Threads line (session fourteen)
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
      await page.screenshot({ path: join(out, `paper-${name}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const deskReady = async (page) => { await page.goto(`${base}/desk`); await page.waitForFunction(() => window.Desk && window.Desk.desk, null, { timeout: 8000 }); await page.waitForTimeout(250); };

  // --- the data: Guy's lesson; להמר and הסלמה on the desk; להמר asked about -----------------
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  for (const w of ['להמר', 'הסלמה']) { await api('POST', '/lookup', { surface: w, sentence: w, lesson_id: lesson.id }); await api('POST', '/desks/put', { surface: w, sentence: w }); }
  let desk = (await api('GET', '/desks/current')).body;
  const W = desk.cards.find((c) => c.card.surface === 'להמר').key;
  const S = desk.cards.find((c) => c.card.surface === 'הסלמה').key;
  const ex = (await api('POST', `/card/${W}/examples`)).body;
  await api('POST', `/card/${ex.added[0].key}/keep`, { kept: true });
  await api('POST', `/card/${W}/ask`, { question: 'What is the difference between להמר and לסכן?' });
  await api('POST', `/card/${S}/notes`, { text: 'same root as סולם — a ladder' });
  // a card branched from להמר, as in thirteen's live round
  const branched = (await api('POST', `/card/${ex.added[0].key}/branch`, { desk_id: desk.desk.id })).body.card.key;

  // ================================ computer ==========================================
  {
    const { ctx, page } = await context({ width: 1280, height: 800 }, false);
    const name = 'desktop';
    await deskReady(page);

    // --- 1a. the fragments behind an opened card ----------------------------------------------
    await page.fill('#find', 'המר');
    await page.keyboard.press('Enter');
    await page.locator('#results-cards .result-card.word').first().waitFor({ timeout: 5000 });
    await page.locator('#results-cards .result-card.word .result-open').first().click();
    await page.locator('#grow .layers-line').waitFor({ timeout: 5000 });
    await page.locator('#full').evaluate((e) => { e.scrollTop = 0; });
    const probe = async () => page.evaluate(() => {
      // every point of the backdrop outside the card: what is drawn there
      const card = document.querySelector('#full-card').getBoundingClientRect();
      const stray = [];
      for (let y = 20; y < innerHeight; y += 40) for (let x = 20; x < innerWidth; x += 40) {
        if (x >= card.left && x <= card.right && y >= card.top && y <= card.bottom) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest('#full')) stray.push(`${x},${y}:${hit.id || hit.className}`);
      }
      const panel = getComputedStyle(document.querySelector('#results')).visibility;
      return { stray: stray.slice(0, 5), count: stray.length, panel };
    });
    const p0 = await probe();
    for (let i = 0; i < 6; i++) { await page.mouse.move(640, 500); await page.mouse.wheel(0, 180); await page.waitForTimeout(60); }
    const p1 = await probe();
    check(`${name}: with Find open behind an opened card, the panel behind is not drawn at all`, p0.panel === 'hidden' && p1.panel === 'hidden', JSON.stringify([p0.panel, p1.panel]));
    check(`${name}: scrolling the opened card over an open Find shows no stray text anywhere around it`, p0.count === 0 && p1.count === 0 && !(await page.locator('#full').innerText()).match(/This desk/), JSON.stringify([p0, p1]));
    await page.screenshot({ path: join(out, 'paper-no-fragments-desktop-light.png') });
    // 1c: two links, told apart by their page titles
    const labels = await page.locator('#grow .layer.answer .src-link').allInnerTexts();
    check(`${name}: an answer's links read their page titles, never "Milog · Milog"`, labels.length === 2 && labels[0].includes('Pealim') && labels[1].includes('מילוג') && labels[0] !== labels[1], JSON.stringify(labels));
    await page.locator('#full-card .close').click();
    check(`${name}: closing the card brings Find's panel back as it was`, await page.locator('#results').evaluate((e) => getComputedStyle(e).visibility === 'visible' && !e.classList.contains('hidden')));
    // 1b: "last worked on"
    const tl = await page.locator('#results-threads .result-thread').first().innerText();
    check(`${name}: the Threads line reads "last worked on"`, /last worked on \d{1,2} [A-Z][a-z]{2} \d{4}/.test(tl) && !/last touched/i.test(tl), tl);
    await page.fill('#find', '');
    await page.keyboard.press('Escape');

    // --- 1d. a card out of view, and bringing it back ------------------------------------------------
    await api('PATCH', `/desks/${desk.desk.id}/cards/${S}`, { x: 60, y: 2400 });
    await deskReady(page);
    const strip = await page.locator('.strip-line').innerText();
    check(`${name}: the count says how many cards are out of view`, /3 cards \(1 out of view\)/.test(strip) && await page.locator('#bring-in').isVisible(), strip);
    await both(page, 'out-of-view-desktop');
    await page.locator('#bring-in').click();
    await page.waitForFunction(() => !/out of view/.test(document.querySelector('#desk-count').textContent), null, { timeout: 5000 });
    const moved = (await api('GET', `/desks/${desk.desk.id}`)).body.cards.find((c) => c.key === S).place;
    const box = await page.locator(`.dcard[data-key="${S}"]`).boundingBox();
    check(`${name}: "bring every card into view" moves it into the part on screen, and the move is saved`, moved.y < 800 && box && box.y >= 0 && box.y + box.height <= 800 && await page.locator('#bring-in').isHidden(), JSON.stringify([moved, box]));

    // --- 2. ink on the opened card --------------------------------------------------------------------
    await page.locator(`.dcard[data-key="${W}"]`).hover();
    await page.locator(`.dcard[data-key="${W}"] .dacts button`, { hasText: 'open' }).click();
    await page.locator('#grow .layers-line').waitFor({ timeout: 5000 });
    check(`${name}: a card with no ink shows no ink area until "Draw here"`, (await page.locator('#grow .ink-area').count()) === 0 && await page.locator('#grow .draw-here').isVisible());
    await page.locator('#grow .draw-here').click();
    const pad = page.locator('#grow .ink-area.editable .ink-pad');
    await pad.waitFor({ timeout: 3000 });
    const drawOn = async (loc, pts) => {
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]);
      await page.mouse.down();
      for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 4 });
      await page.mouse.up();
    };
    const inked = page.waitForResponse((r) => /\/ink$/.test(r.url()) && r.request().method() === 'POST');
    await drawOn(pad, [[0.1, 0.3], [0.3, 0.6], [0.5, 0.3], [0.7, 0.6]]);
    await inked;
    await page.locator('#grow .layer.ink:not(.pending) .layer-kind').waitFor({ timeout: 5000 });
    const pad2 = page.locator('#grow .layer.ink .ink-area.editable .ink-pad');
    const second = page.waitForResponse((r) => /\/ink$/.test(r.url()) && r.request().method() === 'POST');
    await drawOn(pad2, [[0.2, 0.8], [0.8, 0.8]]);
    await second;
    const inkLayer = (await api('GET', `/card/${W}`)).body.ink;
    check(`${name}: the mouse draws; each stroke is saved as it ends`, inkLayer && inkLayer.strokes.length === 2 && inkLayer.strokes[0].points.length >= 4, JSON.stringify(inkLayer && inkLayer.strokes.map((s) => s.points.length)));
    await both(page, 'ink-open-desktop');
    // reload: the stroke is still there, as a layer "note · ink · <today>"
    await deskReady(page);
    await page.locator(`.dcard[data-key="${W}"]`).hover();
    await page.locator(`.dcard[data-key="${W}"] .dacts button`, { hasText: 'open' }).click();
    await page.locator('#grow .layer.ink').waitFor({ timeout: 5000 });
    const kind = await page.locator('#grow .layer.ink .layer-kind').innerText();
    check(`${name}: after a reload the strokes are still there, on the layer "note · ink · <today>"`, /^note · ink · \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(kind) && (await page.locator('#grow .layer.ink path').count()) === 2, kind);
    const inkColor = await page.locator('#grow .layer.ink .ink-pad').evaluate((e) => getComputedStyle(e).color);
    check(`${name}: ink is drawn in the text's colour, legible on the card`, contrast(inkColor, await ground(page.locator('#grow .layer.ink .ink-pad'))) >= 4.5);
    const undone = page.waitForResponse((r) => /\/ink\/last$/.test(r.url()));
    await page.locator('#grow .ink-undo').click();
    await undone;
    check(`${name}: "undo last stroke" removes the last stroke`, (await page.locator('#grow .layer.ink path').count()) === 1 && (await api('GET', `/card/${W}`)).body.ink.strokes.length === 1);
    await page.locator('#full-card .close').click();
    await page.waitForTimeout(400);
    check(`${name}: the desk card shows its ink small`, (await page.locator(`.dcard[data-key="${W}"] .dink path`).count()) === 1);

    // ink on a desk card
    await page.locator(`.dcard[data-key="${S}"]`).hover();
    await page.locator(`.dcard[data-key="${S}"] .dacts button`, { hasText: 'draw here' }).click();
    const dpad = page.locator(`.dcard[data-key="${S}"] .ink-area.editable .ink-pad`);
    await dpad.waitFor({ timeout: 3000 });
    const before = (await api('GET', `/desks/${desk.desk.id}`)).body.cards.find((c) => c.key === S).place;
    const d1 = page.waitForResponse((r) => /\/ink$/.test(r.url()) && r.request().method() === 'POST');
    await drawOn(dpad, [[0.15, 0.4], [0.5, 0.6], [0.85, 0.4]]);
    await d1;
    const after = (await api('GET', `/desks/${desk.desk.id}`)).body.cards.find((c) => c.key === S);
    check(`${name}: "draw here" on a desk card draws on it; the card does not move while drawing`, after.ink && after.ink.strokes.length === 1 && after.place.x === before.x && after.place.y === before.y, JSON.stringify([before, after.place]));
    await both(page, 'ink-desk-card-desktop');
    await page.locator(`.dcard[data-key="${S}"] .ink-acts button`, { hasText: 'done' }).click();

    // --- 3. Dan's own link ----------------------------------------------------------------------------
    const SENT = 'things that move without a destination';
    await page.locator('#link-these').click();
    check(`${name}: "Link these" asks for the first card`, (await page.locator('#link-step').innerText()).includes('choose the first card'));
    await page.locator(`.dcard[data-key="${W}"] .dface`).click();
    await page.locator(`.dcard[data-key="${branched}"]`).click({ position: { x: 20, y: 8 } });
    await page.locator('#link-sentence').waitFor({ state: 'visible', timeout: 3000 });
    await page.fill('#link-sentence', SENT);
    await page.locator('#link-save').click();
    await page.locator('#lines line.dan-link').waitFor({ timeout: 5000 });
    const cap = page.locator('.link-caption');
    check(`${name}: a blue line joins the two cards, the sentence beside it`, (await cap.innerText()) === `you linked these: ${SENT}` && (await page.locator('#lines line.dan-link').count()) === 1);
    check(`${name}: the strip counts the linked pair with its family as one group`, /· 1 group/.test(await page.locator('.strip-line').innerText()), await page.locator('.strip-line').innerText());
    const blue = await page.locator('#lines line.dan-link').evaluate((e) => getComputedStyle(e).stroke);
    const grey = await page.locator('#lines line:not(.dan-link)').first().evaluate((e) => getComputedStyle(e).stroke).catch(() => '');
    check(`${name}: the link Dan drew is blue, the lines of growth grey`, /rgb\(47, 107, 209\)/.test(blue) && blue !== grey, `${blue} / ${grey}`);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(100);
      const c = await cap.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
      check(`${name} ${theme}: the sentence beside the line is legible (contrast ≥ 4.5)`, contrast(c[0], c[1]) >= 4.5, JSON.stringify(c));
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await both(page, 'link-desktop');
    // one card off the desk: the line goes
    await api('DELETE', `/desks/${desk.desk.id}/cards/${branched}`);
    await deskReady(page);
    check(`${name}: with one of the two off the desk, the line and sentence are gone`, (await page.locator('#lines line.dan-link').count()) === 0 && (await page.locator('.link-caption').count()) === 0);
    await api('POST', `/desks/${desk.desk.id}/cards`, { card: branched });
    await deskReady(page);
    check(`${name}: put back, the line returns`, (await page.locator('#lines line.dan-link').count()) === 1);
    // the thread in Find
    await page.fill('#find', 'המר');
    await page.keyboard.press('Enter');
    await page.locator('#results-threads .result-thread').first().waitFor({ timeout: 5000 });
    const tline = await page.locator(`#results-threads .result-thread[data-key="${W}"]`).innerText();
    check(`${name}: Find's thread tells the link: "· linked to <word>: <sentence>"`, tline.includes(`linked to ${SENT.slice(0, 0)}`) && tline.includes(`: ${SENT}`), tline);
    await page.fill('#find', '');
    await page.keyboard.press('Escape');

    // --- 4. the sheet for the reMarkable ---------------------------------------------------------------
    check(`${name}: the strip reads "not yet sent to the reMarkable"`, (await page.locator('#desk-sheets').innerText()) === '· not yet sent to the reMarkable');
    await both(page, 'strip-desktop');
    const nav = page.waitForURL(/\/desk\/sheet\/\d+$/, { timeout: 15000 });
    await page.locator('#make-sheet').click();
    await nav;
    await page.waitForFunction(() => document.body.dataset.pages, null, { timeout: 10000 });
    const sheetId = Number(page.url().split('/').pop());
    const pages = page.locator('.page');
    const n = await pages.count();
    const head = await pages.first().locator('.where').innerText();
    check(`${name}: the sheet is headed "From the desk of <desk> · sheet 1 of N"`, head === `From the desk of ${desk.desk.name} · sheet 1 of ${n}`, head);
    const sheet = (await api('GET', `/sheets/${sheetId}`)).body;
    check(`${name}: one page per group at least`, n >= sheet.groups.length, `${n} pages, ${sheet.groups.length} groups`);
    const first = await pages.first().innerText();
    const all = await page.locator('#sheet-pages').innerText();
    check(`${name}: the linked group first: the card with nikud, the kept example with its source, "you linked these: <sentence>"; the other cards and their notes after`,
      first.includes('הִימֵּר') && first.includes('— ynet') && first.includes(`you linked these: ${SENT}`) && all.includes('הַסְלָמָה') && all.includes('same root as סולם'), first.slice(0, 600));
    const prompts = await page.locator('.prompt').allInnerTexts();
    check(`${name}: numbered writing prompts, none naming a word that is not on the sheet`, prompts.length >= 3 && /^1\./.test(prompts[0]) && !prompts.some((p) => p.includes('לנדוד')), JSON.stringify(prompts));
    check(`${name}: every page closes with "Nothing you write here goes back to the desk…"`, (await page.locator('.page-foot').allInnerTexts()).every((t) => t === 'Nothing you write here goes back to the desk. The desk only remembers that this sheet was made.'));
    check(`${name}: the page says how to get it onto the reMarkable, and has no desk buttons`, (await page.locator('#how').innerText()).startsWith('Print this page to PDF, then send it to the reMarkable') && (await page.locator('.page button, .page .desk-strip').count()) === 0);
    const ratio = await pages.first().evaluate((e) => e.offsetHeight / e.offsetWidth);
    check(`${name}: a page is in the reMarkable's proportion (3:4, 1404×1872)`, Math.abs(ratio - 1872 / 1404) < 0.01, String(ratio));
    const rtl = await page.locator('.s-ex').first().evaluate((e) => getComputedStyle(e).direction);
    const face = await page.locator('.s-head .pointed').first().evaluate((e) => getComputedStyle(e).fontFamily);
    check(`${name}: Hebrew right to left, headwords in the site's pointed face`, rtl === 'rtl' && /Noto Serif Hebrew/.test(face), `${rtl} ${face}`);
    await page.screenshot({ path: join(out, 'paper-sheet-screen-light.png'), fullPage: true });
    // as it prints: one page, light only
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    await page.setViewportSize({ width: 702, height: 936 });
    await page.waitForTimeout(200);
    const printed = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.bar')).display, bg: getComputedStyle(document.querySelector('.page')).backgroundColor, ink: getComputedStyle(document.body).color }));
    check('the sheet printed: no bar, white paper and dark ink even when the device asks for dark', printed.bar === 'none' && printed.bg === 'rgb(255, 255, 255)' && contrast(printed.ink, printed.bg) >= 12, JSON.stringify(printed));
    await page.screenshot({ path: join(out, 'paper-sheet-printed-light.png'), clip: { x: 0, y: 0, width: 702, height: 936 } });
    const pdf = await page.pdf({ width: '702px', height: '936px', printBackground: true, preferCSSPageSize: true });
    check('printed to PDF by the browser, the sheet makes one PDF page per sheet page', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === n, `${(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length} vs ${n}`);
    await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 800 });
    // back on the desk
    await deskReady(page);
    const sent = await page.locator('#desk-sheets').innerText();
    check(`${name}: back on the desk, "sent to the reMarkable 1 time, <today>"`, /^· sent to the reMarkable 1 time, last \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(sent), sent);
    await page.locator(`.dcard[data-key="${W}"]`).hover();
    await page.locator(`.dcard[data-key="${W}"] .dacts button`, { hasText: 'open' }).click();
    await page.locator('#grow .grow-foot').first().waitFor({ timeout: 5000 });
    const foot = await page.locator('#grow .grow-foot').first().innerText();
    check(`${name}: the card's footer says "on 1 sheet"`, /on 1 sheet$/.test(foot), foot);
    const linkedLine = await page.locator('#grow .linked-line').innerText().catch(() => '');
    check(`${name}: the opened card says what it is linked to`, linkedLine.includes(SENT), linkedLine);
    await page.locator('#full-card .close').click();

    // a group too long for one page continues on the next
    const long = (await api('POST', '/desks')).body.desk;
    let prev = (await api('POST', '/notes', { text: 'the first of a long thread '.repeat(6), desk_id: long.id })).body.card.key;
    for (let i = 0; i < 9; i++) prev = (await api('POST', '/notes', { text: `step ${i + 2}: ${'a line that takes room on the sheet, '.repeat(5)}`, desk_id: long.id, born_from: prev })).body.card.key;
    const longSheet = (await api('POST', `/desks/${long.id}/sheets`)).body.sheet;
    await page.goto(`${base}/desk/sheet/${longSheet.id}`);
    await page.waitForFunction(() => document.body.dataset.pages, null, { timeout: 10000 });
    // a face arriving late lays the pages again: wait for the faces to settle
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const ln = await page.locator('.page').count();
    const heads = await page.locator('.page .group').allInnerTexts();
    check('a group that does not fit on one page continues on the next, numbered "sheet N of M"', longSheet.groups.length === 1 && ln >= 2 && heads.slice(1).every((h) => /continued/.test(h)) && (await page.locator('.page').last().locator('.where').innerText()).endsWith(`sheet ${ln} of ${ln}`), JSON.stringify([ln, heads]));
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.page-body')].some((b) => b.scrollHeight > b.clientHeight + 1));
    check('no page cuts off what it holds', !clipped);
    await page.screenshot({ path: join(out, 'paper-sheet-continued-light.png'), fullPage: true });
    await api('POST', `/desks/${desk.desk.id}/open`);

    check(`${name}: no screen of this session shows "map", "met", "touch" or "spot"`, page.jargon.length === 0, page.jargon.join(' | '));
    await ctx.close();
  }

  // ================================== phone ===========================================
  {
    const { ctx, page } = await context({ width: 412, height: 915 }, true);
    const name = 'phone';
    // the installable app
    await page.goto(`${base}/desk`);
    const man = await page.locator('link[rel=manifest]').getAttribute('href');
    const sw = await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => Boolean(r && (r.active || r.installing || r.waiting))), null, { timeout: 8000 }).then(() => true).catch(() => false);
    check(`${name}: the page names its manifest and its service worker registers (installable)`, man === '/manifest.webmanifest' && sw);
    // a line shared from another app
    const line = 'שמעתי בפודקאסט: הם ממשיכים להמר על הריבית';
    await page.goto(`${base}/share?text=${encodeURIComponent(line)}`);
    await page.waitForFunction(() => window.Desk && window.Desk.desk, null, { timeout: 8000 });
    await page.locator('#desk-msg').waitFor({ timeout: 5000 });
    const msg = await page.locator('#desk-msg').innerText();
    check(`${name}: a shared line says "Saved to tonight's desk, unplaced. Put it somewhere when you're at the computer."`, msg === "Saved to tonight's desk, unplaced. Put it somewhere when you're at the computer.", msg);
    const firstItem = await page.locator('#list .ditem').first().innerText();
    check(`${name}: the caught card is first in the list`, firstItem.includes('בפודקאסט'), firstItem);
    check(`${name}: the address is /desk again, so a reload saves nothing twice`, new URL(page.url()).pathname === '/desk');
    await both(page, 'caught-phone');
    const cards = (await api('GET', '/desks/current')).body.cards.filter((c) => c.kind === 'note' && (c.text || '').includes('בפודקאסט'));
    await page.reload();
    await page.waitForFunction(() => window.Desk && window.Desk.desk, null, { timeout: 8000 });
    check(`${name}: reloading does not save it twice`, cards.length === 1 && (await api('GET', '/desks/current')).body.cards.filter((c) => c.kind === 'note' && (c.text || '').includes('בפודקאסט')).length === 1);
    // a share from a link on another website: shown, saved only on a tap
    await page.goto(`${base}/share/confirm?text=${encodeURIComponent('from a web page')}`);
    await page.locator('.share-bar').waitFor({ timeout: 8000 });
    const unsaved = (await api('GET', '/desks/current')).body.cards.some((c) => c.kind === 'note' && c.text === 'from a web page');
    await both(page, 'share-ask-phone');
    await page.locator('.share-bar button', { hasText: "Save to tonight's desk" }).click();
    await page.locator('.share-bar').waitFor({ state: 'detached', timeout: 5000 });
    const saved = (await api('GET', '/desks/current')).body.cards.some((c) => c.kind === 'note' && c.text === 'from a web page');
    check(`${name}: a share from another website is shown and saved only when Dan taps "Save to tonight's desk"`, !unsaved && saved && (await page.locator('#desk-msg').innerText()).startsWith("Saved to tonight's desk"));
    check(`${name}: the strip says the phone opens cards and does not move them`, (await page.locator('.strip-line').innerText()).includes("you can't move them here, only open them"));
    check(`${name}: no "Link these" or sheet button on the phone`, await page.locator('#link-these').isHidden() && await page.locator('#make-sheet').isHidden());
    // ink on the phone: shown, not drawn
    await page.locator(`#list [data-key="${W}"] .ditem-open`).click();
    await page.locator('#grow .layer.ink').waitFor({ timeout: 5000 });
    check(`${name}: the opened card shows its ink, with no drawing controls`, (await page.locator('#grow .layer.ink path').count()) === 1 && (await page.locator('#grow .ink-area.editable, #grow .draw-here, #grow .ink-undo').count()) === 0);
    await page.locator('#grow .layer.ink').scrollIntoViewIfNeeded();
    await both(page, 'ink-phone');
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    check(`${name}: the page fits the phone's width`, fits);
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
if (failed) { console.log(`\n${failed} paper page check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} paper page checks passed`);
