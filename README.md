# Hebrew reader

A personal web app for one reader, Dan, who reads Israeli news and business
Hebrew at an advanced level and wants the words he is shaky on to show
themselves while he reads.

He pastes or links an article; the page shows it right-to-left in a serif
face, with words tinted by how they stand on his "map" (never met, shaky,
solid). Tapping or hovering a word opens a card: root, binyan, form, meaning,
what preposition it governs, and which of his weakness categories it touches.
Saving or marking a word records a "spot" on the map. Every card opened is a
"touch" on that spot.

It runs on a desktop screen and on an Android phone. A phone page (`/phone`)
hands him a sentence from something he has read with the verb blanked and
asks for the form; an Ask box in the reader sends a question to the
references (Pealim, Milog, Morfix, Wiktionary, the Academy) and links each
claim; a lesson sheet gathers the words he keeps meeting. A scheduled
article hunt is a later session.

## Running it

```
npm install
APP_PASSWORD=... COOKIE_SECRET=... OPENROUTER_API_KEY=... node server.js
```

Open http://localhost:8080. See `PLAN.md` for the decisions, the data model,
the environment variables, and how the app talks to the spine.

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes, static files.
- `lib/` — database, auth, rate limit, article extraction, the word card (OpenRouter), the spine client, the category list, the demand, the ask surface and its reference list, the lesson sheet.
- `public/` — the pages: `index.html` (articles + add form), `read.html?id=…` (the reader), `phone.html` (the demand and quick lookup), `sheet.html` (the print sheet), `login.html`; `card-ui.js` is the card shared by the reader and the phone page.
- `scripts/` — local checks: smoke test, screenshots, mock servers for OpenRouter and the spine.
- `docs/` — screenshots and session reports.

Deploys go through the GitHub Actions workflow in `.github/workflows/deploy.yml`, never from a session.
