const APP_CACHE_NAME = 'thixx-v110'; // Version erhöht, um Update zu erzwingen
const DOC_CACHE_NAME = 'thixx-docs-v1'; // Separater Cache für Dokumente

const APP_ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/config.json',
    // Nur noch die korrekten Icons cachen
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png'
];

// Install: Cacht die App-Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => cache.addAll(APP_ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// NEU: Funktion, um ausstehende Downloads abzuarbeiten
const processPendingDownloads = async () => {
    const pending = JSON.parse(localStorage.getItem('pendingDownloads') || '[]');
    if (pending.length === 0) return;

    console.log('[Service Worker] Verarbeite ausstehende Downloads:', pending);
    const docCache = await caches.open(DOC_CACHE_NAME);
    
    for (const url of pending) {
        try {
            await docCache.add(url);
            console.log(`[Service Worker] ${url} erfolgreich gecacht.`);
        } catch (err) {
            console.error(`[Service Worker] Fehler beim Cachen von ${url}:`, err);
        }
    }
    
    // Bereinige die Liste nach der Verarbeitung
    localStorage.removeItem('pendingDownloads');
    console.log('[Service Worker] Ausstehende Downloads abgeschlossen.');
};


// Activate: Räumt alte Caches auf UND prüft auf ausstehende Downloads
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        // Lösche alle Caches, die nicht dem aktuellen App-Cache oder Doku-Cache entsprechen
                        if (cacheName !== APP_CACHE_NAME && cacheName !== DOC_CACHE_NAME) {
                            console.log('[Service Worker] Lösche alten Cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            processPendingDownloads() // Prüft direkt beim Aktivieren
        ]).then(() => self.clients.claim())
    );
});

// Fetch: Liefert Assets aus dem Cache, wenn offline
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Priorität: Dokumente aus dem Doku-Cache, falls vorhanden
    if (url.pathname.endsWith('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(cache => {
                return cache.match(request).then(response => {
                    // Wenn im Cache, liefere es. Ansonsten versuche, es aus dem Netzwerk zu holen.
                    return response || fetch(request);
                });
            })
        );
        return;
    }

    // App-Dateien mit Netzwerk-First oder Cache-First Strategie
    if (APP_ASSETS_TO_CACHE.some(asset => url.pathname.endsWith(asset))) {
         event.respondWith(
            caches.match(request).then(cachedResponse => {
                const fetchPromise = fetch(request).then(networkResponse => {
                    const cacheToUpdate = caches.open(APP_CACHE_NAME);
                    cacheToUpdate.then(cache => cache.put(request, networkResponse.clone()));
                    return networkResponse;
                });
                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // Fallback für Navigation
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('/ThiXX/offline.html'))
        );
    }
});

// Lauscht auf Nachrichten von der App
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-doc') {
        console.log('[Service Worker] Anweisung zum Cachen erhalten:', event.data.url);
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(event.data.url))
        );
    }
});

