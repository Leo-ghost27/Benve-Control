-- Stand-ins for live-production tables that exist there but are not created by
-- the repo's migrations. Shapes copied from the live schema (read-only query).
create table if not exists public.readiness_areas (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  area_name text not null, current_maturity text, target_maturity text, readiness_score numeric,
  status text not null default 'in_progress' check (status in ('in_progress','priority','on_track','complete')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.readiness_gaps (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid references public.readiness_areas(id), requirement text, current_status text, evidence_notes text,
  gap_severity text, owner text, created_at timestamptz not null default now());
create table if not exists public.readiness_roadmap_actions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  gap_id uuid references public.readiness_gaps(id), action_ref text, description text, owner text, target_date date,
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete')), priority text,
  created_at timestamptz not null default now());
do $$ declare t text; begin
  foreach t in array array['readiness_areas','readiness_gaps','readiness_roadmap_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "org members can view %s" on public.%I for select using (is_org_member(organization_id))', replace(t,'_',' '), t);
    execute format('create policy "management and auditors can create %s" on public.%I for insert with check (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))', replace(t,'_',' '), t);
    execute format('create policy "management and auditors can update %s" on public.%I for update using (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))', replace(t,'_',' '), t);
    execute format('create policy "owners can delete %s" on public.%I for delete using (org_role(organization_id) = ''owner'')', replace(t,'_',' '), t);
  end loop; end $$;

-- Module 3 live shapes (read-only query of production)
create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, description text, owner text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, jurisdiction text, functional_scope text, is_parent boolean not null default false,
  status text not null default 'in_progress' check (status in ('in_progress','complete')), created_at timestamptz not null default now());
alter table public.controls add column if not exists entity_id uuid references public.entities(id) on delete set null;
alter table public.deficiencies add column if not exists entity_id uuid references public.entities(id) on delete set null;
alter table public.deficiencies add column if not exists resolved_at timestamptz;
create table if not exists public.subsidiary_questionnaires (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade, period text, prepared_by text, reviewed_by_local text, submitted_to text,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed')), submission_date date, group_reviewed_by text,
  group_review_date date, group_outcome text, follow_up_actions text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.subsidiary_questionnaire_responses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  questionnaire_id uuid not null references public.subsidiary_questionnaires(id) on delete cascade,
  question text, response text, evidence_comments text, follow_up_required text);
do $$ declare t text; begin
  foreach t in array array['processes','entities','subsidiary_questionnaires','subsidiary_questionnaire_responses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "org members can view %s" on public.%I for select using (is_org_member(organization_id))',
      case t when 'subsidiary_questionnaire_responses' then 'questionnaire responses' else replace(t,'_',' ') end, t);
    if t <> 'processes' then
      execute format('create policy "management and auditors can create %s" on public.%I for insert with check (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))',
        case t when 'subsidiary_questionnaire_responses' then 'questionnaire responses' else replace(t,'_',' ') end, t);
      execute format('create policy "management and auditors can update %s" on public.%I for update using (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))',
        case t when 'subsidiary_questionnaire_responses' then 'questionnaire responses' else replace(t,'_',' ') end, t);
    end if;
    execute format('create policy "owners can delete %s" on public.%I for delete using (org_role(organization_id) = ''owner'')',
      case t when 'subsidiary_questionnaire_responses' then 'questionnaire responses' else replace(t,'_',' ') end, t);
  end loop; end $$;
