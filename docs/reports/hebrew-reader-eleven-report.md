# FIELD REPORT — hebrew-reader-eleven — 25 Sep 2026

Session: cloud (`flyctl` not present). Brief: "START HERE — hebrew-reader-eleven — 24 Sep 2026 (cloud)" on card `hebrew-satellite`. Work on branch `claude/awesome-wozniak-e9u3th`; on Dan's "push to main", `main` was fast-forwarded to `9490f2a` and deploy run 24 succeeded. Close-out note and this report are on the branch, not on `main`.

## What stands

**Proven live by Dan (25 Sep 2026, deploy run 24):**
- The lesson list shows "שיעור עם גיא — 8.7.2025" between 26.1.2026 and 10.2.2025, no longer at the top. The one-time re-date ran.
- להמר (9 Feb 2026 lesson) opened as Pi'el, root ה.מ.ר, with the new "Set root or binyan" control filled in with those values. Saved as it stands, it showed "Confirmed by you, 25 Sep 2026", "Set root or binyan again" and "recorded on the spine". Its two earlier correction lines stayed.

**Checked against stand-ins for the AI model only (224 server checks, 229 page checks; 204 and 209 at the start):**
1. Dan's root and binyan control on verb cards (reader, lesson and phone pages). It offers the seven binyanim plus Polel, Polal and Hitpolel. Saving a changed binyan saves it, confirms the card, adds a "Set by you" line, moves the spot and refreshes the card once. Saving as it stands confirms the card and makes no refresh call. A bad root or binyan is refused with the reason on the card. Roots written as ה.מ.ר, as המר, with a final letter (ק.ל.ך), with nikud, and with 4 letters are all accepted (the false-rejection check). A noun's card is refused. A card Dan set survives a later review fix that the verb check agrees with.
2. "Not changed — you confirmed this card: <word> — review proposed X; verb check proposed Y". Tested with both sides, with one side each way, with a root and a binyan together, and with none (a guide saved before this, which shows the word alone).
3. "The review gave no verdict on: <words>", one caption line under the review. The names were already in the lesson's data.
4. In the agreement rule only, Polel counts as Pi'el, Polal as Pu'al and Hitpolel as Hitpa'el. The 26 Jan case shape (review Pi'el, verb check Polel) now counts as agreement with no "disagree" line, and the card keeps Pi'el. The tests fail with the rule switched off.
5. A noun card is left out of the verb check and the review's verdict list. The card maker's instruction now says a verbal noun is a noun.
6. File names with one word before the date, such as "Daniel Guy hebrew 08july25", are read. The one-time re-date runs once, touches only that kind of lesson, keeps its guide, and logs and records the count.

## What the brief got wrong

1. **"The names must reach the lesson page's data" (step 3):** they already did. `GET /lessons/:id` returns the whole guide, `review.verdicts_missing` included. The import found empty lists because every verb card had a verdict. Empty meant zero, not unknown. Only the page line was missing.
2. **"Find why שוטטות (a noun) got there" (step 5):** there was no selection bug. Only cards labeled verb ever reached the verb check or the verdict list. The only way the noun could have shown a "disagree" line is if its card was labeled a verb. So the card maker labeled the noun שוטטות (a noun made from a verb) a verb. That was fixed in the card maker's instruction. The existing live שוטטות card still says verb until it is made again; with step 4 in place, its "disagree" line will not come back.
3. **Polel and friends were not binyanim the app knew.** A card could not hold them, and the review's "Polel" was thrown away. They had to be added to the name list before Dan's control could offer them (step 1).
4. **"Final letters as written" has a catch.** Typing לחם gives the root ל.ח.ם, which is a different root from ל.ח.מ, as the rest of the app already treats it. The control opens with the card's own root filled in, so "save as it stands" is safe. A root retyped on a Hebrew keyboard is not.

## Deliberate divergences

1. **The re-date also sets the title.** The July 2025 lesson's title was its file name. It now has the title the name pattern gives, "שיעור עם גיא — 8.7.2025", like every other lesson. The step also finds such lessons by rule (the name pattern reads the file name, but the stored title is still the file name) rather than by one hard-coded file name. Live, that is one lesson.
2. **"Today" is Tokyo's date.** Dan's confirmation date uses Asia/Tokyo, not the server's UTC. Live it read 25 Sep 2026 at 01:30 Tokyo time.
3. **The control keeps what Dan typed when the card redraws itself** (for example when its nikud arrives). This was not asked for. Without it, a half-typed root could vanish.
4. **The card maker's instruction changed.** Step 5 was fixed where the fault came from, not by filtering, because the filter was already right.

## What the next brief needs

- The live שוטטות card is still labeled a verb. Only re-making it clears that; Dan's control sets root and binyan, not part of speech.
- The page check "the points are set in Noto Serif Hebrew" flaked 3 times in about 8 runs in the cloud sandbox and passed on rerun each time. It is worth making sturdy, or noting as a known flake.
- The 36 lessons from 2022–2025 still build their guides when Dan opens them (unchanged, out of scope).

## Asks for the origin chat

1. Re-make the live שוטטות card once, as a one-time step, so it becomes a noun? Recommended: yes, folded into the next cloud session that touches `lib/guy-lesson.js`. It's small, and until then that word is still sent to the verb check.
2. Should the root box treat a final letter as its regular form (ם as מ), so that a retyped root matches the card? Recommended: no. The rest of the app counts them as different letters, and saving as it stands is already safe. Revisit only if Dan trips on it.
3. Make the web-font page check sturdy (wait for the font to load before measuring)? Recommended: yes, as a one-line item in the next session. It costs a rerun most sessions.
