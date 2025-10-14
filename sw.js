const CACHE_NAME = 'thixx-v84'; // Version erhöht für die neuen Icons
const ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/config.json',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/THiXX_Icon_192x192.png', // Korrekte Icons
    '/ThiXX/assets/THiXX_Icon_512x512.png',
    '/ThiXX/manifest.webmanifest'
];

// Install event: precache all essential assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell');
                // Use addAll with a catch to prevent install failure if one asset is missing
                return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                    console.error('[SW] Failed to cache assets during install:', err);
                });
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

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // --- STRATEGY 1: Network First (for critical, frequently updated files) ---
    if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css') || url.pathname.endsWith('/config.json')) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                    return networkResponse;
                })
                .catch(() => {
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
                    return caches.match(request)
                        .then((response) => {
                            return response || caches.match('/ThiXX/offline.html');
                        });
                })
        );
        return;
    }

    // --- STRATEGY 3: Cache First (for static assets that rarely change) ---
    event.respondWith(
        caches.match(request)
            .then((response) => {
                return response || fetch(request).then((networkResponse) => {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                    return networkResponse;
                });
            })
    );
});

