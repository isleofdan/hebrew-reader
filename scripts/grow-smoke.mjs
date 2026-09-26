// Server checks for session thirteen: a card grows. Layers (examples,
// answers, notes, lookups), branching and cutting, threads, Find's chips and
// Threads column, and the past desk in the corner — against the local
// stand-ins for OpenRouter and the spine.
//   node scripts/grow-smoke.mjs      (npm run smoke runs it after smoke.mjs)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8800, OR_PORT = 8801, SPINE_PORT = 8802;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-grow-'));

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

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'x'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;

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

  // a lesson from Guy, and להמר looked up in it: the card the checks grow
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(here, 'fixtures', 'Daniel Hebrew 24feb26.pdf'))], { type: 'application/pdf' }), 'Daniel Hebrew 24feb26.pdf');
  const lesson = await (await fetch(`${base}/lessons`, { method: 'POST', headers: { cookie }, body: form })).json();
  const sentence = 'לא כדאי להמר על העתיד של החברה.';
  const looked = await api('POST', '/lookup', { surface: 'להמר', sentence, lesson_id: lesson.id });
  const cardId = peek('SELECT id FROM cards WHERE surface = ?', 'להמר')[0].id;
  const W = `word:${cardId}`;
  check('setup: a lesson and the word card להמר looked up in it', looked.status === 200 && Boolean(lesson.id), JSON.stringify(looked.body).slice(0, 200));

  // a card cached before cards kept their sentence gets it when opened again,
  // and keeps the time it was built (Find's time chips and thread order read it)
  {
    const Dw0 = new Database(join(dataDir, 'reader.db'));
    Dw0.prepare("UPDATE cards SET sentence = NULL, built_at = '2025-01-02T00:00:00.000Z' WHERE id = ?").run(cardId);
    Dw0.close();
    await api('POST', '/lookup', { surface: 'להמר', sentence, lesson_id: lesson.id });
    const r0 = peek('SELECT sentence, built_at FROM cards WHERE id = ?', cardId)[0];
    check('an old card opened again gets its sentence and keeps the time it was built', r0.sentence === sentence && r0.built_at === '2025-01-02T00:00:00.000Z', JSON.stringify(r0));
    const Dw1 = new Database(join(dataDir, 'reader.db'));
    Dw1.prepare('UPDATE cards SET built_at = ? WHERE id = ?').run(new Date().toISOString(), cardId);
    Dw1.close();
  }

  // --- step 1: layers in the database --------------------------------------------------
  let full = await api('GET', `/card/${W}`);
  check('a card with no layers says so plainly: "No layers yet", state no data',
    full.status === 200 && full.body.layers.length === 0 && full.body.layers_line === 'No layers yet' && full.body.state === 'no data', JSON.stringify(full.body).slice(0, 300));
  // Dan confirms the card (session eleven); layers must never touch its entry
  const conf = await api('POST', '/lookup/confirm', { surface: 'להמר', sentence, root: 'ה.מ.ר', binyan: 'piel' });
  const entryBefore = peek('SELECT json FROM cards WHERE id = ?', cardId)[0].json;
  check('setup: Dan confirms the card', conf.status === 200 && JSON.parse(entryBefore).confirmed, JSON.stringify(conf.body).slice(0, 200));

  const n1 = await api('POST', `/card/${W}/notes`, { text: 'bet ON: להמר על' });
  const ask1 = await api('POST', `/card/${W}/ask`, { question: 'What is the difference between להמר and לסכן?' });
  const look1 = await api('POST', `/card/${W}/lookup`, { reference: 'pealim' });
  check('each kind is made and read back: a note layer, an answer layer, a lookup layer',
    n1.status === 201 && n1.body.layer.key.startsWith('note:') && ask1.status === 201 && ask1.body.layer.key.startsWith('answer:') && look1.status === 201 && look1.body.layer.key.startsWith('lookup:'),
    JSON.stringify([n1.body, ask1.body, look1.body]).slice(0, 400));
  const ex = await api('POST', `/card/${W}/examples`);
  full = await api('GET', `/card/${W}`);
  const kinds = full.body.layers.map((l) => l.kind);
  check('layers are read back oldest first, in the order they were made', kinds.join(',') === 'note,answer,lookup,example,example,example,example', kinds.join(','));
  const keys = full.body.layers.map((l) => l.key);
  check('layer keys have the card shape: answer:<id>, example:<id>, lookup:<id>', keys.every((k) => /^(note|answer|example|lookup):\d+$/.test(k)), keys.join(' '));
  const links = peek("SELECT child, parent, kind FROM card_links WHERE parent = ? AND kind = 'layer'", W);
  check('each layer is its own record, tied to the card by a "layer" link', links.length === 7, JSON.stringify(links));
  check('a confirmed word card\'s entry is unchanged by adding layers (the stored card, byte for byte)', peek('SELECT json FROM cards WHERE id = ?', cardId)[0].json === entryBefore);
  check('placements are untouched by layers: no layer is on any desk', peek("SELECT * FROM placements WHERE card NOT LIKE 'word:%' AND card NOT LIKE 'note:%'").length === 0);
  const putLayer = await api('POST', '/desks/1/cards', { card: ask1.body.layer.key });
  check('a layer is not put on a desk by itself (400, says why)', putLayer.status === 400 || putLayer.status === 404, JSON.stringify(putLayer.body));

  // --- step 3: Ask here ----------------------------------------------------------------
  const a = ask1.body.layer;
  let c = await calls();
  const askAsk = c.search_asks.find((x) => x.kind === 'ask');
  check('Ask here: one call with the web search tool, the seven reference sites as allowed_domains, max_uses 3, max_total_results 15',
    askAsk && askAsk.tool === 'openrouter:web_search' && JSON.stringify(askAsk.parameters.allowed_domains) === JSON.stringify(['morfix.co.il', 'pealim.com', 'he.wiktionary.org', 'milog.co.il', 'hebrew-academy.org.il', 'kizur.co.il', 'sefaria.org'])
    && askAsk.parameters.max_uses === 3 && askAsk.parameters.max_total_results === 15 && askAsk.response_format === null, JSON.stringify(askAsk));
  check('Ask here: a mocked answer with citations is saved as a layer with the question, the text and every cited link (once each)',
    a.question === 'What is the difference between להמר and לסכן?' && /Pi'el/.test(a.answer) && a.links.length === 2 && a.links[0].reference === 'pealim' && a.links[1].reference === 'milog', JSON.stringify(a));
  check('false-rejection: an answer whose only link sits in an annotation, not in its text, is accepted', !/https?:/.test(a.answer) && a.links.length > 0);
  const before = (await api('GET', `/card/${W}`)).body.layers.length;
  const noLink = await api('POST', `/card/${W}/ask`, { question: 'Answer without a link, please.' });
  check('Ask here: a mocked answer with no link is refused (422), says so plainly, and nothing is saved',
    noLink.status === 422 && /link/.test(noLink.body.error) && (await api('GET', `/card/${W}`)).body.layers.length === before, JSON.stringify(noLink.body));
  const inText = await api('POST', `/card/${W}/ask`, { question: 'Give the link in the text only.' });
  check('Ask here: a link written in the answer\'s text but not cited by the search is not taken as a link (refused)', inText.status === 422, JSON.stringify(inText.body));
  const declined = await api('POST', `/card/${W}/ask`, { question: 'decline this' });
  check('Ask here: a model that declines says so, and nothing is saved', declined.status === 422 && /declined/.test(declined.body.error), JSON.stringify(declined.body));
  const emptyQ = await api('POST', `/card/${W}/ask`, { question: '  ' });
  check('Ask here: an empty question is refused before any call', emptyQ.status === 400);
  await api('POST', `/card/${W}/ask`, { question: 'What else?' });
  c = await calls();
  const lastAsk = c.search_asks.filter((x) => x.kind === 'ask').at(-1);
  check('the Ask box on the reader page is unchanged: it makes no web search', await (async () => { const n = c.search_calls; await api('POST', '/ask', { question: 'What does נאלץ take?' }); return (await calls()).search_calls === n; })());
  check('Ask here: the card\'s entry and its layers go to the model as context', lastAsk.has_entry && lastAsk.has_layers, JSON.stringify(lastAsk));

  // --- step 4: Find more examples ------------------------------------------------------
  check('Find more examples: five mocked results with one refused (no url) -> four layers, not yet kept',
    ex.status === 200 && ex.body.added.length === 4 && ex.body.refused.length === 1 && ex.body.refused[0].why === 'no source link' && ex.body.added.every((l) => l.kept === false), JSON.stringify(ex.body).slice(0, 400));
  const exAsk = (await calls()).search_asks.find((x) => x.kind === 'examples');
  check('Find more examples tells the search which forms of the word the app will accept', exAsk && exAsk.forms === 'הימר, להמר', JSON.stringify(exAsk && exAsk.forms));
  check('Find more examples: the web search with no domain list, max_uses 3, max_total_results 15', exAsk && !exAsk.parameters.allowed_domains && exAsk.parameters.max_uses === 3 && exAsk.parameters.max_total_results === 15, JSON.stringify(exAsk));
  const added = ex.body.added;
  check('false-rejection: an example with the word after a prefix ו (והימר) or ש (שלהמר) is accepted',
    added.some((l) => l.sentence.startsWith('והימר')) && added.some((l) => l.sentence.includes('שלהמר')));
  check('an example keeps its source name, kind (forum -> other), date when known, and url',
    added[0].source_name === 'ynet' && added[0].source_kind === 'news' && added[0].source_date === '2026-09-18' && added[3].source_kind === 'other' && added[3].source_date === null && added[1].url.startsWith('https://'));
  const keep = await api('POST', `/card/${added[0].key}/keep`, { kept: true });
  full = await api('GET', `/card/${W}`);
  check('keep one -> the counts: 1 of 4 found', keep.status === 200 && keep.body.layer.kept === true && full.body.counts.examples_kept === 1 && full.body.counts.examples_found === 4, JSON.stringify(full.body.counts));
  const ex2 = await api('POST', `/card/${W}/examples`);
  full = await api('GET', `/card/${W}`);
  const urls = full.body.layers.filter((l) => l.kind === 'example').map((l) => l.url);
  check('a second search adds to the found count and never duplicates a url already on the card',
    ex2.body.added.length === 1 && ex2.body.already === 4 && full.body.counts.examples_found === 5 && new Set(urls).size === urls.length, JSON.stringify({ added: ex2.body.added.length, already: ex2.body.already, counts: full.body.counts }));
  // the gate: the word by the reader's own matching, and a conjugated form it knows
  await control({ extra_cards: { 'הימרו': { surface: 'הימרו', lemma: 'הימר', pos: 'verb', root: 'ה.מ.ר', binyan: 'piel', tense: 'past', person_gender_number: '3p', meaning_en: 'they bet', governs: 'על', categories: [], note: null } } });
  await api('POST', '/lookup', { surface: 'הימרו', sentence: 'הם הימרו על הקבוצה.', lesson_id: lesson.id });
  await control({ examples: [
    { sentence: 'המשקיעים הימרו על עליית המניה.', source_name: 'גלובס', source_kind: 'news', date: null, url: 'https://www.globes.co.il/x1' },
    { sentence: 'והימרו על הכול.', source_name: 'גלובס', source_kind: 'news', date: null, url: 'https://www.globes.co.il/x2' },
    { sentence: 'הוא סיכן את כל כספו.', source_name: 'גלובס', source_kind: 'news', date: null, url: 'https://www.globes.co.il/x3' },
    { sentence: 'להמר זה מסוכן.', source_name: 'גלובס', source_kind: 'news', date: null, url: 'ftp://nope' },
  ] });
  const ex3 = await api('POST', `/card/${W}/examples`);
  check('false-rejection: a conjugated form the matching already knows (הימרו, met in another sentence), alone or after ו, is accepted',
    ex3.body.added.map((l) => l.sentence).join('|') === 'המשקיעים הימרו על עליית המניה.|והימרו על הכול.', JSON.stringify(ex3.body.added.map((l) => l.sentence)));
  check('an example whose sentence does not use the word is refused, and one whose link is not a web address',
    ex3.body.refused.map((r) => r.why).join('|') === 'the sentence does not use this word|no source link', JSON.stringify(ex3.body.refused));
  await control({ examples: [] });
  const none = await api('POST', `/card/${W}/examples`);
  check('no examples found is "no data", said plainly, not an error', none.status === 200 && none.body.state === 'no data' && none.body.added.length === 0);
  await control({ examples: null });
  const noteCard = await api('POST', '/notes', { text: 'a note of my own' });
  const exNote = await api('POST', `/card/${noteCard.body.card.key}/examples`);
  check('examples are found for a word card; a note card says why not', exNote.status === 400, JSON.stringify(exNote.body));

  // --- step 5: Look up in references ---------------------------------------------------
  const refs = full.body.references;
  check('the seven references, in Dan\'s order', refs.map((r) => r.id).join(',') === 'morfix,pealim,wiktionary,milog,academy,kizur,sefaria', refs.map((r) => r.id).join(','));
  const enc = encodeURIComponent('להמר');
  const expect = {
    morfix: `https://www.morfix.co.il/en/${enc}`, pealim: `https://www.pealim.com/search/?q=${enc}`, wiktionary: `https://he.wiktionary.org/w/index.php?search=${enc}`,
    milog: `https://milog.co.il/${enc}`, academy: `https://hebrew-academy.org.il/?s=${enc}`, kizur: `https://www.kizur.co.il/search_word.php?abbr=${enc}`, sefaria: `https://www.sefaria.org/search?q=${enc}`,
  };
  const got = {};
  for (const r of refs) got[r.id] = (await api('POST', `/card/${W}/lookup`, { reference: r.id })).body;
  check('each button\'s link is the unpointed headword (the infinitive להמר), Hebrew URL-encoded, on that site',
    Object.keys(expect).every((k) => got[k].url === expect[k] && refs.find((r) => r.id === k).url === expect[k]), JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.url]))));
  full = await api('GET', `/card/${W}`);
  check('each tap records a lookup layer', full.body.layers.filter((l) => l.kind === 'lookup').length === 8 && full.body.layers.at(-1).label === 'Sefaria');
  const badRef = await api('POST', `/card/${W}/lookup`, { reference: 'google' });
  check('an unknown reference is refused', badRef.status === 400);

  // --- step 6: branch, and cut -------------------------------------------------------
  const d0 = (await api('GET', '/desks/current')).body.desk;
  const put = await api('POST', '/desks/put', { card_id: cardId });
  const kept = full.body.layers.find((l) => l.kind === 'example' && l.kept);
  const brEx = await api('POST', `/card/${kept.key}/branch`, { desk_id: d0.id });
  const brAns = await api('POST', `/card/${a.key}/branch`, { desk_id: d0.id });
  const brNote = await api('POST', `/card/${n1.body.layer.key}/branch`, { desk_id: d0.id });
  check('branch from each layer kind: a new note card carrying the example\'s sentence, the question and answer, the note',
    put.status === 201 && brEx.status === 201 && brEx.body.card.text === kept.sentence && brAns.body.card.text.startsWith(a.question) && brAns.body.card.text.includes(a.answer) && brNote.body.card.text === 'bet ON: להמר על',
    JSON.stringify([brEx.body, brAns.body.card, brNote.body.card]).slice(0, 400));
  check('the branched card is linked branched-from the layer', peek("SELECT * FROM card_links WHERE child = ? AND parent = ? AND kind = 'branched-from'", brEx.body.card.key, kept.key).length === 1);
  const dv = (await api('GET', `/desks/${d0.id}`)).body;
  const pw = dv.cards.find((x) => x.key === W).place, pb = dv.cards.find((x) => x.key === brEx.body.card.key).place;
  check('the branched card is placed beside the parent on the current desk, and its grey line is drawn to the parent card',
    Math.abs(pb.y - pw.y) < 400 && Math.abs(pb.x - pw.x) < 700 && dv.links.some((l) => l.child === brEx.body.card.key && l.parent === W && l.kind === 'branched-from'), JSON.stringify({ pw, pb, links: dv.links }));
  const brPhone = await api('POST', `/card/${kept.key}/branch`, { desk_id: d0.id, unplaced: true });
  check('at phone width a branched card is on the desk, not yet placed', brPhone.body.place.x === null);
  const brCard = await api('POST', `/card/${W}/branch`, { desk_id: d0.id });
  check('"Branch a new card from here" on the card itself: an empty note card, branched-from the card', brCard.status === 201 && brCard.body.card.text === '' && brCard.body.branched_from === W);

  // cut: a note card with three layers, cut at the second
  const host = (await api('POST', '/notes', { text: 'host', desk_id: d0.id })).body.card.key;
  const L = [];
  for (const t of ['first', 'second', 'third']) L.push((await api('POST', `/card/${host}/notes`, { text: t })).body.layer.key);
  const cutR = await api('POST', `/card/${host}/cut`, { at: L[1], desk_id: d0.id });
  const hostFull = (await api('GET', `/card/${host}`)).body, newFull = (await api('GET', `/card/${cutR.body.card.key}`)).body;
  check('cut at the second of three layers: the card keeps one, the new card holds two, its text the first moved layer\'s',
    cutR.status === 201 && hostFull.layers.map((l) => l.key).join() === L[0] && newFull.layers.map((l) => l.key).join() === `${L[1]},${L[2]}` && cutR.body.card.text === 'second',
    JSON.stringify({ host: hostFull.layers.map((l) => l.text), cut: newFull.layers.map((l) => l.text), text: cutR.body.card.text }));
  check('the cut card is linked cut-from the card and placed beside it', peek("SELECT * FROM card_links WHERE child = ? AND parent = ? AND kind = 'cut-from'", cutR.body.card.key, host).length === 1 && cutR.body.place.x !== null);
  check('the cut card\'s footer says where it came from', newFull.footer.origin && newFull.footer.origin.via === 'Cut from' && newFull.footer.origin.text === 'host', JSON.stringify(newFull.footer));
  const wLayers = (await api('GET', `/card/${W}`)).body.layers.map((l) => l.key);
  const cutW = await api('POST', `/card/${W}/cut`, { at: wLayers.at(-1), desk_id: d0.id });
  const row = peek('SELECT json FROM cards WHERE id = ?', cardId)[0];
  check('a confirmed word card cut keeps its entry and its lock', cutW.status === 201 && row.json === entryBefore && JSON.parse(row.json).confirmed, JSON.stringify(cutW.body).slice(0, 200));
  const badCut = await api('POST', `/card/${host}/cut`, { at: L[2] });
  check('cutting at a layer the card does not hold is refused', badCut.status === 400);

  // --- the full view: the counts line and the footer ----------------------------------
  full = await api('GET', `/card/${W}`);
  const f = full.body;
  check('the full view\'s counts line: N layers, oldest first (examples not kept are not counted as layers)',
    f.layers_line === `${f.counts.layers} layers, oldest first` && f.counts.layers === f.layers.filter((l) => l.kind !== 'example' || l.kept).length, JSON.stringify({ line: f.layers_line, counts: f.counts }));
  check('the footer: born from Guy\'s lesson of its date', f.footer.origin && f.footer.origin.from === 'lesson' && f.footer.origin.text === "Guy's lesson of 24 Feb 2026", JSON.stringify(f.footer));
  const d1 = (await api('POST', '/desks')).body.desk;
  await api('POST', `/desks/${d1.id}/cards`, { card: W });
  full = await api('GET', `/card/${W}`);
  check('the footer lists the desks it is on, and how many cards branched from it', full.body.footer.desks.length === 2 && full.body.footer.desks.map((d) => d.id).includes(d0.id) && full.body.footer.branched >= 5, JSON.stringify(full.body.footer));
  const opened = await api('GET', `/card/${n1.body.layer.key}`);
  check('a note that is a layer opens through its card (400 says which)', opened.status === 400 && opened.body.error.includes(W), JSON.stringify(opened.body));

  // --- step 7: Threads in Find ---------------------------------------------------------
  let found = await api('GET', `/desks/find?q=${encodeURIComponent('הקופה')}`);
  check('a match found only in a layer\'s text returns the root card under Threads, once',
    found.status === 200 && found.body.threads.length === 1 && found.body.threads[0].key === W, JSON.stringify(found.body.threads).slice(0, 300));
  const t = found.body.threads[0];
  check('a thread carries its counts line and "last touched <date> · on N desks"',
    /^word → 1 example kept → 2 questions → 1 note → looked up 8 times · \d+ branches$/.test(t.line) && /^last touched \d{1,2} [A-Z][a-z]{2} \d{4} · on 2 desks$/.test(t.where), JSON.stringify(t));
  const pointed = await api('GET', `/desks/find?q=${encodeURIComponent('הִמֵּר')}`), plain = await api('GET', `/desks/find?q=${encodeURIComponent('המר')}`);
  check('unpointed and pointed queries match alike (threads and cards)',
    pointed.body.threads.map((x) => x.key).join() === plain.body.threads.map((x) => x.key).join() && plain.body.threads.some((x) => x.key === W) && pointed.body.cards.length === plain.body.cards.length, JSON.stringify({ p: pointed.body.threads.length, u: plain.body.threads.length }));
  check('Find\'s cards carry their origin: word from Guy\'s lesson, examples found online on their card',
    plain.body.cards.some((x) => x.kind === 'word' && /^word · from Guy's lesson of/.test(x.origin_line)) && plain.body.cards.some((x) => x.kind === 'example' && /^example · found online .* · on להמר$/.test(x.origin_line)),
    JSON.stringify(plain.body.cards.map((x) => x.origin_line)));
  const only = async (source) => (await api('GET', `/desks/find?q=${encodeURIComponent('המר')}&source=${source}`)).body;
  const guy = await only('guy'), online = await only('online'), asked = await only('asked'), notes = await only('notes'), arts = await only('articles');
  check('chip "from Guy" narrows the cards to word cards from a lesson', guy.cards.length > 0 && guy.cards.every((x) => x.kind === 'word'), JSON.stringify(guy.cards.map((x) => x.key)));
  check('chip "found online" narrows to examples', online.cards.length > 0 && online.cards.every((x) => x.kind === 'example'));
  check('chip "asked" narrows to answers', asked.cards.length > 0 && asked.cards.every((x) => x.kind === 'answer'), JSON.stringify(asked.cards.map((x) => x.key)));
  check('chip "my notes" narrows to note cards', notes.cards.every((x) => x.kind === 'note'));
  check('chip "from articles" finds no card that came from a lesson', arts.cards.every((x) => x.kind === 'word' && !/Guy/.test(x.origin_line)));
  const month = (await api('GET', `/desks/find?q=${encodeURIComponent('המר')}&time=month`)).body, anyT = (await api('GET', `/desks/find?q=${encodeURIComponent('המר')}&time=any`)).body;
  check('chips "this month" and "any time": everything here was made this month, so both find the same', month.cards.length === anyT.cards.length && month.threads.length === anyT.threads.length);
  // a card made last year: out of "this year", in "any time"
  const Dw = new Database(join(dataDir, 'reader.db'));
  Dw.prepare("UPDATE answers SET made_at = '2025-03-01T00:00:00.000Z'").run();
  Dw.close();
  const thisYear = (await api('GET', `/desks/find?q=${encodeURIComponent('לסכן')}&time=year&source=asked`)).body, ever = (await api('GET', `/desks/find?q=${encodeURIComponent('לסכן')}&time=any&source=asked`)).body;
  check('chip "this year" leaves out a card made last year; "any time" keeps it', thisYear.cards.length === 0 && ever.cards.length > 0, JSON.stringify({ y: thisYear.cards.length, a: ever.cards.length }));
  const badChip = await api('GET', '/desks/find?q=x&source=everywhere');
  check('an unknown chip is refused', badChip.status === 400);

  // --- step 8: the past desk in the corner ---------------------------------------------
  // desks now: d0 (cards), d1 (current, holds W), plus the first desk made by find/put if any
  let past = (await api('GET', '/desks/past')).body;
  const all = (await api('GET', '/desks')).body.items;
  const withCards = all.filter((d) => d.count > 0 && d.id !== all[0].id).sort((x, y) => (x.touched_at < y.touched_at ? -1 : 1));
  check('the corner\'s desk is the longest-unopened desk that holds a card', past.state === 'ok' && past.desk.id === withCards[0].id && past.desk.shapes.length > 0, JSON.stringify({ past: past.desk && past.desk.id, want: withCards[0] && withCards[0].id }));
  const empty = (await api('POST', '/desks')).body.desk; // an empty desk, now current
  past = (await api('GET', '/desks/past')).body;
  check('the desk open now is never chosen, and an empty desk never is', past.desk.id !== empty.id && past.desk.count > 0);
  const wasPast = past.desk.id;
  const cur = (await api('POST', `/desks/${wasPast}/open`)).body;
  check('opening it makes it the current desk, as it was left (its cards are not poured onto another desk)',
    cur.desk.id === wasPast && (await api('GET', '/desks/current')).body.desk.id === wasPast && (await api('GET', `/desks/${empty.id}`)).body.cards.length === 0);
  past = (await api('GET', '/desks/past')).body;
  check('the corner then changes: another desk, never the one just opened', past.desk && past.desk.id !== wasPast);
  check('the server log names each layer written', /card word:\d+: answer layer answer:\d+ \(2 link\(s\)\)/.test(server.log) && /example refused \(no source link\)/.test(server.log));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(server.log.split('\n').slice(-30).join('\n')); console.log(`\n${failed} grow check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} grow checks passed`);
