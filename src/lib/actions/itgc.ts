"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withParams } from "@/lib/phase2/context";
import { done, fail, friendly, gate, txt } from "@/lib/phase2/action-utils";
import { CATEGORIES, CRITICALITY, DEPENDENCY_TYPES, FREQUENCIES, RELEVANCE, STEP_TEMPLATES } from "@/lib/phase2/itgc";

/**
 * ITGC actions. Capability checks give friendly errors; the database (RLS, triggers and the
 * hash-bound workflow functions) is authoritative. Nothing here marks a configuration or
 * control as validated: conclusions are entered by a preparer and approved by a different
 * authorised user against the exact version they reviewed.
 */
const BASE = "/dashboard/itgc";

function list(fd: FormData, key: string): string[] | null {
  const v = fd.getAll(key).map((x) => String(x).trim()).filter(Boolean);
  return v.length ? v : null;
}

// --------------------------------------------------------------------------
// Systems
// --------------------------------------------------------------------------
export async function saveSystemAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.manage", `${BASE}/systems`);
  const id = txt(fd, "id");
  const name = txt(fd, "name");
  if (!name) fail(returnTo, "System name is required.");
  const relevance = txt(fd, "financial_reporting_relevance");
  const criticality = txt(fd, "criticality");
  if (relevance && !RELEVANCE.includes(relevance)) fail(returnTo, "Invalid financial-reporting relevance.");
  if (criticality && !CRITICALITY.includes(criticality)) fail(returnTo, "Invalid criticality.");
  const status = txt(fd, "status") ?? "in_progress";
  if (!["in_progress", "complete", "inactive"].includes(status)) fail(returnTo, "Invalid status.");
  const fields = {
    name,
    system_type: txt(fd, "system_type"),
    description: txt(fd, "description"),
    system_owner_user_id: txt(fd, "system_owner_user_id"),
    financial_reporting_relevance: relevance,
    criticality,
    in_scope: fd.get("in_scope") === "on",
    status,
  };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("itgc_systems").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "System updated.");
  }
  const { data, error } = await supabase.from("itgc_systems").insert({ ...fields, organization_id: ctx.org.id }).select("id").single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${BASE}/systems/${data.id}`, { notice: "System created." }));
}

export async function addDependencyAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.manage", `${BASE}/systems`);
  const controlId = txt(fd, "control_id");
  const systemId = txt(fd, "system_id");
  const type = txt(fd, "dependency_type") ?? "application_data";
  if (!controlId || !systemId) fail(returnTo, "Choose a financial control.");
  if (!DEPENDENCY_TYPES.includes(type)) fail(returnTo, "Invalid dependency type.");
  const supabase = await createClient();
  const { error } = await supabase.from("control_system_dependencies").insert({ organization_id: ctx.org.id, control_id: controlId, system_id: systemId, dependency_type: type, notes: txt(fd, "notes") });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Dependency recorded.");
}

export async function removeDependencyAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.manage", `${BASE}/systems`);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing dependency.");
  const supabase = await createClient();
  const { error } = await supabase.from("control_system_dependencies").delete().eq("id", id).eq("organization_id", ctx.org.id);
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Dependency removed.");
}

// --------------------------------------------------------------------------
// ITGC controls
// --------------------------------------------------------------------------
export async function saveItgcControlAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.manage", `${BASE}/controls`);
  const id = txt(fd, "id");
  const ref = txt(fd, "control_ref");
  const category = txt(fd, "category");
  if (!ref || !category) fail(returnTo, "Control reference and category are required.");
  if (!(CATEGORIES as readonly string[]).includes(category)) fail(returnTo, "Category must be access, change or operations.");
  const frequency = txt(fd, "frequency");
  if (frequency && !FREQUENCIES.includes(frequency)) fail(returnTo, "Invalid frequency.");
  const sample = txt(fd, "sample_size");
  const fields = {
    system_id: txt(fd, "system_id"),
    control_id: txt(fd, "control_id"),
    control_ref: ref,
    category,
    description: txt(fd, "description"),
    risk: txt(fd, "risk"),
    test_approach: txt(fd, "test_approach"),
    sample_size: sample ? Math.max(0, parseInt(sample, 10) || 0) : null,
    frequency,
    assertions: list(fd, "assertions"),
    owner_user_id: txt(fd, "owner_user_id"),
    evidence_id: txt(fd, "evidence_id"),
    status: txt(fd, "status") ?? "active",
  };
  if (!["active", "inactive"].includes(fields.status)) fail(returnTo, "Invalid status.");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("itgc_controls").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "ITGC updated.");
  }
  const { data, error } = await supabase.from("itgc_controls").insert({ ...fields, organization_id: ctx.org.id }).select("id").single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${BASE}/controls/${data.id}`, { notice: "ITGC created." }));
}

