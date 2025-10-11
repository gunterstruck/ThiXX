const CACHE_NAME = 'thixx-v21'; // Version erhöht, um den Cache zu erneuern und neue Logik zu erzwingen
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

// Fetch event: Apply different caching strategies based on the request.
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle GET requests.
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // --- STRATEGY 1: Network First (for critical, frequently updated files) ---
    // For app.js and style.css, always try the network first.
    if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css')) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    // If successful, update the cache with the new version.
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                    return networkResponse;
                })
                .catch(() => {
                    // If the network fails, serve the file from the cache.
                    return caches.match(request);
                })
        );
        return;
    }

    // --- STRATEGY 2: Network falling back to Cache (for the main page) ---
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .catch(() => {
                    // If network fails, try to serve from cache.
                    return caches.match(request)
                        .then((response) => {
                            // If not in cache, serve the offline fallback page.
                            return response || caches.match('/ThiXX/offline.html');
                        });
                })
        );
        return;
    }

    // --- STRATEGY 3: Cache First (for static assets that rarely change) ---
    // For all other requests (images, manifest), serve from cache for performance.
    event.respondWith(
        caches.match(request)
            .then((response) => {
                // If the resource is in the cache, serve it.
                if (response) {
                    return response;
                }
                // Otherwise, fetch from the network and cache it for next time.
                return fetch(request).then((networkResponse) => {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                    return networkResponse;
                });
            })
    );
});

