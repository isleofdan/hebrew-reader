'use strict';
// "Delete" on the reader and the lesson page: one tap shows one confirm in
// the page ("Delete this article? Saved words stay."), a second deletes and
// goes back to the list. Saved words, their touches and the spine are not
// touched; the server says so in its own log. `done`, when given, runs
// instead of going back to the list (a recording on the Look up page,
// hebrew-speech-one).
(function () {
  function wire({ button, bar, what, path, done = () => { location.href = '/'; } }) {
    const text = bar.querySelector('.confirm-text');
    const yes = bar.querySelector('[data-act="delete"]');
    const no = bar.querySelector('[data-act="keep"]');
    const msg = bar.querySelector('.msg');
    text.textContent = `Delete this ${what}? Saved words stay.`;
    // the confirm opens without scrolling: what Dan tapped stays where it was
    button.addEventListener('click', () => { bar.classList.remove('hidden'); msg.textContent = ''; yes.focus({ preventScroll: true }); });
    no.addEventListener('click', () => bar.classList.add('hidden'));
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      try {
        const res = await fetch(path(), { method: 'DELETE', headers: { accept: 'application/json' } });
        if (res.status === 401) { location.href = '/login'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
        bar.classList.add('hidden');
        yes.disabled = false;
        done(data);
      } catch (e) {
        msg.className = 'msg error';
        msg.textContent = e.message === 'Failed to fetch' ? 'The server could not be reached; nothing was deleted.' : e.message;
        yes.disabled = false;
      }
    });
  }
  window.DeleteUI = { wire };
})();
