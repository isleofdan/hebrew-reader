# FIELD REPORT — hebrew-reader-two — 22 Sep 2026

For the Personal Shipyard chat, from the Claude Code cloud session that built the second round of the Hebrew reader: touches to the spine, the thin flag, the phone demand page, the ask surface and the lesson sheet.

## What stands

All seven steps of the brief are built, checked against the local mocks, and pushed on branch `claude/hebrew-satellite-brief-2sqmao` (one commit per step). Checks: 60 server checks (`npm run smoke`) and 40 page checks (`npm run screenshots`) pass, up from the 26 and 12 this session measured at baseline (the brief said 25 and 14). Screenshots at phone 412×915 and desktop 1280×800 are in `docs/screenshots/`.

**Proven** in the sandbox against the mocks (the check behind each is named):

1. **Touches to the spine.** `spots.on_spine` added by a migration on start; set for every spot already shaky or solid (checked against a database in session one's shape with one shaky and one new spot); set on every successful spine PUT. A card opened on a marked spot sends exactly one PUT with status unchanged, `last_seen_at` now and `touches` up by one (the spine mock counts PUTs per item); a card opened on an unmarked spot sends none. Quick lookups and demand Check/Show go through the same lookup, so they count too.
2. **Thin flag on the index.** An article under 200 characters shows a small grey mark and "thin — the page gave little text; paste the article instead" on its row only, derived from the stored text (server check on `GET /articles`; page check on both viewports: `index-thin-phone.png`, `index-thin-desktop.png`).
3. **The demand, server side.** `GET /demand` chooses a verb spot shaky first, then new, least recently touched first, skipping `?after=`; cuts the sentence holding the surface from the stored article and blanks it; returns root, binyan, tense, person, meaning, the article title and the piece's other mapped words; a translation from one model call, cached by sentence hash, or `null` when the model refuses. `POST /demand/check` accepts the bare surface and the surface minus one proclitic (`ו, ש, ה, כש, וש, וכש, מש, לכש`), ignoring nikud, punctuation and spaces, keeping final letters; rejects the wrong form; `POST /demand/show` reveals exactly the surface the article held. Both record a touch and reach the spine. No item → `{state: "no data", reason}` in one sentence. Refusals name the field and its shape.
4. **The phone page** at `/phone`: the sentence with its gap, the `root · binyan · tense · person` line, a right-to-left "Your form" input, Check (green fill and the card on a right answer; "not that — try again or Show" with the text kept on a wrong one), Show (plain fill and the card), Next (a different spot), "Also from this piece" (each word opens its card), "Quick lookup" with the caption "A lookup counts as a touch on your map." The index header has a "phone" link, shown first under 600 px. Page checks on both viewports; nothing clipped; Hebrew right-to-left. Shots: `phone-gap-*.png`, `phone-check-*.png`, `phone-show-*.png`.
5. **Checks and screenshots** as above.
6. **Ask surface.** `POST /ask {question, article_id?}`: one model call with a fixed system message naming the reference set (`lib/references.js`: Pealim, Milog, Morfix, Hebrew Wiktionary, the Academy); the model returns a brief answer with "(not sure)" marks and one (reference, term) per claim; the server builds every URL. With an article, its mapped words go into the question, and the mock proves "which Nif'al forms are in this piece" is answered from that data. The reader's right column has the Ask box above "This piece against your map"; on phone it sits below the article (checked by position). Shots: `reader-ask-*.png`.
7. **Lesson sheet.** `GET /make/lesson?articles=N` (default 5): a Markdown download of every spot touched two or more times across the N most recent articles, Nif'al first, then other binyanim, then non-verbs, each with surfaces, root, binyan, meaning, one sentence, status, touch count; header names the articles by title and date; nothing qualifying → one line. `/sheet.html?articles=N` is the print page (no chrome, serif Hebrew, A4 margins, a writing line under each word). Buttons "Lesson sheet" and "reMarkable sheet" in the Ask column. "Deck" not built. Shots: `sheet-*.png`.

**Designed, not yet proven live** (the sandbox reaches no outside site): OpenRouter answering the translation and ask prompts, the spine taking the touch PUTs, the deploy. The live proof is the Actions run after Dan's "push to main" and Dan's look, recorded below.

## The deploy and Dan's look

_Pending at the time of writing. This section is updated when the push to main and Dan's checks are done._

- GitHub Actions deploy run after "push to main": pending.
- Dan's look: (1) open https://hebrew-reader-dan.fly.dev/phone on the phone and try one Check; (2) open an article on the desktop and open one card, then check that `list_marks app=hebrew-reader` shows that spot's touch count rose: pending.

## What the brief got wrong (carry into the next brief)

1. **The baseline counts.** The runners printed 26 server checks and 12 page checks at the start of this session, not 25 and 14. Next brief: 60 and 40.
2. **Only `POST /demand/check` was named** for Check and Show. Show needs its own route (`POST /demand/show`), since Check requires `typed` and refuses without it.
3. **"Reuse `GET /marks-for-article/:id`" for the other mapped words.** That route returns every surface in the cards cache, not the words of one article; the demand intersects the map with the article's own words (the shared tokenizer) and, like the reader's side list, leaves solid words out.
4. **The sentence for the phone page and the reader's card context must be cut the same way**, or a Check on the phone misses the card the reader cached and calls the model again. The brief did not say so; this session made `sentenceSpan` in `public/tokenize.js` the one rule for both.

## Deliberate divergences — DO NOT REVERSE

- **One model transport** (`lookup.chat`) for the card, the translation and the ask. The card prompt string is untouched; only the plumbing moved.
- **The card's rendering lives in `public/card-ui.js`**, shared by the reader and the phone page; `card.js` is the reader's glue only. The brief said "same card component" and this is how it is one.
- **Touches are awaited.** A card open on a marked spot waits for the spine PUT (8 s timeout) so the footer can say "recorded on the spine" and the checks can count deterministically. If the spine is slow this shows as a slower card open on marked words only.
- **`demandCandidates` orders untouched spots as least recent of all** and the demand simply skips them (no sentence); the "no data" reason distinguishes "no verb on the map" from "no sentence on record".
- **Translations that fail are not cached**, so a refusal is retried on the next open rather than remembered.
- **The lesson sheet's touch count is the count within the N articles**, not the spot's lifetime count.

## Dan's decisions this session

- Touches to the spine only for spots already on the spine (from the Personal Shipyard chat, 22 Sep 2026; carried into the brief).
- Prefixed forms stay separate surfaces in the reader; the demand accepts the form minus a proclitic when typed (the brief's list).
- The card prompt is untouched; Dan judges card quality over a few days.
- "Push to main": pending Dan's word.

## What the next brief needs to contain

- The reader has five surfaces now: index, reader (with Ask and Make), `/phone`, `/sheet.html`, login. The routes are listed in `PLAN.md`.
- The demand's choice rule and the proclitic list are in `lib/demand.js`; the reference set in `lib/references.js`; the sheet's grouping in `lib/lesson.js`. Change those files, not the pages, to change the behavior.
- Local checks: `npm run smoke` (60) and `npm run screenshots` (40), ports 8790–8797.
- The scheduled hunt and its line on the phone page remain out of scope; the phone page has no hunt line and no counters — pull-only holds.
- Branch rule unchanged: build on the session's branch, then Dan says "push to main".

## Asks, numbered, each with a recommended answer

1. **Card open waits for the spine.** Marked words take a spine round trip to open (usually well under a second; up to 8 s if the spine is down). Keep it, or fire the touch without waiting and drop the footer line? Recommended: keep it for a few days of use; if Dan feels it, the next session makes the touch fire-and-forget on the reader only.
2. **The demand's "no data" when every verb is solid.** Once Dan marks his verbs solid, the phone page says so and offers nothing. Should solid verbs come back after a long gap? Recommended: no; solid means solid, and the brief rules out due dates. The reader adds new shaky verbs as he reads.
3. **Translation quality.** The demand's English line is the model's; a wrong one misleads more than none. Should the page show it at all until Dan has seen a few? Recommended: show it; Dan reports a bad one and the next session either tightens the prompt in `lib/demand.js` or adds a "hide translations" toggle.
4. **Lesson sheet window.** Fixed at the five most recent articles from the buttons. Recommended: leave the buttons at 5; the URL takes `?articles=N` for any other window.

## Screenshots

- Phone page, gap open: `docs/screenshots/phone-gap-phone.png`, `docs/screenshots/phone-gap-desktop.png`
- Phone page, after a right Check: `docs/screenshots/phone-check-phone.png`, `docs/screenshots/phone-check-desktop.png`
- Phone page, after Show: `docs/screenshots/phone-show-phone.png`, `docs/screenshots/phone-show-desktop.png`
- Index with a thin article: `docs/screenshots/index-thin-phone.png`, `docs/screenshots/index-thin-desktop.png`
- Reader with the Ask box answered: `docs/screenshots/reader-ask-phone.png`, `docs/screenshots/reader-ask-desktop.png`
- Print sheet: `docs/screenshots/sheet-phone.png`, `docs/screenshots/sheet-desktop.png`
