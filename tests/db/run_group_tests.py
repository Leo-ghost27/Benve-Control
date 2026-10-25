"""Module 3 (multi-entity / group ICFR) DB acceptance tests. Run: python3 tests/db/run_group_tests.py"""
import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
QUESTIONS = ["Any significant changes in internal control?", "Any fraud or suspected fraud?", "Any unusual transactions?"]

# ---- seed (superuser): processes, group/entity controls ---------------------
procA = uid(); run("insert into processes(id,organization_id,name) values (%s,%s,'Order to cash')",(procA,orgA))
procB = uid(); run("insert into processes(id,organization_id,name) values (%s,%s,'Other tenant process')",(procB,orgB))

@test("7. Entities: create, hierarchy rules, local owners, process and control assignment")
def _():
    as_user("ia")
    P = q("insert into entities(organization_id,name,legal_name,is_parent,in_scope,consolidation_method,jurisdiction) values (%s,'Group Parent','Group Parent plc',true,true,'full','UK') returning id",(orgA,))[0][0]
    S1 = q("insert into entities(organization_id,name,legal_name,parent_entity_id,in_scope,consolidation_method,local_owner_user_id,jurisdiction) values (%s,'Sub One','Sub One Ltd',%s,true,'full',%s,'IE') returning id",(orgA,P,users["ctrl"]))[0][0]
    S2 = q("insert into entities(organization_id,name,parent_entity_id,in_scope,consolidation_method,local_owner_user_id) values (%s,'Sub Two',%s,true,'full',%s) returning id",(orgA,P,users["ia"]))[0][0]
    S3 = q("insert into entities(organization_id,name,parent_entity_id,in_scope) values (%s,'Sub Three',%s,true) returning id",(orgA,P))[0][0]
    S.update(P=P,S1=S1,S2=S2,S3=S3)
    expect_fail("insert into entities(organization_id,name,is_parent) values (%s,'Second Parent',true)",(orgA,),"uq_entities_one_parent")
    expect_fail("insert into entities(organization_id,name) values (%s,'sub one')",(orgA,),"uq_entities_name")
    expect_fail("update entities set parent_entity_id=%s where id=%s",(S1,S1),"own parent")
    expect_fail("update entities set parent_entity_id=%s where id=%s",(S1,P),"cannot itself have a parent")
    run("update entities set is_parent=false where id=%s",(P,))
    expect_fail("update entities set parent_entity_id=%s where id=%s",(S1,P),"circular")
    run("update entities set is_parent=true where id=%s",(P,))
    expect_fail("insert into entities(organization_id,name,local_owner_user_id) values (%s,'Bad owner',%s)",(orgA,users["ia_b"]),"not a member")
    run("insert into entity_processes(organization_id,entity_id,process_id,in_scope,notes) values (%s,%s,%s,true,'in scope')",(orgA,S1,procA))
    expect_fail("insert into entity_processes(organization_id,entity_id,process_id) values (%s,%s,%s)",(orgA,S1,procB),"Cross-tenant")
    as_user("adv"); expect_fail("insert into entities(organization_id,name) values (%s,'Adviser entity')",(orgA,),"row-level security")

