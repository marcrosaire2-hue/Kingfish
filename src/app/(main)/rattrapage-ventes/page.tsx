import { redirect } from "next/navigation";
import { RattrapageVentesPage } from "@/components/rattrapage-ventes/rattrapage-ventes-page";
import { getSessionUser } from "@/lib/session";

/** Ventes d'un jour passé : administrateur uniquement. */
export default async function Page() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") redirect("/");
  return <RattrapageVentesPage />;
}
