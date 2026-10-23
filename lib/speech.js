'use strict';
// Speech on the Look up page (hebrew-speech-one): a word Dan says is written
// down by a model that hears audio, and the text goes into the box and
// through the look-up as typed text does. The model only writes down what
// was said — the words, in the script spoken, no nikud added, nothing
// translated or corrected; the look-up decides everything else.
//
// The phone's recording is uploaded as it is (WebM/Opus from Chrome on
// Android, Ogg, MP4 or WAV), the raw request body, and sent to OpenRouter as
// an `input_audio` part in its own format: both WebM and WAV were accepted
// live (Dan's environment check, 23 Oct 2026). Kept as
// DATA_DIR/recordings/<id>.<ext> with a row in `recordings`; a recording no
// row was attached to is deleted after seven days, at start-up.

const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { ReaderError } = db;
const lookup = require('./lookup');

const SPEECH_MODEL = process.env.SPEECH_MODEL || 'google/gemini-3.8-flash';
const TIMEOUT_MS = 60000;
const MAX_BYTES = 2 * 1024 * 1024; // readBuffer's limit: well over 30 seconds of Opus or 16 kHz WAV
const KEEP_UNATTACHED_MS = 7 * 24 * 3600 * 1000;

// The recorder's type -> the file's extension and OpenRouter's `format`.
const TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/wav': 'wav' };
const TYPE_LIST = 'audio/webm, audio/ogg, audio/mp4 or audio/wav';

const SYSTEM = 'You write down speech. Return only the words spoken, in the script of the language spoken: a Hebrew word is always written in Hebrew letters, never spelled out in Latin letters (for a spoken אמת, write אמת, never "Emet"); an English word in Latin letters. Add no nikud, translate nothing, correct nothing. If nothing intelligible was said, return an empty answer.';
const ASK = 'Write down what is said in this recording.';

const NOTHING = 'Nothing was heard. Try again.';
const FAILED = 'The recording could not be written down; try again or type it.';
const TOO_LONG = 'A recording can be at most 30 seconds.';

let dir = null;
let clock = () => Date.now();
function setClock(fn) { clock = fn; }

// The recordings folder under DATA_DIR, made once; then the sweep.
function init(dataDir) {
  dir = path.join(dataDir, 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return sweep();
}

// The type a request names, its parameters (";codecs=opus") set aside; one
// of the four, else 415 naming them.
function typeOf(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[base]) throw new ReaderError(415, `A recording is sent as ${TYPE_LIST}; this was ${base || 'sent with no type'}.`);
  return base;
}

// What the model wrote, as the box takes it: spaces made single, and
// punctuation at either end dropped (a spoken word comes back as "אמת." at
// times) — a geresh or gershayim kept. Bracketed notes ("[noise]") and an
// answer with no letter at all are nothing heard.
function clean(content) {
  const t = String(content || '').normalize('NFC').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}\p{S}]+/u, '').replace(/[\s\p{S}]+$/u, '').replace(/[^\P{P}׳״'’]+$/u, '').trim();
  return /\p{L}/u.test(t) ? t : '';
}

// One recording written down. Answers { text, took } or throws the 502.
async function writeDown(bytes, mime) {
  const key = process.env.OPENROUTER_API_KEY;
  const what = 'The recording could not be written down';
  const t0 = clock();
  try {
    if (!key) throw new ReaderError(503, `${what}: OPENROUTER_API_KEY is unset.`);
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [{ type: 'text', text: ASK }, { type: 'input_audio', input_audio: { data: bytes.toString('base64'), format: TYPES[mime] } }] },
    ];
    // the least thinking the model allows (0 reasoning tokens live), through
    // the card's own helper, which asks once more without it if refused
    const r = await lookup.post({ key, model: SPEECH_MODEL, messages, maxTokens: 1000, format: null, timeoutMs: TIMEOUT_MS, what, reasoning: { effort: 'minimal' }, temperature: 0 });
    if (!r.ok) {
      const detail = lookup.errorDetail(r.text);
      throw new ReaderError(502, `${what}: OpenRouter answered ${r.status}${detail ? ' (' + detail + ')' : ''}.`);
    }
    return { text: clean(lookup.contentOf(r.text, what).content), took: clock() - t0 };
  } catch (e) {
    console.error(`speech: ${e.message} (${SPEECH_MODEL}, ${bytes.length} bytes of ${mime})`);
    throw new ReaderError(502, FAILED);
  }
}