@test("7b. Group-level vs entity-level controls; assigning controls to entities; cross-tenant blocked")
def _():
    as_super()
    G1 = uid(); E1 = uid(); E2 = uid(); E3 = uid()
    for cid,code,ent in [(G1,'G-1',None),(E1,'E-1',S["S1"]),(E2,'E-2',S["S2"]),(E3,'E-3',S["S3"])]:
        run("insert into controls(id,organization_id,code,name,title,entity_id) values (%s,%s,%s,'n',%s,%s)",(cid,orgA,code,'Ctl '+code,ent))
    S.update(G1=G1,E1=E1,E2=E2,E3=E3)
    as_user("ia")
    for ent in (S["S1"],S["S2"]):   # BOTH entities rely on the one group-level control
        run("insert into entity_controls(organization_id,entity_id,control_id,reliance_type,local_owner_user_id) values (%s,%s,%s,'group_level',%s)",(orgA,ent,G1,users["ia"]))
    run("insert into entity_controls(organization_id,entity_id,control_id,reliance_type) values (%s,%s,%s,'entity_level')",(orgA,S["S1"],E1))
    expect_fail("insert into entity_controls(organization_id,entity_id,control_id) values (%s,%s,%s)",(orgA,S["S1"],G1),"entity_controls_entity_id_control_id_key")
    expect_fail("insert into entity_controls(organization_id,entity_id,control_id,reliance_type) values (%s,%s,%s,'bogus')",(orgA,S["S2"],E2),"entity_controls_reliance")
    expect_fail("insert into entity_controls(organization_id,entity_id,control_id) values (%s,%s,%s)",(orgA,S["S2"],ctlB),"Cross-tenant")

@test("8. Questionnaire: only IA or the entity's local owner can prepare; one per entity per period")
def _():
    as_user("cfo")    # group CFO is not the local owner of S1
    expect_fail("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s)",(orgA,S["S1"],perA),"row-level security")
    as_user("adv")
    expect_fail("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s)",(orgA,S["S1"],perA),"row-level security")
    as_user("ctrl")   # local owner of S1
    S["q1"] = q("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s) returning id",(orgA,S["S1"],perA))[0][0]
    expect_fail("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s)",(orgA,S["S1"],perA),"uq_questionnaire_entity_period")
    expect_fail("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s)",(orgA,S["S2"],perA),"row-level security")  # not their entity
    for i,qs in enumerate(QUESTIONS):
        run("insert into subsidiary_questionnaire_responses(organization_id,questionnaire_id,question,sort_order) values (%s,%s,%s,%s)",(orgA,S["q1"],qs,i))

@test("8b. Submit rules: all questions answered, follow-up needs comments, locked after submit")
def _():
    as_user("ctrl"); q1 = S["q1"]
    expect_fail("update subsidiary_questionnaires set status='submitted' where id=%s",(q1,),"Illegal transition")
    run("update subsidiary_questionnaires set status='prepared' where id=%s",(q1,))
    expect_fail("update subsidiary_questionnaires set status='submitted' where id=%s",(q1,),"Every question must be answered")
    run("update subsidiary_questionnaire_responses set response='No' where questionnaire_id=%s",(q1,))
    rid = q("select id from subsidiary_questionnaire_responses where questionnaire_id=%s order by sort_order limit 1",(q1,))[0][0]
    S["resp"] = rid
    run("update subsidiary_questionnaire_responses set response='Yes', follow_up_required=true where id=%s",(rid,))
    run("update subsidiary_questionnaires set status='prepared' where id=%s and false",(q1,))
    expect_fail("update subsidiary_questionnaires set status='submitted' where id=%s",(q1,),"flagged as needing follow-up")
    run("update subsidiary_questionnaire_responses set evidence_comments='New ERP go-live in Q3; user access review pending' where id=%s",(rid,))
    run("update subsidiary_questionnaires set status='submitted' where id=%s",(q1,))
    r = q("select group_review_status, submitted_by, submitted_at is not null from subsidiary_questionnaires where id=%s",(q1,))[0]
    assert r[0]=="in_review" and str(r[1])==users["ctrl"] and r[2], r
    expect_fail("update subsidiary_questionnaire_responses set response='changed' where id=%s",(rid,),"locked")
    expect_fail("insert into subsidiary_questionnaire_responses(organization_id,questionnaire_id,question) values (%s,%s,'late')",(orgA,q1),"locked")

