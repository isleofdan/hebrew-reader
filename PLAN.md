# PLAN — hebrew-reader

Decisions made in session hebrew-reader-one (22 Sep 2026), from the brief on
the spine card `hebrew-satellite`.

## Decisions

- **Spot id scheme.** A spot is a place on Dan's map. Verbs: `v:<root>:<binyan>`
  with the root as dotted letters, e.g. `v:א.ל.צ:nifal`. Everything else:
  `w:<lemma>`, e.g. `w:אמינות`. The id is derived from the card the model
  returns; a card with neither a root+binyan (verb) nor a lemma makes no spot.
- **Three statuses.** `new` (met through a card, not yet marked), `shaky`
  (saved to vocab), `solid` (marked solid). Any other value is refused with a
  400 that names those three.
- **Tints.** `shaky` = amber, `new` = light blue, `solid` = plain, a word with
  no spot = plain. An article with no marks shows every word plain and says
  nothing.
- **Marks are the map, the spine is the record.** The app keeps every spot in
  its own SQLite database, always. On every status change it also writes the
  mark to the spine (see below). A spine failure never blocks the local write.
- **Pull-only.** Nothing notifies, reminds, streaks, counts days, or asks Dan
  to come back.
- **Fail closed.** With `APP_PASSWORD` or `COOKIE_SECRET` unset, the server
  serves only the login page, which says the server is not configured.
- **The card comes from the model, cached.** OpenRouter (`anthropic/claude-sonnet-4.6`,
  one constant in `lib/lookup.js`), JSON only, keyed by a hash of surface +
  sentence. No Hebrew NLP library.
- **The weakness categories** live as one list in `lib/categories.js` so a
  later session can replace them.

## What step 4.1 found: the spine's server-callable mark write

The spine (`isleofdan/spine`, https://spine-dan.fly.dev) exposes its marks
over plain HTTP behind a bearer token, the same token its MCP door takes:

- `PUT /api/marks/:app/:item_id` with `Authorization: Bearer <SPINE_TOKEN>`
  and a JSON body of `{ status, due_on?, interval_days?, last_seen_at?, fields? }`.
  Creates or updates; `status` is required on create. Unknown keys are refused
  with a 400 naming the allowed ones. `fields` must be a JSON object.
- `GET /api/marks?app=hebrew-reader` lists them; `GET|DELETE /api/marks/:app/:item_id`.
- `GET /api/health` is unauthenticated.

So step 7 (marks to the spine) is wired: on every status change the app calls
`PUT https://spine-dan.fly.dev/api/marks/hebrew-reader/<spot id>` with
`{ status, fields: { root, binyan, lemma, categories, last_article_title, touches } }`.
The credential is `SPINE_TOKEN` (env); absent, the app logs once and skips.
`SPINE_URL` overrides the base address (used by the local mock).

The spine was cloned read-only into this session; nothing in it was changed.

## Data model (SQLite, `DATA_DIR/reader.db`)

- `articles(id, title, source_url, text, added_at)`
- `cards(id, surface, context_hash UNIQUE, spot_id, json, built_at)` — the model's answer, cached
- `spots(id, kind, root, binyan, lemma, status, categories_json, updated_at)`
- `touches(id, spot_id, article_id, surface, at)` — one row per card opened

## Environment variables

| Name | Meaning |
|------|---------|
| `APP_PASSWORD` | the site passphrase |
| `COOKIE_SECRET` | signs the 30-day login cookie (32+ random bytes, hex) |
| `OPENROUTER_API_KEY` | the word card, the guide, the phone page, the Ask box |
| `GUIDE_MODEL` | optional; the lesson guide's model, default `anthropic/claude-opus-4.6` |
| `SPINE_TOKEN` | optional; the spine's bearer token for recording marks |
| `SPINE_URL` | optional; default `https://spine-dan.fly.dev` |
| `OPENROUTER_URL` | optional; default `https://openrouter.ai/api/v1/chat/completions` |
| `SEFARIA_URL` | optional; Sefaria's base address for the walks' passages, default `https://www.sefaria.org` (the checks point it at `scripts/mock-sefaria.mjs`) |
| `DATA_DIR` | where `reader.db` lives; `./data` locally, `/data` on Fly |
| `PORT` | listen port, default 8080 |
| `COOKIE_INSECURE` | `1` only for local plain-http runs |
| `LOGIN_WINDOW_MS` | only for tests; the rate-limit window (default 15 minutes) |

## Close-out note — session hebrew-reader-one, 22 Sep 2026

**What stands.** Steps 1–8 of the brief are built, checked locally, and
pushed on branch `claude/hebrew-satellite-brief-v5bwp0`: the passphrase gate,
the data model, article import by paste or url, the reader page with tints
and the side list, the word card through OpenRouter with a context cache,
spots and touches, marks to the spine, and the deploy workflow. 25 smoke
checks and 14 page checks pass (`npm run smoke`, `npm run screenshots`);
screenshots at phone and desktop are in `docs/screenshots/`.

**Step 4.1 finding.** The spine's `PUT /api/marks/:app/:item_id` behind
`SPINE_TOKEN` (see above). Step 7 is wired and proven against a mock that
enforces the spine's key rules.

**Secrets, by name only.** Repository: `FLY_API_TOKEN`, `APP_PASSWORD`,
`OPENROUTER_API_KEY`, and optionally `SPINE_TOKEN`. On Fly, set by the
workflow: `APP_PASSWORD`, `OPENROUTER_API_KEY`, `COOKIE_SECRET` (generated),
`SPINE_TOKEN` (only if the repository has it).

**Divergence from the brief: the branch.** The brief said to work on `main`.
This session was bound by its runner to the branch above and cannot push to
`main` without Dan's word. GitHub registers a `workflow_dispatch` workflow
only once it is on the default branch, so the deploy could not be run from
the branch. The first deploy happens when the branch lands on `main`.

**What could not be reached from the sandbox** (so it was checked against
mocks and is Dan's to confirm on the live site): OpenRouter, the Israeli news
sites (article-by-url was proven against a local page), the spine, Fly.

**Open items.**
- First deploy: merge or push the branch to `main`, then read the Actions run.
- `SPINE_TOKEN` as a repository secret so marks reach the spine (the app
  says "saved here; spine not configured" until then).
- Real-word quality of the card is the model's; the prompt is in
  `lib/lookup.js` and the category list in `lib/categories.js`.
- "Ask about this root" opens two tabs (Pealim, Wiktionary); a browser that
  blocks the second popup shows only Pealim.

## Close-out note — session hebrew-reader-two, 22 Sep 2026

**What shipped (all seven steps of the brief),** on branch
`claude/hebrew-satellite-brief-2sqmao`, each step its own commit, checked
against the local mocks: 60 server checks (`npm run smoke`, up from 26) and
40 page checks (`npm run screenshots`, up from 12). The session's baseline
run printed 26 and 12, not the 25 and 14 the brief carried.

**Decisions this session.**

- **The `on_spine` rule.** `spots.on_spine` is set the first time a spine
  `PUT` for that spot succeeds (the migration on start also sets it for
  every spot already `shaky` or `solid`, which session one sent). A touch —
  a card opened in the reader, a quick lookup, a demand Check or Show —
  sends one `PUT` with `status` unchanged, `last_seen_at` now and `touches`
  updated, only when the spot has `on_spine`. Spots without it stay local
  (Dan, 22 Sep 2026). Every touch goes through `lib/lookup.js`, so there is
  one place this happens.
- **One model transport.** `lookup.chat()` carries every OpenRouter call
  (the card, the demand translation, the ask). The card prompt string is
  unchanged, as the brief required.
- **The demand's sentence** is cut with the same `sentenceSpan` the reader
  uses to build the card's context (`public/tokenize.js`), so a Check or
  Show on the phone hits the card cache the reader filled.
- **The proclitic list** accepted in front of a typed form:
  `ו, ש, ה, כש, וש, וכש, מש, לכש` (`lib/demand.js`, `PROCLITICS`). Comparison
  strips nikud, punctuation and spaces and keeps final-form letters as
  themselves. Only the surface minus a proclitic is accepted, never the
  surface plus one.
- **Translations** are cached in `demand_translations` by a hash of the
  gapped sentence; a refusal or an unreachable model is not cached, so the
  next open tries once more.
- **"Also from this piece"** lists the piece's words that are `shaky` or
  `new`, as the reader's side list does; `solid` words are left out.
- **The reference set** (`lib/references.js`): Pealim, Milog, Morfix,
  Hebrew Wiktionary, the Hebrew Language Academy. The model names a
  reference id and a term per claim; the server builds the URL. The model
  never writes a URL.
- **The lesson sheet** qualifies a spot on two or more touches across the
  N most recent articles (default 5, at most 50). Groups: Nif'al, other
  binyanim, not verbs. Markdown at `/make/lesson?articles=N` (a download);
  `&format=json` feeds `public/sheet.html`, the print page.
- **On phone the Ask column sits below the article** (the right column
  already stacks under it below 900 px); the demand page is its own page at
  `/phone` and works in a desktop window too.

**Data model additions.** `spots.on_spine INTEGER NOT NULL DEFAULT 0`;
`demand_translations(sentence_hash, sentence, translation_en, built_at)`.

**New routes.** `GET /demand?after=`, `POST /demand/check`,
`POST /demand/show`, `POST /ask`, `GET /make/lesson`, and the pages `/phone`
and `/sheet.html`.

**What could not be reached from the sandbox** (checked against mocks; the
live proof is the deploy log and Dan's look): OpenRouter, the spine, Fly.

**Open items.**
- The deploy: Dan's "push to main", then the Actions run.
- Real translations and ask answers are the model's; the prompts are in
  `lib/demand.js` and `lib/ask.js`.
- The scheduled hunt and its line on the phone page: a later session.

## Close-out note — session hebrew-reader-three, 22 Sep 2026

Three fixes from Dan's live use, on branch `claude/peaceful-babbage-bb1t53`,
each its own commit: the Ask box mislabeling a link-less answer as a failure,
no dark theme on a phone browser that forces one, and headline words that
could not be tapped. Checks against the local mocks: 69 server checks
(`npm run smoke`, up from 60) and 82 page checks (`npm run screenshots`, up
from 40).

**Decisions this session.**

- **"No data" reaches the Ask box as an answer.** The ask prompt used to
  tell the model to answer `{"error"}` when a question "cannot be
  answered", and the model read "there is no Nif'al here" as exactly that.
  Now the prompt says that "there is none" IS the answer, with `links: []`,
  and reserves `{"error"}` for declining to answer at all. The server takes
  any reply carrying an answer as the answer, links or not. The failure
  line — "The references could not be asked: …" — is left for the model
  being unreachable, timing out, declining, or answering nothing usable,
  and it names which of those it was.
- **One model transport, with one option.** `lookup.chat()` gained
  `textFallback`: with it, a reply that is not JSON but does carry text
  comes back as `{ text }`. Only the ask surface passes it; the card and
  the demand translation still refuse anything but JSON, so a card is never
  built from prose.
- **The palette rule.** Every color in the app is stated once, at the top of
  `public/app.css`: a light set (`--light-*`) and a dark set (`--dark-*`)
  under the same names. Three blocks map one set onto the names everything
  else uses — the light set by default, the dark set under
  `prefers-color-scheme: dark` for a page with no explicit choice, and the
  dark set under `[data-theme="dark"]`. Nothing below that block names a
  color; new rules use the mapped names. `color-scheme` is declared with
  each set, so fields, scrollbars and the browser's own chrome follow.
- **The switch's storage rule.** Light / Dark / Device sits in the header of
  the index, the reader and the phone page. Device is the default and writes
  nothing — the stylesheet's `prefers-color-scheme` block does the work, and
  the choice is cleared from storage. Light and Dark write `data-theme` on
  `<html>` and are remembered per browser under `hebrew-reader.theme`.
  Every `localStorage` read and write is wrapped: where storage is refused,
  the switch still works for that page's life. `public/theme.js` is loaded
  in `<head>`, so the ground is chosen before the first paint.
- **The print sheet and the login page stay light,** and say so with
  `color-scheme: only light` — that is what stops a browser darkening them
  on its own. The sheet is printed; the login page is one form.
- **The headline rule.** The reader draws the headline with the same
  routine as a paragraph (`fillWords`), so a headline word has the same
  span markup, tint, card and touch as a body word, and its sentence is the
  headline (`sentenceSpan` stops at a line break). `articles.asRead()` — the
  headline as the first line, then the text — is how `lib/demand.js` and
  `lib/ask.js` now read a piece, so the phone page can draw a headline
  sentence, Check and Show stop refusing a headline word, and a headline
  word on the map reaches a question about the piece. No other change was
  needed: the gap, the translation and the card cache all follow the same
  sentence.
- **Contrast is measured, not asserted.** `npm run screenshots` reads the
  colors the browser actually painted: WCAG contrast for text against its
  ground, CIEDE2000 for one tint against another, since amber and blue
  differ by hue rather than by lightness.

**Open items.**
- Whether Dan's phone browser stops forcing its own dark colors now that the
  app declares both grounds: expected, not proven, until he looks.
- The scheduled article hunt: a later session.

## Lessons from Guy — session hebrew-reader-four

### The instructions, and how they reach the model

Dan's שיעורי גיא project instructions were filed on the spine card as one
note, `# GUY LESSON INSTRUCTIONS — 22 Sep 2026`, holding five files. The note
is committed unchanged at `docs/guy-lessons/guy-lesson-instructions-2026-09-22.md` (the note's own heading as an ASCII file name, so no tool trips on the dash and spaces). `lib/guy-lesson-prompt.js`
reads every note in that folder on the first guide build (a missing file stops the guide with its reason, never the server), splits it on its
`=== FILE: <name> ===` lines, and quotes every file in full in the system
message; then one closing block, "How these instructions apply in this app",
asks for a JSON answer instead of two files and forbids items that are not in
the lesson. `.dockerignore` now leaves out only `docs/screenshots` and
`docs/reports`, so the instructions ship in the image.

### Instruction → JSON field

| Instruction (file) | JSON field | Rendered as |
|---|---|---|
| Study Guide Format: `# שיעור עם גיא — [Date]` (Hebrew_Lesson_Tools) | `title`, `date` | lesson page header |
| `## Lesson Topics` | `sections[kind=topics].items` | "Lesson topics" |
| `## [Grammar Topic N]` | `sections[kind=grammar]`: `topic`, `guys_lines`, `explanation`, `examples[{he,en}]`, `verb_claims` | one section per topic, Guy's order |
| "non-technical explanation suitable for sharing with Guy" | none — skipped (Dan, 22 Sep 2026: "I'll bring my own stuff back to him when I need to") | not drawn, even from older saved guides |
| `## תרגילי הטיה` + Conjugation Drill Format + Register §1 (1-2 verbs, Nif'al and deviations first, compare Pa'al) | `sections[kind=drills].verbs[]`: `verb`, `root`, `binyan`, `why`, `table[{tense, forms[{person, he}]}]`, `deviations`, `paal_comparison`, `exercises[{sentence, cue, answer}]` | tables and blank-filling exercises, answers behind a tap |
| Thinking on Paper: section between Core Vocabulary and the Drills, 1-2 prompts, seven types, name the Register categories | `sections[kind=paper].prompts[]`: `type`, `anchor`, `prompt`, `categories` | "עבודה על נייר — Thinking on Paper", placed after the drills and before the vocabulary |
| `## מילים מרכזיות` table: Hebrew, English, Root, Binyan, Category | `sections[kind=vocabulary].rows[]` | a table |
| `## שאלות הבנה` (in Hebrew) | `sections[kind=questions].items` | a numbered list, right-to-left |
| `## ביטויים חשובים` with usage notes and difficulty flags | `sections[kind=expressions].items[]`: `he`, `en`, `usage`, `flags` | a list |
| Data Format: array-of-arrays, 11 fields in order | `cards[]`, each 11 strings | the flashcards page |
| Notes-field flag conventions (⚠️ Prep / Confusable / Spelling / Construction / Idiom) | `cards[][10]` | the card's expandable notes |
| Size management: 35 cards maximum | server keeps the first 35 | "N cards" |
| Flashcard features: nikud toggle, category filter, card flip, expandable notes, mobile layout, `dir="rtl"`, per-category accent | cards page | as named; accents reuse the palette's four existing line colors |

The server keeps a card, a vocabulary row or an expression only when its
Hebrew (nikud stripped) is found in the lesson's own text, so an item the
model added is dropped and the page says how many were.

### The word rule, and what a lesson puts on the map

An item that is exactly one token after the shared tokenizer
(`public/tokenize.js`) is a **word**; anything else is a **phrase** and stays
in the guide and the cards only. After the first guide that builds, each word
goes through the reader's own card path (`lookup.lookup`, same cache, same
spot id), its sentence being the item itself — which is how the lesson page
cuts it, so a later tap is a cache hit. Then:

- a spot not yet on the map (absent, or `new`, met but never marked) is saved
  `shaky` and sent to the spine with one `PUT`; `fields.last_article_title`
  is the lesson's title (`db.lastArticleTitle` now reads the latest touch of
  an article or a lesson);
- a `shaky` or `solid` spot is touched (one more touch, sent to the spine if
  it is there) and keeps its status;
- two items landing on the same spot count once.

The result is kept on the lesson (`lessons.saved_json`: words, touched,
phrases, failed, spine outcomes) and drawn in the lesson page's footer. When
every word fails because the model cannot be reached, nothing is recorded, and
the next guide build tries the words again. Touches carry `touches.lesson_id`.

## Close-out note — session hebrew-reader-four, 22 Sep 2026

Lessons from Guy, on branch `claude/hebrew-satellite-brief-ot8uh7`,
fast-forwarded onto `main` twice on Dan's word (deploy runs 9 and 10, both
green). All six steps of the brief shipped, the print sheet included. Checks
against the local mocks: 94 server checks (`npm run smoke`, from 69) and 132
page checks (`npm run screenshots`, from 84).

**Proven live by Dan, 22 Sep 2026:** the June 2026 PDF uploaded as 39 items
with title and date from the file name, the items read correctly; the guide
built with every section of the instructions and 33 cards (one invented card
dropped); 10 words saved, 27 phrases kept, 2 not identified (עדה, עדתי),
recorded on the spine; six of the lesson's words amber in a pasted article.

**The title-and-date patterns.** `Daniel (HEB|Hebrew|Guy) <d><mon><yy|yyyy>`,
case-insensitive (`Daniel HEB 15jun26`, `Daniel Hebrew 24feb26`,
`Daniel Guy 10FEB2025`, `Daniel Guy 21oct2024`). Title `שיעור עם גיא — 15.6.2026`:
the date is written the Hebrew way because an English month name inside a
right-to-left line is reordered into "Jun 2026 15". Any other name: title =
file name, date = upload date, and the upload says so.

**The item rule.** One item per printed line; a line is joined to the next
only when it runs the full width of the text block (90% of the block and 60%
of the page) and does not end in . ! ? or : — the mark of a sentence the PDF
wrapped. Lines with no Hebrew are left out and counted.

**The guide is built in the background.** A real guide takes a minute or
more; the lesson page asks for its state every three seconds, and a missed
answer (Dan's phone showed "Failed to fetch" on the first real lesson) is said
and retried, never the end of asking. A build the server lost to a restart is
started again.

**Skipped instruction lines** (they cannot apply inside the app): the two
output files and their names (`lesson-[date]-flashcards.html`,
`lesson-[date]-study-guide.md`), the save path `/mnt/user-data/outputs/`,
"present to user", the vanilla-HTML/no-React file spec and the 15 KB size
target (the app draws the cards itself), the `#f8fafc` background (the app's
palette stays; category accents reuse its four line colors), and the "known"
marking under progress tracking (the brief: Know it and Not yet only move on).
The Thinking-on-Paper section sits after the drills and before the
vocabulary, which is "between" them in the Study Guide Format's own order.

**Open items.**
- Articles (and lessons) have no delete button; Dan's check left a test
  article in the list.
- A lesson word tints only in its exact spelling; a prefixed form (והממסד)
  stays plain — the reader's surface rule, older than this session.
- Words the card cannot identify (עדה, עדתי) are named in the footer with no
  way to retry.
- Guide quality against the project's past outputs: session five. First
  observation: the להסלים drill calls the verb intransitive, then drills it
  with an object (הממשלה ___ את המצב).
- The Dropbox folder and bulk import: session five.

## Close-out note — session hebrew-reader-five, 22 Sep 2026

On branch `claude/hebrew-satellite-brief-n91kia`, one commit per step. Checks
against the local mocks: 123 server checks (`npm run smoke`, from 94) and 149
page checks (`npm run screenshots`, from 132). All seven steps of the brief
shipped, steps 5 and 6 included.

**Two models.** `MODEL` (`anthropic/claude-sonnet-4.6`) answers the card, the
phone page's translation and the Ask box. `GUIDE_MODEL` (default
`anthropic/claude-opus-4.6`, overridable by the environment variable of the
same name) builds the guide and runs its review. The fallback rule: when
OpenRouter answers 400 "… is not a valid model ID" or 404 "No endpoints found
for …" to a model other than the card model, `lookup.chat()` makes the same
call once more with the card model; the guide is saved with
`built_with: "fallback"`, and the lesson page's footer says "Built with the
fallback model." The id could not be checked against OpenRouter from the
sandbox; Dan's first rebuild on the live site settles it.

**The five checks** (`lib/guide-checks.js`, each named by the instruction line
it enforces), run on every guide before it is saved:
1. coverage — every one of Guy's lines, nikud and punctuation ignored, is in
   some grammar section's `guys_lines`;
2. drill — when the lesson holds a Nif'al verb or a verb whose root is פ"נ,
   has a guttural (א ה ח ע, and ר) or is hollow, the first drill is Nif'al or
   one of those. The lesson's verbs come from the card cache (the single-word
   items, under the key the word save uses), else from the guide's own
   vocabulary rows that name a binyan; the drill's `binyan` must match the
   card for the same word, and its `deviation` must be true of the root;
