'use strict';
// The rule checks a lesson guide must pass before it is saved. Each is
// mechanical, and each is named by the instruction line it enforces (the
// שיעורי גיא instructions in docs/guy-lessons/, or the app's own frame where
// the fault was the app's). A guide that fails is rebuilt once with the
// failures named; a second failure leaves the lesson without a guide.
//
//   check(guide, lesson, verbs) -> [{ check, rule, detail }]  ([] = passed)
//
// `verbs` is what the server already knows about the lesson's verbs:
// [{ surface, lemma, root, binyan, from }] — from the card cache ('card') for
// single-word items that were looked up, else from the guide's own
// vocabulary rows ('vocabulary').

const NIKUD = /[\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;
const SPELLING_LETTERS = /[חכךאעסשטת]/;
const FLAGGED = /⚠️\s*(Spelling|Confusable)\s*:/i;
const NO_TRAP = /no spelling trap/i;
const IRREGULAR = ['pe-nun', 'guttural', 'hollow'];
const DEVIATIONS = ['pe-nun', 'pe-yod', 'guttural', 'hollow', 'doubled', 'none'];

const RULES = {
  coverage: "Anti-Patterns: \"Ignoring Guy's teaching structure … Preserve Guy's topic organization\" — every one of Guy's lines is explained in a grammar section",
  drill: "Selection Protocol 3: \"Favor Nif'al over other binyanim when available; roots with phonological deviations … over clean roots\"",
  nikud: 'Data Format [0] "Hebrew with nikud" — the vocabulary carries vowel points',
  flags: 'Flagging Protocol: "Spelling alert when homophonous letters (ח/כ, א/ע, ט/ת) could cause confusion" — with the Register\'s ס/ש',
  objects: "The app's frame: a verb's objects are stated once — the grammar section and the drill agree",
};

// Nikud, punctuation and spacing ignored; the same comparison the guide's
// "is it in the lesson" rule uses.
function plain(s) {
  return String(s || '').normalize('NFC').replace(/[֑-ֽֿ-ׇ]/g, '')
    .replace(/[״”“]/g, '"').replace(/[׳’‘]/g, "'").replace(/[^א-ת"']+/g, ' ').replace(/\s+/g, ' ').trim();
}

// "Nif'al", "nifal", "נפעל" -> "nifal". Unknown -> ''.
function binyanKey(b) {
  const t = String(b || '').toLowerCase().replace(/[^a-zא-ת]/g, '');
  const table = { paal: 'paal', kal: 'paal', qal: 'paal', פעל: 'paal', nifal: 'nifal', niphal: 'nifal', נפעל: 'nifal', piel: 'piel', פיעל: 'piel',
    pual: 'pual', פועל: 'pual', hifil: 'hifil', hiphil: 'hifil', הפעיל: 'hifil', hufal: 'hufal', hofal: 'hufal', huffal: 'hufal', הופעל: 'hufal',
    hitpael: 'hitpael', hitpaal: 'hitpael', התפעל: 'hitpael' };
  if (table[t]) return table[t];
  const key = Object.keys(table).find((k) => t.startsWith(k)); // "Pa'al (present)"
  return key ? table[key] : '';
}

// What the root's letters make irregular: pe-nun (first נ), pe-yod (first י),
// guttural (א ה ח ע ר anywhere: they reject the doubling dagesh or pull the
// vowel), hollow (a ו or י in the middle of three), doubled (last two alike).
function rootDeviations(root) {
  const letters = plain(root).replace(/[^א-ת]/g, '').split('');
  if (letters.length < 2) return [];
  const out = [];
  if (letters[0] === 'נ') out.push('pe-nun');
  if (letters[0] === 'י') out.push('pe-yod');
  if (letters.some((l) => 'אהחער'.includes(l))) out.push('guttural');
  if (letters.length === 3 && 'וי'.includes(letters[1])) out.push('hollow');
  if (letters.length === 3 && letters[1] === letters[2]) out.push('doubled');
  return out;
}

// "pe-nun, doubled", "pe-nun and doubled" -> ['pe-nun', 'doubled']: a root
// can deviate in more than one way (נוצץ, root נ.צ.צ, is both; the June
// review, 23 Sep 2026). Each part is checked on its own.
function deviationParts(dev) {
  return String(dev || '').toLowerCase().split(/\s*(?:,|;|\/|\+|&|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);
}

function irregular(v) {
  return binyanKey(v.binyan) === 'nifal' || rootDeviations(v.root).some((d) => IRREGULAR.includes(d));
}

// true, false or 'both'; anything else null.
function objectValue(v) {
  if (v === true || v === 'true' || v === 'yes') return true;
  if (v === false || v === 'false' || v === 'no') return false;
  if (v === 'both') return 'both';
  return null;
}

const few = (list, n = 3) => list.slice(0, n).join(', ') + (list.length > n ? ` and ${list.length - n} more` : '');

function checkCoverage(guide, lesson) {
  const covered = new Set(guide.sections.filter((s) => s.kind === 'grammar').flatMap((s) => s.guys_lines || []).map(plain));
  const missing = lesson.items.filter((item) => !covered.has(plain(item)));
  if (!missing.length) return null;
  return `${missing.length} of Guy's ${lesson.items.length} lines are in no grammar section's "Guy's lines": ${few(missing)}`;
}

function checkDrill(guide, verbs) {
  const drills = guide.sections.find((s) => s.kind === 'drills');
  const irregulars = verbs.filter(irregular);
  const first = drills && drills.verbs[0];
  if (!first) return irregulars.length ? `the lesson has ${few(irregulars.map((v) => v.surface))} (Nif'al or irregular) but the guide has no drill` : null;
  const problems = [];
  const claimed = binyanKey(first.binyan);
  const dev = first.deviation;
  const parts = deviationParts(dev);
  const listed = parts.length > 0 && parts.every((p) => DEVIATIONS.includes(p)) && (parts.length === 1 || !parts.includes('none'));
  if (!listed) problems.push(`the first drill (${first.verb}) gives no deviation from ${DEVIATIONS.join(', ')}, alone or combined`);
  // The model's claims checked against what the server knows: the card for
  // the same word when there is one, else the root the drill itself gives.
  const card = verbs.find((v) => v.from === 'card' && plain(v.surface) === plain(first.verb));
  // A disagreement with the card is not a failure by itself: the card comes
  // from the smaller model and can be the one that is wrong (the live card for
  // לזנק says Pa'al; it is Pi'el). The card only stops a Nif'al claim from
  // passing a drill the card says is not Nif'al.
  const binyan = card && card.binyan && claimed === 'nifal' ? card.binyan : claimed;
  const root = (card && card.root) || first.root;
  const rootDevs = rootDeviations(root);
  const notInRoot = listed ? parts.filter((p) => p !== 'none' && !rootDevs.includes(p)) : [];
  if (notInRoot.length) problems.push(`the drill calls ${first.verb} ${notInRoot.join(', ')}, which its root ${root || '(none given)'} is not`);
  // Irregular is read from the root's letters, never from the model's single
  // label: ח.ש.ש labeled "doubled" is still guttural (live rebuild, 23 Sep 2026).
  const firstIrregular = binyan === 'nifal' || rootDevs.some((d) => IRREGULAR.includes(d));
  if (irregulars.length && !firstIrregular) {
    problems.push(`the first drill is ${first.verb} (${first.binyan || 'no binyan'}, ${dev || 'no deviation'}) while the lesson has ${few(irregulars.map((v) => `${v.surface} (${[v.binyan, ...rootDeviations(v.root).filter((d) => IRREGULAR.includes(d))].filter(Boolean).join(', ')})`))}`);
  }
  return problems.length ? problems.join('; ') : null;
}

function checkNikud(guide) {
  const rows = (guide.sections.find((s) => s.kind === 'vocabulary') || { rows: [] }).rows;
  if (!rows.length) return null;
  const bare = rows.filter((r) => !NIKUD.test(r.pointed || ''));
  if (bare.length <= rows.length * 0.1) return null;
  return `${bare.length} of ${rows.length} vocabulary rows have no vowel points: ${few(bare.map((r) => r.he))}`;
}

function checkFlags(guide) {
  const rows = (guide.sections.find((s) => s.kind === 'vocabulary') || { rows: [] }).rows;
  const unflagged = [];
  for (const r of rows) if (SPELLING_LETTERS.test(plain(r.he)) && !FLAGGED.test(r.flags) && !NO_TRAP.test(r.flags)) unflagged.push(`row ${r.he}`);
  for (const c of guide.cards) if (SPELLING_LETTERS.test(plain(c[1] || c[0])) && !FLAGGED.test(c[10]) && !NO_TRAP.test(c[10])) unflagged.push(`card ${c[1] || c[0]}`);
  if (!unflagged.length) return null;
  return `${unflagged.length} items hold ח, כ, א, ע, ס, ש, ט or ת with no ⚠️ Spelling or ⚠️ Confusable note and no "no spelling trap": ${few(unflagged)}`;
}

function checkObjects(guide) {
  const drills = guide.sections.find((s) => s.kind === 'drills');
  if (!drills) return null;
  const claims = guide.sections.filter((s) => s.kind === 'grammar').flatMap((s) => (s.verb_claims || []).map((c) => ({ ...c, topic: s.topic })));
  const problems = [];
  for (const v of drills.verbs) {
    const drilled = objectValue(v.takes_object);
    if (drilled === null) { problems.push(`the drill of ${v.verb} does not say whether it takes an object`); continue; }
    for (const c of claims.filter((x) => plain(x.verb) === plain(v.verb))) {
      const said = objectValue(c.takes_object);
      if (said !== null && said !== drilled) problems.push(`"${c.topic}" says ${v.verb} takes_object ${said}; the drill says ${drilled}`);
    }
    if (drilled === false) {
      const withObject = v.exercises.filter((x) => /_{2,}\s*(את|אֶת)\s/.test(x.sentence));
      if (withObject.length) problems.push(`${v.verb} is drilled as taking no object, yet ${withObject.length} exercise(s) put את after the blank`);
    }
  }
  return problems.length ? problems.join('; ') : null;
}

// Every failure, in the order the checks are listed above.
function check(guide, lesson, verbs = []) {
  const out = [];
  const add = (name, detail) => { if (detail) out.push({ check: name, rule: RULES[name], detail }); };
  add('coverage', checkCoverage(guide, lesson));
  add('drill', checkDrill(guide, verbs));
  add('nikud', checkNikud(guide));
  add('flags', checkFlags(guide));
  add('objects', checkObjects(guide));
  return out;
}

// One line per failure, for the log, the page and the rebuild's prompt.
function describe(failures) {
  return failures.map((f) => `the ${f.check} check (${f.rule}): ${f.detail}`).join('; ');
}

module.exports = { check, describe, plain, binyanKey, rootDeviations, deviationParts, irregular, objectValue, RULES, DEVIATIONS, NAMES: Object.keys(RULES) };
