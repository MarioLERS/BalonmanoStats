const CACHE = 'hk-stats-v8';
const FILES = [
  './balonmano_stats.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo_hk.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(FILES);
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

self.addEventListener('fetch', function(e) {
  // 'no-store' evita que el navegador conteste con su propia caché HTTP por debajo de
  // nuestra caché — si no, aunque subamos una versión nueva del sw.js, la petición de red
  // "fetch" de aquí abajo puede resolverse igualmente con una copia antigua sin volver a tocar el servidor.
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).catch(function() {
      return caches.match(e.request);
    })
  );
});
