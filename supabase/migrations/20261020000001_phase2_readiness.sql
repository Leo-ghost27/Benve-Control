-- ============================================================================
-- Phase 2 Module 2: Pre-IPO / ICFR readiness
--
-- Extends the existing readiness_areas / readiness_gaps / readiness_roadmap_actions
-- (all empty in production at time of writing) and adds readiness_assessments and
-- readiness_checklist_items. Also introduces p2_approval_guard(), the reusable
-- workflow trigger that Modules 3-6 attach to their own tables.
--
-- Field mapping vs. the Phase 2 brief (existing columns are reused, not duplicated):
--   readiness_gaps.area            -> area_id (FK readiness_areas)
--   readiness_gaps.severity        -> gap_severity (check: high/medium/low)
--   readiness_gaps.status          -> approval workflow status
--   readiness_gaps.description     -> new description column
--   readiness_areas.readiness_score is the manual per-area score (0-100)
--
-- The score is a MANAGEMENT PLANNING ASSESSMENT. Nothing here computes or
-- asserts a regulatory determination.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Reusable approval workflow trigger
--    Works on any table with: status, plus (where present) review_note,
--    submitted_by, submitted_at, reviewed_by, approved_at.
--      draft -> prepared -> submitted -> (returned -> prepared | approved)
--      approved -> reopened (reviewer, fresh note) -> prepared
--      approved -> archived
--    New rows must start as draft. Content is frozen while a record is
--    submitted / approved / archived, and a review transition may not change
--    anything except workflow columns (no editing content while approving).
-- ---------------------------------------------------------------------------
create or replace function public.p2_approval_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  wf text[] := array['status','review_note','submitted_by','submitted_at','reviewed_by','approved_at','updated_at'];
  v_org uuid := (n->>'organization_id')::uuid;
  v_managers text[] := array['owner','admin','cfo','controller'];
  v_from text;
  v_to text := n->>'status';
begin
  if tg_op = 'INSERT' then
    if v_to is distinct from 'draft' then
      raise exception 'New records must start as draft (got %)', v_to using errcode = 'P0001';
    end if;
    return new;
  end if;

  o := to_jsonb(old);
  v_from := o->>'status';

  if v_from is not distinct from v_to then
    -- no status change: frozen once under review / approved / archived
    if v_from in ('submitted','approved','archived')
       and (n - wf) is distinct from (o - wf) then
      raise exception 'Record is % and locked; return or reopen it before editing', v_from using errcode = 'P0001';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if not (
    (v_from = 'draft'     and v_to = 'prepared') or
    (v_from = 'prepared'  and v_to = 'submitted') or
    (v_from = 'submitted' and v_to in ('returned','approved')) or
    (v_from in ('returned','reopened') and v_to = 'prepared') or
    (v_from = 'approved'  and v_to in ('reopened','archived'))
  ) then
    raise exception 'Illegal transition % -> %', v_from, v_to using errcode = 'P0001';
  end if;

  if v_to in ('approved','returned','reopened') and not public.p2_has_role(v_org, v_managers) then
    raise exception 'Only a controller/CFO/admin/owner may move a record to %', v_to using errcode = '42501';
  end if;

  -- review transitions may not smuggle in content edits
  if v_from in ('submitted','approved') and (n - wf) is distinct from (o - wf) then
    raise exception 'Content cannot change during a review transition' using errcode = 'P0001';
  end if;

  if v_to in ('returned','reopened')
     and (n->>'review_note' is not distinct from o->>'review_note'
          or length(btrim(coalesce(n->>'review_note',''))) < 5) then
    raise exception 'A new review note is required when returning or reopening' using errcode = 'P0001';
  end if;

  if v_to = 'submitted' then
    new := jsonb_populate_record(new, jsonb_build_object('submitted_by', auth.uid(), 'submitted_at', now()));
  elsif v_to = 'approved' then
    if auth.uid() is not distinct from nullif(o->>'submitted_by','')::uuid then
      raise exception 'The submitter cannot approve their own record' using errcode = 'P0001';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('reviewed_by', auth.uid(), 'approved_at', now()));
  elsif v_to in ('returned','reopened') then
    new := jsonb_populate_record(new, jsonb_build_object('approved_at', null));
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Extend the same-org guard to the new reference columns
-- ---------------------------------------------------------------------------
create or replace function public.p2_assert_same_org()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  v_org uuid := (j->>'organization_id')::uuid;
  col text;
  tbl text;
  ref uuid;
  ok boolean;
