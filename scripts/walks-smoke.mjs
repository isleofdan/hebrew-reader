// Server checks for hebrew-walks-one: walks with the guide to Jewish thought
// (the `thought` desk, lib/walks.js) and passages from Sefaria
// (lib/sefaria.js) — against the real server with the stand-in model
// (scripts/mock-openrouter.mjs) and a stand-in Sefaria
// (scripts/mock-sefaria.mjs). The desk's limits are replaced from this check
// (register of the same id, through `node --require`) with a 5-second time
// limit, so the limit is timed for real; one check waits out Sefaria's own
// 20-second fetch limit, so this takes about 35 s.
//   node scripts/walks-smoke.mjs      (npm run smoke runs it)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8890, OR_PORT = 8891, SEF_PORT = 8892;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-walks-'));
const require = createRequire(import.meta.url);

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
start('node', ['scripts/mock-sefaria.mjs', String(SEF_PORT)]);
// the desk's limits replaced from the check: the same desk, a 5-second limit
const preload = join(dataDir, 'thought-limit.cjs');
writeFileSync(preload, `const d = require(${JSON.stringify(join(root, 'lib', 'ask-desks.js'))});
const t = d.get('thought');
d.register({ ...t, limits: { ...t.limits, timeoutMs: 5000 }, choose: { ...t.choose, timeoutMs: 3000 } });\n`);
const server = start('node', ['--require', preload, 'server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'w'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SEFARIA_URL: `http://127.0.0.1:${SEF_PORT}`,
});
const base = `http://127.0.0.1:${PORT}`;
const mock = `http://127.0.0.1:${OR_PORT}`;
const sef = `http://127.0.0.1:${SEF_PORT}`;

