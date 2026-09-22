# FIELD REPORT — hebrew-reader-one — 22 Sep 2026

For the Personal Shipyard chat, from the Claude Code cloud session that built the first Hebrew reader.

## What stands

The reader is live at https://hebrew-reader-dan.fly.dev, behind Dan's passphrase, and Dan has used it: an article pasted, the card opened with a root and a meaning, one word saved to vocab, and the card footer said "recorded on the spine". The spine confirms it: `list_marks app=hebrew-reader` shows `w:שיקום` (root ש.ק.מ, status shaky, one touch, last article "עזה כפסע מקטסטרופה").

Built, all eight steps of the brief, in `isleofdan/hebrew-reader` on `main`:

1. **Skeleton.** README, PLAN (decisions, the spine finding, close-out note), gitignore, package.json.
2. **Server and gate.** One plain Node server. `POST /login` sets a signed 30-day cookie; every other route needs it; five wrong passphrases from one address lock it for 15 minutes; with `APP_PASSWORD` or `COOKIE_SECRET` unset only the login page serves and says the server is not configured.
3. **Data model.** SQLite via better-sqlite3 at `DATA_DIR/reader.db`: `articles`, `cards` (the model's answers, keyed by a hash of surface + sentence, plus the derived `spot_id`), `spots`, `touches`.
4. **Add an article.** `POST /articles` with pasted `text` (first short line becomes the headline) or a `url` (Readability + jsdom; under 200 characters of main text keeps the raw page text and flags `thin`).
5. **Reader page.** Right-to-left in Frank Ruhl Libre, UI in Assistant. Client-side tokenizer keeps maqaf, gershayim and hyphen-joined words whole; each word is a span. Tints from `GET /marks-for-article/:id`: shaky amber, met-not-marked light blue, solid and unknown plain. Legend in the top bar; a right column lists this piece's words that are on the map. Index page lists articles newest first with the add form.
6. **The card.** Hover on desktop, tap on phone. OpenRouter, model `anthropic/claude-sonnet-4.6` (one constant in `lib/lookup.js`), JSON only, cached. Shows meaning, lemma, root, binyan, tense, person/gender/number, what it governs, category chips, a note, status and touch count. Buttons: Save to vocab, Mark solid, Ask about this root (Pealim + Hebrew Wiktionary in new tabs). A card the model cannot build is refused in one line; nothing invented. Category list lives alone in `lib/categories.js`.
7. **Marks to the spine.** Wired. On every status change: `PUT https://spine-dan.fly.dev/api/marks/hebrew-reader/<spot id>` with `{ status, last_seen_at, fields: { root, binyan, lemma, categories, last_article_title, touches } }` behind `SPINE_TOKEN`. Failures never block the local write; the card footer says "recorded on the spine", "saved here; spine unreachable" or "saved here; spine not configured".
8. **Deploy.** `fly.toml` (app `hebrew-reader-dan`, nrt, 512 MB, always on, volume `reader_data` at `/data`), Dockerfile, and `.github/workflows/deploy.yml` on push to `main` or by hand. Run 1 created the app, the volume and three secrets and deployed; run 2 (by hand, after Dan added `SPINE_TOKEN` as a repository secret) staged that secret and redeployed. Both green, with the live check passing (health says configured, `/articles` answers 401 without a cookie).

Checks in the sandbox: 25 server checks (`npm run smoke`) and 14 browser checks (`npm run screenshots`) pass against local stand-ins for OpenRouter and the spine. Screenshots at phone 412×915 and desktop 1280×800 are in `docs/screenshots/` (login, index, reader with the card open, reader after a save).

Secrets, by name only. Repository: `FLY_API_TOKEN`, `APP_PASSWORD`, `OPENROUTER_API_KEY`, `SPINE_TOKEN`. On Fly: the last three plus a generated `COOKIE_SECRET`.

## What the brief got wrong (carry into the next brief)

1. **"Work on main."** The cloud runner binds a session to its own branch (`claude/hebrew-satellite-brief-v5bwp0` here) and forbids pushing elsewhere without Dan's word. GitHub also registers a manually-runnable workflow only once the file is on the default branch, so a deploy cannot be run from a side branch at all. The next brief should say: build on the session's branch, then ask Dan for "push to main" as a named step, or have Dan merge.
2. **"Add one real article by URL."** The sandbox reaches neither Israeli news sites, nor OpenRouter, nor the spine, nor Fly. Article-by-URL was proven against a local page standing in for a news site; the card against a mock model; the spine against a mock enforcing its key rules. All four were then proven live by the deploy log and Dan's look. A cloud brief should expect this and name the mocks as the check.
3. **"SPINE_TOKEN — Dan will add it as a Fly secret later."** The workflow reads it from a repository secret and stages it on Fly itself, so what Dan adds is a GitHub repository secret, not a Fly one. The token's value lives only in Dan's password manager (the spine's own notes say so), and Fly cannot show it back.
4. **Verify 3 names נאלצה.** Dan's first real article did not contain it; the live proof used שיקום. The mock proves the Nif'al case (root א.ל.צ, binyan nifal) in the sandbox.

## Deliberate divergences — DO NOT REVERSE

- **Branch, then fast-forward to main.** All eight steps were committed on the session branch and `main` was fast-forwarded to the same commit on Dan's word. Same history, no merge commit.
- **Tint meaning.** The brief says "never-touched = light blue". A word never met has no spot and shows plain; light blue marks a spot that exists with status `new` (met through a card, not yet marked). This is what "an article with no marks shows every word plain" requires.
- **`last_seen_at` is also sent to the spine** alongside the brief's `fields`; it is one of the spine's allowed top-level keys and costs nothing.
- **`COOKIE_INSECURE=1`, `LOGIN_WINDOW_MS`, `OPENROUTER_URL`, `SPINE_URL`** exist as environment overrides only so the local checks can run; production sets none of them.
- **A build-tools layer in the Dockerfile** (python3, make, g++) as the fallback if a better-sqlite3 prebuild is ever missing; the image is 172 MB.

## Dan's decisions this session

- "Push to main." (22 Sep 2026, in the session.) Main is the deploy branch from here on.
- `SPINE_TOKEN` added as a repository secret by Dan; the redeploy picked it up.
- Dan's live look: login, article, card, save, "recorded on the spine" — all three of his checks passed.

## What the next brief needs to contain

- The reader exists and deploys on push to `main`. Session two touches `server.js`, `lib/`, `public/`; nothing in `fly.toml` or the workflow needs to change for new pages.
- The spine sync is done; session two need not "wire it if session one could not".
- The spot id derivation is in `lib/lookup.js` (`spotFor`); the tokenizer in `public/tokenize.js` is shared by the page and the checks; the category list in `lib/categories.js`.
- Local check commands: `npm run smoke`, `npm run screenshots`. Both start their own mocks and servers on ports 8790–8797.
- The branch rule above (item 1 under "what the brief got wrong").

## Asks, numbered, each with a recommended answer

1. **Touches on the spine.** Today only status changes reach the spine; a card opened without a save is a touch known only to the reader. Should every touch also update the mark (`touches` and `last_seen_at`) on the spine? Recommended: yes, in session two, as a single `PUT` per lookup on spots that already have a mark there; it is one call and keeps the spine's `touches` count true.
2. **Card quality on real words.** The model's answers are Dan's to judge over a few days of reading; the prompt is one string in `lib/lookup.js`. Recommended: collect three or four wrong cards before changing the prompt, then change it once.
3. **Article by URL from Israeli sites.** Proven only against a local page; some sites block scrapers or serve their text through scripts. Recommended: Dan tries one Ynet and one Globes address; if either comes back "thin", session two adds a site-specific fallback for that one site rather than a general one.
4. **Prefixed forms as separate surfaces.** "שנאלצה" and "נאלצה" are two surfaces today and tint independently, though they map to one spot. Recommended: leave it; the map is by spot, and a later tokenizer pass can strip prefixes once the card data shows which prefixes matter.

## Screenshots

- Phone, reader with the card open: `docs/screenshots/reader-card-phone.png`
- Desktop, reader with the card open: `docs/screenshots/reader-card-desktop.png`
- Phone and desktop index: `docs/screenshots/index-phone.png`, `docs/screenshots/index-desktop.png`
- After a save (amber tint): `docs/screenshots/reader-marked-phone.png`, `docs/screenshots/reader-marked-desktop.png`
