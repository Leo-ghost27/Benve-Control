"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/org";
import { logChange } from "@/lib/supabase/audit";

const DESIGN_STEPS = [
  "Obtain the current payment-approval policy and approval matrix.",
  "Verify that approval thresholds, authorized approvers, and segregation-of-duties expectations are documented.",
  "Confirm that the control identifies the control owner, operating frequency, retained evidence, and escalation path.",
  "Document an auditor draft conclusion on whether the design addresses the stated risk.",
];

const EFFECTIVENESS_STEPS = [
  "Obtain the complete population of payments above $10,000 for the review period.",
  "Select a sample using the documented sampling approach.",
  "Inspect each selected payment for evidence of two approvals before payment release.",
  "Verify the approvers were authorized under the current approval matrix.",
  "Record any exceptions and assess whether additional follow-up is needed.",
  "Draft the auditor conclusion.",
];

export async function loadStarterTemplateAction() {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to load the starter template.");
  }

  const supabase = await createClient();

  const { data: control, error: controlError } = await supabase
    .from("controls")
    .insert({
      organization_id: ctx.org.id,
      code: "CTRL-PAY-001",
      title: "Dual Approval for High-Value Payments",
      description:
        "The payment platform requires dual approval for all payments above $10,000 before funds are released.",
      framework: "SOX 404 / ICFR",
      business_model: "Payments",
      process: "Payments and settlement",
      risk_statement:
        "Payments may be released without appropriate authorization, resulting in unauthorized disbursements or inaccurate financial reporting.",
      control_objective:
        "Payments above the approved threshold are authorized by an appropriate individual before release.",
      assertion: "Occurrence, Completeness, Accuracy",
      risk_rating: "high",
      frequency: "Per transaction",
      control_owner: "Finance Operations Manager",
      status: "active",
    })
    .select("id")
    .single();

  if (controlError) throw new Error(controlError.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "control",
    entityId: control.id,
    metadata: { source: "starter_template", code: "CTRL-PAY-001" },
  });

  const planDefs = [
    {
      name: "Payments — Dual Approval for High-Value Payments: Test of Design",
      test_type: "test_of_design",
      steps: DESIGN_STEPS,
    },
    {
      name: "Payments — Dual Approval for High-Value Payments: Test of Effectiveness",
      test_type: "test_of_effectiveness",
      steps: EFFECTIVENESS_STEPS,
    },
  ];

  for (const planDef of planDefs) {
    const { data: plan, error: planError } = await supabase
      .from("test_plans")
      .insert({
        organization_id: ctx.org.id,
        control_id: control.id,
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
      metadata: { source: "starter_template" },
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

  revalidatePath("/dashboard/controls");
  redirect(`/dashboard/controls/${control.id}`);
}
