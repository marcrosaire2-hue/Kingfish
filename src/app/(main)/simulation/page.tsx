import { SimulationPage } from "@/components/simulation/simulation-page";
import { getSessionUser } from "@/lib/session";
import type { VenteSite } from "@/lib/types";

export default async function Page() {
  const user = await getSessionUser();
  const initialSite: VenteSite =
    user?.site === "gbegamey" ? "gbegamey" : "zogbo";
  return (
    <SimulationPage
      initialSite={initialSite}
      peutRattraper={user?.role === "admin"}
    />
  );
}
