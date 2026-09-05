import { LoginPage } from "@/components/login/login-page";

function first(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

/**
 * Le formulaire est rendu côté serveur (pas de Suspense / useSearchParams).
 * Sur mobile, un Suspense bloqué sur « Chargement… » laissait un écran blanc
 * si le JS client mettait du temps ou échouait.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <LoginPage nextPath={first(params.next)} />;
}
