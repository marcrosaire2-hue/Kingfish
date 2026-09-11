import { redirect } from "next/navigation";
import { AppShellFrame } from "@/components/app-shell-frame";
import { PageChromeProvider } from "@/components/page-chrome-context";
import { getSessionUser } from "@/lib/session";

export default async function MainAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <PageChromeProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </PageChromeProvider>
  );
}
