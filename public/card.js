'use strict';
// The word card: fills the desktop panel or the phone sheet from POST /lookup,
// and handles Save to vocab, Mark solid, Ask about this root.

(function () {
  const BINYAN = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };
  const LABELS = { conjugation: 'conjugation', 'sound-pattern-deviation': 'sound pattern deviation', 'preposition-government': 'preposition government', 'letter-order': 'letter order', 'homophonous-spelling': 'homophonous spelling' };
  const STATUS_TEXT = { new: 'met, not yet marked', shaky: 'shaky on your map', solid: 'solid' };

  const cards = [document.getElementById('card-desktop'), document.getElementById('card-phone')];
  let current = null; // { span, surface, card, spot, sentence }
  let seq = 0;

  function activeCard() {
    return window.Reader.DESKTOP.matches ? cards[0] : cards[1];
  }

  function el(card, cls) { return card.querySelector('.' + cls); }

  function he(text) {
    const s = document.createElement('span'); s.className = 'he'; s.textContent = text; return s;
  }

  function setLoading(card, surface) {
    card.classList.remove('idle');
    el(card, 'surface').textContent = surface;
    el(card, 'status').textContent = 'looking up…';
    for (const c of ['meaning', 'grammar', 'chips', 'note', 'error', 'foot']) el(card, c).textContent = '';
    el(card, 'actions').classList.add('hidden');
  }

  function setError(card, surface, message) {
    card.classList.remove('idle');
    el(card, 'surface').textContent = surface;
    el(card, 'status').textContent = '';
    for (const c of ['meaning', 'grammar', 'chips', 'note', 'foot']) el(card, c).textContent = '';
    el(card, 'error').textContent = message;
    el(card, 'actions').classList.add('hidden');
  }

  function fill(card, data) {
    const c = data.card, spot = data.spot;
    card.classList.remove('idle');
    el(card, 'surface').textContent = c.surface;
    el(card, 'status').textContent = spot ? `${STATUS_TEXT[spot.status] || spot.status} · ${spot.touches} touch${spot.touches === 1 ? '' : 'es'}` : 'no spot for this word';
    el(card, 'meaning').textContent = c.meaning_en;
    const g = el(card, 'grammar');
    g.innerHTML = '';
    const parts = [];
    if (c.lemma && c.lemma !== c.surface) parts.push(['lemma ', he(c.lemma)]);
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
    el(card, 'error').textContent = '';
    const actions = el(card, 'actions');
    actions.classList.toggle('hidden', !spot);
    actions.querySelector('[data-act=shaky]').disabled = !spot || spot.status === 'shaky';
    actions.querySelector('[data-act=solid]').disabled = !spot || spot.status === 'solid';
    actions.querySelector('[data-act=ask]').disabled = !c.root && !c.lemma;
    el(card, 'foot').textContent = data.cached ? 'from the cache' : '';
  }

  async function showCard(span) {
    const surface = span.dataset.surface;
    const sentence = span.dataset.sentence || '';
    const card = activeCard();
    const my = ++seq;
    current = { span, surface, sentence, card: null, spot: null };
    setLoading(card, surface);
    try {
      const data = await window.Reader.api('POST', '/lookup', { surface, sentence, article_id: window.Reader.article.id });
      if (my !== seq) return;
      current.card = data.card; current.spot = data.spot;
      fill(card, data);
      if (data.spot) {
        const marks = window.Reader.marks;
        const hintFrom = data.card.binyan ? [BINYAN[data.card.binyan], data.card.tense].filter(Boolean).join(' ') : (data.card.governs ? `governs ${data.card.governs}` : data.card.pos);
        marks[surface] = { spot_id: data.spot.id, status: data.spot.status, hint: hintFrom };
        window.Reader.applyTints();
        span.classList.add('active');
      }
    } catch (e) {
      if (my !== seq) return;
      setError(card, surface, e.message);
    }
  }

  async function setStatus(status) {
    if (!current || !current.spot) return;
    const card = activeCard();
    const spineLine = el(card, 'foot');
    spineLine.textContent = 'saving…';
    try {
      const data = await window.Reader.api('POST', `/spots/${encodeURIComponent(current.spot.id)}`, { status });
      current.spot = data.spot;
      fill(card, { card: current.card, spot: data.spot, cached: false });
      const marks = window.Reader.marks;
      if (marks[current.surface]) marks[current.surface].status = data.spot.status;
      else marks[current.surface] = { spot_id: data.spot.id, status: data.spot.status, hint: '' };
      window.Reader.applyTints();
      current.span.classList.add('active');
      spineLine.textContent = data.spine === 'recorded' ? 'recorded on the spine' : data.spine === 'unreachable' ? 'saved here; spine unreachable' : data.spine === 'not configured' ? 'saved here; spine not configured' : 'saved';
    } catch (e) {
      el(card, 'error').textContent = e.message;
      spineLine.textContent = '';
    }
  }

  function ask() {
    if (!current || !current.card) return;
    const c = current.card;
    const rootLetters = c.root ? c.root.replace(/\./g, '') : '';
    const q = rootLetters || c.lemma;
    window.open(`https://www.pealim.com/search/?q=${encodeURIComponent(q)}`, '_blank', 'noopener');
    window.open(`https://he.wiktionary.org/w/index.php?search=${encodeURIComponent(c.lemma || q)}`, '_blank', 'noopener');
  }

  for (const card of cards) {
    card.querySelector('[data-act=shaky]').addEventListener('click', () => setStatus('shaky'));
    card.querySelector('[data-act=solid]').addEventListener('click', () => setStatus('solid'));
    card.querySelector('[data-act=ask]').addEventListener('click', ask);
    const close = card.querySelector('.close');
    if (close) close.addEventListener('click', () => { card.classList.add('idle'); seq++; });
  }

  window.showCard = showCard;
})();
