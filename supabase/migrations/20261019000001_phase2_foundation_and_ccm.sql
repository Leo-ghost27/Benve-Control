-- ============================================================================
-- Phase 2 foundation + Module 1 (Continuous Controls Monitoring)
--
-- Additive and backward-compatible: no Phase 1 column is dropped or renamed.
-- Written defensively because the repo's earlier migrations do not fully
-- reproduce the live schema (e.g. org_role() is referenced but never defined
-- in-repo, controls has title/risk_rating). This file therefore depends only
-- on: organizations, organization_members(role), controls, deficiencies,
-- test_steps, audit_log, is_org_member(), and the Task 45 CCM tables.
--
-- Naming: the existing schema uses organization_id for what the Phase 2 brief
-- calls tenant_id. organization_id is retained (tenant == organization).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Role helper (new name -> cannot clash with a live org_role() definition)
-- ---------------------------------------------------------------------------
create or replace function public.p2_role(p_org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select m.role::text
  from public.organization_members m
  where m.organization_id = p_org and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.p2_has_role(p_org uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.p2_role(p_org) = any (p_roles), false);
$$;

-- Internal workspace roles (may see drafts / internal notes).
create or replace function public.p2_is_internal(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.p2_has_role(p_org,
    array['owner','admin','cfo','controller','internal_auditor','adviser']);
$$;

-- ---------------------------------------------------------------------------
-- 2. Reporting periods (did not exist in Phase 1)
-- ---------------------------------------------------------------------------
create table if not exists public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  period_type text not null default 'quarter',
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_periods_dates check (end_date >= start_date),
  constraint reporting_periods_status check (status in ('open','closed')),
  unique (organization_id, label)
);
create index if not exists idx_reporting_periods_org on public.reporting_periods(organization_id);
alter table public.reporting_periods enable row level security;

drop policy if exists "p2 members view periods" on public.reporting_periods;
create policy "p2 members view periods" on public.reporting_periods
  for select using (public.is_org_member(organization_id));
drop policy if exists "p2 managers manage periods" on public.reporting_periods;
create policy "p2 managers manage periods" on public.reporting_periods
  for all
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']))
  with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']));

-- ---------------------------------------------------------------------------
-- 3. Generic audit trigger (DB-level, so no code path can skip the audit log)
--    Writes actor, action, old/new status and changed-field names.
-- ---------------------------------------------------------------------------
create or replace function public.p2_audit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_action text;
  v_meta jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
begin
  if tg_op = 'DELETE' then
    v_org := (to_jsonb(old)->>'organization_id')::uuid;
    v_id := (to_jsonb(old)->>'id')::uuid;
    v_action := 'deleted';
  elsif tg_op = 'INSERT' then
    v_org := (to_jsonb(new)->>'organization_id')::uuid;
    v_id := (to_jsonb(new)->>'id')::uuid;
    v_action := 'created';
    v_meta := jsonb_build_object('status', to_jsonb(new)->'status');
  else
    v_org := (to_jsonb(new)->>'organization_id')::uuid;
    v_id := (to_jsonb(new)->>'id')::uuid;
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    select array_agg(k) into v_changed
      from jsonb_object_keys(v_new) k
      where k <> 'updated_at' and v_new->k is distinct from v_old->k;
    if v_changed is null then return new; end if;
    if v_old->>'status' is distinct from v_new->>'status' then
      v_action := 'status_changed';
      v_meta := jsonb_build_object('from', v_old->'status', 'to', v_new->'status');
    else
      v_action := 'updated';
    end if;
    v_meta := v_meta || jsonb_build_object('changed_fields', to_jsonb(v_changed));
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), v_action, tg_table_name, v_id, v_meta);

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Tenant-integrity guard: referenced rows must belong to the same org
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
      ('linked_exception_id','test_steps')
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

  for col in select unnest(array['owner_user_id','assigned_to','created_by','updated_by'])
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
-- 5. CCM rules
-- ---------------------------------------------------------------------------
alter table public.ccm_rules
  add column if not exists reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  add column if not exists rule_code text,
  add column if not exists name text,
  add column if not exists logic_summary text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ccm_rules drop constraint if exists ccm_rules_status_check;
alter table public.ccm_rules add constraint ccm_rules_status_check
  check (status in ('draft','active','inactive','archived'));
alter table public.ccm_rules drop constraint if exists ccm_rules_severity_check;
alter table public.ccm_rules add constraint ccm_rules_severity_check
  check (severity is null or severity in ('low','medium','high','critical'));
