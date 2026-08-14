import { memo, type ReactNode } from "react";
import type { VenteKind } from "@/lib/types";

export type ProductIconKey =
  | "dish"
  | "fish"
  | "skewer"
  | "fry"
  | "sauce"
  | "rice"
  | "local"
  | "combo"
  | "drink";

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Choisit une icône selon la catégorie et le nom du produit. */
export function resolveProductIconKey(
  kind: VenteKind | "base",
  name: string,
): ProductIconKey {
  if (kind === "boisson") return "drink";
  if (kind === "combo") return "combo";
  if (kind === "local") return "local";
  if (kind === "extra") return "dish";

  const n = normalizeName(name);
  if (/sauce|monyo|tchayo|arachide|graine|legume|tomate/.test(n)) {
    return "sauce";
  }
  if (/brochette|choucouya/.test(n)) return "skewer";
  if (/friture|frit/.test(n)) return "fry";
  if (/poisson|chawarma|pane|filet/.test(n)) return "fish";
  if (/attasi|attassi|riz/.test(n)) return "rice";
  return "dish";
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconDish() {
  return (
    <Svg>
      <path d="M4 11h16" {...stroke} />
      <path d="M6 11c.5 4 2.8 7 6 7s5.5-3 6-7" {...stroke} />
      <path d="M8 7.5c1-.9 2.4-1.5 4-1.5s3 .6 4 1.5" {...stroke} />
    </Svg>
  );
}

function IconFish() {
  return (
    <Svg>
      <path
        d="M4 12s3.5-5 8-5 8 5 8 5-3.5 5-8 5-8-5-8-5Z"
        {...stroke}
      />
      <path d="M16.5 12h3.5l2 2.2V9.8L20 12" {...stroke} />
      <circle cx="9.2" cy="11.2" r="0.9" fill="currentColor" />
    </Svg>
  );
}

function IconSkewer() {
  return (
    <Svg>
      <path d="M5 19 19 5" {...stroke} />
      <path d="M9.2 14.8 11.5 17" {...stroke} />
      <path d="M12.2 11.8 14.5 14" {...stroke} />
      <path d="M15.2 8.8 17.5 11" {...stroke} />
      <circle cx="8.2" cy="15.8" r="1.35" {...stroke} />
      <circle cx="11.2" cy="12.8" r="1.35" {...stroke} />
      <circle cx="14.2" cy="9.8" r="1.35" {...stroke} />
    </Svg>
  );
}

function IconFry() {
  return (
    <Svg>
      <path d="M7 8.5c0-2.4 2.2-4.3 5-4.3s5 1.9 5 4.3" {...stroke} />
      <path d="M6 10h12v7.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10Z" {...stroke} />
      <path d="M9 13.5v3M12 12.5v4M15 13.5v3" {...stroke} />
    </Svg>
  );
}

function IconSauce() {
  return (
    <Svg>
      <path
        d="M8 9.5h8l-.7 8.2A2 2 0 0 1 13.3 20h-2.6a2 2 0 0 1-2-2.3L8 9.5Z"
        {...stroke}
      />
      <path d="M9.5 9.5c0-2 1.1-3.5 2.5-3.5s2.5 1.5 2.5 3.5" {...stroke} />
      <path d="M10.5 13.5h3" {...stroke} />
    </Svg>
  );
}

function IconRice() {
  return (
    <Svg>
      <ellipse cx="12" cy="16.5" rx="7" ry="2.8" {...stroke} />
      <path d="M5 16.2V11c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5v5.2" {...stroke} />
      <path d="M9 10.5c.8-.6 1.9-1 3-1s2.2.4 3 1" {...stroke} />
      <path d="M8.5 13.2c1-.7 2.2-1.1 3.5-1.1s2.5.4 3.5 1.1" {...stroke} />
    </Svg>
  );
}

function IconLocal() {
  return (
    <Svg>
      <path
        d="M12 21s6-4.2 6-9.2A6 6 0 0 0 6 11.8C6 16.8 12 21 12 21Z"
        {...stroke}
      />
      <circle cx="12" cy="11.5" r="2.2" {...stroke} />
    </Svg>
  );
}

function IconCombo() {
  return (
    <Svg>
      <path d="M5 8h14" {...stroke} />
      <path d="M7 8c.4 3.2 2.3 5.2 5 5.2S16.6 11.2 17 8" {...stroke} />
      <path d="M5 14.5h14" {...stroke} />
      <path d="M7.5 14.5c.35 2.6 1.9 4.2 4.5 4.2s4.15-1.6 4.5-4.2" {...stroke} />
    </Svg>
  );
}

function IconDrink() {
  return (
    <Svg>
      <path
        d="M8 4h8l-1 14.5A2 2 0 0 1 13 21h-2a2 2 0 0 1-2-2.5L8 4Z"
        {...stroke}
      />
      <path d="M9 9.5h6" {...stroke} />
      <path d="M10.5 4V2.8M13.5 4V2.8" {...stroke} />
    </Svg>
  );
}

const ICONS: Record<ProductIconKey, () => ReactNode> = {
  dish: IconDish,
  fish: IconFish,
  skewer: IconSkewer,
  fry: IconFry,
  sauce: IconSauce,
  rice: IconRice,
  local: IconLocal,
  combo: IconCombo,
  drink: IconDrink,
};

/** Mémoïsé : les 40 tuiles du catalogue ne recalculent plus leurs icônes
 *  (normalisation de nom + regex) à chaque frappe dans les champs du panier. */
export const ProductIcon = memo(function ProductIcon({
  kind,
  name,
  className = "",
  size = "md",
}: {
  kind: VenteKind | "base";
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const key = resolveProductIconKey(kind, name);
  const Glyph = ICONS[key];
  return (
    <span
      className={`product-icon product-icon-${size} product-icon-${key}${className ? ` ${className}` : ""}`}
      data-icon={key}
      aria-hidden
    >
      <Glyph />
    </span>
  );
});
