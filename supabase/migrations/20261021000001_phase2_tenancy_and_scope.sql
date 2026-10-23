-- ============================================================================
-- Phase 2 / Priority 1: firm + client workspaces, team access, archival,
-- controlled deletion requests, and client scope sign-off.
--
-- Model (additive; organization_id stays the tenant key everywhere):
--   * organization kind 'firm'   = the operator (e.g. GHG Consulting).
--   * organization kind 'client' = one confidential engagement workspace,
--     linked to its firm through organizations.firm_id.
--   * Firm membership grants NO access to any client workspace. Access to a
--     client exists only through an explicit organization_members row in that
--     client (creating a client, accepting an invitation, or a reasoned and
--     logged firm_access_claimed). Nothing here reads across clients.
--
-- Enforcement is in the database:
--   * organization_members is writable only through the functions below
--     (direct INSERT/UPDATE/DELETE by signed-in users is rejected), which
--     closes the admin -> owner escalation the older policies allowed.
--   * Organizations cannot be hard-deleted through the API. Deletion is a
--     request/approval record that respects retention and legal hold; the
--     purge itself is deliberately NOT implemented here.
--   * Protected org columns (kind, firm_id, status, archive fields) change
--     only through functions.
-- Idempotent: every statement can be re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Organization kind / firm link / archive state
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists kind text not null default 'client'
    check (kind in ('firm','client')),
  add column if not exists firm_id uuid references public.organizations(id) on delete restrict,
  add column if not exists status text not null default 'active'
    check (status in ('active','archived')),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;
create index if not exists idx_orgs_firm on public.organizations(firm_id);

create table if not exists public.client_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text,
  industry text,
  fiscal_year_end text,
  primary_contact_name text,
  primary_contact_email text,
  engagement_type text,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.client_profiles enable row level security;
drop policy if exists "p2 members view client profile" on public.client_profiles;
create policy "p2 members view client profile" on public.client_profiles
  for select using (public.is_org_member(organization_id));
drop policy if exists "p2 managers edit client profile" on public.client_profiles;
create policy "p2 managers edit client profile" on public.client_profiles
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']))
  with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.p2_valid_role(p_role text)
returns boolean language sql immutable set search_path = public as $$
  select p_role = any (array['owner','admin','cfo','controller','internal_auditor',
                             'external_auditor','adviser','viewer']);
$$;

create or replace function public.p2_is_firm_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organizations c
    join public.organization_members fm
      on fm.organization_id = c.firm_id and fm.user_id = auth.uid()
     and fm.role::text in ('owner','admin')
    where c.id = p_org);
$$;

create or replace function public.p2_user_label(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.full_name,''), u.email::text, p_user::text)
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user;
$$;

create or replace function public.p2_log(p_org uuid, p_action text, p_type text, p_id uuid, p_meta jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), p_action, p_type, p_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- Explicit per-engagement permissions (a role alone never confers these).
create table if not exists public.engagement_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null check (permission in ('review.approve','scope.sign')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, permission)
);
alter table public.engagement_permissions enable row level security;
drop policy if exists "p2 view permissions" on public.engagement_permissions;
create policy "p2 view permissions" on public.engagement_permissions
  for select using (user_id = auth.uid()
                    or public.p2_has_role(organization_id, array['owner','admin']));

create or replace function public.p2_has_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.engagement_permissions
                 where organization_id = p_org and user_id = auth.uid() and permission = p_perm);
$$;

-- ---------------------------------------------------------------------------
-- 3. Organization guards (protected columns, no API hard-delete) + audit
-- ---------------------------------------------------------------------------
create or replace function public.p2_org_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'DELETE' then
      raise exception 'Organizations cannot be deleted directly: use the deletion-request workflow'
        using errcode = 'P0001';
    elsif tg_op = 'INSERT' then
      if new.kind <> 'client' or new.firm_id is not null or new.status <> 'active' then
        raise exception 'Use the firm/client functions to create firms and clients' using errcode = 'P0001';
      end if;
    elsif (new.kind, new.firm_id, new.status, new.archived_at, new.archived_by, new.archive_reason)
          is distinct from
          (old.kind, old.firm_id, old.status, old.archived_at, old.archived_by, old.archive_reason) then
      raise exception 'Firm link, kind and archive state change only through workspace functions'
        using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists orgs_guard on public.organizations;
