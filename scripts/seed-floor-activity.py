#!/usr/bin/env python3
"""What happened to the stock after it reached the shop: it was counted, it was
read by a handheld, and some of it was sold through a till that reported back.

    python3 scripts/seed-floor-activity.py --db "$DATABASE_URL"

Runs last, after `seed-full-chain.py` and `seed-commercial-and-trade.py`,
because everything here points at units those two put on a shelf. Three things,
each of which leaves a different screen empty when it is missing:

  1. OFFICIAL COUNTS — a count is a snapshot of what the ledger expected and a
     set of entries saying what was actually found. Seeding the count header
     without the snapshot gives a count of nothing, which is how the Counts
     screen ends up drawing an empty sheet against a count that says it covered
     four hundred units.

  2. OBSERVATIONS — what a handheld saw on the floor. `observation_sighting`
     insists `method = 'RFID_HANDHELD'` and joins back to a real device and a
     real pool, so a sighting is evidence a specific reader produced, not a
     free-floating row.

  3. EDGE SALE FACTS — the till's own record of a sale, which is a DIFFERENT
     thing from the cloud `sale` row: `sales.rs` writes one when the sale is
     made at the centre, `sync.rs` writes the other when a shop reports one.
     `commercial_usage` is counted from the edge facts alone, so a database
     with cloud sales and no edge facts shows every promotion as never used —
     which is true, and which is why the promotions here are attached to edge
     sales rather than invented in the counter table.

Discrepancies are deliberate. A count where everything is found is a count that
proves nothing, so a small proportion of units come back short or in the wrong
pool — which is the case the variance column exists for.

Deterministic and re-runnable: every id derives from a stable name and every
insert is guarded by a count check.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import subprocess
import sys
import uuid
from datetime import datetime, timedelta

NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")


def rid(name: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, name)


class Db:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def rows(self, query: str) -> list[list[str]]:
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-tAF", "\x1f", "-c", query],
            capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"psql read failed:\n{done.stderr.strip()}")
        return [line.split("\x1f") for line in done.stdout.splitlines() if line]

    def one(self, query: str) -> str:
        got = self.rows(query)
        return got[0][0] if got else ""

    def run(self, sql: str) -> None:
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
            input=sql, capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"psql write failed:\n{done.stderr.strip()}")
        if done.stdout.strip():
            print(done.stdout.strip())

    def copy(self, table: str, columns: list[str], records: list[tuple]) -> None:
        if not records:
            return
        buffer = io.StringIO()
        for record in records:
            buffer.write("\t".join(_tsv(v) for v in record))
            buffer.write("\n")
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-q",
             "-c", f"\\copy {table} ({', '.join(columns)}) FROM STDIN"],
            input=buffer.getvalue(), capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"COPY into {table} failed:\n{done.stderr.strip()}")


def _tsv(value) -> str:
    if value is None:
        return "\\N"
    if isinstance(value, bool):
        return "t" if value else "f"
    return (str(value).replace("\\", "\\\\").replace("\t", "\\t")
            .replace("\n", "\\n").replace("\r", "\\r"))


def q(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


# --------------------------------------------------------------------------
# 1. counts
# --------------------------------------------------------------------------

def seed_counts(db: Db, rng: random.Random) -> None:
    """A count per pool that has stock in it, with the shortages real counts find."""
    if db.one("SELECT count(*) FROM count_snapshot") != "0":
        print("counts already have snapshots — skipping")
        return

    pools = db.rows(
        """
        SELECT p.place_id, count(*)::text
          FROM inventory_projection p
         WHERE p.place_id LIKE '%:on_hand'
         GROUP BY p.place_id
        HAVING count(*) >= 30
         ORDER BY count(*) DESC
         LIMIT 8
        """
    )
    if not pools:
        sys.exit("no pool holds enough stock to be worth counting")

    now = datetime.now()
    counts, snapshots, entries = [], [], []

    for index, (place_id, held) in enumerate(pools):
        pool_id = place_id.rsplit(":", 1)[0]
        site_id = pool_id.split(".", 1)[0]
        count_id = rid(f"count:{place_id}")
        counted_on = now - timedelta(days=7 * index + rng.randint(1, 5))

        units = db.rows(
            f"""
            SELECT subject_id FROM inventory_projection
             WHERE place_id = {q(place_id)}
             ORDER BY subject_id
             LIMIT 400
            """
        )
        counts.append(
            (count_id, site_id, pool_id, "CYCLE", "CLOSED",
             json.dumps({"pool_id": pool_id}),
             "Scheduled cycle count", "stock-controller",
             counted_on - timedelta(days=1), counted_on,
             counted_on + timedelta(hours=4), counted_on + timedelta(hours=6),
             None, None, None, None, None, None, None, None, None, None, None)
        )
        for (subject_id,) in units:
            snapshots.append((count_id, subject_id, 1, place_id))
            # Most units are found. A few are not, which is the entire reason
            # anybody counts: a count that always agrees with the ledger is a
            # count nobody needs to run.
            found = 0 if rng.random() < 0.035 else 1
            entries.append(
                (count_id, subject_id, found, "stock-counter",
                 counted_on + timedelta(minutes=rng.randint(1, 220)))
            )

    db.copy(
        "official_count",
        ["id", "site_id", "pool_id", "kind", "status", "scope_json", "reason",
         "created_by", "created_at", "activated_at", "submitted_at", "closed_at",
         "approval_movement_group_id", "activation_command_id", "activation_target_origin_id",
         "edge_result_id", "edge_result_received_at", "adjustment_id", "adjustment_command_id",
         "adjustment_target_origin_id", "edge_adjustment_completion_id",
         "edge_adjustment_received_at", "edge_adjustment_status"],
        counts,
    )
    db.copy("count_snapshot", ["count_id", "subject_id", "expected_quantity", "expected_place_id"], snapshots)
    db.copy("count_entry", ["count_id", "subject_id", "found_quantity", "recorded_by", "recorded_at"], entries)
    missing = sum(1 for e in entries if e[2] == 0)
    print(f"  {len(counts)} counts, {len(snapshots)} expected, {len(entries)} counted, {missing} not found")


# --------------------------------------------------------------------------
# 2. what a handheld saw
# --------------------------------------------------------------------------

def seed_observations(db: Db, rng: random.Random) -> None:
    # Count only sightings that resolved to a unit. A node that has been read
    # by a handheld before this ran holds rows with a NULL `subject_id` — tags
    # seen on the floor that matched nothing — and treating those as "already
    # seeded" leaves the screen showing reads that identify nothing at all.
    if db.one("SELECT count(*) FROM observation_sighting WHERE subject_id IS NOT NULL") != "0":
        print("observations already present — skipping")
        return

    devices = db.rows(
        """
        SELECT d.device_id, p.pool_id
          FROM rfid_device d
          JOIN rfid_device_pool p ON p.device_id = d.device_id
         WHERE d.active
         ORDER BY d.device_id, p.pool_id
        """
    )
    if not devices:
        print("no RFID device is registered — skipping observations")
        return

    now = datetime.now()
    sightings = []
    for device_id, pool_id in devices:
        site_id = pool_id.split(".", 1)[0]
        units = db.rows(
            f"""
            SELECT p.subject_id, b.epc
              FROM inventory_projection p
              JOIN inventory_subject b ON b.id = p.subject_id
             WHERE p.place_id = {q(pool_id + ':on_hand')} AND b.epc IS NOT NULL
             ORDER BY b.epc
             LIMIT 150
            """
        )
        for sequence, (subject_id, epc) in enumerate(units, start=1):
            first = now - timedelta(days=rng.randint(1, 25), minutes=rng.randint(0, 600))
            sightings.append(
                (rid(f"sighting:{device_id}:{epc}"), subject_id, epc, site_id, pool_id,
                 first, first + timedelta(seconds=rng.randint(1, 90)), first,
                 device_id, str(rid(f"reader-session:{device_id}:{first:%Y%m%d}")),
                 "RFID_HANDHELD", rng.randint(1, 14),
                 round(rng.uniform(-72.0, -38.0), 1), str(rng.randint(1, 4)),
                 "wh-operator", None, None, sequence)
            )

    db.copy(
        "observation_sighting",
        ["observation_id", "subject_id", "epc", "site_id", "pool_id", "first_seen_at",
         "last_seen_at", "received_at", "device_id", "reader_session_id", "method",
         "read_count", "best_rssi", "antenna", "operator_id", "edge_origin_id",
         "edge_batch_id", "device_sequence"],
        sightings,
    )
    print(f"  {len(sightings)} sightings from {len({d for d, _ in devices})} handhelds")


# --------------------------------------------------------------------------
# 3. the till's own record, and what the offers cost
# --------------------------------------------------------------------------

def seed_edge_sales(db: Db, rng: random.Random, wanted: int) -> None:
    """Sales as a SHOP reported them, which is where promotion usage comes from.

    Only shops with a registered sync origin can report: `edge_sale.origin_id`
    is the credential the cloud issued that node, and a fact from an
    unregistered origin is one the ingest would have refused.
    """
    if db.one("SELECT count(*) FROM edge_sale") != "0":
        print("edge sale facts already present — skipping")
        return

    origins = db.rows(
        "SELECT origin_id, site_id FROM sync_origin_credential WHERE node_role='STORE' ORDER BY origin_id"
    )
    if not origins:
        print("no shop has a registered sync origin — skipping edge sales")
        return

    rules = [r[0] for r in db.rows("SELECT rule_id FROM commercial_rule ORDER BY rule_id")]
    campaigns = {r[0]: r[1] for r in db.rows("SELECT campaign_id, name FROM commercial_campaign ORDER BY campaign_id")}
    coupons = [r[0] for r in db.rows("SELECT code FROM commercial_coupon WHERE active ORDER BY code")]
    members = [r[0] for r in db.rows("SELECT member_id FROM member ORDER BY member_id LIMIT 120")]

    now = datetime.now()
    sales, lines, promotions, tenders = [], [], [], []
    seq = 0

    for origin_id, site_id in origins:
        units = db.rows(
            f"""
            SELECT l.subject_id, b.epc, k.sku_code, l.unit_price_minor,
                   to_char(s.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS')
              FROM sale s
              JOIN sale_line l ON l.sale_id = s.id
              JOIN inventory_subject b ON b.id = l.subject_id
              JOIN sku k ON k.id = l.sku_id
             WHERE s.site_id = {q(site_id)} AND s.status = 'COMPLETED'
             ORDER BY s.completed_at DESC
             LIMIT {wanted}
            """
        )
        for subject_id, epc, sku_code, price, sold_at in units:
            seq += 1
            sale_id = rid(f"edge-sale:{origin_id}:{seq}")
            price = int(price)
            # An offer takes something off roughly a third of baskets, which is
            # what makes "what did this promotion cost us" a real number.
            benefit = 0
            rule = campaign = coupon = None
            if rules and rng.random() < 0.34:
                rule = rng.choice(rules)
                campaign = rng.choice(list(campaigns)) if campaigns and rng.random() < 0.7 else None
                coupon = rng.choice(coupons) if coupons and rng.random() < 0.25 else None
                benefit = int(price * rng.uniform(0.05, 0.3) // 1000) * 1000
            total = price - benefit
            occurred = datetime.fromisoformat(sold_at)

            sales.append(
                (sale_id, origin_id, 1, seq, rid(f"edge-group:{sale_id}"), site_id,
                 f"{site_id}-till", occurred, "IDR", total, total, 0, occurred,
                 benefit, total // 10000,
                 None, rng.choice(members) if members and rng.random() < 0.45 else None)
            )
            lines.append(
                (sale_id, subject_id, epc, sku_code, 1, total, total,
                 "PUBLICATION", None, price, None)
            )
            if rule:
                promotions.append((sale_id, rule, campaign, coupon, benefit))
            tenders.append(
                (sale_id, 1, rng.choices(["CASH", "CARD", "QRIS", "VOUCHER"],
                                         weights=[36, 30, 30, 4])[0], total, None)
            )

    db.copy(
        "edge_sale",
        ["sale_id", "origin_id", "generation", "seq", "movement_group_id", "site_id",
         "actor_id", "occurred_at", "currency", "total_minor", "paid_minor", "change_minor",
         "received_at", "discount_total_minor", "points_earned", "pricing_trace_id", "customer_id"],
        sales,
    )
    db.copy(
        "edge_sale_line",
        ["sale_id", "subject_id", "epc", "sku_code", "quantity", "unit_price_minor",
         "line_total_minor", "price_source", "publication_version", "base_unit_price_minor",
         "markdown_id"],
        lines,
    )
    db.copy(
        "edge_sale_promotion",
        ["sale_id", "rule_id", "campaign_id", "coupon_code", "benefit_minor"],
        promotions,
    )
    db.copy(
        "edge_sale_tender",
        ["sale_id", "tender_seq", "method", "amount_minor", "reference"],
        tenders,
    )
    print(f"  {len(sales)} edge sales from {len(origins)} shops, {len(promotions)} carrying an offer")


AUDIT = """
\\pset border 2
SELECT 'count snapshots on a unit that does not exist' AS link, count(*) AS broken
  FROM count_snapshot s WHERE NOT EXISTS (SELECT 1 FROM inventory_subject b WHERE b.id=s.subject_id)
UNION ALL SELECT 'count entries with no snapshot beside them', count(*) FROM count_entry e
  WHERE NOT EXISTS (SELECT 1 FROM count_snapshot s WHERE s.count_id=e.count_id AND s.subject_id=e.subject_id)
UNION ALL SELECT 'counts whose snapshot place is not where the unit was', count(*)
  FROM count_snapshot s
  LEFT JOIN inventory_projection p ON p.subject_id=s.subject_id AND p.place_id=s.expected_place_id
 WHERE p.subject_id IS NULL
UNION ALL SELECT 'sightings of a unit that does not exist', count(*) FROM observation_sighting o
 WHERE o.subject_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_subject b WHERE b.id=o.subject_id)
