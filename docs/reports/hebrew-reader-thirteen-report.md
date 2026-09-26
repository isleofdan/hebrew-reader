# FIELD REPORT — hebrew-reader-thirteen — 26 Sep 2026

Session: cloud (`flyctl` not present). Brief: "START HERE — hebrew-reader-thirteen — 25 Sep 2026 (cloud)" on card `hebrew-satellite`. Pull request [isleofdan/hebrew-reader#2](https://github.com/isleofdan/hebrew-reader/pull/2) was merged on Dan's word, by the session. Deploy run 26 is green, including its live-site answer check.

## What stands

**Proven live by Dan (26 Sep 2026, deploy run 26, desktop Chrome and his Android phone):**
1. **26 Jan lesson:** the word list shows שוטטות · **noun**. Session twelve's one-time re-make is now seen live.
2. **The להמר card, opened:** "No layers yet", the full action row, and the footer "Born from Guy's lesson of 9 Feb 2026 · on 1 desk · 0 cards branched from it". The card was reached through Find, because on the desk it had been dragged below the visible area (see "What the brief got wrong", item 5).
3. **Find more examples:** 4 real sentences, all from ynet, each with its source and an arrow. "keep" on one gave "1 layer, oldest first" and "examples you kept · 1 of 4 found on 26 Sep".
4. **Ask here**, with "What is the difference between להמר and לסכן?": a substantive answer (להמר is intransitive and takes על; לסכן is transitive; it quoted Milog's example), with two links to Milog pages.
5. **The seven lookups:**
   - Morfix, Pealim, Wiktionary and Milog opened on the word.
   - The Academy connected, but loaded choppily.
   - **Kizur did not connect** (an error from the site itself).
   - **Sefaria** opened its search, which had **no entry** for להמר.
6. **Branch** from the kept example: a new note card holding the sentence, set under להמר on the phone list; the desk went from 3 to 4 cards.
7. **Find "המר":** under Threads, "להמר: word → 1 example kept → 1 question → looked up 11 times · 1 branch / last touched 26 Sep 2026 · on 1 desk". The 11 lookups mean some buttons were tapped more than once.
8. **The corner:** after "New desk", "Saturday 26 Sep · morning" appeared small, with its name, in the bottom-right corner; clicking it made that desk current again, with its 4 cards.

**Checked against the local stand-ins only.** 320 server checks (254 before, plus 66 in `scripts/grow-smoke.mjs`) and 324 page checks (276 before, plus 48 in `scripts/grow-pages.mjs`), phone and computer, light and dark. These cover:
- cutting (not tried live);
- the source and time chips (only "any time / everything" was seen live);
- Note here;
- the refusal of an answer with no cited link;
- the refusal of examples with no link or without the word;
- no duplicate urls on a second search;
- a confirmed card's entry and lock surviving layers and a cut;
- the two screen races found in review.

**Not seen, not verified:**
- **Which search engine the live calls used, and what one search costs.** The sandbox cannot read the live server's log or reach openrouter.ai. OpenRouter's docs, as seen through search results, say `auto` uses the provider's native search for Anthropic models where the endpoint offers it, otherwise Exa. That would make this app's calls use Anthropic's own search, at roughly $0.01 per search. With up to 3 searches, plus the model reading the results, one "Ask here" or "Find more examples" should cost about 5–10 US cents. This is an estimate, not a measurement.

## What the brief got wrong

1. **"The Ask box already treats a link-less answer as failed."** It does the opposite, and by design: session three decided that "there is none" is an answer, links or not (PLAN.md, session three close-out). The Ask box also never searched the web; it builds reference links from a term the model names. So it was not moved onto the new route. The link-required rule applies to answers on a card only (see ask 2).
2. **The reference link shapes, as understood in the chat:**
   - Morfix needs `/en/` (`https://www.morfix.co.il/en/{word}`).
   - Wiktionary's `/wiki/{word}` finds nothing for an inflected form such as להמר, so its search form is used.
   - The Academy's term database was reported offline, so its button runs the Academy's site search.
   - Kizur is a dictionary of abbreviations, so most words will find nothing there, and live it did not even connect.
   - Sefaria has no entry for a modern word like להמר.

   The sandbox could reach none of the seven sites; all shapes came from search-index evidence and are recorded in PLAN.md.
3. **"Wait up to a minute and a half" is not safe on this site.** A request that stays silent for about a minute may be dropped by the proxy in front of the app. Both web-search calls therefore stop at 55 seconds; their expected times are 33 and 45 seconds.
4. **"Prefixed and inflected forms count."** The app's matching knows the dictionary form, every form Dan has met, and any of those after one prefix, but not unseen conjugations (הם מהמרים is refused). The search is now told which forms count, so fewer found sentences are thrown away. Live it found 4 of up to 5.
5. **"Open https://hebrew-reader-dan.fly.dev/desk and open the להמר card."** On the desk that opened, להמר sat below the visible area, where it had been dragged during session twelve's check. The count at the top said 3 cards while 2 showed. Find reached it.

## Deliberate divergences

1. **The Ask box on the reader page is unchanged.** DO NOT REVERSE without a decision (ask 2): session three's rule stands there.
2. **Answers on a card keep only the links the web search cited** (`url_citation` annotations), never URLs the model wrote into its text. DO NOT REVERSE: this is what makes "an answer without a link is a failure" mean a real source.
3. **Unkept examples are not counted as layers.** "N layers" counts kept examples, answers, notes and lookups; found-but-unkept examples fold under "show the others".
4. **"Note on a new card" left the card's full view.** "Branch a new card from here" does the same from there. It stays on the desk card itself.
5. **The corner uses "worked on longest ago"** (the desk's last-touched time). Any change to a desk, not only opening it, counts as working on it.
6. **Threads list only a card that has grown something** (a layer, a branch or a cut), once per root card. A bare word card appears under Cards only.
7. **"Last touched"** is the brief's wording and stays on the Threads line, although "touch" is on Dan's list of words to avoid. It is excluded from the jargon check for that line only.
8. **Commits:** the server work (brief steps 1 and 3–8) went in one commit and the screens in another, not one commit per step, because the steps share one module.
9. **One session-twelve page check** waited for "On the desk" with a case-blind match, so it read "putting it on the desk…" too early and failed on a clean main. It now waits for the finished line.

## Dan's decisions this session

- Merge: approved. The first "yes" was refused by the session's safety check; the merge went through on his fuller instruction, "Merge pull request 2 into main now."
- Live-check steps 6–8 went ahead after Kizur and Sefaria gave nothing. Those are the sites' own results, not app failures, so the session judged they did not trigger the brief's "stop".

## What the next brief needs

- **For fourteen (ink, the reMarkable sheet, catching a card):**
  - A card is named by a key: `word:<id>`, `note:<id>`, `answer:<id>`, `example:<id>` or `lookup:<id>`.
  - Ink fits as its own table keyed by card key. It can be a layer through a `card_links` row of kind `layer`: its order under the card is the link's time, and a cut moves it like any layer.
  - Only word and note cards can be placed; a layer is refused a placement.
  - A sheet from an arrangement reads `placements` for a desk. Each card's layers come from `GET /card/:key`, which returns `layers`, `counts`, `footer` and `thread_line`.
  - A thread is computed from `card_links`, never stored.
- **Where writes go:** every write goes through `lib/desk.js`; model calls with web search go through `lookup.chat({ tools })` in `lib/grow.js`.
- **Seen live, not diagnosed:**
  - With Find's panel open behind an opened card, the desktop showed repeated "desk" / "This desk" fragments under the card as Dan scrolled. It looks like leftover drawing, not duplicated data (Find said "1 desk").
  - Two links on the same site both read "Milog · Milog". The page title would tell them apart.
- **Web-search engine and cost:** read them from the live log line `card word:<id>: answer layer …` and OpenRouter's activity page before the next brief quotes a price.

## Asks for the origin chat

1. **Kizur and Sefaria buttons:** Kizur did not connect, and Sefaria has no entry for a modern word. Keep them, replace them, or drop them? **Recommended:** drop Kizur, since an abbreviations dictionary rarely serves a word card. Keep Sefaria only if Dan wants classical sources.
2. **The Ask box on the reader page:** move it onto the web-search route, with its links from real searches, and keep session three's "no link is still an answer" rule there? **Recommended: yes.** Its links would come from real pages instead of search links the model names, while "there is none" stays a valid answer.
3. **Conjugated examples:** let the example gate accept any word sharing the card's root letters in order (a looser match), accepting a few wrong hits? **Recommended: no, not yet.** The strict gate plus telling the search which forms count gave 4 good sentences live. Revisit if searches come back thin.
4. **The fragments behind an opened card on the desktop:** fix them in fourteen as a small first step? **Recommended: yes.** It's a few lines, with a screenshot check.
