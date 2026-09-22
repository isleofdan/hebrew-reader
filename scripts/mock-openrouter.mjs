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
};
let calls = 0;
let guides = 0;

const CATS = ['Nouns & Terms', 'Verbs', 'Expressions'];
function mockGuide(items, date, n) {
  const singles = items.filter((i) => !/\s/.test(i));
  const phrases = items.filter((i) => /\s/.test(i));
  return {
    title: `שיעור עם גיא — ${date}`,
    date,
    sections: [
      { kind: 'expressions', items: [...phrases.slice(0, 4).map((p) => ({ he: p, en: `the phrase "${p}"`, usage: 'Heard in news commentary.', flags: '⚠️ Construction: the English says it differently.' })), { he: 'ביטוי מומצא', en: 'an invented expression', usage: '', flags: '' }] },
      { kind: 'topics', items: [`Nif'al in the news (build ${n})`, 'Prepositions that differ from English'] },
      { kind: 'grammar', topic: "Nif'al: passive and middle", explanation: `${items[0]} — the lesson's first line. Nif'al marks what happens to the subject.`, examples: [{ he: items[0], en: 'the first line of the lesson' }], for_guy: 'We looked at verbs where something happens to the subject.' },
      { kind: 'drills', verbs: [{ verb: 'להיאלץ', root: 'א.ל.צ', binyan: "Nif'al", why: "Nif'al (1a) with a guttural first letter (1b); governs ל- (2).",
        table: [{ tense: 'past', forms: [{ person: '1s', he: 'נֶאֱלַצְתִּי' }, { person: '3ms', he: 'נֶאֱלַץ' }, { person: '3fs', he: 'נֶאֶלְצָה' }] },
                { tense: 'present', forms: [{ person: 'ms', he: 'נֶאֱלָץ' }, { person: 'fs', he: 'נֶאֱלֶצֶת' }] },
                { tense: 'future', forms: [{ person: '1s', he: 'אֵאָלֵץ' }, { person: '3ms', he: 'יֵאָלֵץ' }] }],
        deviations: 'The guttural א takes a hataf vowel where the template has a shva.', paal_comparison: "Pa'al אָלַץ (to force) is rare; the active form in use is the Pi'el אִלֵּץ.",
        exercises: [{ sentence: 'הממשלה ___ לדחות את ההצבעה.', cue: '3fs past', answer: 'נאלצה' }, { sentence: 'אני ___ לעבוד מהבית מחר.', cue: '1s future', answer: 'אאלץ' }, { sentence: 'הוא ___ לוותר.', cue: '3ms past', answer: 'נאלץ' }] }] },
      { kind: 'paper', prompts: [{ type: 'Root radiation map', anchor: 'ס.ל.מ', prompt: 'Put ס.ל.מ in the center and radiate outward to הסלמה and whatever else you recall. Where does the meaning stay military, and where does it go metaphorical?', categories: ['Verb conjugation production', 'Homophonous letter spelling'] }] },
      { kind: 'vocabulary', rows: [...singles.map((w, i) => ({ he: w, en: `meaning of ${w}`, root: i % 2 ? 'ס.ל.מ' : '', binyan: i % 2 ? "Hif'il" : '', category: CATS[i % 3] })), { he: 'מילה שלא בשיעור', en: 'a word not in the lesson', root: '', binyan: '', category: 'Nouns & Terms' }] },
      { kind: 'questions', items: ['מה הנושא העיקרי של השיעור?', 'איזה פועל בנפעל הופיע בשיעור?'] },
    ],
    cards: [...items.map((w, i) => [w, w, `translit-${i}`, `meaning of ${w}`, i % 2 ? 'ס.ל.מ' : '', i % 2 ? "Hif'il" : '', CATS[i % 3], i % 2 ? 'verb' : 'noun', w, `an example with ${w}`, i % 2 ? '⚠️ Prep: ל- where English has no preposition' : '']),
      ['מוּמְצָא', 'מומצא', 'mumtza', 'invented', '', '', 'Nouns & Terms', 'noun', '', '', '']],
  };
}
http.createServer((req, res) => {
  if (req.url === '/calls') { res.end(JSON.stringify({ calls, guides })); return; }
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    calls++;
    if (!(req.headers.authorization || '').startsWith('Bearer ')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'No auth credentials found' } })); return; }
    const body = JSON.parse(raw);
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
    } else if (user.startsWith('Lesson: ')) {
      guides++;
      const date = (/Lesson date: (\S+)/.exec(user) || [])[1] || 'unknown';
      const items = user.split('one per line:\n')[1].split('\n').filter(Boolean);
      answer = items.some((i) => i.includes('סירוב'))
        ? { error: 'these lines are not a lesson a guide can be built from' }
        : mockGuide(items, date, guides);
    } else {
      const surface = /Surface: (\S+)/.exec(user)[1];
      answer = known[surface] || { error: `unknown word ${surface} in this mock` };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
  });
}).listen(port, () => console.log(`mock openrouter on ${port}`));
