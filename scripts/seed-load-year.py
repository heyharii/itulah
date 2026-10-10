#!/usr/bin/env python3
"""Seed one client-year of goods + money flow for load testing.

Set-based SQL into ONE business database (a rig made from the sandbox
template `itulah_blank`, or a `biz_*` database on the GCP sandbox VM).
Everything is deterministic (`md5(tag||n)::uuid`, modular arithmetic), so a
re-run replays instead of duplicating, and every row lands behind
`ON CONFLICT DO NOTHING`.

Model per 1,000,000 till sales/year (13 stores):
  2.0M sale lines, 2.2M pieces bought (1 TAGGED piece = 1 subject = 1 EPC),
  ~23k POs (4 lines x 24 pcs), ~350 day-bucket deliveries, ~650 weekly
  allotments, ~23k supplier bills left DRAFT (a bill must be POSTED — journal
  + open fiscal period — before anything may settle it, and posting is the
  app's job: the money ledger grows when the load test drives the real
  payables/sales-posting flow, which is itself a lane to measure).

    python3 scripts/seed-load-year.py --database rig_seed_check --scale 0.02
    python3 scripts/seed-load-year.py --database sim_rig_load_year --create
    # on the sandbox VM (business db from `business.database_name`):
    python3 scripts/seed-load-year.py --database biz_load_1m \
        --psql-cmd "docker exec -i pg psql -U itulah" --verify
"""

import argparse
import json
import math
import shlex
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--database", default="sim_rig_load_year")
parser.add_argument("--psql-cmd", default="psql",
                    help="psql command line; on the sandbox VM: "
                         "'docker exec -i pg psql -U itulah'")
parser.add_argument("--create", action="store_true",
                    help="create the database from the template first (--template)")
parser.add_argument("--template", default="itulah_blank")
parser.add_argument("--sales", type=int, default=1_000_000, help="till sales/year")
parser.add_argument("--stores", type=int, default=13)
parser.add_argument("--scale", type=float, default=1.0, help="multiply every volume")
parser.add_argument("--year", type=int, default=2025, help="the trading year seeded")
parser.add_argument("--images", choices=("none", "pool"), default="pool",
                    help="sample article images from the R2 pool JSON instead of NULL")
parser.add_argument("--image-pool", default="data/supplier-images-hm.json")
parser.add_argument("--phase", default="", help="comma-separated phases to run (default all)")
parser.add_argument("--verify", action="store_true", help="run invariant checks after seeding")
args = parser.parse_args()

RUN = set(args.phase.split(",")) if args.phase else None


def phase(name):
    return RUN is None or name in RUN


# ---- the model ---------------------------------------------------------------

