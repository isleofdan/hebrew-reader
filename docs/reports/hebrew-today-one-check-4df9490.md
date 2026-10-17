# Independent check: Today follow-up 4df9490

FINDINGS for candidate 4df9490b3c009f6bbf03aff7760008f84fdf0417: two reproducible defects remain despite all 108 Today server checks and 67 Today page checks passing.

Reviewed by dev-check against `git diff 3c9bcf5..4df9490` and the three-part request in queue row `qitem-20261016165843-74426239`. The candidate is on `claude/hebrew-today-one-fixes`. No implementation changes, push, merge, deployment, live model calls or live spine writes were made.

## 1. P2 — A saved shaky word must override its earlier easy judgment

At `lib/today.js:348`, the learning predicate requires `easy !== 1` for both new and shaky words. The easy judgment persists when Dan changes a word's status. Thus a new word judged easy remains excluded even after he explicitly saves it as shaky. This contradicts the handoff's stated behavior: “A word judged easy is skipped only while new; once saved shaky it is drilled regardless.”

Independent reproduction against a disposable fixture database:

1. Seed the lesson word רפורמה as new.
2. Store its easy judgment through `db.setEasy(id, true)`.
3. Save it as shaky through `db.setSpotStatus(id, 'shaky')` (the same local status write used by saveStatus).
4. Call `today.chooseWords('2026-10-20')`.

Observed: `{status:'shaky', easy:1, due:['w:רפורמה'], chosen:[]}`. The word is due, but neither lesson nor article selection can return it. No model call is needed to reproduce this.

Fix the predicate so shaky words are eligible regardless of `easy`, and apply easy filtering only to new words. Add a regression for new/easy -> shaky, ensuring the word is selected and is not sent for another difficulty judgment. Existing checks cover initially shaky words and easy-new words separately; they miss this transition.

## 2. P2 — Preserve the actual answer when adding niqud to a sentence gap

At `lib/today.js:599–607`, the pointed dictionary form is used as `answer_pointed` even when it is a different grammatical form from the answer. `public/today.js:62–65,240` then puts that value into the sentence gap. This changes the correct answer, rather than adding vowels to it.

The existing fixture for להתבייש has only pointed lemma `הִתְבַּיֵּשׁ`. With a valid made-up sentence, the independent reproduction returns:

- sentence: `אין סיבה … בהחלטה הזאת.`
- expected answer: `להתבייש` (infinitive)
- answer_pointed: `הִתְבַּיֵּשׁ` (past tense)
- rendered result: `אין סיבה הִתְבַּיֵּשׁ בהחלטה הזאת.`

The same mismatch can affect Give the form when the required surface has no pointed surface on its card. The candidate's server and browser checks explicitly accept the lemma substitution; their green result does not establish grammatical correctness.

The handoff describes a dictionary-form fallback. That can remain a separately labeled dictionary reference, but it should not replace the answer in a sentence. For `answer_pointed`, use a card value only when its unpointed form matches the expected answer; otherwise retain the plain expected answer. Update the current fixture assertions and check that stripping niqud from the filled gap yields the expected surface. This requires no new model calls.

## Verification and limits

- `node scripts/today-smoke.mjs`: exit 0, `all 108 today checks passed`.
- Candidate `scripts/today-pages.mjs` copied to `/tmp/today-pages-review.mjs` with only import/root/output paths adjusted: exit 0, `all 67 today page checks passed`, desktop/phone and light/dark. No committed screenshots were rewritten. The reused temporary output directory is `/tmp/today-review-pages-3065620/` (its historical name does not identify this run's candidate).
- `node /tmp/today-review-4df9490.mjs`: exit 0; independently printed both reproductions above using actual Today/database modules and disposable fixture data, with a deterministic sentence stand-in.
- Inspected the migration, spelling and preposition sentence paths, passage length/question validation, Too easy route/status/Undo handling, updated tests and documentation.

Not independently rerun: the full legacy `npm run check` suite. Not tested: live model judgment/quality or the deployed spine. No additional findings in the reviewed changes. HEAD was the requested candidate and the working tree was clean before this report.

Next: owner fixes these two cases, updates regressions and documentation where needed, and returns the exact revised candidate for focused recheck before the supervising session pushes it.
