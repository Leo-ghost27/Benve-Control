import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPhase2Context, withParams } from "@/lib/phase2/context";
import { can } from "@/lib/phase2/permissions";
import { loadMembers, memberName } from "@/lib/phase2/ccm-queries";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { Banner, LastUpdated, PageHeader, PermissionDenied, StatusBadge, TableShell, Th, cardClass, fmtDateTime, inputClass, label, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { assignControlAction, assignProcessAction, removeAssignmentAction, saveEntityAction } from "@/lib/actions/group";

type SP = { period?: string; notice?: string; error?: string };
const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function EntityDetail({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  let p2;
  try { p2 = await getPhase2Context(searchParams.period); } catch (e) { return <ErrorState message={(e as Error).message} />; }
  if (!p2) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const { ctx } = p2;
  if (!can(ctx.role, "group.view_internal")) return <PermissionDenied />;

  const supabase = await createClient();
  const { data: ent, error } = await supabase.from("entities").select("*").eq("id", params.id).eq("organization_id", ctx.org.id).maybeSingle();
  if (error) return <ErrorState message={error.message} />;
  if (!ent) notFound();

  const [members, { data: all }, { data: procs }, { data: eprocs }, { data: ctls }, { data: ectls }, { data: owned }, { data: qs }, { data: defs }, { data: log }] = await Promise.all([
    loadMembers(supabase, ctx.org.id).catch(() => []),
    supabase.from("entities").select("id, name").eq("organization_id", ctx.org.id).neq("id", ent.id).order("name"),
    supabase.from("processes").select("id, name").eq("organization_id", ctx.org.id).order("name"),
    supabase.from("entity_processes").select("id, process_id, in_scope, notes, processes(name)").eq("organization_id", ctx.org.id).eq("entity_id", ent.id),
    supabase.from("controls").select("id, code, title, entity_id").eq("organization_id", ctx.org.id).order("code"),
    supabase.from("entity_controls").select("id, control_id, reliance_type, status, local_owner_user_id, controls(code, title, entity_id)").eq("organization_id", ctx.org.id).eq("entity_id", ent.id),
    supabase.from("controls").select("id, code, title").eq("organization_id", ctx.org.id).eq("entity_id", ent.id).order("code"),
    supabase.from("subsidiary_questionnaires").select("id, status, group_review_status, reporting_period_id, reporting_periods(label)").eq("organization_id", ctx.org.id).eq("entity_id", ent.id).order("created_at", { ascending: false }),
    supabase.from("deficiencies").select("id, title, severity, status").eq("organization_id", ctx.org.id).eq("entity_id", ent.id).is("resolved_at", null),
    supabase.from("audit_log").select("id, action, actor_id, metadata, created_at").eq("organization_id", ctx.org.id).eq("entity_type", "entities").eq("entity_id", ent.id).order("created_at", { ascending: false }).limit(30),
  ]);

  const canManage = can(ctx.role, "entity.manage");
  const here = withParams(`/dashboard/entities/${ent.id}`, { period: searchParams.period });
  const parentName = (all ?? []).find((e) => e.id === ent.parent_entity_id)?.name;

  return (
    <div>
      <Link href={withParams("/dashboard/entities", { period: searchParams.period })} className="mb-3 inline-block text-xs text-mute hover:text-paper">← All entities</Link>
      <PageHeader eyebrow={ent.is_parent ? "Group parent entity" : `Subsidiary${parentName ? ` of ${parentName}` : ""}`} title={ent.name} subtitle={ent.legal_name ?? undefined} />
      <Banner notice={searchParams.notice} error={searchParams.error} />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <section className={cardClass}>
            <div className="mb-4 flex items-center gap-3"><StatusBadge value={ent.status} /><span className="text-xs text-mute">{ent.in_scope ? "In scope" : "Out of scope"}</span></div>
            {canManage ? (
              <form action={saveEntityAction} className="grid grid-cols-2 gap-3">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={ent.id} />
                <div><label className={labelClass} htmlFor="name">Display name *</label><input id="name" name="name" required defaultValue={ent.name} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="legal_name">Legal name</label><input id="legal_name" name="legal_name" defaultValue={ent.legal_name ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="jurisdiction">Jurisdiction</label><input id="jurisdiction" name="jurisdiction" defaultValue={ent.jurisdiction ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="parent_entity_id">Parent entity</label><select id="parent_entity_id" name="parent_entity_id" defaultValue={ent.parent_entity_id ?? ""} disabled={ent.is_parent} className={inputClass}><option value="">None</option>{(all ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="consolidation_method">Consolidation method</label><select id="consolidation_method" name="consolidation_method" defaultValue={ent.consolidation_method ?? ""} className={inputClass}><option value="">—</option>{["full", "proportional", "equity_method", "not_consolidated"].map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="local_owner_user_id">Local entity owner</label><select id="local_owner_user_id" name="local_owner_user_id" defaultValue={ent.local_owner_user_id ?? ""} className={inputClass}><option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)} ({label(m.role)})</option>)}</select></div>
                <div className="col-span-2"><label className={labelClass} htmlFor="functional_scope">Functional scope</label><input id="functional_scope" name="functional_scope" defaultValue={ent.functional_scope ?? ""} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="status">Status</label><select id="status" name="status" defaultValue={ent.status} className={inputClass}>{["in_progress", "complete", "inactive"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                <div className="flex items-end gap-4 pb-2"><label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" name="in_scope" defaultChecked={ent.in_scope} /> In scope</label>{ent.is_parent && <label className="flex items-center gap-2 text-sm text-paper"><input type="checkbox" name="is_parent" defaultChecked /> Group parent</label>}</div>
                <div><button className={primaryBtn} type="submit">Save entity</button></div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-xs text-mute">Jurisdiction</dt><dd className="mt-1 text-paper">{ent.jurisdiction ?? "—"}</dd></div>
                <div><dt className="text-xs text-mute">Consolidation</dt><dd className="mt-1 text-paper">{label(ent.consolidation_method)}</dd></div>
                <div><dt className="text-xs text-mute">Local owner</dt><dd className="mt-1 text-paper">{memberName(members, ent.local_owner_user_id)}</dd></div>
                <div><dt className="text-xs text-mute">Functional scope</dt><dd className="mt-1 text-paper">{ent.functional_scope ?? "—"}</dd></div>
              </dl>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Processes</h2>
            {(eprocs ?? []).length === 0 ? <p className="mb-3 text-sm text-mute">No processes assigned.</p> : (
              <TableShell><thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Process</Th><Th>In scope</Th><Th>Notes</Th>{canManage && <Th>Actions</Th>}</tr></thead>
                <tbody className="divide-y divide-line bg-ink">{(eprocs ?? []).map((p) => (
                  <tr key={p.id}><td className="px-3 py-2 text-paper">{one(p.processes as { name: string } | { name: string }[] | null)?.name ?? "—"}</td><td className="px-3 py-2 text-mute">{p.in_scope ? "Yes" : "No"}</td><td className="px-3 py-2 text-mute">{p.notes ?? "—"}</td>
                    {canManage && <td className="px-3 py-2"><form action={removeAssignmentAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="table" value="entity_processes" /><button className={secondaryBtn} type="submit">Remove</button></form></td>}</tr>
                ))}</tbody></TableShell>
            )}
            {canManage && (
              <form action={assignProcessAction} className="mt-4 grid grid-cols-4 items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="entity_id" value={ent.id} />
                <div className="col-span-2"><label className={labelClass} htmlFor="process_id">Assign process</label><select id="process_id" name="process_id" required className={inputClass}><option value="">Choose…</option>{(procs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="p_notes">Notes</label><input id="p_notes" name="notes" className={inputClass} /></div>
                <div className="flex items-center gap-3"><select name="in_scope" aria-label="Scope" className={inputClass}><option value="on">In scope</option><option value="off">Out of scope</option></select><button className={secondaryBtn} type="submit">Save</button></div>
              </form>
            )}
          </section>

          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-semibold text-paper">Controls</h2>
            <p className="mb-3 text-xs text-mute">Entity-level controls belong to this entity. Group-level controls are owned centrally and counted once in the group roll-up, however many entities rely on them.</p>
            {(owned ?? []).length > 0 && <p className="mb-3 text-xs text-mute">Owned by this entity: {(owned ?? []).map((c) => c.code).join(", ")}</p>}
            {(ectls ?? []).length === 0 ? <p className="mb-3 text-sm text-mute">No controls assigned.</p> : (
              <TableShell><thead className="bg-panel text-xs uppercase tracking-wide text-mute"><tr><Th>Control</Th><Th>Scope</Th><Th>Reliance</Th><Th>Local owner</Th><Th>Status</Th>{canManage && <Th>Actions</Th>}</tr></thead>
                <tbody className="divide-y divide-line bg-ink">{(ectls ?? []).map((c) => {
                  const ctl = one(c.controls as { code: string; title: string; entity_id: string | null } | { code: string; title: string; entity_id: string | null }[] | null);
                  return (<tr key={c.id}><td className="px-3 py-2 text-paper">{ctl?.code} — {ctl?.title}</td><td className="px-3 py-2 text-mute">{ctl?.entity_id ? "Entity-level" : "Group-level"}</td><td className="px-3 py-2 text-mute">{label(c.reliance_type)}</td><td className="px-3 py-2 text-mute">{memberName(members, c.local_owner_user_id)}</td><td className="px-3 py-2"><StatusBadge value={c.status} /></td>
                    {canManage && <td className="px-3 py-2"><form action={removeAssignmentAction}><input type="hidden" name="return_to" value={here} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="table" value="entity_controls" /><button className={secondaryBtn} type="submit">Remove</button></form></td>}</tr>);
                })}</tbody></TableShell>
            )}
            {canManage && (
              <form action={assignControlAction} className="mt-4 grid grid-cols-4 items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="return_to" value={here} /><input type="hidden" name="entity_id" value={ent.id} />
                <div className="col-span-2"><label className={labelClass} htmlFor="control_id">Assign control</label><select id="control_id" name="control_id" required className={inputClass}><option value="">Choose…</option>{(ctls ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} ({c.entity_id ? "entity-level" : "group-level"})</option>)}</select></div>
                <div><label className={labelClass} htmlFor="reliance_type">Reliance</label><select id="reliance_type" name="reliance_type" className={inputClass}>{["entity_level", "group_level", "shared_service"].map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
                <div><label className={labelClass} htmlFor="c_owner">Local owner</label><select id="c_owner" name="local_owner_user_id" className={inputClass}><option value="">—</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberName(members, m.user_id)}</option>)}</select></div>
                <div><button className={secondaryBtn} type="submit">Save assignment</button></div>
              </form>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Questionnaires</h2>
            {(qs ?? []).length === 0 ? <p className="text-sm text-mute">None yet.</p> : (
              <ul className="space-y-2 text-sm">{(qs ?? []).map((q) => (
                <li key={q.id} className="flex items-center justify-between"><Link className="text-signal hover:underline" href={withParams(`/dashboard/subsidiary-questionnaires/${q.id}`, { period: q.reporting_period_id })}>{one(q.reporting_periods as { label: string } | { label: string }[] | null)?.label ?? "Period"}</Link><StatusBadge value={q.status} /></li>
              ))}</ul>
            )}
          </section>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Open deficiencies (entity)</h2>
            {(defs ?? []).length === 0 ? <p className="text-sm text-mute">None recorded.</p> : (
              <ul className="space-y-2 text-sm">{(defs ?? []).map((d) => <li key={d.id} className="flex items-center justify-between"><Link className="text-signal hover:underline" href={`/dashboard/deficiencies/${d.id}`}>{d.title}</Link><StatusBadge value={d.severity} /></li>)}</ul>
            )}
          </section>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-paper">Activity</h2>
            {(log ?? []).length === 0 ? <p className="text-sm text-mute">No activity recorded.</p> : (
              <ol className="space-y-3 border-l border-line pl-4">{(log ?? []).map((l) => {
                const m = (l.metadata ?? {}) as { from?: string; to?: string; changed_fields?: string[] };
                return <li key={l.id} className="text-xs"><p className="text-paper">{l.action === "status_changed" ? `Status: ${label(m.from)} → ${label(m.to)}` : label(l.action)}{l.action === "updated" && m.changed_fields ? ` (${m.changed_fields.join(", ")})` : ""}</p><p className="text-mute">{memberName(members, l.actor_id)} · {fmtDateTime(l.created_at)}</p></li>;
              })}</ol>
            )}
          </section>
          <LastUpdated at={ent.updated_at} />
        </div>
      </div>
    </div>
  );
}
