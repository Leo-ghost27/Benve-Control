/** Mirrors the DB transition triggers so the UI only offers legal moves. */
export const EXCEPTION_TRANSITIONS: Record<string, string[]> = {
  open: ["in_investigation", "false_positive"],
  in_review: ["in_investigation", "false_positive"],
  in_investigation: ["false_positive", "linked", "closed"],
  false_positive: ["closed"],
  linked: ["closed"],
  closed: ["in_investigation"],
};

export const RULE_TRANSITIONS: Record<string, string[]> = {
  draft: ["active", "archived"],
  active: ["inactive", "archived"],
  inactive: ["active", "archived"],
  archived: [],
};

export const SUMMARY_TRANSITIONS: Record<string, string[]> = {
  draft: ["prepared"],
  prepared: ["submitted"],
  submitted: ["returned", "approved"],
  returned: ["prepared"],
  reopened: ["prepared"],
  approved: ["reopened", "archived"],
  archived: [],
};

export function canTransition(map: Record<string, string[]>, from: string, to: string) {
  return (map[from] ?? []).includes(to);
}

export function isOverdue(dueDate: string | null, status: string, today = new Date()) {
  if (!dueDate || status === "closed") return false;
  const t = new Date(today.toISOString().slice(0, 10)).getTime();
  return new Date(dueDate).getTime() < t;
}
