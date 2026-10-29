import { redirect } from "next/navigation";
import { DroitsPage } from "@/components/droits/droits-page";
import { getSessionUser } from "@/lib/session";

export default async function Page() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") redirect("/");
  return <DroitsPage />;
}
