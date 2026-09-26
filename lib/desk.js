'use strict';
// The desk: a surface Dan lays cards out on — his word cards and note cards
// he types — and comes back to later. Every write goes through this module
// and is saved as it happens; the page never holds the only copy.
//
// One card, one truth: a word card on a desk is the reader's own cached card
// (a placement names it by id), never a copy, so a card Dan confirmed stays
// as he set it here too. A placement is only which card, where, how big and
// how high in the stack.

const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');

const SIZE = { word: { w: 260, h: 176 }, note: { w: 220, h: 140 } };
const MIN = { w: 140, h: 90 };
const MAX = { w: 900, h: 900 };
const FAR = 20000;           // no card is placed beyond this, either way
const ROW_WIDTH = 1180;      // a new card is placed within this width
const GAP = 16;              // the space kept between cards
const STEP = 20;
const NAME_MAX = 80;
const NOTE_MAX = 4000;

// --- names ---------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tokyo's wall clock at `at`: { year, month (1-12), day, weekday (0-6), hour }.
function tokyo(at) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(at)) parts[p.type] = p.value;
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return { year, month, day, hour: Number(parts.hour) % 24, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

// A new desk's name: when it was opened, in Tokyo — "Thursday 25 Sep · evening".
function deskName(at = new Date()) {
  const t = tokyo(at);
  return `${DAYS[t.weekday]} ${t.day} ${MONTHS[t.month - 1]} · ${partOfDay(t.hour)}`;
}

// --- card keys -------------------------------------------------------------------

// "word:12" or "note:3" -> { kind, id }; anything else is refused.
function parseKey(key) {
  const m = /^(word|note):(\d+)$/.exec(String(key || ''));
  if (!m) throw new ReaderError(400, `A card is named "word:<id>" or "note:<id>"; got ${JSON.stringify(key)}.`);
  return { kind: m[1], id: Number(m[2]) };
}

// What a card shows, read fresh from its own record every time.
function content(key) {
  const { kind, id } = parseKey(key);
  if (kind === 'note') {
    const n = db.getNote(id);
    return { key, kind, text: n.text, made_at: n.made_at, edited_at: n.edited_at };
  }
  const row = db.getCardById(id);
  if (!row) throw new ReaderError(404, `No word card with id ${id}.`);
  const spot = row.spot_id ? db.getSpot(row.spot_id) : null;
  return {
    key, kind, card_id: row.id, card: row.card, sentence: row.sentence || '',
    spot: spot ? { id: spot.id, status: spot.status, touches: spot.touches } : null,
    ...(lookup.refreshDue(row.card) ? { refresh_due: true } : lookup.hasPoints(row.card) ? {} : { points_missing: true }),
  };
}

// The word as Dan met it, unpointed: the name a word card goes by in a line.
function label(c) {
  if (c.kind === 'note') {
    const t = c.text.replace(/\s+/g, ' ').trim();
    return t.length > 30 ? t.slice(0, 29) + '…' : t || 'an empty note';
  }
  return c.card.surface || c.card.lemma || '';
}

// --- numbers -------------------------------------------------------------------

function num(v, name, lo, hi) {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) throw new ReaderError(400, `${name} must be a number; got ${JSON.stringify(v)}.`);
  return Math.round(Math.min(hi, Math.max(lo, n)));
}

// --- where a new card goes -------------------------------------------------------

const overlaps = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

// The first free spot on the desk for a card of this size, row by row from
// the top left; beside `near` first when given (right, below, left, above).
function freeSpot(deskId, w, h, near = null) {
  const taken = db.placementsOf(deskId).filter((p) => p.x !== null && p.y !== null);
  const free = (r) => r.x >= 0 && r.y >= 0 && !taken.some((t) => overlaps(r, t));
  if (near && near.x !== null) {
    for (const r of [
      { x: near.x + near.w + GAP * 2, y: near.y },
      { x: near.x, y: near.y + near.h + GAP * 2 },
      { x: near.x - w - GAP * 2, y: near.y },
      { x: near.x, y: near.y - h - GAP * 2 },
    ]) if (free({ ...r, w, h })) return { x: r.x, y: r.y };
  }
  for (let y = 24; y < FAR; y += STEP) {
    for (let x = 24; x + w <= ROW_WIDTH; x += STEP) {
      if (free({ x, y, w, h })) return { x, y };
    }
  }
  return { x: 24, y: 24 };
}

