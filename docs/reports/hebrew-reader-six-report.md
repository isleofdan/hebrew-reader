# FIELD REPORT — hebrew-reader-six — 23 Sep 2026

Session: cloud (no `flyctl` on the path). Branch `claude/hebrew-reader-six-setup-6dp9xr`, fast-forwarded onto `main` once on Dan's "push to main". Deploy run 18 finished green. Brief: the note "START HERE — hebrew-reader-six" on card `hebrew-satellite`. Baseline on a clean `main`: 129 server checks and 153 page checks, as session five reported. After: 139 server checks and 161 page checks.

## What stands

**Proven live by Dan (23 Sep 2026):**
- The deploy is live and the June lesson rebuilt on it.
- **לזנק is still Pa'al.** Dan opened it from the June lesson's word list after the rebuild. This is the brief's one live round, and it failed. No second round was run.

**Checked here only, against mocks:**
- **The review corrects word cards.** The review is given the lesson's word cards (word, lemma, part of speech, root, binyan). It may correct a card's root or binyan directly. A root or binyan it corrects in the guide also reaches the word's card.
- **Matching.** A fix matches its card by surface or lemma, among this lesson's cards only.
  - A correct card is left alone.
  - A wrong card is corrected and logged. The card records the before and after, and shows "Corrected by the lesson review: Pa'al → Nif'al" with the lesson's name below it.
  - A fix that matches two cards is refused and listed, never guessed.
  - A guide fix for a word with no card changes nothing else.
- **The spot follows the card.** A corrected verb moves to the corrected binyan's spot, keeping its status and touches. The phone page will not drill a binyan the verb does not have. The new spot is sent to the spine.
- **Guides on first open** already worked. It is now checked that two opens at once start one build, and that the import leaves pre-2026 lessons with no guide for that path to pick up.
- Screenshots (phone 412×915 and computer 1280×800, light and dark):
  - `docs/screenshots/lesson-card-corrected-{light,dark}-{phone,desktop}.png`
  - `docs/screenshots/lesson-building-{light,dark}-{phone,desktop}.png`

**Screen lines changed:**
- The "being built" line on a lesson page:
  - Before: "…this takes a minute or two."
  - After: "…this can take ten minutes or more; you can leave the page and come back."
- New on a corrected card: "Corrected by the lesson review: Pa'al → Pi'el", with the lesson's name below it.

## What the brief got wrong

1. **The session-five report is not at `docs/reports/hebrew-reader-five-report.md` on `main`.** It lives on the session-five branch and on the card.
2. **Step 2 was already built.** A lesson with no guide already built one on first open, with no duplicate builds. Only the checks were missing.
3. **"The cached word cards" did not exist when a lesson's first review ran.** Words were saved, and their cards made, only after the guide was saved. On the import every 2026 lesson is a first build, so the review would have seen no cards. See divergence 1.
4. **Mocks prove the mechanism, not the model's answer.** The live miss on לזנק passed every mock check, as in session five.

## Deliberate divergences

1. **Cards are made before the review.** These are the same card calls the word save makes, only earlier, with no extra model spend. DO NOT REVERSE: without it, a lesson's first review cannot correct any card.
2. **Card fixes come only from a review that was applied.** A discarded review corrects no card.
3. **A guide fix for a word with no card is skipped without a line.** Most guide items are phrases, and listing each as "refused" would bury the real refusals. A fix that names a card and matches none is refused and listed.
4. **The old spot is deleted locally** when no other card points at it. Its touches move to the corrected spot. Its mark on the spine is left as it was: nothing in the app deletes spine marks.
5. **The waiting line was reworded** ("ten minutes or more"). Every older lesson will show it on first open after the import, and live builds take 10–20 minutes.
6. **The close-out walk-through was one message, not one change per round.** The changes were already explained before the push.

## Dan's decisions this session

- "push to main": given once. Deploy run 18 was green.
- **"Don't act on the card"** (23 Sep 2026). He said this after the card gained three new notes during the session: a "hebrew-reader-seven" brief (nikud on word cards), its "addendum 1" (plain words for "map", "met" and "touch"), and a "combined" note folding both into this session.
  - None of that work was built.
  - This report is not filed on the card; Dan carries it.

## What the next brief needs to contain

- **The לזנק miss comes first.** Read what the live review did before building anything more on it. The June lesson page's review list shows it: "Reviewed: N corrections", then "Word cards corrected by the review (N)" and "Word card corrections not made (not guessed): …" when there are any. The server log also has a line "lesson N: card … (the lesson review)" or "card corrections refused: …".
- **Is the review's own prompt enough?** It names "לזנק is Pi'el, not Pa'al" as an example, and the model still did not fix the card. If the review was applied but never named the card, a server rule may be needed instead of model judgment, for example checking a card's binyan against the guide's vocabulary row for the same word.
- The nikud and plain-words work from the seven brief and its addendum, if the chat still wants it. Dan held it back from this session.

## Asks for the origin chat

1. **How to find out why לזנק was not corrected?** Recommended: the next session begins by having Dan read the June lesson's review list (one look, no rebuild), then fixes the cause. It should not rebuild again blind.
2. **Should the server correct a card when the guide's vocabulary row and the card disagree on binyan, without waiting for the review to name it?** Recommended: not yet. Decide after ask 1 shows whether the review saw the card at all.
3. **The old spine marks under a corrected verb's former id (e.g. `v:ז.נ.ק:paal`)**: delete them from the spine, or leave them? Recommended: leave them. They are a record, and nothing in the app reads them back.
4. **The nikud and plain-words briefs**: rerun as their own session, now that this one is closed? Recommended: yes, as their own session, after ask 1 is settled. They touch the same card display.
