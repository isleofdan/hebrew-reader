// Server checks for hebrew-today-one: Today's daily drills — choosing the
// day's words, each word's exercise, fresh passages, when a set is made, the
// 05:00 Tokyo scheduler, answers and status, Show and Undo — against local
// stand-ins for OpenRouter and the spine. Part one goes through a real server
// (GET /today/set, POST /today/answer, /show, /undo); part two calls
// lib/today.js in this process with a seeded clock, for what turns on the day.
//   node scripts/today-smoke.mjs   (npm test runs it)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seed } from './today-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const PORT = 8880, OR_PORT = 8881, SPINE_PORT = 8882;
const PASS = 'open-sesame';
const dirs = [];
const newDir = (name) => { const d = mkdtempSync(join(tmpdir(), `hr-today-${name}-`)); dirs.push(d); return d; };

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
// what the app logs while part two runs in this process is kept, and shown
// only when a check fails
const say = (line) => process.stdout.write(line + '\n');
let appLog = '';
const quiet = () => { console.log = console.error = (...a) => { appLog += a.join(' ') + '\n'; }; };
let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

Object.assign(process.env, {
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`,
});
const db = require(join(root, 'lib', 'db.js'));
const Database = require(join(root, 'node_modules', 'better-sqlite3'));

start('node', ['scripts/mock-openrouter.mjs', String(OR_PORT)]);
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
const dirA = newDir('server');
const A = seed(db, dirA);
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dirA, APP_PASSWORD: PASS, COOKIE_SECRET: 'y'.repeat(64), COOKIE_INSECURE: '1',
});
const base = `http://127.0.0.1:${PORT}`;
const enc = encodeURIComponent;
const orCalls = async () => (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json();
const orControl = (c) => fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify(c) });
const spineBodies = async (id) => (await (await fetch(`http://127.0.0.1:${SPINE_PORT}/bodies?item=${enc(id)}`)).json()).bodies;
const tokyo = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + offsetDays * 86400000));
const noon = (day) => new Date(`${day}T12:00:00+09:00`);

