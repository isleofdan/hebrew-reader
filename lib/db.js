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
  `);
  return db;
}

const now = () => new Date().toISOString();

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

function listArticles() {
  const rows = db.prepare(`SELECT id, title, source_url, added_at, length(text) AS chars FROM articles ORDER BY id DESC`).all();
  return { items: rows, state: rows.length ? 'ok' : 'no data' };
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
  return { ...row, categories: JSON.parse(row.categories_json), touches };
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

function listSpots({ status } = {}) {
  if (status !== undefined) checkStatus(status);
  const rows = status
    ? db.prepare('SELECT * FROM spots WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM spots ORDER BY updated_at DESC').all();
  const items = rows.map(rowToSpot);
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- touches ----------------------------------------------------------------

function addTouch({ spotId, articleId, surface }) {
  db.prepare('INSERT INTO touches (spot_id, article_id, surface, at) VALUES (?, ?, ?, ?)')
    .run(spotId, articleId || null, surface, now());
}

// The title of the article the spot was last touched in, or null.
function lastArticleTitle(spotId) {
  const row = db.prepare(`SELECT a.title FROM touches t JOIN articles a ON a.id = t.article_id
                          WHERE t.spot_id = ? ORDER BY t.id DESC LIMIT 1`).get(spotId);
  return row ? row.title : null;
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

module.exports = {
  open, STATUSES, ReaderError,
  addArticle, getArticle, listArticles, deleteArticle,
  getCard, putCard,
  getSpot, requireSpot, ensureSpot, setSpotStatus, listSpots, checkStatus,
  addTouch, lastArticleTitle, marksForSurfaces, cardHint, BINYAN_NAMES,
};
