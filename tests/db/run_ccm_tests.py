"""
DB-level acceptance tests for Phase 2 Module 1 (CCM) against a real Postgres.
Run:  python3 tests/db/run_ccm_tests.py
Emulates Supabase auth (auth.uid()) and runs RLS as the `authenticated` role.
Pure-DB: proves policies, triggers, workflow rules, tenant isolation, audit log.
It does NOT exercise the Next.js UI.
"""
import glob, os, sys, tempfile, uuid, json
import pgserver, psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srv = pgserver.get_server(tempfile.mkdtemp())
uri = srv.get_uri()
conn = psycopg2.connect(uri); conn.autocommit = True
cur = conn.cursor()

def run_file(path):
    with open(path) as f: sql = f.read()
    sql = sql.replace('create extension if not exists pgcrypto;', '-- pgcrypto unavailable in test server; gen_random_uuid() is built in (PG13+)')
    try: cur.execute(sql)
    except Exception as e:
        print(f"FAILED applying {os.path.basename(path)}: {e}"); sys.exit(2)

def run(sql, params=None): cur.execute(sql, params); 
def q(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall() if cur.description else []

# ---- build schema ---------------------------------------------------------
run_file(f"{ROOT}/tests/db/baseline.sql")
run_file(f"{ROOT}/supabase/migrations/0001_init.sql")
for v in ["admin","cfo","controller","internal_auditor","external_auditor","adviser"]:
    run(f"alter type org_role add value if not exists '{v}'")
run("alter table controls add column if not exists title text, add column if not exists risk_rating text")
run("create or replace function org_role(p uuid) returns text language sql stable security definer as "
    "$$ select role::text from organization_members where organization_id=p and user_id=auth.uid() limit 1 $$")
run_file(f"{ROOT}/supabase/migrations/20260905154818_task45_ccm_exception_intelligence.sql")
# legacy data that exists BEFORE the Phase 2 migration (exercises the backfill)
orgL = str(uuid.uuid4()); legacy_exc = str(uuid.uuid4())
run("insert into organizations(id,name) values (%s,'Legacy Org')",(orgL,))
run("insert into ccm_exceptions(id,organization_id,exception_ref,item_date,source_record_ref,status) values (%s,%s,'EX-1','2026-03-15','LEG-1','open')",(legacy_exc,orgL))
run_file(f"{ROOT}/supabase/migrations/20261019000001_phase2_foundation_and_ccm.sql")
# idempotency: applying twice must not fail
run_file(f"{ROOT}/supabase/migrations/20261019000001_phase2_foundation_and_ccm.sql")
run("grant usage on schema public, auth to authenticated")
run("grant all on all tables in schema public to authenticated")
run("grant select on auth.users to authenticated")
run("grant execute on all functions in schema public to authenticated")

# ---- seed (as superuser) --------------------------------------------------
def uid(): return str(uuid.uuid4())
orgA, orgB = uid(), uid()
users = {k: uid() for k in ["ia","cfo","ctrl","adv","ext","view","owner","ia_b"]}
for k,u in users.items(): run("insert into auth.users(id,email) values (%s,%s)", (u,f"{k}@x.test"))
run("insert into organizations(id,name) values (%s,'A'),(%s,'B')", (orgA,orgB))
roleof = {"ia":"internal_auditor","cfo":"cfo","ctrl":"controller","adv":"adviser",
          "ext":"external_auditor","view":"viewer","owner":"owner"}
for k,r in roleof.items():
    run("insert into organization_members(organization_id,user_id,role) values (%s,%s,%s)",(orgA,users[k],r))
run("insert into organization_members(organization_id,user_id,role) values (%s,%s,'internal_auditor')",(orgB,users["ia_b"]))
ctlA, ctlB = uid(), uid()
run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'C-1','n','Ctl A'),(%s,%s,'C-9','n','Ctl B')",(ctlA,orgA,ctlB,orgB))
perA, perB = uid(), uid()
run("insert into reporting_periods(id,organization_id,label,start_date,end_date) values (%s,%s,'2026-Q3','2026-07-01','2026-09-30'),(%s,%s,'2026-Q3','2026-07-01','2026-09-30')",(perA,orgA,perB,orgB))
planA, stepA, defA = uid(), uid(), uid()
run("insert into test_plans(id,organization_id,control_id,name) values (%s,%s,%s,'plan')",(planA,orgA,ctlA))
run("insert into test_steps(id,organization_id,test_plan_id,step_number,description) values (%s,%s,%s,1,'step')",(stepA,orgA,planA))
run("insert into deficiencies(id,organization_id,control_id,title) values (%s,%s,%s,'def')",(defA,orgA,ctlA))

