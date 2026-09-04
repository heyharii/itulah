#!/usr/bin/env python3
"""Fill the range out to something a pricelist screen has to cope with.

Six styles is a screenshot, not a test. Every judgement the Pricelist makes —
does the grid stay readable, is the search worth having, does a filter narrow
anything — is a judgement about a few hundred styles across thirteen shops, and
none of it can be made against a catalogue that fits on one screen.

    ITULAH_DB=inventory_tanstack python3 scripts/seed-pricelist-scale.py

Three shapes are seeded deliberately, because they are the three the screen has
to draw differently and a uniform catalogue would let all three go untested:

  * **One price per style** (most of them). One rung, one amount, nothing to
    expand. This is the row the grid must not make heavy weather of.
  * **Priced per size** (~1 in 7). One rung carrying SEVERAL amounts, because a
    XXL costs more than an S. This is the case where a single figure in a cell
    would be a lie, and the reason the cell has to say how many prices are
    under it.
  * **A shop that charges less** (~1 in 5). A second rung at two to four shops,
    so the cascade has depth and "what did this price beat" has an answer.

Everything is written straight to Postgres rather than through the API. There
is no endpoint that mints a SKU outside a setup session, and none that writes a
price outside a publish — the two paths this script would have to fake are
exactly the two with the most invariants in them, and faking them badly is how
a seeded database ends up disagreeing with a real one. Prices DO go through a
real publication (drafted, filled, then published) because that is a row the
reader can see and the immutability trigger enforces the order anyway.

Re-running is safe: articles are keyed by a stable code and every insert is
ON CONFLICT DO NOTHING, and the publication is found by name before a new one
is minted.
"""

import os
import random
import subprocess
import sys
import uuid

DB = os.environ.get("ITULAH_DB", "inventory_tanstack")
HOW_MANY = int(os.environ.get("ITULAH_ARTICLES", "500"))

# Deterministic, so two runs describe the same catalogue and a screenshot taken
# today still matches the database tomorrow.
RNG = random.Random(20260904)

# ── the vocabulary the names are built from ────────────────────────────────
# Indonesian, because the fleet is: a merchandiser searching this screen types
# "kemeja", not "shirt", and a catalogue in the wrong language makes the search
# box untestable.
GARMENTS = {
    "MENSWEAR": [
        ("Kemeja", ["Flanel", "Oxford", "Linen", "Katun", "Denim", "Motif"]),
        ("Kaos", ["Polos", "Grafis", "Saku", "Raglan", "Oversize"]),
        ("Celana", ["Chino", "Kargo", "Bahan", "Jogger", "Pendek"]),
        ("Jaket", ["Bomber", "Parka", "Denim", "Coach", "Windbreaker"]),
        ("Sweater", ["Rajut", "Crewneck", "Zip", "Half-Zip"]),
    ],
    "WOMENSWEAR": [
        ("Blus", ["Katun", "Sifon", "Lengan Balon", "Kerah V", "Motif"]),
        ("Gaun", ["Midi", "Maxi", "Wrap", "Slip", "Kemeja"]),
        ("Rok", ["Plisket", "A-Line", "Denim", "Pensil", "Wrap"]),
        ("Kardigan", ["Rajut", "Panjang", "Crop", "Oversize"]),
        ("Kulot", ["Linen", "Katun", "Denim", "Bahan"]),
    ],
    "KIDS": [
        ("Kaos Anak", ["Karakter", "Polos", "Garis", "Motif"]),
        ("Celana Anak", ["Pendek", "Jogger", "Denim", "Kargo"]),
        ("Dress Anak", ["Katun", "Motif", "Renda"]),
        ("Piyama Anak", ["Katun", "Flanel", "Motif"]),
    ],
    "FOOTWEAR": [
        ("Sepatu", ["Lari", "Kanvas", "Kulit", "Slip-On", "Basket"]),
        ("Sandal", ["Jepit", "Slide", "Gunung", "Kulit"]),
        ("Boot", ["Chelsea", "Hiking", "Kulit"]),
    ],
    "ACCESSORY": [
        ("Topi", ["Baseball", "Bucket", "Rajut"]),
        ("Tas", ["Ransel", "Selempang", "Tote", "Pinggang"]),
        ("Ikat Pinggang", ["Kulit", "Kanvas", "Anyam"]),
        ("Kaus Kaki", ["Pendek", "Panjang", "Olahraga"]),
        ("Dompet", ["Lipat", "Kartu", "Panjang"]),
    ],
    "DIVIDED": [
        ("Denim", ["Straight", "Slim", "Baggy", "Mom", "Wide-Leg"]),
        ("Hoodie", ["Polos", "Grafis", "Zip", "Crop"]),
        ("Jersey", ["Retro", "Klub", "Latihan"]),
    ],
}

SEASONS = ["Basic", "Musim Panas", "Musim Hujan", "Lebaran", "Sekolah", "Kerja"]

