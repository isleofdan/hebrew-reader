# FIELD REPORT — hebrew-adopt-kit — 3 Oct 2026

(in progress)

## Baseline (step 1)

Clone: `$HOME/work/hebrew-reader` on `agent-machine-dan`, `main` at `4170412`; identity set in the clone only (`user.name Claude`, `user.email noreply@anthropic.com`). `npm ci`: 4.3 s.

The reader's own checks before this session, timed with bash's `time` on this machine (Node 24.21.0), three runs each:

| Script | Checks | Time here |
| - | - | - |
| `scripts/smoke.mjs` | 254 | 33.43 s, 32.90 s, 32.76 s |
| `scripts/grow-smoke.mjs` | 66 | 1.78 s, 1.63 s, 1.72 s |
| `scripts/paper-smoke.mjs` | 81 | 2.65 s, 2.63 s, 2.81 s |
| `npm run screenshots` (four scripts) | — | fails in 1.63 s: no Playwright browser on this machine |

All 401 server checks pass. There was no `npm test`, no `test/` folder, no `CLAUDE.md` and no Checks workflow; the only workflow is Deploy.
