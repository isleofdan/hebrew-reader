'use strict';
// The study guide of a lesson from Guy, drawn from its JSON in the order and
// under the headings the שיעורי גיא instructions give. Shared by the lesson
// page and the print sheet; `print` puts the drill answers at the end
// instead of behind a tap.

(function () {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function he(tag, text, cls) { const e = el(tag, cls ? `he ${cls}` : 'he', text); e.dir = 'rtl'; return e; }
  function auto(tag, text, cls) { const e = el(tag, cls, text); e.dir = 'auto'; return e; }
  let print = false;
  let answers = [];

const HEADINGS = {
  topics: 'Lesson topics',
  drills: 'תרגילי הטיה — Conjugation Drills',
  paper: 'עבודה על נייר — Thinking on Paper',
  vocabulary: 'מילים מרכזיות — Core Vocabulary',
  questions: 'שאלות הבנה — Comprehension Questions',
  expressions: 'ביטויים חשובים — Key Expressions',
};
// The Thinking-on-Paper template's own opening line.
const PAPER_LEAD = 'Before working through the flashcards, spend 10-20 minutes on one or both of these prompts on the Remarkable. Generative sketching, not copying. Messy is fine.';

function section(kind, heading) {
  const s = el('section', `g-${kind}`);
  s.dataset.kind = kind;
  s.append(auto('h3', heading));
  return s;
}

function drawSection(sec) {
  if (sec.kind === 'topics') {
    const s = section('topics', HEADINGS.topics);
    const ul = el('ul', 'topics');
    for (const t of sec.items) ul.append(auto('li', t));
    s.append(ul);
    return s;
  }
  if (sec.kind === 'grammar') {
    const s = section('grammar', sec.topic || 'Grammar');
    if (sec.guys_lines && sec.guys_lines.length) {
      const lines = el('p', 'guys-lines');
      lines.append(el('span', 'label', "Guy's lines"), he('span', sec.guys_lines.join(' · ')));
      s.append(lines);
    }
    if (sec.explanation) s.append(auto('p', sec.explanation, 'prose'));
    if (sec.examples.length) {
      const ul = el('ul', 'examples');
      for (const x of sec.examples) { const li = el('li'); li.append(he('div', x.he), auto('div', x.en, 'en')); ul.append(li); }
      s.append(ul);
    }
    // No "For Guy" box, even in a guide saved before Dan dropped it (22 Sep 2026).
    return s;
  }
  if (sec.kind === 'drills') {
    const s = section('drills', HEADINGS.drills);
    for (const v of sec.verbs) {
      const box = el('div', 'drill');
      const head = el('div', 'drill-head');
      head.append(he('span', v.verb, 'drill-verb'), el('span', 'muted', [v.root && `root ${v.root}`, v.binyan].filter(Boolean).join(' · ')));
      box.append(head);
      if (v.why) box.append(auto('p', v.why, 'why'));
      if (v.table.length) {
        const t = el('div', 'conj');
        for (const tense of v.table) {
          const col = el('div', 'tense');
          col.append(el('div', 'label', tense.tense));
          const grid = el('dl', 'forms');
          for (const f of tense.forms) { grid.append(el('dt', '', f.person), he('dd', f.he)); }
          col.append(grid);
          t.append(col);
        }
        box.append(t);
      }
      if (v.deviations) box.append(auto('p', v.deviations, 'note'));
      if (v.paal_comparison) box.append(auto('p', v.paal_comparison, 'note'));
      if (v.exercises.length) {
        const ol = el('ol', 'exercises');
        for (const x of v.exercises) {
          const li = el('li');
          li.append(he('div', x.sentence, 'sentence'), auto('div', x.cue, 'cue'));
          if (print) answers.push(`${v.verb} ${ol.children.length + 1}. ${x.answer}`);
          else { const d = el('details'); d.append(el('summary', '', 'Answer'), he('span', x.answer)); li.append(d); }
          ol.append(li);
        }
        box.append(ol);
      }
      s.append(box);
    }
    return s;
  }
  if (sec.kind === 'paper') {
    const s = section('paper', HEADINGS.paper);
    s.append(el('p', 'lead', PAPER_LEAD));
    sec.prompts.forEach((p, i) => {
      const box = el('div', 'paper-prompt');
      box.append(auto('div', `${i + 1}. ${[p.type, p.anchor].filter(Boolean).join(': ')}`, 'paper-title'), auto('p', p.prompt, 'prose'));
      if (p.categories.length) box.append(el('div', 'muted', `Register: ${p.categories.join(', ')}`));
      s.append(box);
    });
    return s;
  }
  if (sec.kind === 'vocabulary') {
    const s = section('vocabulary', HEADINGS.vocabulary);
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'vocab');
    const hr = el('tr');
    for (const h of ['Hebrew', 'English', 'Root', 'Binyan', 'Category']) hr.append(el('th', '', h));
    table.append(hr);
    for (const r of sec.rows) {
      const tr = el('tr');
      const en = auto('td', r.en);
      // A difficulty flag sits under the meaning; "no spelling trap" is the
      // model's answer to the flag check, not something to read.
      if (r.flags && !/^\s*no spelling trap\.?\s*$/i.test(r.flags)) en.append(auto('div', r.flags, 'flags'));
      tr.append(he('td', r.pointed || r.he), en, he('td', r.root), el('td', '', r.binyan), auto('td', r.category));
      table.append(tr);
    }
    wrap.append(table);
    s.append(wrap);
    return s;
  }
  if (sec.kind === 'questions') {
    const s = section('questions', HEADINGS.questions);
    const ol = el('ol', 'questions');
    ol.dir = 'rtl';
    for (const q of sec.items) ol.append(he('li', q));
    s.append(ol);
    return s;
  }
  if (sec.kind === 'expressions') {
    const s = section('expressions', HEADINGS.expressions);
    for (const x of sec.items) {
      const box = el('div', 'expression');
      const head = el('div', 'expr-head');
      head.append(he('span', x.he, 'expr-he'), auto('span', x.en, 'expr-en'));
      box.append(head);
      if (x.usage) box.append(auto('p', x.usage, 'prose'));
      if (x.flags) box.append(auto('p', x.flags, 'flags'));
      s.append(box);
    }
    return s;
  }
  return null;
}


  function render(box, guide, opts = {}) {
    print = Boolean(opts.print);
    answers = [];
    for (const sec of guide.sections) { const s = drawSection(sec); if (s) box.append(s); }
    if (print && answers.length) {
      const s = section('answers', 'Answers to the drills');
      const ol = el('ul', 'answers');
      for (const a of answers) ol.append(he('li', a));
      s.append(ol);
      box.append(s);
    }
  }

  window.GuideUI = { render, HEADINGS };
})();
