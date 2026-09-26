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
    // every shot is read for the words Dan called jargon, and the ones the brief names
    page.screenshot = async (opts) => {
      const visible = await page.evaluate(() => document.body.innerText).catch(() => '');
      const hits = visible.match(/\b(maps?|mapped|met|touch(es|ed)?|spots?)\b/gi);
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
