'use strict';
// Study: the library itself, from Sefaria (hebrew-study-one). Beside the
// question-led walks, a way into the texts by their own order: the contents
// of the Tanakh and of the Babylonian Talmud, today's Daf Yomi, one page at a
// time (a chapter, or one side of a daf), and Dan's place in each book. The
// structure and every line come from Sefaria and are kept; nothing here is
// typed by hand and nothing here calls a model.
//
// Sefaria's interfaces used (developers.sefaria.org; sizes measured 22 Oct
// 2026 from the build machine):
//   GET /api/shape/Tanakh     9 KB: the 39 books in Sefaria's order, each
//                             { title, heTitle, section (Torah, Prophets,
//                             Writings), length (its chapters), chapters
//                             (verses per chapter) }
//   GET /api/shape/Bavli      26 KB: the 37 tractates in Sefaria's order, each
//                             { title, heTitle, section ("Seder Zeraim", …),
//                             length, chapters }; for a tractate `length` and
//                             `chapters` count daf sides from 1a (index 0 = 1a,
//                             1 = 1b, 2 = 2a, …), 0 lines for a side with no
//                             text: Berakhot 127 sides, 1a and 1b empty, so
//                             2a to 64a; Tamid begins at 25b
//   (the whole-library GET /api/index is 4.0 MB and gives no lengths; the
//   per-book GET /api/v2/index/<title> gives `schema.lengths` but is 14–16 KB
//   a book, 76 calls: the two shapes answer both at 35 KB together)
//   GET /api/calendars?timezone=Asia/Tokyo&year=&month=&day=
//                             `calendar_items`, each { title.en, displayValue
//                             .en/.he, ref }: "Daf Yomi" (a whole daf,
//                             "Bekhorot 34") and "Parashat Hashavua" (the
//                             week's Torah portion, "Genesis 12:1-17:27")
//   GET /api/v3/texts/<ref>?version=hebrew&version=english (lib/sefaria.js)
//                             one page: `ref`, `heRef`, `versions[].text` (a
//                             list of lines), `next` and `prev` (null at the
//                             end and the start of a book: the next book's
//                             first page then comes from the contents)
// What is fetched is kept (lib/db.js): the contents by corpus, refreshed by
// the first request more than 30 days after they were fetched; each page
// once, never fetched again; the calendar by its Tokyo day. Sefaria down: a
// kept copy is served; with none, 502 "Sefaria could not be reached".

const db = require('./db');
const { ReaderError } = db;
const sefaria = require('./sefaria');
const refs = require('./references');

const REFRESH_MS = 30 * 24 * 3600 * 1000;
const TZ = 'Asia/Tokyo';
const CORPORA = {
  Tanakh: { id: 'Tanakh', label: 'Tanakh', path: '/api/shape/Tanakh' },
  Bavli: { id: 'Bavli', label: 'Talmud', path: '/api/shape/Bavli' },
};

// The checks set the clock (the 30-day refresh, the Tokyo day).
let clock = () => Date.now();
function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }
const nowIso = () => new Date(clock()).toISOString();

