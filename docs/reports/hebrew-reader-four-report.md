# FIELD REPORT — hebrew-reader-four — 22 Sep 2026

Session: cloud, branch `claude/hebrew-satellite-brief-ot8uh7`, fast-forwarded
onto `main` twice on Dan's word. Deploy runs 9 and 10 green. Lessons from Guy
are in the app: upload a PDF, get the study guide and the flashcards made by
the שיעורי גיא instructions, and every single-word item saved on the map.
All six steps of the brief shipped, the reMarkable sheet included.

Checks against the local mocks: **94 server checks** (`npm run smoke`, from
69) and **132 page checks** (`npm run screenshots`, from 84).

## What stands

**Proven live by Dan on his phone, 22 Sep 2026:**

1. **Upload.** Guy's June 2026 PDF (`Daniel HEB 15jun26.pdf`) came in as
   "שיעור עם גיא — 15.6.2026 · 39 items. Title and date read from the file
   name." Dan: the items read correctly — right word order, one of Guy's lines
   per item. This was the one thing only a real PDF could prove.
2. **The guide.** Built by the real model with every section the
   instructions name: Lesson topics; six grammar topics in Guy's order, each
   with a note for Guy; תרגילי הטיה — Conjugation Drills (להסלים, and להקיז
   chosen for its nun-assimilating root — the Register's "irregular roots
   first" rule at work); עבודה על נייר — Thinking on Paper (two prompts,
   Register categories named); מילים מרכזיות — Core Vocabulary; שאלות הבנה —
   Comprehension Questions (seven); ביטויים חשובים — Key Expressions with ⚠️
   flags. 33 flashcards; one card the model invented was dropped as not in the
   lesson.
3. **Words onto the map.** Footer: "10 words saved · 27 phrases kept in the
   guide only · 2 could not be looked up (עדה, עדתי) · recorded on the spine"
   — 39, every item accounted for.
4. **Guy's words in reading.** In an article Dan pasted, all six lesson words
   (הממסד, לזנק, בחסות, במה, בלעדי, בדיה) showed amber.

**Deployed, proven by checks, not yet looked at by Dan:** the flashcards page
(nikud toggle, category filter, transliteration only on request, flip,
Previous/Next, Know it and Not yet only move on, Shuffle); the reMarkable sheet
(`sheet.html?lesson=`, drill answers gathered at the end); a tap on a lesson
word opening the reader's card; Rebuild guide replacing the guide whole.

**Fixed after Dan's first look (run 10):** the lesson page showed "Failed to
fetch" under Study guide. The guide had in fact built in the background; one
missed poll had stopped the page asking. Now a missed answer shows "Lost touch
with the server for a moment; trying again…" and asks again, and a build the
server lost to a restart is started again. Proven by a page check that drops
the connection once mid-build; not observed live.

Checks behind the rest: upload of each file-name pattern, the two-line PDF
refused naming the count, the wrapped sentence as one item, the guide built
once and served from the lesson after (no second model call), the 35-card cap,
rebuild replacing, one spine PUT per saved word and none for a phrase, a solid
word touched but left solid, the model refusing leaving the raw items and one
line.

## What the brief got wrong

1. **"The Professional Relevance section."** The filed instructions have no
   such section. The guide carries the sections the instructions do name.
2. **"part 1 of N".** The instructions came as one note holding five files,
   each marked `=== FILE: <name> ===`. Committed unchanged as
   `docs/guy-lessons/guy-lesson-instructions-2026-09-22.md` — the note's
   heading as an ASCII name, because a simulated image build tripped on the
   em dash and spaces.
3. **The image left out `docs/`.** `.dockerignore` excluded the whole folder,
   so the instructions would never have reached the live app. Now only
   `docs/screenshots` and `docs/reports` are left out.