@test("8c. Group review: clarification request, return, accept-with-follow-up needs a real follow-up")
def _():
    q1 = S["q1"]
    as_user("ctrl")
    expect_fail("update subsidiary_questionnaires set status='approved', group_review_status='accepted' where id=%s",(q1,),"submitter cannot approve")
    as_user("ia")
    expect_fail("update subsidiary_questionnaires set status='returned', group_review_status='clarification_requested', review_note='Please clarify ERP scope' where id=%s",(q1,),"Only a controller")
    as_user("cfo")
    expect_fail("update subsidiary_questionnaires set status='returned', review_note='Please clarify ERP scope' where id=%s",(q1,),"clarification is requested or")
    expect_fail("update subsidiary_questionnaires set group_review_status='accepted' where id=%s",(q1,),"only change together")
    expect_fail("update subsidiary_questionnaires set status='returned', group_review_status='accepted', review_note='Please clarify ERP scope' where id=%s",(q1,),"clarification is requested or")
    run("update subsidiary_questionnaires set status='returned', group_review_status='clarification_requested', review_note='Please clarify ERP scope' where id=%s",(q1,))
    as_user("ctrl")   # preparer can edit again and resubmit
    run("update subsidiary_questionnaire_responses set evidence_comments='ERP go-live Q3; access review due 30 Nov; scope: AP and GL' where id=%s",(S["resp"],))
    run("update subsidiary_questionnaires set status='prepared' where id=%s",(q1,))
    assert q("select group_review_status from subsidiary_questionnaires where id=%s",(q1,))[0][0]=="not_started"
    run("update subsidiary_questionnaires set status='submitted' where id=%s",(q1,))
    as_user("cfo")
    expect_fail("update subsidiary_questionnaires set status='approved', group_review_status='accepted_with_follow_up' where id=%s",(q1,),"requires at least one open follow-up")
    as_user("ia")
    fu = q("insert into follow_ups(organization_id,questionnaire_id,description,owner_user_id,due_date,status) values (%s,%s,'Complete ERP access review',%s,'2026-11-30','open') returning id",(orgA,q1,users["ctrl"]))[0][0]
    S["fu"] = fu
    as_user("cfo")
    expect_fail("update subsidiary_questionnaires set status='approved', group_review_status='accepted_with_follow_up', overall='x' where id=%s",(q1,))  # unknown column
    run("update subsidiary_questionnaires set status='approved', group_review_status='accepted_with_follow_up' where id=%s",(q1,))
    r = q("select status, group_review_status, reviewed_by, approved_at is not null from subsidiary_questionnaires where id=%s",(q1,))[0]
    assert r[0]=="approved" and r[1]=="accepted_with_follow_up" and str(r[2])==users["cfo"] and r[3], r
    # the reviewer can link the follow-up to the flagged answer even though the record is approved; nothing else changes
    run("update subsidiary_questionnaire_responses set follow_up_id=%s where id=%s",(fu,S["resp"]))
    expect_fail("update subsidiary_questionnaire_responses set response='tampered' where id=%s",(S["resp"],),"locked")

@test("Group reviewer (CFO/controller) can raise a follow-up; adviser and viewer cannot")
def _():
    as_user("adv"); expect_fail("insert into follow_ups(organization_id,questionnaire_id,description,owner_user_id,due_date) values (%s,%s,'x',%s,'2026-12-01')",(orgA,S["q1"],users["ia"]),"row-level security")
    as_user("cfo")
    fid = q("insert into follow_ups(organization_id,questionnaire_id,description,owner_user_id,due_date,status) values (%s,%s,'Reviewer-raised follow-up',%s,'2026-12-01','open') returning id",(orgA,S["q1"],users["ia"]))[0][0]
    as_super(); run("delete from follow_ups where id=%s",(fid,))

