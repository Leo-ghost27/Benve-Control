"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { done, fail, friendly, gate, num, txt } from "@/lib/phase2/action-utils";
import type { Capability } from "@/lib/phase2/permissions";
import { canTransition, EXCEPTION_TRANSITIONS, RULE_TRANSITIONS, SUMMARY_TRANSITIONS } from "@/lib/phase2/workflow";
import { SEVERITIES, validateCsv, MAX_IMPORT_ROWS } from "@/lib/phase2/csv";

/**
 * All mutations: (1) check the capability here for a friendly message,
 * (2) let the database re-check via RLS + triggers (authoritative),
 * (3) audit entries are written by DB triggers (p2_audit), so no action
 *     can change a record without a log entry.
 * Failures redirect back with ?error= so every page can show an error state.
 */

function sev(fd: FormData): string | null {
  const s = txt(fd, "severity");
  if (s && !(SEVERITIES as readonly string[]).includes(s)) return "invalid";
  return s;
}

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------
export async function saveCcmRuleAction(fd: FormData) {
  const id = txt(fd, "id");
  const { ctx, returnTo } = await gate(fd, id ? "ccm.rule.edit" : "ccm.rule.create", "/dashboard/ccm/rules");
  const severity = sev(fd);
  if (severity === "invalid") fail(returnTo, "Severity must be low, medium, high or critical.");
  const name = txt(fd, "name");
  const ruleCode = txt(fd, "rule_code");
  if (!name || !ruleCode) fail(returnTo, "Rule code and name are required.");

  const supabase = await createClient();
  const fields = {
    reporting_period_id: txt(fd, "reporting_period_id"),
    control_id: txt(fd, "control_id"),
    rule_code: ruleCode,
    name,
    description: txt(fd, "description"),
    logic_summary: txt(fd, "logic_summary"),
    frequency: txt(fd, "frequency"),
    severity,
    owner_user_id: txt(fd, "owner_user_id"),
    updated_by: ctx.userId,
  };
  const { error } = id
    ? await supabase.from("ccm_rules").update(fields).eq("id", id).eq("organization_id", ctx.org.id)
    : await supabase.from("ccm_rules").insert({ ...fields, organization_id: ctx.org.id, status: "draft", created_by: ctx.userId });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, id ? "Rule updated." : "Rule created as draft.");
}

export async function setRuleStatusAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.rule.edit", "/dashboard/ccm/rules");
  const id = txt(fd, "id");
  const to = txt(fd, "to");
  const from = txt(fd, "from");
  if (!id || !to || !from) fail(returnTo, "Missing rule or target status.");
  if (!canTransition(RULE_TRANSITIONS, from, to)) fail(returnTo, `Cannot move a rule from ${from} to ${to}.`);
  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_rules")
    .update({ status: to, updated_by: ctx.userId })
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .eq("status", from);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, `Rule ${to}.`);
}

// --------------------------------------------------------------------------
// Exceptions
// --------------------------------------------------------------------------
export async function recordExceptionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.exception.write", "/dashboard/ccm/exceptions");
  const severity = sev(fd);
  if (severity === "invalid") fail(returnTo, "Severity must be low, medium, high or critical.");
  const description = txt(fd, "description");
  const source = txt(fd, "source_record_ref");
  if (!description || !source) fail(returnTo, "Source reference and description are required.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ccm_exceptions")
    .insert({
      organization_id: ctx.org.id,
      reporting_period_id: txt(fd, "reporting_period_id"),
      rule_id: txt(fd, "rule_id"),
      control_id: txt(fd, "control_id"),
      source_record_ref: source,
      description,
      severity,
      amount: num(fd, "amount"),
      detected_at: txt(fd, "detected_at") ?? new Date().toISOString(),
      assigned_to: txt(fd, "assigned_to"),
      status: "open",
      source_type: "manual",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`/dashboard/ccm/exceptions/${data.id}`, { period: txt(fd, "reporting_period_id") ?? undefined, notice: "Exception recorded." }));
}

