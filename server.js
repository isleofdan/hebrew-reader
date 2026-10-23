'use strict';
// The Hebrew reader: one plain Node server.
//   /login (GET, POST), /logout, /health  — open
//   everything else                        — behind the passphrase cookie
// Fail closed: with APP_PASSWORD or COOKIE_SECRET unset, only the login page
// serves, and it says the server is not configured.

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const auth = require('./lib/auth');
const db = require('./lib/db');
const articles = require('./lib/articles');
const lookup = require('./lib/lookup');
const demand = require('./lib/demand');
const askRefs = require('./lib/ask');
const lesson = require('./lib/lesson');
const guyLesson = require('./lib/guy-lesson');
const desk = require('./lib/desk');
const grow = require('./lib/grow');
const sheet = require('./lib/sheet');
const caught = require('./lib/catch');
const hunt = require('./lib/hunt');
const referencePages = require('./lib/reference-pages');
const lookupPage = require('./lib/lookup-page');
const english = require('./lib/english');
const today = require('./lib/today');
const walks = require('./lib/walks');
const library = require('./lib/library');
const speech = require('./lib/speech');
const { CATEGORIES } = require('./lib/categories');
const ratelimit = require('./lib/ratelimit');
const { sendJson, sendHtml, redirect, readJson, readFile, readBuffer, serveStatic } = require('./lib/http');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const { APP_PASSWORD, COOKIE_SECRET } = process.env;
const SECURE_COOKIE = process.env.COOKIE_INSECURE !== '1';
const CONFIGURED = Boolean(APP_PASSWORD && COOKIE_SECRET);

if (!CONFIGURED) {
  const missing = ['APP_PASSWORD', 'COOKIE_SECRET'].filter((k) => !process.env[k]);
  console.error(`not configured: ${missing.join(', ')} unset. Only the login page will serve.`);
}

const LOGIN_TEMPLATE = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(res, status, message = '', next = '') {
  sendHtml(res, status, LOGIN_TEMPLATE.replace('{{MESSAGE}}', escapeHtml(message)).replace('{{NEXT}}', escapeHtml(safeNext(next))));
}

