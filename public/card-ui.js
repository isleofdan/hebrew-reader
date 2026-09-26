'use strict';
// The word card's rendering, shared by the reader page (desktop panel and
// phone sheet) and the phone page. Pure: fills a `.card` element from a
// { card, spot, cached, spine } answer; the pages wire the buttons.

(function () {
  const BINYAN = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el", polel: 'Polel', polal: 'Polal', hitpolel: 'Hitpolel' };
  const LABELS = { conjugation: 'conjugation', 'sound-pattern-deviation': 'sound pattern deviation', 'preposition-government': 'preposition government', 'letter-order': 'letter order', 'homophonous-spelling': 'homophonous spelling' };
  const STATUS_TEXT = { new: 'looked up', shaky: 'shaky', solid: 'solid' };
  const SPINE_TEXT = { recorded: 'recorded on the spine', unreachable: 'saved here; spine unreachable', 'not configured': 'saved here; spine not configured' };

  function el(card, cls) { return card.querySelector('.' + cls); }

  function he(text) {
    const s = document.createElement('span'); s.className = 'he'; s.textContent = text; return s;
  }

  function setLoading(card, surface) {
    card.classList.remove('idle');
    const sv = card.querySelector('.setverb'); if (sv) sv.remove();
    el(card, 'surface').textContent = surface;
    el(card, 'status').textContent = 'looking up…';
    for (const c of ['meaning', 'grammar', 'chips', 'note', 'corrected', 'error', 'foot']) el(card, c).textContent = '';
    el(card, 'actions').classList.add('hidden');
  }

  function setError(card, surface, message) {
    card.classList.remove('idle');
    const sv = card.querySelector('.setverb'); if (sv) sv.remove();
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
    drawCorrected(el(card, 'corrected'), c.corrected, c.refreshed, c.confirmed);
    drawSetVerb(card, c);
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
    if (data && data.refresh_due) return refresh(card, data, { api, sentence, isCurrent });
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
    } catch (e) {
      // the card stays unpointed, and says why, so a failure is never silent
      if (isCurrent()) el(card, 'foot').textContent = `No nikud this time: ${e.message}`;
    }
  }

  const BY = { 'lesson review': 'lesson review', 'verb-card check': 'verb check', 'lesson review and verb check': 'lesson review and the verb check' };

  // A card whose root or binyan was corrected and not yet re-pointed: one
  // call re-points it and writes its note again, then the card is filled
  // again in place. A failure is saved on the card, which says so.
  async function refresh(card, data, { api, sentence, isCurrent }) {
    try {
      const got = await api('POST', '/lookup/refresh', { surface: data.card.surface, sentence: sentence || '' });
      data.card = got.card;
      delete data.refresh_due;
      if (isCurrent()) {
        const foot = el(card, 'foot').textContent;
        fill(card, data);
        el(card, 'foot').textContent = foot;
      }
    } catch (e) {
      if (isCurrent()) el(card, 'foot').textContent = `Nikud and note not refreshed after the correction: ${e.message}`;
    }
  }

  // What the lesson review corrected on this card, before and after:
  // "Corrected by the lesson review: Pa'al → Pi'el", the lesson on a line of its own.
  function drawCorrected(box, list, refreshed, confirmed) {
    box.innerHTML = '';
    // a card Dan confirmed says so first: no check changes it (session ten)
    if (confirmed) {
      const b = document.createElement('strong');
      b.className = 'confirmed';
      b.textContent = `Confirmed by you, ${dayName(confirmed.on)}`;
      box.append(b);
    }
    if (!Array.isArray(list) || !list.length) return;
    if (confirmed) box.append(document.createElement('br'));
    const show = (f, v) => (f === 'binyan' ? document.createTextNode(BINYAN[v] || v || 'none') : he(v || 'none'));
    // a correction put back is left out; the put-back line says what happened
    list.filter((x) => !x.undone).forEach((x, i) => {
      if (i) box.append(document.createElement('br'));
      box.append(document.createTextNode(x.restored
        ? `Restored: the verb check's change was contradicted by the lesson review: ${x.field === 'root' ? 'root ' : ''}`
        : x.by === 'Dan' ? `Set by you: ${x.field === 'root' ? 'root ' : ''}`
        : `Corrected by the ${BY[x.by] || 'lesson review'}: ${x.field === 'root' ? 'root ' : ''}`));
      box.append(show(x.field, x.before), document.createTextNode(' → '), show(x.field, x.after));
      if (x.lesson_title) { const t = document.createElement('span'); t.className = 'src'; t.dir = 'rtl'; t.textContent = x.lesson_title; box.append(t); }
    });
    // the pointed forms and note after a correction: a failed refresh says so
    if (refreshed && refreshed.failed) {
      box.append(document.createElement('br'), document.createTextNode(`Nikud and note not refreshed after the correction: ${refreshed.failed}`));
    }
  }

  // Dan's own root and binyan for a verb card (session eleven): a small
  // control under the corrections, on a page that wired onSetVerb. Saving,
  // changed or as it stands, marks the card confirmed by him; a root or
  // binyan the server refuses says why here, and nothing is saved.
  function drawSetVerb(card, c) {
    const old = card.querySelector('.setverb');
    // the same card drawn again (its nikud or note arrived): the control
    // stays as it is, open or not, with whatever is typed in it
    const key = [c.surface, c.root, c.binyan, c.confirmed ? c.confirmed.on : ''].join('|');
    if (old && old.dataset.key === key && card._onSetVerb && c.pos === 'verb') return;
    if (old) old.remove();
    if (!card._onSetVerb || c.pos !== 'verb') return;
    const box = document.createElement('details'); box.className = 'setverb'; box.dataset.key = key;
    const sum = document.createElement('summary'); sum.textContent = c.confirmed ? 'Set root or binyan again' : 'Set root or binyan';
    const form = document.createElement('form');
    const bl = document.createElement('label'); bl.textContent = 'Binyan';
    const sel = document.createElement('select'); sel.name = 'binyan';
    for (const [k, name] of Object.entries(BINYAN)) { const o = document.createElement('option'); o.value = k; o.textContent = name; sel.append(o); }
    if (c.binyan && BINYAN[c.binyan]) sel.value = c.binyan;
    else { const o = document.createElement('option'); o.value = ''; o.textContent = 'choose…'; sel.prepend(o); sel.value = ''; }
    bl.append(sel);
    const rl = document.createElement('label'); rl.textContent = 'Root';
    const input = document.createElement('input'); input.type = 'text'; input.name = 'root'; input.dir = 'rtl'; input.lang = 'he';
    input.value = c.root || ''; input.placeholder = 'ה.מ.ר'; input.autocomplete = 'off'; input.spellcheck = false;
    rl.append(input);
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn primary'; save.textContent = 'Save';
    const row = document.createElement('div'); row.className = 'row'; row.append(bl, rl, save);
    const hintLine = document.createElement('p'); hintLine.className = 'hint'; hintLine.textContent = 'Saving, changed or as it stands, marks the card as confirmed by you: no check changes it after that.';
    const msg = document.createElement('p'); msg.className = 'setverb-msg';
    form.append(row, hintLine, msg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save.disabled = true; msg.className = 'setverb-msg'; msg.textContent = 'saving…';
      try {
        const data = await card._onSetVerb({ root: input.value, binyan: sel.value });
        box.remove(); // drawn again from the saved card
        fill(card, data);
        el(card, 'foot').textContent = spineLine(data.spine) || 'saved';
      } catch (e) {
        msg.className = 'setverb-msg bad'; msg.textContent = e.message; save.disabled = false;
      }
    });
    box.append(sum, form);
    el(card, 'corrected').after(box);
  }

  // "2026-09-23" -> "23 Sep 2026"
  function dayName(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`;
  }

  // "Ask about this root": Pealim and Hebrew Wiktionary in new tabs.
  function askAbout(c) {
    if (!c) return;
    const rootLetters = c.root ? c.root.replace(/\./g, '') : '';
    const q = rootLetters || c.lemma;
    window.open(`https://www.pealim.com/search/?q=${encodeURIComponent(q)}`, '_blank', 'noopener');
    window.open(`https://he.wiktionary.org/w/index.php?search=${encodeURIComponent(c.lemma || q)}`, '_blank', 'noopener');
  }

  // "Put on the desk" (session twelve): the card on screen goes onto the desk
  // Dan last worked on, once. `onPut()` answers the server's { desk, already };
  // the card's foot says where it went, quietly, with a way to the desk.
  function wirePut(card, onPut) {
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.dataset.act = 'desk'; b.textContent = 'Put on the desk';
    el(card, 'actions').append(b);
    b.addEventListener('click', async () => {
      const foot = el(card, 'foot');
      b.disabled = true;
      foot.textContent = 'putting it on the desk…';
      try {
        const got = await onPut();
        foot.textContent = got.already ? `Already on the desk “${got.desk.name}”. ` : `On the desk “${got.desk.name}”. `;
        const a = document.createElement('a'); a.href = '/desk'; a.textContent = 'Open the desk';
        foot.append(a);
      } catch (e) {
        foot.textContent = `Not put on the desk: ${e.message}`;
      } finally {
        b.disabled = false;
      }
    });
  }

  // Wires one card element: `getCurrent()` answers { card, spot } for the
  // word on the card; `onStatus(status)` saves; `onClose()` for the sheet.
  function wire(card, { onStatus, getCurrent, onClose, onSetVerb, onPut }) {
    // the root and binyan control shows on verb cards of a page that saves it
    if (onSetVerb) card._onSetVerb = onSetVerb;
    if (onPut) wirePut(card, onPut);
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
