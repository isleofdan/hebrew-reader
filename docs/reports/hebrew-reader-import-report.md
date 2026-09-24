# FIELD REPORT — hebrew-reader-import — 24 Sep 2026

Session: laptop (Windows, `flyctl` and Node 24 present). Brief: the note "START HERE — hebrew-reader-import — v2 — 24 Sep 2026 (laptop)" on card `hebrew-satellite`. No code changed, nothing deployed, `main` untouched. The close-out note and this report are on branch `claude/hebrew-reader-import`, built on session ten's branch (`claude/hebrew-reader-ten-wr59vn`) so that PLAN.md stays in order.

## What stands

**Proven live, from the import script's own output on the live site:**
- Folder: `C:\Users\shulm\Dropbox\Hebrew\Guy Lessons`, the only folder with that name. It holds 58 files, 51 of them PDFs.
- **44 imported, 0 failed.** 14 skipped, each with its reason:
  - `Daniel HEB 15jun26.pdf`: already on the site. No second copy was made.
  - 6 PDFs not named as Guy's: `1 -`, `2 -`, `3 -` and the unnumbered `StreetWiseHebrew400Draftforchecking - Sheet1.pdf`, `BOR(1).pdf`, `Editer un RIB - Crédit Agricole d'Ille et Vilaine.pdf`.
  - 7 non-PDFs: `24hours3132022.jpg`, `BOR(1).jpg`, `galeria27122023.jpg`, `maslul1422022.png`, `Screenshot_20220323-055702_Brave.jpg`, `StreetWiseHebrew400Draftforchecking.xlsx`, `מסעדה.png`.
- The confirming dry run shows 45 already on the site and 0 to add. The site holds 45 lessons.
- **2026 guides: 7 built, 0 failed**, one at a time, 282–595 s each. That is the 6 lessons dated 2026, plus the July 2025 lesson, which was dated wrongly (see below). All 8 lessons dated 2026 or later now have a guide, June included (not rebuilt).

**Read from the live site through its own pages' data (GET only):**
- "Checks not passed:" lines: **0 on the 7 new guides.** June keeps its earlier drill line from before this session.
- "Verb cards checked: N, corrected: M" across the 8 lessons dated 2026 or later: **N = 17, M = 2.** Both corrections are one word, להמר (9 Feb): root מ.ר.ר → ה.מ.ר, and Hif'il → Pi'el.
- "Not changed — the two checks disagree": **2, both in the 26 Jan lesson.** לשוטט and שוטטות: the review says Pi'el, the verb check says Polel.
- June: "Not changed — you confirmed this card: לזנק" is still there.
- The review's "verdicts missing" count came back empty on every lesson. The lesson API does not return it, or it is unset. Unknown, not zero.

**Proven live by Dan (24 Sep 2026):**
- Check 1: lesson 45 (9 Feb 2026) shows a full guide with "Verb cards checked: 6, corrected: 2". Dan: "seems about right".
- Check 2: lesson 27 (27 Dec 2023) showed "being built". The guide was then built in 512 s, and Dan confirmed "it's there". The site's log says it was saved with the drill check unmet (first pass failed drill and flags; one rebuild; drill still unmet), so the page carries a "Checks not passed" line about the drill.

## What the brief got wrong

1. **The repo needed `npm ci` before the script would run.** A fresh clone has no `better-sqlite3`, and the script loads it through `lib/guy-lesson.js`. The first run failed with "Cannot find module". The next laptop brief should list `npm ci` as a step.
2. **"The June lesson… would be imported again rather than skipped"** did not happen. It was skipped by file name. But the brief missed a different date problem: `Daniel Guy hebrew 08july25.pdf` has the word "hebrew" between "Daniel Guy" and the date. `nameAndDate` misses the pattern, so the lesson took the upload day, **2026-09-24**. The dry run shows this as "no date in the name". Because of the wrong date, it fell inside `--build-guides-from 2026-01-01` and got a guide now: 7 builds, not 6.
3. **Session five's report and session ten's PLAN note and report are not on `main`.** The brief said to read them there. They live on `claude/hebrew-satellite-brief-n91kia` and `claude/hebrew-reader-ten-wr59vn`. Session ten's PLAN.md note is not on `main` either.
4. **"Run it in the background … check the log until it exits"** doesn't fit the passphrase rule: the passphrase exists only in Dan's own window. The run went in the foreground of Dan's PowerShell with `Tee-Object` to `%USERPROFILE%\.hebrew-import\`, and the session read that log.
5. **The laptop sleeps on battery after 3 minutes.** The first real run died with "fetch failed" after 3 guides. Windows logged "entering sleep" at 22:03 local time, with the laptop on battery. The site finished the 4th guide by itself, and a re-run built the last 3. Future laptop briefs with long runs: charger in.

## Deliberate divergences

1. The passphrase was typed into Dan's own PowerShell window (masked `Read-Host` into `$env:APP_PASSWORD`), not into the chat. The session never saw it, and it is in no file. DO NOT REVERSE.
2. Section 9's page counts were read by a small read-only script (`%USERPROFILE%\.hebrew-import\check.js`, outside the repo), which Dan ran in his logged-in window. It sends GET requests only. A direct read of the live database over `flyctl ssh` was refused by the session's safety check.
3. The mis-dated July 2025 lesson was left as is (brief: no hand-fixing).

## What the next brief needs to contain

- **The July 2025 date.** Either `nameAndDate` tolerates a word between "Daniel Guy" and the date (for example "Daniel Guy hebrew 08july25"), plus a one-time step to re-date lesson 39 to 2025-07-08; or the date is fixed by hand. Right now it sorts as the newest lesson.
- **Polel versus Pi'el.** The review and the verb check name the same pattern differently (לשוטט, שוטטות, root ש.ו.ט). So the agreement rule reads them as a disagreement. Treating Polel as Pi'el-family when comparing would turn these into agreement. Also, שוטטות is a noun and should not be on the verb-card list.
- **The "verdicts missing" count** is not visible through the lesson API. If the lesson page is to show it (session ten, ask 2, answered yes), the data must reach the page.
- 36 lessons from 2022–2025 have no guide yet (37 minus lesson 27, now built). Each builds, 10–20 minutes, the first time Dan opens it.

## Asks for the origin chat

1. Fix the July 2025 lesson's date in code (the name pattern plus a one-time re-date), in the next cloud session? Recommended: yes. It is small, and it belongs with the session that touches `lib/guy-lesson.js`.
2. Treat Polel (and Polal and Hitpolel) as the Pi'el family when the two checks are compared? Recommended: yes, on the comparison only. The card keeps whichever name it has. Without this, every hollow-root verb in the doubled pattern will show as "not changed — disagree".
3. Keep verb-card checks off nouns such as שוטטות? Recommended: yes, and look at why a noun reached the verb list in the same session.
