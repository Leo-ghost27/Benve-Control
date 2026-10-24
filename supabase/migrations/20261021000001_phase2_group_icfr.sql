-- ============================================================================
-- Phase 2 Module 3: Multi-entity and group ICFR
--
-- Extends entities / subsidiary_questionnaires / subsidiary_questionnaire_responses
-- (all empty in production at time of writing) and adds entity_processes,
-- entity_controls and group_icfr_summaries.
--
-- Field mapping vs. the Phase 2 brief:
--   entities.display_name            -> existing "name" column
--   entities.legal_name              -> new column
--   subsidiary_questionnaires.submitted_at -> new timestamptz (legacy submission_date kept)
--   subsidiary_questionnaires.review_notes -> review_note (shared workflow column)
--   questionnaire_responses.comments -> existing evidence_comments
--
-- Control scope: controls.entity_id IS NULL  => group-level control
--                controls.entity_id = X      => entity-level control of X
-- Roll-up attributes every control / deficiency / exception / test plan to
-- exactly ONE bucket (its entity, or "group"), so totals cannot double-count.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. p2_approval_guard: allow a table to declare extra workflow-owned columns
--    via trigger argument (e.g. group_review_status). Behaviour otherwise
--    identical to Module 2.
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
  if tg_nargs > 0 and tg_argv[0] <> '' then
    wf := wf || string_to_array(tg_argv[0], ',');
  end if;

  if tg_op = 'INSERT' then
    if v_to is distinct from 'draft' then
      raise exception 'New records must start as draft (got %)', v_to using errcode = 'P0001';
    end if;
    return new;
  end if;

  o := to_jsonb(old);
  v_from := o->>'status';

  if v_from is not distinct from v_to then
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
-- 2. Generic parent lock: children are frozen while the parent is under review /
--    approved. Args: parent table, fk column. For questionnaire responses the
--    reviewer may still link a follow-up (follow_up_id) on a submitted record.
-- ---------------------------------------------------------------------------
create or replace function public.p2_parent_lock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_parent uuid := nullif(r->>tg_argv[1], '')::uuid;
  v_status text;
begin
  if v_parent is not null then
    execute format('select status from public.%I where id = $1', tg_argv[0]) into v_status using v_parent;
    if v_status in ('submitted','approved','archived') then
      if tg_op = 'UPDATE' and tg_table_name = 'subsidiary_questionnaire_responses'
         and (to_jsonb(new) - 'follow_up_id') = (to_jsonb(old) - 'follow_up_id') then
        return new;   -- only the follow-up link changed
      end if;
      raise exception 'The parent record is % and locked; return or reopen it to change this', v_status
        using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Same-org guard: add the Module 3 reference columns
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
      ('area_id','readiness_areas'),
      ('entity_id','entities'),
      ('parent_entity_id','entities'),
      ('process_id','processes'),
      ('questionnaire_id','subsidiary_questionnaires'),
      ('follow_up_id','follow_ups')
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

  for col in select unnest(array['owner_user_id','assigned_to','created_by','updated_by','prepared_by',
                                  'reviewed_by','submitted_by','local_owner_user_id'])
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
-- 4. Entities
-- ---------------------------------------------------------------------------
alter table public.entities
  add column if not exists parent_entity_id uuid references public.entities(id) on delete set null,
  add column if not exists legal_name text,
  add column if not exists in_scope boolean not null default true,
  add column if not exists consolidation_method text,
  add column if not exists local_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.entities drop constraint if exists entities_status_check;
alter table public.entities add constraint entities_status_check
  check (status in ('in_progress','complete','inactive'));
alter table public.entities drop constraint if exists entities_consolidation_check;
alter table public.entities add constraint entities_consolidation_check
  check (consolidation_method is null or consolidation_method in
    ('full','proportional','equity_method','not_consolidated'));
create unique index if not exists uq_entities_one_parent on public.entities(organization_id) where is_parent;
create unique index if not exists uq_entities_name on public.entities(organization_id, lower(name));
create index if not exists idx_entities_parent on public.entities(parent_entity_id);

