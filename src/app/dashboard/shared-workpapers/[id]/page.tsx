import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { Banner, PageHeader, TableShell, Th, cardClass, fmtDate, fmtDateTime, inputClass, labelClass, secondaryBtn } from "@/components/phase2/ui";
import { addPlanCommentAction } from "@/lib/actions/reviews";

type Doc = {
  plan: Record<string, string | number | null>;
  approved: { version: number; approved_at: string; content_hash: string };
  steps: { id: string; step_number: number; description: string; expected_result: string | null; actual_result: string | null; status: string; draft_conclusion: string | null }[];
  evidence: { id: string; name: string | null; description: string | null; step_id: string }[];
};

export default async function SharedWorkpaper({ params, searchParams }: { params: { id: string }; searchParams: { notice?: string; error?: string } }) {
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("p2_shared_test_plan", { p_plan: params.id });
  if (!data) notFound();                                       // not approved, or not in this person's workspace
  const doc = data as Doc;
  const { data: commentRows } = await supabase.from("workpaper_comments").select("id, body, created_at")
    .eq("organization_id", ctx.org!.id).eq("target_type", "test_plan").eq("target_id", params.id).eq("visibility", "shareable").order("created_at", { ascending: false });
  const comments = (commentRows ?? []) as { id: string; body: string; created_at: string }[];
  const canComment = ctx.role === "external_auditor";
  return (
    <div className="p-8">
      <Link href="/dashboard/shared-workpapers" className="text-xs text-mute hover:text-paper">← Approved workpapers</Link>
      <PageHeader eyebrow={`Approved version ${doc.approved.version}`} title={String(doc.plan.name ?? "Workpaper")} subtitle={`Approved ${fmtDate(doc.approved.approved_at)} · reference ${doc.approved.content_hash.slice(0, 12)}`} />
      <Banner notice={searchParams.notice} error={searchParams.error} />
      <div className={`${cardClass} mb-6 grid gap-3 text-sm sm:grid-cols-3`}>
        {([["Test type", doc.plan.test_type], ["Period", doc.plan.period_under_review], ["Sample size", doc.plan.sample_size], ["Population", doc.plan.population_description], ["Sampling approach", doc.plan.sampling_approach], ["Description", doc.plan.description]] as const).map(([t, v]) => (
          <div key={t}><p className="text-xs text-mute">{t}</p><p className="text-paper">{v ?? "—"}</p></div>
        ))}
      </div>
      <h2 className="mb-2 font-display text-lg font-semibold text-paper">Test steps</h2>
      <TableShell>
        <thead className="bg-panel text-xs text-mute"><tr><Th>#</Th><Th>Procedure</Th><Th>Expected</Th><Th>Actual</Th><Th>Result</Th><Th>Conclusion</Th></tr></thead>
        <tbody>{doc.steps.map((s) => (
          <tr key={s.id} className="border-t border-line align-top">
            <td className="px-3 py-2">{s.step_number}</td><td className="px-3 py-2 text-paper">{s.description}</td>
            <td className="px-3 py-2">{s.expected_result ?? "—"}</td><td className="px-3 py-2">{s.actual_result ?? "—"}</td>
            <td className="px-3 py-2">{s.status}</td><td className="px-3 py-2">{s.draft_conclusion ?? "—"}</td>
          </tr>
        ))}</tbody>
      </TableShell>
      {doc.evidence.length > 0 && (
        <div className={`${cardClass} mt-6`}>
          <h2 className="mb-2 text-sm font-semibold text-paper">Linked evidence</h2>
          <ul className="space-y-1 text-sm">{doc.evidence.map((e) => <li key={e.id} className="text-paper">{e.name ?? "Evidence item"}{e.description ? <span className="text-mute"> — {e.description}</span> : null}</li>)}</ul>
          <p className="mt-2 text-xs text-mute">File downloads are provided by the engagement team on request.</p>
        </div>
      )}
      <div className={`${cardClass} mt-6`}>
        <h2 className="mb-2 text-sm font-semibold text-paper">Shared comments</h2>
        {comments.length === 0 ? <p className="text-sm text-mute">No shared comments yet.</p> : (
          <ul className="mb-3 space-y-2">{comments.map((c) => <li key={c.id} className="rounded-md border border-line p-3 text-sm"><span className="text-xs text-mute">{fmtDateTime(c.created_at)}</span><p className="text-paper">{c.body}</p></li>)}</ul>
        )}
        {canComment && (
          <form action={addPlanCommentAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="plan_id" value={params.id} /><input type="hidden" name="org_id" value={ctx.org!.id} /><input type="hidden" name="visibility" value="shareable" />
            <div><label className={labelClass} htmlFor="sc-body">Add a comment for the engagement team</label><input id="sc-body" name="body" required className={inputClass} /></div>
            <button className={secondaryBtn} type="submit">Add</button>
          </form>
        )}
      </div>
    </div>
  );
}
