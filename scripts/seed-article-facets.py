#!/usr/bin/env python3
"""Give the demo articles the attributes the Articles screen filters by.

A node seeded with articles but no division, tags or colourways draws a filter
rail with nothing in it — the screen is correct and the master data is bare,
which looks the same from the browser. This writes the smallest set that makes
every facet real: four divisions, twelve tags, seven sizes and eleven colours
across six styles.

    ITULAH_API=http://127.0.0.1:8080 ITULAH_DB=inventory_tanstack \
        python3 scripts/seed-article-facets.py

Attributes go through PATCH /api/v1/articles/{code}, guarded with If-Match and
Idempotency-Key exactly as the browser sends them, so this exercises the same
path a merchandiser does. Two columns go through psql instead —
`sku.colour_digit` and `sku.size_code` — because SKUs are minted by a setup
session and no endpoint edits them afterwards; these demo rows were never
minted through one.

Re-running is safe: the PATCH replaces tags and colourways rather than adding
to them, and the SQL is an idempotent UPDATE.

Deliberately NOT seeded: `sku.base_price_minor`. A price reaches a till through
a commercial publication and nothing else — a base price on the SKU is the
second authority that put one number on a garment's label and another at the
counter (see `publish_setup_prices` in backend/src/cloud/postgres/tagging.rs).
The Articles price column reading "—" is that invariant holding, not a gap.

The photographs are illustrative and hosted elsewhere, the same convention
`seed-catalogue.py` already uses for supplier items.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = os.environ.get("ITULAH_API", "http://127.0.0.1:8080").rstrip("/")
DB = os.environ.get("ITULAH_DB", "inventory_tanstack")

UNSPLASH = "https://images.unsplash.com/{}?w=600"

# article -> division, tags, photo, and one (digit, colour, size) per SKU.
#
# The colourways are varied on purpose: a fleet where every style is Black,
# Navy and Natural gives a colour facet with three rows in it, which tests
# nothing about a filter people use to find one shirt among hundreds.
PLAN = {
    "ART-CAP": (
        "AKSESORIS",
        ["AKSESORI", "BASIC"],
        "photo-1588850561407-ed78c282e89b",
        [("0", "BLACK", "08"), ("1", "NAVY", "08"), ("2", "KHAKI", "08")],
    ),
    "ART-TSHIRT": (
        "PRIA",
        ["KAOS", "BASIC", "LENGAN_PENDEK"],
        "photo-1521572163474-6864f9cf17ab",
        [("0", "WHITE", "02"), ("1", "BLACK", "03"), ("2", "OLIVE", "04")],
    ),
    "ART-HOODIE": (
        "PRIA",
        ["RAJUT", "LENGAN_PANJANG", "MUSIMAN"],
        "photo-1556821840-3a63f95609a7",
        [("0", "CHARCOAL", "02"), ("1", "MAROON", "03"), ("2", "MINT", "04")],
    ),
    "ART-DENIM": (
        "NON_DIVISI",
        ["CELANA", "DENIM", "BASIC"],
        "photo-1542272604-787c3835535d",
        [("0", "DENIM", "02"), ("1", "NAVY", "03"), ("2", "BLACK", "04")],
    ),
    "ART-JACKET": (
        "WANITA",
        ["JAKET", "MUSIMAN", "FORMAL"],
        "photo-1516257984-b1b4d707412e",
        [("0", "OLIVE", "02"), ("1", "BEIGE", "03"), ("2", "NAVY", "04")],
    ),
    # Shoes carry EU sizes rather than S/M/L, so the size facet is not one
    # ladder pretending to fit everything the company sells.
    "ART-SHOES": (
        "SANDAL_SEPATU",
        ["SEPATU"],
        "photo-1542291026-7eec264c27ff",
        [("0", "WHITE", "13"), ("1", "BLACK", "14"), ("2", "RED", "15")],
    ),
}

# The demo SKUs are `SKU-nn-S|M|L`; the suffix is the only thing that tells
# them apart within an article.
SUFFIXES = ["S", "M", "L"]


def call(method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{API}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw)
        except ValueError:
            return error.code, {"error": raw.decode(errors="replace")[:300]}
    except urllib.error.URLError as error:
        # Wrong address, node asleep, no network. A stack trace here tells the
        # person running this nothing they can act on; the address does.
        sys.exit(f"Could not reach {API}: {error.reason}")


def sql(statement):
    done = subprocess.run(
        ["psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAc", statement],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.exit(f"psql failed against {DB}: {done.stderr.strip()}")
    return done.stdout.strip()


def main():
    status, health = call("GET", "/api/v1/health")
    if status != 200:
        sys.exit(f"{API} did not answer /api/v1/health ({status}).")
    if health.get("auth") != "DISABLED":
        sys.exit(
            f"{API} has authentication on; this seed signs nothing in. "
            "Point it at a dev node with INVENTORY_AUTH_MODE=disabled."
        )

    for code, (division, tags, photo, ways) in PLAN.items():
        status, detail = call("GET", f"/api/v1/articles/{code}")
        if status != 200:
            sys.exit(f"{code}: detail {status} {detail}")
        body = {
            "division_code": division,
            "tags": tags,
            "image_url": UNSPLASH.format(photo),
            "colours": [
                {"colour_digit": digit, "colour_code": colour}
                for digit, colour, _ in ways
            ],
        }
        status, answer = call(
            "PATCH",
            f"/api/v1/articles/{code}",
            body,
            {
                "if-match": f'"{detail["article"]["version"]}"',
                # The key changes with the payload, not with the run: a second
                # run of the same seed is the same act and should replay, while
                # an edited seed is a new one and must not.
                "idempotency-key": f"seed-article-facets-{code}-v2",
            },
        )
        if status not in (200, 201):
            sys.exit(f"{code}: patch {status} {answer}")
        print(f"{code:12} {division:11} {len(tags)} tags  {len(ways)} colourways  photo")

    # The colourway rows written above are what these point at, so they cannot
    # be set before the PATCH lands.
    for code, (_, _, _, ways) in PLAN.items():
        for suffix, (digit, colour, size) in zip(SUFFIXES, ways):
            sql(
                f"UPDATE sku s SET colour_digit = '{digit}', size_code = '{size}', "
                f"color = (SELECT label FROM colour WHERE code = '{colour}'), "
                f"size = (SELECT label FROM size_code WHERE code = '{size}') "
                f"FROM article a "
                f"WHERE a.id = s.article_id AND a.article_code = '{code}' "
                f"AND s.sku_code LIKE '%-{suffix}'"
            )
    print("sku colour digits and size codes written")


if __name__ == "__main__":
    main()
