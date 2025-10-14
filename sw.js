const CACHE_NAME = 'thixx-v95'; // Version erhöht, um den Cache zu erneuern
const ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/manifest.webmanifest',
    '/ThiXX/config.json',
    // Neue Standard-Icons
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png',
    // Andere Design-Icons
    '/ThiXX/assets/THiXX_Icon_192x192.png',
    '/ThiXX/assets/THiXX_Icon_512x512.png',
    // Originale Icons für SIGX hinzugefügt
    '/ThiXX/assets/icon-192.png',
    '/ThiXX/assets/icon-512.png'
];

// Install event: precache all essential assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell');
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

    // --- STRATEGIE 1: Netzwerk zuerst (für kritische, oft geänderte Dateien) ---
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

    // --- STRATEGIE 2: Netzwerk mit Fallback auf Cache (für die Hauptseite) ---
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

    // --- STRATEGIE 3: Cache zuerst (für statische Assets, die sich selten ändern) ---
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

