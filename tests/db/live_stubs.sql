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

-- Priority 2 (session A): populations/sample_items exist live (Task 40s); minimal shapes for the review hash.
create table if not exists public.populations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  test_plan_id uuid not null references public.test_plans(id) on delete cascade, description text, population_size integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.sample_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  population_id uuid not null references public.populations(id) on delete cascade, item_number integer, item_reference text,
  item_value numeric, item_date date, result text, notes text, created_at timestamptz not null default now());
alter table public.populations enable row level security; alter table public.sample_items enable row level security;

-- Priority 2: live test_plans / test_steps columns (Task 40s) that the shared-view tests rely on.
alter table public.test_plans add column if not exists test_type text, add column if not exists period_under_review text,
  add column if not exists population_description text, add column if not exists sampling_approach text,
  add column if not exists sample_size integer, add column if not exists prepared_by text, add column if not exists reviewed_by text;
alter table public.test_steps add column if not exists expected_result text, add column if not exists actual_result text,
  add column if not exists evidence_reference text, add column if not exists auditor_notes text, add column if not exists draft_conclusion text;

-- Priority 2 follow-up: client_links exists live (Task 43 client evidence portal); shape from the live table.
create table if not exists public.client_links (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_name text, owner_email text, token uuid not null default gen_random_uuid(), created_at timestamptz not null default now());
alter table public.client_links enable row level security;
drop policy if exists "Members can view client links" on public.client_links;
create policy "Members can view client links" on public.client_links for select using (is_org_member(organization_id));

-- Priority 2 external read limits: live deficiency/communication tables (Tasks 40-42), minimal shapes + live-style member SELECT policies.
alter table public.deficiencies add column if not exists review_status text not null default 'draft';
create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  deficiency_id uuid references public.deficiencies(id) on delete cascade, comm_ref text, draft_text text,
  status text not null default 'draft' check (status in ('draft','approved','issued')), created_at timestamptz not null default now());
create table if not exists public.management_responses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  communication_id uuid not null references public.communications(id) on delete cascade, response_text text,
  created_at timestamptz not null default now());
create table if not exists public.compensating_controls (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  deficiency_id uuid not null references public.deficiencies(id) on delete cascade, description text,
  created_at timestamptz not null default now());
do $$ declare t text; begin
  foreach t in array array['communications','management_responses','compensating_controls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "org members can view %s" on public.%I', t, t);
    execute format('create policy "org members can view %s" on public.%I for select using (is_org_member(organization_id))', t, t);
  end loop; end $$;

-- ============================================================================
-- Session B (Module 4 ITGC): live shapes for the Phase 1 testing engine and the
-- Task 48 ITGC tables (append-only; production columns/checks as of 2026-10).
-- ============================================================================
alter table public.test_plans
  add column if not exists test_type text, add column if not exists period_under_review text,
  add column if not exists population_description text, add column if not exists sampling_approach text,
  add column if not exists sample_size integer, add column if not exists prepared_by text, add column if not exists reviewed_by text;
alter table public.test_plans alter column status set default 'not_started';
alter table public.test_plans add constraint test_plans_status_check check (status in ('not_started','in_progress','ready_for_review','final'));
alter table public.test_plans add constraint test_plans_test_type_check check (test_type is null or test_type in ('test_of_design','test_of_effectiveness'));
alter table public.test_plans alter column control_id set not null;
alter table public.test_steps
  add column if not exists evidence_reference text, add column if not exists auditor_notes text, add column if not exists draft_conclusion text;
alter table public.test_steps alter column status set default 'not_started';
-- NOTE: production test_steps.status is limited to not_started/pass/exception/not_applicable (check constraint);
-- not stubbed here because other suites still insert 'pending'. See docs/PHASE2_COORDINATION.md (Session B note).

create table if not exists public.itgc_systems (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, system_type text, status text not null default 'in_progress', created_at timestamptz not null default now(),
  constraint itgc_systems_status_check check (status = any (array['in_progress','complete'])));
create table if not exists public.itgc_controls (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id uuid references public.itgc_systems(id) on delete set null, control_ref text, category text, description text, risk text,
  test_approach text, sample_size int, results text, exception_id uuid, deficiency_id uuid references public.deficiencies(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint itgc_controls_category_check check (category is null or category = any (array['access','change','operations'])));
create table if not exists public.automated_controls (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id uuid references public.itgc_systems(id) on delete set null, control_ref text, description text, financial_assertions text[],
  linked_sox_control_id uuid references public.controls(id) on delete set null, frequency text, testing_approach text, results text,
  linked_deficiency_id uuid references public.deficiencies(id) on delete set null, status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint automated_controls_status_check check (status = any (array['active','inactive'])));
do $$ declare t text; begin
  foreach t in array array['itgc_systems','itgc_controls','automated_controls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "org members can view %s" on public.%I for select using (is_org_member(organization_id))', replace(t,'_',' '), t);
    execute format('create policy "management and auditors can create %s" on public.%I for insert with check (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))', replace(t,'_',' '), t);
    execute format('create policy "management and auditors can update %s" on public.%I for update using (org_role(organization_id) = any (array[''owner'',''admin'',''cfo'',''controller'',''internal_auditor'']))', replace(t,'_',' '), t);
    execute format('create policy "owners can delete %s" on public.%I for delete using (org_role(organization_id) = ''owner'')', replace(t,'_',' '), t);
  end loop; end $$;

-- Priority 2 deficiency review: live Task 40 deficiency columns used by the review hash/workflow.
alter table public.deficiencies add column if not exists draft_classification text, add column if not exists classification_rationale text,
  add column if not exists reviewer_id uuid references auth.users(id) on delete set null, add column if not exists review_date date,
  add column if not exists resolved_at timestamptz;
create table if not exists public.aggregation_groups (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  group_ref text, process text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.aggregation_groups enable row level security;
drop policy if exists "org members can view aggregation_groups" on public.aggregation_groups;
create policy "org members can view aggregation_groups" on public.aggregation_groups for select using (is_org_member(organization_id));
