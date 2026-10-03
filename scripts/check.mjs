// Every check, in order, stopping at the first failure, ending with one
// line that names what failed. Uses only what Node ships with.
//   npm run check              syntax, tests, screenshots (the full run)
//   npm run check -- --fast    syntax and the fast tests only (a few seconds)
//   node scripts/check.mjs --hook
// The reader's tests: `npm test` runs all three smoke scripts (about 37 s
// here); --fast and --hook run `npm run test:fast` (grow and paper, about
// 4 s), because scripts/smoke.mjs alone takes about 33 s, past the hook's
// 30 s. The full run and the Checks workflow run them all.
//       the fast checks, as Claude Code's after-every-edit hook runs them
//       (.claude/settings.json): silent when they pass; when one fails,
//       its output goes to stderr and the exit code is 2, which is how a
//       PostToolUse hook shows a failure to the session.
// Screenshots need Playwright's browser. Where it is missing (some
// machines) they are skipped and the verdict says so; in GitHub Actions
// (CI set) a missing browser is a failure.
import { spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hook = process.argv.includes('--hook');
const fast = hook || process.argv.includes('--fast');

// Edits made side by side fire the hook side by side; the tests start a
// server on a fixed port, so a second run would fail for no real reason.
// While one run holds the lock, another skips quietly.
let lock;
if (hook) {
  lock = join(tmpdir(), `kit-check-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.lock`);
  try { if (Date.now() - statSync(lock).mtimeMs > 120000) unlinkSync(lock); } catch {}
  try { closeSync(openSync(lock, 'wx')); } catch { process.exit(0); }
  process.on('exit', () => { try { unlinkSync(lock); } catch {} });
}

const say = (line) => (hook ? process.stderr : process.stdout).write(line + '\n');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: process.env });

function jsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFiles(path));
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const checks = [
  {
    name: 'syntax',
    run() {
      const bad = [];
      for (const file of jsFiles(root)) {
        const r = run(process.execPath, ['--check', file]);
        if (r.status !== 0) bad.push({ file: relative(root, file), error: r.stderr.trim() });
      }
      if (!bad.length) return { ok: true };
      return { ok: false, output: bad.map((b) => b.error).join('\n\n'), detail: `does not parse: ${bad.map((b) => b.file).join(', ')}` };
    },
  },
  {
    name: 'tests',
    run() {
      const r = fast ? run('npm', ['run', 'test:fast', '--silent']) : run('npm', ['test', '--silent']);
      const output = r.stdout + r.stderr;
      if (r.status === 0) return { ok: true };
      // Node's own reporter marks a failed test "✖ <name>" (or "not ok N - <name>");
      // the reader's smoke scripts print "FAIL <name> — <detail>".
      const failed = [...new Set([...output.matchAll(/^\s*(?:✖|not ok \d+ -|FAIL) (.+?)(?: \(\d[\d.]*ms\))?$/gm)].map((m) => m[1]))]
        .filter((name) => !/^failing tests:?$/.test(name));
      return { ok: false, output, detail: failed.length ? `failed: ${failed.join('; ')}` : `${fast ? 'npm run test:fast' : 'npm test'} exited ${r.status}` };
    },
  },
  {
    name: 'screenshots',
    slow: true,
    async run() {
      let browser = null;
      try { browser = (await import('playwright')).chromium.executablePath(); } catch {}
      if (!browser || !existsSync(browser)) {
        if (process.env.CI) return { ok: false, output: '', detail: "Playwright's browser is missing (npx playwright install chromium)" };
        return { ok: true, skipped: 'no browser on this machine; the Checks workflow runs them' };
      }
      const r = run('npm', ['run', 'screenshots', '--silent']);
      const output = r.stdout + r.stderr;
      if (r.status === 0) return { ok: true };
      const failed = [...output.matchAll(/^FAIL (.+)$/gm)].map((m) => m[1]);
      return { ok: false, output, detail: failed.length ? `failed: ${failed.join('; ')}` : `npm run screenshots exited ${r.status}` };
    },
  },
];

const passed = [];
const skipped = [];
for (const check of checks) {
  if (fast && check.slow) continue;
  const started = Date.now();
  const result = await check.run();
  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  if (!result.ok) {
    if (result.output) say(result.output.trimEnd());
    say(`check: FAILED at ${check.name} (${seconds} s): ${result.detail}`);
    process.exit(hook ? 2 : 1);
  }
  if (result.skipped) { skipped.push(`${check.name} (${result.skipped})`); if (!hook) say(`skip ${check.name}: ${result.skipped}`); continue; }
  passed.push(check.name);
  if (!hook) say(`ok   ${check.name} (${seconds} s)`);
}
if (!hook) say(`check: all passed: ${passed.join(', ')}${skipped.length ? `; skipped ${skipped.join(', ')}` : ''}`);