create trigger orgs_guard before insert or update or delete on public.organizations
  for each row execute function public.p2_org_guard();

create or replace function public.p2_org_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (new.id, auth.uid(), 'created', 'organizations', new.id, jsonb_build_object('kind', new.kind));
  else
    select array_agg(k) into v_changed
      from jsonb_object_keys(to_jsonb(new)) k
     where k <> 'updated_at' and to_jsonb(new)->k is distinct from to_jsonb(old)->k;
    if v_changed is not null then
      insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (new.id, auth.uid(), 'updated', 'organizations', new.id,
              jsonb_build_object('changed_fields', to_jsonb(v_changed)));
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists orgs_audit on public.organizations;
create trigger orgs_audit after insert or update on public.organizations
  for each row execute function public.p2_org_audit();

-- ---------------------------------------------------------------------------
-- 4. Membership guard: no direct writes by signed-in users
--    (only the very first owner row of a brand-new org may be self-inserted)
-- ---------------------------------------------------------------------------
create or replace function public.p2_member_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT'
       and new.role::text = 'owner' and new.user_id = auth.uid()
       and not exists (select 1 from public.organization_members m
                       where m.organization_id = new.organization_id) then
      return new;
    end if;
    raise exception 'Membership changes go through the invitation / team functions'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists members_guard on public.organization_members;
create trigger members_guard before insert or update or delete on public.organization_members
  for each row execute function public.p2_member_guard();
