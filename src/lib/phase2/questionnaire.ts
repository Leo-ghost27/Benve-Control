/** Standard subsidiary ICFR sub-certification questions seeded into every new questionnaire. */
export const STANDARD_QUESTIONS = [
  "Have there been significant changes in the design or operation of internal controls over financial reporting this period?",
  "Have any control deficiencies, exceptions or failures been identified (including by local management or auditors)?",
  "Are you aware of any fraud, suspected fraud or management override of controls?",
  "Were there any unusual, complex or significant non-routine transactions this period?",
  "Were there any significant changes to financial systems, IT access or key service providers?",
  "Were there any related-party transactions or changes in related-party relationships?",
  "Was the period-end financial close completed on time, with all reconciliations reviewed and signed off?",
  "Have there been significant changes in key finance personnel or reporting lines?",
];

export const GROUP_OUTCOMES = {
  approved: ["accepted", "accepted_with_follow_up"],
  returned: ["clarification_requested", "returned"],
} as const;

export const OUTCOME_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_review: "In group review",
  clarification_requested: "Clarification requested",
  accepted: "Accepted",
  accepted_with_follow_up: "Accepted with follow-up",
  returned: "Returned",
};
