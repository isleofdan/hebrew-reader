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
references, which are searched for the answer, and lists the pages the
answer leaned on; a lesson sheet gathers the words he keeps meeting. Lessons from his
tutor Guy come in as PDFs: the app makes the study guide and the flashcards
by Dan's own lesson instructions (`docs/guy-lessons/`) and saves each
single-word item to the map; each guide is checked against five rules and
reviewed by a second model call before it is saved: each of the review's
corrections is kept unless it breaks a rule the guide passed, and it also
corrects a wrong root or binyan on the lesson's word cards. A third, small
call then checks the lesson's verb cards alone. A lesson with no
guide builds one when it is first opened. Articles and lessons can
be deleted (saved words stay), and a saved word tints in its prefixed forms
too. The desk (`/desk`) lays word cards and typed note cards out freely and
finds them again; a card opened there grows layers under its entry: example
sentences found online that Dan keeps, questions asked on it with the answers
and the pages they leaned on, notes, and lookups in seven references. A new
card can be branched from any layer, or a card cut in two; Find shows each
card's thread. Since session fourteen Dan can draw on a card with a pen or
the mouse (ink, kept as a layer), link two cards with a sentence saying why
(a blue line), make a printable sheet for his reMarkable from a desk (with
writing prompts), and, with the site installed on his phone, share a line or
a link from another app onto tonight's desk. A scheduled article hunt is a
later session.

The Look up page (`/lookup`, "Look up" in the top navigation) takes one word,
typed or pasted, with or without nikud or a prefix, and shows its card (the
reader's own card for that word when there is one); the word is saved as one
of his at once, and the search is kept on the card. Under the card, seven
tabs open the references inside the page, never in a new tab, only when
tapped; each tap is kept on the card as a lookup. "Looked up" lists every word
looked up there, newest first, with tick boxes and "Put on a desk", which
puts the ticked words on tonight's desk, unplaced, as a line caught on the
phone lands. A card's "Look up in" row on the desk now opens the reference in
a pane under the row too. A site that lets itself be framed shows its own
page; one that does not is shown from a cleaned copy the reader fetches on
the tap and keeps seven days (`docs/REFERENCES.md` says which is which, and
why).

Every question is answered in one place, the ask surface (`lib/ask.js`,
since hebrew-ask-one): the reader's Ask box, "Ask here" on a desk card, and
"Ask about this root" on a word card. Each question goes to a desk
(`lib/ask-desks.js`; one so far, the Hebrew references), which searches
only its own sites, and the links under an answer are the pages that search
cited. Every answer kept is recorded, and "Ask more" asks a follow-up with
the earlier questions and answers given first. "Ask about this root" opens a
pane under the card's buttons, on every page with a word card: the root in
Hebrew, Pealim and Wiktionary as two tabs shown inside the pane, and a
question box with "Ask". Nothing loads until he taps a tab or "Ask", and the
card's buttons stay where they were when the pane opens and closes.

The Today page (`/today`, "Today" in the top navigation) brings his material
back to him, phone first, one item at a time: each day a set of ten, made by
the server at 05:00 Tokyo time so the page opens at once. Eight are his own
words that are due — lesson words from Guy first, the least recently seen
first, then words from articles, then one solid word coming due — each drilled
by its weakness: give the form of a verb in a sentence he read, pick the
preposition a word takes, pick the right spelling, or "Do you know it" with
"I had it" / "I missed it". Two are fresh passages the model writes around his
shaky words, with one question each. A right answer brings the word back after
1, then 3, 7, 14 and 30 days; three right answers on three different days make
a shaky word solid; a wrong one brings it back tomorrow and makes it shaky.
Each answer shows the word and when it is next due, with Undo. A set not
finished stays until it is; nothing reminds him or counts days.

He can do as many sets a day as he likes: a finished set ends on "Done" with
the results and an "Another set" button, which makes a new set and opens it
at item 1. A new set never repeats a word from a set still unfinished, and it
never runs dry: when the words due are used up it draws on his shaky words
not yet due, then his solid ones, earliest due first, and its note says so
("Nothing more is due; this set draws on words not yet due."). On the phone
the answer choices stand one under another, each fully readable.

The Walks page (`/walks`, "Walks" in the top navigation) is a guide to
Jewish thought, for self-understanding: Dan writes a question in his own
words and presses Start, and the guide — one voice from inside the
tradition, with a stance — chooses one primary passage as the first stop.
Each stop shows the passage in Hebrew, its transliteration and its English
(fetched from Sefaria, never written by the model), "Full passage" on
sefaria.org, why it is the stop, what it says plainly with every name and
term explained, where the tradition argues with itself (with the Sefaria
pages cited), and the guide's own opinion; then two or three directions
for the next stop and a box to push back or ask. Each walk is kept and
reopens from the record at once. Israel, antisemitism and current politics
are declined in one line. `/walks?ref=<reference>` starts a walk at a
passage (the door for a later study tool).

## Running it

```
npm install
APP_PASSWORD=... COOKIE_SECRET=... OPENROUTER_API_KEY=... node server.js
```

Open http://localhost:8080. See `PLAN.md` for the decisions, the data model,
the environment variables, and how the app talks to the spine.

## Layout

- `server.js` — one plain Node server: the passphrase gate, the JSON routes, static files.
- `lib/` — database, auth, rate limit, article extraction, the word card (OpenRouter), the spine client, the category list, the demand, the ask surface (`ask.js`) and its desks (`ask-desks.js`) and reference list, the lesson sheet, the lesson guide and its rule checks (`guide-checks.js`), the desk and a card's layers (`desk.js`), the two web-search calls that grow a card (`grow.js`), the sheet's writing prompts (`sheet.js`), a caught link's title (`catch.js`), the Look up page (`lookup-page.js`), a reference shown inside the reader (`reference-pages.js`), Today's daily drills (`today.js`), and the walks with the guide to Jewish thought (`walks.js`) with their passages from Sefaria (`sefaria.js`).
- `public/` — the pages: `index.html` (articles + add form), `today.html` (Today's drills), `walks.html` (the walks page and one walk, `/walks` and `/walks/<id>`, drawn by `walks.js`), `lookup.html` (the Look up page; `reference-ui.js` is the reference pane it shares with the desk), `read.html?id=…` (the reader), `phone.html` (the demand and quick lookup), `sheet.html` (the print sheet; `?lesson=` for a lesson's guide), `lesson.html?id=…` (a lesson from Guy and its study guide), `cards.html?lesson=…` (its flashcards), `login.html`; `card-ui.js` is the card shared by the reader, the lesson page and the phone page, with `ask-ui.js` its ask pane, `guide-ui.js` the study guide shared by the lesson page and its print sheet; `desk.html` the desk, with `grow-ui.js` for a card's layers and `ink-ui.js` for drawing; `desk-sheet.html` the sheet for the reMarkable; `manifest.webmanifest`, `sw.js` and `install.js` make the site installable with a share target.
- `scripts/import-lessons.js` — bulk import of Guy's PDFs from a folder into the site (see `PLAN.md`).
- `scripts/` — local checks: smoke test, screenshots, mock servers for OpenRouter, the spine, the reference sites and Sefaria; sample lesson PDFs in `scripts/fixtures/`, made by `make-fixtures.mjs`.
- `docs/` — screenshots and session reports.

Deploys go through the GitHub Actions workflow in `.github/workflows/deploy.yml`, never from a session.
