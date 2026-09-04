-- Extend organization_members.role from {owner, auditor, client, viewer}
-- to the full 8-role model from the Benve Control product spec (Tasks 1-50):
-- owner, admin, cfo, controller, internal_auditor, external_auditor, adviser, viewer.
--
-- Mapping decisions (no existing data affected other than 'owner'):
--   'auditor' -> 'internal_auditor' (Benve/firm-side staff doing the audit work)
--   'client'  -> broadened to the client-side business roles (cfo, controller, adviser)
--                wherever 'client' previously appeared in a policy
--   'admin'   -> added alongside 'owner' for org/content management, but NOT for
--                hard deletes or org-level destructive actions (stays owner-only,
--                matching existing conservative behavior)
--   'external_auditor' -> new, read-only everywhere (no write policies added)
--
-- Applied directly to the Benve Control Supabase project (version 20260904083621).
-- This file exists for version-controlled history; re-running it against a
-- database that already has the 8-role constraint will fail on the DROP
-- CONSTRAINT step, which is expected.

begin;

-- 1. Widen the role check constraint
alter table public.organization_members
  drop constraint organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role = any (array[
    'owner', 'admin', 'cfo', 'controller',
    'internal_auditor', 'external_auditor', 'adviser', 'viewer'
  ]));

-- 2. organization_members: admins can also manage members (not just owner)
alter policy "owners can add members" on public.organization_members
  with check (org_role(organization_id) = any (array['owner','admin']));

alter policy "owners can update members" on public.organization_members
  using (org_role(organization_id) = any (array['owner','admin']));

alter policy "owners can remove members" on public.organization_members
  using (org_role(organization_id) = any (array['owner','admin']));

-- 3. controls
alter policy "owners and auditors can create controls" on public.controls
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners and auditors can update controls" on public.controls
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 4. test_plans
alter policy "owners and auditors can create test plans" on public.test_plans
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners and auditors can update test plans" on public.test_plans
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 5. test_steps
alter policy "owners and auditors can create test steps" on public.test_steps
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners and auditors can update test steps" on public.test_steps
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 6. test_step_evidence
alter policy "owners and auditors can link evidence to test steps" on public.test_step_evidence
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners and auditors can unlink evidence from test steps" on public.test_step_evidence
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 7. evidence (upload stays open to client-side business roles too)
alter policy "owners and auditors can update evidence" on public.evidence
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners auditors and clients can upload evidence" on public.evidence
  with check (
    org_role(organization_id) = any (array[
      'owner','admin','internal_auditor','cfo','controller','adviser'
    ])
    and uploaded_by = auth.uid()
  );

-- 8. evidence_requests
alter policy "Owners and auditors can create evidence requests" on public.evidence_requests
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "Owners and auditors can update evidence requests" on public.evidence_requests
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']))
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 9. client_links
alter policy "Owners and auditors can create client links" on public.client_links
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 10. deficiencies
alter policy "owners and auditors can create deficiencies" on public.deficiencies
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners and auditors can update deficiencies" on public.deficiencies
  using (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

-- 11. remediation_tasks
alter policy "owners and auditors can create remediation tasks" on public.remediation_tasks
  with check (org_role(organization_id) = any (array['owner','admin','internal_auditor']));

alter policy "owners auditors and assignees can update remediation tasks" on public.remediation_tasks
  using (
    org_role(organization_id) = any (array['owner','admin','internal_auditor'])
    or assigned_to = auth.uid()
  );

commit;
