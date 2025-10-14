const CACHE_NAME = 'thixx-v73-fresh-start'; // KORREKTUR: Neue Version, um alles neu zu laden
const ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/config.js',

    // Original-Icons
    '/ThiXX/assets/icon-192.png',
    '/ThiXX/assets/icon-512.png',

    // Neue Icons
    '/ThiXX/assets/THiXX_Icon_192x192.png',
    '/ThiXX/assets/THiXX_Icon_512x512.png'
];

// Install event: precache all essential assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell for new version.');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('[Service Worker] New shell cached. Activating now.');
                return self.skipWaiting(); // Zwingt den neuen Service Worker zur sofortigen Aktivierung
            })
    );
});

// Activate event: clean up ALL old caches.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // KORREKTUR: Wir löschen JEDEN Cache, der nicht exakt der neuen Version entspricht
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[Service Worker] Old caches deleted. Claiming clients.');
            return self.clients.claim(); // Übernimmt die Kontrolle über alle offenen Tabs
        })
    );
});

// Fetch event: Network falling back to Cache strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                // Bei Erfolg: Cache aktualisieren
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                });
                return networkResponse;
            })
            .catch(() => {
                // Bei Fehler: Aus dem Cache bedienen
                return caches.match(request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Wenn nicht im Cache und Navigation: Offline-Seite zeigen
                    if (request.mode === 'navigate') {
                        return caches.match('/ThiXX/offline.html');
                    }
                    // Andernfalls gibt es keine Antwort
                    return new Response("Network error and not in cache", {
                        status: 404,
                        statusText: "Not Found"
                    });
                });
            })
    );
});