create or replace function public.p2_entity_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_cycle boolean;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.subsidiary_questionnaires q where q.entity_id = old.id and q.status <> 'draft') then
      raise exception 'Entity has questionnaires that have been submitted or reviewed; set it inactive instead of deleting'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.is_parent and new.parent_entity_id is not null then
    raise exception 'The group parent entity cannot itself have a parent' using errcode = 'P0001';
  end if;
  if new.parent_entity_id is not null then
    if new.parent_entity_id = new.id then
      raise exception 'An entity cannot be its own parent' using errcode = 'P0001';
    end if;
    with recursive up as (
      select id, parent_entity_id from public.entities where id = new.parent_entity_id
      union all
      select e.id, e.parent_entity_id from public.entities e join up on e.id = up.parent_entity_id
    )
    select exists (select 1 from up where id = new.id) into v_cycle;
    if v_cycle then
      raise exception 'That parent would create a circular ownership structure' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists entities_a_same_org on public.entities;
create trigger entities_a_same_org before insert or update on public.entities
  for each row execute function public.p2_assert_same_org();
drop trigger if exists entities_b_guard on public.entities;
create trigger entities_b_guard before insert or update or delete on public.entities
  for each row execute function public.p2_entity_guard();
drop trigger if exists entities_z_audit on public.entities;
create trigger entities_z_audit after insert or update or delete on public.entities
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 5. Entity <-> process / control assignment
-- ---------------------------------------------------------------------------
create table if not exists public.entity_processes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  process_id uuid not null references public.processes(id) on delete cascade,
  in_scope boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, process_id)
);
create index if not exists idx_entity_processes_org on public.entity_processes(organization_id);
alter table public.entity_processes enable row level security;

create table if not exists public.entity_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete cascade,
  local_owner_user_id uuid references auth.users(id) on delete set null,
  reliance_type text not null default 'entity_level',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, control_id),
  constraint entity_controls_reliance check (reliance_type in ('entity_level','group_level','shared_service')),
  constraint entity_controls_status check (status in ('active','inactive'))
);
create index if not exists idx_entity_controls_org on public.entity_controls(organization_id);
create index if not exists idx_entity_controls_control on public.entity_controls(control_id);
alter table public.entity_controls enable row level security;

do $$
declare t text;
begin
  foreach t in array array['entity_processes','entity_controls'] loop
    execute format('drop trigger if exists %1$s_a_same_org on public.%1$I', t);
    execute format('create trigger %1$s_a_same_org before insert or update on public.%1$I for each row execute function public.p2_assert_same_org()', t);
    execute format('drop trigger if exists %1$s_b_touch on public.%1$I', t);
    execute format('create trigger %1$s_b_touch before update on public.%1$I for each row execute function public.p2_touch_updated_at()', t);
    execute format('drop trigger if exists %1$s_z_audit on public.%1$I', t);
    execute format('create trigger %1$s_z_audit after insert or update or delete on public.%1$I for each row execute function public.p2_audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Subsidiary questionnaires (retype legacy text columns; tables are empty)
-- ---------------------------------------------------------------------------
-- Retype the legacy text columns ONLY while they are still text (first run). On a
-- populated or already-migrated table this block does nothing, so re-running is safe.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='subsidiary_questionnaires'
                and column_name='prepared_by' and data_type='text') then
    if (select count(*) from public.subsidiary_questionnaires) > 0 then
      raise exception 'subsidiary_questionnaires already contains data; migrate prepared_by manually before retyping';
    end if;
    alter table public.subsidiary_questionnaires drop column prepared_by;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='subsidiary_questionnaire_responses'
                and column_name='follow_up_required' and data_type='text') then
    if (select count(*) from public.subsidiary_questionnaire_responses) > 0 then
      raise exception 'subsidiary_questionnaire_responses already contains data; migrate follow_up_required manually before retyping';
    end if;
    alter table public.subsidiary_questionnaire_responses drop column follow_up_required;
  end if;
end $$;

alter table public.subsidiary_questionnaires
  add column if not exists reporting_period_id uuid references public.reporting_periods(id) on delete cascade,
  add column if not exists prepared_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists review_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists group_review_status text not null default 'not_started';
alter table public.subsidiary_questionnaires drop constraint if exists subsidiary_questionnaires_status_check;
alter table public.subsidiary_questionnaires add constraint subsidiary_questionnaires_status_check
  check (status in ('draft','prepared','submitted','returned','approved','reopened','archived'));
alter table public.subsidiary_questionnaires drop constraint if exists subsidiary_questionnaires_group_status_check;
alter table public.subsidiary_questionnaires add constraint subsidiary_questionnaires_group_status_check
  check (group_review_status in ('not_started','in_review','clarification_requested','accepted','accepted_with_follow_up','returned'));
create unique index if not exists uq_questionnaire_entity_period
  on public.subsidiary_questionnaires(entity_id, reporting_period_id) where reporting_period_id is not null;
