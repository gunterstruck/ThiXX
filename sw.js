const APP_CACHE_NAME = 'thixx-robust-v6'; // Version erhöht, um Update auszulösen
const DOC_CACHE_NAME = 'thixx-docs-v1';

/*
 * WICHTIG: Sicherstellen, dass alle hier gelisteten Pfade erreichbar sind.
 * Fehlende Dateien können die Service Worker-Installation beeinträchtigen,
 * auch wenn safeCacheAddAll einzelne Fehler abfängt.
 */
const APP_ASSETS_TO_CACHE = [
    '/ThiXX/index.html',
    '/ThiXX/offline.html',
    '/ThiXX/assets/style.css',
    '/ThiXX/assets/app.js',
    '/ThiXX/assets/theme-bootstrap.js',
    '/ThiXX/config.json',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_192x192.png',
    '/ThiXX/assets/THiXX_Icon_Grau6C6B66_Transparent_512x512.png',
    '/ThiXX/lang/de.json',
    '/ThiXX/lang/en.json',
    '/ThiXX/lang/es.json',
    '/ThiXX/lang/fr.json'
];

async function safeCacheAddAll(cache, urls) {
  console.log('[Service Worker] Starting robust caching of assets.');
  const promises = urls.map(url => {
    return cache.add(url).catch(err => {
      console.warn(`[Service Worker] Skipping asset: ${url} failed to cache.`, err);
    });
  });
  await Promise.all(promises);
  console.log(`[Service Worker] Robust caching finished.`);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
            .then((cache) => safeCacheAddAll(cache, APP_ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== APP_CACHE_NAME && cacheName !== DOC_CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // KORREKTUR (PRIO 1): PDF-Caching für 'no-cors' Anfragen (opaque responses).
    // Die 'response.ok' Prüfung wurde entfernt, da sie bei opaque responses immer fehlschlägt.
    // So werden externe PDFs korrekt gecacht und offline verfügbar gemacht.
    if (url.pathname.endsWith('.pdf')) {
        event.respondWith(
            caches.open(DOC_CACHE_NAME).then(async (cache) => {
                const noCorsRequest = new Request(request.url, { mode: 'no-cors' });
                try {
                    const networkResponse = await fetch(noCorsRequest);
                    // Lege die (potenziell opaque) Antwort direkt in den Cache.
                    cache.put(noCorsRequest, networkResponse.clone());
                    return networkResponse;
                } catch (error) {
                    console.log('[Service Worker] Network fetch for PDF failed, trying cache.');
                    const cachedResponse = await cache.match(noCorsRequest);
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Wenn auch im Cache nichts ist, Fehler werfen.
                    throw error;
                }
            })
        );
        return;
    }
    
    // ROBUSTHEITS-UPDATE (Navigation-Fallback): Network-First mit robustem Cache-Fallback
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
          try {
            const networkResponse = await fetch(request);
            return networkResponse;
          } catch (error) {
            console.log('[Service Worker] Navigate fetch failed, trying cache fallbacks.');
            
            // ✅ KORREKTUR IMPLEMENTIERT: ignoreSearch: true ist entscheidend,
            // um Anfragen wie 'index.html?param=wert' gegen das gecachte 'index.html' zu matchen.
            const cached = await caches.match(request, { ignoreSearch: true });
            if (cached) return cached;
            
            // Diese Fallbacks sind weiterhin sinnvoll, falls der erste Match aus irgendeinem Grund fehlschlägt.
            const shell = await caches.match('/ThiXX/index.html');
            if (shell) return shell;
            
            return await caches.match('/ThiXX/offline.html');
          }
        })());
        return;
    }

    // Standard-Strategie "Stale-While-Revalidate" für alle anderen Assets
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            const fetchPromise = fetch(request).then(networkResponse => {
                caches.open(APP_CACHE_NAME).then(cache => {
                    if (networkResponse.ok) {
                        cache.put(request, networkResponse.clone());
                    }
                });
                return networkResponse;
            });
            return cachedResponse || fetchPromise;
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'cache-doc') {
        event.waitUntil(
            caches.open(DOC_CACHE_NAME)
                .then(cache => cache.add(new Request(event.data.url, { mode: 'no-cors' })))
                .catch(err => console.error('[Service Worker] Failed to cache doc:', err))
        );
    } else if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
