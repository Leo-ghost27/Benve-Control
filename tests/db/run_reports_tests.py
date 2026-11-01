"""Module 5 (reporting and governance packs) DB acceptance tests. Run: python3 tests/db/run_reports_tests.py

Seeds a synthetic client A (with real alerts, follow-ups, readiness, entities, controls, deficiencies,
remediation, ITGC, evidence) and a separate client B, then exercises the pack workflow with ordinary
(authenticated) credentials. Engine/seed writes use the superuser; what is under test is the reporting layer."""
import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
SECRET_NOTE, SECRET_FP, SECRET_FILE, SECRET_COMMENT = "SECRET-INTERNAL-NOTE", "SECRET-FP-REASON", "secret-evidence-name.pdf", "SECRET-COMMENT"

def denied(sql, params=None):
    """An ordinary user's write must either raise or change zero rows (RLS with no write policy filters silently)."""
    try: cur.execute(sql, params)
    except psycopg2.Error: return
    assert cur.rowcount == 0, f"write was not denied: {sql[:80]}"

def metric(snap, section, key):
    sec = next(s for s in snap["sections"] if s["section"] == section)
    return next(m for m in sec["metrics"] if m["key"] == key)
def count(snap, section, key): return metric(snap, section, key)["count"]
def compute(user, typ="governance_pack", entity=None, org=None, period=None):
    as_user(user)
    r = q("select p2_report_compute(%s,%s,%s,%s)", (org or orgA, period or perA, typ, entity))[0][0]
    as_super(); return r if isinstance(r, dict) else json.loads(r)
def pack(pid, col="snapshot"):
    as_super(); r = q(f"select {col} from report_packs where id=%s", (pid,))[0][0]
    return r if not isinstance(r, str) or col != "snapshot" else json.loads(r)

# ---------------- seed (superuser) ----------------
ctl2, ctl3 = uid(), uid()
run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'C-2','n','Ctl 2'),(%s,%s,'C-3','n','Ctl 3')", (ctl2, orgA, ctl3, orgA))
E1, E2 = uid(), uid()
run("insert into entities(id,organization_id,name,in_scope) values (%s,%s,'Entity One',true),(%s,%s,'Entity Two',true)", (E1, orgA, E2, orgA))
E_B = uid(); run("insert into entities(id,organization_id,name,in_scope) values (%s,%s,'B Entity',true)", (E_B, orgB))
# ctlA shared by both entities; ctl2 local to E1; ctl3 local to E2  => 3 unique definitions, 4 instances
for e, c_ in [(E1, ctlA), (E2, ctlA), (E1, ctl2), (E2, ctl3)]:
    run("insert into entity_controls(organization_id,entity_id,control_id,reliance_type,status) values (%s,%s,%s,'entity_level','active')", (orgA, e, c_))
# deficiencies: open in period, remediated in period, resolved BEFORE period (excluded), low severity (must not be excluded)
run("update deficiencies set identified_at='2026-08-15', severity='low', title='Open low-severity def' where id=%s", (defA,))
defR, defOld = uid(), uid()
run("insert into deficiencies(id,organization_id,control_id,title,severity,status,identified_at,resolved_at) values (%s,%s,%s,'Remediated in period','high','closed','2026-07-10','2026-09-01')", (defR, orgA, ctl2))
run("insert into deficiencies(id,organization_id,control_id,title,severity,status,identified_at,resolved_at) values (%s,%s,%s,'Resolved before period','medium','closed','2026-01-10','2026-05-01')", (defOld, orgA, ctl3))
run("insert into remediation_tasks(organization_id,deficiency_id,title,status,due_date,retest_result) values (%s,%s,'Fix A','in_progress',current_date - 5,null)", (orgA, defA))
run("insert into remediation_tasks(organization_id,deficiency_id,title,status,due_date,retest_result) values (%s,%s,'Fix R','complete',current_date - 50,'Reperformed, no exceptions')", (orgA, defR))
run("insert into remediation_tasks(organization_id,deficiency_id,title,status,due_date) values (%s,%s,'Fix R2','complete',current_date - 20)", (orgA, defR))
# CCM alerts: old unresolved (100d), investigating, false positive with secret rationale, closed; plus a client-B alert
run("""insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,investigation_notes,source_type)
       values (%s,%s,%s,'ALR-1','open','high',now() - interval '100 days','Old open alert',%s,'manual')""", (orgA, perA, ctlA, SECRET_NOTE))
