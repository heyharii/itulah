#!/usr/bin/env python3
"""Compare two ledger scans with one materialized balance; TEMP tables only."""
import argparse, json, re, statistics, subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('database',nargs='?',default='postgresql:///postgres')
parser.add_argument('--baseline',default='HEAD',help='revision before the one-scan projection change')
args=parser.parse_args()
source=(Path(__file__).resolve().parents[1]/'backend/src/cloud/postgres/movements.rs').read_text()
baseline=subprocess.check_output(["git","show",args.baseline+":backend/src/cloud/postgres/movements.rs"],cwd=Path(__file__).resolve().parents[1],text=True)
body=baseline.split('async fn refresh_projection_positions(',1)[1].split('async fn validate_unique_company_placements',1)[0]
old=re.findall(r'sqlx::query\(\s*"([\s\S]*?)",\s*\)',body)
assert len(old)==2
new=old[0].replace('), balance AS (', '), balance AS MATERIALIZED (')
new=new.replace('         INSERT INTO inventory_projection', '''         , removed AS (
             DELETE FROM inventory_projection projection USING balance
             WHERE projection.subject_id=balance.subject_id AND projection.place_id=balance.place_id
               AND balance.quantity<=0
             RETURNING projection.subject_id
         )
         INSERT INTO inventory_projection''')
actual_body=source.split('async fn refresh_projection_positions(',1)[1].split('async fn validate_unique_company_placements',1)[0]
actual_queries=re.findall(r'sqlx::query\(\s*"([\s\S]*?)",\s*\)',actual_body)
if len(actual_queries)==1: new=actual_queries[0]
sql="""SET statement_timeout='30s';
CREATE TEMP TABLE movement(subject_id uuid,from_place_id text,to_place_id text,quantity bigint,fact_sequence bigint);
CREATE INDEX ON movement(subject_id);
CREATE TEMP TABLE inventory_projection(subject_id uuid,place_id text,quantity bigint,last_fact_sequence bigint,updated_at timestamptz,PRIMARY KEY(subject_id,place_id));
INSERT INTO movement SELECT md5(g::text)::uuid,'system/source','stockroom',1,g FROM generate_series(1,10000) g;
INSERT INTO movement SELECT md5(g::text)::uuid,'stockroom','picking',1,g+10000 FROM generate_series(1,5000) g;
INSERT INTO inventory_projection SELECT md5(g::text)::uuid,'stockroom',1,g,now() FROM generate_series(1,10000) g;
ANALYZE movement;
CREATE TEMP TABLE expected AS
SELECT subject_id, place_id, sum(delta)::bigint quantity,max(fact_sequence)::bigint last_fact_sequence
FROM (SELECT subject_id,to_place_id place_id,quantity delta,fact_sequence FROM movement
UNION ALL SELECT subject_id,from_place_id,-quantity,fact_sequence FROM movement) d
WHERE place_id IN ('stockroom','picking')
GROUP BY subject_id,place_id HAVING sum(delta)>0;
CREATE TEMP TABLE payload AS SELECT jsonb_agg(jsonb_build_object('subject_id',md5(g::text)::uuid,'place_id',place)) AS data FROM generate_series(1,10000) g CROSS JOIN (VALUES ('stockroom'),('picking')) p(place);
"""
for run in range(8):
    for variant in (('before','after') if run%2==0 else ('after','before')):
        sql+=f'BEGIN;\n\\echo {variant}\n'
        for q in (old if variant=='before' else [new]):
            sql+='EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+q.replace('$1','(SELECT data FROM payload)')+';\n'
        sql+="""DO $$ BEGIN
IF (SELECT count(*) FROM inventory_projection)<>10000 THEN RAISE EXCEPTION 'row count mismatch'; END IF;
IF EXISTS ((SELECT subject_id,place_id,quantity,last_fact_sequence FROM inventory_projection EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT subject_id,place_id,quantity,last_fact_sequence FROM inventory_projection)) THEN RAISE EXCEPTION 'position parity failed'; END IF;
IF (SELECT count(*) FROM inventory_projection WHERE place_id='picking')<>5000 THEN RAISE EXCEPTION 'stale position'; END IF;
END $$;
ROLLBACK;
"""
r=subprocess.run(['psql',args.database,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
if r.returncode: raise RuntimeError(r.stderr)
results={'before':[],'after':[]};variant=None;total=0;decoder=json.JSONDecoder();rest=r.stdout
while rest.strip():
    rest=rest.lstrip()
    if rest.startswith('before') or rest.startswith('after'):
        if variant is not None: results[variant].append(total)
        variant,rest=rest.split('\n',1);total=0
    else:
        obj,n=decoder.raw_decode(rest);rest=rest[n:];total+=obj[0]['Execution Time']
if variant is not None:results[variant].append(total)
for variant,times in results.items(): print(json.dumps({'variant':variant,'positions':20000,'warm_median_ms':statistics.median(times[1:]),'runs_ms':times}))
