# FIELD REPORT — hebrew-reader-ten — 24 Sep 2026

Session: cloud (`flyctl` not on the path). Branch `claude/hebrew-reader-ten-wr59vn`, fast-forwarded onto `main` on Dan's "push to main"; deploy run 23 green. Brief: the note "START HERE — hebrew-reader-ten — 24 Sep 2026 (cloud)" on card `hebrew-satellite`. Baseline on a clean `main`: 188 server checks, 201 page checks, all passing. After: 204 server checks, 209 page checks, all passing. The web-font page check failed on two runs while the font host was slow, and passed on the third; it is unrelated to this change. Session nine's report and PLAN.md note were brought onto this branch first, as their own commit.

## What stands

**Proven live by Dan (24 Sep 2026, after run 23):**
- **לזנק is Pi'el again.** The card reads headword זִנֵּק, "in the text לְזַנֵּק · root ז.נ.ק · Pi'el, infinitive", with a Pi'el note ("The piel infinitive construct …"), "Confirmed by you, 23 Sep 2026", and "Corrected by the lesson review: Pa'al → Pi'el". The "Restored" line is gone.
- **נוצץ is unchanged:** Pa'al, root נ.צ.צ, its Pa'al note and its "Restored" line (right for נוצץ).
- **The June rebuild (check 3) left both cards unchanged.** לזנק is Pi'el and confirmed; נוצץ is Pa'al. The rebuilt page reads "Verb cards checked: 3, corrected: 0, not changed: 1", with "Not changed — you confirmed this card: לזנק". A check proposed a change to לזנק and the lock held. נוצץ has no line: neither check proposed a change to it.
- The first copy of the verb-card section Dan sent was stale: it came from before the rebuild was saved. It still showed session eight's "corrected: 2" and session nine's "Restored (2)". After a reload the rebuilt text was there. This is not a new round, only a re-read of the same page.

**Checked here only, against stand-ins for the AI service and the spine:**
- Step 1: a confirmed card survives a review fix on its own (the verb check not run), a verb-check fix the review is silent on, and both checks agreeing on a fix. Each time it is listed as kept and logged. Checks that propose nothing list nothing.
- Step 2 ran on a database shaped like the live one after session nine. It set לזנק to Pi'el, root ז.נ.ק, confirmed on 23 Sep 2026. It removed the "Restored" entry and the lesson page's "Restored" line for לזנק, and put the earlier correction back. It moved the spot, refreshed the card once (זִנֵּק / לְזַנֵּק, a note without "Pa'al") and logged the change. Count 1. נוצץ was untouched. The step never runs twice. On a fresh database it runs after session nine's step and touches nothing.
- Step 3 tests:
  - The לזנק case: the guide gives the card's value, while the review's verdict and the check both say Pi'el. Result: Pi'el, "agreed by both".
  - The נוצץ case: the guide is silent, the review's verdict says "correct" and the check says Pi'el. Result: not changed, listed.
  - A missing verdict while the check proposes a change: applied, even though the guide gives the card's own value. This proves the guide is no longer read.
  - False-rejection check: a verdict written as נִלְחַם with nikud and "Nif'al" is still read.
  - Verdicts naming another lesson's word, or a noun, are refused and listed.
  - The review prompt now asks for a verdict on every verb card.
  - The review's token limit is now 16,000 plus 150 per verb card.
- Screenshots on phone 412×915 and computer 1280×800, light and dark: `docs/screenshots/lesson-card-confirmed-*` and `lesson-kept-*`.

**Screen lines changed (before → after):**
- Card: a new first line in the correction box, "Confirmed by you, <date>".
- Lesson page: "Verb cards checked: N, corrected: M, not changed: K". K now counts confirmed cards a check proposed to change. Each such card gets the new line "Not changed — you confirmed this card: <word>".
- Card (June lesson, לזנק only): "Restored: the verb check's change was contradicted by the lesson review: Pi'el → Pa'al" → gone. "Corrected by the lesson review: Pa'al → Pi'el" is shown again.
- Card: a new label "Set by you: X → Y". It only appears when the one-time step makes a change that no existing correction explains. It was not used live.

## What the brief got wrong

1. "Dan confirmed לזנק as Pi'el live in session eight" is right, but the card's own record only carried the review's correction line. The step therefore restores that line instead of writing a new "confirmed by Dan" correction. The confirmation lives in a separate `confirmed` field, which the card displays.
2. "Drop the guide as a stand-in … everywhere else": session nine's one-time put-back still reads the guide. It is recorded as already run on the live site and cannot run there again. Rewriting it would have changed session nine's own tests. The rule that decides live card changes no longer reads the guide.

## Deliberate divergences

1. **For a verb card, the review's only opinion is its verdict.** A `word_cards` correction the review makes on a verb card is no longer read. The prompt now tells the review to correct verb cards by verdict only. Non-verb cards (root fixes such as הסלמה) still use `word_cards` and guide corrections, as before. DO NOT REVERSE: otherwise the review can speak twice about one card and contradict itself.
2. A "fix" verdict gives both root and binyan. The field that matches the card is not treated as part of the fix, unless neither field differs. In that case it is listed as unchanged, as session six's line did.
3. The confirmed check sits in two places: in the agreement rule, which lists it, and in the card-correction step, which refuses. The second catches any path added later, one-time steps included. DO NOT REVERSE.
4. Confirmed cards are still sent to both checks, so a proposal against them can be seen and listed. They are never changed.
5. The one-time step finds the June lesson by lesson date 2026-06-15 or a file name containing "15jun26", and names only לזנק.
6. The step is recorded as confirmed on 23 Sep 2026 (the session-eight date), as the brief says, not the date it ran.
7. The review's time limit also grows by 3 seconds per verb card, the same rule the verb check uses.

## Dan's decisions this session

- "push to main" (run 23, green).

## What the next brief needs to contain

- The planned control on the card for Dan to set a root or binyan himself can reuse `card.confirmed = { on, root, binyan }`. The lock and the "Not changed — you confirmed this card" line already work. The control only needs to write that field and the value through the same card-save path (`saveCard` in `lib/guy-lesson.js`, which moves the spot and tells the spine).
- The "Not changed — you confirmed this card" line does not say which check proposed what. On the live rebuild, something proposed a change to לזנק and the page cannot say whether it was the review, the verb check, or both. If Dan wants to see that, the line needs the proposals added.
- If the review leaves out a verdict on a verb card, the verb check alone can still change it. That is the brief's rule. It did not happen on the June rebuild. The count of missing verdicts is logged and saved on the guide (`review.verdicts_missing`), but not shown on the page.
- The laptop import can go ahead. The agreement rule now reads a real review verdict, and לזנק is fixed.

## Asks for the origin chat

1. Should the "you confirmed this card" line say what was proposed (for example "review proposed Pa'al")? Recommended: yes, as one short addition in the session that builds Dan's root and binyan control, since both sessions touch the same lines.
2. Should a missing review verdict be shown on the lesson page (for example "The review gave no verdict on: …")? Recommended: yes, one caption line under the review, in the same session. It is the only case where the verb check can change a card on its own.
3. Session nine's put-back is dead code on every database: it is recorded as run on the live site, and a fresh database has nothing for it to touch. Should it be removed? Recommended: no, leave it. It is small, recorded, and its tests document what happened live.
