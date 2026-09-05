import { JournalVentesPage } from "@/components/journal-ventes/journal-ventes-page";

function first(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <JournalVentesPage
      initialFrom={first(params.from)}
      initialTo={first(params.to)}
      initialSite={first(params.site)}
    />
  );
}
