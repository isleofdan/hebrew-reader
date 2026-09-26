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
const refs = require('./references');
const tok = require('../public/tokenize.js');

const SIZE = { word: { w: 260, h: 196 }, note: { w: 220, h: 140 } };
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

// "word:12" or "note:3" -> { kind, id }; anything else is refused. A layer
// on a card (session thirteen) is named the same way: "answer:<id>",
// "example:<id>", "lookup:<id>" (a typed note on a card is a note card).
const KINDS = ['word', 'note', 'answer', 'example', 'lookup'];
function parseKey(key) {
  const m = /^(word|note|answer|example|lookup):(\d+)$/.exec(String(key || ''));
  if (!m) throw new ReaderError(400, `A card is named "word:<id>" or "note:<id>" (a layer "answer:<id>", "example:<id>" or "lookup:<id>"); got ${JSON.stringify(key)}.`);
  return { kind: m[1], id: Number(m[2]) };
}

// What a card shows, read fresh from its own record every time.
function content(key) {
  const { kind, id } = parseKey(key);
  if (kind === 'answer') {
    const a = db.getAnswer(id);
    return { key, kind, question: a.question, answer: a.answer, links: a.links, made_at: a.made_at };
  }
  if (kind === 'example') {
    const x = db.getExample(id);
    return { key, kind, sentence: x.sentence, source_name: x.source_name, source_kind: x.source_kind, source_date: x.source_date, url: x.url, kept: x.kept, made_at: x.found_at };
  }
  if (kind === 'lookup') {
    const l = db.getLookup(id);
    const ref = refs.byId(l.reference);
    return { key, kind, reference: l.reference, label: ref ? ref.label : l.reference, term: l.term, url: ref ? ref.url(l.term) : null, made_at: l.at };
  }
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
  const cut = (t, empty) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 30 ? t.slice(0, 29) + '…' : t || empty; };
  if (c.kind === 'note') return cut(c.text, 'an empty note');
  if (c.kind === 'answer') return cut(c.question, 'a question');
  if (c.kind === 'example') return cut(c.sentence, 'an example');
  if (c.kind === 'lookup') return `looked up in ${c.label}`;
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
  return { desk, cards, links: deskLinks(cards.map((c) => c.key)), state: cards.length ? 'ok' : 'no data' };
}

// The grey lines between cards on a desk: born from, branched from, cut
// from. A card branched from a layer is drawn to the card the layer is on.
function deskLinks(keys) {
  const onDesk = new Set(keys);
  const out = [];
  for (const l of db.linksOf(keys)) {
    if (l.kind === 'layer') continue;
    const parent = cardOf(l.parent);
    if (onDesk.has(l.child) && onDesk.has(parent) && !out.some((o) => o.child === l.child && o.parent === parent)) out.push({ child: l.child, parent, kind: l.kind });
  }
  return out;
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
  if (!SIZE[c.kind]) throw new ReaderError(400, `${key} is a layer of its card; a layer is not put on a desk by itself.`);
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
// `free: true` gives a card not yet placed (typed on the phone) the next
// free spot, beside the card it was born from when that is placed.
function move(deskId, key, { x, y, w, h, front, free } = {}) {
  parseKey(key);
  const p = db.getPlacement(deskId, key);
  if (!p) throw new ReaderError(404, `Card ${key} is not on desk ${deskId}.`);
  if (free && x === undefined && y === undefined) {
    if (p.x !== null && p.y !== null) return p;
    const parent = db.linksOf([key]).find((l) => l.child === key && l.kind !== 'layer');
    const near = parent ? db.getPlacement(deskId, cardOf(parent.parent)) : null;
    const at = freeSpot(deskId, p.w, p.h, near);
    x = at.x; y = at.y;
  }
  const next = {
    x: x === undefined ? p.x : num(x, 'x', 0, FAR),
    y: y === undefined ? p.y : num(y, 'y', 0, FAR),
    w: w === undefined ? p.w : num(w, 'w', MIN.w, MAX.w),
    h: h === undefined ? p.h : num(h, 'h', MIN.h, MAX.h),
    z: front ? frontZ(deskId, p) : p.z,
  };
  return db.together(() => {
    const out = db.setPlacement(deskId, key, next);
    db.touchDesk(deskId);
    return out;
  });
}

// On top already, alone there: it stays; otherwise one above the top.
function frontZ(deskId, p) {
  const top = db.topZ(deskId);
  const atTop = db.placementsOf(deskId).filter((x) => x.z === top).length;
  return p.z === top && atTop === 1 ? p.z : top + 1;
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
    const said = String(sentence || '').trim();
    // the card for this word in this sentence; else (a card the phone page
    // showed from another sentence) the newest card of the word
    row = db.getCard(lookup.contextHash(s, said));
    if (row && row.sentence === null) db.setCardSentence(row.context_hash, said);
    if (!row) row = db.newestCardFor(s);
  }
  if (!row) throw new ReaderError(404, `No saved card for "${surface || card_id}": open the word's card first.`);
  const desk = current().desk;
  const out = place(desk.id, `word:${row.id}`);
  return { desk: db.getDesk(desk.id), key: out.placement.card, already: out.already, place: out.placement };
}


