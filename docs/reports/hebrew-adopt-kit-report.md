# FIELD REPORT — hebrew-adopt-kit — 3 Oct 2026

Nothing changed on Dan's screens: the reader looks and behaves as before. It
now has checks that run after every edit an agent makes and on every pull
request, rules on what an agent may touch, and a map of where the article
hunt attaches (`docs/HUNT-MAP.md`), for session B.

Session A of two on card `hebrew-hunt`, run attended on the rented Linux
machine (`agent-machine-dan`) through the Claude app's Code tab. Brief: the
note "START HERE — hebrew-adopt-kit — 2 Oct 2026 (session A of two)".

## What stands

1. **Checks adopted from the kit's `main`.**
   - Added `scripts/check.mjs` (with `npm run check`), the after-edit hook
     in `.claude/settings.json`, the "Checks" workflow
     (`.github/workflows/checks.yml`, the fixed version with no
     `--with-deps`) and `docs/CHECKS.md`, written for the reader.
   - `npm test` is the reader's own smoke scripts (`npm run smoke`, 401
     checks).
   - `npm run test:fast` is grow and paper (147 checks).
   - No new test framework or dependency.
2. **Rules adopted.**
   - The kit's permission rules are in `.claude/settings.json`, with every
     deny kept and two denies added (below). `CLAUDE.md` says the same in
     words.
   - Proven in this trusted clone: `flyctl deploy` and
     `git push origin main` are refused by the rules themselves.
3. **The hunt map** (`docs/HUNT-MAP.md`) answers (a)–(e) with file and
   route names. Two points are UNKNOWN; its headline findings are below.
4. **This machine.**
   - The clone is `$HOME/work/hebrew-reader`. Its git identity is set in
     the clone only.
   - It is marked trusted in `~/.claude.json`
     (`projects["/data/home/dan/work/hebrew-reader"].hasTrustDialogAccepted = true`,
     written by a short `node -e` script on Dan's yes). A copy of the file
     from before is kept at `~/.claude.json.bak-hebrew-adopt-kit`.
   - Dan added the user rule
     `Edit(/data/home/dan/work/hebrew-reader/.claude/settings.json)` to
     `~/.claude/settings.json` from the terminal page, so that a session
     could write the reader's rules file (see "What the brief got wrong",
     item 1).

## What the brief got wrong

1. **"Ask Dan one yes/no and he is present for exactly this."** Dan's yes
   was not enough.
   - This machine's safety check refused writing `.claude/settings.json`
     both before and after Dan said "y". The second time it gave no reason.
   - It also refused the `~/.claude.json` trust entry until Dan's yes; it
     accepted that entry after.
   - What cleared the settings file was a permission rule Dan added himself
     (`Edit(<that file>)` in `~/.claude/settings.json`), pasted as one line
     on the terminal page. `/permissions` "isn't available in this
     environment" in the Claude app.
2. **"`docs/reports/hebrew-reader-fourteen-report.md` (the latest)".** It
   is not on `main`; it is only on branch
   `claude/hebrew-satellite-brief-0yfm9t` (commit `9168368`). It was read
   from there. The latest report on `main` is thirteen's.
3. **"The reader keeps its own tests."** The reader had no `npm test`, no
   `test/` folder and no `CLAUDE.md`. Its tests are three smoke scripts and
   its screenshots are four scripts. Both are wrapped as they are.
4. **The kit's after-edit hook assumes tests that take about a second.**
   `scripts/smoke.mjs` takes about 33 s here, past the hook's 30 s timeout,
   so the hook runs a fast subset instead (divergence 1).
5. **Environment check 5 failed:** `bash -lc 'test -n "$OPENROUTER_API_KEY" && echo key-loaded'`
   printed nothing. A local run of the hunt here cannot call a model as
   things stand (ask 3).
6. **"Dan rejects 'map', 'met', 'touch'".** The screens already avoid
   them, but `README.md` still uses all three. It was left as is (rule 4,
   out of scope).

## Deliberate divergences

1. **`scripts/check.mjs` differs from the kit's in two lines.**
   - `--fast` and `--hook` run `npm run test:fast` (grow and paper,
     about 4.5 s) instead of `npm test`.
   - A failure is also named from the smoke scripts' `FAIL <name>` lines.
   - The full run and the Checks workflow still run all 401 tests.