create unique index if not exists uq_ccm_rules_code
  on public.ccm_rules(organization_id, rule_code) where rule_code is not null;

-- Rule lifecycle: draft -> active <-> inactive -> archived (archived is final)
create or replace function public.p2_ccm_rule_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'draft'    and new.status in ('active','archived')) or
      (old.status = 'active'   and new.status in ('inactive','archived')) or
      (old.status = 'inactive' and new.status in ('active','archived'))
    ) then
      raise exception 'Illegal CCM rule transition % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists ccm_rules_transition on public.ccm_rules;
create trigger ccm_rules_transition before update on public.ccm_rules
  for each row execute function public.p2_ccm_rule_transition();
drop trigger if exists ccm_rules_same_org on public.ccm_rules;
create trigger ccm_rules_same_org before insert or update on public.ccm_rules
  for each row execute function public.p2_assert_same_org();
drop trigger if exists ccm_rules_audit on public.ccm_rules;
create trigger ccm_rules_audit after insert or update or delete on public.ccm_rules
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 6. CCM import batches (manual CSV import with explicit approval)
-- ---------------------------------------------------------------------------
create table if not exists public.ccm_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  source_system text not null,
  file_name text,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  validation_status text not null default 'validated',
  status text not null default 'pending_approval',
  rows jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ccm_batch_status check (status in ('pending_approval','approved','rejected')),
  constraint ccm_batch_validation check (validation_status in ('validated','partially_valid','invalid'))
);
create index if not exists idx_ccm_batches_org on public.ccm_import_batches(organization_id);
alter table public.ccm_import_batches enable row level security;

drop policy if exists "p2 ccm batches select" on public.ccm_import_batches;
create policy "p2 ccm batches select" on public.ccm_import_batches
  for select using (public.p2_is_internal(organization_id));
drop policy if exists "p2 ccm batches insert" on public.ccm_import_batches;
create policy "p2 ccm batches insert" on public.ccm_import_batches
  for insert with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 ccm batches update" on public.ccm_import_batches;
create policy "p2 ccm batches update" on public.ccm_import_batches
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller']));

-- Batch decision is final; only approvers may decide, and not their own import.
create or replace function public.p2_ccm_batch_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'pending_approval' then
      raise exception 'Import batch already decided (%)', old.status using errcode = 'P0001';
    end if;
    if new.status = 'approved' and new.approved_by is not distinct from old.imported_by then
      raise exception 'Importer cannot approve their own import batch' using errcode = 'P0001';
    end if;
    new.updated_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists ccm_batches_guard on public.ccm_import_batches;
create trigger ccm_batches_guard before update on public.ccm_import_batches
  for each row execute function public.p2_ccm_batch_guard();
drop trigger if exists ccm_batches_audit on public.ccm_import_batches;
create trigger ccm_batches_audit after insert or update or delete on public.ccm_import_batches
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 7. CCM exceptions
-- ---------------------------------------------------------------------------
alter table public.ccm_exceptions
  add column if not exists reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  add column if not exists detected_at timestamptz not null default now(),
  add column if not exists description text,
  add column if not exists severity text,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists investigation_notes text,
  add column if not exists false_positive_reason text,
  add column if not exists linked_exception_id uuid references public.test_steps(id) on delete set null,
  add column if not exists source_type text not null default 'manual',
  add column if not exists import_batch_id uuid references public.ccm_import_batches(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ccm_exceptions drop constraint if exists ccm_exceptions_status_check;
alter table public.ccm_exceptions add constraint ccm_exceptions_status_check
  check (status in ('open','in_review','in_investigation','false_positive','linked','closed'));
alter table public.ccm_exceptions drop constraint if exists ccm_exceptions_severity_check;
alter table public.ccm_exceptions add constraint ccm_exceptions_severity_check
  check (severity is null or severity in ('low','medium','high','critical'));
alter table public.ccm_exceptions drop constraint if exists ccm_exceptions_source_type_check;
alter table public.ccm_exceptions add constraint ccm_exceptions_source_type_check
  check (source_type in ('manual','csv_import'));
create index if not exists idx_ccm_exc_period on public.ccm_exceptions(organization_id, reporting_period_id);
create index if not exists idx_ccm_exc_status on public.ccm_exceptions(organization_id, status);

-- Exception lifecycle + mandatory rationale / linkage rules.
--   open -> in_investigation -> (false_positive | linked | closed)
--   false_positive / linked -> closed;  closed -> in_investigation (reopen)
create or replace function public.p2_ccm_exception_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status in ('open','in_review') and new.status in ('in_investigation','false_positive')) or
      (old.status = 'in_investigation' and new.status in ('false_positive','linked','closed')) or
      (old.status in ('false_positive','linked') and new.status = 'closed') or
      (old.status = 'closed' and new.status = 'in_investigation')
    ) then
      raise exception 'Illegal CCM exception transition % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('in_investigation') and new.assigned_to is null then
      raise exception 'An owner (assigned_to) is required before investigation' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'false_positive' and length(btrim(coalesce(new.false_positive_reason,''))) < 10 then
    raise exception 'A false-positive rationale of at least 10 characters is mandatory' using errcode = 'P0001';
  end if;
  if new.status = 'linked' and new.linked_exception_id is null and new.linked_deficiency_id is null then
    raise exception 'Linking requires a formal exception or a deficiency' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists ccm_exceptions_transition on public.ccm_exceptions;
