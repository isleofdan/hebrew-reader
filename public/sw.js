// The service worker that makes the phone page installable (session
// fourteen). It keeps no copy of anything: every request goes to the server
// as it would without it, so the app stays exactly as live as the site.
// A recording (/recordings/<id>, hebrew-speech-one) is never cached either:
// it is not even handled here, so the player's ranged requests go straight
// to the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.startsWith('/recordings/')) return;
  /* the network answers, as always */
});
