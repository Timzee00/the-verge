const VERSION = 'the-verge-shell-v3';
const PRECACHE_URLS = [];

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isApiRequest(requestUrl) {
  return requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/');
}

async function putInCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const cache = await caches.open(VERSION);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))
      )),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url) || isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html')
        .then((cached) => cached ?? fetch(request)
          .then((response) => putInCache(new Request('/index.html'), response))
        )
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached ?? fetch(request).then((response) => putInCache(request, response))
    )
  );
});