create trigger ccm_exceptions_transition before insert or update on public.ccm_exceptions
  for each row execute function public.p2_ccm_exception_transition();
drop trigger if exists ccm_exceptions_same_org on public.ccm_exceptions;
create trigger ccm_exceptions_same_org before insert or update on public.ccm_exceptions
  for each row execute function public.p2_assert_same_org();
drop trigger if exists ccm_exceptions_audit on public.ccm_exceptions;
create trigger ccm_exceptions_audit after insert or update or delete on public.ccm_exceptions
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 8. Follow-ups
-- ---------------------------------------------------------------------------
alter table public.follow_ups
  add column if not exists deficiency_id uuid references public.deficiencies(id) on delete set null,
  add column if not exists description text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists escalation_status text not null default 'none',
  add column if not exists completed_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.follow_ups drop constraint if exists follow_ups_escalation_check;
alter table public.follow_ups add constraint follow_ups_escalation_check
  check (escalation_status in ('none','requested','approved','rejected'));
create index if not exists idx_follow_ups_due on public.follow_ups(organization_id, due_date);

create or replace function public.p2_follow_up_guard()
returns trigger language plpgsql as $$
begin
  if new.status = 'closed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  if new.status <> 'closed' then new.completed_at := null; end if;
  if tg_op = 'UPDATE' and old.escalation_status is distinct from new.escalation_status then
    if not (
      (old.escalation_status = 'none' and new.escalation_status = 'requested') or
      (old.escalation_status = 'requested' and new.escalation_status in ('approved','rejected')) or
      (old.escalation_status = 'rejected' and new.escalation_status = 'requested')
    ) then
      raise exception 'Illegal escalation transition % -> %', old.escalation_status, new.escalation_status
        using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists follow_ups_guard on public.follow_ups;
create trigger follow_ups_guard before insert or update on public.follow_ups
  for each row execute function public.p2_follow_up_guard();
drop trigger if exists follow_ups_same_org on public.follow_ups;
create trigger follow_ups_same_org before insert or update on public.follow_ups
  for each row execute function public.p2_assert_same_org();
drop trigger if exists follow_ups_audit on public.follow_ups;
create trigger follow_ups_audit after insert or update or delete on public.follow_ups
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 9. Approved CCM summaries (the ONLY CCM data external auditors / viewers see)
-- ---------------------------------------------------------------------------
create table if not exists public.ccm_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods(id) on delete cascade,
  status text not null default 'draft',
  snapshot jsonb not null default '{}'::jsonb,
  prepared_by uuid references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ccm_summaries_status check
    (status in ('draft','prepared','submitted','returned','approved','reopened','archived'))
);
create index if not exists idx_ccm_summaries_org on public.ccm_summaries(organization_id, reporting_period_id);
alter table public.ccm_summaries enable row level security;

-- Draft -> Prepared -> Submitted -> (Returned -> Prepared | Approved)
-- Approved -> Reopened (reviewer) -> Prepared;  Approved -> Archived.
create or replace function public.p2_ccm_summary_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'draft'     and new.status = 'prepared') or
      (old.status = 'prepared'  and new.status = 'submitted') or
      (old.status = 'submitted' and new.status in ('returned','approved')) or
      (old.status in ('returned','reopened') and new.status = 'prepared') or
      (old.status = 'approved'  and new.status in ('reopened','archived'))
    ) then
      raise exception 'Illegal summary transition % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('approved','returned','reopened')
       and not public.p2_has_role(new.organization_id, array['owner','admin','cfo','controller']) then
      raise exception 'Only a controller/CFO/admin may % a summary', new.status using errcode = '42501';
    end if;
    if new.status = 'approved' then
      new.approved_at := now(); new.reviewed_by := auth.uid();
      if auth.uid() is not distinct from old.submitted_by then
        raise exception 'Submitter cannot approve their own summary' using errcode = 'P0001';
      end if;
    end if;
    if new.status = 'submitted' then new.submitted_at := now(); new.submitted_by := auth.uid(); end if;
    -- The note must be written for THIS transition (not carried over from an earlier one).
    if new.status in ('returned','reopened')
       and (new.review_note is not distinct from old.review_note
            or length(btrim(coalesce(new.review_note,''))) < 5) then
      raise exception 'A new review note is required when returning or reopening' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists ccm_summaries_guard on public.ccm_summaries;