// Where sign-in may send Dan back to: only a share on its way to the desk
// (session fourteen), so a share made while signed out is not lost.
function safeNext(next) {
  const n = String(next || '');
  return /^\/share(\/confirm)?(\?[^#]*)?$/.test(n) ? n : '';
}

// A share that did not come from the phone's own share sheet or this site
// (a link on another website): it is shown and saved only on a tap.
function fromAnotherSite(req) {
  const s = req.headers['sec-fetch-site'];
  return s === 'cross-site' || s === 'same-site';
}

const NOT_CONFIGURED = 'This server is not configured: APP_PASSWORD or COOKIE_SECRET is unset. Set both and restart.';

function wantsJson(req) {
  return (req.headers.accept || '').includes('application/json')
    || (req.headers['content-type'] || '').includes('application/json');
}

async function handleLogin(req, res) {
  if (!CONFIGURED) {
    return wantsJson(req) ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  }
  const wait = ratelimit.lockedFor(req);
  if (wait > 0) {
    const msg = `Too many wrong passphrases. Wait ${Math.ceil(wait / 60)} minute(s) and try again.`;
    return wantsJson(req) ? sendJson(res, 429, { error: msg, retry_after_s: wait }, { 'retry-after': String(wait) })
      : loginPage(res, 429, msg);
  }
  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  if (!auth.passwordOk(body.passphrase, APP_PASSWORD)) {
    ratelimit.recordFailure(req);
    const msg = `Wrong passphrase. ${ratelimit.MAX_ATTEMPTS} wrong tries in ${Math.round(ratelimit.WINDOW_MS / 60000)} minutes lock this address.`;
    return wantsJson(req) ? sendJson(res, 401, { error: msg }) : loginPage(res, 401, msg);
  }
  ratelimit.clear(req);
  const headers = { 'set-cookie': auth.issueCookie(COOKIE_SECRET, { secure: SECURE_COOKIE }) };
  return wantsJson(req) ? sendJson(res, 200, { ok: true }, headers) : redirect(res, safeNext(body.next) || '/', headers);
}

// Routes that need the cookie.
const api = [];
function route(method, pattern, run) { api.push({ method, pattern, run }); }

// --- the map against an article --------------------------------------------

// surface -> { spot_id, status, hint } for every surface the cards cache has
// a spot for. The client tints the words it finds. An article no card was
// ever opened in gets an empty map: every word plain, nothing said.
route('GET', /^\/marks-for-article\/(?<id>\d+)$/, (req, res, { id }) => {
  db.getArticle(id);
  const surfaces = db.marksForSurfaces();
  return sendJson(res, 200, { article_id: Number(id), surfaces, lemmas: db.marksForLemmas(), state: Object.keys(surfaces).length ? 'ok' : 'no data' });
});

// --- the card ---------------------------------------------------------------

// { surface, sentence, article_id | lesson_id } -> { card, spot, cached }.
// From the Look up page, { surface, origin: 'lookup' }: the same card, the
// word saved, and the search recorded on the card (lib/lookup-page.js); an
// English word there answers { mode: 'english', text, groups, at }
// (lib/english.js, hebrew-english-one).
route('POST', /^\/lookup$/, async (req, res) => {
  const body = await readJson(req);
  if (body.origin === 'lookup') return sendJson(res, 200, await lookupPage.search(body));
  const articleId = body.article_id ? Number(body.article_id) : null;
  if (articleId) db.getArticle(articleId);
  const lessonId = body.lesson_id ? Number(body.lesson_id) : null;
  if (lessonId) db.getLesson(lessonId);
  const answer = await lookup.lookup({ surface: body.surface, sentence: body.sentence, article_id: articleId, lesson_id: lessonId });
  return sendJson(res, 200, answer);
});

// { surface, sentence } of a card already looked up -> { pointed, called }:
// its nikud, added once to a card cached before cards carried it.
route('POST', /^\/lookup\/points$/, async (req, res) => sendJson(res, 200, await lookup.addPoints(await readJson(req))));
route('POST', /^\/lookup\/refresh$/, async (req, res) => sendJson(res, 200, await lookup.refreshCard(await readJson(req))));
// { surface, sentence, root, binyan } of a verb card already looked up ->
// { card, spot, spine, changed }: Dan's own root and binyan, saved and the
// card marked confirmed by him (a bad root or binyan answers 400 and why).
route('POST', /^\/lookup\/confirm$/, async (req, res) => sendJson(res, 200, await guyLesson.confirmCard(await readJson(req))));

route('GET', /^\/categories$/, (req, res) => sendJson(res, 200, { items: CATEGORIES, state: 'ok' }));

// --- spots (the map) --------------------------------------------------------

route('GET', /^\/spots$/, (req, res, g, url) => {
  const status = url.searchParams.get('status');
  return sendJson(res, 200, db.listSpots(status ? { status } : {}));
});

route('GET', /^\/spots\/(?<id>.+)$/, (req, res, { id }) => sendJson(res, 200, db.requireSpot(decodeURIComponent(id))));

// { status } -> the spot. Status must be one of new, shaky, solid.
route('POST', /^\/spots\/(?<id>.+)$/, async (req, res, { id }) => {
  const body = await readJson(req);
  return sendJson(res, 200, await lookupPage.saveStatus(decodeURIComponent(id), body.status));
});

// --- the demand (the phone page) --------------------------------------------

// One item: a sentence Dan has read with the verb blanked. ?after=<spot id>
// skips that spot. No item -> { state: "no data", reason }.
route('GET', /^\/demand$/, async (req, res, g, url) => {
  const after = url.searchParams.get('after') || null;
  return sendJson(res, 200, await demand.next({ after }));
});

// { spot_id, article_id, surface, typed } -> { ok, surface, card, spot, spine }
route('POST', /^\/demand\/check$/, async (req, res) => sendJson(res, 200, await demand.check(await readJson(req))));

// { spot_id, article_id, surface } -> { surface, card, spot, spine }
route('POST', /^\/demand\/show$/, async (req, res) => sendJson(res, 200, await demand.show(await readJson(req))));

// --- the ask surface --------------------------------------------------------

// { desk?, subject: { kind, … }, question, parent? } -> { id, answer, links,
// searches, state } (lib/ask.js); the Ask box's first shape { question,
// article_id? } is the article subject on the hebrew desk
route('POST', /^\/ask$/, async (req, res) => sendJson(res, 200, await askRefs.askRoute(await readJson(req))));

// --- make from recent reading -----------------------------------------------

// ?articles=<N, default 5>: a Markdown download of every spot touched two or
// more times across the N most recent articles; &format=json for the print page.
route('GET', /^\/make\/lesson$/, (req, res, g, url) => {
  const sheet = lesson.build(url.searchParams.get('articles'));
  if (url.searchParams.get('format') === 'json') return sendJson(res, 200, sheet);
  const md = lesson.markdown(sheet);
  const day = sheet.made_at.slice(0, 10);
  res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="lesson-sheet-${day}.md"`,
    'cache-control': 'no-store',
  });
  res.end(md);
  console.log(`lesson: ${sheet.count} word(s) from ${sheet.articles.length} article(s), as markdown`);
});

// --- articles ---------------------------------------------------------------

route('GET', /^\/articles$/, (req, res) => sendJson(res, 200, db.listArticles()));

route('GET', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, db.getArticle(id)));

// The article goes; its touches stay (without the article) and its spots keep
// their status. Nothing is sent to the spine.
route('DELETE', /^\/articles\/(?<id>\d+)$/, (req, res, { id }) => {
  const out = db.deleteArticle(id);
  console.log(`article ${id}: deleted (touches and spots kept)`);
  return sendJson(res, 200, out);
});

// { text } (pasted) or { url }. Answers the stored article plus `thin` when a
// url gave under 200 characters of main text and the raw page text was kept.
route('POST', /^\/articles$/, async (req, res) => {
  const body = await readJson(req);
  const hasText = typeof body.text === 'string' && body.text.trim() !== '';
  const hasUrl = typeof body.url === 'string' && body.url.trim() !== '';
  if (!hasText && !hasUrl) throw new db.ReaderError(400, 'Give either text (the pasted article) or url (its address).');
  const drafted = hasText ? articles.fromText(body.text) : await articles.fromUrl(body.url.trim());
  const stored = db.addArticle(drafted);
  console.log(`article ${stored.id}: "${stored.title}" (${stored.text.length} chars${drafted.thin ? ', thin' : ''}${stored.source_url ? ', from ' + stored.source_url : ', pasted'})`);
  return sendJson(res, 201, { ...stored, thin: drafted.thin });
});

// --- "Find an article" (the article hunt) --------------------------------------
// Runs only on Dan's tap. The answer is a stream of lines, one JSON object
// each: { progress } while it looks (repeated every 15 s so the connection
// stays open), then { done: true, article_id, guide } or { done: true,
// nothing }, or { done: true, error }. A tap that leaves before the end does
// not stop it: the article and its guide are stored all the same.
// ?trial=1 is the deploy's check: the same candidates, tests and model
// question as a tap, nothing stored; it answers one JSON object
// { status, model, line, tried } (tried: every candidate and why it was left).
route('POST', /^\/articles\/find$/, async (req, res, g, url) => {
  if (url.searchParams.get('trial') === '1') {
    const out = await hunt.trial();
    console.log(`hunt trial: ${out.status} ${out.line}`);
    return sendJson(res, out.status === 200 ? 200 : 502, out);
  }
  if (hunt.isRunning()) throw new db.ReaderError(409, 'Already looking for an article; wait for it to finish.');
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  let last = 'Starting…';
  const send = (o) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(o) + '\n'); };
  const beat = setInterval(() => send({ progress: last }), 15000);
  try {
    const out = await hunt.run({ progress: (line) => { last = line; send({ progress: line }); } });
    send(out.article ? { done: true, article_id: out.article.id, title: out.article.title, guide: out.guide } : { done: true, nothing: out.nothing });
  } catch (e) {
    if (e.status !== 409) console.error(e);
    send({ done: true, error: e.message });
  } finally {
    clearInterval(beat);
    res.end();
  }
});

// The last search: when, the candidates tried and why each was dropped, the
// last model call's status; and the sources left out.
route('GET', /^\/articles\/find\/last$/, (req, res) => sendJson(res, 200, hunt.last()));

// (Re)makes a found article's study guide: { ok, counts } or 502 and why.
route('POST', /^\/articles\/(?<id>\d+)\/guide$/, async (req, res, { id }) => {
  db.getArticle(id);
  const out = await hunt.makeGuide(Number(id));
  return sendJson(res, out.ok ? 200 : 502, out.ok ? out : { error: out.error });
});

// --- lessons from Guy ------------------------------------------------------

route('GET', /^\/lessons$/, (req, res) => sendJson(res, 200, db.listLessons()));

// A PDF as multipart/form-data, field "file", at most 5 MB. Answers 201 with
// the lesson and a note saying where its title and date came from; 200 with
// the lesson already stored when the same items were uploaded before.
route('POST', /^\/lessons$/, async (req, res) => {
  const { fileName, bytes } = await readFile(req, 'file', guyLesson.MAX_BYTES + 64 * 1024);
  const out = await guyLesson.add({ fileName, bytes });
  const { text, ...lessonOut } = out.lesson;
  return sendJson(res, out.created ? 201 : 200, { ...lessonOut, created: out.created, title_from: out.from || null, note: out.note });
});

// The lesson with its items, its guide when built, and the guide's state:
// none, building, built, or failed (with the one-line reason).
route('GET', /^\/lessons\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, guyLesson.view(id)));

// Builds the guide on first open; { rebuild: true } replaces the one there.
// The build runs in the background: 202 while it runs, 200 when the guide was
// already there and no rebuild was asked for.
// The lesson, its items and its guide go; its touches and spots stay.
route('DELETE', /^\/lessons\/(?<id>\d+)$/, (req, res, { id }) => {
  const out = guyLesson.remove(id);
  console.log(`lesson ${id}: deleted (touches and spots kept)`);
  return sendJson(res, 200, out);
});

route('POST', /^\/lessons\/(?<id>\d+)\/guide$/, async (req, res, { id }) => {
  const body = await readJson(req);
  const state = guyLesson.startGuide(id, { rebuild: body.rebuild === true || body.rebuild === 'true' });
  return sendJson(res, state === 'building' ? 202 : 200, guyLesson.view(id));
});

// { surface } -> one more lookup of a word the card could not identify; on
// success it is saved like the lesson's other words. Answers { surface,
// result, saved }; a second failure answers the card's own error.
route('POST', /^\/lessons\/(?<id>\d+)\/retry$/, async (req, res, { id }) => {
  const body = await readJson(req);
  return sendJson(res, 200, await guyLesson.retryWord(id, body.surface));
});

// The same surface map as an article's, for the lesson page's tints.
route('GET', /^\/marks-for-lesson\/(?<id>\d+)$/, (req, res, { id }) => {
  db.getLesson(id);
  const surfaces = db.marksForSurfaces();
  return sendJson(res, 200, { lesson_id: Number(id), surfaces, lemmas: db.marksForLemmas(), state: Object.keys(surfaces).length ? 'ok' : 'no data' });
});

// --- the desk ---------------------------------------------------------------
// Every write is saved as it happens; the page holds no copy of its own.

// The desk Dan last worked on (a new one, named for now, when there is none),
// with its cards read fresh from their own records.
route('GET', /^\/desks\/current$/, (req, res) => sendJson(res, 200, desk.current()));
// Every desk, newest touched first, with the shapes for its small drawing.
route('GET', /^\/desks$/, (req, res) => sendJson(res, 200, desk.list()));
route('POST', /^\/desks$/, (req, res) => sendJson(res, 201, desk.newDesk()));
// ?q= : cards and desks that match, Hebrew compared without nikud.
// &source= everything | guy | articles | online | notes | asked; &time= month | year | any
route('GET', /^\/desks\/find$/, (req, res, g, url) => sendJson(res, 200, desk.find(url.searchParams.get('q') || '', {
  source: url.searchParams.get('source') || 'everything', time: url.searchParams.get('time') || 'any',
})));
// The one past desk shown small in a corner: { desk } or { desk: null, state: "no data" }.
route('GET', /^\/desks\/past$/, (req, res) => sendJson(res, 200, desk.pastDesk()));
// { surface, sentence } of a card on screen (or { card_id }) -> onto the current desk, once.
route('POST', /^\/desks\/put$/, async (req, res) => {
  const out = desk.put(await readJson(req));
  return sendJson(res, out.already ? 200 : 201, out);
});
route('GET', /^\/desks\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, desk.view(Number(id))));
// Opened: it is the current desk again.
route('POST', /^\/desks\/(?<id>\d+)\/open$/, (req, res, { id }) => sendJson(res, 200, desk.open(Number(id))));
// { name }
route('PATCH', /^\/desks\/(?<id>\d+)$/, async (req, res, { id }) => sendJson(res, 200, desk.rename(Number(id), (await readJson(req)).name)));
// { card: "word:<id>" | "note:<id>", x?, y?, w?, h?, near?, unplaced? }
route('POST', /^\/desks\/(?<id>\d+)\/cards$/, async (req, res, { id }) => {
  const body = await readJson(req);
  const out = desk.place(Number(id), body.card, body);
  return sendJson(res, out.already ? 200 : 201, out);
});
// { x?, y?, w?, h?, front? }
route('PATCH', /^\/desks\/(?<id>\d+)\/cards\/(?<key>[a-z]+:\d+)$/, async (req, res, { id, key }) => sendJson(res, 200, { place: desk.move(Number(id), key, await readJson(req)) }));
route('DELETE', /^\/desks\/(?<id>\d+)\/cards\/(?<key>[a-z]+:\d+)$/, (req, res, { id, key }) => sendJson(res, 200, desk.unplace(Number(id), key)));
// { text, desk_id?, born_from?, unplaced? } -> a new note card on a desk
route('POST', /^\/notes$/, async (req, res) => {
  const out = desk.addNote(await readJson(req));
  caught.later(out.card.key, out.fetch);
  return sendJson(res, 201, out);
});
// { text }; a text that is only a web address gets its page's title, fetched afterwards
route('PATCH', /^\/notes\/(?<id>\d+)$/, async (req, res, { id }) => {
  const out = desk.editNote(Number(id), (await readJson(req)).text);
  caught.later(out.key, out.fetch);
  return sendJson(res, 200, out);
});
// Catching a card on the phone: { text?, url?, title? } shared from another
// app -> a note card on the desk worked on last, not yet placed.
route('POST', /^\/desks\/catch$/, async (req, res) => {
  // Chrome's doubled address (plain, and with the selection coded in) kept once
  const out = desk.catchCard(caught.share(await readJson(req)));
  caught.later(out.card.key, out.fetch);
  return sendJson(res, 201, out);
});
// "Sheet for the reMarkable": one sheet made from this desk, its prompts
// asked of the model now; the desk records that it was made.
route('POST', /^\/desks\/(?<id>\d+)\/sheets$/, async (req, res, { id }) => sendJson(res, 201, await sheet.make(Number(id))));
route('GET', /^\/sheets\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, sheet.view(Number(id))));

// --- a card, opened (session thirteen) ---------------------------------------
// A card's full view with its layers; each action saves as it happens. The
// model calls (ask, examples) run only when Dan presses them.
const CARD = '(?<key>[a-z]+:\\d+)';
route('GET', new RegExp(`^/card/${CARD}$`), (req, res, { key }) => sendJson(res, 200, desk.full(key)));
// { text } -> a note that is a layer of this card
route('POST', new RegExp(`^/card/${CARD}/notes$`), async (req, res, { key }) => sendJson(res, 201, { layer: desk.noteLayer(key, (await readJson(req)).text) }));
// { question } -> { layer, ask_id, searches }, through the ask surface; an
// answer with no link answers 422 and why
route('POST', new RegExp(`^/card/${CARD}/ask$`), async (req, res, { key }) => sendJson(res, 201, await askRefs.askCard(key, await readJson(req))));
// -> { added, refused, already, found, searches }
route('POST', new RegExp(`^/card/${CARD}/examples$`), async (req, res, { key }) => sendJson(res, 200, await grow.findExamples(key)));
// on an example: { kept: true | false }
route('POST', new RegExp(`^/card/${CARD}/keep$`), async (req, res, { key }) => sendJson(res, 200, { layer: desk.keepExample(key, (await readJson(req)).kept) }));
// { reference, origin? } -> { layer, url }: the page to open, and the lookup
// recorded; origin 'desk' (a card's row, the default) or 'lookup' (the Look up page's tabs)
route('POST', new RegExp(`^/card/${CARD}/lookup$`), async (req, res, { key }) => {
  const body = await readJson(req);
  const layer = desk.lookupLayer(key, body.reference, { origin: body.origin || 'desk' });
  return sendJson(res, 201, { layer, url: layer.url });
});
// on a card or a layer: { desk_id?, unplaced? } -> a new note card beside the card
route('POST', new RegExp(`^/card/${CARD}/branch$`), async (req, res, { key }) => sendJson(res, 201, desk.branch(key, await readJson(req))));
// Ink: { points: [[x, y, pressure?], ...] } -> { layer, stroke }, one stroke saved as it ends
route('POST', new RegExp(`^/card/${CARD}/ink$`), async (req, res, { key }) => sendJson(res, 201, desk.addStroke(key, (await readJson(req)).points)));
// "undo last stroke" -> { layer (null when no stroke is left), removed }
route('DELETE', new RegExp(`^/card/${CARD}/ink/last$`), (req, res, { key }) => sendJson(res, 200, desk.undoStroke(key)));
// "link these": { to: <another card>, sentence } -> { link }
route('POST', new RegExp(`^/card/${CARD}/link$`), async (req, res, { key }) => {
  const body = await readJson(req);
  return sendJson(res, 201, desk.link(key, body.to, body.sentence));
});
// { at: <a layer of this card>, desk_id?, unplaced? }
route('POST', new RegExp(`^/card/${CARD}/cut$`), async (req, res, { key }) => {
  const body = await readJson(req);
  return sendJson(res, 201, desk.cut(key, body.at, body));
});

// --- a reference shown inside the reader (hebrew-lookup-one) ------------------
// ?term=<word> -> { mode: 'frame', url } | { mode: 'copy', html, fetched_at, url }
// | { mode: 'failed', url, reason }. A copy is fetched only here, on Dan's tap.
// The Look up page's "Looked up" list: ?limit=200&before=<time>&before_key=<card> -> { items, more, next, next_key }
route('GET', /^\/lookups$/, (req, res, g, url) => sendJson(res, 200, lookupPage.list({ limit: url.searchParams.get('limit'), before: url.searchParams.get('before'), before_key: url.searchParams.get('before_key') })));
route('GET', /^\/reference\/(?<id>[a-z]+)$/, async (req, res, { id }, url) => sendJson(res, 200, await referencePages.pane(id, url.searchParams.get('term'))));
// hebrew-english-one: an English look-up reopened from "Looked up" (its kept
// answer, no site asked), and a row's source label shown inside the page
route('GET', /^\/english$/, (req, res, g, url) => sendJson(res, 200, english.kept(url.searchParams.get('text'))));
route('GET', /^\/english\/entry$/, async (req, res, g, url) => sendJson(res, 200, await english.entry({ site: url.searchParams.get('site'), path: url.searchParams.get('path'), page: url.searchParams.get('page') })));

// --- speech on the Look up page (hebrew-speech-one) -----------------------------
// The raw recording (audio/webm, audio/ogg, audio/mp4 or audio/wav, at most
// 2 MB), ?ms=<its length> -> { id, text, ms } (lib/speech.js), or { id: null,
// text: '', message } when nothing was heard. The page then looks the text
// up as typed text and attaches the recording to the row the look-up made.
route('POST', /^\/lookup\/speech$/, async (req, res, g, url) => {
  const type = speech.typeOf(req.headers['content-type']);
  const tooLong = () => new db.ReaderError(413, speech.TOO_LONG);
  if (Number(req.headers['content-length']) > speech.MAX_BYTES) throw tooLong();
  let bytes;
  try { bytes = await readBuffer(req, speech.MAX_BYTES); } catch (e) { throw e.status === 413 ? tooLong() : e; }
  return sendJson(res, 200, await speech.hear(bytes, type, { ms: url.searchParams.get('ms') }));
});
// { row_key } -> { id, row_key }; once only (409 on an attached recording)
route('POST', /^\/recordings\/(?<id>\d+)\/attach$/, async (req, res, { id }) => sendJson(res, 200, speech.attach(id, (await readJson(req)).row_key)));
// the file, with its type; a Range request answers 206
route('GET', /^\/recordings\/(?<id>\d+)$/, (req, res, { id }) => speech.serve(req, res, id));
route('DELETE', /^\/recordings\/(?<id>\d+)$/, (req, res, { id }) => sendJson(res, 200, speech.remove(id)));

// --- Today (hebrew-today-one) --------------------------------------------------
// The day's drills. GET /today is the page (a page route: signed out, it
// redirects to /login); its data is here, under /today/.
// -> the set being served (made first when there is none): { state, set,
// items, position, done, ... } or { state: "no data", reason }
route('GET', /^\/today\/set$/, async (req, res) => sendJson(res, 200, await today.current()));
// { set_id, item_index, result: right | wrong, answer? } -> { result, flash, spot, spine, view }
route('POST', /^\/today\/answer$/, async (req, res) => sendJson(res, 200, await today.answer(await readJson(req))));
// { set_id, item_index } -> what Show reveals; the show is recorded
route('POST', /^\/today\/show$/, async (req, res) => sendJson(res, 200, await today.show(await readJson(req))));
// "Too easy": { set_id, item_index } -> the word marked solid (through the save), the tap recorded like an answer
route('POST', /^\/today\/easy$/, async (req, res) => sendJson(res, 200, await today.tooEasy(await readJson(req))));
// { set_id, answer_id? } -> the set's last answer undone, its word put back
route('POST', /^\/today\/undo$/, async (req, res) => sendJson(res, 200, await today.undo(await readJson(req))));
// "Another set" (hebrew-today-two): {} -> a new set, as GET /today/set gives
// it, opened at item 1; or { state: "no data", reason }
route('POST', /^\/today\/another$/, async (req, res) => sendJson(res, 200, await today.another()));

// --- Walks (hebrew-walks-one) ---------------------------------------------------
// Walks with the guide to Jewish thought. GET /walks and GET /walks/<id> are
// the pages (signed out, they redirect to /login); the data is here, under
// /walks/, never at a bare number. A model call runs only on Start, a
// direction or Go.
// A stop that fails answers its failure line and the walk as it stands
// ({ error, walk }), so the page keeps the earlier stops.
async function walkMove(res, run) {
  try {
    return sendJson(res, 200, await run());
  } catch (e) {
    if (!e.walk_id) throw e;
    return sendJson(res, e.status || 500, { error: e.message, walk: walks.get(e.walk_id) });
  }
}
// -> { items: [{ id, title, started_at, stops }], state }, newest first
route('GET', /^\/walks\/list$/, (req, res) => sendJson(res, 200, walks.list()));
// { question } or { ref } -> the walk with its first stop (or `declined`)
// A stop is made in the background and the walk answered at once, marked
// pending; ?wait=1 waits for it (the checks)
const waits = (req) => new URL(req.url, 'http://x').searchParams.get('wait') === '1';
route('POST', /^\/walks\/start$/, async (req, res) => walkMove(res, async () => walks.start(await readJson(req), { wait: waits(req) })));
// -> the walk with its stops, oldest first, each with its passage
route('GET', /^\/walks\/(?<id>[^/]+)\/stops$/, (req, res, { id }) => sendJson(res, 200, walks.get(id)));
// { pick: <index of an offered direction> } or { text } -> the walk with its new stop (or `declined`)
route('POST', /^\/walks\/(?<id>[^/]+)\/step$/, async (req, res, { id }) => walkMove(res, async () => walks.step(id, await readJson(req), { wait: waits(req) })));

// --- Study (hebrew-study-one) -----------------------------------------------------
// The library from Sefaria (lib/library.js). GET /study and GET /study/<page>
// (Sefaria's address form: /study/Genesis.1, /study/Berakhot.2a) are the
// pages; the data is under /study/data/. Nothing here calls a model.
// -> { tanakh, talmud }: each { label, groups: [{ name, books }] } in Sefaria's order
route('GET', /^\/study\/data\/contents$/, async (req, res) => sendJson(res, 200, await library.contents()));
// -> { day, daf, portion }: today's Daf Yomi in Tokyo and the week's portion
route('GET', /^\/study\/data\/today$/, async (req, res) => sendJson(res, 200, await library.today()));
// -> { items: [{ book, ref, path, opened_at }] }, newest first
route('GET', /^\/study\/data\/places$/, (req, res) => sendJson(res, 200, library.places()));
// -> the page, uncut: { ref, title, lines: [{ ref, he, en }], prev, next, … };
// opening it writes Dan's place in its book
route('GET', /^\/study\/data\/page\/(?<ref>.+)$/, async (req, res, { ref }) => {
  let r;
  try { r = decodeURIComponent(ref); } catch { throw new db.ReaderError(400, `"${ref}" is not a page; a page is a book and its place, such as Genesis.1 or Berakhot.2a.`); }
  return sendJson(res, 200, await library.open(r));
});

const GUIDE_TEMPLATE =fs.readFileSync(path.join(PUBLIC, 'guide.html'), 'utf8');
function guidePage(res, id) {
  let article;
  try { article = db.getArticle(id); } catch (e) { return sendHtml(res, 404, GUIDE_TEMPLATE.replace('{{TITLE}}', 'Study guide').replace('{{BACK}}', '/').replace('{{BODY}}', `<p class="empty">${escapeHtml(e.message)}</p>`)); }
  const html = db.articleGuide(id);
  const body = (html && hunt.redrawFlags(html)) || '<p class="empty">This article has no study guide yet.</p>';
  return sendHtml(res, 200, GUIDE_TEMPLATE.replace('{{TITLE}}', () => `Study guide — ${escapeHtml(article.title)}`).replace('{{BACK}}', `/read.html?id=${id}`).replace('{{BODY}}', () => body));
}

function isApiPath(p) {
  return /^\/(articles|lookup|spots|marks-for-article|marks-for-lesson|categories|demand|ask|make|lessons|desks|notes|card|sheets|reference|lookups|english|recordings)(\/|$)/.test(p);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return sendJson(res, 200, { ok: true, configured: CONFIGURED });
  if (p === '/login' && req.method === 'GET') return loginPage(res, CONFIGURED ? 200 : 503, CONFIGURED ? '' : NOT_CONFIGURED, url.searchParams.get('next'));
  if (p === '/login' && req.method === 'POST') return handleLogin(req, res);
  if (p === '/logout') return redirect(res, '/login', { 'set-cookie': auth.clearCookie({ secure: SECURE_COOKIE }) });
  // what makes the phone page installable: fetched by the browser without the
  // cookie, and holding nothing of Dan's
  if (['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png'].includes(p)) {
    return serveStatic(res, PUBLIC, p) || sendJson(res, 404, { error: `${p} is missing.` });
  }

  // GET /lookup is the Look up page; POST /lookup the card. /today is a
  // page; what is under it (/today/set, …) is its data. /walks and
  // /walks/<id> are pages; everything else under /walks/ is data
  const walkPage = p === '/walks' || /^\/walks\/\d+$/.test(p);
  // /study and /study/<page> are pages; /study/data/… is their data
  const studyPage = p === '/study' || (p.startsWith('/study/') && !p.startsWith('/study/data/'));
  const apiPath = (isApiPath(p) && !(p === '/lookup' && req.method === 'GET')) || p.startsWith('/today/') || (p.startsWith('/walks/') && !walkPage) || p.startsWith('/study/data/');
  if (!CONFIGURED) return apiPath ? sendJson(res, 503, { error: NOT_CONFIGURED }) : loginPage(res, 503, NOT_CONFIGURED);
  if (!auth.cookieOk(req, COOKIE_SECRET)) {
    if (p === '/share' || p === '/share/confirm') {
      const back = `${p === '/share' && !fromAnotherSite(req) ? '/share' : '/share/confirm'}${url.search}`;
      return redirect(res, `/login?next=${encodeURIComponent(back)}`);
    }
    return apiPath ? sendJson(res, 401, { error: 'Sign in first: POST /login with the passphrase.' }) : redirect(res, '/login');
  }

  for (const route of api) {
    const m = route.method === req.method && route.pattern.exec(p);
    if (m) {
      try {
        return await route.run(req, res, m.groups || {}, url);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        return sendJson(res, status, { error: e.message });
      }
    }
  }

  if (apiPath) return sendJson(res, 404, { error: `No route ${req.method} ${p}.` });
  if (p === '/') return serveStatic(res, PUBLIC, '/index.html') || sendJson(res, 404, { error: 'index.html is missing.' });
  if (p === '/login.html') return redirect(res, '/login');
  if (p === '/phone') return serveStatic(res, PUBLIC, '/phone.html') || sendJson(res, 404, { error: 'phone.html is missing.' });
  if (p === '/lookup') return serveStatic(res, PUBLIC, '/lookup.html') || sendJson(res, 404, { error: 'lookup.html is missing.' });
  if (p === '/today') {
    // the day's set is made now if it is not there yet; the page's own
    // GET /today/set waits for the same build
    today.ensureSet().catch((e) => console.error(`today: the day's set could not be made: ${e.message}`));
    return serveStatic(res, PUBLIC, '/today.html') || sendJson(res, 404, { error: 'today.html is missing.' });
  }
  if (walkPage) return serveStatic(res, PUBLIC, '/walks.html') || sendJson(res, 404, { error: 'walks.html is missing.' });
  if (studyPage && req.method === 'GET') return serveStatic(res, PUBLIC, '/study.html') || sendJson(res, 404, { error: 'study.html is missing.' });
  // /share is where the installed app receives what another app shares; the
  // desk page saves it (a GET here writes nothing)
  if (p === '/share' && fromAnotherSite(req)) return redirect(res, `/share/confirm${url.search}`);
  if (p === '/desk' || p === '/share' || p === '/share/confirm') return serveStatic(res, PUBLIC, '/desk.html') || sendJson(res, 404, { error: 'desk.html is missing.' });
  // an article's study guide, as a page of its own
  const guideMatch = /^\/guide\/(\d+)$/.exec(p);
  if (guideMatch) return guidePage(res, Number(guideMatch[1]));
  if (/^\/desk\/sheet\/\d+$/.test(p)) return serveStatic(res, PUBLIC, '/desk-sheet.html') || sendJson(res, 404, { error: 'desk-sheet.html is missing.' });
  if (serveStatic(res, PUBLIC, p)) return;
  return sendJson(res, 404, { error: `Nothing at ${p}.` });
}

db.open(DATA_DIR);
console.log(`database: ${path.join(DATA_DIR, 'reader.db')}`);
// recordings under DATA_DIR/recordings/; those never attached, past seven days, go
speech.init(DATA_DIR);
// one-time steps on the data; each is recorded and never runs twice
// one after the other: the second undoes one card of the first
guyLesson.restoreContradicted().catch((e) => console.error(`one-time step failed, to be tried at the next start: ${e.message}`))
  .then(() => guyLesson.confirmZinek()).catch((e) => console.error(`one-time step failed, to be tried at the next start: ${e.message}`))
  .then(() => guyLesson.redateLessons()).catch((e) => console.error(`one-time step failed, to be tried at the next start: ${e.message}`))
  .then(() => guyLesson.remakeShotetut()).catch((e) => console.error(`one-time step failed, to be tried at the next start: ${e.message}`));

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error.' });
  });
});

server.listen(PORT, () => console.log(`hebrew-reader listening on ${PORT}${CONFIGURED ? '' : ' (NOT CONFIGURED)'}`));
// Today's set is made at 05:00 Tokyo by this process (a timeout chain, never
// a cron on the machine), so the page opens at once
if (CONFIGURED) today.startScheduler();

module.exports = { api };
