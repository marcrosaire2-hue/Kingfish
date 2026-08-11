import { Suspense } from "react";
import { GbegameyPage } from "@/components/gbegamey/gbegamey-page";

export default function Page() {
  return (
    <Suspense
      fallback={<p className="muted" style={{ padding: 24 }}>Chargement…</p>}
    >
      <GbegameyPage />
    </Suspense>
  );
}
