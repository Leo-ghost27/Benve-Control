-- Phase 2 / Module 5: Reporting and governance packs.
--
-- Design:
--   * Every count comes from ONE server-side function (p2_report_compute) that reads real records,
--     states its counting basis, and returns the exact records behind each count (so the UI can
--     drill down and a snapshot can be reconciled).
--   * A "pack" is an immutable, versioned snapshot of that computation. Packs are created only by
--     p2_report_generate (never by a direct insert), are hash-bound, and are approved by a reviewer
--     holding explicit review authority. A changed report is a NEW version; approved snapshots are
--     never rewritten. Approving a newer version supersedes the earlier approved one.
--   * Snapshots contain refs, statuses, dates and counts only: no internal notes, investigation
--     text, false-positive rationales, comments, or evidence file names.
--   * External auditors / viewers see a pack only when it is approved AND explicitly shared with
--     them (p2_report_share, rationale required, logged).
--   * Idempotent: safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.report_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods(id) on delete restrict,
  entity_id uuid references public.entities(id) on delete restrict,
  pack_type text not null,
  title text not null,
  version integer not null,
  status text not null default 'draft',
  filters jsonb not null default '{}'::jsonb,
  as_of timestamptz not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  generated_by uuid references auth.users(id) on delete set null,
  generated_by_label text,
  generated_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  shared_with_external boolean not null default false,
  shared_by uuid references auth.users(id) on delete set null,
  shared_at timestamptz,
  share_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_packs_type check (pack_type in
    ('ccm_aging','readiness','questionnaires','group_coverage','itgc','evidence','review_backlog','remediation','governance_pack')),
  constraint report_packs_status check (status in ('draft','submitted','returned','approved','superseded','archived'))
);
create unique index if not exists uq_report_packs_version
  on public.report_packs (organization_id, reporting_period_id, pack_type,
                          coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create index if not exists idx_report_packs_org on public.report_packs (organization_id, reporting_period_id, status);
alter table public.report_packs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Triggers: same-client integrity, immutability, workflow-only writes
-- ---------------------------------------------------------------------------
create or replace function public.p2_report_same_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.reporting_periods where id = new.reporting_period_id and organization_id = new.organization_id) then
    raise exception 'Cross-tenant reference: reporting period belongs to another client' using errcode = 'P0001';
  end if;
  if new.entity_id is not null and not exists (select 1 from public.entities where id = new.entity_id and organization_id = new.organization_id) then
    raise exception 'Cross-tenant reference: entity belongs to another client' using errcode = 'P0001';
  end if;
  return new;
end; $$;

create or replace function public.p2_report_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated','anon') then
      raise exception 'Report packs are created only through the generate function' using errcode = 'P0001';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if current_user in ('authenticated','anon') then
      raise exception 'Report packs cannot be deleted: archive instead (deletion follows the retention process)' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if current_user in ('authenticated','anon') then
    raise exception 'Report pack fields change only through the workflow functions' using errcode = 'P0001';
  end if;
  if (new.snapshot, new.snapshot_hash, new.pack_type, new.version, new.organization_id, new.reporting_period_id,
      new.entity_id, new.filters, new.as_of, new.generated_by, new.generated_by_label, new.generated_at, new.title)
     is distinct from
     (old.snapshot, old.snapshot_hash, old.pack_type, old.version, old.organization_id, old.reporting_period_id,
      old.entity_id, old.filters, old.as_of, old.generated_by, old.generated_by_label, old.generated_at, old.title) then
    raise exception 'A report snapshot is immutable: generate a new version instead' using errcode = 'P0001';
  end if;
  if old.status is distinct from new.status and not (
       (old.status = 'draft'     and new.status in ('submitted','archived')) or
       (old.status = 'submitted' and new.status in ('approved','returned')) or
       (old.status = 'returned'  and new.status = 'archived') or
       (old.status = 'approved'  and new.status = 'superseded')) then
    raise exception 'Illegal report transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists report_packs_same_org on public.report_packs;
create trigger report_packs_same_org before insert or update on public.report_packs
  for each row execute function public.p2_report_same_org();
drop trigger if exists report_packs_guard on public.report_packs;
create trigger report_packs_guard before insert or update or delete on public.report_packs
  for each row execute function public.p2_report_guard();
drop trigger if exists report_packs_audit on public.report_packs;
create trigger report_packs_audit after insert or update or delete on public.report_packs
  for each row execute function public.p2_audit();

-- ---------------------------------------------------------------------------
-- 3. RLS: read only. Internal roles see everything in the client; external auditors / viewers
--    see a pack only when approved AND explicitly shared. No insert/update/delete policies.
-- ---------------------------------------------------------------------------
drop policy if exists "p2 report packs select" on public.report_packs;
create policy "p2 report packs select" on public.report_packs
  for select using (
    public.p2_is_internal(organization_id)
    or (public.p2_has_role(organization_id, array['external_auditor','viewer'])
        and status = 'approved' and shared_with_external)
  );

-- ---------------------------------------------------------------------------
-- 4. Compute helpers
-- ---------------------------------------------------------------------------
create or replace function public.p2_rpt_age(p_days integer)
returns text language sql immutable as $$
  select case when p_days is null then 'unknown' when p_days <= 30 then '0_30' when p_days <= 60 then '31_60'
              when p_days <= 90 then '61_90' else '91_plus' end;
$$;

create or replace function public.p2_rpt_overdue_bucket(p_days_overdue integer)
returns text language sql immutable as $$
  select case when p_days_overdue is null then 'no_due_date' when p_days_overdue <= 0 then 'not_overdue'
              when p_days_overdue <= 30 then 'overdue_1_30' when p_days_overdue <= 60 then 'overdue_31_60'
              else 'overdue_61_plus' end;
$$;

-- Turn metric definitions + flat record rows into the metric objects stored in a snapshot.
-- Each row: {k, rtype, rid, ref, status, due, detail, since}. count = ALL matching rows;
-- records is capped at 500 and flagged truncated (the count is never capped).
create or replace function public.p2_rpt_build(p_defs jsonb, p_rows jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', t.d->>'k', 'label', t.d->>'l', 'basis', t.d->>'b',
      'count', c.n, 'truncated', c.n > 500, 'records', c.recs) order by t.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_defs,'[]'::jsonb)) with ordinality as t(d, ord)
  cross join lateral (
    select count(*)::int as n,
           coalesce(jsonb_agg(s.x order by s.rn) filter (where s.rn <= 500), '[]'::jsonb) as recs
    from (select r as x, row_number() over (order by r->>'ref', r->>'rid') as rn
            from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
           where r->>'k' = t.d->>'k') s
  ) c;
$$;

-- Common guard: only internal roles of THIS client; period and entity must belong to it.
create or replace function public.p2_rpt_guard(p_org uuid, p_period uuid, p_entity uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.p2_is_internal(p_org) then
    raise exception 'Not permitted to read report data for this client' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reporting_periods where id = p_period and organization_id = p_org) then
    raise exception 'Reporting period does not belong to this client' using errcode = 'P0001';
  end if;
  if p_entity is not null and not exists (select 1 from public.entities where id = p_entity and organization_id = p_org) then
    raise exception 'Entity does not belong to this client' using errcode = 'P0001';
  end if;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Sections (one per pack type). All SECURITY DEFINER with an explicit guard and an explicit
