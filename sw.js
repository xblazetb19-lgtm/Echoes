/* ═══════════════════════════════════════════════
   SoundVault — Service Worker
   Gère le cache pour fonctionnement hors-ligne
═══════════════════════════════════════════════ */

const CACHE_NAME = 'soundvault-v1';
const ASSETS = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
];

// Installation : mise en cache des assets statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activation : supprime les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : cache-first pour les assets, network-first pour le reste
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignore les requêtes non-HTTP
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Met en cache les nouvelles ressources statiques
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback vers index.html pour la navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
