# Speech fixtures (hebrew-speech-one)

- `he-emet.ogg` — the word אמת ("truth") spoken: the original of
  File:He-אֱמֶת.ogg on Wikimedia Commons,
  https://commons.wikimedia.org/wiki/File:He-%D7%90%D6%B1%D7%9E%D6%B6%D7%AA.ogg.
  Licence: CC0 (public-domain dedication).
- `he-emet.webm` — the same recording as Chromium's MediaRecorder made it
  (WebM/Opus), and `he-emet.wav` — the same, 16 kHz mono WAV, the file the
  page checks play as the fake microphone
  (`--use-file-for-fake-audio-capture`). Both derived from the CC0 original.
- `answer-hebrew.json` — OpenRouter's real answer (google/gemini-3.8-flash,
  `reasoning: { effort: 'minimal' }`) to `he-emet.webm`, 23 Oct 2026: "אמת".
- `answer-english.json` ("run"), `answer-empty.json` (content "") and
  `answer-refusal.json` (HTTP 400, OpenRouter's error shape) — written by
  hand, shaped after it, for the stand-in (`scripts/mock-openrouter.mjs`).
