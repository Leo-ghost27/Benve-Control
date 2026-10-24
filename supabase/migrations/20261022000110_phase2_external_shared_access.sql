-- ============================================================================
-- Phase 2 / Priority 2: external auditors and viewers see approved workpapers
-- only, through a function that strips private working notes.
--
-- Before: any workspace member (including external_auditor / viewer) could SELECT
-- raw test_plans, test_steps (incl. auditor_notes), evidence and samples for any
-- plan, draft or not. Now raw access is internal-only (RESTRICTIVE policies, which
-- AND with the existing permissive ones), and external roles read approved
-- workpapers via p2_shared_* functions: no auditor_notes, no storage paths, no
-- internal comments, only an exact approved version.
-- Service-role flows (client evidence portal) are unaffected (they bypass RLS).
-- Idempotent.
-- ============================================================================
begin;

do $$
declare t text;
begin
  foreach t in array array['test_plans','test_steps','test_step_evidence','populations','sample_items','evidence'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "p2 raw access internal only" on public.%I', t);
      execute format('create policy "p2 raw access internal only" on public.%I as restrictive for select
                      using (public.p2_is_internal(organization_id))', t);
    end if;
  end loop;
end $$;

-- Approved workpapers visible to the caller's workspace (names only).
create or replace function public.p2_shared_workpapers(p_org uuid)
returns table (id uuid, name text, approved_version integer, approved_at timestamptz, content_hash text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, r.record_version, r.decided_at, r.content_hash
  from public.test_plans t
  join public.workpaper_reviews r on r.record_id = t.id and r.record_type = 'test_plan' and r.status = 'approved'
  where t.organization_id = p_org and public.is_org_member(p_org)
  order by r.decided_at desc;
$$;

-- One approved workpaper, minus private notes. Returns null unless the caller is a
-- member of the plan's workspace and the plan has an approved review.
create or replace function public.p2_shared_test_plan(p_plan uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.test_plans%rowtype; r public.workpaper_reviews%rowtype;
begin
  select * into t from public.test_plans where id = p_plan;
  if not found or not public.is_org_member(t.organization_id) then return null; end if;
  select * into r from public.workpaper_reviews
   where record_type = 'test_plan' and record_id = p_plan and status = 'approved';
  if not found then return null; end if;
  return jsonb_build_object(
    'plan', to_jsonb(t) - 'prepared_by' - 'reviewed_by' - 'created_by',
    'approved', jsonb_build_object('version', r.record_version, 'approved_at', r.decided_at, 'content_hash', r.content_hash),
    'steps', coalesce((select jsonb_agg(to_jsonb(s) - 'auditor_notes' order by s.step_number)
                       from public.test_steps s where s.test_plan_id = p_plan), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(to_jsonb(e)->>'title', to_jsonb(e)->>'file_name'),
                                                               'description', e.description, 'step_id', se.test_step_id))
                          from public.test_step_evidence se
                          join public.evidence e on e.id = se.evidence_id
                          join public.test_steps s on s.id = se.test_step_id
                          where s.test_plan_id = p_plan), '[]'::jsonb)
  );
end; $$;

revoke all on function public.p2_shared_workpapers(uuid) from public, anon;
revoke all on function public.p2_shared_test_plan(uuid) from public, anon;
grant execute on function public.p2_shared_workpapers(uuid) to authenticated;
grant execute on function public.p2_shared_test_plan(uuid) to authenticated;

commit;
