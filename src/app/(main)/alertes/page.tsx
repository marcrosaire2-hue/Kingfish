import { redirect } from "next/navigation";
import { AlertesPage } from "@/components/alertes/alertes-page";
import { getSessionUser } from "@/lib/session";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") redirect("/");
  return <AlertesPage />;
}