create index if not exists idx_questionnaires_period on public.subsidiary_questionnaires(organization_id, reporting_period_id);

alter table public.subsidiary_questionnaire_responses
  add column if not exists evidence_id uuid references public.evidence(id) on delete set null,
  add column if not exists follow_up_id uuid references public.follow_ups(id) on delete set null,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();
alter table public.subsidiary_questionnaire_responses add column if not exists follow_up_required boolean not null default false;
create index if not exists idx_questionnaire_responses_q on public.subsidiary_questionnaire_responses(questionnaire_id);

alter table public.follow_ups
  add column if not exists questionnaire_id uuid references public.subsidiary_questionnaires(id) on delete set null;
create index if not exists idx_follow_ups_questionnaire on public.follow_ups(questionnaire_id);

create or replace function public.p2_group_required()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_table_name = 'subsidiary_questionnaires' then
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      if old.group_review_status is distinct from new.group_review_status then
        raise exception 'The group review outcome can only change together with a workflow transition' using errcode = 'P0001';
      end if;
      return new;
    end if;
    if new.reporting_period_id is null and new.status <> 'draft' then
      raise exception 'A reporting period is required' using errcode = 'P0001';
    end if;
    if new.status in ('draft','prepared','reopened') then
      new.group_review_status := 'not_started';
    elsif new.status = 'submitted' then
      if exists (select 1 from public.subsidiary_questionnaire_responses r
                  where r.questionnaire_id = new.id and length(btrim(coalesce(r.response,''))) = 0) then
        raise exception 'Every question must be answered before submitting' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.subsidiary_questionnaire_responses r
                  where r.questionnaire_id = new.id and r.follow_up_required
                    and length(btrim(coalesce(r.evidence_comments,''))) = 0) then
        raise exception 'Explain (in comments) every answer flagged as needing follow-up' using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.subsidiary_questionnaire_responses r where r.questionnaire_id = new.id) then
        raise exception 'A questionnaire needs at least one question before it can be submitted' using errcode = 'P0001';
      end if;
      new.group_review_status := 'in_review';
    elsif new.status = 'returned' then
      if new.group_review_status not in ('clarification_requested','returned') then
        raise exception 'State whether clarification is requested or the questionnaire is returned' using errcode = 'P0001';
      end if;
    elsif new.status = 'approved' then
      if new.group_review_status not in ('accepted','accepted_with_follow_up') then
        raise exception 'Choose accept or accept with follow-up' using errcode = 'P0001';
      end if;
      if new.group_review_status = 'accepted_with_follow_up'
         and not exists (select 1 from public.follow_ups f
                          where f.questionnaire_id = new.id and f.status <> 'closed') then
        raise exception 'Accepting with follow-up requires at least one open follow-up linked to this questionnaire'
          using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'group_icfr_summaries' then
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return new;
    end if;
    if new.status in ('submitted','approved') and length(btrim(coalesce(new.conclusion,''))) < 20 then
      raise exception 'A group conclusion (at least 20 characters) is required to submit' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Group ICFR summaries (the only group data external auditors / viewers see)
