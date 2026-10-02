# About Hebrew reader
Written 2 Oct 2026 by a Claude Code session from the files in this folder; "Unknown" means the files did not say.

## What it is
A private website for one reader, Dan, who reads Israeli news and business Hebrew at an advanced level. He pastes an article or gives its web address, and the page shows it right to left with the words he is unsure of tinted; tapping a word opens a card with its dictionary form, root, meaning and grammar notes. It also turns PDF lessons from his tutor Guy into study guides and flashcards, has a short practice page for his Android phone, and has a "desk" page where word cards and note cards can be laid out, grown, drawn on and printed as a sheet for his reMarkable (an e-paper writing tablet). It opens in a web browser on a computer or phone, first at a sign-in page that asks for a passphrase.

## What it plugs into (in and out)
In:
- Articles: pasted text, or a web address whose page the app goes and fetches itself.
- Lesson files (PDFs) from Guy, chosen with an upload button, or sent in bulk from a folder by a small program run on a computer (`scripts/import-lessons.js`).
- Lines or links shared from another app on Dan's phone, once the site is installed on the phone (a "share target").
- The title of a shared web link, fetched from that page.
- Answers from OpenRouter, a paid service that passes requests on to AI models (mainly Anthropic's Claude), which also runs web searches for example sentences and for questions asked on a card.

Out:
- Requests to OpenRouter (the AI service above) for each word card, study guide, question and search.
- Each change to a word's status is also written to "the spine", another of Dan's own websites (spine-dan.fly.dev) that keeps the record of these marks, using a private access key (`SPINE_TOKEN`); without that key the marks stay only in this app. Whether the key is set on the live site is Unknown (the deploy instructions set it only if it is supplied).
- Links on each card that open seven online Hebrew references (Morfix, Pealim, Milog, Wiktionary, the Hebrew Academy, Kizur, Sefaria) in Dan's browser.

## How it is built
It is one program written in the programming language JavaScript and run by Node (the engine that runs JavaScript outside a browser), plus a set of plain web pages it hands to the browser. Everything it keeps (articles, word cards, lessons, desks, ink) lives in one database file (a single file where it keeps its records in tables, SQLite) called `reader.db`, stored on a rented storage disk (a "volume") attached to the computer it runs on. The code is kept on GitHub, the website where Dan's code is stored. A change goes live by itself whenever it is added to the main copy of the code (a "push to main"), or when someone starts the publishing steps by hand on GitHub; those steps (`.github/workflows/deploy.yml`) package the program, put it on the rented computer, and then check the live site answers. The files do not say it was copied from a starting kit.

## Where it runs and how to tell it is alive
It runs on one small always-on computer in Tokyo rented from Fly.io, a company that rents out computers to run websites, at https://hebrew-reader-dan.fly.dev. To check it, open https://hebrew-reader-dan.fly.dev ; a page headed "Hebrew reader" with a "Sign in" button means it is up. Its health address, a page kept only for checking that it runs, is https://hebrew-reader-dan.fly.dev/health, which shows `{"ok":true,"configured":true}` when it is running with its passphrase in place. Checked 2 Oct 2026: the main address sent the visitor to its sign-in page, and the health address answered that it was up and set up.

## Which hand-off route it is on
Dan builds.

## Which assistants can reach it
None found in the files. The app has no door for an AI assistant of its own (no MCP, the plug-in connection Claude chats use); every page and data address sits behind the passphrase. The files show only that it writes word marks to the spine, and PLAN.md notes the spine has its own MCP door; the files do not say which assistants use that.