export async function assignExceptionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.exception.write", "/dashboard/ccm/exceptions");
  const id = txt(fd, "id");
  const assignee = txt(fd, "assigned_to");
  if (!id || !assignee) fail(returnTo, "Choose an owner.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_exceptions")
    .update({ assigned_to: assignee, updated_by: ctx.userId })
    .eq("id", id)
    .eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Owner assigned.");
}

export async function transitionExceptionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.exception.write", "/dashboard/ccm/exceptions");
  const id = txt(fd, "id");
  const from = txt(fd, "from");
  const to = txt(fd, "to");
  if (!id || !from || !to) fail(returnTo, "Missing exception or target status.");
  if (!canTransition(EXCEPTION_TRANSITIONS, from, to)) fail(returnTo, `Cannot move an exception from ${from} to ${to}.`);

  const patch: Record<string, unknown> = { status: to, updated_by: ctx.userId };
  const notes = txt(fd, "investigation_notes");
  if (notes) patch.investigation_notes = notes;
  if (to === "false_positive") {
    const reason = txt(fd, "false_positive_reason");
    if (!reason || reason.length < 10) fail(returnTo, "A false-positive rationale (at least 10 characters) is mandatory.");
    patch.false_positive_reason = reason;
  }
  if (to === "linked") {
    const formal = txt(fd, "linked_exception_id");
    const def = txt(fd, "linked_deficiency_id");
    if (!formal && !def) fail(returnTo, "Choose a formal exception or a deficiency to link, or create a deficiency referral.");
    if (formal) patch.linked_exception_id = formal;
    if (def) patch.linked_deficiency_id = def;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_exceptions")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .eq("status", from);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, `Exception moved to ${to.replace(/_/g, " ")}.`);
}

export async function saveInvestigationNotesAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.exception.write", "/dashboard/ccm/exceptions");
  const id = txt(fd, "id");
  const notes = txt(fd, "investigation_notes");
  if (!id || !notes) fail(returnTo, "Enter investigation notes.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ccm_exceptions")
    .update({ investigation_notes: notes, updated_by: ctx.userId })
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .eq("status", "in_investigation");
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Investigation notes saved.");
}

/** Create a new deficiency referral from an exception and link it in one step. */
export async function referToDeficiencyAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.exception.write", "/dashboard/ccm/exceptions");
  const id = txt(fd, "id");
  const title = txt(fd, "title");
  if (!id || !title) fail(returnTo, "A deficiency title is required.");
  const supabase = await createClient();
  const { data: exc, error: e1 } = await supabase
    .from("ccm_exceptions")
    .select("id, status, control_id, severity, description, assigned_to")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();
  if (e1 || !exc) fail(returnTo, "Exception not found.");
  if (exc.status !== "in_investigation") fail(returnTo, "Start the investigation before referring to a deficiency.");

  const { data: def, error: e2 } = await supabase
    .from("deficiencies")
    .insert({
      organization_id: ctx.org.id,
      control_id: exc.control_id,
      title,
      description: txt(fd, "description") ?? exc.description,
      severity: exc.severity === "critical" ? "high" : exc.severity ?? "medium",
    })
    .select("id")
    .single();
  if (e2) fail(returnTo, friendly(e2.message));

  const { error: e3 } = await supabase
    .from("ccm_exceptions")
    .update({ status: "linked", linked_deficiency_id: def.id, updated_by: ctx.userId })
    .eq("id", id)
    .eq("organization_id", ctx.org.id);
  if (e3) fail(returnTo, friendly(e3.message));
  done(returnTo, "Deficiency referral created and linked.");
}

// --------------------------------------------------------------------------
// Follow-ups
// --------------------------------------------------------------------------
export async function addFollowUpAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.followup.write", "/dashboard/ccm/follow-ups");
  const description = txt(fd, "description");
  const due = txt(fd, "due_date");
  const owner = txt(fd, "owner_user_id");
  if (!description || !due || !owner) fail(returnTo, "Description, owner and due date are required.");
  const supabase = await createClient();
  const { error } = await supabase.from("follow_ups").insert({
    organization_id: ctx.org.id,
    ccm_exception_id: txt(fd, "ccm_exception_id"),
    readiness_gap_id: txt(fd, "readiness_gap_id"),
    deficiency_id: txt(fd, "deficiency_id"),
    description,
    owner_user_id: owner,
    due_date: due,
    status: "open",
    created_by: ctx.userId,
  });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Follow-up created.");
}

