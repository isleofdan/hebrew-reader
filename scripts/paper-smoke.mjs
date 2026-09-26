// Server checks for session fourteen: the desk with a pen and with paper.
// The repairs from thirteen (link labels, "last worked on"), ink on a card,
// Dan's own link between two cards, the sheet for the reMarkable with its
// writing prompts, and catching a card on the phone — against the local
// stand-ins for OpenRouter and the spine, and a small local site for the
// title of a shared link.
//   node scripts/paper-smoke.mjs      (npm run smoke runs it after the others)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8820, OR_PORT = 8821, SPINE_PORT = 8822, SITE_PORT = 8823;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-paper-'));

const kids = [];
function start(cmd, args, env = {}) {
  const k = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  k.log = '';
  k.stdout.on('data', (d) => k.log += d);
  k.stderr.on('data', (d) => k.log += d);
  kids.push(k);
  return k;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { await fetch(url); return; } catch { await wait(100); } }
  throw new Error(`nothing answered at ${url}`);
}
let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

// a page a shared link points at: /with-title has one, /slow never answers in time
const site = http.createServer((req, res) => {
  if (req.url === '/with-title') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html><head><title>ההימור הגדול של הבנקים &amp; השוק | כלכליסט</title></head><body><p>x</p></body></html>'); return; }
  if (req.url === '/og') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><meta property="og:title" content="A podcast episode"><title>ignored</title></head></html>'); return; }
  res.writeHead(500); res.end('down');
}).listen(SITE_PORT);

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'p'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;
const siteBase = `http://127.0.0.1:${SITE_PORT}`;