drop trigger if exists members_audit on public.organization_members;
create trigger members_audit after insert or update or delete on public.organization_members
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 5. Firm and client lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.p2_slug(p_name text)
returns text language sql immutable set search_path = public as $$
  select left(regexp_replace(regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'), 50)
         || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
$$;

create or replace function public.p2_create_firm(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Firm name is required'; end if;
  insert into public.organizations (name, slug, kind) values (trim(p_name), public.p2_slug(p_name), 'firm')
    returning id into v_org;
  execute format('insert into public.organization_members (organization_id, user_id, role) values (%L, %L, ''owner'')',
                 v_org, auth.uid());
  perform public.p2_log(v_org, 'firm_created', 'organizations', v_org, '{}');
  return v_org;
end; $$;

-- Convert an existing organization you own into the firm (no firm_id, not a client of another firm).
create or replace function public.p2_convert_to_firm(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_has_role(p_org, array['owner']) then
    raise exception 'Only the organization owner can convert it to a firm' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = p_org and firm_id is not null) then
    raise exception 'A client workspace cannot become a firm';
  end if;
  update public.organizations set kind = 'firm' where id = p_org;
  perform public.p2_log(p_org, 'converted_to_firm', 'organizations', p_org, '{}');
end; $$;

create or replace function public.p2_create_client(
  p_firm uuid, p_name text, p_legal_name text default null, p_industry text default null,
  p_fiscal_year_end text default null, p_contact_name text default null,
  p_contact_email text default null, p_engagement_type text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not exists (select 1 from public.organizations f
                 join public.organization_members m on m.organization_id = f.id
                 where f.id = p_firm and f.kind = 'firm' and f.status = 'active'
                   and m.user_id = auth.uid() and m.role::text in ('owner','admin')) then
    raise exception 'Only an owner or admin of the firm can create client workspaces' using errcode = '42501';
  end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Client name is required'; end if;
  insert into public.organizations (name, slug, kind, firm_id)
    values (trim(p_name), public.p2_slug(p_name), 'client', p_firm) returning id into v_org;
  insert into public.client_profiles (organization_id, legal_name, industry, fiscal_year_end,
                                      primary_contact_name, primary_contact_email, engagement_type)
    values (v_org, p_legal_name, p_industry, p_fiscal_year_end, p_contact_name, p_contact_email, p_engagement_type);
  -- The creator becomes the engagement owner of this one workspace (explicit, logged).
  execute format('insert into public.organization_members (organization_id, user_id, role) values (%L, %L, ''owner'')',
                 v_org, auth.uid());
  insert into public.org_retention_settings (organization_id) values (v_org) on conflict do nothing;
  perform public.p2_log(v_org, 'client_created', 'organizations', v_org,
                        jsonb_build_object('firm_id', p_firm, 'creator_granted_role', 'owner'));
  return v_org;
end; $$;

create or replace function public.p2_firm_clients(p_firm uuid)
returns table (id uuid, name text, status text, created_at timestamptz, i_am_member boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organization_members m
                 where m.organization_id = p_firm and m.user_id = auth.uid()
                   and m.role::text in ('owner','admin')) then
    return;
  end if;
  -- Metadata only: names and status, never workpapers.
  return query
    select c.id, c.name, c.status, c.created_at,
           exists (select 1 from public.organization_members x
                   where x.organization_id = c.id and x.user_id = auth.uid())
    from public.organizations c where c.firm_id = p_firm order by c.name;
end; $$;

create or replace function public.p2_my_workspaces()
returns table (org_id uuid, name text, kind text, status text, role text, firm_id uuid, firm_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.kind, o.status, m.role::text, o.firm_id, f.name
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  left join public.organizations f on f.id = o.firm_id
  where m.user_id = auth.uid()
  order by (o.status = 'archived'), o.kind desc, o.name;
$$;

-- Firm owners/admins may add themselves to a client of their firm, with a
-- mandatory reason; this is the only cross-client route and it is logged.
create or replace function public.p2_claim_client_access(p_org uuid, p_role text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_is_firm_admin(p_org) then
    raise exception 'Only a firm owner or admin can claim access to a client of the firm' using errcode = '42501';
  end if;
  -- Never owner/admin: elevated roles in a client come only from the client's own owner.
  if p_role not in ('internal_auditor','adviser','viewer') then
    raise exception 'Invalid role for firm access';
  end if;
  if length(coalesce(trim(p_reason),'')) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  if exists (select 1 from public.organization_members where organization_id = p_org and user_id = auth.uid()) then
    raise exception 'You already have access to this workspace';
  end if;
  execute format('insert into public.organization_members (organization_id, user_id, role) values (%L, %L, %L)',
                 p_org, auth.uid(), p_role);
  perform public.p2_log(p_org, 'firm_access_claimed', 'organization_members', null,
                        jsonb_build_object('role', p_role, 'reason', trim(p_reason)));
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Invitations (hashed single-use tokens; link is shown to the inviter once)
-- ---------------------------------------------------------------------------
create table if not exists public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner','admin','cfo','controller','internal_auditor',
                                     'external_auditor','adviser','viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_org_invitations_org on public.org_invitations(organization_id);
create unique index if not exists uq_org_invitations_pending
  on public.org_invitations(organization_id, lower(email)) where status = 'pending';
alter table public.org_invitations enable row level security;
drop policy if exists "p2 managers view invitations" on public.org_invitations;
create policy "p2 managers view invitations" on public.org_invitations
  for select using (public.p2_has_role(organization_id, array['owner','admin']));
drop trigger if exists org_invitations_audit on public.org_invitations;
create trigger org_invitations_audit after insert or update or delete on public.org_invitations
  for each row execute function public.p2_audit();

-- Owners may grant any role; admins may not grant or touch owner/admin.
create or replace function public.p2_can_grant(p_org uuid, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.p2_role(p_org)
    when 'owner' then public.p2_valid_role(p_role)
    when 'admin' then public.p2_valid_role(p_role) and p_role not in ('owner','admin')
    else false end;
$$;

create or replace function public.p2_invite_member(p_org uuid, p_email text, p_role text)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid; v_email text := lower(trim(coalesce(p_email,'')));
begin
  if not public.p2_can_grant(p_org, p_role) then
    raise exception 'You are not allowed to invite someone as %', p_role using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
  if exists (select 1 from public.organizations where id = p_org and status = 'archived') then
    raise exception 'Archived workspaces cannot be changed';
  end if;
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
             where m.organization_id = p_org and lower(u.email::text) = v_email) then
    raise exception 'That person already has access to this workspace';
  end if;
  update public.org_invitations set status = 'revoked'
   where organization_id = p_org and lower(email) = v_email and status = 'pending' and expires_at < now();
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.org_invitations (organization_id, email, role, token_hash, invited_by)
    values (p_org, v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
    returning id into v_id;
  invitation_id := v_id; token := v_token;
  return next;
end; $$;

create or replace function public.p2_accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.org_invitations%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into inv from public.org_invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token,''), 'UTF8')), 'hex') for update;
  if not found or inv.status <> 'pending' or inv.expires_at < now() then
    raise exception 'This invitation is invalid, expired or already used' using errcode = 'P0001';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = auth.uid();
  if v_email is distinct from lower(inv.email) then
    raise exception 'This invitation was issued to a different email address' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = inv.organization_id and status = 'archived') then
    raise exception 'This workspace is archived';
  end if;
  if exists (select 1 from public.organization_members
             where organization_id = inv.organization_id and user_id = auth.uid()) then
    raise exception 'You already have access to this workspace';
  end if;
  execute format('insert into public.organization_members (organization_id, user_id, role) values (%L, %L, %L)',
                 inv.organization_id, auth.uid(), inv.role);
  update public.org_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   where id = inv.id;
  return inv.organization_id;
end; $$;

create or replace function public.p2_revoke_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.org_invitations%rowtype;
begin
  select * into inv from public.org_invitations where id = p_invitation;
  if not found or not public.p2_can_grant(inv.organization_id, inv.role) then
    raise exception 'Invitation not found or not permitted' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then raise exception 'Only pending invitations can be revoked'; end if;
  update public.org_invitations set status = 'revoked' where id = p_invitation;
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Team management (change role / remove / explicit permissions)
-- ---------------------------------------------------------------------------
create or replace function public.p2_change_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  select m.role::text into v_old from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_user;
  if v_old is null then raise exception 'Member not found'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if not public.p2_can_grant(p_org, p_role) or not public.p2_can_grant(p_org, v_old) then
    raise exception 'You are not allowed to make this role change' using errcode = '42501';
  end if;
  if v_old = 'owner' and p_role <> 'owner'
     and (select count(*) from public.organization_members
          where organization_id = p_org and role::text = 'owner') <= 1 then
    raise exception 'A workspace must keep at least one owner';
  end if;
  execute format('update public.organization_members set role = %L where organization_id = %L and user_id = %L',
                 p_role, p_org, p_user);
  perform public.p2_log(p_org, 'member_role_changed', 'organization_members', null,
                        jsonb_build_object('user_id', p_user, 'from', v_old, 'to', p_role));
end; $$;

create or replace function public.p2_remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  select m.role::text into v_old from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_user;
  if v_old is null then raise exception 'Member not found'; end if;
  if not (p_user = auth.uid() or public.p2_can_grant(p_org, v_old)) then
    raise exception 'You are not allowed to remove this member' using errcode = '42501';
  end if;
  if v_old = 'owner' and (select count(*) from public.organization_members
                          where organization_id = p_org and role::text = 'owner') <= 1 then
    raise exception 'A workspace must keep at least one owner';
  end if;
  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  delete from public.engagement_permissions where organization_id = p_org and user_id = p_user;
  perform public.p2_log(p_org, 'member_removed', 'organization_members', null,
                        jsonb_build_object('user_id', p_user, 'role', v_old));
end; $$;

create or replace function public.p2_set_permission(p_org uuid, p_user uuid, p_perm text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_has_role(p_org, array['owner','admin']) then
    raise exception 'Only an owner or admin can assign engagement permissions' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then
    raise exception 'Permissions can only be assigned to members of this workspace';
  end if;
  if p_granted then
    insert into public.engagement_permissions (organization_id, user_id, permission, granted_by)
      values (p_org, p_user, p_perm, auth.uid()) on conflict do nothing;
  else
    delete from public.engagement_permissions
     where organization_id = p_org and user_id = p_user and permission = p_perm;
  end if;
  perform public.p2_log(p_org, case when p_granted then 'permission_granted' else 'permission_revoked' end,
                        'engagement_permissions', null,
                        jsonb_build_object('user_id', p_user, 'permission', p_perm));
end; $$;

-- ---------------------------------------------------------------------------
-- 8. Retention, legal hold, archive, deletion requests
-- ---------------------------------------------------------------------------
create table if not exists public.org_retention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  retention_years integer not null default 7 check (retention_years between 1 and 99),
  retention_until date,
  legal_hold boolean not null default false,
  legal_hold_reason text,
  legal_hold_set_by uuid references auth.users(id) on delete set null,
  legal_hold_set_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.org_retention_settings enable row level security;
drop policy if exists "p2 internal view retention" on public.org_retention_settings;
create policy "p2 internal view retention" on public.org_retention_settings
  for select using (public.p2_is_internal(organization_id) or public.p2_is_firm_admin(organization_id));

create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_deletion_requests_open
  on public.deletion_requests(organization_id) where status = 'requested';
alter table public.deletion_requests enable row level security;
drop policy if exists "p2 view deletion requests" on public.deletion_requests;
create policy "p2 view deletion requests" on public.deletion_requests
  for select using (public.p2_has_role(organization_id, array['owner','admin'])
                    or public.p2_is_firm_admin(organization_id));
drop trigger if exists deletion_requests_audit on public.deletion_requests;
create trigger deletion_requests_audit after insert or update or delete on public.deletion_requests
  for each row execute function public.p2_audit();

create or replace function public.p2_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.p2_has_role(p_org, array['owner','admin']) or public.p2_is_firm_admin(p_org);
$$;

create or replace function public.p2_set_retention(p_org uuid, p_years integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_org_admin(p_org) then raise exception 'Not permitted' using errcode = '42501'; end if;
  insert into public.org_retention_settings (organization_id, retention_years, updated_at)
    values (p_org, p_years, now())
    on conflict (organization_id) do update set retention_years = excluded.retention_years, updated_at = now();
  update public.org_retention_settings s
     set retention_until = (o.archived_at + make_interval(years => s.retention_years))::date
    from public.organizations o
   where s.organization_id = p_org and o.id = p_org and o.archived_at is not null;
  perform public.p2_log(p_org, 'retention_changed', 'org_retention_settings', p_org,
                        jsonb_build_object('retention_years', p_years));
end; $$;

create or replace function public.p2_set_legal_hold(p_org uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_org_admin(p_org) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if length(coalesce(trim(p_reason),'')) < 5 then raise exception 'A reason is required'; end if;
  insert into public.org_retention_settings (organization_id, legal_hold, legal_hold_reason,
                                             legal_hold_set_by, legal_hold_set_at, updated_at)
    values (p_org, p_on, trim(p_reason), auth.uid(), now(), now())
    on conflict (organization_id) do update
      set legal_hold = excluded.legal_hold, legal_hold_reason = excluded.legal_hold_reason,
          legal_hold_set_by = excluded.legal_hold_set_by, legal_hold_set_at = now(), updated_at = now();
  perform public.p2_log(p_org, case when p_on then 'legal_hold_placed' else 'legal_hold_released' end,
                        'org_retention_settings', p_org, jsonb_build_object('reason', trim(p_reason)));
end; $$;

create or replace function public.p2_archive_client(p_org uuid, p_confirm_name text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.organizations%rowtype;
begin
  select * into o from public.organizations where id = p_org;
  if not found or o.kind <> 'client' then raise exception 'Client workspace not found'; end if;
  if not public.p2_org_admin(p_org) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if o.status = 'archived' then raise exception 'Already archived'; end if;
  if p_confirm_name is distinct from o.name then
    raise exception 'Confirmation failed: type the exact client name to archive it' using errcode = 'P0001';
  end if;
  if length(coalesce(trim(p_reason),'')) < 5 then raise exception 'A reason is required'; end if;
  update public.organizations
     set status = 'archived', archived_at = now(), archived_by = auth.uid(), archive_reason = trim(p_reason)
   where id = p_org;
  insert into public.org_retention_settings (organization_id) values (p_org) on conflict do nothing;
  update public.org_retention_settings
     set retention_until = (now() + make_interval(years => retention_years))::date, updated_at = now()
   where organization_id = p_org;
  perform public.p2_log(p_org, 'client_archived', 'organizations', p_org,
                        jsonb_build_object('reason', trim(p_reason)));
end; $$;

create or replace function public.p2_restore_client(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_org_admin(p_org) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and status = 'archived') then
    raise exception 'Workspace is not archived';
  end if;
  if length(coalesce(trim(p_reason),'')) < 5 then raise exception 'A reason is required'; end if;
  update public.organizations set status = 'active', archived_at = null, archived_by = null, archive_reason = null
   where id = p_org;
  update public.org_retention_settings set retention_until = null, updated_at = now() where organization_id = p_org;
  perform public.p2_log(p_org, 'client_restored', 'organizations', p_org,
                        jsonb_build_object('reason', trim(p_reason)));
end; $$;

create or replace function public.p2_request_deletion(p_org uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.p2_org_admin(p_org) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'client' and status = 'archived') then
    raise exception 'Only archived client workspaces can be the subject of a deletion request';
  end if;
  if length(coalesce(trim(p_reason),'')) < 10 then raise exception 'A reason of at least 10 characters is required'; end if;
  insert into public.deletion_requests (organization_id, requested_by, reason)
    values (p_org, auth.uid(), trim(p_reason)) returning id into v_id;
  return v_id;
end; $$;

-- Approval records the decision only. It never deletes data.
create or replace function public.p2_decide_deletion(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.deletion_requests%rowtype; s public.org_retention_settings%rowtype; o public.organizations%rowtype;
        v_authorised boolean;
begin
  select * into r from public.deletion_requests where id = p_request for update;
  if not found or r.status <> 'requested' then raise exception 'Request not found or already decided'; end if;
  select * into o from public.organizations where id = r.organization_id;
  if r.requested_by = auth.uid() then
    raise exception 'The requester cannot decide their own deletion request' using errcode = 'P0001';
  end if;
  v_authorised := case when o.firm_id is not null then public.p2_is_firm_admin(o.id)
                       else public.p2_has_role(o.id, array['owner']) end;
  if not v_authorised then raise exception 'Not permitted' using errcode = '42501'; end if;
  if p_approve then
    select * into s from public.org_retention_settings where organization_id = o.id;
    if s.legal_hold then
      raise exception 'Blocked: this workspace is under legal hold' using errcode = 'P0001';
    end if;
    if s.retention_until is null or s.retention_until > current_date then
      raise exception 'Blocked: retention period runs until %', coalesce(s.retention_until::text, 'an undetermined date')
        using errcode = 'P0001';
    end if;
  elsif length(coalesce(trim(p_note),'')) < 5 then
    raise exception 'A note is required to reject';
  end if;
  update public.deletion_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note),'')
   where id = p_request;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. Engagement scope + client sign-off (approval bound to an exact version)
-- ---------------------------------------------------------------------------
create table if not exists public.engagement_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods(id) on delete restrict,
  title text not null,
  objective text,
  scope_summary text,
  exclusions text,
  status text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  version integer not null default 1,
  content_hash text,
  created_by uuid references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_scopes_org_period on public.engagement_scopes(organization_id, reporting_period_id);

create table if not exists public.engagement_scope_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_id uuid not null references public.engagement_scopes(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  entity_id uuid references public.entities(id) on delete set null,
  description text not null,
  rationale text,
  created_at timestamptz not null default now()
);
create index if not exists idx_scope_items_scope on public.engagement_scope_items(scope_id);

-- Append-only record of every decision, with the exact version/hash decided on.
create table if not exists public.scope_signoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_id uuid not null references public.engagement_scopes(id) on delete cascade,
  version integer not null,
  content_hash text,
  decision text not null check (decision in ('approved','returned','reopened')),
  signer_id uuid references auth.users(id) on delete set null,
  signer_name text,
  signer_role text,
  comment text,
  signed_at timestamptz not null default now()
);
create index if not exists idx_scope_signoffs_scope on public.scope_signoffs(scope_id);

alter table public.engagement_scopes enable row level security;
alter table public.engagement_scope_items enable row level security;
alter table public.scope_signoffs enable row level security;

drop policy if exists "p2 scopes select" on public.engagement_scopes;
create policy "p2 scopes select" on public.engagement_scopes for select
  using (public.p2_is_internal(organization_id)
         or (status = 'approved' and public.p2_has_role(organization_id, array['external_auditor','viewer'])));
drop policy if exists "p2 scopes insert" on public.engagement_scopes;
create policy "p2 scopes insert" on public.engagement_scopes for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 scopes update" on public.engagement_scopes;
create policy "p2 scopes update" on public.engagement_scopes for update
  using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']))
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 scopes delete" on public.engagement_scopes;
create policy "p2 scopes delete" on public.engagement_scopes for delete
  using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));

drop policy if exists "p2 scope items select" on public.engagement_scope_items;
create policy "p2 scope items select" on public.engagement_scope_items for select
  using (exists (select 1 from public.engagement_scopes s where s.id = scope_id));
drop policy if exists "p2 scope items write" on public.engagement_scope_items;
create policy "p2 scope items write" on public.engagement_scope_items for all
  using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']))
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));