export async function setFollowUpStatusAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.followup.write", "/dashboard/ccm/follow-ups");
  const id = txt(fd, "id");
  const to = txt(fd, "to");
  if (!id || !to || !["open", "in_progress", "closed"].includes(to)) fail(returnTo, "Invalid follow-up status.");
  const supabase = await createClient();
  const { error } = await supabase.from("follow_ups").update({ status: to }).eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Follow-up updated.");
}

export async function escalationAction(fd: FormData) {
  const to = txt(fd, "to");
  const cap: Capability = to === "requested" ? "ccm.followup.write" : "ccm.escalation.approve";
  const { ctx, returnTo } = await gate(fd, cap, "/dashboard/ccm/follow-ups");
  const id = txt(fd, "id");
  if (!id || !to || !["requested", "approved", "rejected"].includes(to)) fail(returnTo, "Invalid escalation action.");
  const supabase = await createClient();
  const { error } = await supabase.from("follow_ups").update({ escalation_status: to }).eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, `Escalation ${to}.`);
}

// --------------------------------------------------------------------------
// CSV import (staged -> approved by a different person)
// --------------------------------------------------------------------------
export async function stageCcmImportAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.import.create", "/dashboard/ccm/import");
  const file = fd.get("file");
  const source = txt(fd, "source_system");
  const periodId = txt(fd, "reporting_period_id");
  if (!source) fail(returnTo, "Source system is required so imported data is labelled.");
  if (!(file instanceof File) || file.size === 0) fail(returnTo, "Choose a CSV file.");
  if (file.size > 2_000_000) fail(returnTo, "File too large (2 MB maximum).");

  const supabase = await createClient();
  const [{ data: rules }, { data: controls }] = await Promise.all([
    supabase.from("ccm_rules").select("id, rule_code").eq("organization_id", ctx.org.id).not("rule_code", "is", null),
    supabase.from("controls").select("id, code").eq("organization_id", ctx.org.id).not("code", "is", null),
  ]);
  const result = validateCsv(await file.text(), {
    rulesByCode: new Map((rules ?? []).map((r) => [String(r.rule_code).toLowerCase(), r.id as string])),
    controlsByCode: new Map((controls ?? []).map((c) => [String(c.code).toLowerCase(), c.id as string])),
  });
  if (result.rows.length === 0) {
    fail(returnTo, `Nothing to import. ${result.errors.slice(0, 3).map((e) => `Line ${e.line}: ${e.message}`).join(" | ")}`);
  }

  const { data, error } = await supabase
    .from("ccm_import_batches")
    .insert({
      organization_id: ctx.org.id,
      reporting_period_id: periodId,
      source_system: source,
      file_name: file.name,
      imported_by: ctx.userId,
      total_rows: result.totalRows,
      valid_rows: result.rows.length,
      invalid_rows: result.errors.length,
      validation_status: result.validationStatus,
      rows: result.rows,
      errors: result.errors,
    })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`/dashboard/ccm/import`, { period: periodId ?? undefined, notice: `Staged ${result.rows.length} valid row(s); awaiting approval.`, batch: data.id }));
}

export async function decideCcmImportAction(fd: FormData) {
  const { returnTo } = await gate(fd, "ccm.import.approve", "/dashboard/ccm/import");
  const id = txt(fd, "id");
  const approve = txt(fd, "decision") === "approve";
  if (!id) fail(returnTo, "Missing import batch.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_approve_ccm_batch", { p_batch: id, p_approve: approve });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, approve ? `Import approved: ${data} exception(s) created.` : "Import rejected.");
}

