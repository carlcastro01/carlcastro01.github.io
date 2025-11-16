// Simple SW: cache-first for app shell; network-first for tiles (then cache).
const CACHE = 'connectta-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/app/main.js',
  '/app/meshtasticClient.js',
  '/app/storage.js',
  '/app/map.js',
  '/app/ui.js',
  '/app/utils.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // Cache-first for app shell and same-origin
  if(url.origin === location.origin){
    e.respondWith(
      caches.match(e.request).then(res=> res || fetch(e.request).then(resp=>{
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
        return resp;
      }).catch(()=>caches.match('/index.html')))
    );
    return;
  }
  // For map tiles and CDNs: network-first, fallback to cache
  e.respondWith(
    fetch(e.request).then(resp=>{
      const copy = resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return resp;
    }).catch(()=>caches.match(e.request))
  );
});
