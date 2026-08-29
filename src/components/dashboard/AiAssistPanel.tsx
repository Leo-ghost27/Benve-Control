"use client";

import { useState } from "react";
import {
  generateControlDraftAction,
  type ControlDraft,
  type ControlDraftInputs,
} from "@/lib/actions/ai-assist";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const labelClass = "mb-1.5 block text-xs font-medium text-mute";

const aiTag = (
  <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
    AI draft – auditor reviewed
  </span>
);

type Mode = "collapsed" | "inputs" | "loading" | "preview" | "editing";

export function AiAssistPanel({
  onUseDraft,
}: {
  onUseDraft: (draft: ControlDraft) => void;
}) {
  const [mode, setMode] = useState<Mode>("collapsed");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ControlDraft | null>(null);
  const [editableDraft, setEditableDraft] = useState<ControlDraft | null>(null);

  const [inputs, setInputs] = useState<ControlDraftInputs>({
    business_model: "Payments",
    process_area: "Payments & settlement",
    frequency: "Monthly",
    control_type: "Preventive",
    automation_level: "Manual",
    risk_description: "",
    control_objective_hint: "",
    additional_context: "",
  });

  function setInput<K extends keyof ControlDraftInputs>(key: K, value: ControlDraftInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    setError(null);
    setMode("loading");
    const result = await generateControlDraftAction(inputs);
    if (result.error || !result.draft) {
      setError(result.error ?? "Something went wrong generating the draft.");
      setMode("inputs");
      return;
    }
    setDraft(result.draft);
    setEditableDraft(result.draft);
    setMode("preview");
  }

  function handleDiscard() {
    setDraft(null);
    setEditableDraft(null);
    setError(null);
    setMode("collapsed");
  }

  function handleUseDraft() {
    if (editableDraft) {
      onUseDraft(editableDraft);
      setMode("collapsed");
    }
  }

  if (mode === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setMode("inputs")}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-signal/50 bg-signal/5 px-4 py-3 text-sm font-medium text-signal transition-colors hover:bg-signal/10"
      >
        <span aria-hidden="true">✨</span> Generate draft with AI Assist
      </button>
    );
  }

  if (mode === "inputs" || mode === "loading") {
    return (
      <div className="mb-6 rounded-lg border border-line bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-paper">AI Assist</h3>
          <button
            type="button"
            onClick={handleDiscard}
            className="text-xs text-mute hover:text-paper"
          >
            Cancel
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Business model</label>
            <select
              className={inputClass}
              value={inputs.business_model}
              onChange={(e) => setInput("business_model", e.target.value)}
            >
              <option>Payments</option>
              <option>Lending</option>
              <option>Neobank</option>
              <option>BaaS</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Process area</label>
            <select
              className={inputClass}
              value={inputs.process_area}
              onChange={(e) => setInput("process_area", e.target.value)}
            >
              <option>Payments & settlement</option>
              <option>Revenue</option>
              <option>Treasury</option>
              <option>Financial close</option>
              <option>ITGC</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Control frequency</label>
            <select
              className={inputClass}
              value={inputs.frequency}
              onChange={(e) => setInput("frequency", e.target.value)}
            >
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
              <option>Quarterly</option>
              <option>Ad-hoc</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Control type</label>
            <select
              className={inputClass}
              value={inputs.control_type}
              onChange={(e) => setInput("control_type", e.target.value)}
            >
              <option>Preventive</option>
              <option>Detective</option>
              <option>Hybrid</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Automation level</label>
            <select
              className={inputClass}
              value={inputs.automation_level}
              onChange={(e) => setInput("automation_level", e.target.value)}
            >
              <option>Manual</option>
              <option>IT-dependent manual</option>
              <option>Automated</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className={labelClass}>Risk description (required)</label>
          <textarea
            rows={2}
            className={inputClass}
            value={inputs.risk_description}
            onChange={(e) => setInput("risk_description", e.target.value)}
            placeholder="What could go wrong without this control?"
          />
        </div>
        <div className="mt-4">
          <label className={labelClass}>Control objective (optional)</label>
          <textarea
            rows={2}
            className={inputClass}
            value={inputs.control_objective_hint}
            onChange={(e) => setInput("control_objective_hint", e.target.value)}
          />
        </div>
        <div className="mt-4">
          <label className={labelClass}>Additional context (optional)</label>
          <textarea
            rows={2}
            className={inputClass}
            value={inputs.additional_context}
            onChange={(e) => setInput("additional_context", e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={mode === "loading" || !inputs.risk_description.trim()}
          className="mt-5 w-full rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === "loading" ? "Generating draft…" : "Generate draft"}
        </button>
      </div>
    );
  }

  if ((mode === "preview" || mode === "editing") && editableDraft) {
    const editing = mode === "editing";
    return (
      <div className="mb-6 rounded-lg border border-amber-400/30 bg-panel p-5">
        <div className="mb-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-300">
          AI Assist draft – requires auditor review and approval.
        </div>

        <div className="space-y-4 text-sm">
          <Field label="Control ID suggestion" tag>
            <EditableText
              editing={editing}
              value={editableDraft.control_id_suggestion}
              onChange={(v) => setEditableDraft({ ...editableDraft, control_id_suggestion: v })}
            />
          </Field>
          <Field label="Control name" tag>
            <EditableText
              editing={editing}
              value={editableDraft.control_name}
              onChange={(v) => setEditableDraft({ ...editableDraft, control_name: v })}
            />
          </Field>
          <Field label="Risk statement" tag>
            <EditableTextarea
              editing={editing}
              value={editableDraft.risk_statement}
              onChange={(v) => setEditableDraft({ ...editableDraft, risk_statement: v })}
            />
          </Field>
          <Field label="Control objective" tag>
            <EditableTextarea
              editing={editing}
              value={editableDraft.control_objective}
              onChange={(v) => setEditableDraft({ ...editableDraft, control_objective: v })}
            />
          </Field>
          <Field label="Control description" tag>
            <EditableTextarea
              editing={editing}
              value={editableDraft.control_description}
              onChange={(v) => setEditableDraft({ ...editableDraft, control_description: v })}
            />
          </Field>
          <Field label="ICFR assertions" tag>
            <div className="flex flex-wrap gap-1.5">
              {editableDraft.assertions.map((a, i) => (
                <span key={i} className="rounded-full border border-line bg-ink px-2.5 py-1 text-xs text-paper">
                  {a}
                </span>
              ))}
            </div>
          </Field>
          <Field label="Evidence required" tag>
            <ul className="list-disc space-y-1 pl-4 text-paper">
              {editableDraft.evidence_required.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Field>
          <Field label="Test of Design steps" tag>
            <ol className="list-decimal space-y-1 pl-4 text-paper">
              {editableDraft.test_of_design_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </Field>
          <Field label="Test of Effectiveness steps" tag>
            <ol className="list-decimal space-y-1 pl-4 text-paper">
              {editableDraft.test_of_effectiveness_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </Field>
          <Field label="Client evidence request" tag>
            <EditableTextarea
              editing={editing}
              value={editableDraft.client_evidence_request}
              onChange={(v) => setEditableDraft({ ...editableDraft, client_evidence_request: v })}
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleUseDraft}
            className="rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90"
          >
            Use draft
          </button>
          <button
            type="button"
            onClick={() => setMode(editing ? "preview" : "editing")}
            className="rounded-md border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-signal"
          >
            {editing ? "Done editing" : "Edit draft"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-md border border-line px-4 py-2 text-sm text-paper transition-colors hover:border-signal"
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="rounded-md border border-line px-4 py-2 text-sm text-mute transition-colors hover:border-rose-400 hover:text-rose-400"
          >
            Discard
          </button>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-mute">
          AI Assist may draft descriptions, objectives, assertions, evidence lists, test steps,
          and client request wording. It does not decide sample sizes, effectiveness
          conclusions, deficiency severity, evidence approval/rejection, client communications,
          or SOX applicability — those remain the auditor&apos;s decisions.
        </p>
      </div>
    );
  }

  return null;
}

function Field({
  label,
  tag,
  children,
}: {
  label: string;
  tag?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-xs font-medium text-mute">{label}</p>
        {tag && aiTag}
      </div>
      {children}
    </div>
  );
}

function EditableText({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!editing) return <p className="text-paper">{value}</p>;
  return (
    <input
      type="text"
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EditableTextarea({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!editing) return <p className="text-paper">{value}</p>;
  return (
    <textarea
      rows={2}
      className={inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