@test("8d. A second entity's questionnaire is prepared by IA and accepted")
def _():
    as_user("ia")
    q2 = q("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s) returning id",(orgA,S["S2"],perA))[0][0]
    S["q2"] = q2
    for i,qs in enumerate(QUESTIONS):
        run("insert into subsidiary_questionnaire_responses(organization_id,questionnaire_id,question,response,sort_order) values (%s,%s,%s,'No',%s)",(orgA,q2,qs,i))
    run("update subsidiary_questionnaires set status='prepared' where id=%s",(q2,))
    run("update subsidiary_questionnaires set status='submitted' where id=%s",(q2,))
    as_user("ctrl")
    run("update subsidiary_questionnaires set status='approved', group_review_status='accepted' where id=%s",(q2,))
    # S3: draft only (not approved) -> must be excluded from the roll-up
    as_user("ia")
    S["q3"] = q("insert into subsidiary_questionnaires(organization_id,entity_id,reporting_period_id) values (%s,%s,%s) returning id",(orgA,S["S3"],perA))[0][0]

@test("9. Group roll-up counts approved entity records WITHOUT double-counting")
def _():
    as_super()
    # deficiencies: D1 on S1 control+entity; D2 on the group-level control; D3 on excluded S3; D4 entity=S2 but control belongs to S1
    D1,D2,D3,D4 = uid(),uid(),uid(),uid()
    run("insert into deficiencies(id,organization_id,control_id,entity_id,title) values (%s,%s,%s,%s,'D1'),(%s,%s,%s,null,'D2'),(%s,%s,%s,%s,'D3'),(%s,%s,%s,%s,'D4')",
        (D1,orgA,S["E1"],S["S1"], D2,orgA,S["G1"], D3,orgA,S["E3"],S["S3"], D4,orgA,S["E1"],S["S2"]))
    run("insert into deficiencies(id,organization_id,control_id,title,resolved_at) values (%s,%s,%s,'resolved one',now())",(uid(),orgA,S["E1"]))   # resolved: ignored
    # CCM exceptions in the period: on S1 control, on group control, on S3 control (excluded)
    for ctl in (S["E1"], S["G1"], S["E3"]):
        run("insert into ccm_exceptions(organization_id,reporting_period_id,control_id,description,status) values (%s,%s,%s,'x','open')",(orgA,perA,ctl))
    # a test plan on the group-level control that BOTH entities rely on
    run("insert into test_plans(id,organization_id,control_id,name,status) values (%s,%s,%s,'G1 plan','final')",(uid(),orgA,S["G1"]))
    run("insert into test_plans(id,organization_id,control_id,name) values (%s,%s,%s,'E3 plan')",(uid(),orgA,S["E3"]))
    as_user("ia")
    r = q("select p2_group_rollup(%s,%s)",(orgA,perA))[0][0]
    t = r["totals"]
    assert t["entities_in_scope"]==4 and t["entities_included"]==3 and t["entities_excluded"]==1, t   # parent + S1 + S2 in; S3 out
    # group bucket also holds the shared seed control C-1 and seed deficiency "def" (both entity_id null)
    assert t["controls"]==4, t            # C-1 + G1 (once, though two entities rely on it) + E1 + E2; E3 excluded
    assert t["deficiencies_open"]==4, t   # seed def + D2 (group) + D1 (S1) + D4 (S2, counted once); D3 excluded
    assert t["exceptions_open"]==2, t     # S1 control + group control; S3 excluded
    assert t["test_plans"]==1 and t["test_plans_complete"]==1, t
    by = {e["name"]: e for e in r["entities"]}
    assert by["Sub One"]["controls_owned"]==1 and by["Sub One"]["group_controls_relied_on"]==1
    assert by["Sub Two"]["controls_owned"]==1 and by["Sub Two"]["group_controls_relied_on"]==1
    assert by["Sub Two"]["deficiencies_open"]==1 and by["Sub One"]["deficiencies_open"]==1
    assert by["Sub Three"]["included"] is False and by["Group Parent"]["included"] is True
    # property: totals are exactly the sum of disjoint buckets
    g = r["group_level"]
    for k_total,k_ent,k_grp in [("controls","controls_owned","controls"),("deficiencies_open","deficiencies_open","deficiencies_open"),
                                ("exceptions_open","exceptions_open","exceptions_open"),("test_plans","test_plans","test_plans")]:
        assert t[k_total] == g[k_grp] + sum(e[k_ent] for e in r["entities"] if e["included"]), k_total
    S["rollup"] = r

