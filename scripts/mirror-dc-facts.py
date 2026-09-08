#!/usr/bin/env python3
"""Give the DC edge the facts the cloud ledger says it is holding.

    python3 scripts/mirror-dc-facts.py --db postgresql:///inventory_tanstack
    python3 scripts/mirror-dc-facts.py --db ... --undo

# Why this exists

A `TO_STORE` allotment out of `dc.warehouse` is judged by the DC node's own
facts, not by the cloud ledger — the centre may author the promise, but the
warehouse is the authority on whether the goods are on the racks. Cloud reads
those facts out of `edge_inventory_fact_position`, which is filled only by an
Edge node syncing.

In a development database seeded straight into Postgres, no DC node ever ran.
The cloud ledger says `dc.warehouse` holds thousands of pieces and
`edge_inventory_fact_position` holds nothing, so every allotment the New
allotment screen raises is refused — correctly, and unhelpfully.

This writes the mirror: one fact row per SKU the cloud ledger holds in
`dc.warehouse`, filed under the DC origin's own place id. That is the SAME row
a real DC node's checkpoint would produce, so nothing downstream can tell the
difference — and nothing downstream should have to.

**Development only.** These are facts nobody observed. On any database an Edge
node actually syncs into, this would fight the node for the same rows; run
`--undo` and let the node speak for itself.

# The name gap it steps over

Cloud names its single distribution centre `dc` and its shelves
`dc.warehouse`; the Edge names itself `dc-01` and the same shelves
`dc-01.warehouse`. Both are right in their own territory, and
`pool_id_for_site` in `cloud/postgres/sync.rs` is what translates between them
at the wire. This script writes the EDGE spelling, because that is what an Edge
node would have sent.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
import uuid

# The one DC the cloud pool model has, and the origin that owns it here. Read
# from the database rather than hardcoded would be better; there is exactly one
# DC origin by construction (`sole_dc_origin_tx` refuses if there are two), so
# the query below asks for it and this is only the fallback for an empty fleet.
CLOUD_DC_POOL = "dc.warehouse"

# A stable namespace, so re-running updates the same rows instead of inventing
# a second subject for every SKU.
SUBJECTS = uuid.uuid5(uuid.NAMESPACE_URL, "itulah/dev/mirror-dc-facts")


def psql(dsn: str, sql: str) -> str:
    done = subprocess.run(
        ["psql", "-d", dsn, "-v", "ON_ERROR_STOP=1", "-tAF", "\x1f", "-c", sql],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.exit(f"psql failed:\n{done.stderr.strip()}")
    return done.stdout


def availability(api: str, pool_id: str) -> list[dict]:
    """Every SKU the cloud ledger holds in the pool, walking the cursor."""
    items, cursor = [], ""
    while True:
        url = (
            f"{api}/api/v1/inventory/availability"
            f"?source_pool_id={pool_id}&limit=500"
            + (f"&cursor={cursor}" if cursor else "")
        )
        with urllib.request.urlopen(url) as answer:
            page = json.load(answer)
        items += page["items"]
        if not page["next_cursor"]:
            return items
        cursor = page["next_cursor"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Postgres DSN")
    parser.add_argument(
        "--api",
        default="http://127.0.0.1:8080",
        help="a cloud node on this database, for the availability read",
    )
    parser.add_argument("--pool", default=CLOUD_DC_POOL)
    parser.add_argument(
        "--undo",
        action="store_true",
        help="remove only the rows this script wrote",
    )
    args = parser.parse_args()

    origin = psql(
        args.db,
        "SELECT origin_id,site_id FROM sync_origin_credential "
        "WHERE inventory_enabled AND node_role='DC' ORDER BY origin_id LIMIT 1",
    ).strip()
    if not origin:
        sys.exit("no DC origin is registered; nothing to mirror onto")
    origin_id, site_id = origin.split("\x1f")

    if args.undo:
        # Matched on the fact generation this script stamps, so a real node's
        # rows are never in the blast radius.
        psql(
            args.db,
            "DELETE FROM edge_inventory_fact_position "
            f"WHERE origin_id='{origin_id}' AND last_seq=900000",
        )
        psql(
            args.db,
            "DELETE FROM edge_inventory_fact_subject_identity "
            f"WHERE origin_id='{origin_id}' AND first_seq=900000",
        )
        print(f"mirror removed from {origin_id}")
        return 0

    edge_place = f"{site_id}.{args.pool.split('.', 1)[1]}:on_hand"
    held = [row for row in availability(args.api, args.pool) if row["stock_qty"] > 0]
    if not held:
        sys.exit(f"the cloud ledger holds nothing in {args.pool}; nothing to mirror")

    statements = []
    for row in held:
        subject = uuid.uuid5(SUBJECTS, row["sku_code"])
        statements.append(
            "INSERT INTO edge_inventory_fact_subject_identity"
            "(origin_id,subject_id,epc,sku_code,first_generation,first_seq) "
            f"VALUES('{origin_id}','{subject}',NULL,'{row['sku_code']}',1,900000) "
            "ON CONFLICT DO NOTHING;"
        )
        statements.append(
            "INSERT INTO edge_inventory_fact_position"
            "(origin_id,subject_id,place_id,epc,sku_code,quantity,"
            "last_generation,last_seq) "
            f"VALUES('{origin_id}','{subject}','{edge_place}',NULL,"
            f"'{row['sku_code']}',{row['stock_qty']},1,900000) "
            "ON CONFLICT (origin_id,subject_id,place_id) "
            "DO UPDATE SET quantity=EXCLUDED.quantity;"
        )

    done = subprocess.run(
        ["psql", "-d", args.db, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input="\n".join(statements),
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.exit(f"psql write failed:\n{done.stderr.strip()}")

    pieces = sum(row["stock_qty"] for row in held)
    print(
        f"{len(held)} SKUs · {pieces} pieces mirrored from {args.pool} "
        f"onto {origin_id} at {edge_place}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