// POST /lookup/speech: the raw recording -> { id, text, ms }, the file and
// its row kept; nothing heard -> { id: null, text: '', message }, nothing
// kept; the model down or refusing -> 502, nothing kept. `ms` is the
// recording's length as the page measured it (?ms=), null when not given.
async function hear(bytes, contentType, { ms } = {}) {
  const mime = typeOf(contentType);
  if (!bytes.length) throw new ReaderError(400, 'The recording is empty.');
  const length = ms === undefined || ms === null || ms === '' ? null : Math.round(Number(ms));
  if (length !== null && !(Number.isFinite(length) && length >= 0)) throw new ReaderError(400, `ms is the recording's length in milliseconds; got ${JSON.stringify(ms)}.`);
  const { text, took } = await writeDown(bytes, mime);
  if (!text) {
    console.log(`speech: nothing heard in ${bytes.length} bytes of ${mime} (${took} ms); nothing kept`);
    return { id: null, text: '', message: NOTHING };
  }
  const id = db.addRecording({ file: '', mime, bytes: bytes.length, ms: length, text, model: SPEECH_MODEL, at: new Date(clock()).toISOString() });
  const file = `${id}.${TYPES[mime]}`;
  try {
    fs.writeFileSync(path.join(dir, file), bytes);
    db.setRecordingFile(id, file);
  } catch (e) {
    db.deleteRecording(id);
    throw e;
  }
  console.log(`speech: recording ${id} (${bytes.length} bytes of ${mime}${length !== null ? `, ${length} ms` : ''}) written down by ${SPEECH_MODEL} in ${took} ms: "${text}"`);
  return { id, text, ms: length };
}

const ROW_KEY = /^(word:\d+|note:\d+|english:.+)$/;

function need(id) {
  const r = db.getRecording(Number(id));
  if (!r) throw new ReaderError(404, `No recording with id ${id}.`);
  return r;
}

// POST /recordings/<id>/attach { row_key }: once only.
function attach(id, rowKey) {
  const r = need(id);
  const k = String(rowKey || '');
  if (!ROW_KEY.test(k)) throw new ReaderError(400, `row_key is a "Looked up" row's key: word:<id>, english:<text> or note:<id>; got ${JSON.stringify(rowKey)}.`);
  if (!db.attachRecording(r.id, k)) throw new ReaderError(409, `Recording ${r.id} is already attached to ${r.row_key}; it stays there.`);
  console.log(`speech: recording ${r.id} attached to ${k}`);
  return { id: r.id, row_key: k };
}

// GET /recordings/<id>: the file, with its type; a Range request answers
// 206 with that part, so the phone's player can seek.
function serve(req, res, id) {
  const r = need(id);
  const file = path.join(dir, r.file);
  let size;
  try { size = fs.statSync(file).size; } catch { throw new ReaderError(404, `The file of recording ${r.id} is missing.`); }
  const head = { 'content-type': r.mime, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (req.headers.range && m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { ...head, 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  return fs.createReadStream(file).pipe(res);
}

function removeFile(r) {
  if (!r.file) return;
  try { fs.unlinkSync(path.join(dir, r.file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// DELETE /recordings/<id>: the row and the file. Saved words stay.
function remove(id) {
  const r = need(id);
  removeFile(r);
  db.deleteRecording(r.id);
  console.log(`speech: recording ${r.id} deleted (row and file; saved words kept)`);
  return { deleted: r.id };
}

// At start-up: recordings never attached, older than seven days, deleted
// with their files; logged once with the count. Answers the count.
function sweep() {
  const old = db.unattachedBefore(new Date(clock() - KEEP_UNATTACHED_MS).toISOString());
  for (const r of old) { removeFile(r); db.deleteRecording(r.id); }
  if (old.length) console.log(`speech: ${old.length} recording(s) never attached to a looked-up word, older than seven days, deleted with their files`);
  return old.length;
}

module.exports = { SPEECH_MODEL, SYSTEM, MAX_BYTES, NOTHING, FAILED, TOO_LONG, TYPES, init, setClock, typeOf, clean, hear, attach, serve, remove, sweep };