// --- desks ---------------------------------------------------------------------

function view(deskId) {
  const desk = db.getDesk(deskId);
  const cards = [];
  for (const p of db.placementsOf(deskId)) {
    let c;
    try { c = content(p.card); } catch (e) { if (e.status === 404) continue; throw e; }
    cards.push({ ...c, place: { x: p.x, y: p.y, w: p.w, h: p.h, z: p.z } });
  }
  const keys = cards.map((c) => c.key);
  const onDesk = new Set(keys);
  const links = db.linksOf(keys).filter((l) => onDesk.has(l.child) && onDesk.has(l.parent));
  return { desk, cards, links, state: cards.length ? 'ok' : 'no data' };
}

// The desk Dan last worked on; a new one when there is none yet.
function current() {
  const d = db.latestDesk() || newDesk().desk;
  return view(d.id);
}

function newDesk() {
  const at = new Date();
  const desk = db.addDesk({ name: deskName(at), at: at.toISOString() });
  console.log(`desk ${desk.id}: new, "${desk.name}"`);
  return view(desk.id);
}

// An older desk opened: it becomes the current desk again, exactly as left.
function open(deskId) {
  db.getDesk(deskId);
  db.touchDesk(deskId);
  return view(deskId);
}

function rename(deskId, name) {
  db.getDesk(deskId);
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ReaderError(400, 'A desk needs a name: type at least one letter.');
  if (n.length > NAME_MAX) throw new ReaderError(400, `A desk's name is at most ${NAME_MAX} characters; this one has ${n.length}.`);
  const desk = db.renameDesk(deskId, n);
  console.log(`desk ${deskId}: renamed "${desk.name}"`);
  return desk;
}

// Every desk, newest touched first, each with its cards' shapes for a small
// drawing of its layout (placed cards only; notes drawn yellow).
function list() {
  const items = db.listDesks().map((d) => {
    const ps = db.placementsOf(d.id);
    return { ...d, count: ps.length, shapes: ps.filter((p) => p.x !== null && p.y !== null).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, kind: parseKey(p.card).kind })) };
  });
  return { items, state: items.length ? 'ok' : 'no data' };
}

// --- placements -----------------------------------------------------------------

// A word card already on this desk under the same word (the same spot, from
// another sentence) counts as this card: a word is on a desk once.
function sameWordOn(deskId, key) {
  const { kind, id } = parseKey(key);
  if (kind !== 'word') return null;
  const row = db.getCardById(id);
  if (!row || !row.spot_id) return null;
  for (const p of db.placementsOf(deskId)) {
    const k = parseKey(p.card);
    if (k.kind !== 'word' || k.id === id) continue;
    const other = db.getCardById(k.id);
    if (other && other.spot_id === row.spot_id) return p;
  }
  return null;
}