-- ---------------------------------------------------------------------------
create table if not exists public.group_icfr_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods(id) on delete cascade,
  title text not null default 'Group ICFR roll-up',
  conclusion text,
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  prepared_by uuid default auth.uid() references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_icfr_summaries_status check
    (status in ('draft','prepared','submitted','returned','approved','reopened','archived'))
);
create index if not exists idx_group_icfr_summaries_org on public.group_icfr_summaries(organization_id, reporting_period_id);
alter table public.group_icfr_summaries enable row level security;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------
do $$
begin
  -- questionnaires: guard (with group_review_status as a workflow column) then required/outcome
  drop trigger if exists subsidiary_questionnaires_a_same_org on public.subsidiary_questionnaires;
  create trigger subsidiary_questionnaires_a_same_org before insert or update on public.subsidiary_questionnaires
    for each row execute function public.p2_assert_same_org();
  drop trigger if exists subsidiary_questionnaires_b_guard on public.subsidiary_questionnaires;
  create trigger subsidiary_questionnaires_b_guard before insert or update on public.subsidiary_questionnaires
    for each row execute function public.p2_approval_guard('group_review_status');
  drop trigger if exists subsidiary_questionnaires_c_required on public.subsidiary_questionnaires;
  create trigger subsidiary_questionnaires_c_required before insert or update on public.subsidiary_questionnaires
    for each row execute function public.p2_group_required();
  drop trigger if exists subsidiary_questionnaires_d_draft_delete on public.subsidiary_questionnaires;
  create trigger subsidiary_questionnaires_d_draft_delete before delete on public.subsidiary_questionnaires
    for each row execute function public.p2_draft_only_delete();
  drop trigger if exists subsidiary_questionnaires_z_audit on public.subsidiary_questionnaires;
  create trigger subsidiary_questionnaires_z_audit after insert or update or delete on public.subsidiary_questionnaires
    for each row execute function public.p2_audit();

  -- responses: frozen with the parent (except linking a follow-up)
  drop trigger if exists subsidiary_questionnaire_responses_a_same_org on public.subsidiary_questionnaire_responses;
  create trigger subsidiary_questionnaire_responses_a_same_org before insert or update on public.subsidiary_questionnaire_responses
    for each row execute function public.p2_assert_same_org();
  drop trigger if exists subsidiary_questionnaire_responses_b_lock on public.subsidiary_questionnaire_responses;
  create trigger subsidiary_questionnaire_responses_b_lock before insert or update or delete on public.subsidiary_questionnaire_responses
    for each row execute function public.p2_parent_lock('subsidiary_questionnaires', 'questionnaire_id');
  drop trigger if exists subsidiary_questionnaire_responses_c_touch on public.subsidiary_questionnaire_responses;
  create trigger subsidiary_questionnaire_responses_c_touch before update on public.subsidiary_questionnaire_responses
    for each row execute function public.p2_touch_updated_at();
  drop trigger if exists subsidiary_questionnaire_responses_z_audit on public.subsidiary_questionnaire_responses;
  create trigger subsidiary_questionnaire_responses_z_audit after insert or update or delete on public.subsidiary_questionnaire_responses
    for each row execute function public.p2_audit();

  -- group summaries
  drop trigger if exists group_icfr_summaries_a_same_org on public.group_icfr_summaries;
  create trigger group_icfr_summaries_a_same_org before insert or update on public.group_icfr_summaries
    for each row execute function public.p2_assert_same_org();
  drop trigger if exists group_icfr_summaries_b_guard on public.group_icfr_summaries;
  create trigger group_icfr_summaries_b_guard before insert or update on public.group_icfr_summaries
    for each row execute function public.p2_approval_guard();
  drop trigger if exists group_icfr_summaries_c_required on public.group_icfr_summaries;
  create trigger group_icfr_summaries_c_required before insert or update on public.group_icfr_summaries
    for each row execute function public.p2_group_required();
  drop trigger if exists group_icfr_summaries_d_draft_delete on public.group_icfr_summaries;
  create trigger group_icfr_summaries_d_draft_delete before delete on public.group_icfr_summaries
    for each row execute function public.p2_draft_only_delete();
  drop trigger if exists group_icfr_summaries_z_audit on public.group_icfr_summaries;
  create trigger group_icfr_summaries_z_audit after insert or update or delete on public.group_icfr_summaries
    for each row execute function public.p2_audit();
end $$;

-- ---------------------------------------------------------------------------
-- 9. Row-level security
-- ---------------------------------------------------------------------------
create or replace function public.p2_can_prepare_entity(p_org uuid, p_entity uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.p2_has_role(p_org, array['owner','admin','internal_auditor'])
      or (public.p2_has_role(p_org, array['controller','cfo'])
          and exists (select 1 from public.entities e
                       where e.id = p_entity and e.organization_id = p_org
                         and e.local_owner_user_id = auth.uid()));
$$;

-- entities: everyone in the org may see the structure (names / jurisdictions);
-- management and internal audit maintain it.
drop policy if exists "management and auditors can create entities" on public.entities;
drop policy if exists "management and auditors can update entities" on public.entities;
drop policy if exists "p2 entities insert" on public.entities;
create policy "p2 entities insert" on public.entities for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));
drop policy if exists "p2 entities update" on public.entities;
create policy "p2 entities update" on public.entities for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

do $$
declare t text;
begin
  foreach t in array array['entity_processes','entity_controls'] loop
    execute format('drop policy if exists "p2 select" on public.%I', t);
    execute format('create policy "p2 select" on public.%I for select using (public.p2_is_internal(organization_id))', t);
    execute format('drop policy if exists "p2 write" on public.%I', t);
    execute format($p$create policy "p2 write" on public.%I for all
      using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))
      with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))$p$, t);
  end loop;
end $$;

