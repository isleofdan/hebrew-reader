// The installed app's icons (session fourteen): the letter א, white on the
// site's accent, drawn by the local browser into public/icon-192.png and
// public/icon-512.png. The shape leaves the middle 80% for the letter, so an
// Android launcher's round mask never cuts it.
//   node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0"><div style="width:${size}px;height:${size}px;background:#2f6f6a;display:flex;align-items:center;justify-content:center">
    <span style="font-family:'Noto Serif Hebrew','Frank Ruhl Libre','DejaVu Serif',serif;font-size:${Math.round(size * 0.56)}px;color:#fbfaf6;line-height:1;transform:translateY(-4%)">א</span></div></body></html>`);
  await page.screenshot({ path: join(root, 'public', `icon-${size}.png`) });
  await page.close();
}
await browser.close();
console.log('icons written: public/icon-192.png, public/icon-512.png');