3. nikud — at least 90% of vocabulary rows have a vowel point in `pointed`;
4. flags — every vocabulary row and card whose Hebrew holds ח כ ך א ע ס ש ט ת
   carries `⚠️ Spelling:` or `⚠️ Confusable:`, or the words "no spelling trap";
5. objects — the drill's `takes_object` agrees with every `verb_claims` entry
   for the same verb, and a verb drilled as taking no object has no exercise
   with את after the blank.
A failure rebuilds once, the failures named at the end of the user message;
a second failure saves nothing (a first build leaves the raw items and the
line naming the check; a rebuild keeps the previous guide).

**The review-pass contract.** After the checks pass, one more call with the
same instruction files and a review frame returns
`{ guide, changes: [English lines] }`. The server shapes the reviewed guide
the same way, then compares it item for item with the checked one: vocabulary
rows, expressions, drill verbs and cards are matched by their Hebrew (counted,
so a second copy is an addition), topics, prompts, questions and grammar
sections may not grow. Additions are taken out and listed as refused. The
reviewed guide is saved only when it still passes all five checks; otherwise
the checked guide is saved (`review.state` `discarded`), and a review that
does not answer leaves it too (`not run`, with the reason). The page shows
"Reviewed: N corrections", the list behind one tap.

**Schema additions** (the system message was tightened only where the brief
named a fault): grammar `guys_lines`, `verb_claims[{verb, takes_object}]`;
drill `deviation`, `takes_object`; vocabulary `pointed`, `flags`. The object
claim sits per verb inside a grammar section, since one section can discuss
two verbs.