begin
  for col, tbl in
    select cname, tname from (values
      ('control_id','controls'),
      ('reporting_period_id','reporting_periods'),
      ('rule_id','ccm_rules'),
      ('ccm_exception_id','ccm_exceptions'),
      ('linked_deficiency_id','deficiencies'),
      ('deficiency_id','deficiencies'),
      ('linked_exception_id','test_steps'),
      ('evidence_id','evidence'),
      ('related_control_id','controls'),
      ('related_deficiency_id','deficiencies'),
      ('readiness_assessment_id','readiness_assessments'),
      ('assessment_id','readiness_assessments'),
      ('readiness_gap_id','readiness_gaps'),
      ('gap_id','readiness_gaps'),
      ('area_id','readiness_areas')
    ) as t(cname, tname)
  loop
    if j ? col and j->>col is not null then
      ref := (j->>col)::uuid;
      execute format('select exists (select 1 from public.%I where id = $1 and organization_id = $2)', tbl)
        into ok using ref, v_org;
      if not ok then
        raise exception 'Cross-tenant or missing reference: %.% -> %', tg_table_name, col, tbl
          using errcode = '23503';
      end if;
    end if;
  end loop;

  for col in select unnest(array['owner_user_id','assigned_to','created_by','updated_by','prepared_by','reviewed_by','submitted_by'])
  loop
    if j ? col and j->>col is not null then
      select exists (select 1 from public.organization_members
                     where organization_id = v_org and user_id = (j->>col)::uuid) into ok;
      if not ok then
        raise exception 'User in % is not a member of this organization', col using errcode = '23503';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. readiness_assessments (new)
-- ---------------------------------------------------------------------------
create table if not exists public.readiness_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods(id) on delete cascade,
  target_milestone text,
  target_date date,
  current_filer_status text,
  maturity_level text,
  overall_score numeric,
  management_conclusion text,
  assumptions text,
  timeline_risks text,
  status text not null default 'draft',
  prepared_by uuid default auth.uid() references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint readiness_assessments_status check
    (status in ('draft','prepared','submitted','returned','approved','reopened','archived')),
  constraint readiness_assessments_score check (overall_score is null or (overall_score >= 0 and overall_score <= 100)),
  constraint readiness_assessments_maturity check
    (maturity_level is null or maturity_level in ('initial','developing','defined','managed','optimized')),
  constraint readiness_assessments_filer check
    (current_filer_status is null or current_filer_status in
      ('pre_ipo','emerging_growth','non_accelerated','accelerated','large_accelerated','other'))
);
create index if not exists idx_readiness_assessments_org on public.readiness_assessments(organization_id, reporting_period_id);
alter table public.readiness_assessments enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Extend existing tables
-- ---------------------------------------------------------------------------
alter table public.readiness_areas
  add column if not exists assessment_id uuid references public.readiness_assessments(id) on delete cascade,
  add column if not exists score_rationale text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.readiness_areas drop constraint if exists readiness_areas_score_check;
alter table public.readiness_areas add constraint readiness_areas_score_check
  check (readiness_score is null or (readiness_score >= 0 and readiness_score <= 100));
create index if not exists idx_readiness_areas_assessment on public.readiness_areas(assessment_id);

create table if not exists public.readiness_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.readiness_assessments(id) on delete cascade,
  area_id uuid references public.readiness_areas(id) on delete set null,
  item text not null,
  requirement_ref text,
  status text not null default 'not_started',
  evidence_id uuid references public.evidence(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint readiness_checklist_status check (status in ('not_started','in_progress','complete','not_applicable')),
  constraint readiness_checklist_item check (length(btrim(item)) > 0)
);
create index if not exists idx_readiness_checklist_assessment on public.readiness_checklist_items(assessment_id);
alter table public.readiness_checklist_items enable row level security;

alter table public.readiness_gaps
  add column if not exists readiness_assessment_id uuid references public.readiness_assessments(id) on delete cascade,
  add column if not exists description text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists target_date date,
  add column if not exists status text not null default 'draft',
  add column if not exists evidence_id uuid references public.evidence(id) on delete set null,
  add column if not exists related_control_id uuid references public.controls(id) on delete set null,
  add column if not exists related_deficiency_id uuid references public.deficiencies(id) on delete set null,
  add column if not exists remediation_action text,
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists review_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.readiness_gaps drop constraint if exists readiness_gaps_status_check;
alter table public.readiness_gaps add constraint readiness_gaps_status_check
  check (status in ('draft','prepared','submitted','returned','approved','reopened','archived'));
alter table public.readiness_gaps drop constraint if exists readiness_gaps_severity_check;
alter table public.readiness_gaps add constraint readiness_gaps_severity_check
  check (gap_severity is null or gap_severity in ('high','medium','low'));
