import { RegularisationPage } from "@/components/regularisation/regularisation-page";
import { canManagePastVentes } from "@/lib/auth-types";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !canManagePastVentes(user.role)) {
    redirect("/vente");
  }
  return <RegularisationPage />;
}
