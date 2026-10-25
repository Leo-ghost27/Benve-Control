-- ============================================================================
-- Phase 2 Module 4: ITGC and automated-control assurance  (Session B lane)
--
-- Extends the existing Task 48 tables (itgc_systems, itgc_controls,
-- automated_controls; all empty in production when written) and adds:
--   control_system_dependencies   which financial controls rely on which systems
--   automated_control_configurations  versioned, hash-approved configuration conclusions
--   itgc_exceptions               failed ITGC test steps routed for review
--
-- Testing reuses the EXISTING Phase 1 engine (test_plans / test_steps /
-- test_step_evidence). An ITGC test plan is an ordinary test plan on the
-- financial control the ITGC is mapped to; itgc_controls.test_plan_id links it.
-- Nothing in this file changes how Phase 1 records results.
--
-- Field mapping vs. the Phase 2 brief (existing columns reused):
--   automated_controls.control_code        -> control_ref
--   automated_controls.assertions          -> financial_assertions
--   automated_controls.linked_control_id   -> linked_sox_control_id
--   automated_controls.configuration_*     -> automated_control_configurations (versioned)
--   itgc_controls.control_id               -> new column (the financial control)
--
-- A system configuration is NEVER treated as automatically validated: the
-- conclusion is entered by a preparer and approved by a different authorised
-- user, bound to the exact version content hash (same pattern as scope sign-off).
--
-- Rules followed: tenant key organization_id; p2_has_role / p2_is_internal
-- policies; no is_platform_admin() policy; audit trigger names <table>_p2_audit;
-- shared helper p2_assert_same_org() is NOT redefined (own guard below).
-- Idempotent.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Existing tables: extend
-- ---------------------------------------------------------------------------
alter table public.itgc_systems
  add column if not exists description text,
  add column if not exists system_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists financial_reporting_relevance text,
  add column if not exists in_scope boolean not null default true,
  add column if not exists criticality text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.itgc_systems drop constraint if exists itgc_systems_status_check;
alter table public.itgc_systems add constraint itgc_systems_status_check
  check (status in ('in_progress','complete','inactive'));
alter table public.itgc_systems drop constraint if exists itgc_systems_relevance_check;
alter table public.itgc_systems add constraint itgc_systems_relevance_check
  check (financial_reporting_relevance is null or financial_reporting_relevance in ('high','medium','low'));
alter table public.itgc_systems drop constraint if exists itgc_systems_criticality_check;
alter table public.itgc_systems add constraint itgc_systems_criticality_check
  check (criticality is null or criticality in ('critical','high','medium','low'));
create unique index if not exists uq_itgc_systems_name on public.itgc_systems(organization_id, lower(name));

