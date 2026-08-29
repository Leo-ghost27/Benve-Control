import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { updateControlStatusAction } from "@/lib/actions/controls";
import { ChangeHistory } from "@/components/dashboard/ChangeHistory";

function formatLabel(value: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusOptions = ["Draft", "Active", "Under testing", "Completed"];

export default async function ControlDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getOrgContext();
  if (!ctx?.org) notFound();

  const supabase = await createClient();

  const { data: control, error } = await supabase
    .from("controls")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !control) notFound();

  const { data: testPlans } = await supabase
    .from("test_plans")
    .select("id, name, test_type, status, sample_size, created_at")
    .eq("control_id", id)
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: true });

  const { data: history } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, metadata, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link href="/dashboard/controls" className="text-sm text-mute hover:text-paper">
        &larr; Back to Controls
      </Link>

      <div className="mt-4 mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
            Auditor Workspace
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
            {control.code} — {control.title}
          </h1>
          <p className="mt-1 text-sm text-mute">{ctx.org.name}</p>
          {control.ai_assisted && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              AI draft – auditor reviewed
            </span>
          )}
        </div>
        <form action={updateControlStatusAction} className="flex shrink-0 items-center gap-2">
          <input type="hidden" name="controlId" value={control.id} />
          <select
            name="status"
            defaultValue={formatLabel(control.status)}
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

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-panel p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Framework</p>
          <p className="mt-1 text-sm text-paper">{control.framework ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Business model</p>
          <p className="mt-1 text-sm text-paper">{control.business_model ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Process</p>
          <p className="mt-1 text-sm text-paper">{control.process ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Risk rating</p>
          <p className="mt-1 text-sm text-paper">{formatLabel(control.risk_rating)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Frequency</p>
          <p className="mt-1 text-sm text-paper">{control.frequency ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-mute">Control owner</p>
          <p className="mt-1 text-sm text-paper">{control.control_owner ?? "—"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-mute">Assertion</p>
          <p className="mt-1 text-sm text-paper">{control.assertion ?? "—"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-mute">Risk statement</p>
          <p className="mt-1 text-sm text-paper">{control.risk_statement ?? "—"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-mute">Control objective</p>
          <p className="mt-1 text-sm text-paper">{control.control_objective ?? "—"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs uppercase tracking-wide text-mute">Control description</p>
          <p className="mt-1 text-sm text-paper">{control.description ?? "—"}</p>
        </div>
      </div>

      {control.ai_evidence_request_draft && (
        <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/5 p-5">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
              Draft client evidence request
            </p>
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              AI draft – auditor reviewed
            </span>
          </div>
          <p className="text-sm text-paper">{control.ai_evidence_request_draft}</p>
          <p className="mt-3 text-xs text-mute">
            This wording was drafted for a future evidence-request feature and isn&apos;t sent
            to any client yet — that pipeline hasn&apos;t been built.
          </p>
        </div>
      )}

      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-paper">Test plans</h2>
        <Link
          href={`/dashboard/controls/${control.id}/test-plans/new`}
          className="rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
        >
          Create test plan
        </Link>
      </div>

      {!testPlans || testPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-mute">
          No test plans yet for this control.
        </div>
      ) : (
        <div className="space-y-2">
          {testPlans.map((plan) => (
            <Link
              key={plan.id}
              href={`/dashboard/test-plans/${plan.id}`}
              className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3 text-sm transition-colors hover:border-signal"
            >
              <div>
                <p className="font-medium text-paper">{plan.name}</p>
                <p className="mt-0.5 text-xs text-mute">
                  {formatLabel(plan.test_type)}
                  {plan.sample_size ? ` · Sample size ${plan.sample_size}` : ""}
                </p>
              </div>
              <span className="text-xs text-mute">{formatLabel(plan.status)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-paper">Change history</h2>
        <ChangeHistory entries={history ?? []} />
      </div>

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-mute">
        Benve provides configurable workpapers and draft procedures. The auditor remains
        responsible for audit scope, sampling, testing, evidence evaluation, exception
        assessment, conclusions, and client advice.
      </p>
    </div>
  );
}
