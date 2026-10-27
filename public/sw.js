// Sparky service worker: precache the app shell, serve it offline. API calls are never cached.
const CACHE = 'sparky-shell-v8';
const SHELL = [
  '/', '/index.html', '/style.css', '/app.js', '/orb.js', '/store.js', '/themes.js', '/memory.js', '/history.js', '/voice.js', '/wake.js', '/panels.js', '/listen.js', '/speech.js', '/tts.js', '/voicelog.js', '/night.js', '/narrate.js', '/topics.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Stale-while-revalidate for the shell; fall back to the cached page when offline.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || (req.mode === 'navigate' ? cache.match('/index.html') : Response.error());
    })
  );
});
