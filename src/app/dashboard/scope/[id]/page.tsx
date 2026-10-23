import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PageHeader, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { addScopeItemAction, decideScopeAction, removeScopeItemAction, reopenScopeAction, submitScopeAction, updateScopeAction } from "@/lib/actions/scopes";

type Scope = {
  id: string; organization_id: string; title: string; objective: string | null; scope_summary: string | null; exclusions: string | null;
  status: string; version: number; content_hash: string | null; submitted_at: string | null; decided_at: string | null; decision_note: string | null;
  reporting_periods: { label: string } | { label: string }[] | null;
};
type Item = { id: string; description: string; rationale: string | null; controls: { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null };
type Signoff = { id: string; version: number; decision: string; signer_name: string | null; signer_role: string | null; comment: string | null; signed_at: string; content_hash: string | null };

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function ScopeDetail({ params, searchParams }: { params: { id: string }; searchParams: { notice?: string; error?: string; period?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const supabase = await createClient();
  // RLS decides visibility: a scope of another client (or a draft an external auditor may not see) simply returns nothing.
  const { data: scope } = await supabase
    .from("engagement_scopes")
    .select("id, organization_id, title, objective, scope_summary, exclusions, status, version, content_hash, submitted_at, decided_at, decision_note, reporting_periods(label)")
    .eq("id", params.id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!scope) notFound();
  const s = scope as unknown as Scope;
  const { data: itemRows } = await supabase.from("engagement_scope_items").select("id, description, rationale, controls(code, name)").eq("scope_id", s.id).order("created_at");
  const items = (itemRows ?? []) as unknown as Item[];
  const { data: soRows } = await supabase.from("scope_signoffs").select("id, version, decision, signer_name, signer_role, comment, signed_at, content_hash").eq("scope_id", s.id).order("signed_at", { ascending: false });
  const signoffs = (soRows ?? []) as Signoff[];
  const { data: ctlRows } = await supabase.from("controls").select("id, code, name").eq("organization_id", ctx.org.id).order("code");
  const controls = (ctlRows ?? []) as { id: string; code: string | null; name: string | null }[];
  const { data: myPerm } = await supabase.from("engagement_permissions").select("permission").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).eq("permission", "scope.sign");

  const role = ctx.role ?? "";
  const canPrepare = ["owner", "admin", "internal_auditor"].includes(role);
  const editable = canPrepare && (s.status === "draft" || s.status === "returned");
  const canSign = ["cfo", "controller"].includes(role) || (myPerm ?? []).length > 0;
  const canReopen = ["owner", "admin", "cfo", "controller"].includes(role);
  const back = `/dashboard/scope${searchParams.period ? `?period=${searchParams.period}` : ""}`;

  return (
    <div className="p-8">
      <Link href={back} className="text-xs text-mute hover:text-paper">← All scopes</Link>
      <PageHeader eyebrow={`Scope · ${one(s.reporting_periods)?.label ?? ""}`} title={s.title} subtitle={ctx.org.name} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge value={s.status} /><span className="text-xs text-mute">Version {s.version}</span>
        {s.submitted_at && <span className="text-xs text-mute">Submitted {fmtDateTime(s.submitted_at)}</span>}
        {s.content_hash && <span className="font-mono text-[10px] text-mute" title="Fingerprint of the exact content a decision applies to">ref {s.content_hash.slice(0, 12)}</span>}
      </div>
      {s.status === "approved" && <p className="mb-5 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">Approved for version {s.version}. This scope is locked; changing it requires reopening with a recorded rationale, which voids this approval.</p>}
      {s.status === "returned" && s.decision_note && <p className="mb-5 rounded-md border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">Returned for rework: {s.decision_note}</p>}

      {editable ? (
        <form action={updateScopeAction} className={`${cardClass} mb-6 grid gap-3`}>
          <input type="hidden" name="scope_id" value={s.id} />
          <div><label className={labelClass} htmlFor="e-title">Title</label><input id="e-title" name="title" defaultValue={s.title} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="e-obj">Objective</label><textarea id="e-obj" name="objective" rows={2} defaultValue={s.objective ?? ""} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="e-sum">Scope summary</label><textarea id="e-sum" name="scope_summary" rows={3} defaultValue={s.scope_summary ?? ""} className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="e-exc">Exclusions</label><textarea id="e-exc" name="exclusions" rows={2} defaultValue={s.exclusions ?? ""} className={inputClass} /></div>
          <button className={`${secondaryBtn} w-fit`} type="submit">Save changes</button>
        </form>
      ) : (
        <div className={`${cardClass} mb-6 space-y-3 text-sm`}>
          {([["Objective", s.objective], ["Scope summary", s.scope_summary], ["Exclusions", s.exclusions]] as const).map(([t, v]) => (
            <div key={t}><p className="text-xs text-mute">{t}</p><p className="whitespace-pre-wrap text-paper">{v || "—"}</p></div>
          ))}
        </div>
      )}

      <div className={`${cardClass} mb-6`}>
        <h2 className="mb-3 text-sm font-semibold text-paper">In-scope items ({items.length})</h2>
        {items.length === 0 ? <p className="text-sm text-mute">No items yet.</p> : (
          <TableShell>
            <thead className="bg-panel text-xs text-mute"><tr><Th>Control</Th><Th>Description</Th><Th>Rationale</Th>{editable && <Th>{" "}</Th>}</tr></thead>
            <tbody>{items.map((i) => {
              const c = one(i.controls);
              return (
                <tr key={i.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 text-paper">{c ? `${c.code ?? ""} ${c.name ?? ""}`.trim() : "—"}</td>
                  <td className="px-3 py-2 text-paper">{i.description}</td><td className="px-3 py-2">{i.rationale ?? "—"}</td>
                  {editable && <td className="px-3 py-2"><form action={removeScopeItemAction}><input type="hidden" name="scope_id" value={s.id} /><input type="hidden" name="item_id" value={i.id} /><button className={secondaryBtn} type="submit">Remove</button></form></td>}
                </tr>
              );
            })}</tbody>
          </TableShell>
        )}
        {editable && (
          <form action={addScopeItemAction} className="mt-4 grid gap-3 sm:grid-cols-[14rem_1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="scope_id" value={s.id} /><input type="hidden" name="org_id" value={ctx.org.id} />
            <div><label className={labelClass} htmlFor="i-ctl">Control (optional)</label>
              <select id="i-ctl" name="control_id" className={inputClass} defaultValue=""><option value="">—</option>{controls.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="i-desc">Description</label><input id="i-desc" name="description" required className={inputClass} /></div>
            <div><label className={labelClass} htmlFor="i-rat">Rationale</label><input id="i-rat" name="rationale" className={inputClass} /></div>
            <button className={secondaryBtn} type="submit">Add item</button>
          </form>
        )}
      </div>

      {editable && (
        <form action={submitScopeAction} className="mb-6">
          <input type="hidden" name="scope_id" value={s.id} />
          <button className={primaryBtn} type="submit">Submit to client for sign-off</button>
          <span className="ml-3 text-xs text-mute">Locks the content and records its fingerprint; the client approves exactly this version.</span>
        </form>
      )}

      {s.status === "submitted" && canSign && s.content_hash && (
        <form action={decideScopeAction} className={`${cardClass} mb-6 grid gap-3 border-sky-900/60`}>
          <input type="hidden" name="scope_id" value={s.id} /><input type="hidden" name="content_hash" value={s.content_hash} />
          <h2 className="text-sm font-semibold text-sky-300">Your sign-off (version {s.version})</h2>
          <p className="text-sm text-mute">You are approving the scope exactly as shown above. If anything changes before you submit this form, the decision is refused and you must review again.</p>
          <div><label className={labelClass} htmlFor="d-comment">Comment (required when returning)</label><textarea id="d-comment" name="comment" rows={2} className={inputClass} /></div>
          <div className="flex gap-2">
            <button name="decision" value="approved" className={primaryBtn} type="submit">Approve scope</button>
            <button name="decision" value="returned" className={`${secondaryBtn} !py-2 text-rose-300`} type="submit">Return for rework</button>
          </div>
        </form>
      )}
      {s.status === "submitted" && !canSign && <p className="mb-6 text-sm text-mute">Awaiting sign-off by the client&apos;s CFO or controller. Only they (or an explicitly designated signatory) can decide this scope; the preparer cannot.</p>}

      {s.status === "approved" && canReopen && (
        <form action={reopenScopeAction} className={`${cardClass} mb-6 grid gap-3`}>
          <input type="hidden" name="scope_id" value={s.id} />
          <h2 className="text-sm font-semibold text-paper">Reopen approved scope</h2>
          <p className="text-sm text-mute">Creates a new draft version and voids the current approval (kept in history). A rationale is required.</p>
          <div><label className={labelClass} htmlFor="r-reason">Rationale</label><input id="r-reason" name="reason" required minLength={10} className={inputClass} /></div>
          <button className={`${secondaryBtn} w-fit`} type="submit">Reopen as new version</button>
        </form>
      )}

      <div className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-paper">Sign-off history</h2>
        {signoffs.length === 0 ? <p className="text-sm text-mute">No decisions recorded yet.</p> : (
          <ul className="space-y-2 text-sm">
            {signoffs.map((x) => (
              <li key={x.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge value={x.decision === "reopened" ? "in_review" : x.decision} /><span className="text-paper">{label(x.decision)} — version {x.version}</span><span className="text-xs text-mute">{fmtDateTime(x.signed_at)}</span></div>
                <p className="mt-1 text-xs text-mute">{x.signer_name} ({label(x.signer_role)}){x.content_hash ? ` · ref ${x.content_hash.slice(0, 12)}` : ""}</p>
                {x.comment && <p className="mt-1 text-paper">{x.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
