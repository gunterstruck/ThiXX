const CACHE_NAME = 'thixx-v80'; // Finale Version, um alles zu überschreiben
const ASSETS_TO_CACHE = [
    // WICHTIG: Pfade müssen exakt mit der Server-Struktur übereinstimmen
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/config.js',
    '/ThiXX/assets/icon-192.png',
    '/ThiXX/assets/icon-512.png',
    '/ThiXX/assets/THiXX_Icon_192x192.png',
    '/ThiXX/assets/THiXX_Icon_512x512.jpg' // Korrekter Dateityp .jpg
];

// Install event: Neues Caching
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching app shell for FINAL version.');
                // Wir fügen eine "no-cache" Anweisung hinzu, um sicherzugehen, dass die Dateien frisch vom Server geholt werden
                const requests = ASSETS_TO_CACHE.map(url => new Request(url, {cache: 'no-cache'}));
                return cache.addAll(requests);
            })
            .then(() => {
                console.log('[Service Worker] New shell cached. Activating immediately.');
                return self.skipWaiting();
            })
    );
});

// Activate event: Radikales Aufräumen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting ALL old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[Service Worker] Claiming clients now.');
            return self.clients.claim();
        })
    );
});

// Fetch event: Network First, dann Cache
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request, {cache: 'no-cache'}) // Immer zuerst das Netzwerk versuchen
            .then((networkResponse) => {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            })
            .catch(() => { // Nur wenn das Netzwerk fehlschlägt, den Cache verwenden
                return caches.match(event.request).then((cachedResponse) => {
                    return cachedResponse || caches.match('/ThiXX/offline.html');
                });
            })
    );
});

