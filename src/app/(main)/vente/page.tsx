import type { VenteSite } from "@/lib/types";
import { VentePage } from "@/components/vente/vente-page";
import { canAccessPath } from "@/lib/auth-types";
import { getSessionUser } from "@/lib/session";

export default async function Page() {
  const user = await getSessionUser();
  const canViewHistory = Boolean(
    user && canAccessPath(user.role, "/journal-ventes", user.site),
  );
  const initialSite: VenteSite =
    user?.site === "gbegamey" ? "gbegamey" : "zogbo";
  return (
    <VentePage
      canViewHistory={canViewHistory}
      initialSite={initialSite}
    />
  );
}
