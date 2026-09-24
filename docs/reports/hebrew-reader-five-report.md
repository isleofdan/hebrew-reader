# FIELD REPORT — hebrew-reader-five — 23 Sep 2026

Session: cloud, branch `claude/hebrew-satellite-brief-n91kia`, fast-forwarded onto `main` six times on Dan's "push to main" (deploy runs 12–17, all green). Brief: the START HERE note on card `hebrew-satellite`, 22 Sep 2026. Checks against the local mocks: 129 server checks (from 94), 153 page checks (from 132).

## What stands

**Proven live by Dan (23 Sep 2026):**
- **Guide model.** `anthropic/claude-opus-4.6` is a valid OpenRouter id. No guide showed "Built with the fallback model."
- **June lesson guide, final rebuild.** Every one of the five checks is met, with no "Not met" line.
  - The review applied 40 corrections.
  - First drill לחשוש (ח.ש.ש, guttural and doubled); second להקיז (נ.ק.ז, the nun assimilates). That is the same second drill the project chat chose.
  - All 39 lines are in grammar sections. Vocabulary has nikud and spelling flags.
  - Of the five errors named from the first live guide, four are fixed: היכון Nif'al, להקיז נ.ק.ז, נוצץ Pa'al, עדה י.ע.ד. **לזנק is still Pa'al** (vocabulary row לִזְנוֹק and one grammar section); it is Pi'el לְזַנֵּק.
  - Smaller slips remain: two future forms in the לחשוש table disagree (תֶּחְשׁוֹשׁ / תֶּחְשַׁשׁ); בדיה is given as ב.ד.ה in the grammar and ב.ד.א in the vocabulary; the note on לנצח's binyanim is muddled.
- **"For Guy" box gone** (Dan's decision, filed on the card 22 Sep).
- **Prefixed tinting.** In a pasted paragraph, all seven forms tinted: בחסות, והממסד, לממסד, לבמה, ובבמה, החשיכה, שבלעדי.
- **Delete.** The test article "בדיקה של מילים מהשיעור" was deleted from the page with the in-page confirm, and Dan landed back on the list.
- **"Try again" links** show next to עדה and עדתי. Not tapped live.

**Checked here only, against mocks (not tapped live):**
- try again succeeding and failing (server checks);
- the import script against a fresh local site: three fixtures imported with the right dates, a non-Guy PDF and an image skipped, a second run skipping all three, `--dry-run`, and a wrong passphrase;
- the lesson delete route leaving spots, touches and the spine untouched.

**Screenshots** (phone 412×915 and desktop 1280×800, light and dark):
- `docs/screenshots/lesson-review-{light,dark}-{phone,desktop}.png`
- `docs/screenshots/reader-prefixed-{light,dark}-{phone,desktop}.png`
- `docs/screenshots/reader-delete-confirm-{light,dark}-{phone,desktop}.png`

## What the brief got wrong

1. **"A second failure leaves the lesson unsaved."** Live, with five all-or-nothing checks and a model that does not always follow a rebuild note, every rebuild tripped whichever check had not yet tripped (a drill label, then a single missing flag). Dan got nothing three times over.
2. **"A second model call … returns the guide corrected."** The whole guide written back by the guide model timed out live at five minutes and again at fifteen. A review has to answer corrections only.
3. **"The server checks [binyan and deviation] against the card data it already has."** The card data can be the wrong one: the live card for לזנק says Pa'al. A check that trusts it rejects a correct guide. The model's one-word `deviation` label also under-describes roots (ח.ש.ש labeled "doubled" is guttural too).
4. **`DELETE /articles/:id` was not new.** It existed since session one; only the lesson route and both pages' links were new.
5. **Mocks cannot show model time or model judgment.** Every live failure this session passed the mocks. The next brief should budget a live round per model-facing change, not assume one.

## Stack and precedent as observed

- **Deploy.** A push to `main` runs `.github/workflows/deploy.yml`, about 70 seconds, green each time. The sandbox cannot reach the live site or OpenRouter; results are read through GitHub Actions.
- **Timing.** A June-lesson guide build on the guide model takes several minutes; with one rebuild plus the review, 10–20 minutes. The review answering corrections completes well inside its limit.
- **Card cache.** The card cache holds Sonnet cards for the lesson's single-word items (from the word save). Several are wrong on binyan (לזנק Pa'al).

