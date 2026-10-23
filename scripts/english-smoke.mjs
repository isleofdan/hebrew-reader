// Server checks for hebrew-english-one: English to Hebrew on the Look up page
// (lib/english.js, POST /lookup with English text) — Dan's own cards, Pealim's
// English search and English Wiktionary, merged; the model only when all
// three are empty; each site's answer kept 30 days; a site down; the
// refusals; nothing saved until a Hebrew word is tapped; the "Looked up"
// list — against the real server with the stand-ins for OpenRouter, the
// spine and the reference sites (scripts/mock-references.mjs serves the
// pages saved from Pealim and Wiktionary). What turns on the clock (the
// 30-day reuse, a site down past it) calls lib/english.js in this process
// with the clock set from here. About 3 s.
//   node scripts/english-smoke.mjs      (npm run smoke runs it)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8910, OR_PORT = 8911, SPINE_PORT = 8912, REF_PORT = 8913;
const PASS = 'open-sesame';
const dataDir = mkdtempSync(join(tmpdir(), 'hr-english-'));
const libDir = mkdtempSync(join(tmpdir(), 'hr-english-lib-'));
const require = createRequire(import.meta.url);
const Database = require(join(root, 'node_modules', 'better-sqlite3'));

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
const mock = `http://127.0.0.1:${OR_PORT}`;
const spineUrl = `http://127.0.0.1:${SPINE_PORT}`;
const server = start('node', ['server.js'], {
  PORT: String(PORT), DATA_DIR: dataDir, APP_PASSWORD: PASS, COOKIE_SECRET: 'e'.repeat(64), COOKIE_INSECURE: '1',
  OPENROUTER_API_KEY: 'test-key', OPENROUTER_URL: `${mock}/v1/chat/completions`,
  SPINE_TOKEN: 'test-spine-token', SPINE_URL: spineUrl, REFERENCE_STANDIN: standin,
});
const base = `http://127.0.0.1:${PORT}`;