// --- a card's layers (session thirteen) ----------------------------------------------
// Under a card's entry, oldest first: examples found online that Dan kept,
// questions he asked with their answers, notes he typed, and where he looked
// the word up. A layer is a record of its own tied to its card by a 'layer'
// link; the card's entry is never touched, so a card Dan confirmed stays as
// he set it. A branched or cut card is a new note card with a link back.

const LAYER_KINDS = ['answer', 'example', 'lookup'];
const QUESTION_MAX = 1000;

// The card a key belongs to: itself, or the card it is a layer of.
function cardOf(key) {
  let k = key;
  for (let n = 0; n < 20; n++) {
    const up = db.parentsOf(k).find((l) => l.kind === 'layer');
    if (!up) return k;
    k = up.parent;
  }
  return k;
}

// A card (word or note), never a layer: a layer is reached through its card.
function cardContent(key) {
  const c = content(key);
  if (!SIZE[c.kind]) throw new ReaderError(400, `${key} is a layer, not a card: open the card it is on.`);
  if (c.kind === 'note') {
    const up = db.parentsOf(key).find((l) => l.kind === 'layer');
    if (up) throw new ReaderError(400, `${key} is a note on ${up.parent}, not a card of its own: open that card.`);
  }
  return c;
}

function layersOf(key) {
  const out = [];
  for (const l of db.childrenOf(key, 'layer')) {
    try { out.push({ ...content(l.child), layered_at: l.at }); } catch (e) { if (e.status !== 404) throw e; }
  }
  return out;
}

// Adds a layer (made by `make` inside the same write) to a card.
function addLayer(parent, make) {
  cardContent(parent);
  return db.together(() => {
    const key = make();
    db.addLink(key, parent, 'layer');
    for (const d of db.desksHolding(parent)) db.touchDesk(d.id);
    return content(key);
  });
}

// "Note here": a note card that is a layer of this card (not on any desk).
function noteLayer(parent, text) {
  const t = noteText(text);
  const out = addLayer(parent, () => `note:${db.addNote(t).id}`);
  console.log(`card ${parent}: note layer ${out.key}`);
  return out;
}

// An answer to a question asked on this card, with the links it leaned on.
function answerLayer(parent, { question, answer, links }) {
  const out = addLayer(parent, () => `answer:${db.addAnswer({ question, answer, links }).id}`);
  console.log(`card ${parent}: answer layer ${out.key} (${links.length} link(s))`);
  return out;
}

// Examples found online: each a layer, not yet kept. A url already on the
// card is not added twice. Answers the layers added.
function exampleLayers(parent, found) {
  cardContent(parent);
  const have = new Set(layersOf(parent).filter((l) => l.kind === 'example').map((l) => l.url));
  const added = [];
  for (const x of found) {
    if (have.has(x.url)) continue;
    have.add(x.url);
    added.push(addLayer(parent, () => `example:${db.addExample(x).id}`));
  }
  console.log(`card ${parent}: ${added.length} example(s) added, ${found.length - added.length} already there`);
  return added;
}

