import { Suspense } from "react";
import { ReprisePage } from "@/components/reprise/reprise-page";
import { BrandLoader } from "@/components/brand-loader";

export default function Page() {
  return (
    <Suspense
      fallback={<BrandLoader label="Chargement de la reprise…" />}
    >
      <ReprisePage />
    </Suspense>
  );
}