try {
  await up(`${base}/health`); await up(`${mock}/calls`); await up(`${spineUrl}/api/health`); await up(`${standin}/calls`);
  const refCalls = async () => (await fetch(`${standin}/calls`)).json();
  const asked = async () => (await refCalls()).english_asked || [];
  const orCalls = async () => (await fetch(`${mock}/calls`)).json();
  const control = (c) => fetch(`${standin}/control`, { method: 'POST', body: JSON.stringify(c) });
  const orControl = (c) => fetch(`${mock}/control`, { method: 'POST', body: JSON.stringify(c) });
  const spinePuts = async () => Object.values((await (await fetch(`${spineUrl}/puts`)).json()).puts).reduce((n, v) => n + v, 0);
  const peek = (sql, ...a) => { const d = new Database(join(dataDir, 'reader.db'), { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
  const count = (table, where = '1=1', ...a) => peek(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...a)[0].n;

  const out = await fetch(`${base}/lookup`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ surface: 'run', origin: 'lookup' }) });
  check('signed out, an English look-up answers 401 and asks no site', out.status === 401 && (await asked()).length === 0);

  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ passphrase: PASS }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json', accept: 'application/json' };
  const api = async (method, path, body) => { const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  const look = (surface) => api('POST', '/lookup', { surface, origin: 'lookup' });
  const groupOf = (b, id) => (b.groups || []).find((g) => g.id === id);
  const words = (g) => (g ? g.rows.map((r) => r.he.normalize('NFC')) : []);

  check('the two new tables exist, empty: english_sites (site, text, answer_json, fetched_at) and english_lookups (id, text, at, answer_json)',
    peek('PRAGMA table_info(english_sites)').map((c) => c.name).join() === 'site,text,answer_json,fetched_at' && peek('PRAGMA table_info(english_lookups)').map((c) => c.name).join() === 'id,text,at,answer_json'
    && count('english_sites') === 0 && count('english_lookups') === 0);

  // Dan's own cards: two that mean "run" in a whole word, one that only has "running"
  await orControl({ extra_cards: {
    'מרוץ': { surface: 'מרוץ', lemma: 'מרוץ', lemma_pointed: 'מֵרוֹץ', surface_pointed: 'מֵרוֹץ', pos: 'noun', root: 'ר.ו.ץ', binyan: null, tense: null, person_gender_number: 'ms', meaning_en: 'a race, a run', governs: null, categories: [], note: null },
    'לברוח': { surface: 'לברוח', lemma: 'ברח', lemma_pointed: 'בָּרַח', surface_pointed: 'לִבְרוֹחַ', pos: 'verb', root: 'ב.ר.ח', binyan: 'paal', tense: 'infinitive', person_gender_number: null, meaning_en: 'to Run away, to escape', governs: 'מ-', categories: [], note: null },
    'בריחה': { surface: 'בריחה', lemma: 'בריחה', lemma_pointed: 'בְּרִיחָה', surface_pointed: 'בְּרִיחָה', pos: 'noun', root: 'ב.ר.ח', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'escape, running away', governs: null, categories: [], note: null },
    'ריצה': { surface: 'ריצה', lemma: 'ריצה', lemma_pointed: 'רִיצָה', surface_pointed: 'רִיצָה', pos: 'noun', root: 'ר.ו.ץ', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'running; a run', governs: null, categories: [], note: null },
    'לרוץ': { surface: 'לרוץ', lemma: 'רץ', lemma_pointed: 'רָץ', surface_pointed: 'לָרוּץ', pos: 'verb', root: 'ר.ו.ץ', binyan: 'paal', tense: 'infinitive', person_gender_number: null, meaning_en: 'to run', governs: null, categories: [], note: null },
  } });
  for (const w of ['מרוץ', 'בריחה']) await api('POST', '/lookup', { surface: w, sentence: '' });
  await api('POST', '/lookup', { surface: 'לברוח', sentence: '' });
  await api('POST', '/lookup', { surface: 'ריצה', sentence: '' });
  await api('POST', `/spots/${encodeURIComponent('w:מרוץ')}`, { status: 'shaky' });
  const nfc = (s) => String(s).normalize('NFC');

  // --- verify 1: "run" ------------------------------------------------------------------------
  const spots0 = count('spots'), shaky0 = count('spots', "status != 'new'"), puts0 = await spinePuts(), layers0 = count('lookups'), or0 = (await orCalls()).calls;
  const run = await look('run');
  const R = run.body;
  console.log(`     run: ${R.groups && R.groups.map((g) => `${g.id}(${g.state}): ${g.rows.map((r) => `${r.he}=${r.sources.map((s) => s.label).join('+')}`).join(', ')}`).join(' | ')}`);
  check('"run" answers { mode: english, text, groups, at }: Yours, From Pealim, From Wiktionary, in that order, no model group',
    run.status === 200 && R.mode === 'english' && R.text === 'run' && /^\d{4}-\d\d-\d\dT/.test(R.at) && R.groups.map((g) => g.id).join() === 'yours,pealim,wiktionary'
    && R.groups.map((g) => g.heading).join('|') === 'Yours|From Pealim|From Wiktionary', JSON.stringify(R).slice(0, 400));
  const yours = groupOf(R, 'yours'), pealim = groupOf(R, 'pealim'), wikt = groupOf(R, 'wiktionary');
  check('Yours first: Dan\'s cards whose meaning has "run" as a whole word, any case, newest first (ריצה "running; a run", לברוח "to Run away", מרוץ "a race, a run"), pointed as the Looked up list shows them, with their status; "running away" alone is not "run"',
    words(yours).join() === nfc('רִיצָה,בָּרַח,מֵרוֹץ') && yours.rows[1].word === 'ברח' && yours.rows[2].meaning === 'a race, a run' && yours.rows[2].status === 'shaky' && yours.rows[1].status === 'new' && !words(yours).includes(nfc('בְּרִיחָה')), JSON.stringify(yours));
  const larutz = pealim.rows.find((r) => r.he.normalize('NFC') === nfc('לָרוּץ'));
  check('From Pealim: the ten rows of its results page, לָרוּץ among them — "to run", lar u tz, root ר.ו.ץ, "Verb – pa\'al", its entry on pealim.com',
    pealim.state === 'ok' && pealim.rows.length === 10 && larutz && larutz.meaning === 'to run' && larutz.translit === 'larutz' && larutz.root === 'ר.ו.ץ' && larutz.pos === "Verb – pa'al"
    && larutz.sources.length === 1 && larutz.sources[0].url === 'https://www.pealim.com/dict/11-larutz/' && larutz.sources[0].path === '/dict/11-larutz/' && larutz.word === 'לרוץ', JSON.stringify(larutz));
  check('…in Pealim\'s order (לִרְהוֹט first, לָרוּץ second, לְהִיגָּמֵר last)', words(pealim)[0] === nfc('לִרְהוֹט') && words(pealim)[1] === nfc('לָרוּץ') && words(pealim)[9] === nfc('לְהִיגָּמֵר'), words(pealim).join());
  check('From Wiktionary: the Hebrew words of run/translations (the entry points to its subpage), each under its sense\'s gloss, in the entry\'s order, the {{trans-see}} senses included (ריצה, Dan\'s, stands in Yours)',
    wikt.state === 'ok' && wikt.rows.map((r) => `${r.he.normalize('NFC')}:${r.sense}`).join('|') === nfc('רָץ:to move quickly on two feet|נִהֵל:to be in charge of|הבריח:to smuggle illegal goods|מְנוּסָה:instance or period of fleeing|הַפְלָגָה:voyage|נִסָּיוֹן:trial'), JSON.stringify(wikt.rows.map((r) => [r.he, r.sense])));
  check('…each with its tr= transliteration, its meaning the gloss, and its label opening the Wiktionary page it came from',
    wikt.rows[0].translit === 'rats' && wikt.rows[0].meaning === 'to move quickly on two feet' && wikt.rows[0].sources[0].url === 'https://en.wiktionary.org/wiki/run/translations' && wikt.rows[3].translit === "m'nusá" && yours.rows[0].translit === '');
  const smug = wikt.rows.find((r) => r.word === 'הבריח'), trialRow = wikt.rows.find((r) => r.word === 'ניסיון');
  check('a {{trans-see|to smuggle illegal goods|smuggle}} sense: the Hebrew of the entry it names (smuggle\'s first sense, הבריח), kept under run\'s gloss, its label opening https://en.wiktionary.org/wiki/smuggle',
    smug && smug.sense === 'to smuggle illegal goods' && smug.meaning === 'to smuggle illegal goods' && smug.sources[0].url === 'https://en.wiktionary.org/wiki/smuggle' && smug.sources[0].page === 'smuggle', JSON.stringify(smug));
  check('…{{trans-see|trial}} (the entry named by the gloss itself): trial\'s ניסיון, its alt= of two spellings ("ניסיון \\ נִסָּיוֹן") shown pointed, transliterated nisayón',
    trialRow && nfc(trialRow.he) === nfc('נִסָּיוֹן') && trialRow.translit === 'nisayón' && trialRow.sources[0].url === 'https://en.wiktionary.org/wiki/trial', JSON.stringify(trialRow));
  check('…and Wiktionary\'s group says its word that stands in Yours is shown above', wikt.message === 'Wiktionary lists 1 more, shown above.', wikt.message);
  const ask1 = await asked();
  check('one request to Pealim (run); to Wiktionary run, run/translations and the three entries its {{trans-see}} senses name (smuggle, voyage, trial), nothing else',
    JSON.stringify([...ask1].sort()) === JSON.stringify(['enwiktionary:run', 'enwiktionary:run/translations', 'enwiktionary:smuggle', 'enwiktionary:trial', 'enwiktionary:voyage', 'pealim:run']), JSON.stringify(ask1));
  const ritsa = yours.rows[0];
  check('a word of Dan\'s that Wiktionary lists too (ריצה) is one row in Yours naming both ("Yours, Wiktionary"), Dan\'s meaning kept, and leaves Wiktionary\'s group',
    ritsa.word === 'ריצה' && ritsa.sources.map((s) => s.label).join(', ') === 'Yours, Wiktionary' && ritsa.meaning === 'running; a run' && !wikt.rows.some((r) => r.word === 'ריצה'), JSON.stringify(ritsa));
  check('…merged by the bare word only: Dan\'s verb ברח (its past form) and Pealim\'s לִבְרוֹחַ (the infinitive) stay two rows',
    yours.rows[1].sources.length === 1 && pealim.rows.some((r) => r.word === 'לברוח'));
  check('the model was not asked (the dictionaries had words)', (await orCalls()).calls === or0 && (await orCalls()).english_calls === 0);

  // --- verify 6: nothing saved by an English look-up ----------------------------------------------
  check('an English look-up makes no spot, changes no status, sends no mark to the spine and records no lookup on a card',
    count('spots') === spots0 && count('spots', "status != 'new'") === shaky0 && (await spinePuts()) === puts0 && count('lookups') === layers0);
  check('…and keeps the look-up (english_lookups: text, at, the merged answer) and each site\'s parsed answer by site and lower-cased text',
    count('english_lookups') === 1 && JSON.parse(peek('SELECT answer_json FROM english_lookups')[0].answer_json).groups.length === 3
    && peek('SELECT site, text FROM english_sites ORDER BY site').map((r) => `${r.site}:${r.text}`).join() === 'pealim:run,wiktionary:run');

  // --- verify 4: fetched once ----------------------------------------------------------------------
  const n1 = (await asked()).length;
  const again = await look('RUN');
  check('"RUN" again within 30 days: the same groups, no request to either stand-in (kept by the lower-cased text)',
    again.status === 200 && (await asked()).length === n1 && again.body.text === 'RUN' && words(groupOf(again.body, 'pealim')).join() === words(pealim).join() && count('english_lookups') === 2);

  // --- verify 3 and the meaning's precedence: "credibility" ------------------------------------
  const cred = (await look('credibility')).body;
  const cp = groupOf(cred, 'pealim'), cw = groupOf(cred, 'wiktionary');
  check('a word both sites list (אמינות: Pealim\'s אֲמִינוּת, Wiktionary\'s אמינות) is one row naming both, "Pealim, Wiktionary", first in Pealim\'s group',
    cp.rows.length === 1 && cp.rows[0].word === 'אמינות' && cp.rows[0].sources.map((s) => s.label).join(', ') === 'Pealim, Wiktionary' && !cw.rows.some((r) => r.word === 'אמינות'), JSON.stringify(cred.groups));
  check('…its meaning Pealim\'s ("reliability, credibility"), not Wiktionary\'s gloss; its pointed form Pealim\'s; the transliteration Pealim\'s',
    cp.rows[0].meaning === 'reliability, credibility' && cp.rows[0].he === 'אֲמִינוּת' && cp.rows[0].translit === 'aminut');
  check('…and a word only Wiktionary lists (אמון) has the gloss for its meaning; the group says its other word is shown above',
    cw.rows.length === 1 && cw.rows[0].he === 'אמון' && cw.rows[0].meaning === "reputation impacting one's ability to be believed" && cw.rows[0].translit === 'emún' && cw.message === 'Wiktionary lists 1 more, shown above.', JSON.stringify(cw));
  // dev-check on 53de2d3: a site whose words all stand above is not "no word"
  const cre = (await look('credence')).body;
  const crp = groupOf(cre, 'pealim'), crw = groupOf(cre, 'wiktionary');
  check('complete overlap ("credence": Wiktionary\'s only word, אמון, is Pealim\'s אֵמוּן): one row naming both; Wiktionary\'s group has no row and says "Wiktionary lists one word for “credence”, shown above." — never "lists no Hebrew word"',
    crp.rows.length === 1 && crp.rows[0].sources.map((s) => s.label).join(', ') === 'Pealim, Wiktionary' && crw.state === 'ok' && crw.rows.length === 0
    && crw.message === 'Wiktionary lists one word for “credence”, shown above.' && !groupOf(cre, 'model'), JSON.stringify(cre.groups));
  // dev-check on 53de2d3: a {{trans-see}} sense supplies the Hebrew
  const nOr = (await orCalls()).english_calls;
  const tr = (await look('trustiness')).body;
  const tw = groupOf(tr, 'wiktionary');
  check('"trustiness", whose only translations are {{trans-see|confidence in or reliance on some person or quality|trust}}: trust\'s matching sense gives אֵמוּן, kept under that gloss and linked to trust',
    tw.state === 'ok' && words(tw).join() === nfc('אֵמוּן') && tw.rows[0].sense === 'confidence in or reliance on some person or quality' && tw.rows[0].sources[0].url === 'https://en.wiktionary.org/wiki/trust' && tw.rows[0].translit === "'emún", JSON.stringify(tw));
  check('…so the model is not asked (Pealim lists none; the word came from the entry Wiktionary names)', (await orCalls()).english_calls === nOr && !groupOf(tr, 'model') && groupOf(tr, 'pealim').state === 'none');
  // dev-check on 5bd1871: a linked page that fails keeps the words already read
  await control({ 'enwiktionary:trust': 'reset' });
  const nOr2 = (await orCalls()).english_calls;
  const pr = (await look('probe')).body;
  const pw = groupOf(pr, 'wiktionary');
  check('a {{trans-see}} entry that fails (trust down): the entry\'s own word (אמינות) still shows, the group saying "Wiktionary\'s page trust did not answer; the words it gave are shown."; the model is not asked',
    pw.state === 'ok' && words(pw).join() === 'אמינות' && pw.message === 'Wiktionary\'s page trust did not answer; the words it gave are shown.' && (await orCalls()).english_calls === nOr2 && !groupOf(pr, 'model'), JSON.stringify(pr.groups));
  check('…and the partial answer is not kept as Wiktionary\'s answer (no english_sites row for probe)', count('english_sites', "site = 'wiktionary' AND text = 'probe'") === 0);
  await control({ 'enwiktionary:trust': 'page' });
  const pr2 = (await look('probe')).body;
  check('…trust back: the next look-up reads it again and gives both words (אמינות, אֵמוּן), kept now, no line about a missing page',
    words(groupOf(pr2, 'wiktionary')).join() === nfc('אמינות,אֵמוּן') && !groupOf(pr2, 'wiktionary').message && count('english_sites', "site = 'wiktionary' AND text = 'probe'") === 1, JSON.stringify(groupOf(pr2, 'wiktionary')));
  await control({ 'enwiktionary:probesub/translations': 'reset' });
  const ps = (await look('probesub')).body;
  check('a /translations subpage that fails: the entry\'s own word (מְהֵימָנוּת) still shows, saying the subpage did not answer; not kept; no model call',
    words(groupOf(ps, 'wiktionary')).join() === nfc('מְהֵימָנוּת') && groupOf(ps, 'wiktionary').message === 'Wiktionary\'s page probesub/translations did not answer; the words it gave are shown.'
    && count('english_sites', "site = 'wiktionary' AND text = 'probesub'") === 0 && (await orCalls()).english_calls === nOr2, JSON.stringify(groupOf(ps, 'wiktionary')));
  await control({ 'enwiktionary:probesub/translations': 'page' });
  const la = (await look('loopa')).body;
  check('two entries that name each other (loopa -> loopb -> loopa): each read once, the second\'s trans-see not followed; no word, so the model group',
    (await asked()).filter((a) => /^enwiktionary:loop/.test(a)).join() === 'enwiktionary:loopa,enwiktionary:loopb' && groupOf(la, 'wiktionary').state === 'none' && groupOf(la, 'model'), JSON.stringify(await asked()));
  check('…Yours is said to be empty, in plain words', groupOf(cred, 'yours').state === 'none' && groupOf(cred, 'yours').message === 'None of your words means “credibility”.');

  // --- verify 2: "reliability" — no Hebrew in the dictionaries, so the model ---------------------
  const relCalls = (await orCalls()).english_calls;
  const rel = (await look('reliability')).body;
  const oc = await orCalls();
  console.log(`     reliability: ${rel.groups.map((g) => `${g.id}(${g.state}${g.message ? `: ${g.message}` : ''}) ${words(g).join(', ')}`).join(' | ')}`);
  check('"reliability": Pealim says it lists no word; Wiktionary\'s entry has a Translations table but no Hebrew line, so no word either',
    groupOf(rel, 'pealim').state === 'none' && groupOf(rel, 'pealim').message === 'Pealim lists no Hebrew word for “reliability”.' && groupOf(rel, 'wiktionary').state === 'none');
  const mg = groupOf(rel, 'model');
  check('…so, and only so, the model is asked once, and its words stand last under "Suggested by the model; no dictionary listed it"',
    oc.english_calls === relCalls + 1 && rel.groups.at(-1) === mg && mg.heading === 'Suggested by the model; no dictionary listed it' && words(mg).join() === 'אֲמִינוּת,מְהֵימָנוּת' && mg.rows[1].meaning === 'trustworthiness, dependability', JSON.stringify(mg));
  check('…a model answer that is not Hebrew letters ("reliable") is dropped; the call is JSON only, to the card model, asking for at most five words used in Israeli news and business Hebrew',
    !words(mg).includes('reliable') && oc.last_english_ask.format === 'json_object' && oc.last_english_ask.model === 'anthropic/claude-sonnet-4.6' && /at most five words/i.test(oc.last_english_ask.system) && /Israeli news and business Hebrew/.test(oc.last_english_ask.system)
    && /1 dropped \(not Hebrew\)/.test(server.log), JSON.stringify(oc.last_english_ask));
  check('…and the model\'s rows carry no source label and no link (the model writes no URL)', mg.rows.every((r) => r.sources.length === 0 && !JSON.stringify(r).includes('http')));
  const zz = (await look('zzqx')).body;
  check('a word nobody has and the model answers only with Latin letters: the model group says it gave no Hebrew word', groupOf(zz, 'model').state === 'none' && groupOf(zz, 'model').rows.length === 0 && /no Hebrew word/.test(groupOf(zz, 'model').message));

  // --- a phrase; tried as typed ---------------------------------------------------------------------
  const phCalls = (await orCalls()).english_calls;
  const ph = (await look('run  away')).body;
  check('a phrase ("run away"): Yours holds the cards with both words (לברוח); each site asked for the phrase; no model call since Yours has a word',
    ph.text === 'run away' && words(groupOf(ph, 'yours')).join() === 'בָּרַח' && (await asked()).includes('pealim:run away') && (await asked()).includes('enwiktionary:run away') && (await orCalls()).english_calls === phCalls, JSON.stringify(ph.groups));
  const kn = (await look('Knesset')).body;
  check('Wiktionary: the lower-cased page first (knesset, missing), then as typed (Knesset), its alt= pointed form taken',
    (await asked()).filter((a) => /^enwiktionary:knesset$/i.test(a)).join() === 'enwiktionary:knesset,enwiktionary:Knesset' && words(groupOf(kn, 'wiktionary')).join() === 'כְּנֶסֶת' && groupOf(kn, 'wiktionary').rows[0].sources[0].url === 'https://en.wiktionary.org/wiki/Knesset', JSON.stringify(kn.groups));

  // --- verify 5 and the changed page: one site failing, the other showing -------------------------
  await control({ pealim: 'reset' });
  const down = (await look('trust')).body;
  check('Pealim down, no kept copy: its group says "Pealim did not answer"; Wiktionary\'s words for "trust" still show',
    groupOf(down, 'pealim').state === 'failed' && groupOf(down, 'pealim').message === 'Pealim did not answer' && words(groupOf(down, 'wiktionary')).join() === 'אֵמוּן,טְרַסְט,בָּטַח,סָמַךְ', JSON.stringify(down.groups).slice(0, 400));
  check('…a failure is not kept (no english_sites row for pealim:trust)', count('english_sites', "site = 'pealim' AND text = 'trust'") === 0);
  await control({ pealim: 'changed' });
  const changed = (await look('escape')).body;
  check('Pealim\'s page changed shape (no results table, no "No results"): "Pealim’s page could not be read", never an empty group that looks like no words',
    groupOf(changed, 'pealim').state === 'failed' && groupOf(changed, 'pealim').message === 'Pealim’s page could not be read' && groupOf(changed, 'pealim').rows.length === 0, JSON.stringify(groupOf(changed, 'pealim')));
  await control({ pealim: 'page', enwiktionary: 'status:503' });
  const wdown = (await look('stride')).body;
  check('Wiktionary down: "Wiktionary did not answer", Pealim\'s group still there', groupOf(wdown, 'wiktionary').message === 'Wiktionary did not answer' && groupOf(wdown, 'pealim').state === 'none');
  await control({ enwiktionary: 'page' });
  check('the server log names each site fetched and each failure', /english: pealim "run": 10 words, fetched in \d+ ms/.test(server.log) && /english: pealim "trust": Pealim did not answer/.test(server.log));

  // --- verify 7: refusals ---------------------------------------------------------------------------
  const nAsk = (await asked()).length, nKept = count('english_lookups'), orN = (await orCalls()).calls;
  const mixed = await look('run רץ'), four = await look('run to the hills'), long = await look('a'.repeat(61)), digit = await look('covid19');
  console.log(`     refusals: ${[mixed, four, long, digit].map((r) => `${r.status} ${r.body.error}`).join(' | ')}`);
  check('mixed Hebrew and Latin letters: 400 saying the box takes a Hebrew word or an English one', mixed.status === 400 && mixed.body.error === 'Look up a Hebrew word or an English one, not both: this has Hebrew and Latin letters together.');
  check('four English words: 400 saying it takes a word or a phrase of up to three', four.status === 400 && four.body.error === 'Look up an English word or a phrase of up to 3 words; this has 4.');
  check('over 60 characters: 400 naming the limit', long.status === 400 && long.body.error === 'Look up an English word or a phrase of up to 3 words (at most 60 characters); this has 61.');
  check('a digit among Latin letters: 400 naming what an English look-up takes', digit.status === 400 && digit.body.error === 'An English look-up takes letters, spaces, hyphens and apostrophes; this has “1”.');
  check('…each refused before any site or the model is asked, and nothing kept', (await asked()).length === nAsk && count('english_lookups') === nKept && (await orCalls()).calls === orN);
  const hy = await look("well-known"), ap = await look("don't");
  check('false-rejection: a hyphen or an apostrophe inside an English word is taken', hy.status === 200 && hy.body.mode === 'english' && ap.status === 200 && ap.body.mode === 'english');

  // --- Hebrew as before ------------------------------------------------------------------------------
  const he = await look('רפורמה');
  check('Hebrew text still answers as before: the card, saved, its seven tabs (no mode field)', he.status === 200 && he.body.mode === undefined && he.body.card.meaning_en === 'a reform' && he.body.saved.status === 'shaky' && he.body.references.length === 7);
  const gersh = await look('צה"ל'), longHe = await look('א'.repeat(61));
  check('…a Hebrew word with gershayim goes the Hebrew way (the stand-in model does not know it: 422), and a long Hebrew text gets the Hebrew refusal, unchanged',
    gersh.status === 422 && longHe.status === 400 && /^Look up one word \(at most 60 characters\)/.test(longHe.body.error), JSON.stringify([gersh.body, longHe.body]));

  // --- verify 6: a tap saves exactly that one word ----------------------------------------------
  const sp1 = count('spots', "status = 'shaky'"), puts1 = await spinePuts();
  const tap = await look(larutz.word);
  check('tapping לָרוּץ looks up its bare word (לרוץ) as a Hebrew word: its card, saved, its seven tabs, recorded on the Look up page',
    tap.status === 200 && tap.body.card.meaning_en === 'to run' && tap.body.saved.status === 'shaky' && tap.body.saved.already === false && tap.body.references.length === 7 && tap.body.layer.line === 'looked up on the Look up page', JSON.stringify(tap.body).slice(0, 300));
  check('…exactly one word saved (one more shaky spot, one mark to the spine)', count('spots', "status = 'shaky'") === sp1 + 1 && (await spinePuts()) === puts1 + 1);

  // --- verify 8: "Looked up" -------------------------------------------------------------------------
  const nAsk2 = (await asked()).length, orN2 = (await orCalls()).calls;
  const list = await api('GET', '/lookups');
  const items = list.body.items;
  const runItem = items.find((i) => i.key === 'english:run');
  console.log(`     Looked up: ${items.map((i) => (i.kind === 'english' ? `${i.text}(${i.count})` : i.headword)).join(', ')}`);
  check('"Looked up" carries the English look-ups as { kind: english, text, count, at, day }, newest first among the words, one per text',
    list.status === 200 && runItem && runItem.kind === 'english' && runItem.text === 'RUN' && runItem.count === 19 && /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(runItem.day)
    && items[0].kind === 'word' && items[1].kind === 'word' && items.filter((i) => i.key === 'english:run').length === 1, JSON.stringify(items.slice(0, 4)));
  check('…in the same newest-first order (the tapped לרוץ, then רפורמה, then the English look-ups, newest first)',
    items.map((i) => i.key).indexOf('english:don\'t') < items.map((i) => i.key).indexOf('english:run') && items.map((i) => i.at).every((a, i, all) => i === 0 || all[i - 1] >= a));
  const reopen = await api('GET', `/english?text=${encodeURIComponent(runItem.text)}`);
  check('reopening it answers the kept answer (the 19 words), with no request to the stand-ins or the model',
    reopen.status === 200 && reopen.body.kept === true && reopen.body.groups.reduce((n, g) => n + g.rows.length, 0) === 19 && (await asked()).length === nAsk2 && (await orCalls()).calls === orN2);
  const nope = await api('GET', '/english?text=never');
  check('an English text never looked up: 404 saying so', nope.status === 404 && /look it up again/.test(nope.body.error));
  // walk the list one at a time: every item once, English and Hebrew alike
  const seen = [];
  let cursor = '';
  for (let i = 0; i < 50; i++) {
    const pg = (await api('GET', `/lookups?limit=1${cursor}`)).body;
    seen.push(...pg.items.map((x) => x.key));
    if (!pg.more) break;
    cursor = `&before=${encodeURIComponent(pg.next)}&before_key=${encodeURIComponent(pg.next_key)}`;
  }
  check('paging one at a time reaches every item once, an English key as before_key included', seen.join() === items.map((i) => i.key).join(), JSON.stringify({ seen, all: items.map((i) => i.key) }));

  // --- the source labels, opened inside the page ------------------------------------------------
  const pe = await api('GET', `/english/entry?site=pealim&path=${encodeURIComponent('/dict/11-larutz/')}`);
  check('Pealim\'s label: GET /english/entry answers a copy of the entry (embed copy, as the Pealim tab), its live link on pealim.com, kept',
    pe.status === 200 && pe.body.mode === 'copy' && pe.body.url === 'https://www.pealim.com/dict/11-larutz/' && !/<script/i.test(pe.body.html) && count('reference_pages', "reference = 'pealim' AND term = '/dict/11-larutz/'") === 1, JSON.stringify({ ...pe.body, html: undefined }));
  const wk = await api('GET', `/english/entry?site=wiktionary&page=${encodeURIComponent('run/translations')}`);
  check('Wiktionary\'s label: framed (its English pages send no X-Frame-Options), the live link https://en.wiktionary.org/wiki/run/translations',
    wk.status === 200 && wk.body.mode === 'frame' && wk.body.url === 'https://en.wiktionary.org/wiki/run/translations' && wk.body.frame_url.startsWith(standin), JSON.stringify(wk.body));
  const badEntry = await api('GET', `/english/entry?site=pealim&path=${encodeURIComponent('https://evil.example/')}`), badSite = await api('GET', '/english/entry?site=morfix&path=x');
  check('an entry path that is not a Pealim entry, or another site, is refused (400), naming what is taken', badEntry.status === 400 && /\/dict\//.test(badEntry.body.error) && badSite.status === 400 && /pealim or wiktionary/.test(badSite.body.error));

  // --- in this process, with the clock set: 30 days, a site down past them ----------------------
  process.env.REFERENCE_STANDIN = standin;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_URL = `${mock}/v1/chat/completions`;
  const db = require(join(root, 'lib', 'db.js'));
  db.open(libDir);
  const english = require(join(root, 'lib', 'english.js'));
  const seeOnly = english.parseWiktionary('{{trans-see|confidence in a person|trust}}\n{{trans-see|voyage}}\n{{trans-see|to smuggle|smuggle#Verb|contraband}}');
  check('the parser keeps a {{trans-see}} sense with the entries it names (the gloss itself when none is named; "#…" dropped)',
    JSON.stringify(seeOnly.senses) === JSON.stringify([{ gloss: 'confidence in a person', words: [], see: ['trust'] }, { gloss: 'voyage', words: [], see: ['voyage'] }, { gloss: 'to smuggle', words: [], see: ['smuggle', 'contraband'] }]), JSON.stringify(seeOnly));
  const DAY = 24 * 3600 * 1000;
  let at = Date.parse('2026-10-23T03:00:00Z');
  english.setClock(() => at);
  const runs = async () => (await asked()).filter((a) => a === 'pealim:run' || a === 'enwiktionary:run').length;
  const r0 = await runs();
  await english.find('run');
  check('in this process: "run" fetched on the first look-up (Pealim and Wiktionary once each)', (await runs()) === r0 + 2);
  at += 29 * DAY;
  await english.find('run');
  check('29 days on: the kept answers, no request', (await runs()) === r0 + 2);
  at += 2 * DAY;
  const r31 = await english.find('run');
  check('31 days on: fetched again (one more request to each), and kept with the new time', (await runs()) === r0 + 4 && db.getEnglishSite('pealim', 'run').fetched_at === new Date(at).toISOString() && groupOf(r31, 'pealim').rows.length === 10);
  at += 31 * DAY;
  await control({ pealim: 'reset' });
  const stale = await english.find('run');
  const sp = groupOf(stale, 'pealim');
  check('31 days more with Pealim down: its kept copy shown (10 rows), saying so with its day; Wiktionary fetched afresh',
    sp.state === 'ok' && sp.rows.length === 10 && sp.message === `Pealim did not answer; shown from the copy kept on ${new Date(at - 31 * DAY).toISOString().slice(0, 10)}.` && groupOf(stale, 'wiktionary').state === 'ok', JSON.stringify({ ...sp, rows: sp.rows.length }));
  await control({ pealim: 'page' });
  // a partial answer past the 30 days, with a full copy kept: the kept copy wins
  await english.find('probe');
  at += 31 * DAY;
  await control({ 'enwiktionary:trust': 'reset' });
  const keptAt = db.getEnglishSite('wiktionary', 'probe').fetched_at;
  const pk = groupOf(await english.find('probe'), 'wiktionary');
  check('31 days on, trust down while probe\'s own page answers: the full copy kept is shown (both words), saying what did not answer and the day kept; the kept copy not replaced',
    words(pk).join() === nfc('אמינות,אֵמוּן') && pk.message === `Wiktionary's page trust did not answer; shown from the copy kept on ${keptAt.slice(0, 10)}.` && db.getEnglishSite('wiktionary', 'probe').fetched_at === keptAt, JSON.stringify(pk));
  await control({ 'enwiktionary:trust': 'page' });
} catch (e) {
  console.error(e);
  failed++;
} finally {
  for (const k of kids) k.kill();
  if (failed) console.log(server.log.split('\n').slice(-30).join('\n'));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(libDir, { recursive: true, force: true });
}
if (failed) { console.log(`\n${failed} english check(s) failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} english checks passed`);
