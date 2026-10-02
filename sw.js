/* J&M AROMAS — Service Worker
 * - App shell (index, manifest, iconos): cache-first con actualización en segundo plano
 * - Navegación: red primero, caché como respaldo (funciona sin conexión)
 * - Librerías CDN y Google Fonts: stale-while-revalidate
 * - Supabase (datos/auth/storage) y peticiones no-GET: SIEMPRE a la red, nunca se cachean
 * Para forzar actualización en todos los dispositivos: sube la versión de CACHE_VERSION.
 */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `jm-aromas-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `jm-aromas-runtime-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL))
    // No hacemos skipWaiting automático: la app muestra el aviso "Nueva versión".
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('jm-aromas-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase y cualquier otra API: directo a la red
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  // Navegación (abrir la app): red primero, caché si no hay conexión
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Recursos del mismo origen (iconos, manifest): cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // CDN (Chart.js, supabase-js, xlsx, qrcode, fuentes): stale-while-revalidate
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});
