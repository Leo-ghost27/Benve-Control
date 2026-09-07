-- Platform admin console: contract drafting/e-signature + Stripe billing.
-- New scope beyond Tasks 1-50 (Eve's explicit request to sell her SOX
-- audit engagements through this app - contract-to-cash workflow).
--
-- NOTE: the platform-admin identity piece of this migration (the
-- 'profiles' table + its is_platform_admin column/policies) was
-- superseded by a concurrent session's migration
-- (20260907081516_add_platform_admin_role, applied moments after this
-- one) which independently built the same concept as a separate
-- 'platform_admins' table and replaced the is_platform_admin()
-- function to read from it. See 20260907081516_reconcile_platform_admin_concurrent_change.sql
-- for the follow-up that reconciles the two. 'contracts' and
-- 'organization_billing' below are unaffected - they call
-- is_platform_admin() rather than reading any column directly, so they
-- kept working correctly through the reconciliation.
--
-- Design choices:
--   - 'contracts' has a nullable organization_id: a contract is drafted
--     and sent BEFORE the client has an account/organization. Signing
--     is via a public token-based link (mirrors the existing
--     'client_links' token pattern already used for evidence requests),
--     not requiring the client to log in.
--   - 'organization_billing' is a separate 1:1 table rather than adding
--     columns directly to 'organizations' (owned by the core schema
--     migration from an earlier session) - keeps the billing concern
--     isolated and easy to reason about/revert independently.
--
-- Applied directly to the Benve Control Supabase project (version 20260907080324).

begin;

-- ============================================================
-- 1. Platform admin identity (superseded - see note above)
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users can view their own profile" on public.profiles
  for select using (id = auth.uid());

create policy "platform admins can view all profiles" on public.profiles
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_platform_admin)
  );

create policy "users can update their own profile" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and is_platform_admin = (select is_platform_admin from public.profiles where id = auth.uid()));

insert into public.profiles (id, is_platform_admin)
select id, (email = 'gina.hamza@proton.me') from auth.users
on conflict (id) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;
revoke execute on function public.is_platform_admin() from anon;

-- ============================================================
-- 2. Contracts (draft -> sent -> signed), token-based public signing
-- ============================================================

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  client_name text not null,
  client_email text not null,
  title text not null default 'SOX 404 / ICFR Advisory Engagement Letter',
  body_text text not null,
  status text not null default 'draft',
  access_token uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  signed_at timestamptz,
  signer_name text,
  signer_title text,
  signer_ip text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contracts
  add constraint contracts_status_check
  check (status = any (array['draft', 'sent', 'signed', 'declined']));

create unique index contracts_access_token_idx on public.contracts (access_token);

alter table public.contracts enable row level security;

create policy "platform admins can view contracts" on public.contracts
  for select using (is_platform_admin());

create policy "platform admins can create contracts" on public.contracts
  for insert with check (is_platform_admin());

create policy "platform admins can update contracts" on public.contracts
  for update using (is_platform_admin());

create policy "platform admins can delete contracts" on public.contracts
  for delete using (is_platform_admin());

-- ============================================================
-- 3. Billing (1:1 with organizations)
-- ============================================================

create table public.organization_billing (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  billing_status text not null default 'none',
  trial_end date,
  current_period_end date,
  updated_at timestamptz not null default now()
);

alter table public.organization_billing
  add constraint organization_billing_status_check
  check (billing_status = any (array['none', 'trialing', 'active', 'past_due', 'canceled']));

alter table public.organization_billing enable row level security;

create policy "org owners can view own billing" on public.organization_billing
  for select using (is_org_member(organization_id) and org_role(organization_id) = any (array['owner','admin']));

create policy "platform admins can view all billing" on public.organization_billing
  for select using (is_platform_admin());

create policy "platform admins can manage billing" on public.organization_billing
  for insert with check (is_platform_admin());

create policy "platform admins can update billing" on public.organization_billing
  for update using (is_platform_admin());

commit;
