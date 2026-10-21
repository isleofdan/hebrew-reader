'use strict';
// The reader's Ask box: one question about this piece to the hebrew desk of
// the ask surface (POST /ask, subject article, hebrew-ask-one), which
// searches the references; the brief answer and the pages the search cited
// are drawn under it. The article's mapped words go along so questions about
// this piece are answered from data. Under a drawn answer, "Ask more" sends
// a follow-up: the model is given the earlier questions and answers of this
// thread first. A new question in the top box starts a new thread.
//
// An answer the search cited nothing for is still an answer: it draws with a
// quiet line saying nothing came back to look up. The red line is only for a
// question that could not be asked at all, and the server's message says why.

(function () {
  const $ = (s) => document.querySelector(s);
  const q = $('#ask-q'), go = $('#ask-go'), msg = $('#ask-msg'), box = $('#ask-answer'), thread = $('#ask-thread');
  const moreQ = $('#ask-more-q'), moreGo = $('#ask-more-go'), moreMsg = $('#ask-more-msg');
  let last = null; // the id of the thread's latest answer, the next follow-up's parent

  async function send(field, button, line, parent) {
    const question = field.value.trim();
    line.className = 'msg';
    if (!question) { line.className = 'msg error'; line.textContent = 'Type a question first.'; return; }
    button.disabled = true;
    line.textContent = 'asking…';
    try {
      const article = window.Reader.article;
      const data = await window.Reader.api('POST', '/ask', { desk: 'hebrew', subject: { kind: 'article', article_id: article ? article.id : undefined }, question, parent: parent || undefined });
      line.textContent = '';
      if (!parent) thread.innerHTML = '';
      // drawn as the ask pane draws an answer (ask-ui.js): the question, the answer, each cited page
      window.AskUI.drawTurn(thread, question, data);
      last = data.id;
      field.value = parent ? '' : field.value;
      box.classList.remove('hidden');
    } catch (e) {
      if (!parent) box.classList.add('hidden');
      line.className = 'msg error'; line.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }

  const ask = () => send(q, go, msg, null);
  const askMore = () => send(moreQ, moreGo, moreMsg, last);
  go.addEventListener('click', ask);
  moreGo.addEventListener('click', askMore);
  for (const [field, fn] of [[q, ask], [moreQ, askMore]]) {
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn(); } });
  }
})();
