'use strict';
// The desks of the ask surface (hebrew-ask-one): who answers a question and
// what it may search. lib/ask.js answers every question through one of these;
// a desk is chosen by its id in POST /ask ({ desk }, default 'hebrew').
//
// A desk is { id, persona, domains, model, limits }:
//   persona  the model's opening instructions: who it is and how it answers
//   domains  the sites its web search may reach (OpenRouter's allowed_domains)
//   model    the OpenRouter model id
//   limits   { maxTokens, timeoutMs } for one answer
// What the answer must look like (one JSON object) and what it is about (the
// subject) are the ask surface's, not the desk's; so is whether an answer
// with no citation is kept, which each caller decides.
//
// One desk this session, `hebrew`, as "Ask here" on a card has answered
// since session thirteen: its persona from that call's system text, the seven
// references, the card model, and grow.js's ASK limits. A second desk (the
// guided study of Jewish thought Dan intends) is a second entry here, added
// with `register` — nothing in lib/ask.js or server.js changes for it.

const refs = require('./references');
const lookup = require('./lookup');
const grow = require('./grow');

// "Pealim (pealim.com: verb tables by root and binyan)" for a reference's
// domain; a domain that is not one of the references is named as it is.
function sitesLine(domains) {
  return domains.map((d) => {
    const r = refs.REFERENCES.find((x) => x.domain === d);
    return r ? `${r.label} (${d}: ${r.hint})` : d;
  }).join('; ');
}

const DESKS = new Map();

// Adds a desk, or replaces the one of the same id. Answers the desk as kept.
function register({ id, persona, domains, model = lookup.MODEL, limits = grow.ASK }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`a desk id is lowercase letters, digits and dashes; got ${JSON.stringify(id)}`);
  if (typeof persona !== 'string' || !persona.trim()) throw new Error(`desk ${id}: persona is the model's opening text`);
  if (!Array.isArray(domains) || !domains.length || !domains.every((d) => typeof d === 'string' && d)) throw new Error(`desk ${id}: domains is the list of sites it may search`);
  const desk = Object.freeze({ id, persona: persona.trim(), domains: [...domains], model, limits: { ...limits } });
  DESKS.set(id, desk);
  return desk;
}

register({
  id: 'hebrew',
  persona: `You are a Hebrew reference desk for an advanced reader of Israeli news and business Hebrew.
Search the references before you answer; you may search only these sites: ${sitesLine(refs.DOMAINS)}.
Answer briefly, in English (Hebrew words in Hebrew letters), in at most five short sentences, and base each claim on a page you found. Mark anything you are not sure of with "(not sure)" right after the claim; never present a guess as a fact.`,
  domains: refs.DOMAINS,
  model: lookup.MODEL,
  limits: grow.ASK,
});

function get(id) { return DESKS.get(id) || null; }
function ids() { return [...DESKS.keys()]; }

module.exports = { register, get, ids, sitesLine };
