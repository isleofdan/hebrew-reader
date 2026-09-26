'use strict';
// The sheet for the reMarkable (session fourteen), laid out as it prints:
// one page per group of the desk, a group that does not fit continuing on
// the next page; each page headed "From the desk of <desk> · sheet N of M"
// and closed by the line saying nothing written here comes back. The page
// is made to print; Dan prints it to PDF and puts the file on his reMarkable.

(function () {
  const $ = (s) => document.querySelector(s);
  const BINYAN = { paal: "Pa'al", nifal: "Nif'al", piel: "Pi'el", pual: "Pu'al", hifil: "Hif'il", hufal: "Huf'al", hitpael: "Hitpa'el" };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function he(text, cls) { const s = el('span', cls ? `he ${cls}` : 'he', text); s.dir = 'rtl'; return s; }

  // A card as the sheet shows it: headword with nikud, root · binyan · gloss,
  // kept examples with their source (no link), asked lines, notes, ink small.
  function cardBlock(c) {
    const box = el('section', `s-card ${c.kind}`);
    box.dataset.key = c.key;
    if (c.kind === 'word') {
      const head = el('div', 's-head');
      head.append(he(c.pointed, 'pointed'));
      if (c.pointed !== c.word) head.append(he(c.word, 'plain'));
      box.append(head);
      const line = el('div', 's-line');
      const bits = [];
      if (c.root) bits.push(he(c.root));
      if (c.binyan) bits.push(document.createTextNode(BINYAN[c.binyan] || c.binyan));
      else if (c.pos) bits.push(document.createTextNode(c.pos));
      if (c.gloss) bits.push(document.createTextNode(c.gloss));
      bits.forEach((b, i) => { if (i) line.append(document.createTextNode(' · ')); line.append(b); });
      box.append(line);
    } else {
      box.append(el('div', 's-kind', 'note'));
      const t = el('p', 's-note', c.text || '');
      t.dir = 'auto';
      box.append(t);
      if (c.link_title) { const l = el('div', 's-muted', c.link_title); l.dir = 'auto'; box.append(l); }
    }
    for (const x of c.examples) {
      const s = el('p', 's-ex', x.sentence); s.lang = 'he';
      box.append(s, el('div', 's-src', `— ${x.source}`));
    }
    for (const a of c.asked) {
      box.append(el('div', 's-kind', 'asked'));
      const q = el('p', 's-q', a.question); q.dir = 'auto';
      box.append(q, el('p', 's-a', a.answer));
    }
    for (const n of c.notes) {
      box.append(el('div', 's-kind', 'note'));
      const t = el('p', 's-note', n); t.dir = 'auto';
      box.append(t);
    }
    for (const strokes of c.ink || []) {
      box.append(el('div', 's-kind', 'note · ink'));
      const pic = window.InkUI.picture(strokes);
      pic.classList.add('s-ink');
      box.append(pic);
    }
    return box;
  }

  // Dan's link: "you linked these: <sentence>".
  function linkBlock(l) {
    const b = el('div', 's-link', `you linked these: ${l.sentence}`);
    b.dir = 'auto';
    return b;
  }

  function blocksOf(g, i, all) {
    const blocks = [];
    const joined = all.filter((x) => !x.alone).length;
    const title = g.alone ? (all.length > 1 ? 'Cards on their own' : '') : joined > 1 ? `Group ${i + 1}` : '';
    for (const c of g.cards) blocks.push(cardBlock(c));
    for (const l of g.links) blocks.push(linkBlock(l));
    if (g.prompts.length) {
      blocks.push(el('p', 'prompts-title', 'Write'));
      g.prompts.forEach((p, n) => {
        const b = el('p', 'prompt');
        b.dataset.kind = p.kind;
        b.append(el('span', 'n', `${n + 1}.`));
        const t = el('span', 't', p.text); t.dir = 'auto';
        b.append(t);
        blocks.push(b);
      });
    } else if (g.prompts_error) {
      blocks.push(el('p', 's-muted', 'No writing prompts this time: they could not be made. Write what these cards bring to mind.'));
    }
    return { title, blocks };
  }

  function newPage(title, continued) {
    const page = el('section', 'page');
    const head = el('div', 'page-head');
    head.append(el('span', 'where'));
    head.append(el('span', 'group', title ? `${title}${continued ? ' (continued)' : ''}` : continued ? '(continued)' : ''));
    const body = el('div', 'page-body');
    page.append(head, body, el('div', 'page-foot'));
    $('#sheet-pages').append(page);
    return { page, body };
  }

  const over = (body) => body.scrollHeight > body.clientHeight + 1;

  function lay(sheet) {
    const pages = [];
    sheet.groups.forEach((g, i) => {
      const { title, blocks } = blocksOf(g, i, sheet.groups);
      let cur = newPage(title, false);
      pages.push(cur.page);
      for (const b of blocks) {
        cur.body.append(b);
        if (over(cur.body) && cur.body.children.length > 1) {
          b.remove();
          cur = newPage(title, true);
          pages.push(cur.page);
          cur.body.append(b);
        }
      }
      // what is left of the group's last page is ruled for writing
      const space = el('div', 'write-space');
      cur.body.append(space);
      if (over(cur.body)) space.remove();
    });
    pages.forEach((p, n) => {
      p.querySelector('.where').textContent = `From the desk of ${sheet.desk_name} · sheet ${n + 1} of ${pages.length}`;
      p.querySelector('.page-foot').textContent = sheet.footer;
    });
    return pages.length;
  }

  async function start() {
    const id = (/\/desk\/sheet\/(\d+)$/.exec(location.pathname) || [])[1];
    let sheet;
    try {
      const r = await fetch(`/sheets/${id}`, { headers: { accept: 'application/json' } });
      if (r.status === 401) { location.href = '/login'; return; }
      sheet = await r.json();
      if (!r.ok) throw new Error(sheet.error || `The server answered ${r.status}.`);
    } catch (e) { $('#msg').textContent = `The sheet could not be opened: ${e.message}`; return; }
    document.title = `Sheet from ${sheet.desk_name} — Hebrew reader`;
    $('#how').textContent = `${sheet.delivery}.`;
    // the faces first, so the pages break where they will print: a face is
    // fetched only when asked for, so each is asked for by name
    const faces = ['600 30px "Noto Serif Hebrew"', '400 17px "Frank Ruhl Libre"', '600 14px "Frank Ruhl Libre"', '400 15px "Assistant"', '700 13px "Assistant"'];
    try { await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f, 'אבג abc'))), new Promise((r) => setTimeout(r, 5000))]); } catch { /* the fallback faces */ }
    const again = () => { $('#sheet-pages').innerHTML = ''; document.body.dataset.pages = String(lay(sheet)); };
    again();
    const msg = $('#msg');
    if (msg) msg.remove();
    // a face that arrives later changes the text's height: the pages are laid again
    document.fonts.addEventListener('loadingdone', again);
  }

  $('#print').addEventListener('click', () => window.print());
  start();
})();
