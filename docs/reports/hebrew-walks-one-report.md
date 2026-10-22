# FIELD REPORT — hebrew-walks-one — 22 Oct 2026

Permission mode: Auto (the session ran in auto mode; the OpenRig seats ran in Accept edits, and the session answered their prompts).

This is the session's own report, written on the machine on 21 Oct, completed and filed by the Personal Shipyard thread that supervised it. The session stopped at the permission prompt for pushing its report file at 20:58 UTC on 21 Oct and had not moved by 01:05 UTC on 22 Oct; the thread read the file off the machine with the read-only machine check (agent-machine run 39704388184), added what happened after the session's last line (pull request #20, the stall itself, the machine's two drifted files), and filed it. The session's own lines stand as it wrote them; the additions are marked "(thread)".

## What stands

- **The OpenRig team did the work.** The builder was seat `dev-owner@hebrew-today-two-mixed` (Claude Code) and the checker was seat `dev-check@hebrew-today-two-mixed` (Codex), in rig `hebrew-today-two-mixed` (id `01M5FA96MMTK15SX7MTS39T9QY`). The team was started fresh on the clone `~/work/hebrew-walks-one` from the existing spec copy `~/openrig-setup/rig/hebrew-today-two-mixed.rig.yaml`, while another session's team (`sync-board-mixed`) worked in its own clone. Queue items:
  - Builder job: `qitem-20261021133056-05fd3b64`, done.
  - First check: `qitem-20261021142925-b4f8d9db`. FINDINGS on 0e4948d, two findings.
  - Builder fix: `qitem-20261021143725-9131003f`.
  - Recheck: `qitem-20261021145204-eacc5d9d`.
  - Checker's closing note to the builder: `qitem-20261021145459-a9b281a3`, done.
- **The checker's final verdict line, verbatim:** "PASS for candidate 5a73251eea24980c568c44e5c4dd0ba8de920e3c in /data/home/dan/work/hebrew-walks-one. Both prior findings resolved. Independent node scripts/walks-smoke.mjs: all 48 checks passed."
- **Pull request:** https://github.com/isleofdan/hebrew-reader/pull/18, branch `claude/hebrew-walks-one`, 6 commits on base 2c3a4a4, head 5a73251. MERGED on Dan's yes (15:01 UTC), merge commit 309f865, at 15:14 UTC. LIVE: Deploy run 39623883094 is green.
- **Step 1, Sefaria and the passages** (commit d4cbf5d). `lib/sefaria.js` `passage(ref)` fetches through Sefaria's Texts API v3, `GET <SEFARIA_URL>/api/v3/texts/<ref>?version=hebrew&version=english`, within the 20-second limit the server's other outside fetches use. It answers `{ ref, title, he, en, url }`, with tags and footnotes stripped and one line per segment. An unknown reference answers 404 naming it; Sefaria unreachable or slow answers 502 "Sefaria could not be reached". New table `passages` (inside `migrate()`); a reference is fetched once. A passage is kept to its first 40 segments in each language (see Deliberate divergences, 9). The stand-in Sefaria is `scripts/mock-sefaria.mjs`.
- **Step 2, the desk and the walk's records** (commit f63e922). The `thought` desk is in `lib/ask-desks.js`:
  - the persona, sharpened from the sample stop;
  - `www.sefaria.org` as its one site;
  - `GUIDE_MODEL`, falling back to the card model;
  - limits: a stop `{ 3000 tokens, 120 s }`, *choose* `{ 600 tokens, 60 s }`;
  - `turns` 10, while `hebrew` keeps 6 and `chainOf` reads the field from the desk.

  The subject kind `walk` is in `lib/ask.js`. New table `walks`; new columns `asks.walk_id`, `asks.ref` and `asks.took_ms` by `ALTER TABLE … ADD COLUMN`. `lib/walks.js` holds `start`, `step`, `get` and `list`. A stop is two calls through `ask`: *choose* (not recorded, retried once on an unknown reference) and *teach* (recorded).
- **Step 3, the routes** (commit b09bc78). The pages `GET /walks` and `GET /walks/<n>`, and the data routes `GET /walks/list`, `POST /walks/start`, `GET /walks/:id/stops` and `POST /walks/:id/step`. Refusals name the valid values.
- **Step 4, the pages** (commit f8f3ed6). `public/walks.html`, `public/walks.js` and `public/app.css`, with "Walks" after "Today" in every top navigation. On the phone the navigation now wraps to a second line on every page.
- **Step 5, checks and docs** (commit 0e4948d, fixes in 5a73251). `scripts/walks-smoke.mjs` (48 checks) and `scripts/walks-pages.mjs` (27 checks, 28 screenshots), plus the stand-in model's `thought` answers. The new counts are in `docs/CHECKS.md`, the close-out note "hebrew-walks-one" is in `PLAN.md`, and the README paragraph is added.
- **Sefaria interface and address rule used:** Texts API v3 as above. The "Full passage" address is `https://www.sefaria.org/` plus the canonical reference with spaces turned to `_`, `:` turned to `.`, and the space before the section numbers turned to `.`, so `Shabbat 112b` becomes `/Shabbat.112b` and `Genesis 1:1-3` becomes `/Genesis.1.1-3`. The rule sits beside the Sefaria search link in `lib/references.js`. Sefaria's "Text References" page only says spaces may be `_`; the rest follows how sefaria.org writes its own addresses, and each one was opened live and answered 200.
- **After the merge, not the team's:** Dan tried Walks live on his phone, and the Personal Shipyard thread's own session made two follow-up pull requests the same day, each with the full local checks and the Checks workflow green and merged on Dan's yes:
  - https://github.com/isleofdan/hebrew-reader/pull/19 at 15:44 UTC (merge commit ccfe3ce, Deploy run 39628392350, green): the typed question is kept in the browser's storage until the walk exists, the start question may be 4,000 characters (it was 1,000, and Dan's first question was refused and then lost on a reload), a counter shows the length past 75 %, and a read-only Logs workflow (`.github/workflows/logs.yml`, run by hand) prints recent server log lines and the walks list.
  - https://github.com/isleofdan/hebrew-reader/pull/20 at 20:51 UTC (merge commit d2f049d, Deploy green) (thread): a stop is made in the background and the page polls `GET /walks/:id/stops` every 3 s until it lands, so a cut connection or a reload during the one-to-three-minute first stop loses nothing ("Failed to fetch" on the phone; `?wait=1` keeps the waiting shape for the checks); and a *reply* stop: when the guide answers a move itself instead of naming a passage (Dan's pushback "tell me what you think my question means before searching the texts further" came back as "the model gave no answer"), *choose* may answer `{ reply, next }`, recorded as a stop with no reference and no teaching call, drawn as "Stop N · the guide answers" with its directions. The walks checks are now 60 server and 34 page.

## UI review

Screens touched: the walks page (`/walks`), a walk's page (`/walks/<id>`), and the top navigation on every page.

1. **Speed of the frequent action:** on a walk, choosing the next stop is one tap on a direction. A pushback is the box plus "Go". Since #20 the page keeps up while the stop is made in the background, with the seconds counting (thread).
2. **Recovery:** a failed stop shows its line where the buttons were, says which part failed (the guide, Sefaria, or the time limit), and brings the buttons back. A second move sent during a stop is refused with "wait for it to arrive", and the walk stays one line. Since #19 the typed question survives a refusal and a reload; since #20 a cut connection or a reload during a stop loses nothing, and a reflective pushback is answered rather than failed (thread).
3. **Finding the tool:** "Walks" sits after "Today" in every page's top navigation.
4. **Orientation:** the walk's question is its title. Each stop is headed "Stop N · <passage title>", and "← Walks" goes back to the list.
5. **Feedback:** "Thinking…" replaces the buttons at the same height. The choice then stays on screen as "You chose: …" or "You wrote: …", and each stop ends with "answered in N s".
6. **Interruption:** no model call runs on opening a page or reopening a walk (checked: no request to the stand-in model or the stand-in Sefaria). Nothing notifies.
7. **Thumb reach:** on the phone the directions and "Go" are full width, 63, 63, 63 and 56 px high.
8. **Defaults and prefill:** `/walks?ref=<reference>` fills the box as "Start from <reference>". The question box starts empty, with the placeholder "a question to walk with…".
- **Not added:** deleting a walk, search across walks, and audio (out of scope in the brief). The typed question was not kept across a reload during the one-to-three-minute first stop. Dan hit this live, and pull request #19 fixed it after this session.
- **Which came from Dan's own requests:** 1, 5 and 6. He asked for a walk where he picks the next stop or pushes back, sees what he chose, and has no model calls until he presses. Then 2, from his phone tests the same day (thread).
- **Screenshots:** `docs/screenshots/walks-{empty,with-walks,one-stop,thinking,after-pick,after-pushback,failed}-{phone,desktop}-{light,dark}.png` (28). "After a mistake" is the `failed` state. The session inspected `walks-one-stop-desktop-light.png` and `walks-after-pick-phone-light.png`: three columns on the computer and stacked on the phone, with "You chose" between the stops. `walks-reply-*` (4) from #20 (thread).

## Verify (numbers)

Source: the session's own runs on 5a73251 of `node scripts/walks-smoke.mjs` (all 48 passed) and `node scripts/walks-pages.mjs` (all 27 passed), saved in `~/work/scratch-hebrew-walks-one/walks-smoke.log` and `walks-pages.log`, unless named otherwise.

1. `POST /walks/start` with a question wrote one `walks` row and one `asks` row (`walk_id` set, `ref` canonical, `took_ms` a number, `parent_id` null, desk `thought`, subject_kind `walk`). `passages` held the reference once. The stand-in model saw two calls, *choose* (no search, 600 tokens) then *teach* (search on www.sefaria.org only, 3000 tokens), and only *teach* carried the Hebrew and English.
2. A step by pick and a step by text each wrote one `asks` row with `parent_id` the previous stop. The third stop's requests carried the two earlier stops' JSON. A walk of twelve stops carried the last ten (turns 3 to 12). Three stops took six calls and wrote three rows, so *choose* writes none.
3. An unknown reference was retried once carrying Sefaria's message. A second miss gave the failure line and no `asks` row. A declined first stop wrote the `walks` row only (one *choose*, no *teach*).
4. `POST /walks/start { ref }` made one call (*teach*); `start_ref` is the canonical reference.
5. `<big>` in the Hebrew and `<b>` plus a footnote in the English were stripped. An unknown reference answered 404 naming it. Sefaria dropped and Sefaria silent each answered 502 "Sefaria could not be reached", the second at the 20-second limit. A second fetch, with the reference written another way, made no request.
6. With the desk's limits replaced at 5 s: a *teach* answering after 4 s was kept (`took_ms` at least 4 s). One that never answered ended at the limit with the failure line naming the time limit, and no row.
7. `node scripts/grow-smoke.mjs`: all 83 passed (the checker's independent run on 0e4948d; unchanged surfaces since). Six turns carried for `hebrew`.
8. Pages: seven states at 390 px and 1280 px, light and dark (28 screenshots). Pressed direction's top versus the "You chose" line's top: 514.59 → 514.59 px at 390 px and 483.19 → 483.19 px at 1280 px, 0 px apart. Pushback: −0.28 px. Phone buttons: 63, 63, 63, 56 px. Reopening made no request to the stand-in model or Sefaria. Signed out, `GET /walks` and `GET /walks/1` answered 303 to `/login`, and `GET /walks/list` and `/walks/1/stops` answered 401.
9. The session's `npm run check` on 5a73251: syntax 3.64 s, tests 110.52 s, screenshots 278.29 s, last line `check: all passed: syntax, tests, screenshots`. Totals: 718 server checks (baseline 670) and 614 page checks (baseline 587). The paper-pages flake did not occur.
10. After the merge, Deploy run 39623883094 was green. Live, signed out, at 15:58 UTC: `GET https://hebrew-reader-dan.fly.dev/walks` answered 303 to `/login`, as predicted, and `/walks/list` answered 401.
11. (thread) After #19 and #20: `scripts/walks-smoke.mjs` 60 and `scripts/walks-pages.mjs` 34, all green in the Checks runs on 2cdb218 and 487c7a4 and in the thread's `npm run check` (syntax 3.09 s, tests 104.12 s; the thread's machine has no browser, so the Checks workflow ran the screenshots). `docs/CHECKS.md` still shows the #18 counts (totals 718 and 614; with #19 and #20 they are 730 and 621).

## What the brief got wrong

1. It did not foresee that a first stop takes one to three minutes on the phone, during which a reload loses the typed question. Rule 6 covered keeping Dan's place, not his typed text across a long wait. Dan hit it live, and pull request #19 fixed it. For the template: a long model call from a typed box should keep the box's text until the result arrives.
2. It said Sefaria's documentation gives the passage address rule. It only says spaces may become `_`; the rest of the rule was taken from sefaria.org's own addresses and checked live.
3. It said "expect one push prompt". Prompts came for the push, and again for the merge, and each waited on Dan.
4. (thread) It assumed a stop arrives inside one request; on the phone the connection does not hold one to three minutes ("Failed to fetch"). #20 moved the stop into the background with polling.
5. (thread) Its *choose* format allowed only a reference or a decline. A pushback that asks the guide to reflect has no reference to name, and the guide's answer was read as none. #20 added the reply stop. The brief's checks ran against a stand-in model that answers at once, so none of the three faults in 1, 4 and 5 could show in them.

## Deliberate divergences

1. `ask` in `lib/ask.js` takes three caller settings beyond the brief's `format` and `record`: `read` (how the answer is read from the model's JSON), `limits` (the desk's `choose` limits for the short call) and `search` (off for *choose*). The two calls could not be made without them, and the `hebrew` desk's callers pass none.
2. `lookup.chat` now sends the earlier turns on a call without the search too (it dropped them, and no caller had passed them before). The model-not-found fallback now also covers the call with the search. *Choose* needed both.
3. The phone's top navigation wraps to a second line on every page, because the sixth link made pages wider than 390 px. Every page looks slightly different at the top on the phone.
4. From the checker's findings, not the brief: a stop missing its reason, its transliteration or two to three explained directions is refused unsaved, and a walk takes one move at a time (409).
5. The session sent the builder the brief as a file (`~/work/scratch-hebrew-walks-one/brief.md`), as the brief allowed, and assigned the pull request to Dan with `gh api`. The review request failed, because the author cannot review their own pull request.
6. This session was the third start. An earlier start set up the clone and team and sent the job (13:26–13:27 UTC), then went silent with the builder stuck on a prompt. The session took the team over as it stood rather than restarting it.
7. (thread) Pull requests #19 and #20 were made by the supervising cloud thread directly, not through the team on the machine: the machine's disk had been full that morning, the build session was closing out, and Dan was testing live and wanted the fixes fast.
8. (thread) This report is filed by the supervising thread, with the session's file read off the machine, because the session's report push waited on a prompt from 20:58 UTC on 21 Oct past 01:05 UTC on 22 Oct.
9. (thread) The brief's step 1 asked for the passage's Hebrew and English with the segment breaks kept. `lib/sefaria.js` keeps the segment breaks but cuts each language to its first 40 segments (`SEGMENTS_MAX`, commit d4cbf5d, with the comment "a long reference (a whole chapter) is cut here; 'Full passage' has the rest"). The reason: a stop's teaching call carries the passage inside a 3,000-token answer and 120-second limit, and the walk carries the last ten stops' JSON on every later call, so a whole chapter or daf would crowd out the teaching and the chain. The guide names a passage of a few verses or lines, which is under the cut; a long reference is cut and the "Full passage" link under every stop opens the whole text on sefaria.org. The session's report did not say this; the result check on 22 Oct found it. Not yet decided: whether to raise the cut, or to show "first 40 of N segments" on the stop when it applies.

## Asks

None.

## What the study tool needs

- **Table of contents:** Sefaria's `GET https://www.sefaria.org/api/index` (the whole library tree, about 4 MB) and, per book, `GET /api/v2/index/<title>` (its sections, e.g. Shabbat's dapim). Both answered 200 from the machine on 21 Oct.
- **Daf Yomi:** Sefaria's `GET /api/calendars` lists today's items. On 21 Oct the "Daf Yomi" entry answered `Bekhorot 33`, with a `ref` ready for `/walks?ref=`.
- **A reading position:** a small new table beside `walks` (book, current reference, updated time), added in `migrate()`. Walks already key everything by canonical reference (`walks.start_ref`, `asks.ref`, `passages.ref`), so nothing in the walk's records changes.
- **"Start a walk here":** sends the passage's canonical reference to `POST /walks/start { ref }`, or opens `/walks?ref=<reference>`, both live now.
- **What the walk page lacks for a walk started at a passage:** its title is the passage's title, with no question. There is no link back to the place in the table of contents, and nothing for "next passage" in reading order.
- **Interface and address rule the code uses:** Texts API v3 (`GET /api/v3/texts/<ref>?version=hebrew&version=english`), and the sefaria.org address built from the canonical reference by `lib/references.js` (spaces to `_`, `:` to `.`, the space before the sections to `.`).

## What the next session needs

- The team's last snapshot is `01M5FFPQQTTGBX8M1EAPJYAHZH` (rig `hebrew-today-two-mixed`, id `01M5FA96MMTK15SX7MTS39T9QY`), recorded in FACTS.md. Use it only to continue this job; a new job starts the team fresh.
- The disk is now 50 GB (39 GB free at 20:56 UTC). The volume was grown on Dan's yes after this merge, and Fly grows it by itself by 10 GB at 80% full, up to 100 GB (FACTS.md, "The machine").
- The live site now carries pull requests #19 and #20 on top of this work. Start from `main`.
- (thread) `docs/CHECKS.md` records the walks checks at 48 server and 27 page; after #19 and #20 they are 60 and 34 (totals 730 and 621). The next change to the repo should update the counts.
- (thread) The machine's deploy (isleofdan/agent-machine) ended red on 21 Oct on one post-deploy check: `~/openrig-setup/tools/seat-watch.sh` on the machine (edited 15 Oct: ERROR and UNPICKED alerts) differs from the repo copy; and the same deploy installed the repo's stale FACTS.md over the machine's. Both machine copies are carried into the repo byte for byte in the pull request `claude/machine-files-sync` on agent-machine, to be merged when no build session is running on the machine (merging restarts it).
- What changed on Dan's screens: "Walks" is in every top navigation, with the Walks page and the walk page as described; since #19 a long question is kept; since #20 the stop keeps coming after a reload or a dropped connection, and a reflective pushback is answered as "the guide answers".

## Checks

1. Brief check, job `20261021-082246-53b4a4`: FINDINGS (two: the same GET paths serving both pages and data; the smoke-test wording asking for null stop fields that Verify required set). Fixed in the next version by the chat.
2. Brief check, job `20261021-082704-7fa137`: PASS (event 1806, the brief this session ran).
3. Team check 1, queue `qitem-20261021142925-b4f8d9db`, candidate 0e4948d: FINDINGS.
   - Incomplete teaching answers (blank reason or transliteration, one unexplained direction) were saved as stops. Fixed in 5a73251: such a stop is refused with a line naming what is missing, nothing is saved, and a regression check was added.
   - Two simultaneous steps forked the saved chain. Fixed in 5a73251: one move at a time per walk, the second answers 409, and a regression check was added.
4. Team check 2, queue `qitem-20261021145204-eacc5d9d`, candidate 5a73251: PASS.
5. The session's full `npm run check` on 5a73251: all passed. (thread) Checks workflow green on 2cdb218 (#19) and 487c7a4 (#20); Deploy green after each merge.
6. Result check, job `20261022-011056-23f4bc`, on the thread's first version of this report (card event 1824): FINDINGS, one: the seat names, queue item ids and the checker's verdict line were missing, because the session's file was unpushed. Fixed in this version by reading the file off the machine.
7. Result check, job `20261022-012130-08cb4b`, on the second version (card event 1826): FINDINGS, one: the 40-segment cut on a passage was not reported. Added as deliberate divergence 9 in this version.
8. Result check: run on this version of the report. Its verdict is named in the closing message, per Dan's rule that only the final version's verdict stays outside the report.

## Fly machine and OpenRig lessons

1. **A full disk silently kills sessions.** The disk reached 0 bytes free, and the first two starts of this session went silent. Cost: two lost runs and about an hour. Fix: Dan's yes cleared old `node_modules` (back to about 750 MB). He approved growing the volume to 50 GB with auto-grow, and a new standing rule makes every session check `df -h /data` at start and before installs. A cache deletion without his yes was refused [Irreversible Local Destruction].
2. **seat-watch missed prompts.** One builder prompt sat unreported until the session looked itself (the 30-minute watch delivered no events while a prompt was on screen). Cost: the builder idled for several minutes. Fix: a second check in the same Monitor that flags any prompt seen in two reads 15 s apart, regardless of the screen signature. It caught every later prompt. The lasting fix is to change `seat-watch.sh`'s WAITING signature to the prompt lines only, through the agent-machine repository.
3. **A merge prompt blocks the turn until Dan answers.** The session's `gh pr merge` waited on the approval prompt from about 15:07 to 15:14 UTC. Dan's "Push" at 15:00 approved the earlier push prompt rather than answering the merge question. Lesson (as in hebrew-ask-one): send the "a prompt may appear" line first, and read a one-word reply as possibly approving a prompt.
4. **The Codex checker needs outside-sandbox runs for every local server check.** Port inspection, walks-smoke, walks-pages and grow-smoke each asked once per round. All were within the job, so the session said yes once each.
5. **Two teams ran side by side without a clash** (this one and `sync-board-mixed`); the check ports 8820–8823 and 8910–8913 were free at each run.
6. **A deploy of the machine replaced FACTS.md with a stale repo copy.** The disk-upgrade deploy (about 20:56 UTC) restarted the machine. That ended this session mid close-out, and it installed the repository's FACTS.md, which had lost the OpenRig team and snapshot history and the "Secrets page" section. The old copy survived as `FACTS.md.bak-20261021-205633`. Cost: about five hours before close-out resumed, and a FACTS.md repair. Fix: the session rebuilt `/data/home/dan/FACTS.md` from the backup, plus the deploy's three new disk lines and its snapshot line. (thread) The lasting fix, the repo copy made equal to the machine's, is in the pull request `claude/machine-files-sync` on agent-machine.
7. (thread) **A permission prompt at the end of a job stalls the whole chain.** The session's report push waited on a prompt from 20:58 UTC on 21 Oct past 01:05 UTC on 22 Oct, through the machine restart and a "Y" from Dan in the thread that did not reach the prompt, holding the disk merge and the next project for hours. Fix: the supervising thread files the report itself when the session's prompt is unanswered for longer than the push takes, reading the session's file off the machine with the read-only machine check (an extra path in `machine-check.yml`'s files step, on a session branch; the run took 34 s).
8. (thread) **Checks against an instant stand-in model never exercise the phone's long wait.** Three faults (a lost long question, a dropped connection during a three-minute stop, a reflective pushback with no passage) passed every check and showed only in Dan's hands. Fix for the next brief: a stand-in delay of at least the real first stop's length in one page check, and a stand-in *choose* that answers without a reference.
9. (thread) **Messages to a Remote Control session can arrive hours late.** Dan's "Merge" sent at 15:13 UTC reached the session after the 20:56 UTC restart. The thread acted on his yes directly, so nothing waited on the relay.

Prompts answered on the seats: 26 (log at `~/work/scratch-hebrew-walks-one/prompts.log`): 10 by the earlier start, including two session-only grants for the job's scratch folder, and 16 by the third start, each a one-time yes. None went to Dan.

## Closing message to Dan

Walks is live. Open https://hebrew-reader-dan.fly.dev/walks, type a question and press Start. Each stop is one passage in Hebrew, its transliteration and its English, fetched from Sefaria. Under it come why the guide chose it, a plain explanation, where the tradition argues with itself, and the guide's opinion. You then pick one of two or three directions or push back, and your walks are saved and reopen instantly. The team's checker passed it after two fixes.

From your phone tests the same day, also live: a long question is kept and no longer refused; the stop keeps coming even if you leave the page or lose signal, with a counter for the wait; and a pushback that asks the guide to reflect rather than open a passage comes back as a stop titled "the guide answers".

Needed from you: nothing to decide.