create index if not exists idx_readiness_gaps_assessment on public.readiness_gaps(readiness_assessment_id);

alter table public.readiness_roadmap_actions
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.follow_ups
  add column if not exists readiness_gap_id uuid references public.readiness_gaps(id) on delete set null;
create index if not exists idx_follow_ups_gap on public.follow_ups(readiness_gap_id);

-- ---------------------------------------------------------------------------
-- 5. Required-field validation per workflow step
-- ---------------------------------------------------------------------------
create or replace function public.p2_readiness_required()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if tg_table_name = 'readiness_assessments' then
    if new.status in ('prepared','submitted','approved') then
      if new.target_milestone is null or btrim(new.target_milestone) = ''
         or new.target_date is null or new.current_filer_status is null
         or new.maturity_level is null or new.overall_score is null then
        raise exception 'Target milestone, target date, filer status, maturity level and overall score are required to prepare an assessment'
          using errcode = 'P0001';
      end if;
    end if;
    if new.status in ('submitted','approved') then
      if length(btrim(coalesce(new.management_conclusion,''))) < 20 then
        raise exception 'A management conclusion (at least 20 characters) is required to submit' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.readiness_areas a
                      where a.assessment_id = new.id and a.readiness_score is not null) then
        raise exception 'Score at least one readiness area before submitting' using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'readiness_gaps' then
    if new.status in ('prepared','submitted','approved') then
      if new.readiness_assessment_id is null or new.gap_severity is null
         or length(btrim(coalesce(new.description,''))) = 0 then
        raise exception 'Assessment, severity and description are required to prepare a gap' using errcode = 'P0001';
      end if;
    end if;
    if new.status in ('submitted','approved') then
      if new.owner_user_id is null or new.target_date is null
         or length(btrim(coalesce(new.remediation_action,''))) = 0 then
        raise exception 'Owner, target date and remediation action are required to submit a gap' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Children of an assessment are frozen while it is under review / approved.
create or replace function public.p2_assessment_child_lock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_assessment uuid;
  v_status text;
begin
  v_assessment := coalesce((to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'assessment_id')::uuid, null);
  if v_assessment is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.readiness_assessments where id = v_assessment;
  if v_status in ('submitted','approved','archived') then
    raise exception 'The assessment is % and locked; return or reopen it to change areas or checklist items', v_status
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.p2_roadmap_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'complete' and new.completed_at is null then new.completed_at := now(); end if;
  if new.status <> 'complete' then new.completed_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.p2_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

create or replace function public.p2_draft_only_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status is distinct from 'draft' then
    raise exception 'Only draft records can be deleted; archive a % record instead', old.status using errcode = 'P0001';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Triggers (order matters: same-org -> required -> approval guard; audit last)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['readiness_assessments','readiness_gaps'] loop
    execute format('drop trigger if exists %1$s_a_same_org on public.%1$I', t);
    execute format('create trigger %1$s_a_same_org before insert or update on public.%1$I for each row execute function public.p2_assert_same_org()', t);
    -- guard first (legal transition / role / lock), then required-field validation
    execute format('drop trigger if exists %1$s_b_required on public.%1$I', t);
    execute format('drop trigger if exists %1$s_c_guard on public.%1$I', t);
    execute format('drop trigger if exists %1$s_b_guard on public.%1$I', t);
    execute format('drop trigger if exists %1$s_c_required on public.%1$I', t);
    execute format('create trigger %1$s_b_guard before insert or update on public.%1$I for each row execute function public.p2_approval_guard()', t);
    execute format('create trigger %1$s_c_required before insert or update on public.%1$I for each row execute function public.p2_readiness_required()', t);
    execute format('drop trigger if exists %1$s_d_draft_delete on public.%1$I', t);
    execute format('create trigger %1$s_d_draft_delete before delete on public.%1$I for each row execute function public.p2_draft_only_delete()', t);
  end loop;

  foreach t in array array['readiness_areas','readiness_checklist_items'] loop
    execute format('drop trigger if exists %1$s_a_same_org on public.%1$I', t);
    execute format('create trigger %1$s_a_same_org before insert or update on public.%1$I for each row execute function public.p2_assert_same_org()', t);
    execute format('drop trigger if exists %1$s_b_lock on public.%1$I', t);
    execute format('create trigger %1$s_b_lock before insert or update or delete on public.%1$I for each row execute function public.p2_assessment_child_lock()', t);
    execute format('drop trigger if exists %1$s_c_touch on public.%1$I', t);
    execute format('create trigger %1$s_c_touch before update on public.%1$I for each row execute function public.p2_touch_updated_at()', t);
  end loop;

  drop trigger if exists readiness_roadmap_actions_a_same_org on public.readiness_roadmap_actions;
  create trigger readiness_roadmap_actions_a_same_org before insert or update on public.readiness_roadmap_actions
    for each row execute function public.p2_assert_same_org();
  drop trigger if exists readiness_roadmap_actions_b_guard on public.readiness_roadmap_actions;
  create trigger readiness_roadmap_actions_b_guard before insert or update on public.readiness_roadmap_actions
    for each row execute function public.p2_roadmap_guard();

  foreach t in array array['readiness_assessments','readiness_gaps','readiness_areas',
                           'readiness_checklist_items','readiness_roadmap_actions'] loop
    execute format('drop trigger if exists %1$s_z_audit on public.%1$I', t);
    execute format('create trigger %1$s_z_audit after insert or update or delete on public.%1$I for each row execute function public.p2_audit()', t);
  end loop;
