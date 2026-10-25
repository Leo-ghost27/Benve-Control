-- Fix (Session B, Module 3 roll-up): production test_plans.status is one of
-- not_started / in_progress / ready_for_review / final. The roll-up counted
-- 'complete'/'completed', which never occur, so completed plans were always 0.
-- Only the status literal changes; everything else is identical to 20261021000001.
begin;

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
      (select count(*) from tp where tp.bucket = ent.id and tp.status = 'final') as test_plans_complete
    from ent
  ),
  grp as (
    select (select count(*) from ctl where ctl.bucket is null) as controls,
           (select count(*) from def where def.bucket is null) as deficiencies_open,
           (select count(*) from exc where exc.bucket is null) as exceptions_open,
           (select count(*) from tp where tp.bucket is null) as test_plans,
           (select count(*) from tp where tp.bucket is null and tp.status = 'final') as test_plans_complete
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

commit;