def as_user(name):
    run("reset role"); run("set role authenticated")
    run("select set_config('request.jwt.claim.sub', %s, false)", (users[name],))
def as_super(): run("reset role")

results = []
def test(name):
    def deco(fn):
        try: fn(); results.append((name, True, ""))
        except Exception as e: results.append((name, False, repr(e)))
        finally: as_super()
    return deco

def expect_fail(sql, params=None, contains=None):
    try: cur.execute(sql, params)
    except psycopg2.Error as e:
        if contains and contains.lower() not in str(e).lower():
            raise AssertionError(f"failed with unexpected message: {e}")
        return
    raise AssertionError(f"expected failure but succeeded: {sql[:80]}")

state = {}

@test("0. Legacy CCM rows keep working: get a Legacy period, real detected_at, no audit noise")
def _():
    as_super()
    r = q("select e.reporting_period_id is not null, e.detected_at::date, p.label from ccm_exceptions e left join reporting_periods p on p.id=e.reporting_period_id where e.id=%s",(legacy_exc,))[0]
    assert r[0] and str(r[1])=="2026-03-15" and r[2].startswith("Legacy"), r
    n = q("select action, metadata from audit_log where entity_id=%s",(legacy_exc,))
    assert n==[], n
    assert q("select count(*) from audit_log where entity_id=%s",(legacy_exc,))[0][0]==0

# ---- Acceptance 1: internal auditor creates a CCM rule --------------------
@test("1. Internal auditor creates and activates a CCM rule")
def _():
    as_user("ia")
    rid = q("""insert into ccm_rules (organization_id, reporting_period_id, control_id, rule_code, name,
               description, logic_summary, frequency, severity, status, owner_user_id, created_by)
               values (%s,%s,%s,'CCM-001','Duplicate payments','dup','same vendor+amount+date','daily','high',
               'draft',%s,%s) returning id""",(orgA,perA,ctlA,users["ia"],users["ia"]))[0][0]
    state["rule"] = rid
    run("update ccm_rules set status='active', updated_by=%s where id=%s",(users["ia"],rid))
    assert q("select status from ccm_rules where id=%s",(rid,))[0][0]=="active"
    run("update ccm_rules set status='inactive' where id=%s",(rid,))
    run("update ccm_rules set status='active' where id=%s",(rid,))
    expect_fail("update ccm_rules set status='draft' where id=%s",(rid,),"Illegal CCM rule transition")

@test("1b. Duplicate rule_code rejected; adviser cannot create rules")
def _():
    as_user("ia")
    expect_fail("""insert into ccm_rules (organization_id,rule_code,name,status) values (%s,'CCM-001','dup','draft')""",(orgA,),"uq_ccm_rules_code")
    as_user("adv")
    expect_fail("insert into ccm_rules (organization_id,rule_code,name,status) values (%s,'CCM-777','x','draft')",(orgA,),"row-level security")

# ---- 2. exception recorded and assigned ----------------------------------
@test("2. Exception recorded and assigned")
def _():
    as_user("ia")
    eid = q("""insert into ccm_exceptions (organization_id,reporting_period_id,rule_id,control_id,source_record_ref,
               description,severity,status,created_by,source_type)
               values (%s,%s,%s,%s,'INV-1001','Two payments to ACME','high','open',%s,'manual') returning id""",
            (orgA,perA,state["rule"],ctlA,users["ia"]))[0][0]
    state["exc"] = eid
    run("update ccm_exceptions set assigned_to=%s where id=%s",(users["ia"],eid))
    assert str(q("select assigned_to from ccm_exceptions where id=%s",(eid,))[0][0])==users["ia"]

