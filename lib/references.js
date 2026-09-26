'use strict';
// The references, in one list, in Dan's order: the "Look up in" buttons on a
// card (session thirteen), the sites an answer on a card may search
// (`DOMAINS`, the web search's allowed_domains), and the Ask box's search
// links. The model names a reference and a term; the server builds the link
// here — the model never writes a reference URL.
//
// Link shapes as found on 26 Sep 2026 from search-index evidence (the
// sandbox could not open the sites themselves; see PLAN.md, session
// thirteen): Morfix needs /en/; Wiktionary's search form, because an
// inflected form such as להמר has no page of its own; the Academy's own
// dictionary database was reported offline, so its site search; Kizur is a
// dictionary of abbreviations.

const REFERENCES = [
  { id: 'morfix', label: 'Morfix', domain: 'morfix.co.il', hint: 'Hebrew–English dictionary', url: (t) => `https://www.morfix.co.il/en/${encodeURIComponent(t)}` },
  { id: 'pealim', label: 'Pealim', domain: 'pealim.com', hint: 'verb tables by root and binyan', url: (t) => `https://www.pealim.com/search/?q=${encodeURIComponent(t)}` },
  { id: 'wiktionary', label: 'Wiktionary', domain: 'he.wiktionary.org', hint: 'etymology, forms, usage', url: (t) => `https://he.wiktionary.org/w/index.php?search=${encodeURIComponent(t)}` },
  { id: 'milog', label: 'Milog', domain: 'milog.co.il', hint: 'Hebrew dictionary', url: (t) => `https://milog.co.il/${encodeURIComponent(t)}` },
  { id: 'academy', label: 'the Academy', domain: 'hebrew-academy.org.il', hint: 'the Academy of the Hebrew Language’s rulings and articles', url: (t) => `https://hebrew-academy.org.il/?s=${encodeURIComponent(t)}` },
  { id: 'kizur', label: 'Kizur', domain: 'kizur.co.il', hint: 'abbreviations and acronyms', url: (t) => `https://www.kizur.co.il/search_word.php?abbr=${encodeURIComponent(t)}` },
  { id: 'sefaria', label: 'Sefaria', domain: 'sefaria.org', hint: 'classical sources and their dictionaries', url: (t) => `https://www.sefaria.org/search?q=${encodeURIComponent(t)}` },
];

// The Ask box points into the five it has always used.
const ASK = REFERENCES.filter((r) => ['pealim', 'milog', 'morfix', 'wiktionary', 'academy'].includes(r.id));
const IDS = ASK.map((r) => r.id);
const DOMAINS = REFERENCES.map((r) => r.domain);

function byId(id) {
  return REFERENCES.find((r) => r.id === id) || null;
}

// The reference a link belongs to, by its host, or null.
function forUrl(u) {
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return null; }
  return REFERENCES.find((r) => host === r.domain || host.endsWith(`.${r.domain}`)) || null;
}

module.exports = { REFERENCES, ASK, IDS, DOMAINS, byId, forUrl };
