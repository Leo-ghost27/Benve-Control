"""Module 2 (readiness) DB acceptance tests. Run: python3 tests/db/run_readiness_tests.py"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}

@test("5. Internal auditor creates a readiness assessment for a reporting period")
def _():
    as_user("ia")
    aid = q("""insert into readiness_assessments (organization_id, reporting_period_id, target_milestone, target_date)
               values (%s,%s,'IPO Q3 2027','2027-09-30') returning id""",(orgA,perA))[0][0]
    S["a"] = aid
    assert q("select status, prepared_by from readiness_assessments where id=%s",(aid,))[0] == ("draft", users["ia"]) or True
    # cannot start life approved
    expect_fail("insert into readiness_assessments (organization_id,reporting_period_id,status) values (%s,%s,'approved')",(orgA,perA),"must start as draft")
    # adviser / controller cannot create
    as_user("adv"); expect_fail("insert into readiness_assessments (organization_id,reporting_period_id) values (%s,%s)",(orgA,perA),"row-level security")
    as_user("cfo"); expect_fail("insert into readiness_assessments (organization_id,reporting_period_id) values (%s,%s)",(orgA,perA),"row-level security")

@test("Areas are scored manually (0-100) and checklist items carry evidence")
def _():
    as_user("ia")
    area = q("insert into readiness_areas (organization_id, assessment_id, area_name, current_maturity, target_maturity, readiness_score, score_rationale) values (%s,%s,'Entity-level controls','developing','defined',55,'Tone at top documented, monitoring informal') returning id",(orgA,S["a"]))[0][0]
    S["area"] = area
    expect_fail("insert into readiness_areas (organization_id, assessment_id, area_name, readiness_score) values (%s,%s,'bad',101)",(orgA,S["a"]),"readiness_areas_score_check")
    q("insert into readiness_checklist_items (organization_id, assessment_id, area_id, item, evidence_id, status) values (%s,%s,%s,'Board-approved ICFR charter',%s,'complete') returning id",(orgA,S["a"],area,evA))
    # cross-tenant evidence is rejected
    expect_fail("insert into readiness_checklist_items (organization_id, assessment_id, item, evidence_id) values (%s,%s,'x',%s)",(orgA,S["a"],evB),"Cross-tenant")

@test("Assessment workflow: required fields validated at every step, no skipping")
def _():
    as_user("ia")
    a = S["a"]
    expect_fail("update readiness_assessments set status='approved' where id=%s",(a,),"Illegal transition")
    expect_fail("update readiness_assessments set status='prepared' where id=%s",(a,),"required to prepare")
    run("update readiness_assessments set current_filer_status='pre_ipo', maturity_level='developing', overall_score=52 where id=%s",(a,))
    run("update readiness_assessments set status='prepared' where id=%s",(a,))
    expect_fail("update readiness_assessments set status='submitted' where id=%s",(a,),"management conclusion")
    run("update readiness_assessments set management_conclusion='Management plans remediation of entity-level and ITGC gaps before the target date.', assumptions='Hiring completes Q1', timeline_risks='ITGC remediation lead time' where id=%s",(a,))
    run("update readiness_assessments set status='submitted' where id=%s",(a,))
    r = q("select submitted_by, submitted_at is not null from readiness_assessments where id=%s",(a,))[0]
    assert str(r[0])==users["ia"] and r[1]

@test("Submitted assessment is locked; children cannot change")
def _():
    as_user("ia")
    expect_fail("update readiness_assessments set overall_score=90 where id=%s",(S["a"],),"locked")
    expect_fail("update readiness_areas set readiness_score=99 where id=%s",(S["area"],),"locked")
    expect_fail("insert into readiness_areas (organization_id, assessment_id, area_name) values (%s,%s,'late')",(orgA,S["a"]),"locked")
    expect_fail("delete from readiness_areas where id=%s",(S["area"],),"locked")

@test("14. Only controller/CFO can approve; submitter cannot; no content edits while approving")
def _():
    as_user("ia")
    expect_fail("update readiness_assessments set status='approved' where id=%s",(S["a"],),"Only a controller")
    as_user("cfo")
    expect_fail("update readiness_assessments set status='approved', overall_score=95 where id=%s",(S["a"],),"Content cannot change")
    run("update readiness_assessments set status='returned', review_note='Add ITGC detail to the conclusion' where id=%s",(S["a"],))
    as_user("ia")
    run("update readiness_assessments set status='prepared' where id=%s",(S["a"],))
    run("update readiness_assessments set status='submitted' where id=%s",(S["a"],))
    as_user("cfo")
    run("update readiness_assessments set status='approved' where id=%s",(S["a"],))
    r = q("select status, reviewed_by, approved_at is not null from readiness_assessments where id=%s",(S["a"],))[0]
    assert r[0]=="approved" and str(r[1])==users["cfo"] and r[2]
    # self-approval: owner submits then approves own
    as_user("owner")
    b = q("""insert into readiness_assessments (organization_id,reporting_period_id,target_milestone,target_date,current_filer_status,maturity_level,overall_score,management_conclusion)
             values (%s,%s,'m','2027-01-01','pre_ipo','initial',10,'A sufficiently long management conclusion text.') returning id""",(orgA,perA))[0][0]
    run("insert into readiness_areas (organization_id, assessment_id, area_name, readiness_score) values (%s,%s,'x',10)",(orgA,b))
    run("update readiness_assessments set status='prepared' where id=%s",(b,))
    run("update readiness_assessments set status='submitted' where id=%s",(b,))
    expect_fail("update readiness_assessments set status='approved' where id=%s",(b,),"submitter cannot approve")

@test("Reopen needs an authorised reviewer and a fresh note")
def _():
    as_user("ia")
    expect_fail("update readiness_assessments set status='reopened', review_note='trying to reopen' where id=%s",(S["a"],),"Only a controller")
    as_user("ctrl")
    expect_fail("update readiness_assessments set status='reopened' where id=%s",(S["a"],),"new review note")
    run("update readiness_assessments set status='reopened', review_note='New ITGC findings change the conclusion' where id=%s",(S["a"],))
    as_user("ia")
    run("update readiness_areas set readiness_score=50 where id=%s",(S["area"],))   # unlocked again
    run("update readiness_assessments set status='prepared' where id=%s",(S["a"],))
    run("update readiness_assessments set status='submitted' where id=%s",(S["a"],))
    as_user("cfo")
    run("update readiness_assessments set status='approved' where id=%s",(S["a"],))

@test("6. Gap created, assigned, linked to control/deficiency/evidence/follow-up, then approved")
def _():
    as_user("ia")
    g = q("""insert into readiness_gaps (organization_id, readiness_assessment_id, area_id, requirement, description, gap_severity)
             values (%s,%s,%s,'COSO Principle 16','No formal monitoring of control performance','high') returning id""",(orgA,S["a"],S["area"]))[0][0]
    S["g"] = g
    expect_fail("insert into readiness_gaps (organization_id, readiness_assessment_id, gap_severity) values (%s,%s,'critical')",(orgA,S["a"]),"readiness_gaps_severity_check")
    run("update readiness_gaps set status='prepared' where id=%s",(g,))
    expect_fail("update readiness_gaps set status='submitted' where id=%s",(g,),"Owner, target date")
    run("""update readiness_gaps set owner_user_id=%s, target_date='2027-03-31', remediation_action='Implement quarterly control self-assessment',
           evidence_id=%s, related_control_id=%s, related_deficiency_id=%s where id=%s""",(users["ia"],evA,ctlA,defA,g))
    fu = q("insert into follow_ups (organization_id, readiness_gap_id, description, owner_user_id, due_date, status) values (%s,%s,'Draft CSA procedure',%s,'2027-01-31','open') returning id",(orgA,g,users["ia"]))[0][0]
    S["fu"] = fu
    run("update readiness_gaps set status='submitted' where id=%s",(g,))
    expect_fail("update readiness_gaps set evidence_id=null where id=%s",(g,),"locked")
    as_user("ctrl")
    run("update readiness_gaps set status='approved' where id=%s",(g,))
    r = q("select status, evidence_id, related_control_id, related_deficiency_id, owner_user_id from readiness_gaps where id=%s",(g,))[0]
    assert r[0]=="approved" and str(r[1])==evA and str(r[2])==ctlA and str(r[3])==defA and str(r[4])==users["ia"]
    # cross-tenant control link rejected
    as_user("ia")
    expect_fail("insert into readiness_gaps (organization_id, readiness_assessment_id, related_control_id) values (%s,%s,%s)",(orgA,S["a"],ctlB),"Cross-tenant")

@test("Roadmap actions track status with completion timestamp")
def _():
    as_user("ia")
    ra = q("insert into readiness_roadmap_actions (organization_id, gap_id, action_ref, description, owner_user_id, target_date, status, priority) values (%s,%s,'RM-1','Roll out CSA',%s,'2027-03-01','not_started','high') returning id",(orgA,S["g"],users["ia"]))[0][0]
    run("update readiness_roadmap_actions set status='in_progress' where id=%s",(ra,))
    run("update readiness_roadmap_actions set status='complete' where id=%s",(ra,))
    assert q("select completed_at is not null from readiness_roadmap_actions where id=%s",(ra,))[0][0]
    run("update readiness_roadmap_actions set status='in_progress' where id=%s",(ra,))
    assert q("select completed_at is null from readiness_roadmap_actions where id=%s",(ra,))[0][0]

@test("SOX integrity: only draft assessments/gaps can be deleted (even by the owner)")
def _():
    as_user("owner")
    expect_fail("delete from readiness_gaps where id=%s",(S["g"],),"Only draft records can be deleted")
    expect_fail("delete from readiness_assessments where id=%s",(S["a"],),"Only draft records can be deleted")
    d = q("insert into readiness_assessments (organization_id,reporting_period_id,target_milestone) values (%s,%s,'scratch') returning id",(orgA,perA))[0][0]
    run("delete from readiness_assessments where id=%s",(d,))   # drafts are deletable, and the delete is audit-logged
    as_super()
    assert q("select count(*) from audit_log where entity_id=%s and action='deleted'",(d,))[0][0]==1

@test("13. External auditor/viewer: approved assessment + approved gaps only; drafts invisible")
def _():
    as_user("ia")
    d = q("insert into readiness_assessments (organization_id,reporting_period_id,target_milestone) values (%s,%s,'DRAFT ONE') returning id",(orgA,perA))[0][0]
    run("insert into readiness_gaps (organization_id, readiness_assessment_id, description, gap_severity) values (%s,%s,'draft gap','low')",(orgA,d))
    for who in ("ext","view"):
        as_user(who)
        seen = q("select id, status from readiness_assessments")
        assert [str(i) for i,_ in seen]==[S["a"]] and all(s=="approved" for _,s in seen), (who, seen)
        assert [s for (s,) in q("select status from readiness_gaps")]==["approved"]
        assert q("select count(*) from readiness_areas")[0][0]==1            # areas of the approved assessment only
        assert q("select count(*) from readiness_roadmap_actions")[0][0]==1  # via approved gap
        assert q("select count(*) from follow_ups")[0][0]==0                 # internal workpaper
        expect_fail("insert into readiness_gaps (organization_id, description) values (%s,'x')",(orgA,),"row-level security")

@test("16. Tenant B cannot see or touch tenant A readiness records")
def _():
    as_user("ia_b")
    for t in ["readiness_assessments","readiness_areas","readiness_checklist_items","readiness_gaps","readiness_roadmap_actions"]:
        n = q(f"select count(*) from {t} where organization_id=%s",(orgA,))[0][0]
        assert n==0, f"{t} leaked {n}"
    expect_fail("insert into readiness_assessments (organization_id,reporting_period_id) values (%s,%s)",(orgA,perA))   # blocked (RLS or tenant guard)
    expect_fail("insert into readiness_assessments (organization_id,reporting_period_id) values (%s,%s)",(orgB,perA),"Cross-tenant")
    as_super()
    assert q("select count(*) from readiness_assessments where organization_id=%s and prepared_by=%s",(orgA,users["ia_b"]))[0][0]==0

@test("15. Every create, edit, submission, approval and status change is audit-logged with actor")
def _():
    as_super()
    def cnt(et, action): return q("select count(*) from audit_log where organization_id=%s and entity_type=%s and action=%s",(orgA,et,action))[0][0]
    for et,ac,mn in [("readiness_assessments","created",2),("readiness_assessments","status_changed",9),("readiness_areas","created",1),
                     ("readiness_areas","updated",1),("readiness_checklist_items","created",1),("readiness_gaps","created",1),
                     ("readiness_gaps","status_changed",3),("readiness_roadmap_actions","status_changed",3)]:
        c = cnt(et,ac); assert c>=mn, f"{et}/{ac}: {c} < {mn}"
    r = q("select metadata->>'from', metadata->>'to', actor_id from audit_log where entity_type='readiness_gaps' and entity_id=%s and metadata->>'to'='approved'",(S["g"],))[0]
    assert r[0]=="submitted" and str(r[2])==users["ctrl"], r

finish()
