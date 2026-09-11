import { Suspense } from "react";
import { StockZogboPage } from "@/components/stock-zogbo/stock-zogbo-page";
import { BrandLoader } from "@/components/brand-loader";

export default function Page() {
  return (
    <Suspense fallback={<BrandLoader label="Chargement du stock Gbégamey…" />}>
      <StockZogboPage site="gbegamey" />
    </Suspense>
  );
}
