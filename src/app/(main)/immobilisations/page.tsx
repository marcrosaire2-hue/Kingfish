import { ImmobilisationsPage } from "@/components/immobilisations/immobilisations-page";
import { canManagePastVentes, navForSession } from "@/lib/auth-types";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Page() {
  const user = await getSessionUser();
  const allowed =
    !!user &&
    (canManagePastVentes(user.role) ||
      navForSession(user).includes("immobilisations"));
  if (!allowed) {
    redirect("/");
  }
  return <ImmobilisationsPage />;
}