run("""insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,source_type)
       values (%s,%s,%s,'ALR-2','in_investigation','medium',now() - interval '10 days','Investigating','manual')""", (orgA, perA, ctlA))
run("""insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,false_positive_reason,source_type)
       values (%s,%s,%s,'ALR-3','false_positive','low',now() - interval '5 days','Dup',%s,'manual')""", (orgA, perA, ctlA, SECRET_FP))
run("insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,source_type) values (%s,%s,%s,'ALR-4','closed','low',now(),'Closed','manual')", (orgA, perA, ctlA))
run("insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,source_type) values (%s,%s,%s,'ALR-B1','open','high',now(),'TENANT B ALERT','manual')", (orgB, perB, ctlB))
alr1 = q("select id from ccm_exceptions where exception_ref='ALR-1' and organization_id=%s", (orgA,))[0][0]
run("insert into follow_ups(organization_id,followup_ref,ccm_exception_id,description,status,due_date) values (%s,'FU-1',%s,'Overdue 40 days','open',current_date - 40)", (orgA, alr1))
run("insert into follow_ups(organization_id,followup_ref,ccm_exception_id,description,status,due_date) values (%s,'FU-2',%s,'Not yet due','in_progress',current_date + 10)", (orgA, alr1))
run("insert into follow_ups(organization_id,followup_ref,ccm_exception_id,description,status,due_date) values (%s,'FU-3',%s,'Done','closed',current_date - 3)", (orgA, alr1))
# Readiness: 1 assessment, 4 checklist items (2 unanswered, 1 complete w/ evidence, 1 complete w/o), 2 gaps
asm = uid(); run("insert into readiness_assessments(id,organization_id,reporting_period_id,target_milestone,status,overall_score) values (%s,%s,%s,'S-1 readiness','draft',62.5)", (asm, orgA, perA))
for it, st, ev in [("Item A", "not_started", None), ("Item B", "not_started", None), ("Item C", "complete", evA), ("Item D", "complete", None)]:
    run("insert into readiness_checklist_items(organization_id,assessment_id,item,status,evidence_id) values (%s,%s,%s,%s,%s)", (orgA, asm, it, st, ev))
gapH, gapL = uid(), uid()
run("insert into readiness_gaps(id,organization_id,readiness_assessment_id,description,gap_severity,status,target_date) values (%s,%s,%s,'High gap, past target','high','draft',current_date - 10)", (gapH, orgA, asm))
run("insert into readiness_gaps(id,organization_id,readiness_assessment_id,description,gap_severity,status,target_date,owner_user_id) values (%s,%s,%s,'Low gap','low','draft',current_date + 30,%s)", (gapL, orgA, asm, users["ctrl"]))
run("insert into readiness_roadmap_actions(organization_id,gap_id,description,status,target_date) values (%s,%s,'Late action','in_progress',current_date - 4)", (orgA, gapH))
# Questionnaires: E1 submitted, E2 none
run("insert into subsidiary_questionnaires(organization_id,entity_id,period,status,reporting_period_id) values (%s,%s,'Q3','draft',%s)", (orgA, E1, perA))
run("alter table subsidiary_questionnaires disable trigger user")      # seed a mid-workflow state directly (workflow itself is covered by the group suite)
run("update subsidiary_questionnaires set status='submitted', group_review_status='in_review', submitted_at=now() - interval '3 days' where organization_id=%s", (orgA,))
run("alter table subsidiary_questionnaires enable trigger user")
# Test plan final with evidence on a step, plan without evidence
tpF, tpN = uid(), uid()
run("insert into test_plans(id,organization_id,control_id,name,status,reporting_period_id) values (%s,%s,%s,'Plan with evidence','final',%s),(%s,%s,%s,'Plan no evidence','in_progress',%s)", (tpF, orgA, ctlA, perA, tpN, orgA, ctl2, perA))
tsF = uid(); run("insert into test_steps(id,organization_id,test_plan_id,step_number,description) values (%s,%s,%s,1,'step')", (tsF, orgA, tpF))
run("insert into test_step_evidence(organization_id,test_step_id,evidence_id) values (%s,%s,%s)", (orgA, tsF, evA))
run("update evidence set file_name=%s where id=%s", (SECRET_FILE, evA))
# ITGC: one in-scope high system with a gap profile, dependency
sysA = uid(); run("insert into itgc_systems(id,organization_id,name,system_type,in_scope,financial_reporting_relevance) values (%s,%s,'ERP','erp',true,'high')", (sysA, orgA))
run("insert into control_system_dependencies(organization_id,control_id,system_id,dependency_type) values (%s,%s,%s,'automated_control')", (orgA, ctlA, sysA))
# Evidence requests: accepted, sent (overdue), rejected
for st, due in [("accepted", "current_date - 20"), ("sent", "current_date - 7"), ("rejected", "current_date + 5")]:
    run(f"insert into evidence_requests(organization_id,control_id,title,status,due_date) values (%s,%s,%s,%s,{due})", (orgA, ctlA, f"Request {st}", st))
