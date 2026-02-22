// sw.js
const APP_VERSION = "2026-02-22-1"; // <-- aumente quando publicar update
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

const INDEX_URL = new URL("./index.html", self.location).toString();
const ROOT_URL = new URL("./", self.location).toString();

// 1) Instala: faz cache sem quebrar se 1 arquivo falhar
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.allSettled(
      CORE_ASSETS.map((url) => cache.add(url))
    );

    // Não chama skipWaiting aqui.
    // O app vai chamar quando você clicar "Atualizar agora".
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

  // Só lidamos com GET (evita erro com POST/PUT)
  if (req.method !== "GET") return;

  // Navegação do app (SPA): tenta rede, se falhar usa cache
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);

        // Só atualiza cache se a resposta estiver OK
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(INDEX_URL, fresh.clone());
        }

        return fresh;
      } catch {
        const cached = await caches.match(INDEX_URL);
        return cached || caches.match(ROOT_URL);
      }
    })());
    return;
  }

  // Assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);

      // Só cacheia resposta OK
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        try {
          await cache.put(req, res.clone());
        } catch (e) {
          // Se der algum erro de cache.put, não quebra o app
          // (ex: respostas especiais/opaque em alguns casos)
          console.warn("[SW] cache.put failed:", e);
        }
      }

      return res;
    } catch (e) {
      // Se não tem cache e rede falha, deixa o navegador resolver (vai dar erro)
      // Você pode melhorar isso depois com uma página offline opcional.
      throw e;
    }
  })());
});
