"use client";

import { usePathname } from "next/navigation";
import { switchWorkspaceAction } from "@/lib/actions/workspaces";
import type { Workspace } from "@/lib/supabase/org";

/**
 * Client selector. This is a convenience only: the action re-checks membership on the
 * server and the database enforces access on every query regardless of what is selected.
 */
export function WorkspaceSwitcher({ workspaces, currentId }: { workspaces: Workspace[]; currentId: string }) {
  const pathname = usePathname();
  const firms = workspaces.filter((w) => w.kind === "firm");
  const clients = workspaces.filter((w) => w.kind === "client" && w.status === "active");
  const archived = workspaces.filter((w) => w.kind === "client" && w.status === "archived");
  if (workspaces.length <= 1) return null;
  const opt = (w: Workspace) => (
    <option key={w.org_id} value={w.org_id}>
      {w.name} · {w.role.replace(/_/g, " ")}
    </option>
  );
  return (
    <form action={switchWorkspaceAction} className="flex items-center gap-2">
      <input type="hidden" name="return_to" value={pathname ?? "/dashboard"} />
      <label htmlFor="workspace" className="sr-only">Client workspace</label>
      <select
        id="workspace"
        name="workspace_id"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-[18rem] rounded-md border border-line bg-panel px-2 py-1.5 text-xs text-paper focus:outline-none focus:ring-1 focus:ring-signal"
      >
        {firms.length > 0 && <optgroup label="Firm">{firms.map(opt)}</optgroup>}
        {clients.length > 0 && <optgroup label="Client workspaces">{clients.map(opt)}</optgroup>}
        {archived.length > 0 && <optgroup label="Archived">{archived.map(opt)}</optgroup>}
      </select>
    </form>
  );
}