# Internal comment that must never appear in a pack
run("insert into workpaper_comments(organization_id,target_type,target_id,visibility,body) values (%s,'ccm_exception',%s,'internal',%s)", (orgA, alr1, SECRET_COMMENT))
# Review authority: adviser Dana holds explicit review.approve; controller does NOT.
run("insert into engagement_permissions(organization_id,user_id,permission) values (%s,%s,'review.approve')", (orgA, users["adv"]))

# ---------------- tests ----------------
@test("1. Governance pack generates from real records as a draft with metadata and an integrity hash")
def _():
    as_user("ia")
    S["p1"] = q("select p2_report_generate(%s,%s,'governance_pack',null)", (orgA, perA))[0][0]
    as_super()
    status, ver, h = q("select status, version, snapshot_hash from report_packs where id=%s", (S["p1"],))[0]
    assert (status, ver) == ("draft", 1)
    assert h == q("select p2_report_hash(%s)", (S["p1"],))[0][0] and len(h) == 64
    snap = pack(S["p1"]); S["snap1"] = snap
    assert len(snap["sections"]) == 8
    m = snap["meta"]
    assert m["client"] == "A" and m["reporting_period"] == "2026-Q3" and m["generated_by"] == "ia@x.test" and m["pack_version"] == 1 and m["generated_at"]

@test("2. Every dashboard count reconciles to the records behind it (no count without records)")
def _():
    snap = S["snap1"]; checked = 0
    for sec in snap["sections"]:
        for m in sec["metrics"]:
            assert m["basis"], f"{m['key']} has no counting basis"
            if not m["truncated"]: assert m["count"] == len(m["records"]), f"{sec['section']}.{m['key']}: count {m['count']} != {len(m['records'])} records"
            checked += 1
    assert checked > 100, checked

@test("3. CCM counts and aging match the seeded alerts and follow-ups")
def _():
    s = S["snap1"]
    assert count(s, "ccm_aging", "alerts_total") == 4
    assert count(s, "ccm_aging", "alerts_open") == 1 and count(s, "ccm_aging", "alerts_false_positive") == 1 and count(s, "ccm_aging", "alerts_closed") == 1
    assert count(s, "ccm_aging", "alerts_open_unassigned") == 2          # open + in_investigation, both unassigned
    assert count(s, "ccm_aging", "alerts_age_91_plus") == 1 and count(s, "ccm_aging", "alerts_age_0_30") == 1
    assert count(s, "ccm_aging", "followups_total") == 3 and count(s, "ccm_aging", "followups_open") == 2 and count(s, "ccm_aging", "followups_closed") == 1
    assert count(s, "ccm_aging", "followups_overdue") == 1 and count(s, "ccm_aging", "followups_overdue_31_60") == 1 and count(s, "ccm_aging", "followups_not_overdue") == 1
    assert "TENANT B" not in json.dumps(s)

