# Independent review of 4dc0d83

Reviewer: dev-check@hebrew-speech-mixed, 23 October 2026.
Queue: qitem-20261023132319-94993f4c.
Repository: /data/home/dan/work/hebrew-speech-one.
Candidate: 4dc0d83, reviewed against 22822fb and the complete job at
/data/home/dan/work/scratch-hebrew-speech-one/job.md.

Verdict: **FINDINGS**. The ordinary speech flows pass, but rule 7 has an
uncovered pending-microphone-request race.

## Required correction

**P1 — cancel a pending microphone request when the page goes away.**
In public/mic-ui.js:126, begin() awaits getUserMedia. The away handler at
lines 198–200 does nothing until run exists, and begin() resumes at lines
134–146 without checking whether that request was canceled or the document
became hidden. Tap Speak, background the app while permission/device acquisition
is pending, then let the request resolve: recording starts in the hidden page.
Tracks remain live, and the normal 30-second timer can eventually upload this
recording. The same missing cancellation applies to pagehide while acquisition
is pending. Rule 7 requires recording to stop when the app goes to the background
or leaves the page, with tracks stopped every time.

Reproduced by executing the candidate's actual public/mic-ui.js in JSDOM,
holding the getUserMedia promise, dispatching visibilitychange with visibilityState
hidden, then resolving a stream. MediaRecorder and its track were test doubles.
Observed after resolution:

```json
{"visibility":"hidden","recording":true,"track":"live","stopped":0,"label":"Stop · 0:00"}
```

Expected: recording false, late-arriving tracks ended, no upload. Invalidate pending
starts on visibilitychange/pagehide (including a hidden-then-visible transition),
stop any stream arriving for an invalidated start, and require a fresh Speak tap.
Add delayed-getUserMedia regression cases alongside the existing active-recording
background test. No implementation changes were made by the reviewer.

Reproduction, from the repository, with its installed jsdom:

```js
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
(async () => {
  const dom = new JSDOM('<input><button></button><p></p>', { runScripts: 'outside-only' });
  const w = dom.window;
  let resolve, stopped = 0;
  const track = { readyState: 'live', stop() { stopped++; this.readyState = 'ended'; } };
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(r => { resolve = r; }) }
  });
  w.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.handlers = {}; }
    addEventListener(n, f) { this.handlers[n] = f; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.handlers.stop(); }
  };
  w.eval(fs.readFileSync('public/mic-ui.js', 'utf8'));
  const mic = w.MicUI.mount({ input: w.document.querySelector('input'),
    after: w.document.querySelector('button'), line: w.document.querySelector('p'),
    onHeard: () => {} });
  mic.button.click();
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, value: 'hidden' });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  resolve({ getTracks: () => [track] });
  await new Promise(r => setImmediate(r));
  console.log({ visibility: w.document.visibilityState, recording: mic.recording,
    track: track.readyState, stopped, label: mic.button.textContent });
  mic.stop();
  dom.window.close();
})();
```

## Fresh verification and scope

- `node scripts/speech-smoke.mjs`: all 46 checks passed, exit 0.
- `node scripts/speech-pages.mjs`: all 75 checks passed, exit 0, Chromium fake
  microphone, both viewport widths and themes. Desktop Speak top 99.0 px in
  idle/recording/writing/done; phone 259.4 px throughout. All deltas 0.0 px.
  Automatic stop measured 30.1 seconds.
- Verified by those tests: Hebrew and English lookup/attachment, one-time attachment,
  byte-preserving storage, ranged playback, authentication, error/noise cleanup,
  delete/Keep, sweep, ordinary track cleanup and equivalence to typed lookup saves.
- The first server check attempt was sandbox-blocked (listen EPERM); the passing
  run was outside that sandbox. Ports 8920–8928 were free before the runs.
- The race reproduction above is a deterministic module test, not an observed
  real browser permission dialog race. An additional Chromium reproduction attempt
  did not launch because the explicitly selected /opt/pw-browsers/chromium path
  did not exist; it supplies no browser evidence. The repository's page suite used
  its own successful executable discovery.
- Full `npm run check` was reported passing by the owner; this review reran the two
  speech suites, not the full regression suite. Live model verify item 9 remains
  Dan's task, as the job specifies. No live model request, push or deployment.
- Generated screenshot changes were restored after the review run.

## Contract deviations to resolve or disclose

Steps 2 and 3 share one commit despite the requested commit after each step
(already disclosed by the owner). The phone control measures 156 by 52 px and
is a pill spanning half the form row; the job asks for a round 44 px phone button.
The current test accepts a large border radius and minimum height rather than
checking those literal dimensions. Resolve that design discrepancy with the job
before describing the candidate as fully conforming.

Continuation: owner fixes the pending-start lifecycle and adds regression evidence,
then hands back the exact new candidate for focused recheck. Preserve the existing
passing ordinary flows and document the two contract deviations above.
