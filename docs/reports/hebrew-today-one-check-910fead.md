# Independent recheck: Today follow-up 910fead

PASS for candidate 910fead6c0c859e63da446c25c858f29424d6603: both findings on 4df9490 are resolved; all 111 Today server checks pass, and both original independent reproductions now give the expected result.

Reviewed by dev-check on queue row `qitem-20261016171745-7d62a143`, against `git diff 4df9490..910fead`. This verdict supersedes the findings in `docs/reports/hebrew-today-one-check-4df9490.md` for this revised candidate.

- **Saved shaky overrides easy:** the eligibility predicate now applies the easy filter only to new words. The original reproduction (`node /tmp/today-review-4df9490.mjs`) returns `{status:'shaky', easy:1, due:['w:רפורמה'], chosen:['w:רפורמה']}`. The added server regression also confirms the saved word is not sent for another difficulty judgment.
- **Niqud preserves the answer:** `answer_pointed` is populated only when the pointed form, stripped of niqud, matches the expected answer. The original reproduction now returns answer `להתבייש`, answer_pointed null, and the correctly filled sentence `אין סיבה להתבייש בהחלטה הזאת.` The dictionary fallback remains available in `word_pointed` for the flash/list as requested. Server assertions cover exact pointed forms, fallback, Show, and the invariant that every populated pointed answer preserves the expected letters. The browser assertion now expects the actual infinitive in the spelling gap.

Fresh verification: `node scripts/today-smoke.mjs` exited 0 with `all 111 today checks passed`; `node /tmp/today-review-4df9490.mjs` exited 0 and printed the corrected outcomes above. Tests used disposable fixture data and stand-ins. Inspected all five changed text files, including the updated tests and documentation. No additional findings in this focused revision.

Limits: the full legacy suite and browser suite were not independently rerun in this recheck. The owner reports a full `npm run check` pass including 67 Today page checks, after one known paper-pages failure on the first run. The previous independent 67-page-check pass was on 4df9490. Live model quality and deployed spine behavior remain untested. No implementation changes, push, merge or deployment were performed; only this review report was added alongside the prior report.

Next: owner records this accepted candidate and returns it to the supervising session for the authorized push/PR workflow. Merge and deployment retain their separate authorization requirement.
