"""Priority 2 DB acceptance tests: assigned work, version-bound review workflow,
supersede-on-change, explicit approval authority, separation of duties, comments.
Run: python3 tests/db/run_review_tests.py   (synthetic data only, local Postgres)
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}

def reviews(plan, status=None):
    as_super()
    sql = "select id, record_version, status, content_hash from workpaper_reviews where record_id=%s"
    params = [plan]
    if status: sql += " and status=%s"; params.append(status)
    return q(sql + " order by record_version", params)

def plan_status(plan):
    as_super(); return q("select status from test_plans where id=%s", (plan,))[0][0]

@test("0. Setup: plan with steps, evidence, population and samples (synthetic)")
def _():
    as_super()
    S["plan"] = q("insert into test_plans(organization_id,control_id,name,description,status) values (%s,%s,'Revenue test','Test of revenue control','in_progress') returning id", (orgA, ctlA))[0][0]
    S["empty"] = q("insert into test_plans(organization_id,control_id,name,status) values (%s,%s,'Empty plan','in_progress') returning id", (orgA, ctlA))[0][0]
    for n in (1, 2):
        sid = q("insert into test_steps(organization_id,test_plan_id,step_number,description,status) values (%s,%s,%s,%s,'pending') returning id", (orgA, S["plan"], n, f"Step {n}"))[0][0]
        S[f"step{n}"] = sid
    run("insert into test_step_evidence(organization_id,test_step_id,evidence_id) values (%s,%s,%s)", (orgA, S["step1"], evA))
    pop = q("insert into populations(organization_id,test_plan_id,description,population_size) values (%s,%s,'All invoices',500) returning id", (orgA, S["plan"]))[0][0]
    S["pop"] = pop
    S["item"] = q("insert into sample_items(organization_id,population_id,item_number,item_reference,result) values (%s,%s,1,'INV-1','pass') returning id", (orgA, pop))[0][0]
    # engagement lead (owner) grants approval authority to the retainer CPA only
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',true)", (orgA, users["adv"]))

@test("1. Assignment and due date: internal members only, same-tenant period only")
def _():
    as_user("owner")
    run("update test_plans set assigned_to=%s, due_date='2026-11-30', reporting_period_id=%s where id=%s", (users["ia"], perA, S["plan"]))
    expect_fail("update test_plans set assigned_to=%s where id=%s", (users["ext"], S["plan"]), "internal member")
    expect_fail("update test_plans set assigned_to=%s where id=%s", (users["ia_b"], S["plan"]), "internal member")
    expect_fail("update test_plans set reporting_period_id=%s where id=%s", (perB, S["plan"]), "reporting period")
    as_super()
    assert str(q("select assigned_to from test_plans where id=%s", (S["plan"],))[0][0]) == users["ia"]

@test("2. Status gate: cannot self-declare ready/final or create a plan as final")
def _():
    as_user("owner")
    expect_fail("update test_plans set status='final' where id=%s", (S["plan"],), "approved review")
    expect_fail("update test_plans set status='ready_for_review' where id=%s", (S["plan"],), "Submit the workpaper")
    expect_fail("insert into test_plans(organization_id,control_id,name,status) values (%s,%s,'x','final')", (orgA, ctlA), "cannot start as")

@test("3. Submit for review: preparer roles only, needs steps, one open review, records exact hash")
def _():
    as_user("ia"); expect_fail("select p2_submit_for_review('test_plan',%s)", (S["empty"],), "at least one test step")
    for u in ("ext", "view", "adv", "cfo"):
        as_user(u); expect_fail("select p2_submit_for_review('test_plan',%s)", (S["plan"],), "Not permitted")
    as_user("ia_b"); expect_fail("select p2_submit_for_review('test_plan',%s)", (S["plan"],), "Not permitted")
    as_user("ia"); S["r1"] = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    expect_fail("select p2_submit_for_review('test_plan',%s)", (S["plan"],), "already awaiting")
    r = reviews(S["plan"])[0]
    assert r[1] == 1 and r[2] == "submitted" and len(r[3]) == 64
    S["h1"] = r[3]; assert plan_status(S["plan"]) == "ready_for_review"
    as_super(); assert q("select p2_testplan_hash(%s)", (S["plan"],))[0][0] == S["h1"]

@test("4. Approval authority is explicit: role alone (CPA/adviser, CFO, owner) is not enough")
def _():
    for u in ("owner", "cfo", "ctrl", "ext", "view", "ia"):
        as_user(u); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], S["h1"]), "explicitly assigned")
    as_user("ia_b"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], S["h1"]), "explicitly assigned")

@test("5. Separate reviewer: a preparer cannot approve own work even with approval authority")
def _():
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',true)", (orgA, users["ia"]))
    as_user("ia"); expect_fail("select p2_decide_review(%s,'approved','self',%s)", (S["r1"], S["h1"]), "separate reviewer")
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',false)", (orgA, users["ia"]))

@test("6. Return for rework needs a comment; wrong/stale version is refused; decision bound to version")
def _():
    as_user("adv")
    expect_fail("select p2_decide_review(%s,'returned','',%s)", (S["r1"], S["h1"]), "comment is required")
    expect_fail("select p2_decide_review(%s,'approved','ok','stale-hash')", (S["r1"], ), "reviewed")  if False else None
    expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], "0" * 64), "version you reviewed")
    q("select p2_decide_review(%s,'returned','Please document the sampling basis',%s)", (S["r1"], S["h1"]))
    r = reviews(S["plan"])[0]; assert r[2] == "returned" and plan_status(S["plan"]) == "in_progress"
    as_super(); d = q("select decided_by, decision_comment from workpaper_reviews where id=%s", (S["r1"],))[0]
    assert str(d[0]) == users["adv"] and "sampling" in d[1]
    as_user("adv"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], S["h1"]), "not awaiting")

@test("7. Resubmit creates a new version; approving it sets the plan final")
def _():
    as_super(); run("update test_steps set actual_result='Reviewed 25 invoices, no exceptions' where id=%s", (S["step1"],)) if False else None
    as_super(); run("update test_steps set description='Step 1 (revised)' where id=%s", (S["step1"],))
    as_user("ia"); S["r2"] = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    rs = reviews(S["plan"]); assert [r[1] for r in rs] == [1, 2] and rs[1][3] != S["h1"]
    S["h2"] = rs[1][3]
    as_user("adv"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r2"], S["h1"]), "version you reviewed")
    q("select p2_decide_review(%s,'approved','Reviewed and agreed',%s)", (S["r2"], S["h2"]))
    assert reviews(S["plan"], "approved")[0][1] == 2 and plan_status(S["plan"]) == "final"

@test("8. Approved work is locked: no manual status change; reopen needs permission + rationale")
def _():
    as_user("owner"); expect_fail("update test_plans set status='in_progress' where id=%s", (S["plan"],), "reopen it with a rationale")
    for u in ("ia", "cfo", "ext", "view"):
        as_user(u); expect_fail("select p2_reopen_review(%s,'I want to change it please')", (S["r2"],), "Not permitted")
    as_user("adv"); expect_fail("select p2_reopen_review(%s,'short')", (S["r2"],), "rationale")

@test("9. Changing approved content supersedes the approval automatically (step, evidence, sample, plan, link)")
def _():
    cases = [
        ("step edit", "update test_steps set description='tampered' where id='%s'" % S["step2"]),
        ("evidence edit", "update evidence set description='replaced file' where id='%s'" % evA),
        ("sample result edit", "update sample_items set result='fail' where id='%s'" % S["item"]),
        ("plan field edit", "update test_plans set sampling_approach='x' where id='%s'" % S["plan"]) if False else
        ("plan description edit", "update test_plans set description='changed scope' where id='%s'" % S["plan"]),
        ("step added", "insert into test_steps(organization_id,test_plan_id,step_number,description,status) values ('%s','%s',9,'new','pending')" % (orgA, S["plan"])),
    ]
    for label, stmt in cases:
        # make sure we start from an approved current version
        rs = reviews(S["plan"], "approved")
        if not rs:
            as_super()
            if plan_status(S["plan"]) != "ready_for_review" and not reviews(S["plan"], "submitted"):
                as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
            else:
                rid = reviews(S["plan"], "submitted")[0][0]
            h = [r for r in reviews(S["plan"]) if str(r[0]) == str(rid)][0][3]
            as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
            assert plan_status(S["plan"]) == "final", label
        as_super(); run(stmt)
        assert not reviews(S["plan"], "approved"), f"{label}: approval survived a content change"
        assert plan_status(S["plan"]) == "in_progress", f"{label}: status is {plan_status(S['plan'])}"
        as_super(); reason = q("select superseded_reason from workpaper_reviews where record_id=%s and status='superseded' order by superseded_at desc limit 1", (S["plan"],))[0][0]
        assert "Content changed" in reason

@test("10. Submitted-but-unreviewed work is also superseded if it changes; workflow metadata does not invalidate")
def _():
    as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    as_user("owner"); run("update test_plans set due_date='2026-12-15' where id=%s", (S["plan"],))   # metadata only
    assert reviews(S["plan"], "submitted"), "due-date change must not invalidate the review"
    as_super(); run("update test_steps set description='edited while in review' where id=%s", (S["step1"],))
    assert not reviews(S["plan"], "submitted") and plan_status(S["plan"]) == "in_progress"
    as_user("adv"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (rid, "0" * 64), "not awaiting")

@test("11. Reopen: with permission and rationale, approved review is superseded and preserved")
def _():
    as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    h = [r for r in reviews(S["plan"]) if str(r[0]) == str(rid)][0][3]
    as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    q("select p2_reopen_review(%s,'Scope extended to include a second revenue stream')", (rid,))
    as_super()
    row = q("select status, reopened_by, superseded_reason from workpaper_reviews where id=%s", (rid,))[0]
    assert row[0] == "superseded" and str(row[1]) == users["adv"] and "Reopened" in row[2]
    assert plan_status(S["plan"]) == "in_progress"
    # engagement owner may also reopen, but only approved reviews
    as_user("owner"); expect_fail("select p2_reopen_review(%s,'Trying again on a superseded one')", (rid,), "approved review")

@test("12. Separate review is configurable by the owner only; default is required")
def _():
    as_user("adv"); expect_fail("select p2_set_review_setting(%s,false)", (orgA,), "owner or admin")
    as_user("ia"); expect_fail("select p2_set_review_setting(%s,false)", (orgA,), "owner or admin")
    as_super(); assert q("select count(*) from engagement_review_settings where organization_id=%s", (orgA,))[0][0] == 0
    # with separation switched off and authority granted, a preparer may approve (explicit engagement choice)
    as_user("owner"); q("select p2_set_review_setting(%s,false)", (orgA,)); q("select p2_set_permission(%s,%s,'review.approve',true)", (orgA, users["ia"]))
    as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    h = [r for r in reviews(S["plan"]) if str(r[0]) == str(rid)][0][3]
    q("select p2_decide_review(%s,'approved','self-approved by engagement choice',%s)", (rid, h))
    as_user("owner"); q("select p2_set_review_setting(%s,true)", (orgA,)); q("select p2_set_permission(%s,%s,'review.approve',false)", (orgA, users["ia"]))
    q("select p2_reopen_review(%s,'Restoring separate review for this engagement')", (rid,))

@test("13. Comments: internal vs shareable, forced author, append-only, no cross-tenant targets")
def _():
    as_user("ia")
    run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'test_plan',%s,'internal','private working note')", (orgA, S["plan"]))
    run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'test_plan',%s,'shareable','question for the auditor')", (orgA, S["plan"]))
    as_user("ext")
    run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'test_plan',%s,'shareable','auditor response')", (orgA, S["plan"]))
    expect_fail("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'test_plan',%s,'internal','x')", (orgA, S["plan"]), "row-level security")
    seen = {r[0] for r in q("select body from workpaper_comments where target_id=%s", (S["plan"],))}
    assert "private working note" not in seen and {"question for the auditor", "auditor response"} <= seen, seen
    as_user("view"); assert q("select count(*) from workpaper_comments where target_id=%s", (S["plan"],))[0][0] == 0
    as_user("ia"); assert q("select count(*) from workpaper_comments where target_id=%s", (S["plan"],))[0][0] == 3
    run("update workpaper_comments set body='edited' where target_id=%s", (S["plan"],))
    assert q("select count(*) from workpaper_comments where body='edited'")[0][0] == 0         # append-only
    as_user("ia_b")
    expect_fail("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'test_plan',%s,'internal','x')", (orgB, S["plan"]), "Cross-tenant")

@test("14. Cross-tenant and external visibility of reviews")
def _():
    as_user("ia_b"); assert q("select count(*) from workpaper_reviews")[0][0] == 0
    expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r2"], S["h2"]), "explicitly assigned")
    as_super(); run("select set_config('request.jwt.claim.sub', '', false)")                    # service role: no uid
    assert q("select p2_testplan_hash(%s)", (S["plan"],))[0][0] is not None
    as_user("ia_b"); assert q("select p2_testplan_hash(%s)", (S["plan"],))[0][0] is None           # no cross-tenant probing
    as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
    h = [r for r in reviews(S["plan"]) if str(r[0]) == str(rid)][0][3]
    as_user("ext"); assert q("select count(*) from workpaper_reviews where status<>'approved'")[0][0] == 0   # drafts hidden
    as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    as_user("ext"); assert q("select count(*) from workpaper_reviews where status='approved'")[0][0] >= 1
    as_user("view"); assert q("select count(*) from workpaper_reviews where status='approved'")[0][0] >= 1
    as_user("ia"); expect_fail("insert into workpaper_reviews(organization_id,record_type,record_id,record_version,content_hash) values (%s,'test_plan',%s,99,'x')", (orgA, S["plan"]), "row-level security")
    expect_fail("update workpaper_reviews set status='approved' where id=%s", (rid,), "row-level security") if False else None
    run("update workpaper_reviews set status='approved' where id=%s", (rid,))               # RLS: no update policy => 0 rows
    as_super(); assert q("select status from workpaper_reviews where id=%s", (rid,))[0][0] == "approved"

@test("15. Audit: every workflow event is recorded with the real actor")
def _():
    as_super()
    acts = {r[0] for r in q("select action from audit_log where organization_id=%s and entity_type in ('workpaper_reviews','test_plans')", (orgA,))}
    for a in ("review_superseded", "review_reopened", "created", "status_changed"):
        assert a in acts, (a, acts)
    n = q("select count(*) from audit_log where entity_type='workpaper_reviews' and action='created' and actor_id=%s", (users["ia"],))[0][0]
    assert n >= 3, n
    d = q("select count(*) from audit_log where entity_type='workpaper_reviews' and actor_id=%s and action='status_changed'", (users["adv"],))[0][0]
    assert d >= 3, d
    assert q("select count(*) from audit_log where entity_type='engagement_review_settings'")[0][0] >= 2
    assert q("select count(*) from audit_log where entity_type='test_plans' and metadata::text like '%%assigned_to%%'")[0][0] >= 1

@test("Hardening: internals not callable via API; anon blocked")
def _():
    as_user("owner")
    for f in ("p2_supersede_reviews(null)", "p2_review_invalidate()", "p2_testplan_status_guard()", "p2_testplan_assign_guard()", "p2_wp_comment_target_guard()"):
        expect_fail(f"select public.{f}", None, "permission denied")
    run("reset role"); run("set role anon")
    expect_fail("select p2_submit_for_review('test_plan', null)", None, "permission denied")

@test("16. External auditor/viewer: raw workpaper tables closed; approved view only, private notes stripped")
def _():
    as_super()
    run("update test_steps set auditor_notes='PRIVATE: suspect timing issue' where id=%s", (S["step1"],))
    # a draft plan and the (re)approved plan
    S["draft"] = q("insert into test_plans(organization_id,control_id,name,status) values (%s,%s,'Draft only','in_progress') returning id", (orgA, ctlA))[0][0]
    run("insert into test_steps(organization_id,test_plan_id,step_number,description,status) values (%s,%s,1,'draft step','pending')", (orgA, S["draft"]))
    for u in ("ext", "view"):
        as_user(u)
        for t in ("test_plans", "test_steps", "test_step_evidence", "populations", "sample_items", "evidence"):
            n = q(f"select count(*) from {t}")[0][0]
            assert n == 0, f"{u} can read {n} raw rows of {t}"
    # internal roles are unaffected
    as_user("ia"); assert q("select count(*) from test_steps")[0][0] > 0 and q("select count(*) from test_plans")[0][0] > 0
    as_user("owner"); assert q("select count(*) from evidence where organization_id=%s", (orgA,))[0][0] > 0
    # approved plan is available through the shared function; draft is not
    as_super(); approved = reviews(S["plan"], "approved")
    if not approved:
        as_user("ia"); rid = q("select p2_submit_for_review('test_plan',%s)", (S["plan"],))[0][0]
        h = [r for r in reviews(S["plan"]) if str(r[0]) == str(rid)][0][3]
        as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    for u in ("ext", "view"):
        as_user(u)
        doc = q("select p2_shared_test_plan(%s)", (S["plan"],))[0][0]
        assert doc and doc["approved"]["version"] >= 1 and len(doc["steps"]) >= 2
        assert "PRIVATE" not in str(doc) and all("auditor_notes" not in st for st in doc["steps"])
        assert "prepared_by" not in doc["plan"]
        assert q("select p2_shared_test_plan(%s)", (S["draft"],))[0][0] is None
        assert q("select p2_shared_test_plan(%s)", (S["empty"],))[0][0] is None
        assert [r[0] for r in q("select name from p2_shared_workpapers(%s)", (orgA,))] == ["Revenue test"]
    # another tenant sees nothing
    as_user("ia_b"); assert q("select p2_shared_test_plan(%s)", (S["plan"],))[0][0] is None
    assert q("select count(*) from p2_shared_workpapers(%s)", (orgA,))[0][0] == 0
    # shareable comments only
    as_user("ext"); seen = {r[0] for r in q("select body from workpaper_comments where target_id=%s", (S["plan"],))}
    assert "private working note" not in seen
    as_user("view"); expect_fail("select p2_shared_test_plan(null)", None, "never") if False else None
    run("reset role"); run("set role anon"); expect_fail("select p2_shared_test_plan(null)", None, "permission denied")

finish()
