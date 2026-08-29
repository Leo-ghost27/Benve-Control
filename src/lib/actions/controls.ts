"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { logChange } from "@/lib/supabase/audit";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export async function createControlAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to create a control.");
  }

  const supabase = await createClient();

  const isAiAssisted = str(formData, "ai_assisted") === "true";
  const aiEvidenceRequestDraft = str(formData, "ai_evidence_request_draft");
  const aiDesignStepsRaw = str(formData, "ai_design_steps");
  const aiEffectivenessStepsRaw = str(formData, "ai_effectiveness_steps");

  const record = {
    organization_id: ctx.org.id,
    code: str(formData, "code") ?? "",
    title: str(formData, "title") ?? "",
    description: str(formData, "description"),
    framework: str(formData, "framework"),
    business_model: str(formData, "business_model"),
    process: str(formData, "process"),
    risk_statement: str(formData, "risk_statement"),
    control_objective: str(formData, "control_objective"),
    assertion: str(formData, "assertion"),
    risk_rating: str(formData, "risk_rating")?.toLowerCase() ?? null,
    frequency: str(formData, "frequency"),
    control_owner: str(formData, "control_owner"),
    control_type: str(formData, "control_type")?.toLowerCase().replace(/ /g, "_") ?? null,
    automation_level: str(formData, "automation_level")?.toLowerCase().replace(/[ -]/g, "_") ?? null,
    status: str(formData, "status")?.toLowerCase().replace(/ /g, "_") ?? "draft",
    ai_assisted: isAiAssisted,
    ai_evidence_request_draft: isAiAssisted ? aiEvidenceRequestDraft : null,
    ai_assisted_at: isAiAssisted ? new Date().toISOString() : null,
  };

  if (!record.code || !record.title) {
    throw new Error("Control ID and control name are required.");
  }

  const { data, error } = await supabase
    .from("controls")
    .insert(record)
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (isAiAssisted) {
    // Auditor accepted the AI draft: log the specific audit entry the
    // guardrails require, then create the working Test of Design and
    // Test of Effectiveness plans from the draft steps so there's an
    // actual working version to review, not just text.
    await logChange({
      supabase,
      organizationId: ctx.org.id,
      actorId: ctx.userId,
      action: "ai_assist_accepted",
      entityType: "control",
      entityId: data.id,
      metadata: { code: record.code, actor_email: ctx.userEmail },
    });

    const designSteps: string[] = aiDesignStepsRaw ? JSON.parse(aiDesignStepsRaw) : [];
    const effectivenessSteps: string[] = aiEffectivenessStepsRaw
      ? JSON.parse(aiEffectivenessStepsRaw)
      : [];

    const planDefs = [
      { name: `${record.title}: Test of Design`, test_type: "test_of_design", steps: designSteps },
      {
        name: `${record.title}: Test of Effectiveness`,
        test_type: "test_of_effectiveness",
        steps: effectivenessSteps,
      },
    ];

    for (const planDef of planDefs) {
      if (planDef.steps.length === 0) continue;

      const { data: plan, error: planError } = await supabase
        .from("test_plans")
        .insert({
          organization_id: ctx.org.id,
          control_id: data.id,
          name: planDef.name,
          test_type: planDef.test_type,
          status: "not_started",
        })
        .select("id")
        .single();

      if (planError) throw new Error(planError.message);

      await logChange({
        supabase,
        organizationId: ctx.org.id,
        actorId: ctx.userId,
        action: "created",
        entityType: "test_plan",
        entityId: plan.id,
        metadata: { source: "ai_assist" },
      });

      const stepRows = planDef.steps.map((description, i) => ({
        organization_id: ctx.org!.id,
        test_plan_id: plan.id,
        step_number: i + 1,
        description,
        status: "not_started",
      }));

      const { error: stepsError } = await supabase.from("test_steps").insert(stepRows);
      if (stepsError) throw new Error(stepsError.message);
    }
  } else {
    await logChange({
      supabase,
      organizationId: ctx.org.id,
      actorId: ctx.userId,
      action: "created",
      entityType: "control",
      entityId: data.id,
      metadata: { code: record.code, title: record.title },
    });
  }

  revalidatePath("/dashboard/controls");
  redirect(`/dashboard/controls/${data.id}`);
}

export async function updateControlStatusAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to update a control.");
  }

  const controlId = String(formData.get("controlId"));
  const status = String(formData.get("status")).toLowerCase().replace(/ /g, "_");

  const supabase = await createClient();
  const { error } = await supabase
    .from("controls")
    .update({ status })
    .eq("id", controlId)
    .eq("organization_id", ctx.org.id);

  if (error) {
    throw new Error(error.message);
  }

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "status_changed",
    entityType: "control",
    entityId: controlId,
    metadata: { status },
  });

  revalidatePath(`/dashboard/controls/${controlId}`);
}
