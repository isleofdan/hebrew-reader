# Focused independent recheck of c1cff26

Verdict: **PASS for the pending-microphone lifecycle correction.**

Reviewer: dev-check@hebrew-speech-mixed, 23 October 2026.
Queue: qitem-20261023135701-ee16b34e.
Repository: /data/home/dan/work/hebrew-speech-one.
Exact candidate: c1cff26347d209f0207ba1270ce985c8f0586cbd.
Reviewed diff: 4dc0d83..c1cff26 (four files).

The P1 finding from docs/reports/hebrew-speech-one-review-4dc0d83.md is
resolved. Pending acquisition now carries a cancellation flag. Both hiding
the page and pagehide invalidate it; a subsequently delivered stream is stopped
before MediaRecorder starts. Becoming visible again does not undo cancellation.
No additional finding in the focused diff.

Fresh checks:

- `node scripts/speech-pages.mjs`: all **81** checks passed, exit 0. Includes
  delayed microphone acquisition followed by hidden, hidden-then-visible, and
  pagehide, each at desktop and phone widths. The six checks confirm ended tracks,
  no recording, idle/enabled Speak, and no request to the stand-in model.
- `node /data/home/dan/work/scratch-hebrew-speech-one/race-repro.cjs`: inspected
  and rerun. All three cases returned recording false, track ended, stopped 1,
  label Speak, disabled false.
- The identical reproduction was also run against the old public/mic-ui.js
  source read with `git show 4dc0d83:public/mic-ui.js`, without changing the
  worktree. All three cases returned recording true, track live, stopped 0,
  label Stop · 0:00. This establishes that the reproduction distinguishes the fix.
- Syntax checks for public/mic-ui.js and scripts/speech-pages.mjs, and
  `git diff --check 4dc0d83..c1cff26`, passed.
- The browser suite retained the existing ordinary flows. Speak top remained
  99.0 px on desktop and 259.4 px on phone across idle/recording/writing/done:
  all differences 0.0 px. Automatic stop measured 30.2 seconds.

Ports 8925–8928 were free before testing. Browser checks ran with fake microphone
and local stand-ins outside the filesystem/network sandbox. Generated screenshot
changes were restored; no implementation changes, commits, pushes or deployments
were made by the reviewer.

Scope and remaining departures:

- This PASS closes the microphone finding; it does not assert literal conformity
  to every original job requirement. The phone control remains a 156 by 52 px
  pill rather than the requested 44 px circle, and steps 2/3 share one commit.
  PLAN.md now explicitly discloses both departures. Disclosure is not evidence
  that Dan approved them; carry them in the final result for his judgment.
- The owner reports full `npm run check` passing with 905 server and 804 page
  checks. This focused review reran the 81-check speech browser suite, not the
  full regression suite or unchanged server suite. The prior independent review
  passed all 46 speech server checks on 4dc0d83; no server code changed here.
- Live model verification item 9 remains Dan's task. No paid/live model call
  was made by the reviewer.

Continuation: owner records this scoped review result, preserves the disclosed
departures, and gives Dan the local trial instructions and live-call continuation.
