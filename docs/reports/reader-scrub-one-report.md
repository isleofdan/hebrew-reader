# Field report: reader-scrub-one (26 Oct 2026)

Nothing on Dan's screen changes: the reader looks and works the same, and only what Sentry receives is smaller. The Sentry issue's event (linked under "Verify results" once the merge is confirmed) is where the difference shows.

Session `reader-scrub-one`, on the Linux machine (agent-machine-dan), permission mode Auto. Brief: the `# START HERE — reader-scrub-one` note on Wall card `crash-reporting` (event 2189, brief check PASS job 20261026-124013-8f14c0). Branch `claude/reader-scrub-one`.

## What stands

- **The OpenRig team did the code change.** Rig `reader-scrub-one-mixed` (id `01M5W4CC54FMQ2TKW6YYNY65D8`, from a copy of the team spec with only `name:` changed), builder seat `dev-owner@reader-scrub-one-mixed` (Claude Code, auto mode) and checker seat `dev-check@reader-scrub-one-mixed` (Codex). Queue items: the builder's job `reader-scrub-one-keeplist`, the check `qitem-20261026133745-235af5a2`, and the checker's verdict returned as `qitem-20261026134041-daf218de` (closed done).
- **dev-check's verdict line, verbatim:** "Independent QA result: no blocking findings for candidate 04023716083766b5105ed07566dc054baf3cffd2 in /data/home/dan/work/reader-scrub-one, diff 85446b5..0402371."
- **`public/crash.js`** now builds each event from the kit's keep-list. From the opening `(function () {` to the end, the file is byte for byte the starting kit's (`isleofdan/starting-kit` `main`); the header comment keeps the reader's own notes on what its addresses carry. The event that leaves keeps id, time, level, platform, environment, release, SDK name and version, and each exception's type, message, mechanism and frames (file, abs_path, module, function, line, column, in_app, with query and fragment stripped), plus breadcrumbs outside http, fetch, xhr, console, navigation and ui.*. `SETTINGS` adds `includeServerName: false`, `includeLocalVariables: false`, `dataCollection` with every switch off and `frameContextLines: 0`, and an `integrations` function that removes ContextLines, LocalVariables, LocalVariablesAsync, Context, CultureContext and Modules. Exports: `scrub`, `SETTINGS`, `DROPPED`, `SKIPPED`.
- **`lib/crash.js`**: its code was already the kit's; only its comment changed, now describing the keep-list. `server.js` and the capture call sites are unchanged.
- **Bundle**: `npm run build` regenerated `public/sentry.min.js` with no difference (the bundle is Sentry's own code; `public/crash.js` is not inside it), so there was nothing to commit for it. Sentry versions unchanged at 11.8.0 (see "What the brief got wrong").
- **Tests** (`scripts/crash-smoke.mjs`, 47 → 52 checks): five added (the keep-list on a full sample event with request, user, contexts, modules, tags, extra, a frame with source lines and variables, and every dropped breadcrumb category plus a kept one; no server name or local variables; `dataCollection` off with `frameContextLines` 0 and `stackFrameVariables` false; the integrations function removing the six and keeping others; only keep-list fields in what reached the stand-in Sentry) and one changed (threads are now dropped, where the old check had them kept with frame queries stripped). The existing check that the committed bundle equals a fresh build stays.
- **Docs**: the README's crash-reporting paragraph says what leaves and what is dropped, in the kit's words with the reader's examples; `docs/CHECKS.md` has the counts before and after; `PLAN.md` has this session's close-out note.
- Commits: 6071f64 (public/crash.js), 63a6cbf (lib/crash.js), fe18a17 (crash-smoke and CHECKS.md), 0402371 (README), then this report and the `PLAN.md` note.

## What the brief got wrong

- The brief named "the crash tests under `test/`" and "the reader's crash test file". The reader has no `test/` folder; its crash checks are `scripts/crash-smoke.mjs`, run by `npm test`. The job text said so, and the tests went there.
- The brief expected the bundle to change after editing `public/crash.js` and said to commit the rebuilt `public/sentry.min.js`. The bundle is built from `@sentry/browser` alone, so the rebuild was byte-identical and there was no change to commit.
- The kit's `dataCollection` includes an `mcp` switch that Sentry 11.8.0 does not have (dev-check found it by probing the installed SDK's own option resolver). It is ignored by 11.8.0, and every option 11.8.0 does know resolves to off, so nothing collects. Not a defect; noted because the brief said the kit's settings would be copied as they are.

