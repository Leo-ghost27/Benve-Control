import { describe, it, expect } from "vitest";
import { parseCsv, validateCsv, csvCell, toCsv } from "@/lib/phase2/csv";
import { can } from "@/lib/phase2/permissions";
import { canTransition, EXCEPTION_TRANSITIONS, SUMMARY_TRANSITIONS, isOverdue } from "@/lib/phase2/workflow";

const lookups = {
  rulesByCode: new Map([["ccm-001", "rule-uuid"]]),
  controlsByCode: new Map([["c-1", "ctl-uuid"]]),
};

describe("csv parsing", () => {
  it("handles quotes, escaped quotes, CRLF and embedded newlines", () => {
    const g = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\r\n');
    expect(g).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "z"]]);
  });
  it("strips BOM and skips blank lines", () => {
    expect(parseCsv("\uFEFFa,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("csv validation", () => {
  it("accepts valid rows and resolves rule/control codes", () => {
    const r = validateCsv(
      "source_reference,description,severity,rule_code,control_code,amount\nINV-1,Duplicate,HIGH,CCM-001,C-1,\"1,250.50\"\n",
      lookups
    );
    expect(r.validationStatus).toBe("validated");
    expect(r.rows[0]).toMatchObject({ rule_id: "rule-uuid", control_id: "ctl-uuid", severity: "high", amount: "1250.50" });
  });
  it("reports line-numbered errors and keeps valid rows (partially_valid)", () => {
    const r = validateCsv(
      "source_reference,description,severity,rule_code\nINV-1,ok,low,\n,missing ref,low,\nINV-3,bad sev,urgent,\nINV-4,bad rule,low,NOPE\n",
      lookups
    );
    expect(r.validationStatus).toBe("partially_valid");
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(r.errors[0].message).toMatch(/source_reference is required/);
    expect(r.errors[2].message).toMatch(/rule_code "nope" not found/);
  });
  it("rejects files missing required columns or empty", () => {
    expect(validateCsv("foo,bar\n1,2\n", lookups).validationStatus).toBe("invalid");
    expect(validateCsv("", lookups).validationStatus).toBe("invalid");
  });
  it("rejects invalid dates and amounts", () => {
    const r = validateCsv("source_reference,description,detected_at,amount\nA,b,not-a-date,xyz\n", lookups);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/not a valid date/);
    expect(r.errors[0].message).toMatch(/not a number/);
  });
});

describe("csv export safety", () => {
  it("neutralises formula injection and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(["a"], [["x"], [null]])).toBe("a\r\nx\r\n\r\n");
  });
});

describe("permission matrix", () => {
  it("internal auditor creates/investigates but cannot approve", () => {
    expect(can("internal_auditor", "ccm.exception.write")).toBe(true);
    expect(can("internal_auditor", "ccm.escalation.approve")).toBe(false);
    expect(can("internal_auditor", "ccm.import.approve")).toBe(false);
  });
  it("controller/CFO approve escalation and summaries", () => {
    for (const r of ["cfo", "controller"] as const) {
      expect(can(r, "ccm.escalation.approve")).toBe(true);
      expect(can(r, "ccm.summary.review")).toBe(true);
    }
  });
  it("adviser reviews/comments only", () => {
    expect(can("adviser", "ccm.view_internal")).toBe(true);
    expect(can("adviser", "comment.internal")).toBe(true);
    expect(can("adviser", "ccm.exception.write")).toBe(false);
  });
  it("external auditor and viewer see summaries only, never internal data", () => {
    for (const r of ["external_auditor", "viewer"] as const) {
      expect(can(r, "ccm.view_summary")).toBe(true);
      expect(can(r, "ccm.view_internal")).toBe(false);
      expect(can(r, "comment.internal")).toBe(false);
    }
    expect(can("external_auditor", "comment.shareable")).toBe(true);
    expect(can("viewer", "comment.shareable")).toBe(false);
    expect(can(null, "ccm.view_summary")).toBe(false);
  });
});

describe("workflow rules", () => {
  it("never allows draft -> approved directly", () => {
    expect(canTransition(SUMMARY_TRANSITIONS, "draft", "approved")).toBe(false);
    expect(canTransition(SUMMARY_TRANSITIONS, "submitted", "approved")).toBe(true);
    expect(canTransition(SUMMARY_TRANSITIONS, "approved", "reopened")).toBe(true);
  });
  it("exceptions cannot jump open -> linked", () => {
    expect(canTransition(EXCEPTION_TRANSITIONS, "open", "linked")).toBe(false);
    expect(canTransition(EXCEPTION_TRANSITIONS, "in_investigation", "linked")).toBe(true);
  });
  it("overdue is derived from due date and status", () => {
    const today = new Date("2026-10-19T12:00:00Z");
    expect(isOverdue("2026-10-18", "open", today)).toBe(true);
    expect(isOverdue("2026-10-19", "open", today)).toBe(false);
    expect(isOverdue("2026-10-01", "closed", today)).toBe(false);
    expect(isOverdue(null, "open", today)).toBe(false);
  });
});
