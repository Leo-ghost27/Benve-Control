-- ============================================================================
-- Phase 2 / Priority 1 follow-up
--
-- 1. The platform admin must not automatically see confidential client
--    workpapers. Platform-admin SELECT policies on controls and test_plans
--    (added with the platform admin console) are removed. Contract and billing
--    policies for the platform admin are untouched, and organization /
--    membership listing is left as support metadata. Cross-client access to a
--    client's workpapers now requires an explicit membership (logged).
-- 2. Phase 1 tables get the same database-level audit trigger Phase 2 tables
--    already have, so no code path can change a record without an audit event
--    that carries the real actor (auth.uid()). App-level logChange() entries
--    still exist alongside these.
-- Idempotent.
-- ============================================================================
begin;

drop policy if exists "Platform admins can view all controls" on public.controls;
drop policy if exists "Platform admins can view all test plans" on public.test_plans;

do $$
declare t text;
begin
  foreach t in array array[
    'evidence','test_step_evidence','test_plans','client_links','test_steps','evidence_requests',
    'controls','deficiencies','aggregation_groups','icfr_reports','compensating_controls',
    'communications','management_responses','remediation_tasks','review_approvals','certifications',
    'sub_certifications','audit_communications','icfr_changes','access_settings','walkthroughs',
    'populations','sample_items','entities','subsidiary_questionnaires',
    'subsidiary_questionnaire_responses','itgc_systems','itgc_controls','automated_controls',
    'processes','risks','control_risks','reporting_periods'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_p2_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.p2_audit()', t || '_p2_audit', t);
    end if;
  end loop;
end $$;

commit;
