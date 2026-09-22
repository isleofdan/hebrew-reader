'use strict';
// Dan's weakness categories, the initial set from his Difficulty Register.
// One list, one file, so a later session can replace it. The card's
// `categories` is always a subset of these ids.

const CATEGORIES = [
  { id: 'conjugation', label: 'conjugation', hint: 'the form of the verb: binyan, tense, person' },
  { id: 'sound-pattern-deviation', label: 'sound pattern deviation', hint: 'the word does not follow the pattern its root and binyan predict' },
  { id: 'preposition-government', label: 'preposition government', hint: 'which preposition the word takes' },
  { id: 'letter-order', label: 'letter order', hint: 'letters easily swapped when writing or reading' },
  { id: 'homophonous-spelling', label: 'homophonous spelling', hint: 'sounds like another word spelled differently' },
];

const IDS = CATEGORIES.map((c) => c.id);

module.exports = { CATEGORIES, IDS };
