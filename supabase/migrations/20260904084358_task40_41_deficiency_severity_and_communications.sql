-- Task 40 (Deficiency Severity & Aggregation Assessment Centre) and
-- Task 41 (Controlled Deficiency Communication & Remediation Assurance Pack).
--
-- Design choices:
--   - Extends the existing `deficiencies` table in place rather than a
--     parallel table. The existing `severity` column (low/medium/high,
--     used today by the dashboard list page) is left untouched — it's a
--     simple triage field. The new `draft_classification` column is the
--     Task 40 auditor-judgment field (control deficiency / significant
--     deficiency / material weakness), a distinct concept.
--   - IMPORTANT: mirrors the existing guardrail in ai-assist.ts ("never
--     classify or imply a deficiency severity... no material weakness,
--     no significant deficiency"). draft_classification and likelihood
--     must never be populated by the AI-assist feature — auditor-entered
--     only. Not enforced at the DB layer (no AI service role writes to
--     this table today), but documented here so future AI-assist work
--     on deficiencies respects the existing boundary.
--   - No separate `risks` table exists yet (Tasks 1-10 model risk as a
--     text field on `controls.risk_statement`), so `related_risk_summary`
--     stays a text field for consistency rather than introducing a new
--     normalized entity this pass.
--   - remediation_tasks already covers Task 41's remediation-action
--     concept; only adding the two fields it's missing (root_cause,
--     retest_result) rather than a parallel table.
--
-- Applied directly to the Benve Control Supabase project (version 20260904084358).

begin;

-- ============================================================
-- 1. Extend deficiencies with Task 40 severity/aggregation fields
-- ============================================================

alter table public.deficiencies
  add column financial_statement_area text,
  add column assertions text[],
  add column related_risk_summary text,
  add column potential_error_type text,
  add column max_reasonable_exposure numeric,
  add column identified_amount numeric,
  add column planning_materiality numeric,
  add column performance_materiality numeric,
  add column clearly_trivial_threshold numeric,
  add column qualitative_flags jsonb not null default '{}'::jsonb,
  add column potential_impact_analysis text,
  add column likelihood text,
  add column draft_classification text,
  add column classification_rationale text,
  add column reviewer_id uuid references auth.users(id) on delete set null,
  add column review_status text not null default 'draft',
  add column review_date date,
  add column aggregation_group_id uuid;

alter table public.deficiencies
  add constraint deficiencies_likelihood_check
  check (likelihood is null or likelihood = any (array[
    'remote', 'reasonably_possible', 'probable', 'further_analysis_required'
  ]));

alter table public.deficiencies
  add constraint deficiencies_draft_classification_check
  check (draft_classification is null or draft_classification = any (array[
    'control_deficiency', 'significant_deficiency', 'material_weakness', 'further_evaluation_required'
  ]));

alter table public.deficiencies
  add constraint deficiencies_review_status_check
  check (review_status = any (array['draft', 'awaiting_review', 'approved', 'returned']));

-- ============================================================
-- 2. Aggregation groups
-- ============================================================

create table public.aggregation_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_ref text not null,
  process text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deficiencies
  add constraint deficiencies_aggregation_group_id_fkey
  foreign key (aggregation_group_id) references public.aggregation_groups(id) on delete set null;

alter table public.aggregation_groups enable row level security;

create policy "org members can view aggregation groups" on public.aggregation_groups
  for select using (is_org_member(organization_id));

create policy "owners and auditors can create aggregation groups" on public.aggregation_groups
  for insert with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners and auditors can update aggregation groups" on public.aggregation_groups
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete aggregation groups" on public.aggregation_groups
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 3. Compensating controls (Task 40 section B)
-- ============================================================

create table public.compensating_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deficiency_id uuid not null references public.deficiencies(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  control_ref text,
  description text,
  operating_status text,
  assessment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.compensating_controls enable row level security;

create policy "org members can view compensating controls" on public.compensating_controls
  for select using (is_org_member(organization_id));

create policy "owners and auditors can create compensating controls" on public.compensating_controls
  for insert with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners and auditors can update compensating controls" on public.compensating_controls
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete compensating controls" on public.compensating_controls
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 4. Communications (Task 41 sections A-C)
-- ============================================================

create table public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deficiency_id uuid not null references public.deficiencies(id) on delete cascade,
  comm_ref text,
  audience text,
  comm_type text,
  confidentiality text,
  planned_issue_date date,
  draft_text text,
  status text not null default 'draft',
  approved_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz,
  distribution_method text,
  access_period_days integer,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.communications
  add constraint communications_status_check
  check (status = any (array['draft', 'approved', 'issued']));

alter table public.communications enable row level security;

-- External auditors only ever see issued communications, never drafts —
-- mirrors Task 41's "internal workpaper vs client/governance-facing" split.
create policy "org members can view communications" on public.communications
  for select using (
    is_org_member(organization_id)
    and (org_role(organization_id) <> 'external_auditor' or status = 'issued')
  );

create policy "owners and auditors can draft communications" on public.communications
  for insert with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners and auditors can update communications" on public.communications
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete communications" on public.communications
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 5. Management responses (Task 41 section C)
-- ============================================================

create table public.management_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  communication_id uuid not null references public.communications(id) on delete cascade,
  response_text text,
  responded_by text,
  response_date date,
  status text not null default 'received',
  created_at timestamptz not null default now()
);

alter table public.management_responses enable row level security;

create policy "org members can view management responses" on public.management_responses
  for select using (
    is_org_member(organization_id)
    and (
      org_role(organization_id) <> 'external_auditor'
      or exists (
        select 1 from public.communications c
        where c.id = management_responses.communication_id and c.status = 'issued'
      )
    )
  );

create policy "business and audit roles can record management responses" on public.management_responses
  for insert with check (
    org_role(organization_id) = any (array[
      'owner','admin','internal_auditor','cfo','controller','adviser'
    ])
  );

create policy "owners and auditors can update management responses" on public.management_responses
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete management responses" on public.management_responses
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 6. Extend remediation_tasks with Task 41 fields
-- ============================================================

alter table public.remediation_tasks
  add column root_cause text,
  add column retest_result text;

commit;
