// A stand-in for the seven reference sites, for local checks only: the
// server reaches it through REFERENCE_STANDIN as <base>/<reference id>/<term>.
// Each reference answers a small page holding the term, with the things a
// copy must lose (a script, an inline handler, a form's controls, a
// javascript: link, a frame) and keep (a heading, a table, an image, text
// inside a form, a relative link). POST /control { <id>: how } sets how one
// reference answers: 'page' (default), 'slow' (the page after `slow_ms`,
// default 10 s), 'hang' (never answers), 'reset' (drops the connection),
// 'status:<n>' (that status), 'blank' (a 200 with no text, as a bot check),
// 'redirect:<path>' (a 302 to that path on the stand-in). A path
// /site/<scheme>/<host>/<rest> stands for <scheme>://<host>/<rest> (the
// server reads it back so: its redirect gate) and answers a page. GET /calls counts the requests per reference.
//
// hebrew-english-one: the two English sites, from pages saved live on 23 Oct
// 2026 (scripts/fixtures/english/). /pealim/<English text> answers Pealim's
// English search: its results page for "run" (ten rows, לָרוּץ the
// second), a results page for "credibility" made from the same markup with
// one row, אֲמִינוּת (built here, not saved: Wiktionary lists the word too,
// so it shows the merge), one for "credence" the same way with אֵמוּן, and
// its "No results for" page for anything else;
// 'changed' (POST /control { pealim: 'changed' }) answers a page with no
// results table and no "No results". /enwiktionary/<page> answers
// Wiktionary's API (action=parse, the wikitext as JSON): the saved answers
// for credibility, reliability, run, run/translations and trust, and (saved
// the same day, for run's {{trans-see}} senses) smuggle, voyage and trial;
// Knesset (built here: a page found only as typed, capitalised); trustiness
// (built here: its only translations a {{trans-see}} to trust's first
// sense, so the Hebrew comes from the entry it names); and the saved
// "missingtitle" answer for any other page. /calls counts them as
// pealim:english and enwiktionary, apart from the Hebrew tabs' pealim.
//   node scripts/mock-references.mjs [port]
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]) || 8853;
const how = {};
let slowMs = 10000;
const calls = {};

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'english');
const saved = (name) => readFileSync(join(fixtures, name), 'utf8');
const pealimRun = saved('pealim-run.html');
const pealimNone = saved('pealim-reliability.html');
// the run page's markup with one row of its own
const tbody = /<tbody>[\s\S]*<\/tbody>/;
const pealimRow = (path, he, tr, root, pos, meaning) => `<tr onclick="javascript:window.document.location=&quot;${path}&quot;" style="cursor:pointer"><td><span class="dict-lemma"><span><a href="${path}"><span class="menukad">${he}</span></a></span></span><span class="dict-transcription">${tr}</span></td><td><a href="/dict/?num-radicals=3">${root}</a></td><td>${pos}</td><td class="dict-meaning">${meaning}</td></tr>`;
const PEALIM = {
  run: pealimRun,
  credence: pealimRun.replace(tbody, `<tbody>${pealimRow('/dict/9002-emun/', 'אֵמוּן', 'em<b>u</b>n', 'א - מ - ן', 'Noun – <i>masculine</i>', 'trust, faith, credence')}</tbody>`).replace(/Results for run/g, 'Results for credence'),
  credibility: pealimRun.replace(tbody, `<tbody>${pealimRow('/dict/9001-aminut/', 'אֲמִינוּת', 'amin<b>u</b>t', 'א - מ - ן', 'Noun – <i>feminine</i>', 'reliability, credibility')}</tbody>`).replace(/Results for run/g, 'Results for credibility'),
};
const WIKT = {
  run: saved('wikt-run.json'), 'run/translations': saved('wikt-run_translations.json'), credibility: saved('wikt-credibility.json'),
  reliability: saved('wikt-reliability.json'), trust: saved('wikt-trust.json'),
  smuggle: saved('wikt-smuggle.json'), voyage: saved('wikt-voyage.json'), trial: saved('wikt-trial.json'),
  // built: credence's only Hebrew word is Pealim's too (every word shown above);
  // loopa and loopb point at each other ({{trans-see}} followed one step only)
  credence: JSON.stringify({ parse: { title: 'credence', pageid: 3, wikitext: '==English==\n===Noun===\n====Translations====\n{{trans-top|acceptance of a belief}}\n* Hebrew: {{t|he|אמון|m|tr=emún}}\n{{trans-bottom}}\n' } }),
  loopa: JSON.stringify({ parse: { title: 'loopa', pageid: 4, wikitext: '==English==\n====Translations====\n{{trans-see|a loop|loopb}}\n' } }),
  loopb: JSON.stringify({ parse: { title: 'loopb', pageid: 5, wikitext: '==English==\n====Translations====\n{{trans-see|a loop|loopa}}\n' } }),
  trustiness: JSON.stringify({ parse: { title: 'trustiness', pageid: 2, wikitext: '==English==\n===Noun===\n{{en-noun}}\n# The quality of being trusted.\n====Translations====\n{{trans-see|confidence in or reliance on some person or quality|trust}}\n' } }),
  Knesset: JSON.stringify({ parse: { title: 'Knesset', pageid: 1, wikitext: '==English==\n===Proper noun===\n{{en-prop}}\n# The parliament of Israel.\n====Translations====\n{{trans-top|parliament of Israel}}\n* Hebrew: {{t+|he|כְּנֶסֶת|alt=כְּנֶסֶת|tr=k\'néset}}\n{{trans-bottom}}\n' } }),
};
const missing = saved('wikt-Zzqxnotaword.json');
const latin = (t) => /[A-Za-z]/.test(t) && !/[א-ת]/.test(t);