function keepExample(key, kept) {
  const { kind, id } = parseKey(key);
  if (kind !== 'example') throw new ReaderError(400, `Only an example is kept; ${key} is not one.`);
  db.setExampleKept(id, kept !== false);
  for (const d of db.desksHolding(cardOf(key))) db.touchDesk(d.id);
  return content(key);
}

// The word a reference is asked for: a verb met as its infinitive by that
// infinitive (dictionaries list להמר), else the dictionary form; unpointed.
function headword(c) {
  if (c.kind === 'word') {
    const k = c.card;
    const w = k.tense === 'infinitive' && k.surface ? k.surface : k.lemma || k.surface;
    return String(w || '').replace(/[֑-ׇ]/g, '');
  }
  return String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// "Look up in <reference>": the link to open, and a lookup layer recorded.
function lookupLayer(parent, reference) {
  const ref = refs.byId(reference);
  if (!ref) throw new ReaderError(400, `reference must be one of ${refs.REFERENCES.map((r) => r.id).join(', ')}; got ${JSON.stringify(reference)}.`);
  const term = headword(cardContent(parent));
  if (!term) throw new ReaderError(400, 'This card has no word to look up yet.');
  const out = addLayer(parent, () => `lookup:${db.addLookup({ reference: ref.id, term }).id}`);
  console.log(`card ${parent}: looked up in ${ref.label}`);
  return out;
}

// What a layer says, as a new card would carry it.
function layerText(c) {
  if (c.kind === 'example') return c.sentence;
  if (c.kind === 'answer') return `${c.question}\n\n${c.answer}`;
  if (c.kind === 'lookup') return `looked up in ${c.label}: ${c.term}`;
  if (c.kind === 'note') return c.text;
  return '';
}

// A new note card made from a card or a layer, on a desk beside the card
// it came from (not yet placed when `unplaced`, as on the phone).
function newCardFrom({ text, link, from, owner, desk_id, unplaced }) {
  const deskId = desk_id ? Number(desk_id) : current().desk.id;
  db.getDesk(deskId);
  return db.together(() => {
    const n = db.addNote(noteText(text));
    const key = `note:${n.id}`;
    db.addLink(key, from, link);
    const near = db.getPlacement(deskId, owner) ? owner : null;
    const { placement } = place(deskId, key, { near, unplaced });
    return { card: content(key), place: placement, desk_id: deskId, [link.replace('-f', '_f')]: from, owner };
  });
}

// "Branch a new card from here": from a layer, a note card carrying the
// layer's text; from the card itself, an empty note card. Linked
// branched-from what it came from.
function branch(from, { desk_id, unplaced } = {}) {
  const c = content(from);
  const owner = cardOf(from);
  cardContent(owner);
  const out = newCardFrom({ text: from === owner ? '' : layerText(c), link: 'branched-from', from, owner, desk_id, unplaced });
  console.log(`card ${out.card.key}: branched from ${from}`);
  return out;
}

// "Cut this card in two": the layer `at` and every layer after it move to a
// new note card whose text is the first moved layer's text, beside the card,
// linked cut-from it. The card keeps the rest and its entry.
function cut(key, at, { desk_id, unplaced } = {}) {
  cardContent(key);
  const layers = db.childrenOf(key, 'layer').map((l) => l.child);
  const i = layers.indexOf(at);
  if (i < 0) throw new ReaderError(400, `${at} is not a layer of ${key}: choose one of its layers to cut at.`);
  const moved = layers.slice(i);
  return db.together(() => {
    const out = newCardFrom({ text: layerText(content(at)), link: 'cut-from', from: key, owner: key, desk_id, unplaced });
    for (const m of moved) db.moveLayer(m, key, out.card.key);
    console.log(`card ${key}: cut at ${at}; ${moved.length} layer(s) moved to ${out.card.key}`);
    return { ...out, moved, kept: layers.slice(0, i) };
  });
}

// --- threads -------------------------------------------------------------------------

// A card with its history: its layers, every card branched or cut from it
// or from its layers, and theirs, in the order they grew. Answers
// [{ key, via, from, at, depth }], the card itself first.
function thread(root) {
  const nodes = [{ key: root, via: null, from: null, at: made(root), depth: 0 }];
  const seen = new Set([root]);
  for (let i = 0; i < nodes.length && nodes.length < 500; i++) {
    const n = nodes[i];
    for (const via of ['layer', 'branched-from', 'cut-from']) {
      for (const l of db.childrenOf(n.key, via)) {
        if (seen.has(l.child)) continue;
        seen.add(l.child);
        nodes.push({ key: l.child, via, from: n.key, at: l.at, depth: n.depth + 1 });
      }
    }
  }
  return [nodes[0], ...nodes.slice(1).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))];
}

