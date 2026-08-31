"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_EXTENSIONS = ["pdf", "xlsx", "csv", "png", "jpg", "jpeg", "docx"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Resolves a client token to the org + owner it belongs to, using the
 * service-role client server-side. Returns null if the token is invalid.
 * This is the ONLY way the anonymous client flow is allowed to touch
 * this data — never via a direct anon PostgREST/RLS path.
 */
export async function resolveClientToken(token: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("client_links")
    .select("id, organization_id, owner_name, owner_email, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;

  const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;

  return {
    organizationId: data.organization_id,
    organizationName: (org as { name: string } | null)?.name ?? "Your auditor",
    ownerName: data.owner_name,
    ownerEmail: data.owner_email,
  };
}

export async function submitClientEvidenceAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const requestId = String(formData.get("requestId") ?? "");
  const submittedBy = String(formData.get("submitted_by") ?? "").trim();
  const clientNote = String(formData.get("client_note") ?? "").trim() || null;
  const file = formData.get("file") as File | null;

  const link = await resolveClientToken(token);
  if (!link) {
    throw new Error("This link is not valid. Please ask your auditor for a new one.");
  }

  if (!submittedBy) {
    throw new Error("Please enter your name before submitting.");
  }
  if (!file || file.size === 0) {
    throw new Error("Please choose a file to upload.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("That file is larger than the 20 MB limit. Please upload a smaller file.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = ALLOWED_MIME_TYPES.includes(file.type);
  const extOk = ALLOWED_EXTENSIONS.includes(ext);
  if (!extOk && !mimeOk) {
    throw new Error(
      "That file type isn't supported. Please upload a PDF, XLSX, CSV, PNG, JPG, or DOCX file."
    );
  }

  const admin = createAdminClient();

  // Verify this request actually belongs to this token's organization
  // and owner — a valid token for one client must never let them touch
  // another client's or another owner's request.
  const { data: request, error: fetchError } = await admin
    .from("evidence_requests")
    .select("id, organization_id, owner_email")
    .eq("id", requestId)
    .single();

  if (
    fetchError ||
    !request ||
    request.organization_id !== link.organizationId ||
    request.owner_email !== link.ownerEmail
  ) {
    throw new Error("This request could not be found for your account.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${link.organizationId}/${requestId}/${Date.now()}_${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from("evidence-files")
    .upload(storagePath, arrayBuffer, { contentType: file.type || undefined, upsert: false });

  if (uploadError) {
    throw new Error("Upload failed: " + uploadError.message);
  }

  const { error: updateError } = await admin
    .from("evidence_requests")
    .update({
      submitted_file_name: file.name,
      submitted_file_path: storagePath,
      submitted_file_size: file.size,
      submitted_by: submittedBy,
      submitted_at: new Date().toISOString(),
      client_note: clientNote,
      status: "submitted",
    })
    .eq("id", requestId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await admin.from("audit_log").insert({
    organization_id: link.organizationId,
    actor_id: null,
    action: "submitted",
    entity_type: "evidence_request",
    entity_id: requestId,
    metadata: { submitted_by: submittedBy, file_name: file.name },
  });

  revalidatePath(`/client/${token}`);
  revalidatePath(`/client/${token}/requests/${requestId}`);
  redirect(`/client/${token}/requests/${requestId}`);
}
