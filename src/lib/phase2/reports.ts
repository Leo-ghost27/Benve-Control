import { toCsv } from "@/lib/phase2/csv";

/**
 * Module 5 (reporting and governance packs): shared types and pure helpers.
 * The numbers themselves are computed in the database (p2_report_compute); nothing here
 * calculates a count. This file only labels, links and exports what the database returned.
 */
export const PACK_TYPES = [
  "governance_pack",
  "ccm_aging",
  "readiness",
  "questionnaires",
  "group_coverage",
  "itgc",
  "evidence",
  "review_backlog",
  "remediation",
] as const;
export type PackType = (typeof PACK_TYPES)[number];
export const SECTION_TYPES = PACK_TYPES.filter((t) => t !== "governance_pack") as Exclude<PackType, "governance_pack">[];

export const PACK_LABELS: Record<PackType, string> = {
  governance_pack: "Governance pack (all sections)",
  ccm_aging: "CCM alerts and follow-up aging",
  readiness: "Readiness gaps and roadmap",
  questionnaires: "Entity questionnaire status",
  group_coverage: "Group control coverage and testing",
  itgc: "ITGC dependencies and open issues",
  evidence: "Evidence completeness",
  review_backlog: "Review backlog",
  remediation: "Remediation and retest status",
};

export function isPackType(v: string | null | undefined): v is PackType {
  return !!v && (PACK_TYPES as readonly string[]).includes(v);
}

export type ReportRecord = {
  k?: string;
  rtype: string;
  rid: string | null;
  ref: string | null;
  status: string | null;
  due: string | null;
  detail: string | null;
  since: string | null;
};
export type ReportMetric = { key: string; label: string; basis: string; count: number; truncated: boolean; records: ReportRecord[] };
export type ReportSection = { section: string; title: string; metrics: ReportMetric[]; notes: string[] };
export type ReportMeta = {
  client: string; reporting_period: string; period_start: string; period_end: string;
  generated_at: string; generated_by: string; pack_version: number; entity_id: string | null; entity_name: string | null;
};
export type ReportSnapshot = { pack_type: PackType; sections: ReportSection[]; filter_notes: string[]; meta?: ReportMeta };

export type PackRow = {
  id: string; organization_id: string; reporting_period_id: string; entity_id: string | null; pack_type: PackType; title: string;
  version: number; status: string; filters: Record<string, unknown>; as_of: string; snapshot: ReportSnapshot; snapshot_hash: string;
  generated_by: string | null; generated_by_label: string | null; generated_at: string;
  submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null;
  shared_with_external: boolean; shared_by: string | null; shared_at: string | null; share_note: string | null;
};

/**
 * Where a record can be opened. Only used for internal users; external auditors see the snapshot
 * but are not offered links into workpapers they cannot open. Unknown types have no link rather
 * than a guessed one.
 */
export function recordHref(r: ReportRecord, periodId: string): string | null {
  const id = r.rid;
  const q = (path: string, extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams({ period: periodId, ...extra });
    return `${path}?${sp.toString()}`;
  };
  switch (r.rtype) {
    case "ccm_alert": return q("/dashboard/ccm/exceptions", r.ref ? { q: r.ref } : {});
    case "follow_up": return q("/dashboard/ccm/follow-ups");
    case "ccm_summary": return q("/dashboard/ccm");
    case "readiness_assessment": return q("/dashboard/readiness");
    case "readiness_gap": return id ? `/dashboard/readiness/gaps/${id}` : null;
    case "readiness_item": return q("/dashboard/readiness/checklist");
    case "roadmap_action": return q("/dashboard/readiness/roadmap");
    case "questionnaire": return id ? `/dashboard/subsidiary-questionnaires/${id}` : null;
    case "entity": return id ? `/dashboard/entities/${id}` : null;
    case "entity_control": return q("/dashboard/entities");
    case "control": return id ? `/dashboard/controls/${id}` : null;
    case "group_summary": return q("/dashboard/group-icfr");
    case "deficiency": return id ? `/dashboard/deficiencies/${id}` : null;
    case "remediation_task": return "/dashboard/remediation";
    case "test_plan": return id ? `/dashboard/test-plans/${id}` : null;
    case "itgc_system": case "dependency": return "/dashboard/itgc/systems";
    case "itgc_exception": return "/dashboard/itgc/exceptions";
    case "automated_control": return "/dashboard/itgc/automated-controls";
    case "evidence_request": return id ? `/dashboard/evidence-requests/${id}` : null;
    case "engagement_scope": return id ? `/dashboard/scope/${id}` : null;
    case "report_pack": return id ? `/dashboard/reports/${id}` : null;
    default: return null;
  }
}

