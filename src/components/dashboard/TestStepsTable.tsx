"use client";

import { useState, useTransition } from "react";
import {
  addTestStep,
  updateTestStep,
  deleteTestStep,
  reorderTestSteps,
} from "@/lib/actions/test-steps";

type TestStep = {
  id: string;
  step_number: number;
  description: string;
  expected_result: string | null;
  actual_result: string | null;
  evidence_reference: string | null;
  status: string;
  auditor_notes: string | null;
  draft_conclusion: string | null;
};

const statusOptions = [
  { value: "not_started", label: "Not started" },
  { value: "pass", label: "Pass" },
  { value: "exception", label: "Exception" },
  { value: "not_applicable", label: "Not applicable" },
];

const statusDot: Record<string, string> = {
  not_started: "bg-mute",
  pass: "bg-emerald-400",
  exception: "bg-rose-400",
  not_applicable: "bg-blue-400",
};

const textAreaClass =
  "w-full min-w-[160px] resize-y rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";

export function TestStepsTable({
  testPlanId,
  initialSteps,
}: {
  testPlanId: string;
  initialSteps: TestStep[];
}) {
  const [steps, setSteps] = useState<TestStep[]>(initialSteps);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  function markSaved(id: string) {
    setSavedAt((s) => ({ ...s, [id]: Date.now() }));
    setTimeout(() => {
      setSavedAt((s) => {
        const copy = { ...s };
        delete copy[id];
        return copy;
      });
    }, 1500);
  }

  function updateLocal(id: string, field: keyof TestStep, value: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  }

  async function persistField(id: string, field: keyof TestStep, value: string) {
    try {
      await updateTestStep(id, testPlanId, { [field]: value });
      markSaved(id);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAdd() {
    startTransition(async () => {
      try {
        const newStep = await addTestStep(testPlanId, "New procedure");
        setSteps((prev) => [...prev, newStep as TestStep]);
      } catch (err) {
        console.error(err);
      }
    });
  }

  async function handleDelete(id: string) {
    const remaining = steps.filter((s) => s.id !== id);
    setSteps(remaining);
    startTransition(async () => {
      try {
        await deleteTestStep(id, testPlanId);
        if (remaining.length > 0) {
          await reorderTestSteps(
            testPlanId,
            remaining.map((s) => s.id)
          );
          setSteps(remaining.map((s, i) => ({ ...s, step_number: i + 1 })));
        }
      } catch (err) {
        console.error(err);
      }
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const reordered = [...steps];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const renumbered = reordered.map((s, i) => ({ ...s, step_number: i + 1 }));
    setSteps(renumbered);
    startTransition(async () => {
      try {
        await reorderTestSteps(
          testPlanId,
          renumbered.map((s) => s.id)
        );
      } catch (err) {
        console.error(err);
      }
    });
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-panel text-[10px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-2 py-2.5 font-medium">#</th>
              <th className="px-2 py-2.5 font-medium">Audit procedure</th>
              <th className="px-2 py-2.5 font-medium">Expected result</th>
              <th className="px-2 py-2.5 font-medium">Actual result</th>
              <th className="px-2 py-2.5 font-medium">Evidence ref.</th>
              <th className="px-2 py-2.5 font-medium">Result</th>
              <th className="px-2 py-2.5 font-medium">Auditor notes</th>
              <th className="px-2 py-2.5 font-medium">Draft conclusion</th>
              <th className="px-2 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-ink">
            {steps.map((step, i) => (
              <tr key={step.id} className="align-top">
                <td className="px-2 py-2 font-mono text-mute">{step.step_number}</td>
                <td className="px-2 py-2">
                  <textarea
                    rows={2}
                    className={textAreaClass}
                    defaultValue={step.description}
                    onChange={(e) => updateLocal(step.id, "description", e.target.value)}
                    onBlur={(e) => persistField(step.id, "description", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <textarea
                    rows={2}
                    className={textAreaClass}
                    defaultValue={step.expected_result ?? ""}
                    onChange={(e) => updateLocal(step.id, "expected_result", e.target.value)}
                    onBlur={(e) => persistField(step.id, "expected_result", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <textarea
                    rows={2}
                    className={textAreaClass}
                    defaultValue={step.actual_result ?? ""}
                    onChange={(e) => updateLocal(step.id, "actual_result", e.target.value)}
                    onBlur={(e) => persistField(step.id, "actual_result", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    className={textAreaClass}
                    defaultValue={step.evidence_reference ?? ""}
                    onChange={(e) => updateLocal(step.id, "evidence_reference", e.target.value)}
                    onBlur={(e) => persistField(step.id, "evidence_reference", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[step.status] ?? "bg-mute"}`} />
                    <select
                      className="w-full rounded-md border border-line bg-panel px-1.5 py-1.5 text-xs text-paper focus:outline-none focus:ring-1 focus:ring-signal"
                      value={step.status}
                      onChange={(e) => {
                        updateLocal(step.id, "status", e.target.value);
                        persistField(step.id, "status", e.target.value);
                      }}
                    >
                      {statusOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <textarea
                    rows={2}
                    className={textAreaClass}
                    defaultValue={step.auditor_notes ?? ""}
                    onChange={(e) => updateLocal(step.id, "auditor_notes", e.target.value)}
                    onBlur={(e) => persistField(step.id, "auditor_notes", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <textarea
                    rows={2}
                    className={textAreaClass}
                    defaultValue={step.draft_conclusion ?? ""}
                    onChange={(e) => updateLocal(step.id, "draft_conclusion", e.target.value)}
                    onBlur={(e) => persistField(step.id, "draft_conclusion", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Move up"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="rounded border border-line px-1.5 py-0.5 text-mute hover:border-signal hover:text-paper disabled:opacity-30"
                      >
                        &uarr;
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        onClick={() => move(i, 1)}
                        disabled={i === steps.length - 1}
                        className="rounded border border-line px-1.5 py-0.5 text-mute hover:border-signal hover:text-paper disabled:opacity-30"
                      >
                        &darr;
                      </button>
                    </div>
                    <button
                      type="button"
                      title="Delete step"
                      onClick={() => handleDelete(step.id)}
                      className="rounded border border-line px-1.5 py-0.5 text-mute hover:border-rose-400 hover:text-rose-400"
                    >
                      Delete
                    </button>
                    <span className={`text-[10px] transition-opacity ${savedAt[step.id] ? "opacity-100 text-emerald-400" : "opacity-0"}`}>
                      Saved
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {steps.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-mute">
                  No test steps yet. Add the first procedure below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="mt-3 rounded-md border border-line px-4 py-2 text-xs font-medium text-paper transition-colors hover:border-signal"
      >
        + Add test step
      </button>
    </div>
  );
}
