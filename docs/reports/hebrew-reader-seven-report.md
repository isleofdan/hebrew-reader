# FIELD REPORT — hebrew-reader-seven — 23 Sep 2026

Session: cloud (`flyctl` not on the path). Branch `claude/hebrew-reader-seven-6y3qed`, fast-forwarded onto `main` twice on Dan's "push to main"; deploy runs 19 and 20 finished green. Brief: the note "START HERE — hebrew-reader-seven — 23 Sep 2026 (cloud, v2)" on card `hebrew-satellite`. Baseline on a clean `main`: 139 server checks and 161 page checks, as session six reported. After: 158 server checks and 185 page checks, all passing.

## What stands

**Proven live by Dan (23 Sep 2026):**
- **The review runs now.** On the June lesson's rebuild it answered 59 corrections. Before, it said "Not reviewed: … the model did not return JSON".
- **But the review was not applied.** The page said: "Reviewed, not applied: 59 corrections proposed. The corrected guide failed the drill check, which the guide had passed — the first drill (נוצץ (לנצוץ)) gives no deviation from pe-nun, pe-yod, guttural, hollow, doubled, none; the guide was kept as built." One correction rewrote the drill's deviation as pe-nun *and* doubled, which the drill check does not accept, and the session-five rule discards the whole review when any check it passed before now fails.
- **לזנק is not among the 59 corrections.** The review never proposed it, even though the review prompt names "לזנק is Pi'el, not Pa'al" as its own example. Per the brief, no second round was run; Dan's live check 2 (open לזנק) was skipped because the outcome was certain: a discarded review corrects no card, and the review did not name the word.
- **Nikud on the word card, everywhere.** Article cards showed the pointed headword on the first deploy. Lesson words did not: all were cached before nikud, and the one-time fill failed silently live. Fixed in the second deploy; Dan confirmed the points show on lesson words.
- **Plain words.** Dan confirmed the reader's color key reads "Shaky · Looked up · Solid and new words have no color."

**Checked here only, against mocks:**
- The review asks for structured output against its JSON schema (JSON mode if no provider takes it); reads JSON whole, in a code fence or after prose; refuses a cut-off answer; asks once more and only once; logs the first 2,000 characters of an answer that is not JSON and keeps them with the lesson, shown under "Not reviewed" as "What the model sent back". Token limit 8,000 → 16,000.
- A pointed form never makes a new spot; spot ids, tints and matching read unpointed text only.
- An old cached card gets nikud from one small call on first open, and no call on the second; two opens at once make one call; a card whose points were all refused is asked again.
- No screenshot's visible text contains "map", "met" or "touch" (checked automatically on every screen shot, phone and computer).
- Screenshots: `docs/screenshots/card-nikud-{light,dark}-{desktop,phone}.png`, `reader-card-nikud-*`, `phone-lookup-nikud-*`, `legend-*`, `lesson-card-nikud-{desktop,phone}.png`.

**Screen lines changed (before → after):**
- Color key: "shaky on your map · met, not yet marked · solid or never met" → "Shaky · Looked up · Solid and new words have no color."
- Card status: "met, not yet marked · 2 touches" → "looked up · seen 2 times"; "shaky on your map" → "shaky".
- Card head: the selected word, unpointed → the dictionary form pointed, large, plain spelling beside it; "lemma X" → "in the text" + the selected word, pointed.
- Side panels: "This piece against your map" → "Your words in this piece"; "No word here is on your map yet." → "You haven't looked up or saved a word from this piece yet." (same for lessons).
- Phone: "A lookup counts as a touch on your map." → "Looking up a word you've marked counts as seeing it again."; "No other word of this piece is on your map." → "You haven't looked up any other word in this piece."
- Lesson footer: "N already on your map, touched" → "N you already had, counted as seen again"; "Saving the lesson's words to your map…" → "Saving the lesson's words…"; "Not met:" → "Checks not passed:"; "Lost touch with the server…" → "The connection to the server dropped for a moment…".
- Print sheet: "Words touched 2 or more times" → "Words you've seen 2 or more times"; "shaky · 3 touches" → "shaky · seen 3 times".
- Phone drill messages: "No verb on your map is…" → "None of your verbs is…".
- New: "What the model sent back (the first 2,000 characters)" under a failed review; "The first answer was not in the expected format; the review was asked once more."; on a card, "No nikud this time: …" when adding points fails.

