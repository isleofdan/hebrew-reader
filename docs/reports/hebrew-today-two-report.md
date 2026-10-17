# FIELD REPORT — hebrew-today-two — 2026-10-17

Merged and live: pull request #16 (https://github.com/isleofdan/hebrew-reader/pull/16, merge commit d25f19c, on Dan's yes in chat). The Today page now offers "Another set" after a finished set, as many times a day as Dan likes, a set never runs dry while he has words, and the answer choices stack on the phone. Permission mode: Auto (read with `get_session`: `permission_mode: auto`).

## What stands

- **The OpenRig team did the work**, steps 1 to 5. Builder `dev-owner@hebrew-today-two-mixed` (Claude Code), checker `dev-check@hebrew-today-two-mixed` (Codex), in a second team started fresh on `~/work/hebrew-today-two` (see "Deliberate divergences", 1). Queue items, in order:
  - `qitem-20261017062621-6f3017ab`: the job, builder. Handed to the checker.
  - `qitem-20261017070819-c462d8f0`: checker, candidate 1f5909b. FINDINGS, 1 finding.
  - `qitem-20261017071213-2f7fbdcf`: builder, the fix. Handed to the checker.
  - `qitem-20261017072814-d547887b`: checker, candidate ac54991. PASS.
  - `qitem-20261017073016-1a0f2bc0`: builder close-out, done.
- **The checker's verdict line**, verbatim: "PASS on ac54991: finding resolved by explicit solid-without-due-date exception; 142 Today server checks passed independently".
- **Sets are numbered** (step 1, `lib/db.js`, `lib/today.js`).
  - `drill_sets.seq` was added by `ALTER TABLE … ADD COLUMN` in `migrate()` and back-filled from `id`.
  - The current set is the newest unfinished one, by `seq`.
  - `for_day` keeps its UNIQUE constraint. A later set built the same day is written `<day>#2`, `#3`. The only reader of `for_day` as a date is `newestSetOfDay`, and it reads the suffix.
  - `addDrillSet` is now a plain insert, so a failed insert is an error rather than a silent old row.
  - The Undo refusal (409) names the newer set by its number.
  - `ensureSet` builds only when no set is unfinished and none was built that day; it serves the page and the 05:00 build. `newSet()` builds regardless and is used only by the tap. Both share one guard.
- **Pools** (step 2, `lib/today.js`). Word slots fill in this order:
  - (a) the words due, in the existing priority;
  - (b) shaky words not yet due;
  - (c) solid words not yet due.
  - Pools (b) and (c) go earliest due first, least recently touched breaking ties. A word already in an unfinished set is skipped.
  - When (b) or (c) is used, the note says "Nothing more is due; this set draws on words not yet due." "No data" comes only when no word can be drilled; with no words at all, the reason says so.
  - A not-yet-due word answered right climbs from its interval; one answered wrong resets.
- **The tap** (step 3).
  - The finished screen is headed "Done", with a large "Another set" button under the results.
  - The button calls `POST /today/another` (`server.js`), which opens the new set at "1 of 10".
  - While the set builds, the button says "Building…" and is disabled. Two taps make one set.
- **Phone layout** (step 4, `public/app.css`).
  - Below 600 px the choice rows (passage question, "Which preposition", "Which spelling") stack one under another, full width, and the text wraps inside each button.
  - At computer width they stay in one row, and each button grows with its text.
- **Checks and docs** (step 5).
  - The Today server checks went from 111 to 142 and the Today page checks from 67 to 83. The totals in `docs/CHECKS.md` are 645 server and 545 page checks, against the baseline of 616 and 529.
  - `PLAN.md` has the close-out note "hebrew-today-two", and README.md has a paragraph after the Today paragraph. `LEARNING.md` is unchanged: no new environment fact about the app turned up.
  - The stand-in's (`scripts/mock-openrouter.mjs`) third comprehension choice was made long, so the phone check has a long choice to test.
- **`npm run check` on ac54991**, run by this session after the PASS: last line `check: all passed: syntax, tests, screenshots` (tests 70.44 s, screenshots 213.03 s).
- **Deploy**: Deploy run 39019960725 for d25f19c: success; the Checks run 39019960733 on main: success. `curl -sI https://hebrew-reader-dan.fly.dev/today` at 09:11:41 UTC: `HTTP/2 303`, `location: /login`, the status the code predicts for a signed-out request.

### Verify (section 9)

