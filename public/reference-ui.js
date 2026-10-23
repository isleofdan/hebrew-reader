'use strict';
// A reference shown inside the reader (hebrew-lookup-one): the pane under a
// card's "Look up in" row and under a tab of the Look up page. It asks
// GET /reference/<id>?term=<word> only when called — on Dan's tap — and draws
// what comes back: the site's own page in a frame, a cleaned copy in a
// sandboxed frame under one line saying so, or the failure line. Every way
// out to the live site opens a new tab; nothing else does.
//
//   ReferenceUI.open(box, { api, reference, term, label, onClose, request })
// fills `box` (emptied first) and answers the server's reply. `request`
// (hebrew-english-one) is the address asked instead of /reference/<id>: a
// row of an English look-up opens its Pealim entry or its Wiktionary page
// through GET /english/entry, which answers the same shapes.

(function () {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function liveLink(url, text) {
    const a = el('a', 'ref-live', text);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  async function open(box, { api, reference, term, label, onClose, request }) {
    const seq = String(Number(box.dataset.refSeq || 0) + 1);
    box.dataset.refSeq = seq;
    box.innerHTML = '';
    box.className = 'ref-pane';
    box.dataset.ref = reference;
    const head = el('div', 'ref-head');
    const title = el('span', 'ref-title', `${label} · `);
    const w = el('span', 'he', term); w.dir = 'rtl'; title.append(w);
    const close = el('button', 'btn small ref-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${label}`);
    close.addEventListener('click', () => { box.dataset.refSeq = String(Number(box.dataset.refSeq) + 1); box.innerHTML = ''; box.className = 'ref-pane hidden'; delete box.dataset.ref; if (onClose) onClose(); });
    head.append(title, close);
    const body = el('div', 'ref-body');
    body.append(el('p', 'ref-wait', `Opening ${label}…`));
    box.append(head, body);
    let got;
    try {
      got = await api('GET', request || `/reference/${encodeURIComponent(reference)}?term=${encodeURIComponent(term)}`);
    } catch (e) {
      got = { mode: 'failed', url: null, reason: e.message };
    }
    if (box.dataset.refSeq !== seq) return got; // closed, or another reference opened meanwhile
    body.innerHTML = '';
    box.dataset.mode = got.mode;
    if (got.mode === 'frame') {
      const f = el('iframe', 'ref-frame');
      f.src = got.frame_url || got.url;
      f.title = `${label}: ${term}`;
      f.referrerPolicy = 'no-referrer';
      // the site's own page, working as on its site; it cannot reach the reader (another origin)
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
      const line = el('p', 'ref-line');
      line.append(document.createTextNode(`${label}'s own page. `), liveLink(got.url, 'Open the site'));
      body.append(line, f);
    } else if (got.mode === 'copy') {
      const line = el('p', 'ref-line');
      line.append(document.createTextNode('Shown from a copy fetched by the reader; open the site for the live page. '), liveLink(got.url, 'Open the site'));
      const f = el('iframe', 'ref-frame copy');
      // no scripts, no access to the reader; its links open the live site in a new tab
      f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      f.title = `${label}: ${term} (a copy)`;
      f.srcdoc = got.html;
      body.append(line, f);
    } else {
      const line = el('p', 'ref-line bad');
      line.append(document.createTextNode('The site did not answer; open it directly. '));
      if (got.url) line.append(liveLink(got.url, `Open ${label}`));
      body.append(line);
      if (got.reason) body.append(el('p', 'ref-why', `(${got.reason})`));
    }
    return got;
  }

  window.ReferenceUI = { open };
})();
