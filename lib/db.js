'use strict';
// The reader's own database: articles, cached cards, spots (the map), touches.
// SQLite through better-sqlite3, at DATA_DIR/reader.db.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const STATUSES = ['new', 'shaky', 'solid'];

class ReaderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let db;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'reader.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_url TEXT,
      text TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surface TEXT NOT NULL,
      context_hash TEXT NOT NULL UNIQUE,
      spot_id TEXT,
      json TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cards_surface ON cards(surface);
    CREATE TABLE IF NOT EXISTS spots (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      root TEXT,
      binyan TEXT,
      lemma TEXT,
      status TEXT NOT NULL CHECK (status IN ('new','shaky','solid')),
      categories_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS touches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id TEXT NOT NULL REFERENCES spots(id),
      article_id INTEGER REFERENCES articles(id),
      surface TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS touches_spot ON touches(spot_id);
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      lesson_date TEXT,
      source_name TEXT NOT NULL,
      text TEXT NOT NULL,
      items_json TEXT NOT NULL,
      guide_json TEXT,
      guide_built_at TEXT,
      saved_json TEXT,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS steps (
      name TEXT PRIMARY KEY,
      done_at TEXT NOT NULL,
      result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS desks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      named INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL,
      touched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL DEFAULT '',
      made_at TEXT NOT NULL,
      edited_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS placements (
      desk_id INTEGER NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
      card TEXT NOT NULL,
      x REAL, y REAL, w REAL NOT NULL, h REAL NOT NULL,
      z INTEGER NOT NULL DEFAULT 0,
      placed_at TEXT NOT NULL,
      PRIMARY KEY (desk_id, card)
    );
    CREATE INDEX IF NOT EXISTS placements_card ON placements(card);
    CREATE TABLE IF NOT EXISTS card_links (
      child TEXT NOT NULL,
      parent TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'born-from',
      at TEXT NOT NULL,
      PRIMARY KEY (child, parent, kind)
    );
    CREATE INDEX IF NOT EXISTS card_links_parent ON card_links(parent);
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      links_json TEXT NOT NULL DEFAULT '[]',
      made_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('news','tv','blog','other')),
      source_date TEXT,
      url TEXT NOT NULL,
      kept INTEGER NOT NULL DEFAULT 0,
      found_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lookups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL,
      term TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      made_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ink_strokes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ink_id INTEGER NOT NULL REFERENCES inks(id) ON DELETE CASCADE,
      points_json TEXT NOT NULL,
      drawn_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ink_strokes_ink ON ink_strokes(ink_id);
    CREATE TABLE IF NOT EXISTS sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      desk_id INTEGER NOT NULL,
      desk_name TEXT NOT NULL,
      made_at TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      prompts_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS sheet_cards (
      sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      card TEXT NOT NULL,
      PRIMARY KEY (sheet_id, card)
    );
    CREATE INDEX IF NOT EXISTS sheet_cards_card ON sheet_cards(card);
    CREATE TABLE IF NOT EXISTS demand_translations (
      sentence_hash TEXT PRIMARY KEY,
      sentence TEXT NOT NULL,
      translation_en TEXT NOT NULL,
      built_at TEXT NOT NULL
    );
  `);
  migrate();
  return db;
}

// Columns added after the first release. Each runs once, when the column is
// missing; an existing database keeps its rows.
function migrate() {
  const cols = db.prepare('PRAGMA table_info(spots)').all().map((c) => c.name);
  if (!cols.includes('on_spine')) {
    // Session one already sent every shaky and solid spot to the spine.
    db.exec(`ALTER TABLE spots ADD COLUMN on_spine INTEGER NOT NULL DEFAULT 0;
             UPDATE spots SET on_spine = 1 WHERE status IN ('shaky', 'solid');`);
    console.log('database: added spots.on_spine (set for shaky and solid spots)');
  }
  const touchCols = db.prepare('PRAGMA table_info(touches)').all().map((c) => c.name);
  if (!touchCols.includes('lesson_id')) {
    db.exec('ALTER TABLE touches ADD COLUMN lesson_id INTEGER');
    console.log('database: added touches.lesson_id');
  }
  // the sentence a card was made for, so a card reached by its id (the desk)
  // can be pointed and refreshed like one reached by its word and sentence
  const cardCols = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
  if (!cardCols.includes('sentence')) {
    db.exec('ALTER TABLE cards ADD COLUMN sentence TEXT');
    console.log('database: added cards.sentence');
  }
  // session fourteen: the sentence Dan wrote on a link he drew between two
  // cards (kind 'linked'), and the title of a page a note card's link names
  const linkCols = db.prepare('PRAGMA table_info(card_links)').all().map((c) => c.name);
  if (!linkCols.includes('sentence')) {
    db.exec('ALTER TABLE card_links ADD COLUMN sentence TEXT');
    console.log('database: added card_links.sentence');
  }
  const noteCols = db.prepare('PRAGMA table_info(notes)').all().map((c) => c.name);
  if (!noteCols.includes('link_url')) {
    db.exec('ALTER TABLE notes ADD COLUMN link_url TEXT; ALTER TABLE notes ADD COLUMN link_title TEXT;');
    console.log('database: added notes.link_url and notes.link_title');
  }
}

const now = () => new Date().toISOString();

// --- one-time steps on the data, each recorded so it never runs twice -----

function stepDone(name) {
  const row = db.prepare('SELECT * FROM steps WHERE name = ?').get(name);
  return row ? { name: row.name, done_at: row.done_at, result: row.result_json ? JSON.parse(row.result_json) : null } : null;
}

function markStep(name, result) {
  db.prepare('INSERT INTO steps (name, done_at, result_json) VALUES (?, ?, ?)').run(name, now(), JSON.stringify(result || null));
}

// --- articles ---------------------------------------------------------------

function addArticle({ title, source_url, text }) {
  const r = db.prepare('INSERT INTO articles (title, source_url, text, added_at) VALUES (?, ?, ?, ?)')
    .run(title, source_url || null, text, now());
  return getArticle(r.lastInsertRowid);
}

function getArticle(id) {
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No article with id ${id}.`);
  return row;
}

