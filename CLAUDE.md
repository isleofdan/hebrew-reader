# Rules for every Claude Code session on the Hebrew reader

Read `README.md` and `PLAN.md` before changing anything. The reader came
before `isleofdan/starting-kit` (the kit was copied from it); its checks and
the rules below were adopted from the kit's `main` by hebrew-adopt-kit
(3 Oct 2026). Checks: `docs/CHECKS.md`.

## What an agent may and may not touch

Claude Code enforces these from `.claude/settings.json` (`permissions`);
this section says the same in words, with why. The line between them is
the cost of a wrong move: who sees it, and what it costs to undo. The
reader has a real user (Dan) and records he would miss (`reader.db` on
Fly, his marks on the spine), so the kit's rules are narrowed as below.

- **May, without asking:** edit files in the app, run the checks (`npm
  test`, `npm run …`, `node …`), commit, push its own branch, open a pull
  request, read pull requests and workflow runs. A wrong move here is seen
  by nobody until a pull request, and is undone by another commit. (A
  pushed branch does not deploy: Deploy runs on a push to `main`, which is
  refused below, or by hand.)
- **Asks Dan one yes/no first:** merging a pull request (`gh pr merge`; a
  merge into `main` deploys the live site), starting a workflow (`gh
  workflow run`, which includes Deploy), and any direct GitHub request
  (`gh api`). For reading runs and pull requests, use `gh run view` and
  `gh pr view`, which need no asking.
- **Never, from its own shell:**
  - `fly` / `flyctl`: deploying and anything that costs money run only
    through the Deploy workflow, after Dan's yes. This also keeps
    `reader.db` on Fly out of a session's reach.
  - `sqlite3`: no hand-run database command, on any copy of `reader.db`.
    A table holding Dan's data is never dropped or rebuilt: new fields go
    in by `ALTER TABLE … ADD COLUMN` and back-fill, in `lib/db.js`.
  - `scripts/import-lessons.js`: it uploads Guy's lessons to the live site
    with the passphrase; Dan runs it himself, from his computer.
  - `npm publish`: nothing of Dan's is published.
  - Pushing to `main`: push your own branch and open a pull request.
  - Deleting a branch, here or on GitHub: leave it; Dan deletes branches.
  - `gh secret`, `gh variable`, `gh repo edit`/`delete`/`rename`/`archive`:
    repository secrets and settings are Dan's; ask him, naming the setting
    and the value.
- **This rule file itself** is a protected path in Claude Code: an agent
  cannot change `.claude/settings.json` without a prompt, and any change
  reaches `main` only through a pull request Dan says yes to.

These rules stop the commands an agent normally types, not every way of
spelling them. They bound mistakes; they are not a lock against someone
determined.

## Do not reverse

- **Records.** Never drop and recreate a table that holds Dan's data, and
  never move rows to a new one.
- **The volume's mount path** (`/data`, `fly.toml`) never changes.
- **Marks are the map, the spine is the record** (`PLAN.md`): a spine
  failure never blocks the local write.