**The prefix list** is one list in `public/tokenize.js`: `PROCLITICS`
(`ו ש ה כש וש וכש מש לכש`, the phone page's, moved from `lib/demand.js`) and
`READING_PREFIXES` = those plus `ב ל מ כ וה וב ול ומ וכ שה שב של שמ מה`, tried
shortest first. A word tints with the mark of its surface, of a lemma it
equals, or — when it has four letters or more — of itself minus one listed
prefix, compared with saved surfaces and lemmas (`/marks-for-article` and
`/marks-for-lesson` now carry `lemmas`). One prefix only; the map is only
read.

**The delete rule.** `DELETE /articles/:id` and `DELETE /lessons/:id`: the
row goes (a lesson's items and guide with it); touches stay without it, spots
keep their status, nothing is sent to the spine. The pages ask once, in the
page: "Delete this article? Saved words stay."

**Try again.** `POST /lessons/:id/retry { surface }`: one lookup through the
card path (a failed card is never cached); on success saved shaky like the
lesson's other words and out of the footer's list.

**The import script, for the laptop brief:**

    APP_PASSWORD=<the site passphrase> node scripts/import-lessons.js "<the Guy Lessons folder>" https://hebrew-reader-dan.fly.dev --build-guides-from 2026-01-01

`--dry-run` first lists what would be added and uploads nothing. It reads the
folder itself, not subfolders; takes only `Daniel Guy|Hebrew|HEB …` PDFs;
skips a file whose name is already a lesson's `source_name`; prints one line
per file. Decision carried from the brief: import all; build guides only for
the 2026 lessons; older ones build on first open.

**Open items.**
- Whether `anthropic/claude-opus-4.6` exists at OpenRouter: Dan's rebuild.
- The drill check sees verbs only through cached cards and the model's own
  vocabulary rows; a lesson whose only irregular verbs sit inside phrases and
  are missing from the vocabulary is not caught.
- The scheduled article finder.

## Close-out note — session hebrew-reader-six, 23 Sep 2026

On branch `claude/hebrew-reader-six-setup-6dp9xr`, one commit per step. Checks
against the local mocks: 139 server checks (`npm run smoke`, from 129) and 161
page checks (`npm run screenshots`, from 153).

**The review corrects the word cards.** The lesson's word cards are the cached
cards of its single-word items (the key the word save uses). They are now made
before the review, through `lookup.cardOnly` (cache, else one card call; no
spot, no touch), so a first build's review sees them too: on the import every
2026 lesson is a first build. These are the same card calls the word save
would make, made earlier. The review message lists them as
`[{word, lemma, pos, root, binyan}]`, and the review frame lets a correction
target one: `{section: "word_cards", item: <the word as listed>, field: "root" |
"binyan", find: <its current value>, replace, why}`. A root or binyan the
review corrects in the guide (a vocabulary row, a drill verb, a flashcard) is
also a fix for that word's card.

**The match rule.** A fix finds its card by the word: the card's surface or its
lemma, nikud ignored, among this lesson's cards only. Exactly one card:
corrected. The same value already on the card: left alone and counted as
unchanged. More than one card: refused and listed ("not guessed"). No card: a
`word_cards` fix is refused and listed; a guide fix is skipped without a line,
since most guide items (phrases, a drill verb in its infinitive) have no card.
A binyan fix on a card that is not a verb, a value that is not a binyan or a
root, and a `find` that is not what the card says are refused. Card fixes come
only from a review that was applied; a discarded review corrects no card.

**What a corrected card records.** `card.corrected[]`: `{by: "lesson review",
lesson_id, lesson_title, field, before, after, why, at}`. Every card shows it as
"Corrected by the lesson review: Pa'al → Pi'el", the lesson on the line below.
The lesson's review list says which cards were corrected and which fixes were
not made. The server log has one line per corrected card.

**The spot follows the card.** A verb's spot id carries its binyan and root
(`v:<root>:<binyan>`), so a corrected verb card moves to the corrected spot.
The corrected spot takes the old one's status when that is further along.
When no other cached card still points at the old spot, its touches move over
and the old spot is deleted locally, so the phone page never asks for a form
under a binyan the verb does not have. A spot that is shaky or solid is sent
to the spine under its new id. The old id's mark on the spine is left as it
was: nothing in the app deletes spine marks.

**Guides on first open** were already built: the lesson page asks for a
build when the state is `none`, and the server runs one build per lesson at
a time. So a second open while one is building starts nothing. That is now
checked, as is the import leaving pre-2026 lessons with no guide. The
"being built" line now says "this can take ten minutes or more" instead of
"a minute or two".

**Open items.**
- The old spine marks under a corrected verb's former id (e.g.
  `v:ז.נ.ק:paal`) stay on the spine.
- Whether the live review corrects לזנק: Dan's rebuild.
- On the desktop lesson page the word card sits at the top of the right
  column and does not follow the scroll. A word tapped low on a long guide
  opens a card that is off screen. This is older than this session.

## Close-out note — session hebrew-reader-seven, 23 Sep 2026

Cloud session (no `flyctl` on the path). Baseline on a clean `main`: 139
server checks, 161 page checks. After: 157 server checks, 183 page checks.

**The review now runs.** Live on the June lesson (build 07:24) it said "the
model did not return JSON", so the review never saw לזנק. What changed, all in
`lookup.chat()` so every model call shares it:
- The review asks OpenRouter for structured output against its schema
  (`response_format: json_schema`, strict, `provider.require_parameters`).
  If no provider of the model takes it (a 400 naming response_format or a 404
  "requested parameters"), the same call goes once more in JSON mode;
  `review.json` records which was used. OpenRouter lists structured output
  for Claude Opus 4.6; it could not be tried from the sandbox.
- The reader takes the first complete JSON object: the whole answer, one in a
  code fence, or one after prose. A `{` that never closes is a cut-off answer
  and is refused, never read for an inner object.
- An answer that is not JSON is logged (its first 2,000 characters, with the
  finish reason) and asked once more, and only once: "return only the JSON
  object", or "your answer was cut off" when it was. A second miss leaves the
  review "not run"; its first 2,000 characters are kept in
  `guide.review.raw_head` and shown under the "Not reviewed" line.
- The review's token limit went from 8,000 to 16,000. The June review had
  applied 40 corrections before (session five); in Hebrew that is close to
  8,000 tokens, and a cut-off answer is not JSON. The most likely cause of the
  live failure, not proven.
- Schema shape: every field is required, so `field` is `""` when a correction
  fills nothing and `replace` is always text ("true"/"false"/"both" for
  `takes_object`). The server treats `field: ""` as no field.

**Nikud on the word card.** The card call also answers `lemma_pointed` and
`surface_pointed`, kept in `card.pointed = { lemma, surface }`. A pointed form
is taken only when it has points and the same letters as the unpointed word
once ו and י are set aside (dictionary spelling drops them); otherwise it is
null and the card shows the word unpointed. Nothing reads `card.pointed` but
the card's display: spot ids, tints, prefix matching stay on unpointed text.
The card shows the pointed headword large (Noto Serif Hebrew — Frank Ruhl
Libre places points poorly), the unpointed spelling smaller beside it, and the
word as it stands in the text, pointed. The card has no list of forms, so
these two are the forms that carry nikud.

**Old cached cards.** A card with no `pointed` opens at once, unpointed, with
`points_missing`; the page then calls `POST /lookup/points` with the same word
and sentence. One small call adds the two pointed forms, saves them back into
the cached card (read again first, so a review correction is not lost), and
the card updates in place. A card that has `pointed`, even with nulls, is
never asked again. Two opens at once make one call. No bulk backfill.

**Plain words.** "map", "met" and "touch" are gone from everything Dan sees:
the color key is "Shaky · Looked up · Solid and new words have no color.";
the card says "looked up · seen 3 times"; side panels "Your words in this
piece / lesson"; the print sheet counts words "seen"; the unmet-checks line
is "Checks not passed"; server messages and the two model prompts whose
wording can come back on screen follow. Kept: "Root radiation map", a paper
exercise named in Dan's own lesson instructions. Code, database and spine
names are unchanged. The page checks read every screenshot's visible text for
the three words.

**Checks.** The screenshot browser now goes through the sandbox's proxy when
there is one, so Google Fonts load as they do for Dan (before, no web font
ever loaded in the screenshots).

**Open items.**
- Whether the live review runs and corrects לזנק: Dan's rebuild of the June
  lesson.
- Nikud comes from the model and can be wrong on rare words.
- On the desktop lesson page the word card does not follow the scroll (older).

**After the first deploy (same session).** Dan's live look: the review now
answers (59 corrections on the June lesson), but it was discarded whole
because one correction (the first drill's deviation, "pe-nun and doubled")
made the corrected guide fail the drill check; לזנק was not among the 59.
Nikud showed on new article cards but not on lesson words: those cards were
all cached before nikud, and the one-time fill used the strict schema the
card model had never run with live. The fill now uses JSON mode (as the card
call does, proven live) with one retry, a card whose forms were all refused
is asked again when next opened, and a failed fill says so on the card
("No nikud this time: …"). Dan confirmed nikud on lesson words after the
second deploy (run 20). Checks: 158 server, 185 page.

## Session eight — hebrew-reader-eight (23 Sep 2026, cloud)

**Review corrections one at a time.** The all-or-nothing rule is gone. The
review's corrections are applied in order, each to the guide as the ones
before it left it; after each, the five checks run, and a correction that
makes a check fail that the guide was passing is undone and listed with the
check and why. The page says "Reviewed: N applied, M dropped". Card fixes
come from applied corrections only. (`applyCorrections(guide, raw, breaks)`
in `lib/guy-lesson.js`.)

**No-change corrections.** A correction whose find and replace are the same
is skipped without a line on the page. The review prompt says "No change
needed" is not a correction, and to leave out any it is unsure of.

**Combined drill deviations.** The drill check accepts a deviation naming
several listed types ("pe-nun, doubled" for נוצץ, root נ.צ.צ); each part must
be listed and in the root. The guide prompt says so.

**Verb-card check.** After the review and its card fixes, a small call to
the guide model gets only the lesson's verb cards (word, lemma, root,
binyan) and answers "correct" or the fix per card. Fixes go through the
review's card-correction path (`correctCards`). An answer naming a word not
among the verb cards sent is refused and listed. Limits: 400 + 150 tokens a
verb; 60 s + 3 s a verb. Saved on the guide as `verb_check`; the page shows
"Verb cards checked: N, corrected: M".

**Live (run 21, Dan's rebuild of the June lesson).** "Reviewed: 14 applied,
0 dropped"; "Verb cards checked: 3, corrected: 2" — לזנק Pa'al → Pi'el
(right), נוצץ Pa'al → Pi'el (wrong: נוֹצֵץ is Pa'al of נ.צ.צ, as the review's
own corrections said). The לזנק card reads Pi'el with "Corrected by the
lesson review: Pa'al → Pi'el", but its pointed forms (זָנַק, לִזְנֹק) and its
note still say Pa'al: a binyan correction does not refresh them.

**Open items.**
- The verb-card check can override a right card and contradict the review.
- A binyan or root correction leaves the card's nikud and note stale.
- The review still lets "acceptable either way" notes through when the text
  changes, and tries to edit JSON keys (`"deviation":"none"`), which are
  refused.

Checks: 171 server, 189 page.

## Session nine — hebrew-reader-nine (23–24 Sep 2026, cloud)

**The two checks must agree.** The verb-card check no longer changes a card
on its own. After the review, the check answers per verb card; then
`settleCards` weighs, per card and field, the review's view (its card fixes,
else what its guide gives for the word: vocabulary rows, drills, flashcards)
against the check's (a fix, or "correct"). Both propose the same value, or
one proposes and the other said nothing about the card: applied. They
differ: left, and listed under the verb-card check as "Not changed — the two
checks disagree: <word>: review says X, verb check says Y". A card's
correction line names who made it (lesson review / verb check / both).

**Refresh after a correction.** `lookup.refreshCard`: one small JSON-mode
call re-points the headword and the word as it is in the text and rewrites
the note for the corrected root or binyan. Run straight after corrections;
a card corrected earlier gets it on its first open (`refresh_due`, then
POST /lookup/refresh). `card.refreshed = { for, at, failed? }`; a failure is
shown on the card and retried at the next open.

**One-time put-back.** `restoreContradicted()` at start, recorded in the new
`steps` table. For each verb-check fix made before this session where the
review's card fixes, else its guide, give the word a value and none equals
the check's, the earlier value is restored and the card shows "Restored: the
verb check's change was contradicted by the lesson review".

**Drill fixes by field.** The review prompt says to write find text from the
guide's visible text, never its JSON keys; a drills correction may name
"field": "deviation" or "takes_object", set on the data and checked like any
other correction.

**Live (Dan, 24 Sep 2026, deploy run 22):** נוצץ restored to Pa'al with the
"Restored" line and a Pa'al note — as expected. **לזנק was also restored to
Pa'al — wrong.** Its card shows זָנַק, "in the text לִזְנֹק", "Pa'al,
infinitive", a Pa'al note, and the "Restored" line. The put-back read the
June guide as the review's view, and the guide evidently gives לזנק as
Pa'al somewhere. Per the brief, no second round: the rebuild check was not
run. The step is recorded and will not run again. Checks: 188 server, 201
page.

## Session ten — hebrew-reader-ten (24 Sep 2026, cloud)

**Confirmed by Dan.** `card.confirmed = { on, root, binyan }`. `agree()` skips
a confirmed card for every field; when either check proposes a change it is
listed in `review.cards.kept`, and `correctCards` refuses to change a
confirmed card as a second guard (so the review's path, the verb check's, the
agreement and any one-time step all stop there). The lesson page shows "Not
changed — you confirmed this card: <word>" under the verb-card check (under
the review when the check did not run), counted in "not changed". The card
shows "Confirmed by you, <date>" first in its correction box.

**לזנק put back.** `confirmZinek()` at start, after `restoreContradicted()`,
recorded in `steps`: the June lesson (lesson date 2026-06-15 or file name
15jun26) card לזנק only, set to Pi'el, root ז.נ.ק, confirmed 2026-09-23; the
put-back's "Restored" entry removed and the correction it had undone shown
again; removed from `verb_check.restored`; spot moved; refreshed.

**The review's verdict per verb card.** The review schema has a required
`verb_cards` list (word, "correct" | "fix", root, binyan, why); parsed by
`verbVerdicts` (card found by surface or lemma, nikud ignored; a word that is
not a verb card of this lesson refused and listed; a verb card with no entry
named in `verdicts_missing`). For a verb card, `agree()` reads the verdict
only — not the review's word_cards fixes, not its guide. A missing verdict
means the review said nothing. `guideSays` is now read only by session nine's
put-back, which is recorded as run live. Review limits: 16,000 tokens + 150
a verb card; 15 minutes + 3 s a verb card.

