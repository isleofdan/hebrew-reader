# Independent check: Today candidate 3065620

FINDINGS for candidate 30656207aa282b84f187b5f9dc9ed49f0faaa450. Two Undo defects need resolution; the source-label defect should also be corrected.

Reviewed by dev-check against the brief at `/data/home/dan/work/scratch-hebrew-today-one/brief.md`, steps 1–8, and diff `7b3a8b6..3065620`. Review row: `qitem-20261016153407-fffe401b`. No implementation changes, pushes, merges, deployment, live model calls, or live spine writes were made.

## Findings

### 1. P2 — Reject Undo from an older set after later answers

`lib/today.js:617–627` checks only the last answer **inside the requested set** before restoring its snapshot. An old phone/tab can therefore overwrite progress recorded in a newer set.

Reproduced with the existing fixture restricted to רפורמה, using the actual `ensureSet`, `answer`, and `undo` functions and an injected clock:

1. Answer right in the October 20 set; retain that answer ID as an old tab would.
2. Answer right in the October 21 set. The word is due October 24, interval 3, right_run 2.
3. Undo the October 20 answer with its exact answer ID. It succeeds, resetting the word to due_on null, interval 0, right_run 0. The October 21 right-answer row remains. `current()` now serves the reopened October 20 set.

Expected: stale Undo is rejected without changing any rows or schedule. Guard the last-answer rule across sets (at minimum reject when this word has a newer answer), and prevent reopening historical sets in a way that violates the single-unfinished-set contract. Add a two-set regression that verifies both the answer ledger and schedule remain intact on rejection.

### 2. P2 — Undo of the first drill does not restore the spine schedule

`lib/spine.js:32` omits both scheduling fields when due_on is null. After an initial right or wrong answer, Undo restores null/0 locally but sends a mark containing neither field. This confirms the limitation disclosed in the handoff; it is a record-consistency defect, not a complete Undo.

Observed request sequence using real `recordMark` with an intercepted fetch:

- Answer: `{status: 'shaky', due_on: '2026-10-21', interval_days: 1, ...}`.
- Undo: `{status: 'shaky', ...}` with due_on and interval_days absent; local state is null/0.

The repository's spine stand-in retains the prior due date and interval for omitted fields (`scripts/mock-spine.mjs:36`). It also retains a prior date for explicit null because it uses `??`, so simply adding null to the body does not establish a fix. Determine the supported clearing representation from the spine contract and test the stored mark after Undo, not merely the outgoing body. If the spine cannot clear these values within scope, return that concrete dependency/decision to Dan rather than claiming full restoration. The live spine was not contacted in this review.

### 3. P2 — Attribute the selected sentence to its actual source

`lib/today.js:83–87` chooses the newest source independently of the read sentence selected at `lib/today.js:191–200` (also relevant to preposition/know items).

Reproduced by seeding נאלצה with the existing September 1 lesson sentence, then adding a newer lesson containing only the single word נאלצה and a touch for it. `itemFor` returns:

- sentence: `הממשלה … לדחות את ההצבעה` (from lesson 1);
- source: `From Guy's lesson Later lesson with word alone`;
- lesson_id: 3, though that lesson contains no such sentence.

This is an ordinary repeat-word-across-lessons case. Carry the selected read's title and lesson/article ID into the item. Preserve the appropriate word-origin labeling for made-up sentences and spelling exercises. Test a repeated word whose usable sentence comes from an older source, including article fallback for a lesson word.

## Verification performed

- `node scripts/today-smoke.mjs`: **all 75 today checks passed**. The initial sandbox attempt could not bind port 8880 (`listen EPERM`); rerunning with permission outside the sandbox succeeded.
- Candidate `scripts/today-pages.mjs`, copied to `/tmp/today-pages-review.mjs` with only module/root/output paths adjusted: **all 55 today page checks passed**, desktop and phone, light and dark. Screenshots are in `/tmp/today-review-pages-3065620/`; candidate screenshots were not rewritten. Visually inspected the fresh phone form screenshot.
- `node /tmp/today-review-3065620.mjs`: reproduced all three findings against disposable fixture databases; no production data or services. The script uses actual application modules, intercepts spine fetch, and stubs only sentence translation for the source-label case.
- HEAD remained the exact requested candidate. Before this report the working tree was clean.

The new checks establish the usual Today flows, including selection, model-down fallbacks, scheduling, auth, progression, and normal Undo. They do not cover the defects above. The model stand-in refuses the Today form translations, so the current screenshots/checks exercise the Hebrew-only fallback, not a successful English translation.

Not rerun: the entire legacy `npm run check` suite. Not checked: live OpenRouter passage quality or the live spine's update/clearing behavior. Midnight Tokyo as the calendar-day boundary and first-open building rather than boot building are consistent with the brief's day/05:00 distinction.

Next: owner resolves findings, records any explicit limitation/decision, and hands the exact revised candidate back for focused recheck before the supervising session pushes it.
