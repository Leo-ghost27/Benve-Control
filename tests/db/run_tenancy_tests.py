"""Priority 1 DB acceptance tests: firm/client tenancy, team access, archive,
controlled deletion, client scope sign-off.
Run: python3 tests/db/run_tenancy_tests.py

These run against a real Postgres (pgserver) built from the repo migrations plus
test stubs for live-only objects, using role switching + auth.uid() to exercise
RLS/triggers exactly as an authenticated API caller would. Synthetic data only.
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
EMAIL = {}

def mkuser(name):
    u = uid(); EMAIL[name] = f"{name}@synthetic.test"
    as_super(); run("insert into auth.users(id,email) values (%s,%s)", (u, EMAIL[name])); users[name] = u

for n in ["gowner","gadmin","staff","cpa","ccfo","extA","cadmin","bcfo","stranger","tmp","late"]:
    mkuser(n)

def call(sql, params=None): return q(sql, params)
def invite(inviter, org, who, role):
    as_user(inviter)
    return call("select invitation_id, token from p2_invite_member(%s,%s,%s)", (org, EMAIL[who], role))[0]
def invite_accept(inviter, org, who, role):
    inv, tok = invite(inviter, org, who, role)
    as_user(who); call("select p2_accept_invitation(%s)", (tok,)); return inv, tok
def count_as(user, sql, params=None):
    as_user(user); return q(sql, params)[0][0]

@test("1. Firm and separate client workspaces; creator explicitly becomes engagement owner")
def _():
    as_user("gowner")
    S["firm"] = call("select p2_create_firm('GHG Consulting (synthetic)')")[0][0]
    S["A"] = call("select p2_create_client(%s,'Acme Corp (synthetic)','Acme Corporation','Banking','12-31','A. Contact','a@acme.test','SOX 404')", (S["firm"],))[0][0]
    S["B"] = call("select p2_create_client(%s,'Beta Inc (synthetic)')", (S["firm"],))[0][0]
    rows = call("select kind, firm_id, status from organizations where id in (%s,%s) order by name", (S["A"], S["B"]))
    assert all(r[0] == "client" and str(r[1]) == S["firm"] and r[2] == "active" for r in rows), rows
    assert call("select kind from organizations where id=%s", (S["firm"],))[0][0] == "firm"
    assert call("select p2_role(%s)", (S["A"],))[0][0] == "owner"
    assert call("select legal_name, fiscal_year_end from client_profiles where organization_id=%s", (S["A"],))[0] == ("Acme Corporation", "12-31")
    # only a firm owner/admin can create clients
    as_user("ia"); expect_fail("select p2_create_client(%s,'Sneaky')", (S["firm"],), "owner or admin of the firm")

@test("1b. Protected org columns and hard delete are blocked at the database")
def _():
    as_user("gowner")
    expect_fail("update organizations set status='archived' where id=%s", (S["A"],), "workspace functions")
    expect_fail("update organizations set firm_id=null where id=%s", (S["A"],), "workspace functions")
    expect_fail("update organizations set kind='firm' where id=%s", (S["A"],), "workspace functions")
    expect_fail("delete from organizations where id=%s", (S["A"],), "deleted directly")
    expect_fail("insert into organizations(name,kind) values ('x','firm')", None, "firm/client functions")
    run("update organizations set name='Acme Corp (synthetic)' where id=%s", (S["A"],))  # ordinary rename still allowed

@test("2. Firm membership grants no client access; claiming access needs a reason and is logged")
def _():
    invite_accept("gowner", S["firm"], "gadmin", "admin")
    as_super()
    run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'A-1','n','Acme control')", (uid(), S["A"]))
    run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'B-1','n','Beta control')", (uid(), S["B"]))
    as_user("gadmin")
    assert q("select count(*) from controls where organization_id=%s", (S["A"],))[0][0] == 0
    assert q("select count(*) from controls where organization_id=%s", (S["B"],))[0][0] == 0
    cl = q("select name, i_am_member from p2_firm_clients(%s)", (S["firm"],))
    assert len(cl) == 2 and not any(r[1] for r in cl), cl         # metadata only
    as_user("staff" if False else "ia"); assert q("select count(*) from p2_firm_clients(%s)", (S["firm"],))[0][0] == 0
    as_user("gadmin")
    expect_fail("select p2_claim_client_access(%s,'internal_auditor','x')", (S["B"],), "reason")
    expect_fail("select p2_claim_client_access(%s,'owner','Review Beta workpapers for quality check')", (S["B"],), "Invalid role")
    call("select p2_claim_client_access(%s,'internal_auditor','Quality review of Beta workpapers')", (S["B"],))
    assert q("select count(*) from controls where organization_id=%s", (S["B"],))[0][0] == 1
    assert q("select count(*) from controls where organization_id=%s", (S["A"],))[0][0] == 0   # A still closed
    as_user("ia"); expect_fail("select p2_claim_client_access(%s,'viewer','Trying to peek at the client')", (S["A"],), "firm owner or admin")

@test("3. Invitations: hashed single-use tokens, email-bound, expiry, revoke, role ceiling")
def _():
    inv, tok = invite("gowner", S["A"], "staff", "internal_auditor")
    S["staff_inv"] = inv
    as_super()
    cols = [r[0] for r in q("select column_name from information_schema.columns where table_name='org_invitations'")]
    assert "token" not in cols and "token_hash" in cols
    assert q("select token_hash from org_invitations where id=%s", (inv,))[0][0] != tok
    as_user("stranger"); expect_fail("select p2_accept_invitation(%s)", (tok,), "different email")
    as_user("staff"); call("select p2_accept_invitation(%s)", (tok,))
    assert call("select p2_role(%s)", (S["A"],))[0][0] == "internal_auditor"
    expect_fail("select p2_accept_invitation(%s)", (tok,), "invalid, expired or already used")
    # expiry
    inv2, tok2 = invite("gowner", S["A"], "late", "viewer")
    as_super(); run("update org_invitations set expires_at = now() - interval '1 day' where id=%s", (inv2,))
    as_user("late"); expect_fail("select p2_accept_invitation(%s)", (tok2,), "invalid, expired or already used")
    # revoke
    inv3, tok3 = invite("gowner", S["A"], "late", "viewer")
    as_user("gowner"); call("select p2_revoke_invitation(%s)", (inv3,))
    as_user("late"); expect_fail("select p2_accept_invitation(%s)", (tok3,), "invalid, expired or already used")
    # direct writes are impossible; non-managers cannot list or create invitations
    as_user("staff")
    expect_fail("insert into org_invitations(organization_id,email,role,token_hash) values (%s,'x@x.test','owner','h')", (S["A"],), "row-level security")
    assert q("select count(*) from org_invitations where organization_id=%s", (S["A"],))[0][0] == 0
    expect_fail("select * from p2_invite_member(%s,'z@z.test','viewer')", (S["A"],), "not allowed")
    # other invitations: remaining members
    invite_accept("gowner", S["A"], "cpa", "adviser")
    invite_accept("gowner", S["A"], "ccfo", "cfo")
    invite_accept("gowner", S["A"], "extA", "external_auditor")
    invite_accept("gowner", S["A"], "cadmin", "admin")
    invite_accept("gowner", S["B"], "bcfo", "cfo")
    # admin may invite a viewer but not an owner/admin
    as_user("cadmin")
    expect_fail("select * from p2_invite_member(%s,'o@o.test','owner')", (S["A"],), "not allowed")
    expect_fail("select * from p2_invite_member(%s,'o@o.test','admin')", (S["A"],), "not allowed")
    call("select * from p2_invite_member(%s,'v@v.test','viewer')", (S["A"],))

@test("4. One person, several client workspaces, different role in each")
def _():
    invite_accept("gowner", S["B"], "staff", "adviser")
    as_user("staff")
    ws = {str(r[0]): r[2] for r in q("select org_id, name, role from p2_my_workspaces()")}
    assert ws.get(S["A"]) == "internal_auditor" and ws.get(S["B"]) == "adviser", ws
    S["period"] = {}
    as_super()
    for k in ("A", "B"):
        S["period"][k] = q("insert into reporting_periods(organization_id,label,start_date,end_date) values (%s,'2026-FY','2026-01-01','2026-12-31') returning id", (S[k],))[0][0]
    as_user("staff")
    run("insert into engagement_scopes(organization_id,reporting_period_id,title) values (%s,%s,'probe')", (S["A"], S["period"]["A"]))
    expect_fail("insert into engagement_scopes(organization_id,reporting_period_id,title) values (%s,%s,'probe')", (S["B"], S["period"]["B"]), "row-level security")

@test("5. Membership cannot be edited directly; role ceiling, no self-change, last owner protected")
def _():
    # Emulate the LIVE policies (migration 20260904083621 lets owner AND admin write members) so
    # these attempts actually reach the guard trigger instead of being filtered by older RLS.
    as_super()
    for cmd, clause in (("insert", "with check"), ("update", "using"), ("delete", "using")):
        run(f'drop policy if exists "live emu {cmd}" on organization_members')
        run(f'create policy "live emu {cmd}" on organization_members for {cmd} {clause} '
            f"(org_role(organization_id) = any (array['owner','admin']))")
    as_user("cadmin")
    expect_fail("insert into organization_members(organization_id,user_id,role) values (%s,%s,'owner')", (S["A"], users["stranger"]), "invitation")
    expect_fail("update organization_members set role='owner' where organization_id=%s and user_id=%s", (S["A"], users["cadmin"]), "invitation")
    expect_fail("delete from organization_members where organization_id=%s and user_id=%s", (S["A"], users["staff"]), "invitation")
    as_super(); assert q("select role::text from organization_members where organization_id=%s and user_id=%s", (S["A"], users["cadmin"]))[0][0] == "admin"
    as_user("cadmin")
    expect_fail("select p2_change_member_role(%s,%s,'owner')", (S["A"], users["cadmin"]), "own role")
    expect_fail("select p2_change_member_role(%s,%s,'owner')", (S["A"], users["staff"]), "not allowed")
    expect_fail("select p2_change_member_role(%s,%s,'viewer')", (S["A"], users["gowner"]), "not allowed")
    as_user("staff"); expect_fail("select p2_change_member_role(%s,%s,'viewer')", (S["A"], users["cpa"]), "not allowed")
    as_user("gowner")
    call("select p2_change_member_role(%s,%s,'viewer')", (S["A"], users["cpa"]))
    assert call("select p2_role(%s)", (S["A"],))[0][0] == "owner"
    as_user("cpa"); assert q("select p2_role(%s)", (S["A"],))[0][0] == "viewer"
    as_user("gowner"); call("select p2_change_member_role(%s,%s,'adviser')", (S["A"], users["cpa"]))
    expect_fail("select p2_remove_member(%s,%s)", (S["A"], users["gowner"]), "at least one owner")
    # remove revokes access immediately
    invite_accept("gowner", S["A"], "tmp", "internal_auditor")
    assert count_as("tmp", "select count(*) from controls where organization_id=%s", (S["A"],)) == 1
    as_user("gowner"); call("select p2_remove_member(%s,%s)", (S["A"], users["tmp"]))
    assert count_as("tmp", "select count(*) from controls where organization_id=%s", (S["A"],)) == 0
    as_user("gowner"); call("select p2_set_permission(%s,%s,'review.approve',true)", (S["A"], users["cpa"]))
    assert call("select count(*) from engagement_permissions where organization_id=%s", (S["A"],))[0][0] == 1
    as_user("staff"); expect_fail("select p2_set_permission(%s,%s,'review.approve',true)", (S["A"], users["staff"]), "owner or admin")

@test("6. Archive needs exact-name confirmation; archived workspaces refuse new invitations")
def _():
    as_user("gowner")
    S["C"] = call("select p2_create_client(%s,'Gamma LLC (synthetic)')", (S["firm"],))[0][0]
    expect_fail("select p2_archive_client(%s,'gamma llc','Engagement ended')", (S["C"],), "exact client name")
    as_user("ia"); expect_fail("select p2_archive_client(%s,'Gamma LLC (synthetic)','Engagement ended')", (S["C"],), "Not permitted")
    as_user("gowner"); call("select p2_archive_client(%s,'Gamma LLC (synthetic)','Engagement ended')", (S["C"],))
    r = call("select status, archived_by, archive_reason from organizations where id=%s", (S["C"],))[0]
    assert r[0] == "archived" and str(r[1]) == users["gowner"] and r[2] == "Engagement ended"
    days = call("select retention_until - current_date from org_retention_settings where organization_id=%s", (S["C"],))[0][0]
    assert days > 2500, days
    expect_fail("select * from p2_invite_member(%s,'n@n.test','viewer')", (S["C"],), "Archived")

@test("7. Deletion request: archived only, no self-decision, retention + legal hold block, approval never deletes")
def _():
    as_user("gowner")
    expect_fail("select p2_request_deletion(%s,'Client asked for removal of data')", (S["A"],), "archived")
    S["req"] = call("select p2_request_deletion(%s,'Client asked for removal of all data')", (S["C"],))[0][0]
    expect_fail("select p2_decide_deletion(%s,true,'ok')", (S["req"],), "own deletion request")
    as_user("gadmin")      # firm admin, NOT a member of C
    expect_fail("select p2_decide_deletion(%s,true,'ok')", (S["req"],), "retention period")
    # SIMULATED passage of time: pretend the retention period has ended
    as_super(); run("update org_retention_settings set retention_until = current_date - 1 where organization_id=%s", (S["C"],))
    as_user("gowner"); call("select p2_set_legal_hold(%s,true,'Pending litigation hold')", (S["C"],))
    as_user("gadmin"); expect_fail("select p2_decide_deletion(%s,true,'ok')", (S["req"],), "legal hold")
    as_user("gowner"); call("select p2_set_legal_hold(%s,false,'Hold released by counsel')", (S["C"],))
    as_user("ia"); expect_fail("select p2_decide_deletion(%s,true,'ok')", (S["req"],), "Not permitted")
    as_user("gadmin"); call("select p2_decide_deletion(%s,true,'Retention satisfied, no hold')", (S["req"],))
    as_super()
    assert q("select count(*) from organizations where id=%s", (S["C"],))[0][0] == 1          # nothing purged
    assert q("select count(*) from client_profiles where organization_id=%s", (S["C"],))[0][0] == 1
    assert q("select status from deletion_requests where id=%s", (S["req"],))[0][0] == "approved"
    as_user("gowner"); run("delete from deletion_requests where id=%s", (S["req"],))
    assert q("select count(*) from deletion_requests where id=%s", (S["req"],))[0][0] == 1    # RLS: no delete policy
    call("select p2_restore_client(%s,'Reinstated after review')", (S["C"],))
    assert call("select status from organizations where id=%s", (S["C"],))[0][0] == "active"

@test("8. Client scope: preparer -> client CFO approves exact version; locked after approval")
def _():
    as_user("staff")
    sid = q("insert into engagement_scopes(organization_id,reporting_period_id,title,objective,scope_summary) values (%s,%s,'FY26 ICFR scope','Define in-scope controls','Revenue and financial close controls in scope') returning id", (S["A"], S["period"]["A"]))[0][0]
    S["scope"] = sid
    assert str(q("select created_by from engagement_scopes where id=%s", (sid,))[0][0]) == users["staff"]
    expect_fail("insert into engagement_scopes(organization_id,reporting_period_id,title,status) values (%s,%s,'x','approved')", (S["A"], S["period"]["A"]), "start as a draft")
    expect_fail("select p2_submit_scope(%s)", (sid,), "scope item")                               # needs an item
    as_super(); ctlA = q("select id from controls where organization_id=%s", (S["A"],))[0][0]
    ctlB = q("select id from controls where organization_id=%s", (S["B"],))[0][0]
    entB = q("insert into entities(organization_id,name) values (%s,'Beta sub') returning id", (S["B"],))[0][0]
    as_user("staff")
    expect_fail("insert into engagement_scope_items(organization_id,scope_id,control_id,description) values (%s,%s,%s,'x')", (S["A"], sid, ctlB), "Cross-tenant")
    expect_fail("insert into engagement_scope_items(organization_id,scope_id,entity_id,description) values (%s,%s,%s,'x')", (S["A"], sid, entB), "Cross-tenant")
    run("insert into engagement_scope_items(organization_id,scope_id,control_id,description,rationale) values (%s,%s,%s,'Revenue recognition control','Material account')", (S["A"], sid, ctlA))
    expect_fail("update engagement_scopes set status='approved' where id=%s", (sid,), "workflow functions")
    h1 = call("select p2_submit_scope(%s)", (sid,))[0][0]; S["h1"] = h1
    expect_fail("update engagement_scopes set title='changed' where id=%s", (sid,), "locked")
    expect_fail("insert into engagement_scope_items(organization_id,scope_id,description) values (%s,%s,'late')", (S["A"], sid), "locked")
    expect_fail("select p2_decide_scope(%s,'approved','ok',%s)", (sid, h1), "CFO/controller")   # preparer
    as_user("cpa"); expect_fail("select p2_decide_scope(%s,'approved','ok',%s)", (sid, h1), "CFO/controller")  # CPA role alone
    as_user("bcfo"); expect_fail("select p2_decide_scope(%s,'approved','ok',%s)", (sid, h1), "CFO/controller")  # other client's CFO
    as_user("ccfo")
    expect_fail("select p2_decide_scope(%s,'approved','ok','stale-hash')", (sid,), "version you reviewed")
    expect_fail("select p2_decide_scope(%s,'returned','',%s)", (sid, h1), "comment is required")
    call("select p2_decide_scope(%s,'approved','Scope agreed by management',%s)", (sid, h1))
    so = call("select version, content_hash, decision, signer_name, signer_role from scope_signoffs where scope_id=%s", (sid,))
    assert so == [(1, h1, "approved", EMAIL["ccfo"], "cfo")], so
    assert call("select status from engagement_scopes where id=%s", (sid,))[0][0] == "approved"
    expect_fail("select p2_decide_scope(%s,'approved','again',%s)", (sid, h1), "not awaiting")
    as_user("staff")
    expect_fail("update engagement_scopes set scope_summary='tampered' where id=%s", (sid,), "locked")
    expect_fail("delete from engagement_scopes where id=%s", (sid,), "draft scopes")

@test("8b. Reopen needs permission + rationale, bumps the version, invalidates the approval, re-approval is per version")
def _():
    sid, h1 = S["scope"], S["h1"]
    as_user("staff"); expect_fail("select p2_reopen_scope(%s,'I would like to change the scope')", (sid,), "Not permitted")
    as_user("ccfo")
    expect_fail("select p2_reopen_scope(%s,'short')", (sid,), "rationale")
    call("select p2_reopen_scope(%s,'Revenue stream added mid-year, scope must change')", (sid,))
    r = call("select status, version, content_hash, decided_by from engagement_scopes where id=%s", (sid,))[0]
    assert r == ("draft", 2, None, None), r
    as_user("staff")
    run("insert into engagement_scope_items(organization_id,scope_id,description) values (%s,%s,'New revenue stream control')", (S["A"], sid))
    h2 = call("select p2_submit_scope(%s)", (sid,))[0][0]
    assert h2 != h1
    as_user("ccfo"); expect_fail("select p2_decide_scope(%s,'approved','x',%s)", (sid, h1), "version you reviewed")  # old version cannot be approved
    call("select p2_decide_scope(%s,'approved','Agreed v2',%s)", (sid, h2))
    hist = call("select version, decision, content_hash from scope_signoffs where scope_id=%s order by signed_at, version", (sid,))
    assert [(h[0], h[1]) for h in hist] == [(1, "approved"), (1, "reopened"), (2, "approved")], hist
    assert hist[0][2] == h1 and hist[2][2] == h2

@test("8c. Submitter cannot approve own scope even with sign permission; return-for-rework loop")
def _():
    as_user("gowner")
    call("select p2_set_permission(%s,%s,'scope.sign',true)", (S["A"], users["gowner"]))
    sid = q("insert into engagement_scopes(organization_id,reporting_period_id,title,scope_summary) values (%s,%s,'Second scope','ITGC scope') returning id", (S["A"], S["period"]["A"]))[0][0]
    run("insert into engagement_scope_items(organization_id,scope_id,description) values (%s,%s,'ITGC: access management')", (S["A"], sid))
    h = call("select p2_submit_scope(%s)", (sid,))[0][0]
    expect_fail("select p2_decide_scope(%s,'approved','self',%s)", (sid, h), "cannot decide it")
    as_user("ccfo"); call("select p2_decide_scope(%s,'returned','Please add the payroll system',%s)", (sid, h))
    assert call("select status, decision_note from engagement_scopes where id=%s", (sid,))[0] == ("returned", "Please add the payroll system")
    as_user("gowner")
    run("insert into engagement_scope_items(organization_id,scope_id,description) values (%s,%s,'ITGC: payroll system')", (S["A"], sid))
    h_b = call("select p2_submit_scope(%s)", (sid,))[0][0]; assert h_b != h
    # a different signatory (the CFO) approves the reworked version
    as_user("ccfo"); call("select p2_decide_scope(%s,'approved','OK',%s)", (sid, h_b))
    S["scope2"] = sid

@test("13. External auditor/viewer see approved scopes only; other clients see nothing")
def _():
    as_user("staff")
    draft = q("insert into engagement_scopes(organization_id,reporting_period_id,title,scope_summary) values (%s,%s,'Draft only','x') returning id", (S["A"], S["period"]["A"]))[0][0]
    as_user("extA")
    vis = {r[0] for r in q("select title from engagement_scopes where organization_id=%s", (S["A"],))}
    assert "Draft only" not in vis and "FY26 ICFR scope" in vis, vis
    assert q("select count(*) from engagement_scope_items where scope_id=%s", (draft,))[0][0] == 0
    assert q("select count(*) from org_invitations")[0][0] == 0 and q("select count(*) from engagement_permissions")[0][0] == 0
    as_user("bcfo")
    for t in ("engagement_scopes", "engagement_scope_items", "scope_signoffs", "client_profiles", "org_invitations",
              "org_retention_settings", "deletion_requests", "engagement_permissions", "controls"):
        n = q(f"select count(*) from {t} where organization_id=%s", (S["A"],))[0][0]
        assert n == 0, f"client B user can see {n} rows of {t} for client A"

@test("15. Audit: client creation, invitations, role changes, removals, archive, legal hold, firm access, scope workflow")
def _():
    as_super()
    have = {r[0] for r in q("select action from audit_log where organization_id=%s", (S["A"],))}
    for a in ("client_created", "member_role_changed", "member_removed", "permission_granted", "status_changed", "created"):
        assert a in have, (a, have)
    assert q("select count(*) from audit_log where organization_id=%s and entity_type='org_invitations' and action='created'", (S["A"],))[0][0] >= 5
    assert q("select count(*) from audit_log where organization_id=%s and entity_type='organization_members' and action='created'", (S["A"],))[0][0] >= 5
    r = q("select actor_id, metadata->>'reason' from audit_log where organization_id=%s and action='firm_access_claimed'", (S["B"],))
    assert len(r) == 1 and str(r[0][0]) == users["gadmin"] and "Quality review" in r[0][1]
    assert q("select count(*) from audit_log where organization_id=%s and action in ('client_archived','legal_hold_placed','legal_hold_released','client_restored')", (S["C"],))[0][0] == 4
    # scope decisions are attributable to the signer
    assert q("select count(*) from audit_log where entity_type='engagement_scopes' and action='status_changed' and actor_id=%s", (users["ccfo"],))[0][0] >= 3
    # raw tokens never reach the audit log
    assert q("select count(*) from audit_log where metadata::text ilike '%%token%%'")[0][0] == 0

@test("Hardening: internal/trigger functions are not callable through the API; anon cannot use workflow functions")
def _():
    as_user("gowner")
    for f in ("p2_member_guard()", "p2_org_guard()", "p2_scope_guard()", "p2_log(null,null,null,null,null)", "p2_slug('x')"):
        expect_fail(f"select public.{f}", None, "permission denied")
    run("reset role"); run("set role anon")
    expect_fail("select p2_create_firm('x')", None, "permission denied")
    expect_fail("select * from p2_my_workspaces()", None, "permission denied")

@test("16. Platform admin has no automatic access to client workpapers; Phase 1 changes are audited with the real actor")
def _():
    as_super()
    run("create table if not exists platform_admins(user_id uuid primary key)")
    run("create or replace function is_platform_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$")
    run("grant select on platform_admins to authenticated")
    run('drop policy if exists "Platform admins can view all controls" on controls')
    run('create policy "Platform admins can view all controls" on controls for select using (is_platform_admin())')
    run('drop policy if exists "Platform admins can view all test plans" on test_plans')
    run('create policy "Platform admins can view all test plans" on test_plans for select using (is_platform_admin())')
    run("insert into platform_admins(user_id) values (%s) on conflict do nothing", (users["stranger"],))
    as_user("stranger")
    assert q("select count(*) from controls")[0][0] > 0, "precondition: policy should leak before the fix"
    as_super()
    run_file(f"{ROOT}/supabase/migrations/20261021000011_phase2_platform_access_and_audit.sql", twice=True)
    as_user("stranger")
    assert q("select count(*) from controls")[0][0] == 0
    assert q("select count(*) from test_plans")[0][0] == 0
    # audit triggers: real actor, created + updated with changed fields
    as_user("gowner")   # (repo 0001 policies predate the 8-role model; owner passes both)
    cid = q("insert into controls(organization_id,code,name,title) values (%s,'T-1','n','Audit probe') returning id", (S["A"],))[0][0]
    run("update controls set name='renamed' where id=%s", (cid,))
    as_super()
    rows = q("select action, actor_id, metadata->'changed_fields' from audit_log where entity_type='controls' and entity_id=%s order by created_at", (cid,))
    assert [r[0] for r in rows] == ["created", "updated"], rows
    assert all(str(r[1]) == users["gowner"] for r in rows)
    assert "name" in str(rows[1][2])

finish()
