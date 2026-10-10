#!/usr/bin/env python3
"""Benchmark the native availability CTE used by new allotments.

The fixture is temporary and the entire run is rolled back. It mirrors
`load_create_availability` with 5,000 subjects across 200 SKUs and 250,000
balanced movement facts (50 per subject). It checks exact normal/committed
quantity parity, then compares the current movement indexes with indexes on
the two equality-key pairs used by the query. The prepared statement is tested
with forced custom and generic plans and JIT on/off; an `auto` plan-cache probe
records PostgreSQL's custom/generic plan counters. A focused ABCCBA comparison
also measures a per-subject lateral aggregate that reads both movement sides
in one pass, with current and candidate indexes.

Run after any competing HTTP matrix finishes:
    python3 scripts/benchmark-native-allotment-availability.py \
        --database postgresql://hari@127.0.0.1:55437/postgres
"""

import argparse
import hashlib
import json
import statistics
import subprocess
from pathlib import Path
from uuid import UUID


DEFAULT_DATABASE = "postgresql:///postgres"
SUBJECTS = 5_000
SKUS = 200
HISTORY_PER_SUBJECT = 50
REQUEST_SIZES = (10, 200)
SOURCE_POOL_ID = "bench.warehouse"
PICKING_POOL_ID = "bench.picking"
WAREHOUSE_PLACE = f"{SOURCE_POOL_ID}:on_hand"
PICKING_PLACE = f"{PICKING_POOL_ID}:on_hand"
CANDIDATE_TO_INDEX = "bench_movement_subject_to_place"
CANDIDATE_FROM_INDEX = "bench_movement_subject_from_place"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", default=DEFAULT_DATABASE)
parser.add_argument(
    "--cycles",
    type=int,
    default=2,
    help="number of ABBA cycles (each index shape gets 2 * cycles runs)",
)
parser.add_argument(
    "--output",
    type=Path,
    default=Path(__file__).resolve().parents[1] / "outputs/native-allotment-availability.json",
)
args = parser.parse_args()
if args.cycles < 1:
    parser.error("--cycles must be positive")


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sku_code(number: int) -> str:
    return f"SKU-{number:05d}"


def sku_uuid(number: int) -> str:
    return str(UUID(hashlib.md5(f"native-sku-{number}".encode()).hexdigest()))


def array_literal(values: list[str], pg_type: str) -> str:
    if pg_type == "uuid[]":
        items = ",".join(f"{sql_literal(value)}::uuid" for value in values)
    else:
        items = ",".join(sql_literal(value) for value in values)
    return f"ARRAY[{items}]::{pg_type}"


def request_arguments(pair_count: int) -> str:
    # Rust constructs a BTreeSet<(pool, UUID)> before binding these arrays.
    # Sorting the canonical UUID strings reproduces that aligned pair order.
    ids = sorted(sku_uuid(number) for number in range(1, pair_count + 1))
    pools = [SOURCE_POOL_ID] * pair_count
    return f"{array_literal(pools, 'text[]')},{array_literal(ids, 'uuid[]')}"


