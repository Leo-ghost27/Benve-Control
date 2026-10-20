export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type StagedRow = {
  source_reference: string;
  description: string;
  severity: Severity | "";
  detected_at: string;
  amount: string;
  exception_ref: string;
  rule_id: string;
  control_id: string;
};

export type RowError = { line: number; message: string };

export type ParseResult = {
  rows: StagedRow[];
  errors: RowError[];
  totalRows: number;
  validationStatus: "validated" | "partially_valid" | "invalid";
};

/** RFC 4180-style CSV parser (quoted fields, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

export type Lookups = {
  rulesByCode: Map<string, string>;     // rule_code (lower) -> rule id
  controlsByCode: Map<string, string>;  // control code (lower) -> control id
};

const REQUIRED = ["source_reference", "description"];
export const MAX_IMPORT_ROWS = 2000;

export function validateCsv(text: string, lookups: Lookups): ParseResult {
  const grid = parseCsv(text);
  if (grid.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "File is empty." }], totalRows: 0, validationStatus: "invalid" };
  }
  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (missing.length) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}.` }],
      totalRows: 0,
      validationStatus: "invalid",
    };
  }
  const data = grid.slice(1);
  if (data.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [{ line: 0, message: `Too many rows (${data.length}); maximum is ${MAX_IMPORT_ROWS} per import.` }],
      totalRows: data.length,
      validationStatus: "invalid",
    };
  }
  const idx = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => (idx(name) >= 0 ? (r[idx(name)] ?? "").trim() : "");

  const rows: StagedRow[] = [];
  const errors: RowError[] = [];
  data.forEach((r, i) => {
    const line = i + 2;
    const problems: string[] = [];
    const sourceRef = get(r, "source_reference");
    const description = get(r, "description");
    const severity = get(r, "severity").toLowerCase();
    const detected = get(r, "detected_at");
    const amount = get(r, "amount").replace(/,/g, "");
    const ruleCode = get(r, "rule_code").toLowerCase();
    const controlCode = get(r, "control_code").toLowerCase();

    if (!sourceRef) problems.push("source_reference is required");
    if (!description) problems.push("description is required");
    if (severity && !(SEVERITIES as readonly string[]).includes(severity))
      problems.push(`severity "${severity}" must be one of ${SEVERITIES.join("/")}`);
    if (detected && Number.isNaN(Date.parse(detected))) problems.push(`detected_at "${detected}" is not a valid date`);
    if (amount && !Number.isFinite(Number(amount))) problems.push(`amount "${amount}" is not a number`);
    const ruleId = ruleCode ? lookups.rulesByCode.get(ruleCode) : "";
    if (ruleCode && !ruleId) problems.push(`rule_code "${ruleCode}" not found`);
    const controlId = controlCode ? lookups.controlsByCode.get(controlCode) : "";
    if (controlCode && !controlId) problems.push(`control_code "${controlCode}" not found`);

    if (problems.length) {
      errors.push({ line, message: problems.join("; ") });
      return;
    }
    rows.push({
      source_reference: sourceRef,
      description,
      severity: severity as Severity | "",
      detected_at: detected ? new Date(detected).toISOString() : "",
      amount,
      exception_ref: get(r, "exception_ref"),
      rule_id: ruleId ?? "",
      control_id: controlId ?? "",
    });
  });

  const validationStatus =
    rows.length === 0 ? "invalid" : errors.length === 0 ? "validated" : "partially_valid";
  return { rows, errors, totalRows: data.length, validationStatus };
}

/** Escape a value for CSV output; neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], records: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...records.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
