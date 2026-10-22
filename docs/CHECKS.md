# Checks

What checks the reader has, when each runs, how long each takes, and how to
read a failure. Adopted from `isleofdan/starting-kit` by hebrew-adopt-kit
(3 Oct 2026); the checks themselves are the reader's own smoke and
screenshot scripts, unchanged.

## The checks

| Check | What it proves |
| - | - |
| syntax | Every `.js`, `.mjs` and `.cjs` file outside `node_modules` parses (`node --check`, file by file). |
| tests | `npm test` = `npm run smoke`: `scripts/smoke.mjs` (256 checks), `scripts/grow-smoke.mjs` (83; since hebrew-ask-one also the ask surface: an `asks` row for an accepted answer of each subject kind — article, card, root — and none for a desk ask refused without a citation, the answer layer pointing at its row, the Ask box's first shape `{ question, article_id }`, the refusals naming the valid desks and kinds, a follow-up carrying the earlier turns and a chain of seven carrying the last six, the reader's Ask box keeping an answer with no citation and its links the citations, and the seam: a stand-in second desk registered from the check through `node --require`, answering with its own persona and site), `scripts/paper-smoke.mjs` (86; since hebrew-ask-one also an empty note card left off the sheet and Chrome's doubled address in a shared line kept once with the selected text), `scripts/hunt-smoke.mjs` (39, "Find an article" against local news pages) and `scripts/lookup-smoke.mjs` (64, the Look up page and the references shown inside the reader, its redirect gate included, against local reference pages; about 25 s, because the 20-second fetch limit is timed for real) and `scripts/today-smoke.mjs` (142, the Today page's sets: choosing the words (shaky before new, new words judged once by the model, the easy ones skipped), each word's exercise and the source it names, its read or made-up sentence, answers with niqud, fresh passages, their length and the verb they blank, "Too easy", when a set is made, the 05:00 Tokyo scheduler, answers, Show and Undo, an older page's Undo refused; since hebrew-today-two: sets numbered by `seq` (the migration's back-fill, `for_day` "#2", "#3" for later sets the same day), "Another set" (`POST /today/another`, two at once making one set), the words of an unfinished set skipped, the pools when nothing more is due (shaky not yet due, then solid not yet due) and their note, "no data" only with no words, a word marked solid before it was ever drilled left out, the 05:00 build making a set only when none is unfinished; about 4 s; its day-dependent rules call `lib/today.js` in the check's own process with a seeded clock) and `scripts/walks-smoke.mjs` (68; since hebrew-guide-one also: a *choose* that never answers failing at its own limit (3 s, set from the check) and the failure line naming that limit, the guide's *choose* and *teach* requests naming `anthropic/claude-fable-5.1`, each carrying `reasoning: { max_tokens: 4000 }` with `max_tokens` 6000 and 9000 and no temperature, *choose* asked for the reading first, the reading reaching the *teach* request and kept in the saved stop, a stop saved with no reading reading back as before, a reply stop showing none, the slow *teach* under the replaced limit keeping its thinking, and a card-model call (the root ask) with no `reasoning` and temperature 0; 48 at hebrew-walks-one, 60 after the walks' background stops: a walk from a question writing one `walks` row and one `asks` row with its walk, its reference and its time, *choose* then *teach* with the passage's Hebrew and English, steps by pick and by text chained to the previous stop, the third stop carrying the two earlier stops and a walk of twelve the last ten, *choose* writing no row, an unknown reference retried once with Sefaria's message and a second miss failing, a declined start, a walk from a reference skipping *choose*, Sefaria's tags and footnotes stripped, a reference fetched once, 404 for an unknown one, 502 when Sefaria is down or silent, the time limit — the desk's limits set to 5 s from the check: a 4-second answer kept, a silent one failing at 5 s — a stop with parts missing kept as no stop, two moves at once on one walk (the second refused, the chain one line), the refusals, and reopening with no request; about 40 s, because Sefaria's 20-second fetch limit is timed for real), each against a real server with local stand-ins for OpenRouter, the spine, the reference sites and Sefaria (`scripts/mock-openrouter.mjs`, `scripts/mock-spine.mjs`, `scripts/mock-references.mjs`, `scripts/mock-sefaria.mjs`). 738 in all (22 Oct 2026, hebrew-guide-one; 730 before it, 718 at hebrew-walks-one, 670 before that). |
| screenshots | `npm run screenshots`: `scripts/screenshots.mjs` (231; the reader's Ask box drawing the cited pages and "Ask more"), `desk-pages.mjs` (47), `grow-pages.mjs` (105; since hebrew-ask-one also the ask pane on the reader's card and the phone page's card at 390 px and 1280 px, light and dark — closed, open with nothing fetched, after "Ask", after "Ask more", a tab open — the action row's top unchanged when it opens and when it closes, also after the pane was used and scrolled, "Ask" at least 56 px high on the phone, and a tab recorded on a word put on the desk a moment before, never on another word opened while the put was on its way), `paper-pages.mjs` (54; the print line by the Print button), `hunt-pages.mjs` (23), `lookup-pages.mjs` (44; "Ask about this root" now on the Look up page's card, opening the pane), `today-pages.mjs` (83; since hebrew-today-two also the "Done" screen's "Another set" button, "Building…", the new set at "1 of 10", and the answer choices stacked at phone width with every choice's text inside its button, a long third choice included), `walks-pages.mjs` (38; since hebrew-guide-one also the stop's "Your question, as I read it: …" line at 390 px and 1280 px, light and dark — under "Stop N · …" and above the passage, smaller and quieter than the guide's words — and none on a reply stop; 27 at hebrew-walks-one, 34 after the walks' background stops: the walks page and a walk at 390 px and 1280 px, light and dark — empty, with walks, one stop, "Thinking…", after a pick, after a pushback, after a failed stop — the "You chose" line 0 px from the pressed button, the phone's buttons full width and at least 56 px high, the page no wider than the phone, the passage in three columns or stacked, reopening with no request, `?ref=` and a declined start) — every screen at phone and computer size, signing in through the form; 625 in all (22 Oct 2026, hebrew-guide-one; 621 before it, 614 at hebrew-walks-one, 587 before that). Needs Playwright's browser. The Checks run keeps the hunt's screenshots as the artifact `hunt-screenshots`. |
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
| `npm run check`, everything (16 Oct 2026, hebrew-today-one, the Today checks added) | syntax 2.90 s, tests 76.71 s, screenshots 241.65 s | by hand |
| `scripts/today-smoke.mjs` alone (16 Oct 2026) | 3.05 s | workflow (and full run) |
| `npm run check`, everything (21 Oct 2026, hebrew-ask-one, the ask surface and the ask pane added) | syntax 3.10 s, tests 79.57 s, screenshots 277.79 s | by hand |
| `npm run check`, everything (21 Oct 2026, hebrew-walks-one, the walks added) | syntax 3.18 s, tests 108.48 s, screenshots 300.22 s | by hand |
| `npm run check`, everything (22 Oct 2026, hebrew-guide-one, Playwright's browser installed in the session's own cache) | syntax 4.81 s, tests 125.34 s, screenshots 341.69 s | by hand |

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