## Deliberate divergences

- **Save and warn instead of discard.** DO NOT REVERSE. After the one rebuild, the better attempt is saved; unmet checks go to the review and are named on the page ("Not met: …").
- **Review answers corrections, not a guide.** DO NOT REVERSE. Each correction is `{section, item, find, replace, why}`, plus `field` to fill an empty flag, vowel points or card note. The server applies them, refuses what it cannot place, and keeps the review unless it breaks a check the guide had met.
- **Drill check reads the root, not the label.** DO NOT REVERSE. A disagreeing card no longer fails a guide; it only blocks a false Nif'al claim.
- **Object claims sit per verb** (`verb_claims`) inside a grammar section, since one section can discuss two verbs.
- **Time limits.** Build 10 minutes (the brief implied the old 5), review 15.
- **Delete confirm.** In-page, not the browser's native dialog, so it can be screenshotted and styled.
- **One prefix list.** It moved to `public/tokenize.js` so the phone page and the reader share it.
- **The prompt reads only `guy-lesson-instructions-*.md`.** The committed chat guide never reaches the model.

## Dan's decisions this session

- **Drop the "For Guy" explanation** from guides and the print sheet: "I'll bring my own stuff back to him when I need to" (filed on the card 22 Sep). Built and live.
- **Six "push to main"** words, each deploy green.
- **"Step back … figure it out"** after the third failed live rebuild. This led to save-and-warn and the corrections-only review, and to Claude's commitment that the next rebuild's result, whatever it showed, goes to this report rather than into more rebuild rounds.

Rules added to Dan's global instructions this session, from error analysis:
- NEEDED FROM YOU holds every action Dan performs, steps included.
- A gate on model output ships with a false-rejection test.
- A model call's time limit comes from its expected output, not the mock.

## What the next brief needs to contain

- **The laptop import.** Commands, in Windows PowerShell; the laptop session verifies the folder path first:

  ```
  $env:APP_PASSWORD = "<the site passphrase>"
  node scripts/import-lessons.js "<Dropbox folder>\Hebrew\Guy Lessons" https://hebrew-reader-dan.fly.dev --dry-run
  node scripts/import-lessons.js "<Dropbox folder>\Hebrew\Guy Lessons" https://hebrew-reader-dan.fly.dev --build-guides-from 2026-01-01
  ```

  Budget 10–20 minutes per guide for the 2026 lessons, one at a time. The script prints one line per file and exits 1 if any failed.
- **The card errors.** The guide build never sees the word cards, and the review did not fix לזנק. A card fix needs its own step (ask 2).
- **A live round per model-facing change.** State its material in hand: the lesson, the page line to read, the expected result.

## Asks for the origin chat

1. **Keep save-and-warn (a guide is always saved, unmet checks shown) in place of "unsaved after a second failure"?** Recommended: yes. The old rule produced nothing three times live; the new one produced a guide meeting every check on its first live run.
2. **How should wrong word cards (לזנק Pa'al) get corrected?** Recommended: when the review corrects a word's binyan or root and that word has a cached card, the server updates the card too, logged and shown on the card as "corrected by the lesson review". This is a small next-session step, and needs no new model.
3. **Guides for the older lessons [DAN GATE — OpenRouter spend].** Import all fifty and build guides only for the 2026 lessons now; older ones build when first opened. Recommended: as stated. Each guide is one build, sometimes a rebuild, plus one review on the guide model.
4. **Fix the four smaller slips in the June guide** (לחשוש future forms, בדיה root, לנצח note, לזנק)? Recommended: leave them. They're shown here for the record; a later rebuild after ask 2 lands may fix לזנק on its own.
5. **Reinstate the old five-minute build limit?** Recommended: no. Keep ten for the build and fifteen for the review; live builds come close to five.
