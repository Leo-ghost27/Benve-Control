-- Reconciliation with a concurrent session's migration
-- (20260907081516_add_platform_admin_role), which independently built
-- the same "platform admin" concept as a separate 'platform_admins'
-- join table and replaced the is_platform_admin() function to read
-- from it instead of my 'profiles.is_platform_admin' column.
--
-- Keeping their table as canonical (it already wired broader read-access
-- policies onto organizations/organization_members/controls/test_plans
-- that mine didn't) rather than fighting the current DB state. My
-- contracts/organization_billing policies already call
-- is_platform_admin() rather than reading the profiles column directly,
-- so they need no changes - they'll work correctly once someone is
-- actually in platform_admins.
--
-- 1. Backfill the one real admin (GHG Consulting owner) into the
--    now-canonical platform_admins table.
-- 2. Drop the redundant is_platform_admin column + its policies from
--    'profiles' so there is exactly one source of truth. 'profiles'
--    itself is kept (harmless, may be useful for full_name later).
--
-- Applied directly to the Benve Control Supabase project (version 20260907193247).

begin;

insert into public.platform_admins (user_id)
select id from auth.users where email = 'gina.hamza@proton.me'
on conflict (user_id) do nothing;

drop policy if exists "platform admins can view all profiles" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;

alter table public.profiles drop column is_platform_admin;

create policy "users can update their own profile" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

commit;