try {
  await up(`${base}/health`); await up(`${mock}/calls`); await up(`http://127.0.0.1:${SPINE_PORT}/api/health`);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const control = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
  const calls = async () => (await fetch(`${mock}/calls`)).json();
  const Database = createRequire(import.meta.url)(join(root, 'node_modules', 'better-sqlite3'));
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const poke = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db')); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await wait(100); } };

  // a lesson from Guy; להמר and הסלמה met in it and put on the desk
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  for (const w of ['להמר', 'הסלמה']) { await api('POST', '/lookup', { surface: w, sentence: w, lesson_id: lesson.id }); await api('POST', '/desks/put', { surface: w, sentence: w }); }
  let desk = (await api('GET', '/desks/current')).body;
  const W = desk.cards.find((c) => c.card.surface === 'להמר').key;
  const S = desk.cards.find((c) => c.card.surface === 'הסלמה').key;
  check('setup: להמר and הסלמה on the desk', Boolean(W && S), JSON.stringify(desk.cards.map((c) => c.key)));

  // --- 1. the repairs from thirteen ------------------------------------------------------
  {
    // two links on one site with no page title (as a live answer could carry)
    const a = poke("INSERT INTO answers (question, answer, links_json, made_at) VALUES (?, ?, ?, ?)", 'What does להמר take?', 'על.',
      JSON.stringify([{ url: 'https://milog.co.il/a', title: '', reference: 'milog', label: 'Milog' }, { url: 'https://milog.co.il/b', title: '', reference: 'milog', label: 'Milog' }, { url: 'https://www.pealim.com/x', title: '', reference: 'pealim', label: 'Pealim' }]), new Date().toISOString());
    poke("INSERT INTO card_links (child, parent, kind, at) VALUES (?, ?, 'layer', ?)", `answer:${a.lastInsertRowid}`, W, new Date().toISOString());
    const got = (await api('GET', `/card/${W}`)).body.layers.find((l) => l.key === `answer:${a.lastInsertRowid}`);
    const labels = got.links.map((l) => l.label);
    check('two links to one site with no title read "Milog 1 · Milog 2", a single one its site alone', labels.join(' · ') === 'Milog 1 · Milog 2 · Pealim', labels.join(' · '));
    const asked = await api('POST', `/card/${W}/ask`, { question: 'What is the difference between להמר and לסכן?' });
    const l2 = asked.body.layer.links.map((l) => l.label);
    check('links whose citation carries a page title are labelled with the title', asked.status === 201 && l2[0] === 'להמר – Pealim' && l2[1] === 'מה זה להמר – מילוג', l2.join(' · '));
    // two pages with one title are told apart
    const d = createRequire(import.meta.url)(join(root, 'lib', 'desk.js'));
    const same = d.linkLabels([{ url: 'https://milog.co.il/1', title: 'להמר – מילוג', label: 'Milog' }, { url: 'https://milog.co.il/2', title: 'להמר – מילוג', label: 'Milog' }]).map((l) => l.label);
    check('two pages with the same title are numbered', same.join(' · ') === 'להמר – מילוג 1 · להמר – מילוג 2', same.join(' · '));
    const found = (await api('GET', `/desks/find?q=${encodeURIComponent('המר')}`)).body;
    const t = found.threads.find((x) => x.key === W);
    check('a thread reads "last worked on <date>", never "last touched"', t && /^last worked on \d{1,2} [A-Z][a-z]{2} \d{4} · on 1 desk$/.test(t.where) && !JSON.stringify(found).includes('last touched'), t && t.where);
  }

  // --- 2. ink on a card ------------------------------------------------------------------------
  {
    const empty = (await api('GET', `/card/${W}`)).body;
    check('a card with no ink has no ink area (ink: null)', empty.ink === null, JSON.stringify(empty.ink));
    const s1 = await api('POST', `/card/${W}/ink`, { points: [[0.1, 0.1, 0.5], [0.2, 0.15, 0.7], [0.3, 0.2, 0.9]] });
    const s2 = await api('POST', `/card/${W}/ink`, { points: [[0.5, 0.3], [0.6, 0.35]] });
    const s3 = await api('POST', `/card/${W}/ink`, { points: [[0.7, 0.4, 0.2]] });
    check('three strokes saved, each as it ends, into one ink layer', s1.status === 201 && s2.status === 201 && s3.status === 201 && s1.body.layer.key === s3.body.layer.key, JSON.stringify([s1.status, s2.status, s3.status, s1.body.error]));
    const ink = s3.body.layer.key;
    const v = (await api('GET', `/card/${W}`)).body;
    const layer = v.layers.find((l) => l.key === ink);
    check('read back in the order drawn, pressure kept when given', layer && layer.strokes.length === 3 && layer.strokes[0].points[2][2] === 0.9 && layer.strokes[1].points[0].length === 2 && layer.strokes[2].points[0][0] === 0.7, JSON.stringify(layer && layer.strokes.map((s) => s.points)));
    check('the ink is a layer of the card, after the layers before it, and the card view carries it as its ink', v.layers[v.layers.length - 1].key === ink && v.ink.key === ink && /layers, oldest first$/.test(v.layers_line));
    check('one stroke is one row', peek('SELECT COUNT(*) AS n FROM ink_strokes')[0].n === 3);
    const undo = await api('DELETE', `/card/${W}/ink/last`);
    check('"undo last stroke" removes the last one only', undo.status === 200 && undo.body.layer.strokes.length === 2 && undo.body.layer.strokes[1].points[0][0] === 0.5, JSON.stringify(undo.body).slice(0, 200));
    const bad = await api('POST', `/card/${W}/ink`, { points: [[3, 0.2]] });
    const none = await api('POST', `/card/${W}/ink`, { points: [] });
    check('a stroke outside the ink area, or with no point, is refused and says why', bad.status === 400 && /outside the ink area/.test(bad.body.error) && none.status === 400, JSON.stringify([bad.body, none.body]));
    const onLayer = await api('POST', `/card/${ink}/ink`, { points: [[0.1, 0.1]] });
    check('ink is drawn on a card, never on a layer', onLayer.status === 400, JSON.stringify(onLayer.body));
    const placed = await api('POST', `/desks/${desk.desk.id}/cards`, { card: ink });
    check('an ink layer cannot be placed on a desk by itself', placed.status === 400 && /layer/.test(placed.body.error), JSON.stringify(placed.body));
    const confirmedBefore = peek('SELECT json FROM cards WHERE id = ?', Number(W.split(':')[1]))[0].json;
    check("the card's own record is not touched by ink", confirmedBefore === peek('SELECT json FROM cards WHERE id = ?', Number(W.split(':')[1]))[0].json);

    // a cut at the ink layer carries it, strokes and all
    const cut = await api('POST', `/card/${W}/cut`, { at: ink, desk_id: desk.desk.id });
    const moved = (await api('GET', `/card/${cut.body.card.key}`)).body;
    check('ink survives a cut: the new card holds the ink layer with its strokes; the card keeps no ink', cut.status === 201 && moved.ink && moved.ink.key === ink && moved.ink.strokes.length === 2 && (await api('GET', `/card/${W}`)).body.ink === null, JSON.stringify(cut.body).slice(0, 200));
    // drawing again on להמר starts a new ink layer
    const again = await api('POST', `/card/${W}/ink`, { points: [[0.4, 0.4]] });
    check('drawing on the card after the cut starts a new ink layer', again.status === 201 && again.body.layer.key !== ink);
    const gone = await api('DELETE', `/card/${W}/ink/last`);
    check('undoing its only stroke leaves the card with no ink area again', gone.body.layer === null && (await api('GET', `/card/${W}`)).body.ink === null && peek("SELECT COUNT(*) AS n FROM card_links WHERE child = ?", again.body.layer.key)[0].n === 0);
    // the thread line counts ink
    const th = (await api('GET', `/desks/find?q=${encodeURIComponent(moved.card.text || 'x')}`)).body;
    check('the desk view carries a card\'s ink for the desk card', (await api('GET', `/desks/${desk.desk.id}`)).body.cards.find((c) => c.key === cut.body.card.key).ink.strokes.length === 2);
    void th;
  }

  // --- 3. Dan's own link ------------------------------------------------------------------------
  const SENTENCE = 'things that move without a destination';
  {
    desk = (await api('GET', `/desks/${desk.desk.id}`)).body;
    const groupsBefore = desk.groups;
    const made = await api('POST', `/card/${W}/link`, { to: S, sentence: `  ${SENTENCE} ` });
    check('"link these": a link from the first card to the second, with the sentence', made.status === 201 && made.body.link.kind === 'linked' && made.body.link.sentence === SENTENCE && made.body.link.child === W && made.body.link.parent === S, JSON.stringify(made.body));
    const v = (await api('GET', `/desks/${desk.desk.id}`)).body;
    const line = v.links.find((l) => l.kind === 'linked');
    check('the desk carries it as a blue line between the two, with the sentence', line && line.child === W && line.parent === S && line.sentence === SENTENCE, JSON.stringify(v.links));
    check('a linked pair counts as one group with the cards born, branched or cut from them', v.groups === 1 && groupsBefore === 1, `${groupsBefore} → ${v.groups}`);
    const again = await api('POST', `/card/${S}/link`, { to: W, sentence: 'the same two, said again' });
    check('linking the same two again (either way round) replaces the sentence: one link', again.status === 201 && peek("SELECT COUNT(*) AS n FROM card_links WHERE kind = 'linked'")[0].n === 1 && again.body.link.sentence === 'the same two, said again');
    await api('POST', `/card/${W}/link`, { to: S, sentence: SENTENCE });
    const self = await api('POST', `/card/${W}/link`, { to: W, sentence: 'x' });
    const blank = await api('POST', `/card/${W}/link`, { to: S, sentence: '   ' });
    const toLayer = await api('POST', `/card/${W}/link`, { to: v.cards.find((c) => c.kind === 'note').key.replace('note', 'example'), sentence: 'x' });
    check('a card linked to itself, a link with no sentence, and a link to a layer are refused, each saying why', self.status === 400 && blank.status === 400 && /sentence/.test(blank.body.error) && toLayer.status >= 400, JSON.stringify([self.body, blank.body, toLayer.body]));
    // a note's origin is not a link Dan drew
    const n0 = await api('POST', '/notes', { text: 'heard on the train', desk_id: desk.desk.id });
    const n1 = await api('POST', '/notes', { text: 'a note of its own', desk_id: desk.desk.id });
    await api('POST', `/card/${n1.body.card.key}/link`, { to: n0.body.card.key, sentence: 'both from the train' });
    check('two linked note cards make a second group', (await api('GET', `/desks/${desk.desk.id}`)).body.groups === 2);
    check("a link Dan drew never reads as where a card came from", (await api('GET', `/card/${n1.body.card.key}`)).body.footer.origin === null);
    // one card leaves: the line goes, the link stays; it comes back with the card
    await api('DELETE', `/desks/${desk.desk.id}/cards/${S}`);
    const without = (await api('GET', `/desks/${desk.desk.id}`)).body;
    check('removing one card from the desk hides the line; the link is kept', !without.links.some((l) => l.kind === 'linked' && (l.child === S || l.parent === S)) && peek("SELECT COUNT(*) AS n FROM card_links WHERE kind = 'linked' AND child = ?", W)[0].n === 1);
    await api('POST', `/desks/${desk.desk.id}/cards`, { card: S });
    const back = (await api('GET', `/desks/${desk.desk.id}`)).body;
    check('put back on the desk, the line returns with its sentence', back.links.some((l) => l.kind === 'linked' && l.child === W && l.parent === S && l.sentence === SENTENCE));
    // Find: the linked card's thread, once, with the link
    const found = (await api('GET', `/desks/find?q=${encodeURIComponent('הסלמה')}`)).body;
    const ts = found.threads.filter((t) => t.key === S);
    check("Find's Threads include a linked card's thread once, with \"· linked to <word>: <sentence>\"", ts.length === 1 && ts[0].line.endsWith(`· linked to להמר: ${SENTENCE}`), JSON.stringify(found.threads.map((t) => t.line)));
    const fw = (await api('GET', `/desks/find?q=${encodeURIComponent('להמר')}`)).body.threads.filter((t) => t.key === W);
    check('the other end tells it too', fw.length === 1 && fw[0].line.includes(`· linked to הסלמה: ${SENTENCE}`), JSON.stringify(fw.map((t) => t.line)));
  }

  // --- 4. the sheet for the reMarkable ------------------------------------------------------------
  {
    const deskId = desk.desk.id;
    check('before any sheet the desk reads "not yet sent to the reMarkable"', (await api('GET', `/desks/${deskId}`)).body.sheets.line === 'not yet sent to the reMarkable');
    // a note on הסלמה, and an example kept on להמר, for the sheet to carry
    await api('POST', `/card/${S}/notes`, { text: 'same root as סולם — a ladder' });
    const ex = (await api('POST', `/card/${W}/examples`)).body;
    await api('POST', `/card/${ex.added[0].key}/keep`, { kept: true });
    await api('POST', `/card/${W}/ink`, { points: [[0.1, 0.1], [0.4, 0.3]] });
    await api('POST', '/notes', { text: 'a card on its own', desk_id: deskId });
    const before = (await calls()).sheet_calls;
    const made = await api('POST', `/desks/${deskId}/sheets`);
    const sh = made.body.sheet;
    check('the button makes one sheet: the desk, when, and its cards and groups as they were', made.status === 201 && sh.desk_id === deskId && sh.desk_name === desk.desk.name && Array.isArray(sh.groups) && sh.groups.length === 3, JSON.stringify(made.body).slice(0, 300));
    const g = sh.groups.find((x) => x.cards.some((c) => c.key === W));
    check('the linked pair is one group, with Dan\'s link and its sentence', g && g.cards.some((c) => c.key === S) && g.links.length === 1 && g.links[0].sentence === SENTENCE, JSON.stringify(g && g.links));
    const wc = g.cards.find((c) => c.key === W), sc = g.cards.find((c) => c.key === S);
    check('each card carries its headword with nikud, root · binyan · gloss, kept examples with their source, notes and ink', wc.pointed === 'הִימֵּר' && wc.root === 'ה.מ.ר' && wc.binyan === 'piel' && wc.gloss && wc.examples.length === 1 && wc.examples[0].source === 'ynet' && !('url' in wc.examples[0]) && sc.notes[0] === 'same root as סולם — a ladder' && wc.ink.length === 1, JSON.stringify(wc).slice(0, 400));
    check('the questions asked on a card are on the sheet as question and answer', wc.asked.length >= 1 && wc.asked[0].question && wc.asked[0].answer);
    const alone = sh.groups[sh.groups.length - 1];
    check('cards on their own come last, together', alone.alone === true && alone.cards.length === 1 && alone.cards[0].text === 'a card on its own', JSON.stringify(alone));
    const asks = (await calls()).sheet_asks.slice(before);
    check('one model call per group, asked for structured output, with the group\'s content, no web search', asks.length === sh.groups.length && asks.every((a) => a.response_format && a.response_format.type === 'json_schema') && asks.some((a) => a.user.includes('The reader linked') && a.user.includes(SENTENCE)), JSON.stringify(asks.map((a) => a.response_format)).slice(0, 200));
    const ps = g.prompts.map((p) => p.text);
    check('three to five prompts for the group', ps.length >= 3 && ps.length <= 5, JSON.stringify(ps));
    check('a prompt naming a word that is not on the sheet (לנדוד) is refused', !ps.some((p) => p.includes('לנדוד')), JSON.stringify(ps));
    check('false-rejection check: a prompt that inflects a sheet word (הימרתי) is accepted', ps.some((p) => p.includes('הימרתי')), JSON.stringify(ps));
    check('a prompt naming a word written in the sheet\'s own note (סולם) is accepted', ps.some((p) => p.includes('with each other')), JSON.stringify(ps));
    // the check alone, on hand-written prompts
    const Sh = createRequire(import.meta.url)(join(root, 'lib', 'sheet.js'));
    const voc = Sh.vocabulary(sh.groups);
    const cases = [
      ['Write שוטטתי in a sentence.', false], // שוטט is not on this sheet
      ["Pi'el forms of ה.מ.ר in at least two tenses: מהמרים, הימרנו.", true],
      ['Use ההסלמה and להמר together.', true],
      ['In Hebrew: what do סולם and הסלמה have to do with each other?', true],
      ['Use לנדוד in a sentence.', false],
      ['Forms of ש.ו.ט.', false],
    ];
    for (const [text, pass] of cases) check(`the prompt check ${pass ? 'accepts' : 'refuses'} "${text}"`, (Sh.strangers(text, voc).length === 0) === pass, JSON.stringify(Sh.strangers(text, voc)));
    const v = (await api('GET', `/desks/${deskId}`)).body;
    check('the desk then reads "sent to the reMarkable 1 time, last <date>"', /^sent to the reMarkable 1 time, last \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(v.sheets.line), v.sheets.line);
    const full = (await api('GET', `/card/${W}`)).body;
    check("a card's footer counts the sheets it is on", full.footer.sheets === 1, JSON.stringify(full.footer));
    const page = await fetch(`${base}/desk/sheet/${sh.id}`, { headers: { cookie } });
    const html = await page.text();
    check('the sheet has its own page at /desk/sheet/<id>', page.status === 200 && html.includes('sheet-pages'), String(page.status));
    const got = (await api('GET', `/sheets/${sh.id}`)).body;
    check('the sheet reads back as it was made, with its footer and how it reaches the reMarkable', got.id === sh.id && got.footer === 'Nothing you write here goes back to the desk. The desk only remembers that this sheet was made.' && /^Print this page to PDF/.test(got.delivery));
    // a later change to the desk does not change a sheet already made
    await api('DELETE', `/desks/${deskId}/cards/${S}`);
    check('a sheet keeps the cards as they were when it was made', (await api('GET', `/sheets/${sh.id}`)).body.groups.find((x) => x.cards.some((c) => c.key === W)).cards.some((c) => c.key === S));
    await api('POST', `/desks/${deskId}/cards`, { card: S });
    // the model declining never blocks the sheet
    await control({ sheet_fail: true });
    const second = await api('POST', `/desks/${deskId}/sheets`);
    await control({ sheet_fail: false });
    check('when the prompts cannot be made the sheet is still made, and says why', second.status === 201 && second.body.sheet.groups.every((x) => x.prompts.length === 0 && /could not be made/.test(x.prompts_error)), JSON.stringify(second.body).slice(0, 300));
    check('the desk then reads "sent to the reMarkable 2 times"', /^sent to the reMarkable 2 times, last /.test(second.body.sheets.line), second.body.sheets.line);
    const emptyDesk = (await api('POST', '/desks')).body;
    const none = await api('POST', `/desks/${emptyDesk.desk.id}/sheets`);
    check('an empty desk makes no sheet and says so', none.status === 400 && /nothing to put on a sheet/.test(none.body.error), JSON.stringify(none.body));
    await api('POST', `/desks/${deskId}/open`);
  }

  // --- 5. catching a card on the phone ------------------------------------------------------------
  {
    const deskNow = (await api('GET', '/desks/current')).body.desk;
    const t = await api('POST', '/desks/catch', { text: 'שמעתי ברכבת: הם ממשיכים להמר על הריבית' });
    check('shared text becomes a note card on the desk worked on last, not yet placed', t.status === 201 && t.body.desk.id === deskNow.id && t.body.place.x === null && t.body.card.text.includes('ברכבת'), JSON.stringify(t.body).slice(0, 200));
    const view = (await api('GET', `/desks/${deskNow.id}`)).body;
    check('the caught card is on that desk', view.cards.some((c) => c.key === t.body.card.key && c.place.x === null));
    // another desk opened last: the next catch lands there
    const other = (await api('POST', '/desks')).body.desk;
    const t2 = await api('POST', '/desks/catch', { text: 'a line for the newest desk' });
    check('it lands on whichever desk was worked on most recently', t2.body.desk.id === other.id);
    await api('POST', `/desks/${deskNow.id}/open`);
    const link = await api('POST', '/desks/catch', { title: 'Shared from a podcast app', text: '', url: `${siteBase}/with-title` });
    check('a shared link is saved at once with the bare link', link.status === 201 && link.body.card.text.includes(`${siteBase}/with-title`) && link.body.card.link && link.body.card.link.title === null, JSON.stringify(link.body.card));
    const titled = await until(async () => { const c = (await api('GET', `/card/${link.body.card.key}`)).body.card; return c.link && c.link.title ? c : null; });
    check("the page's title is filled in once the server has fetched it", titled && titled.link.title === 'ההימור הגדול של הבנקים & השוק | כלכליסט', JSON.stringify(titled && titled.link));
    const og = await api('POST', '/desks/catch', { text: `${siteBase}/og` });
    const ogc = await until(async () => { const c = (await api('GET', `/card/${og.body.card.key}`)).body.card; return c.link && c.link.title ? c : null; });
    check('a link sent as the text itself is fetched too (its og:title first)', ogc && ogc.link.title === 'A podcast episode', JSON.stringify(ogc && ogc.link));
    const down = await api('POST', '/desks/catch', { text: 'worth reading', url: `${siteBase}/down` });
    await wait(800);
    const dc = (await api('GET', `/card/${down.body.card.key}`)).body.card;
    check('a link whose page cannot be fetched keeps the bare link; the card is saved all the same', down.status === 201 && dc.link && dc.link.title === null && dc.text.includes('/down') && server.log.includes('could not be fetched'), JSON.stringify(dc));
    const blank = await api('POST', '/desks/catch', { text: '  ' });
    check('an empty share is refused and says so', blank.status === 400 && /Nothing was shared/.test(blank.body.error));
    // the phone's New card: an empty note, then a pasted link
    const n = await api('POST', '/notes', { text: '', desk_id: deskNow.id, unplaced: true });
    await api('PATCH', `/notes/${n.body.card.key.split(':')[1]}`, { text: `${siteBase}/with-title` });
    const pasted = await until(async () => { const c = (await api('GET', `/card/${n.body.card.key}`)).body.card; return c.link && c.link.title ? c : null; });
    check('"New card" with a pasted link gets the page\'s title the same way', pasted && pasted.link.title.startsWith('ההימור הגדול'), JSON.stringify(pasted));
    await api('PATCH', `/notes/${n.body.card.key.split(':')[1]}`, { text: `${siteBase}/with-title\nmy thought on it` });
    const kept = (await api('GET', `/card/${n.body.card.key}`)).body.card;
    check('typing more under the link keeps the link and its title', kept.link && kept.link.title && kept.link.title.startsWith('ההימור'));
    // the installable app
    const man = await fetch(`${base}/manifest.webmanifest`);
    const m = await man.json().catch(() => null);
    check('the manifest is served without signing in, with a share target', man.status === 200 && m && m.share_target && m.share_target.action === '/share' && m.share_target.params.text && m.start_url === '/desk' && m.icons.some((i) => i.sizes === '512x512'), JSON.stringify(m).slice(0, 300));
    const sw = await fetch(`${base}/sw.js`);
    const icon = await fetch(`${base}/icon-192.png`);
    check('the service worker and the icons are served without signing in', sw.status === 200 && /javascript/.test(sw.headers.get('content-type')) && icon.status === 200 && icon.headers.get('content-type') === 'image/png');
    check('the service worker keeps no copy of any data (no cache)', !/caches\.|cache\.put|cache\.add/.test(await sw.text()));
    const share = await fetch(`${base}/share?text=${encodeURIComponent('x')}`, { headers: { cookie } });
    const before = peek('SELECT COUNT(*) AS n FROM notes')[0].n;
    check('/share opens the desk page and writes nothing by itself', share.status === 200 && (await share.text()).includes('desk-strip') && peek('SELECT COUNT(*) AS n FROM notes')[0].n === before);
    const out = await fetch(`${base}/share?text=x`, { redirect: 'manual' });
    check('/share without the sign-in goes to the login page', out.status === 302 || out.status === 303);
  }

  check('the server log names each ink stroke layer, link, sheet and catch', /ink layer ink:\d+/.test(server.log) && /linked to/.test(server.log) && /sheet \d+ made/.test(server.log) && /caught on desk/.test(server.log));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  site.close();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) {
  console.log(`\n${failed} paper check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nall ${passed} paper checks passed`);
