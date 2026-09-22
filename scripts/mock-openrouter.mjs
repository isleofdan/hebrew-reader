// A stand-in for OpenRouter for local checks: answers a fixed card for a few
// known surfaces and an {"error"} for anything it does not know. Counts calls
// so a test can prove the second lookup was served from the cache.
//   node scripts/mock-openrouter.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2]) || 8791;
const known = {
  'נאלצה': { surface: 'נאלצה', lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', tense: 'past', person_gender_number: '3fs', meaning_en: 'was forced to', governs: 'ל-', categories: ['conjugation', 'preposition-government'], note: "Nif'al past of the root א.ל.צ; takes ל- plus an infinitive." },
  'שנאלצה': { surface: 'שנאלצה', lemma: 'נאלץ', pos: 'verb', root: 'א.ל.צ', binyan: 'nifal', tense: 'past', person_gender_number: '3fs', meaning_en: 'which was forced to', governs: 'ל-', categories: ['conjugation', 'preposition-government'], note: "Prefix ש- on the Nif'al past of א.ל.צ." },
  'באמינות': { surface: 'באמינות', lemma: 'אמינות', pos: 'noun', root: 'א.מ.נ', binyan: null, tense: null, person_gender_number: 'fs', meaning_en: 'reliability (with ב-)', governs: null, categories: ['homophonous-spelling'], note: null },
  'להתמודד': { surface: 'להתמודד', lemma: 'התמודד', pos: 'verb', root: 'מ.ד.ד', binyan: 'hitpael', tense: 'infinitive', person_gender_number: null, meaning_en: 'to cope, to deal with', governs: 'עם', categories: ['preposition-government'], note: null },
  'ייקבעו': { surface: 'ייקבעו', lemma: 'נקבע', pos: 'verb', root: 'ק.ב.ע', binyan: 'nifal', tense: 'future', person_gender_number: '3p', meaning_en: 'will be set', governs: null, categories: ['conjugation'], note: "Nif'al future with the doubled yod spelling." },
};
let calls = 0;
http.createServer((req, res) => {
  if (req.url === '/calls') { res.end(JSON.stringify({ calls })); return; }
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', () => {
    calls++;
    if (!(req.headers.authorization || '').startsWith('Bearer ')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'No auth credentials found' } })); return; }
    const body = JSON.parse(raw);
    const user = body.messages.find((m) => m.role === 'user').content;
    const surface = /Surface: (\S+)/.exec(user)[1];
    const answer = known[surface] || { error: `unknown word ${surface} in this mock` };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }] }));
  });
}).listen(port, () => console.log(`mock openrouter on ${port}`));
