"""Shared harness for module DB tests: builds a Postgres that mirrors production
(drift included), applies every Phase 2 migration in order, seeds two tenants
and one user per role, and provides as_user()/expect_fail()/test()."""
import os, sys, tempfile, uuid, glob
import pgserver, psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srv = pgserver.get_server(tempfile.mkdtemp())
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()

def run_file(path, twice=False):
    sql = open(path).read().replace('create extension if not exists pgcrypto;', '-- pgcrypto n/a; gen_random_uuid is built in')
    for _ in range(2 if twice else 1):
        try: cur.execute(sql)
        except Exception as e:
            print(f"FAILED applying {os.path.basename(path)}: {e}"); sys.exit(2)

def run(sql, params=None): cur.execute(sql, params)
def q(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall() if cur.description else []

run_file(f"{ROOT}/tests/db/baseline.sql")
run_file(f"{ROOT}/supabase/migrations/0001_init.sql")
for v in ["admin","cfo","controller","internal_auditor","external_auditor","adviser"]:
    run(f"alter type org_role add value if not exists '{v}'")
run("alter table controls add column if not exists title text, add column if not exists risk_rating text")
run("create or replace function org_role(p uuid) returns text language sql stable security definer as "
    "$$ select role::text from organization_members where organization_id=p and user_id=auth.uid() limit 1 $$")
run_file(f"{ROOT}/supabase/migrations/20260905154818_task45_ccm_exception_intelligence.sql")
run_file(f"{ROOT}/tests/db/live_stubs.sql")
for m in sorted(glob.glob(f"{ROOT}/supabase/migrations/2026101*_phase2_*.sql") + glob.glob(f"{ROOT}/supabase/migrations/202610[2-9]*_phase2_*.sql")):
    run_file(m, twice=True)          # every Phase 2 migration must be idempotent
run("grant usage on schema public, auth to authenticated")
run("grant all on all tables in schema public to authenticated")
run("grant select on auth.users to authenticated")
run("""do $$ declare r record; begin for r in select oid::regprocedure p from pg_proc
   where pronamespace='public'::regnamespace and proname not like 'p2\\_%' loop
   execute 'grant execute on function '||r.p||' to authenticated'; end loop; end $$""")
run("""do $$ declare r record; begin for r in select oid::regprocedure p from pg_proc
   where pronamespace='public'::regnamespace and proname in ('p2_role','p2_has_role','p2_is_internal','p2_org_members','p2_approve_ccm_batch')
   loop execute 'grant execute on function '||r.p||' to authenticated'; end loop; end $$""")

def uid(): return str(uuid.uuid4())
orgA, orgB = uid(), uid()
ROLES = {"ia":"internal_auditor","cfo":"cfo","ctrl":"controller","adv":"adviser","ext":"external_auditor","view":"viewer","owner":"owner"}
users = {k: uid() for k in list(ROLES)+["ia_b"]}
for k,u in users.items(): run("insert into auth.users(id,email) values (%s,%s)", (u,f"{k}@x.test"))
run("insert into organizations(id,name) values (%s,'A'),(%s,'B')", (orgA,orgB))
for k,r in ROLES.items():
    run("insert into organization_members(organization_id,user_id,role) values (%s,%s,%s)",(orgA,users[k],r))
run("insert into organization_members(organization_id,user_id,role) values (%s,%s,'internal_auditor')",(orgB,users["ia_b"]))
ctlA, ctlB = uid(), uid()
run("insert into controls(id,organization_id,code,name,title) values (%s,%s,'C-1','n','Ctl A'),(%s,%s,'C-9','n','Ctl B')",(ctlA,orgA,ctlB,orgB))
perA, perB = uid(), uid()
run("insert into reporting_periods(id,organization_id,label,start_date,end_date) values (%s,%s,'2026-Q3','2026-07-01','2026-09-30'),(%s,%s,'2026-Q3','2026-07-01','2026-09-30')",(perA,orgA,perB,orgB))
defA, evA, evB = uid(), uid(), uid()
run("insert into deficiencies(id,organization_id,control_id,title) values (%s,%s,%s,'def')",(defA,orgA,ctlA))
run("insert into evidence(id,organization_id,file_name,storage_path) values (%s,%s,'a.pdf','a/a.pdf'),(%s,%s,'b.pdf','b/b.pdf')",(evA,orgA,evB,orgB))

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
    raise AssertionError(f"expected failure but succeeded: {sql[:90]}")

def finish():
    print()
    for n,ok,msg in results: print(("PASS " if ok else "FAIL ")+n+("" if ok else f"\n     -> {msg}"))
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results)-len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)