function page(id, term) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${id}: ${term}</title>
<link rel="stylesheet" href="/site.css"><script>window.parent.postMessage('ran', '*')</script></head>
<body onload="alert(1)">
<form action="/search" method="get"><div class="results"><h1>${term}</h1><p class="inside-form">kept text inside a form: ${term} means to bet</p>
<input name="q" value="${term}"><button type="submit">Search</button></div></form>
<h2>Conjugation</h2>
<table class="forms"><tr><th>past</th><td>הימר</td></tr><tr><th>future</th><td>יהמר</td></tr></table>
<p><img src="/img/logo.png" alt="logo"> <a class="rel" href="/word/2">the next entry</a>
<a class="js" href="javascript:alert(2)">a script link</a>
<span class="handler" onclick="alert(3)" onmouseover="alert(4)">tap me</span></p>
<iframe src="https://example.com/ad"></iframe>
<!-- an old ad, as Kizur keeps one: <script type="text/javascript">google_ad_client = "x";</script> -->
<script src="/app.js"></script>
</body></html>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/calls') return json(200, calls);
  if (url.pathname === '/control' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => raw += c);
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.slow_ms) slowMs = Number(body.slow_ms);
      for (const [k, v] of Object.entries(body)) if (k !== 'slow_ms') how[k] = v;
      json(200, { how, slow_ms: slowMs });
    });
    return;
  }
  const site = /^\/site\/(https?)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (site) {
    calls[`site:${site[2]}`] = (calls[`site:${site[2]}`] || 0) + 1;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page(site[2], decodeURIComponent(url.searchParams.get('q') || url.searchParams.get('abbr') || 'redirected')));
  }
  const m = /^\/([a-z]+)\/(.+)$/.exec(url.pathname);
  if (!m) return json(404, { error: `nothing at ${url.pathname}` });
  const id = m[1], term = decodeURIComponent(m[2]);
  const english = id === 'enwiktionary' || (id === 'pealim' && latin(term));
  const counted = english && id === 'pealim' ? 'pealim:english' : id;
  calls[counted] = (calls[counted] || 0) + 1;
  if (english) (calls.english_asked ||= []).push(`${id}:${term}`);
  const mode = how[id] || 'page';
  const send = () => {
    if (id === 'enwiktionary') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end(WIKT[term] || missing); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (english && mode !== 'changed') return res.end(PEALIM[term] || pealimNone.replace(/reliability/g, term.replace(/[<>&"]/g, '')));
    res.end(page(id, term));
  };
  if (mode === 'hang') return; // never answers
  if (mode.startsWith('redirect:')) { res.writeHead(302, { location: mode.slice(9) }); return res.end(); }
  if (mode === 'reset') return req.socket.destroy();
  if (mode.startsWith('status:')) { res.writeHead(Number(mode.slice(7)), { 'content-type': 'text/html' }); return res.end('<p>refused</p>'); }
  if (mode === 'slow') return setTimeout(send, slowMs);
  // a bot check's shell: a page with a script and no text
  if (mode === 'blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><head><script>challenge()</script></head><body><noscript>enable JavaScript</noscript></body></html>'); }
  send();
}).listen(port, () => console.log(`mock references on ${port}`));
