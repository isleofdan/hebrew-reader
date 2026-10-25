// Builds public/sentry.min.js, Sentry's browser SDK as one minified script
// served from this site (hebrew-crash-one), exposing window.Sentry with only
// init and captureException: no tracing, no session replay, no feedback
// widget in the file at all. The npm package of @sentry/browser ships no
// ready bundle (its bundles are on Sentry's CDN only), so this script makes
// one with esbuild from the installed package.
//   npm run build   (the output is committed; the image does not run this)
// scripts/crash-smoke.mjs builds it again in memory and fails if the
// committed file differs, so it cannot drift from package-lock.json.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(root, 'public', 'sentry.min.js');

export async function sentryBundle({ write = false } = {}) {
  const { version } = JSON.parse(readFileSync(join(root, 'node_modules', '@sentry', 'browser', 'package.json'), 'utf8'));
  const out = await build({
    stdin: {
      contents: "import { init, captureException } from '@sentry/browser';\nwindow.Sentry = { init, captureException };\n",
      resolveDir: root,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    legalComments: 'none',
    banner: { js: `/* @sentry/browser ${version} (MIT, Functional Software, Inc.), built by scripts/build-sentry.mjs: window.Sentry = { init, captureException } */` },
    outfile: OUT,
    write,
    define: { __SENTRY_DEBUG__: 'false', __SENTRY_TRACING__: 'false' },
    logLevel: 'silent',
  });
  return write ? null : out.outputFiles[0].text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await sentryBundle({ write: true });
  console.log(`built ${OUT} (${readFileSync(OUT).length} bytes)`);
}