UNION ALL SELECT 'sightings whose EPC does not match the unit', count(*) FROM observation_sighting o
  JOIN inventory_subject b ON b.id=o.subject_id WHERE b.epc <> o.epc
UNION ALL SELECT 'sightings from an unregistered device', count(*) FROM observation_sighting o
 WHERE NOT EXISTS (SELECT 1 FROM rfid_device d WHERE d.device_id=o.device_id)
UNION ALL SELECT 'edge sales from an unregistered origin', count(*) FROM edge_sale e
 WHERE NOT EXISTS (SELECT 1 FROM sync_origin_credential c WHERE c.origin_id=e.origin_id)
UNION ALL SELECT 'edge sale lines whose EPC is unknown', count(*) FROM edge_sale_line l
 WHERE NOT EXISTS (SELECT 1 FROM inventory_subject b WHERE b.epc=l.epc)
UNION ALL SELECT 'promotions naming a rule that does not exist', count(*) FROM edge_sale_promotion p
 WHERE NOT EXISTS (SELECT 1 FROM commercial_rule r WHERE r.rule_id=p.rule_id)
UNION ALL SELECT 'edge sales that do not balance', count(*) FROM edge_sale
 WHERE paid_minor - total_minor <> change_minor
ORDER BY 2 DESC, 1;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("ITULAH_DB", ""))
    parser.add_argument("--edge-sales", type=int, default=180, help="edge sale facts per shop")
    parser.add_argument("--seed", type=int, default=20260905)
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()

    if not args.db:
        sys.exit("--db is required (or set ITULAH_DB)")
    db = Db(args.db)

    if args.audit:
        subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
        return 0

    rng = random.Random(args.seed)
    seed_counts(db, rng)
    seed_observations(db, rng)
    seed_edge_sales(db, rng, args.edge_sales)

    print()
    subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
