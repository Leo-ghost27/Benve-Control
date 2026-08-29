"use client";

import { useState } from "react";
import Link from "next/link";
import { createControlAction } from "@/lib/actions/controls";
import { AiAssistPanel } from "@/components/dashboard/AiAssistPanel";
import type { ControlDraft } from "@/lib/actions/ai-assist";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium text-mute";

const aiTag = (
  <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
    AI draft – auditor reviewed
  </span>
);

type FormState = {
  code: string;
  title: string;
  framework: string;
  business_model: string;
  process: string;
  risk_statement: string;
  control_objective: string;
  description: string;
  assertion: string;
  risk_rating: string;
  frequency: string;
  control_owner: string;
  control_type: string;
  automation_level: string;
  status: string;
};

const emptyState: FormState = {
  code: "",
  title: "",
  framework: "SOX 404 / ICFR",
  business_model: "Payments",
  process: "",
  risk_statement: "",
  control_objective: "",
  description: "",
  assertion: "",
  risk_rating: "Medium",
  frequency: "",
  control_owner: "",
  control_type: "",
  automation_level: "",
  status: "Draft",
};

export function NewControlForm({ orgName }: { orgName: string | null }) {
  const [form, setForm] = useState<FormState>(emptyState);
  const [aiFields, setAiFields] = useState<Set<keyof FormState>>(new Set());
  const [aiAssisted, setAiAssisted] = useState(false);
  const [aiEvidenceRequest, setAiEvidenceRequest] = useState("");
  const [aiDesignSteps, setAiDesignSteps] = useState<string[]>([]);
  const [aiEffectivenessSteps, setAiEffectivenessSteps] = useState<string[]>([]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Manual edits after using a draft still count as auditor review —
    // the field simply stops being purely AI-authored text.
    setAiFields((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function handleUseDraft(draft: ControlDraft) {
    setForm((prev) => ({
      ...prev,
      code: draft.control_id_suggestion,
      title: draft.control_name,
      risk_statement: draft.risk_statement,
      control_objective: draft.control_objective,
      description: draft.control_description,
      assertion: draft.assertions.join(", "),
    }));
    setAiFields(
      new Set(["code", "title", "risk_statement", "control_objective", "description", "assertion"])
    );
    setAiAssisted(true);
    setAiEvidenceRequest(draft.client_evidence_request);
    setAiDesignSteps(draft.test_of_design_steps);
    setAiEffectivenessSteps(draft.test_of_effectiveness_steps);
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href="/dashboard/controls" className="text-sm text-mute hover:text-paper">
        &larr; Back to Controls
      </Link>

      <div className="mt-4 mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          New control
        </h1>
        <p className="mt-1 text-sm text-mute">Company / client: {orgName ?? "—"}</p>
      </div>

      <AiAssistPanel onUseDraft={handleUseDraft} />

      {aiAssisted && (
        <div className="mb-6 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          This form is populated from an AI Assist draft. Review every field below before
          creating the control — you can edit anything.
          {(aiDesignSteps.length > 0 || aiEffectivenessSteps.length > 0) && (
            <span>
              {" "}
              Creating this control will also create Test of Design (
              {aiDesignSteps.length} steps) and Test of Effectiveness (
              {aiEffectivenessSteps.length} steps) test plans from the draft.
            </span>
          )}
        </div>
      )}

      <form action={createControlAction} className="space-y-5">
        <input type="hidden" name="ai_assisted" value={aiAssisted ? "true" : "false"} />
        <input type="hidden" name="ai_evidence_request_draft" value={aiEvidenceRequest} />
        <input type="hidden" name="ai_design_steps" value={JSON.stringify(aiDesignSteps)} />
        <input
          type="hidden"
          name="ai_effectiveness_steps"
          value={JSON.stringify(aiEffectivenessSteps)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Control ID {aiFields.has("code") && aiTag}
            </label>
            <input
              name="code"
              required
              placeholder="CTRL-PAY-001"
              className={inputClass}
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>
              Control name {aiFields.has("title") && aiTag}
            </label>
            <input
              name="title"
              required
              placeholder="Dual Approval for High-Value Payments"
              className={inputClass}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Framework</label>
            <select
              name="framework"
              className={inputClass}
              value={form.framework}
              onChange={(e) => set("framework", e.target.value)}
            >
              <option value="SOX 404 / ICFR">SOX 404 / ICFR</option>
              <option value="SOX 404">SOX 404</option>
              <option value="ICFR">ICFR</option>
              <option value="OCC / bank-partner readiness">OCC / bank-partner readiness</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Business model</label>
            <select
              name="business_model"
              className={inputClass}
              value={form.business_model}
              onChange={(e) => set("business_model", e.target.value)}
            >
              <option value="Payments">Payments</option>
              <option value="Lending">Lending</option>
              <option value="Neobank/BaaS">Neobank/BaaS</option>
              <option value="Card programme">Card programme</option>
              <option value="Treasury">Treasury</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Process</label>
          <input
            name="process"
            placeholder="Payments and settlement"
            className={inputClass}
            value={form.process}
            onChange={(e) => set("process", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>
            Risk statement {aiFields.has("risk_statement") && aiTag}
          </label>
          <textarea
            name="risk_statement"
            rows={2}
            className={inputClass}
            value={form.risk_statement}
            onChange={(e) => set("risk_statement", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>
            Control objective {aiFields.has("control_objective") && aiTag}
          </label>
          <textarea
            name="control_objective"
            rows={2}
            className={inputClass}
            value={form.control_objective}
            onChange={(e) => set("control_objective", e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>
            Control description {aiFields.has("description") && aiTag}
          </label>
          <textarea
            name="description"
            rows={2}
            className={inputClass}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Financial statement assertion {aiFields.has("assertion") && aiTag}
            </label>
            <input
              name="assertion"
              placeholder="Occurrence, Completeness, Accuracy"
              className={inputClass}
              value={form.assertion}
              onChange={(e) => set("assertion", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Risk rating</label>
            <select
              name="risk_rating"
              className={inputClass}
              value={form.risk_rating}
              onChange={(e) => set("risk_rating", e.target.value)}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Frequency</label>
            <input
              name="frequency"
              placeholder="Per transaction"
              className={inputClass}
              value={form.frequency}
              onChange={(e) => set("frequency", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Control owner</label>
            <input
              name="control_owner"
              placeholder="Finance Operations Manager"
              className={inputClass}
              value={form.control_owner}
              onChange={(e) => set("control_owner", e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Control type</label>
            <select
              name="control_type"
              className={inputClass}
              value={form.control_type}
              onChange={(e) => set("control_type", e.target.value)}
            >
              <option value="">Not set</option>
              <option value="Preventive">Preventive</option>
              <option value="Detective">Detective</option>
              <option value="Hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Automation level</label>
            <select
              name="automation_level"
              className={inputClass}
              value={form.automation_level}
              onChange={(e) => set("automation_level", e.target.value)}
            >
              <option value="">Not set</option>
              <option value="Manual">Manual</option>
              <option value="IT-dependent manual">IT-dependent manual</option>
              <option value="Automated">Automated</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Status</label>
          <select
            name="status"
            className={inputClass}
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="Draft">Draft</option>
            <option value="Active">Active</option>
            <option value="Under testing">Under testing</option>
            <option value="Completed">Completed</option>
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
          >
            Create control
          </button>
          <Link
            href="/dashboard/controls"
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:border-mute"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