**Live (Dan, 24 Sep 2026, deploy run 23):** לזנק Pi'el, root ז.נ.ק,
זִנֵּק / לְזַנֵּק, a Pi'el note, "Confirmed by you, 23 Sep 2026", no
"Restored" line. נוצץ Pa'al, unchanged. After a rebuild of the June lesson:
both unchanged; "Verb cards checked: 3, corrected: 0, not changed: 1" with
"Not changed — you confirmed this card: לזנק". Checks: 204 server, 209 page.

## Import — hebrew-reader-import (24 Sep 2026, laptop)

No code changed. `scripts/import-lessons.js` run from Dan's laptop against
the live site, on the folder `Dropbox\Hebrew\Guy Lessons` (58 files, 51 PDFs).
Dan typed the passphrase into his own PowerShell window (masked `Read-Host`);
it never reached a file or this session.

- **Imported 44, failed 0.** Skipped 14: the June lesson (already on the
  site), 6 PDFs not named as Guy's, 7 non-PDFs. The confirming dry run shows
  45 already on the site, 0 to add. The site holds 45 lessons.
- **2026 guides: 7 built, one at a time** (282–595 s each), none with
  "Checks not passed". The run was cut by the laptop sleeping on battery
  ("fetch failed" after 3 guides); the site finished the 4th on its own, and a
  re-run built the last 3. Re-running is safe: it skips what is on the site
  and builds only missing guides.
- **Mis-dated lesson:** `Daniel Guy hebrew 08july25.pdf` has a word between
  "Daniel Guy" and the date, so `nameAndDate` misses the pattern and the
  lesson took the upload day, 2026-09-24. It therefore also got a guide now.
  Not hand-fixed.
- **Verb cards across the 2026 lessons: checked 17, corrected 2** (להמר in
  9 Feb: root מ.ר.ר → ה.מ.ר, Hif'il → Pi'el). "Not changed — the two checks
  disagree": 2, both 26 Jan (לשוטט, שוטטות: review Pi'el, verb check Polel).
  June untouched: לזנק still "you confirmed".
- **Live (Dan, 24 Sep 2026):** lesson 45 (9 Feb 2026) shows a full guide,
  "about right". Lesson 27 (27 Dec 2023) showed "being built", then a guide
  (512 s, saved with the drill check unmet — a "Checks not passed" line).

## Session eleven — hebrew-reader-eleven (24–25 Sep 2026, cloud)

**Dan sets a verb's root or binyan.** `POST /lookup/confirm { surface,
sentence, root, binyan }` → `guyLesson.confirmCard`: verb cards only; binyan
from `lookup.BINYANIM_ALL` (the seven plus polel, polal, hitpolel; the card
call itself still answers the seven); root through `readRoot` (3 or 4 Hebrew
letters, dots/spaces/dashes and nikud ignored, final letters kept as written,
so לחם is ל.ח.ם, not ל.ח.מ). Writes the values, a `by: 'Dan'` line per
changed field, and `card.confirmed = { on (Tokyo date), root, binyan }`
through `saveCard`; refreshes once when a field changed, never when saved as
it stands. The control is built by `CardUI` (`drawSetVerb`) on any page that
wires `onSetVerb` (reader, lesson, phone); a redraw of the same card keeps it
as typed.

**What was proposed.** `review.cards.kept` is now `[{ word, review, check }]`
("Pa'al", "root ה.מ.ר", "Pa'al, root ה.מ.ר", or null); the page also reads the
older list of plain words.

**No verdict.** `review.verdicts_missing` already reached `GET /lessons/:id`
(an empty list meant none missing); the page now shows "The review gave no
verdict on: <words>" under the review.

**Doubled patterns.** `sameHere` in `agree()` only: polel = piel, polal =
pual, hitpolel = hitpael. A review fix naming only the doubled pattern of the
card's own binyan changes nothing.

**Verbs only.** Selection was already `pos === 'verb'`; שוטטות got there
because the card call made its card a verb. The card instruction now says a
verbal noun (שם פעולה) is a noun. The live שוטטות card still says verb until
it is made again.

**Re-date.** `NAME_PATTERN` takes one word before the date. One-time step
`redateLessons()` at start, after `confirmZinek()`, recorded in `steps`: a
lesson whose file name the pattern reads but whose title is still the file
name gets the pattern's date and title; guide kept.

**Live (Dan, 25 Sep 2026, deploy run 24):** the lesson list shows
"שיעור עם גיא — 8.7.2025" between 26.1.2026 and 10.2.2025. להמר (9 Feb
2026), saved as it stands: "Confirmed by you, 25 Sep 2026", "Set root or
binyan again", "recorded on the spine". Checks: 224 server, 229 page (the
web-font check flaked once on clean main and twice later; passed on rerun).

## Session twelve — hebrew-reader-twelve (26 Sep 2026, cloud): the desk

**Data.** `desks(id, name, named, opened_at, touched_at)`; `placements(desk_id,
card, x, y, w, h, z, placed_at)`, x and y null for a card on the desk but not
yet placed (typed on the phone); `notes(id, text, made_at, edited_at)`;
`card_links(child, parent, kind 'born-from', at)`. A card is named by a key:
`word:<cards.id>` (the reader's own cached card, never a copy) or
`note:<notes.id>`. `cards.sentence` added (migration), so a card reached by its
id can be pointed and refreshed (`POST /lookup/points` and `/lookup/refresh`
now also take `{ card_id }`). Every write goes through `lib/desk.js`.

**Rules.** A desk is named for when it was opened, Tokyo time: "Friday 25 Sep ·
evening" (morning 5–12, afternoon 12–17, evening 17–22, night). The desk page
opens the desk last worked on; a new one only when there is none. A word is on
a desk once: a second card of the same word (same spot, another sentence)
counts as already there. A new card goes to the next free spot, row by row
from the top left within 1180 px; a note born from a card goes beside it.
Sizes held to 140×90 – 900×900. Find matches word cards by headword, surface or
root (Hebrew letters only, nikud and dots ignored) or by meaning (English),
note cards by text, desks by name or by a card they hold — the newest card of
each word is the one listed, and a desk holding any card of that word counts.
A matched card grown from another matched card is told as part of it
("להמר and 1 card from it").

**Routes.** `GET /desks/current`, `GET /desks`, `POST /desks`, `GET /desks/find?q=`,
`POST /desks/put`, `GET /desks/:id`, `POST /desks/:id/open`, `PATCH /desks/:id`,
`POST /desks/:id/cards`, `PATCH|DELETE /desks/:id/cards/:key`, `POST /notes`,
`PATCH /notes/:id`; the page `/desk`.

**One-time step.** `remakeShotetut()` at start, after the re-date, recorded in
`steps`: the 26 Jan 2026 lesson's card שוטטות, when still a verb and not
confirmed by Dan, is made again by the card maker as it is now; same card id,
its spot follows. Logs the count (expected 1 live).

**Font check.** The flake was the sandbox failing to download the font from
Google Fonts, not timing: the check now asks for the face, waits up to 15 s,
and on a failed download reloads and tries again, at most three times.

**Checks.** 254 server (from 224), 276 page (229 + 47 desk checks in
`scripts/desk-pages.mjs`, run by `npm run screenshots`).

## Session thirteen — hebrew-reader-thirteen (26 Sep 2026, cloud): a card grows

**Data.** New records, each named by a key of the card shape: `answers(id,
question, answer, links_json, made_at)` → `answer:<id>`; `examples(id,
sentence, source_name, source_kind news|tv|blog|other, source_date, url, kept,
found_at)` → `example:<id>`; `lookups(id, reference, term, at)` →
`lookup:<id>`. A typed note on a card is a note card (`note:<id>`). New
`card_links` kinds: `layer` (child is a layer of parent), `branched-from`,
`cut-from`. A card's layers are its `layer` children in link order (time, then
row order); a cut moves a layer's link, keeping its time. A thread is computed,
never stored: a card, its layers, and every card branched or cut from it or its
layers, recursively, in creation order. Placements are untouched; a layer
cannot be placed (400). Every write goes through `lib/desk.js`. The card's own
record is never written by any of this, so a card Dan confirmed stays locked.

**Routes.** `GET /card/:key` (the full view: `layers`, `counts`,
`layers_line`, `footer { origin, desks, branched }`, `thread_line`,
`references`); `POST /card/:key/notes {text}`; `POST /card/:key/ask
{question}`; `POST /card/:key/examples`; `POST /card/example:<id>/keep
{kept}`; `POST /card/:key/lookup {reference}` → `{ layer, url }`; `POST
/card/:key/branch {desk_id?, unplaced?}` (on a card or a layer); `POST
/card/:key/cut {at, desk_id?, unplaced?}`; `GET /desks/find?q=&source=&time=`
now answers `cards` (with `origin_line`, `owner`), `threads`, `desks`;
`GET /desks/past` (the corner).

**Model calls (`lib/grow.js`).** Both through `lookup.chat({ tools })`, which
for a call with tools sends no `response_format`, reads the JSON from the
answer's text, and hands back `url_citation` annotations as `info.citations`
and `usage.server_tool_use.web_search_requests` as `info.searches`. Tool:
`{ type: 'openrouter:web_search', parameters: { max_uses: 3,
max_total_results: 15 } }`, plus `allowed_domains` = the seven references for
Ask here. **Ask here** keeps an answer only when the search cited at least one
page (the links are the citations, never URLs the model wrote); none → 422,
said on the card, nothing saved. **Find more examples** keeps an example only
with an http(s) url and the card's word by the reader's own matching
(`HebrewTokenize.markFor`: the card's surface and lemma, every surface its
word was met as, alone or after one listed prefix); a url already on the card
is not added again. Time limits 55 s each (expected 33 s and 45 s), under the
minute a quiet request may be dropped by the proxy in front of the site.
Engine: `auto` (left unset). Per OpenRouter's docs as searched on 26 Sep 2026
(the sandbox cannot open openrouter.ai), `auto` uses the provider's native
search for Anthropic models on endpoints that advertise it, else Exa; so live
calls with `anthropic/claude-sonnet-4.6` should use Anthropic's own search
(about $0.01 a search) — unconfirmed until the first live answer's log line.

**The Ask box on the reader page is unchanged.** It builds reference links from
a reference and a term the model names; it makes no web search, and an answer
with no link is still an answer there (session three's decision). The brief
assumed the opposite; see the session report.

**The seven references (`lib/references.js`), in Dan's order, and their link
shapes** (from search-index evidence, 26 Sep 2026; the sandbox could reach none
of the sites, so each is unconfirmed until Dan's live round):
- Morfix — `https://www.morfix.co.il/en/{word}` (the /en/ segment; the shape
  without it was the Ask box's before and is likely wrong)
- Pealim — `https://www.pealim.com/search/?q={word}`
- Wiktionary (Hebrew) — `https://he.wiktionary.org/w/index.php?search={word}`
  (search, because an inflected form such as להמר has no page of its own)
- Milog — `https://milog.co.il/{word}`
- the Academy — `https://hebrew-academy.org.il/?s={word}` (the site's search;
  the Academy's term database was reported offline)
- Kizur — `https://www.kizur.co.il/search_word.php?abbr={word}` (a dictionary
  of abbreviations: most words will find nothing there)
- Sefaria — `https://www.sefaria.org/search?q={word}`
The word asked for is the unpointed infinitive when the card is a verb met as
its infinitive (להמר), else the dictionary form.

**Screens.** `public/grow-ui.js` draws the layers, the action row, cut mode
and the footer under the card's entry in the desk page's full view (computer
"open", a tap on the phone, a Find result). Find shows Cards, Threads and
Desks with source and time chips. The past desk sits small in the bottom
right corner at computer width (`#past`): the desk worked on longest ago that
holds a card, never the desk open now; tapping it opens it. "Note on a new
card" left the full view (the card's own "Branch a new card from here" does
the same); it stays on the desk card itself.

**Checks.** 320 server (254 + 66 in `scripts/grow-smoke.mjs`), 324 page (276 +
48 in `scripts/grow-pages.mjs`). One session-twelve page check waited for
"On the desk" with a case-blind match and so read "putting it on the desk…"
too early; it now waits for the finished line.

**After review (same session).** An old card given its sentence on a later
open no longer has its built time reset (`db.setCardSentence`, not `putCard`);
the example search is told the forms the app accepts (`desk.formsOf`), since
the gate knows only the lemma, the surfaces met, and one prefix — a new
conjugation (הם מהמרים) is still refused; the card view ignores a reply that
arrives after another card was opened, runs one action at a time, keeps a note
as typed before it is saved, and labels "Cut here (every layer)" by the
server's own order.