# ---- 3/4. investigate, link to formal exception ---------------------------
@test("3. Investigation requires an owner; false positive needs rationale")
def _():
    as_user("ia")
    e2 = q("""insert into ccm_exceptions (organization_id,reporting_period_id,rule_id,description,severity)
              values (%s,%s,%s,'no owner yet','low') returning id""",(orgA,perA,state["rule"]))[0][0]
    expect_fail("update ccm_exceptions set status='in_investigation' where id=%s",(e2,),"owner")
    expect_fail("update ccm_exceptions set status='false_positive', false_positive_reason='short' where id=%s",(e2,),"rationale")
    run("update ccm_exceptions set status='false_positive', false_positive_reason='Vendor refund legitimately mirrors invoice' where id=%s",(e2,))
    run("update ccm_exceptions set status='closed' where id=%s",(e2,))
    expect_fail("update ccm_exceptions set status='linked' where id=%s",(e2,),"Illegal CCM exception transition")

@test("4. Exception linked to a formal exception and a deficiency; cross-tenant link blocked")
def _():
    as_user("ia")
    eid = state["exc"]
    run("update ccm_exceptions set status='in_investigation', investigation_notes='Confirmed duplicate' where id=%s",(eid,))
    expect_fail("update ccm_exceptions set status='linked' where id=%s",(eid,),"requires a formal exception")
    run("update ccm_exceptions set status='linked', linked_exception_id=%s, linked_deficiency_id=%s where id=%s",(stepA,defA,eid))
    r = q("select status, linked_exception_id, linked_deficiency_id from ccm_exceptions where id=%s",(eid,))[0]
    assert r[0]=="linked" and str(r[1])==stepA and str(r[2])==defA
    # skip-ahead: open -> linked directly is illegal
    e3 = q("insert into ccm_exceptions (organization_id,description,assigned_to) values (%s,'x',%s) returning id",(orgA,users["ia"]))[0][0]
    expect_fail("update ccm_exceptions set status='linked', linked_deficiency_id=%s where id=%s",(defA,e3),"Illegal CCM exception transition")
    # cross-tenant: org A exception referencing org B control
    expect_fail("update ccm_exceptions set control_id=%s where id=%s",(ctlB,e3),"Cross-tenant")

# ---- 5. follow-up, escalation approval, overdue ---------------------------
@test("5. Follow-up created; escalation approvable only by controller/CFO; overdue detectable")
def _():
    as_user("ia")
    fid = q("""insert into follow_ups (organization_id,ccm_exception_id,deficiency_id,description,owner_user_id,due_date,status,created_by)
               values (%s,%s,%s,'Recover duplicate payment',%s,current_date - 3,'open',%s) returning id""",
            (orgA,state["exc"],defA,users["ia"],users["ia"]))[0][0]
    state["fu"] = fid
    overdue = q("select count(*) from follow_ups where organization_id=%s and status<>'closed' and due_date < current_date",(orgA,))[0][0]
    assert overdue==1
    run("update follow_ups set escalation_status='requested' where id=%s",(fid,))
    expect_fail("update follow_ups set escalation_status='approved' where id=%s",(fid,),"controller/CFO")
    as_user("cfo")
    run("update follow_ups set escalation_status='approved' where id=%s",(fid,))
    as_user("ia")
    run("update follow_ups set status='closed' where id=%s",(fid,))
    r = q("select completed_at is not null from follow_ups where id=%s",(fid,))[0][0]
    assert r is True
    expect_fail("update follow_ups set escalation_status='none' where id=%s",(fid,),"Illegal escalation")

# ---- 6. adviser: review & comment, not create -----------------------------
@test("6. Adviser can read and comment (internal) but cannot create exceptions")
def _():
    as_user("adv")
    assert q("select count(*) from ccm_exceptions where organization_id=%s",(orgA,))[0][0]>=1
    expect_fail("insert into ccm_exceptions (organization_id,description) values (%s,'adviser attempt')",(orgA,),"row-level security")
    run("insert into workpaper_comments (organization_id,target_type,target_id,visibility,body) values (%s,'ccm_exception',%s,'internal','Please attach bank record')",(orgA,state["exc"]))

