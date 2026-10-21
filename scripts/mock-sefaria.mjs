// A stand-in for Sefaria's Texts API (v3), for local checks only: the server
// reaches it through SEFARIA_URL as <base>/api/v3/texts/<reference>?version=
// hebrew&version=english. Three references are known, answered in Sefaria's
// own shape (the canonical `ref`, `primary_category`, `versions` with
// `language` and `text`):
//   Shabbat 112b      a list of segments, with <b> inside the English
//   Genesis 1:1-3     a list of segments, with <big> in the Hebrew and
//                     footnotes (a marker and its note) in the English
//   Ecclesiastes 1:9  one segment, as a string
// A reference is matched however it is written ("Shabbat.112b",
// "Shabbat_112b"); anything else answers 404 {"error": "Could not find title
// in reference: …"}, as Sefaria does. POST /control { mode, slow_ms } sets
// how every request is answered: 'ok' (default), 'slow' (after slow_ms,
// default 25 s), 'hang' (never), 'reset' (the connection dropped),
// 'status:<n>'. GET /calls answers { count, asked: [<reference as asked>] }.
//   node scripts/mock-sefaria.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2]) || 8892;
let mode = 'ok', slowMs = 25000;
const asked = [];

const TEXTS = {
  'Shabbat 112b': {
    primary_category: 'Talmud', book: 'Shabbat',
    he: ['קָרֵי עֲלֵיהּ: לֵית דֵּין בַּר אִינָשׁ.', 'אָמַר רַבִּי זֵירָא אָמַר רָבָא בַּר זִימּוּנָא: אִם רִאשׁוֹנִים בְּנֵי מַלְאָכִים — אָנוּ בְּנֵי אֲנָשִׁים. וְאִם רִאשׁוֹנִים בְּנֵי אֲנָשִׁים — אָנוּ כַּחֲמוֹרִים.'],
    en: ['<b>He exclaimed about him: This is not a human being.</b>', '<b>Rabbi Zeira said</b> that <b>Rava bar Zimuna said: If the early</b> generations <b>are</b> characterized as <b>sons of angels, we are the sons of men.</b>'],
  },
  'Genesis 1:1-3': {
    primary_category: 'Tanakh', book: 'Genesis',
    he: ['<big>בְּ</big>רֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃', 'וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ', 'וַיֹּ֥אמֶר אֱלֹהִ֖ים יְהִ֣י א֑וֹר וַֽיְהִי־אֽוֹר׃'],
    en: ['When God began to create<sup class="footnote-marker">a</sup><i class="footnote"><b>When God began to create </b>In contrast to others <i>In the beginning</i>.</i> heaven and earth— ', 'the earth being unformed and void— ', 'God said, “Let there be light”; and there was light. '],
  },
  'Ecclesiastes 1:9': {
    primary_category: 'Tanakh', book: 'Ecclesiastes',
    he: 'מַה־שֶּֽׁהָיָה֙ ה֣וּא שֶׁיִּהְיֶ֔ה וְאֵ֥ין כׇּל־חָדָ֖שׁ תַּ֥חַת הַשָּֽׁמֶשׁ׃',
    en: 'Only that shall happen which has happened, only that occur which has occurred; there is nothing new beneath the sun!',
  },
};

// "Shabbat.112b", "Shabbat_112b", "shabbat 112b" -> "Shabbat 112b"
const key = (r) => r.replace(/[._:\s]+/g, ' ').trim().toLowerCase();
const known = Object.fromEntries(Object.keys(TEXTS).map((r) => [key(r), r]));

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/calls') return json(200, { count: asked.length, asked });
  if (url.pathname === '/control' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => raw += c);
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.mode) mode = body.mode;
      if (body.slow_ms) slowMs = Number(body.slow_ms);
      json(200, { mode, slow_ms: slowMs });
    });
    return;
  }
  const m = /^\/api\/v3\/texts\/(.+)$/.exec(url.pathname);
  if (!m) return json(404, { error: `nothing at ${url.pathname}` });
  const tref = decodeURIComponent(m[1]);
  asked.push(tref);
  const answer = () => {
    const ref = known[key(tref)];
    if (!ref) return json(404, { error: `Could not find title in reference: ${tref}` });
    const t = TEXTS[ref];
    json(200, { ref, book: t.book, primary_category: t.primary_category, versions: [
      { language: 'he', versionTitle: 'Stand-in Hebrew', text: t.he },
      { language: 'en', versionTitle: 'Stand-in English', text: t.en },
    ] });
  };
  if (mode === 'hang') return;
  if (mode === 'reset') return req.socket.destroy();
  if (mode.startsWith('status:')) return json(Number(mode.slice(7)), { error: 'stand-in refusal' });
  if (mode === 'slow') return setTimeout(answer, slowMs);
  answer();
}).listen(port, () => console.log(`mock sefaria on ${port}`));
