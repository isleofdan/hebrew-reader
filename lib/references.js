'use strict';
// The reference set the ask surface points into. One list, one file, so a
// later session can change it. The model names a reference and a term; the
// server builds the link here — the model never writes a URL.

const REFERENCES = [
  { id: 'pealim', label: 'Pealim', hint: 'verb tables by root and binyan', url: (t) => `https://www.pealim.com/search/?q=${encodeURIComponent(t)}` },
  { id: 'milog', label: 'Milog', hint: 'Hebrew dictionary', url: (t) => `https://milog.co.il/${encodeURIComponent(t)}` },
  { id: 'morfix', label: 'Morfix', hint: 'Hebrew–English dictionary', url: (t) => `https://www.morfix.co.il/${encodeURIComponent(t)}` },
  { id: 'wiktionary', label: 'Hebrew Wiktionary', hint: 'etymology, forms, usage', url: (t) => `https://he.wiktionary.org/wiki/${encodeURIComponent(t)}` },
  { id: 'academy', label: 'Hebrew Language Academy', hint: 'the Academy’s rulings and articles', url: (t) => `https://hebrew-academy.org.il/?s=${encodeURIComponent(t)}` },
];

const IDS = REFERENCES.map((r) => r.id);

function byId(id) {
  return REFERENCES.find((r) => r.id === id) || null;
}

module.exports = { REFERENCES, IDS, byId };
