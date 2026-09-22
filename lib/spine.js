'use strict';
// Marks to the spine, Dan's personal database, the record of the map.
// On every status change: PUT {SPINE_URL}/api/marks/hebrew-reader/<spot id>
// with a bearer SPINE_TOKEN. A failure never blocks the local write; the
// answer is one of 'recorded', 'unreachable', 'not configured'.

const APP = 'hebrew-reader';
const SPINE_URL = (process.env.SPINE_URL || 'https://spine-dan.fly.dev').replace(/\/$/, '');
const TIMEOUT_MS = 8000;

let saidNotConfigured = false;

async function recordMark(spot, { lastArticleTitle } = {}) {
  const token = process.env.SPINE_TOKEN;
  if (!token) {
    if (!saidNotConfigured) {
      console.log('spine: SPINE_TOKEN is unset; marks stay local until it is set.');
      saidNotConfigured = true;
    }
    return 'not configured';
  }
  const body = {
    status: spot.status,
    last_seen_at: new Date().toISOString(),
    fields: {
      root: spot.root || null,
      binyan: spot.binyan || null,
      lemma: spot.lemma || null,
      categories: spot.categories || [],
      last_article_title: lastArticleTitle || null,
      touches: spot.touches || 0,
    },
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SPINE_URL}/api/marks/${APP}/${encodeURIComponent(spot.id)}`, {
      method: 'PUT',
      signal: ac.signal,
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`spine: ${spot.id} not recorded, answered ${res.status} ${text.slice(0, 200)}`);
      return 'unreachable';
    }
    console.log(`spine: recorded ${spot.id} as ${spot.status}`);
    return 'recorded';
  } catch (e) {
    console.error(`spine: ${spot.id} not recorded, ${e.name === 'AbortError' ? 'timed out' : e.message}`);
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recordMark, APP, SPINE_URL };
