#!/usr/bin/env python3
"""Replay native tagging's per-EPC SQL against temporary tables only.

Measures lock/placement/ledger append SQL; excludes projection, pricing,
HTTP, real-table triggers, and application serialization.
"""
import json
from pathlib import Path
import re
import statistics
import subprocess
import sys
import uuid

source = (Path(__file__).resolve().parents[1] / "backend/src/cloud/postgres/movements.rs").read_text()
batch = source.split("async fn apply_tagging_identification_batch", 1)[1].split("async fn apply_line", 1)[0]
queries = re.findall(r'"((?:[^"\\]|\\.)*)"', batch)
lock = next(q for q in queries if q.startswith("SELECT id, subject_type"))
placement = next(q for q in queries if q.startswith("WITH delta AS"))
insert = next(q for q in queries if q.startswith("INSERT INTO movement"))
old_placement = re.search(r'sqlx::query\("([^"\n]+)"\)', source.split("async fn company_placement_count", 1)[1]).group(1)
old_insert = re.search(r'sqlx::query\("(INSERT INTO movement[^"\n]+)"\)', source.split("async fn apply_line", 1)[1]).group(1)
count = 1000
lot = str(uuid.UUID(int=1))
units = [str(uuid.UUID(int=n + 2)) for n in range(count)]
array = lambda values: "ARRAY[" + ",".join("'" + v + "'::uuid" for v in values) + "]"
def bind(query, values):
    return re.sub(r"\$(\d+)", lambda match: values[int(match[1]) - 1], query) + ";\n"
rows = [{"line_index": 0, "movement_id": str(uuid.uuid4()), "subject_id": lot,
         "quantity": count, "from_place_id": "company/source", "to_place_id": "system/identification"}]
rows += [{"line_index": n + 1, "movement_id": str(uuid.uuid4()), "subject_id": subject,
          "quantity": 1, "from_place_id": "system/identification", "to_place_id": "company/warehouse"}
         for n, subject in enumerate(units)]
constants = ["'" + str(uuid.uuid4()) + "'::uuid", "'IDENTIFICATION'", "'TAGGING_JOB'", "'job'", "'key'", "'digest'", "'actor'", "now()"]
sql = """
SET statement_timeout='20s';
CREATE TEMP TABLE inventory_subject(id uuid PRIMARY KEY, subject_type text, quantity bigint);
CREATE TEMP TABLE inventory_place(id text PRIMARY KEY, is_company boolean);
CREATE TEMP TABLE movement(fact_sequence bigserial, movement_id uuid PRIMARY KEY,
movement_group_id uuid, subject_id uuid, quantity bigint, from_place_id text,
to_place_id text, cause text, reference_type text, reference_id text,
idempotency_key text, payload_digest text, actor_id text, occurred_at timestamptz);
CREATE INDEX ON movement(subject_id);
INSERT INTO inventory_place VALUES ('company/source',true),('company/warehouse',true),('system/identification',false);
"""
sql += f"INSERT INTO inventory_subject VALUES ('{lot}','QUANTITY',{count});\n"
sql += "INSERT INTO inventory_subject VALUES " + ",".join(f"('{u}','UNIT',1)" for u in units) + ";\n"
sql += f"INSERT INTO movement(movement_id,subject_id,quantity,from_place_id,to_place_id) VALUES (gen_random_uuid(),'{lot}',{count},'external/supplier','company/source');\nANALYZE movement;\nANALYZE inventory_subject;\n"
balance = f"SELECT COALESCE(SUM(CASE WHEN to_place_id='company/source' THEN quantity WHEN from_place_id='company/source' THEN -quantity ELSE 0 END),0)::bigint FROM movement WHERE subject_id='{lot}' AND (from_place_id='company/source' OR to_place_id='company/source');\n"
for run in range(6):
    for variant in (("before", "after") if run % 2 == 0 else ("after", "before")):
        sql += f"BEGIN;\n\\echo {variant}\n\\timing on\n"
        if variant == "after":
            sql += bind(lock, [array([lot] + units)]) + balance + bind(placement, [array(units)])
            sql += bind(insert, ["'" + json.dumps(rows) + "'::jsonb"] + constants)
        else:
            for row in rows:
                subject = row["subject_id"]
                sql += f"SELECT subject_type,quantity FROM inventory_subject WHERE id='{subject}' FOR UPDATE;\n"
                sql += balance if subject == lot else bind(old_placement, ["'" + subject + "'::uuid"])
                sql += bind(old_insert, ["'" + row["movement_id"] + "'::uuid", constants[0], "'" + subject + "'::uuid", str(row["quantity"]), "'" + row["from_place_id"] + "'", "'" + row["to_place_id"] + "'"] + constants[1:])
        sql += "\\timing off\nDO $$ BEGIN IF (SELECT count(*) FROM movement) <> 1002 THEN RAISE EXCEPTION 'incorrect fact count'; END IF; IF EXISTS (SELECT subject_id FROM movement WHERE to_place_id='company/warehouse' GROUP BY subject_id HAVING SUM(quantity)<>1) THEN RAISE EXCEPTION 'incorrect unit balance'; END IF; END $$;\nROLLBACK;\n"
# A returned unit has no positive company placement; an existing unit does.
# The check must also reject quantity two at the same company place.
for quantity in (1, 2):
    sql += "BEGIN;\n"
    sql += f"INSERT INTO movement(movement_id,subject_id,quantity,from_place_id,to_place_id) VALUES (gen_random_uuid(),'{units[0]}',{quantity},'system/identification','company/warehouse');\n"
    sql += "CREATE TEMP TABLE guard_result ON COMMIT DROP AS " + bind(placement, [array(units)])
    sql += "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM guard_result) THEN RAISE EXCEPTION 'existing placement not rejected'; END IF; END $$;\nROLLBACK;\n"
sql += "BEGIN;\n"
sql += f"INSERT INTO movement(movement_id,subject_id,quantity,from_place_id,to_place_id) VALUES (gen_random_uuid(),'{units[0]}',1,'system/identification','company/warehouse'),(gen_random_uuid(),'{units[0]}',1,'company/warehouse','system/identification');\n"
sql += "CREATE TEMP TABLE guard_result ON COMMIT DROP AS " + bind(placement, [array(units)])
sql += "DO $$ BEGIN IF EXISTS (SELECT 1 FROM guard_result) THEN RAISE EXCEPTION 'returned unit incorrectly rejected'; END IF; END $$;\nROLLBACK;\n"
result = subprocess.run(["psql", sys.argv[1] if len(sys.argv)>1 else "postgresql:///postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, capture_output=True, check=True)
measurements = {"before": [], "after": []}
variant, times = None, []
for line in result.stdout.splitlines():
    if line in measurements:
        if variant:
            measurements[variant].append(sum(times))
        variant, times = line, []
    elif line.startswith("Time:"):
        times.append(float(re.search(r"Time: ([\d.]+) ms", line).group(1)))
if variant:
    measurements[variant].append(sum(times))
for variant, times in measurements.items():
    print(json.dumps({"variant": variant, "units": count, "queries": 3*(count+1) if variant=="before" else 4,
                      "warm_median_ms": statistics.median(times[1:]), "runs_ms": times}))
