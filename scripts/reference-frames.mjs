// The frame test for the seven references (hebrew-lookup-one, step 1): one
// plain GET per reference and test word, from wherever it is run, recording
// the status, X-Frame-Options, any Content-Security-Policy frame-ancestors,
// and whether the page's text holds the word. Not part of `npm test`: it
// reaches the live sites. Its result is written up in docs/REFERENCES.md and
// sets `embed` per reference in lib/references.js.
// Since hebrew-english-one it also asks English Wiktionary (`enwiktionary`,
// the pages a row of an English look-up frames) for "run".
//   node scripts/reference-frames.mjs          a table on stdout
//   node scripts/reference-frames.mjs --json   the raw results
//   node scripts/reference-frames.mjs --only enwiktionary   one site only
import { createRequire } from 'node:module';

const { REFERENCES, ENGLISH } = createRequire(import.meta.url)('../lib/references.js');
const LIMIT_MS = 20000;
const TERMS = { default: ['להמר'], kizur: ['להמר', 'צה"ל'], sefaria: ['להמר', 'בראשית'], enwiktionary: ['run'] };
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const SITES = [...REFERENCES, ENGLISH.wiktionary].filter((r) => !only || r.id === only);

const bare = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '');

// Can another site frame this page? No X-Frame-Options (DENY or SAMEORIGIN
// both refuse a frame from another site), and no frame-ancestors that leaves
// other sites out ('none', 'self', or a list without * or https:).
function frameable(xfo, ancestors) {
  if (xfo) return { ok: false, why: `X-Frame-Options: ${xfo}` };
  if (ancestors !== null) {
    const list = ancestors.split(/\s+/).filter(Boolean);
    if (!list.some((s) => s === '*' || s === 'https:' || s === 'http:')) return { ok: false, why: `frame-ancestors ${ancestors || "''"}` };
  }
  return { ok: true, why: 'no X-Frame-Options, no frame-ancestors limit' };
}

// Each page is asked for twice, as a browser and as a plain client: a site
// behind a bot wall may show one of them only a challenge page (Morfix's
// 202 "challenge" carries none of the site's own headers; its plain answer
// does). A refusal in either answer counts.
const AGENTS = { browser: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', plain: 'curl/8.5.0' };

async function probe(ref, term) {
  const [a, b] = await Promise.all([once(ref, term, AGENTS.browser), once(ref, term, AGENTS.plain)]);
  const answered = [a, b].filter((r) => r.status);
  const refused = answered.find((r) => !r.frame.ok);
  const best = answered.find((r) => r.status === 200) || answered[0] || a;
  let frame = refused ? refused.frame : answered.length ? best.frame : a.frame;
  // a page served over http cannot be framed in the reader, served over https
  if (frame.ok && best.final_url && best.final_url.startsWith('http:')) frame = { ok: false, why: 'http only: blocked as mixed content in an https page' };
  return { ...best, has_word: answered.some((r) => r.has_word), frame, answers: [a, b].map((r) => ({ agent: r.agent, status: r.status ?? r.error, x_frame_options: r.x_frame_options ?? null, frame_ancestors: r.frame_ancestors ?? null, waf: r.waf ?? null })) };
}

async function once(ref, term, agent) {
  const url = ref.url(term);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LIMIT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': agent, 'accept-language': 'he,en;q=0.8' } });
    const text = await res.text();
    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy') || '';
    const fa = /(?:^|;)\s*frame-ancestors\s*([^;]*)/i.exec(csp);
    const ancestors = fa ? fa[1].trim() : null;
    const plain = bare(text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#34;/g, '"'));
    const word = bare(term);
    return {
      id: ref.id, term, url, agent: agent === AGENTS.plain ? 'plain' : 'browser', waf: res.headers.get('x-amzn-waf-action') || (res.headers.get('cf-mitigated') ? `cloudflare ${res.headers.get('cf-mitigated')}` : null),
      final_url: res.url, status: res.status, ms: Date.now() - t0, bytes: text.length,
      x_frame_options: xfo, frame_ancestors: ancestors, has_word: plain.includes(word), frame: frameable(xfo, ancestors),
      title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [])[1]?.replace(/\s+/g, ' ').trim().slice(0, 100) || null,
    };
  } catch (e) {
    return { id: ref.id, term, url, agent: agent === AGENTS.plain ? 'plain' : 'browser', status: null, ms: Date.now() - t0, error: e.name === 'AbortError' ? `no answer in ${LIMIT_MS / 1000} s` : `${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`, frame: { ok: false, why: 'did not answer' } };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(SITES.flatMap((r) => (TERMS[r.id] || TERMS.default).map((t) => probe(r, t))));
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
else {
  console.log('| reference | word | status (browser / plain) | X-Frame-Options | frame-ancestors | word in text | can frame |');
  console.log('| - | - | - | - | - | - | - |');
  const cell = (f) => [...new Set(results.length ? f : [])].join(' / ') || '—';
  for (const r of results) {
    const st = r.answers.map((x) => `${x.status}${x.waf ? ` (${x.waf})` : ''}`).join(' / ');
    console.log(`| ${r.id} | ${r.term} | ${st} | ${cell(r.answers.map((x) => x.x_frame_options).filter(Boolean))} | ${cell(r.answers.map((x) => x.frame_ancestors).filter((x) => x !== null))} | ${r.status ? (r.has_word ? 'yes' : 'no') : '—'} | ${r.frame.ok ? 'yes' : `no (${r.frame.why})`} |`);
  }
}