// When a card or layer was made (a word card: when it was built).
function made(key) {
  const { kind, id } = parseKey(key);
  if (kind === 'word') { const r = db.getCardById(id); return r ? r.built_at : null; }
  try { return content(key).made_at || null; } catch { return null; }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "word → 2 examples kept → 1 question → 1 note · 1 branch"
function threadLine(root, nodes) {
  const cs = nodes.slice(1).map((n) => { try { return { ...n, c: content(n.key) }; } catch { return null; } }).filter(Boolean);
  const layers = cs.filter((n) => n.via === 'layer');
  const kept = layers.filter((n) => n.c.kind === 'example' && n.c.kept).length;
  const asked = layers.filter((n) => n.c.kind === 'answer').length;
  const notes = layers.filter((n) => n.c.kind === 'note').length;
  const looked = layers.filter((n) => n.c.kind === 'lookup').length;
  const branches = cs.filter((n) => n.via !== 'layer').length;
  const steps = [parseKey(root).kind];
  if (kept) steps.push(plural(kept, 'example kept', 'examples kept'));
  if (asked) steps.push(plural(asked, 'question', 'questions'));
  if (notes) steps.push(plural(notes, 'note', 'notes'));
  if (looked) steps.push(`looked up ${plural(looked, 'time', 'times')}`);
  return steps.join(' → ') + (branches ? ` · ${plural(branches, 'branch', 'branches')}` : '');
}

// The last time anything in a thread was made or changed.
function lastTouched(nodes) {
  let last = null;
  for (const n of nodes) {
    let t = n.at;
    if (parseKey(n.key).kind === 'note') { try { const e = db.getNote(parseKey(n.key).id).edited_at; if (!t || e > t) t = e; } catch { /* gone */ } }
    if (t && (!last || t > last)) last = t;
  }
  return last;
}

// --- where a card came from ------------------------------------------------------------

const DATE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  // a time is read on Tokyo's clock; a bare date as written
  if (String(iso).length > 10) { const t = tokyo(new Date(iso)); return `${t.day} ${DATE_MONTHS[t.month - 1]} ${t.year}`; }
  return `${Number(m[3])} ${DATE_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// { from: 'lesson' | 'article' | 'card', text, ... } or null: a word card
// from the lesson or article its word was first met in (its own sentence's
// first); a note card from the card it was born, branched or cut from.
function origin(key) {
  const { kind, id } = parseKey(key);
  if (kind === 'word') {
    const row = db.getCardById(id);
    if (!row || !row.spot_id) return null;
    const touches = db.touchesOfSpot(row.spot_id).filter((t) => t.lesson_id || t.article_id);
    const t = touches.find((x) => x.surface === row.surface) || touches[0];
    if (!t) return null;
    if (t.lesson_id) return { from: 'lesson', id: t.lesson_id, text: `Guy's lesson of ${t.lesson_date ? day(t.lesson_date) : t.lesson_title}` };
    return { from: 'article', id: t.article_id, text: `the article “${t.article_title}”` };
  }
  const up = db.parentsOf(key).find((l) => l.kind !== 'layer');
  if (!up) return null;
  let parent;
  try { parent = content(cardOf(up.parent)); } catch { return null; }
  const via = { 'born-from': 'Born from', 'branched-from': 'Branched from', 'cut-from': 'Cut from' }[up.kind] || 'Born from';
  return { from: 'card', key: parent.key, via, text: label(parent) };
}

