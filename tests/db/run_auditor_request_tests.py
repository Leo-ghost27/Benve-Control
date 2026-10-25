"""Priority 2 DB tests: external-auditor request/response workflow + client_links / client_profiles hardening.
Run: python3 tests/db/run_auditor_request_tests.py   (synthetic data only)"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
def status(rid):
    as_super(); return q("select status from auditor_requests where id=%s", (rid,))[0][0]

@test("1. Who may raise a request: external auditor (or owner/admin on their behalf) only")
def _():
    for u in ("view", "ia", "cfo", "ctrl", "adv", "ia_b"):
        as_user(u); expect_fail("select p2_create_auditor_request(%s,'Sneaky request')", (orgA,), "Only the external auditor")
    as_user("ext")
    S["r"] = q("select p2_create_auditor_request(%s,'Provide Q3 revenue reconciliation','Please send the reconciliations','2026-11-15','high',null,%s)", (orgA, perA))[0][0]
    as_user("owner"); S["r_owner"] = q("select p2_create_auditor_request(%s,'Logged by owner for the auditor')", (orgA,))[0][0]
    as_user("ext"); expect_fail("select p2_create_auditor_request(%s,'x',null,null,'urgent')", (orgA,), "priority")
    expect_fail("select p2_create_auditor_request(%s,'x',null,null,'normal',null,%s)", (orgA, perB), "reporting period")
    as_super(); assert str(q("select requested_by from auditor_requests where id=%s", (S["r"],))[0][0]) == users["ext"]

@test("2. Visibility and no direct writes: viewers and other tenants see nothing; nobody writes tables directly")
def _():
    as_user("ext"); assert q("select count(*) from auditor_requests")[0][0] == 2
    for u in ("ia", "cfo", "owner", "adv"):
        as_user(u); assert q("select count(*) from auditor_requests")[0][0] == 2, u
    for u in ("view", "ia_b"):
        as_user(u); assert q("select count(*) from auditor_requests")[0][0] == 0, u
    for u in ("ext", "owner", "ia"):
        as_user(u)
        expect_fail("insert into auditor_requests(organization_id,title) values (%s,'direct')", (orgA,), "row-level security")
        run("update auditor_requests set status='closed' where id=%s", (S["r"],))
        expect_fail("insert into auditor_request_responses(organization_id,request_id,kind,body) values (%s,%s,'management_response','x')", (orgA, S["r"]), "row-level security")
    assert status(S["r"]) == "open"

@test("3. Assignment: management assigns to a management/audit-team member only")
def _():
    as_user("ia"); expect_fail("select p2_assign_auditor_request(%s,%s)", (S["r"], users["ia"]), "Not permitted")
    as_user("ext"); expect_fail("select p2_assign_auditor_request(%s,%s)", (S["r"], users["ia"]), "Not permitted")
    as_user("cfo")
    expect_fail("select p2_assign_auditor_request(%s,%s)", (S["r"], users["ext"]), "management or audit-team")
    expect_fail("select p2_assign_auditor_request(%s,%s)", (S["r"], users["ia_b"]), "management or audit-team")
    q("select p2_assign_auditor_request(%s,%s)", (S["r"], users["ia"]))
    as_super(); assert str(q("select assigned_to from auditor_requests where id=%s", (S["r"],))[0][0]) == users["ia"]

@test("4. Responses: management roles respond as management; auditor follows up as auditor; others cannot")
def _():
    for u in ("view", "adv", "ia_b"):
        as_user(u); expect_fail("select p2_respond_auditor_request(%s,'hello')", (S["r"],), "Not permitted")
    as_user("ext"); q("select p2_respond_auditor_request(%s,'Which entity is in scope for the reconciliation?')", (S["r"],))
    assert status(S["r"]) == "open"
    as_user("ia"); q("select p2_respond_auditor_request(%s,'Group entity only; reconciliations attached to the evidence request')", (S["r"],))
    assert status(S["r"]) == "responded"
    as_super(); rows = q("select kind, author_role from auditor_request_responses where request_id=%s order by created_at", (S["r"],))
    assert rows == [("auditor_followup", "external_auditor"), ("management_response", "internal_auditor")], rows
    as_user("ext"); assert q("select count(*) from auditor_request_responses where request_id=%s", (S["r"],))[0][0] == 2
    as_user("view"); assert q("select count(*) from auditor_request_responses")[0][0] == 0

@test("5. Closing: only the external auditor, only after management responded, with their own conclusion")
def _():
    for u in ("owner", "cfo", "ia", "adv"):
        as_user(u); expect_fail("select p2_close_auditor_request(%s,'Looks fine to me')", (S["r"],), "Only the external auditor")
    as_user("ext"); expect_fail("select p2_close_auditor_request(%s,'x')", (S["r"],), "conclusion is required")
    expect_fail("select p2_close_auditor_request(%s,'Satisfied with the reconciliation')", (S["r_owner"],), "after management has responded")
    q("select p2_close_auditor_request(%s,'Satisfied: reconciliation agrees to the ledger')", (S["r"],))
    assert status(S["r"]) == "closed"
    as_super(); c = q("select auditor_conclusion, closed_by from auditor_requests where id=%s", (S["r"],))[0]
    assert "Satisfied" in c[0] and str(c[1]) == users["ext"]
    as_user("ia"); expect_fail("select p2_respond_auditor_request(%s,'one more thing')", (S["r"],), "cannot take new responses")

@test("6. Reopen needs a rationale and the right role; history is kept")
def _():
    as_user("ia"); expect_fail("select p2_reopen_auditor_request(%s,'Management reopening an auditor close')", (S["r"],), "Not permitted")
    as_user("ext"); expect_fail("select p2_reopen_auditor_request(%s,'short')", (S["r"],), "rationale")
    q("select p2_reopen_auditor_request(%s,'Need the sub-ledger tie-out as well')", (S["r"],))
    assert status(S["r"]) == "open"
    as_super(); assert q("select auditor_conclusion from auditor_requests where id=%s", (S["r"],))[0][0] is None
    assert q("select count(*) from auditor_request_responses where request_id=%s and kind='status_note'", (S["r"],))[0][0] == 1
    as_user("ext"); expect_fail("select p2_reopen_auditor_request(%s,'Reopen an already open one please')", (S["r"],), "closed or withdrawn")

@test("7. Withdraw: requester or owner/admin only, with a reason")
def _():
    as_user("ia"); expect_fail("select p2_withdraw_auditor_request(%s,'not mine to withdraw')", (S["r_owner"],), "Only the person who raised")
    as_user("ext"); expect_fail("select p2_withdraw_auditor_request(%s,'not mine to withdraw')", (S["r_owner"],), "Only the person who raised")  # raised by owner on their behalf
    as_user("owner"); expect_fail("select p2_withdraw_auditor_request(%s,'')", (S["r_owner"],), "reason")
    q("select p2_withdraw_auditor_request(%s,'No longer needed')", (S["r_owner"],))
    assert status(S["r_owner"]) == "withdrawn"

@test("8. Internal comments on a request are hidden from the external auditor; cross-tenant targets refused")
def _():
    as_user("cfo")
    run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'auditor_request',%s,'internal','do not share the margin figures')", (orgA, S["r"]))
    run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'auditor_request',%s,'shareable','we will send it tomorrow')", (orgA, S["r"]))
    as_user("ext"); bodies = {r[0] for r in q("select body from workpaper_comments where target_id=%s", (S["r"],))}
    assert bodies == {"we will send it tomorrow"}, bodies
    as_user("ia_b"); expect_fail("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'auditor_request',%s,'internal','x')", (orgB, S["r"]), "Cross-tenant")

@test("9. client_links: portal tokens are readable by internal issuing roles only")
def _():
    as_super(); run("insert into client_links(organization_id,owner_name,owner_email) values (%s,'Client contact','c@client.test')", (orgA,))
    for u in ("ext", "view", "adv"):
        as_user(u); assert q("select count(*) from client_links")[0][0] == 0, u
    for u in ("owner", "ia", "cfo"):
        as_user(u); assert q("select count(*) from client_links")[0][0] == 1, u
    as_user("ia_b"); assert q("select count(*) from client_links")[0][0] == 0

@test("10. client_profiles edits are audited with the real actor")
def _():
    as_super(); run("insert into client_profiles(organization_id,legal_name) values (%s,'Acme') on conflict do nothing", (orgA,))
    as_user("owner"); run("update client_profiles set industry='Banking' where organization_id=%s", (orgA,))
    as_super(); a = q("select actor_id, metadata->'changed_fields' from audit_log where entity_type='client_profiles' and action='updated' and organization_id=%s", (orgA,))
    assert a and str(a[0][0]) == users["owner"] and "industry" in str(a[0][1]), a

@test("11. Audit trail and hardening")
def _():
    as_super()
    acts = {r[0] for r in q("select action from audit_log where entity_type in ('auditor_requests','auditor_request_responses') and organization_id=%s", (orgA,))}
    assert {"created", "status_changed"} <= acts, acts
    assert q("select count(*) from audit_log where entity_type='auditor_request_responses' and action='created' and actor_id=%s", (users["ia"],))[0][0] >= 1
    as_user("owner")
    for f in ("p2_auditor_request_guard()", "p2_wp_comment_target_guard()"):
        expect_fail(f"select public.{f}", None, "permission denied")
    run("reset role"); run("set role anon")
    expect_fail("select p2_create_auditor_request(null,'x')", None, "permission denied")

finish()
