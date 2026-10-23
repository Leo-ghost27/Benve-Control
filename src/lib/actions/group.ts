"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { done, fail, friendly, gate, txt } from "@/lib/phase2/action-utils";
import type { Capability } from "@/lib/phase2/permissions";
import { canTransition, WORKFLOW_TRANSITIONS } from "@/lib/phase2/workflow";
import { GROUP_OUTCOMES, STANDARD_QUESTIONS } from "@/lib/phase2/questionnaire";

/**
 * Group ICFR actions. The database enforces who may do what (RLS + triggers,
 * including "only the entity's local owner or internal audit may prepare a
 * questionnaire"); capability checks here only give friendlier messages.
 */
const ENTITIES = "/dashboard/entities";
const QUESTIONNAIRES = "/dashboard/subsidiary-questionnaires";
const GROUP = "/dashboard/group-icfr";
const CONSOLIDATION = ["full", "proportional", "equity_method", "not_consolidated"];

// --------------------------------------------------------------------------
// Entities
// --------------------------------------------------------------------------
export async function saveEntityAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "entity.manage", ENTITIES);
  const id = txt(fd, "id");
  const name = txt(fd, "name");
  if (!name) fail(returnTo, "Display name is required.");
  const consolidation = txt(fd, "consolidation_method");
  if (consolidation && !CONSOLIDATION.includes(consolidation)) fail(returnTo, "Invalid consolidation method.");
  const status = txt(fd, "status") ?? "in_progress";
  if (!["in_progress", "complete", "inactive"].includes(status)) fail(returnTo, "Invalid status.");
  const isParent = fd.get("is_parent") === "on";
  const fields = {
    name,
    legal_name: txt(fd, "legal_name"),
    jurisdiction: txt(fd, "jurisdiction"),
    functional_scope: txt(fd, "functional_scope"),
    parent_entity_id: isParent ? null : txt(fd, "parent_entity_id"),
    is_parent: isParent,
    in_scope: fd.get("in_scope") === "on",
    consolidation_method: consolidation,
    local_owner_user_id: txt(fd, "local_owner_user_id"),
    status,
  };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("entities").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "Entity updated.");
  }
  const { data, error } = await supabase.from("entities").insert({ ...fields, organization_id: ctx.org.id }).select("id").single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${ENTITIES}/${data.id}`, { notice: "Entity created." }));
}

export async function assignProcessAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "entity.manage", ENTITIES);
  const entityId = txt(fd, "entity_id");
  const processId = txt(fd, "process_id");
  if (!entityId || !processId) fail(returnTo, "Choose a process.");
  const supabase = await createClient();
  const { error } = await supabase.from("entity_processes").upsert(
    { organization_id: ctx.org.id, entity_id: entityId, process_id: processId, in_scope: fd.get("in_scope") !== "off", notes: txt(fd, "notes") },
    { onConflict: "entity_id,process_id" }
  );
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Process assignment saved.");
}

export async function removeAssignmentAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "entity.manage", ENTITIES);
  const id = txt(fd, "id");
  const table = txt(fd, "table");
  if (!id || !table || !["entity_processes", "entity_controls"].includes(table)) fail(returnTo, "Invalid assignment.");
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Assignment removed.");
}

export async function assignControlAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "entity.manage", ENTITIES);
  const entityId = txt(fd, "entity_id");
  const controlId = txt(fd, "control_id");
  const reliance = txt(fd, "reliance_type") ?? "entity_level";
  if (!entityId || !controlId) fail(returnTo, "Choose a control.");
  if (!["entity_level", "group_level", "shared_service"].includes(reliance)) fail(returnTo, "Invalid reliance type.");
  const supabase = await createClient();
  const { error } = await supabase.from("entity_controls").upsert(
    { organization_id: ctx.org.id, entity_id: entityId, control_id: controlId, reliance_type: reliance, local_owner_user_id: txt(fd, "local_owner_user_id"), status: "active" },
    { onConflict: "entity_id,control_id" }
  );
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Control assignment saved.");
}

// --------------------------------------------------------------------------
// Questionnaires
// --------------------------------------------------------------------------
export async function createQuestionnaireAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "questionnaire.prepare", QUESTIONNAIRES);
  const entityId = txt(fd, "entity_id");
  const periodId = txt(fd, "reporting_period_id");
  if (!entityId || !periodId) fail(returnTo, "Choose an entity and reporting period.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subsidiary_questionnaires")
    .insert({ organization_id: ctx.org.id, entity_id: entityId, reporting_period_id: periodId, prepared_by: ctx.userId })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  const { error: qerr } = await supabase.from("subsidiary_questionnaire_responses").insert(
    STANDARD_QUESTIONS.map((question, i) => ({ organization_id: ctx.org.id, questionnaire_id: data.id, question, sort_order: i }))
  );
  if (qerr) fail(withParams(`${QUESTIONNAIRES}/${data.id}`, { period: periodId }), friendly(qerr.message));
  redirect(withParams(`${QUESTIONNAIRES}/${data.id}`, { period: periodId, notice: "Questionnaire created with the standard questions." }));
}

export async function saveResponseAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "questionnaire.prepare", QUESTIONNAIRES);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing response.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("subsidiary_questionnaire_responses")
    .update({
      response: txt(fd, "response"),
      evidence_comments: txt(fd, "evidence_comments"),
      evidence_id: txt(fd, "evidence_id"),
      follow_up_required: fd.get("follow_up_required") === "on",
    })
    .eq("id", id)
    .eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Response saved.");
}

export async function addQuestionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "questionnaire.prepare", QUESTIONNAIRES);
  const qid = txt(fd, "questionnaire_id");
  const question = txt(fd, "question");
  if (!qid || !question) fail(returnTo, "Enter a question.");
  const supabase = await createClient();
  const { error } = await supabase.from("subsidiary_questionnaire_responses").insert({ organization_id: ctx.org.id, questionnaire_id: qid, question, sort_order: 100 });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Question added.");
}

export async function transitionQuestionnaireAction(fd: FormData) {
  const to = txt(fd, "to");
  const cap: Capability = to && ["approved", "returned", "reopened"].includes(to) ? "group.review" : "questionnaire.prepare";
  const { ctx, returnTo } = await gate(fd, cap, QUESTIONNAIRES);
  const id = txt(fd, "id");
  const from = txt(fd, "from");
  if (!id || !from || !to) fail(returnTo, "Missing questionnaire or target status.");
  if (!canTransition(WORKFLOW_TRANSITIONS, from, to)) fail(returnTo, `Cannot move a questionnaire from ${from} to ${to}.`);
  const patch: Record<string, unknown> = { status: to };
  if (to === "approved" || to === "returned") {
    const outcome = txt(fd, "outcome");
    const allowed: readonly string[] = GROUP_OUTCOMES[to];
    if (!outcome || !allowed.includes(outcome)) fail(returnTo, `Choose one of: ${allowed.join(", ").replace(/_/g, " ")}.`);
    patch.group_review_status = outcome;
  }
  if (to === "returned" || to === "reopened") {
    const note = txt(fd, "review_note");
    if (!note || note.length < 5) fail(returnTo, "A review note (at least 5 characters) is required.");
    patch.review_note = note;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("subsidiary_questionnaires").update(patch).eq("id", id).eq("organization_id", ctx.org.id).eq("status", from).select("id");
  if (error) fail(returnTo, friendly(error.message));
  if (!data || data.length === 0) fail(returnTo, "That questionnaire changed since you opened it. Refresh and try again.");
  done(returnTo, `Questionnaire moved to ${to}.`);
}

/** Raise a follow-up from a questionnaire and (optionally) attach it to the flagged answer. */
export async function createQuestionnaireFollowUpAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "ccm.followup.write", QUESTIONNAIRES);
  const qid = txt(fd, "questionnaire_id");
  const description = txt(fd, "description");
  const owner = txt(fd, "owner_user_id");
  const due = txt(fd, "due_date");
  if (!qid || !description || !owner || !due) fail(returnTo, "Description, owner and due date are required.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .insert({ organization_id: ctx.org.id, questionnaire_id: qid, description, owner_user_id: owner, due_date: due, status: "open", created_by: ctx.userId })
    .select("id")
    .single();
  if (error) fail(returnTo, friendly(error.message));
  const responseId = txt(fd, "response_id");
  if (responseId) {
    const { error: lerr } = await supabase.from("subsidiary_questionnaire_responses").update({ follow_up_id: data.id }).eq("id", responseId).eq("organization_id", ctx.org.id);
    if (lerr) fail(returnTo, friendly(lerr.message));
  }
  done(returnTo, "Follow-up created.");
}

// --------------------------------------------------------------------------
// Group summaries (approved snapshots are what external auditors see)
// --------------------------------------------------------------------------
export async function createGroupSummaryAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "group.summary.prepare", GROUP);
  const periodId = txt(fd, "reporting_period_id");
  if (!periodId) fail(returnTo, "Select a reporting period first.");
  const supabase = await createClient();
  const { data: rollup, error: rerr } = await supabase.rpc("p2_group_rollup", { p_org: ctx.org.id, p_period: periodId });
  if (rerr) fail(returnTo, friendly(rerr.message));
  const snapshot = {
    ...(rollup as Record<string, unknown>),
    data_scope: "Entities in scope for the period. Only the group parent and entities whose subsidiary questionnaire is approved contribute to totals; each control, deficiency, exception and test plan is counted once.",
  };
  const { error } = await supabase
    .from("group_icfr_summaries")
    .insert({ organization_id: ctx.org.id, reporting_period_id: periodId, snapshot, prepared_by: ctx.userId });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Roll-up snapshot created as draft.");
}

export async function saveGroupConclusionAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "group.summary.prepare", GROUP);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing summary.");
  const supabase = await createClient();
  const { error } = await supabase.from("group_icfr_summaries").update({ conclusion: txt(fd, "conclusion"), title: txt(fd, "title") ?? "Group ICFR roll-up" }).eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Conclusion saved.");
}

export async function transitionGroupSummaryAction(fd: FormData) {
  const to = txt(fd, "to");
  const cap: Capability = to && ["approved", "returned", "reopened"].includes(to) ? "group.review" : "group.summary.prepare";
  const { ctx, returnTo } = await gate(fd, cap, GROUP);
  const id = txt(fd, "id");
  const from = txt(fd, "from");
  if (!id || !from || !to) fail(returnTo, "Missing summary or target status.");
  if (!canTransition(WORKFLOW_TRANSITIONS, from, to)) fail(returnTo, `Cannot move a summary from ${from} to ${to}.`);
  const patch: Record<string, unknown> = { status: to };
  if (to === "returned" || to === "reopened") {
    const note = txt(fd, "review_note");
    if (!note || note.length < 5) fail(returnTo, "A review note (at least 5 characters) is required.");
    patch.review_note = note;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("group_icfr_summaries").update(patch).eq("id", id).eq("organization_id", ctx.org.id).eq("status", from).select("id");
  if (error) fail(returnTo, friendly(error.message));
  if (!data || data.length === 0) fail(returnTo, "That summary changed since you opened it. Refresh and try again.");
  done(returnTo, `Summary moved to ${to}.`);
}
