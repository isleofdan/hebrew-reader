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