## Session fourteen — hebrew-reader-fourteen (26 Sep 2026, cloud): the desk with a pen and with paper

**Data.** `inks(id, made_at)` → the layer key `ink:<id>`, tied to its card by a
`card_links` row of kind `layer` like any layer (so it orders, branches and
cuts as one); `ink_strokes(id, ink_id, points_json, drawn_at)`, one row per
stroke, points `[[x, y, pressure?], …]` with x and y as fractions of the ink
area's width (so one drawing shows the same at any width). Strokes are keyed
by the ink layer, not by the card key, so a cut carries them. `card_links`
gains `sentence` (migration): a row of kind `linked` is a link Dan drew, child
→ parent as he picked them, one per pair whichever way round (drawn again, the
sentence is replaced). `sheets(id, desk_id, desk_name, made_at, groups_json,
prompts_json)` and `sheet_cards(sheet_id, card)` (for "on N sheets"). `notes`
gains `link_url`, `link_title` (migration): a note whose text is only a web
address, or a caught link, holds it; the title is filled in afterwards.

**Rules.** Ink: drawing adds to the card's newest ink layer; a card with none
gets one at the first stroke; "undo last stroke" (or the pen's eraser) removes
the newest stroke, and an ink layer left with none goes with its link. Only
the pen and the mouse draw (a finger scrolls); the phone shows ink, never
takes it. Groups: the connected cards of a desk through born-from,
branched-from, cut-from and linked links; the strip counts groups of two or
more. A `linked` link never reads as where a card came from (origin, the
phone list's nesting, Find's "and N cards from it" all skip it). The blue
line shows only while both cards are on the desk. Find: a card Dan linked has
a thread even with nothing grown on it, its line ending "· linked to <word>:
<sentence>"; Threads read "last worked on" (the jargon exclusion is gone).
An answer's links are labelled by page title when the citation carries one,
else the site's name, numbered when repeated (fixes "Milog · Milog", also on
answers already saved). The fragments behind an opened card: while it is
open the Find and Desks panels are `visibility: hidden` and the holder has
`overscroll-behavior: contain`. "(K out of view)" counts placed cards outside
the part of the desk on screen; "bring every card into view" moves each to
the next free spot inside it (the Find panel excluded), saved as any move.

**The sheet.** `POST /desks/:id/sheets` snapshots the desk's groups (a card
alone joins "cards on their own", last), each card with headword and nikud,
root · binyan · gloss, kept examples with source names (no links), asked
lines, notes, ink; Dan's links as "you linked these: <sentence>". Prompts: one
`lookup.chat` call per group, side by side, structured output (`json_schema`),
no web search, 700 tokens, 30 s (about 6 s expected). A prompt is refused
when a Hebrew word in it is not on the sheet: accepted are the sheet's words
by the reader's matching, a word carrying a sheet word's root letters in
order (an inflection: הימרתי), a dotted root of a sheet word, or a word
written on the sheet (an example, a note, an answer, a link sentence). A
failed call leaves the group without prompts and says so; the sheet is made
anyway. Delivery: the Fly image is Node alone (Playwright is a dev
dependency), so the server cannot print; the page at `/desk/sheet/<id>` is
made to print (`@page` 702×936 px, the reMarkable 2's 1404×1872 at half size,
light whatever the device) and says "Print this page to PDF, then send it to
the reMarkable". Pages are laid out in the browser after the faces load (and
again if a face arrives late); a group that does not fit continues on the
next page, "(continued)".

**Catching.** `public/manifest.webmanifest` (start `/desk`, share target GET
`/share` with title, text, url), `public/sw.js` (no cache; the network
answers), icons from `scripts/make-icons.mjs`; the four are served without
the sign-in cookie (the browser fetches a manifest without it). `/share`
serves the desk page, which POSTs `/desks/catch` and puts the address back to
`/desk`, so a GET writes nothing and a reload saves nothing twice. The card
goes to the desk worked on last, not yet placed; the phone says "Saved to
tonight's desk, unplaced. Put it somewhere when you're at the computer." (it
stays until the next message). A link's title: `lib/catch.js`, one try
through `articles.fetchHtml`, og:title else `<title>`; a failure leaves the
bare link. Voice: the phone keyboard's microphone types into "New card".

**Routes.** `POST /card/:key/ink {points}`, `DELETE /card/:key/ink/last`,
`POST /card/:key/link {to, sentence}`, `POST /desks/:id/sheets`,
`GET /sheets/:id`, `POST /desks/catch {text?, url?, title?}`; pages
`/desk/sheet/<id>`, `/share`. `GET /desks/:id` answers `groups` and `sheets
{count, last, line}`; `GET /card/:key` answers `ink`, `linked` and
`footer.sheets`.

**After review (same session).** A `/share` reached from a link on another
website (`Sec-Fetch-Site` cross-site or same-site) goes to `/share/confirm`,
which shows the share and saves it only on a tap; the share sheet's own
arrives as `none` and saves at once. Signed out, `/share` goes to
`/login?next=…` and sign-in returns there (only `/share…` is accepted as a
return address). The title fetch (`lib/catch.js`) checks every hop and
refuses loopback, private, link-local and Fly-internal (`fdaa::`) addresses
(`CATCH_ALLOW_PRIVATE=1` only for the local checks). A note's link is compared
as an address (`desk.linksIn`), so Hebrew or a bare domain keeps its title and
is not written twice. Undoing the last stroke of ink a card was branched from
keeps the empty ink layer. Strokes and undos reach the server in the order
drawn.

**Checks.** 401 server (320 + 81 in `scripts/paper-smoke.mjs`), 375 page
(324 + 51 in `scripts/paper-pages.mjs`). Twelve's count check reads past the
new "·" separator; thirteen's action-row check skips "Draw here".

## hebrew-adopt-kit (3 Oct 2026, the rented Linux machine): the kit's checks and rules

**Nothing on Dan's screens changed.** The reader now has the starting kit's
checks and rules (`docs/CHECKS.md`, `CLAUDE.md`, `.claude/settings.json`,
`.github/workflows/checks.yml`) and a map for the article hunt
(`docs/HUNT-MAP.md`). Report: `docs/reports/hebrew-adopt-kit-report.md`.

- **Tests are the smoke scripts.** `npm test` = `npm run smoke` (401
  checks, about 38 s here); `npm run test:fast` = grow and paper (147
  checks, about 4.5 s). `scripts/smoke.mjs` alone takes about 33 s, past the
  after-edit hook's 30 s, so the hook runs syntax plus the fast tests (about
  7 s) and the Checks workflow runs everything, screenshots included.
  `scripts/check.mjs` differs from the kit's in two lines: `--fast`/`--hook`
  run `test:fast`, and a failure is named from the smoke scripts' `FAIL`
  lines.
- **Rules:** the kit's set, every deny kept, plus `sqlite3` and
  `scripts/import-lessons.js` (it uploads to the live site) denied.
  `git push *` stays allowed: a branch push does not deploy (Deploy runs on
  a push to `main`, which is denied, or by hand).
- **Proven in this trusted clone** (headless `claude -p`): `flyctl deploy`
  and `git push origin main` are refused by the rules themselves.
- **This machine:** the clone is `$HOME/work/hebrew-reader`, marked trusted
  in `~/.claude.json`; Dan added the user rule
  `Edit(/data/home/dan/work/hebrew-reader/.claude/settings.json)` to
  `~/.claude/settings.json` so a session could write the rules file. The
  OpenRouter key does not load in a login shell here (`bash -lc` test
  printed nothing).
- **Next session needs:** the hunt map's findings — no lesson is made from
  one article today (the lesson sheet is built from touches across recent
  articles); the reader never reads marks from the spine; Dan's words are in
  `reader.db` on Fly, out of a session's reach.

## hebrew-hunt-build (3 Oct 2026, the rented Linux machine, unattended): "Find an article"

**Dan's screens changed.** The Articles screen has "Find an article" beside
"Add an article". A tap looks through recent Globes, Calcalist and Maariv
business and energy news, loads the first article that passes the 2026
Hebrew Study project's tests exactly as a pasted address would be loaded,
and attaches a study guide. A found article shows "Found on <date> from
<source>" under its title, with "Study guide". The last search (when, each
article tried and why it was left, the last model call) is in a block under
the button. Report: `docs/reports/hebrew-hunt-build-report.md`.

- **Pull-only.** Nothing runs on a schedule or at startup; the search runs
  inside the tap's request (`POST /articles/find`, a stream of progress
  lines). A tap that leaves early does not stop it. One search at a time.
- **Choosing** (`lib/hunt.js`): sources in turn, newest first, starting
  after the last found article's source; last 14 days (feed date, or the
  page's `article:published_time`); `fromUrl` unchanged; thin, paywalled
  or under 600 Hebrew words dropped; then one model call (the card model)
  per candidate, at most 6, answering the words it found for the three
  tests, each checked by code to be in the body. TheMarker (a paywall stub
  of about 150 words) and Kan (403 to this server) are left out and named.
- **The study guide** is one call to the guide model over the article and
  its "why this one" words, kept to the note's eight parts (at most 35
  vocabulary rows, 2 prompts, 2 drills) and checked by the reader's own
  guide checks (`lib/guide-checks.js`: drill, nikud, flags, objects) plus
  the counts; one rebuild when a check fails. Dan's Register, Thinking on
  Paper and objectives files (`docs/guy-lessons/`) are its instructions.
  Stored as HTML in `articles.guide_html`, served at `/guide/<id>`.
- **Storage:** `articles.origin` (`pasted` for every older row), `found_at`,
  `source_name`, `why_json`, `guide_html`, added by ALTER TABLE; a `hunts`
  table logs each search.
- **Deploy:** a last step signs in and calls `POST /articles/find?trial=1`:
  one real model call on one real candidate, nothing stored.
- **Checks:** `scripts/hunt-smoke.mjs` (28, in `npm test` and the fast set)
  and `scripts/hunt-pages.mjs` (19 page checks); the Checks run keeps the
  hunt's screenshots. The red phone check in `desk-pages.mjs` was the
  check's own fault (it counted a button drawn after a fetch); fixed.
- **Known:** `fromUrl` glues paragraphs (Readability's text): a Maariv
  article comes as one paragraph with words run together at the joins.
  Left as is (the brief kept `fromUrl` unchanged); an ask in the report.

### hunt-fixes (3 Oct 2026, after PR #8's merge, on Dan's yes to asks 1–4)

- **The first live trial** (deploy run 37106950709) reached the model with
  the live key, but its three-test answer was cut off at 2,500 tokens: the
  real model listed every verb. The question now caps the lists (3 / 5 / 2),
  the limit is 6,000, and a cut-off answer is asked once more
  (`retryParse`). Without this, every candidate on a live tap would have
  been dropped.
- **`fromUrl` keeps paragraph breaks** (ask 2): the text comes from
  Readability's HTML with a line break at every block, not from its
  `textContent`, so no word runs into the next paragraph's ("לדרךחוקר").
  A Maariv article went from 1 paragraph to 34. Articles already stored
  are left as they are.
- TheMarker and Kan stay out (ask 3); the last search stays on the
  Articles screen (ask 4).

## hebrew-hunt-two (3 Oct 2026, the rented Linux machine): live blogs skipped; the guide's icons and future tables

**Dan's screens changed:** in a study guide's vocabulary the ⚠️ sits only on a
spelling trap or a preposition note, and every drill's future table is
complete. The chooser's change shows only in which article a tap brings.
Report: `docs/reports/hebrew-hunt-two-report.md`; PR #10, merge `4d0bf53`.

- **Chooser** (`lib/hunt.js` `pageKind`, before the model): skipped when the
  page calls itself a live blog (Globes `article:type` "סקירת מסחר",
  `LiveBlogPosting`, "עדכונים שוטפים" in the title), when 4+ lines open with a
  clock time, or when 13%+ of words are numbers and market names. Recorded
  as "skipped: live blog …" and "skipped: market ticker …". Measured on 36
  candidates, 3 Oct 2026. The 1,500-word ceiling PR #10 added was removed
  on Dan's word (3 Oct: "I don't see a real reason for the limit"): it only
  dropped long reported pieces; the floor of 600 stays.
  "Already in your articles" now runs after these tests.
- **Trial** (`?trial=1`): a tap's tests on today's candidates, up to 6 model
  calls, answers every candidate with its reason; nothing stored. The deploy
  prints the list. First live run (deploy 37110529261): Globes did=1001558228
  "skipped: live blog"; Calcalist 2,747 words skipped (by the ceiling since removed); Maariv article-1373034
  "would be chosen" by anthropic/claude-sonnet-4.6.
- **Guide:** vocabulary flags drawn by `vocabFlags` (⚠️ only on Prep,
  Spelling, Confusable; "no spelling trap" never shown); stored guides are
  redrawn when served (`redrawFlags`), records unchanged. A future table
  missing a person its past has fails a check (`futureGaps`) and is rebuilt
  once. Persons follow Dan's drill tables in
  `docs/guy-lessons/chat-guide-2026-06-15.md`; the reader has no conjugator.
- **Checks:** `hunt-smoke.mjs` 39; `hunt-pages.mjs` checks both guide fixes at
  both widths and shoots `hunt-vocab-*`, `hunt-drill-*`.

## hebrew-lookup-one (9 Oct 2026, the rented Linux machine, OpenRig team): the Look up page and the references inside the reader

**Dan's screens changed.** A new page, **Look up** (`/lookup`, in the top
navigation of every page beside Desk): one box; Enter shows the word's card,
saves the word as his, and records the search on the card; under the card,
seven tabs open the references inside the page when tapped; "Looked up" lists
every word looked up there, newest first, with tick boxes and "Put on a
desk". On a card at the desk, "Look up in" now opens the reference in a pane
under the row (one at a time, with Close), never a new tab. At phone width
the tabs stand as a list and a tab's pane opens under it.

