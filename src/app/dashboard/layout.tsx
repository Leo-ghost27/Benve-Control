import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOrgContext();

  if (!ctx) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ink text-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          orgName={ctx.org?.name ?? null}
          userEmail={ctx.userEmail}
          role={ctx.role}
        />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
