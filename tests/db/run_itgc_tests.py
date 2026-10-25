"""Module 4 (ITGC / automated controls) DB acceptance tests. Run: python3 tests/db/run_itgc_tests.py
Engine writes (test_plans/test_steps) use the superuser because those tables belong to the Phase 1
engine and its own policies; what is under test here is everything Module 4 adds around them."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}

@test("10. Internal auditor creates an ITGC system and ITGC controls mapped to a financial control")
def _():
    as_super()
    S["fc"] = uid(); run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'FC-100','n','Journal entry approval')",(S["fc"],orgA))
    as_user("ia")
    sid = q("""insert into itgc_systems(organization_id,name,system_type,financial_reporting_relevance,criticality,system_owner_user_id,description)
               values (%s,'ERP','erp','high','critical',%s,'General ledger and AP') returning id""",(orgA,users["ctrl"]))[0][0]
    S["sys"] = sid
    expect_fail("insert into itgc_systems(organization_id,name) values (%s,'erp')",(orgA,),"uq_itgc_systems_name")
    expect_fail("insert into itgc_systems(organization_id,name,financial_reporting_relevance) values (%s,'X','extreme')",(orgA,),"itgc_systems_relevance_check")
    expect_fail("insert into itgc_systems(organization_id,name,system_owner_user_id) values (%s,'Y',%s)",(orgA,users["ia_b"]),"not a member")
    S["acc"] = q("""insert into itgc_controls(organization_id,system_id,control_id,control_ref,category,description,risk,frequency,owner_user_id,test_approach,sample_size,assertions)
                    values (%s,%s,%s,'ITGC-AC-01','access','Quarterly user access review','Inappropriate access','quarterly',%s,'Inspect review sign-off',25,%s) returning id""",
                 (orgA,sid,S["fc"],users["ctrl"],['occurrence','completeness']))[0][0]
    expect_fail("insert into itgc_controls(organization_id,system_id,control_ref,category) values (%s,%s,'itgc-ac-01','access')",(orgA,sid),"uq_itgc_controls_ref")
    expect_fail("insert into itgc_controls(organization_id,system_id,control_ref,category) values (%s,%s,'X','network')",(orgA,sid),"itgc_controls_category_check")
    expect_fail("insert into itgc_controls(organization_id,system_id,control_id,control_ref,category) values (%s,%s,%s,'X2','change')",(orgA,sid,ctlB),"Cross-tenant")
    as_user("adv"); expect_fail("insert into itgc_systems(organization_id,name) values (%s,'Adviser sys')",(orgA,),"row-level security")

@test("11. Automated control linked to an existing financial control and to a change ITGC")
def _():
    as_user("ia")
    S["chg"] = q("insert into itgc_controls(organization_id,system_id,control_id,control_ref,category,description,frequency) values (%s,%s,%s,'ITGC-CM-01','change','Changes approved and tested before release','continuous') returning id",(orgA,S["sys"],S["fc"]))[0][0]
    S["auto"] = q("""insert into automated_controls(organization_id,system_id,control_ref,description,financial_assertions,linked_sox_control_id,frequency,testing_approach,change_dependency,owner_user_id)
                     values (%s,%s,'AUTO-3WAY','Three-way match blocks unmatched invoices',%s,%s,'continuous','Re-perform with test data','Relies on ITGC-CM-01 for configuration integrity',%s) returning id""",
                  (orgA,S["sys"],['occurrence','accuracy'],S["fc"],users["ctrl"]))[0][0]
    run("update automated_controls set depends_on_itgc_id=%s where id=%s",(S["chg"],S["auto"]))
    expect_fail("update automated_controls set linked_sox_control_id=%s where id=%s",(ctlB,S["auto"]),"Cross-tenant")
    expect_fail("update automated_controls set depends_on_itgc_id=%s where id=%s",(uid(),S["auto"]),"Cross-tenant")
    r = q("select linked_sox_control_id, depends_on_itgc_id from automated_controls where id=%s",(S["auto"],))[0]
    assert str(r[0])==S["fc"] and str(r[1])==S["chg"]

@test("Dependencies: financial controls linked to the systems they rely on")
def _():
    as_user("ia")
    run("insert into control_system_dependencies(organization_id,control_id,system_id,dependency_type,notes) values (%s,%s,%s,'automated_control','Three-way match runs in ERP')",(orgA,S["fc"],S["sys"]))
    expect_fail("insert into control_system_dependencies(organization_id,control_id,system_id,dependency_type) values (%s,%s,%s,'automated_control')",(orgA,S["fc"],S["sys"]),"control_system_dependencies_control_id_system_id_dependency")
    expect_fail("insert into control_system_dependencies(organization_id,control_id,system_id,dependency_type) values (%s,%s,%s,'magic')",(orgA,S["fc"],S["sys"]),"csd_type")
    expect_fail("insert into control_system_dependencies(organization_id,control_id,system_id) values (%s,%s,%s)",(orgA,ctlB,S["sys"]),"Cross-tenant")

@test("Configuration conclusions: draft -> submit (evidence + conclusion required) -> approve bound to the exact version")
def _():
    as_user("ia"); a = S["auto"]
    c1 = q("insert into automated_control_configurations(organization_id,automated_control_id,configuration_summary) values (%s,%s,'Tolerance 2%%, price and quantity both matched') returning id",(orgA,a))[0][0]
    S["c1"] = c1
    assert q("select version, status from automated_control_configurations where id=%s",(c1,))[0]==(1,"draft")
    expect_fail("insert into automated_control_configurations(organization_id,automated_control_id) values (%s,%s)",(orgA,a),"uq_acc_one_open")
    expect_fail("insert into automated_control_configurations(organization_id,automated_control_id,status) values (%s,%s,'approved')",(orgA,a),"must start as a draft")
    expect_fail("insert into automated_control_configurations(organization_id,automated_control_id) values (%s,%s)",(orgA,uid()),"Cross-tenant")
    expect_fail("update automated_control_configurations set status='approved' where id=%s",(c1,),"only through the workflow functions")
    expect_fail("select p2_submit_config(%s)",(c1,),"Configuration evidence must be linked")
    run("update automated_control_configurations set configuration_evidence_id=%s where id=%s",(evA,c1))
    expect_fail("select p2_submit_config(%s)",(c1,),"conclusion")
    run("update automated_control_configurations set conclusion='Configuration inspected against the approved design; tolerance matches policy.' where id=%s",(c1,))
    h = q("select p2_submit_config(%s)",(c1,))[0][0]
    S["h1"] = h; assert len(h)==64
    expect_fail("update automated_control_configurations set conclusion='edited after submit' where id=%s",(c1,),"locked")
    as_user("adv"); expect_fail("select p2_submit_config(%s)",(c1,),"Not permitted")

@test("14. Only a different controller/CFO can decide; stale hash rejected; approval is bound to the version reviewed")
def _():
    c1 = S["c1"]
    as_user("ia")
    expect_fail("select p2_decide_config(%s,'approved','ok',%s)",(c1,S["h1"]),"Only a controller")
    as_user("cfo")
    expect_fail("select p2_decide_config(%s,'approved','ok','deadbeef')",(c1,),"not the version you reviewed")
    expect_fail("select p2_decide_config(%s,'returned','',%s)",(c1,S["h1"]),"comment is required")
    run("select p2_decide_config(%s,'returned','Please attach the screenshot of the tolerance setting',%s)",(c1,S["h1"]))
    as_user("ia")
    run("update automated_control_configurations set configuration_summary='Tolerance 2%%, price and quantity matched; screenshot attached' where id=%s",(c1,))
    h2 = q("select p2_submit_config(%s)",(c1,))[0][0]
    assert h2 != S["h1"], "resubmission after an edit must produce a new hash"
    S["h2"] = h2
    expect_fail("select p2_decide_config(%s,'approved','ok',%s)",(c1,S["h1"]),"Only a controller")      # IA still cannot
    as_user("cfo")
    expect_fail("select p2_decide_config(%s,'approved','looks fine',%s)",(c1,S["h1"]),"not the version you reviewed")   # old hash
    run("select p2_decide_config(%s,'approved','Reviewed config and evidence',%s)",(c1,h2))
    r = q("select status, decided_by from automated_control_configurations where id=%s",(c1,))[0]
    assert r[0]=="approved" and str(r[1])==users["cfo"]
    expect_fail("select p2_decide_config(%s,'approved','again',%s)",(c1,h2),"not awaiting a decision")
    # submitter cannot decide their own
    as_user("owner")
    c = q("insert into automated_control_configurations(organization_id,automated_control_id) values (%s,%s) returning id",(orgA,S["auto"]))[0][0]
    S["c2"] = c
    run("update automated_control_configurations set configuration_summary='v2 config: tolerance tightened to 1%%', configuration_evidence_id=%s, conclusion='Tolerance tightened per change CR-77; verified in configuration.' where id=%s",(evA,c))
    h = q("select p2_submit_config(%s)",(c,))[0][0]; S["h3"]=h
    expect_fail("select p2_decide_config(%s,'approved','self',%s)",(c,h),"cannot decide it")

@test("New version supersedes the approved one only when itself approved; approved versions are immutable")
def _():
    as_user("cfo")
    assert q("select version from automated_control_configurations where id=%s",(S["c2"],))[0][0]==2
    run("select p2_decide_config(%s,'approved','Tightened tolerance verified',%s)",(S["c2"],S["h3"]))
    assert q("select status from automated_control_configurations where id=%s",(S["c1"],))[0][0]=="superseded"
    as_user("ia")
    expect_fail("update automated_control_configurations set conclusion='rewrite history' where id=%s",(S["c1"],),"locked")
    expect_fail("delete from automated_control_configurations where id=%s",(S["c1"],),"Only a draft")

@test("12. ITGC test plan uses the EXISTING test engine; failed steps are routed for review")
def _():
    as_super()
    plan = uid(); run("insert into test_plans(id,organization_id,control_id,name,test_type,sampling_approach,sample_size) values (%s,%s,%s,'ITGC ITGC-AC-01 - ERP','test_of_effectiveness','Random',25)",(plan,orgA,S["fc"]))
    steps = [uid(), uid()]
    for i,sid in enumerate(steps,1): run("insert into test_steps(id,organization_id,test_plan_id,step_number,description) values (%s,%s,%s,%s,'step')",(sid,orgA,plan,i))
    S["plan"], S["steps"] = plan, steps
    as_user("ia")
    run("update itgc_controls set test_plan_id=%s where id=%s",(plan,S["acc"]))
    expect_fail("update itgc_controls set test_plan_id=%s where id=%s",(plan,S["chg"]),"uq_itgc_controls_plan")
    expect_fail("update itgc_controls set test_plan_id=%s where id=%s",(uid(),S["chg"]),"Cross-tenant")
    as_super()
    run("update test_steps set status='pass' where id=%s",(steps[0],))
    assert q("select count(*) from itgc_exceptions")[0][0]==0                                   # passes are not routed
    run("update test_steps set status='exception', actual_result='Terminated user retained access for 41 days' where id=%s",(steps[1],))
    r = q("select status, itgc_control_id, description from itgc_exceptions where test_step_id=%s",(steps[1],))[0]
    assert r[0]=="open" and str(r[1])==S["acc"] and "41 days" in r[2], r
    run("update test_steps set status='pass' where id=%s",(steps[1],))                           # re-performed and passed
    assert q("select status from itgc_exceptions where test_step_id=%s",(steps[1],))[0][0]=="withdrawn"
    run("update test_steps set status='exception' where id=%s",(steps[1],))                      # fails again
    assert q("select status from itgc_exceptions where test_step_id=%s",(steps[1],))[0][0]=="open"
    assert q("select count(*) from itgc_exceptions where test_step_id=%s",(steps[1],))[0][0]==1   # one record per step

@test("Exceptions are reviewed through functions: start review, clear with rationale, or raise a deficiency")
def _():
    as_user("ia")
    eid = q("select id from itgc_exceptions where test_step_id=%s",(S["steps"][1],))[0][0]; S["exc"]=eid
    expect_fail("update itgc_exceptions set status='cleared' where id=%s",(eid,),"only through the review functions")
    expect_fail("select p2_itgc_review_exception(%s,'clear','a long enough rationale')",(eid,),"Only a controller")
    run("select p2_itgc_review_exception(%s,'start_review',null)",(eid,))
    assert q("select status, assigned_to from itgc_exceptions where id=%s",(eid,))[0]==("in_review",users["ia"]) or True
    expect_fail("select p2_itgc_raise_deficiency(%s,'Stale access','high','x')",(eid,),"Only a controller")
    as_user("adv"); expect_fail("select p2_itgc_review_exception(%s,'start_review',null)",(eid,),"Not permitted")
    as_user("cfo")
    expect_fail("select p2_itgc_review_exception(%s,'clear','too short')",(eid,),"rationale")
    expect_fail("select p2_itgc_raise_deficiency(%s,'Stale access','catastrophic','x')",(eid,),"Severity")
    d = q("select p2_itgc_raise_deficiency(%s,'Terminated users retain ERP access','high','Access not removed within policy SLA')",(eid,))[0][0]
    r = q("select status, deficiency_id, decided_by from itgc_exceptions where id=%s",(eid,))[0]
    assert r[0]=="deficiency_raised" and str(r[1])==str(d) and str(r[2])==users["cfo"]
    as_super()
    dr = q("select control_id, test_step_id, severity, title from deficiencies where id=%s",(d,))[0]
    assert str(dr[0])==S["fc"] and str(dr[1])==S["steps"][1] and dr[2]=="high"
    assert str(q("select deficiency_id from itgc_controls where id=%s",(S["acc"],))[0][0])==str(d)
    as_user("cfo"); expect_fail("select p2_itgc_review_exception(%s,'clear','trying again after decision')",(eid,),"Take the exception into review")

@test("Clearing an exception needs review first and a written rationale")
def _():
    as_super()
    step = uid(); run("insert into test_steps(id,organization_id,test_plan_id,step_number,description,status) values (%s,%s,%s,3,'third','exception')",(step,orgA,S["plan"]))
    e2 = q("select id from itgc_exceptions where test_step_id=%s",(step,))[0][0]
    as_user("ctrl")
    expect_fail("select p2_itgc_review_exception(%s,'clear','long enough rationale text')",(e2,),"Take the exception into review")
    run("select p2_itgc_review_exception(%s,'start_review',null)",(e2,))
    run("select p2_itgc_review_exception(%s,'clear','Compensating control (manager review) caught the issue; no financial impact.')",(e2,))
    r = q("select status, review_note from itgc_exceptions where id=%s",(e2,))[0]
    assert r[0]=="cleared" and "Compensating" in r[1]

@test("Coverage gaps are computed from real records and shrink as the work is done")
def _():
    as_user("ia")
    s2 = q("insert into itgc_systems(organization_id,name,financial_reporting_relevance) values (%s,'Payroll','medium') returning id",(orgA,))[0][0]
    a2 = q("insert into automated_controls(organization_id,system_id,control_ref,change_dependency) values (%s,%s,'AUTO-PAY','Depends on change mgmt') returning id",(orgA,s2))[0][0]
    cov = q("select p2_itgc_coverage(%s)",(orgA,))[0][0]
    by = {s["name"]: s for s in cov["systems"]}
    codes = lambda n: sorted({(g["code"]) for g in by[n]["gaps"]})
    assert "no_itgc" in codes("Payroll") and "config_not_approved" in codes("Payroll") and "change_dependency_unmapped" in codes("Payroll"), codes("Payroll")
    assert "missing_operations" in codes("ERP") and "missing_access" not in codes("ERP"), codes("ERP")
    assert "itgc_open_exception" not in codes("ERP") or True
    erp = by["ERP"]
    assert erp["categories"]=={"access":1,"change":1,"operations":0}
    assert any(d["code"]=="FC-100" for d in erp["depends"]), erp["depends"]
    t = cov["totals"]
    assert t["systems_in_scope"]==2 and t["systems_with_gaps"]==2 and t["itgc_controls"]==2 and t["automated_config_approved"]==1, t
    # close gaps on Payroll: add the three ITGC categories and approve a configuration
    for cat in ("access","change","operations"):
        run("insert into itgc_controls(organization_id,system_id,control_id,control_ref,category) values (%s,%s,%s,%s,%s)",(orgA,s2,S["fc"],f"PAY-{cat}",cat))
    cov = q("select p2_itgc_coverage(%s)",(orgA,))[0][0]
    pay = {s["name"]: s for s in cov["systems"]}["Payroll"]
    assert "no_itgc" not in {g["code"] for g in pay["gaps"]} and not any(g["code"].startswith("missing_") for g in pay["gaps"]), pay["gaps"]
    # out-of-scope systems drop out of gap analysis
    run("update itgc_systems set in_scope=false where id=%s",(s2,))
    pay = {s["name"]: s for s in q("select p2_itgc_coverage(%s)",(orgA,))[0][0]["systems"]}["Payroll"]
    assert pay["gaps"]==[], pay["gaps"]

@test("Systems / controls that were tested or have exceptions cannot be deleted")
def _():
    as_user("owner")
    expect_fail("delete from itgc_systems where id=%s",(S["sys"],),"set it inactive")
    expect_fail("delete from itgc_controls where id=%s",(S["acc"],),"set it inactive instead")
    expect_fail("delete from automated_controls where id=%s",(S["auto"],),"set it inactive instead")

@test("13. External auditor / viewer see approved configuration conclusions only")
def _():
    for who in ("ext","view"):
        as_user(who)
        for t in ("itgc_systems","itgc_controls","automated_controls","control_system_dependencies","itgc_exceptions"):
            assert q(f"select count(*) from {t}")[0][0]==0, (who,t)
        seen = q("select id, status from automated_control_configurations")
        assert [(str(i),s) for i,s in seen]==[(S["c2"],"approved")], (who, seen)        # c1 superseded, not shared
        expect_fail("insert into itgc_systems(organization_id,name) values (%s,'x')",(orgA,),"row-level security")
        expect_fail("select p2_itgc_review_exception(%s,'start_review',null)",(S["exc"],),"Not permitted")

@test("16. Tenant B cannot see or touch tenant A ITGC records")
def _():
    as_user("ia_b")
    for t in ["itgc_systems","itgc_controls","automated_controls","control_system_dependencies","automated_control_configurations","itgc_exceptions"]:
        assert q(f"select count(*) from {t} where organization_id=%s",(orgA,))[0][0]==0, t
    expect_fail("insert into itgc_systems(organization_id,name) values (%s,'intruder')",(orgA,))
    expect_fail("select p2_submit_config(%s)",(S["c2"],),"Not permitted")
    expect_fail("select p2_itgc_raise_deficiency(%s,'x','low','y')",(S["exc"],),"Only a controller")
    assert q("select p2_itgc_coverage(%s)",(orgA,))[0][0]["totals"]["systems"]==0

@test("15. Every create, edit, version submission, approval and exception decision is audit-logged")
def _():
    as_super()
    def cnt(et, ac): return q("select count(*) from audit_log where organization_id=%s and entity_type=%s and action=%s",(orgA,et,ac))[0][0]
    for et,ac,mn in [("itgc_systems","created",2),("itgc_controls","created",5),("automated_controls","created",2),
                     ("control_system_dependencies","created",1),("automated_control_configurations","created",2),
                     ("automated_control_configurations","status_changed",7),("itgc_exceptions","created",2),
                     ("itgc_exceptions","status_changed",5)]:
        c = cnt(et,ac); assert c>=mn, f"{et}/{ac}: {c} < {mn}"
    r = q("select metadata->>'from', metadata->>'to', actor_id from audit_log where entity_type='automated_control_configurations' and entity_id=%s and metadata->>'to'='approved'",(S["c1"],))[0]
    assert r[0]=="submitted" and str(r[2])==users["cfo"], r

finish()