1. Another set on a finished set: today-smoke "two, verify 1: POST /today/another makes a new set at item 1 with a different seq: two drill_sets rows, the second numbered after the first" and "two, verify 1: GET /today/set now returns the new set (the newest unfinished), at item 1". No word repeats from an unfinished set: "two, verify 1: another set while one is unfinished: none of its words is in the unfinished set". All pass on ac54991.
2. Nothing due: "two, verify 2: nothing due: the set draws on shaky words not yet due first, then solid ones, each earliest due first …", with the note text checked. No words: "two, verify 2: no words at all: { state: "no data" } …". Both pass.
3. Two calls at once: "two, verify 3: two POST /today/another at once make one new drill_sets row, and both answer that set" and "two, verify 3: two newSet calls at once make one drill_sets row". Both pass.
4. The 05:00 build with an unfinished set: "two, verify 4: the 05:00 build (ensureSet for the new day) with an unfinished set present: no new row, the unfinished set kept". It passes. It is checked by calling `ensureSet` in-process, as the timer does, not by waiting for a real timer.
5. Phone-width passage question with the long third choice: today-pages "every choice's text inside its own button" and "stacked one under another, each the full width" pass with the committed CSS (all 83 passed). The builder showed both failing runs, on working-tree edits that were restored afterwards:
   - with the stacking rule removed: 2 failed, 81 passed;
   - with all of step 4's CSS undone: 3 failed, 80 passed, including "every choice's text inside its own button" at phone width.
   - Outputs: `~/work/scratch-hebrew-today-two-builder/pages-without-stacking.txt`, `pages-without-step4.txt` and `pages-with-step4.txt`.
6. `npm run check` ends `check: all passed: syntax, tests, screenshots`. New totals: 645 server checks (baseline 616) and 545 page checks (baseline 529).
7. After the merge: Deploy run 39019960725 for d25f19c: success; the Checks run 39019960733 on main: success. `curl -sI https://hebrew-reader-dan.fly.dev/today` at 09:11:41 UTC: `HTTP/2 303`, `location: /login`, the status the code predicts for a signed-out request.

Live checks for Dan, at https://hebrew-reader-dan.fly.dev/today:
- (a) finish the set (or Show through it) and tap "Another set": a new set at "1 of 10";
- (b) tap "Another set" again after that one: a third set, whose note says the words are not yet due if that is so;
- (c) on a passage's comprehension question, the three choices are stacked and fully readable.

## UI review

Screens changed: the Today "Done" screen (with "Another set" and "Building…") and the choice rows (passage question, "Which preposition", "Which spelling").

