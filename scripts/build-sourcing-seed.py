#!/usr/bin/env python3
"""Turn the H&M article export and the uploaded photographs into a sourcing
catalogue this system can actually browse.

Sourcing answers "what can we buy". That question needs four things on every
row — a name, what kind of thing it is, what it costs, and which part of the
range it belongs to — and a screen missing any of them is a list you can walk
but not search. This builds all four from two inputs that already exist:

    data/supplier-images-hm.json   2806 photographs, keyed by supplier item code
    articles.csv                   the H&M article export, 105k rows

Every one of the 2806 codes is present in the export, so no row is invented.

# What IS invented, and why it is marked

**Suppliers.** There is no supplier in either input. Sourcing groups by supplier
because a purchase order is raised against exactly one `supplier_id`, so a
catalogue with one supplier cannot exercise the screen at all. Names are made
up, deterministic, and flagged in the file.

**Prices.** The H&M export carries no price column — prices live in the
transactions file, which we do not have. They are derived here from the garment
group, so a pair of socks is cheaper than a coat and the price slider has a
believable spread. THESE ARE NOT REAL PRICES. Anything that turns into a real
purchase order must have them replaced.

Everything else — name, description, kind, division — comes from the export.
"""

from __future__ import annotations

import csv
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "data" / "supplier-images-hm.json"
OUT = ROOT / "data" / "sourcing-seed.json"
ITEMS_PER_SUPPLIER = 100

# H&M's index group is about who a garment is for; the client's divisions
# (0382, KODE DIVISI 1-9) mostly ask the same question in their own words.
#
# `Divided` is the young-fashion range and is sold to everyone, so it is not
# Pria or Wanita; it goes to Non Divisi rather than being forced into one of
# those. `Baby/Children` does not say boy, girl or baby at this level, so it
# lands in Anak Laki-laki as a placeholder: the export's section name would
# split it properly, and should before this feeds anything real.
INDEX_GROUP_TO_DIVISION = {
    "Ladieswear": "WANITA",
    "Menswear": "PRIA",
    "Baby/Children": "ANAK_LAKI",
    # Every Sport row in this set is sectioned "Men H&M Sport".
    "Sport": "PRIA",
    "Divided": "NON_DIVISI",
}

# What a thing IS beats who it is for: a shoe is Sandal dan Sepatu whether it
# is a woman's or a child's, so these win over the index group above.
PRODUCT_GROUP_TO_DIVISION = {
    "Shoes": "SANDAL_SEPATU",
    "Accessories": "AKSESORIS",
}

# Garment group is the closest thing in the export to "what kind of garment",
# which is what a buyer filters by. Codes are from `tag` (0027 and 0041).
GARMENT_GROUP_TO_TAGS = {
    "Jersey Basic": ["KAOS", "BASIC"],
    "Jersey Fancy": ["KAOS"],
    "Accessories": ["AKSESORI"],
    "Socks and Tights": ["KAUS_KAKI"],
    "Under-, Nightwear": ["DALAMAN"],
    "Trousers": ["CELANA"],
    "Trousers Denim": ["CELANA", "DENIM"],
    "Knitwear": ["RAJUT"],
    "Outdoor": ["JAKET"],
    "Shirts": ["KEMEJA"],
    "Shoes": ["SEPATU"],
    "Swimwear": ["RENANG"],
    "Dresses Ladies": ["GAUN"],
    "Shorts": ["CELANA_PENDEK"],
    "Dressed": ["FORMAL"],
    "Skirts": ["ROK"],
    "Blouses": ["BLUS"],
    # "Unknown" and "Special Offers" say nothing about the garment. They are
    # not left bare, though — the fallbacks below read the product type and
    # group instead, which do say something.
}

# Read when the garment group says nothing. The product type is the most
# specific description in the export, so it is consulted before the group.
PRODUCT_TYPE_TO_TAGS = {
    "Shirt": ["KEMEJA"],
    "Blouse": ["BLUS"],
    "Dress": ["GAUN"],
    "Skirt": ["ROK"],
    "Trousers": ["CELANA"],
    "Shorts": ["CELANA_PENDEK"],
    "Sweater": ["RAJUT"],
    "Hoodie": ["KAOS"],
    "Jacket": ["JAKET"],
    "Coat": ["JAKET"],
    "T-shirt": ["KAOS"],
    "Belt": ["AKSESORI"],
    "Socks": ["KAUS_KAKI"],
}

