// sw.js
const APP_VERSION = "2026-02-14-1"; // <-- aumente quando publicar update
const CACHE_NAME = `financeapp-${APP_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// 1) Instala: faz cache sem quebrar se 1 arquivo falhar
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Evita o erro do addAll travar tudo se um arquivo der 404
    const results = await Promise.allSettled(
      CORE_ASSETS.map((url) => cache.add(url))
    );

    // Se quiser debugar:
    // results.forEach((r, i) => { if (r.status === "rejected") console.warn("Cache fail:", CORE_ASSETS[i], r.reason); });

    // NÃO ativa automaticamente aqui; vamos ativar quando o usuário clicar "Atualizar agora"
  })());
});

// 2) Ativa: limpa caches antigos e assume controle
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("financeapp-") && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

// 3) Mensagem do app: quando clicar "Atualizar agora", fazemos skipWaiting
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// 4) Fetch: navegação (index) = network-first com fallback; assets = cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Navegação do app (SPA): tenta rede, se falhar usa cache
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match("./index.html");
        return cached || caches.match("./");
      }
    })());
    return;
  }

  // Assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  })());
});