// Puts a card on a desk: at x, y when given, beside `near` (a card on this
// desk) when given, else at the next free spot; `unplaced` leaves it on the
// desk with no place yet (the phone). A card already there stays where it is
// and the answer says so: { placement, already }.
function place(deskId, key, { x, y, w, h, near, unplaced } = {}) {
  db.getDesk(deskId);
  const c = content(key); // the card exists
  const was = db.getPlacement(deskId, key) || sameWordOn(deskId, key);
  if (was) return { placement: was, already: true, card: c };
  const size = SIZE[c.kind];
  const W = w === undefined ? size.w : num(w, 'w', MIN.w, MAX.w);
  const H = h === undefined ? size.h : num(h, 'h', MIN.h, MAX.h);
  let at = { x: null, y: null };
  if (!unplaced) {
    if (x !== undefined && y !== undefined) at = { x: num(x, 'x', 0, FAR), y: num(y, 'y', 0, FAR) };
    else at = freeSpot(deskId, W, H, near ? db.getPlacement(deskId, near) : null);
  }
  const placement = db.together(() => {
    const p = db.addPlacement({ desk_id: deskId, card: key, x: at.x, y: at.y, w: W, h: H, z: db.topZ(deskId) + 1 });
    db.touchDesk(deskId);
    return p;
  });
  console.log(`desk ${deskId}: ${key} placed${at.x === null ? ' (not yet placed)' : ` at ${at.x},${at.y}`}`);
  return { placement, already: false, card: c };
}

// Moved, resized, or brought to the front; only what is given changes.
function move(deskId, key, { x, y, w, h, front } = {}) {
  parseKey(key);
  const p = db.getPlacement(deskId, key);
  if (!p) throw new ReaderError(404, `Card ${key} is not on desk ${deskId}.`);
  const next = {
    x: x === undefined ? p.x : num(x, 'x', 0, FAR),
    y: y === undefined ? p.y : num(y, 'y', 0, FAR),
    w: w === undefined ? p.w : num(w, 'w', MIN.w, MAX.w),
    h: h === undefined ? p.h : num(h, 'h', MIN.h, MAX.h),
    z: front ? db.topZ(deskId) + (p.z === db.topZ(deskId) ? 0 : 1) : p.z,
  };
  return db.together(() => {
    const out = db.setPlacement(deskId, key, next);
    db.touchDesk(deskId);
    return out;
  });
}

// The card leaves the desk; the card itself stays (Find still finds it).
function unplace(deskId, key) {
  parseKey(key);
  db.getDesk(deskId);
  const gone = db.removePlacement(deskId, key);
  if (!gone) throw new ReaderError(404, `Card ${key} is not on desk ${deskId}.`);
  db.touchDesk(deskId);
  console.log(`desk ${deskId}: ${key} removed from the desk (the card stays)`);
  return { removed: key, desk_id: Number(deskId) };
}

// --- note cards ------------------------------------------------------------------

function noteText(v) {
  const t = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  if (t.length > NOTE_MAX) throw new ReaderError(400, `A note card holds at most ${NOTE_MAX} characters; this one has ${t.length}.`);
  return t;
}

// A new note card on a desk (the current desk when none is named). Born from
// another card: the link is kept and the note is placed beside its parent.
function addNote({ text, desk_id, born_from, unplaced } = {}) {
  const t = noteText(text);
  const deskId = desk_id ? Number(desk_id) : current().desk.id;
  db.getDesk(deskId);
  if (born_from) content(born_from); // the parent exists
  return db.together(() => {
    const n = db.addNote(t);
    const key = `note:${n.id}`;
    if (born_from) db.addLink(key, born_from);
    const near = born_from && db.getPlacement(deskId, born_from) ? born_from : null;
    const { placement } = place(deskId, key, { near, unplaced });
    console.log(`note ${n.id}: made on desk ${deskId}${born_from ? `, born from ${born_from}` : ''}`);
    return { card: content(key), place: placement, born_from: born_from || null, desk_id: deskId };
  });
}

// A note's text saved as typed; every desk it is on counts as touched.
function editNote(id, text) {
  const t = noteText(text);
  db.getNote(id);
  const n = db.setNoteText(id, t);
  for (const d of db.desksHolding(`note:${id}`)) db.touchDesk(d.id);
  return content(`note:${n.id}`);
}

// --- "Put on the desk" -----------------------------------------------------------