--    organization filter on every query.
-- ---------------------------------------------------------------------------

-- 5.1 CCM alerts and follow-up aging
create or replace function public.p2_rpt_ccm(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ps date; pe date; v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  select start_date, end_date into ps, pe from public.reporting_periods where id = p_period;
  with al as (
    select e.id, coalesce(nullif(e.source_record_ref,''), e.exception_ref, '(no reference)') as ref, e.status, e.severity,
           e.assigned_to, coalesce(e.detected_at, e.created_at)::date as since
      from public.ccm_exceptions e where e.organization_id = p_org and e.reporting_period_id = p_period),
  fu as (
    select f.id, coalesce(f.followup_ref, left(coalesce(f.description, f.remediation_action, 'follow-up'), 60)) as ref, f.status,
           coalesce(f.due_date, f.target_completion) as due, f.created_at::date as since
      from public.follow_ups f
     where f.organization_id = p_org and (
           exists (select 1 from public.ccm_exceptions e where e.id = f.ccm_exception_id and e.reporting_period_id = p_period)
        or exists (select 1 from public.readiness_gaps g join public.readiness_assessments a on a.id = g.readiness_assessment_id
                    where g.id = f.readiness_gap_id and a.reporting_period_id = p_period)
        or exists (select 1 from public.subsidiary_questionnaires q where q.id = f.questionnaire_id and q.reporting_period_id = p_period)
        or (f.ccm_exception_id is null and f.readiness_gap_id is null and f.questionnaire_id is null
            and f.created_at::date between ps and pe))),
  r as (
    select 'alerts_total' k, 'ccm_alert' rtype, id rid, ref, status, null::date due, severity detail, since from al
    union all select 'alerts_' || status, 'ccm_alert', id, ref, status, null::date, severity, since from al
    union all select 'alerts_open_unassigned', 'ccm_alert', id, ref, status, null::date, severity, since from al
      where status in ('open','in_review','in_investigation') and assigned_to is null
    union all select 'alerts_age_' || public.p2_rpt_age(current_date - since), 'ccm_alert', id, ref, status, null::date, severity, since from al
      where status in ('open','in_review','in_investigation')
    union all select 'followups_total', 'follow_up', id, ref, status, due, null, since from fu
    union all select 'followups_open', 'follow_up', id, ref, status, due, null, since from fu where status <> 'closed'
    union all select 'followups_closed', 'follow_up', id, ref, status, due, null, since from fu where status = 'closed'
    union all select 'followups_overdue', 'follow_up', id, ref, status, due, null, since from fu where status <> 'closed' and due < current_date
    union all select 'followups_' || public.p2_rpt_overdue_bucket(current_date - due), 'follow_up', id, ref, status, due, null, since from fu where status <> 'closed'
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'alerts_total','Alerts in period','Every CCM alert (manual or imported) with this reporting period, any status.'),
    (2,'alerts_open','Alerts: open','Status = open.'),
    (3,'alerts_in_review','Alerts: in review','Status = in_review.'),
    (4,'alerts_in_investigation','Alerts: in investigation','Status = in_investigation.'),
    (5,'alerts_false_positive','Alerts: closed as false positive','Status = false_positive (a rationale is mandatory in the data model).'),
    (6,'alerts_linked','Alerts: linked to a formal exception','Status = linked.'),
    (7,'alerts_closed','Alerts: closed','Status = closed.'),
    (8,'alerts_open_unassigned','Unresolved alerts with no assignee','Alerts that are open, in review or in investigation with no assignee.'),
    (9,'alerts_age_0_30','Unresolved alerts aged 0-30 days','Open/in-review/in-investigation alerts; age = today minus detection date (creation date if none).'),
    (10,'alerts_age_31_60','Unresolved alerts aged 31-60 days','As above.'),
    (11,'alerts_age_61_90','Unresolved alerts aged 61-90 days','As above.'),
    (12,'alerts_age_91_plus','Unresolved alerts aged over 90 days','As above.'),
    (13,'followups_total','Follow-ups in scope','Follow-ups linked to a CCM alert, readiness gap or questionnaire of this period, plus unlinked follow-ups created within the period dates. Each follow-up is counted once.'),
    (14,'followups_open','Follow-ups: not closed','Status open or in_progress.'),
    (15,'followups_closed','Follow-ups: closed','Status = closed.'),
    (16,'followups_overdue','Follow-ups: overdue','Not closed and due date (or target completion) before today.'),
    (17,'followups_not_overdue','Follow-ups aging: not yet due','Not closed; due today or later.'),
    (18,'followups_overdue_1_30','Follow-ups aging: 1-30 days overdue','Not closed; days past due date.'),
    (19,'followups_overdue_31_60','Follow-ups aging: 31-60 days overdue','As above.'),
    (20,'followups_overdue_61_plus','Follow-ups aging: over 60 days overdue','As above.'),
    (21,'followups_no_due_date','Follow-ups aging: no due date','Not closed and no due date recorded: cannot be aged.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'ccm_aging', 'title', 'CCM alerts and follow-up aging',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array(
      'Monitoring is manual / import-based: alerts are those recorded or imported in Benve Control. No live system is scanned.',
      'Aging is measured as at the generation date shown on this pack.'));
end; $$;

