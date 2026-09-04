#!/usr/bin/env python3
"""Make the Commercial screens show reach as well as intent.

A node can hold fifteen promotions and four campaigns and still draw "Never
used · 0 · No shop" down every row, because two tables the screens read are
written by paths a seeded database never went through:

  * `commercial_usage` is counted by the sync ingest as each sale fact lands
    (cloud/postgres/sync.rs). Sales inserted directly skip it, so the counters
    stay at zero while `edge_sale_promotion` holds the evidence.
  * `commercial_publication_activation` is written when a shop reports that it
    has put a book into service. With no edge nodes running, nothing reports,
    and every promotion reads as carried by no shop.

This derives the first from the sale facts already present — the same
arithmetic the ingest does, so the counters agree with the performance tiles
instead of being a second opinion — and writes the second as a fleet rollout.

    ITULAH_DB=inventory_tanstack python3 scripts/seed-commercial-reach.py

A shop activates every book it receives, not only the newest — books are
cumulative and a promotion is carried by whichever book declared it, so a shop
holding only the latest would read as carrying none of the earlier offers. Each
shop therefore gets a row per publication up to the version it has reached.

The rollout is deliberately uneven: most shops current, two stalled several
books back — which is what makes the newest promotions reach ten shops instead
of thirteen — and one that has never reported at all. A screen built to show
"which shop is behind" has nothing to show when every shop is identical, and
the never-reported row is the one the reader in `commercial_activation` calls
the most important and the easiest to leave out.

Re-running is safe: the counters are rebuilt from the facts rather than
incremented, and the activation insert is ON CONFLICT DO NOTHING.
"""

import os
import subprocess
import sys

DB = os.environ.get("ITULAH_DB", "inventory_tanstack")

# Which shops are on which book. Everything not named here goes on the newest.
BEHIND = {"store-09-edge": 12, "store-11-edge": 12}
SILENT = {"store-13-edge"}


def sql(statement, quiet=False):
    done = subprocess.run(
        ["psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAc", statement],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.exit(f"psql failed against {DB}: {done.stderr.strip()}")
    if not quiet and done.stderr.strip():
        print(done.stderr.strip())
    return done.stdout.strip()


# ── what the offers actually cost ──────────────────────────────────────────
#
# One sale can carry a rule, the campaign that rule belongs to and the coupon
# that unlocked it, and the ingest counts all three separately — so the same
# benefit is booked under three keys on purpose. `LATERAL VALUES` is that fan
# out, and the WHERE drops the keys a sale did not carry.
sql("DELETE FROM commercial_usage_customer")
sql("DELETE FROM commercial_usage")
sql(
    """
    INSERT INTO commercial_usage (kind, key, uses, spent_minor, first_used_at, last_used_at)
    SELECT k.kind, k.key, count(*), sum(p.benefit_minor),
           min(s.occurred_at), max(s.occurred_at)
      FROM edge_sale_promotion p
      JOIN edge_sale s ON s.sale_id = p.sale_id
     CROSS JOIN LATERAL (VALUES
             ('RULE',     p.rule_id),
             ('CAMPAIGN', p.campaign_id),
             ('COUPON',   p.coupon_code)
           ) AS k(kind, key)
     WHERE k.key IS NOT NULL AND btrim(k.key) <> ''
     GROUP BY k.kind, k.key
    """
)

# A per-customer limit is meaningless for an anonymous sale, so a sale with no
# customer contributes to the totals above and to nothing here.
sql(
    """
    INSERT INTO commercial_usage_customer (kind, key, customer_id, uses, last_used_at)
    SELECT k.kind, k.key, s.customer_id, count(*), max(s.occurred_at)
      FROM edge_sale_promotion p
      JOIN edge_sale s ON s.sale_id = p.sale_id
     CROSS JOIN LATERAL (VALUES
             ('RULE',     p.rule_id),
             ('CAMPAIGN', p.campaign_id),
             ('COUPON',   p.coupon_code)
           ) AS k(kind, key)
     WHERE k.key IS NOT NULL AND btrim(k.key) <> ''
       AND s.customer_id IS NOT NULL AND btrim(s.customer_id) <> ''
     GROUP BY k.kind, k.key, s.customer_id
    """
)
counted = sql("SELECT count(*)||' keys, '||sum(uses)||' uses' FROM commercial_usage")
print(f"usage rebuilt from sale facts: {counted}")

# ── which shop is charging which book ──────────────────────────────────────
newest = sql(
    """
    SELECT max(version) FROM commercial_publication
     WHERE status = 'PUBLISHED' AND effective_from <= now()
       AND (effective_to IS NULL OR effective_to > now())
    """
)
if newest == "":
    sys.exit("No published book is in force; nothing to activate.")

for origin in sql(
    "SELECT origin_id FROM sync_origin_credential WHERE node_role='STORE' ORDER BY origin_id"
).splitlines():
    origin = origin.strip()
    if origin == "" or origin in SILENT:
        continue
    version = BEHIND.get(origin, int(newest))
    sql(
        f"""
        INSERT INTO commercial_publication_activation
               (publication_id, origin_id, site_id, version, activated_at,
                reported_at, price_rule_count)
        SELECT p.id, c.origin_id, c.site_id, p.version,
               p.published_at, p.published_at,
               (SELECT count(*) FROM commercial_price_rule r WHERE r.publication_id = p.id)
          FROM commercial_publication p
          JOIN sync_origin_credential c ON c.origin_id = '{origin}'
         WHERE p.status = 'PUBLISHED' AND p.version <= {version}
        ON CONFLICT (publication_id, origin_id) DO NOTHING
        """
    )

rolled = sql(
    "SELECT count(DISTINCT origin_id)||' shops, '||count(*)||' activations, newest per shop '"
    "|| (SELECT string_agg(DISTINCT v::text, ',' ORDER BY v::text) "
    "      FROM (SELECT max(version) v FROM commercial_publication_activation "
    "             GROUP BY origin_id) t) "
    "FROM commercial_publication_activation"
)
print(f"books put into service: {rolled}")
print(f"never reported: {', '.join(sorted(SILENT))}")
