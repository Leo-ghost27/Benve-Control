"use server";

import { createClient } from "@/lib/supabase/server";
import { done, fail, friendly, gate, txt } from "@/lib/phase2/action-utils";
import { withParams } from "@/lib/phase2/context";
import { isPackType } from "@/lib/phase2/reports";
import { redirect } from "next/navigation";

/**
 * Report pack actions. Capability checks only give friendly messages: the database functions
 * (p2_report_*) enforce roles, explicit review authority, separation of duties, hash binding and
 * immutability. Nothing here computes or edits a snapshot.
 */
const BASE = "/dashboard/reports";

export async function generatePackAction(fd: FormData) {
  const { ctx, returnTo } = await gate(fd, "reports.generate", BASE);
  const type = txt(fd, "pack_type");
  const period = txt(fd, "period");
  const entity = txt(fd, "entity_id");
  if (!isPackType(type)) fail(returnTo, "Choose a report type.");
  if (!period) fail(returnTo, "Choose a reporting period.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("p2_report_generate", { p_org: ctx.org.id, p_period: period, p_type: type, p_entity: entity });
  if (error) fail(returnTo, friendly(error.message));
  redirect(withParams(`${BASE}/${data as string}`, { notice: "Draft snapshot generated from current records. It is not approved." }));
}

export async function submitPackAction(fd: FormData) {
  const { returnTo } = await gate(fd, "reports.generate", BASE);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing report pack.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_report_submit", { p_id: id });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Submitted for review. The reviewer approves this exact snapshot.");
}

export async function decidePackAction(fd: FormData) {
  const { returnTo } = await gate(fd, "reports.view_internal", BASE);
  const id = txt(fd, "id");
  const decision = txt(fd, "decision");
  const hash = txt(fd, "expected_hash");
  if (!id || !decision || !hash) fail(returnTo, "Missing report pack, decision or version.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_report_decide", { p_id: id, p_decision: decision, p_comment: txt(fd, "comment") ?? "", p_expected_hash: hash });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, decision === "approved" ? "Snapshot approved. Earlier approved versions are superseded." : "Pack returned. Generate a corrected version to continue.");
}

export async function archivePackAction(fd: FormData) {
  const { returnTo } = await gate(fd, "reports.generate", BASE);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing report pack.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_report_archive", { p_id: id, p_reason: txt(fd, "reason") ?? "" });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, "Pack archived.");
}

export async function sharePackAction(fd: FormData) {
  const { returnTo } = await gate(fd, "reports.view_internal", BASE);
  const id = txt(fd, "id");
  if (!id) fail(returnTo, "Missing report pack.");
  const share = fd.get("share") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("p2_report_share", { p_id: id, p_share: share, p_note: txt(fd, "note") ?? "" });
  if (error) fail(returnTo, friendly(error.message));
  done(returnTo, share ? "Shared with external auditors and viewers. This is logged." : "External sharing withdrawn.");
}
