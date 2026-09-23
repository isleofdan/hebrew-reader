'use strict';
// The system message that turns one of Guy's lessons into a study guide and a
// set of flashcards. The rules are Dan's own: the שיעורי גיא project's custom
// instructions and project files, filed on the spine card and committed
// unchanged under docs/guy-lessons/. They are quoted here in full, never
// paraphrased; what this file adds is only how they apply inside the app (one
// JSON answer instead of two files, no items that are not in the lesson).
// PLAN.md maps each instruction onto the JSON field that carries it.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'docs', 'guy-lessons');

// Every "=== FILE: <name> ===" section of every instructions note in the
// folder, in file order: [{ name, text }]. Only the instructions notes are
// read; the folder also keeps the project chat's own guides for comparison
// (chat-guide-*.md), which never reach the model.
const NOTE = /^guy-lesson-instructions-.*\.md$/;
function loadFiles() {
  const notes = fs.readdirSync(DIR).filter((f) => NOTE.test(f)).sort();
  if (!notes.length) throw new Error(`No lesson instructions in ${DIR}.`);
  const files = [];
  for (const note of notes) {
    const text = fs.readFileSync(path.join(DIR, note), 'utf8');
    const parts = text.split(/^=== FILE: (.+?) ===$/m);
    for (let i = 1; i < parts.length; i += 2) files.push({ name: parts[i].trim(), text: parts[i + 1].trim() });
  }
  if (!files.length) throw new Error(`The lesson instructions in ${DIR} hold no "=== FILE:" sections.`);
  return files;
}

// Read on first use, so a missing instructions file stops only the guide,
// with its reason, never the whole server.
let files = null;
function FILES_() { if (!files) files = loadFiles(); return files; }

// The card data format from Hebrew_Lesson_Tools.md, field by field.
const CARD_FIELDS = [
  'Hebrew with nikud',
  'Hebrew without nikud',
  'Transliteration (kept in data for accessibility, not displayed by default)',
  'English meaning',
  'Root (dotted: א.ב.ג)',
  'Binyan (or "" if not a verb)',
  'Category',
  'Part of speech',
  'Example sentence (Hebrew)',
  'Example translation (English)',
  'Notes (linguistic notes, difficulty flags, confusables, preposition alerts)',
];

const MAX_CARDS = 35;       // "35 cards is a comfortable maximum per app"
const MAX_DRILL_VERBS = 2;  // "Select 1-2 verbs for contextual conjugation drilling per lesson"
const MAX_PAPER_PROMPTS = 2; // "Hard cap at 2 prompts per study guide"

