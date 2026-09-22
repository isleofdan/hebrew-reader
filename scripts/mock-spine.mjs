// A stand-in for the spine's /api/marks routes for local checks: the same
// bearer rule, the same allowed keys, an in-memory table.
//   node scripts/mock-spine.mjs [port] [token]
import http from 'node:http';

const port = Number(process.argv[2]) || 8792;
const token = process.argv[3] || 'test-spine-token';
const ALLOWED = ['status', 'due_on', 'interval_days', 'last_seen_at', 'fields'];
const marks = new Map();
const puts = {}; // item_id -> number of PUTs, so a check can count one per touch

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/health') return json(200, { ok: true, marks: marks.size });
  if (url.pathname === '/puts') return json(200, { puts });
  if ((req.headers.authorization || '') !== `Bearer ${token}`) return json(401, { error: 'Unauthorized. Send Authorization: Bearer <SPINE_TOKEN>.' });
  const m = /^\/api\/marks\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (url.pathname === '/api/marks' && req.method === 'GET') {
    const app = url.searchParams.get('app');
    const items = [...marks.values()].filter((x) => !app || x.app === app);
    return json(200, { items, state: items.length ? 'ok' : 'no data' });
  }
  if (m && req.method === 'PUT') {
    let raw = '';
    req.on('data', (c) => raw += c);
    req.on('end', () => {
      const body = JSON.parse(raw);
      for (const k of Object.keys(body)) if (!ALLOWED.includes(k)) return json(400, { error: `Unknown key "${k}". Allowed: ${ALLOWED.join(', ')}.` });
      const app = m[1], item_id = decodeURIComponent(m[2]);
      const key = `${app}\n${item_id}`;
      const prev = marks.get(key);
      if (!prev && !body.status) return json(400, { error: '"status" is required.' });
      const mark = { app, item_id, status: body.status ?? prev.status, due_on: body.due_on ?? prev?.due_on ?? null, interval_days: body.interval_days ?? prev?.interval_days ?? null, last_seen_at: body.last_seen_at ?? prev?.last_seen_at ?? null, fields: body.fields ?? prev?.fields ?? {}, updated_at: new Date().toISOString() };
      marks.set(key, mark);
      puts[item_id] = (puts[item_id] || 0) + 1;
      json(200, mark);
    });
    return;
  }
  json(404, { error: `No route ${req.method} ${url.pathname}.` });
}).listen(port, () => console.log(`mock spine on ${port}`));