## What the brief got wrong

1. Step 3 says "pointed forms in the forms list". The card has no forms list; the forms it shows are the dictionary form and the selected word, and both now carry nikud.
2. Step 1(b) implied JSON was not being asked for. JSON mode (`response_format: json_object`) was already sent on every call; the review now asks for structured output against a schema. The cause of the live "did not return JSON" is not proven; the most likely is an answer cut off at the old 8,000-token limit.
3. Step 4 treats old cached cards as the edge case. For lesson words it is every card, so the one-time fill was the main path Dan hit, and it failed live on its first deploy (see divergence 3).
4. The brief's live round assumed a running review would reach לזנק. It ran, and did not: the review's own output is the problem now, not the plumbing.

## Deliberate divergences

1. The review's token limit went from 8,000 to 16,000. DO NOT REVERSE — 59 corrections in Hebrew needs the room.
2. The card's headword is now the dictionary form (it was the word as selected); the selected word shows on the line below as "in the text", pointed.
3. The one-time nikud fill uses JSON mode, not the strict schema. DO NOT REVERSE — the schema version failed live silently; JSON mode is what the card call uses and it works live.
4. A card whose pointed forms were all refused is asked again on its next open, instead of never. Dan: "Nikud should be available anywhere I select a word."
5. A failed nikud fill says so on the card, never silently.
6. The print sheet counts words "seen", not "looked up": a lesson save counts too.
7. The two model prompts whose wording can come back on screen (the Ask box, the review) no longer say "map".
8. "Root radiation map" is kept: it is an exercise named in Dan's own lesson instructions.
9. The screenshot browser now goes through the sandbox proxy so web fonts load as they do for Dan (before, no web font ever loaded in screenshots). DO NOT REVERSE.
10. A second deploy inside the session, for the lesson-word nikud fix Dan asked for; not a second round on the review.

## Dan's decisions this session

- "push to main", twice (runs 19 and 20, both green).
- "Nikud should be available anywhere I select a word." (23 Sep 2026)

## What the next brief needs to contain

