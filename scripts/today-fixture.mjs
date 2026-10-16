// The Today checks' material (hebrew-today-one), written straight into a
// reader.db through lib/db.js: two lessons from Guy, six words each (two
// verbs with conjugation, one word with preposition government, one with
// letter order), and one article with three words. Each word has its card,
// its spot (shaky, already on the spine) and its touch, at a set time, so the
// order the set is chosen in is known. Used by scripts/today-smoke.mjs and
// scripts/today-pages.mjs; no model is asked.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const card = (o) => ({ lemma: null, pos: 'noun', root: null, binyan: null, tense: null, person_gender_number: null, governs: null, categories: [], note: null, pointed: { lemma: null, surface: null }, ...o });

// lesson 1, the older: all five categories but homophonous spelling, and none
export const LESSON1 = {
  title: 'שיעור עם גיא — 1 בספטמבר', lesson_date: '2026-09-01',
  sentences: ['הממשלה נאלצה לדחות את ההצבעה', 'החברה תצטרך להתמודד עם המשבר'],
  words: [
    card({ surface: 'נאלצה', lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', tense: 'past', person_gender_number: '3fs', meaning_en: 'was forced to', governs: 'ל-', categories: ['conjugation', 'preposition-government'] }),
    card({ surface: 'ייקבעו', lemma: 'נקבע', pos: 'verb', root: 'ק.ב.ע', binyan: 'nifal', tense: 'future', person_gender_number: '3p', meaning_en: 'will be set', categories: ['conjugation'] }),
    card({ surface: 'להתמודד', lemma: 'התמודד', pos: 'verb', root: 'מ.ד.ד', binyan: 'hitpael', tense: 'infinitive', meaning_en: 'to cope, to deal with', governs: 'עם', categories: ['preposition-government'] }),
    card({ surface: 'להתבייש', lemma: 'התבייש', pos: 'verb', root: 'ב.ו.ש', binyan: 'hitpael', tense: 'infinitive', meaning_en: 'to be ashamed', governs: 'ב-', categories: ['letter-order'] }),
    card({ surface: 'רפורמה', lemma: 'רפורמה', meaning_en: 'a reform', pointed: { lemma: 'רֵפוֹרְמָה', surface: 'רֵפוֹרְמָה' } }),
    card({ surface: 'הסלמה', lemma: 'הסלמה', root: 'ס.ל.מ', meaning_en: 'escalation', categories: ['sound-pattern-deviation'] }),
  ],
};

export const LESSON2 = {
  title: 'שיעור עם גיא — 15 בספטמבר', lesson_date: '2026-09-15',
  sentences: ['ההסכם נחתם אתמול בלילה'],
  words: [
    card({ surface: 'נחתם', lemma: 'נחתם', pos: 'verb', root: 'ח.ת.מ', binyan: 'nifal', tense: 'past', person_gender_number: '3ms', meaning_en: 'was signed', categories: ['conjugation'] }),
    card({ surface: 'מקדם', lemma: 'קידם', pos: 'verb', root: 'ק.ד.מ', binyan: 'piel', tense: 'present', person_gender_number: 'ms', meaning_en: 'is promoting', categories: ['conjugation'] }),
    card({ surface: 'להמר', lemma: 'הימר', pos: 'verb', root: 'ה.מ.ר', binyan: 'piel', tense: 'infinitive', meaning_en: 'to gamble, to bet', governs: 'על', categories: ['preposition-government'] }),
    card({ surface: 'להתייבש', lemma: 'התייבש', pos: 'verb', root: 'י.ב.ש', binyan: 'hitpael', tense: 'infinitive', meaning_en: 'to dry out', categories: ['letter-order'] }),
    card({ surface: 'שוטטות', lemma: 'שוטטות', root: 'ש.ו.ט', meaning_en: 'wandering, roaming' }),
    card({ surface: 'שביתה', lemma: 'שביתה', root: 'ש.ב.ת', meaning_en: 'a strike', categories: ['homophonous-spelling'] }),
  ],
};

export const ARTICLE = {
  title: 'רפורמה במשק החשמל',
  text: 'הממסד הפוליטי התנגד לשינוי במשך שנים. בסוף השבוע הוועדה אישרה את התוכנית. זו מגמה ברורה בשוק האנרגיה.',
  words: [
    card({ surface: 'הממסד', lemma: 'ממסד', root: 'מ.ס.ד', meaning_en: 'the establishment', categories: ['homophonous-spelling'] }),
    card({ surface: 'אישרה', lemma: 'אישר', pos: 'verb', root: 'א.ש.ר', binyan: 'piel', tense: 'past', person_gender_number: '3fs', meaning_en: 'approved', categories: ['conjugation'] }),
    card({ surface: 'מגמה', lemma: 'מגמה', root: 'נ.ג.מ', meaning_en: 'a trend' }),
  ],
};

// Writes the material; `at` is the first touch's time, each word a minute
// after the one before, lesson 1 first, then lesson 2, then the article.
// `only` (optional): the surfaces to write, the rest left out. Answers
// { lessons: [id, id], article, spots: { surface -> spot id } }.
export function seed(db, dir, { at = '2026-09-01T09:00:00.000Z', only = null, status = 'shaky' } = {}) {
  const lookup = require(join(root, 'lib', 'lookup.js'));
  const raw = db.open(dir);
  let t = Date.parse(at);
  const spots = {};
  const put = (c, { lessonId, articleId, sentence }) => {
    if (only && !only.includes(c.surface)) return;
    const def = lookup.spotFor(c);
    db.ensureSpot({ ...def, categories: c.categories });
    db.putCard({ surface: c.surface, contextHash: lookup.contextHash(c.surface, sentence), spotId: def.id, card: c, sentence });
    db.addTouch({ spotId: def.id, articleId, lessonId, surface: c.surface });
    raw.prepare('UPDATE touches SET at = ? WHERE id = (SELECT MAX(id) FROM touches)').run(new Date(t).toISOString());
    raw.prepare('UPDATE spots SET status = ?, on_spine = 1 WHERE id = ?').run(status, def.id);
    t += 60000;
    spots[c.surface] = def.id;
  };
  const lessons = [];
  for (const L of [LESSON1, LESSON2]) {
    const items = [...L.words.map((w) => w.surface), ...L.sentences];
    const lesson = db.addLesson({ title: L.title, lesson_date: L.lesson_date, source_name: `${L.lesson_date}.pdf`, text: items.join('\n'), items });
    lessons.push(lesson.id);
    for (const w of L.words) put(w, { lessonId: lesson.id, sentence: w.surface });
  }
  const article = db.addArticle({ title: ARTICLE.title, text: ARTICLE.text });
  for (const w of ARTICLE.words) put(w, { articleId: article.id, sentence: '' });
  return { lessons, article: article.id, spots, raw };
}