-- 5.2 Readiness gaps and roadmap
create or replace function public.p2_rpt_readiness(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  with asm as (
    select a.id, coalesce(nullif(a.target_milestone,''), 'Assessment') as ref, a.status, a.overall_score, a.created_at::date as since
      from public.readiness_assessments a
     where a.organization_id = p_org and a.reporting_period_id = p_period and a.status <> 'archived'),
  gp as (
    select g.id, left(coalesce(nullif(g.description,''), g.requirement, 'gap'), 70) as ref, g.status, g.gap_severity,
           g.target_date, g.owner_user_id, g.owner, g.created_at::date as since
      from public.readiness_gaps g join asm on asm.id = g.readiness_assessment_id
     where g.organization_id = p_org and g.status <> 'archived'),
  ra as (
    select x.id, coalesce(x.action_ref, left(x.description, 60)) as ref, x.status, x.target_date, x.created_at::date as since
      from public.readiness_roadmap_actions x join gp on gp.id = x.gap_id where x.organization_id = p_org),
  r as (
    select 'asm_total' k, 'readiness_assessment' rtype, id rid, ref, status, null::date due,
           'planning score ' || coalesce(overall_score::text, 'not scored') detail, since from asm
    union all select 'asm_' || status, 'readiness_assessment', id, ref, status, null::date, 'planning score ' || coalesce(overall_score::text, 'not scored'), since from asm
    union all select 'gaps_total', 'readiness_gap', id, ref, status, target_date, gap_severity, since from gp
    union all select 'gaps_sev_' || coalesce(gap_severity, 'unrated'), 'readiness_gap', id, ref, status, target_date, gap_severity, since from gp
    union all select 'gaps_unowned', 'readiness_gap', id, ref, status, target_date, gap_severity, since from gp
      where owner_user_id is null and coalesce(btrim(owner), '') = ''
    union all select 'gaps_not_approved', 'readiness_gap', id, ref, status, target_date, gap_severity, since from gp where status <> 'approved'
    union all select 'gaps_past_target', 'readiness_gap', gp.id, gp.ref, gp.status, gp.target_date, gp.gap_severity, gp.since from gp
      where gp.target_date < current_date
        and not exists (select 1 from public.readiness_roadmap_actions x where x.gap_id = gp.id and x.status = 'complete')
    union all select 'road_total', 'roadmap_action', id, ref, status, target_date, null, since from ra
    union all select 'road_' || status, 'roadmap_action', id, ref, status, target_date, null, since from ra
    union all select 'road_overdue', 'roadmap_action', id, ref, status, target_date, null, since from ra
      where status <> 'complete' and target_date < current_date
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'asm_total','Readiness assessments in period','Assessments for this reporting period, excluding archived.'),
    (2,'asm_draft','Assessments: draft','Workflow status = draft.'),
    (3,'asm_prepared','Assessments: prepared','Workflow status = prepared.'),
    (4,'asm_submitted','Assessments: awaiting review','Workflow status = submitted.'),
    (5,'asm_returned','Assessments: returned','Workflow status = returned.'),
    (6,'asm_approved','Assessments: approved','Workflow status = approved (a reviewer approved a specific version).'),
    (7,'asm_reopened','Assessments: reopened','Workflow status = reopened.'),
    (8,'gaps_total','Gaps in period','Gap register entries on this period''s assessments, excluding archived.'),
    (9,'gaps_sev_high','Gaps: high priority','Gap severity = high.'),
    (10,'gaps_sev_medium','Gaps: medium priority','Gap severity = medium.'),
    (11,'gaps_sev_low','Gaps: low priority','Gap severity = low.'),
    (12,'gaps_sev_unrated','Gaps: priority not set','No severity recorded.'),
    (13,'gaps_unowned','Gaps with no owner','Neither an owner user nor an owner name recorded.'),
    (14,'gaps_not_approved','Gaps not yet review-approved','Gap workflow status other than approved.'),
    (15,'gaps_past_target','Gaps past target date with no completed roadmap action','Target date before today and no roadmap action with status complete.'),
    (16,'road_total','Roadmap actions','Roadmap actions attached to the gaps above.'),
    (17,'road_not_started','Roadmap actions: not started','Status = not_started.'),
    (18,'road_in_progress','Roadmap actions: in progress','Status = in_progress.'),
    (19,'road_complete','Roadmap actions: complete','Status = complete.'),
    (20,'road_overdue','Roadmap actions: overdue','Not complete and target date before today.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'readiness', 'title', 'Readiness gaps and roadmap',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array(
      'Scores are planning indicators calculated by the documented assessment method. They are not a legal determination, regulator approval, or a guarantee of IPO readiness.',
      'Filer status is recorded by management and is never inferred by this report.'));
end; $$;