// `thin` is derived from the stored text at render time (under MIN_CHARS,
// the same threshold that kept the raw page text on import); no column.
const THIN_CHARS = 200;

function listArticles() {
  const rows = db.prepare(`SELECT id, title, source_url, added_at, length(text) AS chars FROM articles ORDER BY id DESC`).all();
  const items = rows.map((r) => ({ ...r, thin: r.chars < THIN_CHARS }));
  return { items, state: items.length ? 'ok' : 'no data' };
}

function deleteArticle(id) {
  getArticle(id);
  db.prepare('UPDATE touches SET article_id = NULL WHERE article_id = ?').run(id);
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);
  return { deleted: Number(id) };
}

// --- cards (the model's answers, cached) ------------------------------------

function getCard(contextHash) {
  const row = db.prepare('SELECT * FROM cards WHERE context_hash = ?').get(contextHash);
  return row ? { ...row, card: JSON.parse(row.json) } : null;
}

// `sentence` is kept when given and never cleared by a later write without one.
function putCard({ surface, contextHash, spotId, card, sentence }) {
  db.prepare(`INSERT INTO cards (surface, context_hash, spot_id, json, built_at, sentence) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(context_hash) DO UPDATE SET spot_id = excluded.spot_id, json = excluded.json, built_at = excluded.built_at,
              sentence = COALESCE(excluded.sentence, cards.sentence)`)
    .run(surface, contextHash, spotId || null, JSON.stringify(card), now(), typeof sentence === 'string' ? sentence : null);
  return getCard(contextHash);
}

// The sentence a card was made for, kept on a card cached before cards kept
// it; the card and when it was built are left as they are.
function setCardSentence(contextHash, sentence) {
  db.prepare('UPDATE cards SET sentence = ? WHERE context_hash = ? AND sentence IS NULL').run(sentence, contextHash);
}

function newestCardFor(surface) {
  const row = db.prepare('SELECT * FROM cards WHERE surface = ? ORDER BY id DESC LIMIT 1').get(surface);
  return row ? { ...row, card: JSON.parse(row.json) } : null;
}

function getCardById(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return row ? { ...row, card: JSON.parse(row.json) } : null;
}

// The word cards Find looks through: the newest card of each spot (a spot is
// one word, however many sentences it was looked up in), and each card with
// no spot on its own.
function wordCardsForFind() {
  return db.prepare(`SELECT c.* FROM cards c WHERE c.spot_id IS NULL
                     OR c.id = (SELECT MAX(c2.id) FROM cards c2 WHERE c2.spot_id = c.spot_id) ORDER BY c.id DESC`).all()
    .map((row) => ({ ...row, card: JSON.parse(row.json) }));
}

// --- spots (the map) --------------------------------------------------------

function checkStatus(status) {
  if (!STATUSES.includes(status)) {
    throw new ReaderError(400, `status must be one of ${STATUSES.join(', ')}; got ${JSON.stringify(status)}.`);
  }
  return status;
}

