'use strict';
// The sheet for the reMarkable (session fourteen): made from a desk only when
// Dan presses "Sheet for the reMarkable". It prints the desk's groups — each
// card with what it holds, the links Dan drew — and a few writing prompts
// per group, made by one model call per group. Paper is one-way: nothing
// written on the sheet comes back; the desk records only that it was made.
//
// A prompt may name only words that are on the sheet. A Hebrew word in a
// prompt passes when it is a word of the sheet by the reader's own matching
// (a form met, alone or after one prefix), carries a sheet word's root
// letters in order (an inflected form: שוטטתי for לשוטט), is a sheet word's
// root written with dots, or is written somewhere on the sheet itself (a
// word in a kept example or a note). Any other Hebrew word refuses the
// prompt.

const db = require('./db');
const lookup = require('./lookup');
const desk = require('./desk');
const tok = require('../public/tokenize.js');

const PROMPTS_FAILED = 'The writing prompts could not be made';
// Three to five prompts of a sentence or two: about 300 tokens, some 6 s at
// 50 tokens a second; the groups are asked side by side, so a sheet waits
// for the slowest. 30 s is five times the expected time, well under the
// minute a quiet request may be dropped by the proxy in front of the site.
const PROMPTS = { maxTokens: 700, timeoutMs: 30000 };
const MIN_PROMPTS = 3, MAX_PROMPTS = 5;
const KINDS = ['link-sentence', 'use-together', 'forms', 'hebrew-question', 'other'];

const SCHEMA = {
  name: 'writing_prompts',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['prompts'],
    properties: {
      prompts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'kind'],
          properties: { text: { type: 'string' }, kind: { type: 'string', enum: KINDS } },
        },
      },
    },
  },
};

const SYSTEM = `You write short writing prompts for an advanced reader of Israeli news and business Hebrew, printed on a paper sheet below a group of his study cards. He will answer them by hand, in Hebrew.
Write ${MIN_PROMPTS} to ${MAX_PROMPTS} prompts, each one or two sentences, in English, naming Hebrew words in Hebrew letters. Draw them from this group only, using these kinds where the group allows:
- "link-sentence": when the reader linked two cards with a sentence, ask him to write the sentence that says why he put them together (in Hebrew).
- "use-together": use two or three of the group's words together in one paragraph about something concrete (the news of the last two weeks, work, a plan).
- "forms": produce named forms of one of the group's verbs (a binyan and at least two tenses, e.g. "Pi'el forms of ש.ו.ט in at least two tenses").
- "hebrew-question": a question to answer in Hebrew about how two of the words relate (a shared root, a difference in use).
Name only Hebrew words that appear in the group as given, their roots written with dots (ש.ו.ט), or forms of those words. Never bring in another Hebrew word.
Answer with ONE JSON object: {"prompts": [{"text": "<the prompt>", "kind": one of ${JSON.stringify(KINDS)}}, ...]}`;

const plain = (w) => String(w || '').normalize('NFC').replace(/[֑-ׇ]/g, '');
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const base = (w) => plain(w).replace(/[ךםןףץ]/g, (c) => FINALS[c]).replace(/[^א-ת]/g, '');

// A group as the model is told it, one card to a block.
function groupText(g) {
  const lines = [];
  const name = (key) => { const c = g.cards.find((x) => x.key === key); return c ? (c.word || `the note “${String(c.text || '').slice(0, 40)}”`) : key; };
  for (const c of g.cards) {
    if (c.kind === 'word') {
      lines.push(`- ${c.word}${c.surface && c.surface !== c.word ? ` (met as ${c.surface})` : ''}${c.root ? ` · root ${c.root}` : ''}${c.binyan ? ` · ${c.binyan}` : c.pos ? ` · ${c.pos}` : ''}${c.gloss ? ` · ${c.gloss}` : ''}`);
    } else {
      lines.push(`- a note: ${c.text || '(empty)'}`);
    }
    for (const x of c.examples) lines.push(`  example kept: ${x.sentence}`);
    for (const a of c.asked) lines.push(`  asked: ${a.question} — ${a.answer}`);
    for (const n of c.notes) lines.push(`  note: ${n}`);
  }
  for (const l of g.links) lines.push(`The reader linked ${name(l.from)} and ${name(l.to)}: "${l.sentence}"`);
  return lines.join('\n');
}

