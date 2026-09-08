import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createContractAction } from "@/lib/actions/contracts";

const inputClass =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-paper placeholder:text-mute focus:outline-none focus:ring-1 focus:ring-signal";
const cardClass = "rounded-xl border border-line bg-ink p-6";
const primaryBtn =
  "rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-signal/90";

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

export default async function NewContractPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-signal">
          Admin Console
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-paper">
          Draft New Contract
        </h1>
      </div>

      <div className={cardClass}>
        <form action={createContractAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Client name
              </label>
              <input className={inputClass} name="client_name" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
                Client email
              </label>
              <input className={inputClass} type="email" name="client_email" required />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
              Contract title
            </label>
            <input
              className={inputClass}
              name="title"
              defaultValue="SOX 404 / ICFR Advisory Engagement Letter"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mute">
              Contract text
            </label>
            <textarea
              className={inputClass}
              name="body_text"
              rows={16}
              defaultValue={DEFAULT_ENGAGEMENT_LETTER}
            />
          </div>
          <button type="submit" className={primaryBtn}>
            Save Draft
          </button>
        </form>
      </div>
    </div>
  );
}
