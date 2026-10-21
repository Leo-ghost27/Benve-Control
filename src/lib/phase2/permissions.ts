import type { OrgRole } from "@/lib/supabase/org";

/**
 * Phase 2 capability matrix. This only drives what the UI offers; the
 * database (RLS + triggers in 20261019000001_phase2_foundation_and_ccm.sql)
 * is the actual enforcement point and rejects anything not allowed here.
 */
export type Capability =
  | "ccm.view_internal"
  | "ccm.view_summary"
  | "ccm.rule.create"
  | "ccm.rule.edit"
  | "ccm.exception.write"
  | "ccm.import.create"
  | "ccm.import.approve"
  | "ccm.followup.write"
  | "ccm.escalation.approve"
  | "ccm.summary.prepare"
  | "ccm.summary.review"
  | "readiness.view_internal"
  | "readiness.view_approved"
  | "readiness.prepare"
  | "readiness.review"
  | "comment.internal"
  | "comment.shareable";

const MANAGERS: OrgRole[] = ["owner", "admin", "cfo", "controller"];
const INTERNAL: OrgRole[] = [...MANAGERS, "internal_auditor", "adviser"];

const MATRIX: Record<Capability, OrgRole[]> = {
  "ccm.view_internal": INTERNAL,
  "ccm.view_summary": ["external_auditor", "viewer"],
  "ccm.rule.create": ["owner", "admin", "internal_auditor"],
  "ccm.rule.edit": [...MANAGERS, "internal_auditor"],
  "ccm.exception.write": ["owner", "admin", "internal_auditor"],
  "ccm.import.create": ["owner", "admin", "internal_auditor"],
  "ccm.import.approve": MANAGERS,
  "ccm.followup.write": ["owner", "admin", "internal_auditor"],
  "ccm.escalation.approve": MANAGERS,
  "ccm.summary.prepare": ["owner", "admin", "internal_auditor"],
  "ccm.summary.review": MANAGERS,
  "readiness.view_internal": INTERNAL,
  "readiness.view_approved": ["external_auditor", "viewer"],
  "readiness.prepare": ["owner", "admin", "internal_auditor"],
  "readiness.review": MANAGERS,
  "comment.internal": INTERNAL,
  "comment.shareable": [...INTERNAL, "external_auditor"],
};

export function can(role: OrgRole | null, capability: Capability): boolean {
  return role !== null && MATRIX[capability].includes(role);
}
