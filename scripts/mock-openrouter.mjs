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
  // the desk (session twelve): a verb from the 9 Feb lesson, and the 26 Jan
  // verbal noun as the card maker now labels it
  'להמר': { surface: 'להמר', lemma: 'הימר', pos: 'verb', root: 'ה.מ.ר', binyan: 'piel', tense: 'infinitive', person_gender_number: null, meaning_en: 'to gamble, to bet', governs: 'על', categories: ['preposition-government'], note: "Pi'el infinitive; bets על something." },
  'שוטטות': { surface: 'שוטטות', lemma: 'שוטטות', pos: 'noun', root: 'ש.ו.ט', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'wandering, roaming', governs: null, categories: [], note: 'A verbal noun of the Polel שוטט.' },
  'נלחם': { surface: 'נלחם', lemma: 'נלחם', pos: 'verb', root: 'ל.ח.מ', binyan: 'nifal', tense: 'past', person_gender_number: '3ms', meaning_en: 'fought', governs: 'ב-', categories: ['conjugation', 'preposition-government'], note: "Nif'al; fights ב- (in), not 'against'." },
};
// Nikud for the words above (session seven): the card answers carry it, and
// the small call that adds it to a card cached before cards had it answers it.
// Dictionary spelling on purpose where it drops a vowel letter (קִדֵּם for קידם).
const POINTED = {
  'נאלצה': ['נֶאֱלַץ', 'נֶאֶלְצָה'], 'שנאלצה': ['נֶאֱלַץ', 'שֶׁנֶּאֶלְצָה'], 'באמינות': ['אֲמִינוּת', 'בָּאֲמִינוּת'],
  'להתמודד': ['הִתְמוֹדֵד', 'לְהִתְמוֹדֵד'], 'מקדם': ['קִדֵּם', 'מְקַדֵּם'], 'רפורמה': ['רֵפוֹרְמָה', 'רֵפוֹרְמָה'],
  'ייקבעו': ['נִקְבַּע', 'יִיקָּבְעוּ'], 'נחתם': ['נֶחְתַּם', 'נֶחְתַּם'], 'הסלמה': ['הַסְלָמָה', 'הַסְלָמָה'], 'דם': ['דָּם', 'דָּם'],
  'להמר': ['הִימֵּר', 'לְהַמֵּר'], 'שוטטות': ['שׁוֹטְטוּת', 'שׁוֹטְטוּת'],
};
for (const [w, [lemma, surface]] of Object.entries(POINTED)) if (known[w]) Object.assign(known[w], { lemma_pointed: lemma, surface_pointed: surface });
// The corrected cards' nikud, as the refresh answers it: לזנק in Pi'el.
const REPOINTED = { 'לזנק piel': ['זִנֵּק', 'לְזַנֵּק'], 'נלחם piel': ['נִלְחֵם', 'נִלְחֵם'], 'נוצץ paal': ['נָצַץ', 'נוֹצֵץ'], 'נחתם nifal': ['נֶחְתַּם', 'נֶחְתַּם'] };
let pointsCalls = 0, refreshCalls = 0;
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
// review_format: how the review's answer is written — 'clean' (the JSON
// alone), 'fenced' (in a ```json fence), 'prose' (after a line of prose),
// 'truncated' (cut off mid-object, finish_reason "length") or 'garbage' (no
// JSON at all). review_format_again: the same for the answer to the one
// follow-up ask. schema_refused: structured output answered 404, as OpenRouter
// does when no provider of the model takes the parameters asked for.
const control = { unknown_models: [], guide_faults: [], review: 'fix-root', extra_cards: {}, card_overrides: {}, review_extra: [], review_format: 'clean', review_format_again: 'clean', schema_refused: false, verb_fixes: {}, verb_extra: [], verb_decline: false, guide_silent: [], refresh_fail: false, review_verdicts: {}, review_verdict_extra: [], examples: null };
// verb_fixes: word -> { root?, binyan?, why }, the verb-card check's fix for
// that card (every other card answered "correct"); verb_extra: answers added
// after the cards'; verb_decline: the check answers {"error"}.
let verbChecks = 0, lastVerbCards = null, lastVerbAsk = null;
let lastReviewCards = null;
let reviews = 0;
// every review request: its response_format type and whether it was the follow-up
const reviewAsks = [];
let lastGuideNote = null;

