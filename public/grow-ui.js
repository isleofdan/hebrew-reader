'use strict';
// A card, opened (session thirteen): under the card's entry, its layers
// oldest first — examples found online that Dan kept, questions he asked
// with their answers, notes he typed, where he looked the word up — then a
// row of actions and a footer. Everything is saved as it happens; the model
// is called only when Dan presses "Ask here" or "Find more examples".
//
//   GrowUI.show(box, key, { api, deskId, phone, onNewCard, onChange })
// draws into `box`. onNewCard(out) is called after a branch or a cut made a
// new card (the page reloads its desk); onChange() after anything else.

(function () {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const KIND_WORD = { news: 'news site', tv: 'TV clip', blog: 'blog', other: 'web page' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function he(text, cls) { const s = el('span', cls ? `he ${cls}` : 'he', text); s.dir = 'rtl'; return s; }
  function btn(text, cls, fn) { const b = el('button', cls || 'btn small', text); b.type = 'button'; b.addEventListener('click', fn); return b; }

  // "26 Sep 2026" from a time (Tokyo) or a date as written ("2026-09", "2026-09-18").
  function day(iso, withYear = true) {
    const s = String(iso || '');
    if (s.length > 10) {
      const p = {};
      for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(s))) p[x.type] = x.value;
      return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}${withYear ? ` ${p.year}` : ''}`;
    }
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
    if (!m) return s;
    if (!m[2]) return m[1];
    return `${m[3] ? `${Number(m[3])} ` : ''}${MONTHS[Number(m[2]) - 1]}${withYear || !m[3] ? ` ${m[1]}` : ''}`;
  }

  // "news site, 18 Sep" — what the source was, and when when known.
  function sourceLabel(x) {
    const bits = [x.source_name];
    const kind = KIND_WORD[x.source_kind] || 'web page';
    if (x.source_name !== kind) bits.push(kind);
    return bits.join(' · ') + (x.source_date ? `, ${day(x.source_date, false)}` : '');
  }

  function arrowLink(url, label) {
    const a = el('a', 'src-link');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (label) { a.append(document.createTextNode(label)); a.append(document.createTextNode(' ')); }
    const arrow = el('span', 'arrow', '↗');
    arrow.setAttribute('aria-hidden', 'true');
    a.append(arrow);
    a.title = url;
    return a;
  }

  function show(box, key, opts) {
    const api = opts.api;
    const state = { key, view: null, cutting: false, asking: false, noting: null, othersOpen: false, msg: '', bad: false, busy: '' };

    async function reload() {
      try { state.view = await api('GET', `/card/${key}`); }
      catch (e) { state.msg = `This card could not be opened: ${e.message}`; state.bad = true; }
      draw();
    }

    function say(text, bad = false) { state.msg = text; state.bad = bad; const m = box.querySelector('.grow-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', bad); } }

    async function act(fn, busy) {
      state.busy = busy || ''; draw();
      try { await fn(); } catch (e) { say(e.message, true); }
      state.busy = ''; draw();
    }

    // --- one layer, drawn by its kind ---------------------------------------------
    function layerBox(l, i, layers) {
      const li = el('li', `layer ${l.kind}`);
      li.dataset.key = l.key;
      const head = el('div', 'layer-kind');
      if (l.kind === 'answer') head.textContent = `asked · ${day(l.made_at)}`;
      if (l.kind === 'note') head.textContent = `note · ${day(l.made_at)}`;
      if (l.kind === 'answer' || l.kind === 'note') li.append(head);
      if (l.kind === 'example') {
        const s = el('p', 'ex-sentence', l.sentence); s.dir = 'rtl'; s.lang = 'he';
        const src = el('div', 'ex-source');
        src.append(arrowLink(l.url, sourceLabel(l)));
        li.append(s, src);
        if (!l.kept) li.append(btn('keep', 'btn small keep', () => act(async () => { await api('POST', `/card/${l.key}/keep`, { kept: true }); await reload(); opts.onChange && opts.onChange(); })));
      }
      if (l.kind === 'answer') {
        const q = el('p', 'q', l.question); q.dir = 'auto';
        const a = el('p', 'a', l.answer); a.dir = 'ltr'; // answers are written in English
        const srcs = el('div', 'ex-source');
        srcs.append(document.createTextNode('leaned on: '));
        l.links.forEach((k, j) => { if (j) srcs.append(document.createTextNode(' · ')); srcs.append(arrowLink(k.url, k.label || k.title)); });
        li.append(q, a, srcs);
      }
      if (l.kind === 'note') {
        const ta = el('textarea', 'layer-note');
        ta.dir = 'auto'; ta.value = l.text || ''; ta.rows = 2;
        ta.setAttribute('aria-label', 'Note');
        ta.placeholder = 'Type here — עברית or English';
        let timer = null;
        const save = async () => { clearTimeout(timer); timer = null; try { await api('PATCH', `/notes/${l.key.split(':')[1]}`, { text: ta.value }); l.text = ta.value; } catch (e) { say(`Not saved: ${e.message}`, true); } };
        ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
        ta.addEventListener('blur', () => { if (timer) save(); });
        li.append(ta);
        if (state.noting === l.key) setTimeout(() => ta.focus(), 0);
      }
      if (l.kind === 'lookup') li.append(el('div', 'lookup-line', `looked up in ${l.label}, ${day(l.made_at)}`));
      if (l.kind !== 'example' || l.kept) {
        const row = el('div', 'layer-acts');
        row.append(btn('Branch a new card from here', 'linklike', () => branchFrom(l.key)));
        if (state.cutting) row.append(btn(i === 0 ? 'Cut here (every layer)' : 'Cut here', 'btn small cut-here', () => cutAt(l.key)));
        li.append(row);
      }
      return li;
    }

    async function branchFrom(from) {
      await act(async () => {
        const out = await api('POST', `/card/${from}/branch`, { desk_id: opts.deskId, unplaced: Boolean(opts.phone) });
        opts.onNewCard && opts.onNewCard(out, 'branch');
      }, 'branching');
    }

    async function cutAt(at) {
      await act(async () => {
        const out = await api('POST', `/card/${key}/cut`, { at, desk_id: opts.deskId, unplaced: Boolean(opts.phone) });
        state.cutting = false;
        opts.onNewCard && opts.onNewCard(out, 'cut');
      }, 'cutting');
    }

    // --- the whole view ------------------------------------------------------------
    function draw() {
      box.innerHTML = '';
      box.classList.add('grow');
      const v = state.view;
      if (!v) { box.append(el('p', 'grow-msg' + (state.bad ? ' bad' : ''), state.msg || 'Opening the card…')); return; }
      const isWord = v.card.kind === 'word';
      const shown = v.layers.filter((l) => l.kind !== 'example' || l.kept);
      const examples = v.layers.filter((l) => l.kind === 'example');
      box.append(el('div', 'layers-line', v.layers_line));

      const list = el('ol', 'layers');
      // the examples stand as one group, where the first of them came
      let grouped = false;
      v.layers.forEach((l) => {
        if (l.kind === 'example') {
          if (grouped) return;
          grouped = true;
          const g = el('li', 'layer examples-group');
          const kept = examples.filter((x) => x.kept), others = examples.filter((x) => !x.kept);
          g.append(el('div', 'layer-kind', `examples you kept · ${kept.length} of ${examples.length} found${v.counts.found_on ? ` on ${v.counts.found_on.replace(/ \d{4}$/, '')}` : ''}`));
          const ul = el('ol', 'examples');
          kept.forEach((x) => ul.append(layerBox(x, shown.indexOf(x), shown)));
          g.append(ul);
          if (others.length) {
            const t = btn(state.othersOpen ? `hide the others (${others.length})` : `show the others (${others.length})`, 'linklike others-toggle', () => { state.othersOpen = !state.othersOpen; draw(); });
            g.append(t);
            if (state.othersOpen) {
              const ol = el('ol', 'examples others');
              others.forEach((x) => ol.append(layerBox(x, -1, shown)));
              g.append(ol);
            }
          }
          list.append(g);
          return;
        }
        list.append(layerBox(l, shown.indexOf(l), shown));
      });
      if (v.layers.length) box.append(list);
      else box.append(el('p', 'no-layers', 'Nothing has grown on this card yet: ask about it, find examples of it, or add a note.'));

      if (state.cutting) {
        const c = el('div', 'cut-bar');
        c.append(el('span', '', shown.length ? 'Choose the layer to cut at: it and every layer after it go to a new card.' : 'Nothing to cut yet: this card has no layers.'));
        c.append(btn('Cancel', 'btn small', () => { state.cutting = false; draw(); }));
        box.append(c);
      }

      // the ask box
      if (state.asking) {
        const f = el('form', 'ask-here');
        const input = el('input', 'ask-input');
        input.type = 'text'; input.dir = 'auto'; input.placeholder = 'Ask about this card — the references are searched';
        input.setAttribute('aria-label', 'Your question');
        input.value = state.question || '';
        input.addEventListener('input', () => { state.question = input.value; });
        const send = el('button', 'btn primary small', state.busy === 'asking' ? 'Asking…' : 'Send');
        send.type = 'submit'; send.disabled = state.busy === 'asking';
        f.append(input, send);
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const q = input.value.trim();
          if (!q) return say('Type a question first.', true);
          act(async () => {
            say('Asking the references… this can take up to a minute.');
            await api('POST', `/card/${key}/ask`, { question: q });
            state.asking = false; state.question = '';
            say('');
            await reload();
            opts.onChange && opts.onChange();
          }, 'asking');
        });
        box.append(f);
        if (state.focusAsk) { state.focusAsk = false; setTimeout(() => input.focus(), 0); }
      }

      // the action row
      const acts = el('div', 'grow-acts');
      acts.append(btn('Ask here', 'btn small', () => { state.asking = !state.asking; state.focusAsk = state.asking; state.cutting = false; draw(); }));
      acts.append(btn('Note here', 'btn small', () => act(async () => {
        state.asking = false; state.cutting = false;
        const out = await api('POST', `/card/${key}/notes`, { text: '' });
        state.noting = out.layer.key;
        await reload();
      })));
      if (isWord) {
        const find = btn(state.busy === 'examples' ? 'Finding examples…' : 'Find more examples', 'btn small', () => act(async () => {
          say('Searching Hebrew sites for examples… this can take up to a minute.');
          const out = await api('POST', `/card/${key}/examples`);
          const refused = out.refused.length ? ` Left out ${out.refused.length}: ${[...new Set(out.refused.map((r) => r.why))].join('; ')}.` : '';
          say(out.added.length ? `Found ${out.added.length} new example${out.added.length === 1 ? '' : 's'}; keep the ones you want.${refused}`
            : `No new examples this time${out.already ? ` (${out.already} already on the card)` : ''}.${refused}`);
          state.othersOpen = true;
          await reload();
          opts.onChange && opts.onChange();
        }, 'examples'));
        find.disabled = state.busy === 'examples';
        acts.append(find);
      }
      box.append(acts);
      if (isWord) {
        const refs = el('div', 'grow-acts refs');
        refs.append(el('span', 'refs-label', 'Look up in'));
        for (const r of v.references) {
          const a = el('a', 'btn small ref');
          a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = r.label;
          a.dataset.ref = r.id;
          // the page opens from the tap itself (no pop-up blocker); the lookup is recorded beside it
          a.addEventListener('click', () => { api('POST', `/card/${key}/lookup`, { reference: r.id }).then(reload).catch((e) => say(`The lookup was not recorded: ${e.message}`, true)); });
          refs.append(a);
        }
        box.append(refs);
      }
      const more = el('div', 'grow-acts');
      more.append(btn('Branch a new card from here', 'btn small', () => branchFrom(key)));
      more.append(btn(state.cutting ? 'Choosing where to cut…' : 'Cut this card in two', 'btn small', () => { state.cutting = !state.cutting; state.asking = false; draw(); }));
      box.append(more);
      box.append(el('p', 'grow-msg' + (state.bad ? ' bad' : ''), state.msg));

      // the footer
      const f = v.footer, bits = [];
      if (f.origin) bits.push(f.origin.from === 'card' ? `${f.origin.via} ${f.origin.text}` : `Born from ${f.origin.text}`);
      bits.push(f.desks.length ? `on ${f.desks.length === 1 ? '1 desk' : `${f.desks.length} desks`}: ${f.desks.map((d) => d.name).join(', ')}` : 'on no desk');
      bits.push(`${f.branched === 1 ? '1 card' : `${f.branched} cards`} branched from it`);
      box.append(el('div', 'grow-foot', bits.join(' · ')));
    }

    draw();
    reload();
    return { reload };
  }

  window.GrowUI = { show, day, sourceLabel };
})();