alter table public.itgc_controls
  add column if not exists control_id uuid references public.controls(id) on delete set null,
  add column if not exists assertions text[],
  add column if not exists frequency text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists test_plan_id uuid references public.test_plans(id) on delete set null,
  add column if not exists evidence_id uuid references public.evidence(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
alter table public.itgc_controls drop constraint if exists itgc_controls_status_check;
alter table public.itgc_controls add constraint itgc_controls_status_check check (status in ('active','inactive'));
alter table public.itgc_controls drop constraint if exists itgc_controls_frequency_check;
alter table public.itgc_controls add constraint itgc_controls_frequency_check
  check (frequency is null or frequency in ('continuous','daily','weekly','monthly','quarterly','annual','ad_hoc'));
create unique index if not exists uq_itgc_controls_ref on public.itgc_controls(organization_id, lower(control_ref)) where control_ref is not null;
create unique index if not exists uq_itgc_controls_plan on public.itgc_controls(test_plan_id) where test_plan_id is not null;
create index if not exists idx_itgc_controls_system on public.itgc_controls(system_id);
create index if not exists idx_itgc_controls_control on public.itgc_controls(control_id);

alter table public.automated_controls
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists change_dependency text,
  add column if not exists depends_on_itgc_id uuid references public.itgc_controls(id) on delete set null,
  add column if not exists test_plan_id uuid references public.test_plans(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_automated_controls_ref on public.automated_controls(organization_id, lower(control_ref)) where control_ref is not null;
create unique index if not exists uq_automated_controls_plan on public.automated_controls(test_plan_id) where test_plan_id is not null;
create index if not exists idx_automated_controls_system on public.automated_controls(system_id);

-- ---------------------------------------------------------------------------
-- 2. Own tenant-integrity guard (the shared p2_assert_same_org is not touched)
-- ---------------------------------------------------------------------------
create or replace function public.p2_itgc_same_org()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  v_org uuid := (j->>'organization_id')::uuid;
  col text;
  tbl text;
  ok boolean;
begin
  for col, tbl in
    select c, t from (values
      ('control_id','controls'), ('linked_sox_control_id','controls'),
      ('system_id','itgc_systems'), ('itgc_control_id','itgc_controls'),
      ('automated_control_id','automated_controls'), ('depends_on_itgc_id','itgc_controls'),
      ('test_plan_id','test_plans'), ('test_step_id','test_steps'),
      ('evidence_id','evidence'), ('configuration_evidence_id','evidence'),
      ('deficiency_id','deficiencies'), ('linked_deficiency_id','deficiencies')
    ) as v(c, t)
  loop
    if j ? col and j->>col is not null then
      execute format('select exists (select 1 from public.%I where id = $1 and organization_id = $2)', tbl)
        into ok using (j->>col)::uuid, v_org;
      if not ok then
        raise exception 'Cross-tenant or missing reference: %.% -> %', tg_table_name, col, tbl using errcode = '23503';
      end if;
    end if;
  end loop;
  for col in select unnest(array['owner_user_id','system_owner_user_id','assigned_to','created_by','submitted_by','decided_by'])
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

create or replace function public.p2_itgc_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end; $$;

-- A system / ITGC / automated control that has been tested or has exceptions
-- is retired (set inactive), not deleted.
create or replace function public.p2_itgc_delete_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_table_name = 'itgc_systems' then
    if exists (select 1 from public.itgc_controls where system_id = old.id)
       or exists (select 1 from public.automated_controls where system_id = old.id)
       or exists (select 1 from public.control_system_dependencies where system_id = old.id) then
      raise exception 'This system has ITGCs, automated controls or dependencies; set it inactive instead of deleting'
        using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'itgc_controls' then
    if old.test_plan_id is not null or exists (select 1 from public.itgc_exceptions where itgc_control_id = old.id) then
      raise exception 'This ITGC has been tested or has exceptions; set it inactive instead of deleting' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'automated_controls' then
    if old.test_plan_id is not null
       or exists (select 1 from public.automated_control_configurations where automated_control_id = old.id and status <> 'draft')
       or exists (select 1 from public.itgc_exceptions where automated_control_id = old.id) then
      raise exception 'This automated control has been tested, has reviewed configurations or exceptions; set it inactive instead of deleting'
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Financial control <-> system dependencies
-- ---------------------------------------------------------------------------
create table if not exists public.control_system_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  control_id uuid not null references public.controls(id) on delete cascade,
  system_id uuid not null references public.itgc_systems(id) on delete cascade,
  dependency_type text not null default 'application_data',
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint csd_type check (dependency_type in
    ('automated_control','system_report','interface','application_data','manual_with_system_data')),
  unique (control_id, system_id, dependency_type)
);
create index if not exists idx_csd_org on public.control_system_dependencies(organization_id);
create index if not exists idx_csd_system on public.control_system_dependencies(system_id);
alter table public.control_system_dependencies enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Automated-control configurations: versioned, hash-approved
-- ---------------------------------------------------------------------------
create table if not exists public.automated_control_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automated_control_id uuid not null references public.automated_controls(id) on delete cascade,
  version integer not null default 1,
  configuration_summary text,
  configuration_evidence_id uuid references public.evidence(id) on delete set null,
  conclusion text,
  content_hash text,
  status text not null default 'draft',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_status check (status in ('draft','submitted','returned','approved','superseded')),
  unique (automated_control_id, version)
);
create unique index if not exists uq_acc_one_open on public.automated_control_configurations(automated_control_id)
  where status in ('draft','submitted','returned');
create index if not exists idx_acc_org on public.automated_control_configurations(organization_id);
alter table public.automated_control_configurations enable row level security;

create or replace function public.p2_config_hash(p_config uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    c.automated_control_id::text || E'\x1f' || c.version::text || E'\x1f' ||
    coalesce(c.configuration_summary,'') || E'\x1f' ||
    coalesce(c.configuration_evidence_id::text,'') || E'\x1f' ||
    coalesce(c.conclusion,''), 'UTF8')), 'hex')
  from public.automated_control_configurations c where c.id = p_config;
