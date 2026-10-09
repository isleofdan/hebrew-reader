# Checks

What checks the reader has, when each runs, how long each takes, and how to
read a failure. Adopted from `isleofdan/starting-kit` by hebrew-adopt-kit
(3 Oct 2026); the checks themselves are the reader's own smoke and
screenshot scripts, unchanged.

## The checks

| Check | What it proves |
| - | - |
| syntax | Every `.js`, `.mjs` and `.cjs` file outside `node_modules` parses (`node --check`, file by file). |
| tests | `npm test` = `npm run smoke`: `scripts/smoke.mjs` (255 checks), `scripts/grow-smoke.mjs` (66), `scripts/paper-smoke.mjs` (81), `scripts/hunt-smoke.mjs` (39, "Find an article" against local news pages) and `scripts/lookup-smoke.mjs` (58, the Look up page and the references shown inside the reader, against local reference pages; about 25 s, because the 20-second fetch limit is timed for real), each against a real server with local stand-ins for OpenRouter, the spine and the reference sites (`scripts/mock-openrouter.mjs`, `scripts/mock-spine.mjs`, `scripts/mock-references.mjs`). 499 in all (9 Oct 2026). |
| screenshots | `npm run screenshots`: `scripts/screenshots.mjs` (229), `desk-pages.mjs` (47), `grow-pages.mjs` (66), `paper-pages.mjs` (53), `hunt-pages.mjs` (23), `lookup-pages.mjs` (44) — every screen at phone and computer size, signing in through the form; 462 in all (9 Oct 2026). Needs Playwright's browser. The Checks run keeps the hunt's screenshots as the artifact `hunt-screenshots`. |
| (by hand) the frame test | `node scripts/reference-frames.mjs`: asks the seven live reference sites whether they can be framed. Not in `npm run check` (it reaches the live sites); its last result is in `docs/REFERENCES.md`. |

The fast tests, `npm run test:fast`, are grow, paper and hunt only:
`scripts/smoke.mjs` alone takes about 33 s, past the after-edit hook's 30 s
limit, so it runs in the full run and on every push and pull request, not
after every edit.

`npm run check` runs syntax, tests and screenshots in that order, stops at
the first failure, and ends with one line: `check: all passed: …`, or
`check: FAILED at <check> (<seconds> s): <what failed>`, naming the file
that does not parse, the smoke check that failed (`FAIL <name>`), or the
screenshot check that failed. `npm run check -- --fast` runs syntax and the
fast tests only.

## What runs when

| When | What runs | Where it is set |
| - | - | - |
| After every edit or new file an agent makes in Claude Code | syntax, fast tests (grow, paper) | `.claude/settings.json`: a `PostToolUse` hook on `Edit\|Write` running `node scripts/check.mjs --hook`, timeout 30 s |
| On every push and every pull request | syntax, all tests, screenshots | `.github/workflows/checks.yml` ("Checks") |
| By hand | any of them | `npm run check`, `npm test`, `npm run test:fast`, `npm run screenshots` |

## Measured times

On the rented Linux machine (`agent-machine-dan`, Node 24.21.0), 3 Oct
2026, with bash's `time`, three runs each:

| Run | Time here | Runs in |
| - | - | - |
| `scripts/smoke.mjs` alone | 33.43 s, 32.90 s, 32.76 s | workflow (and full run) |
| `scripts/grow-smoke.mjs` alone | 1.78 s, 1.63 s, 1.72 s | hook and workflow |
| `scripts/paper-smoke.mjs` alone | 2.65 s, 2.63 s, 2.81 s | hook and workflow |
| `npm run test:fast` | 4.75 s, 4.77 s, 4.37 s | hook |
| syntax, inside `npm run check` | 1.82 s, 1.88 s, 1.89 s | hook and workflow |
| tests, inside `npm run check` | 38.10 s, 37.41 s, 37.93 s | workflow |
| the hook's command (`--hook`: syntax and fast tests) | 6.79 s, 6.92 s, 6.52 s (with hunt-smoke, 3 Oct: 10.2 s) | hook |
| `npm run check -- --fast` | 7.09 s, 7.21 s, 7.09 s | by hand |
| `npm run check` (screenshots skipped here) | 40.74 s, 40.04 s, 40.59 s | by hand |
| `npm run screenshots` | not run here: this machine has no Playwright browser | workflow only |
| `npm run check`, everything (9 Oct 2026, hebrew-lookup-one, Playwright 1.63 with its browser installed in the session's own cache) | syntax 3.22 s, tests 68.16 s, screenshots 196.21 s | by hand |

Known flaky (9 Oct 2026, hebrew-lookup-one): `paper-pages.mjs` fails about
1 run in 10 on this machine, on `main` as well (2 of 20 runs there): "Back
to the desk" closes the sheet's tab while Playwright still reports the click
("Target page, context or browser has been closed"), or the phone's "a share
from another website …" check reads the desk before the save lands. A rerun
passes; neither is a fault in the app.

## Reading a failure

- **In the session, after an edit:** the hook is silent when the checks
  pass. When one fails it prints the failing output and the
  `check: FAILED at …` line and exits 2, which Claude Code shows to the
  session next to the edit (the edit itself has already happened). Fix the
  cause; the next edit runs the checks again. Two edits at once never run
  the checks side by side: the second skips while the first runs.
- **On a pull request:** the "Checks" mark is green or red. Open it, then
  the step "Run every check"; its last line is the verdict.
- **Where screenshots cannot run:** on a machine without Playwright's
  browser, `npm run check` skips them and says so in its verdict; in
  GitHub Actions a missing browser is a failure.

A failing check is shown only on the pull request and in the agent's own
session. Nothing else: no notification, email, badge or summary.
