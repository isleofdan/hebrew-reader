# FIELD REPORT — hebrew-speech-one — 2026-10-23

Status: MERGED. Pull request #25 (https://github.com/isleofdan/hebrew-reader/pull/25) was merged into main by the project thread at 15:32 UTC on 23 Oct 2026 as b765b90, which deploys the live site. It holds everything up to c7d72bd. The follow-up commits (the stricter Hebrew-letters instruction, the one-wait page-check fix, this report) reached the thread as a patch, because the push from this machine kept stopping on its permission prompt; the thread opens the follow-up pull request from it.

## What stands

- **The Look up page has a Speak button.** Dan taps Speak, says a Hebrew or English word or short phrase, and taps Stop (it also stops by itself at 30 seconds). The reader writes down what he said, puts it in the box with "Heard: <text> · Play your recording", and looks it up exactly as if he had typed it. The recording stays with that look-up: the "Looked up" row and the card have a play button, and "…" lists a row's recordings, each with Play and "Delete recording". Code: `lib/speech.js`, `lib/db.js` (table `recordings`), `server.js`, `public/mic-ui.js`, `public/lookup.js`, `public/lookup.html`, `public/app.css`, `public/delete-ui.js`, `public/sw.js`.
- **The model** is `google/gemini-3.8-flash` through OpenRouter (`SPEECH_MODEL` in `lib/speech.js`). OpenRouter's model list prices audio input at US$0.000000825 a token (US$0.825 per million). Measured cost per one-word recording: US$0.0003 (WebM/Opus), US$0.00024 (WAV), and US$0.000086 with minimal reasoning, which the build uses (45 audio tokens; `scratch-hebrew-speech-one/answer-*.json`). That is about US$0.0012 per minute of speech.
- **The format route** (environment check 6.3): both the phone's own WebM/Opus recording and 16 kHz mono WAV were accepted live. So the page uploads the original as it is, the raw request body, with no conversion and no multipart.
- **Live call through the built route** (verify 9), from the machine on the final code (3651c51), with the Commons fixture: WebM/Opus gave "אמת" in 3.02 s and Ogg gave "אמת" in 2.66 s (server log: "written down by google/gemini-3.8-flash in 2984 ms" and "2605 ms").
- **A fault found at close-out and fixed.** With the team's instruction, live calls on the WebM fixture wrote the spoken אמת as "Emet" (Latin letters) in 3 of 43 calls. The page would then have looked "Emet" up as an English word. Commit 3651c51 makes the instruction say that a Hebrew word is always written in Hebrew letters, never in Latin letters, with that example. With it, 0 of 35 calls missed (trial script `scratch-hebrew-speech-one/script-trial.cjs`, two batches of 15 and 20 calls per wording). The speech checks follow the new wording (`scripts/speech-smoke.mjs`, 46 of 46). The PLAN.md close-out note says so.
- **Rebased onto the thread's fix.** The project thread pushed c7d72bd on top of 252fb5c (the page check waits for the desktop's 30-second recording to attach to its row, then deletes it, so the phone's row counts no longer depend on machine speed; that race made GitHub's Checks red on 252fb5c). I rebased the instruction change and this report onto it: 3651c51 is now a5b0559, with the same content.
- **Main merged in.** Main moved after the branch was cut (pull request #24, the save-button state), so 252fb5c merges it in with no conflict. The pull request was merged before hebrew-save-one, so the speech build is on main first and hebrew-save-one carries the integration (see "What the next session needs"). The follow-up commits are in pull request #26 (https://github.com/isleofdan/hebrew-reader/pull/26), opened by the project thread from the patch.
- **What merging changes**, confirmed in `.github/workflows/deploy.yml` (runs on a push to `main`) and in `migrate()` in `lib/db.js`: merging deploys the live site hebrew-reader-dan on Fly. At start-up it adds one new table (`recordings`, with one index, `CREATE TABLE IF NOT EXISTS`) and a `recordings` folder on the volume. No existing table or column changes and no row is moved.
- **Did the OpenRig team do the work: yes**, for steps 1–4. Rig `hebrew-speech-mixed` (id `01M5MBEHE1JRK29TH2HJ5MEJET`) was started fresh on `~/work/hebrew-speech-one`. The builder `dev-owner@hebrew-speech-mixed` (Claude Code) took the job file `/data/home/dan/work/scratch-hebrew-speech-one/job.md` and made commits afdcd93 (step 1), 8b8a743 (steps 2 and 3), 4dc0d83 (step 4) and c1cff26 (the fix), plus c4a8c85 (the review reports). The checker `dev-check@hebrew-speech-mixed` (Codex) recorded two verdicts:
  - queue `qitem-20261023132319-94993f4c`, on 4dc0d83: "Verdict: **FINDINGS**. The ordinary speech flows pass, but rule 7 has an uncovered pending-microphone-request race." (`docs/reports/hebrew-speech-one-review-4dc0d83.md`)
  - queue `qitem-20261023135701-ee16b34e`, on c1cff26: "Verdict: **PASS for the pending-microphone lifecycle correction.**" (`docs/reports/hebrew-speech-one-recheck-c1cff26.md`)
  - The merge 252fb5c and the instruction change 3651c51 came after the team stopped and were not checked by the team's checker (see "Deliberate divergences").
- **The team is stopped.** `rig down hebrew-speech-mixed --snapshot` gave snapshot `01M5MKJBJ6BFY6K0AZBKDG3TC9`. OpenRig printed the restore line `rig up hebrew-speech-mixed`, for continuing this job only. FACTS.md records both.
- **Checks on the final code:** `npm run check` on 55adb4e, the final candidate (its tree is main at b765b90 plus the follow-up patch), ends `check: all passed: syntax, tests, screenshots` (syntax 8.43 s, tests 156.85 s, screenshots 512.74 s; log `scratch-hebrew-speech-one/final-check-55adb4e.log`; earlier runs in "Checks"). `scripts/check.mjs` prints only its three stage lines, so the totals below come from the separate script runs. Server checks: 905 (859 before; `scripts/speech-smoke.mjs` adds 46). Page checks: 805 since the thread's c7d72bd (723 before; `scripts/speech-pages.mjs` adds 82; the 804 and 81 of the run on 3651c51 were before it). Both run against the stand-in and Chromium's fake microphone playing the CC0 Commons recording of אמת (File:He-אֱמֶת.ogg, https://commons.wikimedia.org/wiki/File:He-%D7%90%D6%B1%D7%9E%D6%B6%D7%AA.ogg, licence in `scripts/fixtures/speech/README.md`).
- **Verify items** (from `scripts/speech-smoke.mjs` and `scripts/speech-pages.mjs`, all passing in the final check):
  1. The fake microphone saying אמת fills the box and opens its card, with "Heard: אמת · Play your recording".
  2. Playback works from the Looked up row and from the card; a ranged request answers 206 (and 416 past the end).
  3. A spoken English word ("run" in the stand-in) opens its list, and the recording hangs off the `english:run` row.
  4. Empty speech shows "Nothing was heard. Try again." and keeps no file and no row. With the model down, the 502 message shows and no file is kept.
  5. Speaking makes no spot, touch, lookup or mark beyond what typing does (spine stand-in count unchanged).
  6. The microphone's tracks stop after Stop, after 30 seconds, and on `visibilitychange` to hidden, including while permission is still pending (the checker's finding).
  7. Delete asks its confirm, then removes the row and the file, and "Keep" removes nothing. The seven-day sweep removes only unattached recordings.
  8. Screenshots `docs/screenshots/speech-*.png` cover 9 states × 390 px and 1280 px × light and dark (36 files). The Speak button moves 0.0 px across idle, recording, writing and done (99.0 px from the top on the computer, 259.4 px on the phone).
  9. The live call: see above.
  10. `npm run check`: see "Checks".

## UI review (per screen you touched)

The one screen touched is the Look up page (`/lookup`), with its card and "Looked up" list. Screenshots: `docs/screenshots/speech-idle-*`, `speech-recording-*`, `speech-writing-*`, `speech-heard-*`, `speech-english-*`, `speech-nothing-heard-*` (after a mistake), `speech-refused-*` (microphone refused), `speech-two-recordings-*`, `speech-delete-confirm-*`, each at phone width (390 px) and desktop width (1280 px).

1. Speed of the frequent action: one tap starts recording and one tap stops it. The look-up runs on its own, with no second tap.
2. Recovery: the heard text stays editable and "Look up" runs it again. "Nothing was heard. Try again." and the 502 message say what to do. Delete has the in-page confirm.
3. Finding the tool: Speak sits beside "Look up", in the same row on the phone.
4. Orientation: "Listening…", "Stop · 0:04" and "Writing it down…" say which stage it is in.
5. Feedback: a level meter while recording; "Heard: <text>" afterwards.
6. Interruption: going to the background or leaving the page stops and drops the recording, and nothing is sent.
7. Thumb reach: on the phone, Speak is on the form's second line, half its width and 52 px high.
8. Defaults and prefill: the heard text fills the box; the newest recording is the one the play button plays.

Not added: the mic on other pages, long speech and pronunciation scoring, all out of scope. Dan's own request covers 1 and 5 ("I also want to be able to record speech": speaking instead of typing, and keeping and hearing the recording).

## What the brief got wrong

- Step 2 asked for "a round Speak button … 44 px". A circle cannot show "Stop · 0:04", so the team made a pill 52 px high (the height of "Look up"). The PLAN.md close-out note discloses it.
- The brief's rules did not foresee that the model might write Hebrew speech in Latin letters. Rule 2 says "in the script spoken", but the live calls showed that wording was not enough.

## Deliberate divergences

- Steps 2 and 3 are one commit (8b8a743), because they share `public/lookup.js`. The team disclosed it in PLAN.md.
- **The team's checker did not check the last two commits.** 252fb5c merges main (pull request #24) into the branch, and 3651c51 makes the transcription instruction stricter (one constant and its check). I made both by hand at close-out, after the team was stopped, rather than restarting the team for a no-conflict merge and a one-sentence instruction change. Evidence instead: the full check on 3651c51, and 35 live calls with no miss. The result check reviews both commits.
- c682347 changes the thread's c7d72bd check (one wait added), rather than pushing a check that failed on this machine. It changes no app code and no check count.
- The pull request was opened by the earlier part of this session before it stopped at a prompt. This part pushed 252fb5c and 3651c51 to it and updated its description (`gh pr edit`) rather than opening a second one.

## Asks (with recommended answers)

None.

## What the next session needs

- Integration with hebrew-save-one, now: the speech build is on main (b765b90), so the hebrew-save-one session (team hebrew-save-mixed, running now) rebases its branch onto main, keeps both builds' behavior in `public/lookup.js`, `public/lookup.html` and `lib/db.js`, makes attaching a recording cover its `note:<id>` rows, and runs `npm run check` before its pull request. Nothing remains on this branch for it.
- A lasting fix for this repository's checks: the lesson-import checks in `scripts/smoke.mjs` start a test site on the fixed port 8795. When two teams on the machine run the full check at the same time, one reads the other's site (see "Checks"). Each run should take a free port.
- The restore line `rig up hebrew-speech-mixed` (snapshot `01M5MKJBJ6BFY6K0AZBKDG3TC9`) is only for continuing this job.

## Checks

1. Brief check: card hebrew-satellite, event 1993, FINDINGS (job 20261023-120910-d2eeec). Event 1995, FINDINGS (job 20261023-121224-2e9c3b). Event 1997, PASS (job 20261023-121520-dfa709) on the brief at event 1996. The coordinator fixed both FINDINGS rounds in the brief.
2. Team check 1: `qitem-20261023132319-94993f4c`, dev-check on 4dc0d83, FINDINGS (one finding: a pending microphone request was not cancelled when the page was hidden or left). Fixed in c1cff26 by `public/mic-ui.js` and six new page checks.
3. Team check 2: `qitem-20261023135701-ee16b34e`, dev-check on c1cff26, PASS.
4. `npm run check` on c4a8c85 (the team's last commit): `check: all passed: syntax, tests, screenshots` (`scratch-hebrew-speech-one/final-check.log`).
5. `npm run check` on 252fb5c, first run: `check: FAILED at tests (58.30 s)`. Two lesson-import checks in `scripts/smoke.mjs` ("import run twice…", "import --dry-run…") read 0 uploads where their own site had 3, and one call reached OpenRouter with no key ("No auth credentials found"). The cause is the fixed port 8795 shared with hebrew-save-one's team on the same machine. The rerun passed unchanged: `check: all passed: syntax, tests, screenshots` (syntax 4.86 s, tests 163.96 s, screenshots 542.51 s).
6. `npm run check` on 3651c51, first run: `check: FAILED at tests (29.19 s): failed: Error: nothing answered at http://127.0.0.1:8795/health`. That is the same fixed test port, while the machine was loaded (syntax took 9.79 s, against 4.86 s). Second run: `check: FAILED at tests (55.08 s): failed: a lesson with no guide opened twice at once starts one build, not two: both answer "building", one guide call — 202/202, guide calls 2`, while hebrew-save-one's team ran its full check in its own clone (its screenshots were written at 15:05 UTC, during this run). Third run, started only after no other clone's `node scripts/` process had run for 60 s: `check: all passed: syntax, tests, screenshots` (syntax 5.27 s, tests 170.84 s, screenshots 502.44 s).
7. On the rebased head (a5b0559, on c7d72bd): `node scripts/speech-smoke.mjs` and `node scripts/speech-pages.mjs`, first run: server checks `all 46 speech checks passed`; page checks `1 speech page check(s) failed, 35 passed`, `TypeError: Cannot read properties of null (reading 'key')` at `scripts/speech-pages.mjs:324`. Cause: c7d72bd reads the page's current look-up right after "Heard:" shows, but "Heard:" shows before the look-up answers, so on this loaded machine there was no look-up yet (GitHub's runner was fast enough to pass). Fixed in c682347, which waits for the look-up before reading its row. Second run on c682347: `all 46 speech checks passed` and `all 82 speech page checks passed` (logs `scratch-hebrew-speech-one/rebased-smoke2.log`, `rebased-pages2.log`).
8. `npm run check` on 55adb4e (the final candidate, after the rebase, the page-check fix and the report commits; same tree as main b765b90 plus the follow-up patch), run when no other clone's `node scripts/` process was running: `check: all passed: syntax, tests, screenshots` (syntax 8.43 s, tests 156.85 s, screenshots 512.74 s).
9. Result check 1: job 20261023-154331-7436e6 on card event 2013, FINDINGS (one finding: the full check had not been run on the final candidate, only the two speech scripts). Fixed by run 8.
10. Result check 2: job 20261023-155800-eda121 on card event 2019, FINDINGS (one finding: "What the next session needs" held the save integration until hebrew-save-one merged). Fixed by handing that work to the hebrew-save-one session now, and by updating the "Main merged in" line to match.
11. Result check: the verdict on this report's final version is named in the closing message to Dan.

## Fly machine and OpenRig lessons

- **Two teams' checks collide on fixed ports.** This repository's test sites use fixed ports (8795 here, 8820–8823 per FACTS.md). A full check overlapping another team's check failed falsely. That cost one 1-minute failed run, the time to diagnose it, and a 12-minute rerun. What fixed it: rerunning. The lasting fix is a free port per run (see "What the next session needs").
- **The OpenRig daemon was UNHEALTHY all session** ("event loop may be starved"). `rig queue list` answered "Daemon did not respond", so this report's queue ids come from the checker's own reports. `rig down --snapshot` still worked the first time.
- **A live check found what the stand-ins could not.** The stand-in answers "אמת" from a fixture every time, so no offline check could see the model's roughly 7% Latin-letter answers. Repeated live calls (about US$0.0001 each) caught them. A speech or model-wording change deserves 20 or more live calls, not one.
- **A resumed session finds earlier pushes.** The branch was already on GitHub at c4a8c85 and pull request #25 already existed, although the coordinator's note said the earlier session stopped before pushing. Checking `gh pr list --head` before `gh pr create` avoided a duplicate pull request.

## Closing message to Dan

The reader's Look up page now has a Speak button. Say a Hebrew or English word, and the reader writes it down, looks it up, and keeps your recording to play back. One fault turned up in a live test and is fixed: the model sometimes wrote a Hebrew word in English letters. The Speak button is merged and live: https://github.com/isleofdan/hebrew-reader/pull/25 . The Hebrew-letters fix follows in a second pull request the project thread opens; it brings you that merge.