drop policy if exists "org members can view subsidiary questionnaires" on public.subsidiary_questionnaires;
drop policy if exists "management and auditors can create subsidiary questionnaires" on public.subsidiary_questionnaires;
drop policy if exists "management and auditors can update subsidiary questionnaires" on public.subsidiary_questionnaires;
drop policy if exists "p2 sq select" on public.subsidiary_questionnaires;
create policy "p2 sq select" on public.subsidiary_questionnaires for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved'));
drop policy if exists "p2 sq insert" on public.subsidiary_questionnaires;
create policy "p2 sq insert" on public.subsidiary_questionnaires for insert
  with check (public.p2_can_prepare_entity(organization_id, entity_id));
drop policy if exists "p2 sq update" on public.subsidiary_questionnaires;
create policy "p2 sq update" on public.subsidiary_questionnaires for update using (
  public.p2_can_prepare_entity(organization_id, entity_id)
  or (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']) and status in ('submitted','approved')))
  with check (
  public.p2_can_prepare_entity(organization_id, entity_id)
  or public.p2_has_role(organization_id, array['owner','admin','cfo','controller']));

drop policy if exists "org members can view questionnaire responses" on public.subsidiary_questionnaire_responses;
drop policy if exists "management and auditors can create questionnaire responses" on public.subsidiary_questionnaire_responses;
drop policy if exists "management and auditors can update questionnaire responses" on public.subsidiary_questionnaire_responses;
drop policy if exists "p2 sqr select" on public.subsidiary_questionnaire_responses;
create policy "p2 sqr select" on public.subsidiary_questionnaire_responses for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer'])
      and exists (select 1 from public.subsidiary_questionnaires q where q.id = questionnaire_id and q.status = 'approved')));
drop policy if exists "p2 sqr insert" on public.subsidiary_questionnaire_responses;
create policy "p2 sqr insert" on public.subsidiary_questionnaire_responses for insert with check (
  exists (select 1 from public.subsidiary_questionnaires q
           where q.id = questionnaire_id and public.p2_can_prepare_entity(q.organization_id, q.entity_id)));
drop policy if exists "p2 sqr update" on public.subsidiary_questionnaire_responses;
create policy "p2 sqr update" on public.subsidiary_questionnaire_responses for update using (
  exists (select 1 from public.subsidiary_questionnaires q
           where q.id = questionnaire_id
             and (public.p2_can_prepare_entity(q.organization_id, q.entity_id)
                  or (public.p2_has_role(q.organization_id, array['owner','admin','cfo','controller'])
                      and q.status in ('submitted','approved')))))
  with check (
  exists (select 1 from public.subsidiary_questionnaires q
           where q.id = questionnaire_id
             and (public.p2_can_prepare_entity(q.organization_id, q.entity_id)
                  or public.p2_has_role(q.organization_id, array['owner','admin','cfo','controller']))));
drop policy if exists "p2 sqr delete" on public.subsidiary_questionnaire_responses;
create policy "p2 sqr delete" on public.subsidiary_questionnaire_responses for delete using (
  exists (select 1 from public.subsidiary_questionnaires q
           where q.id = questionnaire_id and public.p2_can_prepare_entity(q.organization_id, q.entity_id)));