const APP_FRAME = `
=== HOW THESE INSTRUCTIONS APPLY IN THIS APP ===

You are building the study guide and the flashcards for ONE lesson with Guy, inside Dan's Hebrew reader app. Everything above is Dan's own instruction set and governs the content: follow it. The app, not you, renders the flashcard page and the guide page, so wherever the instructions describe files, HTML, React, output folders or presenting files, ignore that part and answer instead with ONE JSON object and nothing else, in this shape:

{
  "title": "שיעור עם גיא — <the lesson date as D.M.YYYY>",
  "date": the lesson date as given (YYYY-MM-DD), or null,
  "sections": [ the study guide, in this order, each section an object with "kind":
    { "kind": "topics", "items": [ the grammar topics covered, short strings ] },
    { "kind": "grammar", "topic": "<topic name>", "guys_lines": [ "<every line of the lesson this section explains, copied exactly as given>" ], "explanation": "<explanation with examples from the lesson>", "examples": [ { "he": "<Hebrew from the lesson>", "en": "<English>" } ], "verb_claims": [ { "verb": "<infinitive>", "takes_object": true | false | "both" } — one for every verb whose object the explanation speaks about ] }  — one per grammar topic, in Guy's own order,
    { "kind": "drills", "verbs": [ 1 or 2 verbs chosen per the Difficulty Register protocol:
        { "verb": "<infinitive>", "root": "א.ב.ג", "binyan": "<binyan>", "deviation": "pe-nun" | "pe-yod" | "guttural" | "hollow" | "doubled" | "none", "takes_object": true | false | "both", "why": "<which Register categories it stacks, and why it was chosen>",
          "table": [ { "tense": "past" | "present" | "future" | "imperative", "forms": [ { "person": "<e.g. 1s, 3ms, 2fp>", "he": "<form with nikud>" } ] } ],
          "deviations": "<phonological deviations from the vanilla binyan template, or null>",
          "paal_comparison": "<if Nif'al: the Pa'al form of the same root compared; else null>",
          "exercises": [ 3 or 4 of { "sentence": "<Hebrew sentence with ___ for the blank>", "cue": "<person/number/tense cue>", "answer": "<the form>" } ] } ] },
    { "kind": "paper", "prompts": [ 1 or 2 Thinking-on-Paper prompts: { "type": "<one of the seven prompt types>", "anchor": "<the specific anchor from the lesson>", "prompt": "<2-3 sentences, an invitation, no prescribed layout>", "categories": [ "<the Register categories it targets>" ] } ] },
    { "kind": "vocabulary", "rows": [ { "he": "<Hebrew exactly as in the lesson, without nikud>", "pointed": "<the same with full nikud>", "en": "<English>", "root": "<root or empty>", "binyan": "<binyan or empty>", "category": "<category>", "flags": "<difficulty flags in the ⚠️ conventions, or \"no spelling trap\">" } ] },
    { "kind": "questions", "items": [ comprehension questions, in Hebrew ] },
    { "kind": "expressions", "items": [ { "he": "<expression>", "en": "<English>", "usage": "<usage note>", "flags": "<difficulty flags in the ⚠️ conventions, or empty>" } ] }
  ],
  "cards": [ at most ${MAX_CARDS} flashcards, each an array of exactly ${CARD_FIELDS.length} strings in this order: ${CARD_FIELDS.map((f, i) => `[${i}] ${f}`).join('; ')} ]
}

Rules for this app:
- The lesson's items (the lines of Guy's PDF) are given in the user message, one per line. Build everything from those items only. Do not add vocabulary, expressions or cards that are not in the lesson. Field [1] of every card, "he" of every vocabulary row, and "he" of every expression must be copied from the lesson text exactly as written there — a whole line or a part of one — without nikud.
- Grammar examples, drill sentences and card example sentences may be written by you, but every one of them must use the lesson's own items.
- At most ${MAX_CARDS} cards: when the lesson has more candidates, choose by the Difficulty Register, as the instructions say.
- At most ${MAX_DRILL_VERBS} drill verbs and at most ${MAX_PAPER_PROMPTS} Thinking-on-Paper prompts.
- Leave out a section only when the lesson gives nothing for it; never fill a section with invented material.
- Dan's decision (22 Sep 2026): the "non-technical explanation suitable for sharing with Guy" is not used in this app. Write no such explanation, under any field.
- Every one of the lesson's lines is explained: each appears, copied exactly, in the "guys_lines" of a grammar section, and the grammar sections follow Guy's order. A line may share a section with others; none is left only to the tables.
- Drills follow the Register: when the lesson holds a Nif'al verb, or a verb whose root is פ"נ, has a guttural (א ה ח ע, or ר, which rejects the doubling dagesh), or is hollow (ע"ו/ע"י), the first drill verb is one of those. "binyan" and "deviation" name what it is; they are checked against the root.
- A verb's objects are stated once: the drill's "takes_object" and every "verb_claims" entry for the same verb agree, and a verb said to take no object is never drilled with one (no ___ את).
- Vocabulary rows carry "pointed" with full nikud.
- Spelling flags: every vocabulary row ("flags") and every card (field [10]) whose Hebrew contains ח, כ/ך, א, ע, ס, ש, ט or ת carries a "⚠️ Spelling:" or "⚠️ Confusable:" note naming the letter pair (ח/כ, א/ע, ס/ש, ט/ת), or the words "no spelling trap" when there truly is none.
- Roots, binyanim and etymologies only when you are sure, checked letter by letter against the word (הסלמה is ס.ל.ם, not ש.ל.ם; עדה is י.ע.ד). When unsure, say so rather than invent.
- If the text given is not a Hebrew lesson you can work from, answer {"error": "<one short reason>"} instead.
`;

