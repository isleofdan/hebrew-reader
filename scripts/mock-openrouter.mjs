// A stand-in for OpenRouter for local checks: answers a fixed card for a few
// known surfaces and an {"error"} for anything it does not know. Counts calls
// so a test can prove the second lookup was served from the cache.
//   node scripts/mock-openrouter.mjs [port]
//
// The ask surface has four shapes a question can force, so the page can be
// checked against each. A question containing:
//   "no reference"  -> an answer with an empty links list
//   "in plain text" -> plain text instead of JSON
//   "a recipe"      -> {"error": ...}, the model declining
//   "while it is down" -> the socket dropped, so the call is unreachable
//   "list my map"   -> every surface the article context carried, echoed back
//
// A lesson guide ("Lesson: …" in the user message) is built from the items it
// is given, plus one invented vocabulary row, expression and card that the
// server must drop. An item containing "סירוב" makes it decline.
import http from 'node:http';

const port = Number(process.argv[2]) || 8791;
const known = {
  'נאלצה': { surface: 'נאלצה', lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', tense: 'past', person_gender_number: '3fs', meaning_en: 'was forced to', governs: 'ל-', categories: ['conjugation', 'preposition-government'], note: "Nif'al past of the root א.ל.צ; takes ל- plus an infinitive." },
  'שנאלצה': { surface: 'שנאלצה', lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', tense: 'past', person_gender_number: '3fs', meaning_en: 'which was forced to', governs: 'ל-', categories: ['conjugation', 'preposition-government'], note: "Prefix ש- on the Nif'al past of א.ל.צ." },
  'באמינות': { surface: 'באמינות', lemma: 'אמינות', pos: 'noun', root: 'א.מ.נ', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'reliability (with ב-)', governs: null, categories: ['homophonous-spelling'], note: null },
  'להתמודד': { surface: 'להתמודד', lemma: 'התמודד', pos: 'verb', root: 'מ.ד.ד', binyan: 'hitpael', tense: 'infinitive', person_gender_number: null, meaning_en: 'to cope, to deal with', governs: 'עם', categories: ['preposition-government'], note: null },
  'מקדם': { surface: 'מקדם', lemma: 'קידם', pos: 'verb', root: 'ק.ד.מ', binyan: 'piel', tense: 'present', person_gender_number: 'ms', meaning_en: 'is promoting', governs: null, categories: ['conjugation'], note: "Pi'el present of ק.ד.מ; the headline's verb." },
  'רפורמה': { surface: 'רפורמה', lemma: 'רפורמה', pos: 'noun', root: null, binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'a reform', governs: null, categories: [], note: null },
  'ייקבעו': { surface: 'ייקבעו', lemma: 'נקבע', pos: 'verb', root: 'ק.ב.ע', binyan: 'nifal', tense: 'future', person_gender_number: '3p', meaning_en: 'will be set', governs: null, categories: ['conjugation'], note: "Nif'al future with the doubled yod spelling." },
  // single-word items of the sample lessons (scripts/fixtures); הנהלה is left unknown on purpose
  'הסלמה': { surface: 'הסלמה', lemma: 'הסלמה', pos: 'noun', root: 'ס.ל.מ', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'escalation', governs: null, categories: [], note: null },
  'יו״ש': { surface: 'יו״ש', lemma: 'יו״ש', pos: 'proper-noun', root: null, binyan: null, tense: null, person_gender_number: null, meaning_en: 'Judea and Samaria (the West Bank)', governs: null, categories: [], note: 'An acronym: יהודה ושומרון.' },
  'נחתם': { surface: 'נחתם', lemma: 'נחתם', pos: 'verb', root: 'ח.ת.מ', binyan: 'nifal', tense: 'past', person_gender_number: '3ms', meaning_en: 'was signed', governs: null, categories: ['conjugation', 'homophonous-spelling'], note: "Nif'al past of ח.ת.מ." },
  'שביתה': { surface: 'שביתה', lemma: 'שביתה', pos: 'noun', root: 'ש.ב.ת', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'a strike', governs: null, categories: ['homophonous-spelling'], note: null },
  'להתבייש': { surface: 'להתבייש', lemma: 'התבייש', pos: 'verb', root: 'ב.ו.ש', binyan: 'hitpael', tense: 'infinitive', person_gender_number: null, meaning_en: 'to be ashamed', governs: 'ב-', categories: ['letter-order', 'preposition-government'], note: 'Not להתייבש (to dry out).' },
  'להתייבש': { surface: 'להתייבש', lemma: 'התייבש', pos: 'verb', root: 'י.ב.ש', binyan: 'hitpael', tense: 'infinitive', person_gender_number: null, meaning_en: 'to dry out', governs: null, categories: ['letter-order'], note: 'Not להתבייש (to be ashamed).' },
  // the prefixed-tinting check (session five): a saved word met again with ו/ה/ב/ל/מ/ש in front
  'הממסד': { surface: 'הממסד', lemma: 'ממסד', pos: 'noun', root: 'מ.ס.ד', binyan: null, tense: null, person_gender_number: 'ms', meaning_en: 'the establishment', governs: null, categories: ['homophonous-spelling'], note: 'ה- is the article; the word is ממסד.' },
  'דם': { surface: 'דם', lemma: 'דם', pos: 'noun', root: 'ד.מ.מ', binyan: null, tense: null, person_gender_number: 'ms', meaning_en: 'blood', governs: null, categories: [], note: null },
  'נלחם': { surface: 'נלחם', lemma: 'נלחם', pos: 'verb', root: 'ל.ח.מ', binyan: 'nifal', tense: 'past', person_gender_number: '3ms', meaning_en: 'fought', governs: 'ב-', categories: ['conjugation', 'preposition-government'], note: "Nif'al; fights ב- (in), not 'against'." },
};
let calls = 0;
let guides = 0;
let lastGuideModel = null;
// Set by a check through POST /control: model ids answered as not found.
// guide_faults: one fault per guide call, in order (see mockGuide).
// review: what the review pass does — 'fix-root' (the default: one root
// corrected), 'add-item' (the same, plus corrections naming items the guide
// does not have or text that is not there), 'decline', or 'whole-guide' (the
// guide written back instead of corrections, which the server must refuse).
// extra_cards: surface -> card, answered from now on (a word the mock did
// not know, known on the second try).
// card_overrides: surface -> card, answered in place of the known one (a card
// the card model got wrong, as it did לזנק live).
// review_extra: corrections the review adds to whatever its mode gives.
const control = { unknown_models: [], guide_faults: [], review: 'fix-root', extra_cards: {}, card_overrides: {}, review_extra: [] };
let lastReviewCards = null;
let reviews = 0;
let lastGuideNote = null;

const CATS = ['Nouns & Terms', 'Verbs', 'Expressions'];
const SPELLING = /[חכךאעסשטת]/;
const point = (w) => w[0] + '\u05b8' + w.slice(1); // one vowel point is enough for the check
const flagFor = (w) => (SPELLING.test(w) ? `⚠️ Spelling: mind the letters of ${w}` : 'no spelling trap');

// A guide gives a word's root and binyan as the right card has them (the
// known card, not an override), so a wrong card disagrees with the guide.
const BINYAN_NAME = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };
const rootOf = (w) => (known[w] && known[w].root) || '';
const binyanOf = (w) => (known[w] && known[w].binyan ? BINYAN_NAME[known[w].binyan] : '');

// A guide that passes the server's five checks (and still writes a for_guy,
// which the server must drop), unless `fault` names one to
// break: coverage, drill, nikud, flags or objects.
function mockGuide(items, date, n, fault) {
  const singles = items.filter((i) => !/\s/.test(i));
  const phrases = items.filter((i) => /\s/.test(i));
  const half = Math.ceil(items.length / 2);
  const g = {
    title: `שיעור עם גיא — ${date}`,
    date,
    sections: [
      { kind: 'expressions', items: [...phrases.slice(0, 4).map((p) => ({ he: p, en: `the phrase "${p}"`, usage: 'Heard in news commentary.', flags: '⚠️ Construction: the English says it differently.' })), { he: 'ביטוי מומצא', en: 'an invented expression', usage: '', flags: '' }] },
      { kind: 'topics', items: [`Nif'al in the news (build ${n})`, 'Prepositions that differ from English'] },
      { kind: 'grammar', topic: "Nif'al: passive and middle", guys_lines: items.slice(0, half), explanation: `${items[0]} — the lesson's first line. Nif'al marks what happens to the subject; להיאלץ takes no object, only ל- and an infinitive.`, examples: [{ he: items[0], en: 'the first line of the lesson' }], verb_claims: [{ verb: 'להיאלץ', takes_object: false }], for_guy: 'We looked at verbs where something happens to the subject.' },
      { kind: 'grammar', topic: 'News register', guys_lines: items.slice(half), explanation: 'The rest of the lesson: words and phrases from the news.', examples: [], verb_claims: [], for_guy: 'The news words.' },
      { kind: 'drills', verbs: [{ verb: 'להיאלץ', root: 'א.ל.צ', binyan: "Nif'al", deviation: 'guttural', takes_object: false, why: "Nif'al (1a) with a guttural first letter (1b); governs ל- (2).",
        table: [{ tense: 'past', forms: [{ person: '1s', he: 'נֶאֱלַצְתִּי' }, { person: '3ms', he: 'נֶאֱלַץ' }, { person: '3fs', he: 'נֶאֶלְצָה' }] },
                { tense: 'present', forms: [{ person: 'ms', he: 'נֶאֱלָץ' }, { person: 'fs', he: 'נֶאֱלֶצֶת' }] },
                { tense: 'future', forms: [{ person: '1s', he: 'אֵאָלֵץ' }, { person: '3ms', he: 'יֵאָלֵץ' }] }],
        deviations: 'The guttural א takes a hataf vowel where the template has a shva.', paal_comparison: "Pa'al אָלַץ (to force) is rare; the active form in use is the Pi'el אִלֵּץ.",
        exercises: [{ sentence: 'הממשלה ___ לדחות את ההצבעה.', cue: '3fs past', answer: 'נאלצה' }, { sentence: 'אני ___ לעבוד מהבית מחר.', cue: '1s future', answer: 'אאלץ' }, { sentence: 'הוא ___ לוותר.', cue: '3ms past', answer: 'נאלץ' }] }] },
      { kind: 'paper', prompts: [{ type: 'Root radiation map', anchor: 'ס.ל.ם', prompt: 'Put ס.ל.ם in the center and radiate outward to הסלמה and whatever else you recall. Where does the meaning stay military, and where does it go metaphorical?', categories: ['Verb conjugation production', 'Homophonous letter spelling'] }] },
      { kind: 'vocabulary', rows: [...singles.map((w, i) => ({ he: w, pointed: point(w), en: `meaning of ${w}`, root: rootOf(w), binyan: binyanOf(w), category: CATS[i % 3], flags: flagFor(w) })), { he: 'מילה שלא בשיעור', pointed: 'מִילָה', en: 'a word not in the lesson', root: '', binyan: '', category: 'Nouns & Terms', flags: '' }] },
      { kind: 'questions', items: ['מה הנושא העיקרי של השיעור?', 'איזה פועל בנפעל הופיע בשיעור?'] },
    ],
    cards: [...items.map((w, i) => [w, w, `translit-${i}`, `meaning of ${w}`, rootOf(w), binyanOf(w), CATS[i % 3], known[w] ? known[w].pos : 'phrase', w, `an example with ${w}`, [flagFor(w), i % 2 ? '⚠️ Prep: ל- where English has no preposition' : ''].filter(Boolean).join(' ')]),
      ['מוּמְצָא', 'מומצא', 'mumtza', 'invented', '', '', 'Nouns & Terms', 'noun', '', '', '']],
  };
  const grammar = g.sections.filter((x) => x.kind === 'grammar');
  const drill = g.sections.find((x) => x.kind === 'drills').verbs[0];
  const rows = g.sections.find((x) => x.kind === 'vocabulary').rows;
  if (fault === 'coverage') grammar[1].guys_lines.pop();
  if (fault === 'drill') Object.assign(drill, { verb: 'לכתוב', root: 'כ.ת.ב', binyan: "Pa'al", deviation: 'none', takes_object: true });
  if (fault === 'nikud') for (const r of rows) r.pointed = r.he;
  if (fault === 'flags') { for (const r of rows) r.flags = ''; for (const c of g.cards) c[10] = ''; }
  if (fault === 'objects') drill.takes_object = true;
  return g;
}
http.createServer((req, res) => {
  if (req.url === '/calls') { res.end(JSON.stringify({ calls, guides, reviews, last_guide_model: lastGuideModel, last_guide_note: lastGuideNote, last_review_cards: lastReviewCards })); return; }
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    if (req.url === '/control') { Object.assign(control, JSON.parse(raw || '{}')); res.end(JSON.stringify(control)); return; }
    calls++;
    if (!(req.headers.authorization || '').startsWith('Bearer ')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'No auth credentials found' } })); return; }
    const body = JSON.parse(raw);
    if (control.unknown_models.includes(body.model)) {
      // OpenRouter's own answer to a model id it does not list
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `${body.model} is not a valid model ID`, code: 400 } }));
      return;
    }
    const user = body.messages.find((m) => m.role === 'user').content;
    let answer;
    if (user.startsWith('Sentence: ')) {
      // a translation for the demand page: only the sample article's sentence is known
      const sentence = user.slice('Sentence: '.length);
      answer = sentence.includes('בשנים האחרונות')
        ? { translation_en: 'The company, which … in recent years to deal with a falling market share.' }
        : { error: 'this mock translates only the sample sentence' };
    } else if (user.startsWith('Question: ')) {
      // the ask surface: a fixed answer naming two references; with an article
      // context it lists the Nif'al forms the context carries
      const question = user.slice('Question: '.length).split('\n')[0];
      if (/while it is down/i.test(question)) { req.socket.destroy(); return; }
      if (/in plain text/i.test(question)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: "נאלץ is the Nif'al of א.ל.צ, 'to be forced'. Nothing here needs a reference." } }] }));
        return;
      }
      if (/a recipe/i.test(question)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ error: 'that is not a question about Hebrew' }) } }] }));
        return;
      }
      if (/no reference/i.test(question)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer: 'No Nif\'al verb form appears among the words of this piece on your map.', links: [] }) } }] }));
        return;
      }
      if (/list my map/i.test(question)) {
        const surfaces = [...user.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer: `On your map in this piece: ${surfaces.join(', ')}.`, links: [] }) } }] }));
        return;
      }
      const nifal = [...user.matchAll(/^- (\S+): root \S+, nifal/gm)].map((m) => m[1]);
      answer = /nif.?al/i.test(user) && user.includes('map (surface')
        ? { answer: nifal.length ? `The Nif'al forms on your map in this piece: ${nifal.join(', ')}.` : 'No Nif\'al form of this piece is on your map yet.', links: nifal.map((w) => ({ claim: w, reference: 'pealim', term: w })) }
        : { answer: "נאלץ is the Nif'al of א.ל.צ, 'to be forced'; it takes ל- plus an infinitive (not sure about older usage with את).", links: [{ claim: "Nif'al of א.ל.צ", reference: 'pealim', term: 'אלצ' }, { claim: 'takes ל- plus an infinitive', reference: 'wiktionary', term: 'נאלץ' }, { claim: 'older usage', reference: 'academy', term: 'נאלץ' }] };
    } else if (user.startsWith('Review: ')) {
      // the review answers corrections only, never the guide written out
      reviews++;
      const guide = JSON.parse(user.split('\n\nGuide:\n')[1]);
      const items = user.split('one per line:\n')[1].split('\n\n')[0].split('\n').filter(Boolean);
      const cardList = /\n\nWord cards saved from this lesson's single words \(\d+\):\n(.*)\n\nGuide:\n/.exec(user);
      lastReviewCards = cardList ? JSON.parse(cardList[1]) : (/single words: none yet\./.test(user) ? [] : null);
      const corrections = [...control.review_extra], remove = [];
      const row = guide.sections.find((x) => x.kind === 'vocabulary').rows.find((r) => r.root === 'ס.ל.מ');
      if (row && (control.review === 'fix-root' || control.review === 'add-item')) {
        corrections.push({ section: 'vocabulary', item: row.he, find: 'ס.ל.מ', replace: 'ס.ל.ם', why: `Root of ${row.he} corrected from ס.ל.מ to ס.ל.ם (a final mem; the root of סולם, a ladder).` });
      }
      if (control.review === 'add-item') {
        // what adding would look like through corrections: an item the guide does
        // not have, and text that is not in the item named
        const phrase = items.find((i) => /\s/.test(i));
        corrections.push({ section: 'vocabulary', item: phrase, find: '', replace: 'added by the review', why: `added ${phrase} to the vocabulary` });
        corrections.push({ section: 'cards', item: 'תוספת', find: 'x', replace: 'y', why: 'a card the lesson does not have' });
        corrections.push({ section: 'drills', item: 'להיאלץ', find: 'טקסט שאינו שם', replace: 'z', why: 'text that is not in the drill' });
      }
      if (/the flags check/.test(user.split('\n\nGuide:\n')[0])) {
        for (const r of guide.sections.find((x) => x.kind === 'vocabulary').rows) if (!r.flags) corrections.push({ section: 'vocabulary', item: r.he, field: 'flags', find: '', replace: `⚠️ Spelling: mind the letters of ${r.he}`, why: `Spelling flag added to ${r.he}.` });
        for (const c of guide.cards) if (!c[10]) corrections.push({ section: 'cards', item: c[1], field: 'notes', find: '', replace: `⚠️ Spelling: mind the letters of ${c[1]}`, why: `Spelling flag added to the card ${c[1]}.` });
      }
      answer = control.review === 'decline' ? { error: 'the reviewer declines in this mock' }
        : control.review === 'whole-guide' ? { guide, changes: [] }
        : { corrections, remove };
    } else if (user.startsWith('Lesson: ')) {
      guides++;
      lastGuideModel = body.model;
      const date = (/Lesson date: (\S+)/.exec(user) || [])[1] || 'unknown';
      const [itemText, note] = user.split('one per line:\n')[1].split('\n\n');
      const items = itemText.split('\n').filter(Boolean);
      lastGuideNote = note || null;
      answer = items.some((i) => i.includes('סירוב'))
        ? { error: 'these lines are not a lesson a guide can be built from' }
        : mockGuide(items, date, guides, control.guide_faults.shift());
    } else {
      const surface = /Surface: (\S+)/.exec(user)[1];
      answer = control.card_overrides[surface] || known[surface] || control.extra_cards[surface] || { error: `unknown word ${surface} in this mock` };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
  });
}).listen(port, () => console.log(`mock openrouter on ${port}`));
