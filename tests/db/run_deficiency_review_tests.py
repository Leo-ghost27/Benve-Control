"""Priority 2 DB tests: version-bound review of deficiency classifications.
Run: python3 tests/db/run_deficiency_review_tests.py (synthetic data only)"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
def rv(status=None):
    as_super()
    sql = "select id, record_version, status, content_hash from workpaper_reviews where record_type='deficiency' and record_id=%s"
    p = [S["d"]]
    if status: sql += " and status=%s"; p.append(status)
    return q(sql + " order by record_version", p)
def dstate():
    as_super(); return q("select review_status, reviewer_id from deficiencies where id=%s", (S["d"],))[0]

@test("0. Setup: a deficiency with a draft classification and one compensating control; CPA gets explicit authority")
def _():
    as_super()
    S["d"] = q("insert into deficiencies(organization_id,control_id,title,draft_classification,classification_rationale,status) values (%s,%s,'Late reconciliations','Significant deficiency','Aggregates with two similar exceptions','open') returning id", (orgA, ctlA))[0][0]
    S["cc"] = q("insert into compensating_controls(organization_id,deficiency_id,description) values (%s,%s,'Monthly controller review') returning id", (orgA, S["d"]))[0][0]
    S["agg"] = q("insert into aggregation_groups(organization_id,group_ref,process) values (%s,'AG-1','Close') returning id", (orgA,))[0][0]
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',true)", (orgA, users["adv"]))

@test("1. Direct edits of review state are rejected for signed-in users")
def _():
    as_user("owner")
    expect_fail("update deficiencies set review_status='approved' where id=%s", (S["d"],), "Review state changes only")
    expect_fail("update deficiencies set reviewer_id=%s where id=%s", (users["owner"], S["d"]), "Review state changes only")
    as_user("ia")   # (harness policy predates the 8-role model: the row is filtered, so assert nothing changed)
    run("update deficiencies set review_status='approved', reviewer_id=%s where id=%s", (users["ia"], S["d"]))
    assert dstate() == ("draft", None), dstate()
    as_user("owner"); expect_fail("insert into deficiencies(organization_id,control_id,title,review_status) values (%s,%s,'x','approved')", (orgA, ctlA), "must start as a draft")

@test("2. Submit: audit-team roles only; classification and rationale required; exact hash recorded")
def _():
    for u in ("view", "ext", "adv", "cfo", "ia_b"):
        as_user(u); expect_fail("select p2_submit_for_review('deficiency',%s)", (S["d"],), "Not permitted")
    as_super()
    blank = q("insert into deficiencies(organization_id,control_id,title) values (%s,%s,'No classification yet') returning id", (orgA, ctlA))[0][0]
    as_user("ia"); expect_fail("select p2_submit_for_review('deficiency',%s)", (blank,), "classification and its rationale")
    S["r1"] = q("select p2_submit_for_review('deficiency',%s)", (S["d"],))[0][0]
    expect_fail("select p2_submit_for_review('deficiency',%s)", (S["d"],), "already awaiting")
    r = rv()[0]; assert r[1] == 1 and r[2] == "submitted" and len(r[3]) == 64
    S["h1"] = r[3]; assert dstate()[0] == "awaiting_review"

@test("3. Approval authority is explicit; the submitter cannot decide; wrong version refused")
def _():
    for u in ("owner", "cfo", "ctrl", "ext", "view", "ia"):
        as_user(u); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], S["h1"]), "explicitly assigned")
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',true)", (orgA, users["ia"]))
    as_user("ia"); expect_fail("select p2_decide_review(%s,'approved','self',%s)", (S["r1"], S["h1"]), "separate reviewer")
    as_user("owner"); q("select p2_set_permission(%s,%s,'review.approve',false)", (orgA, users["ia"]))
    as_user("adv"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r1"], "0" * 64), "version you reviewed")
    expect_fail("select p2_decide_review(%s,'returned','',%s)", (S["r1"], S["h1"]), "comment is required")

@test("4. Return then resubmit; approval records reviewer and date")
def _():
    as_user("adv"); q("select p2_decide_review(%s,'returned','Document why it aggregates with DEF-2',%s)", (S["r1"], S["h1"]))
    assert dstate()[0] == "returned" and str(dstate()[1]) == users["adv"]
    as_super(); run("update deficiencies set classification_rationale='Aggregates with two similar exceptions in the close process (DEF-2, DEF-3)' where id=%s", (S["d"],))
    assert dstate()[0] == "returned"                                    # returned stays returned (no open review to withdraw)
    as_user("ia"); S["r2"] = q("select p2_submit_for_review('deficiency',%s)", (S["d"],))[0][0]
    h2 = rv()[1][3]; assert h2 != S["h1"]; S["h2"] = h2
    as_user("adv"); q("select p2_decide_review(%s,'approved','Agreed',%s)", (S["r2"], h2))
    st = dstate(); assert st[0] == "approved" and str(st[1]) == users["adv"]
    as_super(); assert q("select review_date from deficiencies where id=%s", (S["d"],))[0][0] is not None

@test("5. Lifecycle changes (status, resolved) do not withdraw the approval; analysis changes do")
def _():
    as_super(); run("update deficiencies set status='in_remediation' where id=%s", (S["d"],))
    assert rv("approved") and dstate()[0] == "approved"
    run("update deficiencies set draft_classification='Material weakness' where id=%s", (S["d"],))
    assert not rv("approved") and dstate()[0] == "draft", dstate()
    # compensating control change also withdraws an approval
    as_user("ia"); rid = q("select p2_submit_for_review('deficiency',%s)", (S["d"],))[0][0]
    h = [r for r in rv() if str(r[0]) == str(rid)][0][3]
    as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    assert dstate()[0] == "approved"
    as_super(); run("update compensating_controls set description='Quarterly review (changed)' where id=%s", (S["cc"],))
    assert not rv("approved") and dstate()[0] == "draft"

@test("6. Reopen needs permission and a rationale; history is preserved")
def _():
    as_user("ia"); rid = q("select p2_submit_for_review('deficiency',%s)", (S["d"],))[0][0]
    h = [r for r in rv() if str(r[0]) == str(rid)][0][3]
    as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    as_user("ia"); expect_fail("select p2_reopen_review(%s,'Preparer reopening approved work')", (rid,), "Not permitted")
    as_user("adv"); expect_fail("select p2_reopen_review(%s,'short')", (rid,), "rationale")
    q("select p2_reopen_review(%s,'New facts: the control also failed in November')", (rid,))
    assert dstate()[0] == "draft" and len(rv()) >= 4

@test("7. External visibility follows the workflow: only an approved classification is shown; aggregation analysis is internal")
def _():
    as_user("ext"); assert q("select count(*) from deficiencies where id=%s", (S["d"],))[0][0] == 0
    assert q("select count(*) from aggregation_groups")[0][0] == 0
    as_user("view"); assert q("select count(*) from aggregation_groups")[0][0] == 0
    as_user("ia"); assert q("select count(*) from aggregation_groups")[0][0] == 1
    rid = q("select p2_submit_for_review('deficiency',%s)", (S["d"],))[0][0]
    h = [r for r in rv() if str(r[0]) == str(rid)][0][3]
    as_user("ext"); assert q("select count(*) from deficiencies where id=%s", (S["d"],))[0][0] == 0      # awaiting review: still hidden
    as_user("adv"); q("select p2_decide_review(%s,'approved','ok',%s)", (rid, h))
    as_user("ext"); assert q("select count(*) from deficiencies where id=%s", (S["d"],))[0][0] == 1
    as_user("view"); assert q("select count(*) from deficiencies where id=%s", (S["d"],))[0][0] == 1
    as_user("ia_b"); assert q("select count(*) from deficiencies where id=%s", (S["d"],))[0][0] == 0

@test("8. Cross-tenant, comments on deficiencies, audit and hardening")
def _():
    as_user("ia_b"); expect_fail("select p2_decide_review(%s,'approved','ok',%s)", (S["r2"], S["h2"]), "explicitly assigned")
    expect_fail("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'deficiency',%s,'internal','x')", (orgB, S["d"]), "Cross-tenant")
    as_user("ia"); run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'deficiency',%s,'internal','analysis note')", (orgA, S["d"]))
    as_super()
    acts = {r[0] for r in q("select action from audit_log where organization_id=%s and entity_type in ('deficiencies','workpaper_reviews')", (orgA,))}
    assert {"review_superseded", "review_reopened"} <= acts, acts
    assert q("select count(*) from audit_log where entity_type='workpaper_reviews' and actor_id=%s and action='status_changed'", (users["adv"],))[0][0] >= 3
    as_user("owner")
    for f in ("p2_deficiency_review_guard()", "p2_review_invalidate()", "p2_supersede_reviews('deficiency', null)", "p2_supersede_reviews(null)"):
        expect_fail(f"select public.{f}", None, "permission denied")
    run("reset role"); run("set role anon"); expect_fail("select p2_record_hash('deficiency', null)", None, "permission denied")

finish()
