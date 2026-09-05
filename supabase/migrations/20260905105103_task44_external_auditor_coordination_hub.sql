-- Task 44 (External Auditor Attestation & Integrated Audit Coordination Hub).
--
-- Design choices:
--   - Reuses the existing 'evidence_requests' and 'client_links' tables
--     (built pre-Task-44) for the "Requests for Additional Evidence"
--     workflow (Task 44 sec 3B) rather than duplicating a parallel
--     request table - they already model exactly this.
--   - New tables: 'access_settings' (org-level visibility toggles,
--     Task 44 sec 2C), 'walkthroughs' (sec 3A), 'audit_communications'
--     (sec 4A, distinct from Task 41's 'communications' - these are
--     firm<->external-auditor logistics messages, not client-facing
--     deficiency communications).
--   - SECURITY GAP FIXED: today ANY org member (is_org_member() only,
--     no role check) can SELECT full 'deficiencies' and 'test_steps'
--     rows, including draft_classification, classification_rationale,
--     likelihood, and test_steps' internal auditor_notes/draft_conclusion.
--     Task 44 sec 2C requires external_auditor to see a controlled
--     summary only. Rather than editing the base SELECT policies (risking
--     breaking legitimate internal-role access patterns used elsewhere
--     in the app), this adds a SECURITY DEFINER function -
--     auditor_evidence_index(p_org_id) - following the exact same
--     pattern as the existing is_org_member/org_role helper functions.
--     It independently checks org membership, filters deficiencies to
--     review_status = 'approved' only, and redacts
--     classification_rationale/likelihood/qualitative_flags unless the
--     org's access_settings explicitly allow it. The Task 44 Evidence
--     Index page queries this function instead of the base tables for
--     every role, so the controlled view is consistent regardless of
--     who's looking at it.
--
-- Applied directly to the Benve Control Supabase project (version 20260905105103).

begin;

-- ============================================================
-- 1. Access settings (Task 44 sec 2C)
-- ============================================================

create table public.access_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  reviewer_notes_visible_to_auditor boolean not null default false,
  draft_classifications_visible boolean not null default false,
  sample_logic_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.access_settings enable row level security;

create policy "org members can view access settings" on public.access_settings
  for select using (is_org_member(organization_id));

create policy "owners and admins can manage access settings" on public.access_settings
  for insert with check (org_role(organization_id) = any (array['owner','admin']));

create policy "owners and admins can update access settings" on public.access_settings
  for update using (org_role(organization_id) = any (array['owner','admin']));

-- ============================================================
-- 2. Walkthroughs (Task 44 sec 3A)
-- ============================================================

create table public.walkthroughs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  control_id uuid references public.controls(id) on delete set null,
  walkthrough_date date,
  participants text,
  status text not null default 'complete',
  created_at timestamptz not null default now()
);

alter table public.walkthroughs enable row level security;

create policy "org members can view walkthroughs" on public.walkthroughs
  for select using (is_org_member(organization_id));

create policy "owners and auditors can create walkthroughs" on public.walkthroughs
  for insert with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners and auditors can update walkthroughs" on public.walkthroughs
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete walkthroughs" on public.walkthroughs
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 3. Audit communications (Task 44 sec 4A - firm<->external-auditor log)
-- ============================================================

create table public.audit_communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  comm_date date not null default current_date,
  from_party text,
  to_party text,
  subject text,
  body text,
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.audit_communications
  add constraint audit_communications_status_check
  check (status = any (array['open', 'closed']));

alter table public.audit_communications enable row level security;

create policy "org members can view audit communications" on public.audit_communications
  for select using (is_org_member(organization_id));

create policy "owners and auditors can create audit communications" on public.audit_communications
  for insert with check (org_role(organization_id) = any (array['owner','admin','internal_auditor','external_auditor']));

create policy "owners and auditors can update audit communications" on public.audit_communications
  for update using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

create policy "owners can delete audit communications" on public.audit_communications
  for delete using (org_role(organization_id) = 'owner');

-- ============================================================
-- 4. Controlled evidence index function (Task 44 sec 2B)
-- ============================================================

create or replace function public.auditor_evidence_index(p_org_id uuid)
returns table (
  control_id uuid,
  control_code text,
  control_title text,
  process text,
  risk_rating text,
  mgmt_test_status text,
  population_description text,
  deficiency_id uuid,
  deficiency_title text,
  deficiency_classification text,
  deficiency_rationale text,
  deficiency_likelihood text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_settings record;
begin
  if not is_org_member(p_org_id) then
    return;
  end if;

  v_role := org_role(p_org_id);

  select * into v_settings from public.access_settings where organization_id = p_org_id;
  if not found then
    v_settings.draft_classifications_visible := false;
  end if;

  return query
  select
    c.id,
    c.code,
    c.title,
    c.framework,
    c.risk_rating,
    tp.test_type,
    tp.population_description,
    d.id,
    d.title,
    case
      when v_role <> 'external_auditor' or v_settings.draft_classifications_visible then d.draft_classification
      else null
    end,
    case
      when v_role <> 'external_auditor' or v_settings.draft_classifications_visible then d.classification_rationale
      else null
    end,
    case
      when v_role <> 'external_auditor' or v_settings.draft_classifications_visible then d.likelihood
      else null
    end
  from public.controls c
  left join public.test_plans tp on tp.control_id = c.id
  left join public.deficiencies d on d.control_id = c.id
    and (v_role <> 'external_auditor' or d.review_status = 'approved')
  where c.organization_id = p_org_id;
end;
$$;

revoke all on function public.auditor_evidence_index(uuid) from public;
grant execute on function public.auditor_evidence_index(uuid) to authenticated;
revoke execute on function public.auditor_evidence_index(uuid) from anon;

commit;
