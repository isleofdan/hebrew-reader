// A local stand-in for Sentry's ingest (hebrew-crash-one): takes the
// envelopes the SDKs send (POST /api/<project>/envelope/, gzip or plain) and
// keeps them as text, so a check can read exactly what would have left.
//   node scripts/mock-sentry.mjs <port>
//   DSN for it: http://publickey@127.0.0.1:<port>/1
//   GET /envelopes -> [{ path, text }]   (the query string is dropped: it is the key)
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

const port = Number(process.argv[2]) || 8932;
const envelopes = [];

createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const path = req.url.split('?')[0];
  if (req.method === 'GET' && path === '/envelopes') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return res.end(JSON.stringify(envelopes));
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    if (/gzip/i.test(req.headers['content-encoding'] || '')) body = gunzipSync(body);
    if (req.method === 'POST' && /^\/api\/\d+\/envelope\/?$/.test(path)) envelopes.push({ path, text: body.toString('utf8') });
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end('{}');
  });
}).listen(port, '127.0.0.1');
