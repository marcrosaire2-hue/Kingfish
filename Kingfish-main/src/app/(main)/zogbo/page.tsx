import { redirect } from "next/navigation";

/**
 * Ancienne URL Zogbo — le stock est saisi sur Stock Zogbo.
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

  const tab = sp.tab;
  if (tab === "acc" || tab === "boissons") {
    params.set("tab", tab);
  } else if (tab === "ventes") {
    const q = params.toString();
    redirect(q ? `/journal-ventes?${q}` : "/journal-ventes");
  }

  const q = params.toString();
  redirect(q ? `/stock-zogbo?${q}` : "/stock-zogbo");
}
