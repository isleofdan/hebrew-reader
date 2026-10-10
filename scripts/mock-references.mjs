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
//   node scripts/mock-references.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2]) || 8853;
const how = {};
let slowMs = 10000;
const calls = {};

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
  calls[id] = (calls[id] || 0) + 1;
  const mode = how[id] || 'page';
  const send = () => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(id, term)); };
  if (mode === 'hang') return; // never answers
  if (mode.startsWith('redirect:')) { res.writeHead(302, { location: mode.slice(9) }); return res.end(); }
  if (mode === 'reset') return req.socket.destroy();
  if (mode.startsWith('status:')) { res.writeHead(Number(mode.slice(7)), { 'content-type': 'text/html' }); return res.end('<p>refused</p>'); }
  if (mode === 'slow') return setTimeout(send, slowMs);
  // a bot check's shell: a page with a script and no text
  if (mode === 'blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><head><script>challenge()</script></head><body><noscript>enable JavaScript</noscript></body></html>'); }
  send();
}).listen(port, () => console.log(`mock references on ${port}`));
