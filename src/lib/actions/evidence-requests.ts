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

export async function createAndSendEvidenceRequestAction(formData: FormData) {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to request evidence.");
  }

  const supabase = await createClient();
  const controlId = str(formData, "control_id");
  const ownerEmail = str(formData, "owner_email") ?? "";
  const ownerName = str(formData, "owner_name") ?? "";

  if (!ownerEmail || !ownerName) {
    throw new Error("Client control owner name and email are required.");
  }

  const record = {
    organization_id: ctx.org.id,
    control_id: controlId,
    test_plan_id: str(formData, "test_plan_id"),
    test_step_id: str(formData, "test_step_id"),
    title: str(formData, "title") ?? "",
    instructions: str(formData, "instructions"),
    owner_name: ownerName,
    owner_email: ownerEmail.toLowerCase(),
    due_date: str(formData, "due_date"),
    evidence_period: str(formData, "evidence_period"),
    priority: str(formData, "priority")?.toLowerCase() ?? "medium",
    status: "sent",
    created_by: ctx.userId,
  };

  if (!record.title) {
    throw new Error("Request title is required.");
  }

  const { data, error } = await supabase
    .from("evidence_requests")
    .insert(record)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // Ensure a client link (token) exists for this owner so they can see
  // this request (and any future ones) in their "My Benve Actions" list.
  const { error: linkError } = await supabase
    .from("client_links")
    .upsert(
      { organization_id: ctx.org.id, owner_name: ownerName, owner_email: record.owner_email },
      { onConflict: "organization_id,owner_email", ignoreDuplicates: true }
    );
  if (linkError) throw new Error(linkError.message);

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "evidence_request",
    entityId: data.id,
    metadata: { title: record.title, owner_email: record.owner_email, status: "sent" },
  });

  revalidatePath("/dashboard/evidence");
  if (controlId) revalidatePath(`/dashboard/controls/${controlId}`);
  redirect(`/dashboard/evidence-requests/${data.id}`);
}

async function requireWriteAccess() {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    throw new Error("You must belong to an organization to do this.");
  }
  return ctx;
}

export async function acceptEvidenceRequestAction(formData: FormData) {
  const ctx = await requireWriteAccess();
  const requestId = String(formData.get("requestId"));
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("evidence_requests")
    .update({ status: "accepted", auditor_comment: comment })
    .eq("id", requestId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "accepted",
    entityType: "evidence_request",
    entityId: requestId,
    metadata: { comment },
  });

  revalidatePath(`/dashboard/evidence-requests/${requestId}`);
  revalidatePath("/dashboard/evidence");
}

export async function requestClarificationAction(formData: FormData) {
  const ctx = await requireWriteAccess();
  const requestId = String(formData.get("requestId"));
  const comment = String(formData.get("comment") ?? "").trim();

  if (!comment) {
    throw new Error("A comment is required when requesting clarification.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("evidence_requests")
    .update({ status: "clarification_requested", auditor_comment: comment })
    .eq("id", requestId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "clarification_requested",
    entityType: "evidence_request",
    entityId: requestId,
    metadata: { comment },
  });

  revalidatePath(`/dashboard/evidence-requests/${requestId}`);
  revalidatePath("/dashboard/evidence");
}

export async function rejectEvidenceRequestAction(formData: FormData) {
  const ctx = await requireWriteAccess();
  const requestId = String(formData.get("requestId"));
  const comment = String(formData.get("comment") ?? "").trim();

  if (!comment) {
    throw new Error("A comment is required when rejecting evidence.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("evidence_requests")
    .update({ status: "rejected", auditor_comment: comment })
    .eq("id", requestId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "rejected",
    entityType: "evidence_request",
    entityId: requestId,
    metadata: { comment },
  });

  revalidatePath(`/dashboard/evidence-requests/${requestId}`);
  revalidatePath("/dashboard/evidence");
}

export async function linkToTestStepAction(formData: FormData) {
  const ctx = await requireWriteAccess();
  const requestId = String(formData.get("requestId"));
  const testStepId = String(formData.get("test_step_id") || "") || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("evidence_requests")
    .update({ test_step_id: testStepId })
    .eq("id", requestId)
    .eq("organization_id", ctx.org!.id);

  if (error) throw new Error(error.message);

  await logChange({
    supabase,
    organizationId: ctx.org!.id,
    actorId: ctx.userId,
    action: "linked_to_test_step",
    entityType: "evidence_request",
    entityId: requestId,
    metadata: { test_step_id: testStepId },
  });

  revalidatePath(`/dashboard/evidence-requests/${requestId}`);
}