# The last resort. Coarse, but a coarse true tag beats a blank cell: an item
# with no tag at all cannot be reached by any tag filter, which is how a
# catalogue quietly hides part of itself from the people buying from it.
PRODUCT_GROUP_TO_TAGS = {
    "Accessories": ["AKSESORI"],
    "Shoes": ["SEPATU"],
    "Socks & Tights": ["KAUS_KAKI"],
    "Underwear": ["DALAMAN"],
    "Underwear/nightwear": ["DALAMAN"],
    "Nightwear": ["TIDUR"],
    "Swimwear": ["RENANG"],
    "Garment Upper body": ["KAOS"],
    "Garment Lower body": ["CELANA"],
    "Garment Full body": ["GAUN"],
}

# Rupiah, whole. A floor and a ceiling per kind, and the code picks a point
# between them — so the same article always gets the same price and a rebuild
# does not reshuffle the catalogue.
PRICE_BAND_BY_GARMENT_GROUP = {
    "Socks and Tights": (19_000, 59_000),
    "Under-, Nightwear": (39_000, 149_000),
    "Accessories": (29_000, 249_000),
    "Jersey Basic": (49_000, 159_000),
    "Jersey Fancy": (79_000, 229_000),
    "Swimwear": (99_000, 279_000),
    "Shorts": (99_000, 249_000),
    "Skirts": (129_000, 329_000),
    "Blouses": (149_000, 349_000),
    "Shirts": (149_000, 379_000),
    "Trousers": (159_000, 429_000),
    "Trousers Denim": (199_000, 549_000),
    "Dresses Ladies": (199_000, 599_000),
    "Knitwear": (199_000, 549_000),
    "Dressed": (249_000, 699_000),
    "Shoes": (249_000, 799_000),
    "Outdoor": (349_000, 1_299_000),
}
DEFAULT_PRICE_BAND = (79_000, 299_000)

# Made-up suppliers. Indonesian garment-trade names, because the buyers reading
# this screen are Indonesian and a catalogue of "Supplier 01" teaches nobody
# anything about whether the screen works.
SUPPLIER_NAMES = [
    "Sinar Tekstil Nusantara", "Anugerah Garmen Sejahtera", "Cahaya Busana Mandiri",
    "Bintang Konveksi Utama", "Mitra Sandang Perkasa", "Karya Benang Abadi",
    "Sumber Kain Makmur", "Harapan Jaya Tekstil", "Permata Garmen Indonesia",
    "Tunas Busana Lestari", "Gemilang Sandang Persada", "Berkah Konveksi Raya",
    "Cemerlang Tekstil Jaya", "Nusantara Apparel Prima", "Sejahtera Kain Utama",
    "Indah Busana Gemilang", "Prima Garmen Selaras", "Sentosa Tekstil Mandiri",
    "Maju Bersama Konveksi", "Rukun Sandang Nusantara", "Damai Garmen Perkasa",
    "Wijaya Tekstil Abadi", "Surya Busana Nusantara", "Kencana Konveksi Jaya",
    "Mustika Sandang Utama", "Arjuna Garmen Lestari", "Pelangi Tekstil Sejahtera",
    "Srikandi Busana Mandiri",
]