query = """WITH requested AS MATERIALIZED (
    SELECT DISTINCT line.source_pool_id,line.sku_id
      FROM unnest($1::text[],$2::uuid[]) AS line(source_pool_id,sku_id)
), eligible AS MATERIALIZED (
    SELECT DISTINCT requested.source_pool_id,pool.id||':on_hand' AS place_id
      FROM requested
      JOIN operational_pool source ON source.id=requested.source_pool_id
      JOIN operational_pool pool
        ON pool.id=source.id
        OR (source.role='STOCKROOM' AND pool.site_id=source.site_id
            AND pool.role='PICKING')
), movement_deltas AS (
    SELECT requested.source_pool_id,requested.sku_id,movement.quantity::bigint AS delta
      FROM requested
      JOIN inventory_subject subject ON subject.sku_id=requested.sku_id
      JOIN eligible ON eligible.source_pool_id=requested.source_pool_id
      JOIN movement ON movement.subject_id=subject.id
                   AND movement.to_place_id=eligible.place_id
    UNION ALL
    SELECT requested.source_pool_id,requested.sku_id,-movement.quantity::bigint AS delta
      FROM requested
      JOIN inventory_subject subject ON subject.sku_id=requested.sku_id
      JOIN eligible ON eligible.source_pool_id=requested.source_pool_id
      JOIN movement ON movement.subject_id=subject.id
                   AND movement.from_place_id=eligible.place_id
), normal AS (
    SELECT source_pool_id,sku_id,sum(delta)::bigint AS quantity
      FROM movement_deltas GROUP BY source_pool_id,sku_id
), allotted AS (
    SELECT commitment.source_pool_id,commitment.sku_id,
           sum(commitment.to_pack_qty)::bigint AS quantity
      FROM requested
      JOIN allotment_line_commitment commitment
        ON commitment.source_pool_id=requested.source_pool_id
       AND commitment.sku_id=requested.sku_id
     GROUP BY commitment.source_pool_id,commitment.sku_id
)
SELECT requested.source_pool_id,requested.sku_id,
       COALESCE(normal.quantity,0)::bigint AS normal_quantity,
       COALESCE(allotted.quantity,0)::bigint AS allotted_quantity
  FROM requested
  LEFT JOIN normal USING (source_pool_id,sku_id)
  LEFT JOIN allotted USING (source_pool_id,sku_id)"""

# A candidate shape that starts with one subject, then aggregates both sides
# of all eligible places in a single lateral scan. This avoids two UNION ALL
# arms independently reading every movement fact for each selected subject.
lateral_query = """WITH requested AS MATERIALIZED (
    SELECT DISTINCT line.source_pool_id,line.sku_id
      FROM unnest($1::text[],$2::uuid[]) AS line(source_pool_id,sku_id)
), eligible AS MATERIALIZED (
    SELECT requested.source_pool_id,
           array_agg(DISTINCT pool.id||':on_hand') AS place_ids
      FROM requested
      JOIN operational_pool source ON source.id=requested.source_pool_id
      JOIN operational_pool pool
        ON pool.id=source.id
        OR (source.role='STOCKROOM' AND pool.site_id=source.site_id
            AND pool.role='PICKING')
     GROUP BY requested.source_pool_id
), normal AS (
    SELECT requested.source_pool_id,requested.sku_id,
           sum(subject_balance.quantity)::bigint AS quantity
      FROM requested
      JOIN inventory_subject subject ON subject.sku_id=requested.sku_id
      JOIN eligible ON eligible.source_pool_id=requested.source_pool_id
      CROSS JOIN LATERAL (
          SELECT (COALESCE(sum(movement.quantity)
                               FILTER (WHERE movement.to_place_id=ANY(eligible.place_ids)),0)
                 - COALESCE(sum(movement.quantity)
                               FILTER (WHERE movement.from_place_id=ANY(eligible.place_ids)),0))
                 AS quantity
            FROM movement
           WHERE movement.subject_id=subject.id
      ) subject_balance
     GROUP BY requested.source_pool_id,requested.sku_id
), allotted AS (
    SELECT commitment.source_pool_id,commitment.sku_id,
           sum(commitment.to_pack_qty)::bigint AS quantity
      FROM requested
      JOIN allotment_line_commitment commitment
        ON commitment.source_pool_id=requested.source_pool_id
       AND commitment.sku_id=requested.sku_id
     GROUP BY commitment.source_pool_id,commitment.sku_id
)
SELECT requested.source_pool_id,requested.sku_id,
       COALESCE(normal.quantity,0)::bigint AS normal_quantity,
       COALESCE(allotted.quantity,0)::bigint AS allotted_quantity
  FROM requested
  LEFT JOIN normal USING (source_pool_id,sku_id)
  LEFT JOIN allotted USING (source_pool_id,sku_id)"""

