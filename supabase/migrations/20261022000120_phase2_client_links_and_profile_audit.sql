-- ============================================================================
-- Phase 2 / Priority 2 follow-up hardening
--  1. client_links stores the client portal token in plaintext and any workspace
--     member (including external_auditor / viewer) could read it, which would let
--     them use a client's evidence-upload link. Raw SELECT is limited to the
--     internal roles that issue those links. The client portal itself uses the
--     service role and is unaffected.
--  2. client_profiles edits get the standard audit trigger.
-- Idempotent.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.client_links') is not null then
    drop policy if exists "p2 internal only client links" on public.client_links;
    create policy "p2 internal only client links" on public.client_links as restrictive for select
      using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));
  end if;
end $$;

drop trigger if exists client_profiles_audit on public.client_profiles;
create trigger client_profiles_audit after insert or update or delete on public.client_profiles
  for each row execute function public.p2_audit();

commit;
