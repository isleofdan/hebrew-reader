# FIELD REPORT — hebrew-today-one — 2026-10-16

Merged and live: pull request #14 (https://github.com/isleofdan/hebrew-reader/pull/14) was merged on Dan's yes as 3c9bcf5; the Deploy run succeeded and live `/today` answers 303 to `/login`, as the code predicts. This session ran in Auto mode on agent-machine-dan; the OpenRig team did the work.

## What stands

- **Who did the work.** The OpenRig team `first-project-mixed`, started fresh on `~/work/hebrew-today-one` (rig 01M52HTY1JNJ16X57FE567CZYH): the builder `dev-owner@first-project-mixed` (Claude Code) built steps 1–8, and the checker `dev-check@first-project-mixed` (Codex) checked them. This session supervised, pushed, opened the pull request and merged it on Dan's yes.
  - Queue items: the builder's task `qitem-20261016144046-edc1a156` (closed done). Check round 1: `qitem-20261016153407-fffe401b`, with the verdict in `qitem-20261016153913-7c38f6db`. Check round 2: `qitem-20261016155505-0d8b7f1c`, with the verdict in `qitem-20261016155647-037a8ee5`.
  - The checker's final verdict line, verbatim: "PASS for candidate ef95b9c497f23791b61eeb829e5d5135ff2b1d3a: all three findings on 3065620 are resolved; all 82 Today server checks and the original independent reproductions pass."
- **Step 1, the record** (`lib/db.js`, `migrate()`; commit c9aa95a).
  - Added to `spots` by `ALTER TABLE … ADD COLUMN`: `due_on`, `interval_days`, `right_run`.
  - New tables by `CREATE TABLE IF NOT EXISTS`: `drill_sets` and `drill_answers`.
  - Two columns beyond the brief's schema: `drill_sets.note` (the page's plain-words note, such as "No fresh passages today") and `drill_answers.before_json` (what Undo restores from).
  - Nothing is dropped, rebuilt or moved.
- **Steps 2–4, choosing the day's set** (`lib/today.js`; commits 19ed4ad, 6f5b9f1).
  - Ten items: up to six lesson words, then up to two article words, then one solid word coming due, then two fresh passages.
  - Each exercise is chosen by the word's category: Give the form, Which preposition, Which spelling, or Do you know it.
  - Passages are made through `lookup.chat` with `GUIDE_MODEL`. A passage is kept only if at least three of the shaky words given to the model appear in it.
  - If the model doesn't answer, words fill the passage slots and the page says so.
  - With nothing due, the set is `{ state: 'no data' }` and the page shows "Nothing is due today".
- **Step 5, when the set is built** (commit 55fff33).
  - `ensureSet`: a set is made only when no unfinished set exists, and two calls at once share one build.
  - `server.js` arms a `setTimeout` chain to the next 05:00 Tokyo, so the build runs in the app's own process, not as a cron job on the machine.
  - Opening `/today` builds the set if it isn't there yet.
- **Step 6, answers** (commits 55fff33 and ef95b9c).
  - Intervals step 1 → 3 → 7 → 14 → 30 days. A wrong answer sets the run to 0, the interval to 1 and the due date to tomorrow, and makes the word shaky.
  - A shaky word becomes solid after three rights on three different days. Status changes go through `saveStatus`, so the mark reaches the spine.
  - The spine mark now carries `due_on` and `interval_days`.
  - Undo deletes the last answer row and restores the word's three scheduling fields and its status. Undo of a word's first drill sends null for both scheduling fields, so the spine's stored values are cleared too. Undo is refused (409) when a newer answer exists in any set.
- **Step 7, the page** (commit 2d78841).
  - `public/today.html` and `public/today.js`, with "Today" in the top navigation of every page.
  - The screen shows one item at a time, a "3 of 10" position line, a flash with Undo and a Next button, then "Done for today" with the day's results.
