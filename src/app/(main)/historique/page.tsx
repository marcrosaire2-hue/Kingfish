import { HistoriquePage } from "@/components/historique/historique-page";

function first(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

export default function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <HistoriquePage
      initialFrom={first(searchParams.from)}
      initialTo={first(searchParams.to)}
      initialSite={first(searchParams.site)}
      initialKind={first(searchParams.kind)}
    />
  );
}
