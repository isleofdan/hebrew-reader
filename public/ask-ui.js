'use strict';
// "Ask about this root" inside the page (hebrew-ask-one): a pane directly
// under a word card's action row, on every page whose card card-ui.js
// serves. Top to bottom: the root in Hebrew (the dictionary form when the
// word has no root) with "Close"; two tabs, Pealim and Wiktionary, that open
// the reference inside the pane (reference-ui.js, as the Look up page does);
// a question box and "Ask", which asks the hebrew desk of the ask surface
// about this root (POST /ask, subject root, built from the card on screen);
// the answer and its links; then "Ask more" for a follow-up.
//
// Nothing is fetched when the pane opens (pull only): a reference loads on
// its tab's tap, the model is asked on "Ask". Opening and closing keep Dan's
// place: the card's action row stays at the same height on the screen (on a
// card anchored to the bottom of the screen, the phone's sheet, the card
// keeps its height and the pane opens below the row inside the card's own
// scroll).
//
//   AskUI.toggle(card, { api, current })   opens or closes the pane
//   AskUI.close(card)                       closes it (a new word on the card)
//   AskUI.drawLinks(ul, links), AskUI.drawTurn(box, question, data)
//                                           the answer's drawing, shared with
//                                           the reader's Ask box (ask.js)

