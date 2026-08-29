import { redirect } from "next/navigation";

/**
 * Ancienne URL Zogbo — le stock est saisi sur Stock Zogbo.
 */
export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  const date = searchParams.date;
  if (typeof date === "string") params.set("date", date);

  const tab = searchParams.tab;
  if (tab === "acc" || tab === "boissons") {
    params.set("tab", tab);
  } else if (tab === "ventes") {
    const q = params.toString();
    redirect(q ? `/journal-ventes?${q}` : "/journal-ventes");
  }

  const q = params.toString();
  redirect(q ? `/stock-zogbo?${q}` : "/stock-zogbo");
}
