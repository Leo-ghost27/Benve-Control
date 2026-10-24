-- ============================================================================
-- Phase 2 / Priority 2: assigned work, version-bound review workflow,
-- supersede-on-change (comments reuse the existing workpaper_comments table).
--
-- Scope of this migration: record_type 'test_plan' (the core testing workpaper:
-- plan + steps + linked evidence + population/sample results). The review table
-- is polymorphic (record_type/record_id) so other records can be added later.
--
-- Rules enforced in the database:
--   * Review decisions are bound to an exact content hash. Approving a stale or
--     different version is refused.
--   * Approval authority is an explicit engagement permission ('review.approve'),
--     never a role alone (a CPA/adviser is not an approver by default).
--   * Preparers (submitter / assignee) cannot approve their own work while the
--     engagement requires separate review (default: required).
--   * If anything in an approved/submitted workpaper changes, the review is
--     superseded and a 'final'/'ready_for_review' plan drops back to 'in_progress'.
--   * 'final' can only be reached through an approved review of the CURRENT
--     version; leaving 'final' requires reopening with a rationale.
-- Idempotent.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Assignment, due date, period on test plans
-- ---------------------------------------------------------------------------
alter table public.test_plans
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists reporting_period_id uuid references public.reporting_periods(id) on delete set null;
create index if not exists idx_test_plans_assignee on public.test_plans(organization_id, assigned_to);
create index if not exists idx_test_plans_due on public.test_plans(organization_id, due_date);

