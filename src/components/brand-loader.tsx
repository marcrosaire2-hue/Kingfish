import { APP_LOGO, APP_NAME } from "@/lib/brand";

/**
 * Attente à la marque : le logo du restaurant pulse le temps que l'écran ou
 * l'opération aboutisse. Un texte seul laissait croire à un blocage — ici on
 * voit que l'application travaille.
 *
 * - `plein` : occupe la place disponible (transitions de page).
 * - `voile` : couvre l'écran pendant une opération en cours, et bloque les
 *   clics pour qu'une commande ne parte pas deux fois.
 */
export function BrandLoader({
  label = "Chargement…",
  variant = "plein",
}: {
  label?: string;
  variant?: "plein" | "voile" | "ligne";
}) {
  const contenu = (
    <div className="brand-loader-inner">
      <span className="brand-loader-mark" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={APP_LOGO}
          alt=""
          className="brand-loader-logo"
          width={72}
          height={72}
        />
      </span>
      <span className="brand-loader-label">{label}</span>
      <span className="sr-only">{APP_NAME}</span>
    </div>
  );

  if (variant === "voile") {
    return (
      <div className="brand-loader-voile" role="status" aria-live="polite">
        {contenu}
      </div>
    );
  }

  return (
    <div
      className={`brand-loader brand-loader-${variant}`}
      role="status"
      aria-live="polite"
    >
      {contenu}
    </div>
  );
}
