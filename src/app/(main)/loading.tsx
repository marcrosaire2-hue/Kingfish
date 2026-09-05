import { BrandLoader } from "@/components/brand-loader";

/**
 * Navigation interne : un overlay unique masque le menu et la page.
 * Le contenu n’apparaît que lorsque le segment est prêt — pas un second logo
 * dans le corps de page.
 */
export default function MainLoading() {
  return <BrandLoader label="Chargement…" />;
}