// A daf side by its place in Sefaria's count: 0 -> 1a, 1 -> 1b, 2 -> 2a.
const sideOf = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`;
const indexOf = (daf, side) => (daf - 1) * 2 + (side === 'b' ? 1 : 0);

// A /study address for a page reference: "Genesis 1" -> /study/Genesis.1,
// "I Samuel 3" -> /study/I_Samuel.3 (the sefaria.org address rule).
const studyPath = (ref) => `/study/${refs.passagePath(ref)}`;

// --- the contents ------------------------------------------------------------------

// Sefaria's shape as the books kept: a Tanakh book with its chapters, a
// tractate with its first and last side and the sides between with no text.
function readShape(corpus, body) {
  if (!Array.isArray(body)) return [];
  const out = [];
  for (const b of body) {
    if (!b || typeof b.title !== 'string' || !Number.isInteger(b.length) || b.length <= 0) continue;
    const book = { title: b.title, he: typeof b.heTitle === 'string' ? b.heTitle : '', group: typeof b.section === 'string' ? b.section : '' };
    if (corpus === 'Tanakh') {
      out.push({ ...book, chapters: b.length });
      continue;
    }
    const sides = Array.isArray(b.chapters) ? b.chapters.slice(0, b.length) : [];
    const first = sides.findIndex((n) => n > 0);
    if (first < 0) continue;
    let last = sides.length - 1;
    while (last > first && !(sides[last] > 0)) last--;
    const missing = [];
    for (let i = first; i <= last; i++) if (!(sides[i] > 0)) missing.push(sideOf(i));
    out.push({ ...book, first: sideOf(first), last: sideOf(last), missing });
  }
  return out;
}

const running = new Map(); // what is being fetched -> its promise, so two asks make one fetch
function once(key, run) {
  if (!running.has(key)) running.set(key, run().finally(() => running.delete(key)));
  return running.get(key);
}

// One corpus's books: kept, or fetched (first time, or kept more than 30
// days); a failed refresh serves the kept copy.
async function corpusBooks(id) {
  const c = CORPORA[id];
  const kept = db.getContents(id);
  if (kept && clock() - Date.parse(kept.fetched_at) < REFRESH_MS) return kept;
  return once(`contents:${id}`, async () => {
    try {
      const t0 = Date.now();
      const { status, body } = await sefaria.getJson(c.path);
      if (status !== 200) throw new ReaderError(502, `${sefaria.UNREACHABLE} (it answered ${status}).`);
      const books = readShape(id, body);
      if (!books.length) throw new ReaderError(502, `${sefaria.UNREACHABLE} (its contents of the ${c.label} had no books).`);
      const row = db.putContents(id, books, nowIso());
      console.log(`library: the ${c.label}'s contents, ${books.length} books, fetched in ${Date.now() - t0} ms${kept ? ' (refreshed)' : ''}, kept`);
      return row;
    } catch (e) {
      if (kept) {
        console.log(`library: the ${c.label}'s contents could not be refreshed (${e.message}); the kept copy served`);
        return kept;
      }
      throw e;
    }
  });
}

// Books in groups, in Sefaria's order.
function grouped(books) {
  const groups = [];
  for (const b of books) {
    if (!groups.length || groups.at(-1).name !== b.group) groups.push({ name: b.group, books: [] });
    groups.at(-1).books.push(b);
  }
  return groups;
}

// GET /study/data/contents
async function contents() {
  const tanakh = await corpusBooks('Tanakh');
  const bavli = await corpusBooks('Bavli');
  return {
    tanakh: { label: 'Tanakh', groups: grouped(tanakh.books), fetched_at: tanakh.fetched_at },
    talmud: { label: 'Talmud', groups: grouped(bavli.books), fetched_at: bavli.fetched_at },
    state: 'ok',
  };
}

// --- finding a page -----------------------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function findBook(name, all) {
  const n = norm(name);
  return all.find((b) => norm(b.title) === n) || null;
}

function bookList(all) {
  const t = all.filter((b) => b.corpus === 'Tanakh').map((b) => b.title);
  const v = all.filter((b) => b.corpus === 'Bavli').map((b) => b.title);
  return `The Tanakh's books are ${t.join(', ')}; the Talmud's tractates are ${v.join(', ')}.`;
}

const rangeOf = (b) => (b.corpus === 'Tanakh' ? `${b.title} has chapters 1 to ${b.chapters}` : `${b.title} has pages ${b.first} to ${b.last}`);

// "Genesis.1", "Genesis 1", "I_Samuel.3", "Berakhot.2a", "Bekhorot 34" ->
// { book, ref } with `ref` the page's canonical reference ("Bekhorot 34a":
// a whole daf opens at its first side). A book, chapter or page outside the
// library answers 400 or 404 naming what is valid.
function locateIn(raw, all) {
  const t = sefaria.cleanRef(String(raw || '').replace(/_/g, ' '));
  const m = /^(.+?)[\s.:]+(\d+)([ab])?$/i.exec(t);
  const book = findBook(m ? m[1] : t, all);
  if (!book) throw new ReaderError(404, `There is no book named "${m ? m[1] : t}" in the Tanakh or the Talmud. ${bookList(all)}`);
  if (!m) throw new ReaderError(400, `A page is a book and its place: ${rangeOf(book)}.`);
  const n = Number(m[2]);
  if (book.corpus === 'Tanakh') {
    if (m[3]) throw new ReaderError(400, `${book.title} is read by chapter: ${rangeOf(book)}.`);
    if (n < 1 || n > book.chapters) throw new ReaderError(404, `${rangeOf(book)}; there is no chapter ${n}.`);
    return { book, ref: `${book.title} ${n}` };
  }
  const side = (m[3] || 'a').toLowerCase();
  const label = `${n}${side}`;
  const at = indexOf(n, side), first = indexOf(parseInt(book.first, 10), book.first.slice(-1)), last = indexOf(parseInt(book.last, 10), book.last.slice(-1));
  if (n < 1 || at < first || at > last) throw new ReaderError(404, `${rangeOf(book)}; there is no page ${label}.`);
  if (book.missing.includes(label)) throw new ReaderError(404, `Sefaria has no text for ${book.title} ${label}; ${rangeOf(book)}.`);
  return { book, ref: `${book.title} ${label}` };
}

