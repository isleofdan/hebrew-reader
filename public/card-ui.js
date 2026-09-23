'use strict';
// The word card's rendering, shared by the reader page (desktop panel and
// phone sheet) and the phone page. Pure: fills a `.card` element from a
// { card, spot, cached, spine } answer; the pages wire the buttons.

(function () {
  const BINYAN = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };
  const LABELS = { conjugation: 'conjugation', 'sound-pattern-deviation': 'sound pattern deviation', 'preposition-government': 'preposition government', 'letter-order': 'letter order', 'homophonous-spelling': 'homophonous spelling' };
  const STATUS_TEXT = { new: 'looked up', shaky: 'shaky', solid: 'solid' };
  const SPINE_TEXT = { recorded: 'recorded on the spine', unreachable: 'saved here; spine unreachable', 'not configured': 'saved here; spine not configured' };

  function el(card, cls) { return card.querySelector('.' + cls); }

  function he(text) {
    const s = document.createElement('span'); s.className = 'he'; s.textContent = text; return s;
  }

  function setLoading(card, surface) {
    card.classList.remove('idle');
    el(card, 'surface').textContent = surface;
    el(card, 'status').textContent = 'looking up…';
    for (const c of ['meaning', 'grammar', 'chips', 'note', 'corrected', 'error', 'foot']) el(card, c).textContent = '';
    el(card, 'actions').classList.add('hidden');
  }

  function setError(card, surface, message) {
    card.classList.remove('idle');
    el(card, 'surface').textContent = surface;
    el(card, 'status').textContent = '';
    for (const c of ['meaning', 'grammar', 'chips', 'note', 'corrected', 'foot']) el(card, c).textContent = '';
    el(card, 'error').textContent = message;
    el(card, 'actions').classList.add('hidden');
  }

  // One short line for a side list: "Nif'al past", "governs עם", or the pos.
  function hint(c) {
    if (c.binyan) return [BINYAN[c.binyan] || c.binyan, c.tense].filter(Boolean).join(' ');
    if (c.governs) return `governs ${c.governs}`;
    return c.pos || '';
  }

  // How often a word has come up: "seen once", "seen 3 times".
  function seen(n) { return n === 1 ? 'seen once' : `seen ${n} times`; }

  // The footer line for a spine outcome; '' when there is nothing to say.
  function spineLine(outcome) { return SPINE_TEXT[outcome] || ''; }

  // The headword: the dictionary form with its nikud, large, and the same
  // word unpointed beside it, smaller. A card with no pointed form yet shows
  // the word unpointed until addPoints fills it in.
  function headword(box, c) {
    box.innerHTML = '';
    const word = c.lemma || c.surface;
    const pointed = c.pointed ? (c.lemma ? c.pointed.lemma : c.pointed.surface) : null;
    const big = document.createElement('span'); big.className = 'pointed'; big.textContent = pointed || word; box.append(big);
    if (pointed) { const small = document.createElement('span'); small.className = 'plain'; small.textContent = word; box.append(small); }
  }

  // Nikud is display only: compared without it, the selected word and the
  // headword are the same word when only the points differ.
  const bare = (s) => String(s || '').replace(/[\u0591-\u05C7]/g, '');

  function fill(card, data) {
    const c = data.card, spot = data.spot;
    card.classList.remove('idle');
    headword(el(card, 'surface'), c);
    el(card, 'status').textContent = spot ? `${STATUS_TEXT[spot.status] || spot.status} · ${seen(spot.touches)}` : 'no spot for this word';
    el(card, 'meaning').textContent = c.meaning_en;
    const g = el(card, 'grammar');
    g.innerHTML = '';
    const parts = [];
    // the word as it stands in the text, pointed when the card has it
    if (c.lemma && bare(c.lemma) !== bare(c.surface)) {
      const w = he((c.pointed && c.pointed.surface) || c.surface); w.classList.add('pointed');
      parts.push(['in the text ', w]);
    }
    if (c.root) parts.push(['root ', he(c.root)]);
    if (c.binyan) parts.push([[BINYAN[c.binyan] || c.binyan, c.tense, c.person_gender_number].filter(Boolean).join(', ')]);
    else parts.push([[c.pos, c.person_gender_number].filter(Boolean).join(', ')]);
    if (c.governs) parts.push(['governs ', he(c.governs)]);
    parts.forEach((p, i) => {
      if (i) g.append(document.createTextNode(' · '));
      for (const x of p) g.append(typeof x === 'string' ? document.createTextNode(x) : x);
    });
    const chips = el(card, 'chips');
    chips.innerHTML = '';
    for (const id of c.categories || []) {
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = LABELS[id] || id; chips.append(chip);
    }
    el(card, 'note').textContent = c.note || '';
    drawCorrected(el(card, 'corrected'), c.corrected);
    el(card, 'error').textContent = '';
    const actions = el(card, 'actions');
    actions.classList.toggle('hidden', !spot);
    actions.querySelector('[data-act=shaky]').disabled = !spot || spot.status === 'shaky';
    actions.querySelector('[data-act=solid]').disabled = !spot || spot.status === 'solid';
    actions.querySelector('[data-act=ask]').disabled = !c.root && !c.lemma;
    el(card, 'foot').textContent = spineLine(data.spine) || (data.cached ? 'from the cache' : '');
  }

  // A card cached before cards carried nikud: one call adds it, then the card
  // is filled again in place. `isCurrent()` says whether the card still shows
  // this word; a failure leaves the card as it is, unpointed.
  async function addPoints(card, data, { api, sentence, isCurrent }) {
    if (!data || !data.points_missing) return;
    try {
      const got = await api('POST', '/lookup/points', { surface: data.card.surface, sentence: sentence || '' });
      data.card.pointed = got.pointed;
      delete data.points_missing;
      if (isCurrent()) {
        const foot = el(card, 'foot').textContent;
        fill(card, data);
        el(card, 'foot').textContent = foot;
      }
    } catch (e) { /* the card stays unpointed */ }
  }

  // What the lesson review corrected on this card, before and after:
  // "Corrected by the lesson review: Pa'al → Pi'el", the lesson on a line of its own.
  function drawCorrected(box, list) {
    box.innerHTML = '';
    if (!Array.isArray(list) || !list.length) return;
    const show = (f, v) => (f === 'binyan' ? document.createTextNode(BINYAN[v] || v || 'none') : he(v || 'none'));
    list.forEach((x, i) => {
      if (i) box.append(document.createElement('br'));
      box.append(document.createTextNode(`Corrected by the lesson review: ${x.field === 'root' ? 'root ' : ''}`));
      box.append(show(x.field, x.before), document.createTextNode(' → '), show(x.field, x.after));
      if (x.lesson_title) { const t = document.createElement('span'); t.className = 'src'; t.dir = 'rtl'; t.textContent = x.lesson_title; box.append(t); }
    });
  }

  // "Ask about this root": Pealim and Hebrew Wiktionary in new tabs.
  function askAbout(c) {
    if (!c) return;
    const rootLetters = c.root ? c.root.replace(/\./g, '') : '';
    const q = rootLetters || c.lemma;
    window.open(`https://www.pealim.com/search/?q=${encodeURIComponent(q)}`, '_blank', 'noopener');
    window.open(`https://he.wiktionary.org/w/index.php?search=${encodeURIComponent(c.lemma || q)}`, '_blank', 'noopener');
  }

  // Wires one card element: `getCurrent()` answers { card, spot } for the
  // word on the card; `onStatus(status)` saves; `onClose()` for the sheet.
  function wire(card, { onStatus, getCurrent, onClose }) {
    card.querySelector('[data-act=shaky]').addEventListener('click', () => onStatus('shaky'));
    card.querySelector('[data-act=solid]').addEventListener('click', () => onStatus('solid'));
    card.querySelector('[data-act=ask]').addEventListener('click', () => askAbout((getCurrent() || {}).card));
    const close = card.querySelector('.close');
    if (close && onClose) close.addEventListener('click', onClose);
  }

  // Saves a status for the card's spot through `api`, refills the card, and
  // answers the server's { spot, spine }. Errors show on the card.
  async function saveStatus(card, api, current, status) {
    if (!current || !current.spot) return null;
    const foot = el(card, 'foot');
    foot.textContent = 'saving…';
    try {
      const data = await api('POST', `/spots/${encodeURIComponent(current.spot.id)}`, { status });
      current.spot = data.spot;
      fill(card, { card: current.card, spot: data.spot, cached: false, spine: data.spine });
      foot.textContent = spineLine(data.spine) || 'saved';
      return data;
    } catch (e) {
      el(card, 'error').textContent = e.message;
      foot.textContent = '';
      return null;
    }
  }

  window.CardUI = { BINYAN, LABELS, STATUS_TEXT, seen, fill, addPoints, setLoading, setError, hint, spineLine, askAbout, wire, saveStatus };
})();
