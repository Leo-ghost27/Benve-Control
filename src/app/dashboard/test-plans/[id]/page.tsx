import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { updateTestPlanStatusAction } from "@/lib/actions/test-plans";
import { TestStepsTable } from "@/components/dashboard/TestStepsTable";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusOptions = ["Not started", "In progress", "Ready for review", "Final"];

export default async function TestPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: plan, error } = await supabase
    .from("test_plans")
    .select("*, controls(id, code, title)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !plan) notFound();

  const control = Array.isArray(plan.controls) ? plan.controls[0] : plan.controls;

  const { data: steps } = await supabase
    .from("test_steps")
    .select(
      "id, step_number, description, expected_result, actual_result, evidence_reference, status, auditor_notes, draft_conclusion"
    )
    .eq("test_plan_id", id)
    .eq("organization_id", ctx.org.id)
    .order("step_number", { ascending: true });

  const [{ data: planHistory }, { data: stepHistory }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, entity_type, metadata, created_at")
      .eq("organization_id", ctx.org.id)
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("audit_log")
      .select("id, action, entity_type, metadata, created_at")
      .eq("organization_id", ctx.org.id)
      .eq("entity_type", "test_step")
      .contains("metadata", { test_plan_id: id })
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const history = [...(planHistory ?? []), ...(stepHistory ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="mx-auto max-w-6xl p-8">
      {control && (
        <Link
          href={`/dashboard/controls/${control.id}`}
          className="text-sm text-mute hover:text-paper"
        >
          &larr; Back to {control.code}
        </Link>
      )}

      <div className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
            Auditor Workspace
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
            {plan.name}
          </h1>
          <p className="mt-1 text-sm text-mute">
            {formatLabel(plan.test_type)}
            {plan.period_under_review ? ` · ${plan.period_under_review}` : ""}
          </p>
        </div>
        <form action={updateTestPlanStatusAction} className="flex shrink-0 items-center gap-2">
          <input type="hidden" name="testPlanId" value={plan.id} />
          <select
            name="status"
            defaultValue={formatLabel(plan.status)}
            className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-line px-3 py-2 text-sm text-paper transition-colors hover:border-signal"
          >
            Update
          </button>
        </form>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4 rounded-xl border border-line bg-panel p-5 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Population</p>
          <p className="mt-1 text-paper">{plan.population_description ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Sampling approach</p>
          <p className="mt-1 text-paper">{plan.sampling_approach ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Sample size</p>
          <p className="mt-1 text-paper">{plan.sample_size ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Prepared / Reviewed by</p>
          <p className="mt-1 text-paper">
            {plan.prepared_by ?? "—"} / {plan.reviewed_by ?? "—"}
          </p>
        </div>
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold text-paper">Test steps</h2>
      <TestStepsTable testPlanId={plan.id} initialSteps={steps ?? []} />

      <div className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-paper">Change history</h2>
        <ChangeHistory entries={history} />
      </div>

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-mute">
        Benve provides configurable workpapers and draft procedures. The auditor remains
        responsible for audit scope, sampling, testing, evidence evaluation, exception
        assessment, conclusions, and client advice.
      </p>
    </div>
  );
}
