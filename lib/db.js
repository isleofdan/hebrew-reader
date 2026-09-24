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

function putCard({ surface, contextHash, spotId, card }) {
  db.prepare(`INSERT INTO cards (surface, context_hash, spot_id, json, built_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(context_hash) DO UPDATE SET spot_id = excluded.spot_id, json = excluded.json, built_at = excluded.built_at`)
    .run(surface, contextHash, spotId || null, JSON.stringify(card), now());
  return getCard(contextHash);
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

module.exports = {
  open, STATUSES, THIN_CHARS, ReaderError, stepDone, markStep,
  addArticle, getArticle, listArticles, deleteArticle,
  getCard, putCard,
  getSpot, requireSpot, ensureSpot, setSpotStatus, setOnSpine, listSpots, checkStatus, moveSpot,
  addTouch, articleTouches, lastArticleTitle, marksForSurfaces, marksForLemmas, cardHint, BINYAN_NAMES,
  demandCandidates, cardForSurface, getTranslation, putTranslation,
  recentArticles, touchesAcross,
  addLesson, getLesson, lessonByText, listLessons, setLessonGuide, setLessonDate, setLessonSaved, deleteLesson,
};
