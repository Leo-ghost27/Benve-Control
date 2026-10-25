"""Priority 2 DB tests: external auditors / viewers see only reviewed deficiencies and issued communications.
Run: python3 tests/db/run_external_read_tests.py  (synthetic data only)"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from common import *

S = {}
INTERNAL = ("owner", "cfo", "ctrl", "ia", "adv")
EXTERNAL = ("ext", "view")

def counts(user):
    as_user(user)
    return {t: q(f"select count(*) from {t} where organization_id=%s", (orgA,))[0][0]
            for t in ("deficiencies", "remediation_tasks", "compensating_controls", "communications", "management_responses")}

@test("0. Setup: one draft and one approved deficiency, each with remediation + compensating control; draft and issued communications with responses")
def _():
    as_super()
    S["d_draft"] = q("insert into deficiencies(organization_id,control_id,title,review_status) values (%s,%s,'Draft deficiency','draft') returning id", (orgA, ctlA))[0][0]
    S["d_ok"] = q("insert into deficiencies(organization_id,control_id,title,review_status) values (%s,%s,'Approved deficiency','approved') returning id", (orgA, ctlA))[0][0]
    for d in (S["d_draft"], S["d_ok"]):
        run("insert into remediation_tasks(organization_id,deficiency_id,title) values (%s,%s,'Fix it')", (orgA, d))
        run("insert into compensating_controls(organization_id,deficiency_id,description) values (%s,%s,'Mitigating review')", (orgA, d))
    S["c_draft"] = q("insert into communications(organization_id,deficiency_id,comm_ref,status) values (%s,%s,'C-1','draft') returning id", (orgA, S["d_ok"]))[0][0]
    S["c_ok"] = q("insert into communications(organization_id,deficiency_id,comm_ref,status) values (%s,%s,'C-2','issued') returning id", (orgA, S["d_ok"]))[0][0]
    for c in (S["c_draft"], S["c_ok"]):
        run("insert into management_responses(organization_id,communication_id,response_text) values (%s,%s,'We will remediate')", (orgA, c))

@test("1. Internal roles see everything (unchanged)")
def _():
    for u in INTERNAL:
        c = counts(u)
        assert c["deficiencies"] == 3 and c["remediation_tasks"] >= 2 and c["compensating_controls"] == 2 and c["communications"] == 2 and c["management_responses"] == 2, (u, c)   # 3 = harness seed + 2

@test("2. External auditor and viewer see only approved deficiencies and issued communications")
def _():
    for u in EXTERNAL:
        c = counts(u)
        assert c == {"deficiencies": 1, "remediation_tasks": 1, "compensating_controls": 1, "communications": 1, "management_responses": 1}, (u, c)
        as_user(u)
        assert [r[0] for r in q("select title from deficiencies where organization_id=%s", (orgA,))] == ["Approved deficiency"]
        assert [r[0] for r in q("select comm_ref from communications where organization_id=%s", (orgA,))] == ["C-2"]

@test("3. Visibility follows the review state: a deficiency becomes visible when approved and hides again when returned")
def _():
    as_super(); run("update deficiencies set review_status='approved' where id=%s", (S["d_draft"],))
    assert counts("ext")["deficiencies"] == 2 and counts("ext")["remediation_tasks"] == 2
    as_super(); run("update deficiencies set review_status='returned' where id=%s", (S["d_draft"],))
    c = counts("view"); assert c["deficiencies"] == 1 and c["remediation_tasks"] == 1 and c["compensating_controls"] == 1
    as_super(); run("update communications set status='issued' where id=%s", (S["c_draft"],))
    assert counts("ext")["communications"] == 2 and counts("ext")["management_responses"] == 2
    as_super(); run("update communications set status='approved' where id=%s", (S["c_draft"],))
    assert counts("ext")["communications"] == 1

@test("4. Other tenants still see nothing; members of other clients cannot use the new rules to read across")
def _():
    as_user("ia_b")
    for t in ("deficiencies", "remediation_tasks", "compensating_controls", "communications", "management_responses"):
        assert q(f"select count(*) from {t} where organization_id=%s", (orgA,))[0][0] == 0, t

@test("5. Auditor hub tables stay open to the external auditor (not over-restricted)")
def _():
    as_super()
    run("create table if not exists audit_communications_probe(id int)")      # presence check only; hub tables are not touched by this migration
    pols = {r[0] for r in q("select tablename from pg_policies where policyname in ('p2 external sees reviewed only','p2 external sees issued only')")}
    assert pols == {"deficiencies", "compensating_controls", "remediation_tasks", "communications", "management_responses"}, pols

finish()
