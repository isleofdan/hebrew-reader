'use strict';
// Light, dark, or whatever the device asks for. Loaded in the <head> of every
// page that has the switch, so the ground is chosen before the first paint.
//
// Device is the default and writes nothing: the stylesheet's
// prefers-color-scheme block does the work. Light and Dark write data-theme
// on <html> and are remembered in this browser (localStorage). Storage can be
// missing or refused — a private window, blocked site data — so every read and
// write is wrapped; the switch still works for the life of the page.
(function () {
  var KEY = 'hebrew-reader.theme';
  var CHOICES = ['light', 'dark', 'device'];
  var CHROME = { light: '#fbfaf6', dark: '#1d1c16' }; // the top bar, for the browser's own chrome
  var root = document.documentElement;
  var choice = 'device';
  try {
    var saved = localStorage.getItem(KEY);
    if (CHOICES.indexOf(saved) >= 0) choice = saved;
  } catch (e) { /* no storage: this page keeps the device's choice */ }

  var darkNow = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolved() {
    return choice === 'device' ? (darkNow && darkNow.matches ? 'dark' : 'light') : choice;
  }

  function apply() {
    if (choice === 'device') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta && document.head) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    if (meta) meta.setAttribute('content', CHROME[resolved()]);
    var buttons = document.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute('data-theme-choice') === choice ? 'true' : 'false');
    }
  }

  function set(next) {
    if (CHOICES.indexOf(next) < 0) return;
    choice = next;
    try {
      if (next === 'device') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch (e) { /* not remembered, but this page follows the choice */ }
    apply();
  }

  apply();
  if (darkNow && darkNow.addEventListener) darkNow.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var box = document.querySelector('.theme');
    if (box) box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-theme-choice]');
      if (b) set(b.getAttribute('data-theme-choice'));
    });
  });

  window.Theme = { get choice() { return choice; }, resolved: resolved, set: set };
})();