@test("4. Readiness: unanswered is distinct from failed/complete; planning score is not a determination")
def _():
    s = S["snap1"]
    assert count(s, "evidence", "chk_unanswered") == 2 and count(s, "evidence", "chk_complete_evidence") == 1 and count(s, "evidence", "chk_complete_no_evidence") == 1
    assert count(s, "readiness", "gaps_total") == 2 and count(s, "readiness", "gaps_sev_high") == 1 and count(s, "readiness", "gaps_past_target") == 1
    assert count(s, "readiness", "gaps_unowned") == 1 and count(s, "readiness", "road_overdue") == 1 and count(s, "readiness", "asm_draft") == 1
    notes = " ".join(next(x for x in s["sections"] if x["section"] == "readiness")["notes"]).lower()
    assert "not a legal determination" in notes and "never inferred" in notes
    assert metric(s, "readiness", "asm_total")["records"][0]["detail"] == "planning score 62.5"

@test("5. Group roll-up keeps unique control definitions and entity-control instances separate (no double-counting)")
def _():
    s = S["snap1"]
    u, i = count(s, "group_coverage", "defs_unique"), count(s, "group_coverage", "instances")
    assert (u, i) == (3, 4), (u, i)
    assert count(s, "group_coverage", "defs_shared") == 1 and count(s, "group_coverage", "defs_local") == 2 and count(s, "group_coverage", "instances_of_shared") == 2
    assert count(s, "group_coverage", "defs_shared") + count(s, "group_coverage", "defs_local") == u
    assert "INSTANCES" in metric(s, "group_coverage", "instances")["basis"] and "DISTINCT" in metric(s, "group_coverage", "defs_unique")["basis"]
    assert count(s, "group_coverage", "tested_final") == 1 and count(s, "group_coverage", "tested_in_progress") == 1 and count(s, "group_coverage", "not_tested") == 1
    # entity filter: E1 has ctlA (shared) + ctl2 (local); shared is still recognised as shared
    e = compute("ia", "group_coverage", E1)
    assert count(e, "group_coverage", "defs_unique") == 2 and count(e, "group_coverage", "instances") == 2 and count(e, "group_coverage", "defs_shared") == 1
    assert e["filter_notes"] == [] and compute("ia", "governance_pack", E1)["filter_notes"]

@test("6. Deficiencies: low severity and remediated-in-period items are included; resolved-before-period is excluded")
def _():
    s = S["snap1"]
    refs = [r["ref"] for r in metric(s, "group_coverage", "def_relevant")["records"]]
    assert sorted(refs) == ["Open low-severity def", "Remediated in period"], refs
    assert count(s, "group_coverage", "def_open") == 1 and count(s, "group_coverage", "def_remediated") == 1
    assert count(s, "remediation", "def_relevant") == 2 and count(s, "remediation", "def_no_task") == 0

@test("7. Remediation and retest counts; retest outcome is not judged")
def _():
    s = S["snap1"]
    assert count(s, "remediation", "task_total") == 3 and count(s, "remediation", "task_complete") == 2 and count(s, "remediation", "task_overdue") == 1
    assert count(s, "remediation", "task_not_retested") == 1 and count(s, "remediation", "task_retest_recorded") == 1
    assert "does not judge" in metric(s, "remediation", "task_retest_recorded")["basis"]

@test("8. Questionnaire status distinguishes workflow from group review, and lists entities with none")
def _():
    s = S["snap1"]
    assert count(s, "questionnaires", "q_submitted") == 1 and count(s, "questionnaires", "qr_in_review") == 1
    assert count(s, "questionnaires", "entities_in_scope") == 2 and count(s, "questionnaires", "entities_without_questionnaire") == 1
    assert metric(s, "questionnaires", "entities_without_questionnaire")["records"][0]["ref"] == "Entity Two"

@test("9. ITGC section reports inventory gaps and states its limits")
def _():
    s = S["snap1"]
    assert count(s, "itgc", "systems_in_scope") == 1 and count(s, "itgc", "dependencies") == 1 and count(s, "itgc", "gap_no_itgc") == 1
    notes = " ".join(next(x for x in s["sections"] if x["section"] == "itgc")["notes"])
    assert "point-in-time" in notes and "not yet tracked as separate records" in notes and "reliance decision" in notes

