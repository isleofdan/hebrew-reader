'use strict';
// "Find an article": on Dan's tap, and only then, the reader looks through
// recent Israeli business and energy news for one article worth a lesson,
// loads it exactly as if he had given its address, and attaches a study
// guide to it. The rules are the 2026 Hebrew Study project's (card
// hebrew-hunt, event 688): sections 2 and 11 choose the article, section 8
// is the guide, section 10 the rules learned the hard way.
//
//   run({ progress })  -> { article, guide } | { nothing: "<one sentence>" }
//   trial()            -> one real model call on one real candidate, nothing stored
//   makeGuide(id)      -> the study guide made (again) for a found article
//
// Every candidate tried, and why it was dropped, goes to the hunts table;
// the Articles page shows the last one.

const articles = require('./articles');
const db = require('./db');
const lookup = require('./lookup');
const checks = require('./guide-checks');
const guyPrompt = require('./guy-lesson-prompt');

const RECENT_DAYS = 14;          // "published within the last two weeks"
const MIN_WORDS = 600;           // "drop anything … under about 600 words of body text"
// Live blogs and market tickers are skipped (Dan, 3 Oct 2026). The numbers
// were measured on ten-plus real candidates per site on 3 Oct 2026 (field
// report hebrew-hunt-two): the four live pages had 10, 12, 10 and 56 lines
// that open with a clock time and 1,582-2,663 words; no reported piece had
// more than 1; the three market blogs were 14.5-17.2% numbers and market
// names, reported pieces of 600 words or more at most 11%.
const MAX_WORDS = 1500;          // the note's "600-1,500 Hebrew words"; every live blog measured was longer
const CLOCK_LINES = 4;           // lines opening with HH:MM, from this many: a live blog
const MARKET_SHARE = 13;         // % of words that are numbers or market names, from this: a ticker
const LIVE_TYPES = ['סקירת מסחר']; // Globes' article:type on its market live blogs ("trading review")
const LIVE_TITLE = /עדכונים שוטפים/; // "running updates", in a live page's title
const MAX_FETCHED = 18;          // candidates loaded per tap, at most
const MAX_JUDGED = 6;            // candidates put to the model per tap, at most
const PER_SOURCE = 8;            // newest links taken from each source
const JUDGE_CHARS = 12000;       // the body the model reads for the three tests
const GUIDE_CHARS = 20000;       // the body the guide is made from
const VOCAB_MIN = 25, VOCAB_MAX = 35, PAPER_MAX = 2, DRILL_MAX = 2;
// The persons of a drill's past and future table (see personsOf below).
const PERSONS = ['1s', '2ms', '2fs', '3ms', '3fs', '1p', '2mp', '2fp', '3mp', '3fp'];
const JUDGE_WHAT = 'The article could not be checked';
const JUDGE_MAX_TOKENS = 6000;
const GUIDE_WHAT = 'The study guide could not be made';
const GUIDE_TIMEOUT_MS = 8 * 60 * 1000;
const GUIDE_MAX_TOKENS = 16000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hebrew-reader/0.1';

// The five sources of the note's section 2a, as each answered this server on
// 3 Oct 2026 (field report hebrew-hunt-build): Globes and Maariv through
// their RSS feeds, Calcalist through its news section page (its feeds and
// curl are refused; the reader's own fetch is let in). TheMarker gave about
// 150 words of each article (the paywall) and Kan answered 403 to every page
// (a browser challenge): both are left out, and named on the page.
const SOURCES = [
  { name: 'Globes', kind: 'rss', urls: [
    'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=607',  // real estate and infrastructure (energy is here)
    'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=9917', // in Israel
    'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=585',  // capital markets
  ] },
  { name: 'Calcalist', kind: 'page', urls: ['https://www.calcalist.co.il/local_news'], link: /https:\/\/www\.calcalist\.co\.il\/local_news\/article\/[a-z0-9]+/gi },
  { name: 'Maariv', kind: 'rss', urls: ['https://www.maariv.co.il/rss/rssfeedskalkalabaarez'] },
];
const LEFT_OUT = [
  { name: 'TheMarker', why: 'its articles come through as about 150 words (the paywall)' },
  { name: 'Kan', why: 'its site refuses this server (403)' },
];
// HUNT_SOURCES (JSON, the same shape) replaces the list: the checks point it
// at local pages.
function sources() {
  if (process.env.HUNT_SOURCES) return JSON.parse(process.env.HUNT_SOURCES).map((s) => (s.link ? { ...s, link: new RegExp(s.link, 'gi') } : s));
  return SOURCES;
}

const plain = checks.plain;

// --- live blogs and tickers: a recorded rule, not the model's taste ----------