sql = [
    "BEGIN;",
    "SET LOCAL statement_timeout = '90s';",
    "SET LOCAL work_mem = '128MB';",
    "CREATE TEMP TABLE operational_pool (",
    "    id text PRIMARY KEY, site_id text NOT NULL, role text NOT NULL",
    ");",
    "INSERT INTO operational_pool(id,site_id,role) VALUES",
    f"  ({sql_literal(SOURCE_POOL_ID)},'bench-site','STOCKROOM'),",
    f"  ({sql_literal(PICKING_POOL_ID)},'bench-site','PICKING');",
    "CREATE TEMP TABLE inventory_subject (id uuid PRIMARY KEY, sku_id uuid NOT NULL);",
    "CREATE INDEX bench_inventory_subject_sku ON inventory_subject(sku_id);",
    "INSERT INTO inventory_subject(id,sku_id)",
    "SELECT md5('native-subject-' || subject_number::text)::uuid,",
    "       md5('native-sku-' || ((((subject_number-1)/25)+1)::text))::uuid",
    f"  FROM generate_series(1,{SUBJECTS}) AS subjects(subject_number);",
    "CREATE TEMP TABLE movement (",
    "    fact_sequence bigint PRIMARY KEY, subject_id uuid NOT NULL,",
    "    quantity bigint NOT NULL, from_place_id text NOT NULL, to_place_id text NOT NULL,",
    "    occurred_at timestamptz NOT NULL",
    ");",
    "INSERT INTO movement(fact_sequence,subject_id,quantity,from_place_id,to_place_id,occurred_at)",
    "SELECT ((subject_number-1)*50+step)::bigint,",
    "       md5('native-subject-' || subject_number::text)::uuid,",
    "       1::bigint,",
    "       CASE",
    "         WHEN step=1 THEN 'external/supplier'",
    f"         WHEN step=2 THEN {sql_literal(WAREHOUSE_PLACE)}",
    "         WHEN step BETWEEN 3 AND 48 AND step % 2 = 1 THEN 'bench.history_a'",
    "         WHEN step BETWEEN 3 AND 48 THEN 'bench.history_b'",
    "         WHEN step=49 THEN 'bench.history_a'",
    f"         ELSE {sql_literal(WAREHOUSE_PLACE)} END,",
    "       CASE",
    f"         WHEN step=1 THEN {sql_literal(WAREHOUSE_PLACE)}",
    "         WHEN step=2 THEN 'bench.history_a'",
    "         WHEN step BETWEEN 3 AND 48 AND step % 2 = 1 THEN 'bench.history_b'",
    "         WHEN step BETWEEN 3 AND 48 THEN 'bench.history_a'",
    f"         WHEN step=49 THEN {sql_literal(WAREHOUSE_PLACE)}",
    f"         ELSE {sql_literal(PICKING_PLACE)} END,",
    "       timestamptz '2026-01-01 00:00:00+00'",
    "         + ((subject_number-1)*50+step) * interval '1 second'",
    f"  FROM generate_series(1,{SUBJECTS}) AS subjects(subject_number)",
    f" CROSS JOIN generate_series(1,{HISTORY_PER_SUBJECT}) AS steps(step);",
    "CREATE INDEX movement_subject_time_idx ON movement(subject_id,occurred_at,fact_sequence);",
    "CREATE INDEX movement_places_time_idx ON movement(from_place_id,to_place_id,occurred_at);",
    "CREATE INDEX ix_movement_to_place_occurred ON movement(to_place_id,occurred_at);",
    "CREATE INDEX ix_movement_from_place_occurred ON movement(from_place_id,occurred_at);",
    "CREATE TEMP TABLE allotment_line_commitment (",
    "    source_pool_id text NOT NULL, sku_id uuid NOT NULL, to_pack_qty bigint NOT NULL",
    ");",
    "CREATE INDEX bench_commitment_pool_sku",
    "    ON allotment_line_commitment(source_pool_id,sku_id);",
    "INSERT INTO allotment_line_commitment(source_pool_id,sku_id,to_pack_qty)",
    f"SELECT {sql_literal(SOURCE_POOL_ID)}, md5('native-sku-' || sku_number::text)::uuid, 3::bigint",
    f"  FROM generate_series(1,{SKUS}) AS skus(sku_number);",
    "ANALYZE operational_pool;",
    "ANALYZE inventory_subject;",
    "ANALYZE movement;",
    "ANALYZE allotment_line_commitment;",
    f"PREPARE native_availability(text[],uuid[]) AS {query};",
    f"PREPARE native_lateral(text[],uuid[]) AS {lateral_query};",
    "SELECT 'SERVER|' || current_setting('server_version') || '|' ||",
    "       current_setting('jit') || '|' || current_setting('jit_above_cost') || '|' ||",
    "       current_setting('jit_inline_above_cost') || '|' || current_setting('jit_optimize_above_cost');",
]

