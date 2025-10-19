const APP_CACHE_NAME = 'thixx-robust-v1'; // Version erhöht für Update
const DOC_CACHE_NAME = 'thixx-docs-v1';

const APP_ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/theme-bootstrap.js', // Neue Datei hinzugefügt
    '/ThiXX/config.json',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png',
    '/ThiXX/lang/de.json',
    '/ThiXX/lang/en.json', // Wird fehlertolerant gecached
    '/ThiXX/lang/es.json', // Wird fehlertolerant gecached
    '/ThiXX/lang/fr.json'  // Wird fehlertolerant gecached
];

/**
 * ROBUSTHEITS-UPDATE (Fehlertolerantes Caching):
 * Diese Funktion ersetzt `cache.addAll()`. Sie versucht, jede URL einzeln
 * zu cachen. Wenn eine Ressource nicht gefunden wird (z.B. eine optionale
 * Sprachdatei), wird nur eine Warnung ausgegeben, und der Service Worker
 * setzt die Installation mit den restlichen Dateien fort. Dies verhindert,
 * dass ein einziger 404-Fehler die gesamte Offline-Fähigkeit der App blockiert.
 *
 * @param {Cache} cache - Die Cache-Instanz, zu der hinzugefügt wird.
 * @param {string[]} urls - Ein Array von URLs, die gecached werden sollen.
 */
async function safeCacheAddAll(cache, urls) {
  console.log('[Service Worker] Starting robust caching of assets.');
  let successCount = 0;
  for (const url of urls) {
    try {
      await cache.add(url);
      successCount++;
    } catch (err) {
      console.warn(`[Service Worker] Skipping asset: ${url} failed to cache.`, err);
    }
  }
  console.log(`[Service Worker] Robust caching finished. Successfully cached ${successCount} of ${urls.length} assets.`);
}


// Install-Event: Cachen der App-Shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => {
                // Verwende die neue, robuste Caching-Funktion
                return safeCacheAddAll(cache, APP_ASSETS_TO_CACHE);
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

    // Strategie für Dokumente (PDFs): Cache First, dann Network.
    if (url.pathname.endsWith('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(async (cache) => {
                const noCorsRequest = new Request(request.url, { mode: 'no-cors' });
                const cachedResponse = await cache.match(noCorsRequest);
                if (cachedResponse) {
                    return new Response(cachedResponse.body, {
                        headers: { 'Content-Type': 'application/pdf' },
                    });
                }
                return fetch(request);
            })
        );
        return;
    }
    
    // "Cache First" für Navigationsanfragen, damit die App offline startet.
    if (request.mode === 'navigate') {
        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {
                    // Wenn im Cache, liefere von dort. Ansonsten Netzwerk.
                    // Bei Netzwerkfehler, zeige die Offline-Seite.
                    return cachedResponse || fetch(request).catch(() => {
                        return caches.match('/ThiXX/offline.html');
                    });
                })
        );
        return;
    }

    // "Stale-While-Revalidate" für andere App-Assets (JS, CSS, etc.)
    // Liefert schnell aus dem Cache, aktualisiert aber im Hintergrund.
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
});

// Message-Event: Lauscht auf Anweisungen von der App.
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-doc') {
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(new Request(event.data.url, { mode: 'no-cors' })))
                .catch(err => console.error('[Service Worker] Failed to cache doc:', err))
        );
    }
});