const CLOCK = /^\s*(?:[01]?\d|2[0-3]):[0-5]\d(?=\s|$|[-–—|:])/;
const MARKET = /^(?:ו|ה|ב|ל|מ|ש|כש|וה|שה|מה|בה|לה)?(?:מדד|מדדי|דאו|ג'ונס|נאסד"ק|S&P|ת"א|ניקיי|דאקס|פוטסי|קאק|האנג|סנג|יתר|בנקים|נדל"ן|אג"ח|מט"ח|שקל|דולר|אירו|תשואות|תשואת|נפט|ברנט|זהב|ביטקוין|מניית|מניות|המניה|מניה)[,.;:]?$/;

// What kind of page a loaded article is: { clock, market, words, skip }.
// `skip` is the recorded reason ("skipped: live blog", "skipped: market
// ticker", or the length window's), or null for a reported piece.
function pageKind(a) {
  const lines = a.text.split('\n').filter((l) => l.trim());
  const clock = lines.filter((l) => CLOCK.test(l)).length;
  const toks = a.text.split(/\s+/).filter(Boolean);
  const market = toks.length ? Math.round(toks.filter((w) => /\d/.test(w) || MARKET.test(w)).length / toks.length * 1000) / 10 : 0;
  const words = hebrewWords(a.text);
  const page = a.page || {};
  let skip = null;
  if (LIVE_TYPES.includes(page.type)) skip = `skipped: live blog (the page calls itself "${page.type}")`;
  else if (page.live_schema) skip = 'skipped: live blog (the page is marked LiveBlogPosting)';
  else if (LIVE_TITLE.test(page.og_title || '') || LIVE_TITLE.test(a.title || '')) skip = 'skipped: live blog (its title says running updates)';
  else if (clock >= CLOCK_LINES) skip = `skipped: live blog (${clock} lines open with a clock time)`;
  else if (market >= MARKET_SHARE) skip = `skipped: market ticker (${market}% numbers and market names)`;
  else if (words > MAX_WORDS) skip = `skipped: ${words} words, over ${MAX_WORDS}`;
  return { clock, market, words, skip };
}
const hebrewWords = (text) => String(text).split(/\s+/).filter((w) => /[א-ת]/.test(w)).length;
const days = (n) => n * 24 * 3600 * 1000;

async function get(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'he-IL,he;q=0.9,en;q=0.5' } });
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    return await res.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

