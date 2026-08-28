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
    status: str(formData, "status")?.toLowerCase().replace(/ /g, "_") ?? "draft",
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

  await logChange({
    supabase,
    organizationId: ctx.org.id,
    actorId: ctx.userId,
    action: "created",
    entityType: "control",
    entityId: data.id,
    metadata: { code: record.code, title: record.title },
  });

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
