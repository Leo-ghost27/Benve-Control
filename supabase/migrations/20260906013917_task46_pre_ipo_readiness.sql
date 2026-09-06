-- Task 46 (Pre-IPO / Accelerated Filer Readiness & ICFR Maturity Centre).
-- Illustrative planning tool, management-led - same business+auditor
-- write-role pattern as Task 45/42/43 (owner/admin/cfo/controller/
-- internal_auditor), since readiness assessment spans both.
--
-- Applied directly to the Benve Control Supabase project (version 20260906013917).

begin;

create table public.readiness_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_name text not null,
  current_maturity text,
  target_maturity text,
  readiness_score numeric,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.readiness_areas
  add constraint readiness_areas_status_check
  check (status = any (array['in_progress', 'priority', 'on_track', 'complete']));

alter table public.readiness_areas enable row level security;

create policy "org members can view readiness areas" on public.readiness_areas
  for select using (is_org_member(organization_id));

create policy "management and auditors can create readiness areas" on public.readiness_areas
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update readiness areas" on public.readiness_areas
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete readiness areas" on public.readiness_areas
  for delete using (org_role(organization_id) = 'owner');

create table public.readiness_gaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid references public.readiness_areas(id) on delete cascade,
  requirement text,
  current_status text,
  evidence_notes text,
  gap_severity text,
  owner text,
  created_at timestamptz not null default now()
);

alter table public.readiness_gaps enable row level security;

create policy "org members can view readiness gaps" on public.readiness_gaps
  for select using (is_org_member(organization_id));

create policy "management and auditors can create readiness gaps" on public.readiness_gaps
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update readiness gaps" on public.readiness_gaps
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete readiness gaps" on public.readiness_gaps
  for delete using (org_role(organization_id) = 'owner');

create table public.readiness_roadmap_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  gap_id uuid references public.readiness_gaps(id) on delete set null,
  action_ref text,
  description text,
  owner text,
  target_date date,
  status text not null default 'not_started',
  priority text,
  created_at timestamptz not null default now()
);

alter table public.readiness_roadmap_actions
  add constraint readiness_roadmap_actions_status_check
  check (status = any (array['not_started', 'in_progress', 'complete']));

alter table public.readiness_roadmap_actions enable row level security;

create policy "org members can view readiness roadmap actions" on public.readiness_roadmap_actions
  for select using (is_org_member(organization_id));

create policy "management and auditors can create readiness roadmap actions" on public.readiness_roadmap_actions
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update readiness roadmap actions" on public.readiness_roadmap_actions
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete readiness roadmap actions" on public.readiness_roadmap_actions
  for delete using (org_role(organization_id) = 'owner');

commit;