const CATS = ['Nouns & Terms', 'Verbs', 'Expressions'];
const SPELLING = /[חכךאעסשטת]/;
const point = (w) => w[0] + '\u05b8' + w.slice(1); // one vowel point is enough for the check
const flagFor = (w) => (SPELLING.test(w) ? `⚠️ Spelling: mind the letters of ${w}` : 'no spelling trap');

// A guide gives a word's root and binyan as the right card has them (the
// known card, not an override), so a wrong card disagrees with the guide.
const BINYAN_NAME = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };
// guide_silent: words the guide gives no root or binyan for, so the review
// says nothing of their cards (as it said nothing of לזנק live)
const rootOf = (w) => (control.guide_silent.includes(w) ? '' : (known[w] && known[w].root) || '');
const binyanOf = (w) => (control.guide_silent.includes(w) ? '' : known[w] && known[w].binyan ? BINYAN_NAME[known[w].binyan] : '');

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
// --- the web search server tool (session thirteen) --------------------------------------
// A call carrying tools gets an answer shaped as OpenRouter's: the text in
// message.content, the pages the search leaned on as url_citation
// annotations, and usage.server_tool_use.web_search_requests.
// "Ask here" ("The card:" … "Question: …"): a question containing
//   "without a link" -> an answer with no annotation at all
//   "link in the text" -> the link written in the answer, no annotation
//   "decline"          -> {"error"}
//   anything else      -> an answer whose links are only in the annotations
// "Find more examples" ("The word: …"): control.examples, when set, is the
// list answered; else five examples for להמר, one without a url, and from
// the second search on one more with a new url each time.
let searchCalls = 0, exampleCalls = 0;
const searchAsks = [];
function webSearch(res, body, user) {
  searchCalls++;
  const tool = body.tools[0];
  searchAsks.push({ tool: tool.type, parameters: tool.parameters || {}, response_format: body.response_format || null, max_tokens: body.max_tokens, kind: user.startsWith('The card:') ? 'ask' : 'examples', has_entry: /Root: /.test(user), has_layers: /What the reader has added/.test(user) });
  let content, cites = [];
  const cite = (url, title) => ({ type: 'url_citation', url_citation: { url, title, content: `from ${title}`, start_index: 0, end_index: 10 } });
  if (user.startsWith('The card:')) {
    const q = user.split('\n\nQuestion: ')[1] || '';
    if (/decline/i.test(q)) content = JSON.stringify({ error: 'that is not a question about Hebrew' });
    else if (/link in the text/i.test(q)) content = JSON.stringify({ answer: 'להמר is Pi\'el; see https://www.pealim.com/dict/479-lehamer/ for its forms.' });
    else {
      content = JSON.stringify({ answer: 'להמר (Pi\'el of ה.מ.ר) is to bet or gamble, and takes על; לסכן is to put at risk, and takes an object (not sure about formal usage).' });
      if (!/without a link/i.test(q)) cites = [cite('https://www.pealim.com/dict/479-lehamer/', 'להמר – Pealim'), cite('https://milog.co.il/%D7%9C%D7%94%D7%9E%D7%A8', 'מה זה להמר – מילוג'), cite('https://www.pealim.com/dict/479-lehamer/', 'להמר – Pealim')];
    }
  } else {
    exampleCalls++;
    let list = control.examples;
    if (!list) {
      list = [
        { sentence: 'המשקיעים החליטו להמר על מניות הטכנולוגיה.', source_name: 'ynet', source_kind: 'news', date: '2026-09-18', url: 'https://www.ynet.co.il/economy/article/abc1' },
        { sentence: 'והימר על כל הקופה בערב אחד.', source_name: 'כאן 11', source_kind: 'tv', date: null, url: 'https://www.kan.org.il/content/kan/kan-11/p-1/clip-3' },
        { sentence: 'הוא אמר שלהמר על זה עכשיו זו טעות.', source_name: 'בלוג כלכלה', source_kind: 'blog', date: '2026-08', url: 'https://blog.example.co.il/post/7' },
        { sentence: 'לא כדאי להמר ביום שישי בערב.', source_name: 'פורום', source_kind: 'forum', date: 'last week', url: 'https://forum.example.co.il/t/9' },
        { sentence: 'מי שמהמר צריך לדעת להפסיד.', source_name: 'אתר בלי כתובת', source_kind: 'other', date: null, url: '' },
      ];
      if (exampleCalls > 1) list = [...list, { sentence: `הם בחרו להמר שוב (${exampleCalls}).`, source_name: 'גלובס', source_kind: 'news', date: '2026-09-20', url: `https://www.globes.co.il/news/article-${exampleCalls}` }];
    }
    content = JSON.stringify({ examples: list });
    cites = list.filter((x) => x.url).map((x) => cite(x.url, x.source_name));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content, annotations: cites }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 900, completion_tokens: 300, server_tool_use: { web_search_requests: 2 } } }));
}

