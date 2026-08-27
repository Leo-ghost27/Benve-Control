-- ============================================================================
-- Benve Control — Initial schema
-- Multi-tenant compliance platform
--
-- Tables:
--   organizations, organization_members, controls, test_plans, test_steps,
--   evidence, test_step_evidence, deficiencies, remediation_tasks, audit_log
--
-- Notes:
--   - All primary keys are UUIDs (gen_random_uuid()).
--   - Every client-owned table carries organization_id and has RLS enabled.
--   - Access is scoped to organizations the requesting user belongs to,
--     via the org_role enum: owner, auditor, client, viewer.
--   - No service-role key is referenced anywhere in this migration; all
--     policies rely on auth.uid() and are evaluated under RLS as the
--     authenticated user.
--   - No sample/seed data is included.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared helpers
-- ----------------------------------------------------------------------------

create type org_role as enum ('owner', 'auditor', 'client', 'viewer');

-- Generic updated_at trigger
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- organization_members
-- ----------------------------------------------------------------------------

create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            org_role not null default 'viewer',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_org_members_org_id on organization_members(organization_id);
create index idx_org_members_user_id on organization_members(user_id);

create trigger organization_members_set_updated_at
  before update on organization_members
  for each row execute function set_updated_at();

-- Membership helpers (security definer so they can be used inside RLS
-- policies on organization_members itself without recursive-policy issues).

create or replace function is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function get_org_role(p_org_id uuid)
returns org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from organization_members m
  where m.organization_id = p_org_id
    and m.user_id = auth.uid()
  limit 1;
$$;