for pair_count in REQUEST_SIZES:
    sql.extend(
        [
            f"\\echo PARITY|current|{pair_count}",
            f"EXECUTE native_availability({request_arguments(pair_count)});",
        ]
    )

sql.extend(
    [
        f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
        f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
        "ANALYZE movement;",
    ]
)
for pair_count in REQUEST_SIZES:
    sql.extend(
        [
            f"\\echo PARITY|candidate|{pair_count}",
            f"EXECUTE native_availability({request_arguments(pair_count)});",
        ]
    )
sql.extend(
    [
        f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
        f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
    ]
)

# Warm each shape before the measured ABBA runs. Index build/drop time is not
# included in the query timings and all DDL remains transaction-local.
for index_state in ("current", "candidate"):
    if index_state == "candidate":
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
                f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
                "ANALYZE movement;",
            ]
        )
    sql.extend(["SET plan_cache_mode = force_custom_plan;", "SET jit = off;"])
    for pair_count in REQUEST_SIZES:
        sql.append(f"EXECUTE native_availability({request_arguments(pair_count)});")
    if index_state == "candidate":
        sql.extend(
            [
                f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
                f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
            ]
        )

states = ["current", "candidate", "candidate", "current"] * args.cycles
candidate_present = False
for run_number, index_state in enumerate(states, start=1):
    if index_state == "candidate" and not candidate_present:
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
                f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
                "ANALYZE movement;",
            ]
        )
        candidate_present = True
    elif index_state == "current" and candidate_present:
        sql.extend(
            [
                f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
                f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
            ]
        )
        candidate_present = False

    pair_sizes = REQUEST_SIZES if run_number % 2 else tuple(reversed(REQUEST_SIZES))
    for pair_count in pair_sizes:
        args_sql = request_arguments(pair_count)
        for plan_mode in ("force_custom_plan", "force_generic_plan"):
            for jit_state in ("on", "off"):
                sql.extend(
                    [
                        f"SET plan_cache_mode = {plan_mode};",
                        f"SET jit = {jit_state};",
                        f"\\echo PLAN|{pair_count}|{index_state}|{plan_mode}|{jit_state}|{run_number}",
                        "EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) "
                        f"EXECUTE native_availability({args_sql});",
                    ]
                )

# SQLx uses the server's automatic prepared-plan choice. Observe its generic vs
# custom decision independently for each index shape after repeated mixed-size
# executions; JIT is disabled here so this diagnostic measures plan selection.
for index_state in ("current", "candidate"):
    if index_state == "candidate":
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
                f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
                "ANALYZE movement;",
            ]
        )
    sql.extend(
        [
            "PREPARE native_auto(text[],uuid[]) AS " + query + ";",
            "SET plan_cache_mode = auto;",
            "SET jit = off;",
            "\\o /dev/null",
        ]
    )
    for pair_count in (10, 200, 200, 10, 10, 200, 200):
        sql.append(f"EXECUTE native_auto({request_arguments(pair_count)});")
    sql.extend(
        [
            "\\o",
            "SELECT generic_plans AS generic_count, custom_plans AS custom_count",
            "  FROM pg_prepared_statements WHERE name='native_auto' \\gset auto_",
            f"\\echo AUTO|{index_state}|:auto_generic_count|:auto_custom_count",
            f"\\echo AUTOPLAN|{index_state}|200",
            "EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) "
            f"EXECUTE native_auto({request_arguments(200)});",
            "DEALLOCATE native_auto;",
        ]
    )
    if index_state == "candidate":
        sql.extend(
            [
                f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
                f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
            ]
        )

# Focused shape comparison. Parity is checked against the same 25-on-hand / 3
# committed fixture before timing. ABCCBA alternation gives two warm samples
# each for original/current, lateral/current and lateral/candidate indexes.
for pair_count in REQUEST_SIZES:
    sql.extend(
        [
            f"\\echo LATERALPARITY|lateral_current|{pair_count}",
            f"EXECUTE native_lateral({request_arguments(pair_count)});",
        ]
    )