- **Step 8, checks and docs** (commits 3065620 and ef95b9c).
  - New check scripts: `scripts/today-smoke.mjs` (82 checks, in `npm test`) and `scripts/today-pages.mjs` (55, in `npm run screenshots`), with the fixture `scripts/today-fixture.mjs`.
  - Stand-ins: `mock-openrouter.mjs` now answers passages, made-up sentences and misspellings. `mock-spine.mjs` records PUT bodies and clears a field sent as null, as the real spine's `setMark` does (`~/work/spine/lib/db.js`).
  - `docs/CHECKS.md` counts, the `PLAN.md` close-out "hebrew-today-one", and a README paragraph.
- **Step 9, merge.** The pull request's checks passed (4m1s and 3m55s). Merged on Dan's yes as 3c9bcf5. Deploy run 38929852559 succeeded (verify item 9).

### Verify (brief section 9)

1. Against the stand-ins, with two seeded lessons (six words each) and one article: `ok verify 1: GET /today/set returns ten items: six lesson words, then two article words, then two passages`. All six lesson slots come from the older lesson, because its words were touched least recently. Item 1 is נאלצה. The ten sources:
   - 1–6: "From Guy's lesson שיעור עם גיא — 1 בספטמבר" (form נאלצה, form ייקבעו, preposition להתמודד, spelling התבייש, know רפורמה, know הסלמה);
   - 7–8: "From רפורמה במשק החשמל" (spelling ממסד, form אישרה);
   - 9: "A fresh passage: energy and electricity markets (batteries, the grid, tenders)";
   - 10: "A fresh passage: business and markets".
