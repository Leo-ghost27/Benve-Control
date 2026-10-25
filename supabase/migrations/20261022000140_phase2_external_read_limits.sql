-- ============================================================================
-- Phase 2 / Priority 2: external auditors and viewers see only REVIEWED / ISSUED
-- deficiency material.
--
-- Before: any workspace member (including external_auditor / viewer) could SELECT
-- every deficiency (incl. draft severity analysis and rationale), remediation task,
-- compensating control, draft communication and management response.
-- Now (RESTRICTIVE policies, AND-ed with the existing permissive ones; internal
-- roles are unaffected, service role bypasses RLS):
--   deficiencies             -> only review_status = 'approved'
--   compensating_controls    -> only for an approved deficiency
--   remediation_tasks        -> only for an approved deficiency
--   communications           -> only status = 'issued'
--   management_responses     -> only for an issued communication
-- Intentionally left open for the auditor hub: walkthroughs, evidence_requests,
-- audit_communications, access_settings, controls, processes, risks, itgc_*.
-- Not covered here (flagged): aggregation_groups, icfr_changes.
-- Idempotent.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.deficiencies') is not null then
    drop policy if exists "p2 external sees reviewed only" on public.deficiencies;
    create policy "p2 external sees reviewed only" on public.deficiencies as restrictive for select
      using (public.p2_is_internal(organization_id) or review_status = 'approved');
  end if;
  if to_regclass('public.compensating_controls') is not null then
    drop policy if exists "p2 external sees reviewed only" on public.compensating_controls;
    create policy "p2 external sees reviewed only" on public.compensating_controls as restrictive for select
      using (public.p2_is_internal(organization_id) or exists
             (select 1 from public.deficiencies d where d.id = deficiency_id and d.review_status = 'approved'));
  end if;
  if to_regclass('public.remediation_tasks') is not null then
    drop policy if exists "p2 external sees reviewed only" on public.remediation_tasks;
    create policy "p2 external sees reviewed only" on public.remediation_tasks as restrictive for select
      using (public.p2_is_internal(organization_id) or exists
             (select 1 from public.deficiencies d where d.id = deficiency_id and d.review_status = 'approved'));
  end if;
  if to_regclass('public.communications') is not null then
    drop policy if exists "p2 external sees issued only" on public.communications;
    create policy "p2 external sees issued only" on public.communications as restrictive for select
      using (public.p2_is_internal(organization_id) or status = 'issued');
  end if;
  if to_regclass('public.management_responses') is not null then
    drop policy if exists "p2 external sees issued only" on public.management_responses;
    create policy "p2 external sees issued only" on public.management_responses as restrictive for select
      using (public.p2_is_internal(organization_id) or exists
             (select 1 from public.communications c where c.id = communication_id and c.status = 'issued'));
  end if;
end $$;

commit;
