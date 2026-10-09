# The seven references

The references a word card is looked up in, in Dan's order, as
`lib/references.js` lists them. The server builds every link there; the
model never writes one. Since hebrew-lookup-one each opens **inside the
reader**, never in a new tab, in one of two ways set per reference by the
field `embed`:

- `frame`: the site's own page, in a frame. Used when the site lets another
  site frame it: no `X-Frame-Options` and no `Content-Security-Policy`
  `frame-ancestors` that leaves other sites out.
- `copy`: the reader's server fetches the page for the word when Dan taps
  (20-second limit), strips scripts, inline handlers and forms, and shows the
  copy in a sandboxed frame under the line "Shown from a copy fetched by the
  reader; open the site for the live page". A copy is kept seven days
  (`reference_pages`), so the same word on the same reference is not fetched
  again in that time. A fetch that fails shows "The site did not answer;
  open it directly" with the link.

## What each is, and how it is asked

| Reference | What it is | Link shape | `embed` |
| - | - | - | - |
| Morfix | Hebrew–English dictionary | `https://www.morfix.co.il/en/{word}` | copy |
| Pealim | verb tables by root and binyan | `https://www.pealim.com/search/?q={word}` | copy |
| Wiktionary (Hebrew) | etymology, forms, usage | `https://he.wiktionary.org/w/index.php?search={word}` | frame |
| Milog | Hebrew dictionary | `https://milog.co.il/{word}` | frame |
| the Academy | the Academy of the Hebrew Language's site search | `https://hebrew-academy.org.il/?s={word}` | copy |
| Kizur | dictionary of abbreviations | `http://www.kizur.co.il/search_word.php?abbr={word}` | copy |
| Sefaria | classical sources and their dictionaries | `https://www.sefaria.org/search?q={word}` | frame |

`{word}` is the unpointed word, URL-encoded: the infinitive for a verb card
met as its infinitive (להמר), else the dictionary form (`desk.headword`).

## The frame test (9 Oct 2026, the rented Linux machine)

`node scripts/reference-frames.mjs` asks each reference for להמר (Kizur
also for צה"ל, Sefaria also for בראשית) with one plain GET, twice: once
as a browser, once as a plain client, because a bot wall may answer one of
them with a challenge page that carries none of the site's own headers. A
refusal in either answer counts. 20-second limit.

| Reference | Word | Status (browser / plain) | X-Frame-Options | frame-ancestors | Word in the page | Can be framed |
| - | - | - | - | - | - | - |
| Morfix | להמר | 202 (AWS WAF challenge, empty page) / 403 | SAMEORIGIN | — | no | no (X-Frame-Options: SAMEORIGIN) |
| Pealim | להמר | 200 / 200 | SAMEORIGIN | — | yes | no (X-Frame-Options: SAMEORIGIN) |
| Wiktionary | להמר | 200 / 200 (the search lands on the page המר) | — | — | yes | yes |
| Milog | להמר | 200 / 200 | — | — | yes | yes |
| the Academy | להמר | 403 (Cloudflare challenge) / 403 (Cloudflare challenge) | SAMEORIGIN | — | no | no (X-Frame-Options: SAMEORIGIN) |
| Kizur | להמר | 200 / 200 (over http) | — | — | yes (in "no abbreviations found") | no (http only) |
| Kizur | צה"ל | 200 / 200 (over http) | — | — | yes | no (http only) |
| Sefaria | להמר | 200 / 200 | — | — | yes (title and search box) | yes |
| Sefaria | בראשית | 200 / 200 | — | — | yes | yes |

Why each landed where it did:

- **Morfix → copy.** Its own pages send `X-Frame-Options: SAMEORIGIN`
  (seen on the plain client's 403, a Morfix page with its full CSP). The
  browser-like request got only an AWS WAF challenge (202, empty body, no
  headers of the site's own), which is why one probe alone would have
  called it frameable. From this machine the copy fetch is refused too
  (the challenge or 403), so expect "The site did not answer; open it
  directly" unless Fly's address is treated differently.
- **Pealim → copy.** `X-Frame-Options: SAMEORIGIN`; the fetch answers 200
  with the results for להמר, so the copy works.
- **Wiktionary → frame.** No `X-Frame-Options`; its CSP has no
  `frame-ancestors`. The search for להמר lands on the entry המר.
- **Milog → frame.** No `X-Frame-Options`, no `frame-ancestors`; the word's
  page answers 200 with the word in it. (In an earlier probe the same hour
  Cloudflare answered the browser-like request 403; framed, the page is
  loaded by Dan's own browser, not by this server.)
- **the Academy → copy.** Its Cloudflare front answers both requests with a
  challenge (403) carrying `X-Frame-Options: SAMEORIGIN`. A refusal, so
  `copy`; the server's fetch meets the same challenge, so expect "The site
  did not answer; open it directly".
- **Kizur → copy, and its link is now http.** Over https the site's
  certificate names another host (`vmilog2.spd.co.il`), so neither the
  reader nor a browser can open `https://www.kizur.co.il` cleanly; the link
  shape session thirteen wrote (https) is why "a Kizur lookup did not
  connect". Over http it answers 200. A page served over https (the reader)
  cannot frame an http page (mixed content), so the server fetches the copy
  over http. For a modern word it finds nothing: "לא נמצאו קיצורים לערך:
  להמר" (no abbreviations found). For צה"ל it gives "צבא הגנה לישראל".
- **Sefaria → frame.** No `X-Frame-Options`, no `frame-ancestors`. The
  search page fills its results by script, so the frame shows the live
  results. Its search API (the same search) gave, for להמר, 102 hits by
  lemma and 13 exact, all in classical texts (Otzar La'azei Rashi on II
  Kings and Isaiah, a Josephus translation): not the modern verb. For
  בראשית, over 10,000 hits; its dictionary has an entry for רֵאשִׁית (BDB)
  and none for להמר.

The sites change; run the script again before trusting this table, and
change `embed` only from a recorded run.