sql.extend(
    [
        f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
        f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
        "ANALYZE movement;",
    ]
)
for pair_count in REQUEST_SIZES:
    sql.extend(
        [
            f"\\echo LATERALPARITY|lateral_candidate|{pair_count}",
            f"EXECUTE native_lateral({request_arguments(pair_count)});",
        ]
    )
sql.extend(
    [
        f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
        f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
        "ANALYZE movement;",
        "SET plan_cache_mode = force_custom_plan;",
        "SET jit = off;",
    ]
)
lateral_states = [
    "original_current",
    "lateral_current",
    "lateral_candidate",
    "lateral_candidate",
    "lateral_current",
    "original_current",
]
candidate_present = False
for run_number, shape in enumerate(lateral_states, start=1):
    wants_candidate = shape == "lateral_candidate"
    if wants_candidate and not candidate_present:
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_TO_INDEX} ON movement(subject_id,to_place_id);",
                f"CREATE INDEX {CANDIDATE_FROM_INDEX} ON movement(subject_id,from_place_id);",
                "ANALYZE movement;",
            ]
        )
        candidate_present = True
    elif not wants_candidate and candidate_present:
        sql.extend(
            [
                f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
                f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
                "ANALYZE movement;",
            ]
        )
        candidate_present = False

    pair_sizes = REQUEST_SIZES if run_number % 2 else tuple(reversed(REQUEST_SIZES))
    statement = "native_availability" if shape == "original_current" else "native_lateral"
    for pair_count in pair_sizes:
        sql.extend(
            [
                f"\\echo LATERALPLAN|{shape}|{pair_count}|{run_number}",
                "EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) "
                f"EXECUTE {statement}({request_arguments(pair_count)});",
            ]
        )

if candidate_present:
    sql.extend(
        [
            f"DROP INDEX pg_temp.{CANDIDATE_TO_INDEX};",
            f"DROP INDEX pg_temp.{CANDIDATE_FROM_INDEX};",
        ]
    )
sql.extend(["DEALLOCATE native_lateral;", "DEALLOCATE native_availability;"])
sql.append("ROLLBACK;")
result = subprocess.run(
    [
        "psql",
        args.database,
        "-X",
        "-q",
        "-A",
        "-t",
        "-F",
        "\t",
        "-v",
        "ON_ERROR_STOP=1",
    ],
    input="\n".join(sql),
    text=True,
    capture_output=True,
)
if result.returncode:
    raise RuntimeError(f"psql benchmark failed:\n{result.stderr}")


def scan_nodes(node: dict) -> list[dict]:
    scans = []
    if node.get("Node Type") in {
        "Seq Scan",
        "Index Scan",
        "Index Only Scan",
        "Bitmap Heap Scan",
        "Bitmap Index Scan",
    }:
        scans.append(
            {
                key: node[key]
                for key in (
                    "Node Type",
                    "Relation Name",
                    "Index Name",
                    "Actual Rows",
                    "Actual Loops",
                    "Local Hit Blocks",
                    "Local Read Blocks",
                    "Shared Hit Blocks",
                    "Shared Read Blocks",
                )
                if key in node
            }
        )
    for child in node.get("Plans", []):
        scans.extend(scan_nodes(child))
    return scans


