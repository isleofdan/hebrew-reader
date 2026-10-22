'use strict';
// The desks of the ask surface (hebrew-ask-one): who answers a question and
// what it may search. lib/ask.js answers every question through one of these;
// a desk is chosen by its id in POST /ask ({ desk }, default 'hebrew').
//
// A desk is { id, persona, domains, model, limits, turns, choose }:
//   persona  the model's opening instructions: who it is and how it answers
//   domains  the sites its web search may reach (OpenRouter's allowed_domains)
//   model    the OpenRouter model id (one OpenRouter does not have is asked
//            once more with the card model, as lib/lookup.js chat() does)
//   limits   { maxTokens, timeoutMs, reasoning? } for one answer; `reasoning`
//            (hebrew-guide-one) is the room to think given to the model,
//            OpenRouter's `reasoning` field (lib/lookup.js post()); a desk
//            without it sends none
//   turns    the earlier turns a follow-up carries (6 by default)
//   choose   { maxTokens, timeoutMs, reasoning? } for a desk's first call,
//            when it has one (the walks' choosing of the next passage), else
//            null
// What the answer must look like (one JSON object) and what it is about (the
// subject) are the ask surface's, not the desk's; so is whether an answer
// with no citation is kept, which each caller decides.
//
// `hebrew`, as "Ask here" on a card has answered since session thirteen: its
// persona from that call's system text, the seven references, the card
// model, and grow.js's ASK limits. `thought` (hebrew-walks-one), the guide
// to Jewish thought that walks Dan through primary texts one stop at a time
// (lib/walks.js): its persona, Sefaria as its one site, the guide model, a
// stop's limits, ten turns.

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
const TURNS = 6; // the earlier turns a follow-up carries, unless a desk says otherwise

// Adds a desk, or replaces the one of the same id. Answers the desk as kept.
function register({ id, persona, domains, model = lookup.MODEL, limits = grow.ASK, turns = TURNS, choose = null }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`a desk id is lowercase letters, digits and dashes; got ${JSON.stringify(id)}`);
  if (typeof persona !== 'string' || !persona.trim()) throw new Error(`desk ${id}: persona is the model's opening text`);
  if (!Array.isArray(domains) || !domains.length || !domains.every((d) => typeof d === 'string' && d)) throw new Error(`desk ${id}: domains is the list of sites it may search`);
  if (!Number.isInteger(turns) || turns < 0) throw new Error(`desk ${id}: turns is how many earlier turns a follow-up carries, a whole number`);
  const desk = Object.freeze({ id, persona: persona.trim(), domains: [...domains], model, limits: { ...limits }, turns, choose: choose ? { ...choose } : null });
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
  turns: 6,
});

// The guide to Jewish thought (hebrew-walks-one), in the voice of the sample
// stop Dan approved ("Shape is good"): a stance, every name and term
// explained, Hebrew with its transliteration, the argument named, an opinion
// in the first person, two or three ways on. The passage itself always comes
// from Sefaria, never from the model.
register({
  id: 'thought',
  persona: `You are a guide to Jewish thought for one adult reader who is studying it for self-understanding: the tradition's habits of mind, how it argues, where it puts authority. He is not studying it as a believer or a scholar. You write as one voice from inside the tradition, with a stance of your own, and you say where you stand.
You walk him through it one stop at a time. A stop is one primary passage, chosen for a reason you give in a sentence or two ("I am starting there because…"). You never give a list, a survey, an overview or a reading plan; when asked for one, you choose the single best next stop instead and say why.
Every term, name and text is explained the first time it appears, in plain words, adult to adult, never condescending: who a person was and when, what a book is, what a word means (the Talmud is the record of rabbinic debate compiled in Babylonia around the year 500; "112b" is a page). Hebrew appears in Hebrew letters with a transliteration beside it. You never write out the passage yourself: the reader's app fetches it from Sefaria and shows it to you and to him; you write about the text in front of you.
Where the tradition argues with itself about the passage, or scholars read it differently, you say so and name the sides: who, when, and what each holds. Then you give your own opinion, in the first person, and invite him to disagree ("You may well disagree. Tell me where.").
You offer two or three directions for the next stop, each in a few words with one sentence on why. He chooses, or pushes back, or asks something else; you follow him.
Israel, antisemitism and current politics are outside this desk. When a move goes there, decline in one line and say why, and offer nothing else on it.`,
  domains: ['www.sefaria.org'],
  model: lookup.GUIDE_MODEL,
  // a stop is longer than Today's passage (the guide model's longest call
  // so far, 90 s): its explanation, the argument, the opinion, the
  // directions, and a search of Sefaria. Both calls think first
  // (hebrew-guide-one: Dan's first live walk read his question shallowly):
  // 4,000 tokens of thinking, counted inside max_tokens, so each cap is
  // raised by more than that, and the time limits with them
  limits: { maxTokens: 9000, timeoutMs: 240000, reasoning: { max_tokens: 4000 } },
  turns: 10,
  choose: { maxTokens: 6000, timeoutMs: 150000, reasoning: { max_tokens: 4000 } },
});

function get(id) { return DESKS.get(id) || null; }
function ids() { return [...DESKS.keys()]; }

module.exports = { register, get, ids, sitesLine };
