-- ============================================================================
-- Phase 2 / Priority 2: external-auditor request and response workflow
--
--   external auditor raises a request -> management assigns it -> management
--   responds -> external auditor follows up, closes it with THEIR conclusion, or
--   reopens it. Management responses and auditor conclusions are separate fields
--   written only by the appropriate roles, through functions:
--     * management_response: owner/admin/cfo/controller/internal_auditor
--     * auditor_followup + closing conclusion: external_auditor (reopen: also owner/admin)
--   Requests/responses are append-only history; direct writes are impossible.
--   Internal discussion about a request lives in workpaper_comments (internal),
--   which external auditors cannot see. Viewers cannot see requests at all.
-- Idempotent.
-- ============================================================================
begin;

create table if not exists public.auditor_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reporting_period_id uuid references public.reporting_periods(id) on delete set null,
  related_test_plan_id uuid references public.test_plans(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  due_date date,
  status text not null default 'open' check (status in ('open','responded','closed','withdrawn')),
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  auditor_conclusion text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_auditor_requests_org on public.auditor_requests(organization_id, status);
create index if not exists idx_auditor_requests_assignee on public.auditor_requests(organization_id, assigned_to);

create table if not exists public.auditor_request_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.auditor_requests(id) on delete cascade,
  kind text not null check (kind in ('management_response','auditor_followup','status_note')),
  body text not null check (length(trim(body)) > 0),
  author_id uuid references auth.users(id) on delete set null,
  author_role text,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditor_responses_req on public.auditor_request_responses(request_id, created_at);

alter table public.auditor_requests enable row level security;
alter table public.auditor_request_responses enable row level security;

drop policy if exists "p2 auditor requests select" on public.auditor_requests;
create policy "p2 auditor requests select" on public.auditor_requests for select
  using (public.p2_is_internal(organization_id) or public.p2_has_role(organization_id, array['external_auditor']));
drop policy if exists "p2 auditor responses select" on public.auditor_request_responses;
create policy "p2 auditor responses select" on public.auditor_request_responses for select
  using (exists (select 1 from public.auditor_requests r where r.id = request_id));

drop trigger if exists auditor_requests_audit on public.auditor_requests;
create trigger auditor_requests_audit after insert or update or delete on public.auditor_requests
  for each row execute function public.p2_audit();
drop trigger if exists auditor_responses_audit on public.auditor_request_responses;
create trigger auditor_responses_audit after insert or update or delete on public.auditor_request_responses
  for each row execute function public.p2_audit();

create or replace function public.p2_auditor_request_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.related_test_plan_id is not null and not exists
     (select 1 from public.test_plans t where t.id = new.related_test_plan_id and t.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: workpaper' using errcode = '23503';
  end if;
  if new.reporting_period_id is not null and not exists
     (select 1 from public.reporting_periods p where p.id = new.reporting_period_id and p.organization_id = new.organization_id) then
    raise exception 'Cross-tenant or missing reference: reporting period' using errcode = '23503';
  end if;
  if new.assigned_to is not null and not exists
     (select 1 from public.organization_members m where m.organization_id = new.organization_id and m.user_id = new.assigned_to
        and m.role::text in ('owner','admin','cfo','controller','internal_auditor')) then
    raise exception 'Requests can only be assigned to a management or audit-team member of this workspace' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists auditor_requests_guard on public.auditor_requests;
create trigger auditor_requests_guard before insert or update on public.auditor_requests
  for each row execute function public.p2_auditor_request_guard();

create or replace function public.p2_create_auditor_request(
  p_org uuid, p_title text, p_description text default null, p_due date default null,
  p_priority text default 'normal', p_test_plan uuid default null, p_period uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.p2_has_role(p_org, array['external_auditor','owner','admin']) then
    raise exception 'Only the external auditor (or an owner/admin logging it for them) can raise a request' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = p_org and status = 'archived') then
    raise exception 'Archived workspaces cannot be changed';
  end if;
  insert into public.auditor_requests (organization_id, title, description, due_date, priority, related_test_plan_id,
                                       reporting_period_id, requested_by)
    values (p_org, p_title, p_description, p_due, coalesce(p_priority,'normal'), p_test_plan, p_period, auth.uid())
    returning id into v_id;
  return v_id;
end; $$;

create or replace function public.p2_assign_auditor_request(p_request uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.auditor_requests%rowtype;
begin
  select * into r from public.auditor_requests where id = p_request for update;
  if not found or not public.p2_has_role(r.organization_id, array['owner','admin','cfo','controller']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if r.status in ('closed','withdrawn') then raise exception 'This request is %', r.status; end if;
  update public.auditor_requests set assigned_to = p_user where id = p_request;
end; $$;

create or replace function public.p2_respond_auditor_request(p_request uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.auditor_requests%rowtype; v_role text; v_kind text;
begin
  select * into r from public.auditor_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  v_role := public.p2_role(r.organization_id);
  if v_role in ('owner','admin','cfo','controller','internal_auditor') then v_kind := 'management_response';
  elsif v_role = 'external_auditor' then v_kind := 'auditor_followup';
  else raise exception 'Not permitted to respond to this request' using errcode = '42501'; end if;
  if r.status in ('closed','withdrawn') then raise exception 'This request is % and cannot take new responses', r.status; end if;
  if length(coalesce(trim(p_body),'')) = 0 then raise exception 'A response is required'; end if;
  insert into public.auditor_request_responses (organization_id, request_id, kind, body, author_id, author_role)
    values (r.organization_id, p_request, v_kind, trim(p_body), auth.uid(), v_role);
  update public.auditor_requests set status = case when v_kind = 'management_response' then 'responded' else 'open' end
   where id = p_request;
end; $$;

create or replace function public.p2_close_auditor_request(p_request uuid, p_conclusion text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.auditor_requests%rowtype;
begin
  select * into r from public.auditor_requests where id = p_request for update;
  if not found or not public.p2_has_role(r.organization_id, array['external_auditor']) then
    raise exception 'Only the external auditor can close a request with their conclusion' using errcode = '42501';
  end if;
  if r.status <> 'responded' then raise exception 'A request can be closed only after management has responded (status is %)', r.status; end if;
  if length(coalesce(trim(p_conclusion),'')) < 5 then raise exception 'The auditor''s conclusion is required to close'; end if;
  update public.auditor_requests
     set status = 'closed', auditor_conclusion = trim(p_conclusion), closed_by = auth.uid(), closed_at = now()
   where id = p_request;
end; $$;

create or replace function public.p2_reopen_auditor_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.auditor_requests%rowtype; v_role text;
begin
  select * into r from public.auditor_requests where id = p_request for update;
  if not found or not public.p2_has_role(r.organization_id, array['external_auditor','owner','admin']) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if r.status not in ('closed','withdrawn') then raise exception 'Only a closed or withdrawn request can be reopened'; end if;
  if length(coalesce(trim(p_reason),'')) < 10 then raise exception 'A rationale of at least 10 characters is required to reopen'; end if;
  v_role := public.p2_role(r.organization_id);
  insert into public.auditor_request_responses (organization_id, request_id, kind, body, author_id, author_role)
    values (r.organization_id, p_request, 'status_note', 'Reopened: ' || trim(p_reason), auth.uid(), v_role);
  update public.auditor_requests set status = 'open', auditor_conclusion = null, closed_by = null, closed_at = null
   where id = p_request;
end; $$;

create or replace function public.p2_withdraw_auditor_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.auditor_requests%rowtype;
begin
  select * into r from public.auditor_requests where id = p_request for update;
  if not found or not (r.requested_by = auth.uid() or public.p2_has_role(r.organization_id, array['owner','admin'])) then
    raise exception 'Only the person who raised the request, or an owner/admin, can withdraw it' using errcode = '42501';
  end if;
  if r.status in ('closed','withdrawn') then raise exception 'This request is already %', r.status; end if;
  if length(coalesce(trim(p_reason),'')) < 5 then raise exception 'A reason is required'; end if;
  insert into public.auditor_request_responses (organization_id, request_id, kind, body, author_id, author_role)
    values (r.organization_id, p_request, 'status_note', 'Withdrawn: ' || trim(p_reason), auth.uid(), public.p2_role(r.organization_id));
  update public.auditor_requests set status = 'withdrawn' where id = p_request;
end; $$;

-- comments on requests: same cross-tenant guard as test plans (replaces the migration-100 version)
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
  return new;
end; $$;

do $$
declare f text;
begin
  revoke all on function public.p2_auditor_request_guard() from public, anon, authenticated;
  revoke all on function public.p2_wp_comment_target_guard() from public, anon, authenticated;
  foreach f in array array[
    'p2_create_auditor_request(uuid, text, text, date, text, uuid, uuid)','p2_assign_auditor_request(uuid, uuid)',
    'p2_respond_auditor_request(uuid, text)','p2_close_auditor_request(uuid, text)',
    'p2_reopen_auditor_request(uuid, text)','p2_withdraw_auditor_request(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
