# FIELD REPORT — hebrew-reader-twelve — 26 Sep 2026

Session: cloud (`flyctl` not present). Brief: "START HERE — hebrew-reader-twelve — 25 Sep 2026 (cloud)" on card `hebrew-satellite`. Pull request #1 merged on Dan's word (the session merged it for him); deploy run 25 green, including its live-site answer check.

## What stands

**Proven live by Dan (26 Sep 2026, deploy run 25, on his Android phone):**
1. `/desk` opened an empty desk named for now ("Saturday 26 Sep · …"), saying it holds nothing yet.
2. 9 Feb 2026 lesson → להמר → "Put on the desk" → the card on the desk, pointed (הִימֵּר, in the text לְהַמֵּר), root ה.מ.ר · Pi'el.
3. Dragged on the desk (Chrome's "Desktop site" mode on the phone), reloaded: stayed where put.
4. "New card", typed הסלמה, reloaded: still there.
5. Find "המר": להמר under Cards, today's desk under Desks with "holds להמר".

**Checked against the local stand-ins only (254 server checks, from 224; 276 page checks, from 229 — 47 of them new, in `scripts/desk-pages.mjs`):**
- Desks, placements, note cards, born-from links; every write through one server module; nothing held only in the page.
- The desk page on a computer: move, resize by the corner, click to front, all surviving a reload; "note on a new card" with its grey line behind the cards; "remove from the desk" (the card stays findable); "New desk". Light and dark.
- "Put on the desk" from the reader's card and the phone page's quick lookup (the lesson path was also proven live); putting twice does nothing and says so.
- The Desks list: each desk drawn small as its layout (geometry checked against the placements), renamed in place, opened back exactly as left.
- Find with and without nikud; by root and by English meaning; a note by its text; a desk by name or by a card it holds; a card result dragged (computer) or put (phone) onto another desk as the same card.
- Phone width: the list grouped by born-from; a card opens its full view; a new card lands unplaced, first in the list, and the computer places it on next open.
- The one-time re-make of the 26 Jan card שוטטות as a noun: checked against a copy of the live data's shape (count 1, runs once, a card Dan confirmed is left alone). **Not seen live:** the sandbox cannot read the live server's log. Opening that card in the 26 Jan lesson would show "noun".
- The web-font page check: ten runs in a row passed in fresh browsers (the old way: 6 of 10).

## What the brief got wrong

1. **"Thursday 25 Sep"** — 25 Sep 2026 is a Friday. The app names desks by the real weekday; the check follows the calendar, not the brief.
2. **"The web-font check waits for the font to load"** assumed a timing flake. It was not timing: in the cloud sandbox the download of the font from Google Fonts sometimes fails outright (the face ends in "error", or the stylesheet never arrives). No wait mends that. The check now also reloads and tries again, at most three times, on a failed download.
3. **"Nikud on every headword the desk shows, as the reader does it"** needs the sentence a card was made for, which the database did not keep. Cards now keep it (new column); older cards get it when next opened or put on the desk. A card reached only through Find with no sentence gets its nikud asked for with no sentence.

## Deliberate divergences

1. **Find's results sit on the right of the desk on a computer**, as a panel, not below the strip, so a card can be dragged from them onto the visible desk. On the phone they sit above the list.
2. **"Put on the desk" is on every card of the phone page**, not only the quick lookup; it is the same card.
3. **A word is on a desk once**: a second card of the same word (another sentence) counts as already there.
4. **The past desk shown half-size "unasked, with pull forward"** from the mockup was not built: the steps did not name it, and "pull forward" is not defined (open it, or bring its cards here?). See ask 2.
5. **The small actions on a desk card show only while the mouse is on it** (always on a touch screen), so nothing on the desk asks to be looked at.
6. **A card's full view on the desk** (the reader's card, with its status buttons) opens from "open" on a computer and by a tap on the phone.

## Dan's decisions this session

- **Merging: ask, then the session does it — DO NOT REVERSE.** Dan, 26 Sep 2026, after being sent to a GitHub page that would not load on airplane Wi-Fi: "In the future can you just ask me for permission to merge rather than send me to GitHub to do it?" Recorded in his shared instructions (`isleofdan/claude-config`). A session asks one yes/no under NEEDED FROM YOU and, on yes, merges and checks the deploy. He asked that this become standard practice in the briefs too (ask 1).
- Android is fine for the live checks; the drag check was done in Chrome's "Desktop site" mode.

## What the next brief needs

- **Merge wording:** "ask Dan to approve the merge; the session merges", never "Dan taps Merge".
- **Data shape for thirteen and fourteen:** `card_links(child, parent, kind)` already takes other kinds (thirteen's branching and threads can add `branched-from`, `cut-from`); a card key is `word:<id>` or `note:<id>`, so new card kinds (an AI answer, an example, a reference lookup) can be `answer:<id>` and so on without touching placements. Layers on a card have no table yet. A thread is not stored: today it is "a card and everything born from it", computed from links. Fourteen's ink needs its own table keyed by card key; the reMarkable sheet can read `placements` for an arrangement.
- **Routes** are listed in PLAN.md (session twelve note); Find is `GET /desks/find?q=` and answers `cards`, `desks` (with `by_name`, `reasons`); a Threads column would add a third list.
- The live שוטטות re-make is unconfirmed by eye (see above).
- The 36 older lessons still build guides on first open (unchanged).

## Asks for the origin chat

1. Adopt "ask Dan to approve the merge; the session merges it" as the standard wording in every brief? **Recommended: yes** — Dan's own request.
2. Build the mockup's "past desk shown half-size in a corner, with pull forward"? **Recommended: define it first** — if "pull forward" means "open that desk", it adds little over the Desks list; if it means "bring its cards onto today's desk", say so and it goes into thirteen.
3. Have Dan open the 26 Jan lesson's שוטטות card once to confirm it now says noun? **Recommended: yes, as the first live check of session thirteen** — no separate round.
