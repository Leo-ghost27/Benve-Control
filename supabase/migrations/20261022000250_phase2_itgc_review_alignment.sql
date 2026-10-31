-- ============================================================================
-- Phase 2: align ITGC configuration approval with the engagement review rules
-- (Session A, cross-cutting; sorts after Session B's 20261022000200/201 on purpose).
--
-- Session B's p2_decide_config authorised approval by ROLE (owner/admin/cfo/controller).
-- The engagement rule is explicit assigned authority: approving a conclusion needs
-- 'review.approve' (never a role alone), and separate review follows the per-engagement
-- setting (default: required). Everything else in p2_decide_config is unchanged
-- (exact-version hash, comment on return, supersede previous approved version).
-- ITGC exception triage (clear / raise deficiency) stays a management-role decision.
-- Idempotent.
-- ============================================================================
begin;

create or replace function public.p2_decide_config(p_config uuid, p_decision text, p_comment text, p_expected_hash text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.automated_control_configurations%rowtype; v_sep boolean;
begin
  select * into c from public.automated_control_configurations where id = p_config for update;
  if not found then raise exception 'Configuration not found'; end if;
  if not public.p2_can_review(c.organization_id) then
    raise exception 'Only a reviewer who has been explicitly assigned review-approval authority can decide a configuration conclusion'
      using errcode = '42501';
  end if;
  if p_decision not in ('approved','returned') then raise exception 'Decision must be approved or returned'; end if;
  if c.status <> 'submitted' then raise exception 'Configuration is not awaiting a decision (%)', c.status; end if;
  v_sep := coalesce((select require_separate_review from public.engagement_review_settings
                     where organization_id = c.organization_id), true);
  if v_sep and c.submitted_by = auth.uid() then
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

commit;
