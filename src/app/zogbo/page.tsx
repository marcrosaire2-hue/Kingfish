import { Suspense } from "react";
import { ZogboPage } from "@/components/zogbo/zogbo-page";
import { BrandLoader } from "@/components/brand-loader";

export default function Page() {
  return (
    <Suspense
      fallback={<BrandLoader label="Chargement de Zogbo…" />}
    >
      <ZogboPage />
    </Suspense>
  );
}
