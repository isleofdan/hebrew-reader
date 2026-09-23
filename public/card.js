'use strict';
// The reader's word card: fills the desktop panel or the phone sheet from
// POST /lookup through the shared CardUI, and keeps the page's tints in step.
// The lesson page uses it too: its Reader answers source() with the lesson.

(function () {
  const UI = window.CardUI;
  const cards = [document.getElementById('card-desktop'), document.getElementById('card-phone')];
  let current = null; // { span, surface, card, spot, sentence }
  let seq = 0;

  function activeCard() {
    return window.Reader.DESKTOP.matches ? cards[0] : cards[1];
  }

  async function showCard(span) {
    const surface = span.dataset.surface;
    const sentence = span.dataset.sentence || '';
    const card = activeCard();
    const my = ++seq;
    current = { span, surface, sentence, card: null, spot: null };
    UI.setLoading(card, surface);
    try {
      const source = window.Reader.source ? window.Reader.source() : { article_id: window.Reader.article.id };
      const data = await window.Reader.api('POST', '/lookup', { surface, sentence, ...source });
      if (my !== seq) return;
      current.card = data.card; current.spot = data.spot;
      UI.fill(card, data);
      UI.addPoints(card, data, { api: window.Reader.api, sentence, isCurrent: () => my === seq });
      if (data.spot) {
        const marks = window.Reader.marks;
        marks[surface] = { spot_id: data.spot.id, status: data.spot.status, hint: UI.hint(data.card) };
        window.Reader.applyTints();
        span.classList.add('active');
      }
    } catch (e) {
      if (my !== seq) return;
      UI.setError(card, surface, e.message);
    }
  }

  async function setStatus(status) {
    if (!current || !current.spot) return;
    const data = await UI.saveStatus(activeCard(), window.Reader.api, current, status);
    if (!data) return;
    const marks = window.Reader.marks;
    if (marks[current.surface]) marks[current.surface].status = data.spot.status;
    else marks[current.surface] = { spot_id: data.spot.id, status: data.spot.status, hint: '' };
    window.Reader.applyTints();
    current.span.classList.add('active');
  }

  for (const card of cards) {
    UI.wire(card, { onStatus: setStatus, getCurrent: () => current, onClose: () => { card.classList.add('idle'); seq++; } });
  }

  window.showCard = showCard;
})();
