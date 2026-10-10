#!/usr/bin/env python3
"""Load-test the procurement CRUD paths against a seeded rig.

Seeds bulk rows (500k or 1M) straight into the database with set-based SQL,
then drives the real HTTP API and reports p50/p95/min/max per operation:

    python3 scripts/loadtest-crud.py --database sim_rig_load \
        --cloud http://127.0.0.1:8480 --total-rows 1000000

Every write carries an idempotency key, so re-running a phase replays
instead of duplicating. The report is printed as one JSON object.
"""

import argparse
import json
import os
import statistics
import subprocess
import time
import uuid
import urllib.request
import urllib.error
from datetime import date, timedelta

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--database", default="sim_rig_load")
parser.add_argument("--cloud", default="http://127.0.0.1:8480")
parser.add_argument("--password", default=os.environ.get("DEMO_PASSWORD", "Password01"))
parser.add_argument("--username", default=os.environ.get("DEMO_USER", "development"))
parser.add_argument("--total-rows", type=int, default=1_000_000, choices=(500_000, 1_000_000))
parser.add_argument("--iterations", type=int, default=20)
parser.add_argument("--po-lines", type=int, default=20)
parser.add_argument("--seed-only", action="store_true")
parser.add_argument("--sweep-only", action="store_true")
parser.add_argument("--skip", default="", help="comma-separated groups to skip")
args = parser.parse_args()
SKIP = {name.strip() for name in args.skip.split(",") if name.strip()}


def psql(sql, db=None):
    return subprocess.run(
        ["psql", db or args.database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, check=True,
    ).stdout.strip()


class Node:
    """One API base with one bearer token."""

    def __init__(self, base, token=None):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method, path, body=None, ok=(200, 201), headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        # Writes here are guarded by an Idempotency-Key header; a load test
        # replays as honestly as a browser would.
        if method in ("POST", "PATCH", "PUT"):
            request.add_header("Idempotency-Key", uuid.uuid4().hex)
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.load(response)
                if response.status not in ok:
                    raise RuntimeError(f"{method} {path}: {response.status} {payload}")
                return payload
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            raise RuntimeError(f"{method} {path}: {error.code} {detail}") from error

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)

    def patch(self, path, body):
        return self.call("PATCH", path, body, ok=(200,))

    def put(self, path, body):
        return self.call("PUT", path, body, ok=(200,))


# ---- seeding -----------------------------------------------------------------