async function allBooks() {
  const tanakh = await corpusBooks('Tanakh');
  const bavli = await corpusBooks('Bavli');
  return [...tanakh.books.map((b) => ({ ...b, corpus: 'Tanakh' })), ...bavli.books.map((b) => ({ ...b, corpus: 'Bavli' }))];
}

// The books as kept, with no request (null when the contents were never fetched).
function keptBooks() {
  const tanakh = db.getContents('Tanakh'), bavli = db.getContents('Bavli');
  if (!tanakh || !bavli) return null;
  return [...tanakh.books.map((b) => ({ ...b, corpus: 'Tanakh' })), ...bavli.books.map((b) => ({ ...b, corpus: 'Bavli' }))];
}

// The page holding a reference's first line: "Genesis 12:1-17:27" -> Genesis
// 12, "Shabbat 112b:3-5" -> Shabbat 112b, "Bekhorot 34" -> Bekhorot 34a; null
// for a text outside the Tanakh and the Talmud. From the kept contents only
// (reading a walk asks Sefaria nothing): before the contents were ever
// fetched, which books are in the library is not known, so null too — the
// walk stop then shows "Full passage" alone until Study is first opened.
function pageHolding(ref) {
  const first = String(ref || '').split('-')[0].trim().replace(/:\d+$/, '');
  const all = keptBooks();
  if (!all) return null;
  try { return locateIn(first, all).ref; } catch { return null; }
}

// --- a page ---------------------------------------------------------------------------

// The page after the last of a book, and before the first: the next book's
// first page and the previous book's last, in Sefaria's order, never across
// from the Tanakh into the Talmud.
function neighbour(book, all, step) {
  const same = all.filter((b) => b.corpus === book.corpus);
  const i = same.findIndex((b) => b.title === book.title) + step;
  const b = same[i];
  if (!b) return null;
  if (b.corpus === 'Tanakh') return `${b.title} ${step > 0 ? 1 : b.chapters}`;
  return `${b.title} ${step > 0 ? b.first : b.last}`;
}

async function fetchPage(where, all) {
  return once(`page:${where.ref}`, async () => {
    const t0 = Date.now();
    const { status, body } = await sefaria.getJson(sefaria.textPath(where.ref));
    const said = body && typeof body.error === 'string' ? body.error.trim() : '';
    if (status === 404 || status === 400 || (status === 200 && said)) {
      throw new ReaderError(404, `Sefaria does not know the page "${where.ref}"${said ? ` (${said})` : ''}. ${rangeOf(where.book)}.`);
    }
    if (status !== 200 || !body || typeof body.ref !== 'string') throw new ReaderError(502, `${sefaria.UNREACHABLE} (it answered ${status}).`);
    const ref = body.ref.trim();
    const version = (lang) => {
      const v = (body.versions || []).find((x) => x && x.language === lang);
      return v ? sefaria.segments(v.text).map(sefaria.plain) : [];
    };
    const he = version('he'), en = version('en');
    const lines = [];
    for (let i = 0; i < Math.max(he.length, en.length); i++) {
      if (he[i] || en[i]) lines.push({ ref: `${ref}:${i + 1}`, he: he[i] || '', en: en[i] || '' });
    }
    if (!lines.length) throw new ReaderError(404, `Sefaria has no Hebrew or English text for "${ref}". ${rangeOf(where.book)}.`);
    const next = typeof body.next === 'string' && body.next ? body.next : neighbour(where.book, all, 1);
    const prev = typeof body.prev === 'string' && body.prev ? body.prev : neighbour(where.book, all, -1);
    const row = db.putLibraryPage({ ref, book: where.book.title, title: ref, he_title: typeof body.heRef === 'string' ? body.heRef : '', lines, prev, next }, nowIso());
    console.log(`library: "${where.ref}" fetched in ${Date.now() - t0} ms, ${lines.length} lines, kept`);
    return row;
  });
}

