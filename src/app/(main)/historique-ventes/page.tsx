import { redirect } from "next/navigation";

/** Ancienne page fusionnée dans le journal des ventes. */
export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value) && value[0]) qs.set(key, value[0]);
  }
  const tail = qs.toString();
  redirect(tail ? `/journal-ventes?${tail}` : "/journal-ventes");
}
