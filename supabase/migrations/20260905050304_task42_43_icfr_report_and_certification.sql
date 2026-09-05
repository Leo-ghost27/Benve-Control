-- Task 42 (Management's Annual Report on ICFR, SOX 404(a)) and
-- Task 43 (SOX 302 Quarterly & Annual Certification Pack).
--
-- Design choices:
--   - New 'review_approvals' table is a lightweight, reusable review-trail
--     record (mirrors the entity_type/entity_id polymorphic pattern already
--     used by audit_log, rather than inventing a new pattern). Used by both
--     icfr_reports and certifications for their "Review and Approval Trail"
--     tables (Task 42 sec B, Task 43 sec 3C/4C).
--   - icfr_reports and certifications are both drafted/approved primarily
--     by business-side roles (CFO/Controller), unlike the auditor-led
--     deficiency tables from Task 40/41 - so write access is
--     owner/admin/cfo/controller rather than owner/admin/internal_auditor.
--   - 'icfr_changes' is a real child table (Task 43 sec 3A lists these as
--     repeatable rows, not a single field), linked to certifications.
--
-- Applied directly to the Benve Control Supabase project (version 20260905050304).

begin;

-- ============================================================
-- 1. Task 42 - Management's Annual Report on ICFR
-- ============================================================

create table public.icfr_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  as_of_date date,
  framework text not null default 'COSO 2013 Internal Control – Integrated Framework',
  scope_notes text,
  mw_conclusion text,
  mw_rationale text,
  icfr_conclusion text,
  draft_text text,
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.icfr_reports
  add constraint icfr_reports_mw_conclusion_check
  check (mw_conclusion is null or mw_conclusion = any (array[
    'no_material_weakness', 'material_weakness_identified', 'in_progress'
  ]));

alter table public.icfr_reports
  add constraint icfr_reports_icfr_conclusion_check
  check (icfr_conclusion is null or icfr_conclusion = any (array[
    'effective', 'not_effective', 'pending'
  ]));

alter table public.icfr_reports
  add constraint icfr_reports_status_check
  check (status = any (array['draft', 'under_review', 'approved']));

alter table public.icfr_reports enable row level security;

create policy "org members can view icfr reports" on public.icfr_reports
  for select using (is_org_member(organization_id));

create policy "business roles can create icfr reports" on public.icfr_reports
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "business roles can update icfr reports" on public.icfr_reports
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "owners can delete icfr reports" on public.icfr_reports
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 2. Reusable review/approval trail (Task 42 sec B, Task 43 sec 3C/4C)
-- ============================================================

create table public.review_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null, -- 'icfr_report' | 'certification'
  target_id uuid not null,
  reviewer_name text,
  reviewer_role text,
  status text not null default 'pending', -- pending / reviewed / approved
  review_date date,
  comments text,
  created_at timestamptz not null default now()
);

alter table public.review_approvals enable row level security;

create policy "org members can view review approvals" on public.review_approvals
  for select using (is_org_member(organization_id));

create policy "business roles can create review approvals" on public.review_approvals
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "business roles can update review approvals" on public.review_approvals
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "owners can delete review approvals" on public.review_approvals
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 3. Task 43 - SOX 302 Certification Pack
-- ============================================================

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period text not null, -- e.g. "Q3 2026"
  dcp_evaluation_period text,
  dcp_evaluated_by text,
  dcp_methodology text,
  dcp_conclusion text,
  dcp_rationale text,
  draft_text text,
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.certifications
  add constraint certifications_dcp_conclusion_check
  check (dcp_conclusion is null or dcp_conclusion = any (array[
    'effective', 'not_effective', 'in_progress'
  ]));

alter table public.certifications
  add constraint certifications_status_check
  check (status = any (array['draft', 'under_review', 'approved']));

alter table public.certifications enable row level security;

create policy "org members can view certifications" on public.certifications
  for select using (is_org_member(organization_id));

create policy "business roles can create certifications" on public.certifications
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "business roles can update certifications" on public.certifications
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "owners can delete certifications" on public.certifications
  for delete using (org_role(organization_id) = 'owner');

-- Sub-certifications (Task 43 sec 3B)
create table public.sub_certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certification_id uuid not null references public.certifications(id) on delete cascade,
  name text,
  role text,
  area text,
  status text not null default 'pending',
  signed_date date
);

alter table public.sub_certifications
  add constraint sub_certifications_status_check
  check (status = any (array['signed', 'pending']));

alter table public.sub_certifications enable row level security;

create policy "org members can view sub certifications" on public.sub_certifications
  for select using (is_org_member(organization_id));

create policy "business roles can create sub certifications" on public.sub_certifications
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "business roles can update sub certifications" on public.sub_certifications
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller']));

create policy "owners can delete sub certifications" on public.sub_certifications
  for delete using (org_role(organization_id) = 'owner');

-- ICFR changes during the period (Task 43 sec 3A)
create table public.icfr_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certification_id uuid not null references public.certifications(id) on delete cascade,
  description text,
  affected_control_id uuid references public.controls(id) on delete set null,
  related_deficiency_id uuid references public.deficiencies(id) on delete set null,
  remediation_status text,
  dcp_impact text,
  created_at timestamptz not null default now()
);

alter table public.icfr_changes enable row level security;

create policy "org members can view icfr changes" on public.icfr_changes
  for select using (is_org_member(organization_id));

create policy "business and audit roles can create icfr changes" on public.icfr_changes
  for insert with check (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "business and audit roles can update icfr changes" on public.icfr_changes
  for update using (org_role(organization_id) = any (array['owner','admin','cfo','controller','internal_auditor']));

create policy "owners can delete icfr changes" on public.icfr_changes
  for delete using (org_role(organization_id) = 'owner');

commit;
