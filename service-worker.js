const CACHE = 'medihuman-shell-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/src/app.js', '/src/api-client.js', '/src/ocr-adapter.js', '/src/medication-logic.js', '/src/clinical-logic.js', '/src/icon.svg', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))));
});
