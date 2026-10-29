import { redirect } from "next/navigation";
import { JournalDirectionPage } from "@/components/journal-direction/journal-direction-page";
import { getSessionUser } from "@/lib/session";

/** Journal des ventes direction : administrateur uniquement. */
export default async function Page() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") redirect("/");
  return <JournalDirectionPage />;
}