-- 5.3 Entity questionnaire status
create or replace function public.p2_rpt_questionnaires(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  with q as (
    select sq.id, en.name || ' (' || coalesce(sq.period, 'no period label') || ')' as ref, sq.status, sq.group_review_status, sq.created_at::date as since
      from public.subsidiary_questionnaires sq join public.entities en on en.id = sq.entity_id
     where sq.organization_id = p_org and sq.reporting_period_id = p_period and (p_entity is null or sq.entity_id = p_entity)),
  ent as (
    select e.id, e.name from public.entities e
     where e.organization_id = p_org and e.in_scope and e.status <> 'inactive' and (p_entity is null or e.id = p_entity)),
  r as (
    select 'q_total' k, 'questionnaire' rtype, id rid, ref, status, null::date due, group_review_status detail, since from q
    union all select 'q_' || status, 'questionnaire', id, ref, status, null::date, group_review_status, since from q
    union all select 'qr_' || group_review_status, 'questionnaire', id, ref, status, null::date, group_review_status, since from q
    union all select 'entities_in_scope', 'entity', id, name, null, null::date, null, null::date from ent
    union all select 'entities_without_questionnaire', 'entity', ent.id, ent.name, null, null::date, null, null::date from ent
      where not exists (select 1 from public.subsidiary_questionnaires sq where sq.entity_id = ent.id
                          and sq.reporting_period_id = p_period and sq.organization_id = p_org)
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'q_total','Questionnaires in period','One questionnaire per entity per period; all workflow statuses.'),
    (2,'q_draft','Questionnaires: draft','Workflow status = draft.'),
    (3,'q_prepared','Questionnaires: prepared locally','Workflow status = prepared.'),
    (4,'q_submitted','Questionnaires: submitted to group','Workflow status = submitted.'),
    (5,'q_returned','Questionnaires: returned','Workflow status = returned.'),
    (6,'q_approved','Questionnaires: approved','Workflow status = approved.'),
    (7,'q_reopened','Questionnaires: reopened','Workflow status = reopened.'),
    (8,'qr_not_started','Group review: not started','Group review status = not_started.'),
    (9,'qr_in_review','Group review: in review','Group review status = in_review.'),
    (10,'qr_clarification_requested','Group review: clarification requested','Group review status = clarification_requested.'),
    (11,'qr_accepted','Group review: accepted','Group review status = accepted.'),
    (12,'qr_accepted_with_follow_up','Group review: accepted with follow-up','Group review status = accepted_with_follow_up.'),
    (13,'qr_returned','Group review: returned','Group review status = returned.'),
    (14,'entities_in_scope','Entities in scope','Entities flagged in scope and not inactive.'),
    (15,'entities_without_questionnaire','In-scope entities with no questionnaire this period','In-scope entities that have no questionnaire row for this period.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'questionnaires', 'title', 'Entity questionnaire status',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array('Workflow status (preparation/approval) and group-review status are separate dimensions and are shown separately.'));
end; $$;

-- 5.4 Group control coverage and testing
create or replace function public.p2_rpt_group(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ps date; pe date; v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  select start_date, end_date into ps, pe from public.reporting_periods where id = p_period;
  with ec_all as (
    select ec.id, ec.entity_id, ec.control_id, ec.reliance_type, c.code as ccode, en.name as ename
      from public.entity_controls ec
      join public.controls c on c.id = ec.control_id and c.organization_id = p_org
      join public.entities en on en.id = ec.entity_id and en.organization_id = p_org
     where ec.organization_id = p_org and ec.status = 'active' and en.in_scope and en.status <> 'inactive'),
  shared as (select control_id from ec_all group by control_id having count(distinct entity_id) > 1),
  ec as (select * from ec_all where p_entity is null or entity_id = p_entity),
  ctl as (select distinct control_id, ccode from ec),
  plan as (
    select ctl.control_id, ctl.ccode,
           bool_or(tp.status = 'final') as any_final, count(tp.id) as n_plans
      from ctl left join public.test_plans tp
        on tp.control_id = ctl.control_id and tp.organization_id = p_org and tp.reporting_period_id = p_period
     group by ctl.control_id, ctl.ccode),
  df as (
    select d.id, d.title as ref, d.status, d.severity, d.review_status, d.resolved_at, d.identified_at::date as since
      from public.deficiencies d
     where d.organization_id = p_org
       and d.identified_at::date <= pe and (d.resolved_at is null or d.resolved_at::date >= ps)
       and (d.control_id in (select control_id from ctl) or (p_entity is not null and d.entity_id = p_entity))),
  gs as (
    select s.id, s.title as ref, s.status, s.created_at::date as since
      from public.group_icfr_summaries s where s.organization_id = p_org and s.reporting_period_id = p_period),
  r as (
    select 'defs_unique' k, 'control' rtype, control_id rid, ccode ref, null::text status, null::date due,
           case when control_id in (select control_id from shared) then 'shared' else 'local' end detail, null::date since from ctl
    union all select 'defs_shared', 'control', control_id, ccode, null, null::date, 'shared', null::date from ctl where control_id in (select control_id from shared)
    union all select 'defs_local', 'control', control_id, ccode, null, null::date, 'local', null::date from ctl where control_id not in (select control_id from shared)
    union all select 'instances', 'entity_control', id, ename || ' / ' || ccode, null, null::date, reliance_type, null::date from ec
    union all select 'instances_of_shared', 'entity_control', id, ename || ' / ' || ccode, null, null::date, reliance_type, null::date from ec
      where control_id in (select control_id from shared)
    union all select 'tested_final', 'control', control_id, ccode, 'final', null::date, null, null::date from plan where coalesce(any_final, false)
    union all select 'tested_in_progress', 'control', control_id, ccode, 'in progress', null::date, null, null::date from plan where n_plans > 0 and not coalesce(any_final, false)
    union all select 'not_tested', 'control', control_id, ccode, 'no test plan', null::date, null, null::date from plan where n_plans = 0
    union all select 'def_relevant', 'deficiency', id, ref, status, null::date, severity, since from df
    union all select 'def_open', 'deficiency', id, ref, status, null::date, severity, since from df where resolved_at is null
    union all select 'def_remediated', 'deficiency', id, ref, status, null::date, severity, since from df where resolved_at is not null
    union all select 'def_review_' || coalesce(review_status, 'draft'), 'deficiency', id, ref, status, null::date, severity, since from df
    union all select 'gsum_approved', 'group_summary', id, ref, status, null::date, null, since from gs where status = 'approved'
    union all select 'gsum_pending', 'group_summary', id, ref, status, null::date, null, since from gs where status in ('draft','prepared','submitted','returned','reopened')
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'defs_unique','Unique control definitions in group scope','COUNT OF DISTINCT CONTROLS (not instances): each control definition counted once, however many entities operate it. Active entity-control assignments on in-scope entities.'),
    (2,'defs_shared','  of which shared / group controls','Distinct controls operated by more than one in-scope entity.'),
    (3,'defs_local','  of which entity-local controls','Distinct controls operated by exactly one in-scope entity.'),
    (4,'instances','Entity-control instances (coverage instances)','COUNT OF INSTANCES: one per entity per control. A shared control appears once per entity that operates it, so this total is intentionally larger than the unique-definition count.'),
    (5,'instances_of_shared','  of which instances of shared controls','Entity-control instances whose control is shared.'),
    (6,'tested_final','Controls with a final test plan in period','Distinct controls with at least one test plan for this period in status final.'),
    (7,'tested_in_progress','Controls with testing started, none final','Distinct controls with a test plan for this period but none final.'),
    (8,'not_tested','Controls with no test plan in period','Distinct controls with no test plan for this period.'),
    (9,'def_relevant','Deficiencies relevant to the period (all severities, incl. remediated)','Deficiencies on in-scope controls identified on or before period end and not resolved before period start. No deficiency is excluded for being below a standalone material-weakness level, and remediated items are included where relevant to the period.'),
    (10,'def_open','  of which still open','Relevant deficiencies with no resolution date.'),
    (11,'def_remediated','  of which remediated','Relevant deficiencies with a resolution date.'),
    (12,'def_review_draft','  review status: draft','Deficiency review status = draft (classification not yet submitted).'),
    (13,'def_review_awaiting_review','  review status: awaiting review','Deficiency review status = awaiting_review.'),
    (14,'def_review_approved','  review status: approved','Deficiency review status = approved.'),
    (15,'gsum_approved','Group ICFR summaries: approved','Approved reviewer-signed summaries for the period. Aggregation conclusions are reviewer-approved, never inferred by this report.'),
    (16,'gsum_pending','Group ICFR summaries: not yet approved','Draft/prepared/submitted/returned/reopened summaries.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'group_coverage', 'title', 'Group control coverage and testing',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array(
      'Unique control definitions and entity-control instances are different measurements and are never added together.',
      'This report presents counts; it does not conclude on aggregation of deficiencies. That conclusion is made and approved by a reviewer.'));
end; $$;

-- 5.5 ITGC dependencies and open issues
create or replace function public.p2_rpt_itgc(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_defs jsonb; cov jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  cov := public.p2_itgc_coverage(p_org);
  with sys as (
    select s->>'id' as sid, s->>'name' as sname, (s->>'in_scope')::boolean as in_scope, s->>'relevance' as relevance, s->'gaps' as gaps
      from jsonb_array_elements(coalesce(cov->'systems', '[]'::jsonb)) s),
  gaps as (
    select sys.sid, sys.sname, g->>'code' as code, g->>'ref' as gref
      from sys cross join lateral jsonb_array_elements(sys.gaps) g),
  r as (
    select 'systems_total' k, 'itgc_system' rtype, sid::uuid rid, sname ref, null::text status, null::date due, relevance detail, null::date since from sys
    union all select 'systems_in_scope', 'itgc_system', sid::uuid, sname, null, null::date, relevance, null::date from sys where in_scope
    union all select 'systems_with_gaps', 'itgc_system', sid::uuid, sname, null, null::date, relevance, null::date from sys where jsonb_array_length(gaps) > 0
    union all select 'gaps_total', 'itgc_system', sid::uuid, sname || ': ' || code || coalesce(' ' || gref, ''), null, null::date, code, null::date from gaps
    union all select 'gap_' || code, 'itgc_system', sid::uuid, sname || ': ' || code || coalesce(' ' || gref, ''), null, null::date, code, null::date from gaps
    union all select 'dependencies', 'dependency', d.id, c.code || ' relies on ' || s.name, null, null::date, d.dependency_type, d.created_at::date
      from public.control_system_dependencies d
      join public.controls c on c.id = d.control_id and c.organization_id = p_org
      join public.itgc_systems s on s.id = d.system_id and s.organization_id = p_org
     where d.organization_id = p_org
    union all select 'exceptions_open', 'itgc_exception', x.id, left(coalesce(x.description, 'ITGC exception'), 70), x.status, null::date, null, x.raised_at::date
      from public.itgc_exceptions x where x.organization_id = p_org and x.status in ('open','in_review')
    union all select 'exceptions_deficiency', 'itgc_exception', x.id, left(coalesce(x.description, 'ITGC exception'), 70), x.status, null::date, null, x.raised_at::date
      from public.itgc_exceptions x where x.organization_id = p_org and x.status = 'deficiency_raised'
    union all select 'automated_no_config', 'automated_control', a.id, a.control_ref, a.status, null::date, null, a.created_at::date
      from public.automated_controls a where a.organization_id = p_org and a.status = 'active'
       and not exists (select 1 from public.automated_control_configurations c where c.automated_control_id = a.id and c.status = 'approved')
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'systems_total','Systems in inventory','Active (not inactive) systems in the ITGC inventory.'),
    (2,'systems_in_scope','Systems in scope for financial reporting','Systems flagged in scope.'),
    (3,'systems_with_gaps','Systems with at least one coverage gap','Systems that have one or more coverage gaps listed below.'),
    (4,'gaps_total','Coverage gaps (all types)','Each gap counted once per system and control; a system with several gaps contributes several.'),
    (5,'gap_no_itgc','Gap: high/medium-relevance in-scope system with no ITGC mapped','Rule-based gap, not a conclusion on control effectiveness.'),
    (6,'gap_missing_access','Gap: no access ITGC','Rule-based gap.'),
    (7,'gap_missing_change','Gap: no change-management ITGC','Rule-based gap.'),
    (8,'gap_missing_operations','Gap: no operations ITGC','Rule-based gap.'),
    (9,'gap_untested_itgc','Gap: ITGC not yet tested','ITGC with no test plan or a plan not started.'),
    (10,'gap_unmapped_itgc','Gap: ITGC not mapped to a financial control','ITGC with no linked control.'),
    (11,'gap_itgc_open_exception','Gap: ITGC with open exception','Open or in-review ITGC exception.'),
    (12,'gap_config_not_approved','Gap: automated control configuration not approved','No approved configuration version.'),
    (13,'gap_automated_untested','Gap: automated control not tested','No test plan linked.'),
    (14,'gap_change_dependency_unmapped','Gap: change dependency described but not mapped','Dependency described in text with no ITGC link.'),
    (15,'gap_automated_open_exception','Gap: automated control with open exception','Open or in-review exception.'),
    (16,'dependencies','Control-to-system dependencies','Rows in the dependency map (one per control, system and dependency type).'),
    (17,'exceptions_open','ITGC exceptions open / in review','Failed ITGC and automated-control test steps awaiting a reviewer decision.'),
    (18,'exceptions_deficiency','ITGC exceptions referred as deficiencies','Exceptions a reviewer routed into deficiency evaluation (no classification implied).'),
    (19,'automated_no_config','Automated controls with no approved configuration','Active automated controls without an approved configuration version.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'itgc', 'title', 'ITGC dependencies and open issues',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array(
      'The ITGC inventory is a point-in-time position as at generation; it is not filtered by reporting period or entity.',
      'An ITGC issue does not by itself conclude that dependent automated controls failed. A reviewer-supported reliance decision is required.',
      'Dependent-control impact assessments are not yet tracked as separate records; impact is currently considered through ITGC exception review.'));
end; $$;

-- 5.6 Evidence completeness against documented requirements
create or replace function public.p2_rpt_evidence(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_defs jsonb; v_req jsonb := '[]'::jsonb; v_notes jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  v_notes := jsonb_build_array(
    'Completeness is measured only against requirements documented in Benve Control (listed in each basis). It says nothing about requirements that are not recorded.',
    'Evidence file names and contents are never included in report packs.');
  if to_regclass('public.evidence_requests') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'rtype', 'evidence_request', 'rid', id, 'ref', ref, 'status', status,
                                                    'due', due, 'detail', null, 'since', null)), '[]'::jsonb)
        from (
          select 'req_total' k, r.id, left(r.title, 70) ref, r.status, r.due_date due from public.evidence_requests r where r.organization_id = $1
          union all select 'req_accepted', r.id, left(r.title, 70), r.status, r.due_date from public.evidence_requests r where r.organization_id = $1 and r.status = 'accepted'
          union all select 'req_clarification', r.id, left(r.title, 70), r.status, r.due_date from public.evidence_requests r where r.organization_id = $1 and r.status = 'clarification_requested'
          union all select 'req_rejected', r.id, left(r.title, 70), r.status, r.due_date from public.evidence_requests r where r.organization_id = $1 and r.status = 'rejected'
          union all select 'req_outstanding', r.id, left(r.title, 70), r.status, r.due_date from public.evidence_requests r
            where r.organization_id = $1 and r.status not in ('accepted','rejected','clarification_requested')
          union all select 'req_overdue', r.id, left(r.title, 70), r.status, r.due_date from public.evidence_requests r
            where r.organization_id = $1 and r.status <> 'accepted' and r.due_date < current_date
        ) z $q$ into v_req using p_org;
  else
    v_notes := v_notes || jsonb_build_array('Evidence requests are not available in this environment, so request completeness is not reported.');
  end if;

  with chk as (
    select i.id, left(i.item, 70) as ref, i.status, i.evidence_id, i.created_at::date as since
      from public.readiness_checklist_items i
      join public.readiness_assessments a on a.id = i.assessment_id and a.organization_id = p_org
     where i.organization_id = p_org and a.reporting_period_id = p_period and a.status <> 'archived'),
  fp as (
    select tp.id, tp.name as ref, tp.status, tp.created_at::date as since,
           exists (select 1 from public.test_steps ts join public.test_step_evidence se on se.test_step_id = ts.id
                    where ts.test_plan_id = tp.id) as has_evidence
      from public.test_plans tp
     where tp.organization_id = p_org and tp.reporting_period_id = p_period and tp.status = 'final'),
  gp as (
    select g.id, left(coalesce(nullif(g.description,''), g.requirement, 'gap'), 70) as ref, g.status, g.evidence_id, g.created_at::date as since
      from public.readiness_gaps g join public.readiness_assessments a on a.id = g.readiness_assessment_id
     where g.organization_id = p_org and a.reporting_period_id = p_period and g.status <> 'archived' and a.status <> 'archived'),
  r as (
    select 'chk_unanswered' k, 'readiness_item' rtype, id rid, ref, status, null::date due, null::text detail, since from chk where status = 'not_started'
    union all select 'chk_in_progress', 'readiness_item', id, ref, status, null::date, null, since from chk where status = 'in_progress'
    union all select 'chk_complete_evidence', 'readiness_item', id, ref, status, null::date, null, since from chk where status = 'complete' and evidence_id is not null
    union all select 'chk_complete_no_evidence', 'readiness_item', id, ref, status, null::date, null, since from chk where status = 'complete' and evidence_id is null
    union all select 'chk_not_applicable', 'readiness_item', id, ref, status, null::date, null, since from chk where status = 'not_applicable'
    union all select 'plans_final_evidence', 'test_plan', id, ref, status, null::date, null, since from fp where has_evidence
    union all select 'plans_final_no_evidence', 'test_plan', id, ref, status, null::date, null, since from fp where not has_evidence
    union all select 'gaps_with_evidence', 'readiness_gap', id, ref, status, null::date, null, since from gp where evidence_id is not null
    union all select 'gaps_no_evidence', 'readiness_gap', id, ref, status, null::date, null, since from gp where evidence_id is null
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) || v_req into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'chk_unanswered','Readiness checklist items: unanswered','Status = not_started. Unanswered is NOT the same as failed or not met.'),
    (2,'chk_in_progress','Readiness checklist items: in progress','Status = in_progress.'),
    (3,'chk_complete_evidence','Readiness checklist items: complete, with evidence linked','Status = complete and an evidence record linked.'),
    (4,'chk_complete_no_evidence','Readiness checklist items: complete, NO evidence linked','Status = complete and no evidence linked.'),
    (5,'chk_not_applicable','Readiness checklist items: not applicable','Status = not_applicable; excluded from completeness.'),
    (6,'plans_final_evidence','Final test plans with evidence linked to a step','Test plans for this period in status final where at least one step has linked evidence.'),
    (7,'plans_final_no_evidence','Final test plans with NO evidence linked','Final test plans for this period where no step has linked evidence.'),
    (8,'gaps_with_evidence','Readiness gaps with evidence linked','Gaps on this period''s assessments with an evidence record.'),
    (9,'gaps_no_evidence','Readiness gaps with no evidence linked','Gaps with no evidence record (evidence is expected only for completion).'),
    (10,'req_total','Evidence requests','All evidence requests for the client (not period-scoped).'),
    (11,'req_accepted','Evidence requests: accepted','Status = accepted.'),
    (12,'req_outstanding','Evidence requests: outstanding','Sent / awaiting submission or review (not accepted, rejected or in clarification).'),
    (13,'req_clarification','Evidence requests: clarification requested','Status = clarification_requested.'),
    (14,'req_rejected','Evidence requests: rejected','Status = rejected.'),
    (15,'req_overdue','Evidence requests: overdue','Not accepted and due date before today.')
  ) d(o, k, l, b);
  if to_regclass('public.evidence_requests') is null then
    v_defs := (select jsonb_agg(d) from jsonb_array_elements(v_defs) d where d->>'k' not like 'req\_%');
  end if;

  return jsonb_build_object('section', 'evidence', 'title', 'Evidence completeness against documented requirements',
    'metrics', public.p2_rpt_build(v_defs, v_rows), 'notes', v_notes);
