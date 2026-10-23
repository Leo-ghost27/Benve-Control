import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, StatusBadge, cardClass, inputClass, labelClass, primaryBtn, secondaryBtn, label } from "@/components/phase2/ui";
import { convertToFirmAction, updateClientDetailsAction } from "@/lib/actions/workspaces";

export default async function OrganizationSettings({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization" description="You're not part of an organization yet." />;
  const ws = ctx.workspaces.find((w) => w.org_id === ctx.org!.id);
  const supabase = await createClient();
  const { data: profile } = await supabase.from("client_profiles").select("*").eq("organization_id", ctx.org.id).maybeSingle();
  const canEdit = ["owner", "admin", "cfo", "controller"].includes(ctx.role ?? "");
  const canConvert = ctx.role === "owner" && ctx.orgKind === "client" && !ws?.firm_id;
  return (
    <div className="space-y-6">
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-paper">{ctx.org.name}</h2>
          <StatusBadge value={ctx.orgStatus ?? "active"} />
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-mute">{ctx.orgKind === "firm" ? "Firm (operator)" : "Client workspace"}</span>
        </div>
        <p className="mt-2 text-xs text-mute">Your role in this workspace: {label(ctx.role)}{ws?.firm_name ? ` · Firm: ${ws.firm_name}` : ""}</p>
        <p className="mt-1 text-xs text-mute">Your access here is a membership in this workspace only. Other workspaces are separate and confidential.</p>
      </div>

      {canConvert && (
        <form action={convertToFirmAction} className={cardClass}>
          <input type="hidden" name="org_id" value={ctx.org.id} />
          <h3 className="text-sm font-semibold text-paper">Make this organization your firm</h3>
          <p className="mt-1 text-sm text-mute">Use this on your existing organization (for example GHG Consulting) so you can add a separate workspace per client. Existing records stay where they are.</p>
          <button className={`${secondaryBtn} mt-3`} type="submit">Convert to firm</button>
        </form>
      )}

      {ctx.orgKind === "client" && (
        <form action={updateClientDetailsAction} className={`${cardClass} grid gap-3 sm:grid-cols-2`}>
          <input type="hidden" name="org_id" value={ctx.org.id} />
          <h3 className="text-sm font-semibold text-paper sm:col-span-2">Client details</h3>
          {([
            ["name", "Display name", ctx.org.name],
            ["legal_name", "Legal name", profile?.legal_name],
            ["industry", "Industry", profile?.industry],
            ["fiscal_year_end", "Fiscal year end (MM-DD)", profile?.fiscal_year_end],
            ["contact_name", "Primary contact", profile?.primary_contact_name],
            ["contact_email", "Contact email", profile?.primary_contact_email],
            ["engagement_type", "Engagement type", profile?.engagement_type],
          ] as const).map(([name, text, value]) => (
            <div key={name}>
              <label className={labelClass} htmlFor={`f-${name}`}>{text}</label>
              <input id={`f-${name}`} name={name} defaultValue={value ?? ""} disabled={!canEdit} className={inputClass} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="f-notes">Notes</label>
            <textarea id="f-notes" name="notes" rows={3} defaultValue={profile?.notes ?? ""} disabled={!canEdit} className={inputClass} />
          </div>
          {canEdit ? <button className={`${primaryBtn} sm:col-span-2 sm:w-fit`} type="submit">Save details</button>
            : <p className="text-xs text-mute sm:col-span-2">Only owners, admins, CFOs and controllers can amend client details.</p>}
        </form>
      )}
    </div>
  );
}