- **How a reference is shown** (`lib/references.js` `embed`, set from the
  frame test `scripts/reference-frames.mjs`, results in `docs/REFERENCES.md`):
  `frame` — the site's own page in a frame — for Wiktionary, Milog and
  Sefaria (no X-Frame-Options, no frame-ancestors); `copy` for Morfix,
  Pealim and the Academy (X-Frame-Options SAMEORIGIN) and Kizur (its https
  certificate names another host, so its link is now **http**, which an https
  page cannot frame). From this machine the copy works for Pealim and Kizur;
  Morfix answers its bot check (202) and the Academy Cloudflare's (403), so
  those two show "The site did not answer; open it directly" unless Fly's
  address fares better.
- **The fetched copy** (`lib/reference-pages.js`, `GET /reference/<id>?term=`):
  fetched only on the tap (pull only), 20-second limit, only a 200 with text
  is taken (a 202 bot check or an empty shell is a failure); scripts,
  comments, frames, inline handlers, `javascript:` links and form controls
  stripped (a `<form>` is unwrapped, so what it holds stays); links and
  images made absolute, links opening the live site in a new tab; shown in an
  `iframe` sandboxed with popups only, under "Shown from a copy fetched by the
  reader; open the site for the live page". Kept in `reference_pages
  (reference, term, html, fetched_at)` (new table, `CREATE TABLE IF NOT
  EXISTS`) and served from there for **seven days**; a failure is never kept.
  Two taps at once make one fetch. `REFERENCE_STANDIN` (local checks only)
  points every fetch and frame at `scripts/mock-references.mjs`.
- **One card, one truth** (`lib/lookup-page.js`). `POST /lookup` with
  `{ surface, origin: 'lookup' }` finds the word's card in this order: the
  word looked up before with no sentence (POST /lookup's own cache); the
  newest card met as this word, pointed or not; the reader's own matching
  (`HebrewTokenize.markFor`: a saved dictionary form or any form met, alone
  or after one listed prefix); else the card is made as POST /lookup makes it
  (the word, an empty sentence, one model call). A found card goes through
  `lookup.lookup` with its own word and sentence (a cache hit: its touch is
  recorded as for any open). POST /lookup without `origin` is unchanged: it
  matches only the exact word and sentence, so a pointed or prefixed form
  with no sentence asks the model. The card's record is never written.
- **Saved at once**, through the reader's own save (`saveStatus`, which
  `POST /spots/<id>` now calls too): a spot still `new` becomes `shaky` and
  the mark goes to the spine; a word already shaky or solid keeps its status.
- **The record.** `lookups.origin` (`ALTER TABLE … ADD COLUMN … DEFAULT
  'desk'`, every existing row back-filled `desk`): `lookup` for the page's
  search (reference `page`, shown as "looked up on the Look up page") and its
  tabs. `POST /card/<key>/lookup` takes `origin` (default `desk`). "Looked up"
  is `GET /lookups?limit=200&before=<time>` — every card with a page search,
  newest search first, 200 a page with "Show more", each with key, headword,
  gloss, day and the tabs opened (the row updates as a tab is recorded), with
  `next`/`next_key` (`before`/`before_key`) so words searched in the same
  millisecond are never skipped at a page's edge — read from the lookup layers and the cards;
  no table of its own.
- **Put on a desk** reuses how a line caught on the phone lands
  (`/desks/catch` → `desk.place(…, { unplaced: true })` on the desk worked on
  last): `GET /desks/current`, then `POST /desks/<id>/cards { card, unplaced:
  true }` per ticked word; a word already there (`already`, the same word by
  any card) is counted: "N cards put on tonight's desk, unplaced — place them
  at the desk", "1 already there".
- **Left as it was:** the reader's and the phone's card has no "Look up in"
  row (only the desk's card view does), so nothing changed there; its "Ask
  about this root" still opens Pealim and Wiktionary in two new tabs — hidden
  on the Look up page only, whose tabs do the same inside. The phone page's
  quick lookup is unchanged (it does not save or record).
- **Checks:** `scripts/lookup-smoke.mjs` (58 checks, in `npm test`, not the
  fast set: the 20-second limit is timed for real, about 25 s) and
  `scripts/lookup-pages.mjs` (44 page checks, in `npm run screenshots`);
  `grow-pages.mjs` checks the card's pane (copy, frame, failure; both widths,
  light and dark) in place of the new tab. Playwright here is 1.63; its
  browser (build 1243) was installed into `~/.cache/ms-playwright`. Totals:
  499 server checks (from 441), 462 page checks; `npm run check` passes.
- **Follow-on (10 Oct 2026):** the redirect gate (a copy only from the
  reference's own site) is `sameSite(ref, url)` in `lib/reference-pages.js`,
  unchanged in what it takes, and now runs under the stand-in too (its
  `/site/<scheme>/<host>/…` addresses are read back as the sites they stand
  for); `lookup-smoke.mjs` checks it, 64 checks (505 server in all).

## hebrew-today-one (16 Oct 2026, the rented Linux machine, OpenRig team): Today

**Dan's screens changed.** A new page, **Today** (`/today`, in the top
navigation of every page beside Look up): the day's drills, phone first, one
item at a time. A thin "3 of 10" line at the top (a place in today's set,
never a streak); the sentence large; the answer box or the two or three choice
buttons low on the screen; Check and Show as on the phone page; after each
answer a flash naming the word and the result ("נאלצה — right; next due in 3
days") with one Undo, and Next under it; at the end "Done for today" and the
day's words with their results. Nothing due: "Nothing is due today".

- **Why** (Dan): after a lesson or an article "usually nothing happens with
  it over the next few days"; the material should come back to him. Lesson
  words lead: everything from Guy's lessons has a context for him, and
  article material is thin at present.
- **Pull-only, with Dan's one exception.** The server makes the day's set
  ahead of time so the page opens at once; an unfinished set simply stays.
  No message, reminder, count of days or "you missed yesterday".
- **The record** (in `migrate()`, nothing dropped or moved):
  `spots.due_on TEXT` (an ISO date in Tokyo; null: never drilled, due now),
  `spots.interval_days INTEGER NOT NULL DEFAULT 0`, `spots.right_run INTEGER
  NOT NULL DEFAULT 0` (right answers in a row), by `ALTER TABLE … ADD COLUMN`
  (every existing word starts never drilled); and two new tables,
  `drill_sets (id, for_day UNIQUE, built_at, items_json, note)` — one per
  Tokyo day, the items as they were made, and the plain line the page shows
  when fewer than two passages could be made — and `drill_answers (id,
  set_id, item_index, spot_id, kind, result right|wrong|shown, answer, at,
  before_json)`. `note` and `before_json` are two columns the brief did not
  list: `before_json` holds the word's status and three scheduling fields
  before the answer, which is what Undo puts back.
- **Choosing the set** (`lib/today.js`, `build`): ten items. (a) one solid
  word whose due day has come, the longest overdue first; (b) lesson words
  (a touch carrying `lesson_id`), shaky or new, due or never drilled, never
  drilled before drilled, then the least recently touched first — up to six,
  five when (a) filled its slot; (c) article words (an article touch and no
  lesson), the same rule, up to two; slots (b) leaves go to (c) and back. (d)
  two fresh passages; one the model could not make leaves its slot to (b),
  then (c), and the page says "No fresh passages today; the model did not
  answer." Shown as lesson words, article words, the solid word, passages.
  Nothing at all: `{ state: 'no data', reason }`, and no set is stored.
- **The exercise for a word**, by its categories, first match wins:
  `conjugation` → Give the form (the demand's gapping and `formMatches`;
  the sentence is a lesson item of several words holding the word, else the
  article's sentence, else one the model writes, marked "a made-up
  sentence"); `preposition-government` → Which preposition (the card's
  `governs` blanked in the word after it — a whole word, or the one-letter
  prefix — or "<word> …" when the sentence does not hold it; three choices
  from a fixed list); `letter-order` or `homophonous-spelling` → Which
  spelling (the dictionary form and one misspelling: the model's, kept only
  when it is the same length, not the word and not a word Dan has; else one
  made by the same rule here); otherwise Do you know it (Show opens the
  word's own card, then "I had it" / "I missed it"). An exercise that cannot
  be made for a word passes to the next rule. A lesson's single-word item is
  the word alone, so it holds no sentence to gap.
- **Fresh passages**: one model call each through `lookup.chat` with
  `GUIDE_MODEL` and a JSON schema (`today_passage`), made when the set is
  made, never on a tap. Subjects in turn (energy and electricity markets,
  business and markets, aviation, Israeli politics and society,
  twentieth-century history), counted over every passage made so far; the
  question alternates (a verb blanked, a comprehension question in Hebrew with
  three choices). The model is given four to six shaky words with the forms
  each may take (its dictionary form and every form Dan met it as); the
  server keeps a passage only when at least three are words of the text,
  nikud stripped, alone or after one prefix. At most two new words, tinted
  light blue and tappable to the reader's own card; the English shown after
  the answer.
- **When the set is made** (`ensureSet`): only when there is no unfinished
  set at all — an unfinished set from an earlier day keeps being served, and
  its unanswered words stay due — and a finished set is followed by the next
  day's, never a second the same day. Two calls at once share one build.
  `server.js` starts one scheduler at boot: the next 05:00 Tokyo (Japan keeps
  no summer time, so always 20:00 UTC), a `setTimeout`, the build, armed
  again — a chain, so a slow build never overlaps. `GET /today` and
  `GET /today/set` call `ensureSet` too, so the set is there on the day's
  first open even if the scheduled build failed. The day is the calendar day
  in Tokyo: a set finished at 23:00 is followed by a new one opened after
  midnight. No build runs at boot itself (the checks start many servers);
  nothing runs on the machine, only in the app's own process on Fly.
- **The intervals** (`answer`): right → `right_run` + 1 and `interval_days`
  up the ladder 1 → 3 → 7 → 14 → 30 (the first right after none or after a
  wrong is 1), due that many days on; a shaky word whose run is three or more,
  with its rights on three different days, becomes solid. Wrong → run 0,
  interval 1, due tomorrow; a solid or new word becomes shaky. A new word
  answered right stays new (the brief makes only shaky words solid). A typed
  form or a chosen answer is judged by the server; Do you know it, and an
  item after Show, take Dan's own tap.
- **Marks.** A status change goes through `saveStatus` (the spot, then the
  mark). `recordMark`'s body now carries `due_on` and `interval_days` at the
  top level on every mark, both null for a word never drilled: the spine's
  `setMark` (read in its repository, `lib/db.js`) clears a key sent as null
  and keeps one left out, so a null is what puts the spine back when Undo
  returns a word to "never drilled". A word whose status stays but
  whose due day moved gets its mark again when the spine already has it (the
  touch rule of 22 Sep 2026). The stand-in spine already allowed both keys;
  it now clears them on a null as the spine does, and answers
  `GET /bodies?item=` with every PUT body, for the checks.
- **Undo** (`POST /today/undo`): only the newest answer of all, in a set no
  newer set has followed — an older page (another tab, the phone left open)
  is refused with a 409 before anything is written, so it never undoes what
  came after or opens an old set again. Its row goes and the word's status
  and three fields are put back from `before_json`, the status through
  `saveStatus`, and the mark sent again.
- **The line under an item** names where its sentence is: the older lesson
  that holds it, or the article for a lesson word whose only sentence is
  there. A made-up sentence, a spelling, or a word with no sentence names
  where the word was last met.
- **Routes.** `GET /today` is a page route (not in `isApiPath`): signed out it
  answers 303 to `/login`. Its data is under `/today/` (`GET /today/set`,
  `POST /today/answer { set_id, item_index, result, answer }`, `POST
  /today/show`, `POST /today/undo`), which signed out answers 401 in JSON.
- **Checks:** `scripts/today-smoke.mjs` (82, in `npm test`, about 3 s) and
  `scripts/today-pages.mjs` (55, in `npm run screenshots`; screenshots
  `docs/screenshots/today-*.png`), with `scripts/today-fixture.mjs` writing
  two lessons and an article into the database. The OpenRouter stand-in
  answers passages, made-up sentences and misspellings. `lookup-smoke.mjs`'s
  table count and `lookup-pages.mjs`'s navigation check now allow the Today
  tables and link. Totals: 587 server checks (from 505), 517 page checks
  (from 462); `npm run check` passes.
- **Fixes after the result check (16 Oct 2026, after PR #14's merge;
  branch `claude/hebrew-today-one-fixes`).** Three gaps against steps 3 and
  4, closed. Which spelling now always has a sentence: the word blanked in a
  sentence Dan read, else one the model writes ("a made-up sentence"); the
  choices are the word as it stands there and its misspelling, and with no
  sentence at all the word gets Do you know it instead. Which preposition
  with no read sentence holding the preposition asks the model for one
  sentence with the word and its preposition right after it ("a made-up
  sentence", the preposition blanked); the word alone with a blank after it
  is left only for when the model gives no usable sentence. A passage is
  kept only with three to five sentences (counted between . ! ? and line
  breaks); the stand-in now writes five, and one of eight is refused with
  "No fresh passages today; the passages written were not three to five
  sentences." On the page the gap fills with the right answer after a
  preposition or a spelling too.
- **Answers with niqud** (Dan, 16 Oct 2026). Wherever the page reveals or
  confirms an answer — the flash, Show, the filled gap of Give the form, the
  right preposition, the right spelling, the day's list — the word carries
  its niqud from its card as it stands when the set is served
  (`word_pointed`, `answer_pointed`): the pointed word when the card is for
  that very form, else the pointed dictionary form, else the word plain —
  except in a sentence's gap, which takes a pointed form only when it is the
  answer's own letters (a dictionary form of an inflected answer would
  change the answer: `להתבייש` is never filled as `הִתְבַּיֵּשׁ`), else the
  answer plain. A
  preposition's niqud comes from a fixed table beside the list of
  prepositions (a card holds none for it). The questions and the choices to
  tap stay plain, so niqud gives nothing away.
- **Better judgment in choosing words** (Dan, after his first real use:
  "ראשון and צבעי were too easy"). Every single-word item of a lesson lands
  on the map as new, ordinals and colours included, so: shaky words now come
  before new ones among lesson and among article words; each new word is
  judged once by the model — would an advanced reader of Israeli news know
  it cold? — in one call per set build (up to 40 words not yet judged: the
  card's word, meaning and categories), and the judgment is kept in
  `spots.easy` (`ALTER TABLE … ADD COLUMN`; null until judged, 1 easy, 0
  worth drilling); a word judged easy is not drilled while it is new — once
  Dan saves it (shaky) it is drilled whatever the judgment; when the model does
  not answer nothing is kept and the set is chosen as before. A passage's
  blanked verb is one of Dan's given shaky verbs wherever the passage has
  one (the server picks it, whatever the model named); else the model's
  verb, refused — and the passage not kept — when it is a basic verb (a
  fixed list of dictionary forms and their commonest forms). "Too easy", a
  small link on every word item, marks the word solid through `saveStatus`
  (so the spine has it) and leaves its schedule as it was; it is one
  `drill_answers` row with result `right` and kind `too-easy` (the table's
  check allows only right, wrong and shown, and a table holding Dan's
  answers is not rebuilt), with the word's fields before it, so Undo
  reverses it like any answer; the day's list says "too easy".
- **Checks** after these: `today-smoke.mjs` 111 (each preposition path, the
  spelling fallback, the length rule, niqud on the answer fields and every
  pointed answer the answer itself, shaky before new, the one judgment and
  the model down, an easy word saved shaky drilled again, the passage verb
  both ways, "Too easy" and its Undo), `today-pages.mjs` 67; totals 616
  server checks and 529 page checks.

## hebrew-today-two (17 Oct 2026, the rented Linux machine, OpenRig team): as many sets a day as Dan likes

**Dan's screens changed.** The end of a set says "Done" (the day is no
longer the unit) and, under the list of results, a large "Another set"
button; a tap says "Building…" while the set is made (the passages take a
few seconds) and opens the new set at "1 of 10". On the phone the answer
choices of a passage's question, "Which preposition" and "Which spelling"
stand one under another, full width, each choice's text wrapping inside its
button; on the computer they stay on one row and each button grows with its
text.

- **Why** (Dan, his first day): "Can't get a new set of drills going. I
  think we need to change the app so I can do as many sets per day as I want
  to." A set was keyed to the Tokyo day (`drill_sets.for_day` UNIQUE, the
  insert `OR IGNORE`), so a finished set left nothing until the next 05:00
  build. And a longer comprehension choice spilled out of its button below
  the card on the phone.
- **Sets are numbered, not dated** (in `migrate()`, nothing dropped or
  moved): `drill_sets.seq INTEGER` by `ALTER TABLE … ADD COLUMN`, back-filled
  from `id`. The current set is the newest unfinished one (by `seq`); with
  none unfinished the page shows the newest finished set's "Done" screen.
  `for_day` stays the Tokyo day a set was built on; its UNIQUE constraint
  cannot be dropped in place, so a later set built the same day writes the
  day with "#2", "#3" after it. The only reader of `for_day` as a day is
  `newestSetOfDay`, which reads the suffix; the page, the scheduler and the
  Undo message do not read it (the message names the newer set by number).
  `addDrillSet` is a plain insert inside one transaction: a failed insert is
  an error, never an old row answered in its place.
- **When a set is made.** `ensureSet` (the page's open, the 05:00 build)
  makes a set only when no set is unfinished and none was built that day;
  `newSet` (the tap, `POST /today/another`) builds one regardless. Both share
  one guard, so two taps at once make one set.
- **A set never runs dry.** The eight word slots fill from (a) the words due
  (never-drilled ones included), in the order of hebrew-today-one, then the
  rest of the solid words due; then (b) shaky words not yet due, then (c)
  solid words not yet due, each earliest due first, the least recently
  touched first on the same day. A word already in an unfinished set is
  skipped. When (b) or (c) is drawn on, the set's note begins "Nothing more
  is due; this set draws on words not yet due." Answering a word not yet due
  moves it by the same rules as a due one. "No data" is now only for a map
  with no words (or, the one corner left, words that are all in unfinished
  sets, known — judged easy, or marked solid before ever drilled — or never
  met in a lesson or an article, which the reason says).
- **Three things the brief did not say.** A new word answered right stays new
  with a due day (hebrew-today-one's rule), so "a new word is never drilled"
  is not quite so: such a word, not judged easy, is drawn on in (b) with the
  shaky ones. (b) and (c), like (a), take only words met in a lesson or an
  article (a word only ever looked up is not drilled, as before). And a
  solid word never drilled (no due day) is not "a never-drilled word counts
  as due": it is one Dan marked solid himself — "Mark solid" on a card, or
  "Too easy", which leaves the schedule as it was — so it stays out of every
  pool until it has a due day (as before); drilling it would bring a word he
  just called too easy straight back in the next set. (The team's checker
  raised this; kept by choice, with a check and a true "no data" reason.)
- **Checks** after these: `today-smoke.mjs` 142 (a second set the same day
  through `POST /today/another`, "#2" and "#3", two taps at once, the pools
  and their note, the words of an unfinished set skipped, answering a word
  not yet due, "no data" only with no words, a word marked solid before it
  was ever drilled left out, the 05:00 build with a set unfinished, the
  migration's back-fill), `today-pages.mjs` 83 ("Another set" under the
  list, "Building…", the new set at "1 of 10", the choices stacked at phone
  width with every choice's text inside its button, a long third choice in
  the stand-in's passage question); totals 647 server checks and 545 page
  checks.

## hebrew-ask-one (21 Oct 2026, the rented Linux machine, OpenRig team): one ask surface, and "Ask about this root" inside the page

**Dan's screens changed.** "Ask about this root" on a word card no longer
opens Pealim and Wiktionary in two new tabs: it opens a pane directly under
the card's buttons, in the card, on every page with a word card (the
reader, the lesson page, the phone page, Today, the Look up page — where the
button was hidden until now — and the desk's opened card). Top to bottom:
the root in Hebrew (the dictionary form for a word with no root) and
"Close"; two tabs, "Pealim" and "Wiktionary", that show the reference inside
the pane as the Look up page does (Pealim by the root letters, Wiktionary by
the dictionary form, as before); a box, "a question about this root…", and
"Ask"; the answer with the pages it leaned on; then "Ask more". The reader's
Ask box now searches the references too: its links are the pages the
search cited (the reference's name and the page's title), and "Ask more"
under an answer asks a follow-up. An answer with nothing cited is still an
answer there, with "Nothing here to look up in a reference."

- **One ask surface** (`lib/ask.js`). Every question is answered by `ask`:
  the reader's Ask box and the root ask through `POST /ask`, the desk's "Ask
  here" through `POST /card/:key/ask` (`askCard`, which also writes the
  answer layer). An ask has three parts: a **subject** — `article`
  (`article_id`, optional: the piece's mapped words go into the question, as
  before), `card` (`key`: the desk card's entry and layers, `grow.context`),
  `root` (`root`, `lemma`, `lemma_pointed`, `binyan` or `pos`, `meaning_en`,
  `sentence`, from the card the page holds; a root or a lemma needed); a
  **desk** — who answers and what it may search; and an optional
  **parent** — the earlier ask a follow-up follows. With a parent, the
  model is sent the chain's earlier questions and answers as conversation
  turns (`lookup.chat`'s new `history`, oldest first, the last six turns)
  before the subject and the new question. A follow-up goes to its parent's
  desk (another desk: 400). One model call with OpenRouter's web search
  limited to the desk's sites; the links are the citations (`grow.linksFrom`),
  never an address the model wrote (`lib/references.js` still builds the
  "Look up in" links). Whether an answer with no citation is kept is the
  caller's choice, passed in (`keepWithoutLink`): kept for the Ask box and
  the root ask (session three), refused with session thirteen's 422 for
  "Ask here". `POST /ask` takes `{ desk?, subject, question, parent? }` and
  answers `{ id, answer, links, searches, state, links_state }`; the first
  shape `{ question, article_id? }` is the article subject on the hebrew
  desk. Refusals name the valid values: "desk must be one of hebrew",
  "subject.kind must be one of article, card, root". A card asked through
  `POST /ask` is recorded in `asks` but writes no answer layer: only "Ask
  here" puts an answer on a card.
- **The desks** (`lib/ask-desks.js`): `{ id, persona, domains, model,
  limits }`. One desk, `hebrew`: the persona from session thirteen's "Ask
  here" text (the subject's own line and the answer's JSON shape are added
  by `lib/ask.js`), the seven references' domains, the card model and
  `grow.ASK`'s limits (900 tokens, 55 s); no new limit. `register(desk)`
  adds a desk; the check registers a stand-in second desk through `node
  --require` before the server starts, with no change to `server.js` or
  `lib/ask.js`.
- **The record** (in `migrate()`, nothing dropped or moved): a new table
  `asks(id, desk, subject_kind, subject_text, word, question, answer,
  links_json, searches, parent_id, asked_at)` by `CREATE TABLE IF NOT
  EXISTS` (indexes on `word` and `parent_id`), and `answers.ask_id` by
  `ALTER TABLE … ADD COLUMN` (existing rows: null). Every accepted answer is
  one `asks` row (`subject_text` as the model was given it; `word`, the
  dictionary form, for a root or a card); "Ask here" writes its `asks` row
  and its answer layer in one transaction, the layer pointing at the row. A
  refused or declined ask writes nothing.
- **What a second desk needs** (the guided study Dan intends): one
  `register({ id, persona, domains })` entry — its persona (the guide who
  explains, flags where scholars disagree, gives an opinion and takes push
  back), its sites (Sefaria, say), and a model and limits if not the
  card model's; a subject kind for its text (a passage, with a reference and
  its translation), added to `KINDS` and `subjectOf` in `lib/ask.js`; and a
  screen. The follow-up chain is already there for the push back. The pane
  would need the text and its translation side by side, which it does not
  have: it is built around one word card.
- **The pane** (`public/ask-ui.js`; `CardUI.wire` takes the page's `api`).
  Nothing is fetched on opening (rule 3): a reference loads on its tab's
  tap, the model is asked on "Ask". A tab opened from the pane is recorded
  as a lookup on the word's desk card when the word's card is on a desk
  (`desk_key`, which `POST /lookup` and the phone page's demand answers now
  carry; the Look up page records it on its own card with origin `lookup`,
  as its tabs do; the desk's opened card on itself); a word with no desk
  card records nothing. The card's buttons stay at the same height on the
  screen when the pane opens and closes (rule 5). On a card anchored to the
  bottom of the screen — the reader's and the lesson page's card on the
  phone — growing would push the buttons up, so that card keeps its height
  while the pane is open and the pane opens below the buttons inside the
  card, which scrolls. Close keeps the buttons where they are on the screen
  at the moment of the tap, however far the page or the card was scrolled
  while the pane was in use: when the content left below is too short for
  that, blank room is added at the end of the page (or of the card, which
  then keeps its height) and taken away when the pane next opens or the
  card shows another word. A new word on the card closes the pane. "Put on
  the desk" on the card makes a tab tapped afterwards record on the card it
  placed, with no reload — only on the word it was pressed for: a word
  opened while the put was on its way gets neither the key nor the "On the
  desk" line. On the phone the pane is the card's full width
  and "Ask" is 56 px high.
- **Four small fixes.** The reader's Ask box onto the web search (above).
  An empty note card — no text, nothing kept, asked, noted or drawn on it —
  is left off the sheet (`lib/sheet.js`; a desk of only such notes makes no
  sheet and says why). A line shared from Chrome with the page's address
  twice, plain and with the selection coded in after `#:~:text=`, keeps the
  plain address once and the selected text as the line's text
  (`catch.share`, called by `POST /desks/catch`; with only the coded address
  the selection is read back from it). The sheet page says by its Print
  button: "In the print window, choose no headers and footers." (the bar
  does not print).
