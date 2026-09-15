#!/usr/bin/env python3
"""Buy a few things out of the sourcing catalogue, properly, so the shops have
real goods to price.

    ITULAH_API=http://127.0.0.1:8123 ITULAH_DC=http://127.0.0.1:8124 \\
        python3 scripts/seed-bought-goods.py --items 6

Sibling of `seed-sourcing.py`. That one plants a supplier catalogue — 2806
items with real photographs — which is what a buyer BROWSES. This one puts a
few of those items through the whole chain a real purchase takes, so that what
comes out the other end is master data: articles with photographs, SKUs with
EPCs, and a published price a till would charge.

Nothing here is a shortcut. It drives the same endpoints a person drives, in
the same order, because a fixture built by writing rows straight into tables
proves nothing about the flow and quietly skips every check the flow makes:

    01  the buyer raises a purchase order against the supplier's catalogue
    02  the warehouse opens a delivery and counts it BLIND
    03  a second person accepts the count
    04  head office says what the goods ARE — name, colours, sizes, price
        (this is the step that mints SKUs, and the step that carries the
         photograph onto the article)
    05  issuing the setup publishes the first price book for those SKUs

Step 04 is the one worth understanding. Nothing else in this system writes
`article.image_url`, so a catalogue seeded any other way shows "no photo" on
every screen that has a photograph column. The image travels supplier item ->
purchase order line -> receipt line -> setup session -> article.

Re-running is safe. Every write carries a fixed Idempotency-Key derived from
the run label, so a repeat replays the server's first answer rather than
raising a second order. Change --label to buy a different batch.

The password is never an argument and never written down: it is read from
ITULAH_PASSWORD if set, and otherwise prompted for without echo. Against a node
running with INVENTORY_AUTH_MODE=disabled it is not asked for at all.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

CLOUD = os.environ.get("ITULAH_API", "http://127.0.0.1:8080").rstrip("/")
DC = os.environ.get("ITULAH_DC", "http://127.0.0.1:8081").rstrip("/")

# The sizes a garment is minted in. `size_code` is a two-digit code from the
# `size_code` table; 03/04/05 are the middle of the run, which is what a first
# buy of anything is mostly made of.
SIZES = ["03", "04", "05"]


class Node:
    """One node, and the session cookie it hands back."""

    def __init__(self, base: str) -> None:
        self.base = base
        self.cookies: dict[str, str] = {}

    def _request(self, method: str, path: str, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        if data is not None:
            request.add_header("content-type", "application/json")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        if self.cookies:
            request.add_header(
                "cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items())
            )
        # The CSRF token is echoed from the cookie the server set, which is the
        # whole reason it is readable by script.
        csrf = self.cookies.get("inventory_csrf")
        if csrf and method not in ("GET", "HEAD"):
            request.add_header("x-csrf-token", csrf)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                for header in response.headers.get_all("set-cookie") or []:
                    name, _, rest = header.partition("=")
                    self.cookies[name.strip()] = rest.split(";")[0]
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            raise SystemExit(f"{method} {path} -> {error.code}: {detail}") from None
        except urllib.error.URLError as error:
            raise SystemExit(f"{method} {path} -> unreachable: {error.reason}") from None

    def get(self, path):
        return self._request("GET", path)

    def post(self, path, body, idempotency_key=None):
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        return self._request("POST", path, body, headers)

    def sign_in(self, username: str) -> None:
        """Only when the node asks. A node with auth disabled needs nothing."""
        if self.get("/api/v1/health").get("auth") != "enabled":
            return
        password = os.environ.get("ITULAH_PASSWORD") or getpass.getpass(
            f"password for {username} at {self.base}: "
        )
        self.post("/api/v1/auth/login", {"username": username, "password": password})


def pick_items(cloud: Node, wanted: int) -> list[dict]:
    """Supplier items with a photograph, cheapest first.

    A photograph is required rather than preferred: the whole point of buying
    through the chain is that the article ends up with one, and an item without
    a picture produces an article without a picture — which is the state this
    script exists to get out of.
    """
    # A sourcing row is `{ item, supplier }`; only the item half is a product.
    page = cloud.get(f"/api/v1/supplier-items?limit={max(wanted * 6, 60)}")
    items = [
        row["item"]
        for row in page.get("items", [])
        if row.get("item", {}).get("image_url") and row["item"].get("unit_price_minor")
    ]
    items.sort(key=lambda item: item["unit_price_minor"])
    if len(items) < wanted:
        raise SystemExit(
            f"only {len(items)} sourced items carry both a photograph and a price; "
            "run scripts/seed-sourcing.py first"
        )
    return items[:wanted]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--items", type=int, default=6, help="how many styles to buy")
    parser.add_argument(
        "--quantity", type=int, default=30, help="pieces per size, per style"
    )
    parser.add_argument(
        "--label",
        default="seed-1",
        help="makes the idempotency keys; change it to buy another batch",
    )
    parser.add_argument("--user", default="admin", help="who to sign in as")
    parser.add_argument(
        "--dc-site",
        default="dc",
        help=(
            "the site id the DC EDGE NODE is registered under, not `site.id` — a "
            "receipt is checked against sync_origin_credential.site_id, which 0256 "
            "did not touch. `ho` here would refuse every delivery"
        ),
    )
    args = parser.parse_args()

    cloud, dc = Node(CLOUD), Node(DC)
    cloud.sign_in(args.user)
    dc.sign_in(args.user)

    items = pick_items(cloud, args.items)
    per_style = args.quantity * len(SIZES)
    print(f"buying {len(items)} styles, {per_style} pieces each, into {args.dc_site}")

    # --- 01 · The buyer raises the order ----------------------------------
    #
    # One order for the lot, the way a buyer would: a supplier is visited once.
    # The price is NOT sent — the server snapshots it from the supplier item
    # each line names, so nothing here can order at a price the catalogue does
    # not hold.
    lines = [
        {"supplier_item_id": item["supplier_item_id"], "quantity": per_style}
        for item in items
    ]
    supplier_id = items[0]["supplier_id"]
    if any(item["supplier_id"] != supplier_id for item in items):
        # An order belongs to one supplier. Buying across several would be
        # several orders, and pretending otherwise would produce a document no
        # supplier could act on.
        items = [item for item in items if item["supplier_id"] == supplier_id]
        lines = lines[: len(items)]
        print(f"  narrowed to {len(items)} styles from supplier {supplier_id}")

    po_number = f"PO-{args.label.upper()}"
    # `/purchase-orders` takes an order typed out from scratch; `/catalog` takes
    # one raised AGAINST the sourcing catalogue, which is what a buyer actually
    # does and the only shape that carries the supplier item's photograph
    # forward.
    order = cloud.post(
        "/api/v1/purchase-orders/catalog",
        {
            "po_number": po_number,
            "supplier_id": supplier_id,
            "destination_site_id": args.dc_site,
            "notes": None,
            "discount_minor": None,
            "lines": lines,
        },
        idempotency_key=f"{args.label}-order",
    )
    order.setdefault("po_number", po_number)
    order.setdefault("supplier_id", supplier_id)
    print(f"  01 raised {order.get('po_number')} -> {order.get('sent_to_origin')}")
    print("     waiting for the warehouse to receive the order over the sync lane…")
    return handoff(cloud, dc, args, items, per_style, order)


def handoff(cloud: Node, dc: Node, args, items, per_style, order) -> int:
    """Everything from the warehouse counting to the price being published."""

    # --- 02 · The warehouse counts it, blind ------------------------------
    work = dc.get("/api/v1/dc/purchase-orders")
    waiting = [
        line
        for line in work.get("items", [])
        if line.get("po_number") == order.get("po_number")
    ]
    if not waiting:
        print(
            "  02 the order has not reached the warehouse yet. The sync lane moves on\n"
            "     its own timer; run this again in a few seconds and it will pick up\n"
            "     where it left off — every step is idempotent.",
            file=sys.stderr,
        )
        return 1

    receipts = dc.get("/api/v1/dc/goods-receipts")
    open_receipts = receipts.get("items") or []
    receipt_id = (
        open_receipts[0]["receipt_id"]
        if open_receipts
        else dc.post(
            "/api/v1/dc/goods-receipts",
            {
                "supplier_id": order.get("supplier_id") or items[0]["supplier_id"],
                "actor_id": "penerima",
                "idempotency_key": f"{args.label}-grn",
            },
        )["receipt_id"]
    )
    print(f"  02 delivery {receipt_id} open; counting {len(waiting)} lines blind")

    for index, line in enumerate(waiting):
        count = dc.post(
            "/api/v1/dc/purchase-counts",
            {
                "receipt_id": receipt_id,
                "po_line_id": line["po_line_id"],
                "counted_quantity": per_style,
                "actor_id": "checker",
                "idempotency_key": f"{args.label}-count-{index}",
            },
        )
        # --- 03 · A second person accepts it ------------------------------
        #
        # Counting and accepting are two people on purpose: one person doing
        # both is how a delivery gets signed for without being looked at.
        dc.post(
            "/api/v1/dc/purchase-verifications",
            {
                "count_id": count["count_id"],
                "decision": "Accept",
                "verifier_actor_id": "verifier",
                "idempotency_key": f"{args.label}-verify-{index}",
            },
        )
    print(f"  03 counted and accepted {len(waiting)} lines")
    print("     waiting for the receipts to reach head office…")

    # --- 04 · Head office says what the goods ARE -------------------------
    unidentified = cloud.get("/api/v1/article-setups/unidentified").get("items", [])
    if not unidentified:
        print(
            "  04 nothing is waiting to be identified yet — the receipts are still on\n"
            "     the sync lane. Run this again shortly.",
            file=sys.stderr,
        )
        return 1

    # The receipt line already carries what the buyer wrote on the order —
    # name, division, tags and the photograph — because the order snapshotted
    # them from the supplier item. Reading them here rather than matching back
    # to the catalogue means the setup describes what was ACTUALLY ordered,
    # even if somebody has edited the catalogue since.
    cost_by_code = {
        item.get("supplier_item_code"): item.get("unit_price_minor") for item in items
    }
    made = 0
    for pending in unidentified:
        received = int(pending.get("quantity") or 0)
        if received <= 0:
            continue
        # The sizes have to account for every piece received: a setup that
        # named fewer would leave stock in `unidentified` with nothing to
        # rescue it, and one that named more would invent goods.
        each, spare = divmod(received, len(SIZES))
        counts = [each + (1 if index < spare else 0) for index in range(len(SIZES))]
        variants = [
            {
                "colour_digit": "1",
                "size_code": size,
                "quantity": count,
                "base_price_minor": retail_of(
                    cost_by_code.get(pending.get("supplier_article_code"))
                ),
            }
            for size, count in zip(SIZES, counts)
            if count > 0
        ]
        name = pending.get("article_name") or "Barang"
        session = cloud.post(
            "/api/v1/article-setups",
            {
                "receipt_line_id": pending["receipt_line_id"],
                "article_name": name,
                "division_code": pending.get("division_code") or "MENSWEAR",
                "tags": pending.get("tags") or [],
                # The photograph, carried onto the article. This is the only
                # path in the system that writes `article.image_url`.
                "image_url": pending.get("image_url"),
                "currency": "IDR",
                "created_by": args.user,
                "colours": [
                    {"colour_digit": "1", "label": "Dasar", "hex_code": "#334155"}
                ],
                "variants": variants,
            },
            idempotency_key=f"{args.label}-setup-{pending['receipt_line_id']}",
        )
        # --- 05 · Issuing mints the SKUs and publishes their first price ---
        issued = cloud.post(
            f"/api/v1/article-setups/{session['session_id']}/issue",
            {"issued_by": args.user},
            idempotency_key=f"{args.label}-issue-{session['session_id']}",
        )
        minted = len(issued.get("variants") or [])
        made += minted
        print(
            f"  04 {name[:40]:40s} -> {minted} SKUs, {received} pieces"
            f"{'  with photo' if pending.get('image_url') else '  NO PHOTO'}"
        )

    print(f"  05 {made} SKUs minted, each with a published price")
    print(
        "\nDone. The goods now exist as master data: look at /commercial for what "
        "each shop\nwill charge, and at /commercial/books for the price books this "
        "created."
    )
    return 0


def retail_of(cost_minor) -> int:
    """What to sell it for, given what it cost.

    A flat markup, and deliberately a crude one: this is seed data, not a
    pricing decision, and a script that pretended to know the right margin per
    division would be inventing commercial policy nobody agreed to. Rounded to
    a thousand rupiah because that is how price tags in this market are written.
    """
    cost = int(cost_minor or 100_000)
    return max(1_000, round(cost * 2.2 / 1_000) * 1_000)


if __name__ == "__main__":
    raise SystemExit(main())