create or replace function public.p2_testplan_assign_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.assigned_to is not null and not exists (
       select 1 from public.organization_members m
       where m.organization_id = new.organization_id and m.user_id = new.assigned_to
         and m.role::text in ('owner','admin','cfo','controller','internal_auditor','adviser')) then
    raise exception 'Work can only be assigned to an internal member of this workspace' using errcode = 'P0001';
  end if;
  if new.reporting_period_id is not null and not exists (
       select 1 from public.reporting_periods p
       where p.id = new.reporting_period_id and p.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: reporting period' using errcode = '23503';
  end if;
  return new;
end; $$;
drop trigger if exists test_plans_assign_guard on public.test_plans;
create trigger test_plans_assign_guard before insert or update of assigned_to, reporting_period_id on public.test_plans
  for each row execute function public.p2_testplan_assign_guard();

-- ---------------------------------------------------------------------------
-- 2. Engagement review settings (separate review required by default)
-- ---------------------------------------------------------------------------
create table if not exists public.engagement_review_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  require_separate_review boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.engagement_review_settings enable row level security;
drop policy if exists "p2 internal view review settings" on public.engagement_review_settings;
create policy "p2 internal view review settings" on public.engagement_review_settings
  for select using (public.p2_is_internal(organization_id));
drop trigger if exists review_settings_audit on public.engagement_review_settings;
create trigger review_settings_audit after insert or update or delete on public.engagement_review_settings
  for each row execute function public.p2_audit();

create or replace function public.p2_set_review_setting(p_org uuid, p_require_separate boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.p2_has_role(p_org, array['owner','admin']) then
    raise exception 'Only an owner or admin can change review settings' using errcode = '42501';
  end if;
  insert into public.engagement_review_settings (organization_id, require_separate_review, updated_by)
    values (p_org, p_require_separate, auth.uid())
    on conflict (organization_id) do update
      set require_separate_review = excluded.require_separate_review, updated_by = auth.uid(), updated_at = now();
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Versioned reviews
-- ---------------------------------------------------------------------------
create table if not exists public.workpaper_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_type text not null check (record_type in ('test_plan')),
  record_id uuid not null,
  record_version integer not null,
  content_hash text not null,
  status text not null default 'submitted' check (status in ('submitted','returned','approved','superseded')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  superseded_at timestamptz,
  superseded_reason text,
  reopened_by uuid references auth.users(id) on delete set null,
  unique (record_type, record_id, record_version)
);
create index if not exists idx_wp_reviews_record on public.workpaper_reviews(organization_id, record_type, record_id);
create index if not exists idx_wp_reviews_status on public.workpaper_reviews(organization_id, status);
alter table public.workpaper_reviews enable row level security;
drop policy if exists "p2 reviews select" on public.workpaper_reviews;
create policy "p2 reviews select" on public.workpaper_reviews for select
  using (public.p2_is_internal(organization_id)
         or (status = 'approved' and public.p2_has_role(organization_id, array['external_auditor','viewer'])));
drop trigger if exists wp_reviews_audit on public.workpaper_reviews;
create trigger wp_reviews_audit after insert or update or delete on public.workpaper_reviews
  for each row execute function public.p2_audit();

-- Fingerprint of everything a reviewer is signing off: the plan, its steps,
-- linked evidence, and population/sample results. Workflow metadata (status,
-- assignee, due date, period, preparer/reviewer labels) is excluded.
create or replace function public.p2_testplan_hash(p_plan uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    (to_jsonb(p) - 'updated_at' - 'created_at' - 'status' - 'assigned_to' - 'due_date'
                 - 'reporting_period_id' - 'prepared_by' - 'reviewed_by')::text || E'\x1e' ||
    coalesce((select string_agg((to_jsonb(s) - 'updated_at' - 'created_at')::text, E'\x1e' order by s.step_number, s.id)
              from public.test_steps s where s.test_plan_id = p.id), '') || E'\x1d' ||
    coalesce((select string_agg((to_jsonb(e) - 'updated_at' - 'created_at')::text, E'\x1e' order by e.id)
              from public.evidence e
              where e.id in (select se.evidence_id from public.test_step_evidence se
                             join public.test_steps s2 on s2.id = se.test_step_id
                             where s2.test_plan_id = p.id)), '') || E'\x1d' ||
    coalesce((select string_agg((to_jsonb(po) - 'updated_at' - 'created_at')::text, E'\x1e' order by po.id)
              from public.populations po where po.test_plan_id = p.id), '') || E'\x1d' ||
    coalesce((select string_agg((to_jsonb(si) - 'updated_at' - 'created_at')::text, E'\x1e' order by si.id)
              from public.sample_items si
              where si.population_id in (select po2.id from public.populations po2 where po2.test_plan_id = p.id)), ''),
    'UTF8')), 'hex')
  from public.test_plans p
  where p.id = p_plan
    -- no cross-tenant probing: signed-in callers must be internal members (service role / triggers run with no uid)
    and (auth.uid() is null or public.p2_is_internal(p.organization_id));
$$;

