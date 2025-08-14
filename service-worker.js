const CACHE_NAME = 'warehouse-pwa-cache-v1';
const FILES_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',   // 你的圖示
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css'
];
const OFFLINE_URL = './offline.html';

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', evt => {
  const requestURL = new URL(evt.request.url);

  // 不快取 API 請求
  if (requestURL.origin.includes('script.google.com')) {
    evt.respondWith(fetch(evt.request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  evt.respondWith(
    caches.match(evt.request).then(resp => {
      return resp || fetch(evt.request).catch(() => caches.match(OFFLINE_URL));
    })
  );
});