// A card's full view: the card, its layers oldest first, and its footer.
function full(key) {
  const c = cardContent(key);
  const layers = layersOf(key);
  const examples = layers.filter((l) => l.kind === 'example');
  const kept = examples.filter((l) => l.kept);
  const shown = layers.filter((l) => l.kind !== 'example' || l.kept);
  const lastFound = examples.reduce((m, l) => (!m || l.made_at > m ? l.made_at : m), null);
  const nodes = thread(key);
  const branched = nodes.filter((n) => n.via && n.via !== 'layer').length;
  const desks = db.desksHolding(key).map((d) => ({ id: d.id, name: d.name }));
  return {
    card: c,
    layers,
    counts: { layers: shown.length, examples_found: examples.length, examples_kept: kept.length, found_on: lastFound ? day(lastFound) : null },
    layers_line: shown.length ? `${plural(shown.length, 'layer', 'layers')}, oldest first` : 'No layers yet',
    footer: { origin: origin(key), desks, branched },
    thread_line: threadLine(key, nodes),
    references: refs.REFERENCES.map((r) => ({ id: r.id, label: r.label, url: r.url(headword(c) || '') })),
    state: shown.length ? 'ok' : 'no data',
  };
}

// --- the example gate ------------------------------------------------------------------

// Does this sentence use the card's word? The reader's own matching: a word
// in the sentence, nikud ignored, is the card's surface or lemma, or any
// surface this word was met as, alone or after one prefix (ו, ש, ה, ב, ל …).
const plainOf = (w) => String(w || '').normalize('NFC').replace(/[֑-ׇ]/g, '');

// The forms of a word card's word the matching knows: its lemma, its surface,
// and every surface its word was met as.
function formsOf(c) {
  const k = c.card || {};
  const out = new Set([k.lemma, k.surface].filter(Boolean).map(plainOf));
  const row = c.card_id ? db.getCardById(c.card_id) : null;
  if (row && row.spot_id) for (const s of db.surfacesOfSpot(row.spot_id)) out.add(plainOf(s));
  return [...out];
}

function sentenceHasWord(sentence, c) {
  const k = c.card || {};
  const marks = {}, lemmas = {};
  for (const w of formsOf(c)) marks[w] = true;
  if (k.lemma) lemmas[plainOf(k.lemma)] = true;
  return tok.words(String(sentence || '')).some((w) => Boolean(tok.markFor(plainOf(w.surface), marks, lemmas)));
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
    q,
    plain,
    card(c) {
      if (c.kind === 'note') return Boolean(plain) && bare(c.text).includes(plain);
      const k = c.card;
      if (heb && [k.surface, k.lemma, k.root].some((f) => letters(f).includes(heb))) return true;
      return !heb && Boolean(plain) && bare(k.meaning_en).includes(plain);
    },
  };
}


// The chips under Find: where a card came from, and when.
const SOURCES = ['everything', 'guy', 'articles', 'online', 'notes', 'asked'];
const TIMES = ['month', 'year', 'any'];

// Which source chip a card answers to (null: only "everything").
function sourceOf(c) {
  if (c.kind === 'example') return 'online';
  if (c.kind === 'answer') return 'asked';
  if (c.kind === 'note') return 'notes';
  if (c.kind === 'word') { const o = origin(c.key); return o ? (o.from === 'lesson' ? 'guy' : 'articles') : null; }
  return null;
}

// Is `iso` inside the time chip, on Tokyo's calendar?
function inTime(iso, time, at = new Date()) {
  if (time === 'any' || !time) return true;
  if (!iso) return false;
  const a = tokyo(new Date(iso)), b = tokyo(at);
  return a.year === b.year && (time === 'year' || a.month === b.month);
}

// The words a card or layer is found by, for a match.
function matches(m, c) {
  if (c.kind === 'word' || c.kind === 'note') return m.card(c);
  const t = c.kind === 'example' ? c.sentence : c.kind === 'answer' ? `${c.question} ${c.answer}` : '';
  if (!t) return false;
  const heb = letters(m.q);
  return heb ? letters(t).includes(heb) : Boolean(m.plain) && bare(t).includes(m.plain);
}