2. `ok verify 2: after a wrong answer the word is due tomorrow (2026-10-18, Tokyo), interval 1, run 0, shaky`; `ok verify 2: the spine received a PUT whose body carries status, due_on and interval_days at the top level`.
3. `ok verify 3: three rights on three different days: intervals 1, 3, 7 (the first right after a wrong keeps 1)`; `ok verify 3: after the third, status solid and interval 7`; `ok verify 3: the spine received solid, with due_on and interval_days 7`.
4. `ok verify 4: Undo deletes the drill_answers row`; `ok verify 4: …and the word's four fields are as before the answer (due_on null, interval 0, run 0, shaky)`.
5. `ok verify 5: two ensureSet calls for the same day at once make one drill_sets row (and one build: two passage calls)`.
6. `ok verify 6: at 23:30 Tokyo the next build is 05:00 the next day Tokyo, 20:00 UTC`; `ok verify 6: at 04:59 Tokyo it is one minute away`.
7. `npm run check` on ef95b9c, run by this session: the last line is `check: all passed: syntax, tests, screenshots` (syntax 3.08 s, tests 75.03 s, screenshots 238.89 s). New totals: 587 server checks (baseline 505) and 517 page checks (baseline 462). This session's own `node scripts/today-smoke.mjs` ended `all 82 today checks passed`.
8. 44 screenshots are committed under `docs/screenshots/`: `today-{form,wrong,right,preposition,spelling,know,know-shown,passage,passage-question,done,nothing}-{phone,desktop}-{light,dark}.png`. Example: https://github.com/isleofdan/hebrew-reader/blob/main/docs/screenshots/today-wrong-phone-light.png
9. Deploy run 38929852559 (https://github.com/isleofdan/hebrew-reader/actions/runs/38929852559) concluded `success`. Then `curl -sI https://hebrew-reader-dan.fly.dev/today` returned `HTTP/2 303` with `location: /login` (16 Oct 2026 16:12:34 GMT), matching the expected status below. `/health` answers `{"ok":true,"configured":true}`.

Expected status for a signed-out request, read from the code before the deploy: `/today` is not an API path. `server.js` `handle()` sends a request without the cookie to `redirect(res, '/login')`, and `lib/http.js` `redirect` writes 303. So the expected status is 303 with `location: /login`. The smoke check says the same: `ok signed out, GET /today is a page: 303 to /login`.

## UI review

The Today page, the one screen this session produced. Screenshots: `docs/screenshots/today-*.png` on `main` (states: form, wrong with its flash, right, preposition, spelling, know, know-shown, passage, passage question, done, nothing due; phone and computer; light and dark).

1. **Speed of the frequent action.** Answering one item takes one tap (the choice exercises), or typing then Check (Give the form). Next sits directly under the flash.
2. **Recovery.** Undo on every flash reverses the last answer. It is refused if a newer answer exists, so an old tab cannot wipe newer progress.
3. **Finding the tool.** "Today" is in the top navigation of every page, beside "Look up".
4. **Orientation.** A "3 of 10" line with a progress bar is at the top. The source line under each item says where the word came from ("From Guy's lesson …").
5. **Feedback.** The flash names the word, the result and the next due day (screenshot: "נאלצה — wrong; next due tomorrow"). A wrong answer also opens the word's card.
6. **Interruption.** An unfinished set stays as it is and is served again until it is done. Nothing notifies or reminds.
7. **Thumb reach.** The Show button and the answer controls sit low in the card on phone width (today-know-phone-dark.png).
8. **Defaults and prefill.** Not applicable: the page has no settings, and an answer box is never prefilled because that would give the answer away.

What I did not add, and why: no streak, count of days, reminder or badge, by Dan's pull-only rule. No "Ask about this root" change inside the page; that is the separate brief named on the card.

Which of the eight came from Dan's own requests: 6 (the material comes back and nothing is lost if a day is missed) and 7 (phone first). Where a lesson item is a single word, "Do you know it" shows the word alone, because there is no read sentence to show (today-know-phone-dark.png).

## What the brief got wrong

- Section 7 said to wait on "the exact queue item id the seat watcher prints". The brief check on event 1509 flagged this: the seat watcher prints only short id fragments, while FACTS.md documents `rig queue list` and `rig queue show`. I found each row with those commands and waited on its full id.
- Verify item 1 expects "the first six from the lessons" with two seeded lessons. Under step 2's least-recently-touched rule, all six come from the older lesson. That is consistent with the rule, but the newer lesson's words do not appear in a ten-item set.
- Step 8 names `LEARNING.md` "for any new environment fact". The repository has no `LEARNING.md`, and the builder found no new environment fact, so none was created.

## Deliberate divergences

- **Queue waiting.** I waited on the full queue ids found with FACTS.md's commands, as the brief check's finding asked, not on the watcher's short fragments.
- **Two extra columns**, `drill_sets.note` and `drill_answers.before_json`, added by the builder for the page note and the Undo restore. Both are added columns. Nothing existing changes.
- **Day boundary.** The day's set is keyed to the Tokyo calendar day. A set finished in the evening is followed by a new set on the first open after midnight Tokyo, not only after 05:00. The 05:00 build is when the set is made ahead of time. The checker judged this consistent with the brief's day/05:00 distinction.
- **No build at boot.** The 05:00 scheduler is armed at boot, and the first open of a day builds the set if it isn't there yet (step 5's fallback).
- **Screenshots of other pages not refreshed.** The re-rendered screenshots of the other pages (whose navigation now includes "Today") were not committed; only `today-*.png` were. The other pages' committed screenshots still show the old navigation.
- **The checker's review notes** (`docs/reports/hebrew-today-one-check-3065620.md` and `…-ef95b9c.md`) were not on the merged branch. They are on the report branch with this report.

## Asks

None. Needed from you: nothing to decide.

## What the next session needs

- The live signed-in checks below were not run by this session, because it cannot sign in. Dan runs them when he next opens the page:
  - (a) Open https://hebrew-reader-dan.fly.dev/today on the phone: a set of up to ten items, the first ones "From Guy's lesson …".
  - (b) Answer the first item wrong on purpose, then type that word at https://hebrew-reader-dan.fly.dev/lookup: its card says shaky.
  - (c) Tap Undo on the next item's flash: the flash says "undone".
  - (d) After finishing a set, the next day after 05:00 a new set is there without a tap having built it. An unfinished set stays instead.
- Not tested: the quality of passages from the live model, and the live spine's acceptance of `due_on`, `interval_days` and null clearing. The spine's code accepts all three (`setMark`, `checkDate`, `checkInteger` in `~/work/spine/lib/db.js`, as read by the builder and the checker).
- Still open on the card: the reader and phone cards' "Ask about this root" inside the page, session fourteen's four asks, and session fifteen's Ask-box route change. The Personal Shipyard chat writes the next brief.
- To continue this job's team: `rig restore 01M52QPNN20CE0PHWTGZAZ958S --rig 01M52HTY1JNJ16X57FE567CZYH` (seats in `~/work/hebrew-today-one`). A new job starts the team fresh instead.

