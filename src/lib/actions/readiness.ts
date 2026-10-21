"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { done, fail, friendly, gate, num, txt } from "@/lib/phase2/action-utils";
import type { Capability } from "@/lib/phase2/permissions";
import { canTransition, WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";

/**
 * Readiness actions. Capability is checked here for friendly errors; the
 * database (RLS + p2_approval_guard + p2_readiness_required) is authoritative.
 * The readiness score is a management planning assessment, never a
 * regulatory determination.
 */
const BASE = "/dashboard/readiness";
const MATURITY = ["initial", "developing", "defined", "managed", "optimized"];
const FILER = ["pre_ipo", "emerging_growth", "non_accelerated", "accelerated", "large_accelerated", "other"];

function score(fd: FormData, key: string, returnTo: string): number | null {
  const v = num(fd, key);
  if (v !== null && (v < 0 || v > 100)) fail(returnTo, "Scores must be between 0 and 100.");
  return v;
}

// --------------------------------------------------------------------------
// Assessments
// --------------------------------------------------------------------------
export async function createAssessmentAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", BASE);
  const periodId = txt(fd, "reporting_period_id");
  const milestone = txt(fd, "target_milestone");
  if (!periodId || !milestone) fail(returnTo, "Reporting period and target milestone are required.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("readiness_assessments")
    .insert({
      organization_id: ctx.org.id,
      reporting_period_id: periodId,
      target_milestone: milestone,
      target_date: txt(fd, "target_date"),
      current_filer_status: txt(fd, "current_filer_status"),
      prepared_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(BASE, { period: periodId, assessment: data.id, notice: "Assessment created as draft." }));
}

export async function saveAssessmentAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", BASE);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing assessment.");
  const maturity = txt(fd, "maturity_level");
  const filer = txt(fd, "current_filer_status");
  if (maturity && !MATURITY.includes(maturity)) fail(returnTo, "Invalid maturity level.");
  if (filer && !FILER.includes(filer)) fail(returnTo, "Invalid filer status.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("readiness_assessments")
    .update({
      target_milestone: txt(fd, "target_milestone"),
      target_date: txt(fd, "target_date"),
      current_filer_status: filer,
      maturity_level: maturity,
      overall_score: score(fd, "overall_score", returnTo),
      management_conclusion: txt(fd, "management_conclusion"),
      assumptions: txt(fd, "assumptions"),
      timeline_risks: txt(fd, "timeline_risks"),
    })
    .eq("id", id)
    .eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Assessment saved.");
}

async function transition(fd: FormData, table: "readiness_assessments" | "readiness_gaps", label: string) {
  const to = txt(fd, "to");
  const cap: Capability = to && ["approved", "returned", "reopened"].includes(to) ? "readiness.review" : "readiness.prepare";
  const { ctx, returnTo } = await gate(fd, cap, BASE);
  const id = txt(fd, "id");
  const from = txt(fd, "from");
  if (!id || !from || !to) fail(returnTo, "Missing record or target status.");
  if (!canTransition(WORKFLOW_TRANSITIONS, from, to)) fail(returnTo, `Cannot move a ${label} from ${from} to ${to}.`);
  const patch: Record<string, unknown> = { status: to };
  if (to === "returned" || to === "reopened") {
    const note = txt(fd, "review_note");
    if (!note || note.length < 5) fail(returnTo, "A review note (at least 5 characters) is required.");
    patch.review_note = note;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table).update(patch).eq("id", id).eq("organization_id", ctx.org.id).eq("status", from).select("id");
  if (error) fail(returnTo, friendly(error.message));
  if (!data || data.length === 0) fail(returnTo, "That record changed since you opened it. Refresh and try again.");
  done(returnTo, `${label[0].toUpperCase()}${label.slice(1)} moved to ${to}.`);
}

export async function transitionAssessmentAction(fd: FormData) {
  await transition(fd, "readiness_assessments", "assessment");
}
export async function transitionGapAction(fd: FormData) {
  await transition(fd, "readiness_gaps", "gap");
}

// --------------------------------------------------------------------------
// Areas (manual scoring)
// --------------------------------------------------------------------------
export async function saveAreaAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", BASE);
  const id = txt(fd, "id");
  const name = txt(fd, "area_name");
  if (!name) fail(returnTo, "Area name is required.");
  const fields = {
    area_name: name,
    current_maturity: txt(fd, "current_maturity"),
    target_maturity: txt(fd, "target_maturity"),
    readiness_score: score(fd, "readiness_score", returnTo),
    score_rationale: txt(fd, "score_rationale"),
    owner_user_id: txt(fd, "owner_user_id"),
    status: txt(fd, "status") ?? "in_progress",
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("readiness_areas").update(fields).eq("id", id).eq("organization_id", ctx.org.id)
    : await supabase.from("readiness_areas").insert({ ...fields, organization_id: ctx.org.id, assessment_id: txt(fd, "assessment_id"), created_by: ctx.userId });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, id ? "Area updated." : "Area added.");
}