function getSpot(id) {
  const row = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
  return row ? rowToSpot(row) : null;
}

function requireSpot(id) {
  const spot = getSpot(id);
  if (!spot) throw new ReaderError(404, `No spot with id ${JSON.stringify(id)}.`);
  return spot;
}

function rowToSpot(row) {
  const touches = db.prepare('SELECT COUNT(*) AS n FROM touches WHERE spot_id = ?').get(row.id).n;
  return { ...row, on_spine: Boolean(row.on_spine), categories: JSON.parse(row.categories_json), touches };
}

// Remembered once a spine PUT for this spot has succeeded; touches are sent
// to the spine only for spots that have it.
function setOnSpine(id) {
  db.prepare('UPDATE spots SET on_spine = 1 WHERE id = ?').run(id);
}

// Creates the spot as `new` when absent; keeps status when present but
// refreshes the descriptive fields.
function ensureSpot({ id, kind, root, binyan, lemma, categories }) {
  const existing = db.prepare('SELECT * FROM spots WHERE id = ?').get(id);
  if (existing) {
    const merged = Array.from(new Set([...JSON.parse(existing.categories_json), ...(categories || [])]));
    db.prepare('UPDATE spots SET root = COALESCE(?, root), binyan = COALESCE(?, binyan), lemma = COALESCE(?, lemma), categories_json = ? WHERE id = ?')
      .run(root || null, binyan || null, lemma || null, JSON.stringify(merged), id);
  } else {
    db.prepare('INSERT INTO spots (id, kind, root, binyan, lemma, status, categories_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, root || null, binyan || null, lemma || null, 'new', JSON.stringify(categories || []), now());
  }
  return getSpot(id);
}

function setSpotStatus(id, status) {
  checkStatus(status);
  requireSpot(id);
  db.prepare('UPDATE spots SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  return getSpot(id);
}

const STATUS_RANK = { new: 0, shaky: 1, solid: 2 };

// A card's spot changed because its root or binyan was corrected (a verb's
// spot id carries both). The corrected spot is made when absent and takes the
// old spot's status when that is further along; when no other card still
// points at the old spot, its touches move over and the old spot goes, so the
// map does not keep a verb under a binyan it never had. Answers the spot now.
function moveSpot(oldId, def) {
  const old = oldId ? db.prepare('SELECT * FROM spots WHERE id = ?').get(oldId) : null;
  const spot = ensureSpot(def);
  if (!old || oldId === def.id) return spot;
  if (STATUS_RANK[old.status] > STATUS_RANK[spot.status]) {
    db.prepare('UPDATE spots SET status = ?, updated_at = ? WHERE id = ?').run(old.status, now(), def.id);
  }
  const others = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE spot_id = ?').get(oldId).n;
  if (!others) {
    db.prepare('UPDATE touches SET spot_id = ? WHERE spot_id = ?').run(def.id, oldId);
    db.prepare('DELETE FROM spots WHERE id = ?').run(oldId);
  }
  return { ...getSpot(def.id), replaced: oldId, old_kept: others > 0 };
}

function listSpots({ status } = {}) {
  if (status !== undefined) checkStatus(status);
  const rows = status
    ? db.prepare('SELECT * FROM spots WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM spots ORDER BY updated_at DESC').all();
  const items = rows.map(rowToSpot);
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- touches ----------------------------------------------------------------

function addTouch({ spotId, articleId, lessonId, surface }) {
  db.prepare('INSERT INTO touches (spot_id, article_id, lesson_id, surface, at) VALUES (?, ?, ?, ?, ?)')
    .run(spotId, articleId || null, lessonId || null, surface, now());
}

// The articles a spot was touched in, newest touch first, one row per
// (article, surface).
function articleTouches(spotId) {
  return db.prepare(`SELECT article_id, surface, MAX(id) AS last_id FROM touches
                     WHERE spot_id = ? AND article_id IS NOT NULL GROUP BY article_id, surface ORDER BY last_id DESC`).all(spotId);
}

// Every surface a spot's word was met as (its cards').
function surfacesOfSpot(spotId) {
  return db.prepare('SELECT DISTINCT surface FROM cards WHERE spot_id = ?').all(spotId).map((r) => r.surface);
}

// Every touch of a spot, oldest first, with the article's title or the
// lesson's title and date: where a word card was first met.
function touchesOfSpot(spotId) {
  return db.prepare(`SELECT t.surface, t.at, a.id AS article_id, a.title AS article_title, l.id AS lesson_id, l.title AS lesson_title, l.lesson_date
                     FROM touches t LEFT JOIN articles a ON a.id = t.article_id LEFT JOIN lessons l ON l.id = t.lesson_id
                     WHERE t.spot_id = ? ORDER BY t.id ASC`).all(spotId);
}

// The title of the article or the lesson from Guy the spot was last touched
// in, or null. The spine keeps it as fields.last_article_title.
function lastArticleTitle(spotId) {
  const row = db.prepare(`SELECT COALESCE(a.title, l.title) AS title FROM touches t
                          LEFT JOIN articles a ON a.id = t.article_id LEFT JOIN lessons l ON l.id = t.lesson_id
                          WHERE t.spot_id = ? AND (a.id IS NOT NULL OR l.id IS NOT NULL) ORDER BY t.id DESC LIMIT 1`).get(spotId);
  return row ? row.title : null;
}

// --- lessons from Guy -------------------------------------------------------

function rowToLesson(row) {
  return {
    id: row.id, title: row.title, lesson_date: row.lesson_date, source_name: row.source_name, text: row.text,
    items: JSON.parse(row.items_json),
    guide: row.guide_json ? JSON.parse(row.guide_json) : null, guide_built_at: row.guide_built_at,
    saved: row.saved_json ? JSON.parse(row.saved_json) : null, added_at: row.added_at,
  };
}

function addLesson({ title, lesson_date, source_name, text, items }) {
  const r = db.prepare('INSERT INTO lessons (title, lesson_date, source_name, text, items_json, added_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, lesson_date || null, source_name, text, JSON.stringify(items), now());
  return getLesson(r.lastInsertRowid);
}

function getLesson(id) {
  const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No lesson with id ${id}.`);
  return rowToLesson(row);
}

function lessonByText(text) {
  const row = db.prepare('SELECT * FROM lessons WHERE text = ? ORDER BY id LIMIT 1').get(text);
  return row ? rowToLesson(row) : null;
}

// Newest lesson first: by the lesson's own date, then by when it was added.
function listLessons() {
  const rows = db.prepare(`SELECT id, title, lesson_date, source_name, items_json, guide_built_at, added_at FROM lessons
                           ORDER BY COALESCE(lesson_date, substr(added_at, 1, 10)) DESC, id DESC`).all();
  const items = rows.map((r) => ({ id: r.id, title: r.title, lesson_date: r.lesson_date, source_name: r.source_name,
    items: JSON.parse(r.items_json).length, guide: Boolean(r.guide_built_at), added_at: r.added_at }));
  return { items, state: items.length ? 'ok' : 'no data' };
}

// A lesson's title and date set again (a one-time re-date); nothing else changes.
function setLessonDate(id, { title, lesson_date }) {
  db.prepare('UPDATE lessons SET title = ?, lesson_date = ? WHERE id = ?').run(title, lesson_date, id);
}

// A new guide replaces the old one whole; nothing is merged.
function setLessonGuide(id, guide) {
  db.prepare('UPDATE lessons SET guide_json = ?, guide_built_at = ? WHERE id = ?').run(JSON.stringify(guide), now(), id);
}

function setLessonSaved(id, saved) {
  db.prepare('UPDATE lessons SET saved_json = ? WHERE id = ?').run(JSON.stringify(saved), id);
}

// --- the demand -------------------------------------------------------------

// Verb spots that can be asked for: shaky first, then new; least recently
// touched first (a spot never touched counts as least recent of all).
function demandCandidates() {
  const rows = db.prepare(`SELECT s.*, (SELECT MAX(t.at) FROM touches t WHERE t.spot_id = s.id) AS last_touch_at
                           FROM spots s WHERE s.kind = 'verb' AND s.root IS NOT NULL AND s.binyan IS NOT NULL
                           AND s.status IN ('shaky', 'new')
                           ORDER BY CASE s.status WHEN 'shaky' THEN 0 ELSE 1 END, last_touch_at ASC, s.id ASC`).all();
  return rows.map(rowToSpot);
}

// The cached card for a surface: the one for this exact sentence when it
// exists, else the newest card for the surface on this spot. Null when none.
function cardForSurface(surface, spotId, contextHashValue) {
  const exact = contextHashValue ? db.prepare('SELECT json FROM cards WHERE context_hash = ?').get(contextHashValue) : null;
  const row = exact || db.prepare('SELECT json FROM cards WHERE surface = ? AND spot_id = ? ORDER BY id DESC LIMIT 1').get(surface, spotId);
  return row ? JSON.parse(row.json) : null;
}

function getTranslation(hash) {
  return db.prepare('SELECT * FROM demand_translations WHERE sentence_hash = ?').get(hash) || null;
}

function putTranslation({ hash, gapped, translation }) {
  db.prepare('INSERT OR REPLACE INTO demand_translations (sentence_hash, sentence, translation_en, built_at) VALUES (?, ?, ?, ?)')
    .run(hash, gapped, translation, now());
}

// --- the lesson sheet -------------------------------------------------------

function recentArticles(n) {
  return db.prepare('SELECT id, title, added_at, text FROM articles ORDER BY id DESC LIMIT ?').all(n);
}

// Touch counts per spot across the given articles, with the distinct
// surfaces seen (newline-joined), most touched first.
function touchesAcross(articleIds) {
  if (!articleIds.length) return [];
  const marks = articleIds.map(() => '?').join(',');
  return db.prepare(`SELECT spot_id, COUNT(*) AS touches, GROUP_CONCAT(DISTINCT surface) AS surfaces
                     FROM touches WHERE article_id IN (${marks}) GROUP BY spot_id ORDER BY touches DESC, spot_id ASC`)
    .all(...articleIds).map((r) => ({ ...r, surfaces: String(r.surfaces || '').split(',').join('\n') }));
}

// --- the map against an article --------------------------------------------

const BINYAN_NAMES = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };

// One short line for the side list: "Nif'al past" or "governs עם" or the pos.
function cardHint(card) {
  if (!card) return '';
  if (card.binyan) return [BINYAN_NAMES[card.binyan] || card.binyan, card.tense].filter(Boolean).join(' ');
  if (card.governs) return `governs ${card.governs}`;
  return card.pos || '';
}

// surface -> { spot_id, status } for every surface the cards cache knows that
// has a spot. The client applies it to the words on the page. Newest card wins
// when one surface was read in several contexts.
function marksForSurfaces() {
  const rows = db.prepare(`SELECT c.surface, c.spot_id, c.json, s.status FROM cards c
                           JOIN spots s ON s.id = c.spot_id
                           WHERE c.spot_id IS NOT NULL ORDER BY c.id ASC`).all();
  const map = {};
  for (const r of rows) map[r.surface] = { spot_id: r.spot_id, status: r.status, hint: cardHint(JSON.parse(r.json)) };
  return map;
}

// lemma -> { spot_id, status, hint } for every spot with a lemma, so a word
// on the page that equals a saved lemma, alone or after one prefix, tints.
function marksForLemmas() {
  const map = {};
  for (const r of db.prepare('SELECT id, lemma, binyan, status FROM spots WHERE lemma IS NOT NULL ORDER BY updated_at ASC').all()) {
    map[r.lemma] = { spot_id: r.id, status: r.status, hint: r.binyan ? (BINYAN_NAMES[r.binyan] || r.binyan) : '' };
  }
  return map;
}

// The lesson and its guide go; its touches stay (without the lesson) and its
// spots keep their status. Nothing is sent to the spine.
function deleteLesson(id) {
  getLesson(id);
  db.prepare('UPDATE touches SET lesson_id = NULL WHERE lesson_id = ?').run(id);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
  return { deleted: Number(id) };
}

// --- the desk ----------------------------------------------------------------
// A desk is a surface Dan lays cards out on. A placement is one card on one
// desk: where, how big, how high in the stack (x and y null: on the desk but
// not yet placed, as a card typed on the phone lands). A card is named by a
// key: "word:<cards.id>" for a word card (the reader's own card, never a
// copy) or "note:<notes.id>" for a note card. card_links holds born-from
// pairs: child -> parent.

function rowToDesk(row) {
  return { id: row.id, name: row.name, named: Boolean(row.named), opened_at: row.opened_at, touched_at: row.touched_at };
}

function addDesk({ name, at = now() }) {
  const r = db.prepare('INSERT INTO desks (name, named, opened_at, touched_at) VALUES (?, 0, ?, ?)').run(name, at, at);
  return getDesk(r.lastInsertRowid);
}

function getDesk(id) {
  const row = db.prepare('SELECT * FROM desks WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No desk with id ${id}.`);
  return rowToDesk(row);
}

function latestDesk() {
  const row = db.prepare('SELECT * FROM desks ORDER BY touched_at DESC, id DESC LIMIT 1').get();
  return row ? rowToDesk(row) : null;
}

function listDesks() {
  return db.prepare('SELECT * FROM desks ORDER BY touched_at DESC, id DESC').all().map(rowToDesk);
}

function touchDesk(id, at = now()) {
  db.prepare('UPDATE desks SET touched_at = ? WHERE id = ?').run(at, id);
}

function renameDesk(id, name) {
  db.prepare('UPDATE desks SET name = ?, named = 1, touched_at = ? WHERE id = ?').run(name, now(), id);
  return getDesk(id);
}

function placementsOf(deskId) {
  return db.prepare('SELECT * FROM placements WHERE desk_id = ? ORDER BY z ASC, placed_at ASC').all(deskId);
}

function getPlacement(deskId, card) {
  return db.prepare('SELECT * FROM placements WHERE desk_id = ? AND card = ?').get(deskId, card) || null;
}

function addPlacement({ desk_id, card, x, y, w, h, z }) {
  db.prepare('INSERT INTO placements (desk_id, card, x, y, w, h, z, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(desk_id, card, x === undefined ? null : x, y === undefined ? null : y, w, h, z, now());
  return getPlacement(desk_id, card);
}

function setPlacement(deskId, card, { x, y, w, h, z }) {
  db.prepare('UPDATE placements SET x = ?, y = ?, w = ?, h = ?, z = ? WHERE desk_id = ? AND card = ?').run(x, y, w, h, z, deskId, card);
  return getPlacement(deskId, card);
}

function removePlacement(deskId, card) {
  return db.prepare('DELETE FROM placements WHERE desk_id = ? AND card = ?').run(deskId, card).changes;
}

function topZ(deskId) {
  return db.prepare('SELECT COALESCE(MAX(z), 0) AS z FROM placements WHERE desk_id = ?').get(deskId).z;
}

// The desks a card is on, newest touched first.
function desksHolding(card) {
  return db.prepare(`SELECT d.* FROM desks d JOIN placements p ON p.desk_id = d.id WHERE p.card = ?
                     ORDER BY d.touched_at DESC, d.id DESC`).all(card).map(rowToDesk);
}

function addNote(text) {
  const at = now();
  const r = db.prepare('INSERT INTO notes (text, made_at, edited_at) VALUES (?, ?, ?)').run(text, at, at);
  return getNote(r.lastInsertRowid);
}

function getNote(id) {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No note card with id ${id}.`);
  return row;
}

function setNoteText(id, text) {
  db.prepare('UPDATE notes SET text = ?, edited_at = ? WHERE id = ?').run(text, now(), id);
  return getNote(id);
}

function allNotes() {
  return db.prepare('SELECT * FROM notes ORDER BY id DESC').all();
}

function addLink(child, parent, kind = 'born-from', at = now()) {
  db.prepare('INSERT OR IGNORE INTO card_links (child, parent, kind, at) VALUES (?, ?, ?, ?)').run(child, parent, kind, at);
}

function linksOf(cards) {
  if (!cards.length) return [];
  const marks = cards.map(() => '?').join(',');
  return db.prepare(`SELECT child, parent, kind, sentence FROM card_links WHERE child IN (${marks}) OR parent IN (${marks})`).all(...cards, ...cards);
}

// Every card born from this one, and from those, all the way down.
function descendants(card) {
  const out = [];
  const seen = new Set([card]);
  let front = [card];
  while (front.length) {
    const next = [];
    for (const c of front) {
      for (const r of db.prepare('SELECT child FROM card_links WHERE parent = ?').all(c)) {
        if (seen.has(r.child)) continue;
        seen.add(r.child); out.push(r.child); next.push(r.child);
      }
    }
    front = next;
  }
  return out;
}

// --- a card's layers (session thirteen) --------------------------------------
// An answer to a question asked on a card, an example sentence found online,
// a lookup in a reference: each a record of its own, named by a key like a
// card ("answer:<id>", "example:<id>", "lookup:<id>"), and tied to the card
// it belongs to by a card_links row of kind 'layer' (child: the layer). A
// typed note on a card is a note card tied the same way.

function addAnswer({ question, answer, links }) {
  const r = db.prepare('INSERT INTO answers (question, answer, links_json, made_at) VALUES (?, ?, ?, ?)').run(question, answer, JSON.stringify(links || []), now());
  return getAnswer(r.lastInsertRowid);
}

function getAnswer(id) {
  const row = db.prepare('SELECT * FROM answers WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No answer with id ${id}.`);
  const { links_json, ...rest } = row;
  return { ...rest, links: JSON.parse(links_json) };
}

function allAnswers() {
  return db.prepare('SELECT id FROM answers ORDER BY id DESC').all().map((r) => getAnswer(r.id));
}

function addExample({ sentence, source_name, source_kind, source_date, url }) {
  const r = db.prepare('INSERT INTO examples (sentence, source_name, source_kind, source_date, url, kept, found_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(sentence, source_name, source_kind, source_date || null, url, now());
  return getExample(r.lastInsertRowid);
}

function rowToExample(row) { return { ...row, kept: Boolean(row.kept) }; }

function getExample(id) {
  const row = db.prepare('SELECT * FROM examples WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No example with id ${id}.`);
  return rowToExample(row);
}

function setExampleKept(id, kept) {
  getExample(id);
  db.prepare('UPDATE examples SET kept = ? WHERE id = ?').run(kept ? 1 : 0, id);
  return getExample(id);
}

function allExamples() {
  return db.prepare('SELECT * FROM examples ORDER BY id DESC').all().map(rowToExample);
}

function addLookup({ reference, term }) {
  const r = db.prepare('INSERT INTO lookups (reference, term, at) VALUES (?, ?, ?)').run(reference, term, now());
  return getLookup(r.lastInsertRowid);
}

function getLookup(id) {
  const row = db.prepare('SELECT * FROM lookups WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No lookup with id ${id}.`);
  return row;
}

// The children of a card by link kind, in the order they were made (the
// link's time, then the order the rows were written).
function childrenOf(parent, kind) {
  return db.prepare('SELECT child, kind, at FROM card_links WHERE parent = ? AND kind = ? ORDER BY at ASC, rowid ASC').all(parent, kind);
}

// What a card is linked to as a child: [{ parent, kind, at }].
function parentsOf(child) {
  return db.prepare('SELECT parent, kind, at FROM card_links WHERE child = ? ORDER BY at ASC, rowid ASC').all(child);
}

// Every card something grew from: a layer, a branch or a cut.
function grownParents() {
  return db.prepare("SELECT DISTINCT parent FROM card_links WHERE kind IN ('layer', 'branched-from', 'cut-from')").all().map((r) => r.parent);
}

// A layer moves to another card (a cut); it keeps its time, so its order.
function moveLayer(child, from, to) {
  return db.prepare("UPDATE card_links SET parent = ? WHERE child = ? AND parent = ? AND kind = 'layer'").run(to, child, from).changes;
}

// --- session fourteen: ink, Dan's own links, sheets, a caught link --------------
// Ink is a layer of its card ("ink:<inks.id>", tied by a 'layer' link like
// any layer); its strokes are rows of their own, one per stroke, in the order
// drawn. A stroke is [[x, y, pressure], ...] with x and y as fractions of the
// ink area's width, so it draws the same at any width.

function addInk() {
  const r = db.prepare('INSERT INTO inks (made_at) VALUES (?)').run(now());
  return getInk(r.lastInsertRowid);
}

function getInk(id) {
  const row = db.prepare('SELECT * FROM inks WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No ink with id ${id}.`);
  const strokes = db.prepare('SELECT id, points_json, drawn_at FROM ink_strokes WHERE ink_id = ? ORDER BY id ASC').all(id)
    .map((s) => ({ id: s.id, points: JSON.parse(s.points_json), drawn_at: s.drawn_at }));
  return { id: row.id, made_at: row.made_at, strokes };
}

function addStroke(inkId, points) {
  const r = db.prepare('INSERT INTO ink_strokes (ink_id, points_json, drawn_at) VALUES (?, ?, ?)').run(inkId, JSON.stringify(points), now());
  return { id: Number(r.lastInsertRowid) };
}

// The last stroke drawn goes; answers how many are left.
function removeLastStroke(inkId) {
  const last = db.prepare('SELECT id FROM ink_strokes WHERE ink_id = ? ORDER BY id DESC LIMIT 1').get(inkId);
  if (last) db.prepare('DELETE FROM ink_strokes WHERE id = ?').run(last.id);
  return { removed: last ? last.id : null, left: db.prepare('SELECT COUNT(*) AS n FROM ink_strokes WHERE ink_id = ?').get(inkId).n };
}

// An ink layer with no stroke left is gone, with its link.
function removeInk(inkId) {
  db.prepare('DELETE FROM ink_strokes WHERE ink_id = ?').run(inkId);
  db.prepare('DELETE FROM inks WHERE id = ?').run(inkId);
  db.prepare("DELETE FROM card_links WHERE child = ? AND kind = 'layer'").run(`ink:${inkId}`);
}

// Dan's own link between two cards, with the sentence saying why. One per
// pair, whichever way it was drawn; drawn again, its sentence is replaced.
function setDanLink(from, to, sentence) {
  const was = db.prepare("SELECT child, parent FROM card_links WHERE kind = 'linked' AND ((child = ? AND parent = ?) OR (child = ? AND parent = ?))").get(from, to, to, from);
  if (was) db.prepare("UPDATE card_links SET sentence = ?, at = ? WHERE kind = 'linked' AND child = ? AND parent = ?").run(sentence, now(), was.child, was.parent);
  else db.prepare("INSERT INTO card_links (child, parent, kind, at, sentence) VALUES (?, ?, 'linked', ?, ?)").run(from, to, now(), sentence);
  return getDanLink(from, to);
}

function getDanLink(a, b) {
  return db.prepare("SELECT child, parent, kind, at, sentence FROM card_links WHERE kind = 'linked' AND ((child = ? AND parent = ?) OR (child = ? AND parent = ?))").get(a, b, b, a) || null;
}

// Every link Dan drew touching any of these cards.
function danLinksOf(cards) {
  if (!cards.length) return [];
  const marks = cards.map(() => '?').join(',');
  return db.prepare(`SELECT child, parent, kind, at, sentence FROM card_links WHERE kind = 'linked' AND (child IN (${marks}) OR parent IN (${marks})) ORDER BY at ASC, rowid ASC`).all(...cards, ...cards);
}

function allDanLinks() {
  return db.prepare("SELECT child, parent, kind, at, sentence FROM card_links WHERE kind = 'linked' ORDER BY at ASC, rowid ASC").all();
}

function addSheet({ desk_id, desk_name, groups, prompts, cards }) {
  const r = db.prepare('INSERT INTO sheets (desk_id, desk_name, made_at, groups_json, prompts_json) VALUES (?, ?, ?, ?, ?)')
    .run(desk_id, desk_name, now(), JSON.stringify(groups), JSON.stringify(prompts || []));
  const add = db.prepare('INSERT OR IGNORE INTO sheet_cards (sheet_id, card) VALUES (?, ?)');
  for (const c of cards) add.run(r.lastInsertRowid, c);
  return getSheet(r.lastInsertRowid);
}

function getSheet(id) {
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!row) throw new ReaderError(404, `No sheet with id ${id}.`);
  return { id: row.id, desk_id: row.desk_id, desk_name: row.desk_name, made_at: row.made_at, groups: JSON.parse(row.groups_json), prompts: JSON.parse(row.prompts_json) };
}

function sheetsOfDesk(deskId) {
  return db.prepare('SELECT id, made_at FROM sheets WHERE desk_id = ? ORDER BY made_at ASC, id ASC').all(deskId);
}

function sheetsHolding(card) {
  return db.prepare('SELECT COUNT(*) AS n FROM sheet_cards WHERE card = ?').get(card).n;
}

function setNoteLink(id, url, title) {
  db.prepare('UPDATE notes SET link_url = ?, link_title = ? WHERE id = ?').run(url, title, id);
  return getNote(id);
}

// Several writes as one: all land or none do.
function together(fn) { return db.transaction(fn)(); }

module.exports = {
  addDesk, getDesk, latestDesk, listDesks, touchDesk, renameDesk,
  placementsOf, getPlacement, addPlacement, setPlacement, removePlacement, topZ, desksHolding,
  addNote, getNote, setNoteText, allNotes, addLink, linksOf, descendants, together,
  addAnswer, getAnswer, allAnswers, addExample, getExample, setExampleKept, allExamples, addLookup, getLookup,
  childrenOf, parentsOf, moveLayer, grownParents, touchesOfSpot, surfacesOfSpot,
  addInk, getInk, addStroke, removeLastStroke, removeInk, setDanLink, getDanLink, danLinksOf, allDanLinks,
  addSheet, getSheet, sheetsOfDesk, sheetsHolding, setNoteLink,
  getCardById, newestCardFor, wordCardsForFind, setCardSentence,
  open, STATUSES, THIN_CHARS, ReaderError, stepDone, markStep,
  addArticle, getArticle, listArticles, deleteArticle,
  getCard, putCard,
  getSpot, requireSpot, ensureSpot, setSpotStatus, setOnSpine, listSpots, checkStatus, moveSpot,
  addTouch, articleTouches, lastArticleTitle, marksForSurfaces, marksForLemmas, cardHint, BINYAN_NAMES,
  demandCandidates, cardForSurface, getTranslation, putTranslation,
  recentArticles, touchesAcross,
  addLesson, getLesson, lessonByText, listLessons, setLessonGuide, setLessonDate, setLessonSaved, deleteLesson,
};
