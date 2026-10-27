-- ============================================================================
-- Phase 2 / Priority 2: version-bound review for deficiency classifications.
--
-- Generalises the review engine (20261022000100) from 'test_plan' to also cover
-- 'deficiency'. A deficiency classification is submitted as an exact fingerprint
-- (the deficiency row + its compensating controls; lifecycle fields such as
-- status/resolved_at and the review fields themselves are excluded, so remediation
-- progress does not withdraw an approval). Same rules as test plans:
--   * explicit review-approval authority ('review.approve'), never a role alone
--   * separate reviewer (the submitter cannot decide), configurable per engagement
--   * stale / different version refused; content change supersedes the approval
--   * reopen needs permission and a rationale
--   * deficiencies.review_status / reviewer_id / review_date change only through
--     the workflow (direct API edits are rejected)
-- Also: aggregation_groups (internal severity-aggregation analysis) is no longer
-- readable by external roles.
-- Idempotent.
-- ============================================================================
begin;

alter table public.workpaper_reviews drop constraint if exists workpaper_reviews_record_type_check;
alter table public.workpaper_reviews add constraint workpaper_reviews_record_type_check
  check (record_type in ('test_plan','deficiency'));

-- ---------------------------------------------------------------------------
-- Hashing
-- ---------------------------------------------------------------------------
create or replace function public.p2_deficiency_hash(p_def uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    (to_jsonb(d) - 'updated_at' - 'created_at' - 'review_status' - 'reviewer_id' - 'review_date'
                 - 'status' - 'resolved_at')::text || E'\x1e' ||
    coalesce((select string_agg((to_jsonb(c) - 'updated_at' - 'created_at')::text, E'\x1e' order by c.id)
              from public.compensating_controls c where c.deficiency_id = d.id), ''),
    'UTF8')), 'hex')
  from public.deficiencies d
  where d.id = p_def
    and (auth.uid() is null or public.p2_is_internal(d.organization_id));
$$;

