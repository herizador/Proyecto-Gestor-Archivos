// Service worker del Gestor Familiar.
//
// Reglas:
//  · Network-first: la app siempre pide a la red; la caché es solo último recurso.
//  · NO se cachea HTML ni ninguna vista del dashboard. Antes se guardaba `/`, que
//    redirige a /login: offline aparecía la pantalla de login (o una vista vieja)
//    y el usuario creía que la app estaba "congelada".
//  · Solo se precachean manifest e iconos (estables y sin datos privados).
//  · Al cambiar este archivo hay que subir CACHE_NAME para que los móviles
//    suelten la versión anterior.
const CACHE_NAME = 'gestor-familiar-v7';

const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const PAGINA_SIN_RED = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sin conexión · Gestor Familiar</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
           background: #f4f7fc; color: #111a2e; padding: 24px; }
    main { background: #fff; border-radius: 16px; padding: 32px 28px; max-width: 380px;
           text-align: center; box-shadow: 0 12px 32px rgba(17, 26, 46, .08); }
    h1 { font-size: 1.15rem; margin: 0 0 8px; }
    p { margin: 0 0 20px; font-size: .92rem; line-height: 1.5; color: #5b6478; }
    button { border: 0; border-radius: 10px; padding: 11px 20px; font-size: .95rem;
             font-weight: 600; color: #fff; background: #3b66f5; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Sin conexión</h1>
    <p>No se pudo contactar con el servidor. Comprueba tu conexión (WiFi o datos) y vuelve a intentarlo.</p>
    <button type="button" onclick="location.reload()">Reintentar</button>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              return caches.delete(cache);
            }
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Solo GET del propio origen: los POST (Server Actions), las URLs firmadas de
  // R2 y las peticiones a Supabase no pasan nunca por aquí.
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Única caché permitida: los estáticos precacheados.
        const url = new URL(event.request.url);
        if (ASSETS_TO_CACHE.includes(url.pathname)) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return response;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // La cabecera x-sw-offline distingue este 503 (sin red) de un 503 real
        // del servidor: si aparece, el problema es la conexión del dispositivo.
        return new Response(PAGINA_SIN_RED, {
          status: 503,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'x-sw-offline': '1',
          },
        });
      })
  );
});
