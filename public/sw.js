const CACHE = 'leo-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((response) => response || caches.match('/'))),
  );
});

self.addEventListener('push', (event) => {
  const message = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(message.title || 'Feeding reminder', {
    body: message.body || 'The next feeding is due.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: message.tag || 'feed-due',
    renotify: true,
    data: { url: message.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    return existing ? existing.focus() : self.clients.openWindow(event.notification.data?.url || '/');
  }));
});