@test("9b. Roll-up reacts to approval state: un-approve S2 and its records leave the totals")
def _():
    as_user("ctrl")
    run("update subsidiary_questionnaires set status='reopened', review_note='Reopened for restatement' where id=%s",(S["q2"],))
    as_user("ia")
    t = q("select p2_group_rollup(%s,%s)",(orgA,perA))[0][0]["totals"]
    assert t["entities_included"]==2 and t["controls"]==3 and t["deficiencies_open"]==3, t   # E2 and D4 drop out
    as_user("ia"); run("update subsidiary_questionnaires set status='prepared' where id=%s",(S["q2"],))
    run("update subsidiary_questionnaires set status='submitted' where id=%s",(S["q2"],))
    as_user("ctrl"); run("update subsidiary_questionnaires set status='approved', group_review_status='accepted' where id=%s",(S["q2"],))

@test("14. Group conclusion: snapshot links to entity records; only controller/CFO approves; submitter cannot")
def _():
    as_user("ia")
    snap = q("select p2_group_rollup(%s,%s)",(orgA,perA))[0][0]
    sid = q("insert into group_icfr_summaries(organization_id,reporting_period_id,snapshot) values (%s,%s,%s) returning id",(orgA,perA,json.dumps(snap)))[0][0]
    S["gs"] = sid
    ids = [e["questionnaire_id"] for e in snap["entities"] if e["included"] and e["questionnaire_id"]]
    assert set(map(str,ids)) == {str(S["q1"]),str(S["q2"])}      # conclusion links to the underlying entity questionnaires
    expect_fail("update group_icfr_summaries set status='approved' where id=%s",(sid,),"Illegal transition")
    run("update group_icfr_summaries set status='prepared' where id=%s",(sid,))
    expect_fail("update group_icfr_summaries set status='submitted' where id=%s",(sid,),"group conclusion")
    run("update group_icfr_summaries set conclusion='Group ICFR is operating effectively subject to the ERP access-review follow-up at Sub One.' where id=%s",(sid,))
    run("update group_icfr_summaries set status='submitted' where id=%s",(sid,))
    expect_fail("update group_icfr_summaries set status='approved' where id=%s",(sid,),"Only a controller")
    as_user("cfo")
    expect_fail("update group_icfr_summaries set status='approved', conclusion='changed during approval' where id=%s",(sid,),"Content cannot change")
    run("update group_icfr_summaries set status='approved' where id=%s",(sid,))
    assert q("select status from group_icfr_summaries where id=%s",(sid,))[0][0]=="approved"
    as_user("owner")
    s2 = q("insert into group_icfr_summaries(organization_id,reporting_period_id,conclusion) values (%s,%s,'A conclusion that is long enough to pass.') returning id",(orgA,perA))[0][0]
    run("update group_icfr_summaries set status='prepared' where id=%s",(s2,)); run("update group_icfr_summaries set status='submitted' where id=%s",(s2,))
    expect_fail("update group_icfr_summaries set status='approved' where id=%s",(s2,),"submitter cannot approve")