- The review's all-or-nothing rule is now the blocker: one bad correction threw away 58 others. Session five's rule ("kept unless it makes things worse") discards the whole review.
- The review's corrections are not all right. It says היכון is Hitpa'el (it is Nif'al, as the prompt itself says), several items are "no change needed" notes rather than corrections, and it ignored לזנק. Applying all 59 blindly would also have been wrong.
- The drill check accepts one deviation type from a fixed list; a verb that is both pe-nun and doubled (נוצץ, root נ.צ.צ) cannot be described correctly.
- Imported 2026 lessons will meet the same review behavior as the June lesson.
- This report and the PLAN.md note about the second deploy are on the session branch; `main` carries the code and the first PLAN.md note.
- The full list of the 59 proposed corrections is in the appendix below.

## Asks for the origin chat

1. When a corrected guide fails a check it had passed, what should happen? Recommended: apply the corrections one at a time and drop only those that break a check, keeping the rest; list the dropped ones.
2. How to get לזנק fixed, given the review ignores it? Recommended: a narrow second call over the lesson's verb cards only (word, root, binyan; answer "correct" or the fix), separate from the guide review, so the cards are not lost among 59 guide edits.
3. Should the review be told that "no change needed" is not a correction, and to drop a correction it is unsure of? Recommended: yes, one line in the review prompt, plus the server refusing corrections whose find and replace are the same.
4. Should the drill check accept a deviation naming more than one type (e.g. "pe-nun, doubled")? Recommended: yes, accept any combination of the listed types.

## Appendix — the 59 corrections the review proposed (June lesson, 23 Sep 2026, not applied)

As Dan read them off the page:

- חושש is from root ח.ש.ש (geminate/doubled root), not ח.ו.ש (which would be a hollow root). The שׁ repeats.
- The root of לביים is ב.י.מ; ב.מ.י is not a recognized alternative ordering.
- לנצח in Pi'el means to win or to conduct (music). 'To be eternal' is the adjective נצחי or the noun נצח; the verb in Pa'al (נָצַח) can mean to be victorious, not 'to be eternal'.
- בלעדי is not derived from a four-letter root ב.ל.ע.ד in the traditional sense; it comes from the compound preposition בלעדי (without). Calling it a four-letter root is misleading.
- The root נ.צ.צ is both pe-nun AND a geminate (ע"ע/double-ayin) root — the second and third radicals are identical. This is the primary source of its irregularity.
- This form is extremely literary/archaic. The exercise cue says 'future 3fp' but the expected answer uses the rare נָה- ending. For practical study, 3fp future typically uses the 3mp form (יִנְצְצוּ) in modern Hebrew. However the form itself is not wrong per se, just impractical.
- The root of להקיז is נ.ק.ז (pe-nun root), not ק.ו.ז. The nun assimilates in Hif'il, which is why it appears as להקיז. This is a pe-nun verb, not a hollow verb.
- להקיז is a pe-nun root (נ.ק.ז), not a hollow root. The nun assimilates in Hif'il forms.
- The root is נ.ק.ז (pe-nun), not a hollow root. The deviation description was entirely wrong.
- Pe-nun Hif'il past with suffixes: the prefix vowel is hiriq (הִ-), not tzere (הֵ-). The qof takes dagesh from the assimilated nun.
- Same correction: hiriq prefix and dagesh in qof for pe-nun assimilation. (×7)
- 3ms past: hiriq prefix and dagesh in qof for pe-nun Hif'il.
- Hif'il present participle of pe-nun: מַקִּיז with patach under mem and dagesh in qof (like מַכִּיר from נ.כ.ר, מַגִּיש from נ.ג.ש).
- Same correction for fs present. / Same correction for mp present. / Same correction for fp present.
- Hif'il future of pe-nun: patach under prefix letter and dagesh in qof (like אַכִּיר, אַגִּיש).
- Same correction for future forms: patach + dagesh. / Same correction. (×5)
- Hif'il imperative of pe-nun: patach + dagesh (like הַכֵּר, הַגֵּשׁ).
- Same correction for fs imperative. / Same correction for mp imperative.
- Exercise answer: past 3mp needs hiriq + dagesh. / present ms needs patach + dagesh. / future 3mp needs patach + dagesh.
- חושש is from root ח.ש.ש (geminate root), not ח.ו.ש. / ח.ש.ש is a geminate root, not hollow.
- Root of להקיז is נ.ק.ז (pe-nun), not ק.ו.ז. / נ.ק.ז is pe-nun, not hollow.
- This is actually acceptable — but note the word אווירה is borrowed from Latin/Greek 'aer/aura' and the root א.ו.ר is a back-formation. No change needed on reflection.
- The root of בדיה (fiction/fabrication) is ב.ד.א, a lamed-aleph root. The aleph quiesces, which is why the word appears as בדיה.
- לנצח in Pi'el does not mean 'to be eternal'. Eternity is the noun נצח or adjective נצחי.
- No change needed — the nikud is acceptable.
- The unpointed form is עיצומים with a yod; the pointed form should reflect this.
- Root of חושש is ח.ש.ש (geminate), not ח.ו.ש. / ח.ש.ש is geminate, not hollow.
- Root is נ.ק.ז (pe-nun), not ק.ו.ז. / נ.ק.ז is pe-nun, not hollow.
- Root of בדיה is ב.ד.א (lamed-aleph), not ב.ד.ה.
- The root should be stated directly as י.ע.ד without the intermediate ע.ד.ה which is not a root.
- Root is נ.ק.ז, not ק.ו.ז. It is pe-nun, not hollow.
- Root is ב.ד.א (lamed-aleph), not ב.ד.ה.
- No change needed on reflection — the nikud is acceptable for this form.
- No change needed — root and explanation are correct.
- היכון is Hitpa'el imperative (הִתְכּוֹנֵן → היכון), not Nif'al. The Nif'al of כ.ו.נ would be נכון (correct/ready as adjective). The imperative form היכון comes from להתכונן (Hitpa'el). [wrong: היכון is Nif'al]
- היכון is the Hitpa'el imperative of כ.ו.נ (from להתכונן), not Nif'al. (×3, same claim)
- On review, the root א.ו.ר is not clearly wrong but is questionable for a loanword. Keeping it is acceptable — removing this removal note.
- Refused as additions: cards לְנַצֵּחַ: "to win; also: to conduct (music), to be eternal" is not in it; cards חֲשֵׁכָה: no such item in the guide.

Footer on the page: 10 words saved · 27 phrases kept in the guide only · recorded on the spine · 2 could not be identified: עדה, עדתי.
