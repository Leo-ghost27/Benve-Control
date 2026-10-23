import { GroupNav } from "@/components/phase2/GroupNav";

export default function GroupSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <GroupNav />
      {children}
    </div>
  );
}