def stable_fraction(code: str, salt: str) -> float:
    """A repeatable number in [0, 1) from a code.

    `hash()` is salted per process in Python 3, so it would give a different
    catalogue on every run. This does not.
    """
    digest = hashlib.sha256(f"{salt}:{code}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / (1 << 64)


def price_for(code: str, garment_group: str) -> int:
    low, high = PRICE_BAND_BY_GARMENT_GROUP.get(garment_group, DEFAULT_PRICE_BAND)
    raw = low + (high - low) * stable_fraction(code, "price")
    # Retail prices end in round thousands; 187_431 reads as a bug.
    return int(round(raw / 1000) * 1000)


def division_for(row: dict) -> str | None:
    by_product = PRODUCT_GROUP_TO_DIVISION.get(row["product_group_name"])
    if by_product is not None:
        return by_product
    return INDEX_GROUP_TO_DIVISION.get(row["index_group_name"])


def tags_for(row: dict) -> list[str]:
    tags = list(GARMENT_GROUP_TO_TAGS.get(row["garment_group_name"], []))
    if not tags:
        tags = list(PRODUCT_TYPE_TO_TAGS.get(row["product_type_name"], []))
    if not tags:
        tags = list(PRODUCT_GROUP_TO_TAGS.get(row["product_group_name"], []))
    # Sleeve length is a real filter and the vocabulary from 0027 already has
    # both words; only claim it when the product type says so outright.
    kind = row["product_type_name"].lower()
    if "long sleeve" in kind or "longsleeve" in kind:
        tags.append("LENGAN_PANJANG")
    elif kind in {"t-shirt", "vest top", "top"}:
        tags.append("LENGAN_PENDEK")
    if row["garment_group_name"] == "Under-, Nightwear" and row["product_group_name"] == "Nightwear":
        tags.append("TIDUR")
    # De-duplicate, keep order.
    return list(dict.fromkeys(tags))


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <path/to/articles.csv>", file=sys.stderr)
        return 2
    articles_csv = pathlib.Path(sys.argv[1])

    manifest = json.loads(MANIFEST.read_text())
    images = {item["supplier_item_code"]: item["image_url"] for item in manifest["items"]}

    rows: dict[str, dict] = {}
    with articles_csv.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["article_id"] in images:
                rows[row["article_id"]] = row

    missing = sorted(set(images) - set(rows))
    if missing:
        print(f"{len(missing)} photographs have no article row, e.g. {missing[:3]}", file=sys.stderr)
        return 1

    items = []
    for code in sorted(rows):
        row = rows[code]
        description = row["detail_desc"].strip() or None
        items.append({
            "supplier_item_code": code,
            "name": row["prod_name"].strip(),
            "description": description,
            "image_url": images[code],
            "unit_price_minor": price_for(code, row["garment_group_name"]),
            "currency": "IDR",
            "division_code": division_for(row),
            "tags": tags_for(row),
            "status": "ACTIVE",
        })

    # Spread items across suppliers by a stable hash of the code rather than by
    # position, so one supplier does not end up holding every colourway of the
    # same article — which would make the supplier facet look like an article
    # index and hide whether grouping works.
    supplier_count = len(SUPPLIER_NAMES)
    items.sort(key=lambda item: stable_fraction(item["supplier_item_code"], "supplier"))
    suppliers = []
    for index, name in enumerate(SUPPLIER_NAMES):
        share = items[index::supplier_count]
        code = f"SUP{index + 1:02d}"
        suppliers.append({
            "supplier_code": code,
            "name": name,
            "contact_name": None,
            "phone": None,
            "email": None,
            "address": None,
            "status": "ACTIVE",
            "items": sorted(share, key=lambda item: item["supplier_item_code"]),
        })

    seed = {
        "note": (
            "Supplier names and unit prices are FABRICATED. Names, descriptions, "
            "kinds and divisions come from the H&M article export; photographs "
            "come from data/supplier-images-hm.json. Replace prices before any "
            "of this reaches a real purchase order."
        ),
        "items_per_supplier": ITEMS_PER_SUPPLIER,
        "supplier_count": len(suppliers),
        "item_count": len(items),
        "suppliers": suppliers,
    }
    OUT.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n")

    print(f"{len(items)} item across {len(suppliers)} supplier -> {OUT.relative_to(ROOT)}")
    sizes = sorted({len(s["items"]) for s in suppliers})
    print(f"item per supplier: {sizes[0]}-{sizes[-1]}")
    unclassified = sum(1 for i in items if i["division_code"] is None)
    untagged = sum(1 for i in items if not i["tags"])
    prices = sorted(i["unit_price_minor"] for i in items)
    print(f"tanpa division: {unclassified} ({unclassified * 100 // len(items)}%)")
    print(f"tanpa tag:      {untagged} ({untagged * 100 // len(items)}%)")
    print(f"harga: {prices[0]:,} - {prices[-1]:,} IDR, median {prices[len(prices) // 2]:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
