import { Suspense } from "react";
import { ZogboPage } from "@/components/zogbo/zogbo-page";

export default function Page() {
  return (
    <Suspense
      fallback={<p className="muted" style={{ padding: 24 }}>Chargement…</p>}
    >
      <ZogboPage />
    </Suspense>
  );
}