## Deliberate divergences

- None in the change. One in supervision: my baseline `npm test` run redrew the committed screenshots under `docs/screenshots` (this machine's fonts differ), so I restored them and told the builder, in a second message, to keep `docs/screenshots` out of every commit. No screenshot is in the diff.

## Verify results

- **Version check**: Sentry's JavaScript options page (https://docs.sentry.io/platforms/javascript/configuration/options/) lists `dataCollection` as "Available since 10.57.0". The reader's installed `@sentry/node` and `@sentry/browser` are 11.8.0 (`package-lock.json`); the kit's are declared `^11.9.0` and resolved 11.9.0. 11.8.0 is newer than 10.57.0, so no upgrade was made.
- **`npm test` before** (main at 85446b5, run by me): exit 0, 1,009 checks passed, 47 of them crash checks.
- **`npm test` after** (candidate 0402371, run by me): exit 0, 1,014 checks passed, 52 of them crash checks.
- **`npm run check` after** (run by me on 0402371): exit 0, "check: all passed: syntax, tests, screenshots" (syntax 3.28 s, tests 122.34 s, screenshots 476.99 s). The screenshots it redrew were restored afterwards; none is in the diff.
- The builder's own runs (recorded in `docs/CHECKS.md`): `npm run check` passed in full on its third run; the first two each failed one check outside crash reporting (`smoke.mjs` "a lesson with no guide opened twice at once starts one build, not two" and `paper-pages.mjs` "phone: a share from another website is shown and saved only when Dan taps"), both timing races on a loaded machine that passed on the next run.
- dev-check, independently: `node scripts/crash-smoke.mjs` 52 of 52; `npm run build` exit 0 with no diff (86,293 bytes); every resolved data-collection option off; `git diff --check` clean.
- **After the merge** (step f): CONFIRMATION.

## Asks for the origin chat

1. Merge pull request PR_URL ("Crash reports send only the error and its place in the code: the kit's keep-list scrub"). Recommended: yes. Merging deploys the live reader, which looks and works the same.

## What the next session needs

- spine-scrub-one makes the same change in the Spine. The kit's `public/crash.js` from `(function () {` onward can be copied byte for byte, as here. Its `mcp` switch is harmless on Sentry 11.8.0.
- The team snapshot is `01M5W7AJ8S2Y27QQAGBJV74TYM` (restore line `rig up reader-scrub-one-mixed`), only for continuing this job. A new job starts the team fresh.

## Fly machine and OpenRig lessons

1. **A timed-out `rig send` can still land.** My first job send answered "did not respond in time … Delivery UNCONFIRMED". The builder's screen showed the job had arrived, so I did not resend. Cost: about two minutes of checking. Fix: always read the seat's screen before resending. The memory note "a timed-out rig send was not delivered" is too strong, and I've corrected it.
2. **The daemon starves for minutes at a time, and a restart does not cure it.** It went UNHEALTHY within a minute of every restart (my keeper restarted it four times between 13:03Z and 13:30Z). Pausing the seat watcher for three minutes did not change that, so the watcher's own queue calls are not the cause; the daemon's own work on its 508 MB database (`~/.openrig/openrig.sqlite`) is. Cost: queue reads timed out for minutes, which slowed the builder's queue updates and my reads of the verdict. Fix for this session: raise the keeper's restart threshold from 3 to 6 bad checks, since the daemon recovered on its own after about two minutes. Lasting fix: prune the daemon's `usage_samples` table (asked of Dan before, asi-mail-one Ask 6); it has to go through a change to the OpenRig setup, because sessions here may not run `sqlite3`.
3. **`rig down --snapshot` needs a responsive daemon.** It refused once with "Daemon did not respond". `rig daemon stop` then `rig daemon start`, then `rig down`, worked at once, as in kanji-crash-one.
4. **Test runs on this machine redraw the committed screenshots.** Restore `docs/screenshots` after every `npm test` or `npm run check` in a reader clone, and tell the builder so in the job text from the start.

## Checks

- Brief check: PASS, job 20261026-124013-8f14c0 (69 s).
- Team check, round 1: dev-check `qitem-20261026133745-235af5a2` → `qitem-20261026134041-daf218de`, no blocking findings for 0402371.
- Result checks: RESULT_CHECKS.
