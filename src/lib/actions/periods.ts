"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/supabase/org";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo, withParams } from "@/lib/phase2/context";

export async function createReportingPeriodAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("return_to"), "/dashboard/ccm");
  const ctx = await getOrgContext();
  if (!ctx?.org) redirect(withParams(returnTo, { error: "You must belong to an organization." }));
  if (!["owner", "admin", "cfo", "controller"].includes(ctx.role ?? ""))
    redirect(withParams(returnTo, { error: "Only owners, admins, CFOs or controllers can create reporting periods." }));

  const label = String(formData.get("label") ?? "").trim();
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  if (!label || !start || !end) redirect(withParams(returnTo, { error: "Label, start date and end date are required." }));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reporting_periods")
    .insert({ organization_id: ctx.org.id, label, start_date: start, end_date: end, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) redirect(withParams(returnTo, { error: error.message }));

  revalidatePath("/dashboard", "layout");
  redirect(withParams(returnTo, { period: data.id, notice: "Reporting period created." }));
}
