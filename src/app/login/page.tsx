import { Suspense } from "react";
import { LoginPage } from "@/components/login/login-page";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24 }}>Chargement…</p>}>
      <LoginPage />
    </Suspense>
  );
}
