import { redirect } from "next/navigation";

/**
 * Ancienne URL Gbégamey — le stock est saisi sur Stock Gbégamey.
 */
export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  const date = searchParams.date;
  if (typeof date === "string") params.set("date", date);

  const tab = searchParams.tab ?? searchParams.section;
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