- **Checks**: `grow-smoke.mjs` 83, `smoke.mjs` 256, `paper-smoke.mjs` 86,
  `screenshots.mjs` 231, `grow-pages.mjs` 105, `paper-pages.mjs` 54,
  `lookup-pages.mjs` 44 (its check that the button was hidden now opens
  the pane); totals 670 server checks and 587 page checks. The team's
  checker found two faults in the first candidate, both fixed with a check
  each: Close after the pane was used and scrolled let the page or the
  sheet jump, and a word just put on the desk recorded no lookup until its
  card was opened again. Its recheck found the second fix could hand the
  key to a word opened while the put was on its way; fixed, with a check
  that holds the put's answer back.

## hebrew-walks-one (21 Oct 2026, the rented Linux machine, OpenRig team): Walks, the guide to Jewish thought

**Dan's screens changed.** "Walks" joins the top navigation after "Today"
on every page (on the phone the links now wrap to a second line rather than
widen the page). `/walks` has a box, "a question to walk with…", and
"Start", then his walks, newest first, each with the day it started.
Start makes the first stop and opens the walk at `/walks/<id>`: its title,
then each stop as a panel — "Stop N · <the passage's title>" with "Full
passage" (the passage's page on sefaria.org), the passage in Hebrew, its
transliteration and its English (three columns on the computer, one under
another on the phone), "Why here", "What it says, plainly", "Where the
tradition argues with itself" with the Sefaria pages the guide cited, "My
opinion", and "answered in N s". Under the last stop: two or three
directions, "Push back, or ask…" and "Go". A direction or Go shows
"Thinking…" where the buttons were; the stop arrives below and the buttons
become "You chose: …" or "You wrote: …" at the same height. A failed stop
says why in that place and the buttons come back. Reopening a walk draws it
from the record, with no model call. A move about Israel, antisemitism or
current politics is declined in one line.

