# Where the article hunt attaches — map for session B

Written by hebrew-adopt-kit (3 Oct 2026) from `main` at `4170412`. No code
was changed to write it. UNKNOWN means the files did not say.

## (a) How an article is fetched and loaded from a web address

- **Route:** `POST /articles` in `server.js` (about line 205), body `{ url }`
  or `{ text }`. With a url it calls `articles.fromUrl(url)`; with text,
  `articles.fromText(text)`. It then stores the article (`db.addArticle`),
  logs `article <id>: "<title>" (<n> chars, thin?, from <url>)` and answers
  `201` with the stored row plus `thin`.
- **Fetch:** `fetchHtml(url)` in `lib/articles.js`. It uses plain `fetch`
  with a desktop Chrome user-agent, `accept-language: he-IL`, follows
  redirects, times out after 20 s and refuses pages over 5 MB. A failure
  becomes a `502` saying "… Paste the text instead." The same function is
  reused by `lib/catch.js` for a shared link's title. It is **not** routed
  through `lib/upstream.js`: the reader has no such file.
- **Extraction:** `fromUrl(url)`, also in `lib/articles.js`, runs jsdom
  plus Mozilla Readability. The title comes from Readability, else
  `og:title`, else `<title>`.
- **The thin flag is decided in two places:**
  - At import, `fromUrl` marks an article thin when Readability's text is
    under `MIN_CHARS` = 200 characters. It then keeps the raw page text
    instead, with script, style, nav, header and footer removed.
  - When listing, `db.listArticles()` (`lib/db.js`) works thin out again
    from the stored text length (`THIN_CHARS` = 200). There is no `thin`
    column.
  - The Articles page shows "thin — the page gave little text; paste the
    article instead".
- **Sites tried.**
  - hebrew-reader-one's report (22 Sep 2026, ask 3) recommended that Dan
    try one Ynet and one Globes address.
  - Session thirteen's web search found example sentences on ynet; that
    is a different path, through OpenRouter's web search.
  - Session fourteen proved a shared ynet link (`https://www.ynet.co.il/economy`)
    gets its **title** through `lib/catch.js`.
  - **Whether a Ynet or Globes article loaded through `POST /articles`,
    thin or not: UNKNOWN.** No report or close-out note records the result.
- **What the hunt needs that is missing:** there is no list of sites, no
  feed reader and nothing that finds articles. Today an article exists
  only when Dan pastes it or gives its address.

## (b) How a lesson sheet is made from a loaded article today

- **There is no lesson made from one article.** The "Lesson sheet" is
  `lib/lesson.js` `build(n)`. It is served by `GET /make/lesson?articles=N` (a
  Markdown download, or `&format=json` for `public/sheet.html`).
- **What goes into it:** every spot touched two or more times
  (`MIN_TOUCHES`) across the N most recent articles (default 5, max 50).
  The spots are grouped as Nif'al, then other binyanim, then not verbs.
  It reads only the local `touches` and `spots` tables
  (`db.recentArticles`, `db.touchesAcross`).
- **It needs no model call.** It needs Dan to have opened cards: a fresh
  article nobody has read adds nothing to the sheet.
- **Model calls elsewhere** all go through OpenRouter, by `lib/lookup.js`
  `chat()` (`OPENROUTER_URL`, key `OPENROUTER_API_KEY`):
  - The word card uses `anthropic/claude-sonnet-4.6` (`MODEL`), cached by
    surface plus sentence. A model that is not found retries once with
    `MODEL`.
  - Guy's study guides use `GUIDE_MODEL`, default
    `anthropic/claude-opus-4.6`, from `lib/guy-lesson.js`. That is the
    only "lesson" built by a model, and it is built from a PDF, not from
    an article.
  - The desk sheet's prompts use `lib/sheet.js`.
  - Web searches use `lib/grow.js`.
