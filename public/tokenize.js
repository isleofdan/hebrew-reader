// Splits Hebrew text into words. Used by the reader page and by the smoke
// test (through Node), so both count words the same way.
//
// A word starts and ends with a Hebrew letter (nikud allowed) and may hold
// a maqaf, a geresh/gershayim, or a hyphen inside (צה"ל, תל-אביב, על־פי).
// Prefixed articles and prepositions stay part of the surface; markFor()
// below looks past one of them when tinting.
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

  // The one prefix list. PROCLITICS are the ones Dan may leave off when
  // typing a form on the phone page (lib/demand.js). READING_PREFIXES adds,
  // for tinting, the definite ה and the ב/ל/מ/כ family with ו or ש in front.
  // Each entry is one prefix: a token is stripped of one entry, never two.
  var PROCLITICS = ['ו', 'ש', 'ה', 'כש', 'וש', 'וכש', 'מש', 'לכש'];
  var READING_PREFIXES = PROCLITICS.concat(['ב', 'ל', 'מ', 'כ', 'וה', 'וב', 'ול', 'ומ', 'וכ', 'שה', 'שב', 'של', 'שמ', 'מה'])
    .sort(function (a, b) { return a.length - b.length; }); // the shortest reading first

  function bare(s) { return String(s || '').normalize('NFC').replace(/[\u0591-\u05c7]/g, ''); }

  // The mark a word on the page takes: the mark of its surface, or of a
  // lemma it equals, or — for a token of four letters or more — of the
  // token minus one listed prefix, compared with saved surfaces and lemmas.
  // `marks` is surface -> mark, `lemmas` lemma -> mark. Reads only.
  function markFor(surface, marks, lemmas) {
    lemmas = lemmas || {};
    var k = bare(surface);
    var hit = marks[surface] || marks[k] || lemmas[k];
    if (hit) return hit;
    if (k.replace(/[^\u05d0-\u05ea]/g, '').length <= 3) return null;
    for (var i = 0; i < READING_PREFIXES.length; i++) {
      var p = READING_PREFIXES[i];
      if (k.indexOf(p) !== 0 || k.length <= p.length + 1) continue;
      var rest = k.slice(p.length);
      hit = marks[rest] || lemmas[rest];
      if (hit) return hit;
    }
    return null;
  }

  return { words: words, sentenceAt: sentenceAt, sentenceSpan: sentenceSpan, count: count, WORD: WORD,
    PROCLITICS: PROCLITICS, READING_PREFIXES: READING_PREFIXES, markFor: markFor };
});
