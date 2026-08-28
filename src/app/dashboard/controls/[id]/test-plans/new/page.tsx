import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { createTestPlanAction } from "@/lib/actions/test-plans";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium text-mute";

export default async function NewTestPlanPage({
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
    .select("id, code, title")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();

  if (error || !control) notFound();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href={`/dashboard/controls/${id}`} className="text-sm text-mute hover:text-paper">
        &larr; Back to {control.code}
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Create test plan
        </h1>
        <p className="mt-1 text-sm text-mute">
          {control.code} — {control.title}
        </p>
      </div>

      <form action={createTestPlanAction} className="space-y-5">
        <input type="hidden" name="controlId" value={id} />

        <div>
          <label className={labelClass} htmlFor="name">Test plan name</label>
          <input
            id="name"
            name="name"
            required
            placeholder={`${control.title}: Test of Effectiveness`}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="test_type">Test type</label>
          <select id="test_type" name="test_type" className={inputClass} defaultValue="test_of_effectiveness">
            <option value="test_of_design">Test of Design</option>
            <option value="test_of_effectiveness">Test of Effectiveness</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="period_under_review">Period under review</label>
          <input id="period_under_review" name="period_under_review" placeholder="Q3 2026" className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="population_description">Population description</label>
          <textarea id="population_description" name="population_description" rows={2} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="sampling_approach">Sampling approach</label>
            <input id="sampling_approach" name="sampling_approach" placeholder="Systematic sampling" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sample_size">Sample size</label>
            <input id="sample_size" name="sample_size" type="number" min="0" placeholder="25" className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="prepared_by">Prepared by</label>
            <input id="prepared_by" name="prepared_by" placeholder="Auditor name" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="reviewed_by">Reviewed by</label>
            <input id="reviewed_by" name="reviewed_by" placeholder="Reviewer name" className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="status">Test status</label>
          <select id="status" name="status" className={inputClass} defaultValue="Not started">
            <option value="Not started">Not started</option>
            <option value="In progress">In progress</option>
            <option value="Ready for review">Ready for review</option>
            <option value="Final">Final</option>
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
          >
            Create test plan
          </button>
          <Link
            href={`/dashboard/controls/${id}`}
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:border-mute"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
