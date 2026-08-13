import { VentePage } from "@/components/vente/vente-page";
import { canAccessPath } from "@/lib/auth-types";
import { getSessionUser } from "@/lib/session";

export default async function Page() {
  const user = await getSessionUser();
  const canViewHistory = Boolean(
    user && canAccessPath(user.role, "/historique-ventes", user.site),
  );
  return <VentePage canViewHistory={canViewHistory} />;
}