1. **Speed of the frequent action:** one tap on "Another set" starts the next set, and it opens at item 1 without a further screen.
2. **Recovery:** a tap that builds nothing (no drillable words) shows the plain no-data reason. Two quick taps make one set. Undo in an older set is refused, with the reason naming the newer set.
3. **Finding the tool:** the button is the only large button on the Done screen, directly under the results.
4. **Orientation:** the heading "Done" and the progress line "10 of 10". The progress line never counts sets (Dan's pull-only rule).
5. **Feedback:** "Building…", with the button disabled while the passages are made. When the words come from beyond those due, the set's note says so.
6. **Interruption:** an unfinished set stays current. A set built by "Another set" never takes a word from a set still unfinished.
7. **Thumb reach:** on the phone the button spans the panel's width within the first screen (page check "within the first screen, where the thumb reaches"). The stacked choices are full-width buttons at least 56 px high.
8. **Defaults/prefill:** not applicable. The tap takes no input; the set's contents are chosen by the pools.

- **What I did not add, and why:** a count of sets done today, a streak, or a reminder (Dan's pull-only rule); a choice of set size or subject (out of scope, unchanged).
- **Which of the eight came from Dan's requests:** 1 (speed: "as many sets per day as I want") and 7 (thumb reach and readability: the overflowing choice).
- **Screenshots** (in the repository, `docs/screenshots/`, each at phone and desktop width, light and dark):
  - Done with "Another set": `today-done-*`;
  - while building: `today-building-*`;
  - after the tap, the new set at item 1: `today-another-*`;
  - nothing to drill: `today-nothing-*`;
  - the stacked choices, phone width: `today-passage-question-phone-*`.

## What the brief got wrong

1. Section 6 says "a team in a different clone is not a gate". The machine has one team named `first-project-mixed`, and it was in use. The miwa-english-five session had it on `~/work/miwa-english-five/app`, between its Job A and Job B, and was waiting for Dan. Starting that team fresh on this clone would have archived it in the middle of that job. So a team in another clone was a gate in practice, and FACTS.md had no way round it.
2. Step 2 says "a new word is by definition never drilled". Since hebrew-today-one, a new word answered right stays new with a due day. Such a word, if not judged easy, is drawn on in pool (b) with the shaky ones. The builder named this in `PLAN.md`.
3. Step 2's "never-drilled words count as due" ran into an existing rule: a word Dan marked solid before it was ever drilled has no due day, and the earlier code excluded it everywhere. The checker raised it (FINDINGS on 1f5909b). See "Deliberate divergences", 2.

## Deliberate divergences

1. **A second team.** `first-project-mixed` was held by miwa-english-five. So this session ran the same two seats as a second team, `hebrew-today-two-mixed` (id `01M548EWJKMDPAEB1K19H5S9EV`), from a copy of the spec. The copy is `~/openrig-setup/rig/hebrew-today-two-mixed.rig.yaml`, with only `name:` changed. It started fresh on this clone and was stopped with a snapshot. The brief says the session starts nothing lasting. The team is stopped; the spec copy and its snapshot stay so that the job can be continued, and FACTS.md records them.
2. **A word marked solid before it was ever drilled stays out of every pool.** The checker found this on 1f5909b. The builder kept the exclusion, so that marking a word solid (for example "Too easy" on its first drill) is not undone, and documented it:
   - the rule in `PLAN.md`;
   - a true no-data reason;
   - two checks.
   The checker passed it on ac54991.
3. **`ensureSet` builds on page open only when no set is unfinished and none was built that day.** This is so that a finished set shows "Done" with "Another set" instead of silently building another. The brief said "make a set only when no unfinished set exists". This narrows that, and matches the brief's "when none is unfinished, the page shows the newest finished set's 'Done' screen".

## Asks with recommended answers

None.

## What the next session needs

- The next work on card hebrew-satellite stands as before:
  - the reader and phone cards' "Ask about this root" inside the page;
  - session fourteen's four asks;
  - session fifteen's Ask-box route change.
- The Personal Shipyard chat writes that brief.
- Starting a team: `first-project-mixed` may still be held by miwa-english-five, so read `rig ps` and the seats' folders first. A second team from a spec copy works (FACTS.md, section "OpenRig").
- Check servers in this repository use ports 8820–8823, which miwa-english-five's app also uses. Read `ss -ltn` before a run.
- The paper-pages screenshot check failed once on ac54991 ("locator.click: Target page, context or browser has been closed") and passed on the rerun. The builder said the same failure shows on `main`; this session did not reproduce it there. It is a flaky check, not this change.

## Checks

1. Brief check, job `20261017-034725-8c59a4` (event 1526): FINDINGS, 1. Pool (a) and the step-5 order disagreed about new words. Changed by the chat: pool (a) defined, with no separate new-word pool (event 1527).
2. Brief check, job `20261017-035006-9e13e6` (event 1528): FINDINGS, 1. The pools' orderings contradicted each other. Changed by the chat: (a) keeps the existing priority and least-recently-touched order; (b) and (c) go earliest due first, least recently touched breaking ties (event 1529).
3. Brief check, job `20261017-035239-30ab23` (event 1530): PASS on event 1529, the brief this session ran.
4. Team check, `qitem-20261017070819-c462d8f0`, candidate 1f5909b: FINDINGS, 1. Never-drilled solid words fell through every pool, and the no-data reason was untrue. Changed: the exclusion kept and documented, the no-data reason made true, two checks added (commit ac54991).
5. Team check, `qitem-20261017072814-d547887b`, candidate ac54991: PASS. "PASS on ac54991: finding resolved by explicit solid-without-due-date exception; 142 Today server checks passed independently".

## Fly machine and OpenRig lessons

1. **One team name, two jobs.** `first-project-mixed` was held by another session's job between its Job A and Job B, idle, with "Send JOB B" typed at the builder's prompt.
   - Cost: about 2 h 30 min of waiting (04:00–06:22 UTC).
   - Fix: a second team from a copy of the spec with a different `name:`. It started in under a minute and ran side by side (about 2.5 GB memory free).
   - Better: FACTS.md should say a second team is allowed when the first is held.
2. **My wait loop read a failed `rig ps` as "team stopped".** The daemon was unresponsive at times ("Daemon did not respond"), and the loop ended on the first miss.
   - Cost: one false wake.
   - Fix: require two misses in a row, and a successful `rig ps`, before treating the team as stopped.
3. **`seat-watch.sh` reports every rig's queue rows.** With two teams up, the other team's QUEUE lines arrived as noise.
   - Fix: filter the Monitor to this rig's seat names.
   - Cost: a few needless wakes.
4. **Shared check ports.** This repository's checks and miwa-english-five's app both use 8820–8823. The builder spent about 15 minutes on EADDRINUSE and stale mocks from its own runs.
   - Fix: a note to the builder not to stop processes outside its clone. Before saying yes to each kill, I read the process's working folder.
   - Both kills were of the clone's own mock (`scripts/mock-openrouter.mjs 8821`).
5. **Seat prompts answered:** 34 one-time yeses (29 builder, 5 checker), logged in `~/work/scratch-hebrew-today-two/prompts.log`.
   - None was a genuine-risk prompt.
   - Most were reads Claude Code's Accept-edits seat could not run unprompted (`ss`, `ps`, `readlink`, greps in the builder's scratch folder), plus the full check runs.
   - The checker (Codex) asked to run outside its sandbox each time it needed local test ports.
6. **Codex's update prompt** ("Update available · 0.160.0 → 0.163.0") held the fresh checker seat at start. Answered "Skip"; not counted above.
7. **Dan's correction** (in this session): do not offer him the option I advise against. When I have a recommendation, I act on it. Saved as a memory.

## Closing message to Dan

Merged and live: Today now has an "Another set" button after a finished set, so you can do as many sets a day as you like. A set never runs dry: when the due words are used up it draws on words not yet due and says so. On the phone the answer choices stand one under another, fully readable. A word you marked solid before it was ever drilled stays out of the sets.

To try it, at https://hebrew-reader-dan.fly.dev/today on the phone: finish the set and tap "Another set" (a new set at "1 of 10"); tap it again after that one; and look at a passage question's three choices.

Needed from you: nothing to decide.