// What a prompt's Hebrew may name, from what the sheet carries.
function vocabulary(groups) {
  const marks = {}, lemmas = {}, roots = [], written = new Set();
  const words = (t) => tok.words(String(t || '')).map((w) => plain(w.surface)).filter(Boolean);
  for (const g of groups) {
    for (const c of g.cards) {
      if (c.kind === 'word') {
        for (const w of [c.word, c.surface]) if (w) marks[plain(w)] = true;
        if (c.word) lemmas[plain(c.word)] = true;
        if (c.root) { const r = base(c.root); if (r.length >= 2) roots.push(r); }
      } else for (const w of words(c.text)) written.add(base(w));
      for (const x of c.examples) for (const w of words(x.sentence)) written.add(base(w));
      for (const n of c.notes) for (const w of words(n)) written.add(base(w));
      for (const a of c.asked) for (const w of words(`${a.question} ${a.answer}`)) written.add(base(w));
    }
    for (const l of g.links) for (const w of words(l.sentence)) written.add(base(w));
  }
  return { marks, lemmas, roots, written };
}

// Letters of `root` in `word`, in order (not necessarily side by side).
function hasRoot(word, root) {
  let i = 0;
  for (const ch of word) if (ch === root[i]) i++;
  return i === root.length;
}

// The Hebrew words a prompt names that are not on the sheet ([] passes).
function strangers(text, voc) {
  const out = [];
  const t = String(text || '');
  // a root written with dots (ש.ו.ט) is one word
  const dotted = [...t.matchAll(/[א-ת](?:\.[א-ת]){1,4}/g)].map((m) => m[0]);
  for (const d of dotted) if (!voc.roots.includes(base(d))) out.push(d);
  const rest = t.replace(/[א-ת](?:\.[א-ת]){1,4}/g, ' ');
  for (const w of tok.words(rest)) {
    const p = plain(w.surface), b = base(w.surface);
    if (!b) continue;
    if (tok.markFor(p, voc.marks, voc.lemmas)) continue;
    if (voc.written.has(b)) continue;
    if (voc.roots.some((r) => r.length >= 3 && hasRoot(b, r))) continue;
    out.push(w.surface);
  }
  return [...new Set(out)];
}

// The model's prompts, screened: { ok: [{ text, kind }], refused: [{ text, why }] }.
function screen(list, voc) {
  const ok = [], refused = [];
  for (const p of Array.isArray(list) ? list : []) {
    const text = String((p && p.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const bad = strangers(text, voc);
    if (bad.length) { refused.push({ text, why: `names ${bad.join(', ')}, which is not on the sheet` }); continue; }
    ok.push({ text, kind: KINDS.includes(p.kind) ? p.kind : 'other' });
    if (ok.length === MAX_PROMPTS) break;
  }
  return { ok, refused };
}

// The prompts for one group; a failure is said on the sheet, never blocks it.
async function promptsFor(g, voc) {
  try {
    const info = {};
    const raw = await lookup.chat({ system: SYSTEM, user: `The group:\n${groupText(g)}`, ...PROMPTS, what: PROMPTS_FAILED, schema: SCHEMA, info });
    const { ok, refused } = screen(raw.prompts, voc);
    for (const r of refused) console.log(`sheet: prompt refused (${r.why}): ${r.text.slice(0, 80)}`);
    return { prompts: ok, refused: refused.length, error: ok.length ? null : `${PROMPTS_FAILED}: ${refused.length ? 'every prompt named a word that is not on the sheet' : 'the model gave none'}.` };
  } catch (e) {
    console.error(`sheet: ${e.message}`);
    return { prompts: [], refused: 0, error: e.message };
  }
}

// "Sheet for the reMarkable": the sheet made from this desk and saved.
async function make(deskId) {
  const { desk: d, groups } = desk.sheetGroups(Number(deskId));
  const voc = vocabulary(groups);
  const made = await Promise.all(groups.map((g) => promptsFor(g, voc)));
  const withPrompts = groups.map((g, i) => ({ ...g, prompts: made[i].prompts, prompts_error: made[i].error }));
  const sheet = desk.addSheet(d.id, withPrompts, made.map((m) => m.prompts));
  return { sheet, sheets: desk.sheetsLine(d.id) };
}

const FOOTER = 'Nothing you write here goes back to the desk. The desk only remembers that this sheet was made.';

// A sheet as it was made; the page lays it out one group to a page.
function view(id) {
  return { ...db.getSheet(Number(id)), footer: FOOTER, delivery: DELIVERY };
}

// How the sheet reaches the reMarkable: the server has no browser to print
// with (the image is Node alone), so the page is made to print, and Dan
// prints it to PDF and puts the file on the reMarkable his usual way.
const DELIVERY = 'Print this page to PDF, then send it to the reMarkable';

module.exports = { make, view, FOOTER, DELIVERY, screen, strangers, vocabulary, groupText, SYSTEM, SCHEMA, PROMPTS };