/**
 * Create the test plan for an ITGC / automated control in the EXISTING Phase 1 engine
 * (test_plans + test_steps) on the financial control it is mapped to, seed starter
 * steps, and link the plan back. Results, evidence and conclusions are then recorded
 * on the normal test-plan page.
 */
export async function createItgcTestPlanAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.test.create", `${BASE}/controls`);
  const kind = txt(fd, "kind") === "automated" ? "automated" : "itgc";
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing control.");
  const supabase = await createClient();

  const table = kind === "automated" ? "automated_controls" : "itgc_controls";
  const { data: ctl, error: cerr } = await supabase
    .from(table)
    .select(kind === "automated" ? "id, control_ref, description, testing_approach, test_plan_id, linked_sox_control_id, system_id" : "id, control_ref, category, description, test_approach, sample_size, test_plan_id, control_id, system_id")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .single();
  if (cerr || !ctl) fail(returnTo, "Control not found.");
  const c = ctl as any;
  if (c.test_plan_id) fail(returnTo, "This control already has a test plan.");
  const financialControl = kind === "automated" ? c.linked_sox_control_id : c.control_id;
  if (!financialControl) fail(returnTo, "Map this control to a financial control first: the testing engine plans tests per financial control.");

  const { data: plan, error: perr } = await supabase
    .from("test_plans")
    .insert({
      organization_id: ctx.org.id,
      control_id: financialControl,
      name: `${kind === "automated" ? "Automated control" : "ITGC"} ${c.control_ref ?? ""} test plan`.trim(),
      description: c.description ?? null,
      test_type: txt(fd, "test_type") ?? "test_of_effectiveness",
      sampling_approach: kind === "automated" ? c.testing_approach ?? null : c.test_approach ?? null,
      sample_size: kind === "automated" ? null : c.sample_size ?? null,
    })
    .select("id")
    .single();
  if (perr) fail(returnTo, friendly(perr.message));

  const templates = STEP_TEMPLATES[kind === "automated" ? "automated" : c.category] ?? STEP_TEMPLATES.access;
  const { error: serr } = await supabase.from("test_steps").insert(
    templates.map((description, i) => ({ organization_id: ctx.org.id, test_plan_id: plan.id, step_number: i + 1, description }))
  );
  if (serr) fail(returnTo, friendly(serr.message));

  const { error: lerr } = await supabase.from(table).update({ test_plan_id: plan.id }).eq("id", id).eq("organization_id", ctx.org.id);
  if (lerr) fail(returnTo, friendly(lerr.message));
  done(returnTo, "Test plan created in the testing engine with starter steps. Perform and evidence the steps on the test-plan page.");
}

