import { redirect } from "next/navigation";

/**
 * Ancienne URL Gbégamey — le stock est saisi sur Stock Gbégamey.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  const date = sp.date;
  if (typeof date === "string") params.set("date", date);

  const tab = sp.tab ?? sp.section;
  if (
    tab === "local" ||
    tab === "boissons" ||
    tab === "ventes" ||
    tab === "parametres"
  ) {
    params.set("tab", tab);
  }

  const q = params.toString();
  redirect(q ? `/stock-gbegamey?${q}` : "/stock-gbegamey");
}
