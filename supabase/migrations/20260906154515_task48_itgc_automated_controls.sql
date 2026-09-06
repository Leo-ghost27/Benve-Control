-- Task 48 (ITGC Depth & Automated Control Assurance Studio).
-- Same business+auditor write-role pattern as Task 45/46 - ITGC
-- workpapers are prepared jointly by IT/management and the auditor.
--
-- Applied directly to the Benve Control Supabase project (version 20260906154515).

begin;

create table public.itgc_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  system_type text,
  status text not null default 'in_progress',
  created_at timestamptz not null default now()
);

alter table public.itgc_systems
  add constraint itgc_systems_status_check
  check (status = any (array['in_progress', 'complete']));

alter table public.itgc_systems enable row level security;

create policy "org members can view itgc systems" on public.itgc_systems
  for select using (is_org_member(organization_id));

create policy "management and auditors can create itgc systems" on public.itgc_systems
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update itgc systems" on public.itgc_systems
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete itgc systems" on public.itgc_systems
  for delete using (org_role(organization_id) = 'owner');

create table public.itgc_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id uuid references public.itgc_systems(id) on delete set null,
  control_ref text,
  category text, -- access / change / operations
  description text,
  risk text,
  test_approach text,
  sample_size int,
  results text,
  exception_id uuid,
  deficiency_id uuid references public.deficiencies(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.itgc_controls
  add constraint itgc_controls_category_check
  check (category is null or category = any (array['access', 'change', 'operations']));

alter table public.itgc_controls enable row level security;

create policy "org members can view itgc controls" on public.itgc_controls
  for select using (is_org_member(organization_id));

create policy "management and auditors can create itgc controls" on public.itgc_controls
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update itgc controls" on public.itgc_controls
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete itgc controls" on public.itgc_controls
  for delete using (org_role(organization_id) = 'owner');

create table public.automated_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id uuid references public.itgc_systems(id) on delete set null,
  control_ref text,
  description text,
  financial_assertions text[],
  linked_sox_control_id uuid references public.controls(id) on delete set null,
  frequency text,
  testing_approach text,
  results text,
  linked_deficiency_id uuid references public.deficiencies(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.automated_controls
  add constraint automated_controls_status_check
  check (status = any (array['active', 'inactive']));

alter table public.automated_controls enable row level security;

create policy "org members can view automated controls" on public.automated_controls
  for select using (is_org_member(organization_id));

create policy "management and auditors can create automated controls" on public.automated_controls
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update automated controls" on public.automated_controls
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete automated controls" on public.automated_controls
  for delete using (org_role(organization_id) = 'owner');

commit;
