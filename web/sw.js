// Service Worker für Offline-Support
const CACHE_NAME = 'rechnungsapp-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/firebase-config.js',
  '/store.js',
  '/pdf-generator.js',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Firebase/CDN requests: network first
  if (event.request.url.includes('googleapis.com') ||
      event.request.url.includes('gstatic.com') ||
      event.request.url.includes('firestore')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // App files: cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
