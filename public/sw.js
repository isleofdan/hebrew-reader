// The service worker that makes the phone page installable (session
// fourteen). It keeps no copy of anything: every request goes to the server
// as it would without it, so the app stays exactly as live as the site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* the network answers, as always */ });
