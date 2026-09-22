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
