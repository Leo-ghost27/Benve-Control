import { getOrgContext } from "@/lib/supabase/org";
import { NewControlForm } from "@/components/dashboard/NewControlForm";

export default async function NewControlPage() {
  const ctx = await getOrgContext();
  return <NewControlForm orgName={ctx?.org?.name ?? null} />;
}
