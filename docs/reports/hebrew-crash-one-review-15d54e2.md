# Independent review: hebrew-crash-one, 15d54e2

Date: 2026-10-25. Reviewer: dev-check@hebrew-crash-one-mixed.
Repository: /data/home/dan/work/hebrew-crash-one.
Candidate: 15d54e28d3c1300649b464ae893c76b56f021ed3, compared with 9a36f38.
Verdict: FINDINGS. Implementation unchanged by reviewer.

1. **P1 — Query strings escape through exception stack frames.** `public/crash.js:26-36` removes request/user/transaction/extra but passes `exception.values[].stacktrace.frames[].filename` unchanged. In Chromium, an uncaught error from an inline script uses the document URL, including its query, as its filename. The committed SDK and scrub sent `http://127.0.0.1:8949/sheet.html?private=PRIVATE_SENTINEL` in the event envelope in the probe below. This violates the explicit prohibition on URLs with query strings. The application has inline JavaScript in `public/sheet.html:92` and serves it with query parameters. Strip query/fragment data from code-location URL fields while retaining filename/path and line/column, and add a real inline-script regression test. Existing tests throw inside Playwright evaluation, which does not exercise document-origin inline stack locations.

2. **P2 — The warning-only deployment probe fails the job on transport errors.** `.github/workflows/deploy.yml:144-150`: either curl command substitution exits nonzero on connection failure/timeout. Under the runner's `bash -e`, execution stops before printing the code/warning or cleaning the cookie jar. Reproduced against the exact extracted run block using a shell curl function that prints 000 and returns 7 for either /login or /crash-test: login case exits 7 with no stdout; crash-test case exits 7 with only `sign-in: 200`. A real curl to closed localhost port 1 also exits 7 before the warning. Handle transport failure explicitly for both calls, ensure the code and warning are printed, clean up the jar, and bound login time as well. Add a shell regression for failed login transport and failed crash-test transport.

Verification on the candidate:

- `npm test`: exit 0, 1,003 checks (including 41 crash checks). Log: /tmp/hebrew-crash-review-tests.log.
- `node scripts/crash-pages.mjs`: exit 0, seven checks. Log: /tmp/hebrew-crash-review-pages.log.
- Browser privacy probe below: event contains sentinel in filename (`leaked: true`).
- Exact workflow block with controlled curl failures: both cases exit 7 and neither prints a warning.
- Read the diff, build script, reporting hooks, page script ordering, authentication placement and docs. Committed bundle strategy and broader breadcrumb filtering are reasonable; three reporting call sites are disclosed. No project/mission/slice YAML was found in the repository scan.

Limits: existing installed dependencies used; no fresh npm ci. No real Sentry delivery, Wall card, deploy, push, full screenshot suite or Node 22 run. The observed passing checks do not override the two reproduced failures.

Continuation: owner fixes both findings, records the new candidate and requests focused re-review.

## Browser reproduction

Save as a temporary .mjs file and run with Node on this machine. It serves only local synthetic HTML and the candidate's exact committed scripts. No data goes to real Sentry. Expected before fix: `leaked: true`, with PRIVATE_SENTINEL in exception.stacktrace.frames[].filename.

```js
import { chromium } from '/data/home/dan/work/hebrew-crash-one/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const root='/data/home/dan/work/hebrew-crash-one';
const envelopes=[];
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')) {let text='';for await(const c of req)text+=c;envelopes.push(text);res.end('{}');return;}
 if(req.url==='/sentry.min.js'||req.url==='/crash.js'){res.setHeader('content-type','application/javascript');res.end(readFileSync(root+'/public'+req.url));return;}
 res.setHeader('content-type','text/html');res.end('<head><meta name="sentry-dsn" content="http://key@127.0.0.1:8949/1"><script src="/sentry.min.js"></script><script src="/crash.js"></script></head><script>setTimeout(()=>{throw new Error("inline error")},0)</script>');
});
await new Promise(r=>server.listen(8949,'127.0.0.1',r));
let browser;
try {browser=await chromium.launch();const page=await browser.newPage();await page.goto('http://127.0.0.1:8949/sheet.html?private=PRIVATE_SENTINEL');await page.waitForTimeout(1500);for(const env of envelopes){if(env.includes('"type":"event"')){const event=JSON.parse(env.split('\n')[2]);console.log(JSON.stringify({leaked:env.includes('PRIVATE_SENTINEL'),exception:event.exception},null,2));}}}finally{await browser?.close();server.close();}
```
