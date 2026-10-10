# FIELD REPORT — hebrew-lookup-one — 2026-10-10

MERGED and LIVE: two pull requests, both merged into `main` by this session on Dan's yes, and both deploy runs green.

- **#12** (https://github.com/isleofdan/hebrew-reader/pull/12), the Look up page: merged at 11:32 JST, 10 Oct 2026 (02:32 UTC), as `b856ce7`; deploy run 38017340068.
- **#13** (https://github.com/isleofdan/hebrew-reader/pull/13), the follow-on adding the redirect gate's false-rejection checks: merged at 12:18 JST (03:18 UTC), as `7b3a8b6`; deploy run 38020091428.
 Only the signed-in live checks (Ask 1) are still to do, and they are Dan's.

Session hebrew-lookup-one, on the rented Linux machine agent-machine-dan, in auto mode. Brief: the latest "START HERE — hebrew-lookup-one" note on card `hebrew-satellite`, the copy that passed brief check `20261009-144122-d83f30`.

## What stands

- **The OpenRig team did the work.** The builder `dev-owner@first-project-mixed` (Claude Code) did steps 1–7, plus one commit fixing the checker's findings. The checker `dev-check@first-project-mixed` (Codex) checked the result twice. Team `first-project-mixed`, id `01M4GJC4D8THKXD6E3NXSJSS7D`, was started fresh on the clone `~/work/hebrew-lookup-one`; `rig up` archived the earlier team `01M4DR9YM97TS76CZKZ00S2CKD`.
  - Queue items:
    - builder's job: `qitem-20261009145349-ad3ebb95` (done)
    - check, round 1: `qitem-20261009161330-38684625`
    - FINDINGS: `qitem-20261009161811-b1f04a48`
    - check, round 2: `qitem-20261009162752-d7f91ebb`
    - verdict: `qitem-20261009162946-41eb9e4f` (done)
  - The checker's recorded verdict line, verbatim: "PASS for candidate f61db0262ad035802afa991698634278ad44710a."
  - **Follow-on (pull request #13)**, done by the same team restored from its snapshot:
    - builder's job: `qitem-20261010025330-1960ed1e`
    - check: `qitem-20261010030127-e532197a`
    - verdict: `qitem-20261010030312-ac69f49f`, verbatim: "PASS for candidate d1a5f675126f864d8fa84d8a2c2ed42adb65a26c."
  - This session did not change the team's code. It pushed the branch, opened the pull request, merged it on Dan's yes and watched the deploy.
- **Look up page, live at https://hebrew-reader-dan.fly.dev/lookup:**
  - A search box. Enter shows the word's own card and saves the word as Dan's at once (a new word becomes "shaky", the same as pressing save in the reader). The search is recorded on the card as a lookup "looked up on the Look up page", with origin `lookup`.
  - Seven reference tabs in the standing order. Each tab fetches nothing until it is tapped, then opens inside the page and is recorded on the card.
  - "Looked up": every word looked up there, newest first, with the day and the tabs opened, 200 at a time with "Show more". Each row has a tick box, and "Put on a desk" lands the ticked cards on tonight's desk, unplaced.
  - The page is linked as "Look up" on the articles, desk, phone, reader and lesson pages.
- **Desk cards:** a card's "Look up in" row opens the reference in a pane under the row, with Close and one pane at a time. The lookup is recorded with `POST /card/<key>/lookup` as before. No new tab.
- **How each reference is shown** (`lib/references.js` field `embed`, set from the step 1 frame test recorded in `docs/REFERENCES.md`):

  | Reference | `embed` | Why |
  | - | - | - |
  | Morfix | copy | `X-Frame-Options: SAMEORIGIN`. From the machine the fetch meets an AWS WAF challenge (202) or a 403, so the pane will most likely show "The site did not answer; open it directly". |
  | Pealim | copy | `X-Frame-Options: SAMEORIGIN`. The fetch answers 200 with the results, so the copy works. |
  | Wiktionary | frame | No `X-Frame-Options`, no `frame-ancestors`. The search for להמר lands on the entry המר. |
  | Milog | frame | No `X-Frame-Options`, no `frame-ancestors`. 200 with the word in the page. |
  | the Academy | copy | Cloudflare challenge (403) carrying `X-Frame-Options: SAMEORIGIN`. Expect the failure line. |
  | Kizur | copy | Its https certificate names another host (`vmilog2.spd.co.il`); that is why Kizur "did not connect" in session thirteen. The link is now **http**, and an https page cannot frame an http one, so it is fetched as a copy. For להמר: "לא נמצאו קיצורים לערך: להמר" (no abbreviations found). For צה"ל: "צבא הגנה לישראל". |
  | Sefaria | frame | No `X-Frame-Options`, no `frame-ancestors`. For להמר, its search finds only classical texts (Otzar La'azei Rashi on II Kings and Isaiah, a Josephus translation): 102 hits by lemma, 13 exact, and no dictionary entry. For בראשית: over 10,000 hits, and a BDB entry for רֵאשִׁית. |

- **Fetched copy** (`GET /reference/<id>?term=`, `lib/reference-pages.js`):
  - fetched only on the tap, with a 20-second limit
  - scripts, comments, frames, inline handlers, `javascript:` links and form controls stripped
  - links absolute, opening the live site in a new tab
  - shown in a sandboxed frame under "Shown from a copy fetched by the reader; open the site for the live page"
  - kept seven days in the new table `reference_pages` (`CREATE TABLE IF NOT EXISTS`); a failure is never kept
  - a redirect is followed only within the reference's own site: `sameSite(ref, url)`, made testable in #13 and exercised under the stand-in by 6 checks (www and non-www hosts and Kizur's http address accepted; another site and a look-alike host refused, nothing kept)
- **The record:** `lookups.origin` was added by `ALTER TABLE … ADD COLUMN … DEFAULT 'desk'`, which back-fills every existing row as `desk`. `GET /lookups` is read from the lookup layers and the cards; there is no new table of looked-up words.
- **Live, signed out** (this session's own `curl` against https://hebrew-reader-dan.fly.dev after the deploy):
  - `GET /lookup` → `303` to `/login`
  - `GET /reference/morfix?term=x` → `401`
  - `GET /lookups` → `401` `{"error":"Sign in first: POST /login with the passphrase."}`

  The 303 is the new page route at work: before this change, `GET /lookup` was not a page. The passphrase is Dan's repository secret, so no signed-in check was run by this session.

### Findings the brief asked for (section 4, from the builder's reading of `main` at `b435ddb`)

Every file, function and route the brief named was present.

- **Layer model:**
  - A layer is a card linked to its parent through `card_links` with kind `layer`.
  - A lookup layer is a row in `lookups` (card, reference, time) made by `desk.lookupLayer`. It now also carries `origin`.
- **Reference link shapes:** `lib/references.js`, unpointed word, URL-encoded. The table in `docs/REFERENCES.md` gives each shape; only Kizur's changed (https → http).
- **Card routes:**
  - `POST /lookup` makes or finds a word card from a surface form.
  - `POST /card/<key>/lookup` records a lookup.
  - `GET /desks/current` returns tonight's desk.
  - `POST /desks/<id>/cards` with `unplaced` puts a card on a desk.
- **Word-saving code:** the reader's save is `POST /spots/<id>`, which now calls the shared `saveStatus` in `lib/lookup-page.js`; the Look up page calls the same function.
- **Migration convention:** `migrate()` in `lib/db.js` adds new columns by `ALTER TABLE … ADD COLUMN` and new tables by `CREATE TABLE IF NOT EXISTS`. It never rebuilds a table.
- **How a line caught on the phone reaches the desk:** `/desks/catch` → `desk.place(…, { unplaced: true })` on the desk worked on last. "Put on a desk" reuses `place()` through `POST /desks/<id>/cards { card, unplaced: true }`.
- **Forms `POST /lookup`'s matching handles:**
  - From the Look up page (`origin: 'lookup'`), in this order:
    1. POST /lookup's own cache for the word looked up with no sentence
    2. the newest card met as this word, pointed or unpointed
    3. the reader's matching, `HebrewTokenize.markFor`: a saved dictionary form, any form met, alone or after one listed prefix
    4. failing those, a new card as `POST /lookup` makes it (one model call)
  - The matching itself was not changed. `POST /lookup` without `origin` is unchanged: it matches only the exact word and sentence.
  - Unsupported: a prefixed or pointed form of a word Dan has never met or saved is not matched locally, so it goes to the model as a new card, the same as today. The checks cover pointed, unpointed and prefixed forms, and one unknown form (an empty answer: 422, nothing recorded).
- **Check scripts:** `npm run check` runs three parts.
  - syntax: `node --check` on every `.js`, `.mjs` and `.cjs` file
  - tests: `npm test` = `smoke.mjs` 255, `grow-smoke.mjs` 66, `paper-smoke.mjs` 81, `hunt-smoke.mjs` 39, and the new `lookup-smoke.mjs` 58 = **499**
  - screenshots: `screenshots.mjs` 229, `desk-pages.mjs` 47, `grow-pages.mjs` 66, `paper-pages.mjs` 53, `hunt-pages.mjs` 23, and the new `lookup-pages.mjs` 44 = **462**

  All of these run against local stand-ins (`mock-openrouter.mjs`, `mock-spine.mjs`, the new `mock-references.mjs`). The frame test `scripts/reference-frames.mjs` reaches the live sites and runs by hand only.

### Verify, by brief step

1. **Step 1, frame test:** `docs/REFERENCES.md` holds the table, and `lib/references.js` has `embed` per reference (commit `48ef33d`). The live run was made from the machine on 9 Oct.
2. **Step 2, reference route:** `lookup-smoke.mjs` checks that:
   - a copy keeps its text and loses a `<script>` and an inline handler
   - a stored copy is served with no second fetch
   - a stand-in that hangs returns `failed` within the limit
   - a 10-second stand-in still returns the copy

   It passed in `npm test`, and the checker reran it in both rounds (commit `f4d394f`). The redirect gate's false-rejection and refusal checks were added in #13 (`d1a5f67`); the checker reran `lookup-smoke.mjs` there: 64 passed.
3. **Step 3, card pane:** `grow-pages.mjs` checks copy, frame and failure panes at phone and computer widths, light and dark (66 checks, passed; commit `7e4125e`).
4. **Step 4, Look up page:** `lookup-smoke.mjs` and `lookup-pages.mjs` check that:
   - the search saves the word
   - one `page` layer is recorded with origin `lookup`
   - the tabs fetch nothing until tapped
   - pointed, unpointed and prefixed forms are found

   Passed (commit `e8d3ec4`).
5. **Step 5, "Looked up" and "Put on a desk":** the checks cover:
   - the `origin` back-fill
   - paging through 210 cards two at a time, including words with equal timestamps
   - "Put on a desk" with its "already there" count
   - a row updating as a tab is recorded

   Passed (commits `80a0b30` and `f61db02`).
6. **Step 6, phone:** `lookup-pages.mjs` checks the stacked tabs and the pane in place at phone width, light and dark. Passed (commit `26000fb`).
7. **Step 7, docs:** README paragraph, the `PLAN.md` close-out note and the `docs/CHECKS.md` counts (commit `17165d9`, counts updated in `f61db02`).
8. **Step 8, pull request and deploy:**
   - pull request #12 opened
   - GitHub "checks" green on both runs: 38004221967 and 38004271455
   - merged on Dan's yes
   - deploy run 38017340068 succeeded
   - live signed-out responses as listed above
   - follow-on #13: GitHub "checks" green (run 38019251919; run 38019254476 failed once on the known `paper-pages` flake, "1 paper page check(s) failed, 25 passed", and passed on re-run), merged on Dan's yes, deploy run 38020091428 succeeded, and the live signed-out responses are unchanged (`/lookup` 303, `/reference/morfix?term=x` 401)

**Section 9, the local check:** `npm run check` on `f61db02` printed "check: all passed: syntax, tests, screenshots" (the builder's run, recorded on its queue row). The checker independently reran `npm test` (497 at `17165d9`), `lookup-smoke.mjs` (58), `lookup-pages.mjs` (44) and `grow-pages.mjs` (66). It did not rerun the full suite on `f61db02`.

### Signed-in live checks for Dan (Ask 1), and what each should show

1. Open https://hebrew-reader-dan.fly.dev/lookup, type **להמר**, press Enter. The card appears with the pointed headword הִימֵּר, and the page says the word is saved to your words.
2. Tap **Morfix**, then **Pealim**, then **Milog**.
   - Morfix: most likely "The site did not answer; open it directly" with the link, because Morfix's bot check refused the machine; Fly's address may fare better.
   - Pealim: a copy, under the line "Shown from a copy fetched by the reader; open the site for the live page".
   - Milog: its own page in a frame.
   - The card's lookup count rises by three, and the word's row in "Looked up" lists the three tabs.
3. Type **צה"ל** and tap **Kizur**: a copy showing "צבא הגנה לישראל". Type **בראשית** and tap **Sefaria**: Sefaria's own search page in a frame, with classical sources only. For a modern word like להמר, Sefaria finds only classical texts, not the modern verb.
4. Open https://hebrew-reader-dan.fly.dev/desk, open any word card, tap **Wiktionary**: it opens in a pane under the "Look up in" row, not in a new tab.
5. On the Look up page, tick **להמר** and press **Put on a desk**.
   - Expect "1 card put on tonight's desk, unplaced — place them at the desk", and at `/desk` the card is there, unplaced.
   - If להמר was already on tonight's desk, the page says "1 already there" instead.

   This session could not read the live desk (it needs sign-in). A word looked up only on the Look up page sits on no desk until it is put there, so the first message is the one to expect.
6. On the phone: the same page, with the tabs stacked; tap **Morfix** and its pane (or the failure line) opens in place under the tab.

## What the brief got wrong

1. **Reader and phone cards:**
   - Section 2 says the "Look up in" row opens inside on every card: desk, reader and phone.
   - Only the desk's card view has that row. The reader and phone card (`public/card-ui.js`) has none, so step 3's "and wherever else `card-ui.js` shows the row, if it does" changed nothing there.
   - That card's "Ask about this root" still opens Pealim and Wiktionary in two new tabs (Ask 2).
2. **Morfix probe in section 6:** "any status under 500" counts Morfix's 403 as an answer. That 403 is a bot wall, and it predicted that the server cannot fetch Morfix's copy from the machine.
3. **Kizur's link:** session thirteen's https address for Kizur was the cause of "did not connect", not the site being down. The link shape itself had to change, which the brief did not foresee.
4. No disagreement found between the brief and `/data/home/dan/FACTS.md`.

## Deliberate divergences

1. **Kizur's link is now http** (`lib/references.js`), because its https certificate is for another host. The brief's out-of-scope list does not cover link shapes; the change is named here and in `docs/REFERENCES.md`.
2. **One commit beyond the seven steps** (`f61db02`): the fixes for the checker's two findings, each with a regression check. Plus the follow-on pull request #13 (`d1a5f67`), after the merge, for the result check's finding.
3. **The reader's save now calls a shared function.** `POST /spots/<id>` now calls `saveStatus` in `lib/lookup-page.js`, so the Look up page and the reader save a word through the same code. Behaviour is unchanged, and the existing smoke checks pass.
4. **"Ask about this root" is hidden on the Look up page only.** There its two new-tab buttons would duplicate the in-page tabs.
5. **Old screenshots not recommitted.** `npm run check` re-shoots every existing screenshot; only the new `grow-ref-*` and `lookup-*` screenshots are committed.
6. **The report has its own branch.** It is committed on `claude/hebrew-lookup-one-report`, cut from `main` after the merge, never on `main` and not on the merged branch. That is a second push beyond the one the brief announced.

## Asks

1. **Run the six signed-in live checks above** and reply in this session with what differs from the expected result; this session records the results on the card. Recommended answer: yes. Most worth seeing: whether Morfix and the Academy fail from Fly as they did from the machine.
2. **Reader and phone cards' "Ask about this root":** should it also open inside the reader, in the same pane, instead of two new tabs? Recommended answer: yes. It is small and finishes "references embedded everywhere".
3. **Morfix and the Academy** (if they fail live): keep the failure line with the link to the live site, rather than look for another way in? Recommended answer: keep it. Both sites block server fetches on purpose, and the link opens the real page in one tap.

Session fourteen's four asks remain open; this session left them alone, as the brief said.

## Team and seat prompts

- **65 seat prompts, all answered by this session with a one-time yes or Skip; none went to Dan.**
  - 61 from the builder: in-clone edits by `sed -i` and `python3` heredocs, reads, test runs, commits, the Playwright browser install, and the frame-test fetches.
  - 4 from the checker: the Codex update menu (answered "2. Skip"), and three runs of the repository's own checks outside Codex's sandbox (local ports and Chromium).
  - Two builder prompts came from the outward-send rule `Bash(curl *-d *)`. They were Sefaria search queries carrying only the brief's test words להמר and בראשית, so they were answered yes.
- The team was stopped with a snapshot after #12 (`01M4HTMGFQRDX9D8HMPTGFMW2V`), restored from it for the follow-on, and stopped again after it with the snapshot `01M4HWRB8BF4XT4FR907WV8X21` (`rig restore 01M4HWRB8BF4XT4FR907WV8X21 --rig 01M4GJC4D8THKXD6E3NXSJSS7D`, seats in `~/work/hebrew-lookup-one`).
- Follow-on prompts: 10 more (8 builder, 2 checker, one of them the Codex update menu), all answered by this session; 75 in all.
- `/data/home/dan/FACTS.md` was updated with the new team id and the latest snapshot.

## What the next session needs

- **Next work:** Dan answers the three asks in this session, and this session records his answers and the live check results on card `hebrew-satellite`. The Personal Shipyard chat then reads the card and writes the next brief. Then:
  - If Ask 2 is yes, the next brief turns the reader and phone card's "Ask about this root" (`public/card-ui.js`) into the same in-page pane: `public/reference-ui.js` with `GET /reference/<id>?term=`.
  - Still open from before: session fourteen's four asks, and session fifteen's Ask-box route change.
- **Owner:** the Personal Shipyard chat writes the brief; a Claude Code session on the machine, with the OpenRig team, builds it.
- **What it needs to know:**
  - **Reference modes:** they live in `lib/references.js` (`embed`) and `docs/REFERENCES.md`. Rerun `node scripts/reference-frames.mjs` before changing any mode.
  - **Live fetches:** Dan's live check 2 says whether Morfix and the Academy fetch from Fly.
  - **Team snapshot:** `01M4HWRB8BF4XT4FR907WV8X21` is for continuing this job only; a new job starts the team fresh on its own clone.
  - **Known flake:** `paper-pages.mjs` fails about 1 run in 10, on `main` too.
  - **Fetched copies:** `reference_pages` keeps copies for seven days, so a sanitizer change shows only on words fetched after it (or after seven days).

## Checks

1. **Brief check, four rounds, all run by the composing chat before this session** (this session read the reviewer's records):
   - `20261009-142911-82468c`: FINDINGS, 12
   - `20261009-143332-1e1672`: FINDINGS, 6
   - `20261009-143801-65c9b5`: FINDINGS, 1
   - `20261009-144122-d83f30`: **PASS**, 0 findings, 63 s

   The composing chat changed the brief between rounds; what it changed is in its own check records on the card, not seen in detail by this session. The PASS round's brief is the copy this session ran.
2. **Team check, round 1** (`qitem-20261009161330-38684625`, candidate `17165d9`): **FINDINGS**, 2, on `qitem-20261009161811-b1f04a48`:
   - (1) a "Looked up" row did not show tabs opened until a reload. Changed: `public/lookup.js` updates the row when the lookup is recorded.
   - (2) two words searched in the same millisecond could be skipped at a page edge. Changed: the cursor carries the card key (`next_key`/`before_key`) in `lib/db.js`, `lib/lookup-page.js`, `server.js` and `public/lookup.js`.

   Both fixed in `f61db02`, with regression checks.
3. **Team check, round 2** (`qitem-20261009162752-d7f91ebb`, candidate `f61db02`): **PASS**, recorded on `qitem-20261009162946-41eb9e4f`.
4. **GitHub "checks" on pull request #12:** pass (runs 38004221967, 38004271455).
5. **Result check, round 1** (`20261010-023950-fa40a1`, on report event 1237): **FINDINGS**, 2:
   - (1) the first line had no date. Changed: it now reads "# FIELD REPORT — hebrew-lookup-one — 2026-10-10".
   - (2) there was no "What the next session needs" section. Changed: added, with the next work, its owner and what it needs to know.
6. **Result check, round 2** (`20261010-024222-69f40e`, on report event 1239): **PASS**, 0 findings, 53 s.
7. **Dan's correction after round 2:** the asks and closing message sent him to tell the Personal Shipyard chat the live check results, and the closing message ended with a paste block for that chat. Changed: Ask 1, "What the next session needs" and the closing message now have him answer in this session, which records the answers on the card for the chat to read; the paste block is removed.
8. **Result check, round 3** (`20261010-025105-9f77da`, on report event 1241): **FINDINGS**, 1: [step 2] the redirect gate had no false-rejection test (it was skipped under the stand-in). Changed: pull request #13, which makes the gate `sameSite(ref, url)`, runs it under the stand-in and adds 6 checks.
9. **Team check on the follow-on** (`qitem-20261010030127-e532197a`, candidate `d1a5f67`): **PASS**, recorded on `qitem-20261010030312-ac69f49f`.
10. **GitHub "checks" on pull request #13:** pass (run 38019251919; run 38019254476 passed on re-run after the known `paper-pages` flake).
11. **Result check, round 4:** run on this corrected filing; its verdict on this final version is given in the closing message.

## Fly machine and OpenRig lessons

1. **Read a queue row's field names before scripting a wait on it.**
   - What happened: my background wait for the checker's verdict matched on `createdAt`, but rows carry `tsCreated`, so it could never fire.
   - What it cost: round 1's verdict reached me only through the seat watcher's QUEUE line.
   - What fixed it: a one-word change, then the wait fired correctly on round 2.
2. **`pkill -f <script>` kills the shell that runs it** when the script name is in the same command line.
   - What happened: it exited 144 and the edit chained after it never ran.
   - What it cost: one wasted call.
   - What fixed it: running the edit as its own call.
3. **A builder in Accept edits stops on almost every edit.**
   - What happened: 61 builder prompts in about 95 minutes, mostly `sed -i`, `python3 -` heredocs and compound commands ("Contains simple_expansion").
   - What it cost: one supervisor call per prompt.
   - What fixed it: nothing yet. A change to the seats' allow rules goes through the agent-machine repo.
4. **A fresh Codex seat opens on its update menu** ("0.160.0 → 0.161.0").
   - What it cost: one prompt and a "Readiness timeout after 30s" / "Status: partial" start.
   - What fixed it: "2. Skip". The seat then worked normally, as earlier sessions saw.
5. **An idle Claude seat shows a suggested next prompt in its input line.**
   - What happened: after the PASS, the builder's input showed "push the branch and open the pull request".
   - What it cost: nothing, but a stray Enter sent to the seat would have submitted it.
   - What fixed it: reading the screen before any `send-keys`; this session never sends Enter to an idle seat.
6. **`paper-pages.mjs` is flaky on the machine independent of the change.**
   - What happened: it failed about 1 run in 10, on this branch and on clean `main` (2 of 20).
   - What it cost: about 15 minutes of the builder's time to rule out this change.
   - What fixed it: a baseline run on a worktree of `main`, then naming the flake in `docs/CHECKS.md`.
7. **A bot wall can pass an "answers under 500" probe.**
   - What happened: Morfix's 403 passed section 6's environment check, yet it is the same wall that blocks the copy fetch.
   - What fixed it: the frame test probes both as a browser and as a plain client, and records both.

8. **Never send Dan to another chat with a message to relay.**
   - What happened: the closing message and Ask 1 told Dan to tell the Personal Shipyard chat what the live checks showed, and the message ended with a paste block addressed to that chat. The brief's close-out forbade exactly this.
   - What it cost: Dan's correction, and a third filing and result check of the report.
   - What fixed it: the asks are answered in this session, which writes them to the card; the chat reads the card. The session memory that said the closing paste block is "usually the message to the chat that briefs the next session" was rewritten.

9. **Write queue ids from the queue, never from memory.**
   - What happened: pull request #13's first text gave two queue ids with the wrong timestamp digits.
   - What it cost: an edit of the pull request text.
   - What fixed it: reading the ids back with `rig queue list --json` before writing them.
10. **A result check can pass and then find something new on a re-run.**
    - What happened: round 2 passed the same code that round 3 then found the gate-test gap in.
    - What it cost: a follow-on pull request and deploy.
    - What fixed it: nothing to fix; the checker's rounds are independent reads, so every filing is checked again.

## Closing message to Dan

The Look up page is live at https://hebrew-reader-dan.fly.dev/lookup.

- **Look up page:** type a word and its card appears and is saved. The seven references open in tabs inside the page, and "Looked up" lists your words with "Put on a desk".
- **Desk cards:** the "Look up in" buttons now open the reference in a pane under the row, not a new tab.

Needed from you:
1. Run the six signed-in checks in the report (type להמר on /lookup, tap Morfix, Pealim and Milog, and so on) and reply here with what differs; I record it on the card. Recommended: yes.
2. Should the reader and phone cards' "Ask about this root" also open inside the reader instead of two new tabs? Recommended: yes.
3. If Morfix and the Academy show "The site did not answer" live, keep that line with the link? Recommended: keep it.

Answer all three here, in one reply.
