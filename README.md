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

It runs on a desktop screen and on an Android phone. It is the first of
several surfaces; later sessions add an ask surface (dictionaries), a
scheduled article hunt, and a phone drill.

## Running it

```
npm install
APP_PASSWORD=... COOKIE_SECRET=... OPENROUTER_API_KEY=... node server.js
```

Open http://localhost:8080. See `PLAN.md` for the decisions, the data model,
the environment variables, and how the app talks to the spine.

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes, static files.
- `lib/` — database, auth, rate limit, article extraction, the word card (OpenRouter), the spine client, the category list.
- `public/` — the pages: `index.html` (articles + add form), `read.html?id=…` (the reader), `login.html`.
- `scripts/` — local checks: smoke test, screenshots, mock servers for OpenRouter and the spine.
- `docs/` — screenshots and session reports.

Deploys go through the GitHub Actions workflow in `.github/workflows/deploy.yml`, never from a session.
