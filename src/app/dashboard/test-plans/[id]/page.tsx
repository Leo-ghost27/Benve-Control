import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { updateTestPlanStatusAction } from "@/lib/actions/test-plans";
import { createPopulationAction, updatePopulationAction } from "@/lib/actions/populations";
import { TestStepsTable } from "@/components/dashboard/TestStepsTable";
import { SampleItemsTable } from "@/components/dashboard/SampleItemsTable";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";
import { WorkpaperReviewPanel } from "@/components/workspace/WorkpaperReviewPanel";
import { Banner } from "@/components/phase2/ui";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// "Ready for review" and "Final" are set only by the review workflow (submit / approve).
const statusOptions = ["Not started", "In progress"];

export default async function TestPlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();
  if (ctx.role === "external_auditor" || ctx.role === "viewer") redirect(`/dashboard/shared-workpapers/${id}`);

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

  const { data: population } = await supabase
    .from("populations")
    .select("*")
    .eq("test_plan_id", id)
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: sampleItems } = population
    ? await supabase
        .from("sample_items")
        .select("id, item_number, item_reference, item_value, item_date, result, notes")
        .eq("population_id", population.id)
        .eq("organization_id", ctx.org.id)
        .order("item_number", { ascending: true })
    : { data: [] };

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
        {plan.status === "final" || plan.status === "ready_for_review" ? (
          <span className="shrink-0 rounded-md border border-line px-3 py-2 text-sm text-paper">{formatLabel(plan.status)}</span>
        ) : (
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
        )}
      </div>

      <Banner notice={sp.notice} error={sp.error} />
      <WorkpaperReviewPanel
        ctx={ctx as typeof ctx & { org: { id: string; name: string } }}
        plan={{ id: plan.id, status: plan.status, assigned_to: plan.assigned_to ?? null, due_date: plan.due_date ?? null }}
      />

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

      {population ? (
        <div className="mb-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-paper">
            Population &amp; sample
          </h2>
          <form
            action={updatePopulationAction}
            className="mb-4 grid grid-cols-4 gap-4 rounded-xl border border-line bg-panel p-5 text-sm"
          >
            <input type="hidden" name="populationId" value={population.id} />
            <input type="hidden" name="testPlanId" value={plan.id} />
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-mute">Population description</label>
              <input
                name="description"
                defaultValue={population.description}
                className="w-full rounded-md border border-line bg-ink px-2.5 py-1.5 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-mute">Source system</label>
              <input
                name="source_system"
                defaultValue={population.source_system ?? ""}
                className="w-full rounded-md border border-line bg-ink px-2.5 py-1.5 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-mute">Total count</label>
              <input
                name="total_count"
                type="number"
                defaultValue={population.total_count ?? ""}
                className="w-full rounded-md border border-line bg-ink px-2.5 py-1.5 text-sm text-paper focus:outline-none focus:ring-1 focus:ring-signal"
              />
            </div>
            <div className="col-span-4 flex items-center gap-6">
              <label className="flex items-center gap-2 text-xs text-mute">
                <input
                  type="checkbox"
                  name="completeness_confirmed"
                  defaultChecked={population.completeness_confirmed}
                  className="rounded border-line"
                />
                Completeness confirmed
              </label>
              <label className="flex items-center gap-2 text-xs text-mute">
                <input
                  type="checkbox"
                  name="accuracy_confirmed"
                  defaultChecked={population.accuracy_confirmed}
                  className="rounded border-line"
                />
                Accuracy confirmed
              </label>
              <button
                type="submit"
                className="ml-auto rounded-md border border-line px-3 py-1.5 text-xs text-paper transition-colors hover:border-signal"
              >
                Save
              </button>
            </div>
          </form>

          <SampleItemsTable
            populationId={population.id}
            testPlanId={plan.id}
            initialItems={sampleItems ?? []}
          />
        </div>
      ) : (
        <div className="mb-8 rounded-xl border border-dashed border-line p-6">
          <p className="mb-3 text-sm text-mute">
            No population defined yet for this test plan.
          </p>
          <form action={createPopulationAction} className="flex gap-2">
            <input type="hidden" name="testPlanId" value={plan.id} />
            <input
              name="description"
              required
              placeholder="e.g. All payments above $10,000 in the review period"
              className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal"
            />
            <button
              type="submit"
              className="rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
            >
              Create population
            </button>
          </form>
        </div>
      )}

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
