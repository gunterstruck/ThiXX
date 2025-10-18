const APP_CACHE_NAME = 'thixx-shell-v2'; // Version erhöht für Cache-Aktualisierung
const DOC_CACHE_NAME = 'thixx-docs-v1';

const APP_ASSETS_TO_CACHE = [
    './',
    './index.html',
    './offline.html',
    './assets/style.css',
    './assets/app.js',
    './config.json',
    './assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    './assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png',
    './lang/de.json',
    './lang/en.json',
    './lang/es.json',
    './lang/fr.json',
    './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching App Shell');
                return cache.addAll(APP_ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== APP_CACHE_NAME && cacheName !== DOC_CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Strategie für Dokumente (PDFs): Cache First, dann Network.
    // Wichtig für Offline-Verfügbarkeit der Anleitungen.
    if (request.url.includes('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(async (cache) => {
                const cachedResponse = await cache.match(request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Wenn nicht im Cache, vom Netzwerk holen (und für die Zukunft cachen)
                const fetchRequest = request.clone();
                return fetch(fetchRequest).then(response => {
                    if (response.ok) {
                        const responseToCache = response.clone();
                        cache.put(request, responseToCache);
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Standardstrategie: Network falling back to cache.
    event.respondWith(
        fetch(request)
            .catch(() => {
                return caches.match(request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Wenn eine Navigation fehlschlägt, zeige die Offline-Seite.
                    if (request.mode === 'navigate') {
                        return caches.match('./offline.html');
                    }
                    return new Response(null, { status: 404 });
                });
            })
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.action === 'cache-doc' && event.data.url) {
        console.log('[SW] Caching instruction received:', event.data.url);
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(new Request(event.data.url, { mode: 'no-cors' }))) // no-cors ist wichtig für externe URLs
                .then(() => console.log('[SW] Doc cached successfully:', event.data.url))
                .catch(err => console.error('[SW] Failed to cache doc:', err))
        );
    }
});