@test("10. Evidence completeness uses documented requirements only and never lists file names")
def _():
    s = S["snap1"]
    assert count(s, "evidence", "req_total") == 3 and count(s, "evidence", "req_accepted") == 1 and count(s, "evidence", "req_outstanding") == 1
    assert count(s, "evidence", "req_overdue") == 1 and count(s, "evidence", "req_rejected") == 1
    assert count(s, "evidence", "plans_final_evidence") == 1 and count(s, "evidence", "plans_final_no_evidence") == 0
    assert SECRET_FILE not in json.dumps(s)

@test("11. Internal notes, false-positive rationales and internal comments never enter a pack")
def _():
    blob = json.dumps(S["snap1"])
    for secret in (SECRET_NOTE, SECRET_FP, SECRET_COMMENT, SECRET_FILE): assert secret not in blob, secret

@test("12. Client isolation: another client's user, wrong-client period/entity, and cross-tenant arguments are rejected")
def _():
    as_user("ia_b")
    expect_fail("select p2_report_compute(%s,%s,'ccm_aging',null)", (orgA, perA), "not permitted")
    expect_fail("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA), "only an owner")
    assert q("select count(*) from report_packs")[0][0] == 0            # RLS: B user sees none of A's packs
    as_user("ia")
    expect_fail("select p2_report_compute(%s,%s,'ccm_aging',null)", (orgA, perB), "does not belong")
    expect_fail("select p2_report_compute(%s,%s,'ccm_aging',%s)", (orgA, perA, E_B), "does not belong")
    expect_fail("select p2_report_generate(%s,%s,'ccm_aging',%s)", (orgA, perA, E_B), "does not belong")
    expect_fail("select p2_report_compute(%s,%s,'drop_tables',null)", (orgA, perA), "unknown report type")
    as_user("ia_b"); S["pB"] = q("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgB, perB))[0][0]; as_super()
    assert "ALR-B1" in json.dumps(pack(S["pB"])) and "ALR-1" not in json.dumps(pack(S["pB"]))
    as_user("ia"); assert q("select count(*) from report_packs where id=%s", (S["pB"],))[0][0] == 0

@test("13. Roles: external auditor and viewer cannot compute or generate; adviser can read but not generate")
def _():
    for u in ("ext", "view"):
        as_user(u)
        expect_fail("select p2_report_compute(%s,%s,'ccm_aging',null)", (orgA, perA), "not permitted")
        expect_fail("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA), "only an owner")
        assert q("select count(*) from report_packs")[0][0] == 0
    as_user("adv"); q("select p2_report_compute(%s,%s,'ccm_aging',null)", (orgA, perA))
    expect_fail("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA), "only an owner")
    as_user("ctrl"); expect_fail("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA), "only an owner")

@test("14. Packs cannot be written directly; snapshots are immutable even for the superuser")
def _():
    as_user("ia")
    expect_fail("insert into report_packs(organization_id,reporting_period_id,pack_type,title,version,as_of,snapshot,snapshot_hash) values (%s,%s,'ccm_aging','x',9,now(),'{}','h')", (orgA, perA), "only through the generate function")
    denied("update report_packs set status='approved' where id=%s", (S["p1"],))
    denied("update report_packs set snapshot='{}' where id=%s", (S["p1"],))
    denied("update report_packs set shared_with_external=true where id=%s", (S["p1"],))
    denied("delete from report_packs where id=%s", (S["p1"],))
    as_super()
    assert q("select status, shared_with_external, snapshot_hash = p2_report_hash(id) from report_packs where id=%s", (S["p1"],))[0] == ("draft", False, True)
    expect_fail("update report_packs set snapshot='{\"x\":1}' where id=%s", (S["p1"],), "immutable")
    expect_fail("update report_packs set status='approved' where id=%s", (S["p1"],), "illegal report transition")

@test("15. Submit requires a generator role and verifies the stored hash (tampering is detected)")
def _():
    as_user("ctrl"); expect_fail("select p2_report_submit(%s)", (S["p1"],), "not permitted")
    as_super()
    run("alter table report_packs disable trigger report_packs_guard")
    try:
        run("update report_packs set snapshot = jsonb_set(snapshot, '{meta,client}', '\"Tampered\"') where id=%s", (S["p1"],))
        as_user("ia"); expect_fail("select p2_report_submit(%s)", (S["p1"],), "integrity")
        as_super(); run("update report_packs set snapshot = jsonb_set(snapshot, '{meta,client}', '\"A\"') where id=%s", (S["p1"],))
    finally: run("alter table report_packs enable trigger report_packs_guard")
    as_user("ia"); S["hash1"] = q("select p2_report_submit(%s)", (S["p1"],))[0][0]; as_super()
    assert q("select status from report_packs where id=%s", (S["p1"],))[0][0] == "submitted"
    as_user("ia"); expect_fail("select p2_report_submit(%s)", (S["p1"],), "only a draft")

@test("16. Approval needs explicit review authority, a separate reviewer, and the exact reviewed hash")
def _():
    as_user("ctrl"); expect_fail("select p2_report_decide(%s,'approved',null,%s)", (S["p1"], S["hash1"]), "explicitly assigned")
    as_user("cfo");  expect_fail("select p2_report_decide(%s,'approved',null,%s)", (S["p1"], S["hash1"]), "explicitly assigned")
    as_user("ext");  expect_fail("select p2_report_decide(%s,'approved',null,%s)", (S["p1"], S["hash1"]), "explicitly assigned")
    as_user("adv")
    expect_fail("select p2_report_decide(%s,'approved',null,%s)", (S["p1"], "0" * 64), "not the version you reviewed")
    expect_fail("select p2_report_decide(%s,'maybe',null,%s)", (S["p1"], S["hash1"]), "approved or returned")
    expect_fail("select p2_report_decide(%s,'returned','no',%s)", (S["p1"], S["hash1"]), "comment is required")
    run("select p2_report_decide(%s,'approved','Reviewed counts to source records',%s)", (S["p1"], S["hash1"]))
    as_super()
    assert q("select status, decided_by from report_packs where id=%s", (S["p1"],))[0] == ("approved", users["adv"])

@test("17. A preparer cannot approve their own pack while separation is required; it can when the engagement turns it off")
def _():
    as_super(); run("insert into engagement_permissions(organization_id,user_id,permission) values (%s,%s,'review.approve') on conflict do nothing", (orgA, users["ia"]))
    as_user("ia"); S["p_self"] = q("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA))[0][0]
    h = q("select p2_report_submit(%s)", (S["p_self"],))[0][0]
    expect_fail("select p2_report_decide(%s,'approved','self approval attempt',%s)", (S["p_self"], h), "separate reviewer")
    as_super(); run("insert into engagement_review_settings(organization_id,require_separate_review) values (%s,false) on conflict (organization_id) do update set require_separate_review=false", (orgA,))
    as_user("ia"); run("select p2_report_decide(%s,'approved','Separation switched off for this engagement',%s)", (S["p_self"], h))
    as_super(); run("update engagement_review_settings set require_separate_review=true where organization_id=%s", (orgA,))
    run("delete from engagement_permissions where organization_id=%s and user_id=%s", (orgA, users["ia"]))
    assert q("select status from report_packs where id=%s", (S["p_self"],))[0][0] == "approved"

@test("18. Returned packs need a comment, cannot be resubmitted, and can be archived with a reason; approved packs cannot be archived")
def _():
    as_user("ia"); p = q("select p2_report_generate(%s,%s,'remediation',null)", (orgA, perA))[0][0]
    h = q("select p2_report_submit(%s)", (p,))[0][0]
    as_user("adv"); run("select p2_report_decide(%s,'returned','Retest counts look incomplete, please re-run',%s)", (p, h))
    as_user("ia")
    expect_fail("select p2_report_submit(%s)", (p,), "only a draft")
    expect_fail("select p2_report_archive(%s,'x')", (p,), "reason is required")
    run("select p2_report_archive(%s,'Superseded by corrected data; regenerating')", (p,))
    expect_fail("select p2_report_archive(%s,'trying to remove approved report')", (S["p1"],), "approved packs are retained")
    as_super(); assert q("select status from report_packs where id=%s", (p,))[0][0] == "archived"

@test("19. Approved snapshot is preserved when live records change; a new version supersedes it only on approval")
def _():
    before = pack(S["p1"]); hash_before = q("select snapshot_hash from report_packs where id=%s", (S["p1"],))[0][0]
    run("""insert into ccm_exceptions(organization_id,reporting_period_id,control_id,exception_ref,status,severity,detected_at,description,source_type)
           values (%s,%s,%s,'ALR-5','open','medium',now(),'New after approval','manual')""", (orgA, perA, ctlA))
    live = compute("ia", "ccm_aging")
    assert count(live, "ccm_aging", "alerts_total") == 5                      # live moved on
    after = pack(S["p1"])
    assert after == before and count(after, "ccm_aging", "alerts_total") == 4  # approved snapshot did not
    assert q("select p2_report_hash(%s), snapshot_hash from report_packs where id=%s", (S["p1"], S["p1"]))[0] == (hash_before, hash_before)
    as_user("ia"); S["p2"] = q("select p2_report_generate(%s,%s,'governance_pack',null)", (orgA, perA))[0][0]
    as_super(); assert q("select version, status from report_packs where id=%s", (S["p2"],))[0] == (2, "draft")
    assert q("select status from report_packs where id=%s", (S["p1"],))[0][0] == "approved"   # still approved until v2 is approved
    as_user("ia"); h2 = q("select p2_report_submit(%s)", (S["p2"],))[0][0]
    as_user("adv"); run("select p2_report_decide(%s,'approved','v2 reviewed against records',%s)", (S["p2"], h2))
    as_super()
    assert q("select status from report_packs where id=%s", (S["p1"],))[0][0] == "superseded"
    assert q("select status from report_packs where id=%s", (S["p2"],))[0][0] == "approved"
    assert count(pack(S["p2"]), "ccm_aging", "alerts_total") == 5 and count(pack(S["p1"]), "ccm_aging", "alerts_total") == 4

@test("20. External sharing is explicit: approved only, rationale required, visible only after sharing, hidden once superseded")
def _():
    as_user("ext"); assert q("select count(*) from report_packs")[0][0] == 0                     # approved but not shared
    as_user("ia"); expect_fail("select p2_report_share(%s,true,'Sharing with the external auditor')", (S["p2"],), "not permitted")
    as_user("ia"); pd = q("select p2_report_generate(%s,%s,'ccm_aging',null)", (orgA, perA))[0][0]
    as_user("adv")
    expect_fail("select p2_report_share(%s,true,'short')", (S["p2"],), "rationale")
    expect_fail("select p2_report_share(%s,true,'Sharing a pack that is not approved')", (pd,), "only an approved pack")
    run("select p2_report_share(%s,true,'Auditor requested the Q3 governance pack')", (S["p2"],))
    for u in ("ext", "view"):
        as_user(u)
        assert [r[0] for r in q("select id::text from report_packs")] == [S["p2"]]
        expect_fail("select p2_report_share(%s,false,'revoke attempt by auditor')", (S["p2"],), "not permitted")
        expect_fail("select p2_report_decide(%s,'returned','external trying to return',%s)", (S["p2"], "x"), "explicitly assigned")
        expect_fail("select p2_report_compute(%s,%s,'ccm_aging',null)", (orgA, perA), "not permitted")
        blob = json.dumps(q("select snapshot from report_packs")[0][0])
        for secret in (SECRET_NOTE, SECRET_FP, SECRET_COMMENT, SECRET_FILE): assert secret not in blob
    as_user("adv"); run("select p2_report_share(%s,false,'Withdrawn pending corrections')", (S["p2"],))
    as_user("ext"); assert q("select count(*) from report_packs")[0][0] == 0
    as_user("adv"); run("select p2_report_share(%s,true,'Re-shared after corrections were reviewed')", (S["p2"],))
    # a newer approved version is NOT visible until it is shared; the old one disappears when superseded
    as_user("ia"); p3 = q("select p2_report_generate(%s,%s,'governance_pack',null)", (orgA, perA))[0][0]; h3 = q("select p2_report_submit(%s)", (p3,))[0][0]
    as_user("adv"); run("select p2_report_decide(%s,'approved','v3 approved',%s)", (p3, h3)); S["p3"] = p3
    as_user("ext"); assert q("select count(*) from report_packs")[0][0] == 0
    as_user("adv"); run("select p2_report_share(%s,true,'Auditor access to the latest approved version')", (p3,))
    as_user("ext"); assert [r[0] for r in q("select id::text from report_packs")] == [p3]

@test("21. Exports are logged; only readable packs can be exported")
def _():
    as_user("ext"); run("select p2_report_log_export(%s,'csv')", (S["p3"],)); expect_fail("select p2_report_log_export(%s,'csv')", (S["p1"],), "not permitted")
    as_user("ia_b"); expect_fail("select p2_report_log_export(%s,'csv')", (S["p3"],), "not permitted")
    as_user("ia"); run("select p2_report_log_export(%s,'print')", (S["p1"],))
    as_super()
    acts = {r[0] for r in q("select action from audit_log where entity_type='report_packs' and organization_id=%s", (orgA,))}
    assert {"created", "status_changed", "shared_external", "unshared_external", "exported"} <= acts, acts

@test("22. Audit events are protected from ordinary users and contain no report content")
def _():
    as_user("ia")
    n = q("select count(*) from audit_log where entity_type='report_packs'")[0][0]; assert n > 8
    for sql in ("update audit_log set action='edited' where entity_type='report_packs'", "delete from audit_log where entity_type='report_packs'"):
        try: cur.execute(sql); assert cur.rowcount == 0, "ordinary user changed audit rows"
        except psycopg2.Error: pass
    as_super()
    assert q("select count(*) from audit_log where entity_type='report_packs' and action='edited'")[0][0] == 0
    blob = json.dumps(q("select metadata from audit_log where entity_type='report_packs'"))
    for secret in (SECRET_NOTE, SECRET_FP, SECRET_COMMENT, SECRET_FILE, "ALR-1"): assert secret not in blob

@test("23. Review backlog reconciles: total equals the per-type rows and the age rows")
def _():
    as_user("ia"); pb = q("select p2_report_generate(%s,%s,'review_backlog',null)", (orgA, perA))[0][0]; q("select p2_report_submit(%s)", (pb,))
    as_user("ia"); live = q("select p2_report_compute(%s,%s,'review_backlog',null)", (orgA, perA))[0][0]; as_super()
    live = live if isinstance(live, dict) else json.loads(live)
    types = [m["key"] for m in live["sections"][0]["metrics"] if m["key"].startswith("backlog_") and not m["key"].startswith("backlog_age_") and m["key"] != "backlog_total"]
    total = count(live, "review_backlog", "backlog_total")
    ages = sum(count(live, "review_backlog", k) for k in ("backlog_age_0_30", "backlog_age_31_60", "backlog_age_61_90", "backlog_age_91_plus", "backlog_age_unknown"))
    assert total == sum(count(live, "review_backlog", k) for k in types) == ages and total >= 1
    assert count(live, "review_backlog", "backlog_report_pack") >= 1

@test("24. Packs for other types generate, reconcile, and a client's packs stay out of another client's list")
def _():
    for t in ("ccm_aging", "readiness", "questionnaires", "group_coverage", "itgc", "evidence", "review_backlog", "remediation"):
        s = compute("ia", t); assert len(s["sections"]) == 1 and s["sections"][0]["section"] == t
        for m in s["sections"][0]["metrics"]:
            if not m["truncated"]: assert m["count"] == len(m["records"]), (t, m["key"])
    as_user("ia_b"); assert q("select count(*) from report_packs where organization_id=%s", (orgA,))[0][0] == 0
    as_user("ia");   assert q("select count(*) from report_packs where organization_id=%s", (orgB,))[0][0] == 0

@test("25. Unique versioning per client/period/type/entity, and entity-filtered packs version independently")
def _():
    as_user("ia"); pe = q("select p2_report_generate(%s,%s,'group_coverage',%s)", (orgA, perA, E1))[0][0]; pa = q("select p2_report_generate(%s,%s,'group_coverage',null)", (orgA, perA))[0][0]; as_super()
    assert q("select version from report_packs where id=%s", (pe,))[0][0] == 1 and q("select version from report_packs where id=%s", (pa,))[0][0] == 1
    assert pack(pe)["meta"]["entity_name"] == "Entity One"

finish()