@test("13. External auditor/viewer: approved group summaries + approved entity questionnaires only")
def _():
    for who in ("ext","view"):
        as_user(who)
        assert [str(i) for (i,) in q("select id from group_icfr_summaries")]==[S["gs"]], who
        assert {str(i) for (i,) in q("select id from subsidiary_questionnaires")}=={S["q1"],S["q2"]}, who   # S3 draft invisible
        assert q("select count(*) from subsidiary_questionnaire_responses where questionnaire_id=%s",(S["q3"],))[0][0]==0
        assert q("select count(*) from subsidiary_questionnaire_responses")[0][0]==6
        assert q("select count(*) from entity_controls")[0][0]==0 and q("select count(*) from entity_processes")[0][0]==0
        assert q("select count(*) from follow_ups")[0][0]==0
        expect_fail("insert into group_icfr_summaries(organization_id,reporting_period_id) values (%s,%s)",(orgA,perA),"row-level security")
    as_user("ext")
    as_user("ctrl")
    run("update subsidiary_questionnaires set status='reopened', review_note='Second reopening: external visibility check' where id=%s",(S["q2"],))
    as_user("ext")
    assert {str(i) for (i,) in q("select id from subsidiary_questionnaires")}=={S["q1"]}, "reopened questionnaire must disappear from external view"
    as_user("ia"); run("update subsidiary_questionnaires set status='prepared' where id=%s",(S["q2"],)); run("update subsidiary_questionnaires set status='submitted' where id=%s",(S["q2"],))
    as_user("ctrl"); run("update subsidiary_questionnaires set status='approved', group_review_status='accepted' where id=%s",(S["q2"],))

@test("Integrity: entities with reviewed questionnaires cannot be deleted; approved/submitted records cannot be deleted")
def _():
    as_user("owner")
    expect_fail("delete from entities where id=%s",(S["S1"],),"set it inactive")
    expect_fail("delete from subsidiary_questionnaires where id=%s",(S["q1"],),"Only draft records")
    run("delete from group_icfr_summaries where id=%s",(S["gs"],))      # no delete policy exists: silently a no-op
    as_super(); assert q("select count(*) from group_icfr_summaries where id=%s",(S["gs"],))[0][0]==1
    as_user("owner")
    run("delete from subsidiary_questionnaires where id=%s",(S["q3"],))      # draft: allowed (audit-logged)
    as_user("ia"); run("update entities set status='inactive' where id=%s",(S["S3"],))
    t = q("select p2_group_rollup(%s,%s)",(orgA,perA))[0][0]["totals"]; assert t["entities_in_scope"]==3, t   # inactive entities leave scope

@test("16. Tenant B cannot see or touch tenant A group records")
def _():
    as_user("ia_b")
    for t in ["entities","entity_processes","entity_controls","subsidiary_questionnaires","subsidiary_questionnaire_responses","group_icfr_summaries","processes"]:
        assert q(f"select count(*) from {t} where organization_id=%s",(orgA,))[0][0]==0, t
    expect_fail("insert into entities(organization_id,name) values (%s,'intruder')",(orgA,))
    expect_fail("insert into entity_controls(organization_id,entity_id,control_id) values (%s,%s,%s)",(orgB,S["S1"],ctlB),"Cross-tenant")
    r = q("select p2_group_rollup(%s,%s)",(orgA,perA))[0][0]
    assert r["totals"]["entities_in_scope"]==0, r["totals"]       # roll-up runs under RLS: nothing leaks

@test("15. Every create, edit, submission, approval and status change is audit-logged with actor")
def _():
    as_super()
    def cnt(et, ac): return q("select count(*) from audit_log where organization_id=%s and entity_type=%s and action=%s",(orgA,et,ac))[0][0]
    for et,ac,mn in [("entities","created",4),("entities","updated",2),("entities","status_changed",1),("entity_controls","created",3),("entity_processes","created",1),
                     ("subsidiary_questionnaires","created",3),("subsidiary_questionnaires","status_changed",14),
                     ("subsidiary_questionnaire_responses","created",6),("group_icfr_summaries","created",2),
                     ("group_icfr_summaries","status_changed",5),("subsidiary_questionnaires","deleted",1)]:
        c = cnt(et,ac); assert c>=mn, f"{et}/{ac}: {c} < {mn}"
    r = q("select metadata->>'from', metadata->>'to', actor_id from audit_log where entity_type='subsidiary_questionnaires' and entity_id=%s and metadata->>'to'='approved' order by created_at limit 1",(S["q1"],))[0]
    assert r[0]=="submitted" and str(r[2])==users["cfo"], r

finish()