4. **"see one of Guy's words tinted" in "one article".** Dan cannot know which
   of his articles holds a lesson word. The check became a paragraph to paste
   that holds six of them. The next brief's checks must hand Dan the material,
   never send him searching (Dan, 22 Sep: "How the fuck do I know which of the
   articles has one of those words?").
5. **"appears in the lesson sheet."** The existing sheet ("Make from recent
   reading") counts touches across articles only; a lesson word joins it once
   it is touched twice in articles. The lesson's own reMarkable sheet is the
   guide.
6. **The instructions contradict themselves in two places, and the brief did
   not say which wins:** Thinking on Paper "between Core Vocabulary and the
   Conjugation Drills", while the guide format puts the drills first — placed
   after the drills, before the vocabulary; and "Progress tracking: known
   marking" against the brief's no-scores rule — the brief won.

## Deliberate divergences — DO NOT REVERSE

- **The guide is built in the background and the page polls.** A real guide
  takes a minute or more; a request held that long is cut. The page also keeps
  asking through a dropped connection.
- **The server drops cards, vocabulary rows and expressions not found in the
  lesson's text** (nikud and punctuation ignored), and says how many. "The
  model is told not to add items" is not enough on its own; it added one on
  the first real lesson.
- **A spot that is only `new` (met, never marked) is saved `shaky`.** "On the
  map" is read as shaky or solid; those are touched and keep their status.
- **Lesson titles write the date as 15.6.2026.** An English month name inside
  a right-to-left title is reordered by the browser into "Jun 2026 15".
- **The instructions file is read on the first guide build, not at start,**
  so a missing file fails the guide with its reason, never the whole server.
- **The guide's answer may run to 32,000 tokens.** A cut-off answer is not
  JSON and would fail whole.
- **Skipped instruction lines** (cannot apply inside the app): the two output
  files and their names, `/mnt/user-data/outputs/`, "present to user", the
  vanilla-HTML file spec and the 15 KB size target, the `#f8fafc` background
  (the app's palette stays; category accents reuse its four line colors), and
  "known" marking.

## Dan's decisions this session

- "push to main", twice: the build (run 9) and the polling fix (run 10).

## What the next brief needs to contain

- Dan's Dropbox is out of reach until a credential exists (the two lines are
  below). Bulk import of the fifty PDFs needs it.
- A real guide exists to judge against the project's past outputs. First
  observation: the להסלים drill calls the verb intransitive, then drills it
  with an object (הממשלה ___ את המצב).
- Every check Dan does comes with the material in hand — text to paste, a
  link to tap — one step per message, in plain words.
- The test article from check 3 ("בדיקה של מילים מהשיעור") is in Dan's list;
  there is no delete button.
- The branch naming, the "push to main" step and the deploy workflow all held
  as the last briefs described them.

## Dropbox, in two lines

A read-only Dropbox app token would let the app list `/Hebrew/Guy Lessons/`
and import each PDF itself, which is what bulk import of the fifty lessons
needs. Dan would create a Dropbox app (read-only file access), generate its
long-lived refresh token and app key, and the session would store them as
repository secrets for the workflow to stage on Fly.

## Asks for the Personal Shipyard chat

1. **A delete button for articles and lessons?** Recommended: yes, one small
   step in session five. The test article is sitting in Dan's list now.
2. **Tint prefixed forms of a saved word (הממסד → והממסד)?** Recommended: yes,
   in session five. Lesson words are exact dictionary forms, and news text
   rarely uses them bare, so most of Guy's words will stay plain in articles
   until this is done.
3. **A retry for words the card could not identify (עדה, עדתי)?**
   Recommended: yes, a "try again" on the footer's list. It costs one model
   call per word and only happens when Dan taps it.
4. **Dropbox for bulk import.** [DAN GATE — an account setting] Recommended:
   yes, through a read-only Dropbox app scoped to reading files; session five
   walks Dan through creating it one step per message.
5. **Guide quality.** Recommended: judge the first real guide with Dan and
   change the in-app frame only where a fault is observed. The instructions
   stay as filed (the prompt boundary held since session three: one change per
   observed fault).

## Screenshots

`docs/screenshots/` — at 412×915 (`-phone`) and 1280×800 (`-desktop`):
`index-lesson-{light,dark}-*.png`, `lesson-{light,dark}-*.png`,
`lesson-card-*.png`, `cards-front-{light,dark}-*.png`,
`cards-back-{light,dark}-*.png`, `sheet-lesson-*.png`.