$$;

create or replace function public.p2_config_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated','anon') then
      if new.status <> 'draft' or new.content_hash is not null or new.submitted_by is not null or new.decided_by is not null then
        raise exception 'A configuration record must start as a draft' using errcode = 'P0001';
      end if;
      new.created_by := auth.uid();
      new.version := coalesce((select max(version) from public.automated_control_configurations
                                where automated_control_id = new.automated_control_id), 0) + 1;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft configuration can be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if current_user in ('authenticated','anon') then
    if (new.status, new.version, new.content_hash, new.submitted_by, new.submitted_at,
        new.decided_by, new.decided_at, new.decision_note, new.automated_control_id)
       is distinct from
       (old.status, old.version, old.content_hash, old.submitted_by, old.submitted_at,
        old.decided_by, old.decided_at, old.decision_note, old.automated_control_id) then
      raise exception 'Configuration workflow fields change only through the workflow functions' using errcode = 'P0001';
    end if;
    if old.status not in ('draft','returned') then
      raise exception 'This configuration is % and locked; record a new version to change it', old.status using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.p2_submit_config(p_config uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c public.automated_control_configurations%rowtype; v_hash text;
begin
  select * into c from public.automated_control_configurations where id = p_config for update;
  if not found or not public.p2_has_role(c.organization_id, array['owner','admin','internal_auditor']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if c.status not in ('draft','returned') then raise exception 'Only a draft or returned configuration can be submitted'; end if;
  if length(btrim(coalesce(c.configuration_summary,''))) < 10 then raise exception 'A configuration summary is required to submit'; end if;
  if c.configuration_evidence_id is null then raise exception 'Configuration evidence must be linked before submitting'; end if;
  if length(btrim(coalesce(c.conclusion,''))) < 20 then raise exception 'A conclusion (at least 20 characters) is required to submit'; end if;
  v_hash := public.p2_config_hash(p_config);
  update public.automated_control_configurations
     set status = 'submitted', content_hash = v_hash, submitted_by = auth.uid(), submitted_at = now(),
         decided_by = null, decided_at = null, decision_note = null
   where id = p_config;
  return v_hash;
end; $$;

create or replace function public.p2_decide_config(p_config uuid, p_decision text, p_comment text, p_expected_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.automated_control_configurations%rowtype;
begin
  select * into c from public.automated_control_configurations where id = p_config for update;
  if not found then raise exception 'Configuration not found'; end if;
  if not public.p2_has_role(c.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Only a controller/CFO/admin/owner can decide a configuration conclusion' using errcode = '42501';
  end if;
  if p_decision not in ('approved','returned') then raise exception 'Decision must be approved or returned'; end if;
  if c.status <> 'submitted' then raise exception 'Configuration is not awaiting a decision (%)', c.status; end if;
  if c.submitted_by = auth.uid() then
    raise exception 'The person who submitted the configuration cannot decide it' using errcode = 'P0001';
  end if;
  if public.p2_config_hash(p_config) is distinct from c.content_hash or p_expected_hash is distinct from c.content_hash then
    raise exception 'The configuration changed or is not the version you reviewed: reload and review again' using errcode = 'P0001';
  end if;
  if p_decision = 'returned' and length(coalesce(btrim(p_comment),'')) < 5 then
    raise exception 'A comment is required when returning a configuration';
  end if;
  update public.automated_control_configurations
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_comment),'')
   where id = p_config;
  if p_decision = 'approved' then
    update public.automated_control_configurations
       set status = 'superseded'
     where automated_control_id = c.automated_control_id and id <> p_config and status = 'approved';
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. ITGC exceptions: failed test steps routed for review
-- ---------------------------------------------------------------------------
create table if not exists public.itgc_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  itgc_control_id uuid references public.itgc_controls(id) on delete cascade,
  automated_control_id uuid references public.automated_controls(id) on delete cascade,
  test_plan_id uuid references public.test_plans(id) on delete cascade,
  test_step_id uuid not null references public.test_steps(id) on delete cascade,
  description text,
  status text not null default 'open',
  assigned_to uuid references auth.users(id) on delete set null,
  review_note text,
  deficiency_id uuid references public.deficiencies(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  raised_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint itgc_exc_status check (status in ('open','in_review','deficiency_raised','cleared','withdrawn')),
  constraint itgc_exc_target check ((itgc_control_id is not null)::int + (automated_control_id is not null)::int = 1),
  unique (test_step_id)
);
create index if not exists idx_itgc_exc_org on public.itgc_exceptions(organization_id, status);
alter table public.itgc_exceptions enable row level security;

-- Phase 1 records a failed step as test_steps.status = 'exception'. When that step
-- belongs to a plan linked to an ITGC / automated control, queue it for review.
create or replace function public.p2_itgc_route_exception()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_itgc uuid;
  v_auto uuid;
begin
  if new.status = 'exception' and (tg_op = 'INSERT' or old.status is distinct from 'exception') then
    select id into v_itgc from public.itgc_controls where test_plan_id = new.test_plan_id and organization_id = new.organization_id;
    select id into v_auto from public.automated_controls where test_plan_id = new.test_plan_id and organization_id = new.organization_id;
    if v_itgc is not null or v_auto is not null then
      insert into public.itgc_exceptions (organization_id, itgc_control_id, automated_control_id, test_plan_id, test_step_id, description)
      values (new.organization_id, v_itgc, case when v_itgc is null then v_auto end, new.test_plan_id, new.id,
              coalesce(nullif(btrim(new.actual_result),''), new.description))
      on conflict (test_step_id) do update
        set status = case when public.itgc_exceptions.status = 'withdrawn' then 'open' else public.itgc_exceptions.status end,
            description = excluded.description;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'exception' and new.status is distinct from 'exception' then
    update public.itgc_exceptions set status = 'withdrawn'
     where test_step_id = new.id and status in ('open','in_review');
  end if;
  return new;
end;
$$;

drop trigger if exists test_steps_itgc_route on public.test_steps;
create trigger test_steps_itgc_route after insert or update of status on public.test_steps
  for each row execute function public.p2_itgc_route_exception();

create or replace function public.p2_itgc_exception_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_user in ('authenticated','anon') then
    if (new.status, new.review_note, new.deficiency_id, new.decided_by, new.decided_at, new.test_step_id,
        new.itgc_control_id, new.automated_control_id)
       is distinct from
       (old.status, old.review_note, old.deficiency_id, old.decided_by, old.decided_at, old.test_step_id,
        old.itgc_control_id, old.automated_control_id) then
      raise exception 'Exception review decisions are recorded only through the review functions' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.p2_itgc_review_exception(p_exception uuid, p_action text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.itgc_exceptions%rowtype;
begin
  select * into e from public.itgc_exceptions where id = p_exception for update;
  if not found then raise exception 'Exception not found'; end if;
  if p_action = 'start_review' then
    if not public.p2_has_role(e.organization_id, array['owner','admin','cfo','controller','internal_auditor']) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    if e.status <> 'open' then raise exception 'Only an open exception can be taken into review (%)', e.status; end if;
    update public.itgc_exceptions set status = 'in_review', assigned_to = coalesce(assigned_to, auth.uid()) where id = p_exception;
  elsif p_action = 'clear' then
    if not public.p2_has_role(e.organization_id, array['owner','admin','cfo','controller']) then
      raise exception 'Only a controller/CFO/admin/owner can clear an exception' using errcode = '42501';
    end if;
    if e.status <> 'in_review' then raise exception 'Take the exception into review before clearing it (%)', e.status; end if;
    if length(coalesce(btrim(p_note),'')) < 10 then raise exception 'A rationale of at least 10 characters is required to clear an exception'; end if;
    update public.itgc_exceptions
       set status = 'cleared', review_note = btrim(p_note), decided_by = auth.uid(), decided_at = now()
     where id = p_exception;
  else
    raise exception 'Unknown action %', p_action;
  end if;
end; $$;

create or replace function public.p2_itgc_raise_deficiency(p_exception uuid, p_title text, p_severity text, p_description text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.itgc_exceptions%rowtype; v_control uuid; v_def uuid;
begin
  select * into e from public.itgc_exceptions where id = p_exception for update;
  if not found then raise exception 'Exception not found'; end if;
  if not public.p2_has_role(e.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Only a controller/CFO/admin/owner can raise a deficiency from an exception' using errcode = '42501';
  end if;
  if e.status not in ('open','in_review') then raise exception 'This exception is already decided (%)', e.status; end if;
  if length(coalesce(btrim(p_title),'')) < 3 then raise exception 'A deficiency title is required'; end if;
  if p_severity not in ('low','medium','high','critical') then raise exception 'Severity must be low, medium, high or critical'; end if;
  select coalesce(i.control_id, a.linked_sox_control_id) into v_control
    from (select 1) x
    left join public.itgc_controls i on i.id = e.itgc_control_id
    left join public.automated_controls a on a.id = e.automated_control_id;
  insert into public.deficiencies (organization_id, control_id, test_step_id, title, description, severity)
    values (e.organization_id, v_control, e.test_step_id, btrim(p_title), nullif(btrim(p_description),''), p_severity)
    returning id into v_def;
  update public.itgc_exceptions
     set status = 'deficiency_raised', deficiency_id = v_def, decided_by = auth.uid(), decided_at = now(),
         review_note = nullif(btrim(p_description),'')
   where id = p_exception;
  if e.itgc_control_id is not null then
    update public.itgc_controls set deficiency_id = v_def where id = e.itgc_control_id;
  else
    update public.automated_controls set linked_deficiency_id = v_def where id = e.automated_control_id;
  end if;
  return v_def;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['itgc_systems','itgc_controls','automated_controls'] loop
    execute format('drop trigger if exists %1$s_p2_same_org on public.%1$I', t);
    execute format('create trigger %1$s_p2_same_org before insert or update on public.%1$I for each row execute function public.p2_itgc_same_org()', t);
    execute format('drop trigger if exists %1$s_p2_touch on public.%1$I', t);
    execute format('create trigger %1$s_p2_touch before update on public.%1$I for each row execute function public.p2_itgc_touch()', t);
    execute format('drop trigger if exists %1$s_p2_delete_guard on public.%1$I', t);
    execute format('create trigger %1$s_p2_delete_guard before delete on public.%1$I for each row execute function public.p2_itgc_delete_guard()', t);
  end loop;
  -- the <table>_p2_audit triggers on these three tables already exist (Session A, 20261021000011);
  -- (re)create them identically so a fresh database is also covered.
  foreach t in array array['itgc_systems','itgc_controls','automated_controls',
                           'control_system_dependencies','automated_control_configurations','itgc_exceptions'] loop
    execute format('drop trigger if exists %1$s_p2_audit on public.%1$I', t);
    execute format('create trigger %1$s_p2_audit after insert or update or delete on public.%1$I for each row execute function public.p2_audit()', t);
  end loop;

  foreach t in array array['control_system_dependencies','automated_control_configurations','itgc_exceptions'] loop
    execute format('drop trigger if exists %1$s_p2_same_org on public.%1$I', t);
    execute format('create trigger %1$s_p2_same_org before insert or update on public.%1$I for each row execute function public.p2_itgc_same_org()', t);
  end loop;
end $$;

drop trigger if exists acc_p2_guard on public.automated_control_configurations;
create trigger acc_p2_guard before insert or update or delete on public.automated_control_configurations
  for each row execute function public.p2_config_guard();
drop trigger if exists itgc_exceptions_p2_guard on public.itgc_exceptions;
create trigger itgc_exceptions_p2_guard before update on public.itgc_exceptions
  for each row execute function public.p2_itgc_exception_guard();

-- ---------------------------------------------------------------------------
-- 7. Row-level security (internal roles only; approved configurations are shareable)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['itgc_systems','itgc_controls','automated_controls'] loop
    execute format('drop policy if exists "org members can view %s" on public.%I', replace(t,'_',' '), t);
    execute format('drop policy if exists "management and auditors can create %s" on public.%I', replace(t,'_',' '), t);
    execute format('drop policy if exists "management and auditors can update %s" on public.%I', replace(t,'_',' '), t);
    execute format('drop policy if exists "p2 select" on public.%I', t);
    execute format('create policy "p2 select" on public.%I for select using (public.p2_is_internal(organization_id))', t);
    execute format('drop policy if exists "p2 insert" on public.%I', t);
    execute format($p$create policy "p2 insert" on public.%I for insert
      with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))$p$, t);
    execute format('drop policy if exists "p2 update" on public.%I', t);
    execute format($p$create policy "p2 update" on public.%I for update
      using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))$p$, t);
  end loop;
end $$;

drop policy if exists "p2 select" on public.control_system_dependencies;
create policy "p2 select" on public.control_system_dependencies for select using (public.p2_is_internal(organization_id));
drop policy if exists "p2 write" on public.control_system_dependencies;
create policy "p2 write" on public.control_system_dependencies for all
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']))
  with check (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

drop policy if exists "p2 select" on public.automated_control_configurations;
create policy "p2 select" on public.automated_control_configurations for select using (
  public.p2_is_internal(organization_id)
  or (public.p2_has_role(organization_id, array['external_auditor','viewer']) and status = 'approved'));
drop policy if exists "p2 insert" on public.automated_control_configurations;
create policy "p2 insert" on public.automated_control_configurations for insert
  with check (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 update" on public.automated_control_configurations;
create policy "p2 update" on public.automated_control_configurations for update
  using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));
drop policy if exists "p2 delete" on public.automated_control_configurations;
create policy "p2 delete" on public.automated_control_configurations for delete
  using (public.p2_has_role(organization_id, array['owner','admin','internal_auditor']));

drop policy if exists "p2 select" on public.itgc_exceptions;
create policy "p2 select" on public.itgc_exceptions for select using (public.p2_is_internal(organization_id));
drop policy if exists "p2 update" on public.itgc_exceptions;
create policy "p2 update" on public.itgc_exceptions for update
  using (public.p2_has_role(organization_id, array['owner','admin','cfo','controller','internal_auditor']));

-- ---------------------------------------------------------------------------
-- 8. Coverage, results and dependencies (security invoker: runs under the caller's RLS)
-- ---------------------------------------------------------------------------
create or replace function public.p2_itgc_coverage(p_org uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  with sys as (
    select s.* from public.itgc_systems s where s.organization_id = p_org and s.status <> 'inactive'
  ),
  ic as (
    select i.*, p.status as plan_status,
      (select count(*) from public.test_steps t where t.test_plan_id = i.test_plan_id) as steps_total,
      (select count(*) from public.test_steps t where t.test_plan_id = i.test_plan_id and t.status = 'pass') as steps_pass,
      (select count(*) from public.test_steps t where t.test_plan_id = i.test_plan_id and t.status = 'exception') as steps_exception,
      (select count(*) from public.test_steps t where t.test_plan_id = i.test_plan_id and t.status = 'not_started') as steps_open,
      (select count(*) from public.itgc_exceptions x where x.itgc_control_id = i.id and x.status in ('open','in_review')) as open_exceptions
    from public.itgc_controls i
    left join public.test_plans p on p.id = i.test_plan_id
    where i.organization_id = p_org and i.status = 'active'
  ),
  ac as (
    select a.*,
      exists (select 1 from public.automated_control_configurations c where c.automated_control_id = a.id and c.status = 'approved') as config_approved,
      (select count(*) from public.itgc_exceptions x where x.automated_control_id = a.id and x.status in ('open','in_review')) as open_exceptions
    from public.automated_controls a
    where a.organization_id = p_org and a.status = 'active'
  ),
  per_system as (
    select s.id, s.name, s.system_type, s.financial_reporting_relevance, s.criticality, s.in_scope,
      (select count(*) from ic where ic.system_id = s.id and ic.category = 'access') as n_access,
      (select count(*) from ic where ic.system_id = s.id and ic.category = 'change') as n_change,
      (select count(*) from ic where ic.system_id = s.id and ic.category = 'operations') as n_operations,
      (select count(*) from ic where ic.system_id = s.id) as n_itgc,
      (select count(*) from ac where ac.system_id = s.id) as n_automated,
      (select count(*) from public.control_system_dependencies d where d.system_id = s.id) as n_dependent_controls,
      coalesce((select jsonb_agg(jsonb_build_object(
          'id', ic.id, 'ref', ic.control_ref, 'category', ic.category, 'mapped_control_id', ic.control_id,
          'test_plan_id', ic.test_plan_id, 'plan_status', ic.plan_status, 'steps_total', ic.steps_total,
          'steps_pass', ic.steps_pass, 'steps_exception', ic.steps_exception, 'steps_open', ic.steps_open,
          'open_exceptions', ic.open_exceptions) order by ic.control_ref)
        from ic where ic.system_id = s.id), '[]'::jsonb) as controls,
      coalesce((select jsonb_agg(jsonb_build_object(
          'id', ac.id, 'ref', ac.control_ref, 'config_approved', ac.config_approved, 'test_plan_id', ac.test_plan_id,
          'change_dependency', ac.change_dependency, 'depends_on_itgc_id', ac.depends_on_itgc_id,
          'linked_control_id', ac.linked_sox_control_id, 'open_exceptions', ac.open_exceptions) order by ac.control_ref)
        from ac where ac.system_id = s.id), '[]'::jsonb) as automated,
      coalesce((select jsonb_agg(distinct jsonb_build_object('control_id', c.id, 'code', c.code, 'type', d.dependency_type))
                  from public.control_system_dependencies d join public.controls c on c.id = d.control_id
                 where d.system_id = s.id), '[]'::jsonb) as depends
    from sys s
  ),
  gaps as (
    select ps.id as system_id, g.code, g.ref
    from per_system ps
    cross join lateral (
      select 'no_itgc'::text as code, null::text as ref
        where ps.in_scope and ps.financial_reporting_relevance in ('high','medium') and ps.n_itgc = 0
      union all select 'missing_access', null where ps.in_scope and ps.financial_reporting_relevance in ('high','medium') and ps.n_itgc > 0 and ps.n_access = 0
      union all select 'missing_change', null where ps.in_scope and ps.financial_reporting_relevance in ('high','medium') and ps.n_itgc > 0 and ps.n_change = 0
      union all select 'missing_operations', null where ps.in_scope and ps.financial_reporting_relevance in ('high','medium') and ps.n_itgc > 0 and ps.n_operations = 0
      union all select 'untested_itgc', ic.control_ref from ic where ic.system_id = ps.id and ps.in_scope and (ic.test_plan_id is null or ic.plan_status = 'not_started')
      union all select 'unmapped_itgc', ic.control_ref from ic where ic.system_id = ps.id and ps.in_scope and ic.control_id is null
      union all select 'itgc_open_exception', ic.control_ref from ic where ic.system_id = ps.id and ic.open_exceptions > 0
      union all select 'config_not_approved', ac.control_ref from ac where ac.system_id = ps.id and ps.in_scope and not ac.config_approved
      union all select 'automated_untested', ac.control_ref from ac where ac.system_id = ps.id and ps.in_scope and ac.test_plan_id is null
      union all select 'change_dependency_unmapped', ac.control_ref from ac where ac.system_id = ps.id and ps.in_scope
                          and coalesce(btrim(ac.change_dependency),'') <> '' and ac.depends_on_itgc_id is null
      union all select 'automated_open_exception', ac.control_ref from ac where ac.system_id = ps.id and ac.open_exceptions > 0
    ) g
  )
  select jsonb_build_object(
    'generated_at', now(),
    'systems', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'name', ps.name, 'system_type', ps.system_type, 'relevance', ps.financial_reporting_relevance,
        'criticality', ps.criticality, 'in_scope', ps.in_scope,
        'categories', jsonb_build_object('access', ps.n_access, 'change', ps.n_change, 'operations', ps.n_operations),
        'itgc_count', ps.n_itgc, 'automated_count', ps.n_automated, 'dependent_controls', ps.n_dependent_controls,
        'controls', ps.controls, 'automated', ps.automated, 'depends', ps.depends,
        'gaps', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'ref', g.ref) order by g.code, g.ref)
                           from gaps g where g.system_id = ps.id), '[]'::jsonb)) order by ps.name)
      from per_system ps), '[]'::jsonb),
    'totals', jsonb_build_object(
      'systems', (select count(*) from per_system),
      'systems_in_scope', (select count(*) from per_system where in_scope),
      'systems_with_gaps', (select count(distinct system_id) from gaps),
      'gaps', (select count(*) from gaps),
      'itgc_controls', (select count(*) from ic),
      'itgc_tested', (select count(*) from ic where test_plan_id is not null and plan_status <> 'not_started'),
      'automated_controls', (select count(*) from ac),
      'automated_config_approved', (select count(*) from ac where config_approved),
      'open_exceptions', (select count(*) from public.itgc_exceptions where organization_id = p_org and status in ('open','in_review')),
      'unassigned_itgc', (select count(*) from public.itgc_controls where organization_id = p_org and system_id is null)
    )
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['p2_itgc_same_org()','p2_itgc_touch()','p2_itgc_delete_guard()','p2_config_guard()',
                           'p2_itgc_route_exception()','p2_itgc_exception_guard()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['p2_config_hash(uuid)','p2_submit_config(uuid)','p2_decide_config(uuid, text, text, text)',
                           'p2_itgc_review_exception(uuid, text, text)','p2_itgc_raise_deficiency(uuid, text, text, text)',
                           'p2_itgc_coverage(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