// One line on where a result came from: "word · from Guy's lesson of 26 Jan
// 2026", "example · found online 25 Sep 2026 · on להמר".
function originLine(c) {
  const on = () => { const owner = cardOf(c.key); if (owner === c.key) return ''; try { return ` · on ${label(content(owner))}`; } catch { return ''; } };
  if (c.kind === 'word') { const o = origin(c.key); return `word${o ? ` · from ${o.text}` : ''}`; }
  if (c.kind === 'example') return `example · found online ${day(c.made_at)}${on()}`;
  if (c.kind === 'answer') return `asked · ${day(c.made_at)}${on()}`;
  const o = origin(c.key);
  return `note · ${day(c.made_at)}${on()}${o ? ` · ${o.via.toLowerCase()} ${o.text}` : ''}`;
}

// The cards a thread can start from: every card something grew from.
function threadRoots() {
  const roots = new Set();
  for (const p of db.grownParents()) {
    try { const r = rootOf(cardOf(p)); cardContent(r); roots.add(r); } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
  }
  return [...roots];
}

// Up through branched-from and cut-from links to the card the thread began at.
function rootOf(key) {
  let k = key;
  for (let n = 0; n < 50; n++) {
    const up = db.parentsOf(k).find((l) => l.kind === 'branched-from' || l.kind === 'cut-from');
    if (!up) return k;
    k = cardOf(up.parent);
  }
  return k;
}

const FIND_MAX = 60;