// The reader's word card for this word in this sentence onto the current
// desk, once. The card must have been looked up (it is the one on screen).
function put({ surface, sentence, card_id }) {
  let row;
  if (card_id !== undefined && card_id !== null) row = db.getCardById(Number(card_id));
  else {
    const s = String(surface || '').trim();
    if (!s) throw new ReaderError(400, 'surface is required: the word as it appears.');
    row = db.getCard(lookup.contextHash(s, String(sentence || '').trim()));
    if (row && row.sentence === null) db.putCard({ surface: row.surface, contextHash: row.context_hash, spotId: row.spot_id, card: row.card, sentence: String(sentence || '').trim() });
  }
  if (!row) throw new ReaderError(404, `No saved card for "${surface || card_id}": open the word's card first.`);
  const desk = current().desk;
  const out = place(desk.id, `word:${row.id}`);
  return { desk: db.getDesk(desk.id), key: out.placement.card, already: out.already, place: out.placement };
}

// --- Find ----------------------------------------------------------------------

const bare = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '').toLowerCase();
const letters = (s) => bare(s).replace(/[^א-ת]/g, '');

// Hebrew typed with or without nikud finds the same card; English is matched
// in the gloss and in note text, case ignored.
function matcher(q) {
  const plain = bare(q).replace(/\s+/g, ' ').trim();
  const heb = letters(q);
  return {
    plain,
    card(c) {
      if (c.kind === 'note') return Boolean(plain) && bare(c.text).includes(plain);
      const k = c.card;
      if (heb && [k.surface, k.lemma, k.root].some((f) => letters(f).includes(heb))) return true;
      return !heb && Boolean(plain) && bare(k.meaning_en).includes(plain);
    },
  };
}

const FIND_MAX = 60;

// Cards that match (word cards: headword, root, gloss; note cards: text) and
// desks that match (by name, or by holding a matching card — the answer says
// which card, and how many cards on that desk grew from it).
function find(q) {
  const m = matcher(q);
  if (!m.plain) return { q: String(q || ''), cards: [], desks: [], state: 'no data', reason: 'Type a word to find.' };
  const cards = [];
  for (const row of db.wordCardsForFind()) {
    const c = content(`word:${row.id}`);
    if (m.card(c)) cards.push(c);
  }
  for (const n of db.allNotes()) {
    const c = content(`note:${n.id}`);
    if (m.card(c)) cards.push(c);
  }
  // a word card matches on any desk it is on under any of its sentences
  const spots = new Set(cards.filter((c) => c.kind === 'word' && c.spot).map((c) => c.spot.id));
  const keys = new Set(cards.map((c) => c.key));
  const holds = (placedKey) => {
    if (keys.has(placedKey)) return true;
    const k = parseKey(placedKey);
    if (k.kind !== 'word') return false;
    const row = db.getCardById(k.id);
    return Boolean(row && row.spot_id && spots.has(row.spot_id));
  };
  const desks = [];
  for (const d of list().items) {
    const placed = db.placementsOf(d.id).map((p) => p.card);
    const why = [];
    for (const key of placed.filter(holds)) {
      const grown = db.descendants(key).filter((k) => placed.includes(k)).length;
      why.push(`${label(content(key))}${grown ? ` and ${grown} card${grown === 1 ? '' : 's'} from it` : ''}`);
    }
    const byName = bare(d.name).includes(m.plain) || (letters(q) && letters(d.name).includes(letters(q)));
    if (why.length || byName) desks.push({ ...d, reason: why.length ? why.join('; ') : 'its name' });
  }
  for (const c of cards) c.desks = db.desksHolding(c.key).map((d) => ({ id: d.id, name: d.name }));
  const out = { q: String(q), cards: cards.slice(0, FIND_MAX), desks, more: Math.max(0, cards.length - FIND_MAX) };
  return { ...out, state: cards.length || desks.length ? 'ok' : 'no data' };
}

module.exports = { deskName, partOfDay, parseKey, content, label, freeSpot, view, current, newDesk, open, rename, list, place, move, unplace, addNote, editNote, put, find, SIZE };