drop policy if exists "p2 gis select" on public.group_icfr_summaries;
create policy "p2 gis select" on public.group_icfr_summaries for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved'));
drop policy if exists "p2 gis insert" on public.group_icfr_summaries;
create policy "p2 gis insert" on public.group_icfr_summaries for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 gis update" on public.group_icfr_summaries;
create policy "p2 gis update" on public.group_icfr_summaries for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- Group reviewers (CFO / controller) must be able to raise the follow-up when
-- accepting a questionnaire "with follow-up". Widens the Module 1 insert policy.
drop policy if exists "p2 follow ups insert" on public.follow_ups;
create policy "p2 follow ups insert" on public.follow_ups for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- ---------------------------------------------------------------------------
-- 10. Group roll-up (security invoker: runs under the caller's RLS)
--     Only entities whose questionnaire for the period is APPROVED, plus the
--     group parent, contribute. Each record belongs to exactly one bucket:
--       controls      -> controls.entity_id (null = group)
--       deficiencies  -> deficiencies.entity_id, else its control's entity, else group
--       exceptions    -> its control's entity, else group   (period-scoped)
--       test plans    -> its control's entity, else group
--     so totals are sums of disjoint buckets and cannot double-count, even when
--     a group-level control is relied on by many entities.
-- ---------------------------------------------------------------------------
create or replace function public.p2_group_rollup(p_org uuid, p_period uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  with ent as (
    select e.id, e.name, e.is_parent, e.in_scope, e.parent_entity_id, e.jurisdiction,
           q.id as questionnaire_id, q.status as q_status, q.group_review_status,
           (e.is_parent or q.status = 'approved') as included
      from public.entities e
      left join public.subsidiary_questionnaires q
        on q.entity_id = e.id and q.reporting_period_id = p_period
     where e.organization_id = p_org and e.in_scope and e.status <> 'inactive'
  ),
  ctl as (
    select c.id, c.entity_id as bucket, c.status from public.controls c
     where c.organization_id = p_org and c.status = 'active'
  ),
  def as (
    select d.id, coalesce(d.entity_id, c.entity_id) as bucket
      from public.deficiencies d
      left join public.controls c on c.id = d.control_id
     where d.organization_id = p_org and d.resolved_at is null
  ),
  exc as (
    select x.id, c.entity_id as bucket
      from public.ccm_exceptions x
      left join public.controls c on c.id = x.control_id
     where x.organization_id = p_org and x.reporting_period_id = p_period
       and x.status in ('open','in_review','in_investigation')
  ),
  tp as (
    select t.id, c.entity_id as bucket, t.status
      from public.test_plans t
      join public.controls c on c.id = t.control_id
     where t.organization_id = p_org
  ),
  reliance as (
    select ec.entity_id, count(distinct ec.control_id) as n
      from public.entity_controls ec join ctl on ctl.id = ec.control_id and ctl.bucket is null
     where ec.organization_id = p_org and ec.status = 'active' and ec.reliance_type = 'group_level'
     group by ec.entity_id
  ),
  per_entity as (
    select ent.*,
      (select count(*) from ctl where ctl.bucket = ent.id) as controls_owned,
      coalesce((select n from reliance r where r.entity_id = ent.id), 0) as group_controls_relied_on,
      (select count(*) from def where def.bucket = ent.id) as deficiencies_open,
      (select count(*) from exc where exc.bucket = ent.id) as exceptions_open,
      (select count(*) from tp where tp.bucket = ent.id) as test_plans,
      (select count(*) from tp where tp.bucket = ent.id and tp.status in ('complete','completed')) as test_plans_complete
    from ent
  ),
  grp as (
    select (select count(*) from ctl where ctl.bucket is null) as controls,
           (select count(*) from def where def.bucket is null) as deficiencies_open,
           (select count(*) from exc where exc.bucket is null) as exceptions_open,
           (select count(*) from tp where tp.bucket is null) as test_plans,
           (select count(*) from tp where tp.bucket is null and tp.status in ('complete','completed')) as test_plans_complete
  )
  select jsonb_build_object(
    'period_id', p_period,
    'generated_at', now(),
    'entities', coalesce((select jsonb_agg(jsonb_build_object(
        'entity_id', id, 'name', name, 'is_parent', is_parent, 'jurisdiction', jurisdiction,
        'included', included, 'questionnaire_id', questionnaire_id, 'questionnaire_status', q_status,
        'group_review_status', group_review_status,
        'controls_owned', controls_owned, 'group_controls_relied_on', group_controls_relied_on,
        'deficiencies_open', deficiencies_open, 'exceptions_open', exceptions_open,
        'test_plans', test_plans, 'test_plans_complete', test_plans_complete) order by is_parent desc, name)
      from per_entity), '[]'::jsonb),
    'group_level', (select to_jsonb(grp) from grp),
    'totals', jsonb_build_object(
      'entities_in_scope', (select count(*) from ent),
      'entities_included', (select count(*) from ent where included),
      'entities_excluded', (select count(*) from ent where not included),
      'controls', (select controls from grp) + coalesce((select sum(controls_owned) from per_entity where included), 0),
      'deficiencies_open', (select deficiencies_open from grp) + coalesce((select sum(deficiencies_open) from per_entity where included), 0),
      'exceptions_open', (select exceptions_open from grp) + coalesce((select sum(exceptions_open) from per_entity where included), 0),
      'test_plans', (select test_plans from grp) + coalesce((select sum(test_plans) from per_entity where included), 0),
      'test_plans_complete', (select test_plans_complete from grp) + coalesce((select sum(test_plans_complete) from per_entity where included), 0)
    )
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Function privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['p2_parent_lock()','p2_entity_guard()','p2_group_required()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['p2_can_prepare_entity(uuid, uuid)','p2_group_rollup(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
