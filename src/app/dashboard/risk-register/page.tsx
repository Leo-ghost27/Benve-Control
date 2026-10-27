import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Banner, PageHeader, TableShell, Th, cardClass, inputClass, labelClass, primaryBtn, secondaryBtn } from "@/components/phase2/ui";
import { createProcessAction, createRiskAction, linkControlRiskAction, unlinkControlRiskAction } from "@/lib/actions/registers";

type Proc = { id: string; name: string; description: string | null; owner: string | null };
type Risk = { id: string; title: string; rating: string | null; owner: string | null; process_id: string | null };
type Link = { id: string; control_id: string; risk_id: string };
type Ctl = { id: string; code: string | null; title: string | null };

export default async function RiskRegister({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) return <EmptyState title="No organization yet" description="Join or create an organization first." />;
  const supabase = await createClient();
  const orgId = ctx.org.id;
  const [{ data: pr }, { data: rr }, { data: lr }, { data: cr }] = await Promise.all([
    supabase.from("processes").select("id, name, description, owner").eq("organization_id", orgId).order("name"),
    supabase.from("risks").select("id, title, rating, owner, process_id").eq("organization_id", orgId).order("title"),
    supabase.from("control_risks").select("id, control_id, risk_id").eq("organization_id", orgId),
    supabase.from("controls").select("id, code, title").eq("organization_id", orgId).order("code"),
  ]);
  const processes = (pr ?? []) as Proc[]; const risks = (rr ?? []) as Risk[]; const links = (lr ?? []) as Link[]; const controls = (cr ?? []) as Ctl[];
  const procName = new Map(processes.map((p) => [p.id, p.name]));
  const ctl = new Map(controls.map((c) => [c.id, c]));
  const canEdit = ["owner", "admin", "internal_auditor"].includes(ctx.role ?? "");
  const unlinked = risks.filter((r) => !links.some((l) => l.risk_id === r.id)).length;

  return (
    <div className="p-8">
      <PageHeader eyebrow="Risk & control framework" title="Process & risk register" subtitle={`${ctx.org.name} — business processes, the risks in each, and the controls that mitigate them.`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {([["Processes", processes.length], ["Risks", risks.length], ["Risks with no linked control", unlinked]] as const).map(([t, n]) => (
          <div key={t} className={cardClass}><p className="text-xs text-mute">{t}</p><p className={`mt-1 text-2xl font-semibold ${t.startsWith("Risks with") && n > 0 ? "text-amber-300" : "text-paper"}`}>{n}</p></div>
        ))}
      </div>

      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Processes</h2>
      {processes.length === 0 ? <p className="mb-4 text-sm text-mute">No processes yet.</p> : (
        <div className="mb-4"><TableShell><thead className="bg-panel text-xs text-mute"><tr><Th>Process</Th><Th>Owner</Th><Th>Description</Th><Th>Risks</Th></tr></thead>
          <tbody>{processes.map((p) => (
            <tr key={p.id} className="border-t border-line align-top"><td className="px-3 py-2 text-paper">{p.name}</td><td className="px-3 py-2">{p.owner ?? "—"}</td><td className="px-3 py-2">{p.description ?? "—"}</td>
              <td className="px-3 py-2">{risks.filter((r) => r.process_id === p.id).length}</td></tr>))}</tbody></TableShell></div>
      )}
      {canEdit && (
        <form action={createProcessAction} className={`${cardClass} mb-8 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end`}>
          <div><label className={labelClass} htmlFor="pn">Process name</label><input id="pn" name="name" required className={inputClass} placeholder="Order to cash" /></div>
          <div><label className={labelClass} htmlFor="po">Owner</label><input id="po" name="owner" className={inputClass} /></div>
          <div><label className={labelClass} htmlFor="pd">Description</label><input id="pd" name="description" className={inputClass} /></div>
          <button className={secondaryBtn} type="submit">Add process</button>
        </form>
      )}

      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Risks and linked controls</h2>
      {risks.length === 0 ? <p className="mb-4 text-sm text-mute">No risks yet.</p> : (
        <div className="mb-4"><TableShell><thead className="bg-panel text-xs text-mute"><tr><Th>Risk</Th><Th>Process</Th><Th>Rating</Th><Th>Owner</Th><Th>Controls</Th></tr></thead>
          <tbody>{risks.map((r) => {
            const mine = links.filter((l) => l.risk_id === r.id);
            return (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2 text-paper">{r.title}</td><td className="px-3 py-2">{r.process_id ? procName.get(r.process_id) ?? "—" : "—"}</td>
                <td className="px-3 py-2">{r.rating ?? "—"}</td><td className="px-3 py-2">{r.owner ?? "—"}</td>
                <td className="px-3 py-2">
                  {mine.length === 0 ? <span className="text-xs text-amber-300">None linked</span> : (
                    <ul className="space-y-1">{mine.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-xs"><span className="text-paper">{ctl.get(l.control_id)?.code ?? "?"} {ctl.get(l.control_id)?.title ?? ""}</span>
                        {canEdit && <form action={unlinkControlRiskAction}><input type="hidden" name="link_id" value={l.id} /><button className="text-rose-300 hover:underline" type="submit" aria-label="Unlink control">unlink</button></form>}</li>))}</ul>)}
                </td>
              </tr>);
          })}</tbody></TableShell></div>
      )}
      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={createRiskAction} className={`${cardClass} grid gap-3`}>
            <h3 className="text-sm font-semibold text-paper">Add a risk</h3>
            <div><label className={labelClass} htmlFor="rt">Risk</label><input id="rt" name="title" required className={inputClass} /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className={labelClass} htmlFor="rp">Process</label><select id="rp" name="process_id" defaultValue="" className={inputClass}><option value="">—</option>{processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className={labelClass} htmlFor="rr">Rating</label><select id="rr" name="rating" defaultValue="" className={inputClass}><option value="">—</option><option>Low</option><option>Medium</option><option>High</option></select></div>
              <div><label className={labelClass} htmlFor="ro">Owner</label><input id="ro" name="owner" className={inputClass} /></div>
            </div>
            <div><label className={labelClass} htmlFor="rd">Description</label><input id="rd" name="description" className={inputClass} /></div>
            <button className={`${primaryBtn} w-fit`} type="submit">Add risk</button>
          </form>
          <form action={linkControlRiskAction} className={`${cardClass} grid gap-3`}>
            <h3 className="text-sm font-semibold text-paper">Link a control to a risk</h3>
            <div><label className={labelClass} htmlFor="lr">Risk</label><select id="lr" name="risk_id" required defaultValue="" className={inputClass}><option value="" disabled>Select a risk</option>{risks.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
            <div><label className={labelClass} htmlFor="lc">Control</label><select id="lc" name="control_id" required defaultValue="" className={inputClass}><option value="" disabled>Select a control</option>{controls.map((c) => <option key={c.id} value={c.id}>{c.code} {c.title}</option>)}</select></div>
            <button className={`${secondaryBtn} w-fit`} type="submit">Link</button>
          </form>
        </div>
      )}
      {!canEdit && <p className="text-xs text-mute">Only owners, admins and internal auditors can edit the register.</p>}
    </div>
  );
}
