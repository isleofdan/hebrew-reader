# Checks

What checks the reader has, when each runs, how long each takes, and how to
read a failure. Adopted from `isleofdan/starting-kit` by hebrew-adopt-kit
(3 Oct 2026); the checks themselves are the reader's own smoke and
screenshot scripts, unchanged.

## The checks

| Check | What it proves |
| - | - |
| syntax | Every `.js`, `.mjs` and `.cjs` file outside `node_modules` parses (`node --check`, file by file). |
| tests | `npm test` = `npm run smoke`: `scripts/smoke.mjs` (254 checks), `scripts/grow-smoke.mjs` (66) and `scripts/paper-smoke.mjs` (81), each against a real server with local stand-ins for OpenRouter and the spine (`scripts/mock-openrouter.mjs`, `scripts/mock-spine.mjs`). |
| screenshots | `npm run screenshots`: `scripts/screenshots.mjs`, `desk-pages.mjs`, `grow-pages.mjs`, `paper-pages.mjs` — every screen at phone and computer size, signing in through the form. Needs Playwright's browser. |

The fast tests, `npm run test:fast`, are grow and paper only:
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
| the hook's command (`--hook`: syntax and fast tests) | 6.79 s, 6.92 s, 6.52 s | hook |
| `npm run check -- --fast` | 7.09 s, 7.21 s, 7.09 s | by hand |
| `npm run check` (screenshots skipped here) | 40.74 s, 40.04 s, 40.59 s | by hand |
| `npm run screenshots` | not run here: this machine has no Playwright browser | workflow only |

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
