/**
 * Journalisation des erreurs serveur.
 *
 * Volontairement sans dépendance : un `console.error` en JSON sur une seule
 * ligne est déjà exploitable dans les journaux Render (recherche, filtres),
 * et n'oblige à ouvrir aucun compte. Si SENTRY_DSN est renseigné, l'erreur y
 * est en plus envoyée par un simple appel HTTP — pas de SDK à installer.
 *
 * Aucune donnée de vente ni identifiant n'est transmis : seuls le contexte
 * technique et le message d'erreur partent.
 */

type Contexte = Record<string, string | number | boolean | null | undefined>;

function sentryEndpoint(): { url: string; key: string } | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    // Forme du DSN : https://<clé>@<hôte>/<projet>
    const parsed = new URL(dsn);
    const projet = parsed.pathname.replace(/^\//, "");
    if (!parsed.username || !projet) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projet}/store/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
}

async function envoyerASentry(
  message: string,
  contexte: Contexte,
): Promise<void> {
  const cible = sentryEndpoint();
  if (!cible) return;
  try {
    await fetch(cible.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${cible.key}`,
      },
      body: JSON.stringify({
        message,
        level: "error",
        platform: "node",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV ?? "development",
        extra: contexte,
      }),
    });
  } catch {
    // Un incident de télémétrie ne doit jamais aggraver l'incident d'origine.
  }
}

/**
 * À appeler dans le `catch` des routes. Renvoie le message destiné à
 * l'utilisateur, pour que l'appelant n'ait pas à le reconstruire.
 */
export function reportError(
  operation: string,
  error: unknown,
  contexte: Contexte = {},
): string {
  const message = error instanceof Error ? error.message : String(error);
  const enregistrement = {
    niveau: "erreur",
    operation,
    message,
    pile: error instanceof Error ? error.stack : undefined,
    horodatage: new Date().toISOString(),
    ...contexte,
  };

  // Une ligne = une entrée exploitable dans les journaux Render.
  console.error(JSON.stringify(enregistrement));
  void envoyerASentry(`${operation} — ${message}`, contexte);

  return message;
}
