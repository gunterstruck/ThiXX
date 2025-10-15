const APP_CACHE_NAME = 'thixx-v111'; // Version erhöht, um Update mit neuen Sprachdateien zu erzwingen
const DOC_CACHE_NAME = 'thixx-docs-v1'; // Separater Cache für Dokumente

const APP_ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/config.json',
    // Icons
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png', // FIX: Korrekter Icon-Pfad
    // NEU: Sprachdateien für Offline-Verfügbarkeit hinzufügen
    '/ThiXX/assets/lang/de.json',
    '/ThiXX/assets/lang/en.json',
    '/ThiXX/assets/lang/es.json',
    '/ThiXX/assets/lang/fr.json'
];

// Install: Cacht die App-Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => cache.addAll(APP_ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// REMOVED: Die Funktion processPendingDownloads wurde entfernt, da localStorage im Service Worker nicht verfügbar ist.

// Activate: Räumt alte Caches auf
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== APP_CACHE_NAME && cacheName !== DOC_CACHE_NAME) {
                        console.log('[Service Worker] Lösche alten Cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Liefert Assets aus dem Cache, wenn offline
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Strategie für Dokumente (PDFs)
    if (url.pathname.endsWith('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(cache => {
                return cache.match(request).then(response => {
                    return response || fetch(request);
                });
            })
        );
        return;
    }

    // Strategie für App-Dateien (Cache, falling back to Network with revalidation)
    if (APP_ASSETS_TO_CACHE.some(asset => url.pathname.endsWith(asset.substring(6)))) { // Angepasst für robusten Pfadvergleich
         event.respondWith(
            caches.match(request).then(cachedResponse => {
                const fetchPromise = fetch(request).then(networkResponse => {
                    caches.open(APP_CACHE_NAME).then(cache => {
                        cache.put(request, networkResponse.clone());
                    });
                    return networkResponse;
                });
                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // Fallback für Navigation (z.B. bei direkten Seitenaufrufen)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/ThiXX/offline.html'))
        );
    }
});

// Lauscht auf Nachrichten von der App (z.B. zum Cachen von Dokumenten)
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-doc') {
        console.log('[Service Worker] Anweisung zum Cachen erhalten:', event.data.url);
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(event.data.url))
        );
    }
});