create or replace function public.p2_record_hash(p_type text, p_record uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_type when 'test_plan' then public.p2_testplan_hash(p_record)
                     when 'deficiency' then public.p2_deficiency_hash(p_record) end;
$$;

-- ---------------------------------------------------------------------------
-- Supersede on change (generic)
-- ---------------------------------------------------------------------------
create or replace function public.p2_supersede_reviews(p_type text, p_record uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_hash text; v_n integer; v_org uuid;
begin
  if not exists (select 1 from public.workpaper_reviews
                 where record_type = p_type and record_id = p_record and status in ('submitted','approved')) then
    return;
  end if;
  v_hash := public.p2_record_hash(p_type, p_record);
  select organization_id into v_org from public.workpaper_reviews
   where record_type = p_type and record_id = p_record limit 1;
  update public.workpaper_reviews
     set status = 'superseded', superseded_at = now(),
         superseded_reason = 'Content changed after the review was ' || status
   where record_type = p_type and record_id = p_record
     and status in ('submitted','approved') and content_hash is distinct from v_hash;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    if p_type = 'test_plan' then
      update public.test_plans set status = 'in_progress'
       where id = p_record and status in ('final','ready_for_review');
    else
      update public.deficiencies set review_status = 'draft'
       where id = p_record and review_status in ('awaiting_review','approved');
    end if;
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, metadata)
      values (v_org, auth.uid(), 'review_superseded', case p_type when 'test_plan' then 'test_plans' else 'deficiencies' end,
              p_record, jsonb_build_object('reviews', v_n));
  end if;
end; $$;

-- keep the original one-argument form (used by existing callers/tests) as a wrapper
create or replace function public.p2_supersede_reviews(p_plan uuid)
returns void language sql security definer set search_path = public as $$
  select public.p2_supersede_reviews('test_plan', p_plan);
$$;

create or replace function public.p2_review_invalidate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan uuid; v_row jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_table_name = 'deficiencies' then
    perform public.p2_supersede_reviews('deficiency', (v_row->>'id')::uuid);
    return coalesce(new, old);
  elsif tg_table_name = 'compensating_controls' then
    perform public.p2_supersede_reviews('deficiency', (v_row->>'deficiency_id')::uuid);
    return coalesce(new, old);
  elsif tg_table_name = 'evidence' then
    for v_plan in select distinct s.test_plan_id from public.test_step_evidence se
                  join public.test_steps s on s.id = se.test_step_id
                  where se.evidence_id = (v_row->>'id')::uuid loop
      perform public.p2_supersede_reviews('test_plan', v_plan);
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
  if v_plan is not null then perform public.p2_supersede_reviews('test_plan', v_plan); end if;
  return coalesce(new, old);
end; $$;

do $$
declare t text;
begin
  foreach t in array array['deficiencies','compensating_controls'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_review_invalidate', t);
      execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.p2_review_invalidate()', t || '_review_invalidate', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Review state of a deficiency changes only through the workflow
-- ---------------------------------------------------------------------------
create or replace function public.p2_deficiency_review_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.review_status <> 'draft' then
        raise exception 'A new deficiency must start as a draft' using errcode = 'P0001';
      end if;
    elsif (new.review_status, new.reviewer_id, new.review_date)
          is distinct from (old.review_status, old.reviewer_id, old.review_date) then
      raise exception 'Review state changes only through submit / approve / return / reopen' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists deficiencies_review_guard on public.deficiencies;
create trigger deficiencies_review_guard before insert or update on public.deficiencies
  for each row execute function public.p2_deficiency_review_guard();

-- ---------------------------------------------------------------------------
-- Workflow functions: dispatch on record type
-- ---------------------------------------------------------------------------
create or replace function public.p2_submit_for_review(p_type text, p_record uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ver integer; v_id uuid; p public.test_plans%rowtype; d public.deficiencies%rowtype;
begin
  if p_type = 'test_plan' then
    select * into p from public.test_plans where id = p_record for update;
    if not found or not public.p2_has_role(p.organization_id, array['owner','admin','internal_auditor']) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    v_org := p.organization_id;
    if not exists (select 1 from public.test_steps where test_plan_id = p_record) then
      raise exception 'Add at least one test step before submitting for review';
    end if;
  elsif p_type = 'deficiency' then
    select * into d from public.deficiencies where id = p_record for update;
    if not found or not public.p2_has_role(d.organization_id, array['owner','admin','internal_auditor']) then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    v_org := d.organization_id;
    if coalesce(trim(d.draft_classification),'') = '' or coalesce(trim(d.classification_rationale),'') = '' then
      raise exception 'A draft classification and its rationale are required before submitting for review';
    end if;
  else
    raise exception 'Unsupported record type';
  end if;
  if exists (select 1 from public.workpaper_reviews where record_type = p_type and record_id = p_record and status = 'submitted') then
    raise exception 'This item is already awaiting review';
  end if;
  if exists (select 1 from public.workpaper_reviews where record_type = p_type and record_id = p_record and status = 'approved') then
    raise exception 'This item is already approved: reopen it first';
  end if;
  v_ver := coalesce((select max(record_version) from public.workpaper_reviews
                     where record_type = p_type and record_id = p_record), 0) + 1;
  insert into public.workpaper_reviews (organization_id, record_type, record_id, record_version, content_hash, submitted_by)
    values (v_org, p_type, p_record, v_ver, public.p2_record_hash(p_type, p_record), auth.uid())
    returning id into v_id;
  if p_type = 'test_plan' then
    update public.test_plans set status = 'ready_for_review' where id = p_record;
  else
    update public.deficiencies set review_status = 'awaiting_review' where id = p_record;
  end if;
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
  if r.record_type = 'test_plan' then
    select assigned_to into v_assignee from public.test_plans where id = r.record_id;
  end if;
  if v_sep and (auth.uid() = r.submitted_by or auth.uid() = v_assignee) then
    raise exception 'This engagement requires a separate reviewer: preparers cannot decide their own work'
      using errcode = 'P0001';
  end if;
  if public.p2_record_hash(r.record_type, r.record_id) is distinct from r.content_hash
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
  if r.record_type = 'test_plan' then
    update public.test_plans set status = case when p_decision = 'approved' then 'final' else 'in_progress' end
     where id = r.record_id;
  else
    update public.deficiencies
       set review_status = case when p_decision = 'approved' then 'approved' else 'returned' end,
           reviewer_id = auth.uid(), review_date = current_date
     where id = r.record_id;
  end if;
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
  if r.record_type = 'test_plan' then
    update public.test_plans set status = 'in_progress' where id = r.record_id;
  else
    update public.deficiencies set review_status = 'draft' where id = r.record_id;
  end if;
  perform public.p2_log(r.organization_id, 'review_reopened',
                        case r.record_type when 'test_plan' then 'test_plans' else 'deficiencies' end, r.record_id,
                        jsonb_build_object('reason', trim(p_reason), 'version', r.record_version));
end; $$;

-- comments on deficiencies: same cross-tenant guard
create or replace function public.p2_wp_comment_target_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'test_plan' and not exists
     (select 1 from public.test_plans t where t.id = new.target_id and t.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: workpaper' using errcode = '23503';
  end if;
  if new.target_type = 'auditor_request' and not exists
     (select 1 from public.auditor_requests a where a.id = new.target_id and a.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: auditor request' using errcode = '23503';
  end if;
  if new.target_type = 'deficiency' and not exists
     (select 1 from public.deficiencies d where d.id = new.target_id and d.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: deficiency' using errcode = '23503';
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Aggregation groups are internal severity analysis
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.aggregation_groups') is not null then
    drop policy if exists "p2 internal only raw" on public.aggregation_groups;
    create policy "p2 internal only raw" on public.aggregation_groups as restrictive for select
      using (public.p2_is_internal(organization_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'p2_deficiency_review_guard()','p2_supersede_reviews(text, uuid)','p2_supersede_reviews(uuid)',
    'p2_review_invalidate()','p2_wp_comment_target_guard()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['p2_deficiency_hash(uuid)','p2_record_hash(text, uuid)',
                           'p2_submit_for_review(text, uuid)','p2_decide_review(uuid, text, text, text)','p2_reopen_review(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
