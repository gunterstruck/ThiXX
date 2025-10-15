const APP_CACHE_NAME = 'thixx-v119'; // Version erhöht für Cache-Update
const DOC_CACHE_NAME = 'thixx-docs-v1';

// Alle Assets, die für die App-Shell benötigt werden
const APP_ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/config.json',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png',
    '/ThiXX/lang/de.json',
    '/ThiXX/lang/en.json',
    '/ThiXX/lang/es.json',
    '/ThiXX/lang/fr.json'
];

// Install-Event: Cachen der App-Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching App Shell');
                return cache.addAll(APP_ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate-Event: Aufräumen alter Caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== APP_CACHE_NAME && cacheName !== DOC_CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch-Event: Ausliefern von Inhalten
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // KORREKTUR: Neue, verbesserte Logik für PDFs
    // Strategie für Dokumente (PDFs): Immer zuerst im Cache nachsehen, egal welcher Ursprung.
    if (url.pathname.endsWith('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);
                if (cachedResponse) {
                    console.log('[Service Worker] Serving doc from cache:', url.href);
                    return cachedResponse;
                }
                console.log('[Service Worker] Doc not in cache, fetching from network:', url.href);
                // Wenn nicht im Cache, vom Netzwerk holen
                return fetch(request);
            })
        );
        return;
    }

    // Anfragen, die keine PDFs sind und nicht vom eigenen Ursprung stammen,
    // sollen direkt ans Netzwerk weitergeleitet werden.
    if (url.origin !== self.origin) {
        event.respondWith(fetch(request));
        return;
    }

    // Strategie für App-Assets: Stale-While-Revalidate
    if (APP_ASSETS_TO_CACHE.some(asset => url.pathname.endsWith(asset.split('/').pop()))) {
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

    // Fallback für die Navigation (nur für die eigene Seite): Versuche Netzwerk, sonst zeige Offline-Seite
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/ThiXX/offline.html'))
        );
    }
});

// Message-Event: Lauscht auf Anweisungen von der App
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-doc') {
        console.log('[Service Worker] Caching instruction received:', event.data.url);
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                // Wichtig: 'no-cors' wird für externe Inhalte benötigt, damit der Download nicht blockiert wird.
                .then(cache => cache.add(new Request(event.data.url, { mode: 'no-cors' })))
                .then(() => console.log('[Service Worker] Doc cached successfully:', event.data.url))
                .catch(err => console.error('[Service Worker] Failed to cache doc:', err))
        );
    }
});

