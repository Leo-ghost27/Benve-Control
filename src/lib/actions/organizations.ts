"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function createOrganizationAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Organization name is required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization_with_owner", {
    org_name: name,
    org_slug: slugify(name),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
