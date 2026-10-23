# Independent review: hebrew-save-one

PASS for candidate `f13b72ca72e738335a746fef9b4d202e66a551ff`.

Reviewed by dev-check@hebrew-save-mixed on 23 October 2026, for queue
`qitem-20261023162937-e69432ff`, against the job and addendum in
`/data/home/dan/work/scratch-hebrew-save-one/`. No blocking finding in the
reviewed diff and exercised stand-in behavior. This is a review verdict;
the owner retains final acceptance and delivery.

## Fresh checks

- `npm test`: exit 0, the full server regression suite passed, including
  the lookup, English, speech and save suites.
- `node scripts/save-smoke.mjs`: all 58 checks passed independently before
  the full suite. Covers all 20 tricky inputs, phrase caching, refusal
  handling, note limits, same-day deduplication, preservation during
  migration, no automatic saving of phrases/refusals, and recording attach
  to a saved note row.
- `node scripts/save-pages.mjs`: all 68 page checks passed, including the
  shared reader card, desktop and phone, light and dark screenshots.
- `node scripts/speech-pages.mjs`: all 82 page checks passed, including
  recording, playback, attachment, deletion, permission failures and
  microphone lifecycle on desktop and phone.
- `node --check` passed for phrase, lookup-page, lookup, English, database,
  server, public lookup and shared card UI JavaScript.

Ports were inspected before starting the stand-ins. Test data was isolated;
no owner database or live service was used. Screenshot changes from review
were restored. HEAD remained the exact candidate, with a clean tree before
adding this report.

## Evidence against the contract

The phrase response contains its ordered words and model meaning. A second
pointed/space-normalized lookup uses the cached meaning without another
model call. Refused meanings retain words and Save it; refused words retain
422, keepable, typed text and suggestions. The page substitutes the required
plain refusal wording. The tricky set and reader card checks exercise the
confidence, register, correction and alternate-reading additions.

Save it creates the existing note-card record, with meaning and optional
note on following lines, unplaced on the latest desk. Same-day duplicate
saves return that note. Nothing is marked or saved before the explicit tap
for phrases/refused words. The saved row has its checkbox and works with
Put on a desk. The existing recording attach endpoint accepts its note key,
and its row displays the play control.

The implementation records the kept phrase with
`desk.lookupLayer(noteKey, desk.PAGE, { origin: 'lookup' })`. The save change
adds `phrase_meanings` using `CREATE TABLE IF NOT EXISTS`, with no new column
and no destructive table migration. The recordings table belongs to the
merged speech feature. The merge's keepBlock retains the recording argument
until saving and passes the resulting note key to attach.

All measured before/after positions were identical (CSS pixels):

| Action | Desktop | Phone |
| --- | ---: | ---: |
| Refused-word Save it | 560 / 560 | 540.390625 / 540.390625 |
| Add a note | 518.390625 / 518.390625 | 694.921875 / 694.921875 |
| Phrase Save it | 518.390625 / 518.390625 | 694.921875 / 694.921875 |
| Phrase word to folded phrase | 456.390625 / 456.390625 | 632.921875 / 632.921875 |
| Back to the phrase | 456.390625 / 456.390625 | 632.921875 / 632.921875 |

The existing checks' edits are justified by the explicit new requirements:
mixed input now becomes a phrase; English accepts six words; the stand-in
recognizes the abbreviation; the page hides raw refusals; and the schema
inventory includes the new cache table. These are contract changes, not
removed regression protection for unchanged behavior.

Reviewed the owner's eight-question UI review and closing answers at
`/data/home/dan/work/scratch-hebrew-save-one/ui-review.md`. Visually inspected
the generated phone phrase and note-entry screenshots and desktop dark
refusal screenshot. Their wording, hierarchy and control layout support
the report; page assertions cover the other specified states and widths.

Audit item 10 reproduced as reported: bare-first and pointed-first variants
in these checks made no extra model calls for the subsequent variants.
A contextual request for the slang word made one call, while the Look up
page continued to prefer its earlier empty-sentence card.

## Limits and continuation

No live-model or live-dictionary trial was made. The author reports a full
`npm run check` ending `check: all passed: syntax, tests, screenshots`, with
962 server and 875 page checks against the measured baseline 859/725.
This review independently reran the server suite and the save/speech page
suites, not the entire screenshot suite or the baseline checkout.

The saved-phrase recording test exercises attachment and row display; the
handoff from actual microphone speech to a phrase/refusal and then Save it
was inspected in code rather than separately driven end to end. The speech
suite independently exercised actual browser microphone flow with its fake
audio source for successful Hebrew and English lookups.

Return this PASS to the owner for its final queue record and instructions
to Dan. Nothing was pushed, merged, deployed or tried against the live model.
