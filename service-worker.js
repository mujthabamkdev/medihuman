const CACHE = 'medihuman-shell-v5';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles/00-tokens.css',
  '/styles/01-base.css',
  '/styles/02-typography.css',
  '/styles/03-layout.css',
  '/styles/04-components.css',
  '/styles/05-views.css',
  '/styles/06-roles.css',
  '/styles/07-utilities.css',
  '/styles/08-responsive.css',
  '/src/app.js',
  '/src/client/state.js',
  '/src/client/ui.js',
  '/src/client/views.js',
  '/src/client/controller.js',
  '/src/api-client.js',
  '/src/ocr-adapter.js',
  '/src/medication-logic.js',
  '/src/clinical-logic.js',
  '/src/icon.svg',
  '/manifest.json',
];

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
