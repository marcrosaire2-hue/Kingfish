import { APP_LOGO, APP_NAME, APP_TAGLINE } from "@/lib/brand";

const SIZE_PX = { sm: 40, md: 72, lg: 88 } as const;

/**
 * Scène du logo King Fish : halo, orbites, points de couronne, plaque.
 * L’animation ne vit que ici — les logos du chrome (menu, barre) restent
 * immobiles.
 */
export function BrandLogoMark({
  size = "md",
  animated = true,
  alt = "",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  animated?: boolean;
  alt?: string;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const classes = [
    "kf-mark",
    `kf-mark-${size}`,
    animated ? "is-animated" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden={alt ? undefined : true}>
      <span className="kf-mark-glow" />
      <span className="kf-mark-ripple" />
      <span className="kf-mark-orbit kf-mark-orbit-a" />
      <span className="kf-mark-orbit kf-mark-orbit-b" />
      <span className="kf-mark-crown">
        <span className="kf-mark-spark">
          <span />
        </span>
        <span className="kf-mark-spark">
          <span />
        </span>
        <span className="kf-mark-spark">
          <span />
        </span>
      </span>
      <span className="kf-mark-plate">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={APP_LOGO}
          alt={alt}
          className="brand-logo"
          width={px}
          height={px}
        />
      </span>
    </span>
  );
}

/** Composition pleine page : marque + nom + barre, pour l’entrée dans l’app. */
export function BrandIntro({
  title = APP_NAME,
  tagline = APP_TAGLINE,
  hint,
}: {
  title?: string;
  tagline?: string;
  hint?: string;
}) {
  return (
    <div className="kf-intro">
      <BrandLogoMark size="lg" />
      <p className="kf-intro-name">{title}</p>
      <p className="kf-intro-tag">{tagline}</p>
      <div className="kf-intro-bar" aria-hidden>
        <span className="kf-intro-bar-fill" />
      </div>
      {hint ? <p className="kf-intro-hint">{hint}</p> : null}
    </div>
  );
}