-- owner / auditor / client can create and edit records; viewer is read-only.
create or replace function has_org_write_access(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select get_org_role(p_org_id) in ('owner', 'auditor', 'client');
$$;

create or replace function is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select get_org_role(p_org_id) = 'owner';
$$;

-- ----------------------------------------------------------------------------
-- controls
-- ----------------------------------------------------------------------------

create table controls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code            text,
  name            text not null,
  description     text,
  framework       text,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_controls_org_id on controls(organization_id);

create trigger controls_set_updated_at
  before update on controls
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- test_plans
-- ----------------------------------------------------------------------------

create table test_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  control_id      uuid references controls(id) on delete set null,
  name            text not null,
  description     text,
  status          text not null default 'draft',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_test_plans_org_id on test_plans(organization_id);
create index idx_test_plans_control_id on test_plans(control_id);

create trigger test_plans_set_updated_at
  before update on test_plans
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- test_steps
-- ----------------------------------------------------------------------------

create table test_steps (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  test_plan_id    uuid not null references test_plans(id) on delete cascade,
  step_number     integer not null,
  description     text not null,
  expected_result text,
  actual_result   text,
  status          text not null default 'pending',
  performed_by    uuid references auth.users(id) on delete set null,
  performed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (test_plan_id, step_number)
);

create index idx_test_steps_org_id on test_steps(organization_id);
create index idx_test_steps_plan_id on test_steps(test_plan_id);

create trigger test_steps_set_updated_at
  before update on test_steps
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- evidence
-- ----------------------------------------------------------------------------

create table evidence (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  file_name       text not null,
  storage_path    text not null,
  mime_type       text,
  file_size_bytes bigint,
  description     text,
  due_date        date,
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_evidence_org_id on evidence(organization_id);
create index idx_evidence_due_date on evidence(due_date);

create trigger evidence_set_updated_at
  before update on evidence
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- test_step_evidence (join table)
-- ----------------------------------------------------------------------------

create table test_step_evidence (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  test_step_id    uuid not null references test_steps(id) on delete cascade,
  evidence_id     uuid not null references evidence(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (test_step_id, evidence_id)
);

create index idx_tse_org_id on test_step_evidence(organization_id);
create index idx_tse_test_step_id on test_step_evidence(test_step_id);
create index idx_tse_evidence_id on test_step_evidence(evidence_id);

-- ----------------------------------------------------------------------------
-- deficiencies
-- ----------------------------------------------------------------------------

create table deficiencies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  test_step_id    uuid references test_steps(id) on delete set null,
  control_id      uuid references controls(id) on delete set null,
  title           text not null,
  description     text,
  severity        text not null default 'medium',
  status          text not null default 'open',
  identified_by   uuid references auth.users(id) on delete set null,
  identified_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_deficiencies_org_id on deficiencies(organization_id);
create index idx_deficiencies_test_step_id on deficiencies(test_step_id);
create index idx_deficiencies_control_id on deficiencies(control_id);

create trigger deficiencies_set_updated_at
  before update on deficiencies
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- remediation_tasks
-- ----------------------------------------------------------------------------

create table remediation_tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  deficiency_id   uuid not null references deficiencies(id) on delete cascade,
  title           text not null,
  description     text,
  assigned_to     uuid references auth.users(id) on delete set null,
  due_date        date,
  status          text not null default 'open',
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_remediation_org_id on remediation_tasks(organization_id);
create index idx_remediation_deficiency_id on remediation_tasks(deficiency_id);
create index idx_remediation_assigned_to on remediation_tasks(assigned_to);

create trigger remediation_tasks_set_updated_at
  before update on remediation_tasks
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- audit_log
-- Immutable event log — no updated_at, no update/delete policies.
-- ----------------------------------------------------------------------------

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id) on delete set null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index idx_audit_log_org_id on audit_log(organization_id);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);
create index idx_audit_log_created_at on audit_log(created_at);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table controls enable row level security;
alter table test_plans enable row level security;
alter table test_steps enable row level security;
alter table evidence enable row level security;
alter table test_step_evidence enable row level security;
alter table deficiencies enable row level security;
alter table remediation_tasks enable row level security;
alter table audit_log enable row level security;

-- ---- organizations ----------------------------------------------------

create policy "Members can view their organizations"
  on organizations for select
  using (is_org_member(id));

create policy "Owners can update their organization"
  on organizations for update
  using (is_org_owner(id))
  with check (is_org_owner(id));

-- Any authenticated user may create an organization; they are not yet a
-- member of any org at creation time, so this is intentionally unrestricted
-- beyond requiring authentication. Membership (as owner) is granted by a
-- separate insert into organization_members performed by the application.
create policy "Authenticated users can create organizations"
  on organizations for insert
  with check (auth.uid() is not null);

create policy "Owners can delete their organization"
  on organizations for delete
  using (is_org_owner(id));

-- ---- organization_members ----------------------------------------------

create policy "Members can view membership of their organizations"
  on organization_members for select
  using (is_org_member(organization_id));

create policy "Owners can manage membership"
  on organization_members for insert
  with check (is_org_owner(organization_id));

create policy "Owners can update membership"
  on organization_members for update
  using (is_org_owner(organization_id))
  with check (is_org_owner(organization_id));

create policy "Owners can remove membership"
  on organization_members for delete
  using (is_org_owner(organization_id));

-- ---- controls ------------------------------------------------------------

create policy "Members can view controls"
  on controls for select
  using (is_org_member(organization_id));

create policy "Writers can insert controls"
  on controls for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update controls"
  on controls for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete controls"
  on controls for delete
  using (is_org_owner(organization_id));

-- ---- test_plans ------------------------------------------------------------

create policy "Members can view test plans"
  on test_plans for select
  using (is_org_member(organization_id));

create policy "Writers can insert test plans"
  on test_plans for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update test plans"
  on test_plans for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete test plans"
  on test_plans for delete
  using (is_org_owner(organization_id));

-- ---- test_steps ------------------------------------------------------------

create policy "Members can view test steps"
  on test_steps for select
  using (is_org_member(organization_id));

create policy "Writers can insert test steps"
  on test_steps for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update test steps"
  on test_steps for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete test steps"
  on test_steps for delete
  using (is_org_owner(organization_id));

-- ---- evidence ------------------------------------------------------------

create policy "Members can view evidence"
  on evidence for select
  using (is_org_member(organization_id));

create policy "Writers can insert evidence"
  on evidence for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update evidence"
  on evidence for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete evidence"
  on evidence for delete
  using (is_org_owner(organization_id));

-- ---- test_step_evidence ---------------------------------------------------

create policy "Members can view test step evidence links"
  on test_step_evidence for select
  using (is_org_member(organization_id));

create policy "Writers can link evidence to test steps"
  on test_step_evidence for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can unlink evidence from test steps"
  on test_step_evidence for delete
  using (has_org_write_access(organization_id));

-- ---- deficiencies ----------------------------------------------------------

create policy "Members can view deficiencies"
  on deficiencies for select
  using (is_org_member(organization_id));

create policy "Writers can insert deficiencies"
  on deficiencies for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update deficiencies"
  on deficiencies for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete deficiencies"
  on deficiencies for delete
  using (is_org_owner(organization_id));

-- ---- remediation_tasks ------------------------------------------------------

create policy "Members can view remediation tasks"
  on remediation_tasks for select
  using (is_org_member(organization_id));

create policy "Writers can insert remediation tasks"
  on remediation_tasks for insert
  with check (has_org_write_access(organization_id));

create policy "Writers can update remediation tasks"
  on remediation_tasks for update
  using (has_org_write_access(organization_id))
  with check (has_org_write_access(organization_id));

create policy "Owners can delete remediation tasks"
  on remediation_tasks for delete
  using (is_org_owner(organization_id));

-- ---- audit_log -------------------------------------------------------------
-- Append-only: members can read, any member with write access can insert,
-- no one can update or delete via the client.

create policy "Members can view audit log"
  on audit_log for select
  using (is_org_member(organization_id));

create policy "Writers can append to audit log"
  on audit_log for insert
  with check (has_org_write_access(organization_id));