2. **`git push *` stays allowed.** The kit says to move it to "ask" when
   "Deploy runs on every push to `main`". Here, a push of the agent's own
   branch reaches nobody: pushes to `main` are denied, and Deploy otherwise
   runs only by hand, which is "ask". Moving it to ask would stop session B,
   which runs unattended, from pushing its branch. See ask 1.
3. **Two denies added:**
   - `Bash(sqlite3 *)`, as the kit says once an app keeps a database;
   - `scripts/import-lessons.js` (two spellings), because it uploads Guy's
     lessons to the live site with the passphrase.
   - OpenRouter has no command-line tool to deny.
4. **The reader's `CLAUDE.md` is the kit's "What an agent may and may not
   touch" section plus a short "Do not reverse".** It does not include the
   kit's whole `CLAUDE.md`: the brief asked for "the matching `CLAUDE.md`
   section", and the reader's other conventions live in `PLAN.md`.
5. **The proof of the two refusals ran in a fresh headless session**
   (`claude -p` in the clone, `--output-format json`), not in this one.
   This session started in `~/work`, so the clone's project rules did not
   bind it. Before the proof, both commands were checked to be harmless if
   not refused: there is no `flyctl` on this machine, and local `main`
   equalled `origin/main` (`4170412`).

## Verify

1. **Environment:**
   - (1) `agent-machine-dan`.
   - (2) `isleofdan`, scopes `gist`, `read:org`, `repo`, `workflow`.
   - (3) Node v24.21.0, npm 11.19.0, Claude Code 2.1.285.
   - (4) `main`.
   - (5) **key not loaded**.
   - (6) card `hebrew-hunt` read.
2. **Times on this machine** (bash `time`, three runs each). Full table in
   `docs/CHECKS.md`.

   | Run | Time | Where |
   | - | - | - |
   | `scripts/smoke.mjs` | 33.43, 32.90, 32.76 s | workflow |
   | `scripts/grow-smoke.mjs` | 1.78, 1.63, 1.72 s | hook and workflow |
   | `scripts/paper-smoke.mjs` | 2.65, 2.63, 2.81 s | hook and workflow |
   | hook command (`--hook`) | 6.79, 6.92, 6.52 s | hook (limit 30 s) |
   | `npm run check` | 40.74, 40.04, 40.59 s | by hand |
   | `npm run screenshots` | fails in 1.63 s: no browser here | workflow only |

3. **`npm run check` here:**
   `check: all passed: syntax, tests; skipped screenshots (no browser on this machine; the Checks workflow runs them)`
4. **The two refusals**, quoted from the headless session in the trusted
   clone. Both also appear in its `permission_denials`.
   - `flyctl deploy` → "Permission to use Bash with command flyctl deploy has been denied."
   - `git push origin main` → "Permission to use Bash with command git push origin main has been denied."
5. **Settings file and `CLAUDE.md` side by side:**

   | `.claude/settings.json` | `CLAUDE.md` |
   | - | - |
   | allow `Edit(/**)`, `npm test/run/ci/install`, `node *` | May: edit files, run the checks |
   | allow `git add/commit/checkout/switch/fetch/pull/push *` | May: commit, push its own branch |
   | allow `gh pr create/view/checks/list`, `gh run view/list/watch` | May: open a pull request, read pull requests and runs |
   | ask `gh pr merge *` | Asks: merging (a merge into `main` deploys) |
   | ask `gh workflow run *` | Asks: starting a workflow, Deploy included |
   | ask `gh api *` | Asks: any direct GitHub request |
   | deny `fly *`, `flyctl *` | Never: `fly`/`flyctl` |
   | deny `sqlite3 *` | Never: `sqlite3` on any copy of `reader.db` |
   | deny `node scripts/import-lessons.js *`, `* scripts/import-lessons.js *` | Never: `scripts/import-lessons.js` |
   | deny `npm publish *` | Never: `npm publish` |
   | deny `git push * main`, `* main *`, `*:main`, `*:main *` | Never: pushing to `main` |
   | deny `git push --delete`/`-d`, `git branch -d/-D/--delete` | Never: deleting a branch |
   | deny `gh secret`, `gh variable`, `gh repo edit/delete/rename/archive` | Never: secrets and repository settings |
   | hook `PostToolUse` `Edit\|Write` → `check.mjs --hook`, 30 s | `docs/CHECKS.md` |

