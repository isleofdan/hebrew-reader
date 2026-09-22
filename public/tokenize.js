// Splits Hebrew text into words. Used by the reader page and by the smoke
// test (through Node), so both count words the same way.
//
// A word starts and ends with a Hebrew letter (nikud allowed) and may hold
// a maqaf, a geresh/gershayim, or a hyphen inside (צה"ל, תל-אביב, על־פי).
// Prefixed articles and prepositions stay part of the surface for now.
// Punctuation, digits and Latin text are not words.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HebrewTokenize = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var L = '[\\u05d0-\\u05ea\\u05b0-\\u05bd\\u05bf\\u05c1\\u05c2\\u05c4\\u05c5\\u05c7]';
  var INNER = '[\\u05be"\'\\u05f3\\u05f4\\u2010\\u2011-]';
  var WORD = new RegExp(L + '(?:' + INNER + '*' + L + ')*', 'g');

  // Every word with its offset: [{ surface, start, end }].
  function words(text) {
    var out = [];
    WORD.lastIndex = 0;
    var m;
    while ((m = WORD.exec(text)) !== null) {
      out.push({ surface: m[0], start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // The sentence around offset `at` in `text`: from the previous sentence
  // end (. ! ? or a line break) to the next one. Gershayim, geresh and maqaf
  // never end a sentence. Answers { start, end, sentence } with the
  // offsets of the trimmed sentence inside `text`.
  function sentenceSpan(text, at) {
    var start = at, end = at;
    while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
    while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
    if (end < text.length && /[.!?]/.test(text[end])) end++;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start: start, end: end, sentence: text.slice(start, end) };
  }

  function sentenceAt(text, at) { return sentenceSpan(text, at).sentence; }

  function count(text) { return words(text).length; }

  return { words: words, sentenceAt: sentenceAt, sentenceSpan: sentenceSpan, count: count, WORD: WORD };
});