try {
  await up(`${base}/health`); await up(`${mock}/calls`); await up(`${sef}/calls`);

  // --- signed out: the pages are pages, the data is data ------------------------------
  const out = async (path) => { const r = await fetch(base + path, { redirect: 'manual', headers: path.includes('list') ? { accept: 'application/json' } : {} }); return { status: r.status, location: r.headers.get('location'), body: await r.text() }; };
  const so1 = await out('/walks'), so2 = await out('/walks/1'), so3 = await out('/walks/list'), so4 = await out('/walks/1/stops');
  check('signed out, GET /walks and GET /walks/1 redirect to /login (303); GET /walks/list and /walks/1/stops answer 401 as the other data routes do',
    so1.status === 303 && so1.location === '/login' && so2.status === 303 && so2.location === '/login' && so3.status === 401 && /Sign in first/.test(so3.body) && so4.status === 401,
    JSON.stringify([so1, so2, so3, so4].map((x) => [x.status, x.location])));

  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  // a POST to /walks/… waits for its stop (?wait=1) unless the check reads the background path itself
  const api = async (method, path, body, { wait = true } = {}) => { const url = base + path + (method === 'POST' && path.startsWith('/walks/') && wait ? '?wait=1' : ''); const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const control = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
  const sefControl = (c) => fetch(`${sef}/control`, { method: 'POST', body: JSON.stringify(c) });
  const calls = async () => (await fetch(`${mock}/calls`)).json();
  const sefCalls = async () => (await fetch(`${sef}/calls`)).json();
  const Database = require(join(root, 'node_modules', 'better-sqlite3'));
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const count = (table, where = '1=1', ...a) => peek(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a)[0].n;
  const walkAsks = async () => (await calls()).walk_asks;

  const page1 = await fetch(`${base}/walks`, { headers: { cookie } }), page2 = await fetch(`${base}/walks/7`, { headers: { cookie } });
  const html = await page1.text();
  check('signed in, GET /walks and GET /walks/7 serve the walks page (HTML)', page1.status === 200 && /<title>Hebrew reader · Walks<\/title>/.test(html) && page2.status === 200 && (page2.headers.get('content-type') || '').includes('text/html'));
  const empty = await api('GET', '/walks/list');
  check('no walks yet: GET /walks/list answers an empty list, state no data', empty.status === 200 && empty.body.items.length === 0 && empty.body.state === 'no data', JSON.stringify(empty.body));

  // --- the desk ------------------------------------------------------------------------
  const desks = require(join(root, 'lib', 'ask-desks.js'));
  const lookup = require(join(root, 'lib', 'lookup.js'));
  const t = desks.get('thought'), h = desks.get('hebrew');
  check('the thought desk: Sefaria its one site, the guide model (Fable 5.1), a stop of 9000 tokens and 240 s, choose of 6000 tokens and 150 s, each with 4000 tokens of thinking, ten turns; hebrew keeps six and thinks not',
    JSON.stringify(t.domains) === '["www.sefaria.org"]' && t.model === lookup.GUIDE_MODEL && lookup.GUIDE_MODEL === 'anthropic/claude-fable-5.1' && t.limits.maxTokens === 9000 && t.limits.timeoutMs === 240000
    && JSON.stringify(t.limits.reasoning) === '{"max_tokens":4000}' && t.choose.maxTokens === 6000 && t.choose.timeoutMs === 150000 && JSON.stringify(t.choose.reasoning) === '{"max_tokens":4000}'
    && h.limits.reasoning === undefined && t.turns === 10 && h.turns === 6 && /never give a list, a survey/.test(t.persona) && /Israel, antisemitism and current politics/.test(t.persona),
    JSON.stringify({ domains: t.domains, model: t.model, limits: t.limits, choose: t.choose, turns: t.turns, hebrew: h.turns }));

  // --- verify 1: a walk from a question --------------------------------------------------
  const Q = 'Does Jewish thought see humanity on a trajectory of progress?';
  const w1 = await api('POST', '/walks/start', { question: Q });
  const wa1 = await walkAsks();
  const rows1 = peek('SELECT * FROM asks WHERE walk_id = ?', w1.body.id);
  const walkRow = peek('SELECT * FROM walks WHERE id = ?', w1.body.id)[0];
  check('POST /walks/start { question }: one walks row (desk thought, the question, its title) and one asks row',
    w1.status === 200 && count('walks') === 1 && walkRow.desk === 'thought' && walkRow.question === Q && walkRow.title === Q && walkRow.start_ref === null && rows1.length === 1 && walkRow.last_ask_id === rows1[0].id,
    JSON.stringify({ status: w1.status, body: w1.body.error, walkRow, rows: rows1.length }));
  const r1 = rows1[0] || {};
  check('…its asks row: walk_id set, ref the canonical reference, took_ms a number, parent_id null, desk thought, subject_kind walk',
    r1.walk_id === w1.body.id && r1.ref === 'Shabbat 112b' && Number.isInteger(r1.took_ms) && r1.took_ms >= 0 && r1.parent_id === null && r1.desk === 'thought' && r1.subject_kind === 'walk' && r1.question === Q,
    JSON.stringify({ walk_id: r1.walk_id, ref: r1.ref, took_ms: r1.took_ms, parent_id: r1.parent_id, desk: r1.desk, kind: r1.subject_kind }));
  check('…passages holds that reference once', count('passages', 'ref = ?', 'Shabbat 112b') === 1 && count('passages') === 1);
  check('…the stand-in model saw two calls, choose then teach; choose with no search and 6000 tokens, teach with the search on www.sefaria.org only and 9000 tokens, both the guide model',
    wa1.length === 2 && wa1[0].kind === 'choose' && wa1[1].kind === 'teach' && wa1[0].max_tokens === 6000 && wa1[1].max_tokens === 9000
    && JSON.stringify(wa1[1].allowed_domains) === '["www.sefaria.org"]' && wa1.every((x) => x.model === lookup.GUIDE_MODEL) && wa1[0].system.startsWith(t.persona.split('\n')[0]),
    JSON.stringify(wa1.map((x) => [x.kind, x.max_tokens, x.allowed_domains, x.model])));
  check('…the teach call carried the passage\'s Hebrew and English (as plain text, tags gone), the choose call did not',
    /Hebrew:\n.*אָמַר רַבִּי זֵירָא/s.test(wa1[1].user) && /English:\n.*Rabbi Zeira said that Rava bar Zimuna said/s.test(wa1[1].user) && !/<b>/.test(wa1[1].user) && !/Hebrew:/.test(wa1[0].user),
    wa1[1].user.slice(0, 500));
  // --- hebrew-guide-one: Fable 5.1, room to think, the reading -------------------------
  const [c1, t1r] = wa1;
  console.log(`     the choose request: ${JSON.stringify({ model: c1.model, max_tokens: c1.max_tokens, reasoning: c1.reasoning, keys: c1.body_keys })}`);
  console.log(`     the teach request:  ${JSON.stringify({ model: t1r.model, max_tokens: t1r.max_tokens, reasoning: t1r.reasoning, keys: t1r.body_keys })}`);
  check('the guide\'s requests (choose and teach) name anthropic/claude-fable-5.1',
    wa1.length === 2 && wa1.every((x) => x.model === 'anthropic/claude-fable-5.1'), JSON.stringify(wa1.map((x) => x.model)));
  check('choose carries reasoning { max_tokens: 4000 } with max_tokens 6000, teach the same reasoning with max_tokens 9000; neither sends a temperature',
    JSON.stringify(c1.reasoning) === '{"max_tokens":4000}' && c1.max_tokens === 6000 && JSON.stringify(t1r.reasoning) === '{"max_tokens":4000}' && t1r.max_tokens === 9000
    && !c1.has_temperature && !t1r.has_temperature && c1.response_format && c1.response_format.type === 'json_object' && t1r.response_format === null,
    JSON.stringify({ choose: [c1.reasoning, c1.max_tokens, c1.has_temperature, c1.response_format], teach: [t1r.reasoning, t1r.max_tokens, t1r.has_temperature] }));
  check('choose is asked for the reading first, and for a passage that serves it',
    /"reading": "<one or two sentences/.test(c1.system) && c1.system.indexOf('"reading"') < c1.system.indexOf('"ref"') && /The passage must serve the reading/.test(c1.system), c1.system.slice(-900));
  const reading1 = `I read you as asking what lies beneath "${Q.slice(0, 50)}" (choice ${(/\(choice (\d+)\)/.exec(t1r.system) || [])[1]}).`;
  check('the reading reaches the teach request (in its instructions, which say the stop must answer it), not the reader\'s move',
    /When you chose this passage you read the reader's move as asking: I read you as asking what lies beneath "Does Jewish thought/.test(t1r.system) && /The stop must answer that reading\./.test(t1r.system) && t1r.move === Q,
    t1r.system.slice(-400));
  const saved1 = (() => { try { return JSON.parse(rows1[0].answer); } catch { return {}; } })();
  check('the reading is kept in the saved stop\'s JSON and comes back on the stop',
    saved1.reading === reading1 && w1.body.stops && w1.body.stops[0].reading === reading1, JSON.stringify({ saved: saved1.reading, served: w1.body.stops && w1.body.stops[0].reading, expected: reading1 }));

  const s1 = w1.body.stops && w1.body.stops[0];
  check('…the answer is the walk with Stop 1: the passage from Sefaria, its sefaria.org page, the guide\'s parts, two or three directions, the cited Sefaria pages',
    s1 && s1.n === 1 && s1.passage.title === 'Talmud, Shabbat 112b' && s1.passage.url === 'https://www.sefaria.org/Shabbat.112b' && /זֵירָא/.test(s1.passage.he)
    && s1.why_here && s1.transliteration && s1.explanation && s1.argues && s1.opinion && s1.next.length === 3 && s1.links.length === 2 && s1.links.every((l) => l.label === 'Sefaria' && l.url.startsWith('https://www.sefaria.org/'))
    && s1.move.kind === 'question' && w1.body.new_stop === 1,
    JSON.stringify(s1).slice(0, 600));
  check('…the address of the full passage is built by the server from the reference: no address in the guide\'s answer', !/sefaria\.org/.test(r1.answer), r1.answer.slice(0, 200));

  // --- verify 2: a step by pick, a step by text ------------------------------------------
  const w = w1.body.id;
  const st2 = await api('POST', `/walks/${w}/step`, { pick: 1 });
  const st3 = await api('POST', `/walks/${w}/step`, { text: 'I am not convinced: is the descent not just nostalgia?' });
  const rows = peek('SELECT * FROM asks WHERE walk_id = ? ORDER BY id', w);
  check('a step by pick and a step by text each write one asks row whose parent_id is the previous stop',
    st2.status === 200 && st3.status === 200 && rows.length === 3 && rows[1].parent_id === rows[0].id && rows[2].parent_id === rows[1].id && rows.every((r) => r.walk_id === w),
    JSON.stringify({ s2: st2.body.error, s3: st3.body.error, rows: rows.map((r) => [r.id, r.parent_id, r.ref]) }));
  check('…the stops say what Dan did: "You chose" the direction\'s label, "You wrote" his words',
    st3.body.stops[1].move.kind === 'pick' && st3.body.stops[1].move.text === 'The denial of any line' && st3.body.stops[2].move.kind === 'text' && st3.body.stops[2].move.text === 'I am not convinced: is the descent not just nostalgia?' && st3.body.stops.map((s) => s.n).join() === '1,2,3',
    JSON.stringify(st3.body.stops.map((s) => s.move)));
  const wa3 = await walkAsks();
  const teach3 = wa3.filter((x) => x.kind === 'teach').at(-1), choose3 = wa3.filter((x) => x.kind === 'choose').at(-1);
  const stopJson = (c) => { try { const j = JSON.parse(c); return Boolean(j.explanation && j.opinion && Array.isArray(j.next)); } catch { return false; } };
  check('the model\'s requests for the third stop (choose and teach) carry the two earlier stops\' JSON, oldest first',
    teach3.turns.length === 4 && choose3.turns.length === 4 && teach3.turns[0].content === `Question: ${Q}` && teach3.turns[2].content === 'Question: I choose: The denial of any line — Kohelet: nothing new under the sun.'
    && stopJson(teach3.turns[1].content) && stopJson(teach3.turns[3].content) && teach3.turns[1].content === rows[0].answer,
    JSON.stringify(teach3.turns.map((x) => [x.role, x.content.slice(0, 60)])));
  check('the subject tells the guide the stops so far, so it does not repeat one', /Its stops so far, oldest first: Shabbat 112b; Genesis 1:1-3/.test(teach3.user), teach3.user.slice(0, 300));
  check('a choose call writes no row: three stops made with six calls, three asks rows', wa3.length === 6 && count('asks') === 3, `${wa3.length} calls, ${count('asks')} rows`);

  // --- verify 2b: a pushback the guide answers itself, with no passage --------------------
  // (Dan, 21 Oct 2026: "tell me what you think my question means before searching
  // the texts further" came back as "the model gave no answer")
  const askedBefore = (await walkAsks()).length;
  const rp = await api('POST', `/walks/${w}/step`, { text: 'Read my question more closely and tell me what you think my question means before searching the texts further.' });
  const rpRows = peek('SELECT * FROM asks WHERE walk_id = ? ORDER BY id', w);
  const rpStop = rp.body.stops ? rp.body.stops.at(-1) : null;
  check('a pushback that asks the guide to reflect instead of naming a passage is a stop: the guide\'s reply, no reference, no teaching call, one asks row chained to the stop before',
    rp.status === 200 && rp.body.new_stop === 4 && rpStop && rpStop.ref === null && rpStop.passage === null && /I read your question as asking/.test(rpStop.reply) && rpStop.reading === '' && !/must not show/.test(rpRows.at(-1).answer)
    && rpStop.next.length === 2 && rpStop.next[0].label === 'Take the moral reading' && rpStop.move.kind === 'text'
    && rpRows.length === 4 && rpRows[3].ref === null && rpRows[3].parent_id === rows[2].id && rpRows[3].took_ms >= 0 && (await walkAsks()).length === askedBefore + 1,
    JSON.stringify({ status: rp.status, error: rp.body.error, stop: rpStop && { ref: rpStop.ref, reply: (rpStop.reply || '').slice(0, 40), next: rpStop.next }, rows: rpRows.map((r) => [r.id, r.parent_id, r.ref]) }).slice(0, 600));
  const rp2 = await api('POST', `/walks/${w}/step`, { pick: 0 });
  const rp2Rows = peek('SELECT * FROM asks WHERE walk_id = ? ORDER BY id', w);
  const rp2Teach = (await walkAsks()).filter((x) => x.kind === 'teach').at(-1);
  check('…a pick on that reply makes an ordinary stop after it (its parent the reply row); the guide\'s list of stops so far leaves the reply out',
    rp2.status === 200 && rp2.body.stops.length === 5 && rp2.body.stops[4].ref && rp2.body.stops[4].move.kind === 'pick' && rp2.body.stops[4].move.text === 'Take the moral reading'
    && rp2Rows.length === 5 && rp2Rows[4].parent_id === rpRows[3].id && /Its stops so far, oldest first: Shabbat 112b; Genesis 1:1-3; [^;\n]+$/m.test(rp2Teach.user) && !/null/.test((/^Its stops so far.*$/m.exec(rp2Teach.user) || [''])[0]),
    JSON.stringify({ status: rp2.status, error: rp2.body.error, so: (/^Its stops so far.*$/m.exec(rp2Teach.user) || [''])[0], rows: rp2Rows.map((r) => [r.id, r.parent_id, r.ref]) }).slice(0, 600));

  // a stop saved the old way (no reading in its JSON, as every stop before
  // hebrew-guide-one) still reads back, with the stops around it unchanged
  await control({ walk_no_reading: true });
  const old = await api('POST', `/walks/${w}/step`, { text: 'An old-style stop: and the sages after them?' });
  await control({ walk_no_reading: false });
  const oldRow = peek('SELECT answer FROM asks WHERE walk_id = ? ORDER BY id DESC LIMIT 1', w)[0];
  const oldTeach = (await walkAsks()).filter((x) => x.kind === 'teach').at(-1);
  const reread = await api('GET', `/walks/${w}/stops`);
  const oldStop = reread.body.stops ? reread.body.stops.at(-1) : null;
  check('a stop with no reading in its saved JSON (the shape of every stop before) reads back whole with reading "", its teach asked as before, and the earlier stops keep theirs',
    old.status === 200 && !('reading' in JSON.parse(oldRow.answer)) && oldStop && oldStop.reading === '' && oldStop.explanation && oldStop.passage && oldStop.next.length === 3
    && !/When you chose this passage/.test(oldTeach.system) && reread.body.stops[0].reading === reading1 && reread.body.stops.length === 6,
    JSON.stringify({ status: old.status, error: old.body.error, saved: oldRow && oldRow.answer.slice(0, 80), reading: oldStop && oldStop.reading, n: reread.body.stops && reread.body.stops.length }));

  // a walk of twelve stops: the thirteenth carries the last ten
  const long = (await api('POST', '/walks/start', { question: 'Turn 1: where does authority sit?' })).body;
  for (let i = 2; i <= 12; i++) await api('POST', `/walks/${long.id}/step`, { text: `Turn ${i}: and then?` });
  const n12 = count('asks', 'walk_id = ?', long.id);
  await api('POST', `/walks/${long.id}/step`, { text: 'Turn 13: and after twelve?' });
  const t13 = (await walkAsks()).filter((x) => x.kind === 'teach').at(-1);
  const carried = t13.turns.filter((x) => x.role === 'user').map((x) => x.content);
  check('a walk of twelve stops: the next stop\'s request carries the last ten, oldest first (turns 3 to 12)',
    n12 === 12 && t13.turns.length === 20 && carried[0] === 'Question: Turn 3: and then?' && carried[9] === 'Question: Turn 12: and then?' && t13.turns.filter((x) => x.role === 'assistant').every((x) => stopJson(x.content)),
    JSON.stringify({ n12, turns: t13.turns.length, first: carried[0], last: carried.at(-1) }));

  // --- verify 3: a choose that names an unknown reference; a declined start -------------
  let before = (await walkAsks()).length, asksBefore = count('asks');
  const once = await api('POST', `/walks/${w}/step`, { text: 'Show me something unknown once, please.' });
  const waOnce = (await walkAsks()).slice(before);
  check('a choose naming a reference Sefaria does not know is retried once, carrying Sefaria\'s message; the second choice makes the stop',
    once.status === 200 && waOnce.map((x) => x.kind).join() === 'choose,choose,teach' && /You named "Notabook 1", and Sefaria answered: Sefaria does not know the reference "Notabook 1" \(Could not find title in reference: Notabook 1\)/.test(waOnce[1].move)
    && count('asks') === asksBefore + 1,
    JSON.stringify({ status: once.status, kinds: waOnce.map((x) => x.kind), move: waOnce[1] && waOnce[1].move.slice(0, 300) }));
  before = (await walkAsks()).length; asksBefore = count('asks');
  const stopsBefore = (await api('GET', `/walks/${w}/stops`)).body.stops.length;
  const twice = await api('POST', `/walks/${w}/step`, { text: 'Now something unknown twice.' });
  const waTwice = (await walkAsks()).slice(before);
  check('a second miss ends the stop with the failure line, no asks row, and the walk keeps its earlier stops',
    twice.status === 502 && /^The stop could not be made: the guide twice named a passage Sefaria does not know/.test(twice.body.error) && waTwice.map((x) => x.kind).join() === 'choose,choose'
    && count('asks') === asksBefore && twice.body.walk && twice.body.walk.stops.length === stopsBefore,
    JSON.stringify({ status: twice.status, body: twice.body.error, kinds: waTwice.map((x) => x.kind) }));
  const walksBefore = count('walks'); asksBefore = count('asks'); before = (await walkAsks()).length;
  const dec = await api('POST', '/walks/start', { question: 'What should be done about current Israeli politics?' });
  check('a declined first stop answers the decline line and writes the walks row only (one choose call, no teach, no asks row)',
    dec.status === 200 && /outside what I do/.test(dec.body.declined) && count('walks') === walksBefore + 1 && count('asks') === asksBefore && dec.body.stops.length === 0
    && (await walkAsks()).slice(before).map((x) => x.kind).join() === 'choose',
    JSON.stringify(dec.body));
  const decAgain = await api('POST', `/walks/${dec.body.id}/step`, { text: 'Then: what does the tradition say about authority?' });
  check('…the box is offered again: a question on the declined walk makes its first stop (no parent)', decAgain.status === 200 && decAgain.body.stops.length === 1 && peek('SELECT parent_id FROM asks WHERE walk_id = ?', dec.body.id)[0].parent_id === null, JSON.stringify(decAgain.body).slice(0, 200));

  // --- verify 4 and 5: a walk from a reference, and lib/sefaria.js -------------------------
  before = (await walkAsks()).length;
  const sefBefore = (await sefCalls()).count;
  const fromRef = await api('POST', '/walks/start', { ref: 'Genesis.1.1-3' });
  const waRef = (await walkAsks()).slice(before);
  const refWalk = fromRef.body.id && peek('SELECT * FROM walks WHERE id = ?', fromRef.body.id)[0];
  check('POST /walks/start { ref } skips choose (the stand-in saw one call, teach); start_ref is the canonical reference, the title the passage\'s',
    fromRef.status === 200 && waRef.map((x) => x.kind).join() === 'teach' && refWalk.start_ref === 'Genesis 1:1-3' && refWalk.question === null && refWalk.title === 'Tanakh, Genesis 1:1-3' && fromRef.body.stops[0].move.kind === 'start',
    JSON.stringify({ status: fromRef.status, kinds: waRef.map((x) => x.kind), refWalk }));
  check('…the subject reads "The reader is standing at <title>"', /^The walk:\nThe reader is standing at Tanakh, Genesis 1:1-3/.test(waRef[0].user), waRef[0].user.slice(0, 120));
  check('…and Genesis was already fetched (a step above): no request to Sefaria for "Genesis.1.1-3"', (await sefCalls()).count === sefBefore, `${sefBefore} -> ${(await sefCalls()).count}`);
  const gen = peek('SELECT * FROM passages WHERE ref = ?', 'Genesis 1:1-3')[0];
  check('a tag inside Sefaria\'s text is stripped: <big> in the Hebrew, <b> and the footnote (its marker and its note) in the English; segments kept as lines',
    gen && !/[<>]/.test(gen.he + gen.en) && gen.he.startsWith('בְּרֵאשִׁ֖ית') && gen.en.split('\n').length === 3 && gen.en.startsWith('When God began to create heaven and earth—') && !/In contrast to others|footnote/.test(gen.en)
    && !/[<>]/.test(peek('SELECT he, en FROM passages WHERE ref = ?', 'Shabbat 112b').map((p) => p.he + p.en).join('')),
    JSON.stringify(gen));
  check('a one-segment text (a string) is read too', count('passages', 'ref = ?', 'Ecclesiastes 1:9') === 1 && /nothing new beneath the sun/.test(peek('SELECT en FROM passages WHERE ref = ?', 'Ecclesiastes 1:9')[0].en));
  const sefBefore2 = (await sefCalls()).count;
  const again = await api('POST', '/walks/start', { ref: 'Shabbat.112b' });
  check('a second fetch of the same reference (written another way) makes no request to Sefaria, and passages holds it once',
    again.status === 200 && (await sefCalls()).count === sefBefore2 && count('passages', 'ref = ?', 'Shabbat 112b') === 1 && peek('SELECT start_ref FROM walks WHERE id = ?', again.body.id)[0].start_ref === 'Shabbat 112b',
    JSON.stringify({ status: again.status, calls: [sefBefore2, (await sefCalls()).count] }));
  const walksNow = count('walks');
  const unknown = await api('POST', '/walks/start', { ref: 'Notabook 9' });
  check('an unknown reference answers 404 naming it (and what a reference looks like); no walk is made',
    unknown.status === 404 && /Sefaria does not know the reference "Notabook 9"/.test(unknown.body.error) && /such as Shabbat 112b/.test(unknown.body.error) && count('walks') === walksNow, JSON.stringify(unknown.body));
  await sefControl({ mode: 'reset' });
  const down = await api('POST', '/walks/start', { ref: 'Pirkei Avot 1:1' });
  check('Sefaria down (the connection dropped) answers 502 "Sefaria could not be reached"', down.status === 502 && /^Sefaria could not be reached/.test(down.body.error), JSON.stringify(down.body));
  await sefControl({ mode: 'hang' });
  const t0 = Date.now();
  const silent = await api('POST', '/walks/start', { ref: 'Pirkei Avot 1:2' });
  const waited = Date.now() - t0;
  check('Sefaria silent answers 502 "Sefaria could not be reached" at the 20-second fetch limit', silent.status === 502 && /^Sefaria could not be reached \(no answer in 20 s\)/.test(silent.body.error) && waited >= 19500 && waited < 26000, JSON.stringify({ body: silent.body, waited }));
  await sefControl({ mode: 'ok' });
  check('…and a failed fetch keeps nothing', count('passages', "ref LIKE 'Pirkei%'") === 0 && count('walks') === walksNow);

  // --- verify 6: the time limit (5 s, set from this check) --------------------------------
  await control({ walk_teach_ms: 4000 });
  asksBefore = count('asks');
  let t1 = Date.now();
  const slow = await api('POST', `/walks/${w}/step`, { pick: 0 });
  const slowMs = Date.now() - t1;
  const slowRow = peek('SELECT took_ms FROM asks ORDER BY id DESC LIMIT 1')[0];
  const slowTeach = (await walkAsks()).filter((x) => x.kind === 'teach').at(-1);
  check('a teach answering after 4 s is kept under the 5-second limit (the desk\'s limit replaced from this check, its thinking kept: reasoning 4000, 9000 tokens), and its took_ms counts both calls (at least 4 s)',
    slow.status === 200 && count('asks') === asksBefore + 1 && slowRow.took_ms >= 4000 && slowMs >= 4000 && JSON.stringify(slowTeach.reasoning) === '{"max_tokens":4000}' && slowTeach.max_tokens === 9000,
    JSON.stringify({ status: slow.status, error: slow.body.error, took_ms: slowRow.took_ms, slowMs, reasoning: slowTeach.reasoning }));
  await control({ walk_teach_ms: 0, walk_teach_hang: true });
  const stopsNow = (await api('GET', `/walks/${w}/stops`)).body.stops.length;
  asksBefore = count('asks');
  t1 = Date.now();
  const hung = await api('POST', `/walks/${w}/step`, { pick: 2 });
  const hungMs = Date.now() - t1;
  check('a teach that never answers ends at the limit with the failure line naming the time limit; no row, the earlier stops kept',
    hung.status === 504 && hung.body.error === 'The stop could not be made: the guide did not answer within the time limit of 5 s.' && hungMs >= 4900 && hungMs < 8000
    && count('asks') === asksBefore && hung.body.walk.stops.length === stopsNow,
    JSON.stringify({ status: hung.status, body: hung.body.error, hungMs }));
  await control({ walk_teach_hang: false, walk_choose_hang: true });
  t1 = Date.now();
  const chooseHung = await api('POST', `/walks/${w}/step`, { pick: 2 });
  const chooseHungMs = Date.now() - t1;
  check('a choose that never answers ends at its own limit (3 s, set from this check), and the failure line names that limit, not the stop\'s',
    chooseHung.status === 504 && chooseHung.body.error === 'The stop could not be made: the guide did not answer within the time limit of 3 s.' && chooseHungMs >= 2900 && chooseHungMs < 5000 && count('asks') === asksBefore,
    JSON.stringify({ status: chooseHung.status, body: chooseHung.body.error, chooseHungMs }));
  await control({ walk_choose_hang: false, walk_teach_down: true });
  const unreachable = await api('POST', `/walks/${w}/step`, { pick: 2 });
  check('the model unreachable: the failure line says so', unreachable.status === 502 && /^The stop could not be made: OpenRouter is unreachable/.test(unreachable.body.error), JSON.stringify(unreachable.body));
  await control({ walk_teach_down: false });

  // --- a stop is kept only whole (dev-check's finding 1 on 0e4948d) -------------------
  await control({ walk_teach_thin: true });
  asksBefore = count('asks');
  const thin = await api('POST', `/walks/${w}/step`, { pick: 2 });
  check('a teach answer missing the reason, the transliteration or two explained directions is no stop: the failure line names what was missing, no row, the earlier stops kept',
    thin.status === 502 && thin.body.error === 'The stop could not be made: the guide\'s answer was missing the reason for the stop, the transliteration, two or three directions each with its reason (it gave 0).'
    && count('asks') === asksBefore && thin.body.walk.stops.length === stopsNow,
    JSON.stringify({ status: thin.status, body: thin.body.error }));
  await control({ walk_teach_thin: false });

  // --- one move at a time on a walk (dev-check's finding 2 on 0e4948d) ----------------
  await control({ walk_teach_ms: 1500 });
  asksBefore = count('asks');
  const [tabA, tabB] = await Promise.all([
    api('POST', `/walks/${w}/step`, { text: 'First tab: and the counter-tradition?' }),
    (async () => { await wait(200); return api('POST', `/walks/${w}/step`, { text: 'Second tab: and the mystics?' }); })(),
  ]);
  await control({ walk_teach_ms: 0 });
  const chainRows = peek('SELECT id, parent_id FROM asks WHERE walk_id = ? ORDER BY id', w);
  check('two moves at once on one walk (two tabs): the first makes its stop, the second is refused (409) and says to wait; the saved chain stays one line',
    tabA.status === 200 && tabB.status === 409 && /already being made on this walk/.test(tabB.body.error) && count('asks') === asksBefore + 1
    && chainRows.every((r, i) => i === 0 ? r.parent_id === null : r.parent_id === chainRows[i - 1].id),
    JSON.stringify({ a: tabA.status, b: [tabB.status, tabB.body.error], chain: chainRows }));
  const afterBusy = await api('POST', `/walks/${w}/step`, { text: 'Second tab again, after the first arrived.' });
  check('…and once the stop has arrived, the next move goes on from it', afterBusy.status === 200 && peek('SELECT parent_id FROM asks WHERE walk_id = ? ORDER BY id DESC LIMIT 1', w)[0].parent_id === chainRows.at(-1).id, JSON.stringify(afterBusy.body.error || ''));

  // --- refusals name the valid values ----------------------------------------------------
  const ids = peek('SELECT id FROM walks ORDER BY id DESC').map((r) => r.id);
  const bad1 = await api('GET', '/walks/abc/stops');
  const bad2 = await api('GET', '/walks/999/stops');
  const bad3 = await api('POST', `/walks/${w}/step`, {});
  const bad4 = await api('POST', `/walks/${w}/step`, { pick: 7 });
  const bad5 = await api('POST', `/walks/${w}/step`, { pick: 0, text: 'both' });
  const bad6 = await api('POST', '/walks/start', {});
  const bad7 = await api('POST', '/walks/999/step', { text: 'x' });
  check('a walk id that is not a whole number: 400 naming what a walk id is and where the walks are listed', bad1.status === 400 && /whole number id/.test(bad1.body.error) && /GET \/walks\/list/.test(bad1.body.error), JSON.stringify(bad1.body));
  check('a walk id not found: 404 naming the walks there are', bad2.status === 404 && bad2.body.error.includes(`The walks are ${ids.slice(0, 20).join(', ')}`) && bad7.status === 404, JSON.stringify([bad2.body, bad7.body]));
  check('a step with neither pick nor text (or both): 400 naming both and the directions on offer',
    bad3.status === 400 && /\{ pick: <the number of an offered direction> \} or \{ text: <your pushback or question> \}/.test(bad3.body.error) && /pick is one of 0, 1, 2 \(0: The ascending line; 1: The denial of any line; 2: Progress in the law itself\)/.test(bad3.body.error) && bad5.status === 400,
    JSON.stringify([bad3.body, bad5.body]));
  check('a pick outside the offered directions: 400 naming the valid ones', bad4.status === 400 && /pick is one of 0, 1, 2/.test(bad4.body.error) && /got 7/.test(bad4.body.error), JSON.stringify(bad4.body));
  check('a start with neither question nor ref: 400 naming both', bad6.status === 400 && /\{ question: .* \} or \{ ref: .* \}/.test(bad6.body.error), JSON.stringify(bad6.body));
  const longQ = await api("POST", "/walks/start", { question: "q".repeat(4001) });
  check('a question over 4,000 characters: 400 naming the limit (a walk may start from a long question)', longQ.status === 400 && /question is at most 4000 characters; this one has 4001/.test(longQ.body.error), JSON.stringify(longQ.body));
  const badKind = await api('POST', '/ask', { desk: 'thought', subject: { kind: 'walk', walk_id: 999 }, question: 'x?' });
  check('the ask surface refuses a walk subject of no walk (404, naming where the walks are listed)', badKind.status === 404 && /No walk with id 999; GET \/walks\/list/.test(badKind.body.error), JSON.stringify(badKind.body));

  // --- reopening reads the record only ---------------------------------------------------
  const orBefore = (await calls()).calls, sefB = (await sefCalls()).count;
  const re1 = await api('GET', `/walks/${w}/stops`), list = await api('GET', '/walks/list');
  check('reopening a walk (GET /walks/:id/stops) and the list make no request to the stand-in model or the stand-in Sefaria',
    re1.status === 200 && re1.body.stops.length === stopsNow + 2 && (await calls()).calls === orBefore && (await sefCalls()).count === sefB, JSON.stringify({ or: [orBefore, (await calls()).calls], sef: [sefB, (await sefCalls()).count] }));
  check('…every stop comes back with its passage, its parts and its time (the guide\'s reply stop: its reply, no passage)',
    re1.body.stops.every((s) => Number.isInteger(s.took_ms) && (s.reply ? s.passage === null && s.ref === null : s.passage && s.passage.he && s.passage.url.startsWith('https://www.sefaria.org/') && s.explanation))
    && re1.body.stops.filter((s) => s.reply).length === 1);
  check('GET /walks/list: newest first, each with its title, the day it started and its stops', list.body.items[0].id === ids[0] && list.body.items.every((x) => x.title && x.started_at && Number.isInteger(x.stops)) && list.body.state === 'ok', JSON.stringify(list.body.items.slice(0, 3)));

  // --- the background path: Start and a step answer at once, the page reads the walk ---
  await control({ walk_teach_ms: 1500 });
  const asksBg = count('asks');
  let tb = Date.now();
  const bg = await api('POST', '/walks/start', { question: 'Background: does the law move?' }, { wait: false });
  const bgMs = Date.now() - tb;
  const bgRow = peek('SELECT * FROM walks WHERE id = ?', bg.body.id)[0];
  check('POST /walks/start without ?wait answers at once (under 1 s) with the walk written, pending true, pending_since a time, no stop yet, no new_stop',
    bg.status === 200 && bgMs < 1000 && bgRow && bgRow.question === 'Background: does the law move?' && bg.body.pending === true && !Number.isNaN(Date.parse(bg.body.pending_since)) && bg.body.stops.length === 0 && bg.body.new_stop === undefined && bg.body.failure === null,
    JSON.stringify({ status: bg.status, bgMs, body: bg.body }));
  const bgBusy = await api('POST', `/walks/${bg.body.id}/step`, { text: 'too soon' }, { wait: false });
  check('a step while the first stop is on its way: 409, as a second tab gets', bgBusy.status === 409 && /already being made/.test(bgBusy.body.error), JSON.stringify(bgBusy.body));
  let bgGet = (await api('GET', `/walks/${bg.body.id}/stops`)).body;
  check('GET /walks/:id/stops while the stop is on its way: pending true, the same pending_since', bgGet.pending === true && bgGet.pending_since === bg.body.pending_since && bgGet.stops.length === 0, JSON.stringify(bgGet));
  for (let i = 0; i < 40 && bgGet.pending; i++) { await wait(250); bgGet = (await api('GET', `/walks/${bg.body.id}/stops`)).body; }
  check('…and once made: pending false, the stop there with its passage, took_ms counted, one asks row',
    bgGet.pending === false && bgGet.pending_since === null && bgGet.failure === null && bgGet.stops.length === 1 && bgGet.stops[0].ref === 'Shabbat 112b' && bgGet.stops[0].took_ms >= 1500 && count('asks') === asksBg + 1,
    JSON.stringify(bgGet).slice(0, 300));
  await control({ walk_teach_ms: 0, walk_teach_down: true });
  const bgFail = await api('POST', `/walks/${bg.body.id}/step`, { pick: 0 }, { wait: false });
  check('a step without ?wait answers at once, pending', bgFail.status === 200 && bgFail.body.pending === true, JSON.stringify(bgFail.body).slice(0, 200));
  bgGet = bgFail.body;
  for (let i = 0; i < 40 && bgGet.pending; i++) { await wait(250); bgGet = (await api('GET', `/walks/${bg.body.id}/stops`)).body; }
  check('a stop that fails in the background: pending false and failure { status 502, the failure line }, the earlier stop kept, no row',
    bgGet.pending === false && bgGet.failure && bgGet.failure.status === 502 && /^The stop could not be made: OpenRouter is unreachable/.test(bgGet.failure.error) && bgGet.stops.length === 1 && count('asks') === asksBg + 1,
    JSON.stringify(bgGet.failure));
  await control({ walk_teach_down: false });
  const bgDec = await api('POST', `/walks/${bg.body.id}/step`, { text: 'What should be done about current Israeli politics?' }, { wait: false });
  bgGet = bgDec.body;
  for (let i = 0; i < 40 && bgGet.pending; i++) { await wait(250); bgGet = (await api('GET', `/walks/${bg.body.id}/stops`)).body; }
  check('a move the guide declines in the background: failure { status 200, declined: <its line> }, and the earlier failure replaced',
    bgGet.pending === false && bgGet.failure && bgGet.failure.status === 200 && /outside what I do/.test(bgGet.failure.declined) && bgGet.failure.error === undefined, JSON.stringify(bgGet.failure));
  const bgOk = await api('POST', `/walks/${bg.body.id}/step`, { pick: 0 }, { wait: false });
  bgGet = bgOk.body;
  check('the next move clears the failure at once', bgOk.body.failure === null && bgOk.body.pending === true, JSON.stringify(bgOk.body.failure));
  for (let i = 0; i < 40 && bgGet.pending; i++) { await wait(250); bgGet = (await api('GET', `/walks/${bg.body.id}/stops`)).body; }
  check('…and the stop is made: two stops, failure null', bgGet.stops.length === 2 && bgGet.failure === null && bgGet.pending === false, JSON.stringify(bgGet).slice(0, 200));


  // --- the hebrew desk is unchanged -------------------------------------------------------
  const heb = await api('POST', '/ask', { subject: { kind: 'root', root: 'ה.מ.ר', lemma: 'הימר' }, question: 'Which words share this root?' });
  const hebAsk = (await calls()).search_asks.at(-1);
  check('the hebrew desk still answers the root ask as before: its own persona, the seven sites, the card model, 900 tokens',
    heb.status === 200 && hebAsk.system.startsWith('You are a Hebrew reference desk') && hebAsk.parameters.allowed_domains.length === 7 && hebAsk.model === 'anthropic/claude-sonnet-4.6' && hebAsk.max_tokens === 900 && peek('SELECT walk_id, ref, took_ms FROM asks WHERE id = ?', heb.body.id).every((r) => r.walk_id === null && r.ref === null && r.took_ms === null),
    JSON.stringify({ status: heb.status, model: hebAsk && hebAsk.model }));
  console.log(`     a card-model request (the root ask): ${JSON.stringify({ model: hebAsk.model, max_tokens: hebAsk.max_tokens, temperature: hebAsk.temperature, reasoning: hebAsk.reasoning, keys: hebAsk.body_keys })}`);
  check('a card-model call (the root ask) carries no reasoning field and keeps temperature 0, as before',
    hebAsk.reasoning === null && !hebAsk.body_keys.includes('reasoning') && hebAsk.temperature === 0, JSON.stringify(hebAsk.body_keys));
  check('the server log names each stop made and each refusal of Sefaria', /walk \d+: stop at Shabbat 112b \(ask \d+\) in \d+ ms/.test(server.log) && /sefaria: "Notabook 1" not known/.test(server.log));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(server.log.split('\n').slice(-40).join('\n')); console.log(`\n${failed} walks check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} walks checks passed`);