S = args.scale
SALES = round(args.sales * S)
PCS_PER_SALE = 2
PCS_SOLD = SALES * PCS_PER_SALE
PCS_BOUGHT = round(PCS_SOLD * 1.10)          # buffer, dead stock, shrink
STOREBOUND = round(PCS_BOUGHT * 0.85)        # pieces that reach a store
ARTICLES = max(30, round(12_000 * S))
SKUS_PER_ARTICLE = 16                        # 4 colours x 4 sizes
SKUS = ARTICLES * SKUS_PER_ARTICLE
SUPPLIERS = max(10, round(150 * S))
SUPPLIER_ITEMS = max(20, round(30_000 * S))
PO_PCS_PER_LINE = 24
PO_LINES = math.ceil(PCS_BOUGHT / PO_PCS_PER_LINE)
POS = math.ceil(PO_LINES / 4)
RECEIPTS = round(POS * 1.05)                 # one delivery per day bucket
MEMBERS = max(50, round(80_000 * S))
DAYS = 360
KOLI_PCS = 10
PCS_PER_STORE = max(1, STOREBOUND // args.stores)

print("model:", json.dumps({
    "sales": SALES, "sale_lines": PCS_SOLD, "pieces_bought": PCS_BOUGHT,
    "storebound": STOREBOUND, "articles": ARTICLES, "skus": SKUS,
    "suppliers": SUPPLIERS, "supplier_items": SUPPLIER_ITEMS, "pos": POS,
    "po_lines": PO_LINES, "receipts": RECEIPTS, "members": MEMBERS,
    "year": args.year, "stores": args.stores,
}))

psql_argv = shlex.split(args.psql_cmd)


def psql(sql, quiet=False):
    started = time.time()
    result = subprocess.run(
        psql_argv + ["-1", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", args.database],
        input=sql, text=True, capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed on:\n---\n{sql[:600]}\n---\n{result.stderr[-1500:]}")
    out = result.stdout.strip()
    if not quiet:
        print(f"  [{time.time() - started:6.1f}s] {out[:300]}" if out
              else f"  [{time.time() - started:6.1f}s] ok")


def has_column(table, column):
    probe = subprocess.run(
        psql_argv + ["-X", "-q", "-t", "-A", args.database],
        input=f"SELECT 1 FROM information_schema.columns "
              f"WHERE table_name = '{table}' AND column_name = '{column}'",
        text=True, capture_output=True, check=True,
    )
    return probe.stdout.strip() == "1"


EDGE_SALE_DAY = has_column("edge_sale", "business_date")


def ts(day_expr, hour_expr):
    """timestamptz for a day-of-year (1..360) and hour, UTC+7."""
    return (f"('{args.year}-01-01 00:00+07'::timestamptz + "
            f"(({day_expr}) - 1) * interval '1 day' + ({hour_expr}) * interval '1 hour')")


# ---- 0. rig ------------------------------------------------------------------

if args.create:
    subprocess.run(["createdb", "-T", args.template, args.database], check=True)
    print(f"created {args.database} from template {args.template}")

# ---- 1. organisation + masters ----------------------------------------------

if phase("org"):
    print(f"org: 1 HO + {args.stores} stores (units, sites, pools, places)")
    psql(f"""
    INSERT INTO unit (id, code, name, kind, status, created_at, updated_at)
    VALUES ('ho', 'HO', 'Head office', 'HO', 'ACTIVE', now(), now())
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO unit (id, code, name, kind, status, created_at, updated_at)
    SELECT 'store-c' || lpad(g::text, 3, '0'), 'C' || lpad(g::text, 3, '0'),
           'Toko Load ' || lpad(g::text, 2, '0'), 'STORE', 'ACTIVE', now(), now()
      FROM generate_series(1, {args.stores}) g
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO site (id, name, kind, edge_node_id, created_at, city, timezone, unit_id, code)
    VALUES ('ho-gudang', 'Gudang Load', 'HO', 'ho-gudang-edge', now(), 'Bumiayu', 'WIB', 'ho', 'HO-GUDANG')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO site (id, name, kind, edge_node_id, created_at, city, timezone, unit_id, code)
    SELECT 'store-c' || lpad(g::text, 3, '0'), 'Toko Load ' || lpad(g::text, 2, '0'),
           'STORE', 'store-c' || lpad(g::text, 3, '0') || '-edge', now(),
           'Bumiayu', 'WIB', 'store-c' || lpad(g::text, 3, '0'),
           'C' || lpad(g::text, 3, '0') || '-TOKO'
      FROM generate_series(1, {args.stores}) g
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, role, display_order, active, is_placement)
    VALUES ('ho-gudang.warehouse', 'ho-gudang', 'WAREHOUSE', 'WAREHOUSE', 'Warehouse', 'STOCKROOM', 1, true, true),
           ('ho-gudang.pending.unidentified', 'ho-gudang', 'PENDING', 'UNIDENTIFIED', 'Unidentified', 'RECEIVING', 2, true, true),
           ('ho-gudang.reject', 'ho-gudang', 'REJECT', 'REJECT', 'Reject', 'REJECT', 3, true, true),
           ('ho-gudang.outbound.picking', 'ho-gudang', 'OUTBOUND', 'PICKING', 'Pick Area', 'PICKING', 4, true, true),
           ('ho-gudang.outbound.packed', 'ho-gudang', 'OUTBOUND', 'PACKED', 'Packed', 'PACKED', 5, true, true),
           ('ho-gudang.outbound.shipment', 'ho-gudang', 'OUTBOUND', 'SHIPMENT', 'Shipment', 'SHIPMENT', 6, true, true),
           ('ho-gudang.outbound.loaded', 'ho-gudang', 'OUTBOUND', 'LOADED', 'Loaded', 'LOADED', 7, true, true),
           ('ho-gudang.outbound.in-transit', 'ho-gudang', 'OUTBOUND', 'IN_TRANSIT', 'In Transit', 'IN_TRANSIT', 8, true, true)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO operational_pool (id, site_id, group_code, pool_code, label, role, display_order, active, is_placement)
    SELECT 'store-c' || lpad(s.g::text, 3, '0') || '.' || p.code,
           'store-c' || lpad(s.g::text, 3, '0'), p.grp, p.code, p.label, p.role, p.ord, true, true
      FROM generate_series(1, {args.stores}) s(g),
           (VALUES ('WAREHOUSE', 'STORE_INVENTORY', 'Warehouse', 'STOCKROOM', 1),
                   ('FLOOR', 'STORE_INVENTORY', 'Floor', 'FLOOR', 2),
                   ('REJECT', 'REJECT', 'Reject', 'REJECT', 3),
                   ('PICKING', 'OUTBOUND', 'Pick Area', 'PICKING', 4),
                   ('PACKED', 'OUTBOUND', 'Packed', 'PACKED', 5),
                   ('SHIPMENT', 'OUTBOUND', 'Shipment', 'SHIPMENT', 6),
                   ('LOADED', 'OUTBOUND', 'Loaded', 'LOADED', 7),
                   ('IN_TRANSIT', 'OUTBOUND', 'In Transit', 'IN_TRANSIT', 8)) p(code, grp, label, role, ord)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO inventory_place (id, kind, pool_id, state, code, is_company, is_saleable)
    SELECT op.id || CASE WHEN st.state = 'NORMAL' THEN ':on_hand' ELSE ':missing' END,
           'OPERATIONAL', op.id, st.state, null, true,
           (op.group_code = 'STORE_INVENTORY' AND st.state = 'NORMAL')
      FROM operational_pool op, (VALUES ('NORMAL'), ('MISSING')) st(state)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO inventory_place (id, kind, pool_id, state, code, is_company, is_saleable)
    VALUES ('external/customer', 'EXTERNAL', null, null, 'CUSTOMER', false, false),
           ('external/supplier', 'EXTERNAL', null, null, 'SUPPLIER', false, false),
           ('external/disposal', 'EXTERNAL', null, null, 'DISPOSAL', false, false),
           ('system/opening', 'SYSTEM', null, null, 'OPENING', false, false),
           ('system/count_gain', 'SYSTEM', null, null, 'COUNT_GAIN', false, false),
           ('system/lost', 'SYSTEM', null, null, 'LOST', false, false)
    ON CONFLICT (id) DO NOTHING;
    -- a receipt names the origin that delivered it (FK); a template-made rig has none
    INSERT INTO sync_origin_credential (origin_id, ingest_key_sha256, label, created_at, active_generation)
    SELECT 'ho-gudang-edge', md5(random()::text), 'loadtest seed origin', now(), 1
     WHERE NOT EXISTS (SELECT 1 FROM sync_origin_credential WHERE origin_id = 'ho-gudang-edge');
    INSERT INTO sync_origin_credential (origin_id, ingest_key_sha256, label, created_at, active_generation)
    SELECT 'store-c' || lpad(g::text, 3, '0') || '-edge', md5(random()::text),
           'loadtest store origin', now(), 1
      FROM generate_series(1, {args.stores}) g
    ON CONFLICT (origin_id) DO NOTHING;
    """)

if phase("masters"):
    print(f"masters: {ARTICLES} articles, {SKUS} skus, {SUPPLIERS} suppliers, "
          f"{SUPPLIER_ITEMS} supplier items, {MEMBERS} members, price book")
    psql(f"""
    INSERT INTO article (id, article_code, name, active, created_at, division_code, version, updated_at)
    SELECT (md5('art' || g))::uuid, '8' || lpad(g::text, 7, '0'),
           'Artikel Load ' || g, true, {ts("1 + (g % 300)", "9")}, d.code, 1, {ts("1 + (g % 300)", "9")}
      FROM generate_series(1, {ARTICLES}) g
      CROSS JOIN LATERAL (SELECT code FROM division ORDER BY code OFFSET g % (SELECT count(*) FROM division) LIMIT 1) d
    ON CONFLICT (article_code) DO NOTHING;
    """)
    psql(f"""
    INSERT INTO article_colour (article_id, colour_digit, label, hex_code, colour_code, created_at)
    SELECT a.id, c.rn::text, c.label, c.hex_code, c.code, a.created_at
      FROM article a
      CROSS JOIN (SELECT row_number() OVER (ORDER BY code) rn, code, label, hex_code
                    FROM colour WHERE active ORDER BY code LIMIT 4) c
     WHERE a.article_code LIKE '8%'
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    INSERT INTO sku (id, article_id, sku_code, color, size, active, created_at,
                     colour_digit, size_code, base_price_minor, currency)
    SELECT (md5('sku' || k.g))::uuid, a.id,
           lpad('9' || lpad(k.g::text, 10, '0'), 11, '0'),
           c.label, sz.code, true, a.created_at,
           (((k.g - 1) % 4) + 1)::text, sz.code,
           100000 + ((k.g * 7919) % 400000), 'IDR'
      FROM generate_series(1, {SKUS}) k(g)
      JOIN article a ON a.id = (md5('art' || ((k.g - 1) / {SKUS_PER_ARTICLE} + 1)))::uuid
      CROSS JOIN LATERAL (SELECT label FROM colour WHERE active ORDER BY code OFFSET (k.g - 1) % 4 LIMIT 1) c
      CROSS JOIN LATERAL (SELECT code FROM size_code ORDER BY code OFFSET ((k.g - 1) / 4) % 4 LIMIT 1) sz
    ON CONFLICT (sku_code) DO NOTHING;
    """)
    psql(f"""
    INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                          status, category, created_at, created_by, updated_by)
    SELECT (md5('sup' || g))::uuid, 'SUP-Y' || lpad(g::text, 5, '0'),
           lower('SUP-Y' || lpad(g::text, 5, '0')),
           'PT Pemasok Load ' || g, 'ACTIVE', 'MERCHANDISE', now(), 'loadtest', 'loadtest'
      FROM generate_series(1, {SUPPLIERS}) g
    ON CONFLICT (supplier_code_normalized) DO NOTHING;
    INSERT INTO supplier_contact (contact_id, supplier_id, name, name_normalized, phone,
                                  is_primary, version, created_by, created_at, updated_by, updated_at)
    SELECT (md5('supc' || g))::uuid, (md5('sup' || ((g - 1) % {SUPPLIERS} + 1)))::uuid,
           'Kontak ' || g, lower('kontak ' || g), '0812-' || lpad(g::text, 8, '0'),
           true, 1, 'loadtest', now(), 'loadtest', now()
      FROM generate_series(1, {SUPPLIERS}) g
    ON CONFLICT (contact_id) DO NOTHING;
    INSERT INTO supplier_item (supplier_item_id, supplier_id, supplier_item_code,
                               supplier_item_code_normalized, name, unit_price_minor,
                               currency, internal_article_code, status, version,
                               created_by, created_at, updated_by, updated_at, division_code)
    SELECT (md5('sitem' || g))::uuid, (md5('sup' || ((g - 1) % {SUPPLIERS} + 1)))::uuid,
           'HM-Y' || lpad(g::text, 7, '0'), lower('HM-Y' || lpad(g::text, 7, '0')),
           'Item Pemasok ' || g, 50000 + (g * 977) % 300000, 'IDR',
           '8' || lpad(((g * 31) % {ARTICLES} + 1)::text, 7, '0'),
           'ACTIVE', 1, 'loadtest', now(), 'loadtest', now(), d.code
      FROM generate_series(1, {SUPPLIER_ITEMS}) g
      CROSS JOIN LATERAL (SELECT code FROM division ORDER BY code OFFSET g % (SELECT count(*) FROM division) LIMIT 1) d
    ON CONFLICT (supplier_id, supplier_item_code_normalized) DO NOTHING;
    INSERT INTO member (member_id, display_name, joined_on, created_at)
    SELECT 'MEM-Y' || lpad(g::text, 7, '0'), 'Member Load ' || g,
           date '{args.year}-01-01' + ((g * 17) % {DAYS}), now()
      FROM generate_series(1, {MEMBERS}) g
    ON CONFLICT (member_id) DO NOTHING;
    INSERT INTO points_account (customer_id, balance_points, updated_at)
    SELECT 'MEM-Y' || lpad(g::text, 7, '0'), 0, now()
      FROM generate_series(1, {MEMBERS}) g
    ON CONFLICT (customer_id) DO NOTHING;
    """)
    psql(f"""
    -- rules are only writable while the book is a draft; publish afterwards.
    -- Every statement is guarded so a re-run over a PUBLISHED book touches
    -- no row at all — the immutability triggers reject even no-op writes.
    INSERT INTO commercial_publication (id, version, name, status, effective_from, created_by, created_at)
    VALUES (md5('pub1')::uuid, 9001, 'Price book load', 'DRAFT',
            date '{args.year}-01-01', 'loadtest', now())
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO commercial_price_rule (id, publication_id, sku_id, site_id, channel,
                                       currency, unit_price_minor, tax_category)
    SELECT (md5('pr' || k.g))::uuid, md5('pub1')::uuid, s.id, null, 'STORE',
           'IDR', s.base_price_minor, 'B'
      FROM generate_series(1, {SKUS}) k(g)
      JOIN sku s ON s.id = (md5('sku' || k.g))::uuid
     WHERE (SELECT status FROM commercial_publication WHERE id = md5('pub1')::uuid) = 'DRAFT'
    ON CONFLICT (id) DO NOTHING;
    UPDATE commercial_publication
       SET status = 'PUBLISHED', published_by = 'loadtest', published_at = now()
     WHERE id = md5('pub1')::uuid AND status = 'DRAFT';
    """)

if phase("images") and args.images == "pool":
    print("images: sampling the R2 pool for article + supplier-item image_url")
    with open(args.image_pool) as handle:
        pool = json.load(handle)
    urls = [item["image_url"] for item in pool["items"] if item.get("image_url")][:200]
    if not urls:
        raise SystemExit(f"no public_url entries in {args.image_pool}")
    values = ",".join(f"({n}, '{url}')"
                      for n, url in enumerate(urls, 1) if "'" not in url)
    psql(f"""
    CREATE TEMP TABLE seed_image_pool (n int PRIMARY KEY, url text NOT NULL);
    INSERT INTO seed_image_pool (n, url) VALUES {values};
    UPDATE article a SET image_url = p.url
      FROM seed_image_pool p
     WHERE a.image_url IS NULL AND a.article_code LIKE '8%'
       AND p.n = 1 + (('x' || substr(md5(a.article_code), 1, 8))::bit(32)::int % {len(urls)});
    UPDATE supplier_item si SET image_url = p.url
      FROM seed_image_pool p
     WHERE si.image_url IS NULL AND si.supplier_item_code LIKE 'HM-Y%'
       AND p.n = 1 + (('x' || substr(md5(si.supplier_item_code), 1, 8))::bit(32)::int % {len(urls)});
    """)


# ---- 2. buying + the Gudang ledger ------------------------------------------

if phase("buy"):
    print(f"buy: {POS} POs, {PO_LINES} lines")
    psql(f"""
    INSERT INTO purchase_order (purchase_order_id, po_number, supplier_id, supplier_name,
                                destination_site_id, origin_kind, order_status, currency,
                                created_by, created_at, issued_at)
    SELECT (md5('po' || g))::uuid, 'PO-Y' || lpad(g::text, 7, '0'),
           (md5('sup' || ((g - 1) % {SUPPLIERS} + 1)))::uuid,
           'PT Pemasok Load ' || (((g - 1) % {SUPPLIERS}) + 1),
           'ho-gudang', 'DIRECT', 'ISSUED', 'IDR', 'loadtest-buyer',
           {ts("1 + (g % 350)", "9")}, {ts("1 + (g % 350)", "10")}
      FROM generate_series(1, {POS}) g
    ON CONFLICT (po_number) DO NOTHING;
    INSERT INTO purchase_order_line (po_line_id, purchase_order_id, line_number,
                                     article_code, article_name, ordered_quantity,
                                     unit_price_minor, line_amount_minor, line_status, currency)
    SELECT (md5('pol' || g))::uuid, (md5('po' || ((g - 1) / 4 + 1)))::uuid,
           ((g - 1) % 4) + 1, si.internal_article_code, si.name, {PO_PCS_PER_LINE},
           si.unit_price_minor, {PO_PCS_PER_LINE} * si.unit_price_minor, 'OPEN', 'IDR'
      FROM generate_series(1, {PO_LINES}) g
      JOIN supplier_item si ON si.supplier_item_id = (md5('sitem' || (g % {SUPPLIER_ITEMS} + 1)))::uuid
    ON CONFLICT (po_line_id) DO NOTHING;
    """)


def storebound_cte(lo, hi):
    return f"""
    WITH pieces AS (
      SELECT g,
             (g % {SKUS}) + 1                       AS sku_no,
             1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) AS store_no,
             1 + ((g * 37) % 350)                   AS arrive_day
        FROM generate_series({lo}, {hi}) g
    )"""


def receive_month(m, lo, hi):
    print(f"  receive month {m}: pieces {lo}..{hi}")
    psql(f"""
    {storebound_cte(lo, hi)}
    INSERT INTO inventory_subject (id, subject_type, sku_id, epc, quantity, uom, created_at)
    SELECT (md5('subj' || g))::uuid, 'UNIT', (md5('sku' || sku_no))::uuid,
           upper(substr(md5('epc' || g), 1, 24)), 1, 'PCS', {ts("arrive_day", "8")}
      FROM pieces
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(lo, hi)}
    INSERT INTO movement_group (id, cause, reason, reference_type, actor_id,
                                idempotency_key, payload_digest, occurred_at, recorded_at)
    SELECT (md5('grp-' || c.cause || c.leg || '-' || p.arrive_day))::uuid, c.cause,
           'loadtest seed', null, 'loadtest-gudang',
           'seed-' || c.cause || c.leg || '-' || p.arrive_day,
           md5(c.cause || c.leg || p.arrive_day::text),
           {ts("p.arrive_day + c.off", "9")}, now()
      FROM (SELECT DISTINCT arrive_day FROM pieces) p,
           (VALUES ('OPENING', 'a', 0), ('TAGGING', 'b', 0),
                   ('NORMAL_MOVE', '1', 1), ('NORMAL_MOVE', '2', 2)) c(cause, leg, off)
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(lo, hi)}
    INSERT INTO movement (movement_id, movement_group_id, subject_id, quantity,
                          from_place_id, to_place_id, cause, idempotency_key,
                          payload_digest, actor_id, occurred_at, recorded_at)
    SELECT (md5('mv' || p.g || '-' || c.leg))::uuid,
           (md5('grp-' || c.cause || c.leg || '-' || p.arrive_day))::uuid,
           (md5('subj' || p.g))::uuid, 1, c.from_place, c.to_place, c.cause,
           'seed-' || p.g || '-' || c.leg, md5('mv' || p.g || c.leg),
           'loadtest-gudang', {ts("p.arrive_day + c.off", "10")}, now()
      FROM pieces p,
           (VALUES ('system/opening', 'ho-gudang.pending.unidentified:on_hand', 'OPENING', 'a', 0),
                   ('ho-gudang.pending.unidentified:on_hand', 'ho-gudang.warehouse:on_hand', 'TAGGING', 'b', 0),
                   ('ho-gudang.warehouse:on_hand', 'ho-gudang.outbound.packed:on_hand', 'NORMAL_MOVE', '1', 1),
                   ('ho-gudang.outbound.packed:on_hand', 'ho-gudang.outbound.in-transit:on_hand', 'NORMAL_MOVE', '2', 2)
           ) c(from_place, to_place, cause, leg, off)
    ON CONFLICT (movement_id) DO NOTHING;
    """)
    psql(f"""
    WITH pieces AS (
      SELECT g, (g % {SKUS}) + 1 sku_no FROM generate_series({lo}, {hi}) g
    )
    INSERT INTO epc_serial_counter (sku_code, last_serial, updated_at)
    SELECT s.sku_code, count(*), now()
      FROM pieces p JOIN sku s ON s.id = (md5('sku' || p.sku_no))::uuid
     GROUP BY s.sku_code
    ON CONFLICT (sku_code) DO UPDATE
      SET last_serial = epc_serial_counter.last_serial + EXCLUDED.last_serial;
    """)
    psql(f"""
    {storebound_cte(lo, hi)}
    INSERT INTO goods_receipt (receipt_id, receipt_number, origin_id, site_id, supplier_id,
                               arrived_at, status, opened_by, opened_at, closed_by, closed_at,
                               generation, seq, received_at)
    SELECT (md5('gr' || p.arrive_day))::uuid, 'GR-Y' || lpad(p.arrive_day::text, 4, '0'),
           (SELECT origin_id FROM sync_origin_credential ORDER BY created_at LIMIT 1),
           'ho-gudang', 'SUP-Y' || lpad((1 + p.arrive_day % {SUPPLIERS})::text, 5, '0'),
           {ts("p.arrive_day", "8")}, 'COMPLETED', 'loadtest-gudang',
           {ts("p.arrive_day", "8")}, 'loadtest-gudang', {ts("p.arrive_day", "17")},
           1, p.arrive_day, now()
      FROM (SELECT DISTINCT arrive_day FROM pieces) p
    ON CONFLICT (receipt_id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(lo, hi)}
    INSERT INTO goods_receipt_line (receipt_line_id, receipt_id, po_line_id, quantity,
                                    counted_by, verified_by, counted_at, verified_at,
                                    movement_group_id, generation, seq, received_at,
                                    agreed_unit_price_minor, matched_quantity, excess_quantity)
    SELECT (md5('grl' || p.g))::uuid, (md5('gr' || p.arrive_day))::uuid,
           (md5('pol' || ((p.g - 1) % {PO_LINES} + 1)))::uuid, 1,
           'loadtest-count', 'loadtest-verify', {ts("p.arrive_day", "9")},
           {ts("p.arrive_day", "10")},
           (md5('grp-NORMAL_MOVE1-' || p.arrive_day))::uuid, 1, p.g, now(),
           si.unit_price_minor, 1, 0
      FROM pieces p
      JOIN supplier_item si ON si.supplier_item_id
             = (md5('sitem' || (p.g % {SUPPLIER_ITEMS} + 1)))::uuid
    ON CONFLICT (receipt_line_id) DO NOTHING;
    """)

if phase("receive"):
    print(f"receive: {PCS_BOUGHT} pieces across 12 months")
    step = max(1, math.ceil(PCS_BOUGHT / 12))
    for m in range(12):
        lo, hi = 1 + m * step, min(PCS_BOUGHT, (m + 1) * step)
        if lo > hi:
            break
        receive_month(m + 1, lo, hi)


# ---- 3. distributing: allotments, koli, store receive + floor ---------------

if phase("distribute"):
    print(f"distribute: {STOREBOUND} store-bound pieces")
    psql(f"""
    WITH sb AS (
      SELECT g, 1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no,
             ((g * 37) % 350) / 7 week
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO allotment (id, allotment_number, status, created_by, idempotency_key, created_at)
    SELECT (md5('alt' || store_no || '-' || week))::uuid,
           'ALT-Y' || lpad(store_no::text, 2, '0') || '-' || lpad(week::text, 3, '0'),
           'DC_COMPLETED', 'loadtest-md', 'seed-alt-' || store_no || '-' || week, now()
      FROM (SELECT DISTINCT store_no, week FROM sb) b
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    WITH sb AS (
      SELECT g, 1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no,
             ((g * 37) % 350) / 7 week, (g % {SKUS}) + 1 sku_no
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO allotment_line (id, allotment_id, sku_id, quantity, source_site_id,
                                source_pool_id, destination_type, destination_id,
                                packed_quantity, shipment_quantity, dispatched_quantity,
                                unloaded_quantity, in_transit_quantity, handed_over_quantity,
                                received_quantity, created_at, updated_at)
    SELECT (md5('altl' || store_no || '-' || week || '-' || sku_no))::uuid,
           (md5('alt' || store_no || '-' || week))::uuid,
           (md5('sku' || sku_no))::uuid, count(*), 'ho-gudang', 'ho-gudang.warehouse',
           'STORE', 'store-c' || lpad(store_no::text, 3, '0'),
           count(*), count(*), count(*), 0, count(*), count(*), count(*), now(), now()
      FROM sb GROUP BY store_no, week, sku_no
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    WITH sb AS (
      SELECT g, ((g * 37) % 350) / 7 week,
             1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO edge_koli (koli_id, origin_id, source_site_id, destination_store_id, status,
                           shipment_reference, created_at, updated_at, last_generation, last_seq)
    SELECT (md5('koli' || store_no || '-' || (g / {KOLI_PCS})))::uuid,
           'ho-gudang-edge', 'ho-gudang',
           'store-c' || lpad(store_no::text, 3, '0'),
           'IN_TRANSIT', 'SHIP-Y' || lpad(min(week)::text, 3, '0'), now(), now(), 1, max(g)
      FROM (SELECT g, week, store_no FROM sb) x
     GROUP BY store_no, g / {KOLI_PCS}
    ON CONFLICT (koli_id) DO NOTHING;
    """)
    psql(f"""
    WITH sb AS (
      SELECT g, (g % {SKUS}) + 1 sku_no, ((g * 37) % 350) / 7 week,
             1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO edge_koli_unit (koli_id, epc, sku_code, allotment_id, allotment_line_id,
                                current_stage, stage_rank, packed_at, shipment_at,
                                dispatched_at, in_transit_at, updated_at)
    SELECT (md5('koli' || x.store_no || '-' || (x.g / {KOLI_PCS})))::uuid,
           upper(substr(md5('epc' || x.g), 1, 24)), s.sku_code,
           (md5('alt' || x.store_no || '-' || x.week))::uuid,
           (md5('altl' || x.store_no || '-' || x.week || '-' || x.sku_no))::uuid,
           'IN_TRANSIT', 5, {ts("((x.g * 37) % 350) + 2", "9")},
           {ts("((x.g * 37) % 350) + 2", "11")}, {ts("((x.g * 37) % 350) + 3", "8")},
           {ts("((x.g * 37) % 350) + 5", "9")}, now()
      FROM sb x JOIN sku s ON s.id = (md5('sku' || x.sku_no))::uuid
    ON CONFLICT (koli_id, epc) DO NOTHING;
    """)
    psql(f"""
    WITH sb AS (
      SELECT g, 1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no,
             1 + ((g * 37) % 350) arrive_day
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO movement_group (id, cause, reason, reference_type, actor_id,
                                idempotency_key, payload_digest, occurred_at, recorded_at)
    SELECT (md5('egrp-' || c.kind || '-' || p.store_no || '-' || p.arrive_day))::uuid,
           CASE WHEN c.kind = 'recv' THEN 'STORE_RECEIVE' ELSE 'NORMAL_MOVE' END,
           'loadtest seed', null, 'loadtest-store',
           'seed-egrp-' || c.kind || '-' || p.store_no || '-' || p.arrive_day,
           md5('egrp' || c.kind || p.store_no || p.arrive_day),
           {ts("p.arrive_day + 5", "9")}, now()
      FROM (SELECT DISTINCT store_no, arrive_day FROM sb) p, (VALUES ('recv'), ('floor')) c(kind)
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(1, STOREBOUND)}
    INSERT INTO edge_movement (origin_id, generation, seq, event_id, movement_group_id,
                               cause, reason, actor_id, occurred_at, received_at)
    SELECT 'store-c' || lpad(p.store_no::text, 3, '0') || '-edge', 1, p.g,
           (md5('egrp-recv-' || p.store_no || '-' || p.arrive_day))::uuid,
           (md5('egrp-recv-' || p.store_no || '-' || p.arrive_day))::uuid,
           'STORE_RECEIVE', 'loadtest seed', 'loadtest-store', {ts("p.arrive_day + 5", "9")}, now()
      FROM pieces p
    ON CONFLICT (event_id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(1, STOREBOUND)}
    INSERT INTO edge_movement (origin_id, generation, seq, event_id, movement_group_id,
                               cause, reason, actor_id, occurred_at, received_at)
    SELECT 'store-c' || lpad(p.store_no::text, 3, '0') || '-edge', 1, {STOREBOUND} + p.g,
           (md5('egrp-floor-' || p.store_no || '-' || p.arrive_day))::uuid,
           (md5('egrp-floor-' || p.store_no || '-' || p.arrive_day))::uuid,
           'NORMAL_MOVE', 'loadtest seed', 'loadtest-store', {ts("p.arrive_day + 6", "9")}, now()
      FROM pieces p
    ON CONFLICT (event_id) DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(1, STOREBOUND)}
    INSERT INTO edge_movement_line (movement_group_id, subject_id, epc, sku_code, quantity,
                                    from_place_id, to_place_id)
    SELECT (md5('egrp-recv-' || p.store_no || '-' || p.arrive_day))::uuid,
           (md5('subj' || p.g))::uuid, upper(substr(md5('epc' || p.g), 1, 24)),
           s.sku_code, 1, 'ho-gudang.outbound.in-transit:on_hand',
           'store-c' || lpad(p.store_no::text, 3, '0') || '.warehouse:on_hand'
      FROM pieces p JOIN sku s ON s.id = (md5('sku' || p.sku_no))::uuid
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    {storebound_cte(1, STOREBOUND)}
    INSERT INTO edge_movement_line (movement_group_id, subject_id, epc, sku_code, quantity,
                                    from_place_id, to_place_id)
    SELECT (md5('egrp-floor-' || p.store_no || '-' || p.arrive_day))::uuid,
           (md5('subj' || p.g))::uuid, upper(substr(md5('epc' || p.g), 1, 24)),
           s.sku_code, 1,
           'store-c' || lpad(p.store_no::text, 3, '0') || '.warehouse:on_hand',
           'store-c' || lpad(p.store_no::text, 3, '0') || '.floor:on_hand'
      FROM pieces p JOIN sku s ON s.id = (md5('sku' || p.sku_no))::uuid
    ON CONFLICT DO NOTHING;
    """)


# ---- 4. selling: edge sales + tenders + the SALE leg ------------------------

def sell_month(m, s_lo, s_hi):
    print(f"  sell month {m}: sales {s_lo}..{s_hi}")
    day_col = ", business_date" if EDGE_SALE_DAY else ""
    day_val = (f", ('{args.year}-01-01'::date + (t.sale_day - 1))"
               if EDGE_SALE_DAY else "")
    psql(f"""
    WITH sales AS (
      SELECT s, (md5('sale' || s))::uuid sale_id,
             1 + (s % {args.stores}) store_no,
             1 + ((s / {args.stores}) % {DAYS}) sale_day,
             CASE WHEN s % 40 = 0 THEN 'VOIDED' ELSE 'COMPLETED' END status
        FROM generate_series({s_lo}, {s_hi}) s
    ), totals AS (
      SELECT v.*, k1.base_price_minor + k2.base_price_minor total
        FROM sales v
        JOIN sku k1 ON k1.id = (md5('sku' || (1 + ((2 * v.s - 1) % {SKUS}))))::uuid
        JOIN sku k2 ON k2.id = (md5('sku' || (1 + (2 * v.s % {SKUS}))))::uuid
    )
    INSERT INTO edge_sale (sale_id, origin_id, generation, seq, movement_group_id,
                           site_id, actor_id, occurred_at, currency, total_minor,
                           paid_minor, change_minor, received_at, discount_total_minor,
                           points_earned, status, customer_id{day_col})
    SELECT t.sale_id,
           'store-c' || lpad(t.store_no::text, 3, '0') || '-edge', 1, t.s,
           (md5('esgrp' || t.s))::uuid,
           'store-c' || lpad(t.store_no::text, 3, '0'),
           'loadtest-cashier', {ts("t.sale_day", "8 + (t.s % 12)")}, 'IDR',
           t.total,
           CASE WHEN t.s % 5 < 3 THEN (t.total + 49999) / 50000 * 50000 ELSE t.total END,
           CASE WHEN t.s % 5 < 3 THEN (t.total + 49999) / 50000 * 50000 - t.total ELSE 0 END,
           now(), 0, 0, t.status,
           CASE WHEN t.s % 10 < 3 THEN 'MEM-Y' || lpad((1 + t.s % {MEMBERS})::text, 7, '0') END{day_val}
      FROM totals t
    ON CONFLICT (sale_id) DO NOTHING;
    INSERT INTO edge_sale_line (sale_id, subject_id, epc, sku_code, quantity,
                                unit_price_minor, line_total_minor, price_source)
    SELECT (md5('sale' || v.sale_no))::uuid, (md5('subj' || v.piece))::uuid,
           upper(substr(md5('epc' || v.piece), 1, 24)), k.sku_code, 1,
           k.base_price_minor, k.base_price_minor, 'BOOK'
      FROM (SELECT s sale_no, 2 * s - 1 piece FROM generate_series({s_lo}, {s_hi}) s
            UNION ALL
            SELECT s, 2 * s FROM generate_series({s_lo}, {s_hi}) s) v
      JOIN sku k ON k.id = (md5('sku' || (1 + (v.piece % {SKUS}))))::uuid
    ON CONFLICT DO NOTHING;
    INSERT INTO edge_sale_tender (sale_id, tender_seq, method, amount_minor)
    SELECT t.sale_id, 1,
           CASE WHEN t.s % 5 < 3 THEN 'CASH' WHEN t.s % 5 = 3 THEN 'QRIS' ELSE 'CARD' END,
           t.total
      FROM (SELECT v.*, k1.base_price_minor + k2.base_price_minor total
              FROM (SELECT s, (md5('sale' || s))::uuid sale_id
                      FROM generate_series({s_lo}, {s_hi}) s) v
              JOIN sku k1 ON k1.id = (md5('sku' || (1 + ((2 * v.s - 1) % {SKUS}))))::uuid
              JOIN sku k2 ON k2.id = (md5('sku' || (1 + (2 * v.s % {SKUS}))))::uuid) t
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    -- the SALE leg on the store ledger; voids leave the goods on the floor
    WITH sales AS (
      SELECT s, 1 + (s % {args.stores}) store_no, 1 + ((s / {args.stores}) % {DAYS}) sale_day
        FROM generate_series({s_lo}, {s_hi}) s WHERE s % 40 <> 0
    )
    INSERT INTO movement_group (id, cause, reason, reference_type, actor_id,
                                idempotency_key, payload_digest, occurred_at, recorded_at)
    SELECT (md5('esgrp' || v.s))::uuid, 'SALE', 'loadtest seed', null, 'loadtest-cashier',
           'seed-esgrp-' || v.s, md5('esgrp' || v.s::text),
           {ts("v.sale_day", "8 + (v.s % 12)")}, now()
      FROM sales v
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    WITH sales AS (
      SELECT s, 1 + (s % {args.stores}) store_no, 1 + ((s / {args.stores}) % {DAYS}) sale_day
        FROM generate_series({s_lo}, {s_hi}) s WHERE s % 40 <> 0
    )
    INSERT INTO edge_movement (origin_id, generation, seq, event_id, movement_group_id,
                               cause, reason, actor_id, occurred_at, received_at)
    SELECT 'store-c' || lpad(v.store_no::text, 3, '0') || '-edge', 1, {2 * STOREBOUND} + v.s,
           (md5('esgrp' || v.s))::uuid, (md5('esgrp' || v.s))::uuid,
           'SALE', 'loadtest seed', 'loadtest-cashier', {ts("v.sale_day", "8 + (v.s % 12)")}, now()
      FROM sales v
    ON CONFLICT (event_id) DO NOTHING;
    """)
    psql(f"""
    WITH sales AS (
      SELECT s, 1 + (s % {args.stores}) store_no
        FROM generate_series({s_lo}, {s_hi}) s WHERE s % 40 <> 0
    )
    INSERT INTO edge_movement_line (movement_group_id, subject_id, epc, sku_code, quantity,
                                    from_place_id, to_place_id)
    SELECT (md5('esgrp' || v.sale_no))::uuid, (md5('subj' || v.piece))::uuid,
           upper(substr(md5('epc' || v.piece), 1, 24)), k.sku_code, 1,
           'store-c' || lpad(v.store_no::text, 3, '0') || '.floor:on_hand',
           'external/customer'
      FROM (SELECT s sale_no, store_no, 2 * s - 1 piece FROM sales
            UNION ALL SELECT s, store_no, 2 * s FROM sales) v
      JOIN sku k ON k.id = (md5('sku' || (1 + (v.piece % {SKUS}))))::uuid
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    WITH sales AS (
      SELECT s, 1 + (s % {args.stores}) store_no
        FROM generate_series({s_lo}, {s_hi}) s WHERE s % 40 <> 0
    )
    INSERT INTO edge_inventory_fact_subject_identity (origin_id, subject_id, epc, sku_code,
                                                      first_generation, first_seq, updated_at)
    SELECT DISTINCT 'store-c' || lpad(v.store_no::text, 3, '0') || '-edge',
           (md5('subj' || v.piece))::uuid, upper(substr(md5('epc' || v.piece), 1, 24)),
           k.sku_code, 1, v.piece, now()
      FROM (SELECT s, store_no, 2 * s - 1 piece FROM sales
            UNION ALL SELECT s, store_no, 2 * s FROM sales) v
      JOIN sku k ON k.id = (md5('sku' || (1 + (v.piece % {SKUS}))))::uuid
    ON CONFLICT (origin_id, subject_id) DO NOTHING;
    """)
    psql(f"""
    INSERT INTO points_ledger (entry_id, customer_id, entry_type, points, sale_id, actor, created_at)
    SELECT (md5('pt' || v.s))::uuid,
           'MEM-Y' || lpad((1 + v.s % {MEMBERS})::text, 7, '0'), 'EARN',
           GREATEST(1, k1.base_price_minor / 5000),
           (md5('sale' || v.s))::uuid, 'loadtest', now()
      FROM (SELECT s FROM generate_series({s_lo}, {s_hi}) s WHERE s % 40 <> 0 AND s % 10 < 3) v
      JOIN sku k1 ON k1.id = (md5('sku' || (1 + ((2 * v.s - 1) % {SKUS}))))::uuid
    ON CONFLICT (entry_id) DO NOTHING;
    """)

if phase("sell"):
    print(f"sell: {SALES} sales across 12 months")
    step = max(1, math.ceil(SALES / 12))
    for m in range(12):
        lo, hi = 1 + m * step, min(SALES, (m + 1) * step)
        if lo > hi:
            break
        sell_month(m + 1, lo, hi)


# ---- 5. money: bills + payments, RECORDED (unposted — the real posting job
#         grows the journal/payment ledger during the load test) ---------------

if phase("money"):
    print(f"money: {RECEIPTS} bills, payments for 85%")
    psql(f"""
    INSERT INTO supplier_invoice (invoice_id, invoice_number, supplier_id, supplier_name,
                                  site_id, invoice_date, due_date, currency, subtotal_minor,
                                  total_minor, status, recorded_by, recorded_at, kind)
    SELECT (md5('inv' || g))::uuid, 'INV-Y' || lpad(g::text, 7, '0'),
           gr.supplier_id, s.name, 'ho-gudang',
           ('{args.year}-01-01'::date + gr.arrived_day - 1),
           ('{args.year}-01-01'::date + gr.arrived_day + 29),
           'IDR', x.subtotal, x.subtotal, 'DRAFT', 'loadtest-finance', now(), 'MERCHANDISE'
      FROM (SELECT receipt_id, supplier_id,
                   (EXTRACT(DOY FROM arrived_at))::int arrived_day,
                   row_number() OVER (ORDER BY receipt_id) rn
              FROM goods_receipt WHERE receipt_number LIKE 'GR-Y%') gr
      JOIN supplier s ON s.supplier_code = gr.supplier_id
      JOIN LATERAL (SELECT coalesce(sum(l.quantity * l.agreed_unit_price_minor), 0) subtotal
                      FROM goods_receipt_line l WHERE l.receipt_id = gr.receipt_id) x ON true
      JOIN generate_series(1, {RECEIPTS}) g ON g = gr.rn
    ON CONFLICT (invoice_id) DO NOTHING;
    INSERT INTO supplier_invoice_line (invoice_line_id, invoice_id, line_number, po_line_id,
                                       description, quantity, unit_price_minor,
                                       line_amount_minor, receipt_line_id)
    SELECT (md5('invl' || l.receipt_line_id))::uuid, i.invoice_id,
           row_number() OVER (PARTITION BY i.invoice_id), l.po_line_id,
           coalesce(si.name, 'Item load'), l.quantity,
           (l.agreed_unit_price_minor * 11 / 10),
           (l.quantity * l.agreed_unit_price_minor * 11 / 10), l.receipt_line_id
      FROM goods_receipt_line l
      JOIN goods_receipt gr ON gr.receipt_id = l.receipt_id
      JOIN (SELECT receipt_id, row_number() OVER (ORDER BY receipt_id) rn
              FROM goods_receipt WHERE receipt_number LIKE 'GR-Y%') n
        ON n.receipt_id = gr.receipt_id
      JOIN supplier_invoice i ON i.invoice_id = (md5('inv' || n.rn))::uuid
      LEFT JOIN purchase_order_line pol ON pol.po_line_id = l.po_line_id
      LEFT JOIN supplier_item si ON si.internal_article_code = pol.article_code
    ON CONFLICT (invoice_line_id) DO NOTHING;
    """)
    # Payments stay unseeded: a bill must be POSTED (journal + open fiscal
    # period) before anything may settle it, and posting is the app's job.
    # The load test drives the real payables flow against these DRAFT bills.


# ---- 6. ops: shifts, tagging work, counts, observations ---------------------

if phase("ops"):
    print("ops: shifts, tagging jobs, counts, observations, fleet counters")
    psql(f"""
    INSERT INTO cash_shift (shift_id, origin_id, generation, seq, site_id, terminal_id,
                            status, opened_by, opened_at, opening_float_minor, closed_by,
                            closed_at, declared_cash_minor, expected_cash_minor, received_at)
    SELECT (md5('shift' || gd.day || '-' || gs.store_no))::uuid,
           'store-c' || lpad(gs.store_no::text, 3, '0') || '-edge', 1,
           gd.day * 100 + gs.store_no,
           'store-c' || lpad(gs.store_no::text, 3, '0'), 'TILL-1', 'CLOSED',
           'loadtest-cashier', {ts("gd.day", "7")}, 500000, 'loadtest-cashier',
           {ts("gd.day", "21")}, 500000, 500000, now()
      FROM generate_series(1, {DAYS}) gd(day),
           generate_series(1, {args.stores}) gs(store_no)
    ON CONFLICT (shift_id) DO NOTHING;
    INSERT INTO article_setup_session (session_id, receipt_line_id, article_code,
                                       receipt_quantity, destination_site_id, article_name,
                                       division_code, currency, status, created_by, created_at,
                                       issued_by, issued_at, tagged_at)
    SELECT (md5('tsess' || g))::uuid, (SELECT l.receipt_line_id FROM goods_receipt_line l
                                        WHERE l.receipt_id = gr.receipt_id LIMIT 1),
           a.article_code, 24, 'ho-gudang', a.article_name, a.division_code, 'IDR',
           'TAGGED', 'loadtest-gudang', gr.arrived_at,
           'loadtest-gudang', gr.arrived_at, gr.arrived_at
      FROM (SELECT receipt_id, arrived_at, row_number() OVER (ORDER BY receipt_id) rn
              FROM goods_receipt WHERE receipt_number LIKE 'GR-Y%') gr
      JOIN generate_series(1, {RECEIPTS}) g ON g = gr.rn
      JOIN LATERAL (SELECT pol.article_code, pol.article_name, a2.division_code
                      FROM goods_receipt_line l
                      JOIN purchase_order_line pol ON pol.po_line_id = l.po_line_id
                      JOIN article a2 ON a2.article_code = pol.article_code
                     WHERE l.receipt_id = gr.receipt_id LIMIT 1) a ON true
    ON CONFLICT (session_id) DO NOTHING;
    INSERT INTO tagging_job (job_id, session_id, site_id, article_code, article_name,
                             total_quantity, status, issued_by, issued_at,
                             confirmed_by, confirmed_at)
    SELECT (md5('tjob' || g))::uuid, (md5('tsess' || g))::uuid, 'ho-gudang',
           a.article_code, a.article_name, 24, 'TAGGED', 'loadtest-gudang', gr.arrived_at,
           'loadtest-gudang', gr.arrived_at
      FROM (SELECT receipt_id, arrived_at, row_number() OVER (ORDER BY receipt_id) rn
              FROM goods_receipt WHERE receipt_number LIKE 'GR-Y%') gr
      JOIN generate_series(1, {RECEIPTS}) g ON g = gr.rn
      JOIN LATERAL (SELECT pol.article_code, pol.article_name
                      FROM goods_receipt_line l
                      JOIN purchase_order_line pol ON pol.po_line_id = l.po_line_id
                     WHERE l.receipt_id = gr.receipt_id LIMIT 1) a ON true
    ON CONFLICT (job_id) DO NOTHING;
    INSERT INTO official_count (id, site_id, pool_id, kind, status, scope_json, reason, created_by, created_at)
    SELECT (md5('oc' || gd.month || '-' || gs.store_no))::uuid,
           'store-c' || lpad(gs.store_no::text, 3, '0'),
           'store-c' || lpad(gs.store_no::text, 3, '0') || '.floor',
           'CYCLE', 'CLOSED', '{{"all": true}}', 'loadtest seed',
           'loadtest-store', {ts("(gd.month - 1) * 30 + 1", "6")}
      FROM generate_series(1, 12) gd(month),
           generate_series(1, {args.stores}) gs(store_no)
    ON CONFLICT (id) DO NOTHING;
    """)
    psql(f"""
    -- RFID observations at the read grain: the latest sighting per subject
    WITH sb AS (
      SELECT g, 1 + (((g - 1) / {PCS_PER_STORE}) % {args.stores}) store_no,
             1 + ((g * 37) % 350) arrive_day
        FROM generate_series(1, {STOREBOUND}) g
    )
    INSERT INTO observation_sighting (observation_id, subject_id, epc, site_id, pool_id,
                                      first_seen_at, last_seen_at, received_at, device_id,
                                      reader_session_id, method, read_count)
    SELECT (md5('obs' || p.g))::uuid, (md5('subj' || p.g))::uuid,
           upper(substr(md5('epc' || p.g), 1, 24)),
           'store-c' || lpad(p.store_no::text, 3, '0'),
           'store-c' || lpad(p.store_no::text, 3, '0') || '.warehouse',
           {ts("p.arrive_day + 5", "10")}, {ts("p.arrive_day + 5", "10")},
           now(), 'DEV-SEED-1', 'SESS-' || (p.g % 1000), 'RFID_HANDHELD', 1
      FROM sb p
    ON CONFLICT (observation_id) DO NOTHING;
    """)


# ---- 7. finish: projections + analyze ---------------------------------------

if phase("finish"):
    print("finish: rebuilding inventory_projection from the movement ledger")
    psql("""
    INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence, updated_at)
    SELECT subject_id, place_id, sum(delta), 0, now()
      FROM (SELECT m.subject_id, m.to_place_id place_id, m.quantity delta
              FROM movement m JOIN inventory_place p ON p.id = m.to_place_id
             WHERE p.kind = 'OPERATIONAL'
            UNION ALL
            SELECT m.subject_id, m.from_place_id, -m.quantity
              FROM movement m JOIN inventory_place p ON p.id = m.from_place_id
             WHERE p.kind = 'OPERATIONAL') d
     GROUP BY subject_id, place_id HAVING sum(delta) <> 0
    ON CONFLICT (subject_id, place_id) DO NOTHING;
    """)
    print("ANALYZE …")
    psql("ANALYZE;", quiet=True)


VERIFY_SQL = """
SELECT 'sales: ' || count(*) FROM edge_sale
UNION ALL SELECT 'sale_lines: ' || count(*) FROM edge_sale_line
UNION ALL SELECT 'tenders: ' || count(*) FROM edge_sale_tender
UNION ALL SELECT 'subjects: ' || count(*) FROM inventory_subject
UNION ALL SELECT 'movements: ' || count(*) FROM movement
UNION ALL SELECT 'edge_movements: ' || count(*) FROM edge_movement
UNION ALL SELECT 'edge_movement_lines: ' || count(*) FROM edge_movement_line
UNION ALL SELECT 'groups: ' || count(*) FROM movement_group
UNION ALL SELECT 'allotments: ' || count(*) FROM allotment
UNION ALL SELECT 'allotment_lines: ' || count(*) FROM allotment_line
UNION ALL SELECT 'koli: ' || count(*) FROM edge_koli
UNION ALL SELECT 'koli_units: ' || count(*) FROM edge_koli_unit
UNION ALL SELECT 'observations: ' || count(*) FROM observation_sighting
UNION ALL SELECT 'pos: ' || count(*) FROM purchase_order WHERE po_number LIKE 'PO-Y%'
UNION ALL SELECT 'po_lines: ' || count(*) FROM purchase_order_line WHERE po_line_id IN (
  SELECT po_line_id FROM purchase_order_line l JOIN purchase_order o USING (purchase_order_id)
   WHERE o.po_number LIKE 'PO-Y%')
UNION ALL SELECT 'receipts: ' || count(*) FROM goods_receipt WHERE receipt_number LIKE 'GR-Y%'
UNION ALL SELECT 'invoices: ' || count(*) FROM supplier_invoice WHERE invoice_number LIKE 'INV-Y%'
UNION ALL SELECT 'payments: ' || count(*) FROM supplier_payment WHERE payment_number LIKE 'PAY-Y%'
UNION ALL SELECT 'projection_rows: ' || count(*) FROM inventory_projection
UNION ALL SELECT 'points: ' || count(*) FROM points_ledger;
"""

INVARIANTS_SQL = """
SELECT 'sale_money_broken: ' || count(*) FROM edge_sale
 WHERE paid_minor - change_minor <> total_minor AND status = 'COMPLETED';
SELECT 'void_sales_with_sale_leg: ' || count(*) FROM edge_sale s
 WHERE s.status = 'VOIDED' AND EXISTS (
   SELECT 1 FROM edge_movement em WHERE em.movement_group_id = s.movement_group_id);
SELECT 'subjects_without_opening: ' || count(*) FROM inventory_subject s
 WHERE NOT EXISTS (SELECT 1 FROM movement m
                    WHERE m.subject_id = s.id AND m.cause = 'OPENING');
WITH sample AS (
  SELECT id FROM inventory_subject ORDER BY id LIMIT 500
), truth AS (
  SELECT m.subject_id,
         sum(CASE WHEN tp.kind = 'OPERATIONAL' THEN m.quantity ELSE 0 END)
       - sum(CASE WHEN fp.kind = 'OPERATIONAL' THEN m.quantity ELSE 0 END) qty
    FROM movement m
    JOIN sample ON sample.id = m.subject_id
    JOIN inventory_place tp ON tp.id = m.to_place_id
    JOIN inventory_place fp ON fp.id = m.from_place_id
   GROUP BY m.subject_id
)
SELECT 'projection_drift: ' || count(*) FROM truth t
 JOIN inventory_projection p ON p.subject_id = t.subject_id
WHERE p.quantity <> t.qty;
"""


if args.verify:
    print("counts:")
    psql(VERIFY_SQL)
    print("invariants:")
    psql(INVARIANTS_SQL)

print("done")
