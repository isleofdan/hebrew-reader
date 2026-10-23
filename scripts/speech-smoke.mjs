// Server checks for hebrew-speech-one: a word spoken on the Look up page —
// POST /lookup/speech writing the recording down (the stand-in answers from
// scripts/fixtures/speech/: the real answer to the WebM recording of אמת,
// and hand-written English, empty, noise and refusal answers), the file and
// its row kept, attached once to the "Looked up" row its look-up made,
// listed on GET /lookups, played back whole and in ranges, deleted; the
// refusals (415, 413, 502, nothing heard) keeping nothing; nothing saved or
// marked by speaking — against the real server with the stand-ins for
// OpenRouter and the spine. The seven-day sweep calls lib/speech.js in this
// process with the clock set from here. About 2 s.
//   node scripts/speech-smoke.mjs      (npm run smoke runs it)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8920, OR_PORT = 8921, SPINE_PORT = 8922, REF_PORT = 8923;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-speech-'));
const libDir = mkdtempSync(join(tmpdir(), 'hr-speech-lib-'));
const require = createRequire(import.meta.url);
const Database = require(join(root, 'node_modules', 'better-sqlite3'));
const FIX = join(here, 'fixtures', 'speech');
const webm = readFileSync(join(FIX, 'he-emet.webm'));
const wav = readFileSync(join(FIX, 'he-emet.wav'));
const ogg = readFileSync(join(FIX, 'he-emet.ogg'));

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
start('node', ['scripts/mock-references.mjs', String(REF_PORT)]);
const mock = `http://127.0.0.1:${OR_PORT}`;
const spineUrl = `http://127.0.0.1:${SPINE_PORT}`;
const standin = `http://127.0.0.1:${REF_PORT}`;
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 's'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `${mock}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: spineUrl, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;
const recDir = join(dataDir, 'recordings');
const files = () => (existsSync(recDir) ? readdirSync(recDir).sort() : []);

try {
  await up(`${base}/health`); await up(`${mock}/calls`); await up(`${spineUrl}/api/health`); await up(`${standin}/calls`);
  const orControl = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
  const asks = async () => (await (await fetch(`${mock}/calls`)).json()).speech_asks;
  const spinePuts = async () => Object.values((await (await fetch(`${spineUrl}/puts`)).json()).puts).reduce((n, v) => n + v, 0);
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const count = (table, where = '1=1', ...a) => peek(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a)[0].n;

  const out = await fetch(`${base}/lookup/speech`, { method: 'POST', headers: { 'content-type': 'audio/webm', accept: 'application/json' }, body: webm });
  const outGet = await fetch(`${base}/recordings/1`);
  check('signed out, POST /lookup/speech and GET /recordings/1 answer 401 and nothing reaches the model', out.status === 401 && outGet.status === 401 && (await asks()).length === 0);

  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const speak = async (bytes, type, query = '') => {
    const res = await fetch(`${base}/lookup/speech${query}`, { method: 'POST', headers: { cookie, accept: 'application/json', ...(type ? { 'content-type': type } : {}) }, body: bytes });
    return { status: res.status, body: await res.json() };
  };
  const look = (surface) => api('POST', '/lookup', { surface, origin: 'lookup' });
  const rowOf = async (key) => (await api('GET', '/lookups')).body.items.find((i) => i.key === key);

  check('the new table exists, empty: recordings (id, row_key, file, mime, bytes, ms, text, model, at), and the recordings folder under DATA_DIR',
    peek('PRAGMA table_info(recordings)').map((c) => c.name).join() === 'id,row_key,file,mime,bytes,ms,text,model,at' && count('recordings') === 0 && existsSync(recDir) && files().length === 0);

  // --- verify 1 (server): the Hebrew word written down, kept, nothing saved ----------------------
  const spots0 = count('spots'), puts0 = await spinePuts(), lookups0 = count('lookups'), touches0 = count('touches');
  const he = await speak(webm, 'audio/webm;codecs=opus', '?ms=1840');
  const ask = (await asks()).at(-1);
  check('the phone\'s WebM/Opus recording (its type with ;codecs=opus) answers { id, text: "אמת", ms }', he.status === 200 && he.body.id === 1 && he.body.text === 'אמת' && he.body.ms === 1840, JSON.stringify(he));
  check('…sent as it is: one request to google/gemini-3.8-flash with the recording\'s bytes as an input_audio part, format "webm", and the text "Write down what is said in this recording."',
    ask && ask.model === 'google/gemini-3.8-flash' && ask.format === 'webm' && ask.bytes === webm.length && ask.text === 'Write down what is said in this recording.', JSON.stringify(ask));
  check('…with the system text that only writes down (script spoken, no nikud, no translation, no correction, empty when nothing intelligible), reasoning { effort: minimal }, temperature 0, no response format',
    ask.system === 'You write down speech. Return only the words spoken, in the script they were spoken in: Hebrew letters for Hebrew, Latin letters for English. Add no nikud, translate nothing, correct nothing. If nothing intelligible was said, return an empty answer.'
    && JSON.stringify(ask.reasoning) === '{"effort":"minimal"}' && ask.temperature === 0 && !ask.body_keys.includes('response_format'), JSON.stringify(ask));
  const r1 = peek('SELECT * FROM recordings WHERE id = 1')[0];
  check('the recording kept as DATA_DIR/recordings/1.webm, byte for byte, with its row: row_key null, audio/webm, its size, 1840 ms, "אמת", the model, the time',
    files().join() === '1.webm' && readFileSync(join(recDir, '1.webm')).equals(webm) && r1.row_key === null && r1.file === '1.webm' && r1.mime === 'audio/webm' && r1.bytes === webm.length && r1.ms === 1840 && r1.text === 'אמת' && r1.model === 'google/gemini-3.8-flash' && /^\d{4}-\d\d-\d\dT/.test(r1.at), JSON.stringify(r1));
  check('writing it down saved nothing: no spot, no touch, no lookup, no mark to the spine', count('spots') === spots0 && count('touches') === touches0 && count('lookups') === lookups0 && (await spinePuts()) === puts0);

  // the text through the look-up, as typed; the recording attached to its row
  const typed = await look(he.body.text);
  check('the heard text looked up as typed text: אמת\'s card ("truth"), saved as his word, its row key word:<id>, no recordings yet',
    typed.status === 200 && typed.body.card.meaning_en === 'truth' && /^word:\d+$/.test(typed.body.key) && typed.body.saved.status === 'shaky' && JSON.stringify(typed.body.recordings) === '[]', JSON.stringify(typed.body).slice(0, 300));
  check('…saving exactly what typing saves: one spot made (new, then shaky) and one mark sent to the spine', count('spots') === spots0 + 1 && (await spinePuts()) === puts0 + 1);
  const att = await api('POST', '/recordings/1/attach', { row_key: typed.body.key });
  check('POST /recordings/1/attach { row_key } sets the key', att.status === 200 && att.body.row_key === typed.body.key && peek('SELECT row_key FROM recordings WHERE id = 1')[0].row_key === typed.body.key, JSON.stringify(att));
  const row1 = await rowOf(typed.body.key);
  check('GET /lookups: the row carries recordings [{ id, ms, at }]', row1 && row1.recordings.length === 1 && row1.recordings[0].id === 1 && row1.recordings[0].ms === 1840 && row1.recordings[0].at === r1.at && Object.keys(row1.recordings[0]).join() === 'id,ms,at', JSON.stringify(row1));
  check('attaching sent no mark and made no spot', count('spots') === spots0 + 1 && (await spinePuts()) === puts0 + 1);
  const again = await api('POST', '/recordings/1/attach', { row_key: 'english:run' });
  check('attach again (another row) is refused 409, the recording staying on its first row', again.status === 409 && /already attached to word:/.test(again.body.error) && peek('SELECT row_key FROM recordings WHERE id = 1')[0].row_key === typed.body.key, JSON.stringify(again));
  check('attach refusals: a key that is no row\'s 400, an unknown recording 404',
    (await api('POST', '/recordings/1/attach', { row_key: 'card 5' })).status === 400 && (await api('POST', '/recordings/999/attach', { row_key: 'word:1' })).status === 404);

  // WAV and Ogg too, each in its own format; a second recording on the same row, newest first
  const w = await speak(wav, 'audio/wav', '?ms=1800');
  check('16 kHz WAV is taken too: sent as format "wav", kept as 2.wav', w.status === 200 && w.body.id === 2 && (await asks()).at(-1).format === 'wav' && existsSync(join(recDir, '2.wav')), JSON.stringify(w));
  const o = await speak(ogg, 'audio/ogg');
  check('Ogg too: format "ogg", kept as 3.ogg, ms null when the page gave none', o.status === 200 && (await asks()).at(-1).format === 'ogg' && existsSync(join(recDir, '3.ogg')) && o.body.ms === null && peek('SELECT ms FROM recordings WHERE id = 3')[0].ms === null);
  await wait(5);
  await look('אמת');
  await api('POST', `/recordings/${w.body.id}/attach`, { row_key: typed.body.key });
  const row2 = await rowOf(typed.body.key);
  check('two recordings on one row, newest first', row2.recordings.map((r) => r.id).join() === '2,1', JSON.stringify(row2.recordings));
  const again2 = await look('אמת');
  check('the look-up answer for the row carries its recordings too (the card\'s play button)', again2.body.recordings.map((r) => r.id).join() === '2,1');

  // --- verify 2: playback, whole and in ranges --------------------------------------------------
  const whole = await fetch(`${base}/recordings/1`, { headers: { cookie } });
  const wb = Buffer.from(await whole.arrayBuffer());
  check('GET /recordings/1 streams the file with its type (audio/webm), Accept-Ranges: bytes and its length', whole.status === 200 && whole.headers.get('content-type') === 'audio/webm' && whole.headers.get('accept-ranges') === 'bytes' && Number(whole.headers.get('content-length')) === webm.length && wb.equals(webm));
  const part = await fetch(`${base}/recordings/1`, { headers: { cookie, range: 'bytes=100-1099' } });
  const pb = Buffer.from(await part.arrayBuffer());
  console.log(`     range: ${part.status} ${part.headers.get('content-range')} (${pb.length} bytes)`);
  check('a ranged request (bytes=100-1099) answers 206 with Content-Range and exactly those bytes', part.status === 206 && part.headers.get('content-range') === `bytes 100-1099/${webm.length}` && pb.equals(webm.subarray(100, 1100)) && part.headers.get('content-type') === 'audio/webm');
  const tail = await fetch(`${base}/recordings/1`, { headers: { cookie, range: 'bytes=-500' } });
  const open = await fetch(`${base}/recordings/1`, { headers: { cookie, range: 'bytes=29000-' } });
  check('a suffix range (the last 500 bytes) and an open range answer 206 with their bytes',
    tail.status === 206 && Buffer.from(await tail.arrayBuffer()).equals(webm.subarray(webm.length - 500)) && open.status === 206 && Buffer.from(await open.arrayBuffer()).equals(webm.subarray(29000)));
  const past = await fetch(`${base}/recordings/1`, { headers: { cookie, range: `bytes=${webm.length + 10}-` } });
  check('a range past the end answers 416 naming the size', past.status === 416 && past.headers.get('content-range') === `bytes */${webm.length}`);
  const wavGet = await fetch(`${base}/recordings/2`, { headers: { cookie } });
  check('the WAV plays back as audio/wav', wavGet.status === 200 && wavGet.headers.get('content-type') === 'audio/wav' && Buffer.from(await wavGet.arrayBuffer()).equals(wav));
  check('an unknown recording answers 404', (await fetch(`${base}/recordings/999`, { headers: { cookie } })).status === 404);

  // --- verify 3 (server): an English word, hung off its english: row ------------------------------
  await orControl({ speech: 'english' });
  const en = await speak(webm, 'audio/webm');
  const enLook = await look(en.body.text);
  check('an English word spoken ("run") is written down and opens its list of Hebrew words, the answer naming its row english:run',
    en.status === 200 && en.body.text === 'run' && enLook.body.mode === 'english' && enLook.body.key === 'english:run' && enLook.body.groups.some((g) => g.rows.length), JSON.stringify(enLook.body).slice(0, 200));
  await api('POST', `/recordings/${en.body.id}/attach`, { row_key: enLook.body.key });
  const enRow = await rowOf('english:run');
  check('…and the recording hangs off the english:run row in "Looked up"', enRow && enRow.kind === 'english' && enRow.recordings.map((r) => r.id).join() === String(en.body.id), JSON.stringify(enRow));

  // --- verify 4: refusals and failures keep nothing ------------------------------------------------
  const rows0 = count('recordings'), files0 = files().join(), asks0 = (await asks()).length;
  const bad = await speak(Buffer.from('hello'), 'text/plain');
  check('another type answers 415 naming the four, with no request to the model', bad.status === 415 && bad.body.error === 'A recording is sent as audio/webm, audio/ogg, audio/mp4 or audio/wav; this was text/plain.' && (await asks()).length === asks0, JSON.stringify(bad));
  const none = await speak(webm, null);
  check('no type at all answers 415 too', none.status === 415);
  const big = await speak(Buffer.alloc(2 * 1024 * 1024 + 1, 1), 'audio/webm');
  check('over 2 MB answers 413 "A recording can be at most 30 seconds."', big.status === 413 && big.body.error === 'A recording can be at most 30 seconds.' && (await asks()).length === asks0, JSON.stringify(big));
  check('ms that is not a length answers 400', (await speak(webm, 'audio/webm', '?ms=soon')).status === 400);
  await orControl({ speech: 'empty' });
  const empty = await speak(webm, 'audio/webm');
  check('an empty transcript answers 200 { id: null, text: "", message: "Nothing was heard. Try again." }', empty.status === 200 && JSON.stringify(empty.body) === '{"id":null,"text":"","message":"Nothing was heard. Try again."}', JSON.stringify(empty));
  await orControl({ speech: 'noise' });
  const noise = await speak(webm, 'audio/webm');
  check('only noise ("[noise]") answers the same', noise.status === 200 && noise.body.id === null && noise.body.message === 'Nothing was heard. Try again.');
  check('…and neither kept a file or a row', count('recordings') === rows0 && files().join() === files0);
  await orControl({ speech: 'refusal' });
  const asksR = (await asks()).length;
  const refused = await speak(webm, 'audio/webm');
  check('the model refusing (400) answers 502 "The recording could not be written down; try again or type it."', refused.status === 502 && refused.body.error === 'The recording could not be written down; try again or type it.', JSON.stringify(refused));
  check('…asked once more without reasoning (the helper\'s own retry), then given up', (await asks()).length === asksR + 2 && (await asks()).at(-1).reasoning === null && (await asks()).at(-1).temperature === 0);
  await orControl({ speech: 'down' });
  const down = await speak(webm, 'audio/webm');
  check('the model down answers the same 502', down.status === 502 && down.body.error === 'The recording could not be written down; try again or type it.');
  check('…and neither kept a file or a row', count('recordings') === rows0 && files().join() === files0, files().join());
  check('the server log names the refusal and the drop, not the passphrase or the key', /speech: The recording could not be written down: OpenRouter answered 400/.test(server.log) && /speech: The recording could not be written down: OpenRouter is unreachable/.test(server.log) && !server.log.includes('test-key'));
  await orControl({ speech: 'hebrew' });

  // the second look-up after editing leaves the recording on its first row
  const s2 = await speak(webm, 'audio/webm');
  const first = await look(s2.body.text);
  await api('POST', `/recordings/${s2.body.id}/attach`, { row_key: first.body.key });
  const edited = await look('רפורמה');
  const re = await api('POST', `/recordings/${s2.body.id}/attach`, { row_key: edited.body.key });
  check('a second look-up after editing the text (רפורמה): attaching to its row is refused 409, the recording stays on אמת\'s row, and רפורמה\'s row has none',
    re.status === 409 && peek('SELECT row_key FROM recordings WHERE id = ?', s2.body.id)[0].row_key === first.body.key && (await rowOf(edited.body.key)).recordings.length === 0);

  // --- verify 7 (server): delete ------------------------------------------------------------------
  const del = await api('DELETE', `/recordings/${w.body.id}`);
  check('DELETE /recordings/2 removes the row and the file', del.status === 200 && count('recordings', 'id = ?', w.body.id) === 0 && !existsSync(join(recDir, '2.wav')));
  check('…the row\'s other recordings stay, and so does the word (spot, card)', (await rowOf(typed.body.key)).recordings.map((r) => r.id).join() === `${s2.body.id},1` && count('spots', 'id = ?', 'w:אמת') === 1);
  check('a second DELETE answers 404', (await api('DELETE', `/recordings/${w.body.id}`)).status === 404);

  // --- in this process, with the clock set: the seven-day sweep -------------------------------------
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_URL = `${mock}/v1/chat/completions`;
  const db = require(join(root, 'lib', 'db.js'));
  db.open(libDir);
  const speech = require(join(root, 'lib', 'speech.js'));
  const DAY = 24 * 3600 * 1000;
  let at = Date.parse('2026-10-23T03:00:00Z');
  speech.setClock(() => at);
  check('in this process: start-up with nothing to sweep sweeps nothing', speech.init(libDir) === 0);
  const libFiles = () => readdirSync(join(libDir, 'recordings')).sort().join();
  const a = await speech.hear(webm, 'audio/webm');
  const b = await speech.hear(webm, 'audio/webm');
  speech.attach(b.id, 'word:1');
  at += 6 * DAY;
  const c = await speech.hear(webm, 'audio/webm');
  at += 1 * DAY + 60000;
  const logs = [];
  const log0 = console.log;
  console.log = (...x) => logs.push(x.join(' '));
  const swept = speech.init(libDir);
  console.log = log0;
  check('seven days on, the start-up sweep deletes only the unattached recording older than seven days, row and file (count 1)',
    swept === 1 && !db.getRecording(a.id) && db.getRecording(b.id) && db.getRecording(c.id) && libFiles() === `${b.id}.webm,${c.id}.webm`, JSON.stringify([swept, libFiles()]));
  check('…logged once with the count', logs.filter((l) => /speech: 1 recording\(s\) never attached/.test(l)).length === 1, logs.join(' | '));
  at += 30 * DAY;
  check('a month on, the attached one still stays; the other unattached one goes', speech.sweep() === 1 && db.getRecording(b.id) && !db.getRecording(c.id) && libFiles() === `${b.id}.webm`);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  if (failed) console.log(server.log.split('\n').slice(-30).join('\n'));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(libDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} speech check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} speech checks passed`);
