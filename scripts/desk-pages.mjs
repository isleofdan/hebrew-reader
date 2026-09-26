// The desk's page checks (session twelve), against the local mocks, at
// computer (1280×800) and phone (412×915) size, light and dark; screenshots
// into docs/screenshots/desk-*.png. Run by `npm run screenshots` after the
// other page checks, or alone:
//   node scripts/desk-pages.mjs
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

const PORT = 8805, OR_PORT = 8806, SPINE_PORT = 8807;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-desk-'));
const kids = [];
const start = (args, env = {}) => { const k = spawn('node', args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' }); kids.push(k); return k; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url) { for (let i = 0; i < 50; i++) { try { await fetch(url); return; } catch { await wait(100); } } throw new Error(`nothing at ${url}`); }

start(['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start(['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start(['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'd'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const NAME = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) · (morning|afternoon|evening|night)$/;

// WCAG contrast of what the browser painted
const rgb = (css) => (css.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number).map((c) => c / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function contrast(a, b) {
  const L = (css) => { const [r, g, bl] = rgb(css).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const paint = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);

// the server's API as the signed-in page uses it
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
  const context = async (viewport, isMobile, theme) => {
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1, locale: 'en-GB', ignoreHTTPSErrors: true, colorScheme: theme });
    await ctx.addCookies([{ name: cname, value: cvalue, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log('page error:', e.message); failed++; });
    page.jargon = [];
    const shoot = page.screenshot.bind(page);
    // every shot is read for the words Dan called jargon, and the ones the brief
    // names; kept, as in the other checks: "Root radiation map", an exercise in
    // his own lesson instructions
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.replace(/Root radiation map/gi, '').match(/\b(maps?|mapped|met|touch(es|ed)?|spots?)\b/gi);
      if (hits) page.jargon.push(`${opts.path.split('/').pop()}: ${[...new Set(hits)].join(', ')}`);
      return shoot(opts);
    };
    return { ctx, page };
  };
  const saved = (page, method = 'PATCH') => page.waitForResponse((r) => r.request().method() === method && /\/(desks|notes)\//.test(r.url()) && r.ok(), { timeout: 5000 });
  const placeOf = async (key) => (await api('GET', '/desks/current')).body.cards.find((c) => c.key === key).place;

  // --- step 2: the desk page, computer --------------------------------------------
  {
    const { ctx, page } = await context({ width: 1280, height: 800 }, false, 'light');
    await page.goto(`${base}/desk`);
    await page.locator('#empty:not(.hidden)').waitFor({ timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    const emptyText = await page.locator('#empty').innerText();
    const name = await page.locator('#desk-name').inputValue();
    check('desktop: a first visit opens an empty desk named for now, saying plainly it holds nothing yet',
      /This desk holds nothing yet\./.test(emptyText) && NAME.test(name) && (await page.locator('#desk-count').innerText()) === 'no cards', `${name} | ${emptyText}`);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: join(out, `desk-empty-${theme}-desktop.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // two word cards the reader has, put on the desk from their cards
    for (const w of ['להמר', 'הסלמה']) { await api('POST', '/lookup', { surface: w, sentence: w }); await api('POST', '/desks/put', { surface: w, sentence: w }); }
    await page.reload();
    await page.locator('.dcard').nth(1).waitFor();
    const words = page.locator('.dcard.word');
    const lehamer = page.locator('.dcard.word', { hasText: 'ה.מ.ר' });
    const key = await lehamer.getAttribute('data-key');
    check('desktop: a word card shows what the reader\'s card shows: pointed headword, the word in the text, root · binyan · meaning, status dot and times seen',
      (await words.count()) === 2 && (await lehamer.locator('.dhead .pointed').innerText()) === 'הִימֵּר' && (await lehamer.locator('.dintext .pointed').innerText()) === 'לְהַמֵּר'
      && /ה\.מ\.ר · Pi'el · to gamble, to bet/.test(await lehamer.locator('.dline').innerText())
      && /^looked up · seen (once|\d+ times)$/.test(await lehamer.locator('.dstatus').innerText()) && (await lehamer.locator('.dot.new').count()) === 1,
      await lehamer.innerText());
    check('desktop: the pointed headword is legible on its card', contrast(await paint(lehamer.locator('.dhead .pointed'), 'color'), await paint(lehamer, 'backgroundColor')) >= 7);

    // drag: moved, saved, still there after a reload
    const box = await lehamer.boundingBox();
    const before = await placeOf(key);
    await page.mouse.move(box.x + 60, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 80, { steps: 5 });
    const moved = saved(page);
    await page.mouse.move(box.x + 360, box.y + 230, { steps: 8 });
    await page.mouse.up();
    await moved;
    await page.reload();
    await page.locator('.dcard').nth(1).waitFor();
    const afterMove = await placeOf(key);
    const drawn = await page.locator(`.dcard[data-key="${key}"]`).boundingBox();
    check('desktop: a dragged card is saved where it was put, with no Save button, and stays there after a reload',
      afterMove.x === before.x + 300 && afterMove.y === before.y + 200 && Math.abs(drawn.x - box.x - 300) < 2 && Math.abs(drawn.y - box.y - 200) < 2
      && (await page.locator('button', { hasText: /^Save$/ }).count()) === 0, JSON.stringify({ before, afterMove }));

    // resize by the corner
    const g = await page.locator(`.dcard[data-key="${key}"] .grip`).boundingBox();
    await page.mouse.move(g.x + 9, g.y + 9);
    await page.mouse.down();
    const resized = saved(page);
    await page.mouse.move(g.x + 89, g.y + 49, { steps: 6 });
    await page.mouse.up();
    await resized;
    await page.reload();
    await page.locator('.dcard').nth(1).waitFor();
    const afterSize = await placeOf(key);
    const drawnSize = await page.locator(`.dcard[data-key="${key}"]`).boundingBox();
    check('desktop: a card resized by its corner keeps its new size after a reload', afterSize.w === before.w + 80 && afterSize.h === before.h + 40 && Math.round(drawnSize.width) === afterSize.w, JSON.stringify(afterSize));

    // click brings to the front: move the other card over this one first
    const other = page.locator('.dcard.word', { hasText: 'escalation' });
    const okey = await other.getAttribute('data-key');
    await api('PATCH', `/desks/${(await api('GET', '/desks/current')).body.desk.id}/cards/${okey}`, { x: afterMove.x + 100, y: afterMove.y + 60, front: true });
    await page.reload();
    await page.locator('.dcard').nth(1).waitFor();
    const zBefore = [(await placeOf(key)).z, (await placeOf(okey)).z];
    const under = await page.locator(`.dcard[data-key="${key}"]`).boundingBox();
    const front = saved(page);
    await page.mouse.click(under.x + 30, under.y + 30);
    await front;
    await page.reload();
    await page.locator('.dcard').nth(1).waitFor();
    const zAfter = [(await placeOf(key)).z, (await placeOf(okey)).z];
    const topHit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('.dcard').dataset.key, [under.x + 130, under.y + 90]);
    check('desktop: a click brings a card to the front, and it is still in front after a reload', zAfter[0] > zAfter[1] && topHit === key, JSON.stringify({ zBefore, zAfter, topHit }));

    // "note on a new card": born from the word card, beside it, a grey line between
    await page.locator(`.dcard[data-key="${key}"] .dacts button`, { hasText: 'note on a new card' }).click();
    const note = page.locator('.dcard.note');
    await note.waitFor();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('dnote-edit'));
    await page.keyboard.type('על מה מהמרים? bets on');
    await saved(page);
    const nkey = await note.getAttribute('data-key');
    await page.reload();
    await page.locator('.dcard.note').waitFor();
    const line = page.locator(`#lines line[data-child="${nkey}"][data-parent="${key}"]`);
    const lineZ = await page.evaluate(() => [getComputedStyle(document.querySelector('#lines')).zIndex, getComputedStyle(document.querySelector('.dcard')).zIndex].map(Number));
    check('desktop: "note on a new card" makes a note born from the card, focused for typing, beside it, saved as typed, a grey line drawn between them behind the cards',
      focused && (await page.locator('.dcard.note .dnote-edit').inputValue()) === 'על מה מהמרים? bets on' && (await line.count()) === 1 && lineZ[0] < lineZ[1]
      && (await api('GET', '/desks/current')).body.links.some((l) => l.child === nkey && l.parent === key), JSON.stringify({ focused, lineZ }));
    const noteBox = page.locator('.dcard.note');
    check('desktop: a note card sits on a pale yellow ground, its text legible', contrast(await paint(noteBox.locator('.dnote-edit'), 'color'), await paint(noteBox, 'backgroundColor')) >= 7
      && (await paint(noteBox, 'backgroundColor')) !== (await paint(page.locator('.dcard.word').first(), 'backgroundColor')));

    // "New card": a note at the next free spot, text box focused
    await page.click('#new-card');
    await page.locator('.dcard.note').nth(1).waitFor();
    const nf = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('dnote-edit'));
    await page.keyboard.type('הסלמה — escalation, not הצלמה');
    await saved(page);
    await page.reload();
    await page.locator('.dcard.note').nth(1).waitFor();
    const texts = await page.locator('.dcard.note .dnote-edit').evaluateAll((els) => els.map((e) => e.value));
    check('desktop: "New card" makes a note card with its text box focused; what is typed is still there after a reload', nf && texts.includes('הסלמה — escalation, not הצלמה') && (await page.locator('#desk-count').innerText()) === '4 cards', JSON.stringify(texts));

    // laid out tidily for the pictures: two word cards, a note born from one
    {
      const cur = (await api('GET', '/desks/current')).body;
      const notes = cur.cards.filter((c) => c.kind === 'note');
      const at = { [key]: { x: 60, y: 40, w: 280, h: 196 }, [okey]: { x: 400, y: 40, w: 260, h: 196 },
        [nkey]: { x: 60, y: 290, w: 280, h: 130 }, [notes.find((c) => c.key !== nkey).key]: { x: 720, y: 40, w: 240, h: 150 } };
      for (const [k, p] of Object.entries(at)) await api('PATCH', `/desks/${cur.desk.id}/cards/${k}`, p);
      await page.reload();
      await page.locator('.dcard').nth(3).waitFor();
      await page.mouse.move(1200, 700);
    }
    // each theme, the whole desk
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(200);
      const w = page.locator('.dcard.word').first();
      check(`desktop ${theme}: card text is legible on the desk`, contrast(await paint(w.locator('.dline'), 'color'), await paint(w, 'backgroundColor')) >= 4.5
        && contrast(await paint(page.locator('#desk-name'), 'color'), await paint(page.locator('.desk-strip'), 'backgroundColor')) >= 4.5);
      await page.screenshot({ path: join(out, `desk-${theme}-desktop.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // remove from the desk: the placement goes, the card stays
    const rm = saved(page, 'DELETE');
    await page.locator(`.dcard[data-key="${okey}"] .dacts button`, { hasText: 'remove from the desk' }).click();
    await rm;
    await page.reload();
    await page.locator('.dcard').first().waitFor();
    check('desktop: "remove from the desk" takes the card off this desk (it stays findable)', (await page.locator(`.dcard[data-key="${okey}"]`).count()) === 0
      && (await api('GET', `/desks/find?q=${encodeURIComponent('הסלמה')}`)).body.cards.some((c) => c.key === okey));
    await api('POST', `/desks/${(await api('GET', '/desks/current')).body.desk.id}/cards`, { card: okey, x: 40, y: 330 });

    // "New desk": a fresh one, empty, named for now; the first is kept
    const firstDesk = (await api('GET', '/desks/current')).body.desk;
    await page.click('#new-desk');
    await page.locator('#empty:not(.hidden)').waitFor();
    const nd = await page.locator('#desk-name').inputValue();
    await page.reload();
    await page.locator('#empty:not(.hidden)').waitFor();
    check('desktop: "New desk" starts a fresh, empty desk named for now, and a reload keeps it as the current desk',
      NAME.test(nd) && (await api('GET', '/desks/current')).body.desk.id !== firstDesk.id && (await api('GET', '/desks')).body.items.length === 2, nd);
    // back to the first desk for the next steps
    await api('POST', `/desks/${firstDesk.id}/open`);
    check('desktop: no screen of the desk shows "map", "met", "touch" or "spot"', page.jargon.length === 0, page.jargon.join('; '));
    await ctx.close();
  }

  // --- step 3: "Put on the desk" from the reader, the phone page and a lesson -------
  const sample = readFileSync(join(here, 'sample-article.txt'), 'utf8');
  const article = (await api('POST', '/articles', { text: sample })).body;
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel HEB 15jun26.pdf'))], { type: 'application/pdf' }), 'Daniel HEB 15jun26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  for (const [name, viewport, isMobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(viewport, isMobile, 'light');
    const onDesk = async () => (await api('GET', '/desks/current')).body.cards.length;
    const cardEl = page.locator(isMobile ? '#card-phone' : '#card-desktop');
    const tap = async (loc) => { await loc.scrollIntoViewIfNeeded(); if (isMobile) await loc.tap(); else await loc.click(); };

    // the reader
    const word = name === 'desktop' ? 'שנאלצה' : 'מקדם';
    await page.goto(`${base}/read.html?id=${article.id}`);
    await tap(page.locator(`.w[data-surface="${word}"]`).first());
    await cardEl.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    let n0 = await onDesk();
    await tap(cardEl.locator('[data-act=desk]'));
    await cardEl.locator('.foot', { hasText: /^On the desk/ }).waitFor({ timeout: 5000 });
    const n1 = await onDesk();
    const deskName = (await api('GET', '/desks/current')).body.desk.name;
    check(`${name}: "Put on the desk" on the reader's card puts it on the current desk and says so quietly, with a way to the desk`,
      n1 === n0 + 1 && (await cardEl.locator('.foot').innerText()).startsWith(`On the desk “${deskName}”.`) && (await cardEl.locator('.foot a[href="/desk"]').count()) === 1, `${JSON.stringify(await cardEl.locator('.foot').innerText())} vs ${JSON.stringify(deskName)} (${n0} -> ${n1})`);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-put-reader-${theme}-${name}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await tap(cardEl.locator('[data-act=desk]'));
    await cardEl.locator('.foot', { hasText: 'Already on the desk' }).waitFor({ timeout: 5000 });
    check(`${name}: putting the same card twice does nothing, and says so quietly`, (await onDesk()) === n1, await cardEl.locator('.foot').innerText());

    // the phone page's quick lookup
    const looked = name === 'desktop' ? 'שביתה' : 'נלחם';
    await page.goto(`${base}/phone`);
    await page.fill('#lookup', looked);
    await page.click('#lookup-go');
    const lc = page.locator('#card-lookup');
    await lc.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    n0 = await onDesk();
    await tap(lc.locator('[data-act=desk]'));
    await lc.locator('.foot', { hasText: /^On the desk/ }).waitFor({ timeout: 5000 });
    const cur = (await api('GET', '/desks/current')).body;
    check(`${name}: "Put on the desk" on the phone page's quick lookup puts that card on the desk`, (await onDesk()) === n0 + 1 && cur.cards.some((c) => c.kind === 'word' && c.card.surface === looked));
    await lc.scrollIntoViewIfNeeded();
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-put-phone-${theme}-${name}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // a word in a lesson's word list
    const lw = name === 'desktop' ? 'נחתם' : 'יו״ש';
    await page.goto(`${base}/lesson.html?id=${lesson.id}`);
    await page.waitForSelector('#items .w');
    await tap(page.locator('#items .w', { hasText: lw }).first());
    await cardEl.locator('.meaning:not(:empty)').waitFor({ timeout: 10000 });
    n0 = await onDesk();
    await tap(cardEl.locator('[data-act=desk]'));
    await cardEl.locator('.foot', { hasText: /^On the desk/ }).waitFor({ timeout: 5000 });
    const cur2 = (await api('GET', '/desks/current')).body;
    check(`${name}: "Put on the desk" on a lesson word's card puts that card on the desk`, (await onDesk()) === n0 + 1 && cur2.cards.some((c) => c.kind === 'word' && c.card.surface === lw));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-put-lesson-${theme}-${name}.png`) });
    }
    check(`${name}: no screen here shows "map", "met", "touch" or "spot"`, page.jargon.length === 0, page.jargon.join('; '));
    await ctx.close();
  }

  // --- step 4: all desks, and coming back -----------------------------------------------
  {
    const { ctx, page } = await context({ width: 1280, height: 800 }, false, 'light');
    const first = (await api('GET', '/desks/current')).body;
    await page.goto(`${base}/desk`);
    await page.locator('.dcard').first().waitFor();
    await page.click('#show-desks');
    await page.locator('.desk-tile').nth(1).waitFor();
    const listed = (await api('GET', '/desks')).body.items;
    const tile = page.locator(`.desk-tile[data-id="${first.desk.id}"]`);
    // the thumbnail's rectangles, against the placements, scaled as drawn
    const rects = await tile.locator('svg.thumb rect:not(.th-frame)').evaluateAll((rs) => rs.map((r) => ({ kind: r.getAttribute('class').slice(3), x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') })));
    const ps = first.cards.map((c) => ({ ...c.place, kind: c.kind })).filter((p) => p.x !== null);
    const minX = Math.min(...ps.map((p) => p.x)), minY = Math.min(...ps.map((p) => p.y));
    const k = Math.min(160 / (Math.max(...ps.map((p) => p.x + p.w)) - minX), 92 / (Math.max(...ps.map((p) => p.y + p.h)) - minY), 0.25);
    const want = ps.map((p) => ({ kind: p.kind, x: 8 + (p.x - minX) * k, y: 8 + (p.y - minY) * k, w: p.w * k, h: p.h * k }));
    const near = (a, b) => Math.abs(a - b) < 0.02;
    check('desktop: the Desks list shows every desk newest first, each drawn small as its layout — rectangles where its cards lie, notes yellow — with its name and card count',
      (await page.locator('.desk-tile').count()) === listed.length && (await page.locator('.desk-tile').first().getAttribute('data-id')) === String(listed[0].id)
      && rects.length === want.length && want.every((w, i) => w.kind === rects[i].kind && near(w.x, rects[i].x) && near(w.y, rects[i].y) && near(w.w, rects[i].w) && near(w.h, rects[i].h))
      && (await tile.locator('.tile-meta').innerText()).startsWith(`${ps.length} cards`)
      && (await paint(tile.locator('.th-note').first(), 'fill')) !== (await paint(tile.locator('.th-word').first(), 'fill')), JSON.stringify({ rects: rects.slice(0, 2), want: want.slice(0, 2) }));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-list-${theme}-desktop.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    // rename inline
    const nameBox = tile.locator('.tile-name');
    await nameBox.fill('Evening with להמר');
    const renamed = saved(page);
    await nameBox.press('Enter');
    await renamed;
    check('desktop: a desk renamed in the list keeps its new name (and the strip shows it)', (await api('GET', `/desks/${first.desk.id}`)).body.desk.name === 'Evening with להמר'
      && (await page.locator('#desk-name').inputValue()) === 'Evening with להמר');
    // open another desk, then come back: exactly as left
    const other = listed.find((d) => d.id !== first.desk.id);
    await page.locator(`.desk-tile[data-id="${other.id}"] .thumb-open`).click();
    await page.locator('#empty:not(.hidden)').waitFor();
    const switched = (await api('GET', '/desks/current')).body.desk.id === other.id;
    await page.reload();
    await page.locator('#empty:not(.hidden)').waitFor();
    await page.click('#show-desks');
    await page.locator(`.desk-tile[data-id="${first.desk.id}"] .thumb-open`).click();
    await page.locator('.dcard').first().waitFor();
    const drawn = await page.locator('.dcard').evaluateAll((els) => els.map((e) => ({ key: e.dataset.key, x: parseFloat(e.style.left), y: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) })));
    check('desktop: opening a desk from the list makes it the current desk, and opening the first again brings every card back exactly where it was left',
      switched && drawn.length === first.cards.length && first.cards.every((c) => drawn.some((d) => d.key === c.key && d.x === c.place.x && d.y === c.place.y && d.w === c.place.w && d.h === c.place.h))
      && (await api('GET', '/desks/current')).body.desk.id === first.desk.id, JSON.stringify(drawn.slice(0, 2)));
    await ctx.close();
  }

  // --- step 5: Find --------------------------------------------------------------------
  for (const [name, viewport, isMobile] of [['desktop', { width: 1280, height: 800 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const { ctx, page } = await context(viewport, isMobile, 'light');
    const cur = (await api('GET', '/desks/current')).body;
    const lehamer = cur.cards.find((c) => c.kind === 'word' && c.card.surface === 'להמר');
    await page.goto(`${base}/desk`);
    await page.locator(isMobile ? '.ditem' : '.dcard').first().waitFor();
    const results = async (q) => {
      await page.fill('#find', q);
      await page.locator('#results-line', { hasText: `"${q}"` }).waitFor({ timeout: 5000 });
      return page.locator('#results-cards .result-card').evaluateAll((els) => els.map((e) => e.dataset.key));
    };
    const withPoints = await results('לְהַמֵּר');
    const without = await results('להמר');
    check(`${name}: Find — Hebrew typed with nikud finds the same cards as without`, withPoints.includes(lehamer.key) && JSON.stringify(withPoints) === JSON.stringify(without), `${withPoints} | ${without}`);
    await results('המר');
    const deskHit = page.locator(`#results-desks .result-desk[data-id="${cur.desk.id}"]`);
    const whyText = await deskHit.locator('.result-meta').innerText();
    check(`${name}: Find — the desk is found through the card it holds, naming it ("להמר and 1 card from it"), drawn small as its layout`,
      /holds להמר and 1 card from it/.test(whyText) && (await deskHit.locator('svg.thumb rect.th-word').count()) > 0
      && (await page.locator('#results-cards .result-card', { hasText: 'על מה מהמרים' }).count()) === 1, `${whyText} | thumb words ${await deskHit.locator('svg.thumb rect.th-word').count()} | notes ${await page.locator('#results-cards .result-card', { hasText: 'על מה מהמרים' }).count()} | ${JSON.stringify(await page.locator('#results-cards').innerText())}`);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      const rc = page.locator('#results-cards .result-card').first();
      check(`${name} ${theme}: Find results are legible`, contrast(await paint(rc.locator('.dline'), 'color'), await paint(rc, 'backgroundColor')) >= 4.5
        && contrast(await paint(deskHit.locator('.result-meta'), 'color'), await paint(page.locator('#results'), 'backgroundColor')) >= 4.5);
      await page.screenshot({ path: join(out, `desk-find-${theme}-${name}.png`), fullPage: isMobile });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // a card result onto a desk that lacks it: a placement, not a copy
    const fresh = (await api('POST', '/desks')).body.desk;
    await page.reload();
    await page.locator('#empty:not(.hidden)').waitFor();
    await results('המר');
    const src = page.locator(`#results-cards .result-card[data-key="${lehamer.key}"]`);
    if (isMobile) {
      await src.locator('button', { hasText: 'Put on this desk' }).tap();
    } else {
      await src.dragTo(page.locator('#surface'), { targetPosition: { x: 200, y: 300 } });
    }
    await page.locator('#desk-msg', { hasText: 'Put on this desk' }).waitFor({ timeout: 5000 });
    const got = (await api('GET', `/desks/${fresh.id}`)).body.cards;
    const onBoth = (await api('GET', `/desks/find?q=${encodeURIComponent('להמר')}`)).body.cards.find((c) => c.key === lehamer.key).desks.map((d) => d.id);
    check(`${name}: a card result ${isMobile ? 'put' : 'dragged'} onto the desk is placed there — the same card, now on both desks${isMobile ? '' : ', where it was dropped'}`,
      got.length === 1 && got[0].key === lehamer.key && onBoth.includes(fresh.id) && onBoth.includes(cur.desk.id) && (isMobile || (Math.abs(got[0].place.x - 200) < 3 && Math.abs(got[0].place.y - 300) < 3)), JSON.stringify(got.map((c) => c.place)));
    // back to the first desk
    await api('POST', `/desks/${cur.desk.id}/open`);

    // the entry from the reader's top strip
    if (!isMobile) {
      await page.goto(`${base}/read.html?id=${article.id}`);
      await page.fill('.topfind input', 'המר');
      await page.press('.topfind input', 'Enter');
      await page.waitForURL(/\/desk\?find=/);
      await page.locator('#results-cards .result-card').first().waitFor({ timeout: 5000 });
      check('desktop: Find from the reader\'s top strip opens the desk with the word found', (await page.locator('#find').inputValue()) === 'המר'
        && (await page.locator(`#results-cards .result-card[data-key="${lehamer.key}"]`).count()) === 1);
    }
    check(`${name}: no Find screen shows "map", "met", "touch" or "spot"`, page.jargon.length === 0, page.jargon.join('; '));
    await ctx.close();
  }

  // --- step 7: phone width — a list, grouped by which card grew from which ------------------
  {
    const { ctx, page } = await context({ width: 412, height: 915 }, true, 'light');
    const expected = (view) => {
      const onDesk = new Set(view.cards.map((c) => c.key));
      const parent = new Map(view.links.filter((l) => onDesk.has(l.child) && onDesk.has(l.parent)).map((l) => [l.child, l.parent]));
      const order = (a, b) => { const ua = a.place.x === null, ub = b.place.x === null; if (ua !== ub) return ua ? -1 : 1; if (ua) return b.place.z - a.place.z; return a.place.y - b.place.y || a.place.x - b.place.x; };
      const outList = [];
      const walk = (c, depth) => { outList.push([c.key, depth]); for (const k of view.cards.filter((x) => parent.get(x.key) === c.key).sort(order)) walk(k, depth + 1); };
      for (const c of view.cards.filter((x) => !parent.has(x.key)).sort(order)) walk(c, 0);
      return outList;
    };
    let view = (await api('GET', '/desks/current')).body;
    await page.goto(`${base}/desk`);
    await page.locator('.ditem').first().waitFor();
    const drawnOrder = async () => page.locator('.ditem').evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.style.getPropertyValue('--depth'))]));
    const want = expected(view);
    const got = await drawnOrder();
    check('phone: the desk is a list — no arranging — of its cards top to bottom as they lie, each card followed by the cards grown from it, set in',
      JSON.stringify(got) === JSON.stringify(want) && (await page.locator('.dcard').count()) === 0 && got.some(([, d]) => d === 1) && !(await page.locator('#plane').isVisible()), JSON.stringify({ got, want }));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-${theme}-phone.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    // a card opens its full view
    await page.locator('.ditem.word', { hasText: 'ה.מ.ר' }).locator('button').tap();
    await page.locator('#full:not(.hidden) #full-card').waitFor();
    check('phone: a card opens its full view — the reader\'s card, with its note and buttons', (await page.locator('#full-card .surface .pointed').innerText()) === 'הִימֵּר'
      && (await page.locator('#full-card .meaning').innerText()) === 'to gamble, to bet' && (await page.locator('#full-card .actions button', { hasText: 'Note on a new card' }).count()) === 1);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-card-${theme}-phone.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#full-card .close').tap();
    // "New card": typed here, on the current desk, not yet placed
    await page.locator('#new-card').tap();
    await page.locator('#full:not(.hidden) #full-note').waitFor();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'full-note-text');
    await page.keyboard.type('לשאול את גיא על הסלמה');
    await saved(page);
    await page.locator('#full-note .close').tap();
    view = (await api('GET', '/desks/current')).body;
    const typed = view.cards.find((c) => c.kind === 'note' && c.text === 'לשאול את גיא על הסלמה');
    const first = (await drawnOrder())[0];
    check('phone: "New card" opens a note to type in; it lands on the current desk not yet placed, at the top of the list',
      focused && typed && typed.place.x === null && typed.place.y === null && first[0] === typed.key && JSON.stringify(await drawnOrder()) === JSON.stringify(expected(view)), JSON.stringify({ focused, typed: typed && typed.place, first }));
    await page.reload();
    await page.locator('.ditem').first().waitFor();
    check('phone: after a reload the typed card is still there, first', (await drawnOrder())[0][0] === typed.key && (await page.locator('.ditem').first().innerText()).includes('לשאול את גיא'));
    // the Desks list on the phone
    await page.locator('#show-desks').tap();
    await page.locator('.desk-tile').first().waitFor();
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-list-${theme}-phone.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    // an empty desk on the phone
    const back = view.desk.id;
    await api('POST', '/desks');
    await page.goto(`${base}/desk`);
    await page.locator('#empty:not(.hidden)').waitFor();
    check('phone: an empty desk says plainly that it holds nothing yet', /This desk holds nothing yet\./.test(await page.locator('#empty').innerText()));
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, `desk-empty-${theme}-phone.png`) });
    }
    await api('POST', `/desks/${back}/open`);
    check('phone: no desk screen shows "map", "met", "touch" or "spot"', page.jargon.length === 0, page.jargon.join('; '));
    await ctx.close();

    // the computer gives the card typed on the phone the next free spot
    const { ctx: c2, page: p2 } = await context({ width: 1280, height: 800 }, false, 'light');
    await p2.goto(`${base}/desk`);
    await p2.locator(`.dcard[data-key="${typed.key}"]`).waitFor();
    await saved(p2).catch(() => null);
    await p2.waitForTimeout(300);
    const placed = (await api('GET', '/desks/current')).body.cards.find((c) => c.key === typed.key).place;
    check('desktop: a card typed on the phone takes the next free spot when the desk opens on the computer, and that is saved', placed.x !== null && placed.y !== null, JSON.stringify(placed));
    await c2.close();
  }

  await browser.close();
} catch (e) {
  failed++;
  console.error('FAIL', e);
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} desk check(s) failed` : '\nall desk checks passed');
process.exit(failed ? 1 : 0);