(function () {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // --- an answer, drawn ---------------------------------------------------------------

  // Each link the search cited, as its reference's label and the page's
  // title, opening the page in a new tab; none: one quiet line.
  function drawLinks(ul, links) {
    ul.innerHTML = '';
    for (const l of links || []) {
      const li = el('li');
      const a = el('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      a.append(el('span', 'ref-label', l.label));
      // the title in its own direction (a Hebrew title reads right to left), after the separator
      if (l.title) { const t = el('span', 'ref-title', l.title); t.dir = 'auto'; a.append(document.createTextNode(' · '), t); }
      li.append(a);
      ul.append(li);
    }
    if (!ul.children.length) ul.append(el('li', 'claim none', 'Nothing here to look up in a reference.'));
  }

  // One question and its answer, appended to `box`.
  function drawTurn(box, question, data) {
    const turn = el('div', 'ask-turn'); turn.dataset.ask = data.id;
    const q = el('p', 'ask-question', question); q.dir = 'auto';
    const ul = el('ul', 'links');
    drawLinks(ul, data.links);
    turn.append(q, el('p', 'answer', data.answer), ul);
    box.append(turn);
  }

  // --- keeping Dan's place --------------------------------------------------------------

  // The nearest ancestor that scrolls, or null for the page itself.
  function scroller(node) {
    for (let s = node.parentElement; s && s !== document.body && s !== document.documentElement; s = s.parentElement) {
      const o = getComputedStyle(s).overflowY;
      if ((o === 'auto' || o === 'scroll') && s.scrollHeight > s.clientHeight) return s;
    }
    return null;
  }

  // Runs `change` (the pane opened or closed) and puts the action row back
  // at the height it had on the screen. A card that grew upward (anchored to
  // the bottom of the screen) is held at its height instead, until the pane
  // closes; anything else is scrolled back by what it moved.
  function keepPlace(card, row, change) {
    const top = row.getBoundingClientRect().top;
    const height = card.getBoundingClientRect().height;
    change();
    let moved = row.getBoundingClientRect().top - top;
    if (moved < -0.5 && !card.style.height) {
      card.style.height = `${height}px`;
      card.dataset.askHeld = '1';
      moved = row.getBoundingClientRect().top - top;
    }
    if (Math.abs(moved) < 0.5) return;
    const s = scroller(row);
    if (s) s.scrollTop += moved; else window.scrollBy(0, moved);
  }

  // --- the pane --------------------------------------------------------------------------

  const wordOf = (c) => [c.root || '', c.lemma || '', c.surface || ''].join('|');

  // The root subject of POST /ask, from the card the page holds.
  function subjectOf(current) {
    const c = current.card;
    return {
      kind: 'root', root: c.root || undefined, lemma: c.lemma || c.surface || undefined,
      lemma_pointed: (c.pointed && c.pointed.lemma) || undefined, binyan: c.binyan || undefined, pos: c.pos || undefined,
      meaning_en: c.meaning_en || undefined, sentence: current.sentence || undefined,
    };
  }

  function close(card) {
    const pane = card._askPane;
    if (!pane) return;
    pane.remove();
    card._askPane = null;
    if (card.dataset.askHeld) { card.style.height = ''; delete card.dataset.askHeld; }
    const b = card.querySelector('[data-act=ask]');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  // "Close" (or the button tapped again): a card held at its height goes
  // back to it, the row where it was before the pane opened; any other card
  // is put back at the row's height on the screen now.
  function closeKeeping(card) {
    if (card.dataset.askHeld) { close(card); return; }
    keepPlace(card, card.querySelector('.actions'), () => close(card));
  }

  function open(card, { api, current }) {
    const c = current.card;
    const row = card.querySelector('.actions');
    const pane = el('section', 'ask-pane');
    pane.dataset.word = wordOf(c);
    pane.setAttribute('aria-label', 'Ask about this root');

    // the head: the root in Hebrew, or the dictionary form, and Close
    const head = el('div', 'ask-pane-head');
    const title = el('h3', 'ask-pane-title');
    const word = el('span', 'he', c.root || (c.pointed && c.pointed.lemma) || c.lemma || c.surface); word.dir = 'rtl'; word.lang = 'he';
    title.append(word);
    const shut = el('button', 'btn small ask-pane-close', 'Close'); shut.type = 'button';
    shut.addEventListener('click', () => closeKeeping(card));
    head.append(title, shut);

    // the two references, inside the pane, only when tapped
    const rootLetters = c.root ? c.root.replace(/\./g, '') : '';
    const refs = [
      { id: 'pealim', label: 'Pealim', term: rootLetters || c.lemma || c.surface },
      { id: 'wiktionary', label: 'Wiktionary', term: c.lemma || rootLetters || c.surface },
    ];
    const tabs = el('div', 'ask-pane-tabs');
    const refBox = el('div', 'ref-pane hidden');
    const mark = () => { for (const b of tabs.children) { const on = refBox.dataset.ref === b.dataset.ref; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); } };
    for (const r of refs) {
      const b = el('button', 'btn small ref', r.label); b.type = 'button'; b.dataset.ref = r.id;
      b.addEventListener('click', () => {
        window.ReferenceUI.open(refBox, { api, reference: r.id, term: r.term, label: r.label, onClose: mark });
        mark();
        // recorded as a lookup on the word's desk card, as the Look up page
        // records its tabs; a word with no desk card records nothing
        if (current.desk_key) api('POST', `/card/${current.desk_key}/lookup`, { reference: r.id, origin: current.lookup_origin || 'desk' }).catch(() => {});
      });
      tabs.append(b);
    }

    // the question, its answers, and Ask more
    const thread = el('div', 'ask-thread');
    let last = null;
    function box(cls, placeholder, label, followUp) {
      const form = el('form', cls);
      const q = el('textarea'); q.rows = 2; q.placeholder = placeholder; q.setAttribute('aria-label', placeholder);
      const go = el('button', 'btn primary ask-pane-go', label); go.type = 'submit';
      const msg = el('p', 'ask-pane-msg');
      form.append(q, go, msg);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const question = q.value.trim();
        msg.className = 'ask-pane-msg';
        if (!question) { msg.className = 'ask-pane-msg bad'; msg.textContent = 'Type a question first.'; return; }
        go.disabled = true; msg.textContent = 'asking…';
        const parent = followUp ? last : null;
        try {
          const data = await api('POST', '/ask', { desk: 'hebrew', subject: subjectOf(current), question, parent: parent || undefined });
          if (card._askPane !== pane) return; // closed meanwhile
          msg.textContent = '';
          if (!parent) thread.innerHTML = '';
          drawTurn(thread, question, data);
          last = data.id;
          if (parent) q.value = '';
          more.classList.remove('hidden');
        } catch (e) {
          msg.className = 'ask-pane-msg bad'; msg.textContent = e.message;
        } finally {
          go.disabled = false;
        }
      });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
      return form;
    }
    const ask = box('ask-pane-ask', 'a question about this root…', 'Ask', false);
    const more = box('ask-pane-more hidden', 'Ask more: a follow-up, or push back…', 'Ask more', true);

    pane.append(head, tabs, refBox, ask, thread, more);
    keepPlace(card, row, () => { row.after(pane); card._askPane = pane; });
    const b = card.querySelector('[data-act=ask]');
    if (b) b.setAttribute('aria-expanded', 'true');
  }

  // "Ask about this root": opens the pane for the word on the card, or
  // closes it when it is open.
  function toggle(card, { api, current }) {
    if (card._askPane) { closeKeeping(card); return; }
    if (!current || !current.card || !api) return;
    open(card, { api, current });
  }

  // A card filled again: the pane stays for the same word (its nikud or
  // status arrived) and goes for another.
  function follow(card, c) {
    if (card._askPane && (!c || card._askPane.dataset.word !== wordOf(c))) close(card);
  }

  window.AskUI = { toggle, close, follow, drawLinks, drawTurn, keepPlace };
})();