drop policy if exists "p2 signoffs select" on public.scope_signoffs;
create policy "p2 signoffs select" on public.scope_signoffs for select
  using (exists (select 1 from public.engagement_scopes s where s.id = scope_id));

create or replace function public.p2_scope_hash(p_scope uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce(s.title,'') || E'\x1f' || coalesce(s.objective,'') || E'\x1f' ||
    coalesce(s.scope_summary,'') || E'\x1f' || coalesce(s.exclusions,'') || E'\x1f' ||
    s.reporting_period_id::text || E'\x1e' ||
    coalesce((select string_agg(coalesce(i.control_id::text,'') || '|' || coalesce(i.entity_id::text,'') || '|' ||
                                i.description || '|' || coalesce(i.rationale,''), E'\x1e' order by i.id)
              from public.engagement_scope_items i where i.scope_id = s.id), ''),
    'UTF8')), 'hex')
  from public.engagement_scopes s where s.id = p_scope;
$$;

create or replace function public.p2_scope_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated','anon') then
      if new.status <> 'draft' or new.version <> 1 or new.content_hash is not null then
        raise exception 'A scope must start as a draft' using errcode = 'P0001';
      end if;
      new.created_by := auth.uid();
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft scopes can be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if current_user in ('authenticated','anon') then
    if (new.status, new.version, new.content_hash, new.submitted_by, new.submitted_at,
        new.decided_by, new.decided_at, new.decision_note)
       is distinct from
       (old.status, old.version, old.content_hash, old.submitted_by, old.submitted_at,
        old.decided_by, old.decided_at, old.decision_note) then
      raise exception 'Scope workflow fields change only through the workflow functions' using errcode = 'P0001';
    end if;
    if old.status not in ('draft','returned') then
      raise exception 'Scope is locked (%): reopen it with a rationale to edit', old.status using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists scopes_guard on public.engagement_scopes;
