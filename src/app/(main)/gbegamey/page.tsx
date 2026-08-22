import { Suspense } from "react";
import { GbegameyPage } from "@/components/gbegamey/gbegamey-page";
import { BrandLoader } from "@/components/brand-loader";

export default function Page() {
  return (
    <Suspense
      fallback={<BrandLoader label="Chargement de Gbégamey…" />}
    >
      <GbegameyPage />
    </Suspense>
  );
}