// Cards that match (word cards: headword, root, gloss; note cards: text;
// examples and answers: their text), threads that match anywhere in them (a
// card with everything that grew from it, once per card it began at), and
// desks that match (by name, or by holding a matching card — the answer says
// which card, and how many cards on that desk grew from it). `source` and
// `time` are the chips under the Find box.
function find(q, { source = 'everything', time = 'any' } = {}) {
  if (!SOURCES.includes(source)) throw new ReaderError(400, `source must be one of ${SOURCES.join(', ')}; got ${JSON.stringify(source)}.`);
  if (!TIMES.includes(time)) throw new ReaderError(400, `time must be one of ${TIMES.join(', ')}; got ${JSON.stringify(time)}.`);
  const m = matcher(q);
  const filters = { source, time };
  if (!m.plain) return { q: String(q || ''), filters, cards: [], threads: [], desks: [], state: 'no data', reason: 'Type a word to find.' };
  const wanted = (c) => (source === 'everything' || sourceOf(c) === source) && inTime(c.kind === 'word' ? made(c.key) : c.made_at, time);
  const cards = [];
  for (const row of db.wordCardsForFind()) {
    const c = content(`word:${row.id}`);
    if (m.card(c) && wanted(c)) cards.push(c);
  }
  for (const n of db.allNotes()) {
    const c = content(`note:${n.id}`);
    if (m.card(c) && wanted(c)) cards.push(c);
  }
  for (const x of db.allExamples()) {
    const c = content(`example:${x.id}`);
    if (matches(m, c) && wanted(c)) cards.push(c);
  }
  for (const a of db.allAnswers()) {
    const c = content(`answer:${a.id}`);
    if (matches(m, c) && wanted(c)) cards.push(c);
  }
  for (const c of cards) { c.origin_line = originLine(c); c.owner = cardOf(c.key); }
  // threads: a match anywhere in a card's history, told once, at its root
  const threads = [];
  for (const root of threadRoots()) {
    const nodes = thread(root);
    if (nodes.length < 2) continue;
    const hit = nodes.some((n) => { try { const c = content(n.key); return matches(m, c) && (source === 'everything' || sourceOf(c) === source); } catch { return false; } });
    const last = lastTouched(nodes);
    if (!hit || !inTime(last, time)) continue;
    const c = content(root);
    const desks = db.desksHolding(root).map((d) => ({ id: d.id, name: d.name }));
    threads.push({ key: root, card: c, label: label(c), line: threadLine(root, nodes), last_touched: last, last_day: day(last), desks,
      where: `last touched ${day(last)} · ${desks.length ? `on ${plural(desks.length, 'desk', 'desks')}` : 'on no desk'}` });
  }
  threads.sort((a, b) => (a.last_touched < b.last_touched ? 1 : -1));
  // a word card matches on any desk it is on under any of its sentences
  const spots = new Set(cards.filter((c) => c.kind === 'word' && c.spot).map((c) => c.spot.id));
  const keys = new Set(cards.map((c) => cardOf(c.key)));
  const holds = (placedKey) => {
    if (keys.has(placedKey)) return true;
    const k = parseKey(placedKey);
    if (k.kind !== 'word') return false;
    const row = db.getCardById(k.id);
    return Boolean(row && row.spot_id && spots.has(row.spot_id));
  };
  const desks = [];
  for (const d of list().items) {
    if (!inTime(d.touched_at, time)) continue;
    const placed = db.placementsOf(d.id).map((p) => p.card);
    const hit = placed.filter(holds);
    // a card that grew from another card that matched is told as part of it
    const parents = new Map(db.linksOf(placed).filter((l) => l.kind !== 'layer').map((l) => [l.child, cardOf(l.parent)]));
    const grewFromHit = (key) => { for (let k = parents.get(key), n = 0; k && n < 50; k = parents.get(k), n++) if (hit.includes(k)) return true; return false; };
    const why = hit.filter((key) => !grewFromHit(key))
      .sort((a, b) => (parseKey(a).kind === parseKey(b).kind ? 0 : parseKey(a).kind === 'word' ? -1 : 1))
      .map((key) => ({ card: key, label: label(content(key)), grown: placed.filter((k) => k !== key && grownFrom(k, key)).length }));
    const byName = bare(d.name).includes(m.plain) || Boolean(letters(q) && letters(d.name).includes(letters(q)));
    const reason = why.map((w) => `${w.label}${w.grown ? ` and ${w.grown} card${w.grown === 1 ? '' : 's'} from it` : ''}`).join('; ');
    if (why.length || byName) desks.push({ ...d, by_name: byName, reasons: why, reason });
  }
  for (const c of cards) c.desks = db.desksHolding(cardOf(c.key)).map((d) => ({ id: d.id, name: d.name }));
  const out = { q: String(q), filters, cards: cards.slice(0, FIND_MAX), threads, desks, more: Math.max(0, cards.length - FIND_MAX) };
  return { ...out, state: cards.length || threads.length || desks.length ? 'ok' : 'no data' };
}

// Did card `k` grow from card `from` (born, branched or cut, through layers)?
function grownFrom(k, from) {
  let cur = k;
  for (let n = 0; n < 50; n++) {
    const up = db.parentsOf(cur).find((l) => l.kind !== 'layer');
    if (!up) return false;
    cur = cardOf(up.parent);
    if (cur === from) return true;
  }
  return false;
}

// --- the past desk in a corner -------------------------------------------------------

// The desk not opened for the longest time that holds at least one card,
// never the desk open now; null when there is none.
function pastDesk() {
  const now = db.latestDesk();
  const d = db.listDesks().filter((x) => (!now || x.id !== now.id) && db.placementsOf(x.id).length)
    .sort((a, b) => (a.touched_at < b.touched_at ? -1 : a.touched_at > b.touched_at ? 1 : a.id - b.id))[0];
  if (!d) return { desk: null, state: 'no data' };
  const item = list().items.find((x) => x.id === d.id);
  return { desk: item, state: 'ok' };
}

module.exports = {
  deskName, partOfDay, parseKey, content, label, freeSpot, view, current, newDesk, open, rename, list, place, move, unplace, addNote, editNote, put, find, SIZE,
  KINDS, LAYER_KINDS, QUESTION_MAX, cardOf, cardContent, layersOf, noteLayer, answerLayer, exampleLayers, keepExample, lookupLayer, headword, layerText,
  branch, cut, thread, threadLine, lastTouched, origin, full, sentenceHasWord, formsOf, day, pastDesk, rootOf, SOURCES, TIMES,
};
