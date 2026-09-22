// Makes the sample lesson PDFs in scripts/fixtures/, in the shape of Guy's:
// a text PDF, one Hebrew word, phrase or sentence per line, no explanations.
// Chromium prints them, so the text is real PDF text with an embedded font,
// as a word processor would make it. One sentence is long enough to wrap
// onto a second line; one file has only two Hebrew lines, to be refused.
//   node scripts/make-fixtures.mjs
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(out, { recursive: true });

export const FIXTURES = {
  'Daniel HEB 15jun26.pdf': [
    'אי אפשר לעבוד באווירה רגועה',
    'חתימה או הסלמה',
    'טור דעה',
    'יו״ש',
    'להקיז דם',
    'הסלמה',
    'נאלצה',
    'הנהלה',
    'הממשלה נאלצה לדחות את ההצבעה על התקציב לשבוע הבא בגלל מחלוקת חריפה בין שותפות הקואליציה על חלוקת הכספים',
    'נחתם',
  ],
  'Daniel Hebrew 24feb26.pdf': [
    'שביתה',
    'להתבייש',
    'להתייבש',
    'לנהל שיחת טלפון',
    'מי נגד מי',
    'נלחם',
  ],
  'Daniel Guy 10FEB2025.pdf': [
    'בקשת סירוב',
    'שביתה כללית',
    'הסלמה',
    'לפחד מ',
    'לחכות ל',
  ],
  'notes two lines.pdf': [
    'Notes from the call',
    'שלום',
    'תודה רבה',
  ],
};

const html = (lines) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 25mm 25mm; }
  body { font-family: 'DejaVu Sans', 'FreeSans', sans-serif; font-size: 15pt; line-height: 1.5; margin: 0; }
  p { margin: 0 0 6pt; }
</style></head><body>${lines.map((l) => `<p>${l}</p>`).join('')}</body></html>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  for (const [name, lines] of Object.entries(FIXTURES)) {
    await page.setContent(html(lines));
    await page.pdf({ path: join(out, name), format: 'A4', printBackground: false });
    console.log(`made ${name}`);
  }
  await browser.close();
}
