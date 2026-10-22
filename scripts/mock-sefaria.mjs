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
// For Study (hebrew-study-one), in Sefaria's shapes too:
//   /api/shape/Tanakh  two books: Genesis (Torah, 50 chapters) and
//                      Ecclesiastes (Writings, 12)
//   /api/shape/Bavli   two tractates: Berakhot (Seder Zeraim, 127 sides, so
//                      2a to 64a) and Shabbat (Seder Moed, 314 sides, 2a to
//                      157b, with 3a empty)
//   /api/calendars     Daf Yomi "Berakhot 2" and Parashat Hashavua "Genesis
//                      1:1-6:8" (Bereshit), with the timezone and day asked
//   any chapter or daf side of those four: made up here, a few lines each
//                      with tags and a footnote in them, Genesis 2 with 45
//                      lines; `next` and `prev` within the book, null at its
//                      ends, as Sefaria answers; outside the book, 404 "Genesis
//                      ends at Chapter 50."
// POST /control { lengths: { Genesis: 51 } } changes a book's length in the
// shape (the contents' refresh), { daf: "<ref>" } today's Daf Yomi. These
// are counted in /calls as "shape:<corpus>" and "calendars?<query>".
//   node scripts/mock-sefaria.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2]) || 8892;
let mode = 'ok', slowMs = 25000;
const asked = [];
const lengths = { Genesis: 50, Ecclesiastes: 12, Berakhot: 127, Shabbat: 314 };
let dafToday = 'Berakhot 2';
const BOOKS = {
  Genesis: { corpus: 'Tanakh', section: 'Torah', he: 'בראשית' },
  Ecclesiastes: { corpus: 'Tanakh', section: 'Writings', he: 'קהלת' },
  Berakhot: { corpus: 'Bavli', section: 'Seder Zeraim', he: 'ברכות' },
  Shabbat: { corpus: 'Bavli', section: 'Seder Moed', he: 'שבת' },
};
const EMPTY = { Shabbat: [4] }; // daf sides with no text (index 4 = 3a)
const sideOf = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`;
const indexOf = (daf, side) => (daf - 1) * 2 + (side === 'b' ? 1 : 0);
const linesIn = (book, i) => (book === 'Genesis' && i === 2 ? 45 : 4 + (i % 3));
function shape(corpus) {
  return Object.entries(BOOKS).filter(([, b]) => b.corpus === corpus).map(([title, b]) => {
    const n = lengths[title];
    const chapters = corpus === 'Tanakh' ? Array.from({ length: n }, (_, i) => linesIn(title, i + 1))
      : Array.from({ length: n }, (_, i) => (i < 2 || (EMPTY[title] || []).includes(i) ? 0 : linesIn(title, i)));
    return { section: b.section, heTitle: b.he, title, length: n, chapters, book: title, heBook: b.he };
  });
}
// A page of one of the four books, made up: { ref, heRef, next, prev, he, en }
// or { error }.
function madePage(tref) {
  const m = /^([a-z]+) (\d+)([ab])?$/i.exec(tref.replace(/[._:\s]+/g, ' ').trim());
  const title = m && Object.keys(BOOKS).find((t) => t.toLowerCase() === m[1].toLowerCase());
  if (!title) return null;
  const b = BOOKS[title], n = Number(m[2]);
  if (b.corpus === 'Tanakh') {
    if (m[3]) return { error: `Could not find title in reference: ${tref}` };
    if (n < 1 || n > lengths[title]) return { error: `${title} ends at Chapter ${lengths[title]}.` };
    const count = linesIn(title, n);
    const he = Array.from({ length: count }, (_, i) => `<big>ו</big>ַיְהִי ${b.he} ${n}:${i + 1}`);
    const en = Array.from({ length: count }, (_, i) => `<b>Line ${i + 1}</b> of ${title} ${n}${i === 1 ? '<sup class="footnote-marker">a</sup><i class="footnote">A stand-in <i>note</i>.</i>' : ''}.`);
    if (title === 'Genesis' && n === 1) for (let i = 0; i < 3; i++) { he[i] = TEXTS['Genesis 1:1-3'].he[i]; en[i] = TEXTS['Genesis 1:1-3'].en[i]; }
    return { ref: `${title} ${n}`, heRef: `${b.he} ${n}`, next: n < lengths[title] ? `${title} ${n + 1}` : null, prev: n > 1 ? `${title} ${n - 1}` : null, primary_category: 'Tanakh', book: title, he, en };
  }
  const i = indexOf(n, (m[3] || 'a').toLowerCase());
  const last = lengths[title] - 1;
  if (i < 2 || (EMPTY[title] || []).includes(i)) return { error: `We have no text for ${title} ${sideOf(i)}.` };
  if (i > last) return { error: `${title} ends at Daf ${sideOf(last)}.` };
  const count = linesIn(title, i);
  const he = Array.from({ length: count }, (_, k) => `<b>אָמַר</b> רַבִּי ${b.he} ${sideOf(i)}:${k + 1}`);
  const en = Array.from({ length: count }, (_, k) => `<b>Rabbi said</b> line ${k + 1} of ${title} ${sideOf(i)}${k === 0 ? '<sup class="footnote-marker">1</sup><i class="footnote">A note.</i>' : ''}.`);
  const step = (from, d) => { for (let j = from + d; j >= 2 && j <= last; j += d) if (!(EMPTY[title] || []).includes(j)) return `${title} ${sideOf(j)}`; return null; };
  return { ref: `${title} ${sideOf(i)}`, heRef: `${b.he} ${sideOf(i)}`, next: step(i, 1), prev: step(i, -1), primary_category: 'Talmud', book: title, he, en };
}

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
      if (body.lengths) Object.assign(lengths, body.lengths);
      if (body.daf) dafToday = body.daf;
      json(200, { mode, slow_ms: slowMs, lengths, daf: dafToday });
    });
    return;
  }
  const sh = /^\/api\/shape\/(Tanakh|Bavli)$/.exec(url.pathname);
  const cal = url.pathname === '/api/calendars';
  const m = /^\/api\/v3\/texts\/(.+)$/.exec(url.pathname);
  if (!m && !sh && !cal) return json(404, { error: `nothing at ${url.pathname}` });
  const tref = m ? decodeURIComponent(m[1]) : '';
  asked.push(sh ? `shape:${sh[1]}` : cal ? `calendars${url.search}` : tref);
  const answer = () => {
    if (sh) return json(200, shape(sh[1]));
    if (cal) {
      return json(200, { date: [url.searchParams.get('year'), url.searchParams.get('month'), url.searchParams.get('day')].join('-'), timezone: url.searchParams.get('timezone'), calendar_items: [
        { title: { en: 'Parashat Hashavua', he: 'פרשת השבוע' }, displayValue: { en: 'Bereshit', he: 'בראשית' }, ref: 'Genesis 1:1-6:8', url: 'Genesis.1.1-6.8', category: 'Tanakh', order: 1 },
        { title: { en: 'Daf Yomi', he: 'דף יומי' }, displayValue: { en: dafToday, he: 'ברכות ב׳' }, ref: dafToday, url: dafToday.replace(/ /g, '.'), category: 'Talmud', order: 3 },
        { title: { en: 'Daily Mishnah', he: 'משנה יומית' }, displayValue: { en: 'Mishnah Oholot 11:8-9', he: '' }, ref: 'Mishnah Oholot 11:8-9', url: 'Mishnah_Oholot.11.8-9', category: 'Mishnah', order: 5 },
      ] });
    }
    const ref = known[key(tref)];
    if (!ref) {
      const made = madePage(tref);
      if (!made) return json(404, { error: `Could not find title in reference: ${tref}` });
      if (made.error) return json(404, { error: made.error });
      return json(200, { ref: made.ref, heRef: made.heRef, next: made.next, prev: made.prev, book: made.book, primary_category: made.primary_category, versions: [
        { language: 'he', versionTitle: 'Stand-in Hebrew', text: made.he },
        { language: 'en', versionTitle: 'Stand-in English', text: made.en },
      ] });
    }
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
