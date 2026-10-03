# FIELD REPORT — hebrew-reader-fourteen — 28 Sep 2026

Session: cloud (`flyctl` not present). Brief: "START HERE — hebrew-reader-fourteen — 26 Sep 2026 (cloud)" on card `hebrew-satellite`. Two pull requests, each merged by the session on Dan's "yes":
- [isleofdan/hebrew-reader#3](https://github.com/isleofdan/hebrew-reader/pull/3), the session's work: deploy run 27, green.
- [isleofdan/hebrew-reader#4](https://github.com/isleofdan/hebrew-reader/pull/4): the sheet opens in a new tab, as Dan asked during the live check. Deploy run 28, green.

## What stands

**Proven live by Dan (27–28 Sep 2026, his Android phone and his computer):**
1. **Installing the app on the phone.** The first try said "This app cannot be installed", with a grey "F" icon. That tab (the Articles page) had been opened before the deploy. With `/desk` freshly loaded, the green א icon showed; it installed and opened.
2. **Sharing a line from another app.** The app opened with "Saved to tonight's desk, unplaced. Put it somewhere when you're at the computer.", the line first in the list.
   - Dan shared from the reader's own Articles page, so Chrome's share carried that page's address twice: once plain, once with the selected words coded into it (`#:~:text=`). The app saved it as sent. See ask 2.
3. **Sharing a link** (`https://www.ynet.co.il/economy`). After reopening, the page's title showed under the link.
4. **No stray fragments.** להמר, opened from Find with the panel open, then scrolled: nothing around the card, and the panel not drawn behind it. The strip read "6 cards (2 out of view)".
5. **Ink.** "Draw here" on להמר, a squiggle drawn with the mouse, a reload: the layer "note · ink · 27 Sep 2026" held the squiggle, with "undo last stroke".
6. **Dan's own link.** "Link these": להמר, then the ynet note branched from it in thirteen, then the sentence "the word, and a real sentence where it bets on sport". A blue line appeared with the sentence beside it, and the group was counted.
7. **The sheet.** Three pages: "From the desk of Saturday 26 Sep · morning · sheet 1 of 3".
   - Page 1: להמר in nikud, its kept example and its answer, the ink drawn small, "you linked these: …", then "Write" with four prompts.
   - Page 2: the group continues, marked "(continued)".
   - Page 3: "Cards on their own", with two prompts on הסלמה.
   - Every page carries the footer line. Dan printed it to PDF.
   - After #4: the sheet opens in a new tab and the desk stays put; "← Back to the desk" closes the tab; the strip reads "sent to the reMarkable 2 times, last 28 Sep 2026".

**Checked against the local stand-ins only.** 401 server checks (320 before, plus 81 in `scripts/paper-smoke.mjs`) and 377 page checks (324 before, plus 53 in `scripts/paper-pages.mjs`), phone and computer, light and dark, the sheet as printed. These cover:
- undo and the pen's eraser;
- ink carried by a cut;
- the phone showing ink with no drawing controls;
- a link's line going when one card leaves the desk and coming back with it;
- Find's thread line "· linked to <word>: <sentence>";
- a prompt naming a word not on the sheet being refused (לנדוד), and the false-rejection case (הימרתי accepted);
- "bring every card into view";
- the two-links-one-site labels (a page title, else "Milog 1 · Milog 2");
- a share from another website asking before it saves;
- a signed-out share coming back after sign-in;
- the title fetch refusing private and internal addresses.

**Not seen live:** "bring every card into view" was offered but not pressed; the answer-link labels; a pen with pressure (only the mouse was used).

## What the brief got wrong

1. **"Thirteen's report and close-out are on `main`."** The close-out note was, but the report was only on thirteen's branch. It was brought over as its own commit.
2. **Section 6(a): can the server print to PDF?** No. The Fly image is Node alone: the page-check browser (Playwright) is a development dependency and never reaches the image. So the sheet is a page made to print, with "Print this page to PDF, then send it to the reMarkable".
3. **The sheet's 3:4 page.** The page asks for the reMarkable's size (`@page` 702×936 px), but Dan's print came out US Letter, with the browser's own header and footer (date, title, address). The print window's settings win over what the page asks for. Letter is close to 3:4 and reads fine. See ask 3.
4. **"Install the app to the home screen."** Chrome offers the install only on a page loaded after the deploy; a tab opened before it shows a grey "F" and refuses. The next brief's live step should say "open the page fresh first".

## Deliberate divergences

1. **Ink strokes are keyed by the ink layer (`ink:<id>`), not by the card key.** A cut moves the ink layer's link, and the strokes go with it. Keyed by card, a cut would have left them behind. DO NOT REVERSE.
2. **A share from a link on another website goes to `/share/confirm`,** which shows it and saves it only on a tap. The phone's own share sheet saves at once. A plain link elsewhere could otherwise have put cards on Dan's desk and made the server fetch any address. DO NOT REVERSE.
3. **The title fetch refuses private and internal addresses at every redirect** (loopback, private ranges, link-local, Fly's internal network). DO NOT REVERSE.
4. **Signed out, a share goes through sign-in and comes back**; only `/share…` is accepted as the address to come back to.
5. **Undoing the last stroke of ink that a card was branched from keeps the empty ink layer,** so the branch keeps its place in the thread. Otherwise an empty ink layer goes.
6. **Cards on their own share one group, "Cards on their own", at the end of the sheet,** rather than a page each.
7. **The sheet opens in a new tab** (Dan's word during the live check), and "Back to the desk" closes it.
8. **"Saved to tonight's desk…" stays until the next message** instead of fading after 5 seconds.
9. **"Draw here" sits after "Find more examples"**, leaving thirteen's action order as it was. It shows only on a computer, on a card with no ink yet; after that, the newest ink layer itself takes strokes.
10. **The review fixes:** a second agent reviewed the change and found six real problems, all fixed before the merge. They were items 2, 3 and 5 above, plus:
    - Hebrew or bare-domain links losing their title, or being written twice;
    - a quick undo overtaking the stroke before it;
    - a signed-out share being lost.
11. **Commits:** one for the server (brief steps 1–5), one for the screens, then fixes, not one per step, because the steps share `lib/desk.js`.

## Dan's decisions this session

- **Merges:** #3 and #4, each approved with a plain "yes", which the safety check accepted this time.
- **The sheet opens in a new tab:** asked for by Dan during the live check, built and merged (#4).
- **The phone check went first,** before the computer checks.

## What the next brief needs

- **Live-step wording:** open a page fresh before installing the app; untick "Headers and footers" in the print window (see ask 3).
- **Still open from thirteen:**
  - Thirteen's ask 1 (the Kizur and Sefaria buttons) is Dan's call.
  - The reader page's Ask box moving onto the web-search route is fifteen's.
  - The web search's engine and cost are still unmeasured: read them from the live log and OpenRouter's activity page before quoting a price.
- **Where things live:**
  - A card's `GET /card/:key` now answers `ink`, `linked` and `footer.sheets`.
  - `GET /desks/:id` answers `groups` and `sheets { count, last, line }`.
  - Dan's links are `card_links` rows of kind `linked` with a `sentence`.
  - Sheets are records of their own, made only on the button.
- **The one-way rule holds:** nothing comes back from paper; the desk records only that a sheet was made.
- **Voice** needs nothing built: the phone keyboard's microphone types into "New card".
- **Test switch:** `CATCH_ALLOW_PRIVATE=1` exists only for the local checks; never set it on Fly.

## Asks for the origin chat

1. **Empty note cards on the sheet.** They print as a bare "note" label. Leave them off the sheet? **Recommended: yes**, a few lines in fifteen.
2. **Chrome's doubled link in a shared line.** When Chrome shares selected text, it adds the page address with the selection coded into it (`#:~:text=…`), next to the plain address. Keep one plain address? **Recommended: yes**, in fifteen, keeping the selected text itself.
3. **The sheet's paper size.** Dan's print came out US Letter, with the browser's header and footer. Add one line on the sheet page, "In the print window, choose no headers and footers"? **Recommended: yes** (text only). Keep Letter as acceptable: it is close to the reMarkable's 3:4.
4. **"Bring every card into view" was not pressed live.** Leave it to be proven in use? **Recommended: yes.** It is covered by a page check, and a wrong move can be dragged back.