- **So "makes the lesson from it" in the hunt's goal is not something the
  reader can do today.** Session B's brief has to say what that lesson is.
  It could be the existing sheet over recent reading, which stays empty
  until Dan reads. Or it could be a new model-built sheet from one article,
  which would be a new feature.

## (c) Where Dan's word marks are read from

- **They are not read from the spine.** The reader's own SQLite table
  `spots` (`lib/db.js`; statuses `new`, `shaky`, `solid`) is "the map".
  `lib/spine.js` only **writes** to the spine:
  - `recordMark` and `recordTouch` send a `PUT` to
    `/api/marks/hebrew-reader/<spot id>` with the bearer `SPINE_TOKEN`.
  - Nothing in `lib/` or `server.js` issues `GET /api/marks`.
- **Screen words:**
  - "Save to vocab" makes a word shaky.
  - "Mark solid" makes it solid.
  - "Looked up" is a word opened but not marked (`new`).
  - The tints are shaky = amber, new = light blue, solid = plain.
- **A local run with no spine token:**
  - Marks stay local and the log says "spine: SPINE_TOKEN is unset; marks
    stay local until it is set." Everything else works.
  - **But a local run has none of Dan's words:** they are in `reader.db`
    on the Fly volume (`/data/reader.db`), which a session cannot reach
    (`fly` is refused).
  - The spine holds a copy of every marked spot, with root, binyan, lemma
    and touches. Reading it would need `SPINE_TOKEN`, which this machine
    does not have: UNKNOWN whether it is set anywhere here.
  - A hunt that judges "suitable" by Dan's words therefore has two
    choices. It can run on the live site, inside the server, where the
    `spots` table is. Or it can read the spine with a token.
- **This machine's OpenRouter key:** `bash -lc 'test -n "$OPENROUTER_API_KEY"'`
  printed nothing on 3 Oct 2026. The key is meant to load in login shells
  (agent-machine-one), but it did not, so a local run cannot call a model
  as things stand. The local checks use `scripts/mock-openrouter.mjs` and
  need no key.

## (d) Where a loaded article is stored and how past articles are listed

- **Stored in** the `articles(id, title, source_url, text, added_at)`
  table in `DATA_DIR/reader.db`, by `db.addArticle`.
  - There is no column for where an article came from (pasted, linked or
    found) and no column for thin.
  - A hunted article would need a new column added by
    `ALTER TABLE … ADD COLUMN`, never by rebuilding the table.
- **Listed by** `GET /articles` → `db.listArticles()`: newest first, with
  `{id, title, source_url, added_at, chars, thin}` and `state: 'no data'`
  when empty.
  - The Articles page (`public/index.html`, `public/index.js`) shows them.
  - "Read" opens `read.html?id=…`.
  - "Delete" removes the article (`DELETE /articles/:id`); saved words
    stay.
- **Opened by** `GET /articles/:id` → `db.getArticle`.

## (e) What the screens call these things

| Thing | Words on the screen |
| - | - |
| The list of articles | "Articles"; empty: "No articles yet. Add one above." |
| Adding one | "Add an article", "Address of the article", "Or paste the text (first line becomes the headline)", "Add" |
| A poor fetch | "thin — the page gave little text; paste the article instead" |
| Opening one | "Read" |
| A word opened, not marked | "Looked up" |
| Marking | "Save to vocab" (shaky), "Mark solid", "Shaky" |
| The words of one piece | "Your words in this piece"; empty: "You haven't looked up or saved a word from this piece yet." |
| Tint legend | "Solid and new words have no color." |
| The sheet over recent reading | "Lesson sheet", "Make from recent reading" |
| Lessons from Guy | "Lessons from Guy", "Add a lesson (PDF)" |
| A lesson word Dan already had | "… you already had, counted as seen again" (`public/lesson.js`, a lesson from Guy) |

Older text still uses words Dan rejects: README.md has "map", "never met"
and "touch". The screens listed above do not use them.
