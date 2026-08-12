/* Service worker de King Fish Manager.
 *
 * Objectif : que la caisse reste utilisable quand le réseau tombe en plein
 * service. Deux mécanismes, volontairement simples :
 *
 * 1. La coquille de l'application (pages, styles, scripts) est servie depuis
 *    le cache quand le réseau échoue, pour que l'écran ne devienne pas blanc.
 * 2. Les requêtes de l'API ne sont jamais mises en cache : une donnée de
 *    stock périmée serait pire qu'une absence de donnée. Le POST d'une vente
 *    qui échoue faute de réseau est confié à la file d'attente locale, gérée
 *    côté page (offline-queue.ts), qui la rejouera au retour du réseau.
 */

const CACHE = "kingfish-v1";
const COQUILLE = ["/vente", "/login", "/icon.png", "/apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll échoue en bloc si une seule URL manque : on tolère les absences.
      .then((cache) =>
        Promise.allSettled(COQUILLE.map((url) => cache.add(url))),
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

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  // Les données métier ne sont jamais servies depuis le cache.
  if (url.pathname.startsWith("/api/")) return;

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
        // Navigation hors ligne vers une page jamais visitée : on retombe sur
        // l'écran de vente, seul écran réellement utile sans réseau.
        if (requete.mode === "navigate") {
          const repli = await caches.match("/vente");
          if (repli) return repli;
        }
        return new Response("Hors ligne", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
  );
});
