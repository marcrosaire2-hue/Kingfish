import { Suspense } from "react";
import { LoginPage } from "@/components/login/login-page";
import { BrandLoader } from "@/components/brand-loader";

export default function Page() {
  return (
    <Suspense fallback={<BrandLoader label="Chargement…" />}>
      <LoginPage />
    </Suspense>
  );
}
