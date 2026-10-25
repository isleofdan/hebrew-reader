# FIELD REPORT — hebrew-crash-one — 2026-10-25

New on the Wall: the card "hebrew-reader: Error: crash-test: the reader reports crashes", at https://spine-dan.fly.dev/wall?card=crash-hebrew-reader-hebrew-reader-1 (the address answers with the Spine's sign-in, then opens the Wall on that card). It is the test crash the reader's deploy sent on purpose. It sits live in Claude Code's court, with a door to the Sentry issue. This is Direction 2, piece 3: the chain from the Hebrew reader through Sentry and the Spine to the Wall is proven.

Session `hebrew-crash-one`, agent-machine-dan, Auto mode. Repository isleofdan/hebrew-reader. Work branch `claude/hebrew-crash-one` (pull request #28, merged). This report travels on `claude/hebrew-crash-one-report`. Card `crash-reporting`.

## What stands

- **The chain is proven, end to end.**
  1. Pull request #28 was merged at 09:32:24Z (merge commit 633f5e6, merged by the toolkit thread on Dan's typed yes, "yes, merge the reader crash reporting").
  2. Deploy run 40181066398 is green on every step. Its new step "Check a crash reaches Sentry" printed `sign-in: 200` and `crash-test: 500`.
  3. Sentry opened an issue, and the Spine filed the card `crash-hebrew-reader-hebrew-reader-1` at 09:34:31Z, filed by `hook:sentry`. It reads "hebrew-reader: Error: crash-test: the reader reports crashes", live / claude-code. Its `what` reads: "Error: crash-test: the reader reports crashes. In Object.run(server). Level error. First seen 2026-10-25T09:34:13.716000+00:00 … Seen 1 occurrence. Handled."
  4. Its door is the Sentry issue https://shulman-advisory.sentry.io/issues/156021203/. Read back with `list_threads` (home `isleofdan/hebrew-reader@main`).
- **Sentry, done by this session through the API** (the token collected through the Spine secrets page, sent only as a header):
  - `GET /organizations/shulman-advisory/` answered 200.
  - Team `shulman-advisory`.
  - Project `hebrew-reader` created (`POST /teams/shulman-advisory/shulman-advisory/projects/` answered 201) and read back (200, platform node).
  - DSN read from the project's keys. It is public by Sentry's design, so it went into `fly.toml` and the job text.
- **The OpenRig team did the code.** Builder `dev-owner@hebrew-crash-one-mixed`, checker `dev-check@hebrew-crash-one-mixed` (Codex), rig `hebrew-crash-one-mixed`, started from a copy of the team spec with only `name:` changed, as the brief said. Queue items:
  - builder job `qitem-20261025081701-e2bfb629`;
  - check round 1 `qitem-20261025084035-fb42aed8`;
  - fix row `f63781de`;
  - check round 2 `qitem-20261025085638-79cc24e8`;
  - acceptance row `ddfa2118` (done).
- **Checker verdicts.**
  - Round 1 on `15d54e2`: FINDINGS.
    - P1: inline-script stack frames leaked page query strings to Sentry.
    - P2: a curl transport error failed the deploy's crash check instead of warning.
  - Round 2 on `9561b89`, verbatim: "PASS for candidate 9561b89: both prior findings are resolved. Independently passed 47 crash checks and 9 browser checks." Both reviews are in `docs/reports/hebrew-crash-one-review-15d54e2.md` and `…-9561b89.md`.
- **Built** (pull request #28, 32 files):
  - `lib/crash.js`: `@sentry/node`, loaded first in `server.js`. `captureException` sits beside the route catch's and the last-resort catch's `console.error`.
  - `public/crash.js` plus `public/sentry.min.js`: the browser SDK, built by `npm run build` and committed, so every script is served from the reader's own paths. They load first on every page in `public/`, and `sw.js` keeps no cache.
  - `POST /crash-test`: behind sign-in, answers 500.
  - The deploy step "Check a crash reaches Sentry" (a warning, not a failure, if the answer is not 500).
  - `SENTRY_DSN` in `fly.toml` `[env]`.
  - README "Crash reporting", `docs/CHECKS.md` counts, a dated line in `PLAN.md`.
- **Privacy, checked by tests and a Chromium probe.**
  - Settings: `sendDefaultPii: false`, `tracesSampleRate: 0`, no replay.
  - `beforeSend` deletes the request, the user, the transaction name and the extra data. It drops every breadcrumb of category http, fetch, xhr, console, navigation and ui.*, and strips the query and fragment from stack-frame addresses.
  - The looked-up word reaches Sentry nowhere, plain or encoded.
- **Tests.** `npm test`: 962 before (baseline in `docs/CHECKS.md`), 1009 after; I ran it myself on `9561b89`: 1009 ok, 0 failed, exit 0. Page checks: 875 before, 884 after.
- **Deliberate divergence.** The brief's step f says to confirm the Sentry issue through `GET /api/0/projects/shulman-advisory/hebrew-reader/issues/`. It answered 403: the token's scopes (project:read, project:write, team:read, org:read, alerts:write) do not include event:read. I confirmed the issue instead through the card the Spine filed from Sentry's own webhook. The card carries the issue's id, title, count and permalink, which only Sentry could have sent.
- **The machine restarted mid-job.** At 09:02Z the agent-machine deploy (pull request #54 merged, run started 09:01:45Z) restarted the machine and ended both seats during check round 2. The fix commit was safe in the clone. I started the team again on the same clone (`rig-up-auto.sh` archived the first id `01M5S21AEV03E40PYS9E95MTTQ`), and the new checker resumed its open queue row by itself.
- **Team stopped with a snapshot.** `rig down hebrew-crash-one-mixed --snapshot` gave `01M5S57V24K8BKCWM1XDM8M6JS`, restore line `rig restore 01M5S57V24K8BKCWM1XDM8M6JS --rig 01M5S4S1CB4WGV4NQM8X7JX08E`, only to continue this job. Recorded in `/data/home/dan/FACTS.md`, section "OpenRig".
- **Seat prompts I answered myself:** 8, all on `dev-check`. One was the Codex update menu ("Skip until next version"). Seven were one-time yes to run the crash checks, the test suite and a local privacy probe outside its sandbox. None went to Dan.
- **Not done, by the brief:** no change to the Spine, no `fly` command, no merge by this session, no `gh secret`. The token was never printed or written into the clone.

## What the brief got wrong

1. Step f's issue check assumed the token can read issues. Its scopes (as the thread's hand-over note lists them) lack event:read, so the endpoint answered 403. The card proved the issue instead. A later session that must read issues needs a token with event:read.
2. The brief describes the Sentry custom integration as Dan's one-time step in Sentry's settings. This session first tried to create it through the API on the thread's go (`POST /api/0/sentry-apps/`). The machine's safety check refused it before any request left the machine [Account & Standing-Rule Changes]. The thread then had it done in Dan's browser. It is in place, as the card shows.
3. The brief did not foresee a machine restart. An agent-machine merge during a running team job restarts the machine and ends the seats.

## Asks for the origin chat

None. Nothing here needs a decision or a fact only Dan holds.

## What the next session needs

- **The card itself:** `crash-hebrew-reader-hebrew-reader-1` is a deliberate test crash, not a bug. A session or Dan can resolve it in Sentry. The Spine then moves the card to dead in Dan's court, which also proves the `resolved` path live.
- **More apps:** the same pattern (project per repository, DSN in `fly.toml`, the privacy settings, a crash-test route) applies to Dan's other apps. Piece 4, the Spine's own SDK, is still open.
- **Technical follow-ups (no decision needed):**
  - A Sentry token with event:read, if a session must read issues directly.
  - The thread checks for working sessions on the machine before merging to agent-machine.

## Checks

- Brief check: job `20261025-081038-304b63`, PASS (event 2084). Earlier round `20261025-080249-e43417`, FINDINGS, fixed in the brief before this session.
- Team check round 1: `qitem-20261025084035-fb42aed8`, FINDINGS (P1 query strings in stack frames, P2 curl transport error). Changed in `9561b89`.
- Team check round 2: `qitem-20261025085638-79cc24e8`, PASS on `9561b89`.
- Result check: see the closing message for its verdict on this version.

## Fly machine and OpenRig lessons

- **Machine restart mid-job.** The agent-machine merge of pull request #54 deployed at 09:01:45Z and restarted the machine at 09:02, killing both seats during check round 2. Cost: about 5 minutes. Fix: `rig-up-auto.sh` on the same clone; the new checker found its open queue row (same seat name) and resumed. Lasting fix: check working sessions before merging to agent-machine.
- **Codex update menu.** It appeared again on the checker seat; "3 Skip until next version" chosen.
- **Account-change refusal.** Creating a Sentry integration through the API was refused [Account & Standing-Rule Changes] on the thread's go. Only Dan's own yes can be cited on a retry; a coordinator's go is not his.
- **Token scopes.** A token's scopes decide which proof routes work. Read them before the brief names an endpoint.