const STATUS_STATEMENT: Record<string, string> = {
  draft: "DRAFT: not reviewed or approved. Do not rely on this report.",
  submitted: "SUBMITTED FOR REVIEW: not yet approved.",
  returned: "RETURNED: a reviewer returned this pack; it is not approved.",
  approved: "APPROVED: a reviewer approved this exact snapshot (see snapshot reference).",
  superseded: "SUPERSEDED: a later version has been approved; retained for the record.",
  archived: "ARCHIVED: not approved.",
};

export type ExportContext = { exportedAt: string; exportedBy: string; approverName: string | null };

/** Build the CSV for a stored pack. Always produced from the stored snapshot, never from live data. */
export function buildPackCsv(pack: PackRow, ex: ExportContext): string {
  const m = pack.snapshot.meta;
  const meta: [string, unknown][] = [
    ["Report", `${pack.title} (version ${pack.version})`],
    ["Client", m?.client ?? ""],
    ["Reporting period", m ? `${m.reporting_period} (${m.period_start} to ${m.period_end})` : ""],
    ["Scope and filters", pack.entity_id ? `Entity: ${m?.entity_name ?? pack.entity_id}` : "All entities (client-wide)"],
    ["Snapshot generated", pack.as_of],
    ["Generated by", pack.generated_by_label ?? ""],
    ["Status", pack.status.toUpperCase()],
    ["Status statement", STATUS_STATEMENT[pack.status] ?? pack.status],
    ["Snapshot reference", `v${pack.version} sha256:${pack.snapshot_hash}`],
    ["Approved by", pack.status === "approved" || pack.status === "superseded" ? ex.approverName ?? "" : ""],
    ["Approved at", pack.status === "approved" || pack.status === "superseded" ? pack.decided_at ?? "" : ""],
    ["Exported at", ex.exportedAt],
    ["Exported by", ex.exportedBy],
    ["Basis", "Counts summarise records held in Benve Control at the snapshot time. This is not an audit opinion, an ICFR conclusion, or a regulatory filing."],
  ];
  for (const n of pack.snapshot.filter_notes ?? []) meta.push(["Filter note", n]);
  const parts: string[] = [toCsv(["Field", "Value"], meta)];
  for (const s of pack.snapshot.sections) {
    parts.push(toCsv([`Section: ${s.title}`, "", "", ""], [
      ["Metric", "Count", "Counting basis", "Records listed"],
      ...s.metrics.map((x) => [x.label.trim(), x.count, x.basis, x.truncated ? `${x.records.length} of ${x.count} (list truncated)` : x.records.length]),
      ...s.notes.map((n) => ["Note", "", n, ""]),
    ]));
  }
  const rows: unknown[][] = [];
  for (const s of pack.snapshot.sections) {
    for (const x of s.metrics) {
      for (const r of x.records) rows.push([s.title, x.label.trim(), r.rtype, r.ref, r.status, r.due, r.detail, r.since]);
    }
  }
  parts.push(toCsv(["Section", "Metric", "Record type", "Reference", "Status", "Due", "Detail", "Since"], rows));
  return parts.join("\r\n");
}

export function csvFileName(pack: PackRow): string {
  const period = (pack.snapshot.meta?.reporting_period ?? "period").replace(/[^\w-]+/g, "_");
  return `${pack.pack_type}-${period}-v${pack.version}-${pack.status}.csv`;
}