parity: dict[tuple[str, int], dict[tuple[str, str], tuple[int, int]]] = {}
plans: list[dict] = []
lateral_parity: dict[
    tuple[str, int], dict[tuple[str, str], tuple[int, int]]
] = {}
lateral_plans: list[dict] = []
auto_counts: dict[str, tuple[int, int]] = {}
server_settings = None
mode = None
plan_lines: list[str] = []
for line in result.stdout.splitlines():
    if line.startswith("SERVER|"):
        _, version, jit, jit_above, jit_inline, jit_optimize = line.split("|")
        server_settings = {
            "server_version": version,
            "jit": jit,
            "jit_above_cost": float(jit_above),
            "jit_inline_above_cost": float(jit_inline),
            "jit_optimize_above_cost": float(jit_optimize),
        }
    elif line.startswith("PARITY|"):
        _, index_state, pair_count = line.split("|")
        mode = ("parity", index_state, int(pair_count))
        parity[(index_state, int(pair_count))] = {}
    elif line.startswith("PLAN|"):
        _, pair_count, index_state, plan_mode, jit_state, run_number = line.split("|")
        mode = (
            "plan",
            int(pair_count),
            index_state,
            plan_mode,
            jit_state,
            int(run_number),
        )
        plan_lines = []
    elif line.startswith("AUTOPLAN|"):
        _, index_state, pair_count = line.split("|")
        mode = ("auto_plan", index_state, int(pair_count))
        plan_lines = []
    elif line.startswith("LATERALPARITY|"):
        _, shape, pair_count = line.split("|")
        mode = ("lateral_parity", shape, int(pair_count))
        lateral_parity[(shape, int(pair_count))] = {}
    elif line.startswith("LATERALPLAN|"):
        _, shape, pair_count, run_number = line.split("|")
        mode = ("lateral_plan", shape, int(pair_count), int(run_number))
        plan_lines = []
    elif line.startswith("AUTO|"):
        _, index_state, generic_count, custom_count = line.split("|")
        auto_counts[index_state] = (int(generic_count), int(custom_count))
    elif mode and mode[0] == "parity" and line:
        source_pool, requested_sku, normal_quantity, allotted_quantity = line.split("\t")
        parity[(mode[1], mode[2])][(source_pool, requested_sku)] = (
            int(normal_quantity),
            int(allotted_quantity),
        )
    elif mode and mode[0] == "lateral_parity" and line:
        source_pool, requested_sku, normal_quantity, allotted_quantity = line.split("\t")
        lateral_parity[(mode[1], mode[2])][(source_pool, requested_sku)] = (
            int(normal_quantity),
            int(allotted_quantity),
        )
    elif mode and mode[0] in {"plan", "auto_plan", "lateral_plan"} and line:
        plan_lines.append(line)
        try:
            plan_json = json.loads("\n".join(plan_lines))
        except json.JSONDecodeError:
            continue
        if mode[0] == "plan":
            plans.append(
                {
                    "pairs": mode[1],
                    "indexes": mode[2],
                    "plan_mode": mode[3],
                    "jit": mode[4],
                    "run": mode[5],
                    "plan": plan_json[0],
                }
            )
        elif mode[0] == "auto_plan":
            plans.append(
                {
                    "pairs": mode[2],
                    "indexes": mode[1],
                    "plan_mode": "auto",
                    "jit": "off",
                    "run": 0,
                    "plan": plan_json[0],
                }
            )
        else:
            lateral_plans.append(
                {
                    "shape": mode[1],
                    "pairs": mode[2],
                    "run": mode[3],
                    "plan": plan_json[0],
                }
            )
        mode = None

for pair_count in REQUEST_SIZES:
    old = parity.get(("current", pair_count), {})
    candidate = parity.get(("candidate", pair_count), {})
    expected = {
        (SOURCE_POOL_ID, sku_uuid(number)): (25, 3)
        for number in range(1, pair_count + 1)
    }
    if old != candidate or old != expected:
        raise RuntimeError(
            f"quantity parity failed for {pair_count} pairs: "
            f"current={len(old)}, candidate={len(candidate)}, expected={len(expected)}"
        )

expected_plan_count = len(states) * len(REQUEST_SIZES) * 2 * 2 + 2
if len(plans) != expected_plan_count:
    raise RuntimeError(f"expected {expected_plan_count} explain plans, got {len(plans)}")

for pair_count in REQUEST_SIZES:
    baseline = parity[("current", pair_count)]
    expected = {
        (SOURCE_POOL_ID, sku_uuid(number)): (25, 3)
        for number in range(1, pair_count + 1)
    }
    for shape in ("lateral_current", "lateral_candidate"):
        actual = lateral_parity.get((shape, pair_count), {})
        if actual != baseline or actual != expected:
            raise RuntimeError(
                f"lateral quantity parity failed for {shape}/{pair_count} pairs: "
                f"baseline={len(baseline)}, lateral={len(actual)}, expected={len(expected)}"
            )

expected_lateral_plans = len(lateral_states) * len(REQUEST_SIZES)
if len(lateral_plans) != expected_lateral_plans:
    raise RuntimeError(
        f"expected {expected_lateral_plans} lateral comparison plans, got {len(lateral_plans)}"
    )