end; $$;

-- 5.7 Review backlog
create or replace function public.p2_rpt_backlog(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  with b as (
    select 'workpaper' as kind, wr.record_type as rtype, wr.record_id as rid,
           coalesce(tp.name, df.title, 'record') as ref, 'submitted' as status, wr.submitted_at::date as since
      from public.workpaper_reviews wr
      left join public.test_plans tp on wr.record_type = 'test_plan' and tp.id = wr.record_id
      left join public.deficiencies df on wr.record_type = 'deficiency' and df.id = wr.record_id
     where wr.organization_id = p_org and wr.status = 'submitted'
    union all select 'ccm_summary', 'ccm_summary', s.id, 'CCM summary', s.status, s.submitted_at::date
      from public.ccm_summaries s where s.organization_id = p_org and s.reporting_period_id = p_period and s.status = 'submitted'
    union all select 'group_summary', 'group_summary', s.id, s.title, s.status, s.submitted_at::date
      from public.group_icfr_summaries s where s.organization_id = p_org and s.reporting_period_id = p_period and s.status = 'submitted'
    union all select 'readiness_assessment', 'readiness_assessment', a.id, coalesce(nullif(a.target_milestone,''), 'Assessment'), a.status, a.submitted_at::date
      from public.readiness_assessments a where a.organization_id = p_org and a.reporting_period_id = p_period and a.status = 'submitted'
    union all select 'readiness_gap', 'readiness_gap', g.id, left(coalesce(nullif(g.description,''), g.requirement, 'gap'), 70), g.status, g.submitted_at::date
      from public.readiness_gaps g join public.readiness_assessments a on a.id = g.readiness_assessment_id
     where g.organization_id = p_org and a.reporting_period_id = p_period and g.status = 'submitted'
    union all select 'questionnaire', 'questionnaire', q.id, en.name || ' (' || coalesce(q.period, 'no period label') || ')', q.status, q.submitted_at::date
      from public.subsidiary_questionnaires q join public.entities en on en.id = q.entity_id
     where q.organization_id = p_org and q.reporting_period_id = p_period and q.status = 'submitted'
       and q.group_review_status in ('not_started','in_review','clarification_requested')
    union all select 'itgc_config', 'automated_control', c.automated_control_id, 'Configuration v' || c.version, c.status, c.submitted_at::date
      from public.automated_control_configurations c where c.organization_id = p_org and c.status = 'submitted'
    union all select 'itgc_exception', 'itgc_exception', x.id, left(coalesce(x.description, 'ITGC exception'), 70), x.status, x.raised_at::date
      from public.itgc_exceptions x where x.organization_id = p_org and x.status in ('open','in_review')
    union all select 'scope', 'engagement_scope', s.id, s.title, s.status, s.submitted_at::date
      from public.engagement_scopes s where s.organization_id = p_org and s.reporting_period_id = p_period and s.status = 'submitted'
    union all select 'report_pack', 'report_pack', rp.id, rp.title, rp.status, rp.submitted_at::date
      from public.report_packs rp where rp.organization_id = p_org and rp.reporting_period_id = p_period and rp.status = 'submitted'
  ),
  r as (
    select 'backlog_total' k, rtype, rid, ref, status, null::date due, kind detail, since from b
    union all select 'backlog_' || kind, rtype, rid, ref, status, null::date, kind, since from b
    union all select 'backlog_age_' || public.p2_rpt_age(current_date - since), rtype, rid, ref, status, null::date, kind, since from b
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'backlog_total','Items awaiting review (all types)','Sum of the type rows below: each item is counted once under its type.'),
    (2,'backlog_workpaper','Test plans and deficiencies awaiting review','Submitted workpaper reviews (client-wide, not period-filtered).'),
    (3,'backlog_ccm_summary','CCM summaries awaiting review','Submitted, this period.'),
    (4,'backlog_group_summary','Group ICFR summaries awaiting review','Submitted, this period.'),
    (5,'backlog_readiness_assessment','Readiness assessments awaiting review','Submitted, this period.'),
    (6,'backlog_readiness_gap','Readiness gaps awaiting review','Submitted, on this period''s assessments.'),
    (7,'backlog_questionnaire','Questionnaires awaiting group review','Submitted and group review not yet concluded, this period.'),
    (8,'backlog_itgc_config','Automated-control configurations awaiting review','Submitted (client-wide).'),
    (9,'backlog_itgc_exception','ITGC exceptions awaiting a reviewer decision','Open or in review (client-wide).'),
    (10,'backlog_scope','Scoping documents awaiting sign-off','Submitted, this period.'),
    (11,'backlog_report_pack','Report packs awaiting review','Submitted, this period.'),
    (12,'backlog_age_0_30','Waiting 0-30 days','Age of the wait = today minus the submission/raised date. The age rows are a breakdown of the total.'),
    (13,'backlog_age_31_60','Waiting 31-60 days','As above.'),
    (14,'backlog_age_61_90','Waiting 61-90 days','As above.'),
    (15,'backlog_age_91_plus','Waiting over 90 days','As above.'),
    (16,'backlog_age_unknown','Waiting: submission date not recorded','As above.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'review_backlog', 'title', 'Review backlog',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array('Some sources are period-specific and some are client-wide; each row states which.'));
end; $$;

-- 5.8 Remediation and retest status
create or replace function public.p2_rpt_remediation(p_org uuid, p_period uuid, p_entity uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ps date; pe date; v_rows jsonb; v_defs jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  select start_date, end_date into ps, pe from public.reporting_periods where id = p_period;
  with df as (
    select d.id, d.title as ref, d.status, d.severity, d.resolved_at, d.identified_at::date as since
      from public.deficiencies d
     where d.organization_id = p_org and d.identified_at::date <= pe and (d.resolved_at is null or d.resolved_at::date >= ps)
       and (p_entity is null or d.entity_id = p_entity)),
  tk as (
    select t.id, t.title as ref, t.status, t.due_date, t.assigned_to, t.retest_result, t.created_at::date as since
      from public.remediation_tasks t join df on df.id = t.deficiency_id where t.organization_id = p_org),
  r as (
    select 'def_relevant' k, 'deficiency' rtype, id rid, ref, status, null::date due, severity detail, since from df
    union all select 'def_open', 'deficiency', id, ref, status, null::date, severity, since from df where resolved_at is null
    union all select 'def_remediated', 'deficiency', id, ref, status, null::date, severity, since from df where resolved_at is not null
    union all select 'def_no_task', 'deficiency', df.id, df.ref, df.status, null::date, df.severity, df.since from df
      where df.resolved_at is null and not exists (select 1 from public.remediation_tasks t where t.deficiency_id = df.id)
    union all select 'task_total', 'remediation_task', id, ref, status, due_date, null, since from tk
    union all select 'task_' || status, 'remediation_task', id, ref, status, due_date, null, since from tk
    union all select 'task_overdue', 'remediation_task', id, ref, status, due_date, null, since from tk where status <> 'complete' and due_date < current_date
    union all select 'task_unassigned', 'remediation_task', id, ref, status, due_date, null, since from tk where status <> 'complete' and assigned_to is null
    union all select 'task_not_retested', 'remediation_task', id, ref, status, due_date, null, since from tk
      where status = 'complete' and coalesce(btrim(retest_result), '') = ''
    union all select 'task_retest_recorded', 'remediation_task', id, ref, status, due_date, null, since from tk
      where status = 'complete' and coalesce(btrim(retest_result), '') <> ''
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from r;

  select jsonb_agg(jsonb_build_object('k', k, 'l', l, 'b', b) order by o) into v_defs from (values
    (1,'def_relevant','Deficiencies relevant to the period','Identified on or before period end and not resolved before period start; all severities and review statuses; remediated items included.'),
    (2,'def_open','  of which open','No resolution date.'),
    (3,'def_remediated','  of which remediated','Has a resolution date.'),
    (4,'def_no_task','Open deficiencies with no remediation task','Open relevant deficiencies with no remediation task of any status.'),
    (5,'task_total','Remediation tasks','Tasks attached to the relevant deficiencies.'),
    (6,'task_not_started','Tasks: not started','Status = not_started.'),
    (7,'task_in_progress','Tasks: in progress','Status = in_progress.'),
    (8,'task_complete','Tasks: complete','Status = complete.'),
    (9,'task_overdue','Tasks: overdue','Not complete and due date before today.'),
    (10,'task_unassigned','Tasks: no assignee','Not complete and no assignee.'),
    (11,'task_not_retested','Complete tasks with no retest recorded','Status = complete and the retest result is blank.'),
    (12,'task_retest_recorded','Complete tasks with a retest result recorded','Counts presence of a recorded retest result only; this report does not judge whether the retest passed.')
  ) d(o, k, l, b);

  return jsonb_build_object('section', 'remediation', 'title', 'Remediation and retest status',
    'metrics', public.p2_rpt_build(v_defs, v_rows),
    'notes', jsonb_build_array('Remediation does not by itself resolve a deficiency: completion of a task and a recorded retest are shown separately from the deficiency''s own status.'));
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Dispatcher (live dashboards AND snapshot source)
-- ---------------------------------------------------------------------------
create or replace function public.p2_report_compute(p_org uuid, p_period uuid, p_type text, p_entity uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sections jsonb := '[]'::jsonb; v_types text[]; v_unfiltered text[]; t text; v_notes jsonb := '[]'::jsonb;
begin
  perform public.p2_rpt_guard(p_org, p_period, p_entity);
  if p_type not in ('ccm_aging','readiness','questionnaires','group_coverage','itgc','evidence','review_backlog','remediation','governance_pack') then
    raise exception 'Unknown report type %', p_type using errcode = 'P0001';
  end if;
  v_types := case when p_type = 'governance_pack'
    then array['ccm_aging','readiness','questionnaires','group_coverage','itgc','evidence','review_backlog','remediation']
    else array[p_type] end;
  foreach t in array v_types loop
    v_sections := v_sections || jsonb_build_array(case t
      when 'ccm_aging' then public.p2_rpt_ccm(p_org, p_period, p_entity)
      when 'readiness' then public.p2_rpt_readiness(p_org, p_period, p_entity)
      when 'questionnaires' then public.p2_rpt_questionnaires(p_org, p_period, p_entity)
      when 'group_coverage' then public.p2_rpt_group(p_org, p_period, p_entity)
      when 'itgc' then public.p2_rpt_itgc(p_org, p_period, p_entity)
      when 'evidence' then public.p2_rpt_evidence(p_org, p_period, p_entity)
      when 'review_backlog' then public.p2_rpt_backlog(p_org, p_period, p_entity)
      when 'remediation' then public.p2_rpt_remediation(p_org, p_period, p_entity) end);
  end loop;
  if p_entity is not null then
    select array_agg(x) into v_unfiltered from unnest(v_types) x
     where x not in ('questionnaires','group_coverage','remediation');
    if v_unfiltered is not null then
      v_notes := jsonb_build_array('Entity filter applied to: questionnaires, group coverage and remediation. These sections are client-wide and are NOT filtered by entity: '
                                   || array_to_string(v_unfiltered, ', ') || '.');
    end if;
  end if;
  return jsonb_build_object('pack_type', p_type, 'sections', v_sections, 'filter_notes', v_notes);
end; $$;

-- ---------------------------------------------------------------------------
-- 7. Workflow functions
-- ---------------------------------------------------------------------------
create or replace function public.p2_report_hash_of(p_org uuid, p_period uuid, p_type text, p_entity uuid, p_version integer, p_snapshot jsonb)
returns text language sql immutable as $$
  select encode(sha256(convert_to(
    p_org::text || E'\x1f' || p_period::text || E'\x1f' || p_type || E'\x1f' ||
    coalesce(p_entity::text, '') || E'\x1f' || p_version::text || E'\x1f' || p_snapshot::text, 'UTF8')), 'hex');
$$;

create or replace function public.p2_report_hash(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.p2_report_hash_of(p.organization_id, p.reporting_period_id, p.pack_type, p.entity_id, p.version, p.snapshot)
  from public.report_packs p where p.id = p_id;
$$;

create or replace function public.p2_report_generate(p_org uuid, p_period uuid, p_type text, p_entity uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_ver integer; v_snap jsonb; v_label text; v_org_name text; v_per record; v_title text; v_now timestamptz := now();
begin
  if not public.p2_has_role(p_org, array['owner','admin','internal_auditor']) then
    raise exception 'Only an owner, admin or internal auditor can generate a report pack' using errcode = '42501';
  end if;
  v_snap := public.p2_report_compute(p_org, p_period, p_type, p_entity);
  perform pg_advisory_xact_lock(hashtext(p_org::text || p_period::text || p_type || coalesce(p_entity::text, '')));
  select coalesce(max(version), 0) + 1 into v_ver from public.report_packs
   where organization_id = p_org and reporting_period_id = p_period and pack_type = p_type
     and entity_id is not distinct from p_entity;
  select coalesce(nullif(p.full_name,''), u.email::text, u.id::text) into v_label
    from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid();
  select name into v_org_name from public.organizations where id = p_org;
  select label, start_date, end_date into v_per from public.reporting_periods where id = p_period;
  v_title := case p_type when 'ccm_aging' then 'CCM alerts and follow-up aging' when 'readiness' then 'Readiness gaps and roadmap'
    when 'questionnaires' then 'Entity questionnaire status' when 'group_coverage' then 'Group control coverage and testing'
    when 'itgc' then 'ITGC dependencies and open issues' when 'evidence' then 'Evidence completeness'
    when 'review_backlog' then 'Review backlog' when 'remediation' then 'Remediation and retest status'
    else 'Governance pack' end;
  v_snap := v_snap || jsonb_build_object('meta', jsonb_build_object(
    'client', v_org_name, 'reporting_period', v_per.label, 'period_start', v_per.start_date, 'period_end', v_per.end_date,
    'generated_at', v_now, 'generated_by', v_label, 'pack_version', v_ver,
    'entity_id', p_entity, 'entity_name', (select name from public.entities where id = p_entity)));
  insert into public.report_packs (id, organization_id, reporting_period_id, entity_id, pack_type, title, version, status,
                                   filters, as_of, snapshot, snapshot_hash, generated_by, generated_by_label, generated_at)
  values (v_id, p_org, p_period, p_entity, p_type, v_title, v_ver, 'draft',
          jsonb_build_object('entity_id', p_entity), v_now, v_snap,
          public.p2_report_hash_of(p_org, p_period, p_type, p_entity, v_ver, v_snap), auth.uid(), v_label, v_now);
  return v_id;
end; $$;

create or replace function public.p2_report_submit(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p public.report_packs%rowtype;
begin
  select * into p from public.report_packs where id = p_id for update;
  if not found or not public.p2_has_role(p.organization_id, array['owner','admin','internal_auditor']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p.status <> 'draft' then raise exception 'Only a draft pack can be submitted for review'; end if;
  if public.p2_report_hash(p_id) is distinct from p.snapshot_hash then
    raise exception 'Snapshot integrity check failed' using errcode = 'P0001';
  end if;
  update public.report_packs set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = p_id;
  return p.snapshot_hash;
end; $$;

create or replace function public.p2_report_decide(p_id uuid, p_decision text, p_comment text, p_expected_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.report_packs%rowtype; v_sep boolean;
begin
  select * into p from public.report_packs where id = p_id for update;
  if not found then raise exception 'Report pack not found'; end if;
  if not public.p2_can_review(p.organization_id) then
    raise exception 'Only a reviewer who has been explicitly assigned review-approval authority can decide a report pack'
      using errcode = '42501';
  end if;
  if p_decision not in ('approved','returned') then raise exception 'Decision must be approved or returned'; end if;
  if p.status <> 'submitted' then raise exception 'This pack is not awaiting a decision (%)', p.status; end if;
  v_sep := coalesce((select require_separate_review from public.engagement_review_settings where organization_id = p.organization_id), true);
  if v_sep and (auth.uid() = p.submitted_by or auth.uid() = p.generated_by) then
    raise exception 'This engagement requires a separate reviewer: the preparer cannot decide their own pack' using errcode = 'P0001';
  end if;
  if public.p2_report_hash(p_id) is distinct from p.snapshot_hash or p_expected_hash is distinct from p.snapshot_hash then
    raise exception 'The pack is not the version you reviewed: reload and review again' using errcode = 'P0001';
  end if;
  if p_decision = 'returned' and length(coalesce(btrim(p_comment), '')) < 5 then
    raise exception 'A comment is required when returning a pack';
  end if;
  update public.report_packs set status = p_decision, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(p_comment), '') where id = p_id;
  if p_decision = 'approved' then
    update public.report_packs set status = 'superseded'
     where organization_id = p.organization_id and reporting_period_id = p.reporting_period_id
       and pack_type = p.pack_type and entity_id is not distinct from p.entity_id
       and id <> p_id and status = 'approved';
  end if;
end; $$;

create or replace function public.p2_report_archive(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.report_packs%rowtype;
begin
  select * into p from public.report_packs where id = p_id for update;
  if not found or not public.p2_has_role(p.organization_id, array['owner','admin','internal_auditor']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p.status not in ('draft','returned') then raise exception 'Only a draft or returned pack can be archived (approved packs are retained)'; end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then raise exception 'A reason is required to archive a pack'; end if;
  update public.report_packs set status = 'archived', decision_note = coalesce(decision_note || E'\n', '') || 'Archived: ' || btrim(p_reason) where id = p_id;
end; $$;

create or replace function public.p2_report_share(p_id uuid, p_share boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.report_packs%rowtype;
begin
  select * into p from public.report_packs where id = p_id for update;
  if not found or not (public.p2_can_review(p.organization_id) or public.p2_has_role(p.organization_id, array['owner','admin'])) then
    raise exception 'Not permitted to change external sharing' using errcode = '42501';
  end if;
  if p.status <> 'approved' then raise exception 'Only an approved pack can be shared with external auditors'; end if;
  if p_share and length(coalesce(btrim(p_note), '')) < 10 then
    raise exception 'A sharing rationale of at least 10 characters is required';
  end if;
  update public.report_packs
     set shared_with_external = p_share, shared_by = auth.uid(), shared_at = now(),
         share_note = case when p_share then btrim(p_note) else coalesce(nullif(btrim(p_note), ''), share_note) end
   where id = p_id;
  perform public.p2_log(p.organization_id, case when p_share then 'shared_external' else 'unshared_external' end,
                        'report_packs', p_id, jsonb_build_object('version', p.version, 'pack_type', p.pack_type));
end; $$;

-- Record an export (the file itself is produced by the application from the stored snapshot).
create or replace function public.p2_report_log_export(p_id uuid, p_format text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.report_packs%rowtype;
begin
  select * into p from public.report_packs where id = p_id;
  if not found or not (public.p2_is_internal(p.organization_id)
       or (public.p2_has_role(p.organization_id, array['external_auditor','viewer']) and p.status = 'approved' and p.shared_with_external)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform public.p2_log(p.organization_id, 'exported', 'report_packs', p_id,
                        jsonb_build_object('format', left(coalesce(p_format, 'csv'), 20), 'version', p.version, 'status', p.status));
end; $$;

-- ---------------------------------------------------------------------------
-- 8. Function privileges
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['p2_report_same_org()', 'p2_report_guard()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'p2_rpt_age(integer)', 'p2_rpt_overdue_bucket(integer)', 'p2_rpt_build(jsonb, jsonb)', 'p2_rpt_guard(uuid, uuid, uuid)',
    'p2_rpt_ccm(uuid, uuid, uuid)', 'p2_rpt_readiness(uuid, uuid, uuid)', 'p2_rpt_questionnaires(uuid, uuid, uuid)',
    'p2_rpt_group(uuid, uuid, uuid)', 'p2_rpt_itgc(uuid, uuid, uuid)', 'p2_rpt_evidence(uuid, uuid, uuid)',
    'p2_rpt_backlog(uuid, uuid, uuid)', 'p2_rpt_remediation(uuid, uuid, uuid)', 'p2_report_hash(uuid)', 'p2_report_hash_of(uuid, uuid, text, uuid, integer, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'p2_report_compute(uuid, uuid, text, uuid)', 'p2_report_generate(uuid, uuid, text, uuid)', 'p2_report_submit(uuid)',
    'p2_report_decide(uuid, text, text, text)', 'p2_report_archive(uuid, text)', 'p2_report_share(uuid, boolean, text)',
    'p2_report_log_export(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
