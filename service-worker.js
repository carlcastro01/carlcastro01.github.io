/*
 * Service worker for ConnectTa
 *
 * This service worker implements a cache-first strategy for core assets
 * and a network-first strategy with fallback for dynamic resources such as
 * map tiles and remote ES modules. When offline, the app will still load
 * and display previously cached data. Tile requests are cached individually
 * so that map tiles previously visited remain available in offline mode.
 */

const CACHE_NAME = 'connectta-cache-v1';

// List of resources to precache on installation. These files are vital
// for the application shell to render offline. Remote resources used
// directly by the application (Leaflet, ESM modules) are included here
// to ensure that the service worker caches them on first install.
const PRECACHE_URLS = [
  '/connectta/index.html',
  '/connectta/style.css',
  '/connectta/app.js',
  '/connectta/manifest.json',
  '/connectta/icons/icon-192.png',
  '/connectta/icons/icon-512.png',
  // Leaflet assets
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.js',
  // Meshtastic ES modules (core and transports)
  'https://esm.sh/@meshtastic/core',
  'https://esm.sh/@meshtastic/transport-web-serial',
  'https://esm.sh/@meshtastic/transport-web-bluetooth',
  'https://esm.sh/@meshtastic/transport-http'
];

// Installation event: pre-cache critical resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

// Activate event: clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: serve cached content when offline and update cache when online
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle map tile requests separately to cache them individually
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => {
              return cachedResponse;
            });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // For our own domain and trusted third‑party resources, use cache-first.
  if (
    url.origin === self.location.origin ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('esm.sh')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request)
            .then((networkResponse) => {
              // Update cache with fresh copy
              return caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, networkResponse.clone());
                return networkResponse;
              });
            })
            .catch(() => {
              // If the request is for a page, show the offline shell
              if (request.headers.get('accept')?.includes('text/html')) {
                return caches.match('/connectta/index.html');
              }
              return undefined;
            })
        );
      })
    );
  }
});