const link = (ref) => (ref ? { ref, path: studyPath(ref) } : null);

function shapePage(row, book) {
  return {
    ref: row.ref, book: row.book, corpus: book.corpus === 'Tanakh' ? 'Tanakh' : 'Talmud', title: row.title, he_title: row.he_title || '',
    lines: row.lines, prev: link(row.prev), next: link(row.next), url: refs.byId('sefaria').passage(row.ref),
    contents: `/study?book=${encodeURIComponent(row.book)}`, fetched_at: row.fetched_at, state: 'ok',
  };
}

// page(ref): one chapter or one daf side, uncut, from the record or fetched
// once. Writes nothing of Dan's.
async function page(raw) {
  const all = await allBooks();
  const where = locateIn(raw, all);
  const row = db.getLibraryPage(where.ref) || await fetchPage(where, all);
  return shapePage(row, where.book);
}

// GET /study/data/page/<ref>: the page, and Dan's place in its book written
// (the one thing that writes a place).
async function open(raw) {
  const p = await page(raw);
  db.setPlace(p.book, p.ref, nowIso());
  return p;
}

// --- places --------------------------------------------------------------------------

// GET /study/data/places: the page last opened in each book, newest first.
function places() {
  const items = db.listPlaces().map((r) => ({ book: r.book, ref: r.ref, path: studyPath(r.ref), opened_at: r.opened_at }));
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- today ----------------------------------------------------------------------------

const tokyoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

const itemNamed = (items, name) => items.find((it) => it && it.title && it.title.en === name && typeof it.ref === 'string' && it.ref) || null;
const named = (it) => ({ ref: it.ref.trim(), name: (it.displayValue && it.displayValue.en) || it.ref, he_name: (it.displayValue && it.displayValue.he) || '' });

// A calendar entry as the page links it: to its Study page when it lies in
// the Tanakh or the Talmud, otherwise to its page on sefaria.org.
function placeOf(entry, all) {
  if (!entry) return null;
  let study = null;
  try { study = studyPath(locateIn(entry.ref.split('-')[0].trim().replace(/:\d+$/, ''), all).ref); } catch { study = null; }
  return { ...entry, study, url: refs.byId('sefaria').passage(entry.ref) };
}

// GET /study/data/today: today's Daf Yomi in Tokyo, and the week's Torah
// portion when the same answer carries it.
async function today() {
  const day = tokyoDay(clock());
  let kept = db.getCalendar(day);
  if (!kept) {
    kept = await once(`calendar:${day}`, async () => {
      const [y, mo, d] = day.split('-').map(Number);
      const { status, body } = await sefaria.getJson(`/api/calendars?timezone=${encodeURIComponent(TZ)}&year=${y}&month=${mo}&day=${d}`);
      if (status !== 200 || !body || !Array.isArray(body.calendar_items)) throw new ReaderError(502, `${sefaria.UNREACHABLE} (it answered ${status}).`);
      const daf = itemNamed(body.calendar_items, 'Daf Yomi');
      if (!daf) throw new ReaderError(502, `${sefaria.UNREACHABLE}: its calendar for ${day} has no Daf Yomi.`);
      const portion = itemNamed(body.calendar_items, 'Parashat Hashavua');
      console.log(`library: the calendar for ${day} fetched: Daf Yomi ${daf.ref}${portion ? `, portion ${portion.ref}` : ''}, kept`);
      return db.putCalendar(day, { daf: named(daf), portion: portion ? named(portion) : null }, nowIso());
    });
  }
  // the links need the contents; with Sefaria down and none kept, the day's
  // entries still show, linked to sefaria.org
  const all = await allBooks().catch(() => keptBooks() || []);
  const daf = placeOf(kept.daf, all);
  return { day, daf, daf_in_library: Boolean(daf.study), portion: placeOf(kept.portion, all), state: 'ok' };
}

module.exports = { contents, page, open, places, today, pageHolding, studyPath, readShape, setClock, sideOf, REFRESH_MS };