# Tag codes that exist in `tag`, grouped by the division they make sense under.
# A tag that contradicts the garment ("SEPATU" on a shirt) makes the facet
# counts look plausible and the filter results nonsense.
TAGS = {
    "MENSWEAR": ["KEMEJA", "KAOS", "CELANA", "JAKET", "BASIC", "FORMAL",
                 "LENGAN_PANJANG", "LENGAN_PENDEK", "RAJUT"],
    "WOMENSWEAR": ["BLUS", "GAUN", "ROK", "BASIC", "FORMAL", "RAJUT",
                   "LENGAN_PANJANG", "MUSIMAN"],
    "KIDS": ["KAOS", "CELANA", "TIDUR", "BASIC", "MUSIMAN"],
    "FOOTWEAR": ["SEPATU", "KAUS_KAKI", "BASIC"],
    "ACCESSORY": ["AKSESORI", "KAUS_KAKI", "BASIC"],
    "DIVIDED": ["DENIM", "CELANA", "KAOS", "CELANA_PENDEK", "MUSIMAN", "BASIC"],
}

# Size codes from `size_code`, by what the garment is measured in.
APPAREL_SIZES = ["02", "03", "04", "05", "06"]        # S M L XL XXL
SHOE_SIZES = ["11", "12", "13", "14", "15"]           # EU 37-41
ONE_SIZE = ["08"]

COLOURS = ["BLACK", "NAVY", "WHITE", "GREY", "BEIGE", "MAROON", "OLIVE",
           "DENIM", "KHAKI", "CHARCOAL", "MINT", "MUSTARD", "BROWN", "BLUE"]

# Rupiah, whole units. `unit_price_minor` is NOT cents here — lib/format.ts and
# the existing rows both say so, and a seed that multiplied by a hundred would
# put every article a hundredfold out of every filter's reach.
BANDS = {
    "MENSWEAR": (89_000, 399_000),
    "WOMENSWEAR": (99_000, 459_000),
    "KIDS": (59_000, 199_000),
    "FOOTWEAR": (199_000, 899_000),
    "ACCESSORY": (39_000, 299_000),
    "DIVIDED": (149_000, 549_000),
}


