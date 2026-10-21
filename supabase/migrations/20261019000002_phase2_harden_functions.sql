-- Hardening after Supabase security advisor review of 20261019000001.
-- 1) Pin search_path on trigger functions that lacked it.
-- 2) Trigger functions must not be callable through the REST/RPC API. Postgres
--    checks EXECUTE on a trigger function when the trigger is created, not when
--    it fires, so revoking does not stop the triggers.
-- 3) Helper functions used inside RLS policies keep EXECUTE for signed-in users
--    (policy expressions run as the querying role) but not for anon.
-- 4) Only signed-in users may call the two intentional RPCs.
begin;

alter function public.p2_ccm_rule_transition()      set search_path = public;
alter function public.p2_ccm_exception_transition() set search_path = public;
alter function public.p2_follow_up_guard()          set search_path = public;

do $$
declare f text;
begin
  foreach f in array array[
    'p2_audit()', 'p2_assert_same_org()', 'p2_ccm_rule_transition()',
    'p2_ccm_exception_transition()', 'p2_follow_up_guard()', 'p2_ccm_batch_guard()',
    'p2_ccm_summary_guard()', 'p2_follow_up_escalation_authz()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'p2_role(uuid)', 'p2_has_role(uuid, text[])', 'p2_is_internal(uuid)',
    'p2_org_members(uuid)', 'p2_approve_ccm_batch(uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
