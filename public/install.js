'use strict';
// Makes the site installable as an app on the phone (session fourteen), so
// other apps can share a line or a link into it. The service worker keeps
// nothing: the app is the live site.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* the site works the same without it */ }); });
}