end $$;

-- the follow_ups table already has same-org + audit triggers from Module 1;
-- readiness_gap_id is covered by the extended p2_assert_same_org() above.

-- ---------------------------------------------------------------------------
-- 7. Row-level security
--    Internal roles see everything. External auditors / viewers see only
--    APPROVED assessments and, through them, approved gaps / areas / checklist.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['readiness_areas','readiness_gaps','readiness_roadmap_actions'] loop
    execute format('drop policy if exists "org members can view %s" on public.%I', replace(t,'_',' '), t);
    execute format('drop policy if exists "management and auditors can create %s" on public.%I', replace(t,'_',' '), t);
    execute format('drop policy if exists "management and auditors can update %s" on public.%I', replace(t,'_',' '), t);
  end loop;
end $$;

drop policy if exists "p2 ra select" on public.readiness_assessments;
create policy "p2 ra select" on public.readiness_assessments for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved'));
drop policy if exists "p2 ra insert" on public.readiness_assessments;
create policy "p2 ra insert" on public.readiness_assessments for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 ra update" on public.readiness_assessments;
create policy "p2 ra update" on public.readiness_assessments for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));
drop policy if exists "p2 ra delete" on public.readiness_assessments;
create policy "p2 ra delete" on public.readiness_assessments for delete
  using (public.p2_has_role(organization_id, array['owner']));

-- areas + checklist: visible externally only when their assessment is approved
do $$
declare t text;
begin
  foreach t in array array['readiness_areas','readiness_checklist_items'] loop
    execute format('drop policy if exists "p2 select" on public.%I', t);
    execute format($p$create policy "p2 select" on public.%I for select using (
      public.p2_is_internal(organization_id)
      or (public.p2_has_role(organization_id, array['external_auditor','viewer'])
          and exists (select 1 from public.readiness_assessments a
                       where a.id = assessment_id and a.status = 'approved')))$p$, t);
    execute format('drop policy if exists "p2 insert" on public.%I', t);
    execute format($p$create policy "p2 insert" on public.%I for insert
      with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']))$p$, t);
    execute format('drop policy if exists "p2 update" on public.%I', t);
    execute format($p$create policy "p2 update" on public.%I for update
      using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))$p$, t);
    execute format('drop policy if exists "p2 delete" on public.%I', t);
    execute format($p$create policy "p2 delete" on public.%I for delete
      using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']))$p$, t);
  end loop;
end $$;

drop policy if exists "p2 select" on public.readiness_gaps;
create policy "p2 select" on public.readiness_gaps for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved'));
drop policy if exists "p2 insert" on public.readiness_gaps;
create policy "p2 insert" on public.readiness_gaps for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 update" on public.readiness_gaps;
create policy "p2 update" on public.readiness_gaps for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

drop policy if exists "p2 select" on public.readiness_roadmap_actions;
create policy "p2 select" on public.readiness_roadmap_actions for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer'])
      and exists (select 1 from public.readiness_gaps g where g.id = gap_id and g.status = 'approved')));
drop policy if exists "p2 insert" on public.readiness_roadmap_actions;
create policy "p2 insert" on public.readiness_roadmap_actions for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 update" on public.readiness_roadmap_actions;
create policy "p2 update" on public.readiness_roadmap_actions for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- ---------------------------------------------------------------------------
-- 8. Trigger functions are not API-callable (same hardening as Module 1)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'p2_approval_guard()','p2_readiness_required()','p2_assessment_child_lock()',
    'p2_roadmap_guard()','p2_touch_updated_at()','p2_draft_only_delete()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
