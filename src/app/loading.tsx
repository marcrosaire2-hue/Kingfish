import { BrandLoader } from "@/components/brand-loader";

/** Évite un écran blanc pendant le chargement (surtout Safari iOS). */
export default function Loading() {
  return <BrandLoader label="Chargement…" />;
}