http.createServer((req, res) => {
  if (req.url === '/calls') { res.end(JSON.stringify({ search_calls: searchCalls, search_asks: searchAsks, calls, points_calls: pointsCalls, refresh_calls: refreshCalls, guides, reviews, review_asks: reviewAsks, last_guide_model: lastGuideModel, last_guide_note: lastGuideNote, last_review_cards: lastReviewCards, verb_checks: verbChecks, last_verb_cards: lastVerbCards, last_verb_ask: lastVerbAsk })); return; }
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
    if (Array.isArray(body.tools) && body.tools.length) return webSearch(res, body, user);
    const followUp = body.messages.length > 2;
    let answer, format = 'clean';
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
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer: 'No Nif\'al verb form appears among the words of this piece you have looked up.', links: [] }) } }] }));
        return;
      }
      if (/list my map/i.test(question)) {
        const surfaces = [...user.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer: `Your words in this piece: ${surfaces.join(', ')}.`, links: [] }) } }] }));
        return;
      }
      const nifal = [...user.matchAll(/^- (\S+): root \S+, nifal/gm)].map((m) => m[1]);
      answer = /nif.?al/i.test(user) && user.includes('looked up or saved (surface')
        ? { answer: nifal.length ? `The Nif'al forms among your words in this piece: ${nifal.join(', ')}.` : 'None of your words in this piece is a Nif\'al form yet.', links: nifal.map((w) => ({ claim: w, reference: 'pealim', term: w })) }
        : { answer: "נאלץ is the Nif'al of א.ל.צ, 'to be forced'; it takes ל- plus an infinitive (not sure about older usage with את).", links: [{ claim: "Nif'al of א.ל.צ", reference: 'pealim', term: 'אלצ' }, { claim: 'takes ל- plus an infinitive', reference: 'wiktionary', term: 'נאלץ' }, { claim: 'older usage', reference: 'academy', term: 'נאלץ' }] };
    } else if (user.startsWith('Verb cards of the lesson ')) {
      verbChecks++;
      lastVerbCards = user.split('one per line:\n')[1].split('\n').filter(Boolean).map((l) => JSON.parse(l));
      lastVerbAsk = { type: body.response_format && body.response_format.type, schema_name: body.response_format && body.response_format.json_schema ? body.response_format.json_schema.name : null, max_tokens: body.max_tokens, model: body.model };
      answer = control.verb_decline ? { error: 'the checker declines in this mock' } : { cards: [
        ...lastVerbCards.map((c) => {
          const fix = control.verb_fixes[c.word];
          return fix ? { word: c.word, verdict: 'fix', root: fix.root || c.root, binyan: fix.binyan || c.binyan, why: fix.why || '' } : { word: c.word, verdict: 'correct', root: c.root, binyan: c.binyan, why: '' };
        }),
        ...control.verb_extra,
      ] };
    } else if (user.startsWith('Review: ')) {
      // the review answers corrections only, never the guide written out
      const type = body.response_format && body.response_format.type;
      if (control.schema_refused && type === 'json_schema') {
        reviewAsks.push({ type, follow_up: followUp, refused: true });
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'No endpoints found that can handle the requested parameters.', code: 404 } }));
        return;
      }
      reviews++;
      reviewAsks.push({ type, follow_up: followUp, schema_name: type === 'json_schema' ? body.response_format.json_schema.name : null, require_parameters: Boolean(body.provider && body.provider.require_parameters), max_tokens: body.max_tokens, last: followUp ? body.messages.at(-1).content : null });
      format = followUp ? control.review_format_again : control.review_format;
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
      // the review's verdict on every verb card (session ten): review_verdicts
      // names one outright (null: none given); else its word_cards fix; else
      // what its own guide's vocabulary row gives; a guide silent on the word
      // gives no verdict
      const verbCards = [];
      const keyOf = (b) => Object.keys(BINYAN_NAME).find((k) => BINYAN_NAME[k] === b || k === b) || b;
      for (const c of (lastReviewCards || []).filter((x) => x.pos === 'verb')) {
        if (c.word in control.review_verdicts) { const v = control.review_verdicts[c.word]; if (v) verbCards.push({ word: c.word, verdict: 'fix', root: c.root || '', binyan: c.binyan || '', why: '', ...v }); continue; }
        // a word_cards "fix" whose find and replace are the same is no fix: correct
        const extra = control.review_extra.filter((x) => x.section === 'word_cards' && x.item === c.word);
        if (extra.length && extra.every((x) => x.find === x.replace)) { verbCards.push({ word: c.word, verdict: 'correct', root: c.root || '', binyan: c.binyan || '', why: '' }); continue; }
        if (extra.length) { const v = { word: c.word, verdict: 'fix', root: c.root || '', binyan: c.binyan || '', why: extra[0].why }; for (const x of extra) v[x.field] = x.replace; verbCards.push(v); continue; }
        const row = guide.sections.find((x) => x.kind === 'vocabulary').rows.find((r) => r.he === c.word);
        if (!row || !row.binyan) continue;
        const right = keyOf(row.binyan) === c.binyan && (!row.root || row.root === c.root);
        verbCards.push(right ? { word: c.word, verdict: 'correct', root: c.root || '', binyan: c.binyan || '', why: '' }
          : { word: c.word, verdict: 'fix', root: row.root || c.root || '', binyan: row.binyan, why: "as the guide gives it" });
      }
      answer = control.review === 'decline' ? { error: 'the reviewer declines in this mock' }
        : control.review === 'whole-guide' ? { guide, changes: [] }
        : { corrections, remove, verb_cards: [...verbCards, ...control.review_verdict_extra] };
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
    } else if (user.startsWith('Corrected card\n')) {
      // a corrected card re-pointed and its note written again (session nine);
      // refresh_fail: the call declines
      refreshCalls++;
      const f = (k) => (new RegExp(`${k}: (.*)`).exec(user) || [])[1];
      const lemma = f('Lemma'), surface = f('Surface'), binyan = f('Binyan');
      const name = BINYAN_NAME[binyan] || binyan;
      const p = REPOINTED[`${surface} ${binyan}`];
      answer = control.refresh_fail ? { error: 'the pointer declines in this mock' }
        : { lemma_pointed: p ? p[0] : lemma === '(none)' ? '' : point(lemma), surface_pointed: p ? p[1] : point(surface), note: `${name} of ${f('Root')}, as corrected.` };
    } else if (/\nLemma: /.test(user)) {
      // nikud only, for a card cached before cards carried it
      pointsCalls++;
      const surface = /Surface: (\S+)/.exec(user)[1];
      const p = POINTED[surface];
      answer = p ? { lemma_pointed: p[0], surface_pointed: p[1] } : { lemma_pointed: '', surface_pointed: surface };
    } else {
      const surface = /Surface: (\S+)/.exec(user)[1];
      answer = control.card_overrides[surface] || known[surface] || control.extra_cards[surface] || { error: `unknown word ${surface} in this mock` };
    }
    const json = JSON.stringify(answer);
    const content = format === 'fenced' ? `\`\`\`json\n${json}\n\`\`\``
      : format === 'prose' ? `Here are the corrections I found after checking the guide against the lesson.\n${json}\nThat is all.`
      : format === 'truncated' ? json.slice(0, Math.max(20, Math.floor(json.length / 2)))
      : format === 'garbage' ? 'I reviewed the guide. The root of הסלמה should be ס.ל.ם, and the rest looks right to me.' + ' More notes on the guide follow.'.repeat(120)
      : json;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content }, finish_reason: format === 'truncated' ? 'length' : 'stop' }] }));
  });
}).listen(port, () => console.log(`mock openrouter on ${port}`));