def psql(sql, quiet=True):
    """Run one statement, and stop the run if it fails.

    `ON_ERROR_STOP` matters more than it looks: without it psql reports a
    failed INSERT on stderr, exits 0, and the script cheerfully announces a
    catalogue that is not there."""
    done = subprocess.run(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", DB, "-c", sql],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip(), file=sys.stderr)
        sys.exit(f"psql failed on: {sql[:120]}…")
    return done.stdout


def scalar(sql):
    done = subprocess.run(
        ["psql", "-tAX", "-d", DB, "-c", sql], capture_output=True, text=True
    )
    return done.stdout.strip()


def money(low, high):
    """A price that looks like a price: rounded to the nearest 10.000, ending
    in 9.000 the way a shelf edge does."""
    step = RNG.randrange(low // 10_000, high // 10_000 + 1)
    return max(step * 10_000 - 1_000, 9_000)


def quote(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def main():
    sites = [
        line for line in scalar(
            "SELECT site_id FROM sync_origin_credential "
            "WHERE node_role = 'STORE' AND site_id IS NOT NULL ORDER BY site_id"
        ).splitlines() if line
    ]
    if not sites:
        sys.exit("No STORE origin is registered — the pricelist would have no "
                 "columns and this seed nothing to price against.")
    print(f"{len(sites)} shops")

    articles, colours, skus, tags, prices = [], [], [], [], []
    per_size = shop_cut = 0

    for n in range(1, HOW_MANY + 1):
        code = f"ART-{n:04d}"
        division = RNG.choice(list(GARMENTS))
        family, variants = RNG.choice(GARMENTS[division])
        name = f"{family} {RNG.choice(variants)}"
        if RNG.random() < 0.45:
            name += f" {RNG.choice(SEASONS)}"

        article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"itulah/article/{code}"))
        articles.append(
            f"({quote(article_id)}, {quote(code)}, {quote(name)}, "
            f"{quote(division)}, true)"
        )

        for tag in RNG.sample(TAGS[division], RNG.randint(1, 3)):
            tags.append(f"({quote(article_id)}, {quote(tag)})")

        sizes = (SHOE_SIZES if division == "FOOTWEAR"
                 else ONE_SIZE if family in ("Topi", "Tas", "Dompet",
                                             "Ikat Pinggang")
                 else APPAREL_SIZES)
        sizes = sizes if len(sizes) == 1 else RNG.sample(sizes, RNG.randint(3, len(sizes)))
        sizes.sort()
        ways = RNG.sample(COLOURS, RNG.randint(1, 2))

        low, high = BANDS[division]
        base = money(low, high)
        # One style in seven is priced by size. The step is per size index, so
        # the amounts come out ordered — an S cheaper than an XXL — which is
        # what makes the breakdown readable rather than a set of noise.
        by_size = RNG.random() < 0.14
        if by_size:
            per_size += 1
        step = RNG.choice([10_000, 20_000, 30_000]) if by_size else 0

        article_skus = []
        for digit, colour in enumerate(ways):
            colours.append(
                f"({quote(article_id)}, {quote(str(digit))}, {quote(colour)}, "
                f"{quote(colour.replace('_', ' ').title())})"
            )
            for index, size in enumerate(sizes):
                sku_code = f"SKU-{n:04d}-{digit}{size}"
                sku_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"itulah/sku/{sku_code}"))
                skus.append(
                    f"({quote(sku_id)}, {quote(article_id)}, {quote(sku_code)}, "
                    f"{quote(str(digit))}, {quote(size)}, "
                    f"{quote(colour.replace('_', ' ').title())}, {quote(size)}, true)"
                )
                article_skus.append((sku_id, base + index * step))

        for sku_id, amount in article_skus:
            prices.append((sku_id, None, amount))

        # One style in five is cheaper at a handful of shops. Written as its
        # own rule per shop, which is what gives the cascade a second rung —
        # the company price is still there underneath, and still the answer
        # everywhere else.
        if RNG.random() < 0.2:
            shop_cut += 1
            off = RNG.choice([10_000, 20_000, 30_000, 40_000])
            for site in RNG.sample(sites, RNG.randint(2, 4)):
                for sku_id, amount in article_skus:
                    prices.append((sku_id, site, max(amount - off, 9_000)))

    print(f"{len(articles)} articles · {len(skus)} SKUs · {len(prices)} price rules")
    print(f"  {per_size} priced per size · {shop_cut} with a shop that charges less")

    def insert(table, columns, rows, chunk=500):
        for start in range(0, len(rows), chunk):
            batch = ",\n".join(rows[start:start + chunk])
            psql(f"INSERT INTO {table} ({columns}) VALUES {batch} "
                 f"ON CONFLICT DO NOTHING;")

    print("writing articles…")
    insert("article", "id, article_code, name, division_code, active", articles)
    insert("article_colour", "article_id, colour_digit, colour_code, label", colours)
    insert("sku", "id, article_id, sku_code, colour_digit, size_code, color, size, active", skus)
    insert("article_tag", "article_id, tag_code", tags)

    # ── the publication ────────────────────────────────────────────────────
    # Drafted, filled, then published — the order the immutability trigger
    # enforces on real publishes, so this seed cannot write a shape the app
    # could not have produced.
    name = "Range 2026"
    # Only a PUBLISHED book counts as done. A DRAFT with this name is the
    # wreckage of a run that died partway — it is still writable (the trigger
    # only bites once published), so the right move is to carry on filling it
    # rather than to mint a second book saying the same thing.
    publication = scalar(
        f"SELECT id FROM commercial_publication "
        f"WHERE name = {quote(name)} AND status = 'PUBLISHED'"
    )
    if publication:
        print(f"publication “{name}” is already published — leaving prices alone")
    else:
        publication = scalar(
            f"SELECT id FROM commercial_publication WHERE name = {quote(name)}"
        )
        if publication:
            print(f"resuming the unfinished draft of “{name}”…")
        else:
            publication = str(uuid.uuid4())
            version = int(scalar("SELECT COALESCE(max(version), 0) + 1 "
                                 "FROM commercial_publication"))
            psql(
                "INSERT INTO commercial_publication "
                "(id, version, name, status, effective_from, created_by) VALUES "
                f"({quote(publication)}, {version}, {quote(name)}, 'DRAFT', now(), 'seed')"
            )
        print(f"writing {len(prices)} prices into “{name}”…")
        rows = [
            f"({quote(str(uuid.uuid4()))}, {quote(publication)}, {quote(sku)}, "
            f"{quote(site)}, 'STORE', 'IDR', {amount}, 'STANDARD')"
            for sku, site, amount in prices
        ]
        insert(
            "commercial_price_rule",
            "id, publication_id, sku_id, site_id, channel, currency, "
            "unit_price_minor, tax_category",
            rows,
        )

        # An assortment row per price, at the same scope.
        #
        # Not optional, and not obvious: `load_site_price_book` INNER JOINs
        # `commercial_assortment_rule` on (publication, sku, channel, site), so
        # a price with no assortment row beside it is invisible to the engine —
        # no error, no warning, the shop simply has no price. The first run of
        # this script seeded 4.335 prices that reached nothing at all, and the
        # screen was right to draw an empty grid.
        #
        # Which is the invariant working: what a shop MAY sell and what it
        # CHARGES are published together or not at all, so a book can never put
        # a price on something the shop was never given.
        insert(
            "commercial_assortment_rule",
            "id, publication_id, sku_id, site_id, channel, sellable",
            [
                f"({quote(str(uuid.uuid4()))}, {quote(publication)}, "
                f"{quote(sku)}, {quote(site)}, 'STORE', true)"
                for sku, site, _ in prices
            ],
        )
        psql(
            "UPDATE commercial_publication SET status = 'PUBLISHED', "
            "published_at = now(), published_by = 'seed' "
            f"WHERE id = {quote(publication)}"
        )

    print("\ntotals now:")
    print("  articles:", scalar("SELECT count(*) FROM article"))
    print("  skus:    ", scalar("SELECT count(*) FROM sku"))
    print("  prices:  ", scalar("SELECT count(*) FROM commercial_price_rule"))


if __name__ == "__main__":
    main()
