import { SettingsNav } from "@/components/workspace/SettingsNav";
import { PageHeader } from "@/components/phase2/ui";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-8">
      <PageHeader eyebrow="Settings" title="Workspace settings" subtitle="Organization, access, periods, security and retention for the selected workspace." />
      <SettingsNav />
      <div className="max-w-4xl">{children}</div>
    </div>
  );
}