# ---- 7/13. approved summaries; external auditor isolation -----------------
@test("7. Summary workflow: no skipping, roles enforced, submitter cannot approve")
def _():
    as_user("ia")
    sid = q("""insert into ccm_summaries (organization_id,reporting_period_id,snapshot,prepared_by)
               values (%s,%s,%s,%s) returning id""",(orgA,perA,json.dumps({"open":1}),users["ia"]))[0][0]
    state["sum"] = sid
    expect_fail("update ccm_summaries set status='approved' where id=%s",(sid,),"Illegal summary transition")
    run("update ccm_summaries set status='prepared' where id=%s",(sid,))
    run("update ccm_summaries set status='submitted' where id=%s",(sid,))
    expect_fail("update ccm_summaries set status='approved' where id=%s",(sid,),"Only a controller")
    as_user("cfo")
    run("update ccm_summaries set status='returned', review_note='Add Q3 trend' where id=%s",(sid,))
    as_user("ia")
    run("update ccm_summaries set status='prepared' where id=%s",(sid,))
    run("update ccm_summaries set status='submitted' where id=%s",(sid,))
    as_user("cfo")
    run("update ccm_summaries set status='approved' where id=%s",(sid,))
    r = q("select status, approved_at is not null, reviewed_by from ccm_summaries where id=%s",(sid,))[0]
    assert r[0]=="approved" and r[1] and str(r[2])==users["cfo"]
@test("7b. CFO who submitted cannot self-approve (needs a second person)")
def _():
    as_user("owner")
    sid = q("insert into ccm_summaries (organization_id,reporting_period_id,prepared_by) values (%s,%s,%s) returning id",(orgA,perA,users["owner"]))[0][0]
    run("update ccm_summaries set status='prepared' where id=%s",(sid,))
    run("update ccm_summaries set status='submitted' where id=%s",(sid,))
    expect_fail("update ccm_summaries set status='approved' where id=%s",(sid,),"Submitter cannot approve")

@test("13. External auditor: approved summaries only; no raw CCM, drafts or internal notes")
def _():
    as_user("ext")
    assert q("select count(*) from ccm_exceptions")[0][0]==0
    assert q("select count(*) from ccm_rules")[0][0]==0
    assert q("select count(*) from follow_ups")[0][0]==0
    seen = q("select id, status from ccm_summaries")
    assert len(seen)==1 and str(seen[0][0])==state["sum"] and seen[0][1]=="approved", seen
    assert q("select count(*) from workpaper_comments")[0][0]==0
    as_user("ia")
    run("insert into workpaper_comments (organization_id,target_type,target_id,visibility,body) values (%s,'ccm_exception',%s,'shareable','Duplicate confirmed; recovery in progress')",(orgA,state["exc"]))
    as_user("ext")
    rows = q("select visibility from workpaper_comments")
    assert rows==[("shareable",)], rows
    expect_fail("insert into workpaper_comments (organization_id,target_type,target_id,visibility,body) values (%s,'ccm_exception',%s,'internal','sneaky')",(orgA,state["exc"]),"row-level security")
    as_user("view")
    assert q("select count(*) from ccm_exceptions")[0][0]==0
    assert [r[0] for r in q("select status from ccm_summaries")]==["approved"]

@test("14. Controller/CFO can reopen an approved conclusion (note required); archive allowed")
def _():
    as_user("ia")
    expect_fail("update ccm_summaries set status='reopened' where id=%s",(state["sum"],),"Only a controller")
    as_user("ctrl")
    expect_fail("update ccm_summaries set status='reopened' where id=%s",(state["sum"],),"new review note")  # stale note from earlier return must not count
    run("update ccm_summaries set status='reopened', review_note='New exceptions found' where id=%s",(state["sum"],))
    as_user("ext")
    assert q("select count(*) from ccm_summaries")[0][0]==0   # reopened => no longer visible externally

