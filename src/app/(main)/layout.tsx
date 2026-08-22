import { AppShellFrame } from "@/components/app-shell-frame";
import { PageChromeProvider } from "@/components/page-chrome-context";

export default function MainAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageChromeProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </PageChromeProvider>
  );
}
