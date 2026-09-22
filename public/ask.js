'use strict';
// The reader's Ask box: one question to the references through POST /ask,
// the brief answer and its links drawn under it. The article's mapped words
// go along so questions about this piece are answered from data.
//
// An answer with no links is still an answer: it draws in the box with a
// quiet line saying nothing came back to look up. The red line under the
// button is only for a question the references could not be asked at all,
// and the server's message says why.

(function () {
  const $ = (s) => document.querySelector(s);
  const q = $('#ask-q'), go = $('#ask-go'), msg = $('#ask-msg'), box = $('#ask-answer');

  async function ask() {
    const question = q.value.trim();
    msg.className = 'msg';
    if (!question) { msg.className = 'msg error'; msg.textContent = 'Type a question first.'; return; }
    go.disabled = true;
    msg.textContent = 'asking…';
    try {
      const article = window.Reader.article;
      const data = await window.Reader.api('POST', '/ask', { question, article_id: article ? article.id : undefined });
      msg.textContent = '';
      $('#ask-text').textContent = data.answer;
      const links = $('#ask-links');
      links.innerHTML = '';
      for (const l of data.links || []) {
        const li = document.createElement('li');
        if (l.claim) { const c = document.createElement('span'); c.className = 'claim'; c.textContent = `${l.claim} · `; li.append(c); }
        const a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${l.label}: `;
        const t = document.createElement('span'); t.className = 'term'; t.textContent = l.term;
        a.append(t);
        li.append(a);
        links.append(li);
      }
      if (!links.children.length) {
        const li = document.createElement('li'); li.className = 'claim none'; li.textContent = 'Nothing here to look up in a reference.'; links.append(li);
      }
      box.classList.remove('hidden');
    } catch (e) {
      box.classList.add('hidden');
      msg.className = 'msg error'; msg.textContent = e.message;
    } finally {
      go.disabled = false;
    }
  }

  go.addEventListener('click', ask);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
})();
