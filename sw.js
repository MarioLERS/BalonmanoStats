const CACHE = 'hk-stats-v28';
const HTML = './balonmano_stats.html';
const FILES = [
  HTML,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo_hk.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // cache:'reload' salta la caché HTTP del navegador (GitHub Pages sirve max-age=600):
      // sin esto, un sw.js nuevo podía rellenar su caché con una copia de hasta 10 min antes.
      return cache.addAll(FILES.map(function(u){ return new Request(u, {cache:'reload'}); }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Red con 'no-store' (nunca la caché HTTP por debajo de la nuestra) y, si responde bien,
// se guarda en nuestra caché para el siguiente arranque.
function fromNetwork(req, key) {
  return fetch(req, {cache:'no-store'}).then(function(res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ return c.put(key, copy); });
    }
    return res;
  });
}

// Regla 83 (2026-09-25): antes era network-first para TODO, así que cada arranque esperaba a
// descargar el HTML entero (~250 KB comprimidos) y Android dejaba su splash nativo puesto
// hasta entonces. Ahora los archivos propios salen al instante de la caché y se actualizan en
// segundo plano; la versión nueva la detecta la comprobación de version.json (regla 43), que
// recarga con ?fresh= para que el HTML de ESA carga venga de la red y no de la caché.
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Firebase, Google Fonts...: caché HTTP normal del navegador (sus URL llevan versión).
  if (url.origin !== self.location.origin) return;
  // version.json siempre de la red: es la referencia para detectar versiones nuevas.
  if (/\/version\.json$/.test(url.pathname)) return;
  var isDoc = /\/balonmano_stats\.html$/.test(url.pathname);
  var key = isDoc ? HTML : req;
  if (isDoc && url.searchParams.has('fresh')) {
    e.respondWith(fromNetwork(req, HTML).catch(function(){ return caches.match(HTML); }));
    return;
  }
  var net = fromNetwork(req, key);
  e.waitUntil(net.catch(function(){}));
  e.respondWith(
    caches.match(key, {ignoreSearch: isDoc}).then(function(hit) {
      return hit || net.catch(function(){ return caches.match(key, {ignoreSearch: true}); });
    })
  );
});
