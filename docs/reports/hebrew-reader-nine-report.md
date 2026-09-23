# FIELD REPORT — hebrew-reader-nine — 24 Sep 2026

Session: cloud (`flyctl` not on the path). Branch `claude/zealous-ramanujan-91acxg`, fast-forwarded onto `main` on Dan's "push to main"; deploy run 22 green. Brief: the note "START HERE — hebrew-reader-nine — 23 Sep 2026 (cloud)" on card `hebrew-satellite`. Baseline on a clean `main`: 171 server checks, 189 page checks, all passing. After: 188 server checks, 201 page checks, all passing. Session eight's report and PLAN.md note were brought onto this branch first, as their own commit.

## What stands

**Proven live by Dan (24 Sep 2026, after run 22):**
- **נוצץ is back to Pa'al.** Its card reads "root נ.צ.צ · Pa'al, present, ms", with "Restored: the verb check's change was contradicted by the lesson review: Pi'el → Pa'al". The note was rewritten for Pa'al ("Paal participle of the geminate root נ.צ.צ …"), so the refresh step works live too.
- **But לזנק was also put back to Pa'al. That is wrong: Dan confirmed Pi'el in session eight.** Its card now reads headword זָנַק, "in the text לִזְנֹק · root ז.נ.ק · Pa'al, infinitive", a Pa'al note ("Pa'al infinitive construct of a segolate-pattern verb …") and the same "Restored" line. The one-time step treats the June guide as the review's view when the review made no card fix. The guide must give לזנק as Pa'al somewhere (a vocabulary row, drill or flashcard). So the step judged the verb check's correct Pi'el as "contradicted". I flagged this risk to Dan before the push; the live check confirmed it.
- Per the brief ("if a result differs, report what the page shows and stop"), the third check (rebuild the June lesson) was **not run**. No second round. The step is recorded as done and will not run again.

**Checked here only, against stand-ins for the AI service and the spine:**
- The agreement rule, one test per case in step 1. Review silent and check proposes (the לזנק case): applied, marked "verb-card check". Review says the card's own value and check proposes a change (the נוצץ case): not changed, listed. Both propose the same fix: applied once, marked as both. Review proposes and check says correct: not changed, listed.
- Refresh: a corrected card is re-pointed with its note rewritten once, right after the correction. A card corrected before (no refresh record) gets one call on its first open and none on the second. A failed call is kept on the card with its reason and retried at the next open.
- One-time put-back, on a database shaped like the live one after session eight. The test guide gave לזנק as Pi'el, so the test restored only נוצץ. That is why the test passed and the live run did not. The step runs once, is recorded, and the next start says "already run".
- Drill fixes by field: a `deviation` fix passes the drill check; one that breaks it is dropped. A find text that is a JSON key is still refused, and so is a field fix naming the wrong current value. The review prompt carries the new line.
- Screenshots on phone 412×915 and computer 1280×800, light and dark: `docs/screenshots/lesson-review-*`, `lesson-card-corrected-*` (re-pointed card), `lesson-card-restored-*`. The refreshed card on screen is Nif'al (נחתם), not Pi'el: the test lesson has no Pi'el card to correct.

**Screen lines changed (before → after):**
- "Verb cards checked: N, corrected: M" → adds ", not changed: K" when the checks disagree. Each such card gets the new line "Not changed — the two checks disagree: <word>: review says X, verb check says Y".
- New under the verb-card check: "Restored, because the lesson review contradicted the verb check (N):" with "Binyan of <word>: Pi'el → Pa'al".
- Card: "Corrected by the lesson review: …" now names who made the correction: "Corrected by the verb check: …" or "Corrected by the lesson review and the verb check: …". Older entries keep "lesson review".
- Card: new line "Restored: the verb check's change was contradicted by the lesson review: <before> → <after>". The undone correction is hidden.
- Card: new line on a failed refresh: "Nikud and note not refreshed after the correction: <reason>".

## What the brief got wrong

1. "Live this should touch only נוצץ." It touched לזנק as well. The brief's rule ("the same rebuild's review contradicted") leaves open what counts as the review saying something when it made no card fix. Session eight's review stored only its applied card fixes and its change sentences, not its raw answer. The only remaining record of what the review read and let stand is the reviewed guide, and on לזנק that guide disagrees with the card Dan confirmed.
2. It assumed the review's view of נוצץ came through card corrections. It came through drill corrections ("three times", corrections 1, 8, 13), which never reach a card: a drill's verb reads "נוצץ (לנצוץ)", not the card's word.
3. "A refreshed Pi'el card" screenshot: the test lesson has no Pi'el correction. The screenshot shows a Nif'al one.

## Deliberate divergences

1. **What the review "says" when it proposes nothing is what its guide gives for the word** (vocabulary rows, drills, flashcards; a drill "נוצץ (לנצוץ)" names both words). Without this, the נוצץ case cannot be seen at all. The live לזנק result shows it is too broad when the guide itself is wrong. The step-1 agreement rule uses the same reading. On a rebuild it can only hold a card back, never change one on the guide's word alone.
2. The verb-card check now runs on the cards as they were made, before any correction, not "as the review left them". Its answer and the review's are then weighed together. DO NOT REVERSE: that is what keeps them two opinions.
3. A review card fix that names the card's own value is still listed as "unchanged" (session six's line), unless the check proposes otherwise.
4. Roots compare letter by letter; a final letter counts as different (ס.ל.מ → ס.ל.ם is a real correction). DO NOT REVERSE.
5. The refresh keeps the card's unpointed headword (its letters). A pointed form of other letters is refused, as the nikud fill refuses it, and the refusal counts as a failed refresh.
6. The restored card hides the correction it undid, rather than showing it next to the "Restored" line.
7. The restored-card screenshot is drawn from a server answer shaped like the step's output. The step itself is checked in the server checks.

## Dan's decisions this session

- "push to main" (run 22, green).

## What the next brief needs to contain

- **לזנק is wrong live: Pa'al, marked "Restored".** It needs putting back to Pi'el with a new one-time step, not a hand edit. The step would undo this session's put-back for לזנק only, or for any put-back whose word Dan named as confirmed, and log it. The card's refresh then re-points it for Pi'el (זִנֵּק / לְזַנֵּק).
- The guide is not a safe stand-in for the review's opinion on a card. The review should say so outright: for every verb card it read, a card-level verdict (right, or the fix). The agreement rule would then use that and ignore the guide.
- The June guide itself likely calls לזנק Pa'al somewhere. A rebuild may or may not correct that.
- Check 3 (rebuild of "Daniel HEB 15jun26") was not run. What a rebuild does to these two cards under the agreement rule is unproven live.
- The import (laptop session) should wait until לזנק is fixed and the agreement rule reads a real review verdict. Otherwise every imported lesson inherits the guide-as-review reading.

## Asks for the origin chat

1. How should לזנק go back to Pi'el? Recommended: a one-time server step that re-applies Pi'el to לזנק in the June lesson only, named in the step, logged, with a correction line "Corrected: Pi'el confirmed by Dan". No hand edit, no general rule.
2. What counts as the review's opinion of a card? Recommended: add a required per-verb-card verdict to the review's answer (word, "correct" or the fix), so the review always speaks about every verb card. Drop the guide as a stand-in for the review.
3. Should check 3 (the June rebuild) run in the next live round, after asks 1 and 2 land? Recommended: yes, as that round's last step. Expected: לזנק Pi'el and נוצץ Pa'al, both unchanged.