// One source's newest links, newest first: [{ url, title, published }].
// A feed gives each item's date; a section page gives none, so its articles
// are dated from their own page (publishedOf) before they are loaded.
async function linksOf(source) {
  const out = [];
  for (const u of source.urls) {
    const page = await get(u);
    if (source.kind === 'rss') {
      for (const m of page.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const tag = (t) => { const x = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(m[1]); return x ? decode(x[1]) : ''; };
        const url = tag('link').replace(/#.*$/, '');
        const when = Date.parse(tag('pubDate'));
        if (url) out.push({ url, title: tag('title'), published: Number.isNaN(when) ? null : new Date(when).toISOString() });
      }
    } else {
      for (const m of page.matchAll(source.link)) out.push({ url: m[0], title: '', published: null });
    }
  }
  const seen = new Set();
  return out.filter((l) => !seen.has(l.url) && seen.add(l.url))
    .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
    .slice(0, PER_SOURCE);
}

// The article's own publication date, from its page's metadata.
async function publishedOf(url) {
  const html = await get(url);
  const m = /article:published_time"\s+content="([^"]+)"/.exec(html) || /datePublished\\?"\s*:\s*\\?"([^"\\]+)/.exec(html);
  const when = m ? Date.parse(m[1]) : NaN;
  return Number.isNaN(when) ? null : new Date(when).toISOString();
}

// Sources taken in turn, newest first within each, starting after the source
// of the last found article (the note's 2g: rotate sources).
function interleave(lists, startAfter) {
  const order = [...lists];
  const i = order.findIndex((l) => l.source === startAfter);
  if (i >= 0) order.push(...order.splice(0, i + 1));
  const out = [];
  for (let k = 0; order.some((l) => k < l.links.length); k++) for (const l of order) if (l.links[k]) out.push({ ...l.links[k], source: l.source });
  return out;
}

// --- the model's judgement: the three tests of section 11 -------------------

const JUDGE_SYSTEM = `You choose Hebrew news articles for Dan, an advanced learner reading Israeli energy and business news to professional level. His weakest areas, in order: producing verb forms (Nif'al first, then roots that deviate from the regular template: gutturals א ה ח ע and ר, a nun that assimilates, hollow roots), and the prepositions Hebrew verbs govern where English uses a different one or none.
You are given one article. Answer with ONE JSON object and nothing else:
{
  "topic": "<what the article is about, in English, at most 12 words>",
  "beat": "energy" | "business" | "economy" | "policy" | "other",
  "formal": true when it is written in formal news register, false for a chatty column or a personal story,
  "same_story": true when it is about the same story or subject as the previous article named in the message, else false,
  "nifal_or_irregular": [ verbs in the body in the Nif'al binyan, or whose root is pe-nun, guttural or hollow: { "word": "<copied exactly as it appears in the body>", "lemma": "<dictionary form>", "root": "<dotted root, e.g. ק.ב.ע>", "binyan": "<paal, nifal, piel, pual, hifil, hufal or hitpael>", "why": "<Nif'al, or which irregularity>" } ],
  "prepositions": [ verbs in the body whose governed preposition differs from English: { "word": "<copied exactly as it appears in the body, the verb form>", "lemma": "<dictionary form>", "hebrew": "<the preposition it takes, e.g. ב->", "english": "<what English uses instead, e.g. 'none (direct object)' or 'of'>" } ],
  "family": [ roots that appear in two or more different word forms in the body: { "root": "<dotted root>", "forms": [ "<each form copied exactly as it appears in the body>" ] } ]
}
Copy every word exactly as it is written in the body, with its prefixes, without nikud. List only what is really there: an empty list is a fair answer. Check every root letter by letter.
Keep it short: at most 3 entries in "nifal_or_irregular", at most 5 in "prepositions" and at most 2 in "family" (with at most 4 forms each) — the best ones, not all of them. Keep "why" to a few words.`;

function judgeMessage(article, previous) {
  const body = article.text.slice(0, JUDGE_CHARS);
  const prev = previous ? `Previous article: ${previous.title}\n${previous.text.slice(0, 600)}` : 'Previous article: none';
  return `Article to judge\nTitle: ${article.title}\n${prev}\n\nBody:\n${body}`;
}

// The model's answer checked against the body: every word it names must be
// there, and the three counts must hold. Answers { pass, why, reason }.
function verdict(answer, article) {
  const inBody = new Set(plain(article.text).split(' '));
  const there = (w) => plain(w).split(' ').every((p) => inBody.has(p));
  const nifal = (answer.nifal_or_irregular || []).filter((v) => there(v.word) && checks.irregular(v));
  const preps = (answer.prepositions || []).filter((v) => there(v.word) && v.hebrew && v.english);
  const family = (answer.family || []).map((f) => ({ ...f, forms: [...new Set((f.forms || []).filter(there).map(plain))] })).filter((f) => f.forms.length >= 2);
  const why = { topic: answer.topic || '', beat: answer.beat || '', nifal_or_irregular: nifal, prepositions: preps, family };
  const reasons = [];
  if (answer.same_story === true) reasons.push('the same story as the last found article');
  if (answer.beat === 'other') reasons.push('not energy, business, economy or policy');
  if (answer.formal === false) reasons.push('not formal news register');
  if (!nifal.length) reasons.push("no Nif'al or irregular-root verb");
  if (preps.length < 3) reasons.push(`${preps.length} verb${preps.length === 1 ? '' : 's'} with a preposition unlike English (3 needed)`);
  if (!family.length) reasons.push('no root in two word forms');
  return { pass: reasons.length === 0, why, reason: reasons.join('; ') };
}

async function judge(article, previous, info) {
  // 2,500 tokens was too few: the live model listed every verb it found and
  // was cut off (first deploy's trial, 3 Oct 2026). The lists are capped in
  // the question; the limit has room to spare; a cut-off answer is asked once more.
  const answer = await lookup.chat({ system: JUDGE_SYSTEM, user: judgeMessage(article, previous), maxTokens: JUDGE_MAX_TOKENS, timeoutMs: 120000, what: JUDGE_WHAT, info, retryParse: true });
  if (answer.error) throw new db.ReaderError(502, `${JUDGE_WHAT}: the model declined (${answer.error}).`);
  return verdict(answer, article);
}

// --- the hunt ------------------------------------------------------------------

let running = false;

// One candidate through every test that needs no model, in order: the date,
// the page, a live blog or ticker, the length window, already in the list.
// Answers { a } (loaded, ready for the model) or { outcome } (why it was left).
async function screen(c, since) {
  if (/\.premium\//.test(c.url)) return { outcome: 'dropped: behind a paywall' };
  if (!c.published) c.published = await publishedOf(c.url);
  if (!c.published) return { outcome: 'dropped: no publication date on the page' };
  if (Date.parse(c.published) < since) return { outcome: `dropped: published ${c.published.slice(0, 10)}, more than two weeks ago` };
  const a = await articles.fromUrl(c.url);
  c.title = a.title; c.words = hebrewWords(a.text);
  if (a.thin) return { outcome: 'dropped: the page gave little text (a stub or a paywall)' };
  const kind = pageKind(a);
  if (kind.skip) return { outcome: kind.skip };
  if (c.words < MIN_WORDS) return { outcome: `dropped: ${c.words} words, under ${MIN_WORDS}` };
  if (db.articleWithUrl(c.url) || db.articleWithUrl(a.source_url)) return { outcome: 'dropped: already in your articles' };
  return { a };
}

// `progress(line)` is told each step in plain words. Never throws for a
// candidate: each failure is a reason it was dropped. Throws only when
// another search is already running.
async function run({ progress = () => {} } = {}) {
  if (running) throw new db.ReaderError(409, 'Already looking for an article; wait for it to finish.');
  running = true;
  const list = sources();
  const huntId = db.startHunt(list.map((s) => s.name));
  const tried = [];
  const model = { status: null, message: null };
  const note = (c, outcome) => { tried.push({ url: c.url, source: c.source, title: c.title || null, words: c.words || null, outcome }); };
  try {
    const previous = db.lastFoundArticle();
    const prevSource = previous ? (sources().find((s) => previous.source_url && s.urls.some((u) => new URL(u).host === new URL(previous.source_url).host)) || {}).name : null;
    const lists = [];
    for (const s of list) {
      progress(`Looking at ${s.name}…`);
      try { lists.push({ source: s.name, links: await linksOf(s) }); }
      catch (e) { tried.push({ url: s.urls[0], source: s.name, title: null, words: null, outcome: `dropped: the list of articles could not be read (${e.message})` }); }
    }
    const since = Date.now() - days(RECENT_DAYS);
    let fetched = 0, judged = 0;
    for (const c of interleave(lists, prevSource)) {
      if (fetched >= MAX_FETCHED || judged >= MAX_JUDGED) break;
      progress(`Checking an article from ${c.source}…`);
      fetched++;
      try {
        const { a, outcome } = await screen(c, since);
        if (!a) { note(c, outcome); continue; }
        judged++;
        const info = {};
        let v;
        try { v = await judge(a, previous, info); model.status = 'ok'; model.message = `${info.model || lookup.MODEL} answered`; }
        catch (e) { model.status = 'failed'; model.message = e.message; note(c, `dropped: ${e.message}`); continue; }
        if (!v.pass) { note(c, `dropped: ${v.reason}`); continue; }
        note(c, 'chosen');
        const stored = db.addArticle({ title: a.title, source_url: a.source_url, text: a.text, origin: 'found', source_name: c.source, why: { ...v.why, published: c.published, words: c.words } });
        console.log(`hunt ${huntId}: article ${stored.id} "${stored.title}" from ${c.source} (${c.words} words) after ${tried.length} tried`);
        progress('Writing the study guide… this can take a few minutes.');
        const g = await makeGuide(stored.id, { info: model });
        db.finishHunt(huntId, { tried, article_id: stored.id, outcome: g.ok ? 'found, with its study guide' : `found; the study guide could not be made: ${g.error}`, model_status: model.status, model_message: model.message });
        return { article: db.getArticle(stored.id), guide: g };
      } catch (e) {
        note(c, `dropped: ${e.message}`);
      }
    }
    const names = lists.map((l) => l.source);
    const nothing = `Nothing suitable today — tried ${tried.length} article${tried.length === 1 ? '' : 's'} from ${names.length ? names.join(', ') : 'no source that answered'}.`;
    db.finishHunt(huntId, { tried, outcome: nothing, model_status: model.status, model_message: model.message });
    console.log(`hunt ${huntId}: ${nothing}`);
    return { nothing };
  } catch (e) {
    db.finishHunt(huntId, { tried, outcome: `stopped: ${e.message}`, model_status: model.status, model_message: model.message });
    throw e;
  } finally {
    running = false;
  }
}

// The deploy's proof, and the way to see the chooser at work without
// changing anything: the same candidates, the same tests and the same model
// question as a tap, but nothing is stored and nothing is added to the last
// search. Answers { status, model, line, tried: [{ source, title, words,
// outcome }] }: every candidate looked at and why it was left, and the one
// that would be chosen.
async function trial() {
  const list = sources();
  const tried = [];
  const lists = [];
  for (const s of list) {
    try { lists.push({ source: s.name, links: await linksOf(s) }); }
    catch (e) { tried.push({ source: s.name, url: s.urls[0], title: null, words: null, outcome: `dropped: the list of articles could not be read (${e.message})` }); }
  }
  const previous = db.lastFoundArticle();
  const since = Date.now() - days(RECENT_DAYS);
  let fetched = 0, judged = 0, last = null;
  const note = (c, outcome) => tried.push({ source: c.source, url: c.url, title: c.title || null, words: c.words || null, outcome });
  for (const c of interleave(lists, null)) {
    if (fetched >= MAX_FETCHED || judged >= MAX_JUDGED) break;
    fetched++;
    let a, outcome;
    try { ({ a, outcome } = await screen(c, since)); } catch (e) { outcome = `dropped: ${e.message}`; }
    if (!a) { note(c, outcome); continue; }
    judged++;
    const info = {};
    let v;
    try { v = await judge(a, previous, info); }
    catch (e) { note(c, `dropped: ${e.message}`); last = { status: e.status || 502, model: info.model, line: e.message }; continue; }
    if (!v.pass) { note(c, `dropped: ${v.reason}`); last = { status: 200, model: info.model, line: `${c.source}: "${a.title}" would be dropped (${v.reason})` }; continue; }
    note(c, 'would be chosen');
    return { status: 200, model: info.model, line: `${c.source}: "${a.title}" would be chosen`, tried };
  }
  return { ...(last || { status: 503, model: null, line: 'No source gave an article that passed the tests.' }), tried };
}

// --- the study guide: the note's section 8 -------------------------------------

const KEEP_FILES = ['Hebrew_Difficulty_Register.md', 'hebrew-thinking-on-paper.md', 'Hebrew_Study_Objectives_and_Context.md'];

const GUIDE_FRAME = `
=== HOW THESE APPLY TO ONE NEWS ARTICLE ===

You are making the study guide for ONE Israeli news article Dan will read in his Hebrew reader app. The files above are Dan's own: his Difficulty Register, his Thinking-on-Paper practice and his study objectives. They govern the content. The app keeps his word cards itself (every word of the article opens one), so make no flashcards, and the app renders the page, so answer with ONE JSON object and nothing else, in this shape:

{
  "header": { "topic_he": "<the topic, in Hebrew>", "topic_en": "<the topic, in English>", "description": "<one line, in English>" },
  "excerpts": [ 2 to 4 key passages for reading practice: { "theme": "<the theme, in English>", "he": "<one to three sentences copied exactly from the article>" } ],
  "sections": [ in this order, each an object with "kind":
    { "kind": "vocabulary", "rows": [ ${VOCAB_MIN} to ${VOCAB_MAX} words: { "he": "<the word as it appears in the article, without nikud>", "pointed": "<the same with full nikud>", "en": "<English>", "root": "<dotted root, or empty>", "binyan": "<binyan, or empty>", "category": "<thematic category, e.g. Energy, Policy, Economy, Verbs, Expressions>", "flags": "<the ⚠️ flags; for a verb always ⚠️ Prep: the preposition it takes and what English would use; or \\"no spelling trap\\">" } ] },
    { "kind": "paper", "prompts": [ 1 or 2 prompts: { "type": "<one of the seven prompt types>", "anchor": "<the root, verbs or terms from this article>", "prompt": "<2-3 sentences, an invitation, no prescribed layout>", "categories": [ "<the Register categories it targets>" ] } ] },
    { "kind": "drills", "verbs": [ 1 or 2 verbs from the article: { "verb": "<infinitive>", "root": "א.ב.ג", "binyan": "<binyan>", "deviation": "pe-nun" | "pe-yod" | "guttural" | "hollow" | "doubled" | "none" (several joined with ", " when the root has more than one), "takes_object": true | false | "both", "why": "<which Register categories it stacks>",
        "table": [ { "tense": "past" | "present" | "future" | "imperative", "forms": [ { "person": "<e.g. 1s, 3ms, 2fp>", "he": "<form with nikud>" } ] } ] — the past and the future each with every person, one form each: ${PERSONS.join(', ')}; the present ms, fs, mp, fp; the imperative 2ms, 2fs, 2mp, 2fp,
        "deviations": "<where the root deviates from the regular template, or null>",
        "paal_comparison": "<for a Nif'al verb: the same root in Pa'al, compared; else null>",
        "exercises": [ 3 or 4 of { "sentence": "<Hebrew sentence with ___ for the blank>", "cue": "<person/number/tense cue>", "answer": "<the form>" } ] } ] },
    { "kind": "questions", "items": [ 3 to 5 comprehension questions about the article, in Hebrew ] },
    { "kind": "expressions", "items": [ idioms and collocations from the article: { "he": "<as in the article>", "en": "<English>", "usage": "<usage note>", "flags": "<the ⚠️ flags, or empty>" } ] }
  ],
  "relevance": "<how the article connects to Dan's advisory work: Japan energy security, LNG, commodity risk, Israeli policy, Israel-Japan cleantech; 2-4 sentences in English>"
}

Rules, learned the hard way:
- Vocabulary is chosen by stacking: score every candidate against the six Register categories and keep the ones that hit two or three at once (a Nif'al verb with a guttural root and a preposition unlike English outranks three regular verbs); then fill out to ${VOCAB_MIN}-${VOCAB_MAX} across thematic categories so the set still covers the article's meaning.
- Drill the irregular and Nif'al verbs, never only regular ones: when the article has a Nif'al verb, or a verb whose root is pe-nun, guttural (א ה ח ע, or ר) or hollow, the first drill verb is one of those. Favor a verb that also carries a preposition issue.
- Next to every Hebrew preposition, show the English-side mismatch, not only the Hebrew preposition.
- No transliteration anywhere.
- Spelling flags: every vocabulary row whose Hebrew contains ח, כ/ך, א, ע, ס, ש, ט or ת carries a "⚠️ Spelling:" or "⚠️ Confusable:" note naming the letter pair, or the words "no spelling trap" when there truly is none.
- A verb's objects are stated once: a verb said to take no object is never drilled with one (no ___ את).
- Roots, binyanim and etymologies only when you are sure, checked letter by letter.
- At most ${PAPER_MAX} Thinking-on-Paper prompts and ${DRILL_MAX} drill verbs.
- A drill's future table carries every person its past table carries, 2fs, 2mp and 2fp included.
`;

function guideSystem() {
  const files = guyPrompt.files().filter((f) => KEEP_FILES.includes(f.name));
  return [
    "The following are Dan's own Hebrew study files, quoted in full.",
    ...files.map((f) => `=== FILE: ${f.name} ===\n\n${f.text}`),
    GUIDE_FRAME.trim(),
  ].join('\n\n');
}

function guideMessage(article, why, failed) {
  const found = why ? `\nWhat made it suitable: ${JSON.stringify({ nifal_or_irregular: why.nifal_or_irregular, prepositions: why.prepositions, family: why.family })}` : '';
  const base = `Article for a study guide\nTitle: ${article.title}\nSource: ${article.source_name || ''} ${article.source_url || ''}${found}\n\nBody:\n${article.text.slice(0, GUIDE_CHARS)}`;
  return failed ? `${base}\n\nYour previous answer failed these checks. Answer again in full, fixing them: ${failed}` : base;
}

// The answer kept to its shape: the eight parts, vocabulary that is in the
// article, at most 35 rows, 2 prompts and 2 drills.
function shapeGuide(raw, article) {
  const inBody = new Set(plain(article.text).split(' '));
  const there = (w) => plain(w).split(' ').every((p) => inBody.has(p));
  const body = plain(article.text);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const find = (kind) => arr(raw.sections).find((s) => s && s.kind === kind) || {};
  const rows = arr(find('vocabulary').rows).filter((r) => r && r.he && there(r.he)).slice(0, VOCAB_MAX);
  return {
    header: { topic_he: String((raw.header || {}).topic_he || ''), topic_en: String((raw.header || {}).topic_en || ''), description: String((raw.header || {}).description || '') },
    excerpts: arr(raw.excerpts).filter((x) => x && x.he && body.includes(plain(x.he))).slice(0, 4),
    sections: [
      { kind: 'vocabulary', rows },
      { kind: 'paper', prompts: arr(find('paper').prompts).filter((p) => p && p.prompt).slice(0, PAPER_MAX).map((p) => ({ ...p, categories: arr(p.categories) })) },
      { kind: 'drills', verbs: arr(find('drills').verbs).filter((v) => v && v.verb).slice(0, DRILL_MAX).map((v) => ({ ...v, table: arr(v.table), exercises: arr(v.exercises) })) },
      { kind: 'questions', items: arr(find('questions').items).filter(Boolean) },
      { kind: 'expressions', items: arr(find('expressions').items).filter((x) => x && x.he) },
    ],
    relevance: String(raw.relevance || ''),
    cards: [],
  };
}

// The persons of a drill table. The future carries every person the past
// does (Dan's review, 3 Oct 2026: a future without 2fs, 2mp and 2fp). The
// list is the reader's only conjugation reference, Dan's own drill tables in
// docs/guy-lessons/chat-guide-2026-06-15.md, whose past and future columns
// both run אני, אתה, את, הוא, היא, אנחנו, אתם/ן, הם/ן (PERSONS, above). The
// reader has no conjugator: the forms themselves are the guide model's.
const PRONOUNS = { אני: '1s', אתה: '2ms', את: '2fs', הוא: '3ms', היא: '3fs', אנחנו: '1p', אתם: '2mp', אתן: '2fp', הם: '3mp', הן: '3fp' };
// "3ms" -> [3ms]; "3p" -> [3mp, 3fp]; "2mp/2fp", "2mp/fp", "אתם/ן" -> [2mp, 2fp].
function personsOf(label) {
  const out = [];
  let digit = '';
  for (const raw of String(label || '').toLowerCase().replace(/\s+/g, '').split(/[\/,|]/)) {
    if (PRONOUNS[raw]) { out.push(PRONOUNS[raw]); digit = PRONOUNS[raw][0]; continue; }
    if (raw === 'ן' || raw === 'ן)') { if (digit) out.push(`${digit}fp`); continue; }
    const m = /^([123])?([mf])?([sp])$/.exec(raw);
    if (!m) continue;
    digit = m[1] || digit;
    if (!digit) continue;
    if (m[2]) out.push(`${digit}${m[2]}${m[3]}`);
    else if (digit === '1') out.push(`1${m[3]}`);
    else out.push(`${digit}m${m[3]}`, `${digit}f${m[3]}`);
  }
  return out;
}
function tensePersons(verb, tense) {
  const t = (verb.table || []).find((x) => x && String(x.tense).toLowerCase() === tense);
  return t ? new Set((t.forms || []).filter((f) => f && f.he).flatMap((f) => personsOf(f.person))) : null;
}
// "the future of <verb> lacks 2fs, 2mp, 2fp (the past has them)" for each drill that falls short.
function futureGaps(guide) {
  const out = [];
  for (const v of guide.sections.find((s) => s.kind === 'drills').verbs) {
    const past = tensePersons(v, 'past'), future = tensePersons(v, 'future');
    if (!past) continue;
    const missing = PERSONS.filter((p) => past.has(p) && !(future && future.has(p)));
    if (missing.length) out.push(`the future of ${v.verb} lacks ${missing.join(', ')} (the past has ${missing.length === 1 ? 'it' : 'them'})`);
  }
  return out;
}

// The reader's own guide checks (lib/guide-checks.js: drill, nikud, flags,
// objects), plus the counts of the note's section 8.
function guideFailures(guide, why) {
  const verbs = why ? why.nifal_or_irregular.map((v) => ({ surface: v.word, lemma: v.lemma, root: v.root, binyan: v.binyan, from: 'article' })) : [];
  const out = checks.check(guide, { items: [] }, verbs).map((f) => `the ${f.check} check: ${f.detail}`);
  const sec = (k) => guide.sections.find((s) => s.kind === k);
  const n = sec('vocabulary').rows.length;
  if (n < VOCAB_MIN) out.push(`${n} vocabulary rows are in the article (${VOCAB_MIN}-${VOCAB_MAX} needed; a row's Hebrew must be copied from the article)`);
  if (!sec('paper').prompts.length) out.push('no Thinking-on-Paper prompt');
  if (!sec('drills').verbs.length) out.push('no conjugation drill');
  if (!sec('questions').items.length) out.push('no comprehension question');
  if (!guide.excerpts.length) out.push('no key excerpt copied from the article');
  out.push(...futureGaps(guide));
  return out;
}

// Makes (or makes again) the study guide of an article and stores it as HTML.
// Answers { ok, counts } or { ok: false, error }; never throws.
async function makeGuide(id, { info: model = null } = {}) {
  const article = db.getArticle(id);
  const why = article.why;
  const system = guideSystem();
  const info = {};
  let failed = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await lookup.chat({ system, user: guideMessage(article, why, failed), maxTokens: GUIDE_MAX_TOKENS, timeoutMs: GUIDE_TIMEOUT_MS, what: GUIDE_WHAT, model: info.fallback ? lookup.MODEL : lookup.GUIDE_MODEL, info });
      if (raw.error) throw new db.ReaderError(502, `${GUIDE_WHAT}: the model declined (${raw.error}).`);
      const guide = shapeGuide(raw, article);
      const failures = guideFailures(guide, why);
      if (model) { model.status = 'ok'; model.message = `${info.model} answered the study guide${attempt ? ' (second try)' : ''}`; }
      if (!failures.length || attempt === 1) {
        db.setArticleGuide(id, renderGuide(guide, article));
        const counts = { vocabulary: guide.sections[0].rows.length, paper: guide.sections[1].prompts.length, drills: guide.sections[2].verbs.map((v) => `${v.verb} (${v.binyan})`), tries: attempt + 1, unmet: failures };
        console.log(`hunt: study guide for article ${id} via ${info.model}: ${JSON.stringify(counts)}`);
        return { ok: true, counts };
      }
      failed = failures.join('; ');
      console.error(`hunt: study guide for article ${id} failed its checks, asking once more: ${failed}`);
    }
  } catch (e) {
    if (model) { model.status = 'failed'; model.message = e.message; }
    console.error(`hunt: study guide for article ${id}: ${e.message}`);
    return { ok: false, error: e.message };
  }
  return { ok: false, error: 'no guide' };
}

// --- the guide as HTML: the reader's own guide styles (app.css .guide) ------------

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const he = (tag, text, cls = '') => `<${tag} class="he${cls ? ' ' + cls : ''}" dir="rtl">${esc(text)}</${tag}>`;
// A vocabulary row's flags as the page shows them (Dan's review, 3 Oct 2026):
// the ⚠️ only on a spelling trap (Spelling, Confusable) or a preposition note
// (Prep); "no spelling trap" is not shown at all; any other note (Construction,
// Idiom, a plain remark) stays, without the icon. Answers HTML, or ''.
const TRAP = /^(?:Prep|Spelling|Confusable)\s*:/i;
const NO_TRAP = /\bno (?:spelling )?trap\b/i;
function vocabFlags(flags) {
  const parts = String(flags || '').split(/⚠️|\u26A0|;|\n/)
    .map((p) => p.replace(/\uFE0F/g, '').split(/(?<=\.)\s+/).filter((x) => !NO_TRAP.test(x)).join(' ').replace(/^[\s.,:]+|[\s,]+$/g, ''))
    .filter((p) => p && !/^(?:Spelling|Confusable)\s*:\s*(?:none|—|-)?\.?$/i.test(p));
  return parts.map((p) => `<div class="flags">${TRAP.test(p) ? '⚠️ ' : ''}${esc(p)}</div>`).join('');
}
const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
// A guide stored before this rule (3 Oct 2026) is shown by it too: its
// vocabulary flags are redrawn when the page is served; the stored record is
// not changed.
const redrawFlags = (html) => String(html).replace(/<table class="vocab">[\s\S]*?<\/table>/g, (table) => table.replace(/<div class="flags">([\s\S]*?)<\/div>/g, (m, t) => vocabFlags(unesc(t))));

const sectionOpen = (kind, heading) => `<section class="g-${kind}" data-kind="${kind}"><h3 dir="auto">${esc(heading)}</h3>`;

function renderGuide(guide, article) {
  const [vocab, paper, drills, questions, expressions] = guide.sections;
  const host = (() => { try { return new URL(article.source_url).host.replace(/^www\./, ''); } catch { return ''; } })();
  const h = guide.header;
  const parts = [];
  parts.push(`<section class="g-header" data-kind="header"><h2 class="he" dir="rtl">${esc(h.topic_he || article.title)}</h2>`
    + (h.topic_en ? `<p class="en">${esc(h.topic_en)}</p>` : '')
    + `<p>From <a href="${esc(article.source_url)}" target="_blank" rel="noopener">${esc(article.source_name || host)}</a>: ${he('span', article.title)}</p>`
    + (h.description ? `<p class="caption">${esc(h.description)}</p>` : '') + '</section>');
  parts.push(sectionOpen('excerpts', 'קטעים מרכזיים — Key Excerpts')
    + guide.excerpts.map((x) => `<div class="excerpt"><div class="label">${esc(x.theme)}</div>${he('p', x.he)}</div>`).join('') + '</section>');
  parts.push(sectionOpen('vocabulary', 'מילים מרכזיות — Core Vocabulary')
    + `<p class="caption">${vocab.rows.length} words</p><div class="table-wrap"><table class="vocab"><tr><th>Hebrew</th><th>English</th><th>Root</th><th>Category</th></tr>`
    + vocab.rows.map((r) => `<tr>${he('td', r.pointed || r.he)}<td><div>${esc(r.en)}</div>${r.binyan ? `<div class="muted">${esc(r.binyan)}</div>` : ''}${vocabFlags(r.flags)}</td>${he('td', r.root)}<td dir="auto">${esc(r.category)}</td></tr>`).join('')
    + '</table></div></section>');
  parts.push(sectionOpen('paper', 'עבודה על נייר — Thinking on Paper')
    + paper.prompts.map((p) => `<div class="paper-prompt"><div class="paper-title">${esc(p.type)}${p.anchor ? ` — ${esc(p.anchor)}` : ''}</div><p class="prose">${esc(p.prompt)}</p>${p.categories.length ? `<div class="muted">Register: ${esc(p.categories.join(', '))}</div>` : ''}</div>`).join('') + '</section>');
  parts.push(sectionOpen('drills', 'תרגילי הטיה — Conjugation Drills')
    + drills.verbs.map((v) => `<div class="drill"><div class="drill-head">${he('span', v.verb, 'drill-verb')}<span class="muted">${esc([v.root && `root ${v.root}`, v.binyan, v.deviation && v.deviation !== 'none' ? v.deviation : ''].filter(Boolean).join(' · '))}</span></div>`
      + (v.why ? `<p class="why">${esc(v.why)}</p>` : '')
      + `<div class="conj">${v.table.map((t) => `<div class="tense"><div class="label">${esc(t.tense)}</div><dl class="forms">${(t.forms || []).map((f) => `<dt>${esc(f.person)}</dt>${he('dd', f.he)}`).join('')}</dl></div>`).join('')}</div>`
      + (v.deviations ? `<p class="note">${esc(v.deviations)}</p>` : '')
      + (v.paal_comparison ? `<p class="note"><span class="label">Pa'al</span> ${esc(v.paal_comparison)}</p>` : '')
      + `<ol class="exercises">${v.exercises.map((x) => `<li>${he('div', x.sentence, 'sentence')}<div class="cue">${esc(x.cue)}</div><details><summary>Answer</summary>${he('span', x.answer)}</details></li>`).join('')}</ol></div>`).join('') + '</section>');
  parts.push(sectionOpen('questions', 'שאלות הבנה — Comprehension Questions')
    + `<ol class="questions">${questions.items.map((q) => he('li', q)).join('')}</ol></section>`);
  parts.push(sectionOpen('expressions', 'ביטויים חשובים — Key Expressions')
    + expressions.items.map((x) => `<div class="expression"><div class="expr-head">${he('span', x.he, 'expr-he')}<span class="expr-en">${esc(x.en)}</span></div>${x.usage ? `<p class="note">${esc(x.usage)}</p>` : ''}${x.flags ? `<p class="flags">${esc(x.flags)}</p>` : ''}</div>`).join('') + '</section>');
  parts.push(sectionOpen('relevance', 'רלוונטיות מקצועית — Professional Relevance') + `<p class="prose">${esc(guide.relevance)}</p></section>`);
  return `<div class="guide" data-vocabulary="${vocab.rows.length}" data-paper="${paper.prompts.length}" data-drills="${esc(drills.verbs.map((v) => `${v.verb}|${v.binyan}`).join(','))}">${parts.join('\n')}</div>`;
}

// The last search, for the Articles page: when, what was tried, and why.
function last() {
  const h = db.lastHunt();
  return { hunt: h, left_out: LEFT_OUT, state: h ? 'ok' : 'no data' };
}

module.exports = { run, trial, makeGuide, last, verdict, pageKind, vocabFlags, redrawFlags, personsOf, futureGaps, PERSONS, shapeGuide, guideFailures, renderGuide, interleave, SOURCES, LEFT_OUT, MIN_WORDS, MAX_WORDS, CLOCK_LINES, MARKET_SHARE, RECENT_DAYS, isRunning: () => running };
