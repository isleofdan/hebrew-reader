# FIELD REPORT — hebrew-reader-eight — 23 Sep 2026

Session: cloud (`flyctl` not on the path). Branch `claude/hebrew-reader-eight-setup-oetji6`, fast-forwarded onto `main` on Dan's "push to main"; deploy run 21 green. Brief: the note "START HERE — hebrew-reader-eight — 23 Sep 2026 (cloud)" on card `hebrew-satellite`. Baseline on a clean `main`: 158 server checks, 185 page checks, all passing. After: 171 server checks, 189 page checks, all passing. Session seven's report and second PLAN.md note were brought onto this branch first, as their own commit.

## What stands

**Proven live by Dan (23 Sep 2026, rebuild of "Daniel HEB 15jun26"):**
- **The review's corrections land.** "Reviewed: 14 applied, 0 dropped". Before: all 59 discarded because one broke the drill check.
- **לזנק is fixed.** "Verb cards checked: 3, corrected: 2", and the לזנק card reads Pi'el with "Corrected by the lesson review: Pa'al → Pi'el · שיעור עם גיא — 15.6.2026" (Dan's screenshot).
- **But the verb-card check got נוצץ wrong.** It changed the card from Pa'al to Pi'el. נוֹצֵץ is Pa'al of נ.צ.צ, and the same rebuild's review said so three times (its corrections 1, 8, 13). The card was right and is now wrong. Per the brief, no second round.
- **The לזנק card's nikud and note are stale.** Headword זָנַק and "in the text לִזְנֹק" are Pa'al pointings; the note says "The prefix ל- marks the infinitive in paal". The Pi'el forms are זִנֵּק / לְזַנֵּק. A binyan or root correction changes the field and nothing else on the card.
- The review still let one "acceptable either way … keeping as-is is fine" note through as a correction (its 3), since its text changed.
- Word cards corrected by the review: הממסד ס.ד.ר → י.ס.ד, בדיה ב.ד.י → ב.ד.ה, פוסט-עדתי ע.ד.ה → י.ע.ד. בדיה is doubtful (session seven's review said ב.ד.א).
- Refused (could not be placed): corrections that tried to edit JSON keys as text (`"takes_object":true`, `"deviation":"none"`, `"verb":"להחליט","takes_object":false`), a drill להקיז and cards מוכנים / היכון / צא that the guide does not have, and a word-card fix for במה with no value.
- Footer unchanged: 10 words saved · 27 phrases in the guide only · recorded on the spine · 2 could not be identified (עדה, עדתי).

**Checked here only, against mocks:**
- Corrections one at a time: all good → all applied; one breaker among several (a drill deviation "geminate") → that one dropped with the drill check, the rest applied; every correction breaking (drill and flags) → the guide kept as built, all listed. Each correction is checked on the guide as the ones before it left it.
- A correction whose find and replace are the same is skipped with no line anywhere (guide, word cards and takes_object alike).
- The drill check passes נוצץ (נ.צ.צ) as "pe-nun, doubled", "pe-nun and doubled", "doubled, pe-nun"; fails "pe-nun, geminate" (unlisted), "pe-nun, hollow" (not in the root) and "none, doubled".
- Verb-card check: all correct → one call, no change; one wrong → corrected through the review's card path (logged, "lesson review" on the card, spot moved, spine told); answers naming another lesson's word or a noun of this lesson → refused and listed; "Nif'al" and a pointed word accepted (false-rejection); a declining model → "not run" with the reason, guide still saved. Structured output, the guide model, 400 + 150 tokens a verb.
- Screenshots, phone 412×915 and computer 1280×800, light and dark: `docs/screenshots/lesson-review-{light,dark}-{phone,desktop}.png`.
- One page check (web font loaded on the card) failed on two of five runs in the sandbox and passed on the rest, including the final run; it is session seven's check and depends on Google Fonts answering in time here.

**Screen lines changed (before → after):**
- "Reviewed: 40 corrections" → "Reviewed: 40 applied, 0 dropped"; "Reviewed, not applied: 59 corrections proposed" + the reason → no longer produced (kept only for guides saved before this session).
- New: "Dropped, because the guide passed a check and the correction made it fail (M):", each line "<correction> — failed the drill check: <why>".
- New: "No correction was applied; the guide is kept as built."
- New: "Verb cards checked: N, corrected: M", opening to "Binyan of לזנק: Pa'al → Pi'el", "Every verb card was found correct.", "This lesson has no verb cards." or "Answers not used: …"; when the call fails, "Verb cards not checked: <reason>".
- "הסלמה: root ס.ל.מ → ס.ל.ם" → "Root of הסלמה: ס.ל.מ → ס.ל.ם" (it read right to left, with the arrow pointing at the old root).
- Drill check failure: "… gives no deviation from pe-nun, …, none" → "… none, alone or combined".

## What the brief got wrong

1. It expected the verb-card check to fix only wrong cards. Live, it also "fixed" a right one (נוצץ), against the review in the same rebuild. A second model call is another opinion, not a referee.
2. It treated the card's binyan as the whole correction. The card's pointed forms and note come from the original card call and stay Pa'al after the binyan becomes Pi'el.
3. Minor: step 2's "no change needed" rule assumed those notes come with find equal to replace. Live, one came with changed text ("keeping as-is is fine") and was applied.

## Deliberate divergences

1. Steps 1–3 are one commit, not three: they change the same function. Step 4 is its own commit, and a follow-up commit guards it.
2. A correction is checked against the checks the guide passes *just before it* (not only those the first guide passed): a correction that fixes a check and a later one that breaks it again is dropped. DO NOT REVERSE.
3. The guide-build prompt now allows a combined deviation ("pe-nun, doubled"), so the model can write what the check accepts.
4. The verb-card check runs on the guide model (not the card model), since the card model made the errors.
5. Card-correction lines on the page read English first ("Root of הסלמה: …"), each Hebrew piece isolated, so two roots no longer swap around the arrow. This applies to the review's word-card list too.
6. The verb-card check is wrapped so a failure never stops the lesson's words being saved.
7. No second live round after the נוצץ result, per the brief.

## Dan's decisions this session

- "push to main" (run 21, green).

## What the next brief needs to contain

- The verb-card check overrode a right card (נוצץ Pa'al → Pi'el) against the review's own corrections in the same rebuild. Both the review's corrections and the check's answers now touch cards with no tie-break.
- A binyan or root correction leaves the card's nikud (`pointed`) and note stale: לזנק shows זָנַק / לִזְנֹק and "infinitive in paal" under a Pi'el label.
- נוצץ's card is now wrong live (Pi'el) and needs putting back.
- The review writes JSON keys as find text (`"deviation":"none"`); those are refused, so real fixes (a drill deviation, takes_object) are lost that way.
- Imported 2026 lessons will meet all of this; the laptop import session is next per the card.
- This report and the PLAN.md close-out note are on the session branch; `main` carries the code up to run 21.

## Asks for the origin chat

1. When the verb-card check and the review disagree on a card (נוצץ), which wins? Recommended: neither alone. Correct a card only when the two agree, or when one proposes and the other did not speak about that card; list disagreements on the page as "not changed: the two checks disagree".
2. Should a root or binyan correction refresh the card's pointed forms and note? Recommended: yes. After any card correction, one small call re-points the headword and the word in the text and rewrites the note for the corrected binyan (the nikud fill's JSON-mode path, proven live).
3. How to put נוצץ back to Pa'al live? Recommended: fold it into ask 1. With the agreement rule, a rebuild would not have changed it. Add a one-time server step that reverts a card fix the review contradicted, logged, rather than a hand edit.
4. Should the review be told to write find text from the guide's text, never its JSON keys? Recommended: yes, one line in the review prompt, and let "field" name `deviation` and `takes_object` for drills so those fixes have a proper path.
