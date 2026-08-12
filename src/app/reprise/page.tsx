import { Suspense } from "react";
import { ReprisePage } from "@/components/reprise/reprise-page";

export default function Page() {
  return (
    <Suspense
      fallback={<p className="muted" style={{ padding: 24 }}>Chargement…</p>}
    >
      <ReprisePage />
    </Suspense>
  );
}
