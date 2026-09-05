/* Service worker King Fish Manager.
 *
 * Règle stricte : on ne met JAMAIS en cache les pages HTML / réponses RSC
 * de Next.js (sinon coquille périmée → écran blanc / chargement infini).
 *
 * - Assets statiques (_next/static, images, polices) : réseau puis cache.
 * - Navigation / API / RSC : réseau uniquement.
 * - Hors ligne : message simple (pas de HTML Next périmé).
 */

const CACHE = "kingfish-v3";
const PRECACHE = ["/logo-king-fish.jpg", "/sw.js"];

function estAssetStatique(url, requete) {
  if (requete.mode === "navigate") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.searchParams.has("_rsc")) return false;
  try {
    if (requete.headers.get("RSC") === "1") return false;
    if (requete.headers.get("Next-Router-State-Tree")) return false;
  } catch {
    /* headers parfois indisponibles */
  }
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|css|js|webmanifest)$/i.test(
    url.pathname,
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(PRECACHE.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;

  let url;
  try {
    url = new URL(requete.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Pages et vols RSC : toujours le réseau (jamais le cache HTML).
  if (!estAssetStatique(url, requete)) {
    event.respondWith(
      fetch(requete).catch(
        () =>
          new Response(
            "King Fish Manager est hors ligne. Vérifiez la connexion puis réessayez.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            },
          ),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(async () => {
        const cache = await caches.match(requete);
        if (cache) return cache;
        return new Response("Hors ligne", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
  );
});
