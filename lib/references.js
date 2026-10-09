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
//
// `embed` says how a reference is shown inside the reader (hebrew-lookup-one,
// 9 Oct 2026, from scripts/reference-frames.mjs; docs/REFERENCES.md):
// 'frame' — the site's own page in a frame (it sends no X-Frame-Options and
// no frame-ancestors); 'copy' — the site refuses being framed (or cannot be
// framed), so the server fetches the page on Dan's tap and shows a cleaned
// copy. Kizur's https certificate names another host, so its link is http,
// which a page served over https cannot frame.

const REFERENCES = [
  { id: 'morfix', label: 'Morfix', domain: 'morfix.co.il', embed: 'copy', hint: 'Hebrew–English dictionary', url: (t) => `https://www.morfix.co.il/en/${encodeURIComponent(t)}` },
  { id: 'pealim', label: 'Pealim', domain: 'pealim.com', embed: 'copy', hint: 'verb tables by root and binyan', url: (t) => `https://www.pealim.com/search/?q=${encodeURIComponent(t)}` },
  { id: 'wiktionary', label: 'Wiktionary', domain: 'he.wiktionary.org', embed: 'frame', hint: 'etymology, forms, usage', url: (t) => `https://he.wiktionary.org/w/index.php?search=${encodeURIComponent(t)}` },
  { id: 'milog', label: 'Milog', domain: 'milog.co.il', embed: 'frame', hint: 'Hebrew dictionary', url: (t) => `https://milog.co.il/${encodeURIComponent(t)}` },
  { id: 'academy', label: 'the Academy', domain: 'hebrew-academy.org.il', embed: 'copy', hint: 'the Academy of the Hebrew Language’s rulings and articles', url: (t) => `https://hebrew-academy.org.il/?s=${encodeURIComponent(t)}` },
  { id: 'kizur', label: 'Kizur', domain: 'kizur.co.il', embed: 'copy', hint: 'abbreviations and acronyms', url: (t) => `http://www.kizur.co.il/search_word.php?abbr=${encodeURIComponent(t)}` },
  { id: 'sefaria', label: 'Sefaria', domain: 'sefaria.org', embed: 'frame', hint: 'classical sources and their dictionaries', url: (t) => `https://www.sefaria.org/search?q=${encodeURIComponent(t)}` },
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
