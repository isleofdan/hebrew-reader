# Hebrew reader

A personal web app for one reader, Dan, who reads Israeli news and business
Hebrew at an advanced level and wants the words he is shaky on to show
themselves while he reads.

He pastes or links an article; the page shows it right-to-left in a serif
face, with words tinted by how they stand on his "map" (never met, shaky,
solid). Tapping or hovering a word opens a card: the dictionary form with its nikud, root, binyan, form, meaning,
what preposition it governs, and which of his weakness categories it touches.
Saving or marking a word records a "spot" on the map. Every card opened is a
"touch" on that spot.

It runs on a desktop screen and on an Android phone. A phone page (`/phone`)
hands him a sentence from something he has read with the verb blanked and
asks for the form; an Ask box in the reader sends a question to the
references (Pealim, Milog, Morfix, Wiktionary, the Academy) and links each
claim; a lesson sheet gathers the words he keeps meeting. Lessons from his
tutor Guy come in as PDFs: the app makes the study guide and the flashcards
by Dan's own lesson instructions (`docs/guy-lessons/`) and saves each
single-word item to the map; each guide is checked against five rules and
reviewed by a second model call before it is saved, and that review also
corrects a wrong root or binyan on the lesson's word cards. A lesson with no
guide builds one when it is first opened. Articles and lessons can
be deleted (saved words stay), and a saved word tints in its prefixed forms
too. A scheduled article hunt is a later session.

## Running it

```
npm install
APP_PASSWORD=... COOKIE_SECRET=... OPENROUTER_API_KEY=... node server.js
```

Open http://localhost:8080. See `PLAN.md` for the decisions, the data model,
the environment variables, and how the app talks to the spine.

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes, static files.
- `lib/` — database, auth, rate limit, article extraction, the word card (OpenRouter), the spine client, the category list, the demand, the ask surface and its reference list, the lesson sheet, the lesson guide and its rule checks (`guide-checks.js`).
- `public/` — the pages: `index.html` (articles + add form), `read.html?id=…` (the reader), `phone.html` (the demand and quick lookup), `sheet.html` (the print sheet; `?lesson=` for a lesson's guide), `lesson.html?id=…` (a lesson from Guy and its study guide), `cards.html?lesson=…` (its flashcards), `login.html`; `card-ui.js` is the card shared by the reader, the lesson page and the phone page, `guide-ui.js` the study guide shared by the lesson page and its print sheet.
- `scripts/import-lessons.js` — bulk import of Guy's PDFs from a folder into the site (see `PLAN.md`).
- `scripts/` — local checks: smoke test, screenshots, mock servers for OpenRouter and the spine; sample lesson PDFs in `scripts/fixtures/`, made by `make-fixtures.mjs`.
- `docs/` — screenshots and session reports.

Deploys go through the GitHub Actions workflow in `.github/workflows/deploy.yml`, never from a session.