export async function deleteAreaAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", BASE);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing area.");
  const supabase = await createClient();
  const { error } = await supabase.from("readiness_areas").delete().eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Area removed.");
}

// --------------------------------------------------------------------------
// Checklist
// --------------------------------------------------------------------------
export async function addChecklistItemAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", `${BASE}/checklist`);
  const item = txt(fd, "item");
  const assessmentId = txt(fd, "assessment_id");
  if (!item || !assessmentId) fail(returnTo, "Assessment and checklist item are required.");
  const supabase = await createClient();
  const { error } = await supabase.from("readiness_checklist_items").insert({
    organization_id: ctx.org.id,
    assessment_id: assessmentId,
    area_id: txt(fd, "area_id"),
    item,
    requirement_ref: txt(fd, "requirement_ref"),
    evidence_id: txt(fd, "evidence_id"),
    owner_user_id: txt(fd, "owner_user_id"),
    notes: txt(fd, "notes"),
    created_by: ctx.userId,
  });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Checklist item added.");
}

export async function updateChecklistItemAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", `${BASE}/checklist`);
  const id = txt(fd, "id");
  const status = txt(fd, "status");
  if (!id) fail(returnTo, "Missing checklist item.");
  if (status && !["not_started", "in_progress", "complete", "not_applicable"].includes(status)) fail(returnTo, "Invalid status.");
  const patch: Record<string, unknown> = {};
  if (status) patch.status = status;
  if (fd.has("evidence_id")) patch.evidence_id = txt(fd, "evidence_id");
  if (fd.has("notes")) patch.notes = txt(fd, "notes");
  const supabase = await createClient();
  const { error } = await supabase.from("readiness_checklist_items").update(patch).eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Checklist item updated.");
}

// --------------------------------------------------------------------------
// Gaps
// --------------------------------------------------------------------------
export async function saveGapAction(fd: FormData) {
  const id = txt(fd, "id");
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", `${BASE}/gaps`);
  const severity = txt(fd, "gap_severity");
  if (severity && !["high", "medium", "low"].includes(severity)) fail(returnTo, "Severity must be high, medium or low.");
  const fields = {
    area_id: txt(fd, "area_id"),
    requirement: txt(fd, "requirement"),
    description: txt(fd, "description"),
    gap_severity: severity,
    owner_user_id: txt(fd, "owner_user_id"),
    target_date: txt(fd, "target_date"),
    evidence_id: txt(fd, "evidence_id"),
    related_control_id: txt(fd, "related_control_id"),
    related_deficiency_id: txt(fd, "related_deficiency_id"),
    remediation_action: txt(fd, "remediation_action"),
  };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("readiness_gaps").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "Gap saved.");
  }
  const assessmentId = txt(fd, "readiness_assessment_id");
  if (!assessmentId || !fields.description) fail(returnTo, "Assessment and description are required.");
  const { data, error } = await supabase
    .from("readiness_gaps")
    .insert({ ...fields, organization_id: ctx.org.id, readiness_assessment_id: assessmentId, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${BASE}/gaps/${data.id}`, { notice: "Gap created as draft." }));
}

// --------------------------------------------------------------------------
// Roadmap
// --------------------------------------------------------------------------
export async function addRoadmapActionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", `${BASE}/roadmap`);
  const description = txt(fd, "description");
  const gapId = txt(fd, "gap_id");
  if (!description || !gapId) fail(returnTo, "A gap and an action description are required.");
  const priority = txt(fd, "priority");
  if (priority && !["high", "medium", "low"].includes(priority)) fail(returnTo, "Invalid priority.");
  const supabase = await createClient();
  const { error } = await supabase.from("readiness_roadmap_actions").insert({
    organization_id: ctx.org.id,
    gap_id: gapId,
    action_ref: txt(fd, "action_ref"),
    description,
    owner_user_id: txt(fd, "owner_user_id"),
    target_date: txt(fd, "target_date"),
    priority,
    status: "not_started",
    created_by: ctx.userId,
  });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Roadmap action added.");
}

export async function setRoadmapStatusAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "readiness.prepare", `${BASE}/roadmap`);
  const id = txt(fd, "id");
  const to = txt(fd, "to");
  if (!id || !to || !["not_started", "in_progress", "complete"].includes(to)) fail(returnTo, "Invalid roadmap status.");
  const supabase = await createClient();
  const { error } = await supabase.from("readiness_roadmap_actions").update({ status: to }).eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Roadmap action updated.");
}