def seed():
    """Bulk-seed the book to the requested scale with set-based SQL.

    Shares of the requested total: ~90% order lines (with their orders),
    ~10% suppliers plus two contacts each — the tables the procurement
    list queries actually walk. The receiving endpoints are measured on
    the owed book: every line is still awaiting its delivery.
    """
    total = args.total_rows
    suppliers = max(500, total // 200)
    orders = max(1_000, total // 5)           # each with 2-4 lines
    print(f"seeding: {suppliers} suppliers, {orders} orders …")
    psql(f"""
    -- Suppliers the book pages through. The order carries the supplier's
    -- CODE (that is what legacy orders hold), so the code must resolve.
    INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized,
                          name, status, category, created_at, created_by, updated_by)
    SELECT gen_random_uuid(), 'SUP-L' || lpad(g::text, 6, '0'),
           lower('SUP-L' || lpad(g::text, 6, '0')),
           'PT Pemasok Load ' || g, 'ACTIVE', 'MERCHANDISE', now(), 'loadtest', 'loadtest'
      FROM generate_series(1, {suppliers}) g
    ON CONFLICT DO NOTHING;
    INSERT INTO supplier_contact (contact_id, supplier_id, name, name_normalized,
                                  phone, is_primary, version, created_by, updated_by)
    SELECT gen_random_uuid(), s.supplier_id, 'Kontak ' || g, lower('kontak ' || g),
           '0812-' || lpad(g::text, 8, '0'), g = 1, 1, 'loadtest', 'loadtest'
      FROM supplier s, generate_series(1, 2) g
     WHERE s.supplier_code LIKE 'SUP-L%'
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    -- Orders and lines, straight rows: a book the list query must walk.
    INSERT INTO purchase_order (purchase_order_id, po_number, supplier_id, supplier_name,
                                destination_site_id, order_status, currency, created_by,
                                created_at, issued_at, origin_kind, payment_method)
    SELECT gen_random_uuid(), 'PO-L' || lpad(g::text, 7, '0'),
           'SUP-L' || lpad((1 + g % {suppliers})::text, 6, '0'),
           'PT Pemasok Load ' || (1 + g % {suppliers}),
           (SELECT head_office_site_id()), 'ISSUED', 'IDR', 'loadtest',
           now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval,
           'DIRECT', 'GIRO'
      FROM generate_series(1, {orders}) g
    ON CONFLICT (po_number) DO NOTHING;
    INSERT INTO purchase_order_line (po_line_id, purchase_order_id, line_number,
                                     article_code, article_name, ordered_quantity,
                                     unit_price_minor, line_status, line_amount_minor)
    SELECT gen_random_uuid(), o.purchase_order_id, g,
           'ART-L' || lpad(((o.row_number * 4 + g) % 5000 + 1)::text, 5, '0'),
           'Artikel Load ' || ((o.row_number * 4 + g) % 5000 + 1),
           24, 100000 + g * 1000, 'OPEN', 24 * (100000 + g * 1000)
      FROM (SELECT purchase_order_id, row_number() OVER (ORDER BY created_at) row_number
              FROM purchase_order WHERE po_number LIKE 'PO-L%') o,
           generate_series(1, 4) g
     WHERE g <= 2 + (o.row_number % 3)
    ON CONFLICT DO NOTHING;
    """)
    psql(f"""
    -- The work list and its badge are measured on the OWED book — every
    -- line above is still awaiting a delivery, which is the slow case the
    -- screen actually shows on a busy day. Receipt documents pull in the
    -- whole movement protocol (groups, generations, sequence numbers), which
    -- is fixture work a blind count does through the API instead.
    """)
    counts = psql("""
    SELECT 'suppliers: '||count(*) FROM supplier WHERE supplier_code LIKE 'SUP-L%'
    UNION ALL SELECT 'orders: '||count(*) FROM purchase_order WHERE po_number LIKE 'PO-L%'
    UNION ALL SELECT 'order lines: '||count(*) FROM purchase_order_line l
      JOIN purchase_order o USING (purchase_order_id) WHERE o.po_number LIKE 'PO-L%'
    """, db=args.database)
    print(counts.replace("\n", " · "))


# ---- measurement ---------------------------------------------------------------

RESULTS = {}


def timed(group, name):
    def wrap(fn):
        def run():
            samples = []
            for _ in range(args.iterations):
                started = time.perf_counter()
                fn()
                samples.append((time.perf_counter() - started) * 1000)
            RESULTS.setdefault(group, {})[name] = {
                "p50_ms": round(statistics.median(samples), 1),
                "p95_ms": round(sorted(samples)[int(len(samples) * 0.95) - 1], 1),
                "min_ms": round(min(samples), 1),
                "max_ms": round(max(samples), 1),
            }
        return run
    return wrap


def main():
    if not args.sweep_only:
        seed()
    if args.seed_only:
        return
    api = Node(args.cloud)
    try:
        session = api.post("/api/v1/auth/login",
                           {"username": args.username, "password": args.password})
        api = Node(args.cloud, session["token"])
        who = session.get("user", {}).get("username", args.username)
        print(f"signed in as {who}")
    except Exception as error:  # auth disabled or the account missing
        print(f"login skipped ({error}); continuing without a token")

    groups = []
    if "suppliers" not in SKIP:
        groups.append(suppliers_group(api))
    if "orders" not in SKIP:
        groups.append(orders_group(api))
    if "masters" not in SKIP:
        groups.append(masters_group(api))
    if "receiving" not in SKIP:
        groups.append(receiving_group(api))
    for group in groups:
        print(f"running {group.__name__} …")
        group()
    print(json.dumps(RESULTS, indent=2))


def suppliers_group(api):
    def group():
        code = uuid.uuid4().hex[:8]

        @timed("suppliers", "create")
        def create():
            api.post("/api/v1/suppliers", {
                "name": f"PT Load Uji {code}", "legal_form": "PT",
                "contact_name": "Uji Beban", "phone": "0811-000-0001",
                "address": "Jl. Uji No. 1", "status": "ACTIVE",
                "category": "MERCHANDISE", "default_payment_terms_code": "COD",
            })

        create()
        listing = api.get("/api/v1/suppliers/options?limit=200")

        @timed("suppliers", "options_page_200")
        def options():
            api.get("/api/v1/suppliers/options?limit=200")

        options()

        @timed("suppliers", "book_page_200_with_facets")
        def book():
            api.get("/api/v1/suppliers?limit=200&category=MERCHANDISE&sort=name")

        book()
        supplier_id = listing["rows"][0]["supplier_id"]

        @timed("suppliers", "edit")
        def edit():
            # The PATCH quotes If-Match from a fresh read, as the record
            # sheet does: an edit that says which version it came from is
            # refused the moment somebody else moved the row.
            fresh = api.get(f"/api/v1/suppliers/{supplier_id}")
            api.call(
                "PATCH",
                f"/api/v1/suppliers/{supplier_id}",
                {"phone": "0813-999-9999"},
                ok=(200,),
                headers={"If-Match": f'"{fresh["version"]}"'},
            )

        edit()
    return group


def orders_group(api):
    def group():
        # The catalogue create takes real supplier items: one line per item of
        # a seeded supplier's twenty-four — the shape a big order actually
        # has. The book's first row may be a supplier the sweep itself just
        # minted with no items, so walk until one answers with a catalogue.
        items = []
        supplier = None
        for candidate in api.get("/api/v1/suppliers/options?limit=200")["rows"]:
            if not candidate["name"].startswith("PT Pemasok"):
                continue
            items = api.get(
                f"/api/v1/suppliers/{candidate['supplier_id']}/items?limit=24"
            )["items"]
            if items:
                supplier = candidate
                break
        assert items, "no seeded supplier carries catalogue items"
        lines = [
            {
                "supplier_item_id": item["supplier_item_id"],
                "quantity": 24,
                # A line promises a day; the sweep promises a week out.
                "promised_date": (date.today() + timedelta(days=7)).isoformat(),
            }
            for item in items
        ]

        @timed("orders", f"create_{len(lines)}_lines")
        def create():
            api.post(
                "/api/v1/purchase-orders/catalog",
                {
                    "po_number": None,
                    "supplier_id": supplier["supplier_id"],
                    "destination_site_id": None,
                    "notes": "loadtest",
                    "discount_minor": None,
                    "lines": lines,
                    "idempotency_key": uuid.uuid4().hex,
                },
            )

        create()

        @timed("orders", "list_page_with_facets")
        def listing():
            api.get("/api/v1/purchase-orders?limit=50")

        listing()

        @timed("orders", "list_page_no_facets")
        def listing_light():
            api.get("/api/v1/purchase-orders?limit=50&include_facets=false")

        listing_light()

        @timed("orders", "list_search")
        def search():
            api.get("/api/v1/purchase-orders?limit=50&q=PO-L0001")

        search()
        order_id = api.get("/api/v1/purchase-orders?limit=1")["rows"][0]["purchase_order_id"]

        @timed("orders", "detail")
        def detail():
            api.get(f"/api/v1/purchase-orders/{order_id}")

        detail()
    return group


def masters_group(api):
    def group():
        @timed("masters", "tags_list_with_usage")
        def tags():
            api.get("/api/v1/vocabulary/tags")

        tags()

        @timed("masters", "sizes_list_with_usage")
        def sizes():
            api.get("/api/v1/vocabulary/sizes")

        sizes()

        @timed("masters", "colours_list")
        def colours():
            api.get("/api/v1/catalogue/colours")

        colours()

        @timed("masters", "tag_create")
        def tag_create():
            api.post(
                "/api/v1/vocabulary/tags",
                {
                    "code": f"LOAD_{uuid.uuid4().hex[:6].upper()}",
                    "label": "Uji beban",
                    "display_order": 900,
                },
            )

        tag_create()

        @timed("masters", "vocabulary")
        def vocabulary():
            api.get("/api/v1/catalogue/vocabulary")

        vocabulary()
    return group


def receiving_group(api):
    def group():
        @timed("receiving", "work_list")
        def work():
            api.get("/api/v1/dc/purchase-orders")

        work()

        @timed("receiving", "badge_summary")
        def summary():
            api.get("/api/v1/dc/purchase-orders/summary")

        summary()

        @timed("receiving", "verify_queue")
        def queue():
            api.get("/api/v1/dc/purchase-counts")

        queue()
    return group


if __name__ == "__main__":
    main()
