// Server checks for hebrew-save-one: a forgiving card and "Save it" on the
// Look up page — every case of scripts/tricky-lookups.json answering as it
// says, a Hebrew phrase's meaning and words (kept, so asked once), a refused
// meaning and a refused word still keepable, "Save it" making one note card
// on the desk worked on last (once a day per text), its limits, nothing saved
// before it, and an English phrase of four to six words — against local
// stand-ins for OpenRouter, the spine and the reference sites.
//   node scripts/save-smoke.mjs   (npm test runs it; about 3 s)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8874, OR_PORT = 8875, SPINE_PORT = 8876, REF_PORT = 8877;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-save-'));
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
start('node', ['scripts/mock-spine.mjs', String(SPINE_PORT), 'test-spine-token']);
start('node', ['scripts/mock-references.mjs', String(REF_PORT)]);
const standin = `http://127.0.0.1:${REF_PORT}`;
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'v'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `http://127.0.0.1:${OR_PORT}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: `http://127.0.0.1:${SPINE_PORT}`, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;

try {
  await up(`${base}/health`); await up(`http://127.0.0.1:${OR_PORT}/calls`); await up(`http://127.0.0.1:${SPINE_PORT}/api/health`); await up(`${standin}/calls`);
  const signedOut = await fetch(`${base}/lookup/keep`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ text: 'דו או פרד' }) });
  check('"Save it" (POST /lookup/keep) is behind the passphrase (401 signed out)', signedOut.status === 401);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const look = (surface) => api('POST', '/lookup', { surface, origin: 'lookup' });
  const orCalls = async () => (await fetch(`http://127.0.0.1:${OR_PORT}/calls`)).json();
  const spinePuts = async () => Object.values((await (await fetch(`http://127.0.0.1:${SPINE_PORT}/puts`)).json()).puts).reduce((n, v) => n + v, 0);
  const Database = require(join(root, 'node_modules', 'better-sqlite3'));
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const count = (table, where = '1=1', ...a) => peek(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a)[0].n;

  // --- the prompts (step 0) -------------------------------------------------------------------
  const { CARD_SYSTEM } = require(join(root, 'lib', 'lookup.js'));
  check('the card prompt answers the likeliest reading with confidence, other readings, register and corrected_from, refuses only text it cannot connect to anything (with did_you_mean), and no longer says "Never guess"',
    ['"confidence"', '"other_readings"', '"register"', '"corrected_from"', '"did_you_mean"', '(none given)', 'ביטחון, מדינה and שמיים', 'proper-noun', 'מ/ם, נ/ן, צ/ץ, פ/ף, כ/ך', 'צה"ל, ח"כ, ע"י'].every((s) => CARD_SYSTEM.includes(s))
    && !/Never guess/.test(CARD_SYSTEM) && !/If you cannot identify the word with confidence/.test(CARD_SYSTEM));

  // --- the tricky set (step 0, verify 0) -------------------------------------------------------
  const cases = JSON.parse(readFileSync(join(here, 'tricky-lookups.json'), 'utf8')).cases;
  const spots0 = count('spots'), notes0 = count('notes'), puts0 = await spinePuts();
  const answers = {};
  for (const c of cases) {
    const r = await look(c.text);
    answers[c.text] = r;
    const e = c.expect, k = r.body.card || {};
    let ok;
    if (c.way === 'word') {
      ok = r.status === e.status && !r.body.mode
        && (!e.lemma || k.lemma === e.lemma) && (!e.surface || k.surface === e.surface) && (!e.pos || k.pos === e.pos) && (!e.root || k.root === e.root) && (!e.binyan || k.binyan === e.binyan)
        && (!e.confidence || k.confidence === e.confidence) && (!e.register || k.register === e.register) && (e.corrected_from ? k.corrected_from === e.corrected_from : k.corrected_from === null)
        && (e.other_readings === undefined || k.other_readings.length === e.other_readings) && (!e.meaning_has || k.meaning_en.includes(e.meaning_has));
    } else if (c.way === 'refused') {
      ok = r.status === 422 && r.body.keepable === e.keepable && r.body.text === c.text && r.body.did_you_mean.length === e.did_you_mean;
    } else if (c.way === 'phrase') {
      ok = r.status === 200 && r.body.mode === 'phrase' && r.body.words.map((w) => w.word).join() === e.words.join() && r.body.words.map((w) => w.latin).join() === e.latin.join()
        && r.body.meaning && r.body.meaning.meaning_en === e.meaning_en && r.body.keepable === true;
    } else {
      const first = r.body.groups && r.body.groups.find((g) => g.rows.length);
      ok = r.status === 200 && r.body.mode === 'english' && first && first.rows[0].he === e.first;
    }
    check(`tricky: ${c.text} (${c.why}) answers as tricky-lookups.json says`, ok, JSON.stringify(r.body).slice(0, 300));
  }
  const alef = answers['אלפית'].body.card, tir = answers['תירלול'].body;
  check('…אלפית\'s third other reading, not Hebrew letters, is dropped; each kept one has its word, part of speech and meaning',
    alef.other_readings.map((o) => o.lemma_pointed).join() === 'אֲלוּפִית,אַלְפִית' && alef.other_readings.every((o) => o.pos && o.meaning_en));
  check('…תירלול\'s fourth suggestion, not Hebrew letters, is dropped; each kept one has its word, meaning and why',
    tir.did_you_mean.map((s) => s.word_pointed).join() === 'תִּרְגּוּל,תִּלְתּוּל,טִרְלוּל' && tir.did_you_mean.every((s) => s.meaning_en && s.why));
  check('…a refused word keeps the refusal\'s wording for every other caller ("Card could not be built: …")', /^Card could not be built: /.test(tir.error));
  check('…the misspelling טלפום is cached under what was typed and saved as טלפון\'s word',
    peek('SELECT surface, spot_id FROM cards WHERE surface = ?', 'טלפום').map((r) => r.spot_id).join() === 'w:טלפון');
  check('…the transliterated English ("sababa") asked the model with the prompt that says Hebrew typed in Latin letters comes first',
    /typed in Latin letters \("sababa", "davka", "beseder"\): then give that Hebrew word first/.test((await orCalls()).last_english_ask.system) && /misspelled \("recieve"\)/.test((await orCalls()).last_english_ask.system));
  for (const s of tir.did_you_mean) {
    const w = s.word_pointed.replace(/[֑-ׇ]/g, '');
    const r = await look(w);
    check(`…the suggestion ${w} runs the ordinary look-up of that word (a card, or the refusal with keepable)`, (r.status === 200 && r.body.card) || (r.status === 422 && r.body.keepable === true && r.body.text === w), JSON.stringify(r.body).slice(0, 200));
  }

  // a card cached before this change: sure, no readings; nothing rebuilt
  {
    const Dw = new Database(join(dataDir, 'reader.db'));
    const { contextHash } = require(join(root, 'lib', 'lookup.js'));
    Dw.prepare("INSERT INTO cards (surface, context_hash, spot_id, json, built_at, sentence) VALUES (?, ?, NULL, ?, ?, '')")
      .run('ישן', contextHash('ישן', ''), JSON.stringify({ surface: 'ישן', lemma: 'ישן', pos: 'adjective', root: 'י.ש.נ', meaning_en: 'old', categories: [], pointed: { lemma: 'יָשָׁן', surface: 'יָשָׁן' } }), new Date().toISOString());
    Dw.close();
    const c0 = (await orCalls()).calls;
    const old = await look('ישן');
    check('a card cached before hebrew-save-one reads as confidence "sure", no other readings, no register, nothing corrected, and is not rebuilt (no model call)',
      old.status === 200 && old.body.card.confidence === 'sure' && old.body.card.other_readings.length === 0 && old.body.card.register === null && old.body.card.corrected_from === null
      && (await orCalls()).calls === c0 && JSON.parse(peek('SELECT json FROM cards WHERE surface = ?', 'ישן')[0].json).confidence === undefined, JSON.stringify(old.body.card));
  }

  // --- a phrase (step 1, verify 1) ----------------------------------------------------------------
  const p0 = (await orCalls()).phrase_calls, all0 = (await orCalls()).calls;
  const du = await look('דו או פרד');
  check('"דו או פרד" answers mode phrase, its three words in order (none Latin), and the stand-in\'s meaning, word-for-word sense and note; keepable',
    du.status === 200 && du.body.mode === 'phrase' && du.body.text === 'דו או פרד' && du.body.words.map((w) => `${w.word}:${w.latin}`).join() === 'דו:false,או:false,פרד:false'
    && du.body.meaning.meaning_en === 'do or die; now or never' && /^"do or die"/.test(du.body.meaning.literal_en) && /^Slang/.test(du.body.meaning.note) && du.body.keepable === true && /^\d{4}-/.test(du.body.at), JSON.stringify(du.body));
  check('…one call to the model, the phrase\'s meaning only (no word card asked for the phrase or its words)', (await orCalls()).phrase_calls === p0 + 1 && (await orCalls()).calls === all0 + 1);
  check('…its meaning kept by the phrase\'s bare text', peek('SELECT text FROM phrase_meanings').map((r) => r.text).includes('דו או פרד'));
  const du2 = await look('דוֹ  או פרד');
  check('the same phrase a second time (pointed, two spaces) asks the model nothing and answers the same meaning', du2.body.mode === 'phrase' && du2.body.meaning.meaning_en === 'do or die; now or never' && (await orCalls()).calls === all0 + 1 && du2.body.cached === true);
  const mixed = await look('run רץ');
  check('Hebrew and Latin letters together (once a 400) go the phrase way: "run" shown as it is, רץ a word to look up', mixed.status === 200 && mixed.body.mode === 'phrase' && mixed.body.words.map((w) => `${w.word}:${w.latin}`).join() === 'run:true,רץ:false', JSON.stringify(mixed.body));
  const longP = await look('מילה '.repeat(12) + 'אחת');
  check('a phrase over 60 characters is refused, naming the limit', longP.status === 400 && longP.body.error === 'Look up a word or a phrase of at most 60 characters; this has 63.', JSON.stringify(longP.body));

  // --- a refused meaning, a refused word (verify 2, 3) ----------------------------------------------
  const nm = await look('קשקוש בלבוש');
  check('a phrase whose meaning the model refuses still answers its words and keepable, meaning null with a plain meaning_error (not the model\'s words)',
    nm.status === 200 && nm.body.mode === 'phrase' && nm.body.words.length === 2 && nm.body.meaning === null && nm.body.meaning_error === 'The model gave no meaning for this phrase.' && nm.body.keepable === true, JSON.stringify(nm.body));
  check('…and a refused meaning is not kept (the next look-up asks again)', !peek('SELECT text FROM phrase_meanings').some((r) => r.text === 'קשקוש בלבוש'));
  await fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify({ phrase_down: true }) });
  const down = await look('מה קורה');
  await fetch(`http://127.0.0.1:${OR_PORT}/control`, { method: 'POST', body: JSON.stringify({ phrase_down: false }) });
  check('a phrase while the model is down: its words and keepable, meaning null, "The model did not answer."', down.status === 200 && down.body.meaning === null && down.body.meaning_error === 'The model did not answer.' && down.body.words.length === 2 && down.body.keepable === true, JSON.stringify(down.body));
  const unknown = await look('מילהלאידועה');
  check('a refused single word answers 422 with keepable, the text, and did_you_mean (none from this refusal)', unknown.status === 422 && unknown.body.keepable === true && unknown.body.text === 'מילהלאידועה' && Array.isArray(unknown.body.did_you_mean) && unknown.body.did_you_mean.length === 0);

  // --- nothing saved before "Save it" (verify 5) ---------------------------------------------------
  // the tricky words were single words (saved at once, as before); the phrases and refusals save nothing
  const spotsAfterWords = count('spots'), putsAfterWords = await spinePuts();
  const n1 = count('notes'), l1 = count('lookups');
  await look('דו או פרד'); await look('קשקוש בלבוש'); await look('תירלול'); await look('לעשות check');
  check('before "Save it": phrases and refused words make no note, no spot, no lookup record and no mark to the spine stand-in',
    count('notes') === n1 && count('notes') === notes0 && count('spots') === spotsAfterWords && (await spinePuts()) === putsAfterWords && count('lookups') === l1);
  check('…while the single words of the set were saved at once, as before (one spot each with a dictionary form, a mark each)', spotsAfterWords > spots0 && putsAfterWords > puts0);

  // --- "Save it" (step 1, verify 4) ---------------------------------------------------------------
  const deskNow = (await api('GET', '/desks/current')).body.desk;
  const spotsK = count('spots'), putsK = await spinePuts();
  const k1 = await api('POST', '/lookup/keep', { text: 'דו או פרד', note: 'heard on the radio' });
  check('"Save it" on a phrase makes one note card: the text, the phrase\'s meaning on the second line, Dan\'s note on the third',
    k1.status === 201 && k1.body.already === false && /^note:\d+$/.test(k1.body.key) && k1.body.card.text === 'דו או פרד\ndo or die; now or never\nheard on the radio' && count('notes') === notes0 + 1, JSON.stringify(k1.body).slice(0, 300));
  const onDesk = (await api('GET', `/desks/${deskNow.id}`)).body.cards.find((c) => c.key === k1.body.key);
  check('…on the desk worked on last, not yet placed (as a line caught on the phone lands)', k1.body.desk.id === deskNow.id && onDesk && onDesk.place.x === null && onDesk.place.y === null);
  const rec = peek("SELECT l.reference, l.origin, l.term FROM lookups l JOIN card_links k ON k.child = 'lookup:' || l.id WHERE k.parent = ? AND k.kind = 'layer'", k1.body.key);
  check('…recorded as looked up on the Look up page: one lookup layer on the note, reference page, origin lookup', rec.length === 1 && rec[0].reference === 'page' && rec[0].origin === 'lookup', JSON.stringify(rec));
  check('…no spot made and no mark sent to the spine', count('spots') === spotsK && (await spinePuts()) === putsK);
  const list1 = (await api('GET', '/lookups')).body.items;
  check('…first in "Looked up" by its label: the phrase as its headword, the meaning and the note as its gloss, the day',
    list1[0].key === k1.body.key && list1[0].kind === 'note' && list1[0].headword === 'דו או פרד' && list1[0].surface === 'דו או פרד' && list1[0].gloss === 'do or die; now or never · heard on the radio' && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(list1[0].day), JSON.stringify(list1[0]));
  const k2 = await api('POST', '/lookup/keep', { text: 'דו או פרד' });
  check('the same text kept twice the same day keeps one card and answers it again (already: true, 200)', k2.status === 200 && k2.body.already === true && k2.body.key === k1.body.key && count('notes') === notes0 + 1 && (await api('GET', '/lookups')).body.items.filter((i) => i.surface === 'דו או פרד').length === 1);
  const k3 = await api('POST', '/lookup/keep', { text: 'תירלול' });
  check('"Save it" on a refused word: one note holding the word alone (no meaning), listed first', k3.status === 201 && k3.body.card.text === 'תירלול' && (await api('GET', '/lookups')).body.items[0].key === k3.body.key);
  // yesterday's kept text is kept again today as a new card
  {
    const Dw = new Database(join(dataDir, 'reader.db'));
    const id = Number(k3.body.key.split(':')[1]);
    Dw.prepare("UPDATE lookups SET at = ? WHERE id IN (SELECT CAST(substr(child, 8) AS INTEGER) FROM card_links WHERE parent = ? AND kind = 'layer')").run(new Date(Date.now() - 30 * 3600 * 1000).toISOString(), `note:${id}`);
    Dw.close();
  }
  const k4 = await api('POST', '/lookup/keep', { text: 'תירלול' });
  check('false-rejection: a text kept on an earlier day is kept again as a new card today', k4.status === 201 && k4.body.already === false && k4.body.key !== k3.body.key);

  // the limits, by name
  const e0 = await api('POST', '/lookup/keep', { text: '  ' });
  const e1 = await api('POST', '/lookup/keep', { text: 'א'.repeat(61) });
  const e2 = await api('POST', '/lookup/keep', { text: 'דו או פרד', note: 'x'.repeat(4000) });
  check('the limits are refused by name: nothing to save; a text over 60 characters; a note past the 4000 a kept look-up holds',
    e0.status === 400 && e0.body.error === 'Nothing to save: look up a word or a phrase first.'
    && e1.status === 400 && e1.body.error === 'Save it keeps a word or a phrase of at most 60 characters; this has 61.'
    && e2.status === 400 && e2.body.error === 'A note is at most 3966 characters here (4000 with the text and its meaning); this one has 4000.', JSON.stringify([e0.body, e1.body, e2.body]));
  const ok4000 = await api('POST', '/lookup/keep', { text: 'מה קורה', note: 'y'.repeat(3992) });
  check('false-rejection: a note that just fits (the text, its line break and the note at 4000) is kept', ok4000.status === 201 && ok4000.body.card.text.length === 4000, JSON.stringify(ok4000.body).slice(0, 200));

  // --- "Put on a desk" with a kept phrase ticked (verify 6) ------------------------------------------
  const fresh = (await api('POST', '/desks')).body.desk;
  const put = await api('POST', `/desks/${fresh.id}/cards`, { card: k1.body.key, unplaced: true });
  check('a kept phrase ticked goes on a desk with "Put on a desk", not yet placed', put.status === 201 && put.body.already === false && put.body.placement.x === null && put.body.card.kind === 'note');

  // --- English phrases of four to six words (step 0, item 8) --------------------------------------------
  const en4 = await look('take it for granted'), en5 = await look('take it for granted again'), en6 = await look('take it for granted every single');
  check('an English phrase of four, five or six words answers (mode english); four words find the stand-in model\'s Hebrew',
    [en4, en5, en6].every((r) => r.status === 200 && r.body.mode === 'english') && en4.body.groups.find((g) => g.id === 'model').rows[0].he === 'לָקַחַת כְּמוֹבָן מֵאֵלָיו', JSON.stringify([en4.status, en5.status, en6.status]));

  // --- the new table, on a database made before it --------------------------------------------------
  {
    const oldDir = mkdtempSync(join(tmpdir(), 'hr-save-old-'));
    const Old = new Database(join(oldDir, 'reader.db'));
    Old.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, made_at TEXT NOT NULL, edited_at TEXT NOT NULL); INSERT INTO notes (text, made_at, edited_at) VALUES ('a note of Dan''s', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z');");
    Old.close();
    const mig = spawn('node', ['-e', `const db = require('./lib/db'); db.open(${JSON.stringify(oldDir)}); console.log(JSON.stringify(db.getNote(1)));`], { cwd: root });
    let outMig = ''; mig.stdout.on('data', (d) => outMig += d);
    await new Promise((r) => mig.on('close', r));
    const D2 = new Database(join(oldDir, 'reader.db'), { readonly: true });
    const has = D2.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phrase_meanings'").all().length === 1;
    D2.close();
    check('an existing database gains phrase_meanings by CREATE TABLE IF NOT EXISTS; its notes kept as they were', has && JSON.parse(outMig.trim().split('\n').pop()).text === "a note of Dan's", outMig);
    rmSync(oldDir, { recursive: true, force: true });
  }

  // --- audit item 10, watched: measured, not judged ------------------------------------------------
  {
    const c0 = (await orCalls()).calls;
    await look('ספר'); const afterBare = (await orCalls()).calls;
    await look('סֵפֶר'); const afterPointed = (await orCalls()).calls;
    await look('סֶפֶר'); const afterOther = (await orCalls()).calls;
    console.log(`measured: item 10, nikud: ספר asked the model ${afterBare - c0} time(s); then סֵפֶר ${afterPointed - afterBare}, סֶפֶר (other points) ${afterOther - afterPointed} (0: found by the bare form)`);
    // the other order: the tricky set's שָׁלום (pointed on one letter) was asked first
    const b0 = (await orCalls()).calls;
    const bare = await look('שלום'); const afterB = (await orCalls()).calls;
    const other = await look('שָלוֹם'); const afterO = (await orCalls()).calls;
    console.log(`measured: item 10, nikud the other way: after שָׁלום, שלום asked the model ${afterB - b0} time(s) (found by "${bare.body.found_by}"), שָלוֹם ${afterO - afterB} (found by "${other.body.found_by}")`);
    const s0 = (await orCalls()).calls;
    await api('POST', '/lookup', { surface: 'סבבה', sentence: 'היה סבבה לגמרי אתמול.' });
    const withSentence = (await orCalls()).calls - s0;
    const again = await look('סבבה');
    console.log(`measured: item 10, empty sentence: סבבה looked up with a sentence asked the model ${withSentence} time(s); the Look up page then answers the card first built from an empty sentence (found by "${again.body.found_by}")`);
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.log(server.log.split('\n').slice(-30).join('\n')); console.log(`\n${failed} save check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} save checks passed`);
