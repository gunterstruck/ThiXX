const CACHE_NAME = 'thixx-v1';
const ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/icon-192.png',
    '/ThiXX/assets/icon-512.png',
    '/ThiXX/manifest.webmanifest'
];

// Install event: precache all essential assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: serve from network, fall back to cache, then to offline page for navigation.
self.addEventListener('fetch', (event) => {
    // We only want to handle GET requests.
    if (event.request.method !== 'GET') {
        return;
    }

    // For navigation requests (loading a page).
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    // If network fails, try to serve from cache.
                    return caches.match(event.request)
                        .then((response) => {
                            // If not in cache, serve the offline fallback page.
                            return response || caches.match('/ThiXX/offline.html');
                        });
                })
        );
        return;
    }

    // For all other requests (CSS, JS, images), use a cache-first strategy.
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // If the resource is in the cache, serve it.
                if (response) {
                    return response;
                }
                // Otherwise, fetch from the network.
                return fetch(event.request).then((networkResponse) => {
                    // Optionally, you can cache the new resource here if needed.
                    // Be careful with what you cache dynamically.
                    return networkResponse;
                });
            })
            .catch(() => {
                // This is a generic fallback, but for non-navigation requests,
                // it might be better to just fail than to return the offline page.
            })
    );
});