create trigger scopes_guard before insert or update or delete on public.engagement_scopes
  for each row execute function public.p2_scope_guard();
drop trigger if exists scopes_same_org on public.engagement_scopes;
create trigger scopes_same_org before insert or update on public.engagement_scopes
  for each row execute function public.p2_assert_same_org();
drop trigger if exists scopes_audit on public.engagement_scopes;
create trigger scopes_audit after insert or update or delete on public.engagement_scopes
  for each row execute function public.p2_audit();

create or replace function public.p2_scope_item_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_status text; v_org uuid; v_scope uuid := coalesce(new.scope_id, old.scope_id);
begin
  select status, organization_id into v_status, v_org from public.engagement_scopes where id = v_scope;
  if found and v_status not in ('draft','returned') then
    raise exception 'Scope is locked (%): reopen it with a rationale to edit', v_status using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if found and new.organization_id <> v_org then
      raise exception 'Cross-tenant scope item' using errcode = '23503';
    end if;
    if new.entity_id is not null and not exists
       (select 1 from public.entities e where e.id = new.entity_id and e.organization_id = new.organization_id) then
      raise exception 'Cross-tenant or missing reference: entity' using errcode = '23503';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists scope_items_guard on public.engagement_scope_items;
create trigger scope_items_guard before insert or update or delete on public.engagement_scope_items
  for each row execute function public.p2_scope_item_guard();
