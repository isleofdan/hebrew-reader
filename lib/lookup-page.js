'use strict';
// The Look up page (hebrew-lookup-one): a word typed or pasted, its card, the
// word saved as Dan's, and the search recorded on the card as a lookup on the
// Look up page — the record the page's "Looked up" list is read from.
//
// One card, one truth: the card is the reader's own. A word Dan already has a
// card for comes back as that card (the same `lookup.lookup` call, a cache
// hit, so its touch is recorded as for any open); only a word with no card
// asks the model, as POST /lookup always has (the word and an empty
// sentence). A card Dan confirmed is never written: nothing here touches a
// card's record, only its spot's status and its layers.

const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');
const spine = require('./spine');
const desk = require('./desk');
const tok = require('../public/tokenize.js');

const WORD_MAX = 60;
const bare = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '');

// The reader's "save": a spot's status set, and the mark sent to the spine
// (POST /spots/<id> calls this too). Answers { spot, spine }.
async function saveStatus(id, status) {
  const spot = db.setSpotStatus(id, status);
  console.log(`spot ${spot.id}: ${spot.status}`);
  const recorded = await spine.recordMark(spot, { lastArticleTitle: db.lastArticleTitle(spot.id) });
  return { spot, spine: recorded };
}

// A stored card the lookup can reach again by its own word and sentence
// (a card from before cards kept their sentence cannot be, and is passed by).
function reachable(row) {
  if (!row || row.sentence === null) return null;
  const again = db.getCard(lookup.contextHash(row.surface, row.sentence));
  return again && again.id === row.id ? { surface: row.surface, sentence: row.sentence } : null;
}

// Which card the typed word is: the card looked up before with this word and
// no sentence (POST /lookup's own cache); else the newest card met as this
// word, pointed or not; else the reader's own matching (lib/desk.js and the
// tints use it): a saved dictionary form, or any form met, alone or after one
// prefix. Answers { surface, sentence, by } or null (a new card).
function findCard(typed) {
  if (db.getCard(lookup.contextHash(typed, ''))) return { surface: typed, sentence: '', by: 'the word looked up before' };
  const plain = bare(typed);
  for (const s of [...new Set([typed, plain])]) {
    const at = reachable(db.newestCardFor(s));
    if (at) return { ...at, by: 'a card of this word' };
  }
  const mark = tok.markFor(plain, db.marksForSurfaces(), db.marksForLemmas());
  if (mark) {
    const at = reachable(db.newestCardOfSpot(mark.spot_id));
    if (at) return { ...at, by: 'the reader’s matching' };
  }
  return null;
}

// POST /lookup with { surface, origin: 'lookup' }: the card, the word saved,
// the search recorded. Answers what POST /lookup answers, plus { key,
// card_id, saved: { status, spine, already }, layer, references, found_by }.
async function search({ surface }) {
  const typed = String(surface || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!typed) throw new ReaderError(400, 'Type a word to look up.');
  if (typed.length > WORD_MAX) throw new ReaderError(400, `Look up one word (at most ${WORD_MAX} characters); this has ${typed.length}.`);
  const found = findCard(typed);
  const at = found || { surface: typed, sentence: '', by: 'a new card' };
  const answer = await lookup.lookup({ surface: at.surface, sentence: at.sentence });
  const row = db.getCard(lookup.contextHash(at.surface, at.sentence));
  const key = `word:${row.id}`;
  // saved as Dan's word at once, as the reader's save does; a word already
  // saved or marked solid keeps its status
  let saved = null;
  if (answer.spot) {
    if (answer.spot.status === 'new') {
      const s = await saveStatus(answer.spot.id, 'shaky');
      answer.spot = s.spot;
      saved = { status: s.spot.status, spine: s.spine, already: false };
    } else saved = { status: answer.spot.status, spine: null, already: true };
  }
  const layer = desk.lookupLayer(key, desk.PAGE, { origin: 'lookup' });
  console.log(`look up "${typed}": ${key} (${at.by})${saved ? `, ${saved.already ? `already ${saved.status}` : 'saved'}` : ', no spot to save'}`);
  const lookups = desk.layersOf(key).filter((l) => l.kind === 'lookup').length;
  return { ...answer, key, card_id: row.id, sentence: at.sentence, saved, layer, lookups, references: desk.full(key).references, found_by: at.by };
}

module.exports = { search, saveStatus, findCard };