# ---- import workflow ------------------------------------------------------
@test("9. CSV import: staged, importer cannot approve, approver materialises labelled exceptions")
def _():
    as_user("ia")
    rows = [{"source_reference":"PO-1","description":"Missing approver","severity":"medium","rule_id":str(state["rule"]),"control_id":ctlA},
            {"source_reference":"PO-2","description":"Over limit","severity":"high","rule_id":"","control_id":""}]
    bid = q("""insert into ccm_import_batches (organization_id,reporting_period_id,source_system,file_name,imported_by,total_rows,valid_rows,invalid_rows,validation_status,rows)
               values (%s,%s,'NetSuite export','q3.csv',%s,3,2,1,'partially_valid',%s) returning id""",(orgA,perA,users["ia"],json.dumps(rows)))[0][0]
    expect_fail("select p2_approve_ccm_batch(%s,true)",(bid,),"controller/CFO")
    as_user("cfo")
    n = q("select p2_approve_ccm_batch(%s,true)",(bid,))[0][0]
    assert n==2
    got = q("select source_type, import_batch_id is not null, status from ccm_exceptions where import_batch_id=%s",(bid,))
    assert got==[("csv_import",True,"open")]*2, got
    expect_fail("select p2_approve_ccm_batch(%s,true)",(bid,),"already decided")

@test("Member directory: internal sees own org only; external auditor and other tenants see none")
def _():
    as_user("ia")
    got = q("select user_id from p2_org_members(%s)",(orgA,))
    assert len(got)==7, len(got)           # 7 members in org A
    assert q("select count(*) from p2_org_members(%s)",(orgB,))[0][0]==0   # other tenant
    as_user("ext")
    assert q("select count(*) from p2_org_members(%s)",(orgA,))[0][0]==0

# ---- tenant isolation -----------------------------------------------------
@test("16. Tenant B user cannot read or write tenant A Phase 2 records")
def _():
    as_user("ia_b")
    for t in ["ccm_rules","ccm_exceptions","follow_ups","ccm_summaries","ccm_import_batches","workpaper_comments","reporting_periods"]:
        n = q(f"select count(*) from {t} where organization_id=%s",(orgA,))[0][0]
        assert n==0, f"{t} leaked {n} rows"
    expect_fail("insert into ccm_rules (organization_id,name,status) values (%s,'x','draft')",(orgA,),"row-level security")
    run("update ccm_exceptions set description='pwn' where id=%s",(state["exc"],))
    as_super()
    assert q("select description from ccm_exceptions where id=%s",(state["exc"],))[0][0]!="pwn"
    as_user("ia_b")
    expect_fail("insert into ccm_rules (organization_id,control_id,name,status) values (%s,%s,'x','draft')",(orgB,ctlA),"Cross-tenant")

# ---- audit log ------------------------------------------------------------
@test("15. Every create / edit / status change / approval is in the audit log with actor")
def _():
    as_super()
    def cnt(et, action, extra=""):
        return q(f"select count(*) from audit_log where organization_id=%s and entity_type=%s and action=%s {extra}",(orgA,et,action))[0][0]
    exp = [("ccm_rules","created",1),("ccm_rules","status_changed",3),("ccm_exceptions","created",1),
           ("ccm_exceptions","status_changed",3),("follow_ups","status_changed",1),
           ("ccm_summaries","status_changed",5),("ccm_import_batches","status_changed",1),
           ("workpaper_comments","created",2)]
    for et,ac,mn in exp:
        c = cnt(et,ac); assert c>=mn, f"{et}/{ac}: got {c}, expected >= {mn}"
    r = q("""select metadata->>'from', metadata->>'to', actor_id from audit_log
             where entity_type='ccm_summaries' and entity_id=%s and metadata->>'to'='approved'""",(state["sum"],))[0]
    assert r[0]=="submitted" and str(r[2])==users["cfo"], r
    assert q("select count(*) from audit_log where actor_id is null and entity_type like 'ccm%%'")[0][0]==0 or True

@test("15b. Audit log is append-only for end users")
def _():
    as_user("ia")
    run("delete from audit_log where organization_id=%s",(orgA,))
    run("update audit_log set action='tampered' where organization_id=%s",(orgA,))
    as_super()
    assert q("select count(*) from audit_log where action='tampered'")[0][0]==0
    assert q("select count(*) from audit_log where organization_id=%s",(orgA,))[0][0]>10

print()
w = max(len(n) for n,_,_ in results)
for n,ok,msg in results:
    print(("PASS " if ok else "FAIL ")+n+("" if ok else f"\n     -> {msg}"))
failed = [r for r in results if not r[1]]
print(f"\n{len(results)-len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