## Checks

1. **Brief check** on event 1507: job 20261016-142219-8e7247. FINDINGS (1: Undo wording). The chat fixed it and filed event 1509, before this session.
2. **Brief check** on event 1509, run by this session: job 20261016-142739-673046. FINDINGS (1, step 7: the queue-id source). This session applied its fix in supervision, as above; the brief was not re-filed.
3. **Team check, round 1:** checker row `qitem-20261016153407-fffe401b`, verdict in `qitem-20261016153913-7c38f6db`. FINDINGS on 3065620. What was changed in ef95b9c:
   - (1) A stale Undo from an older set is now refused (409).
   - (2) Undo of a first drill now sends null for both scheduling fields, so the spine clears them; the stand-in now clears a null field.
   - (3) Each item's source now names the lesson or article its sentence came from.
   - Seven new checks fail on 3065620 and pass on ef95b9c.
4. **Team check, round 2:** checker row `qitem-20261016155505-0d8b7f1c`, verdict in `qitem-20261016155647-037a8ee5`. PASS for ef95b9c.
5. **Pull request checks** on #14: both `checks` jobs passed.
6. **Result check** on this version of the report: the verdict cannot sit inside the report it checks, so the closing message to Dan names it.

## Fly machine and OpenRig lessons

- **A foreground wait blocked prompts.** My 600-second foreground `until` loop waited on the builder's queue row while the builder sat on a one-line Read prompt for about 10 minutes. Seat-watch reported it, but I could not act until the loop timed out. Cost: about 10 minutes of the builder's time. Fix: every wait now runs in the background (saved to memory as `never-block-the-turn-on-a-wait`, at Dan's request).
- **A broad `pkill -f` killed the wrong wait.** It matched the command line of my other background wait and killed it (exit 144). Cost: one lost wait. Fix: stop background tasks by their id with TaskStop.
- **The OpenRig daemon sometimes doesn't answer.** It answered "Daemon did not respond" three times: `rig ps --nodes` after `rig up`, one `rig queue show`, and the first `rig down --snapshot`. `rig daemon status` showed it running each time, and the retry worked. Cost: a retry each time. A wait loop must treat that error as "not finished" and keep going.
- **Startup warnings looked like a failure.** `rig up` printed `import_rig: failed` and `Status: partial`, but both seats came up working in the clone. Cost: a seat check before sending the job.
- **The checker stopped on a Codex update prompt** at startup (0.160.0 → 0.162.1). I answered "Skip", since updating changes a global install outside the job. This happens whenever a new Codex release is out.
- **The builder hit the prompt checker often.** It ran in "accept edits" mode and stopped on 26 prompts. They came from `$?`, subshells, `cd` before git, heredocs, `sed` (even `sed -i` on /dev/null), and every write in its scratch folder. The checker stopped on 4. All 30 were answered with a one-time yes by this session: 1 Codex update skip, read and write of scratch files, test and check runs, read-only greps, `git stash`/`pop` in the clone, and read-only git in `~/work/spine`. None went to Dan.
- **The builder used heredocs anyway.** It edited a fixture with a python heredoc despite the job's Edit/Write instruction (prompt 4). It was harmless.
- **`npm run screenshots` rewrites every committed screenshot.** Each full check run left about 245 modified PNGs. The builder, and then I, restored them with `git checkout -- docs/screenshots`, so only the Today screenshots were committed.
- **Seat watcher alerts repeat.** Its UNPICKED alert fired twice on the builder's original task row after the checker's hand-off. The builder was working the checker's reply row for the same job, so I did not nudge it. Cost: none.

## Closing message to Dan

The Today page is merged and live. It gives a daily set of up to ten drills on your phone: lesson words first, then article words, one solid word coming due, and two fresh passages on your subjects. Each answer moves the word's next-due day and its shaky/solid status, and Undo puts the last answer back. The checker found three Undo and source-label defects in the first version, and the builder fixed them before the merge. Next time you open https://hebrew-reader-dan.fly.dev/today you'll see the first set. Needed from you: nothing to decide.
