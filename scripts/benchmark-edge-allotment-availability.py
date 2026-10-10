#!/usr/bin/env python3
"""Compare edge-position lookup plans with and without a SKU-code index.

The fixture is connection-local and the entire run is rolled back. It creates
250,000 current positions across 10,000 SKUs, then benchmarks the same JSONB
recordset query used by `load_edge_create_availability` for 10 and 200
requested source-pool/SKU pairs. No application or shared database tables are
modified.

Run:
    python3 scripts/benchmark-edge-allotment-availability.py
    python3 scripts/benchmark-edge-allotment-availability.py \
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
POSITION_ROWS = 250_000
SKU_COUNT = 10_000
REQUEST_SIZES = (10, 200)
ORIGIN_ID = "bench-allotment-origin"
SOURCE_POOL_ID = "bench.warehouse"
PLACES = ["bench.warehouse:on_hand", "bench.picking:on_hand"]
CANDIDATE_INDEX = "bench_edge_position_origin_sku_place"

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
    default=Path(__file__).resolve().parents[1] / "outputs/edge-allotment-availability.json",
)
args = parser.parse_args()
if args.cycles < 1:
    parser.error("--cycles must be positive")


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sku_code(number: int) -> str:
    return f"SKU-{number:05d}"


def sku_id(number: int) -> str:
    # PostgreSQL's md5(text)::uuid is deterministic and unique for this fixture.
    return str(UUID(hashlib.md5(f"bench-sku-{number:05d}".encode()).hexdigest()))


def request_payload(pair_count: int) -> str:
    rows = [
        {
            "source_pool_id": SOURCE_POOL_ID,
            "sku_id": sku_id(number),
            "sku_code": sku_code(number),
            "places": PLACES,
        }
        for number in range(1, pair_count + 1)
    ]
    return json.dumps(rows, separators=(",", ":"))


query = """WITH requested AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS line(source_pool_id text, sku_id uuid, sku_code text, places text[])
), normal AS (
    SELECT requested.source_pool_id,requested.sku_id,
           sum(position.quantity)::bigint AS quantity
      FROM requested
      JOIN bench_edge_inventory_fact_position position
        ON position.origin_id=$2
       AND position.sku_code=requested.sku_code
       AND position.place_id=ANY(requested.places)
     GROUP BY requested.source_pool_id,requested.sku_id
)
SELECT requested.source_pool_id,requested.sku_id,
       COALESCE(normal.quantity,0)::bigint AS normal_quantity
  FROM requested
  LEFT JOIN normal USING(source_pool_id,sku_id)"""

sql = [
    "BEGIN;",
    "SET LOCAL statement_timeout = '60s';",
    "SET LOCAL work_mem = '128MB';",
    "SET LOCAL plan_cache_mode = force_custom_plan;",
    "CREATE TEMP TABLE bench_edge_inventory_fact_position (",
    "    origin_id text NOT NULL,",
    "    subject_id uuid NOT NULL,",
    "    place_id text NOT NULL,",
    "    epc text,",
    "    sku_code text,",
    "    quantity bigint NOT NULL,",
    "    PRIMARY KEY (origin_id, subject_id, place_id)",
    ");",
    f"INSERT INTO bench_edge_inventory_fact_position (origin_id,subject_id,place_id,sku_code,quantity)",
    f"SELECT {sql_literal(ORIGIN_ID)},",
    "       md5('bench-subject-' || n::text)::uuid,",
    "       CASE WHEN ((n - 1) % 25) < 13",
    f"            THEN {sql_literal(PLACES[0])} ELSE {sql_literal(PLACES[1])} END,",
    "       'SKU-' || lpad((((n - 1) / 25) + 1)::text, 5, '0'),",
    "       1::bigint",
    f"  FROM generate_series(1,{POSITION_ROWS}) AS generated(n);",
    "CREATE INDEX bench_edge_position_place",
    "    ON bench_edge_inventory_fact_position(origin_id,place_id);",
    "CREATE UNIQUE INDEX bench_edge_position_epc",
    "    ON bench_edge_inventory_fact_position(origin_id,epc) WHERE epc IS NOT NULL;",
    "ANALYZE bench_edge_inventory_fact_position;",
    f"PREPARE edge_availability(jsonb,text) AS {query};",
]

for pair_count in REQUEST_SIZES:
    payload = sql_literal(request_payload(pair_count))
    sql.extend(
        [
            f"\\echo PARITY|old|{pair_count}",
            f"EXECUTE edge_availability({payload}::jsonb,{sql_literal(ORIGIN_ID)});",
        ]
    )

sql.extend(
    [
        f"CREATE INDEX {CANDIDATE_INDEX}",
        "    ON bench_edge_inventory_fact_position(origin_id,sku_code,place_id)",
        "    WHERE sku_code IS NOT NULL;",
        "ANALYZE bench_edge_inventory_fact_position;",
    ]
)
for pair_count in REQUEST_SIZES:
    payload = sql_literal(request_payload(pair_count))
    sql.extend(
        [
            f"\\echo PARITY|candidate|{pair_count}",
            f"EXECUTE edge_availability({payload}::jsonb,{sql_literal(ORIGIN_ID)});",
        ]
    )
sql.append(f"DROP INDEX pg_temp.{CANDIDATE_INDEX};")

# Warm both plan shapes before recording the ABBA matrix. Index build/drop time
# is deliberately excluded: this compares query execution, not migration cost.
for index_state in ("old", "candidate"):
    if index_state == "candidate":
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_INDEX}",
                "    ON bench_edge_inventory_fact_position(origin_id,sku_code,place_id)",
                "    WHERE sku_code IS NOT NULL;",
                "ANALYZE bench_edge_inventory_fact_position;",
            ]
        )
    for pair_count in REQUEST_SIZES:
        payload = sql_literal(request_payload(pair_count))
        sql.append(
            f"EXECUTE edge_availability({payload}::jsonb,{sql_literal(ORIGIN_ID)});"
        )
    if index_state == "candidate":
        sql.append(f"DROP INDEX pg_temp.{CANDIDATE_INDEX};")

states = ["old", "candidate", "candidate", "old"] * args.cycles
candidate_present = False
for run_number, index_state in enumerate(states, start=1):
    if index_state == "candidate" and not candidate_present:
        sql.extend(
            [
                f"CREATE INDEX {CANDIDATE_INDEX}",
                "    ON bench_edge_inventory_fact_position(origin_id,sku_code,place_id)",
                "    WHERE sku_code IS NOT NULL;",
                "ANALYZE bench_edge_inventory_fact_position;",
            ]
        )
        candidate_present = True
    elif index_state == "old" and candidate_present:
        sql.append(f"DROP INDEX pg_temp.{CANDIDATE_INDEX};")
        candidate_present = False

    sizes = REQUEST_SIZES if run_number % 2 else tuple(reversed(REQUEST_SIZES))
    for pair_count in sizes:
        payload = sql_literal(request_payload(pair_count))
        sql.extend(
            [
                f"\\echo PLAN|{pair_count}|{index_state}|{run_number}",
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "
                f"EXECUTE edge_availability({payload}::jsonb,{sql_literal(ORIGIN_ID)});",
            ]
        )

sql.extend(["ROLLBACK;"])
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

parity_rows: dict[tuple[str, int], dict[tuple[str, str], int]] = {}
plans: list[dict] = []
mode = None
plan_lines: list[str] = []
for line in result.stdout.splitlines():
    if line.startswith("PARITY|"):
        _, index_state, pair_count = line.split("|")
        mode = ("parity", index_state, int(pair_count))
        parity_rows[mode[1:]] = {}
    elif line.startswith("PLAN|"):
        _, pair_count, index_state, run_number = line.split("|")
        mode = ("plan", int(pair_count), index_state, int(run_number))
        plan_lines = []
    elif mode and mode[0] == "parity" and line:
        source_pool, requested_sku, quantity = line.split("\t")
        parity_rows[(mode[1], mode[2])][(source_pool, requested_sku)] = int(quantity)
    elif mode and mode[0] == "plan" and line:
        plan_lines.append(line)
        try:
            plan_json = json.loads("\n".join(plan_lines))
        except json.JSONDecodeError:
            continue
        plans.append(
            {
                "pairs": mode[1],
                "index": mode[2],
                "run": mode[3],
                "plan": plan_json[0],
            }
        )
        mode = None

for pair_count in REQUEST_SIZES:
    old = parity_rows.get(("old", pair_count), {})
    candidate = parity_rows.get(("candidate", pair_count), {})
    expected = {
        (SOURCE_POOL_ID, sku_id(number)): 25
        for number in range(1, pair_count + 1)
    }
    if old != candidate or old != expected:
        raise RuntimeError(
            f"parity failed for {pair_count} pairs: old={len(old)}, "
            f"candidate={len(candidate)}, expected={len(expected)}"
        )

if len(plans) != len(states) * len(REQUEST_SIZES):
    raise RuntimeError(f"expected {len(states) * len(REQUEST_SIZES)} plans, got {len(plans)}")


def index_names(node: dict) -> list[str]:
    names = [node["Index Name"]] if node.get("Index Name") else []
    for child in node.get("Plans", []):
        names.extend(index_names(child))
    return names


def plan_nodes(node: dict) -> list[dict]:
    current = {
        key: node[key]
        for key in (
            "Node Type",
            "Relation Name",
            "Index Name",
            "Actual Rows",
            "Actual Loops",
            "Local Hit Blocks",
            "Local Read Blocks",
        )
        if key in node
    }
    return [current] + [
        child_summary
        for child in node.get("Plans", [])
        for child_summary in plan_nodes(child)
    ]


workloads = []
for pair_count in REQUEST_SIZES:
    workload_plans = [plan for plan in plans if plan["pairs"] == pair_count]
    summary = {}
    for index_state in ("old", "candidate"):
        entries = [plan for plan in workload_plans if plan["index"] == index_state]
        execution_times = [entry["plan"]["Execution Time"] for entry in entries]
        last_node = entries[-1]["plan"]["Plan"]
        summary[index_state] = {
            "median_execution_ms": statistics.median(execution_times),
            "runs_execution_ms": execution_times,
            "last_plan_index_names": sorted(set(index_names(last_node))),
            "last_plan_nodes": plan_nodes(last_node),
            "last_plan_local_hit_blocks": last_node.get("Local Hit Blocks", 0),
            "last_plan_local_read_blocks": last_node.get("Local Read Blocks", 0),
            "last_plan_shared_hit_blocks": last_node.get("Shared Hit Blocks", 0),
            "last_plan_shared_read_blocks": last_node.get("Shared Read Blocks", 0),
        }
    workloads.append(
        {
            "requested_pairs": pair_count,
            "parity": True,
            "quantity_per_sku": 25,
            "candidate_speedup": round(
                summary["old"]["median_execution_ms"]
                / summary["candidate"]["median_execution_ms"],
                2,
            ),
            "indexes": summary,
        }
    )

output = {
    "database": args.database,
    "fixture": {
        "position_rows": POSITION_ROWS,
        "distinct_skus": SKU_COUNT,
        "origins": 1,
        "places_per_request": PLACES,
        "transactions_rolled_back": True,
    },
    "baseline_indexes": [
        "PRIMARY KEY (origin_id, subject_id, place_id)",
        "(origin_id, place_id)",
        "UNIQUE (origin_id, epc) WHERE epc IS NOT NULL",
    ],
    "candidate_index": (
        "(origin_id, sku_code, place_id) WHERE sku_code IS NOT NULL"
    ),
    "abba_cycles": args.cycles,
    "workloads": workloads,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps(output, indent=2))
print(f"saved {args.output}")
