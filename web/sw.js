// Service Worker für Zakflow PWA
// Strategie: network-first mit Cache-Fallback.
// → Nutzer bekommen immer die neueste Version, offline läuft es per Cache weiter.
const CACHE_NAME = 'zakflow-v3';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Nur GET cachen
  if (req.method !== 'GET') return;

  // Firebase/Firestore: immer Netzwerk (Echtzeit-Daten)
  const url = req.url;
  if (url.includes('firestore') || url.includes('googleapis.com') || url.includes('identitytoolkit')) {
    return; // Standard-Netzwerkverhalten
  }

  // App-Dateien + CDN: network-first, bei Offline aus Cache
  event.respondWith(
    fetch(req)
      .then(res => {
        // Erfolgreiche Antworten in den Cache legen
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
  );
});