// --------------------------------------------------------------------------
// Automated controls and configuration conclusions
// --------------------------------------------------------------------------
export async function saveAutomatedControlAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.manage", `${BASE}/automated-controls`);
  const id = txt(fd, "id");
  const ref = txt(fd, "control_ref");
  if (!ref) fail(returnTo, "Control code is required.");
  const frequency = txt(fd, "frequency");
  if (frequency && !FREQUENCIES.includes(frequency)) fail(returnTo, "Invalid frequency.");
  const fields = {
    system_id: txt(fd, "system_id"),
    control_ref: ref,
    description: txt(fd, "description"),
    financial_assertions: list(fd, "financial_assertions"),
    linked_sox_control_id: txt(fd, "linked_sox_control_id"),
    frequency,
    testing_approach: txt(fd, "testing_approach"),
    change_dependency: txt(fd, "change_dependency"),
    depends_on_itgc_id: txt(fd, "depends_on_itgc_id"),
    owner_user_id: txt(fd, "owner_user_id"),
    status: txt(fd, "status") ?? "active",
  };
  if (!["active", "inactive"].includes(fields.status)) fail(returnTo, "Invalid status.");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("automated_controls").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "Automated control updated.");
  }
  const { data, error } = await supabase.from("automated_controls").insert({ ...fields, organization_id: ctx.org.id }).select("id").single();
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${BASE}/automated-controls/${data.id}`, { notice: "Automated control created." }));
}

export async function saveConfigurationAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "itgc.config.prepare", `${BASE}/automated-controls`);
  const id = txt(fd, "id");
  const acId = txt(fd, "automated_control_id");
  const fields = { configuration_summary: txt(fd, "configuration_summary"), configuration_evidence_id: txt(fd, "configuration_evidence_id"), conclusion: txt(fd, "conclusion") };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("automated_control_configurations").update(fields).eq("id", id).eq("organization_id", ctx.org.id);
    if (error) fail(returnTo, friendly(error.message));
    done(returnTo, "Configuration draft saved.");
  }
  if (!acId) fail(returnTo, "Missing automated control.");
  const { error } = await supabase.from("automated_control_configurations").insert({ ...fields, organization_id: ctx.org.id, automated_control_id: acId });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "New configuration version started as a draft.");
}

export async function submitConfigurationAction(fd: FormData) {
  const { returnTo } = await gate(fd, "itgc.config.prepare", `${BASE}/automated-controls`);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing configuration.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_submit_config", { p_config: id });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Submitted for review. The reviewer approves this exact version.");
}

export async function decideConfigurationAction(fd: FormData) {
  const { returnTo } = await gate(fd, "itgc.config.review", `${BASE}/automated-controls`);
  const id = txt(fd, "id");
  const decision = txt(fd, "decision");
  const hash = txt(fd, "expected_hash");
  if (!id || !decision || !hash) fail(returnTo, "Missing configuration, decision or version.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_decide_config", { p_config: id, p_decision: decision, p_comment: txt(fd, "comment") ?? "", p_expected_hash: hash });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, decision === "approved" ? "Configuration conclusion approved." : "Configuration returned to the preparer.");
}

// --------------------------------------------------------------------------
// Exceptions (routed from the testing engine)
// --------------------------------------------------------------------------
export async function reviewItgcExceptionAction(fd: FormData) {
  const action = txt(fd, "action");
  const { returnTo } = await gate(fd, action === "clear" ? "itgc.exception.decide" : "itgc.exception.start", `${BASE}/exceptions`);
  const id = txt(fd, "id");
  if (!id || !action) fail(returnTo, "Missing exception or action.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_itgc_review_exception", { p_exception: id, p_action: action, p_note: txt(fd, "note") ?? "" });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, action === "start_review" ? "Exception taken into review." : "Exception cleared with rationale.");
}

export async function raiseItgcDeficiencyAction(fd: FormData) {
  const { returnTo } = await gate(fd, "itgc.exception.decide", `${BASE}/exceptions`);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing exception.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_itgc_raise_deficiency", {
    p_exception: id,
    p_title: txt(fd, "title") ?? "",
    p_severity: txt(fd, "severity") ?? "medium",
    p_description: txt(fd, "description") ?? "",
  });
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`/dashboard/deficiencies/${data}`, { notice: "Deficiency raised from the ITGC exception." }));
}
