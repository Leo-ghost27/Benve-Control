-- Task 47 (Multi-Entity / Group ICFR Roll-Up & Subsidiary Assurance Hub).
--
-- No 'entities' table existed yet (the app has been single-entity-per-org
-- so far). Adds it plus nullable entity_id FKs on controls/deficiencies
-- so existing single-entity orgs are unaffected (both columns default
-- null, existing 3 controls/0 deficiencies rows untouched) while
-- multi-entity orgs can scope records to a specific subsidiary.
--
-- Group roll-up (Task 47 sec 1 table) is intentionally NOT a stored
-- table - it's a live aggregate query over entities/controls/deficiencies
-- filtered by organization_id, built in the page itself.
--
-- Applied directly to the Benve Control Supabase project (version 20260906075446).

begin;

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  jurisdiction text,
  functional_scope text,
  is_parent boolean not null default false,
  status text not null default 'in_progress',
  created_at timestamptz not null default now()
);

alter table public.entities
  add constraint entities_status_check
  check (status = any (array['in_progress', 'complete']));

alter table public.entities enable row level security;

create policy "org members can view entities" on public.entities
  for select using (is_org_member(organization_id));

create policy "management and auditors can create entities" on public.entities
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update entities" on public.entities
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete entities" on public.entities
  for delete using (org_role(organization_id) = 'owner');

-- Optional entity scoping on existing tables (nullable, non-breaking)
alter table public.controls add column entity_id uuid references public.entities(id) on delete set null;
alter table public.deficiencies add column entity_id uuid references public.entities(id) on delete set null;

create table public.subsidiary_questionnaires (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  period text,
  prepared_by text,
  reviewed_by_local text,
  submitted_to text,
  status text not null default 'draft',
  submission_date date,
  group_reviewed_by text,
  group_review_date date,
  group_outcome text,
  follow_up_actions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subsidiary_questionnaires
  add constraint subsidiary_questionnaires_status_check
  check (status = any (array['draft', 'submitted', 'reviewed']));

alter table public.subsidiary_questionnaires enable row level security;

create policy "org members can view subsidiary questionnaires" on public.subsidiary_questionnaires
  for select using (is_org_member(organization_id));

create policy "management and auditors can create subsidiary questionnaires" on public.subsidiary_questionnaires
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update subsidiary questionnaires" on public.subsidiary_questionnaires
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete subsidiary questionnaires" on public.subsidiary_questionnaires
  for delete using (org_role(organization_id) = 'owner');

create table public.subsidiary_questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  questionnaire_id uuid not null references public.subsidiary_questionnaires(id) on delete cascade,
  question text,
  response text,
  evidence_comments text,
  follow_up_required text
);

alter table public.subsidiary_questionnaire_responses enable row level security;

create policy "org members can view questionnaire responses" on public.subsidiary_questionnaire_responses
  for select using (is_org_member(organization_id));

create policy "management and auditors can create questionnaire responses" on public.subsidiary_questionnaire_responses
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "management and auditors can update questionnaire responses" on public.subsidiary_questionnaire_responses
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete questionnaire responses" on public.subsidiary_questionnaire_responses
  for delete using (org_role(organization_id) = 'owner');

commit;