create trigger ccm_summaries_guard before update on public.ccm_summaries
  for each row execute function public.p2_ccm_summary_guard();
drop trigger if exists ccm_summaries_same_org on public.ccm_summaries;
create trigger ccm_summaries_same_org before insert or update on public.ccm_summaries
  for each row execute function public.p2_assert_same_org();
drop trigger if exists ccm_summaries_audit on public.ccm_summaries;
create trigger ccm_summaries_audit after insert or update or delete on public.ccm_summaries
  for each row execute function public.p2_audit();

drop policy if exists "p2 ccm summaries select" on public.ccm_summaries;
create policy "p2 ccm summaries select" on public.ccm_summaries
  for select using (
    public.p2_is_internal(organization_id)
    or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved')
  );
drop policy if exists "p2 ccm summaries insert" on public.ccm_summaries;
create policy "p2 ccm summaries insert" on public.ccm_summaries
  for insert with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 ccm summaries update" on public.ccm_summaries;
create policy "p2 ccm summaries update" on public.ccm_summaries
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- ---------------------------------------------------------------------------
-- 10. Workpaper comments (internal vs shareable) - used by CCM now, reused by
--     later modules.
-- ---------------------------------------------------------------------------
create table if not exists public.workpaper_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  visibility text not null default 'internal',
  body text not null,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint workpaper_comments_visibility check (visibility in ('internal','shareable')),
  constraint workpaper_comments_body check (length(btrim(body)) > 0)
);
create index if not exists idx_wp_comments_target on public.workpaper_comments(organization_id, target_type, target_id);
alter table public.workpaper_comments enable row level security;

drop policy if exists "p2 comments select" on public.workpaper_comments;
create policy "p2 comments select" on public.workpaper_comments
  for select using (
    public.p2_is_internal(organization_id)
    or (visibility = 'shareable'
        and public.p2_has_role(organization_id, array['external_auditor']))
  );
drop policy if exists "p2 comments insert" on public.workpaper_comments;
create policy "p2 comments insert" on public.workpaper_comments
  for insert with check (
    author_id = auth.uid()
    and (
      public.p2_is_internal(organization_id)
      or (visibility = 'shareable' and public.p2_has_role(organization_id, array['external_auditor']))
    )
  );
drop trigger if exists workpaper_comments_audit on public.workpaper_comments;
create trigger workpaper_comments_audit after insert or delete on public.workpaper_comments
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 11. RLS: replace "any member can read" on CCM tables with role-aware rules
--     and encode the Phase 2 permission matrix.
-- ---------------------------------------------------------------------------
-- ccm_rules / ccm_exceptions / follow_ups: internal roles only. External
-- auditors and viewers get CCM data exclusively through ccm_summaries.
do $$
declare t text;
begin
  foreach t in array array['ccm_rules','ccm_exceptions','follow_ups'] loop
    execute format('drop policy if exists "org members can view %s" on public.%I',
      replace(t,'_',' '), t);
    execute format('drop policy if exists "org members can view ccm rules" on public.%I', t);
    execute format('drop policy if exists "org members can view ccm exceptions" on public.%I', t);
    execute format('drop policy if exists "org members can view follow ups" on public.%I', t);
    execute format('drop policy if exists "p2 internal select" on public.%I', t);
    execute format('create policy "p2 internal select" on public.%I for select using (public.p2_is_internal(organization_id))', t);
  end loop;
end $$;

-- Rules: internal auditor / owner / admin create & edit; controller/CFO may
-- also edit (e.g. activate). Adviser: read + comment only.
drop policy if exists "management and auditors can create ccm rules" on public.ccm_rules;
drop policy if exists "management and auditors can update ccm rules" on public.ccm_rules;
drop policy if exists "p2 ccm rules insert" on public.ccm_rules;
create policy "p2 ccm rules insert" on public.ccm_rules
  for insert with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 ccm rules update" on public.ccm_rules;