- **The desk** `thought` (`lib/ask-desks.js`): the persona (the brief's,
  sharpened from the approved sample stop: a reason for each stop, names
  explained with who and when, "You may well disagree. Tell me where."),
  `www.sefaria.org` as its one site, the guide model (`GUIDE_MODEL`, with the
  card model as the fallback when OpenRouter has no such model — now also
  for a call with the search, `chatWithTools`), a stop's limits `{ 3000
  tokens, 120 s }`, a choosing call's `{ 600 tokens, 60 s }` (the new desk
  field `choose`), and ten turns (the new desk field `turns`; `hebrew` keeps
  six, and `chainOf` reads it from the desk).
- **A stop is two calls through `ask`** (`lib/walks.js`), subject `{ kind:
  'walk', walk_id, ref? }` (the walk's question, or "The reader is standing
  at <title>", the stops so far by reference, and with `ref` the passage's
  Hebrew and English). *Choose*: no search, the guide answers `{ ref, title }`
  or `{ declined }`; not recorded. The server fetches the passage; a
  reference Sefaria does not know is sent back once with Sefaria's message
  for one more choice, and a second miss ends the stop ("the guide twice
  named a passage Sefaria does not know"). *Teach*: the search on Sefaria,
  the stop as JSON (`why_here`, `transliteration`, `explanation`, `argues`,
  `opinion`, `next`); recorded. A walk started from a reference skips
  *choose*. `ask` takes, beside `keepWithoutLink`, `format` and `record` as
  the brief named, and three more the two calls needed (named as a
  divergence in the report): `read` (how the answer is read from the
  model's JSON), `limits` (the desk's `choose` for the short call) and
  `search` (off for *choose*). `lookup.chat` now sends `history` on a call
  without the search too (it was dropped there; no caller passed it before).
  A failure says which: "the guide did not answer within the time limit of
  N s" (504), "OpenRouter is unreachable", or "Sefaria could not be reached".
- **Sefaria** (`lib/sefaria.js`, `passage(ref)`): Sefaria's Texts API v3,
  `GET <SEFARIA_URL>/api/v3/texts/<ref>?version=hebrew&version=english`,
  with the 20-second limit of the server's other outside fetches. It answers
  the canonical `ref`, the title ("Talmud, Shabbat 112b": the book's
  category and the reference), the Hebrew and the English as plain text — a
  line per segment, every tag dropped, a footnote's marker and its note
  removed — and the page's address. A reference it does not know (its 404,
  `{"error": "Could not find title in reference: …"}`) answers 404 naming it;
  unreachable or slow, 502 "Sefaria could not be reached". The address rule
  is in `lib/references.js` (the Sefaria entry's `passage`, beside its search
  link): spaces to `_`, `:` to `.`, and the space before the sections to `.`
  — `Shabbat 112b` → `/Shabbat.112b`, `Genesis 1:1-3` → `/Genesis.1.1-3`,
  `Guide for the Perplexed, Part 3 32` → `/Guide_for_the_Perplexed%2C_Part_3.32`
  (Sefaria's "Text References" page allows `_` for spaces in addresses; the
  rest is how its own pages write a reference; each was opened live, 200).
- **The record** (in `migrate()`, nothing dropped or moved): tables
  `passages(ref PRIMARY KEY, title, he, en, url, fetched_at)` (found by its
  reference or by its address, so `Shabbat.112b` finds `Shabbat 112b`; a
  reference is fetched once) and `walks(id, desk, question, start_ref, title,
  started_at, last_ask_id)`; columns `asks.walk_id`, `asks.ref`,
  `asks.took_ms` (both calls together) by `ALTER TABLE … ADD COLUMN`, null
  for every row before. A stop is its *teach* row: `parent_id` the previous
  stop, the answer the stop's JSON. A declined first stop writes the walk
  only.
- **Routes**: pages `GET /walks`, `GET /walks/<n>` (signed out: 303 to
  `/login`); data `GET /walks/list`, `POST /walks/start` `{ question } | {
  ref }`, `GET /walks/:id/stops`, `POST /walks/:id/step` `{ pick } | { text
  }` (signed out: 401). A failed stop answers `{ error, walk }`. Refusals
  name the valid values (the walks there are, the directions on offer).
- **What the study tool needs**: walks and stops are keyed by Sefaria's
  canonical references (`walks.start_ref`, `asks.ref`, `passages.ref`), and
  `/walks?ref=<reference>` (or `POST /walks/start { ref }`) starts a walk at
  a passage; the table of contents and the Daf Yomi calendar come from
  Sefaria's interface (its index and calendar calls), a reading position
  would be a small table of its own beside `walks`, and "start a walk here"
  sends the passage's reference to that address. The walk page shows a walk
  started at a passage with the passage as its title and no question.
- **Checks**: `scripts/walks-smoke.mjs` 48 (against a stand-in Sefaria,
  `scripts/mock-sefaria.mjs`, and the stand-in model's new `thought`
  answers: *choose* JSON, *teach* JSON with Sefaria citations, by turn),
  `scripts/walks-pages.mjs` 27 (28 screenshots); totals 718 server checks
  and 614 page checks. The team's checker found two faults in the first
  candidate, both fixed with a check each: a stop missing its reason, its
  transliteration or two explained directions was kept (now no stop: the
  failure line names what was missing, nothing recorded), and two moves at
  once on one walk (two tabs) chained both stops to the same parent (now
  one move at a time per walk: the second answers 409 and says to wait). Four older checks changed in wording only: the
  refusals now name `thought` and `walk` (`smoke.mjs`, `grow-smoke.mjs`), the
  seam's "neither names the stand-in desk" matches the word, not "standing"
  (`grow-smoke.mjs`), the navigation ends with Walks (`today-pages.mjs`,
  `lookup-pages.mjs`), and the known tables include `passages` and `walks`
  (`lookup-smoke.mjs`).

## hebrew-guide-one (22 Oct 2026, the rented Linux machine, OpenRig team): the guide on Fable 5.1, and a question-reading step that thinks

Dan, after his first live walk: the guide read his question shallowly. Two
causes: the guide model was Claude Opus 4.6, and the *choose* call (the one
that reads his move and picks the passage) had 600 tokens and no room to
think.

**Dan's screens changed.** A stop the guide chose a passage for now opens,
under "Stop N · …", with a quiet line: "Your question, as I read it: …",
one or two sentences in the guide's voice saying what it takes his move to
be asking. Stops saved before have no such line and draw as before; a stop
where the guide answers him itself (no passage) shows none; a walk begun at
a passage shows none on its first stop. A stop may take longer: up to
about four minutes before the failure line says the guide did not answer.

- **The guide model** (`lib/lookup.js`): `GUIDE_MODEL` defaults to
  `anthropic/claude-fable-5.1`; the environment override and the fallback
  to the card model on a missing model are unchanged. Today's passage, the
  lesson guide and its review, the verb-card check and the hunt guide use
  the same constant and move with it.
- **Room to think**: `chat` and `chatWithTools` take `reasoning`, sent as
  OpenRouter's `reasoning` request field (`{ max_tokens: N }`). OpenRouter's
  reasoning-tokens page: for Anthropic models the value is the thinking
  budget (at least 1024, at most 128,000), the request's `max_tokens`
  covers thinking and answer together and must be strictly higher than the
  budget, and the thinking comes back apart from `message.content` (in
  `message.reasoning` / `reasoning_details`), so reading the answer is
  unchanged. A call with `reasoning` sends no `temperature` (Anthropic's
  models take only their default while they think, and OpenRouter's page
  for Fable 5.1 does not list `temperature` among its request fields); a
  call without it sends `temperature: 0` and no `reasoning`, as before. A
  desk's limits (and its `choose`) may carry `reasoning`; `ask` passes the
  limits through unchanged. The `thought` desk: *choose* `{ 6000 tokens,
  150 s, reasoning 4000 }`, a stop (*teach*) `{ 9000 tokens, 240 s,
  reasoning 4000 }`. *Choose* keeps JSON mode (`json_object`) and *teach*
  the web search, each with reasoning. That combination could not be tried
  against the live route from the build machine, so (Dan's ask) a request
  with reasoning that OpenRouter refuses with 400 or 422 — but not "no such
  model", which keeps its own fallback — is logged in one line naming the
  model and OpenRouter's message, and made once more without reasoning, at
  temperature 0 as before. A walk then still gets its stop, without the
  room to think; the log line is the sign to look at.
- **The reading** (`lib/walks.js`): `CHOOSE_FORMAT` asks for `reading`
  first, then the passage, which must serve it. The reading of the choice
  that made the stop goes to *teach* in its instructions ("The stop must
  answer that reading"), never into the move Dan made, and is kept in the
  stop's JSON answer (`reading`): no schema change. `GET /walks/:id/stops`
  serves it on each stop (`""` when none). A reply carries none, even if
  the guide wrote one.
- **A time-out names its own limit**: the failure line for a *choose* that
  timed out named the stop's limit; it now names the limit of the call that
  was running.
- **Checks**: `walks-smoke.mjs` 69 (60 before), `walks-pages.mjs` 38 (34
  before); totals 739 server checks and 625 page checks. Seven older checks
  changed in their model id only (`smoke.mjs` four, `hunt-smoke.mjs`,
  `today-smoke.mjs`), and two walks checks in the desk's numbers.
