'use strict';
// Crash reporting in the page (hebrew-crash-one). Loaded on every page before
// the page's own scripts, right after /sentry.min.js (Sentry's browser
// bundle, served from this site). The server writes the DSN into each page as
// <meta name="sentry-dsn">; with none (npm test, a local run) this does
// nothing.
//
// Only the error and where in the code it happened leave the page. The
// reader's addresses and logs carry the Hebrew Dan looks up (/share?text=…,
// /lookup?…), so every event loses its request (the page address and
// headers), its user, its transaction name, its extra data (a wrapped
// callback's arguments), and the breadcrumbs that carry addresses, logs or
// page text: http, fetch, xhr, console, navigation and
// ui.* (a click's element names its labels). A stack frame keeps its file,
// line and column but not the query or fragment of its address: an inline
// script's frames are named by the page's own address (/sheet.html?lesson=…).
//
// The same file is required by lib/crash.js, so the server scrubs with the
// same rule.
(function () {
  var DROPPED = ['http', 'fetch', 'xhr', 'console', 'navigation'];

  function dropped(crumb) {
    var c = (crumb && crumb.category) || '';
    return DROPPED.indexOf(c) >= 0 || c.indexOf('ui.') === 0;
  }

  function bare(url) {
    return typeof url === 'string' ? url.replace(/[?#].*$/, '') : url;
  }

  function scrubFrames(list) {
    (list || []).forEach(function (v) {
      var frames = v && v.stacktrace && v.stacktrace.frames;
      (frames || []).forEach(function (f) {
        ['filename', 'abs_path', 'module'].forEach(function (k) { if (k in f) f[k] = bare(f[k]); });
      });
    });
  }

  function scrub(event) {
    delete event.request;
    delete event.user;
    delete event.transaction;
    delete event.extra;
    scrubFrames(event.exception && event.exception.values);
    scrubFrames(event.threads && event.threads.values);
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.filter(function (b) { return !dropped(b); });
    } else if (event.breadcrumbs && Array.isArray(event.breadcrumbs.values)) {
      event.breadcrumbs.values = event.breadcrumbs.values.filter(function (b) { return !dropped(b); });
    }
    return event;
  }

  // What both sides pass to Sentry.init besides the DSN.
  var SETTINGS = {
    environment: 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: scrub,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scrub: scrub, SETTINGS: SETTINGS, DROPPED: DROPPED };
    return;
  }
  var meta = document.querySelector('meta[name="sentry-dsn"]');
  var dsn = meta && meta.getAttribute('content');
  if (!dsn || !window.Sentry) return;
  var options = { dsn: dsn };
  for (var k in SETTINGS) options[k] = SETTINGS[k];
  window.Sentry.init(options);
})();
