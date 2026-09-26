'use strict';
// Ink (session fourteen): what Dan draws on a card with a pen or the mouse.
// Strokes are kept as points in fractions of the ink area's width — so one
// drawing shows the same on an opened card, a desk card and the sheet — and
// drawn as SVG in the text's own colour, so it reads in light and dark.
//
//   InkUI.picture(strokes, { width })   a drawing, to look at
//   InkUI.area({ strokes, editable, onStroke, onUndo })
//     an ink area the width of its box, growing downward as needed. When
//     editable, a pen tip or the mouse draws; a stroke is handed to
//     onStroke(points) as it ends; the pen's eraser, or "undo last stroke",
//     calls onUndo(). Touch never draws here (a finger scrolls).

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const MIN_H = 0.3;     // an empty area is 30% as tall as it is wide
  const ROOM = 0.18;     // room kept under the lowest stroke

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // A smooth path through a stroke's points (x, y in width units).
  function pathOf(points) {
    if (!points.length) return '';
    const p = points.map((q) => [q[0], q[1]]);
    if (p.length === 1) return `M${p[0][0]} ${p[0][1]} l0.0001 0`;
    let d = `M${p[0][0]} ${p[0][1]}`;
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      d += ` Q${p[i][0]} ${p[i][1]} ${mx} ${my}`;
    }
    const last = p[p.length - 1];
    return `${d} L${last[0]} ${last[1]}`;
  }

  // The stroke's width in screen pixels: its pen pressure when it has one.
  function widthOf(points, scale) {
    const ps = points.filter((q) => q.length > 2).map((q) => q[2]);
    const pr = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;
    return ((1.2 + pr * 2.4) * scale).toFixed(2);
  }

  function heightFor(strokes) {
    let maxY = 0;
    for (const s of strokes) for (const q of s) maxY = Math.max(maxY, q[1]);
    return Math.max(MIN_H, maxY + ROOM);
  }

  function svgFor(strokes, h, scale = 1) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ink-svg');
    svg.setAttribute('viewBox', `0 0 1 ${h.toFixed(4)}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svg.setAttribute('aria-hidden', 'true');
    for (const s of strokes) svg.append(strokePath(s, scale));
    return svg;
  }

  function strokePath(points, scale = 1) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathOf(points));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('stroke-width', widthOf(points, scale));
    return path;
  }

  // A drawing to look at: strokes = [points, ...] or [{ points }, ...].
  function picture(strokes, { scale = 1 } = {}) {
    const list = (strokes || []).map((s) => (Array.isArray(s) ? s : s.points));
    const box = el('div', 'ink-picture');
    box.append(svgFor(list, heightFor(list), scale));
    return box;
  }

  function area({ strokes = [], editable = false, onStroke, onUndo, label = 'draw here' } = {}) {
    const list = strokes.map((s) => (Array.isArray(s) ? s : s.points));
    const box = el('div', `ink-area${editable ? ' editable' : ''}`);
    const pad = el('div', 'ink-pad');
    box.append(pad);
    let h = heightFor(list);
    let svg = svgFor(list, h);
    pad.append(svg);
    if (editable && !list.length) pad.append(el('span', 'ink-hint', label));
    if (!editable) return box;

    const row = el('div', 'ink-acts');
    const undo = el('button', 'linklike ink-undo', 'undo last stroke');
    undo.type = 'button';
    undo.disabled = !list.length;
    undo.addEventListener('click', () => undoLast());
    const msg = el('span', 'ink-msg');
    row.append(undo, msg);
    box.append(row);

    const fit = () => {
      const want = heightFor(list);
      if (want > h) { h = want; svg.setAttribute('viewBox', `0 0 1 ${h.toFixed(4)}`); }
    };
    const say = (t) => { msg.textContent = t || ''; };
    // strokes and undos reach the server one after another, in the order
    // Dan made them: an undo never overtakes the stroke drawn just before it
    let queue = Promise.resolve();
    const inOrder = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

    async function undoLast() {
      if (!list.length) return;
      const gone = list.pop();
      const paths = svg.querySelectorAll('path');
      if (paths.length) paths[paths.length - 1].remove();
      undo.disabled = !list.length;
      try { await inOrder(() => onUndo()); say(''); } catch (e) { list.push(gone); svg.append(strokePath(gone)); undo.disabled = false; say(`Not undone: ${e.message}`); }
    }

    let live = null;
    const at = (e) => {
      const r = pad.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.width;
      const pt = [Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000, Math.round(Math.max(0, y) * 10000) / 10000];
      if (e.pointerType === 'pen' && e.pressure > 0) pt.push(Math.round(e.pressure * 100) / 100);
      return pt;
    };
    const eraser = (e) => e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) === 32);

    pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;          // a finger scrolls; a pen or the mouse draws
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (eraser(e)) { undoLast(); return; }
      const hint = pad.querySelector('.ink-hint');
      if (hint) hint.remove();
      pad.setPointerCapture(e.pointerId);
      live = { id: e.pointerId, points: [at(e)], path: strokePath([at(e)]) };
      svg.append(live.path);
    });
    pad.addEventListener('pointermove', (e) => {
      if (!live || e.pointerId !== live.id) return;
      const pt = at(e);
      const prev = live.points[live.points.length - 1];
      if (Math.abs(pt[0] - prev[0]) + Math.abs(pt[1] - prev[1]) < 0.002) return;
      live.points.push(pt);
      live.path.setAttribute('d', pathOf(live.points));
      live.path.setAttribute('stroke-width', widthOf(live.points, 1));
      if (pt[1] > h - ROOM / 2) { h = pt[1] + ROOM; svg.setAttribute('viewBox', `0 0 1 ${h.toFixed(4)}`); }
    });
    const end = async (e) => {
      if (!live || e.pointerId !== live.id) return;
      const done = live;
      live = null;
      list.push(done.points);
      undo.disabled = false;
      fit();
      try { await inOrder(() => onStroke(done.points)); say(''); } catch (err) {
        list.splice(list.indexOf(done.points), 1);
        done.path.remove();
        undo.disabled = !list.length;
        say(`Not saved: ${err.message}`);
      }
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    return box;
  }

  window.InkUI = { area, picture, pathOf };
})();
