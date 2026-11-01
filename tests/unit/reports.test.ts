import { describe, it, expect } from "vitest";
import { buildPackCsv, csvFileName, recordHref, PACK_TYPES, PACK_LABELS, isPackType, type PackRow } from "@/lib/phase2/reports";
import { can } from "@/lib/phase2/permissions";

const base: PackRow = {
  id: "p1", organization_id: "o1", reporting_period_id: "per1", entity_id: null, pack_type: "ccm_aging", title: "CCM alerts and follow-up aging",
  version: 2, status: "approved", filters: {}, as_of: "2026-10-31T10:00:00Z", snapshot_hash: "abc123", generated_by: "u1", generated_by_label: "ia@x.test",
  generated_at: "2026-10-31T10:00:00Z", submitted_by: "u1", submitted_at: null, decided_by: "u2", decided_at: "2026-11-01T09:00:00Z", decision_note: null,
  shared_with_external: false, shared_by: null, shared_at: null, share_note: null,
  snapshot: {
    pack_type: "ccm_aging", filter_notes: ["Entity filter applied to: questionnaires."],
    meta: { client: "Acme", reporting_period: "2026-Q3", period_start: "2026-07-01", period_end: "2026-09-30", generated_at: "x", generated_by: "ia@x.test", pack_version: 2, entity_id: null, entity_name: null },
    sections: [{ section: "ccm_aging", title: "CCM alerts", notes: ["Manual / import-based."], metrics: [
      { key: "alerts_total", label: "Alerts in period", basis: "Every alert.", count: 2, truncated: false, records: [
        { rtype: "ccm_alert", rid: "a1", ref: "=HYPERLINK(\"http://evil\")", status: "open", due: null, detail: "high", since: "2026-07-01" },
        { rtype: "ccm_alert", rid: "a2", ref: "ALR-2", status: "closed", due: null, detail: "low", since: "2026-07-02" }] }] }],
  },
};

describe("report CSV export", () => {
  it("carries client, period, scope, status, snapshot reference, generator and export details", () => {
    const csv = buildPackCsv(base, { exportedAt: "2026-11-01T12:00:00Z", exportedBy: "adv@x.test", approverName: "Dana" });
    for (const s of ["Acme", "2026-Q3 (2026-07-01 to 2026-09-30)", "All entities (client-wide)", "APPROVED", "v2 sha256:abc123", "ia@x.test", "Dana", "adv@x.test", "not an audit opinion", "Filter note"]) expect(csv).toContain(s);
  });
  it("labels drafts as not reliable and leaves approver blank", () => {
    const csv = buildPackCsv({ ...base, status: "draft", decided_by: null, decided_at: null }, { exportedAt: "t", exportedBy: "e", approverName: null });
    expect(csv).toContain("DRAFT: not reviewed or approved. Do not rely on this report.");
    expect(csv).not.toContain("Approved at,2026");
  });
  it("neutralises spreadsheet formulas in record references", () => {
    const csv = buildPackCsv(base, { exportedAt: "t", exportedBy: "e", approverName: null });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
  it("is built only from the stored snapshot: counts and listed records are reproduced exactly", () => {
    const csv = buildPackCsv(base, { exportedAt: "t", exportedBy: "e", approverName: null });
    expect(csv).toContain("Alerts in period,2,Every alert.,2");
    expect(csv.match(/ccm_alert/g)?.length).toBe(2);
  });
  it("names the file with type, period, version and status", () => {
    expect(csvFileName(base)).toBe("ccm_aging-2026-Q3-v2-approved.csv");
  });
});

describe("report helpers", () => {
  it("every pack type has a label and is recognised; unknown types are rejected", () => {
    for (const t of PACK_TYPES) { expect(PACK_LABELS[t]).toBeTruthy(); expect(isPackType(t)).toBe(true); }
    expect(isPackType("drop_table")).toBe(false);
    expect(isPackType(null)).toBe(false);
  });
  it("links known records, never guesses unknown ones", () => {
    const r = (rtype: string, rid: string | null = "x1") => ({ rtype, rid, ref: "R", status: null, due: null, detail: null, since: null });
    expect(recordHref(r("deficiency"), "p")).toBe("/dashboard/deficiencies/x1");
    expect(recordHref(r("questionnaire"), "p")).toBe("/dashboard/subsidiary-questionnaires/x1");
    expect(recordHref(r("ccm_alert"), "p")).toContain("/dashboard/ccm/exceptions?period=p");
    expect(recordHref(r("deficiency", null), "p")).toBeNull();
    expect(recordHref(r("something_new"), "p")).toBeNull();
  });
  it("external roles may read approved packs but not generate, and have no internal view", () => {
    expect(can("external_auditor", "reports.view_approved")).toBe(true);
    expect(can("external_auditor", "reports.view_internal")).toBe(false);
    expect(can("external_auditor", "reports.generate")).toBe(false);
    expect(can("internal_auditor", "reports.generate")).toBe(true);
    expect(can("controller", "reports.generate")).toBe(false);
    expect(can("adviser", "reports.view_internal")).toBe(true);
  });
});
