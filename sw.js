const APP_CACHE_NAME = 'thixx-shell-v150';
const DOC_CACHE_NAME = 'thixx-docs-v1';

// Alle Assets, die für die App-Shell benötigt werden
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

    // Strategie: "Network falling back to cache" für die meisten Anfragen.
    // Bei Navigationsanfragen wird bei einem Fehler die offline.html ausgeliefert.
    event.respondWith(
        fetch(request)
            .catch(() => {
                return caches.match(request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (request.mode === 'navigate') {
                        return caches.match('./offline.html');
                    }
                    return new Response(null, { status: 404 });
                });
            })
    );
});

// Message-Event: Lauscht auf Anweisungen von der App (z.B. zum Cachen von Dokumenten).
self.addEventListener('message', (event) => {
    if (event.data?.action === 'cache-doc' && event.data.url) {
        console.log('[Service Worker] Caching instruction received:', event.data.url);
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(new Request(event.data.url, { mode: 'no-cors' })))
                .then(() => console.log('[Service Worker] Doc cached successfully:', event.data.url))
                .catch(err => console.error('[Service Worker] Failed to cache doc:', err))
        );
    }
});
