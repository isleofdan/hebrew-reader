'use strict';
// Crash reporting in the page (hebrew-crash-one; the keep-list scrub and
// settings from isleofdan/starting-kit). Loaded on every page before the
// page's own scripts, right after /sentry.min.js (Sentry's browser bundle,
// served from this site). The server writes the DSN into each page as
// <meta name="sentry-dsn">; with none (npm test, a local run) this does
// nothing.
//
// Only the error and where in the code it happened leave the page. The
// reader's addresses, logs, page text and source carry the Hebrew Dan looks
// up (/share?text=…, /lookup?…), so the scrub keeps a short list and drops
// everything else. An event keeps its id, time, level, platform,
// environment, release, the SDK's name and version, and its exceptions:
// each one's type, message, how it was caught (mechanism type and handled),
// and stack frames with only file, module, function, line, column and
// in_app. Gone: the request (the page address and headers), the user, the
// transaction name, extra data (a wrapped callback's arguments), tags, the
// server's name, every context (machine, operating system, device, locale,
// time zone), the list of installed modules, threads, a frame's surrounding
// source lines and local variables, and the breadcrumbs that carry
// addresses, logs or page text: http, fetch, xhr, console, navigation and
// ui.* (a click's element names its labels). A stack frame keeps its file,
// line and column but not the query or fragment of its address: an inline
// script's frames are named by the page's own address
// (/sheet.html?lesson=…).
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

  function pick(from, keys) {
    var out = {};
    keys.forEach(function (k) { if (from && from[k] !== undefined) out[k] = from[k]; });
    return out;
  }

  var EVENT_KEYS = ['event_id', 'timestamp', 'level', 'platform', 'environment', 'release', 'sdkProcessingMetadata'];
  var FRAME_KEYS = ['filename', 'abs_path', 'module', 'function', 'lineno', 'colno', 'in_app'];
  var MECHANISM_KEYS = ['type', 'handled', 'synthetic', 'source', 'exception_id', 'parent_id', 'is_exception_group'];

  function frame(f) {
    var out = pick(f, FRAME_KEYS);
    ['filename', 'abs_path', 'module'].forEach(function (k) { if (k in out) out[k] = bare(out[k]); });
    return out;
  }

  function exception(v) {
    var out = pick(v, ['type', 'value']);
    if (v && v.mechanism) out.mechanism = pick(v.mechanism, MECHANISM_KEYS);
    var frames = v && v.stacktrace && v.stacktrace.frames;
    if (Array.isArray(frames)) out.stacktrace = { frames: frames.map(frame) };
    return out;
  }

  // Builds the event that is sent from the short list above; nothing else
  // of the original survives. (sdkProcessingMetadata is the SDK's own note
  // to itself for the envelope; it is never sent.)
  function scrub(event) {
    var out = pick(event, EVENT_KEYS);
    if (event.sdk) out.sdk = pick(event.sdk, ['name', 'version']);
    var values = event.exception && event.exception.values;
    if (Array.isArray(values)) out.exception = { values: values.map(exception) };
    if (Array.isArray(event.breadcrumbs)) {
      out.breadcrumbs = event.breadcrumbs.filter(function (b) { return !dropped(b); });
    } else if (event.breadcrumbs && Array.isArray(event.breadcrumbs.values)) {
      out.breadcrumbs = { values: event.breadcrumbs.values.filter(function (b) { return !dropped(b); }) };
    }
    return out;
  }

  // The integrations that would gather what the scrub drops are not run at
  // all: source lines around each frame (read from disk), local variables,
  // the machine and locale contexts, the module list.
  var SKIPPED = ['ContextLines', 'LocalVariables', 'LocalVariablesAsync', 'Context', 'CultureContext', 'Modules'];

  // What both sides pass to Sentry.init besides the DSN.
  var SETTINGS = {
    environment: 'production',
    sendDefaultPii: false,
    includeServerName: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    includeLocalVariables: false,
    // Sentry 11 decides what it gathers from dataCollection, whose defaults
    // gather everything (user and IP, cookies, headers, bodies, query
    // strings, frame variables, five source lines) whatever sendDefaultPii
    // says; with userInfo on, the page also asks Sentry to record the
    // visitor's IP address (infer_ip). All of it off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    integrations: function (defaults) {
      return defaults.filter(function (i) { return SKIPPED.indexOf(i.name) < 0; });
    },
    beforeSend: scrub,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scrub: scrub, SETTINGS: SETTINGS, DROPPED: DROPPED, SKIPPED: SKIPPED };
    return;
  }
  var meta = document.querySelector('meta[name="sentry-dsn"]');
  var dsn = meta && meta.getAttribute('content');
  if (!dsn || !window.Sentry) return;
  var options = { dsn: dsn };
  for (var k in SETTINGS) options[k] = SETTINGS[k];
  window.Sentry.init(options);
})();