// --------------------------------------------------------------------------
// Approved summaries (the only thing external auditors / viewers can see)
// --------------------------------------------------------------------------
export async function createCcmSummaryAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.summary.prepare", "/dashboard/ccm");
  const periodId = txt(fd, "reporting_period_id");
  if (!periodId) fail(returnTo, "Select a reporting period first.");
  const supabase = await createClient();

  const [{ data: exc }, { data: rules }, { data: fus }] = await Promise.all([
    supabase.from("ccm_exceptions").select("status, severity, linked_deficiency_id").eq("organization_id", ctx.org.id).eq("reporting_period_id", periodId),
    supabase.from("ccm_rules").select("status").eq("organization_id", ctx.org.id),
    supabase.from("follow_ups").select("status, due_date, ccm_exceptions!inner(reporting_period_id)").eq("organization_id", ctx.org.id).eq("ccm_exceptions.reporting_period_id", periodId),
  ]);
  const count = <T,>(rows: T[] | null, f: (r: T) => string | null) => {
    const o: Record<string, number> = {};
    (rows ?? []).forEach((r) => { const k = f(r) ?? "unrated"; o[k] = (o[k] ?? 0) + 1; });
    return o;
  };
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = {
    generated_at: new Date().toISOString(),
    data_scope: "CCM exceptions, rules and follow-ups for the selected reporting period, as recorded in Benve Control at generation time.",
    exceptions_total: (exc ?? []).length,
    exceptions_by_status: count(exc, (e) => e.status),
    exceptions_by_severity: count(exc, (e) => e.severity),
    exceptions_linked_to_deficiency: (exc ?? []).filter((e) => e.linked_deficiency_id).length,
    rules_by_status: count(rules, (r) => r.status),
    follow_ups_total: (fus ?? []).length,
    follow_ups_open: (fus ?? []).filter((f) => f.status !== "closed").length,
    follow_ups_overdue: (fus ?? []).filter((f) => f.status !== "closed" && f.due_date && f.due_date < today).length,
  };
  const { error } = await supabase
    .from("ccm_summaries")
    .insert({ organization_id: ctx.org.id, reporting_period_id: periodId, snapshot, prepared_by: ctx.userId });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Summary snapshot created as draft.");
}

export async function transitionCcmSummaryAction(fd: FormData) {
  const to = txt(fd, "to");
  const cap: Capability = to && ["approved", "returned", "reopened"].includes(to) ? "ccm.summary.review" : "ccm.summary.prepare";
  const { ctx, returnTo } = await gate(fd, cap, "/dashboard/ccm");
  const id = txt(fd, "id");
  const from = txt(fd, "from");
  if (!id || !from || !to) fail(returnTo, "Missing summary or target status.");
  if (!canTransition(SUMMARY_TRANSITIONS, from, to)) fail(returnTo, `Cannot move a summary from ${from} to ${to}.`);
  const patch: Record<string, unknown> = { status: to };
  if (to === "returned" || to === "reopened") {
    const note = txt(fd, "review_note");
    if (!note || note.length < 5) fail(returnTo, "A review note is required.");
    patch.review_note = note;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("ccm_summaries").update(patch).eq("id", id).eq("organization_id", ctx.org.id).eq("status", from);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, `Summary ${to}.`);
}

// --------------------------------------------------------------------------
// Comments (internal vs shareable)
// --------------------------------------------------------------------------
export async function addCommentAction(fd: FormData) {
  const visibility = txt(fd, "visibility") === "shareable" ? "shareable" : "internal";
  const { ctx, returnTo } = await gate(fd, visibility === "shareable" ? "comment.shareable" : "comment.internal", "/dashboard/ccm");
  const body = txt(fd, "body");
  const targetType = txt(fd, "target_type");
  const targetId = txt(fd, "target_id");
  if (!body || !targetType || !targetId) fail(returnTo, "Comment text is required.");
  const supabase = await createClient();
  const { error } = await supabase.from("workpaper_comments").insert({
    organization_id: ctx.org.id,
    target_type: targetType,
    target_id: targetId,
    visibility,
    body,
  });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, visibility === "shareable" ? "Shareable note added." : "Internal note added.");
}
