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
| `OPENROUTER_API_KEY` | the word card |
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
is committed unchanged at `docs/guy-lessons/`. `lib/guy-lesson-prompt.js`
reads every note in that folder at start, splits it on its
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
| `## [Grammar Topic N]` + "non-technical explanation suitable for sharing with Guy" | `sections[kind=grammar]`: `topic`, `explanation`, `examples[{he,en}]`, `for_guy` | one section per topic, Guy's order |
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
