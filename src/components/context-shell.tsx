import { AppShell, AppTopSearch } from "@/components/app-shell";

export function ContextShell({
  children,
  aside,
  wide,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <AppShell aside={aside} wide={wide} topbar={<AppTopSearch />}>
      {children}
    </AppShell>
  );
}
