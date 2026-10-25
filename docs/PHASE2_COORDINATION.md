# Phase 2 coordination (read before you start, update before you push)

Two Claude sessions work in this repo. This file is the shared source of truth so they do not collide.
Last updated by: session A (tenancy/review), Priority 2 core applied to live.

## Current state of `main`
- Phase 1 (Tasks 40-48) + Phase 2 Module 1 CCM, Module 2 Readiness, Module 3 Multi-entity/Group ICFR.
- Priority 1 (firm/client workspaces, invitations, team guards, archive/deletion requests, client scope
  sign-off, platform-admin lockout, Phase 1 audit triggers) is **applied to live** and merged.
- Priority 2 core (My Work, Review Queue, version-bound review, supersede-on-change, external shared view) is **applied to live**.
- DB suites on main: review 18, tenancy 15, CCM 18, readiness 12, group 14 (run `python3 tests/db/run_*_tests.py`).
- NEW RULE for Session B tables: external_auditor/viewer have NO raw access to test_plans/test_steps/evidence/populations/sample_items
  (restrictive policy `p2 raw access internal only`). Serve them via `p2_shared_*` functions; never expose `auditor_notes`.
- Review of other record types: `workpaper_reviews.record_type` is currently only 'test_plan'; extend its check + `p2_*_hash` + invalidate triggers if ITGC/Reports need version-bound approval (coordinate with A).

## Live Supabase migration ledger (project vubcwckjhmssaideznua)
Append a row whenever you apply a migration to live. Repo file names must sort in this same order.
| live version | repo file | by |
|---|---|---|
| 20261021104459 | 20261019000001_phase2_foundation_and_ccm.sql | A |
| 20261021104724 | 20261019000002_phase2_harden_functions.sql | A |
| 20261021205520 | 20261020000001_phase2_readiness.sql | A |
| 20261023095605 | 20261021000001_phase2_group_icfr.sql | B |
| 20261024081832 | 20261021000010_phase2_tenancy_and_scope.sql | A |
| 20261024082002 | 20261021000011_phase2_platform_access_and_audit.sql | A |
| 20261025091231 | 20261022000100_phase2_review_workflow.sql | A |
| 20261025091245 | 20261022000110_phase2_external_shared_access.sql | A |

## Lanes
**Session A (tenancy / review workflow): Priority 1, 2, 4**
- Done: Priority 1.
- Done: My Work, assigned tests + due dates, version-bound review/approval, comments, external shared view.
- Next: external-auditor request/response workflow; client_profiles audit trigger; extend reviews to
  deficiencies/other records; browser verification; navigation map (Processes, Risks, Formal exceptions, Population assessments, Sample plans,
  Remediation, Review queue, Audit trail); audit trigger for `client_profiles`.
- Owns: `src/lib/actions/{workspaces,team,scopes}.ts`, `src/components/workspace/*`, `src/app/dashboard/settings/*`,
  `src/app/dashboard/scope/*`, `src/app/accept-invite/*`, `src/lib/supabase/org.ts`, `src/middleware.ts`.

**Session B (Phase 2 modules): Priority 3 remainder**
- Done: Modules 1-3.
- Next: Module 4 ITGC (system -> map ITGC/automated controls -> dependencies -> test via the EXISTING
  testing engine -> evidence -> results -> route exceptions for review), Module 5 Reports (generated from
  real records with client, period, filters, generation date, draft/approved status; permissions on exports).
- Owns: `src/app/dashboard/{ccm,readiness,group-icfr,subsidiary-questionnaires,itgc,reports}/*`, their actions,
  `tests/db/run_{ccm,readiness,group,itgc,reports}_tests.py`.

## Rules for new tables/functions (both sessions)
1. Tenant key is `organization_id` = one client workspace. Never read across organizations.
2. Use `p2_has_role` / `p2_is_internal` / `p2_has_perm` for policies; attach `p2_audit` and `p2_assert_same_org` triggers.
3. Never write `organization_members` directly; use the `p2_*` team functions. No `is_platform_admin()` policies
   on any workpaper table. Approvals must reference an exact version/hash (see `p2_scope_hash` pattern).
4. Page/action context: `getOrgContext()` / `getPhase2Context()`; do not query memberships yourself.
   The active client is a cookie preference only; RLS is the authority.
5. Test with synthetic data only; add a `tests/db/run_*_tests.py` suite; do not claim a feature works without it.

## Anti-collision rules
- Work on your own branch (`session-a/...`, `session-b/...`). Merge to main only after: `git fetch`,
  rebase/merge main, all DB suites + `tsc` + `next lint` + `vitest` pass.
- Migration file names: Session A uses prefix `2026102A...` style numbering from `20261022000100` upward;
  Session B uses `20261022000200` upward. Never reuse a prefix. Check the ledger above first.
- Shared files (`tests/db/live_stubs.sql`, `src/lib/phase2/permissions.ts`, `src/components/dashboard/Sidebar.tsx`,
  `src/app/dashboard/layout.tsx`): append-only edits, mention them in the commit message, and pull right before pushing.
- Apply to live only after merging to main; add the ledger row in the same commit/PR as the file.
- Never push with `--force`.