create or replace function public.p2_supersede_reviews(p_plan uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_hash text; v_n integer; v_org uuid;
begin
  if not exists (select 1 from public.workpaper_reviews
                 where record_type = 'test_plan' and record_id = p_plan and status in ('submitted','approved')) then
    return;
  end if;
  v_hash := public.p2_testplan_hash(p_plan);
  select organization_id into v_org from public.workpaper_reviews
   where record_type = 'test_plan' and record_id = p_plan limit 1;
  update public.workpaper_reviews
     set status = 'superseded', superseded_at = now(),
         superseded_reason = 'Content changed after the review was ' || status
   where record_type = 'test_plan' and record_id = p_plan
     and status in ('submitted','approved') and content_hash is distinct from v_hash;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update public.test_plans set status = 'in_progress'
     where id = p_plan and status in ('final','ready_for_review');
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (v_org, auth.uid(), 'review_superseded', 'test_plans', p_plan, jsonb_build_object('reviews', v_n));
  end if;
end; $$;

create or replace function public.p2_review_invalidate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_row jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_table_name = 'evidence' then
    for v_plan in select distinct s.test_plan_id from public.test_step_evidence se
                  join public.test_steps s on s.id = se.test_step_id
                  where se.evidence_id = (v_row->>'id')::uuid loop
      perform public.p2_supersede_reviews(v_plan);
    end loop;
    return coalesce(new, old);
  end if;
  v_plan := case tg_table_name
    when 'test_plans' then (v_row->>'id')::uuid
    when 'test_steps' then (v_row->>'test_plan_id')::uuid
    when 'populations' then (v_row->>'test_plan_id')::uuid
    when 'sample_items' then (select po.test_plan_id from public.populations po where po.id = (v_row->>'population_id')::uuid)
    when 'test_step_evidence' then (select s.test_plan_id from public.test_steps s where s.id = (v_row->>'test_step_id')::uuid)
  end;
  if v_plan is not null then perform public.p2_supersede_reviews(v_plan); end if;
  return coalesce(new, old);
end; $$;

do $$
declare t text;
begin
  foreach t in array array['test_plans','test_steps','test_step_evidence','evidence','populations','sample_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_review_invalidate', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.p2_review_invalidate()', t || '_review_invalidate', t);
  end loop;
end $$;

-- 'final' only via an approved review of the current version; leaving 'final' only via reopen.
create or replace function public.p2_testplan_status_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status in ('final','ready_for_review') then
        raise exception 'A new test plan cannot start as %', new.status using errcode = 'P0001';
      end if;
    elsif new.status is distinct from old.status then
      if old.status = 'final' then
        raise exception 'This workpaper is approved: reopen it with a rationale to change its status' using errcode = 'P0001';
      elsif new.status = 'final' then
        if not exists (select 1 from public.workpaper_reviews r
                       where r.record_type = 'test_plan' and r.record_id = new.id and r.status = 'approved'
                         and r.content_hash = public.p2_testplan_hash(new.id)) then
          raise exception 'Final requires an approved review of the current version' using errcode = 'P0001';
        end if;
      elsif new.status = 'ready_for_review' then
        if not exists (select 1 from public.workpaper_reviews r
                       where r.record_type = 'test_plan' and r.record_id = new.id and r.status = 'submitted') then
          raise exception 'Submit the workpaper for review to mark it ready for review' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists test_plans_status_guard on public.test_plans;
create trigger test_plans_status_guard before insert or update on public.test_plans
  for each row execute function public.p2_testplan_status_guard();

create or replace function public.p2_can_review(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.p2_is_internal(p_org) and public.p2_has_perm(p_org, 'review.approve');
$$;

create or replace function public.p2_submit_for_review(p_type text, p_record uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.test_plans%rowtype; v_ver integer; v_id uuid;
begin
  if p_type <> 'test_plan' then raise exception 'Unsupported record type'; end if;
  select * into p from public.test_plans where id = p_record for update;
  if not found or not public.p2_has_role(p.organization_id, array['owner','admin','internal_auditor']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from public.workpaper_reviews where record_type = 'test_plan' and record_id = p_record and status = 'submitted') then
    raise exception 'This workpaper is already awaiting review';
  end if;
  if exists (select 1 from public.workpaper_reviews where record_type = 'test_plan' and record_id = p_record and status = 'approved') then
    raise exception 'This workpaper is already approved: reopen it first';
  end if;
  if not exists (select 1 from public.test_steps where test_plan_id = p_record) then
    raise exception 'Add at least one test step before submitting for review';
  end if;
  v_ver := coalesce((select max(record_version) from public.workpaper_reviews
                     where record_type = 'test_plan' and record_id = p_record), 0) + 1;
  insert into public.workpaper_reviews (organization_id, record_type, record_id, record_version, content_hash, submitted_by)
    values (p.organization_id, 'test_plan', p_record, v_ver, public.p2_testplan_hash(p_record), auth.uid())
    returning id into v_id;
  update public.test_plans set status = 'ready_for_review' where id = p_record;
  return v_id;
end; $$;

create or replace function public.p2_decide_review(p_review uuid, p_decision text, p_comment text, p_expected_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.workpaper_reviews%rowtype; v_sep boolean; v_assignee uuid;
begin
  select * into r from public.workpaper_reviews where id = p_review for update;
  if not found then raise exception 'Review not found'; end if;
  if not public.p2_can_review(r.organization_id) then
    raise exception 'Only a reviewer who has been explicitly assigned review-approval authority can decide a review'
      using errcode = '42501';
  end if;
  if p_decision not in ('approved','returned') then raise exception 'Decision must be approved or returned'; end if;
  if r.status <> 'submitted' then raise exception 'This review is not awaiting a decision (%)', r.status; end if;
  v_sep := coalesce((select require_separate_review from public.engagement_review_settings
                     where organization_id = r.organization_id), true);
  select assigned_to into v_assignee from public.test_plans where id = r.record_id;
  if v_sep and (auth.uid() = r.submitted_by or auth.uid() = v_assignee) then
    raise exception 'This engagement requires a separate reviewer: preparers cannot decide their own work'
      using errcode = 'P0001';
  end if;
  if public.p2_testplan_hash(r.record_id) is distinct from r.content_hash
     or p_expected_hash is distinct from r.content_hash then
    raise exception 'The workpaper changed or is not the version you reviewed: reload and review again'
      using errcode = 'P0001';
  end if;
  if p_decision = 'returned' and length(coalesce(trim(p_comment),'')) < 5 then
    raise exception 'A comment is required when returning work for rework';
  end if;
  update public.workpaper_reviews
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(p_comment),'')
   where id = p_review;
  update public.test_plans set status = case when p_decision = 'approved' then 'final' else 'in_progress' end
   where id = r.record_id;
end; $$;

create or replace function public.p2_reopen_review(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.workpaper_reviews%rowtype;
begin
  select * into r from public.workpaper_reviews where id = p_review for update;
  if not found then raise exception 'Review not found'; end if;
  if not (public.p2_can_review(r.organization_id) or public.p2_has_role(r.organization_id, array['owner','admin'])) then
    raise exception 'Not permitted to reopen approved work' using errcode = '42501';
  end if;
  if r.status <> 'approved' then raise exception 'Only an approved review can be reopened'; end if;
  if length(coalesce(trim(p_reason),'')) < 10 then
    raise exception 'A rationale of at least 10 characters is required to reopen approved work';
  end if;
  update public.workpaper_reviews
     set status = 'superseded', superseded_at = now(), reopened_by = auth.uid(),
         superseded_reason = 'Reopened: ' || trim(p_reason)
   where id = p_review;
  update public.test_plans set status = 'in_progress' where id = r.record_id;
  perform public.p2_log(r.organization_id, 'review_reopened', 'test_plans', r.record_id,
                        jsonb_build_object('reason', trim(p_reason), 'version', r.record_version));
end; $$;

-- ---------------------------------------------------------------------------
-- 4. Comments: reuse public.workpaper_comments (foundation migration; generic
--    target_type/target_id, internal vs shareable, author forced to the caller,
--    append-only). Only add a guard so a 'test_plan' comment cannot point at
--    another tenant's workpaper.
-- ---------------------------------------------------------------------------
create or replace function public.p2_wp_comment_target_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'test_plan' and not exists
     (select 1 from public.test_plans t where t.id = new.target_id and t.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: workpaper' using errcode = '23503';
  end if;
  return new;
end; $$;
drop trigger if exists wp_comments_target_guard on public.workpaper_comments;
create trigger wp_comments_target_guard before insert on public.workpaper_comments
  for each row execute function public.p2_wp_comment_target_guard();

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'p2_testplan_assign_guard()','p2_supersede_reviews(uuid)','p2_review_invalidate()',
    'p2_testplan_status_guard()','p2_wp_comment_target_guard()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'p2_set_review_setting(uuid, boolean)','p2_testplan_hash(uuid)','p2_can_review(uuid)',
    'p2_submit_for_review(text, uuid)','p2_decide_review(uuid, text, text, text)',
    'p2_reopen_review(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
