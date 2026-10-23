'use strict';
// "Speak" beside a text box (hebrew-speech-one): Dan taps it and says a word;
// the recording goes up as it is (POST /lookup/speech), and what was heard
// is put in the box and handed to the page, which looks it up as typed text.
// Any page can mount it on a text box; only the Look up page does so now.
//
// The microphone runs only while he has tapped Speak: recording stops on
// Stop, at 30 seconds, when he leaves the page, and when the app goes to the
// background (that recording is dropped, not sent), and every stop ends the
// stream's tracks. No microphone or no MediaRecorder: no button at all.
(function () {
  const LIMIT_MS = 30000;
  const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const REFUSED = 'The reader may not use the microphone. Allow it in the browser\'s site settings for hebrew-reader-dan.fly.dev, then tap Speak again.';

  const can = () => Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // One player for every recording on the page: playing another stops the first.
  // The button that started it is marked "playing" until it ends or pauses.
  const player = { audio: null, id: null, button: null };
  function unmark() {
    if (player.button) player.button.classList.remove('playing');
    player.button = null; player.id = null;
  }
  function play(id, button) {
    if (!player.audio) {
      player.audio = new Audio();
      player.audio.preload = 'auto';
      // a pause queued by switching recordings arrives after the next play()
      // began, when the player is no longer paused: it clears nothing then
      const off = () => { if (player.audio.paused || player.audio.ended) unmark(); };
      player.audio.addEventListener('ended', off);
      player.audio.addEventListener('pause', off);
    }
    const a = player.audio;
    // the same button again pauses; another button for it plays it from the start
    if (player.id === id && player.button === (button || null) && !a.paused) { a.pause(); return; }
    a.pause();
    unmark();
    player.id = id; player.button = button || null;
    if (button) button.classList.add('playing');
    a.src = `/recordings/${id}`;
    a.play().catch(() => unmark());
  }

  // mount({ input, after, line, onHeard }): the button goes after `after`
  // (the box's own button); `line` shows what is happening; onHeard({ id,
  // text, ms }) is called with the text already in the box. Answers the
  // control, or null when this browser cannot record.
  function mount({ input, after, line, onHeard }) {
    if (!can()) return null;
    const button = el('button', 'btn mic');
    button.type = 'button';
    // a microphone; while recording, CSS shows the stop square instead
    const icon = el('span', 'mic-icon'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>';
    const label = el('span', 'mic-label', 'Speak');
    const meter = el('span', 'mic-meter'); meter.setAttribute('aria-hidden', 'true');
    const level = el('span', 'mic-level'); meter.append(level);
    button.append(icon, label, meter);
    after.after(button);

    let run = null; // { stream, recorder, chunks, started, timer, tick, audio, keep }
    let busy = false;

    const say = (text, cls = '') => { line.className = `mic-line ${cls}`.trim(); line.textContent = text; };

    function draw() {
      button.classList.toggle('recording', Boolean(run));
      button.disabled = busy;
      label.textContent = run ? `Stop · ${clock(Date.now() - run.started)}` : 'Speak';
      button.setAttribute('aria-pressed', String(Boolean(run)));
    }

    // the stream's tracks always end, whatever stopped the recording
    function release(r) {
      clearTimeout(r.timer); clearInterval(r.tick);
      if (r.audio) { cancelAnimationFrame(r.audio.frame); r.audio.ctx.close().catch(() => {}); }
      for (const t of r.stream.getTracks()) t.stop();
      level.style.transform = 'scaleX(0)';
    }

    function stop(keep) {
      const r = run;
      if (!r) return;
      run = null;
      r.keep = keep;
      r.ms = Date.now() - r.started;
      if (r.recorder.state !== 'inactive') r.recorder.stop(); else finish(r);
      release(r);
      draw();
    }

    // a quiet level meter: how loud the microphone is, as a bar
    function listen(r) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(r.stream).connect(an);
        const data = new Uint8Array(an.fftSize);
        r.audio = { ctx, frame: 0 };
        const step = () => {
          an.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          level.style.transform = `scaleX(${Math.min(1, peak / 64).toFixed(2)})`;
          r.audio.frame = requestAnimationFrame(step);
        };
        step();
      } catch { /* no meter; the recording goes on */ }
    }

    async function begin() {
      busy = true; draw();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        busy = false; draw();
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) say(REFUSED, 'error');
        else if (e && e.name === 'NotFoundError') say('No microphone was found on this device.', 'error');
        else say(`The microphone could not be started${e && e.message ? `: ${e.message}` : ''}.`, 'error');
        return;
      }
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      let recorder;
      try { recorder = new MediaRecorder(stream, type ? { mimeType: type } : {}); } catch (e) {
        for (const t of stream.getTracks()) t.stop();
        busy = false; draw();
        say(`The recording could not be started: ${e.message}.`, 'error');
        return;
      }
      const r = { stream, recorder, chunks: [], started: Date.now(), keep: false };
      recorder.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) r.chunks.push(ev.data); });
      recorder.addEventListener('stop', () => finish(r));
      recorder.start();
      run = r;
      busy = false;
      r.timer = setTimeout(() => stop(true), LIMIT_MS);
      r.tick = setInterval(draw, 250);
      listen(r);
      say('Listening…');
      draw();
    }

    async function finish(r) {
      if (r.done) return;
      r.done = true;
      if (!r.keep) return;
      const blob = new Blob(r.chunks, { type: r.recorder.mimeType || (r.chunks[0] && r.chunks[0].type) || 'audio/webm' });
      if (!blob.size) { say('Nothing was heard. Try again.'); return; }
      busy = true; draw();
      say('Writing it down…');
      try {
        const res = await fetch(`/lookup/speech?ms=${r.ms}`, { method: 'POST', headers: { 'content-type': blob.type, accept: 'application/json' }, body: blob });
        if (res.status === 401) { location.href = '/login'; return; }
        const data = await res.json().catch(() => ({ error: `The server answered ${res.status}.` }));
        if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
        if (!data.id) { say(data.message || 'Nothing was heard. Try again.'); return; }
        input.value = data.text;
        heard(data);
        busy = false; draw();
        await onHeard(data);
      } catch (e) {
        say(e.message === 'Failed to fetch' ? 'The server could not be reached; try again or type it.' : e.message, 'error');
      } finally {
        busy = false; draw();
      }
    }

    // "Heard: <text> · Play your recording"
    function heard(data) {
      line.className = 'mic-line heard';
      line.textContent = '';
      const t = el('span', 'mic-heard', 'Heard: ');
      const w = el('span', 'mic-text', data.text); w.dir = 'auto';
      t.append(w);
      const p = el('button', 'linklike mic-play', 'Play your recording');
      p.type = 'button';
      p.addEventListener('click', () => play(data.id, p));
      line.append(t, document.createTextNode(' · '), p);
    }

    button.addEventListener('click', () => {
      if (run) stop(true);
      else if (!busy) begin();
    });
    // leaving the page or the app going to the background: stopped, dropped
    const away = (why) => { if (run) { stop(false); say(why); } };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away('Stopped: the reader went to the background. Tap Speak to try again.'); });
    window.addEventListener('pagehide', () => away('Stopped.'));
    draw();
    return { button, stop: () => stop(false), get recording() { return Boolean(run); } };
  }

  window.MicUI = { mount, play, clock, can };
})();
