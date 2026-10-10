#!/usr/bin/env python3
"""Benchmark actual old/new route triggers on rollback-only TEMP fixtures."""
import argparse
import json
import re
import statistics
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--database', default='postgresql:///postgres')
p.add_argument('--output', type=Path, default=root / 'outputs/allotment-route-trigger.json')
args = p.parse_args()
def function(path, name):
    source = path.read_text()
    body = re.search(r'CREATE (?:OR REPLACE )?FUNCTION \w+\(\) RETURNS trigger\s+LANGUAGE plpgsql AS \$\$(.*?)\$\$;', source, re.S).group(1)
    return f'CREATE FUNCTION pg_temp.{name}() RETURNS trigger LANGUAGE plpgsql AS $${body}$$;'
old = function(root / 'backend/migrations/postgres/0628_a_store_never_sends_goods_to_another_store.sql', 'old_route')
new = function(root / 'backend/migrations/postgres/0925_allotment_routes_are_checked_once_per_statement.sql', 'new_route')
sql = '''BEGIN;
CREATE TEMP TABLE unit(id text PRIMARY KEY, kind text);
INSERT INTO unit VALUES ('ho','HO'),('shop','STORE');
CREATE TEMP TABLE site(id text PRIMARY KEY,kind text,unit_id text);
INSERT INTO site VALUES ('source','HO','ho'),('other-ho','HO','ho');
INSERT INTO site SELECT 'shop-'||i,'STORE','shop' FROM generate_series(1,13) i;
CREATE TEMP TABLE pool_template(site_kind text,role text);
INSERT INTO pool_template VALUES ('STORE','FLOOR'),('HO','RECEIVING');
CREATE TEMP TABLE allotment_line(source_site_id text,destination_type text,destination_id text,sku int);
'''+old+new
for side in ['before','after']:
    trigger = ('BEFORE INSERT ON allotment_line FOR EACH ROW EXECUTE FUNCTION pg_temp.old_route()' if side == 'before' else 'AFTER INSERT ON allotment_line REFERENCING NEW TABLE AS inserted_lines FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.new_route()')
    sql += f'CREATE TRIGGER checked {trigger};\n'
    # A failed mixed insert must roll back the valid row as well.
    sql += '''DO $guard$
DECLARE bad record; rejected bool; good_count bigint;
BEGIN
 FOR bad IN SELECT * FROM (VALUES
 ('source','STORE','absent'),('source','STORE','other-ho'),
 ('source','DC','shop-1'),('source','DC','source'),
 ('shop-1','STORE','shop-2'),('source','SUPPLIER','wrong'),
 ('shop-1','SUPPLIER','external/supplier')) AS r(src,typ,dst)
 LOOP
  rejected := false;
  BEGIN
   INSERT INTO allotment_line VALUES ('source','STORE','shop-1',0),(bad.src,bad.typ,bad.dst,1);
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected OR EXISTS (SELECT 1 FROM allotment_line) THEN
   RAISE EXCEPTION 'route guard or statement rollback failed: %',bad;
  END IF;
 END LOOP;
 INSERT INTO allotment_line VALUES ('source','SUPPLIER','external/supplier',0),('source','DC','other-ho',1);
 SELECT count(*) INTO good_count FROM allotment_line;
 IF good_count <> 2 THEN RAISE EXCEPTION 'valid routes failed'; END IF;
 TRUNCATE allotment_line;
END $guard$;
DROP TRIGGER checked ON allotment_line;
'''
for cycle in range(4):
    for side in (['before','after'] if cycle % 2 == 0 else ['after','before']):
        trigger = ('BEFORE INSERT ON allotment_line FOR EACH ROW EXECUTE FUNCTION pg_temp.old_route()' if side == 'before' else 'AFTER INSERT ON allotment_line REFERENCING NEW TABLE AS inserted_lines FOR EACH STATEMENT EXECUTE FUNCTION pg_temp.new_route()')
        sql += f'''CREATE TRIGGER checked {trigger};
SELECT 'MEASURE {side}';
EXPLAIN (ANALYZE,FORMAT JSON,TIMING OFF)
INSERT INTO allotment_line SELECT 'source','STORE','shop-'||d,s FROM generate_series(1,200) s CROSS JOIN generate_series(1,13) d;
DO $$BEGIN IF (SELECT count(*) FROM allotment_line) <> 2600 THEN RAISE EXCEPTION 'row parity failed'; END IF; END$$;
TRUNCATE allotment_line;
DROP TRIGGER checked ON allotment_line;
'''
sql += 'ROLLBACK;'
r = subprocess.run(['psql',args.database,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if r.returncode:
    raise SystemExit(r.stderr)
values = {'before':[], 'after':[]}; plans = []
for m in re.finditer(r'MEASURE (before|after)\n',r.stdout):
    plan,_ = json.JSONDecoder().raw_decode(r.stdout,m.end()); d = plan[0]
    values[m.group(1)].append(d['Execution Time']); plans.append({'side':m.group(1),'plan':d})
assert all(len(v)==4 for v in values.values())
result = {'fixture':'200 SKUs, 13 routes, 2600 inserted lines; alternating order; rollback-only TEMP tables', 'guards':'Seven invalid mixed-route inserts rejected atomically; supplier and DC valid routes accepted for both triggers', 'operations':{k:{'runs_ms':v,'median_ms':statistics.median(v)} for k,v in values.items()},'plans':plans}
args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='plans'},indent=2))