summary = []
for pair_count in REQUEST_SIZES:
    variants = []
    for index_state in ("current", "candidate"):
        for plan_mode in ("force_custom_plan", "force_generic_plan", "auto"):
            for jit_state in (("on", "off") if plan_mode != "auto" else ("off",)):
                entries = [
                    entry
                    for entry in plans
                    if entry["pairs"] == pair_count
                    and entry["indexes"] == index_state
                    and entry["plan_mode"] == plan_mode
                    and entry["jit"] == jit_state
                ]
                if not entries:
                    continue
                times = [entry["plan"]["Execution Time"] for entry in entries]
                last_plan = entries[-1]["plan"]
                variants.append(
                    {
                        "indexes": index_state,
                        "plan_mode": plan_mode,
                        "jit": jit_state,
                        "median_execution_ms": statistics.median(times),
                        "runs_execution_ms": times,
                        "last_planning_ms": last_plan.get("Planning Time"),
                        "last_jit": last_plan.get("JIT"),
                        "last_scan_nodes": scan_nodes(last_plan["Plan"]),
                        "last_plan_local_hit_blocks": last_plan["Plan"].get("Local Hit Blocks", 0),
                        "last_plan_local_read_blocks": last_plan["Plan"].get("Local Read Blocks", 0),
                        "last_plan_shared_hit_blocks": last_plan["Plan"].get("Shared Hit Blocks", 0),
                        "last_plan_shared_read_blocks": last_plan["Plan"].get("Shared Read Blocks", 0),
                    }
                )
    summary.append(
        {
            "requested_pairs": pair_count,
            "parity": True,
            "normal_quantity_per_sku": 25,
            "allotted_quantity_per_sku": 3,
            "remaining_quantity_per_sku": 22,
            "variants": variants,
        }
    )

lateral_summary = []
for pair_count in REQUEST_SIZES:
    variants = []
    for shape in ("original_current", "lateral_current", "lateral_candidate"):
        entries = [
            entry
            for entry in lateral_plans
            if entry["pairs"] == pair_count and entry["shape"] == shape
        ]
        if not entries:
            continue
        times = [entry["plan"]["Execution Time"] for entry in entries]
        last_plan = entries[-1]["plan"]
        variants.append(
            {
                "shape": shape,
                "median_execution_ms": statistics.median(times),
                "runs_execution_ms": times,
                "last_planning_ms": last_plan.get("Planning Time"),
                "last_jit": last_plan.get("JIT"),
                "last_scan_nodes": scan_nodes(last_plan["Plan"]),
                "last_plan_local_hit_blocks": last_plan["Plan"].get("Local Hit Blocks", 0),
                "last_plan_local_read_blocks": last_plan["Plan"].get("Local Read Blocks", 0),
                "last_plan_shared_hit_blocks": last_plan["Plan"].get("Shared Hit Blocks", 0),
                "last_plan_shared_read_blocks": last_plan["Plan"].get("Shared Read Blocks", 0),
            }
        )
    lateral_summary.append(
        {"requested_pairs": pair_count, "parity": True, "variants": variants}
    )

output = {
    "database": args.database,
    "server_settings": server_settings,
    "fixture": {
        "movement_rows": SUBJECTS * HISTORY_PER_SUBJECT,
        "subjects": SUBJECTS,
        "skus": SKUS,
        "subjects_per_sku": SUBJECTS // SKUS,
        "history_facts_per_subject": HISTORY_PER_SUBJECT,
        "eligible_places": [WAREHOUSE_PLACE, PICKING_PLACE],
        "current_balance_per_subject": 1,
        "transaction_rolled_back": True,
    },
    "current_movement_indexes": [
        "(subject_id, occurred_at, fact_sequence)",
        "(from_place_id, to_place_id, occurred_at)",
        "(to_place_id, occurred_at)",
        "(from_place_id, occurred_at)",
    ],
    "candidate_movement_indexes": [
        "(subject_id, to_place_id)",
        "(subject_id, from_place_id)",
    ],
    "abba_cycles": args.cycles,
    "auto_plan_counts": {
        state: {"generic_plans": counts[0], "custom_plans": counts[1]}
        for state, counts in auto_counts.items()
    },
    "workloads": summary,
    "lateral_comparison": lateral_summary,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps(output, indent=2))
print(f"saved {args.output}")