6. **Checks on the pull request branch.**
   - Run [37102650906](https://github.com/isleofdan/hebrew-reader/actions/runs/37102650906)
     on step 3's commit: **red**.
   - Syntax and all 401 tests passed on GitHub (Node 22).
   - The screenshots then failed at one check of 278: `desk-pages.mjs`,
     "phone: a card opens its full view — the reader's card, with its note
     and buttons" (`check: FAILED at screenshots (95.84 s)`).
   - The same check failed, alone, on all three runs:
     [37102650906](https://github.com/isleofdan/hebrew-reader/actions/runs/37102650906)
     (push, step 3),
     [37102859350](https://github.com/isleofdan/hebrew-reader/actions/runs/37102859350)
     (push, report) and
     [37102862550](https://github.com/isleofdan/hebrew-reader/actions/runs/37102862550)
     (pull request #7). So it is steady, not intermittent.
   - **Cause: UNKNOWN.** The check reads the card's pointed headword and
     meaning as soon as `#full-card` appears, with no wait for the card's
     text to load. Two other candidates:
     - pull request #4 (the sheet opens in a new tab), merged after
       fourteen's 377 page checks last passed;
     - a newer Chromium on GitHub's runner than in fourteen's cloud session.
   - No code under `public/` or `lib/` changed in this session. Per rule
     4 it is recorded and left as is. This is the first time the reader's
     screenshots have run on GitHub.
7. **After the merge:** see the wall note on card `hebrew-hunt`. This
   report is on the branch, which cannot be changed after the merge without
   a new pull request.
8. **`docs/HUNT-MAP.md`:** every item is answered. Two are UNKNOWN: whether
   a Ynet or Globes article ever loaded through the address box, and
   whether a spine token exists on this machine.

## The hunt map's headline findings

1. **No lesson is made from one article today.**
   - The "Lesson sheet" (`GET /make/lesson`, `lib/lesson.js`) lists words
     opened two or more times across the N most recent articles. It makes
     no model call.
   - A freshly found article adds nothing to it until Dan reads it.
   - Session B's brief must say what "the lesson" from a found article is.
2. **The reader never reads marks from the spine; it only writes them.**
   Dan's words live in `spots` in `reader.db` on Fly, which a session here
   cannot reach. Picking a "suitable" article by Dan's words means one of
   two things:
   - the hunt runs inside the live server;
   - or a session gets a spine token to read `GET /api/marks?app=hebrew-reader`.
3. **Fetching by address exists**: `POST /articles` → `lib/articles.js`
   `fromUrl`, using Readability. An article under 200 characters is
   flagged thin. Nothing finds articles.
   - The `articles` table has no column for where an article came from.
   - The fetch does not go through a `lib/upstream.js`; the reader has
     none.
4. **The screens' words:** "Articles", "Add an article", "Looked up",
   "Save to vocab", "Mark solid", "Your words in this piece", "Lesson
   sheet", "Make from recent reading", and "counted as seen again" (on
   Guy's lessons).

## Asks

1. **Keep `git push` of the agent's own branch allowed without asking?**
   **Recommended: yes.** Pushes to `main` stay refused, and a branch push
   deploys nothing. Unattended session B needs to push its branch.
2. **The one red screenshot check:**
   - **Recommended:** session B's brief starts by finding why
     `desk-pages.mjs` "a card opens its full view" fails on GitHub, and
     fixes the check or the screen, whichever is wrong.
   - **Recommended:** merge this pull request now with the red mark
     recorded. All 401 tests and the other 277 screenshot checks are green
     on GitHub, and this pull request changes no screen or route.
3. **The OpenRouter key on this machine does not load in a login shell.**
   **Recommended:** session B's brief has it checked and fixed on the
   agent-machine side, or the hunt is proven only against the reader's
   OpenRouter stand-in.
4. **Session fourteen's report is only on a branch.** **Recommended:**
   bring it to `main` in session B's first commit, as thirteen's was.
5. **Where the hunt runs** (map finding 2): inside the live server with
   the reader's own records, or from this machine with a spine token.
   **Recommended: inside the live server.** Dan's words are there, and it
   needs no new key.

## What the next session needs

- The clone at `$HOME/work/hebrew-reader`: trusted, identity set, rules in
  force.
- `docs/HUNT-MAP.md` and the five asks above.
- `npm run check` before the pull request. The workflow shows the
  screenshots.
