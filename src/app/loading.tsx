import { BrandLoader } from "@/components/brand-loader";

/**
 * Écran d'attente montré pendant qu'une page se charge. Next l'affiche
 * automatiquement à chaque changement de page : la navigation cesse de
 * paraître figée.
 */
export default function Loading() {
  return <BrandLoader label="Chargement de la page…" />;
}
