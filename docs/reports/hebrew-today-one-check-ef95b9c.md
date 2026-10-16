# Independent recheck: Today candidate ef95b9c

PASS for candidate ef95b9c497f23791b61eeb829e5d5135ff2b1d3a: all three findings on 3065620 are resolved; all 82 Today server checks and the original independent reproductions pass.

Reviewed by dev-check on queue row `qitem-20261016155505-0d8b7f1c`, against `git diff 3065620..ef95b9c`. This verdict supersedes the findings in `docs/reports/hebrew-today-one-check-3065620.md` for this revised candidate.

- **Stale Undo:** requires both the newest right/wrong answer across all sets and the latest set, before writes. Independent reproduction now gets 409 for the old October 20 answer after October 21 progress. The newer schedule remains due October 24, interval 3, run 2; the newer answer remains and `current()` serves set 2. Added suite coverage also checks rejection before any answer in the newer set, omission of answer_id, and successful Undo of the newest answer.
- **Spine restoration:** the first-drill Undo now emits explicit null for both scheduling fields. Independently inspected `/data/home/dan/work/spine/lib/db.js`: `setMark` uses key presence to distinguish clearing from preserving; `checkDate` and `checkInteger` accept null. The revised stand-in matches that behavior. The server regression verifies both the emitted body and the stored mark after Undo. The independent intercepted-fetch reproduction also observed the two null fields.
- **Sentence source:** selected reads now carry their own source ID and title, applied to form, preposition and know items. The original repeated-word reproduction now labels the September 1 lesson and returns lesson_id 1, rather than the later lesson holding only the word. Added regression also covers article fallback for a lesson word. Made-up sentences and spelling retain their word-origin labeling.

Fresh verification: `node scripts/today-smoke.mjs` exited 0 with `all 82 today checks passed`. The independent `/tmp/today-review-3065620.mjs` reproduction script, updated to assert corrected outcomes, exited 0 with `PASS: original three reproductions now meet expectations on ef95b9c`. Both use disposable fixture databases; no live model/spine calls.

Scope/limits: this was a focused recheck. No UI files changed in the revision; the prior independent 55-page-check pass applies to the earlier candidate, and was not rerun here. The owner's full `npm run check` pass on ef95b9c is reported in the handoff, not independently rerun. Live OpenRouter quality and the deployed spine were not tested. No implementation edits, push, merge or deployment were performed. Only review reports are untracked additions.

Next: return this accepted candidate to the supervising session for its authorized push/PR workflow; merge/deployment remain subject to the brief's separate authorization.