create policy "p2 ccm rules update" on public.ccm_rules
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- Exceptions: internal auditor creates, investigates, links.
drop policy if exists "management and auditors can create ccm exceptions" on public.ccm_exceptions;
drop policy if exists "management and auditors can update ccm exceptions" on public.ccm_exceptions;
drop policy if exists "p2 ccm exc insert" on public.ccm_exceptions;
create policy "p2 ccm exc insert" on public.ccm_exceptions
  for insert with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 ccm exc update" on public.ccm_exceptions;
create policy "p2 ccm exc update" on public.ccm_exceptions
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- Follow-ups: auditors create; controller/CFO approve escalation (trigger
-- allows the state machine, policy limits who can write at all).
drop policy if exists "management and auditors can create follow ups" on public.follow_ups;
drop policy if exists "management and auditors can update follow ups" on public.follow_ups;
drop policy if exists "p2 follow ups insert" on public.follow_ups;
create policy "p2 follow ups insert" on public.follow_ups
  for insert with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 follow ups update" on public.follow_ups;
create policy "p2 follow ups update" on public.follow_ups
  for update using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- Only controller/CFO/admin/owner may approve or reject an escalation.
create or replace function public.p2_follow_up_escalation_authz()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and old.escalation_status is distinct from new.escalation_status
     and new.escalation_status in ('approved','rejected')
     and not public.p2_has_role(new.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Only a controller/CFO may approve or reject an escalation' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists follow_ups_escalation_authz on public.follow_ups;
create trigger follow_ups_escalation_authz before update on public.follow_ups
  for each row execute function public.p2_follow_up_escalation_authz();

-- Importer cannot approve; only approvers can set approved/rejected.
-- (Exceptions are materialised by the approval action under the approver's
--  identity, but exception INSERT policy is auditor-only -> use a definer fn.)
create or replace function public.p2_approve_ccm_batch(p_batch uuid, p_approve boolean)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  b public.ccm_import_batches%rowtype;
  r jsonb;
  n integer := 0;
begin
  select * into b from public.ccm_import_batches where id = p_batch for update;
  if not found then raise exception 'Batch not found' using errcode = 'P0002'; end if;
  if not public.p2_has_role(b.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Only a controller/CFO/admin may decide an import' using errcode = '42501';
  end if;
  if b.imported_by is not distinct from auth.uid() then
    raise exception 'Importer cannot approve their own import batch' using errcode = 'P0001';
  end if;
  if b.status <> 'pending_approval' then
    raise exception 'Import batch already decided (%)', b.status using errcode = 'P0001';
  end if;

  if p_approve then
    for r in select * from jsonb_array_elements(b.rows) loop
      insert into public.ccm_exceptions (
        organization_id, reporting_period_id, rule_id, control_id, detected_at,
        source_record_ref, description, severity, status, source_type, import_batch_id,
        created_by, amount, exception_ref
      ) values (
        b.organization_id, b.reporting_period_id,
        nullif(r->>'rule_id','')::uuid, nullif(r->>'control_id','')::uuid,
        coalesce(nullif(r->>'detected_at','')::timestamptz, b.imported_at),
        r->>'source_reference', r->>'description', nullif(r->>'severity',''),
        'open', 'csv_import', b.id, b.imported_by,
        nullif(r->>'amount','')::numeric, nullif(r->>'exception_ref','')
      );
      n := n + 1;
    end loop;
    update public.ccm_import_batches
       set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = b.id;
  else
    update public.ccm_import_batches
       set status = 'rejected', approved_by = auth.uid(), approved_at = now() where id = b.id;
  end if;
  return n;
end; $$;
revoke all on function public.p2_approve_ccm_batch(uuid, boolean) from public;
grant execute on function public.p2_approve_ccm_batch(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Org member directory (names for assignee pickers). profiles is
--     self-readable only, so expose a narrow definer function restricted to
--     internal members of the same organization.
-- ---------------------------------------------------------------------------
create or replace function public.p2_org_members(p_org uuid)
returns table (user_id uuid, role text, full_name text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.p2_is_internal(p_org) then
    return;
  end if;
  return query
    select m.user_id, m.role::text, p.full_name, u.email::text
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.organization_id = p_org
    order by coalesce(p.full_name, u.email::text);
end; $$;
revoke all on function public.p2_org_members(uuid) from public;
grant execute on function public.p2_org_members(uuid) to authenticated;

commit;