function system() {
  return [
    "The following are Dan's instructions for turning a lesson with his Hebrew tutor Guy into study materials: the custom instructions and the project files of his שיעורי גיא project, quoted in full.",
    ...FILES_().map((f) => `=== FILE: ${f.name} ===\n\n${f.text}`),
    APP_FRAME.trim(),
  ].join('\n\n');
}

// The user message: the lesson's date and its items, one per line.
// The review pass: a second call, with the same instructions, that checks the
// finished guide's claims. It answers with corrections only — a find and a
// replace inside one named item — never the guide rewritten: written out
// whole, a 39-line lesson's guide took the guide model past fifteen minutes
// (two live timeouts, 22-23 Sep 2026). A correction cannot add an item; the
// server applies each one and refuses any it cannot place.
const REVIEW_FRAME = `
=== THE REVIEW ===

A study guide was built from one lesson with Guy under the instructions above, as the JSON given in the user message. Review it as a careful Hebrew linguist, against the Difficulty Register above:
- Roots: check every root letter by letter against the word, including weak letters (הסלמה is ס.ל.ם, the root of סולם, not ש.ל.ם; עדה is י.ע.ד; להקיז is נ.ק.ז).
- Binyanim: check every binyan named (לזנק is Pi'el, not Pa'al; היכון is Nif'al).
- Etymologies: correct or remove any you cannot vouch for; never replace one guess with another.
- Objects: whether each verb takes an object; a grammar section's "verb_claims", the drill's "takes_object" and the drill's exercises must agree with how the verb is really used.
- Vowel points, conjugation forms and the ⚠️ flags.

Do NOT write the guide back. Answer with ONE JSON object and nothing else:
{
  "corrections": [ {
    "section": "grammar" | "drills" | "paper" | "vocabulary" | "questions" | "expressions" | "cards",
    "item": "<which item: for vocabulary, expressions and cards its Hebrew exactly as the guide gives it (\"he\", or card field [1]); for grammar its topic; for drills its verb; for paper its anchor; for questions the question>",
    "find": "<the exact wrong text, copied from that item, short but unique within it>",
    "replace": "<the corrected text>",
    "why": "<one line in English: what was wrong, and what it is now>"
  } ],
  "remove": [ { "section": "vocabulary" | "expressions" | "cards", "item": "<its Hebrew as the guide gives it>", "why": "<one line in English>" } ]
}
To change whether a drill verb takes an object, use section "drills", the verb as item, "find": "takes_object", and "replace": true, false or "both".
Correct only what is wrong. Never add an item. With nothing to correct, answer {"corrections": [], "remove": []}.
`;

function reviewSystem() {
  return [
    "The following are Dan's instructions for turning a lesson with his Hebrew tutor Guy into study materials: the custom instructions and the project files of his שיעורי גיא project, quoted in full.",
    ...FILES_().map((f) => `=== FILE: ${f.name} ===\n\n${f.text}`),
    REVIEW_FRAME.trim(),
  ].join('\n\n');
}

function reviewMessage({ title, lessonDate, items, guide }) {
  const { title: t, date, sections, cards } = guide;
  return `Review: ${title}\nLesson date: ${lessonDate || 'unknown'}\nLesson items (${items.length}), one per line:\n${items.join('\n')}\n\nGuide:\n${JSON.stringify({ title: t, date, sections, cards })}`;
}

// On the one rebuild after a failed check, the failures follow the items,
// after a blank line.
function userMessage({ title, lessonDate, items, failed = null }) {
  const base = `Lesson: ${title}\nLesson date: ${lessonDate || 'unknown'}\nLesson items (${items.length}), one per line:\n${items.join('\n')}`;
  return failed ? `${base}\n\nYour previous answer failed these checks of the instructions. Answer again in full, fixing them: ${failed}` : base;
}

module.exports = { system, reviewSystem, reviewMessage, files: FILES_, CARD_FIELDS, MAX_CARDS, MAX_DRILL_VERBS, MAX_PAPER_PROMPTS, userMessage };
