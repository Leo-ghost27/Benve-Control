export const CATEGORIES = ["access", "change", "operations"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  access: "Access to programs and data",
  change: "Program change management",
  operations: "Computer operations",
};

export const FREQUENCIES = ["continuous", "daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"];
export const ASSERTIONS = ["existence", "completeness", "accuracy", "valuation", "rights_obligations", "presentation", "occurrence", "cutoff"];
export const RELEVANCE = ["high", "medium", "low"];
export const CRITICALITY = ["critical", "high", "medium", "low"];
export const DEPENDENCY_TYPES = ["automated_control", "system_report", "interface", "application_data", "manual_with_system_data"];

/** Plain-language meaning of each gap code produced by p2_itgc_coverage(). */
export const GAP_LABELS: Record<string, string> = {
  no_itgc: "No ITGC recorded for an in-scope system relevant to financial reporting",
  missing_access: "No access-management ITGC",
  missing_change: "No change-management ITGC",
  missing_operations: "No computer-operations ITGC",
  untested_itgc: "ITGC has no test plan, or its test plan has not started",
  unmapped_itgc: "ITGC is not mapped to a financial control",
  itgc_open_exception: "ITGC has an open test exception awaiting review",
  config_not_approved: "Automated control has no approved configuration conclusion",
  automated_untested: "Automated control has no test plan",
  change_dependency_unmapped: "Automated control states a change dependency that is not linked to an ITGC",
  automated_open_exception: "Automated control has an open test exception awaiting review",
};

/**
 * Starter steps for an ITGC test plan. They are inserted into the EXISTING Phase 1
 * test_steps table and edited / performed / evidenced there like any other step.
 */
export const STEP_TEMPLATES: Record<string, string[]> = {
  access: [
    "Obtain the population of users with access to the system at the period end and confirm its completeness against the system-generated listing.",
    "For a sample of new or changed access grants, inspect approval by an appropriate authoriser before access was provisioned.",
    "For a sample of leavers and role changes, confirm access was removed or amended within the policy timeframe.",
    "Inspect evidence that privileged and administrator access was reviewed by management during the period, and that exceptions were followed up.",
  ],
  change: [
    "Obtain the population of changes released to production in the period and confirm its completeness against the change-management or deployment log.",
    "For a sample of changes, inspect evidence of request, approval, testing and sign-off before migration to production.",
    "Confirm that development / test and production environments are segregated and that developers cannot migrate their own changes.",
    "Inspect evidence that emergency changes were approved and reviewed after the event.",
  ],
  operations: [
    "Obtain the schedule of financially relevant batch jobs and interfaces, and the monitoring log for the period.",
    "For a sample of job or interface failures, inspect evidence they were identified, investigated and resolved.",
    "Inspect evidence that backups ran successfully and that a restore test was performed in the period.",
    "Confirm access to the job scheduler and production data is restricted to authorised personnel.",
  ],
  automated: [
    "Document the automated control's intended logic and the configuration parameters that drive it.",
    "Inspect the configuration in the system (screenshot or export) and compare each parameter to the approved design.",
    "Re-perform the control with test data covering a passing and a failing condition and compare the outcome to expectation.",
    "Confirm the dependent change-management and access ITGCs operated effectively for the period, or perform additional testing.",
  ],
};