try {
  await up(`${base}/health`); await up(`http://127.0.0.1:${OR_PORT}/calls`); await up(`http://127.0.0.1:${SPINE_PORT}/api/health`);

  // ================= part one: through the server =================
  const out = await fetch(`${base}/today`, { redirect: 'manual' });
  check('signed out, GET /today is a page: 303 to /login', out.status === 303 && out.headers.get('location') === '/login', `${out.status} ${out.headers.get('location')}`);
  const outSet = await fetch(`${base}/today/set`, { headers: { accept: 'application/json' } });
  check('signed out, GET /today/set answers 401 in JSON', outSet.status === 401 && /Sign in/.test((await outSet.json()).error));
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const peek = (sql, ...a) => { const d = new Database(join(dirA, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

  const set = (await api('GET', '/today/set')).body;
  const items = set.items || [];
  say('  the ten sources:');
  items.forEach((it) => say(`    ${it.index + 1}. ${it.kind.padEnd(11)} ${(it.word || '').padEnd(8)} ${it.source}`));
  check('verify 1: GET /today/set returns ten items: six lesson words, then two article words, then two passages',
    items.length === 10 && items.map((it) => it.group).join() === 'lesson,lesson,lesson,lesson,lesson,lesson,article,article,passage,passage', items.map((it) => it.group).join());
  check('…the six lesson items say "From Guy\'s lesson <title>", the two article items "From <article title>"',
    items.slice(0, 6).every((it) => it.source.startsWith("From Guy's lesson שיעור עם גיא")) && items.slice(6, 8).every((it) => it.source === 'From רפורמה במשק החשמל'));
  check('…the oldest-touched lesson word is item 1 (נאלצה, touched first)', items[0].spot_id === A.spots['נאלצה'] && items[0].word === 'נאלצה');
  check('lesson words before article words: the first lesson\'s six words fill the lesson slots, the newer lesson waits', items.slice(0, 6).every((it) => it.lesson_id === A.lessons[0]));
  const byWord = Object.fromEntries(items.filter((it) => it.word).map((it) => [it.word, it]));
  check('conjugation -> Give the form: the lesson\'s own sentence with the verb blanked; typed forms are checked against נאלצה',
    byWord['נאלצה'].kind === 'form' && byWord['נאלצה'].sentence === 'הממשלה … לדחות את ההצבעה' && byWord['נאלצה'].answer === 'נאלצה' && byWord['נאלצה'].made_up === false, JSON.stringify(byWord['נאלצה']));
  check('conjugation with no read sentence -> a made-up sentence (one model call), marked made_up',
    byWord['ייקבעו'].kind === 'form' && byWord['ייקבעו'].made_up === true && byWord['ייקבעו'].sentence.includes('…'));
  check('conjugation in an article -> the article\'s sentence, blanked', byWord['אישרה'].kind === 'form' && byWord['אישרה'].sentence === 'בסוף השבוע הוועדה … את התוכנית.');
  check('preposition-government -> Which preposition: עם blanked in the sentence, three choices with the right one',
    byWord['להתמודד'].kind === 'preposition' && byWord['להתמודד'].sentence === 'החברה תצטרך להתמודד … המשבר' && byWord['להתמודד'].choices.length === 3 && byWord['להתמודד'].choices.includes('עם') && byWord['להתמודד'].answer === 'עם', JSON.stringify(byWord['להתמודד']));
  check('letter-order -> Which spelling: the word blanked in a made-up sentence (the lesson holds it alone), the word and the model\'s misspelling, two choices',
    byWord['להתבייש'].kind === 'spelling' && byWord['להתבייש'].made_up === true && byWord['להתבייש'].sentence === 'בישיבה אתמול … השר להסביר את עמדתו.'
    && byWord['להתבייש'].choices.length === 2 && byWord['להתבייש'].choices.includes('להתבייש') && byWord['להתבייש'].choices.includes('לתהבייש'), JSON.stringify(byWord['להתבייש']));
  check('homophonous-spelling -> Which spelling: the article\'s own sentence with הממסד blanked',
    byWord['הממסד'].kind === 'spelling' && byWord['הממסד'].made_up === false && byWord['הממסד'].sentence === '… הפוליטי התנגד לשינוי במשך שנים.' && byWord['הממסד'].choices.includes('הממסד'), JSON.stringify(byWord['הממסד']));
  check('sound-pattern-deviation -> Do you know it, the word in its sentence', byWord['הסלמה'].kind === 'know');
  check('no category -> Do you know it', byWord['רפורמה'].kind === 'know');
  check('every word item carries the spot id, the kind, the sentence, the answer or choices, and the source',
    items.slice(0, 8).every((it) => it.spot_id && it.kind && it.sentence && (it.answer || it.kind === 'know') && it.source), JSON.stringify(items.slice(0, 8).filter((it) => !it.sentence).map((it) => it.word)));
  const POINTS = /[ְ-ׇ]/;
  check('niqud on answers: Give the form carries the word\'s pointed form from its card (answer_pointed נֶאֶלְצָה)',
    byWord['נאלצה'].answer_pointed === 'נֶאֶלְצָה' && byWord['נאלצה'].word_pointed === 'נֶאֶלְצָה', JSON.stringify([byWord['נאלצה'].answer_pointed, byWord['נאלצה'].word_pointed]));
  check('…a card with only its dictionary form pointed: the word is named with it (word_pointed הִתְבַּיֵּשׁ), but the gap keeps the answer itself plain (answer_pointed null: להתבייש is not התבייש); a card with none gives null (ייקבעו)',
    byWord['להתבייש'].word_pointed === 'הִתְבַּיֵּשׁ' && byWord['להתבייש'].answer_pointed === null && byWord['ייקבעו'].answer_pointed === null && byWord['ייקבעו'].word_pointed === null, JSON.stringify([byWord['להתבייש'].word_pointed, byWord['להתבייש'].answer_pointed]));
  const unpoint = (s) => String(s).replace(/[֑-ׇ]/g, '');
  check('…every pointed answer is the answer itself with its points: niqud stripped, it is the expected answer',
    items.filter((it) => it.answer_pointed).length >= 2 && items.filter((it) => it.answer_pointed).every((it) => unpoint(it.answer_pointed) === it.answer), JSON.stringify(items.filter((it) => it.answer_pointed).map((it) => [it.answer, it.answer_pointed])));
  check('…the right preposition pointed (עִם), the word pointed where its card has it (רֵפוֹרְמָה)', byWord['להתמודד'].answer_pointed === 'עִם' && byWord['רפורמה'].word_pointed === 'רֵפוֹרְמָה');
  check('…while the questions and the choices to tap carry no niqud', items.slice(0, 8).every((it) => !POINTS.test(it.sentence) && !(it.choices || []).some((c) => POINTS.test(c)) && !POINTS.test(it.answer || '')));
  const [p1, p2] = items.slice(8);
  const calls1 = await orCalls();
  check('fresh passages: two, made with the guide model and a JSON schema, each using at least three of the words given',
    p1.kind === 'passage' && p2.kind === 'passage' && p1.words_used.length >= 3 && p2.words_used.length >= 3 && calls1.passage_calls === 2
    && calls1.last_passage_ask.model === 'anthropic/claude-fable-5.1' && calls1.last_passage_ask.schema_name === 'today_passage', JSON.stringify(calls1.last_passage_ask && calls1.last_passage_ask.model));
  check('…the subjects in turn, the questions alternating (a verb blanked, then a comprehension question with three choices)',
    p1.subject.startsWith('energy') && p2.subject === 'business and markets' && p1.question.type === 'form' && p1.question.text.includes('…')
    && p2.question.type === 'choice' && p2.question.choices.length === 3 && p2.question.answer === 'על החלטה של הממשלה');
  const ownVerbs = p1.words_used.filter((w) => w.spot_id.startsWith('v:')).map((w) => w.surface);
  check('the verb blanked in a passage is one of Dan\'s given shaky verbs where it has one (not the model\'s החליטה)',
    ownVerbs.length > 0 && p1.question.answer === ownVerbs[0] && p1.question.answer !== 'החליטה', JSON.stringify([p1.question.answer, ownVerbs]));
  check('…and words already saved (shaky) are never sent to be judged: no judging call for this set', (await orCalls()).difficulty_calls === 0);
  check('…at most two new words, each a word of the passage', p1.new_words.length === 1 && p1.new_words[0].surface === 'המכרז' && p1.text.includes('המכרז'));
  const counts = [p1, p2].map((p) => p.text.split(/[.!?]+/).filter((s) => /[א-ת]/.test(s)).length);
  check('…each passage kept is three to five sentences', counts.every((n) => n >= 3 && n <= 5), counts.join());
  check('…the passage items record no spot', p1.spot_id === null && p2.spot_id === null);
  const again = (await api('GET', '/today/set')).body;
  check('the set is made once: a second GET serves the same set and asks the model nothing', again.set.id === set.set.id && (await orCalls()).passage_calls === 2 && peek('SELECT COUNT(*) AS n FROM drill_sets')[0].n === 1);
  const page = await fetch(`${base}/today`, { headers: { cookie } });
  check('signed in, GET /today serves the page', page.status === 200 && /<title>Hebrew reader · Today<\/title>/.test(await page.text()));

  // verify 2: item 1 answered wrong
  const n0 = (await spineBodies(A.spots['נאלצה'])).length;
  const wrong = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 0, answer: 'נאלץ' });
  const sp = (await api('GET', `/spots/${enc(A.spots['נאלצה'])}`)).body;
  const bodies = await spineBodies(A.spots['נאלצה']);
  check('verify 2: a typed form that is not the word is judged wrong, whatever result the page sent', wrong.status === 200 && wrong.body.result === 'wrong');
  check(`verify 2: after a wrong answer the word is due tomorrow (${tokyo(1)}, Tokyo), interval 1, run 0, shaky`,
    sp.due_on === tokyo(1) && sp.interval_days === 1 && sp.right_run === 0 && sp.status === 'shaky', JSON.stringify({ due_on: sp.due_on, interval_days: sp.interval_days, right_run: sp.right_run, status: sp.status }));
  const lastBody = bodies.at(-1) || {};
  check('verify 2: the spine received a PUT whose body carries status, due_on and interval_days at the top level',
    bodies.length === n0 + 1 && lastBody.status === 'shaky' && lastBody.due_on === tokyo(1) && lastBody.interval_days === 1, JSON.stringify(lastBody));
  check('the flash names the word with its niqud, and the result', wrong.body.flash.text === 'נֶאֶלְצָה — wrong; next due tomorrow' && wrong.body.flash.word_pointed === 'נֶאֶלְצָה', wrong.body.flash.text);
  const after = (await api('GET', '/today/set')).body;
  check('an answered item is recorded and the set goes on from the next one after a reload', after.items[0].answered.result === 'wrong' && after.position === 1);
  const twice = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 0, result: 'right' });
  check('an item answered right or wrong cannot be answered again in the same set (409, says Undo)', twice.status === 409 && /Undo/.test(twice.body.error));
  // verify 4: Undo
  const rowsBefore = peek('SELECT COUNT(*) AS n FROM drill_answers')[0].n;
  const undone = await api('POST', '/today/undo', { set_id: set.set.id, answer_id: wrong.body.answer_id });
  const sp2 = (await api('GET', `/spots/${enc(A.spots['נאלצה'])}`)).body;
  check('verify 4: Undo deletes the drill_answers row', undone.status === 200 && peek('SELECT COUNT(*) AS n FROM drill_answers')[0].n === rowsBefore - 1 && !peek('SELECT * FROM drill_answers WHERE id = ?', wrong.body.answer_id).length);
  check('verify 4: …and the word\'s four fields are as before the answer (due_on null, interval 0, run 0, shaky)',
    sp2.due_on === null && sp2.interval_days === 0 && sp2.right_run === 0 && sp2.status === 'shaky', JSON.stringify({ due_on: sp2.due_on, interval_days: sp2.interval_days, right_run: sp2.right_run, status: sp2.status }));
  check('…the item can be answered again', (await api('GET', '/today/set')).body.items[0].answered === null);
  const undoBody = (await spineBodies(A.spots['נאלצה'])).at(-1) || {};
  const marks = await (await fetch(`http://127.0.0.1:${SPINE_PORT}/api/marks?app=hebrew-reader`, { headers: { authorization: 'Bearer test-spine-token' } })).json();
  const stored = marks.items.find((m) => m.item_id === A.spots['נאלצה']) || {};
  check('Undo of a word\'s first answer clears its schedule on the spine too: the mark sends due_on and interval_days as null, and the stored mark holds null',
    'due_on' in undoBody && undoBody.due_on === null && 'interval_days' in undoBody && undoBody.interval_days === null && stored.due_on === null && stored.interval_days === null, JSON.stringify({ undoBody, stored }));
  const undoNone = await api('POST', '/today/undo', { set_id: set.set.id });
  check('Undo with nothing to undo answers 409', undoNone.status === 409);
  const bad = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 4, result: 'maybe' });
  check('a result other than right or wrong is refused with a 400 naming them', bad.status === 400 && /right, wrong/.test(bad.body.error));
  const badIndex = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 99, result: 'right' });
  const badSet = await api('POST', '/today/answer', { set_id: 999, item_index: 0, result: 'right' });
  check('an item or a set that is not there: 400 and 404', badIndex.status === 400 && badSet.status === 404);
  const shown = await api('POST', '/today/show', { set_id: set.set.id, item_index: 4 });
  check('Show on Do you know it records the show and reveals the word\'s card', shown.status === 200 && shown.body.card.meaning_en === 'a reform'
    && peek("SELECT result FROM drill_answers WHERE item_index = 4 AND set_id = ?", set.set.id).map((r) => r.result).join() === 'shown');
  const showSpell = await api('POST', '/today/show', { set_id: set.set.id, item_index: 3 });
  check('Show reveals the answer (plain where the card has no pointed form of that very word), and the card with its niqud', showSpell.body.answer === 'להתבייש' && showSpell.body.answer_pointed === null && showSpell.body.card.pointed.lemma === 'הִתְבַּיֵּשׁ', JSON.stringify([showSpell.body.answer, showSpell.body.answer_pointed]));  const view4 = (await api('GET', '/today/set')).body.items[4];
  check('…the item then waits for the tap: shown, not answered', view4.shown === true && view4.answered === null);
  const had = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 4, result: 'right' });
  const sp4 = (await api('GET', `/spots/${enc(A.spots['רפורמה'])}`)).body;
  check('"I had it" moves the word by Dan\'s own answer: run 1, interval 1, due tomorrow', had.body.result === 'right' && sp4.right_run === 1 && sp4.interval_days === 1 && sp4.due_on === tokyo(1));
  const prep = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 2, answer: 'עם', result: 'wrong' });
  check('a chosen preposition is judged by the server (עם is right even when the page says wrong)', prep.body.result === 'right');
  const pas = await api('POST', '/today/answer', { set_id: set.set.id, item_index: 8, answer: p1.question.answer });
  check('a passage\'s answer is one row with no spot', pas.body.result === 'right' && peek('SELECT spot_id FROM drill_answers WHERE set_id = ? AND item_index = 8', set.set.id)[0].spot_id === null);
  const passShow = await api('POST', '/today/show', { set_id: set.set.id, item_index: 8 });
  check('Show on an answered passage gives its English and records nothing more', /government/.test(passShow.body.english) && peek('SELECT COUNT(*) AS n FROM drill_answers WHERE item_index = 8')[0].n === 1);

  // "Too easy": the word marked solid through the save (the spine has it); Undo puts it back
  const W5 = A.spots['הסלמה'];
  const before5 = (await api('GET', `/spots/${enc(W5)}`)).body;
  const easy = await api('POST', '/today/easy', { set_id: set.set.id, item_index: 5 });
  const sp5 = (await api('GET', `/spots/${enc(W5)}`)).body;
  const b5 = (await spineBodies(W5)).at(-1) || {};
  check('"Too easy" marks the word solid, through the save: the spine receives solid; its schedule is left as it was',
    easy.status === 200 && sp5.status === 'solid' && b5.status === 'solid' && easy.body.spine === 'recorded' && sp5.due_on === before5.due_on && sp5.interval_days === before5.interval_days, JSON.stringify([easy.body.error, sp5.status, b5.status]));
  check('…the flash says so plainly ("הסלמה — too easy; marked solid"), and the item counts as answered, too easy',
    easy.body.flash.text === 'הסלמה — too easy; marked solid' && easy.body.view.items[5].answered.too_easy === true, easy.body.flash && easy.body.flash.text);
  const easyAgain = await api('POST', '/today/easy', { set_id: set.set.id, item_index: 5 });
  const easyPassage = await api('POST', '/today/easy', { set_id: set.set.id, item_index: 9 });
  check('"Too easy" twice on one item: 409; on a passage (no word): 400', easyAgain.status === 409 && easyPassage.status === 400, `${easyAgain.status} ${easyPassage.status}`);
  const easyUndo = await api('POST', '/today/undo', { set_id: set.set.id });
  const sp5b = (await api('GET', `/spots/${enc(W5)}`)).body;
  check('Undo reverses "Too easy" like any answer: shaky again, the spine told shaky, the item open again',
    easyUndo.status === 200 && sp5b.status === 'shaky' && (await spineBodies(W5)).at(-1).status === 'shaky' && easyUndo.body.view.items[5].answered === null, JSON.stringify([easyUndo.body.error, sp5b.status]));

  // hebrew-today-two: "Another set" (POST /today/another), through the server
  for (const it of (await api('GET', '/today/set')).body.items) {
    if (it.answered) continue;
    const body = it.kind === 'passage' ? { answer: it.question.answer } : { result: 'right' };
    await api('POST', '/today/answer', { set_id: set.set.id, item_index: it.index, ...body });
  }
  const finished = (await api('GET', '/today/set')).body;
  check('two: a finished set stays on its "Done" screen: GET /today/set serves it, done, and makes no second set by itself',
    finished.set.id === set.set.id && finished.done === true && peek('SELECT COUNT(*) AS n FROM drill_sets')[0].n === 1, JSON.stringify([finished.set, finished.done]));
  const pcA = (await orCalls()).passage_calls;
  const another = await api('POST', '/today/another');
  const setRows = peek('SELECT id, seq, for_day FROM drill_sets ORDER BY seq');
  check('two, verify 1: POST /today/another makes a new set at item 1 with a different seq: two drill_sets rows, the second numbered after the first',
    another.status === 200 && another.body.state === 'ok' && another.body.position === 0 && another.body.done === false && another.body.items.length > 0
    && setRows.length === 2 && another.body.set.id === setRows[1].id && setRows[1].seq === setRows[0].seq + 1 && another.body.set.seq !== set.set.seq, JSON.stringify([another.status, another.body.error, setRows]));
  check('two: the second set built the same day keeps for_day\'s rule: the day with "#2" after it',
    setRows[0].for_day === tokyo() && setRows[1].for_day === `${tokyo()}#2`, JSON.stringify(setRows));
  check('two: its passages are fresh: the new set asked the model for two more', (await orCalls()).passage_calls === pcA + 2);
  const served2 = (await api('GET', '/today/set')).body;
  check('two, verify 1: GET /today/set now returns the new set (the newest unfinished), at item 1', served2.set.id === another.body.set.id && served2.position === 0, JSON.stringify(served2.set));
  const firstWords = new Set(set.items.filter((it) => it.spot_id).map((it) => it.spot_id));
  const fresh2 = another.body.items.filter((it) => it.spot_id);
  check('two: the first set is finished, so its words may come again: the new set holds the words now due and then words not yet due, with the note saying so',
    fresh2.length === 8 && another.body.set.note && another.body.set.note.startsWith('Nothing more is due; this set draws on words not yet due.'), JSON.stringify([fresh2.length, another.body.set.note]));
  check('two: …the words not yet due in it are ones the first set drilled', fresh2.filter((it) => firstWords.has(it.spot_id)).length > 0);
  const oldUndo = await api('POST', '/today/undo', { set_id: set.set.id });
  check('two: Undo in the first set once another is made: refused (409), naming the newer set by its number', oldUndo.status === 409 && /a newer set \(number 2\)/.test(oldUndo.body.error), JSON.stringify(oldUndo.body));
  // two taps at once make one set
  for (const it of served2.items) await api('POST', '/today/answer', { set_id: served2.set.id, item_index: it.index, ...(it.kind === 'passage' ? { answer: it.question.answer } : { result: 'wrong' }) });
  const nBefore = peek('SELECT COUNT(*) AS n FROM drill_sets')[0].n;
  const [x1, x2] = await Promise.all([api('POST', '/today/another'), api('POST', '/today/another')]);
  check('two, verify 3: two POST /today/another at once make one new drill_sets row, and both answer that set',
    peek('SELECT COUNT(*) AS n FROM drill_sets')[0].n === nBefore + 1 && x1.body.set && x2.body.set && x1.body.set.id === x2.body.set.id, JSON.stringify([nBefore, x1.body.set, x2.body.set]));
  check('two: the third set the same day: "#3"', x1.body.set.for_day === `${tokyo()}#3` && x1.body.set.seq === 3, x1.body.set.for_day);

  // ================= part two: lib/today.js in this process, with a seeded clock =================
  quiet();
  const today = require(join(root, 'lib', 'today.js'));
  const t = today;
  const D = '2026-10-20';
  const fresh = (name, opts) => { const dir = newDir(name); const s = opts === null ? { raw: db.open(dir), spots: {} } : seed(db, dir, opts); return s; };
  const answerAt = (day, setId, index, body) => t.answer({ set_id: setId, item_index: index, ...body }, { now: noon(day) });

  // the scheduler: compute only, no real wait
  check('verify 6: at 23:30 Tokyo the next build is 05:00 the next day Tokyo, 20:00 UTC',
    t.nextBuildAt(new Date('2026-10-16T14:30:00Z')).toISOString() === '2026-10-16T20:00:00.000Z', t.nextBuildAt(new Date('2026-10-16T14:30:00Z')).toISOString());
  check('verify 6: at 04:59 Tokyo it is one minute away', t.nextBuildAt(new Date('2026-10-16T19:59:00Z')).getTime() - Date.parse('2026-10-16T19:59:00Z') === 60000);
  check('the scheduler at 05:00 Tokyo exactly arms for the next day; the day is Tokyo\'s', t.nextBuildAt(new Date('2026-10-16T20:00:00Z')).toISOString() === '2026-10-17T20:00:00.000Z'
    && t.dayOf(new Date('2026-10-16T15:00:00Z')) === '2026-10-17' && t.dayOf(new Date('2026-10-16T14:59:00Z')) === '2026-10-16');

  // no data
  const none = fresh('none', null);
  const pc0 = (await orCalls()).passage_calls;
  const nd = await t.current({ now: noon(D) });
  check('no data: nothing due and no passage possible -> { state: "no data", reason }, no set stored, no model call',
    nd.state === 'no data' && typeof nd.reason === 'string' && !none.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n && (await orCalls()).passage_calls === pc0, JSON.stringify(nd));

  // never drilled before drilled; the solid word coming due; (b) five when (a) filled
  const S = fresh('order');
  S.raw.prepare("UPDATE spots SET due_on = '2026-10-18', interval_days = 3, right_run = 1 WHERE id = ?").run(S.spots['נאלצה']);
  S.raw.prepare("UPDATE spots SET status = 'solid', due_on = '2026-10-15', interval_days = 7 WHERE id = ?").run(S.spots['שביתה']);
  S.raw.prepare("UPDATE spots SET status = 'solid', due_on = '2026-10-12', interval_days = 7 WHERE id = ?").run(S.spots['שוטטות']);
  S.raw.prepare("UPDATE spots SET due_on = '2026-10-25' WHERE id = ?").run(S.spots['ייקבעו']);
  const built = await t.build(D);
  const words = built.items.filter((it) => it.spot_id);
  check('(a) one solid word coming due, the longest overdue first (שוטטות, due 12 Oct, before שביתה, 15 Oct), shown after the article words',
    built.items.map((it) => it.group).join() === 'lesson,lesson,lesson,lesson,lesson,article,article,solid,passage,passage' && built.items[7].spot_id === S.spots['שוטטות'], built.items.map((it) => `${it.group}:${it.word || ''}`).join());
  check('(b) five lesson words when (a) filled its slot; a word due later (ייקבעו, 25 Oct) is not chosen', words.filter((it) => it.group === 'lesson').length === 5 && !words.some((it) => it.spot_id === S.spots['ייקבעו']));
  const lessonIds = words.filter((it) => it.group === 'lesson').map((it) => it.spot_id);
  check('never drilled before drilled: נאלצה (drilled, due 18 Oct) comes after the never-drilled lesson words, though touched first',
    !lessonIds.slice(0, 4).includes(S.spots['נאלצה']) && lessonIds.indexOf(S.spots['להתמודד']) === 0, lessonIds.join(' '));

  // slots (c) leaves go back to (b)
  fresh('spill', { only: ['נאלצה', 'ייקבעו', 'להתמודד', 'להתבייש', 'רפורמה', 'הסלמה', 'נחתם', 'מקדם', 'הממסד'] });
  const spill = await t.build(D);
  check('(c) has one article word: its other slot goes back to (b): seven lesson words, one article word, two passages',
    spill.items.map((it) => it.group).join() === 'lesson,lesson,lesson,lesson,lesson,lesson,lesson,article,passage,passage', spill.items.map((it) => it.group).join());
  fresh('spill2', { only: ['נאלצה', 'ייקבעו', 'הממסד', 'אישרה', 'מגמה'] });
  const spill2 = await t.build(D);
  check('(b) has two lesson words: its slots go to (c): two lesson words, then all three article words',
    spill2.items.filter((it) => it.spot_id).map((it) => it.group).join() === 'lesson,lesson,article,article,article', spill2.items.map((it) => it.group).join());

  // passages: kept only with three of the words given; the model down
  fresh('passages');
  await orControl({ passage_use: 2 });
  const two = await t.build(D);
  await orControl({ passage_use: null, passage_fail: 'down' });
  const down = await t.build(D);
  await orControl({ passage_fail: null });
  check('a passage that uses only two of the words given is not kept; its slot goes to a word, and the set says why',
    !two.items.some((it) => it.kind === 'passage') && two.items.length === 10 && two.note === 'No fresh passages today; the passages written did not use your words.', JSON.stringify([two.items.length, two.note]));
  check('the model unreachable: no passages, the set says "No fresh passages today; the model did not answer.", and the two slots go to lesson words',
    down.note === 'No fresh passages today; the model did not answer.' && down.items.length === 10 && down.items.filter((it) => it.group === 'lesson').length === 8, JSON.stringify([down.items.length, down.note]));
  const kept = t.wordsFound('בדיון דובר על הנאלץ ועל נאלצה, ועל קידום.', [{ spot_id: 'a', lemma: 'נאלץ', forms: ['נאלץ', 'נאלצה'] }, { spot_id: 'b', lemma: 'קידם', forms: ['קידם', 'מקדם'] }]);
  check('the word count reads a form after a prefix (הנאלץ), and not a different word of the same root (קידום)', kept.map((k) => k.spot_id).join() === 'a');
  await orControl({ passage_long: true });
  const long = await t.build(D);
  await orControl({ passage_long: false });
  check('a passage of eight sentences (one per word) is not kept: no passages, the set says why, and the slots go to words',
    !long.items.some((it) => it.kind === 'passage') && long.items.length === 10 && long.note === 'No fresh passages today; the passages written were not three to five sentences.', JSON.stringify([long.items.length, long.note]));
  check('the sentence count: two sentences and six are out, three and five in (a line break ends one too)',
    t.sentenceCount('א ב. ג ד.') === 2 && t.sentenceCount('א. ב. ג. ד. ה. ו.') === 6 && t.sentenceCount('אחת. שתיים!\nשלוש') === 3 && t.sentenceCount('א. ב? ג. ד. ה.') === 5 && t.SENTENCES.min === 3 && t.SENTENCES.max === 5);

  // shaky words before new ones; new words judged once by the model, the easy ones not drilled
  const K = fresh('shaky-first', { only: ['נאלצה', 'ייקבעו', 'להתמודד', 'הממסד', 'מגמה'] });
  K.raw.prepare("UPDATE spots SET status = 'new' WHERE id IN (?, ?)").run(K.spots['נאלצה'], K.spots['הממסד']);
  const ks = (await t.build(D)).items.filter((it) => it.spot_id).map((it) => it.word);
  check('shaky words before new ones: נאלצה (new, touched first) after the shaky lesson words; the new article word הממסד after the shaky מגמה',
    ks.join() === 'ייקבעו,להתמודד,נאלצה,מגמה,הממסד', ks.join());
  const J = fresh('judged', { only: ['רפורמה', 'הסלמה', 'שוטטות', 'שביתה'], status: 'new' });
  J.raw.prepare("UPDATE spots SET status = 'shaky' WHERE id = ?").run(J.spots['שביתה']);
  await orControl({ easy_lemmas: ['רפורמה'] });
  const dc0 = (await orCalls()).difficulty_calls;
  const j1 = await t.build(D);
  const asked = (await orCalls()).last_difficulty_ask || '';
  const easyRows = Object.fromEntries(J.raw.prepare('SELECT lemma, easy FROM spots').all().map((r) => [r.lemma, r.easy]));
  check('new words are judged in one call, with each card\'s word, meaning and categories; a shaky word is not sent',
    (await orCalls()).difficulty_calls === dc0 + 1 && /"word":"רפורמה","meaning":"a reform","categories":\[\]/.test(asked) && /"categories":\["sound-pattern-deviation"\]/.test(asked) && !asked.includes('שביתה'), asked.slice(0, 300));
  check('the judgment is kept on the word (spots.easy: רפורמה 1, the other new words 0, the shaky word not judged)',
    easyRows['רפורמה'] === 1 && easyRows['הסלמה'] === 0 && easyRows['שוטטות'] === 0 && easyRows['שביתה'] === null, JSON.stringify(easyRows));
  check('a word judged easy is not drilled', !j1.items.some((it) => it.spot_id === J.spots['רפורמה']) && j1.items.some((it) => it.spot_id === J.spots['הסלמה']));
  await t.build(D);
  check('a word is judged only once: the next build asks the model nothing', (await orCalls()).difficulty_calls === dc0 + 1);
  await orControl({ easy_lemmas: [] });
  const J2 = fresh('judge-down', { only: ['רפורמה', 'הסלמה'], status: 'new' });
  await orControl({ difficulty_fail: true });
  const j2 = await t.build(D);
  await orControl({ difficulty_fail: false });
  check('the model not answering: the set is built as before (both new words drilled) and nothing is kept, to be judged next time',
    j2.items.filter((it) => it.spot_id).length === 2 && J2.raw.prepare('SELECT COUNT(*) AS n FROM spots WHERE easy IS NOT NULL').get().n === 0);

  // a word judged easy while new, then saved by Dan (shaky): drilled again, and not judged again
  const S2 = fresh('easy-then-saved', { only: ['רפורמה', 'הסלמה'], status: 'new' });
  db.setEasy(S2.spots['רפורמה'], true);
  db.setSpotStatus(S2.spots['רפורמה'], 'shaky');
  const dcS = (await orCalls()).difficulty_calls;
  const sv = await t.chooseWords('2026-10-20');
  const chosenS = [...sv.b, ...sv.c].map((it) => it.spot_id);
  check('a word judged easy while new and then saved (shaky) is drilled: Dan\'s save overrides the judgment', chosenS.includes(S2.spots['רפורמה']), JSON.stringify(chosenS));
  check('…and it is not sent to be judged again (only the other new word is)', !((await orCalls()).last_difficulty_ask || '').includes('רפורמה') && (await orCalls()).difficulty_calls === dcS + 1);

  // the verb blanked in a passage with none of Dan's verbs: the model's, never a basic one
  fresh('nouns', { only: ['רפורמה', 'הסלמה', 'שוטטות', 'שביתה', 'מגמה'] });
  const nv = (await t.build(D)).items.find((it) => it.kind === 'passage');
  check('a passage with none of Dan\'s verbs: the model\'s verb is blanked (החליטה, not a basic verb)', nv && nv.question.type === 'form' && nv.question.answer === 'החליטה', JSON.stringify(nv && nv.question));
  await orControl({ passage_basic: true });
  const bv = await t.build(D);
  await orControl({ passage_basic: false });
  check('…a passage whose verb to blank is a basic one (הייתה, of היה) is not kept, and the set says why',
    !bv.items.some((it) => it.kind === 'passage' && it.question.type === 'form') && /came without a usable question/.test(bv.note || ''), JSON.stringify([bv.note, bv.items.filter((it) => it.kind === 'passage').map((p) => p.question.type)]));

  // Which preposition with no read sentence: a made-up sentence; the plain fallback only when the model gives none
  const P = fresh('prep', { only: ['להמר'] });
  const madePrep = await t.itemFor(db.getSpot(P.spots['להמר']), 'lesson');
  check('Which preposition, no read sentence: the model writes one with the word and its preposition, blanked, marked a made-up sentence',
    madePrep.kind === 'preposition' && madePrep.made_up === true && madePrep.in_sentence === true && madePrep.sentence === 'בישיבה אתמול ביקשו להמר … התוכנית החדשה.' && madePrep.answer === 'על', JSON.stringify(madePrep));
  await orControl({ sentence_fail: true });
  const plainPrep = await t.itemFor(db.getSpot(P.spots['להמר']), 'lesson');
  const P2 = fresh('spell-down', { only: ['להתבייש'] });
  const spellDown = await t.itemFor(db.getSpot(P2.spots['להתבייש']), 'lesson');
  await orControl({ sentence_fail: false });
  check('…the model not answering: the plain fallback, the word and a blank, not marked made up',
    plainPrep.kind === 'preposition' && plainPrep.made_up === false && plainPrep.in_sentence === false && plainPrep.sentence === 'להמר …', JSON.stringify(plainPrep));
  check('Which spelling with no read sentence and the model not answering: no spelling item without a sentence; Do you know it instead', spellDown.kind === 'know', spellDown.kind);
  const prefixPrep = await (async () => { const Q = fresh('prep-prefix', { only: ['נאלצה'] }); Q.raw.prepare("UPDATE spots SET categories_json = '[\"preposition-government\"]' WHERE id = ?").run(Q.spots['נאלצה']); return t.itemFor(db.getSpot(Q.spots['נאלצה']), 'lesson'); })();
  check('a one-letter preposition in the lesson\'s own sentence: its letter blanked in the word after (…דחות)', prefixPrep.kind === 'preposition' && prefixPrep.sentence === 'הממשלה נאלצה …דחות את ההצבעה' && prefixPrep.made_up === false, JSON.stringify(prefixPrep.sentence));

  // ensureSet twice at once (verify 5)
  const E = fresh('ensure');
  const pcE = (await orCalls()).passage_calls;
  const [e1, e2] = await Promise.all([t.ensureSet(D), t.ensureSet(D)]);
  check('verify 5: two ensureSet calls for the same day at once make one drill_sets row (and one build: two passage calls)',
    E.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 1 && e1.set.id === e2.set.id && (await orCalls()).passage_calls === pcE + 2);

  // an unfinished set kept across a day boundary; a finished one replaced by the next day's, never earlier
  const U = fresh('days', { only: ['רפורמה', 'הסלמה'] });
  const u1 = (await t.ensureSet(D)).set;
  await answerAt(D, u1.id, 0, { result: 'right' });
  const u2 = await t.ensureSet(t.addDays(D, 1));
  check('an unfinished set is kept across a day boundary: the next day\'s call serves it, and makes no new set',
    u2.set.id === u1.id && u2.built === false && U.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 1);
  const cur = await t.current({ now: noon(t.addDays(D, 1)) });
  check('…GET /today/set serves it, from where it stopped', cur.set.id === u1.id && cur.position === 1);
  await answerAt(t.addDays(D, 1), u1.id, 1, { result: 'right' });
  const u3 = await t.ensureSet(t.addDays(D, 1));
  check('once finished, the next call that day makes the day\'s own set: רפורמה (right the day before) is due again and comes first; הסלמה (answered today, not due) follows, and the note says so',
    u3.built === true && u3.set.for_day === t.addDays(D, 1) && u3.set.items.length === 2 && u3.set.items[0].spot_id === U.spots['רפורמה'] && u3.set.items[1].spot_id === U.spots['הסלמה']
    && u3.set.note.startsWith('Nothing more is due; this set draws on words not yet due.'), JSON.stringify(u3.set && [u3.set.items.map((x) => x.word), u3.set.note]));
  await answerAt(t.addDays(D, 1), u3.set.id, 0, { result: 'right' });
  await answerAt(t.addDays(D, 1), u3.set.id, 1, { result: 'right' });
  const u4 = await t.ensureSet(t.addDays(D, 1));
  check('a finished set is not replaced the same day', u4.set.id === u3.set.id && u4.built === false && U.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 2);
  const u5 = await t.ensureSet(t.addDays(D, 2));
  check('…and is replaced by the next day\'s build', u5.built === true && u5.set.for_day === t.addDays(D, 2));

  // the ladder and the three-days rule (verify 3)
  const L = fresh('ladder', { only: ['רפורמה'] });
  const W = L.spots['רפורמה'];
  const row = () => L.raw.prepare('SELECT status, due_on, interval_days, right_run FROM spots WHERE id = ?').get(W);
  const day1 = D, day2 = t.addDays(D, 1);
  let s1 = (await t.ensureSet(day1)).set;
  await answerAt(day1, s1.id, 0, { result: 'wrong' });
  check('a wrong answer: run 0, interval 1, due the next day', JSON.stringify(row()) === JSON.stringify({ status: 'shaky', due_on: day2, interval_days: 1, right_run: 0 }), JSON.stringify(row()));
  const intervals = [];
  let day = day2;
  for (let i = 0; i < 3; i++) {
    const s = (await t.ensureSet(day)).set;
    await answerAt(day, s.id, 0, { result: 'right' });
    const r = row();
    intervals.push(r.interval_days);
    if (i < 2) check(`right on ${day}: still shaky after ${i + 1} right`, r.status === 'shaky');
    day = r.due_on;
  }
  const end = row();
  check('verify 3: three rights on three different days: intervals 1, 3, 7 (the first right after a wrong keeps 1)', intervals.join() === '1,3,7', intervals.join());
  check('verify 3: after the third, status solid and interval 7', end.status === 'solid' && end.interval_days === 7 && end.right_run === 3, JSON.stringify(end));
  const lb = (await spineBodies(W)).at(-1) || {};
  check('verify 3: the spine received solid, with due_on and interval_days 7', lb.status === 'solid' && lb.interval_days === 7 && lb.due_on === end.due_on, JSON.stringify(lb));
  // a solid word coming due, answered right, climbs to 14 and stays solid; Undo of that keeps it as it was
  const s4 = (await t.ensureSet(end.due_on)).set;
  check('the solid word comes back when due, in the solid slot', s4.items[0].group === 'solid');
  await answerAt(end.due_on, s4.id, 0, { result: 'right' });
  check('a solid word answered right: interval 14, still solid', row().interval_days === 14 && row().status === 'solid');
  await t.undo({ set_id: s4.id });
  check('Undo puts it back to interval 7, due as before, solid', JSON.stringify(row()) === JSON.stringify(end), JSON.stringify(row()));
  await answerAt(end.due_on, s4.id, 0, { result: 'wrong' });
  check('a solid word answered wrong becomes shaky (through the save: the spine has it)', row().status === 'shaky' && (await spineBodies(W)).at(-1).status === 'shaky');
  await t.undo({ set_id: s4.id });
  check('Undo of that puts back solid and the spine is told solid again', row().status === 'solid' && (await spineBodies(W)).at(-1).status === 'solid');

  // an older page's Undo after later answers is refused, and changes nothing
  const G = fresh('stale', { only: ['רפורמה'] });
  const GW = G.spots['רפורמה'];
  const gRow = () => JSON.stringify(G.raw.prepare('SELECT status, due_on, interval_days, right_run FROM spots WHERE id = ?').get(GW));
  const gCount = () => G.raw.prepare('SELECT COUNT(*) AS n FROM drill_answers').get().n;
  const g1 = (await t.ensureSet(D)).set;
  const a1 = await answerAt(D, g1.id, 0, { result: 'right' });
  const g2 = (await t.ensureSet(t.addDays(D, 1))).set;
  const newerSetBefore = [gRow(), gCount()];
  let refusedNewerSet = null;
  try { await t.undo({ set_id: g1.id, answer_id: a1.answer_id }); } catch (e) { refusedNewerSet = e; }
  check('Undo in a finished set once the next day\'s set is made: refused (409), nothing changed',
    refusedNewerSet && refusedNewerSet.status === 409 && JSON.stringify([gRow(), gCount()]) === JSON.stringify(newerSetBefore), refusedNewerSet ? refusedNewerSet.message : 'not refused');
  await answerAt(t.addDays(D, 1), g2.id, 0, { result: 'right' });
  const staleBefore = [gRow(), gCount()];
  let refusedStale = null;
  try { await t.undo({ set_id: g1.id, answer_id: a1.answer_id }); } catch (e) { refusedStale = e; }
  let refusedStale2 = null;
  try { await t.undo({ set_id: g1.id }); } catch (e) { refusedStale2 = e; }
  check('an older page\'s Undo after a later answer (another set): refused (409), the answers and the word\'s schedule as they were (interval 3, run 2)',
    refusedStale && refusedStale.status === 409 && refusedStale2 && refusedStale2.status === 409 && JSON.stringify([gRow(), gCount()]) === JSON.stringify(staleBefore) && JSON.parse(staleBefore[0]).interval_days === 3 && JSON.parse(staleBefore[0]).right_run === 2,
    `${refusedStale && refusedStale.message} ${staleBefore[0]}`);
  const served = await t.current({ now: noon(t.addDays(D, 1)) });
  check('…and no old set is opened again: today\'s set is served, done', served.set.id === g2.id && served.done === true, JSON.stringify(served.set));
  const ok = await t.undo({ set_id: g2.id });
  check('…while the newest answer itself can still be undone', ok.undone.answer_id > a1.answer_id && JSON.parse(gRow()).interval_days === 1);

  // the line under an item names where its sentence is
  const R = fresh('source', { only: ['נאלצה', 'אישרה'] });
  const later = db.addLesson({ title: 'שיעור מאוחר יותר', lesson_date: '2026-10-01', source_name: 'later.pdf', text: 'נאלצה', items: ['נאלצה'] });
  db.addTouch({ spotId: R.spots['נאלצה'], lessonId: later.id, surface: 'נאלצה' });
  const repeat = await t.itemFor(db.getSpot(R.spots['נאלצה']), 'lesson');
  check('a word met again in a newer lesson that holds it alone: the sentence is the older lesson\'s, and the line names that lesson',
    repeat.sentence === 'הממשלה … לדחות את ההצבעה' && repeat.source === "From Guy's lesson שיעור עם גיא — 1 בספטמבר" && repeat.lesson_id !== later.id, JSON.stringify({ source: repeat.source, lesson_id: repeat.lesson_id }));
  const solo = db.addLesson({ title: 'שיעור עם המילה לבדה', lesson_date: '2026-10-02', source_name: 'solo.pdf', text: 'אישרה', items: ['אישרה'] });
  db.addTouch({ spotId: R.spots['אישרה'], lessonId: solo.id, surface: 'אישרה' });
  const fromArticle = await t.itemFor(db.getSpot(R.spots['אישרה']), 'lesson');
  check('a lesson word whose only sentence is in an article: the article\'s sentence, and the line names the article',
    fromArticle.group === 'lesson' && fromArticle.sentence === 'בסוף השבוע הוועדה … את התוכנית.' && fromArticle.source === 'From רפורמה במשק החשמל' && fromArticle.lesson_id === null, JSON.stringify({ source: fromArticle.source, sentence: fromArticle.sentence }));

  // three rights on one day do not make a word solid
  const O = fresh('oneday', { only: ['הסלמה'] });
  // two rights earlier the same day, recorded in a set of their own (finished: it holds no item)
  const earlier = O.raw.prepare("INSERT INTO drill_sets (for_day, built_at, items_json) VALUES ('2026-10-01', ?, '[]')").run(noon(D).toISOString()).lastInsertRowid;
  for (let i = 0; i < 2; i++) O.raw.prepare("INSERT INTO drill_answers (set_id, item_index, spot_id, kind, result, at) VALUES (?, ?, ?, 'know', 'right', ?)").run(earlier, i, O.spots['הסלמה'], noon(D).toISOString());
  O.raw.prepare('UPDATE spots SET right_run = 2, interval_days = 3, due_on = ? WHERE id = ?').run(D, O.spots['הסלמה']);
  const so = (await t.ensureSet(D)).set;
  await answerAt(D, so.id, 0, { result: 'right' });
  const od = O.raw.prepare('SELECT status, right_run FROM spots WHERE id = ?').get(O.spots['הסלמה']);
  check('three rights in a row all on one day: run 3, but the word stays shaky', od.right_run === 3 && od.status === 'shaky', JSON.stringify(od));

  // a new word answered wrong becomes shaky
  const N = fresh('new', { only: ['רפורמה', 'הסלמה'], status: 'new' });
  const sn = (await t.ensureSet(D)).set;
  await answerAt(D, sn.id, 0, { result: 'wrong' });
  await answerAt(D, sn.id, 1, { result: 'right' });
  const ns = N.raw.prepare('SELECT id, status FROM spots ORDER BY id').all();
  check('a new word answered wrong becomes shaky; a new word answered right stays new', ns.find((r) => r.id === sn.items[0].spot_id).status === 'shaky' && ns.find((r) => r.id === sn.items[1].spot_id).status === 'new');

  // judging and the small rules
  check('a typed form with a proclitic left off is right (שנאלצה typed as נאלצה); nikud is ignored',
    t.judge({ kind: 'form', answer: 'שנאלצה' }, 'נאלצה') === 'right' && t.judge({ kind: 'form', answer: 'נאלצה' }, 'נֶאֶלְצָה') === 'right' && t.judge({ kind: 'form', answer: 'נאלצה' }, 'נאלץ') === 'wrong');
  check('a one-letter preposition is blanked in the word after (לדחות -> …דחות); a sentence without it gives none',
    t.gapPreposition('היא נאלצה לדחות את זה', 'נאלצה', 'ל-') === 'היא נאלצה …דחות את זה' && t.gapPreposition('היא נאלצה מאוד', 'נאלצה', 'ל-') === null);
  check('the ladder is 1, 3, 7, 14, 30', t.LADDER.join() === '1,3,7,14,30');
  check('a misspelling made here when the model\'s is not usable: same length, not the word', t.madeMisspellings('אמינות', 'homophonous-spelling')[0] === 'עמינות' && t.madeMisspellings('אמינות', 'letter-order')[0] === 'אימנות');
  await orControl({ misspellings: { 'אמינות': 'אמינות' } });
  const ms = await t.misspelling('אמינות', 'homophonous-spelling');
  await orControl({ misspellings: {} });
  check('the model answering the word itself as its misspelling: refused, one made here instead', ms.by === 'rule' && ms.misspelling !== 'אמינות');

  // ================= hebrew-today-two: numbered sets, pools, another set =================
  const NOTE_LATER = 'Nothing more is due; this set draws on words not yet due.';
  const wordsOf = (s) => s.items.filter((it) => it.spot_id).map((it) => it.word);

  // verify 2: every word already drilled and not due: shaky not due first, then solid not due
  const V = fresh('later', { only: ['רפורמה', 'הסלמה', 'שוטטות', 'שביתה'] });
  const due = (w, status, on, iv = 3) => V.raw.prepare('UPDATE spots SET status = ?, due_on = ?, interval_days = ?, right_run = 1 WHERE id = ?').run(status, on, iv, V.spots[w]);
  due('רפורמה', 'shaky', t.addDays(D, 2)); due('הסלמה', 'shaky', t.addDays(D, 2));
  due('שוטטות', 'solid', t.addDays(D, 4), 7); due('שביתה', 'solid', t.addDays(D, 3), 7);
  const vb = await t.build(D);
  check('two, verify 2: nothing due: the set draws on shaky words not yet due first, then solid ones, each earliest due first, the least recently touched first on the same day (רפורמה before הסלמה, both due in two days; שביתה, due sooner, before שוטטות)',
    wordsOf(vb).join() === 'רפורמה,הסלמה,שביתה,שוטטות', wordsOf(vb).join());
  check(`two, verify 2: …and the set's note says "${NOTE_LATER}"`, vb.note === `${NOTE_LATER} No fresh passages today; they need at least 3 of your shaky words.`, vb.note);
  check('two: the words not yet due carry their group: a lesson word "From Guy\'s lesson …", a solid word in the solid group', vb.items[0].group === 'lesson' && vb.items[0].source.startsWith("From Guy's lesson") && vb.items[2].group === 'solid');
  // a word due comes before any word not yet due, never-drilled ones included
  const V2 = fresh('later-due', { only: ['רפורמה', 'הסלמה', 'שביתה', 'מגמה'] });
  V2.raw.prepare("UPDATE spots SET due_on = ?, interval_days = 3, right_run = 1 WHERE id IN (?, ?)").run(t.addDays(D, 1), V2.spots['רפורמה'], V2.spots['הסלמה']);
  V2.raw.prepare("UPDATE spots SET status = 'solid', due_on = ?, interval_days = 7, right_run = 3 WHERE id = ?").run(t.addDays(D, 1), V2.spots['שביתה']);
  V2.raw.prepare('UPDATE spots SET due_on = ?, interval_days = 1, right_run = 1 WHERE id = ?').run(D, V2.spots['מגמה']);
  const v2 = await t.build(D);
  check('two: a word due today (מגמה) comes first, then the shaky ones not yet due, then the solid one', wordsOf(v2).join() === 'מגמה,רפורמה,הסלמה,שביתה', wordsOf(v2).join());
  // a set the words due fill needs no note
  fresh('no-note');
  const full = await t.build(D);
  check('two: a set the words due fill draws on nothing not yet due, and its note says nothing of it', full.items.filter((it) => it.spot_id).length === 8 && !full.note, String(full.note));
  // a new word still being learnt (answered right, so new with a due day) is drawn on with the shaky ones; one judged easy is not
  const NW = fresh('later-new', { only: ['רפורמה', 'הסלמה'], status: 'new' });
  NW.raw.prepare('UPDATE spots SET easy = 0, due_on = ?, interval_days = 1, right_run = 1 WHERE id = ?').run(t.addDays(D, 1), NW.spots['רפורמה']);
  NW.raw.prepare('UPDATE spots SET easy = 1, due_on = ?, interval_days = 1, right_run = 1 WHERE id = ?').run(t.addDays(D, 1), NW.spots['הסלמה']);
  check('two: a new word answered right before (new, with a due day) is drawn on with the shaky words; a new word judged easy is not', wordsOf(await t.build(D)).join() === 'רפורמה');
  // no data only with no words at all
  fresh('no-words', null);
  const nw = await t.build(D);
  check('two, verify 2: no words at all: { state: "no data" }, saying so plainly', nw.state === 'no data' && nw.reason === 'You have no words yet; save words as you read, or bring in a lesson from Guy.', JSON.stringify(nw));
  check('two: …while a map whose every word is drilled and not due still gets a set (above), never "no data"', vb.items.length === 4 && !vb.state);
  // a solid word never drilled is one Dan marked solid himself (Mark solid, or Too easy): not drilled until it has a due day
  const SN = fresh('solid-never', { only: ['רפורמה', 'הסלמה'] });
  SN.raw.prepare("UPDATE spots SET status = 'solid' WHERE id = ?").run(SN.spots['רפורמה']);
  check('two: a word marked solid before it was ever drilled (no due day) is not drilled; the other word is', wordsOf(await t.build(D)).join() === 'הסלמה', wordsOf(await t.build(D)).join());
  const SO = fresh('solid-only', { only: ['רפורמה'], status: 'solid' });
  const so1 = await t.build(D);
  check('two: words that are all marked solid and never drilled: "no data", and the reason says why truly (not "in an unfinished set" alone)',
    so1.state === 'no data' && so1.reason === 'None of your words can be drilled just now: each is in a set not yet finished, is one you know (judged easy, or marked solid before it was ever drilled), or was never met in a lesson or an article.' && SO.raw.prepare('SELECT due_on FROM spots').get().due_on === null, JSON.stringify(so1));

  // answering a word not yet due moves it by the same rules
  const AN = fresh('answer-later', { only: ['רפורמה', 'הסלמה'] });
  AN.raw.prepare('UPDATE spots SET due_on = ?, interval_days = 3, right_run = 2 WHERE id IN (?, ?)').run(t.addDays(D, 2), AN.spots['רפורמה'], AN.spots['הסלמה']);
  const an = (await t.ensureSet(D)).set;
  await answerAt(D, an.id, 0, { result: 'right' });
  await answerAt(D, an.id, 1, { result: 'wrong' });
  const anRow = (w) => AN.raw.prepare('SELECT due_on, interval_days, right_run FROM spots WHERE id = ?').get(AN.spots[w]);
  check('two: a word not yet due answered right climbs from its interval (3 -> 7, due in 7 days); one answered wrong goes back to 1, due tomorrow',
    anRow('רפורמה').interval_days === 7 && anRow('רפורמה').due_on === t.addDays(D, 7) && anRow('רפורמה').right_run === 3
    && anRow('הסלמה').interval_days === 1 && anRow('הסלמה').due_on === t.addDays(D, 1) && anRow('הסלמה').right_run === 0, JSON.stringify([anRow('רפורמה'), anRow('הסלמה')]));

  // a word in an unfinished set is skipped by the next set; the newest unfinished set is current
  const B = fresh('busy');
  const b1 = (await t.ensureSet(D)).set;
  const b2 = (await t.newSet(D)).set;
  const ids1 = new Set(b1.items.filter((it) => it.spot_id).map((it) => it.spot_id));
  const ids2 = b2.items.filter((it) => it.spot_id).map((it) => it.spot_id);
  check('two, verify 1: another set while one is unfinished: none of its words is in the unfinished set', ids2.length > 0 && !ids2.some((id) => ids1.has(id)), JSON.stringify([[...ids1], ids2]));
  check('two: …two rows, numbered 1 and 2, for_day the day and the day "#2"', b1.seq === 1 && b2.seq === 2 && b1.for_day === D && b2.for_day === `${D}#2`, JSON.stringify([b1.seq, b1.for_day, b2.seq, b2.for_day]));
  const curB = await t.current({ now: noon(D) });
  check('two: the current set is the newest unfinished one (the second)', curB.set.id === b2.id && curB.set.seq === 2);
  const b3 = (await t.newSet(D)).set;
  const ids3 = b3.items.filter((it) => it.spot_id).map((it) => it.spot_id);
  check('two: a third set skips the words of both unfinished sets', !ids3.some((id) => ids1.has(id) || ids2.includes(id)) && b3.for_day === `${D}#3`, JSON.stringify(ids3));

  // two newSet calls at once share one build
  const C2 = fresh('another-twice');
  await t.ensureSet(D);
  const [n1, n2] = await Promise.all([t.newSet(D), t.newSet(D)]);
  check('two, verify 3: two newSet calls at once make one drill_sets row', C2.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 2 && n1.set.id === n2.set.id);

  // the 05:00 build makes a set only when none is unfinished
  const F = fresh('scheduler-open', { only: ['רפורמה', 'הסלמה'] });
  const f1 = (await t.ensureSet(D)).set;
  const f2 = await t.ensureSet(t.addDays(D, 1));
  check('two, verify 4: the 05:00 build (ensureSet for the new day) with an unfinished set present: no new row, the unfinished set kept',
    F.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 1 && f2.built === false && f2.set.id === f1.id);
  // a day whose second set is finished: the page's open and the 05:00 build read the day through its "#2"
  for (const it of f1.items) await answerAt(D, f1.id, it.index, { result: 'right' });
  const f3 = (await t.newSet(D)).set;
  for (const it of f3.items) await answerAt(D, f3.id, it.index, { result: 'right' });
  const f4 = await t.ensureSet(D);
  check('two: both sets of the day finished: opening the page the same day makes no third set; it serves the "#2" set, done',
    f4.built === false && f4.set.id === f3.id && f3.for_day === `${D}#2` && F.raw.prepare('SELECT COUNT(*) AS n FROM drill_sets').get().n === 2 && (await t.current({ now: noon(D) })).done === true);
  const f5 = await t.ensureSet(t.addDays(D, 1));
  check('two: …and the next day\'s 05:00 build makes the day\'s set, for_day the plain day', f5.built === true && f5.set.for_day === t.addDays(D, 1) && f5.set.seq === 3);

  // the migration: an existing drill_sets without seq gets it, back-filled from id
  const M = newDir('migrate');
  const old = new Database(join(M, 'reader.db'));
  old.exec(`CREATE TABLE drill_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, for_day TEXT NOT NULL UNIQUE, built_at TEXT NOT NULL, items_json TEXT NOT NULL, note TEXT);
            INSERT INTO drill_sets (for_day, built_at, items_json) VALUES ('2026-10-15', 'x', '[]'), ('2026-10-16', 'x', '[]');`);
  old.close();
  const mraw = db.open(M);
  const mrows = mraw.prepare('SELECT id, seq, for_day FROM drill_sets ORDER BY id').all();
  const madded = db.addDrillSet({ day: '2026-10-16', items: [], note: null });
  check('two: the migration adds drill_sets.seq to an existing table, back-filled from id; the rows stay; the next set is numbered after them',
    JSON.stringify(mrows) === JSON.stringify([{ id: 1, seq: 1, for_day: '2026-10-15' }, { id: 2, seq: 2, for_day: '2026-10-16' }]) && madded.seq === 3 && madded.for_day === '2026-10-16#2', JSON.stringify([mrows, madded]));
  let dup = null;
  try { mraw.prepare("INSERT INTO drill_sets (seq, for_day, built_at, items_json) VALUES (9, '2026-10-16', 'x', '[]')").run(); } catch (e) { dup = e; }
  check('two: for_day keeps its UNIQUE constraint (a plain insert of a taken day fails), and addDrillSet no longer ignores a failed insert', dup && /UNIQUE/.test(dup.message) && !/OR IGNORE/.test(String(db.addDrillSet)));
} catch (e) {
  say(String(e && e.stack || e));
  failed++;
} finally {
  for (const k of kids) k.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
if (failed) { say(server.log.split('\n').slice(-30).join('\n')); say(appLog.split('\n').slice(-30).join('\n')); say(`\n${failed} today check(s) failed, ${passed} passed`); process.exit(1); }
say(`\nall ${passed} today checks passed`);