drop trigger if exists scope_items_same_org on public.engagement_scope_items;
create trigger scope_items_same_org before insert or update on public.engagement_scope_items
  for each row execute function public.p2_assert_same_org();
drop trigger if exists scope_items_audit on public.engagement_scope_items;
create trigger scope_items_audit after insert or update or delete on public.engagement_scope_items
  for each row execute function public.p2_audit();

create or replace function public.p2_submit_scope(p_scope uuid)
returns text language plpgsql security definer set search_path = public as $$
declare s public.engagement_scopes%rowtype; v_hash text;
begin
  select * into s from public.engagement_scopes where id = p_scope for update;
  if not found or not public.p2_has_role(s.organization_id, array['owner','admin','internal_auditor']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if s.status not in ('draft','returned') then raise exception 'Only a draft or returned scope can be submitted'; end if;
  if coalesce(trim(s.scope_summary),'') = '' then raise exception 'A scope summary is required to submit'; end if;
  if not exists (select 1 from public.engagement_scope_items where scope_id = p_scope) then
    raise exception 'At least one scope item is required to submit';
  end if;
  v_hash := public.p2_scope_hash(p_scope);
  update public.engagement_scopes
     set status = 'submitted', content_hash = v_hash, submitted_by = auth.uid(), submitted_at = now(),
         decided_by = null, decided_at = null, decision_note = null
   where id = p_scope;
  return v_hash;
end; $$;

create or replace function public.p2_decide_scope(p_scope uuid, p_decision text, p_comment text, p_expected_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.engagement_scopes%rowtype; v_now text;
begin
  select * into s from public.engagement_scopes where id = p_scope for update;
  if not found then raise exception 'Scope not found'; end if;
  if not (public.p2_has_role(s.organization_id, array['cfo','controller'])
          or public.p2_has_perm(s.organization_id, 'scope.sign')) then
    raise exception 'Only the client''s CFO/controller or a designated signatory can decide a scope'
      using errcode = '42501';
  end if;
  if p_decision not in ('approved','returned') then raise exception 'Decision must be approved or returned'; end if;
  if s.status <> 'submitted' then raise exception 'Scope is not awaiting a decision (%)', s.status; end if;
  if s.submitted_by = auth.uid() then
    raise exception 'The person who submitted the scope cannot decide it' using errcode = 'P0001';
  end if;
  v_now := public.p2_scope_hash(p_scope);
  if v_now is distinct from s.content_hash or p_expected_hash is distinct from s.content_hash then
    raise exception 'The scope changed or is not the version you reviewed: reload and review again'
      using errcode = 'P0001';
  end if;
  if p_decision = 'returned' and length(coalesce(trim(p_comment),'')) < 5 then
    raise exception 'A comment is required when returning a scope';
  end if;
  update public.engagement_scopes
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_comment),'')
   where id = p_scope;
  insert into public.scope_signoffs (organization_id, scope_id, version, content_hash, decision,
                                     signer_id, signer_name, signer_role, comment)
    values (s.organization_id, p_scope, s.version, s.content_hash, p_decision, auth.uid(),
            public.p2_user_label(auth.uid()), public.p2_role(s.organization_id), nullif(trim(p_comment),''));
