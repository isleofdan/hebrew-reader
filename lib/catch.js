'use strict';
// A link on a note card (session fourteen): shared from another app on the
// phone, or pasted into a new card. The note is saved at once with the bare
// link; the page's title is fetched afterwards, once, on the server, and
// kept beside the link when it comes. A failure leaves the bare link and is
// never retried; the save never waits for it.

const articles = require('./articles');
const desk = require('./desk');

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// The page's own title: its og:title, else its <title>.
function titleOf(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]*>/i.exec(html);
  const content = og && /content=["']([^"']*)["']/i.exec(og[0]);
  const t = content ? content[1] : ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  return decode(t).replace(/\s+/g, ' ').trim();
}

// One try at the title of `url` for note `id`; answers the note, or null.
async function fillTitle(id, url) {
  try {
    const { html } = await articles.fetchHtml(url);
    const title = titleOf(html);
    if (!title) { console.log(`note ${id}: its link's page has no title; the bare link stays`); return null; }
    return desk.setNoteTitle(id, url, title);
  } catch (e) {
    console.log(`note ${id}: the title of its link could not be fetched (${e.message.replace(/ Paste the text instead\.$/, '')}); the bare link stays`);
    return null;
  }
}

// Starts the fetch without waiting on it (the save has already answered).
function later(key, url) {
  if (!url) return;
  const id = Number(String(key).split(':')[1]);
  fillTitle(id, url).catch(() => {});
}

module.exports = { titleOf, fillTitle, later };
