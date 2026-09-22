# FIELD REPORT — hebrew-reader-three — 22 Sep 2026

Session: cloud, branch `claude/peaceful-babbage-bb1t53`, fast-forwarded onto
`main` twice on Dan's word. Deploy runs 6 and 7 green. Three fixes from Dan's
live use, all three now confirmed by Dan on his own phone against the live
site.

Checks against the local mocks: **69 server checks** (`npm run smoke`, from 60)
and **84 page checks** (`npm run screenshots`, from 40).

## What stands

**1. The Ask box treats an answer as an answer. PROVEN LIVE.** Dan asked
"Tell me all the Nif'al verbs in the article" on a piece whose mapped words
held none. The page drew: "There are no Nif'al verbs among the mapped words
in this article. מחבל is a noun (root ח.ב.ל) …", with three Milog links and
no failure line. That is the exact case that failed on 22 Sep.

Two things caused the old behavior, both server-side:

- the ask prompt told the model to answer `{"error": …}` when a question
  "cannot be answered", and the model read "there is no Nif'al here" as
  exactly that;
- `lookup.chat()` threw away any reply that was not JSON.

Now the prompt says that "there is none" IS the answer, with `links: []`, and
reserves `{"error"}` for declining to answer at all. Any reply carrying an
answer renders as the answer, links or not. The failure line is left for the
model being unreachable, timing out, declining, or answering nothing usable,
and it names which. `chat()` gained `textFallback`, used only by the ask
surface; the card and the demand translation still refuse anything but JSON,
so no card is ever built from prose.

Checks behind it: four server checks (`an answer with nothing to link is an
answer, not a failure`; `a plain-text reply is the answer`; `the model
declining is the failure line and it says declined`; `an unreachable model …
names unreachable`) and three page checks at both viewports.

**2. A light ground and a dark one, with a switch. PROVEN LIVE, after a second
round.** The palette is stated once at the top of `public/app.css` — a light
set and a dark set under the same names — and nothing below it names a color.
Device is the default and writes nothing; Light and Dark write `data-theme` on
`<html>` and are remembered per browser; every `localStorage` call is wrapped.
`public/theme.js` loads in `<head>`, so the ground is chosen before the first
paint.

Dan's first look found the switch apparently dead: with **Light** selected his
phone showed a dark page. Reproduced here with a browser told to darken web
contents — it repaints the light ground to `rgb(36,35,31)` and leaves the dark
ground (`rgb(20,19,14)`) untouched, so all three positions look the same.
Computed style never shows this; only a painted pixel does, which is how it was
caught. The light ground now declares `only light`. Dan's second look, after
deploy run 7: **"Light works now."**

Contrast, measured from what the browser painted: text on each ground 15.1:1
(dark) and 15.2:1 (light); the word text over the shaky tint 6.2:1 dark, 12.6
light; over the met tint 8.7:1 dark, 13.0 light; chip text on the tint 6.2:1
dark; the Check fill's text 8.7:1 dark. Tint against tint and tint against
ground, as perceived difference (CIEDE2000), is wider on the dark ground than
on the light one Dan already reads: shaky/met 36.6 against 28.1, shaky/ground
28.0 against 16.5, met/ground 22.3 against 11.4.

**3. Headline words behave exactly like body words. PROVEN LIVE** — Dan: "3 is
working correctly now." The reader draws the headline with the routine that
draws a paragraph (`fillWords`), so a headline word has the same span markup,
tint, card and touch as a body word, and its sentence is the headline
(`sentenceSpan` stops at a line break). `articles.asRead()` — the headline as
the first line, then the text — is how `lib/demand.js` and `lib/ask.js` now
read a piece.

Checks behind it: five server checks, including that the demand cuts the same
sentence the reader did (the second touch costs no model call, proving the
card cache matched), and six page checks including a headline card open, amber
after save, still amber after reload, and the headline word on the map.

## What the brief got wrong

