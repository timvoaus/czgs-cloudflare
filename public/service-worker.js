const CACHE_NAME = 'czgs-app-shell-v1';
const RUNTIME_CACHE_NAME = 'czgs-runtime-v1';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-centered.ico?v=9',
  '/favicon-centered.png?v=9',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/style.css?v=21',
  '/traffic-map.css?v=22',
  '/script.js?v=61',
  '/sync-engine.js',
  '/traffic-map.js?v=23'
];

const isApiRequest = (url) => url.origin === self.location.origin && url.pathname.startsWith('/api/');

const isStaticAssetRequest = (request, url) => {
  if (request.method !== 'GET') return false;
  if (isApiRequest(url)) return false;

  return (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest')
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || isApiRequest(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseCopy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const networkResponse = fetch(request)
          .then((response) => {
            if (response && (response.ok || response.type === 'opaque')) {
              const responseCopy = response.clone();
              caches.open(url.origin === self.location.origin ? CACHE_NAME : RUNTIME_CACHE_NAME)
                .then((cache) => cache.put(request, responseCopy));
            }
            return response;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkResponse;
      })
    );
  }
});
