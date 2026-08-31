"use client";

import { useState } from "react";
import Link from "next/link";
import { createAndSendEvidenceRequestAction } from "@/lib/actions/evidence-requests";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium text-mute";

type TestPlanOption = { id: string; name: string };
type TestStepOption = { id: string; step_number: number; description: string };

type FormState = {
  title: string;
  instructions: string;
  test_plan_id: string;
  test_step_id: string;
  owner_name: string;
  owner_email: string;
  due_date: string;
  evidence_period: string;
  priority: string;
};

export function NewEvidenceRequestForm({
  controlId,
  controlLabel,
  testPlans,
  testSteps,
}: {
  controlId: string;
  controlLabel: string;
  testPlans: TestPlanOption[];
  testSteps: TestStepOption[];
}) {
  const [previewing, setPreviewing] = useState(false);
  const [form, setForm] = useState<FormState>({
    title: "",
    instructions: "",
    test_plan_id: "",
    test_step_id: "",
    owner_name: "",
    owner_email: "",
    due_date: "",
    evidence_period: "",
    priority: "Medium",
  });

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canPreview =
    form.title.trim() && form.owner_name.trim() && form.owner_email.trim();

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href={`/dashboard/controls/${controlId}`} className="text-sm text-mute hover:text-paper">
        &larr; Back to {controlLabel}
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Request evidence
        </h1>
        <p className="mt-1 text-sm text-mute">{controlLabel}</p>
      </div>

      {!previewing ? (
        <div className="space-y-5">
          <div>
            <label className={labelClass}>Request title</label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Q3 payment population and approval evidence"
            />
          </div>
          <div>
            <label className={labelClass}>Plain-English instructions</label>
            <textarea
              rows={3}
              className={inputClass}
              value={form.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Please upload the complete population of payments above $10,000..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Related test plan (optional)</label>
              <select
                className={inputClass}
                value={form.test_plan_id}
                onChange={(e) => set("test_plan_id", e.target.value)}
              >
                <option value="">None</option>
                {testPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Related test step (optional)</label>
              <select
                className={inputClass}
                value={form.test_step_id}
                onChange={(e) => set("test_step_id", e.target.value)}
              >
                <option value="">None</option>
                {testSteps.map((s) => (
                  <option key={s.id} value={s.id}>
                    Step {s.step_number}: {s.description.slice(0, 40)}
                    {s.description.length > 40 ? "…" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Client control owner name</label>
              <input
                className={inputClass}
                value={form.owner_name}
                onChange={(e) => set("owner_name", e.target.value)}
                placeholder="Sarah Jones"
              />
            </div>
            <div>
              <label className={labelClass}>Client control owner email</label>
              <input
                type="email"
                className={inputClass}
                value={form.owner_email}
                onChange={(e) => set("owner_email", e.target.value)}
                placeholder="sarah.jones@meridianpay.com"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Due date</label>
              <input
                type="date"
                className={inputClass}
                value={form.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Evidence period</label>
              <input
                className={inputClass}
                value={form.evidence_period}
                onChange={(e) => set("evidence_period", e.target.value)}
                placeholder="Q3 2026"
              />
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select
                className={inputClass}
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={!canPreview}
            onClick={() => setPreviewing(true)}
            className="rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Preview request
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-5 rounded-md border border-signal/30 bg-signal/5 px-3 py-2 text-xs text-signal">
            Preview — nothing has been sent yet.
          </div>
          <div className="space-y-4 rounded-xl border border-line bg-panel p-6 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-mute">Title</p>
              <p className="mt-1 text-paper">{form.title}</p>
            </div>
            {form.instructions && (
              <div>
                <p className="text-xs uppercase tracking-wide text-mute">Instructions</p>
                <p className="mt-1 text-paper">{form.instructions}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-mute">Sent to</p>
                <p className="mt-1 text-paper">
                  {form.owner_name} ({form.owner_email})
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-mute">Priority</p>
                <p className="mt-1 text-paper">{form.priority}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-mute">Due date</p>
                <p className="mt-1 text-paper">{form.due_date || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-mute">Evidence period</p>
                <p className="mt-1 text-paper">{form.evidence_period || "—"}</p>
              </div>
            </div>
          </div>

          <form action={createAndSendEvidenceRequestAction} className="mt-5 flex gap-3">
            <input type="hidden" name="control_id" value={controlId} />
            <input type="hidden" name="title" value={form.title} />
            <input type="hidden" name="instructions" value={form.instructions} />
            <input type="hidden" name="test_plan_id" value={form.test_plan_id} />
            <input type="hidden" name="test_step_id" value={form.test_step_id} />
            <input type="hidden" name="owner_name" value={form.owner_name} />
            <input type="hidden" name="owner_email" value={form.owner_email} />
            <input type="hidden" name="due_date" value={form.due_date} />
            <input type="hidden" name="evidence_period" value={form.evidence_period} />
            <input type="hidden" name="priority" value={form.priority} />

            <button
              type="submit"
              className="rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
            >
              Send request
            </button>
            <button
              type="button"
              onClick={() => setPreviewing(false)}
              className="rounded-md border border-line px-5 py-2.5 text-sm text-paper transition-colors hover:border-mute"
            >
              Back to edit
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
