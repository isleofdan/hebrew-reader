'use strict';
// Lessons from Guy: a PDF in, its lines out as the lesson's items.
//
// Guy's PDFs are text PDFs: one word, phrase or sentence per line, no
// explanations. The text comes out through unpdf (pdf.js, pure JavaScript),
// which already turns right-to-left runs into reading order; this file puts
// the runs of one printed line together and the lines into items.

const { ReaderError } = require('./db');
const db = require('./db');

const MAX_BYTES = 5 * 1024 * 1024;
const MIN_ITEMS = 5;
const HEBREW = /[א-ת]/;

// The item rule. One item per non-empty printed line. A line is joined to the
// next one only when the PDF itself wrapped a sentence there: the line runs
// the full width of the text block (at least 90% of the block, and at least
// 60% of the page, so the longest short item on a page is never taken for a
// wrapped one) and does not end in . ! ? or :. Lines with no Hebrew letter
// (a header, a date, a name) are left out and counted.
const FULL_OF_BLOCK = 0.9;
const FULL_OF_PAGE = 0.6;

let unpdf = null;
function pdfLib() {
  if (!unpdf) unpdf = require('unpdf');
  return unpdf;
}

// Printed lines of one page: [{ text, left, right }], top to bottom.
function pageLines(items) {
  const runs = items.filter((it) => it.str && it.str.trim()).map((it) => ({
    str: it.str, dir: it.dir, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height) || Math.abs(it.transform[3]) || 10,
  }));
  runs.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const r of runs) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= Math.max(2, r.h * 0.4));
    if (line) line.runs.push(r); else lines.push({ y: r.y, runs: [r] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => {
    const rtl = l.runs.filter((r) => r.dir === 'rtl').length >= l.runs.length / 2;
    const ordered = [...l.runs].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    let text = '';
    let prev = null;
    for (const r of ordered) {
      if (prev) {
        const gap = rtl ? prev.x - (r.x + r.w) : r.x - (prev.x + prev.w);
        if (gap > r.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(r.str)) text += ' ';
      }
      text += r.str;
      prev = r;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      left: Math.min(...l.runs.map((r) => r.x)),
      right: Math.max(...l.runs.map((r) => r.x + r.w)),
    };
  }).filter((l) => l.text);
}

// { items, other, chars } from the PDF bytes. Throws a ReaderError naming what
// was wrong with the file.
async function extract(buf, name) {
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ReaderError(400, `${name} is not a PDF.`);
  }
  let doc;
  try {
    doc = await pdfLib().getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new ReaderError(422, `${name} could not be read as a PDF: ${e.message}`);
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const width = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const pl = pageLines(content.items);
    if (!pl.length) continue;
    const blockLeft = Math.min(...pl.map((l) => l.left));
    const blockRight = Math.max(...pl.map((l) => l.right));
    for (const l of pl) {
      const extent = l.right - l.left;
      l.wrapped = extent >= FULL_OF_BLOCK * (blockRight - blockLeft) && extent >= FULL_OF_PAGE * width && !/[.!?:]$/.test(l.text);
      lines.push(l);
    }
  }
  const joined = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].text;
    while (lines[i].wrapped && i + 1 < lines.length) text += ' ' + lines[++i].text;
    joined.push(text);
  }
  const items = joined.filter((t) => HEBREW.test(t));
  return { items, other: joined.length - items.length, chars: joined.join('').length };
}

// --- title and date from the file name --------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Guy's file names: "Daniel HEB 15jun26", "Daniel Hebrew 24feb26",
// "Daniel Guy 10FEB2025", "Daniel Guy 21oct2024".
const NAME_PATTERN = /^Daniel\s+(?:HEB|Hebrew|Guy)\s+(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{4}|\d{2})$/i;

function lessonTitle(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `שיעור עם גיא — ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

// { title, lesson_date, from } where from is 'file name pattern' or 'file name'.
function nameAndDate(fileName, today = new Date().toISOString().slice(0, 10)) {
  const base = String(fileName || 'lesson.pdf').replace(/\.pdf$/i, '').trim();
  const m = NAME_PATTERN.exec(base);
  if (m) {
    const day = Number(m[1]), month = MONTHS[m[2].toLowerCase()];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const date = new Date(Date.UTC(year, (month || 1) - 1, day));
    if (month && date.getUTCDate() === day && date.getUTCMonth() === month - 1) {
      const iso = date.toISOString().slice(0, 10);
      return { title: lessonTitle(iso), lesson_date: iso, from: 'file name pattern' };
    }
  }
  return { title: base || 'Lesson', lesson_date: today, from: 'file name' };
}

// --- upload -----------------------------------------------------------------

// The PDF in, the lesson stored. Answers { lesson, created, note }.
async function add({ fileName, bytes }) {
  const name = String(fileName || '').trim() || 'lesson.pdf';
  if (bytes.length > MAX_BYTES) throw new ReaderError(413, `${name} is over 5 MB; a lesson PDF is a few dozen KB.`);
  const { items, other, chars } = await extract(bytes, name);
  if (!items.length) {
    throw new ReaderError(422, chars
      ? `No Hebrew text was found in ${name}: ${other} line${other === 1 ? '' : 's'} of other text only.`
      : `No text was found in ${name}; it may be a scan, and this app reads text PDFs only.`);
  }
  if (items.length < MIN_ITEMS) {
    throw new ReaderError(422, `Only ${items.length} Hebrew item${items.length === 1 ? ' was' : 's were'} found in ${name}; a lesson needs at least ${MIN_ITEMS}.`);
  }
  const text = items.join('\n');
  const existing = db.lessonByText(text);
  if (existing) return { lesson: existing, created: false, note: `This lesson is already here, as "${existing.title}".` };
  const named = nameAndDate(name);
  const lesson = db.addLesson({ title: named.title, lesson_date: named.lesson_date, source_name: name, text, items });
  const notes = [named.from === 'file name pattern'
    ? 'Title and date read from the file name.'
    : 'The file name is not one of Guy\'s patterns, so the title is the file name and the date is today\'s.'];
  if (other) notes.push(`${other} line${other === 1 ? '' : 's'} with no Hebrew left out.`);
  console.log(`lesson ${lesson.id}: "${lesson.title}" from ${name}, ${items.length} items (${named.from})`);
  return { lesson, created: true, from: named.from, note: notes.join(' ') };
}

module.exports = { extract, nameAndDate, add, MIN_ITEMS, MAX_BYTES, NAME_PATTERN };
