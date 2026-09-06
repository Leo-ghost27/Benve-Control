-- Task 45 (Continuous Controls Monitoring & Exception Intelligence Hub).
-- Illustrative, management-led monitoring - write access mirrors the
-- Task 42/43 business-role pattern (owner/admin/cfo/controller) plus
-- internal_auditor, since Task 45 explicitly frames this as
-- "management and the Benve engagement team" jointly, not auditor-only.
--
-- Applied directly to the Benve Control Supabase project (version 20260905154818).

begin;

create table public.ccm_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  rule_ref text,
  description text,
  frequency text,
  severity text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.ccm_rules
  add constraint ccm_rules_status_check check (status = any (array['active', 'inactive']));

alter table public.ccm_rules enable row level security;

create policy "org members can view ccm rules" on public.ccm_rules
  for select using (is_org_member(organization_id));

create policy "management and auditors can create ccm rules" on public.ccm_rules
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update ccm rules" on public.ccm_rules
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete ccm rules" on public.ccm_rules
  for delete using (org_role(organization_id) = 'owner');

create table public.ccm_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid references public.ccm_rules(id) on delete set null,
  control_id uuid references public.controls(id) on delete set null,
  exception_ref text,
  item_date date not null default current_date,
  source_record_ref text,
  amount numeric,
  initial_assessment text,
  linked_deficiency_id uuid references public.deficiencies(id) on delete set null,
  status text not null default 'open',
  owner text,
  created_at timestamptz not null default now()
);

alter table public.ccm_exceptions
  add constraint ccm_exceptions_status_check
  check (status = any (array['open', 'in_review', 'closed']));

alter table public.ccm_exceptions enable row level security;

create policy "org members can view ccm exceptions" on public.ccm_exceptions
  for select using (is_org_member(organization_id));

create policy "management and auditors can create ccm exceptions" on public.ccm_exceptions
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update ccm exceptions" on public.ccm_exceptions
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete ccm exceptions" on public.ccm_exceptions
  for delete using (org_role(organization_id) = 'owner');

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  followup_ref text,
  ccm_exception_id uuid references public.ccm_exceptions(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  owner text,
  root_cause_draft text,
  remediation_action text,
  target_completion date,
  status text not null default 'open',
  escalation_rule text,
  created_at timestamptz not null default now()
);

alter table public.follow_ups
  add constraint follow_ups_status_check
  check (status = any (array['open', 'in_progress', 'closed']));

alter table public.follow_ups enable row level security;

create policy "org members can view follow ups" on public.follow_ups
  for select using (is_org_member(organization_id));

create policy "management and auditors can create follow ups" on public.follow_ups
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update follow ups" on public.follow_ups
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete follow ups" on public.follow_ups
  for delete using (org_role(organization_id) = 'owner');

commit;
