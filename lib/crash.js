'use strict';
// Crash reporting (hebrew-crash-one): unexpected server errors go to Sentry,
// whose alert calls the spine, which files one Wall card per issue.
// Required as the first line of server.js, so Sentry is set up before
// anything else loads.
//
// SENTRY_DSN unset or empty (npm test, a local run): @sentry/node is never
// loaded and captureException and flush do nothing. Set (fly.toml [env]):
// only the error and its code location are sent, because the reader's URLs
// and logs carry the Hebrew Dan looks up. The scrub the pages use
// (public/crash.js) keeps a short list of fields and drops the rest
// (request, user, contexts, modules, source lines, variables, the
// breadcrumbs that carry addresses or logs), and its SETTINGS turn off what
// Sentry 11 would otherwise gather.

const { scrub, SETTINGS } = require('../public/crash.js');

const DSN = (process.env.SENTRY_DSN || '').trim();
let Sentry = null;

if (DSN) {
  Sentry = require('@sentry/node');
  Sentry.init({ dsn: DSN, ...SETTINGS });
}

function captureException(e) {
  if (Sentry) Sentry.captureException(e);
}

// Waits (at most `ms`) until what was captured has been sent.
async function flush(ms = 2000) {
  if (Sentry) await Sentry.flush(ms);
}

module.exports = { enabled: Boolean(Sentry), captureException, flush, scrub };
