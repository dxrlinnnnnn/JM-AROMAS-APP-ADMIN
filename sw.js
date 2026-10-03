/* J&M AROMAS — Service Worker
   - App shell y librerías CDN disponibles sin conexión.
   - Supabase (datos, auth, RPC) NUNCA se cachea: siempre va a la red.
   Para forzar actualización en todos los dispositivos, sube el número de VERSION. */
const VERSION = 'v1';
const SHELL_CACHE = 'jm-shell-' + VERSION;
const LIB_CACHE = 'jm-libs-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-96.png'
];

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    // Las librerías se precargan una a una: si una falla no se rompe la instalación.
    const libs = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(async url => {
      try { await libs.add(new Request(url, { mode: 'no-cors' })); } catch (e) {}
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, LIB_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('jm-') && !keep.includes(k)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos y autenticación: siempre red, jamás caché.
  if (/(^|\.)supabase\.(co|in)$/.test(url.hostname)) return;

  // Navegación (HTML): red primero para recibir actualizaciones; caché si no hay conexión.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        const res = preload || await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(SHELL_CACHE);
          c.put('./index.html', res.clone());
        }
        return res;
      } catch (e) {
        const c = await caches.open(SHELL_CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) ||
          new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Librerías CDN y fuentes: caché primero, y se refresca en segundo plano.
  const isLib = /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (isLib) {
    event.respondWith((async () => {
      const c = await caches.open(LIB_CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // Archivos propios (íconos, manifest): caché primero.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) c.put(req, res.clone());
        return res;
      } catch (e) { return Response.error(); }
    })());
  }
});