end; $$;

create or replace function public.p2_reopen_scope(p_scope uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.engagement_scopes%rowtype;
begin
  select * into s from public.engagement_scopes where id = p_scope for update;
  if not found or not public.p2_has_role(s.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if s.status <> 'approved' then raise exception 'Only an approved scope can be reopened'; end if;
  if length(coalesce(trim(p_reason),'')) < 10 then
    raise exception 'A rationale of at least 10 characters is required to reopen';
  end if;
  insert into public.scope_signoffs (organization_id, scope_id, version, content_hash, decision,
                                     signer_id, signer_name, signer_role, comment)
    values (s.organization_id, p_scope, s.version, s.content_hash, 'reopened', auth.uid(),
            public.p2_user_label(auth.uid()), public.p2_role(s.organization_id), trim(p_reason));
  update public.engagement_scopes
     set status = 'draft', version = s.version + 1, content_hash = null, submitted_by = null, submitted_at = null,
         decided_by = null, decided_at = null, decision_note = null
   where id = p_scope;
end; $$;

-- ---------------------------------------------------------------------------
-- 10. Function privileges: signed-in users only; triggers not callable via API
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'p2_org_guard()','p2_org_audit()','p2_member_guard()','p2_scope_guard()','p2_scope_item_guard()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'p2_valid_role(text)','p2_is_firm_admin(uuid)','p2_user_label(uuid)','p2_has_perm(uuid, text)',
    'p2_can_grant(uuid, text)','p2_org_admin(uuid)','p2_scope_hash(uuid)',
    'p2_create_firm(text)','p2_convert_to_firm(uuid)',
    'p2_create_client(uuid, text, text, text, text, text, text, text)',
    'p2_firm_clients(uuid)','p2_my_workspaces()','p2_claim_client_access(uuid, text, text)',
    'p2_invite_member(uuid, text, text)','p2_accept_invitation(text)','p2_revoke_invitation(uuid)',
    'p2_change_member_role(uuid, uuid, text)','p2_remove_member(uuid, uuid)',
    'p2_set_permission(uuid, uuid, text, boolean)','p2_set_retention(uuid, integer)',
    'p2_set_legal_hold(uuid, boolean, text)','p2_archive_client(uuid, text, text)',
    'p2_restore_client(uuid, text)','p2_request_deletion(uuid, text)',
    'p2_decide_deletion(uuid, boolean, text)','p2_submit_scope(uuid)',
    'p2_decide_scope(uuid, text, text, text)','p2_reopen_scope(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers: never callable through the API
  revoke all on function public.p2_log(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
  revoke all on function public.p2_slug(text) from public, anon, authenticated;
end $$;

commit;
