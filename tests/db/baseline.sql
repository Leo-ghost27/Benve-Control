-- Test-only baseline: emulates Supabase auth + the live-schema drift found in
-- the repo (org_role() fn, controls.title/risk_rating, 8-role model).
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text);
