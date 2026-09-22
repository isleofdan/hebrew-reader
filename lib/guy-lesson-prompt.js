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
// folder, in file order: [{ name, text }].
function loadFiles() {
  const notes = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
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

const FILES = loadFiles();

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
    { "kind": "grammar", "topic": "<topic name>", "explanation": "<explanation with examples from the lesson>", "examples": [ { "he": "<Hebrew from the lesson>", "en": "<English>" } ], "for_guy": "<the non-technical explanation suitable for sharing with Guy>" }  — one per grammar topic, in Guy's own order,
    { "kind": "drills", "verbs": [ 1 or 2 verbs chosen per the Difficulty Register protocol:
        { "verb": "<infinitive>", "root": "א.ב.ג", "binyan": "<binyan>", "why": "<which Register categories it stacks, and why it was chosen>",
          "table": [ { "tense": "past" | "present" | "future" | "imperative", "forms": [ { "person": "<e.g. 1s, 3ms, 2fp>", "he": "<form with nikud>" } ] } ],
          "deviations": "<phonological deviations from the vanilla binyan template, or null>",
          "paal_comparison": "<if Nif'al: the Pa'al form of the same root compared; else null>",
          "exercises": [ 3 or 4 of { "sentence": "<Hebrew sentence with ___ for the blank>", "cue": "<person/number/tense cue>", "answer": "<the form>" } ] } ] },
    { "kind": "paper", "prompts": [ 1 or 2 Thinking-on-Paper prompts: { "type": "<one of the seven prompt types>", "anchor": "<the specific anchor from the lesson>", "prompt": "<2-3 sentences, an invitation, no prescribed layout>", "categories": [ "<the Register categories it targets>" ] } ] },
    { "kind": "vocabulary", "rows": [ { "he": "<Hebrew>", "en": "<English>", "root": "<root or empty>", "binyan": "<binyan or empty>", "category": "<category>" } ] },
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
- If the text given is not a Hebrew lesson you can work from, answer {"error": "<one short reason>"} instead.
`;

const SYSTEM = [
  "The following are Dan's instructions for turning a lesson with his Hebrew tutor Guy into study materials: the custom instructions and the project files of his שיעורי גיא project, quoted in full.",
  ...FILES.map((f) => `=== FILE: ${f.name} ===\n\n${f.text}`),
  APP_FRAME.trim(),
].join('\n\n');

// The user message: the lesson's date and its items, one per line.
function userMessage({ title, lessonDate, items }) {
  return `Lesson: ${title}\nLesson date: ${lessonDate || 'unknown'}\nLesson items (${items.length}), one per line:\n${items.join('\n')}`;
}

module.exports = { SYSTEM, FILES, CARD_FIELDS, MAX_CARDS, MAX_DRILL_VERBS, MAX_PAPER_PROMPTS, userMessage };
