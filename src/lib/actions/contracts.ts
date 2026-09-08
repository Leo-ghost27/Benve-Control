"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function textOrNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

const DEFAULT_ENGAGEMENT_LETTER = `This engagement letter confirms the terms under which [Firm Name] will provide SOX 404 / ICFR advisory and testing services to [Client Name] ("the Client").

1. Scope of Services
[Firm Name] will assist the Client with risk and control framework design, SOX 404 testing, deficiency assessment, and related ICFR advisory support, as further described in the attached statement of work.

2. Fees
Fees for these services are as set out in the attached statement of work and are payable in accordance with the agreed billing plan.

3. Responsibilities
The Client remains responsible for its internal control over financial reporting, for management's assessment and conclusions, and for all final disclosure and filing decisions. [Firm Name] provides advisory support and does not issue an audit opinion.

4. Term and Termination
This engagement may be terminated by either party with 30 days' written notice.

By signing below, the parties agree to the terms of this engagement letter.`;

/**
 * Platform-admin only (enforced by RLS on the 'contracts' table).
 * Drafts a new contract for a prospective or existing client.
 */
export async function createContractAction(formData: FormData) {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const clientName = String(formData.get("client_name") ?? "").trim();
  const clientEmail = String(formData.get("client_email") ?? "").trim();
  if (!clientName || !clientEmail) {
    throw new Error("Client name and email are required.");
  }

  const bodyText = textOrNull(formData.get("body_text")) ?? DEFAULT_ENGAGEMENT_LETTER;

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      client_name: clientName,
      client_email: clientEmail,
      title: textOrNull(formData.get("title")) ?? "SOX 404 / ICFR Advisory Engagement Letter",
      body_text: bodyText,
      organization_id: textOrNull(formData.get("organization_id")),
      created_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  redirect(`/admin/contracts/${data.id}`);
}

export async function updateContractDraftAction(formData: FormData) {
  const supabase = await createClient();
  const contractId = String(formData.get("contractId"));

  const { error } = await supabase
    .from("contracts")
    .update({
      title: textOrNull(formData.get("title")),
      body_text: textOrNull(formData.get("body_text")),
    })
    .eq("id", contractId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/contracts/${contractId}`);
}

/**
 * Marks a contract as sent and returns its public signing link.
 * There is no email-sending integration configured in this app, so the
 * admin copies this link and sends it themselves — this action does
 * NOT claim to have emailed anything.
 */
export async function markContractSentAction(formData: FormData) {
  const supabase = await createClient();
  const contractId = String(formData.get("contractId"));

  const { error } = await supabase
    .from("contracts")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", contractId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/contracts/${contractId}`);
}

/**
 * Public action — called from the token-based /sign/[token] page,
 * which has no authenticated session. Uses the service-role client and
 * independently verifies the token before writing anything, same
 * pattern as the existing client-evidence flow.
 */
export async function signContractAction(formData: FormData) {
  const token = String(formData.get("token"));
  const signerName = String(formData.get("signer_name") ?? "").trim();
  const signerTitle = textOrNull(formData.get("signer_title"));
  const agreed = formData.get("agreed") === "on";

  if (!signerName || !agreed) {
    throw new Error("Please type your full legal name and confirm agreement to continue.");
  }

  const admin = createAdminClient();

  const { data: contract, error: fetchError } = await admin
    .from("contracts")
    .select("id, status")
    .eq("access_token", token)
    .maybeSingle();

  if (fetchError || !contract) {
    throw new Error("This signing link is invalid or has expired.");
  }
  if (contract.status === "signed") {
    throw new Error("This contract has already been signed.");
  }

  const headerList = await headers();
  const signerIp =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null;

  const { error: updateError } = await admin
    .from("contracts")
    .update({
      status: "signed",
      signed_at: new Date().toISOString(),
      signer_name: signerName,
      signer_title: signerTitle,
      signer_ip: signerIp,
    })
    .eq("id", contract.id);

  if (updateError) throw new Error(updateError.message);

  redirect(`/sign/${token}?signed=1`);
}