1. **The Ask defect was not in the client.** The brief said to "find the branch
   in the client (and server, if it errors there)". `public/ask.js` was already
   drawing `data.answer` and had a line for the no-link case; the fault was
   entirely server-side, in the prompt and in the JSON-only gate.
2. **Declaring a dark theme was expected to stop the phone browser forcing
   dark. Half right.** The page did open light. But narrowing `color-scheme` to
   `light` — which the Light position did — invites the repaint back, so the
   switch looked broken until `only light` shipped. A page cannot overrule a
   browser set to darken every site; that is a device setting.
3. **Baseline counts were right this time**: 60 and 40, as the brief carried.
4. The brief's "expected, not proven, until Dan looks" was the correct posture
   and is why the fault surfaced within minutes instead of sitting in the app.

## Deliberate divergences — DO NOT REVERSE

- **`asRead()` lives in `lib/articles.js`, not in the demand,** and the ask
  surface uses it too. The brief scoped the headline change to `lib/demand.js`;
  leaving `lib/ask.js` reading the body alone would mean a headline word on the
  map is invisible to a question about the piece. One reading of a piece, used
  everywhere.
- **The login page also declares `only light`,** not just the print sheet the
  brief named. It is one form on one ground; the same reasoning applies.
- **The palette's colors are stated once** as `--light-*` / `--dark-*`, with
  three short blocks mapping one set onto the names the app uses. Two mapping
  blocks repeat; no hex value does.
- **Contrast is measured, not asserted.** `npm run screenshots` reads the colors
  the browser actually painted — WCAG for text on its ground, CIEDE2000 for one
  tint against another, since amber and blue differ by hue rather than by
  lightness, and a luminance ratio is the wrong instrument there.
- **`/ask` answers now carry `links_state`** (`ok` / `no data`) beside `state`,
  so a later surface can tell "answered with nothing to look up" from
  "answered with references" without counting the array.

## Asks for the Personal Shipyard chat

1. **Dan's browser setting.** Chrome on his phone is set to darken web pages
   itself. The app now has its own dark theme and a switch, so that setting only
   fights it. *Recommended answer: turn it off, walked through one step at a
   time in a later session; nothing in the app changes either way.* [DAN GATE]
2. **Should Device stay the default?** A phone whose browser darkens everything
   will still show our light design under Device when the phone itself is light.
   *Recommended answer: yes, Device stays the default; Dark is one tap and is
   remembered.*
3. **Is a headline-only verb fair game for the phone page's practice sentence?**
   It now is: the demand can draw a headline as the sentence. *Recommended
   answer: yes, leave it — a headline is a sentence Dan read.*
4. **Should the reader say anything near the switch about a browser that
   overrides it?** *Recommended answer: no. Pull-only means no explanations
   bolted to the chrome; this report is where that belongs.*
5. **Prompt changes this session were confined to the ask.** The card prompt and
   the demand translation prompt are untouched, as the brief required.
   *Recommended answer: keep that boundary — one prompt changed per observed
   fault, never per case.*

## Screenshots

`docs/screenshots/`, each at `-desktop` (1280×800) and `-phone` (412×915):

- `reader-dark-*`, `reader-light-*` — the reader on both grounds
- `phone-dark-*`, `phone-light-*` — the phone page on both grounds
- `reader-headline-*` — a card opened from a headline word
- `reader-ask-no-links-*` — an answer with nothing to link, drawn as an answer
- `reader-ask-*`, `reader-card-*`, `reader-marked-*`, `index-*`,
  `index-thin-*`, `phone-gap-*`, `phone-check-*`, `phone-show-*`, `sheet-*`,
  `login-*` — the surfaces that already stood, re-captured

## What could not be reached from the sandbox

OpenRouter, the spine and Fly, as before: checks run against the mocks in
`scripts/`, and the live proof is the deploy run log plus Dan's look. Both
deploy runs are green and Dan has confirmed all three fixes on the live site.
