#!/usr/bin/env python3
"""Fill the drawer, the discussions, the conversations and the Reports shelf of
a dev cloud node — and give them people to have been written by.

A node with fourteen shops, five hundred articles and nobody in `app_user`
draws three correct, empty screens. Correct and empty look identical from the
browser, which is why every one of these modules has been reviewed against a
blank page since it was written. This puts something behind them.

    ITULAH_SEED_PASSWORD=... python3 scripts/seed-workplace.py --db inventory_tanstack

Everything here is idempotent: identifiers are `uuid5` of a fixed namespace and
a slug, so a second run writes the same rows and conflicts away. Re-running
after editing the content below updates nothing — drop the rows (`--reset`) and
run again.

# Why some of this is SQL and not HTTP

The house rule is that writes go through the API, because the invariants live
behind the endpoints. Three of these five sections cannot:

  * A node in dev runs `INVENTORY_AUTH_MODE=disabled`, so every principal is
    `development`. `open_thread`, `reply` and `send_message` take the author
    from the principal, which would give ten threads, thirty posts and every
    conversation one voice. A discussion whose every post is by the same person
    is not a discussion, and the screens are built to show the row of faces.
    `start_conversation` has the same problem twice over: it adds the caller as
    a participant, so every conversation would also have the same membership.

  * `POST /documents` presigns an upload into the attachment bucket and then
    goes and checks the object really arrived. A dev node has no bucket, so
    that endpoint answers "this node has no document storage configured" and
    there is no route that files a document whose bytes are in Postgres.

So those two are written directly, following exactly the shape their modules
write — including the `collaboration_event` rows the SSE stream replays from
and the `discussion_thread_view` rows the people-count is counted from.

Accounts and reports DO go through the API: password hashing belongs behind
`create_user`, and a report spec is validated against the catalogue on the way
in, which is the whole point of a spec. Reports are re-owned afterwards with
one UPDATE, because `create` stamps the caller and the caller is `development`.

# The bytes are real

Attachments are reachable on a bucket-less node — `GET
/discussions/{id}/attachments/{file_id}` reads them back out of `bytea` — so
the files here are real PDFs and a real CSV, generated below, with the hash and
the byte count that belong to them. A placeholder would be a row that lies and
a download that fails.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import textwrap
import urllib.error
import urllib.request
import uuid
import zlib
from base64 import b64encode
from getpass import getpass

# One namespace, so every id below is a pure function of its slug and a re-run
# lands on the same rows.
NS = uuid.UUID("6f1f5a1e-3b6c-4f0e-9f3a-9d5b1c7a4e20")


def rid(slug: str) -> uuid.UUID:
    return uuid.uuid5(NS, slug)


# ---------------------------------------------------------------------------
# talking to the node and to the database
# ---------------------------------------------------------------------------


def psql(db: str, statements: str) -> None:
    """Run SQL, refusing to continue past the first error."""
    result = subprocess.run(
        ["psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
        input=statements,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        sys.exit(f"psql failed:\n{result.stderr.strip()}")


def rows(db: str, query: str) -> list[list[str]]:
    result = subprocess.run(
        ["psql", "-d", db, "-tAF", "\x1f", "-c", query],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        sys.exit(f"psql failed:\n{result.stderr.strip()}")
    return [line.split("\x1f") for line in result.stdout.splitlines() if line]


def api(method: str, url: str, body: dict | None = None) -> tuple[int, dict | list | None]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            return error.code, json.loads(payload)
        except json.JSONDecodeError:
            return error.code, {"error": payload.decode(errors="replace")}


def q(value: str | None) -> str:
    """A SQL string literal, or NULL."""
    if value is None:
        return "NULL"
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def array(values: list[str]) -> str:
    if not values:
        return "'{}'::text[]"
    return "ARRAY[" + ",".join(q(value) for value in values) + "]::text[]"


# ---------------------------------------------------------------------------
# real files
# ---------------------------------------------------------------------------


def pdf(title: str, lines: list[str]) -> bytes:
    """A one-page PDF that actually opens.

    Written out by hand rather than pulled from a library: the script has no
    dependencies on purpose, and what is needed here is five objects and a
    correct xref table. A .pdf whose bytes are not a PDF is a row that lies
    about what somebody attached.
    """

    def escape(text: str) -> str:
        # PDF string literals, and the WinAnsi subset Helvetica can actually
        # draw — the content below is Indonesian, which stays inside it.
        out = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        return "".join(character if ord(character) < 256 else "?" for character in out)

    body = ["BT", "/F1 14 Tf", "60 782 Td", f"({escape(title)}) Tj", "/F1 10 Tf"]
    for line in lines:
        body.append("0 -18 Td")
        body.append(f"({escape(line)}) Tj")
    body.append("ET")
    stream = "\n".join(body).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)


def png(width: int, height: int, paint) -> bytes:
    """A real PNG, from the standard library and nothing else.

    `paint(x, y)` returns an `(r, g, b)`. There is no font here and no drawing
    library, so what these produce is plainly a placeholder rather than a
    photograph that never existed — which is the honest thing for seed data to
    be. What they are FOR is the preview: an image is the one attachment every
    browser can draw without a plugin, so a generated PNG is what proves the
    Files tiles really render their contents rather than their file extension.
    """
    raw = bytearray()
    for y in range(height):
        # Filter byte 0 (None) per scanline — the simplest of the five, and the
        # only one worth writing by hand.
        raw.append(0)
        for x in range(width):
            raw.extend(paint(x, y))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            len(payload).to_bytes(4, "big")
            + kind
            + payload
            + zlib.crc32(kind + payload).to_bytes(4, "big")
        )

    header = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + bytes([8, 2, 0, 0, 0])  # 8-bit, truecolour RGB, no interlace
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def _seam(x: int, y: int) -> tuple[int, int, int]:
    """Grey cloth with a dark seam wandering across it."""
    weave = 150 + ((x + y) % 7) * 4
    on_seam = abs(y - (150 + (x * x) // 900)) < 5
    return (60, 62, 78) if on_seam else (weave, weave - 6, weave - 14)


def _carton(x: int, y: int) -> tuple[int, int, int]:
    """Cardboard, with one corner crushed darker."""
    grain = 186 + ((x * 3 + y * 5) % 11) * 3
    dented = (x - 380) ** 2 + (y - 250) ** 2 < 90 ** 2
    tape = 150 < y < 172
    if tape:
        return (206, 196, 170)
    if dented:
        return (grain - 62, grain - 74, grain - 86)
    return (grain, grain - 34, grain - 74)


def stored_file_sql(file_id: uuid.UUID, name: str, content_type: str,
                    payload: bytes, uploader: str, ago_hours: int,
                    available: bool = True) -> str:
    """One `stored_file` row, bytes in Postgres.

    `storage = 'DATABASE'` is not a fallback here, it is the only truthful
    answer: there is no bucket on this node, and a row claiming `OBJECT` would
    name a key nothing put anything at.
    """
    digest = hashlib.sha256(payload).hexdigest()
    encoded = b64encode(payload).decode()
    return (
        "INSERT INTO stored_file (file_id, file_name, content_type, byte_size, sha256, "
        "storage, bytes, uploaded_by, uploaded_at, available) VALUES ("
        f"'{file_id}', {q(name)}, {q(content_type)}, {len(payload)}, {q(digest)}, "
        f"'DATABASE', decode('{encoded}','base64'), {q(uploader)}, "
        f"now() - interval '{ago_hours} hours', {str(available).lower()}) "
        "ON CONFLICT (file_id) DO NOTHING;"
    )


# ---------------------------------------------------------------------------
# who these people are
# ---------------------------------------------------------------------------

# The nine accounts are nine people who already exist in `employee` (see
# `seed-people.py`), so the Directory, the Access screen and the row of faces
# on a thread are all naming the same person. The roles are the ladder in
# `domain::auth`: what somebody may do, not what their job is called.
#
# username, display name, role, employee code
ACCOUNTS = [
    ("andi", "Andi Prasetyo", "ADMIN", "HO-0001"),
    ("sari", "Sari Wulandari", "SUPERVISOR", "HO-0002"),
    ("bagus", "Bagus Nugroho", "SUPERVISOR", "HO-0003"),
    ("ratih", "Ratih Kusuma", "SUPERVISOR", "HO-0004"),
    ("dimas", "Dimas Saputra", "SUPERVISOR", "HO-0005"),
    # Warehouse staff, numbered in the HO series since migration 0230 folded
    # the distribution centre into head office. These bind to `seed-people.py`
    # by employee code, so the two files have to move together — a login bound
    # to a code nobody issues is an account belonging to nobody.
    ("yusuf", "Yusuf Ramadhan", "SUPERVISOR", "HO-0006"),
    ("nina", "Nina Oktaviani", "CASHIER", "HO-0007"),
    ("maya", "Maya Anggraini", "SUPERVISOR", "ST-0101"),
    ("fajar", "Fajar Setiawan", "CASHIER", "ST-0102"),
]

# The identity a node with authentication disabled hands every request. Some of
# this data is deliberately owned by it — one thread it may close, one report it
# may edit, two bookmarks — because otherwise the dev browser can read
# everything and act on nothing.
DEV = "development"


# ---------------------------------------------------------------------------
# the drawer
# ---------------------------------------------------------------------------

# slug, file name, title, folder, summary, body text, date, tags, links, status,
# uploader, hours ago, available
#
# Tags come from `tag` — the same vocabulary the catalogue and the PO lines use,
# which is the reason `document_tag` points at it rather than carrying free
# text: a supplier's contract and the items it covers are findable by one word.
#
# Links use the five kinds `document_link` accepts. They are UPPERCASE, unlike
# the nine lowercase kinds a discussion hangs on — two different vocabularies
# for two different jobs.
DOCUMENTS = [
    (
        "kontrak-sup02", "Kontrak Kerja Sama SUP02 2026.pdf",
        "Kontrak kerja sama Anugerah Garmen Sejahtera 2026",
        ["Kontrak", "2026"],
        "Perjanjian pemasokan tahunan dengan Anugerah Garmen Sejahtera, berlaku "
        "1 Januari sampai 31 Desember 2026. Termin pembayaran 30 hari, toleransi "
        "reject 5 persen, denda keterlambatan 0,5 persen per hari.",
        "Pasal 3 Mutu. Barang yang diterima dengan cacat jahit lebih dari 5 persen "
        "dari jumlah kirim dapat diretur atas beban pemasok. Pasal 4 Harga. Harga "
        "dalam lampiran berlaku tetap selama enam bulan pertama. Pasal 7 "
        "Keterlambatan. Denda 0,5 persen per hari kalender dihitung dari nilai "
        "baris yang terlambat, maksimum 10 persen. Pasal 9 Pengakhiran. Kedua "
        "pihak dapat mengakhiri perjanjian dengan pemberitahuan 60 hari.",
        "2026-01-05", ["DENIM", "CELANA"],
        [("SUPPLIER", "SUP02")], "COMPLETED", "ratih", 640, True,
    ),
    (
        "faktur-grn-1", "Faktur AGS-2609-0231.pdf",
        "Faktur pembelian GRN-dc-01-000001",
        ["Faktur", "2026-09"],
        "Faktur pembelian dari Anugerah Garmen Sejahtera untuk penerimaan "
        "GRN-dc-01-000001. Nilai sebelum pajak Rp 48.750.000, PPN 11 persen.",
        "Nomor faktur AGS-2609-0231. Tanggal 2 September 2026. Referensi pesanan "
        "PO-20260902-B492. Jumlah kirim 800 pcs, diterima 786 pcs. Nilai barang "
        "Rp 48.750.000. PPN masukan Rp 5.362.500. Jatuh tempo 2 Oktober 2026.",
        "2026-09-02", [],
        [("GOODS_RECEIPT", "GRN-dc-01-000001"), ("PURCHASE_ORDER", "PO-20260902-B492")],
        "COMPLETED", "ratih", 46, True,
    ),
    (
        "surat-jalan-b492", "Surat Jalan SJ-2609-0088.pdf",
        "Surat jalan PO-20260902-B492",
        ["Pengiriman", "2026-09"],
        None,
        None,
        "2026-09-02", [],
        [("PURCHASE_ORDER", "PO-20260902-B492")], "PENDING", "nina", 44, True,
    ),
    (
        "spesifikasi-denim", "Spesifikasi Denim 14oz.pdf",
        "Spesifikasi bahan denim 14oz untuk ART-0002",
        ["Spesifikasi", "Bahan"],
        "Spesifikasi kain denim 14oz: komposisi 98 persen katun 2 persen elastane, "
        "susut maksimum 3 persen setelah pencucian pertama, ketahanan luntur "
        "tingkat 4.",
        "Berat kain 14 ons per yard persegi. Anyaman twill 3/1 arah kanan. "
        "Komposisi 98 persen katun dan 2 persen elastane. Susut memanjang "
        "maksimum 3 persen, melebar maksimum 2 persen. Ketahanan luntur terhadap "
        "gosokan basah tingkat 4. Uji tarik minimum 45 kilogram arah lusi.",
        "2026-02-18", ["DENIM", "CELANA"],
        [("ARTICLE", "ART-0002")], "COMPLETED", "sari", 320, True,
    ),
    (
        "sertifikat-tarik", "Sertifikat Uji Tarik Kain.pdf",
        "Sertifikat uji tarik kain lot 2609",
        ["Sertifikat", "2026"],
        None,
        None,
        "2026-08-28", ["DENIM"],
        [("SUPPLIER", "SUP02")], "FAILED", "yusuf", 150, True,
    ),
    (
        "katalog-denimco", "Katalog Denim Co 2026-2.pdf",
        "Katalog Denim Co Nusantara semester dua",
        ["Katalog", "Pemasok"],
        None,
        None,
        "2026-07-01", ["DENIM"],
        [("SUPPLIER", "DENIMCO")], "PROCESSING", "bagus", 92, True,
    ),
    (
        "kebijakan-retur", "Kebijakan Retur dan Potong Harga.pdf",
        "Kebijakan retur dan potong harga pemasok",
        ["Kebijakan"],
        "Kapan barang diretur dan kapan diminta potong harga, siapa yang "
        "berwenang menyetujui, dan bagaimana selisihnya dicatat.",
        "Retur diambil bila cacat melebihi ambang perjanjian dan barang belum "
        "masuk rak. Potong harga diambil bila barang sudah tercampur atau ongkos "
        "kirim balik melebihi nilai barang yang diretur. Selisih potong harga "
        "dicatat sebagai penyesuaian biaya penerimaan, bukan sebagai diskon "
        "pesanan: yang berubah adalah nilai yang jadi, bukan nilai yang dipesan. "
        "Persetujuan sampai Rp 5.000.000 oleh penyelia gudang, di atasnya oleh "
        "kepala ritel.",
        "2026-03-11", [],
        [], "COMPLETED", "andi", 500, True,
    ),
    (
        "faktur-ptkai-agustus", "Faktur PTKAI Agustus.pdf",
        "Faktur PT Kain Anugerah Agustus 2026",
        ["Faktur", "2026-08"],
        "Faktur bulanan PT Kain Anugerah. Berkasnya tercatat tetapi objeknya "
        "tidak terbaca lagi.",
        None,
        "2026-08-29", [],
        [("SUPPLIER", "PTKAI")], "COMPLETED", "ratih", 168, False,
    ),
    (
        "daftar-harga-sup19", "Daftar Harga SUP19 September.csv",
        "Daftar harga pemasok SUP19 September 2026",
        ["Harga", "Pemasok"],
        "Daftar harga satuan pemasok SUP19 berlaku September 2026, 42 baris.",
        "Kode barang, nama, warna, ukuran, harga satuan. Berlaku 1 September "
        "sampai 30 September 2026. Harga sudah termasuk ongkos kirim sampai DC.",
        "2026-09-01", ["AKSESORI"],
        [("SUPPLIER_ITEM", "0108775015")], "COMPLETED", "bagus", 70, True,
    ),
    (
        "berita-acara-grn-2", "Berita Acara Pemeriksaan GRN-2.pdf",
        "Berita acara pemeriksaan GRN-dc-01-000002",
        ["Penerimaan", "2026-09"],
        "Berita acara pemeriksaan barang datang tanggal 2 September 2026. "
        "Ditemukan selisih 4 pcs yang kemudian ditemukan di rak sebelah.",
        "Pemeriksaan dilakukan dua kali secara buta oleh dua pembaca. Hitungan "
        "pertama 782 pcs, hitungan kedua 786 pcs. Selisih 4 pcs ditelusuri dan "
        "ditemukan di rak B-12 pada hari yang sama. Tidak ada barang hilang.",
        "2026-09-02", [],
        [("GOODS_RECEIPT", "GRN-dc-01-000002")], "COMPLETED", "yusuf", 40, True,
    ),
    (
        "panduan-tag-rfid", "Panduan Pemasangan Tag RFID.pdf",
        "Panduan pemasangan tag RFID di gudang",
        ["Kebijakan", "Operasi"],
        "Di mana tag dipasang pada tiap jenis pakaian, dan mengapa jaraknya "
        "menentukan apakah rak bawah terbaca.",
        "Tag dipasang pada label dalam, bukan pada plastik pembungkus. Untuk "
        "kaos dan atasan rajut, pasang pada jahitan sisi kiri 5 sentimeter dari "
        "bawah. Untuk celana denim, pasang pada label pinggang belakang. Jangan "
        "menumpuk tag lebih dari tiga lapis: pembacaan rak bawah turun tajam "
        "bila tag saling menutup.",
        "2026-06-20", ["KAOS", "DENIM"],
        [], "COMPLETED", "yusuf", 260, True,
    ),
    (
        "kontrak-sewa-store-07", "Kontrak Sewa Store 07.pdf",
        "Kontrak sewa ruang Store 07",
        ["Kontrak", "Sewa"],
        "Sewa ruang toko Store 07 untuk periode 2026 sampai 2028, dengan "
        "kenaikan 7 persen di tahun kedua.",
        "Luas 184 meter persegi di lantai dasar. Masa sewa 1 Februari 2026 "
        "sampai 31 Januari 2029. Sewa dasar Rp 41.000.000 per bulan, naik 7 "
        "persen pada tahun kedua dan 7 persen pada tahun ketiga. Biaya layanan "
        "Rp 55.000 per meter persegi per bulan.",
        "2026-01-28", [],
        [], "COMPLETED", "andi", 700, True,
    ),
]


# Bytes for the documents whose file is not a one-page PDF summarising itself.
# A row that says `text/csv` and carries a paragraph of prose is a row that
# lies about what somebody filed.
DOCUMENT_BYTES = {
    "daftar-harga-sup19": lambda: (
        "kode,nama,warna,ukuran,harga_satuan\n"
        "0108775015,Strap top,Hitam,S,42000\n"
        "0108775015,Strap top,Hitam,M,42000\n"
        "0108775015,Strap top,Hitam,L,44000\n"
        "0108775015,Strap top,Putih,S,42000\n"
        "0108775015,Strap top,Putih,M,42000\n"
        "0108775015,Strap top,Putih,L,44000\n"
        "0110065001,OP T-shirt (Idro),Navy,M,58000\n"
        "0110065001,OP T-shirt (Idro),Navy,L,58000\n"
        "0111565001,20 den 1p Stockings,Hitam,All,19500\n"
    ).encode(),
}


# ---------------------------------------------------------------------------
# the discussions
# ---------------------------------------------------------------------------

# slug, subject kind, subject id, subject note, title, status, tags, opener,
# hours since opened, posts [(author, hours ago, body, is_solution)],
# viewers, bookmarkers, attachment slugs on the opening post
#
# The subject kinds are the nine in `0040_collaboration.sql` and every one of
# them is a thing this business does. The subject ids are records that really
# exist in this database, which is the difference between a seeded discussion
# and a lorem-ipsum forum.
THREADS = [
    (
        "reject-b492", "purchase_order", "PO-20260902-B492",
        "Anugerah Garmen Sejahtera · dc-01",
        "Reject 13,8% di PO-20260902-B492 — lanjut retur atau potong harga?",
        "resolved", ["penerimaan", "kualitas", "pemasok"], "bagus", 52,
        [
            ("bagus", 52,
             "Penerimaan PO-20260902-B492 dari Anugerah Garmen Sejahtera selesai "
             "dengan reject 110 dari 800 pcs (13,8%). Ambang kita untuk pemasok "
             "ini 5%.\n\nDua baris yang bermasalah: sweatpants fleece (70 reject) "
             "dan jogger rib (40 reject). Keluhannya sama — jahitan pinggang "
             "tidak rata dan ada yang lompat.\n\nPertanyaannya: kita retur, atau "
             "minta potong harga untuk yang sudah diterima?", False),
            ("sari", 49,
             "Retur 110 pcs itu ongkos kirimnya sendiri sekitar Rp 900.000 dan "
             "pemasok belum tentu mau tanggung. Kalau potong harga, berapa yang "
             "wajar?", False),
            ("yusuf", 47,
             "Barangnya sudah masuk rak dan tercampur dengan lot sebelumnya. "
             "Memisahkan 110 pcs sekarang butuh setengah hari orang.", False),
            ("ratih", 6,
             "Kalau dipotong harga, selisihnya harus masuk sebagai penyesuaian "
             "biaya penerimaan, bukan diskon PO. Diskon PO mengubah nilai yang "
             "dipesan, padahal yang berubah kenyataannya cuma nilai yang jadi.\n\n"
             "Angka yang saya usulkan: potong 60% dari harga satuan untuk 110 pcs "
             "itu, sekitar Rp 3.630.000. Kalau disepakati, saya yang catatkan.",
             True),
        ],
        ["andi", "sari", "bagus", "ratih", "yusuf", "maya", DEV], ["ratih", DEV],
        ["foto-jahitan", "rekap-reject"],
    ),
    (
        "sup05-termin", "supplier", "SUP05", "Mitra Sandang Perkasa",
        "Pemasok belum bisa di-PO — termin dan kontak kosong sejak Mei",
        "open", ["pemasok", "data-induk"], "bagus", 96,
        [
            ("bagus", 96,
             "SUP05 tidak bisa dibuatkan PO: termin pembayaran dan kontak "
             "penanggung jawab kosong. Terakhir diisi Mei, lalu hilang setelah "
             "data pemasok dirapikan.\n\nSiapa yang pegang salinan perjanjiannya?",
             False),
            ("ratih", 71,
             "Perjanjian aslinya ada di lemari HO. Termin 45 hari, bukan 30 — "
             "ini pemasok yang dulu minta perpanjangan.", False),
            ("bagus", 20,
             "Kalau begitu tolong difoto dan diunggah ke drawer supaya lain kali "
             "tidak perlu cari lemari. Saya isikan terminnya setelah itu.", False),
        ],
        ["bagus", "ratih", "andi", "sari"], ["bagus"],
        [],
    ),
    (
        "selisih-blind-count", "receipt", "GRN-dc-01-000001", "dc-01 · 2 September",
        "Selisih 4 pcs saat blind count — sudah ketemu di rak sebelah",
        "resolved", ["penerimaan", "hitung"], "yusuf", 44,
        [
            ("yusuf", 44,
             "Hitungan buta pertama 782 pcs, kedua 786 pcs. Selisih 4 pcs pada "
             "kaos anak polos. Belum saya tutup penerimaannya sebelum jelas.",
             False),
            ("nina", 43,
             "Empat pcs itu saya yang pindahkan ke rak B-12 waktu jalur masuk "
             "penuh. Maaf, tidak sempat dicatat.", True),
            ("yusuf", 42,
             "Sudah dicocokkan, jumlahnya benar 786. Penerimaan saya tutup.",
             False),
        ],
        ["yusuf", "nina", "andi", "bagus", DEV], [],
        [],
    ),
    (
        "pex-harga-faktur", "purchase_exception", "PEX-2609-0044",
        "PO-20260902-B492 · 2 baris",
        "Harga faktur 2 baris lebih tinggi dari PO — siapa yang boleh menerima?",
        "open", ["harga", "faktur", "kewenangan"], "ratih", 78,
        [
            ("ratih", 78,
             "Verifikasi PEX-2609-0044: dua baris fakturnya lebih tinggi dari PO. "
             "Baris 1 naik 4,3%, baris 3 naik 1,8%.\n\nYang 1,8% masih di bawah "
             "toleransi, yang 4,3% tidak. Tapi saya tidak yakin siapa yang "
             "berwenang menerimanya.", False),
            ("bagus", 30,
             "Batas toleransi 2% itu per baris atau per PO? Di dokumen tidak "
             "disebut. Kalau per PO, rata-ratanya masih 3,1% dan tetap lewat.\n\n"
             "Ini perlu keputusan, bukan tafsiran.", False),
            ("andi", 4,
             "Per baris. Alasannya sederhana: yang kita bayar adalah baris, dan "
             "rata-rata per PO menyembunyikan satu baris yang naik jauh di balik "
             "sembilan baris yang tidak berubah.\n\nSaya akan tuliskan ini ke "
             "kebijakan supaya tidak ditanyakan lagi.", False),
        ],
        ["ratih", "bagus", "andi", "sari", "maya", "yusuf", DEV], ["ratih", "andi"],
        ["ringkasan-selisih"],
    ),
    (
        "publikasi-v12", "commercial_verification", "CV-2609-0007",
        "Publikasi v12 · store-07",
        "Publikasi v12 belum turun ke store-07, harga masih v11 di kasir",
        "open", ["harga", "sinkronisasi", "toko"], DEV, 26,
        [
            (DEV, 26,
             "Publikasi commercial v12 sudah aktif sejak kemarin sore, tapi kasir "
             "store-07 masih menghargai dengan v11. Label baju di rak sudah "
             "v12.\n\nSelisihnya kelihatan di dua artikel diskon.", False),
            ("maya", 24,
             "Betul, di kasir saya harga kaos oversize masih Rp 149.000, di label "
             "Rp 119.000. Kasir sudah dua kali ditanya pembeli.", False),
            ("dimas", 22,
             "Node store-07 terakhir menarik katalog jam 19.40 kemarin, sebelum "
             "publikasi diaktifkan. Sesudah itu koneksinya putus dan belum "
             "menyambung lagi.", False),
        ],
        ["maya", "dimas", "sari", "andi", DEV], [DEV],
        [],
    ),
    (
        "kurva-ukuran-denim", "article", "ART-0002", "Denim Straight Musim Hujan",
        "Kurva ukuran denim terlalu berat di 32 — revisi assortment?",
        "open", ["assortment", "ukuran"], "sari", 120,
        [
            ("sari", 120,
             "Alokasi ART-0002 memberi 32 sebanyak 28% dari total, padahal "
             "penjualan musim lalu 32 hanya 19%. Yang habis duluan justru 30 dan "
             "34.\n\nSaya usul kurva digeser sebelum pesanan berikutnya.", False),
            ("maya", 100,
             "Di store-01 sama. 32 masih menumpuk sampai akhir musim, 30 kosong "
             "tiga minggu sebelum habis musim.", False),
        ],
        ["sari", "maya", "bagus", "andi"], ["sari"],
        [],
    ),
    (
        "harga-katalog-berubah", "purchase_order_line", "PO-E2E-0001 · baris 2",
        "Anugerah Garmen Sejahtera",
        "Harga katalog berubah setelah PO diterbitkan — mana yang mengikat?",
        "locked", ["harga", "pemasok"], "ratih", 300,
        [
            ("ratih", 300,
             "Harga katalog pemasok untuk baris 2 naik dua hari setelah PO "
             "diterbitkan. Baris di PO menyimpan harga lama. Mana yang mengikat "
             "saat faktur datang?", False),
            ("andi", 290,
             "Yang mengikat adalah harga di baris PO. Katalog adalah tawaran, PO "
             "adalah kesepakatan. Kalau pemasok menolak, itu perubahan pesanan "
             "dan lewat amandemen harga, bukan diam-diam lewat faktur.", True),
            ("ratih", 288,
             "Jelas. Saya tutup ini dan tuliskan ke kebijakan pembelian.", False),
        ],
        ["ratih", "andi", "bagus", "sari", "yusuf"], [],
        [],
    ),
    (
        "kain-14oz-diganti", "supply_item", "0108775015", "Strap top · SUP19",
        "Kain 14oz diganti 12oz tanpa pemberitahuan",
        "open", ["pemasok", "kualitas", "bahan"], "sari", 60,
        [
            ("sari", 60,
             "Lot terakhir terasa lebih ringan. Setelah ditimbang, kainnya 12oz, "
             "bukan 14oz seperti di spesifikasi.\n\nSaya lampirkan hasil "
             "timbangan tiga potong.", False),
            ("bagus", 55,
             "Pemasok bilang 14oz sedang kosong dan mereka kirim yang terdekat. "
             "Tidak ada surat, tidak ada persetujuan.", False),
            ("andi", 51,
             "Ganti bahan tanpa persetujuan itu bukan pengiriman sebagian, itu "
             "barang yang berbeda. Jangan diterima sebagai baris yang sama.",
             False),
        ],
        ["sari", "bagus", "andi", "yusuf", "ratih", DEV], ["sari", DEV],
        ["timbangan-kain"],
    ),
    (
        "koli-a3-jaket", "packaging_item", "KOLI-A3", "Koli A3 · 60x40x40",
        "Koli A3 tidak muat untuk jaket — usul ganti ukuran",
        "resolved", ["pengemasan", "gudang"], "yusuf", 200,
        [
            ("yusuf", 200,
             "Jaket musim hujan tidak muat 12 pcs per koli A3 seperti standar. "
             "Yang masuk hanya 8, sisanya dipaksa dan lipatannya rusak.", False),
            ("nina", 190,
             "Kalau pakai koli B2 muat 12 dan tidak dipaksa. Bedanya ongkos "
             "kirim Rp 1.200 per koli.", True),
            ("yusuf", 186,
             "Sudah diganti ke B2 untuk semua jaket. Standar lama saya perbarui.",
             False),
        ],
        ["yusuf", "nina", "andi"], [],
        [],
    ),
    (
        "tag-rak-bawah", "article", "ART-0011", "Kaos Oversize Lebaran",
        "Tag RFID kaos oversize sering gagal dibaca di rak bawah",
        "open", ["rfid", "toko", "hitung"], "maya", 18,
        [
            ("maya", 18,
             "Waktu hitung rak, kaos oversize di rak paling bawah sering tidak "
             "terbaca. Harus diangkat dulu satu per satu baru muncul.\n\nDi rak "
             "atas tidak ada masalah dengan artikel yang sama.", False),
            ("dimas", 14,
             "Rak bawah itu 15 sentimeter dari lantai dan lantainya beton. "
             "Pantulan di situ memang buruk. Tapi tumpukan tag juga berpengaruh — "
             "panduan kita bilang jangan lebih dari tiga lapis.", False),
            ("fajar", 9,
             "Tumpukannya enam sampai delapan lapis kalau stok penuh. Tidak ada "
             "tempat lain untuk oversize.", False),
        ],
        ["maya", "dimas", "fajar", "yusuf", "andi", DEV], [DEV],
        [],
    ),
]

# Attachments on the opening posts. Real files, reachable through the thread
# that carries them — which is also what puts something on the Files screen.
ATTACHMENTS = {
    # A photograph, because the post calls it one. Generated rather than
    # sourced: see `png`.
    "foto-jahitan": (
        "Reject jahitan pinggang.png", "image/png", "bagus",
        lambda: png(480, 320, _seam),
    ),
    "rekap-reject": (
        "Temuan reject PO-20260902-B492.pdf", "application/pdf", "bagus",
        lambda: pdf("Temuan reject PO-20260902-B492", [
            "Sweatpants fleece  : 70 pcs, jahitan pinggang tidak rata",
            "Jogger rib         : 40 pcs, jahitan lompat 3-6 cm",
            "Total reject       : 110 dari 800 pcs (13,8%)",
            "Ambang perjanjian  : 5%",
            "Diperiksa oleh     : Bagus Nugroho, 2 September 2026",
        ]),
    ),
    "ringkasan-selisih": (
        "Selisih harga PEX-2609-0044.csv", "text/csv", "ratih",
        lambda: (
            "baris,artikel,harga_po,harga_faktur,selisih_persen\n"
            "1,Sweatpants fleece,86000,89700,4.3\n"
            "2,Jogger rib,74000,74000,0.0\n"
            "3,Kaos anak polos,31000,31560,1.8\n"
            "4,Piyama anak katun,58000,58000,0.0\n"
        ).encode(),
    ),
    "timbangan-kain": (
        "Timbangan kain 3 potong.pdf", "application/pdf", "sari",
        lambda: pdf("Hasil timbangan kain - lot 2609", [
            "Potong 1 : 11,8 oz/yd2",
            "Potong 2 : 12,1 oz/yd2",
            "Potong 3 : 11,9 oz/yd2",
            "Rata-rata: 11,9 oz/yd2",
            "Spesifikasi: 14 oz/yd2 (toleransi -0,5)",
            "Ditimbang oleh: Sari Wulandari, 2 September 2026",
        ]),
    ),
}


# ---------------------------------------------------------------------------
# the conversations
# ---------------------------------------------------------------------------

# slug, kind, title, participants, opened by, hours since opened,
# messages [(author, hours ago, body, attachment slug or None)],
# how far each person has read
#
# A conversation is NOT a discussion with a different skin, and this table is
# where that shows. It is private to its participants, so `development` is in
# most of them — a dev browser that is in none sees an empty screen and a
# correct one. Unread is a POSITION, not a flag, so leaving somebody's
# `last_read_seq` short of the end is what puts the "unread from here" line in
# the right place rather than merely lighting a dot.
#
# DIRECT conversations carry no title: they are named by whoever else is in
# them, which depends on who is looking, so it is resolved per reader.
CONVERSATIONS = [
    (
        "dc-intake", "GROUP", "Penerimaan dc-01",
        ["yusuf", "nina", "bagus", DEV], "yusuf", 30,
        [
            ("yusuf", 30, "Truk SUP02 sudah di dock 2. Mulai bongkar sekarang.", None),
            ("nina", 29, "Koli 1 sampai 12 sudah masuk. Sisanya 8 lagi.", None),
            ("bagus", 27,
             "Kalau ada yang penyok tolong difoto dulu sebelum dibuka, buat "
             "lampiran ke thread reject.", None),
            ("nina", 26, "Ini dua koli yang penyok.", "koli-penyok"),
            ("yusuf", 25,
             "Diterima. Sisanya bersih, tidak ada yang basah.", None),
        ],
        {"yusuf": 5, "nina": 5, "bagus": 5, DEV: 3},
    ),
    (
        "harga-promo", "GROUP", "Harga & promosi",
        ["sari", "ratih", "andi", "maya", DEV], "sari", 20,
        [
            ("sari", 20,
             "Publikasi v12 sudah saya aktifkan. Diskon lebaran mulai hari ini "
             "sampai 14 September.", None),
            ("maya", 19,
             "Store 07 masih menghargai v11. Sudah saya buka thread-nya.", None),
            ("ratih", 18,
             "Selama masih v11 jangan diskon manual di kasir ya. Nanti "
             "selisihnya tidak bisa dijelaskan waktu tutup buku.", None),
            ("andi", 3,
             "Setuju. Tunggu node-nya nyambung dulu, jangan diakali di kasir.",
             None),
        ],
        {"sari": 4, "ratih": 4, "andi": 4, "maya": 4, DEV: 2},
    ),
    (
        "store-07", "GROUP", "Store 07 harian",
        ["maya", "fajar", DEV], "maya", 9,
        [
            ("maya", 9, "Pagi. Hari ini hitung rak 1 sampai 6 ya.", None),
            ("fajar", 8,
             "Rak 5 dan 6 sudah. Rak bawah oversize masih banyak yang tidak "
             "kebaca.", None),
            ("maya", 7,
             "Angkat dulu satu tumpuk lalu baca lagi. Nanti saya catat ke "
             "thread RFID.", None),
        ],
        {"maya": 3, "fajar": 3, DEV: 3},
    ),
    (
        "dm-maya", "DIRECT", None,
        [DEV, "maya"], "maya", 6,
        [
            ("maya", 6,
             "Boleh minta tolong cek kenapa store-07 belum narik katalog? "
             "Sudah dari kemarin sore.", None),
            (DEV, 5,
             "Sudah saya lihat. Node-nya terakhir nyambung jam 19.40, sesudah "
             "itu putus. Saya kejar ke Dimas.", None),
            ("maya", 4, "Makasih. Kasir sudah dua kali ditanya pembeli.", None),
        ],
        {DEV: 3, "maya": 3},
    ),
    (
        "dm-ratih", "DIRECT", None,
        ["ratih", DEV], DEV, 52,
        [
            (DEV, 52,
             "Faktur PTKAI Agustus di drawer byte-nya hilang. Masih ada "
             "salinan kertasnya?", None),
            ("ratih", 50,
             "Ada di map Agustus. Saya scan ulang besok pagi, sekalian yang "
             "September.", None),
            ("ratih", 49, "Ini rekap yang sudah masuk sejauh ini.",
             "rekap-faktur"),
        ],
        {"ratih": 3, DEV: 2},
    ),
]

CHAT_ATTACHMENTS = {
    "koli-penyok": (
        "Koli penyok dock 2.png", "image/png", "nina",
        lambda: png(480, 320, _carton),
    ),
    "rekap-faktur": (
        "Rekap faktur Agustus.csv", "text/csv", "ratih",
        lambda: (
            "nomor,pemasok,tanggal,nilai,status\n"
            "AGS-2608-0198,Anugerah Garmen Sejahtera,2026-08-04,41200000,dibayar\n"
            "PTK-2608-0077,PT Kain Anugerah,2026-08-12,18650000,dibayar\n"
            "PTK-2608-0091,PT Kain Anugerah,2026-08-29,22300000,jatuh tempo\n"
            "DNC-2608-0044,Denim Co Nusantara,2026-08-30,9750000,dibayar\n"
        ).encode(),
    ),
}


# ---------------------------------------------------------------------------
# the shelf
# ---------------------------------------------------------------------------

# name, owner, shared, prompt, spec
#
# Written as specs and not as SQL, which is the whole point of the feature: the
# catalogue re-validates every one of these each time it runs, so a report whose
# dataset moved underneath it says so instead of answering the wrong question.
#
# `prompt` is set where a person would plausibly have typed the sentence at the
# assistant and null where they built it by hand — that is exactly what the
# column means in `0089`.
REPORTS = [
    (
        "Terlaris 30 hari", "sari", True,
        "artikel terlaris 30 hari terakhir, urut dari unit terbanyak",
        {
            "dataset": "sale_line",
            "period": {"kind": "relative", "last": 30, "unit": "day"},
            "grain": "none",
            "group_by": ["article_code", "article_name"],
            "measures": ["units", "net"],
            "sort": {"key": "units", "desc": True},
            "limit": 20,
            "present": {"kpis": ["units", "net"], "chart": [], "table": []},
        },
    ),
    (
        "Kurva ukuran per divisi", "sari", True, None,
        {
            "dataset": "sale_line",
            "period": {"kind": "relative", "last": 90, "unit": "day"},
            "grain": "none",
            "group_by": ["division_label", "size"],
            "measures": ["units", "net"],
            "sort": {"key": "units", "desc": True},
            "limit": 200,
            "present": {"kpis": ["units"], "chart": [], "table": []},
        },
    ),
    (
        "Penjualan harian per toko", "maya", True,
        "penjualan harian per toko sebulan terakhir",
        {
            "dataset": "sale",
            "period": {"kind": "relative", "last": 30, "unit": "day"},
            "grain": "day",
            "filters": [{"column": "status", "op": "Is", "values": ["COMPLETED"]}],
            "group_by": ["site_name"],
            "measures": ["sales", "net", "average_sale"],
            "sort": {"key": "net", "desc": True},
            "present": {"kpis": ["sales", "net"], "chart": ["net"], "table": []},
        },
    ),
    (
        "Komposisi tender", "ratih", True,
        "berapa persen tunai dan berapa kartu bulan ini",
        {
            "dataset": "sale_payment",
            "period": {"kind": "relative", "last": 30, "unit": "day"},
            "grain": "none",
            "group_by": ["method"],
            "measures": ["amount", "payments", "sales"],
            "sort": {"key": "amount", "desc": True},
            "present": {"kpis": ["amount"], "chart": [], "table": []},
        },
    ),
    (
        "Void per kasir", "maya", True, None,
        {
            "dataset": "sale",
            "period": {"kind": "relative", "last": 30, "unit": "day"},
            "grain": "none",
            "group_by": ["cashier", "site_name"],
            "measures": ["voids", "sales"],
            "sort": {"key": "voids", "desc": True},
            "limit": 50,
            "present": {"kpis": ["voids"], "chart": [], "table": []},
        },
    ),
    (
        "Member per segmen", "sari", True,
        "berapa member di tiap segmen dan berapa belanjanya",
        {
            "dataset": "member",
            "period": {"kind": "relative", "last": 90, "unit": "day"},
            "grain": "none",
            "group_by": ["segment"],
            "measures": ["members", "spent", "average_spend"],
            "sort": {"key": "members", "desc": True},
            "present": {"kpis": ["members", "spent"], "chart": [], "table": []},
        },
    ),
    (
        "Jam sibuk", DEV, False,
        "jam berapa toko paling ramai minggu ini",
        {
            "dataset": "sale",
            "period": {"kind": "relative", "last": 7, "unit": "day"},
            "grain": "none",
            "filters": [{"column": "status", "op": "Is", "values": ["COMPLETED"]}],
            "group_by": ["hour"],
            "measures": ["sales", "net"],
            "sort": {"key": "hour", "desc": False},
            "present": {"kpis": ["sales"], "chart": [], "table": []},
        },
    ),
]


# ---------------------------------------------------------------------------
# doing it
# ---------------------------------------------------------------------------


def seed_accounts(db: str, api_base: str, password: str) -> None:
    print("accounts")
    # `POST /employees/{id}/account` takes the record's own id, not the number
    # printed on it. The code is what a person reads and what `seed-people.py`
    # wrote, so the translation happens here rather than in the table above.
    by_code = {code: id_ for id_, code in rows(db, "SELECT id, code FROM employee")}
    for username, display_name, role, employee_code in ACCOUNTS:
        status, body = api("POST", f"{api_base}/api/v1/auth/users", {
            "username": username,
            "display_name": display_name,
            "password": password,
            "role": role,
        })
        if status in (200, 201):
            print(f"  + {username:8s} {role:10s} {display_name}")
        elif status == 409:
            print(f"  = {username:8s} already exists")
        else:
            print(f"  ! {username:8s} {status} {body}")
            continue

        # Bind the login to the person. Not decoration: `reach.rs` resolves what
        # somebody may see in People from `app_user.employee_id`, so an account
        # with no employee is an account that can only ever see itself.
        employee_id = by_code.get(employee_code)
        if employee_id is None:
            print(f"    (no employee {employee_code} — run seed-people.py first)")
            continue
        # `reason` is not optional and not decoration: binding a login to a
        # person is a grant, and `access.authorize` records why it was made.
        # Sending only the username gets a 422, the account is created but
        # never bound, and the person can then see nothing but themselves.
        status, body = api(
            "POST", f"{api_base}/api/v1/employees/{employee_id}/account",
            {"username": username, "reason": "Seeded development account for this person"},
        )
        if status not in (200, 201, 409):
            print(f"    (employee {employee_code}: {status} {body})")


def seed_documents(db: str) -> None:
    print("documents")
    statements = []
    for (slug, file_name, title, folder, summary, content, doc_date, tags,
         links, status, uploader, ago_hours, available) in DOCUMENTS:
        file_id = rid(f"docfile:{slug}")
        document_id = rid(f"doc:{slug}")
        if slug in DOCUMENT_BYTES:
            payload = DOCUMENT_BYTES[slug]()
        else:
            payload = pdf(title, textwrap.wrap(summary or title, 88)[:12])
        content_type = "application/pdf" if file_name.endswith(".pdf") else "text/csv"
        statements.append(stored_file_sql(
            file_id, file_name, content_type, payload, uploader, ago_hours, available,
        ))
        statements.append(
            "INSERT INTO document (document_id, file_id, name, title, path_tokens, "
            "summary, content, doc_date, language, processing_status, uploaded_by, "
            "created_at, updated_at) VALUES ("
            f"'{document_id}', '{file_id}', {q(file_name)}, {q(title)}, {array(folder)}, "
            f"{q(summary)}, {q(content)}, {q(doc_date)}::date, 'indonesian', {q(status)}, "
            f"{q(uploader)}, now() - interval '{ago_hours} hours', "
            f"now() - interval '{ago_hours} hours') "
            "ON CONFLICT (document_id) DO NOTHING;"
        )
        for tag in tags:
            statements.append(
                f"INSERT INTO document_tag (document_id, tag_code) VALUES "
                f"('{document_id}', {q(tag)}) ON CONFLICT DO NOTHING;"
            )
        for kind, subject in links:
            statements.append(
                "INSERT INTO document_link (document_id, subject_kind, subject_id) "
                f"VALUES ('{document_id}', {q(kind)}, {q(subject)}) "
                "ON CONFLICT DO NOTHING;"
            )
    psql(db, "BEGIN;\n" + "\n".join(statements) + "\nCOMMIT;\n")
    print(f"  {len(DOCUMENTS)} filed")


def seed_discussions(db: str) -> None:
    print("discussions")
    statements = []

    for slug, (name, content_type, uploader, make) in ATTACHMENTS.items():
        statements.append(stored_file_sql(
            rid(f"attfile:{slug}"), name, content_type, make(), uploader, 40,
        ))

    posts_written = 0
    for (slug, kind, subject_id, note, title, status, tags, opener, opened_ago,
         posts, viewers, bookmarkers, attachment_slugs) in THREADS:
        thread_id = rid(f"thread:{slug}")
        latest_ago = min(hours for _, hours, _, _ in posts)
        statements.append(
            "INSERT INTO discussion_thread (thread_id, subject_kind, subject_id, "
            "subject_note, title, status, created_by, created_at, last_activity_at) "
            f"VALUES ('{thread_id}', {q(kind)}, {q(subject_id)}, {q(note)}, {q(title)}, "
            f"{q(status)}, {q(opener)}, now() - interval '{opened_ago} hours', "
            f"now() - interval '{latest_ago} hours') "
            "ON CONFLICT (thread_id) DO NOTHING;"
        )
        # The event the stream replays from. Empty audience, because a
        # discussion is readable by everybody signed in — that is the whole
        # difference between this table and a conversation.
        statements.append(
            "INSERT INTO collaboration_event (kind, thread_id, audience, payload, occurred_at) "
            "SELECT 'discussion.thread', "
            f"'{thread_id}', '{{}}'::text[], jsonb_build_object("
            f"'thread_id', '{thread_id}'::text, 'title', {q(title)}, 'author', {q(opener)}), "
            f"now() - interval '{opened_ago} hours' "
            "WHERE NOT EXISTS (SELECT 1 FROM collaboration_event e "
            f"WHERE e.thread_id = '{thread_id}' AND e.kind = 'discussion.thread');"
        )
        for tag in tags:
            statements.append(
                "INSERT INTO discussion_thread_tag (thread_id, tag) VALUES "
                f"('{thread_id}', {q(tag)}) ON CONFLICT DO NOTHING;"
            )
        for seq, (author, hours, body, is_solution) in enumerate(posts, start=1):
            post_id = rid(f"post:{slug}:{seq}")
            statements.append(
                "INSERT INTO discussion_post (post_id, thread_id, seq, "
                "author_username, body, created_at, is_solution) VALUES ("
                f"'{post_id}', '{thread_id}', {seq}, {q(author)}, {q(body)}, "
                f"now() - interval '{hours} hours', {str(is_solution).lower()}) "
                "ON CONFLICT (post_id) DO NOTHING;"
            )
            statements.append(
                "INSERT INTO collaboration_event (kind, thread_id, audience, payload, occurred_at) "
                f"SELECT 'discussion.post', '{thread_id}', '{{}}'::text[], jsonb_build_object("
                f"'thread_id', '{thread_id}'::text, 'post_id', '{post_id}'::text, "
                f"'author', {q(author)}, 'seq', {seq}), now() - interval '{hours} hours' "
                "WHERE NOT EXISTS (SELECT 1 FROM collaboration_event e "
                f"WHERE e.payload->>'post_id' = '{post_id}');"
            )
            posts_written += 1
            if seq == 1:
                for attachment_slug in attachment_slugs:
                    statements.append(
                        "INSERT INTO discussion_post_attachment (post_id, file_id) VALUES "
                        f"('{post_id}', '{rid(f'attfile:{attachment_slug}')}') "
                        "ON CONFLICT DO NOTHING;"
                    )
        # One row per person who has opened it, ever. The number this yields is
        # people, which is why the screen says "orang" and not "views".
        for viewer in viewers:
            statements.append(
                "INSERT INTO discussion_thread_view (thread_id, username, "
                "first_seen_at, last_seen_at) VALUES "
                f"('{thread_id}', {q(viewer)}, now() - interval '{opened_ago} hours', "
                f"now() - interval '{latest_ago} hours') ON CONFLICT DO NOTHING;"
            )
        for marker in bookmarkers:
            statements.append(
                "INSERT INTO discussion_bookmark (thread_id, username, marked_at) VALUES "
                f"('{thread_id}', {q(marker)}, now() - interval '{latest_ago} hours') "
                "ON CONFLICT DO NOTHING;"
            )

    psql(db, "BEGIN;\n" + "\n".join(statements) + "\nCOMMIT;\n")
    print(f"  {len(THREADS)} threads, {posts_written} posts, "
          f"{len(ATTACHMENTS)} attachments")


def seed_chat(db: str) -> None:
    print("chat")
    statements = []

    for slug, (name, content_type, uploader, make) in CHAT_ATTACHMENTS.items():
        statements.append(stored_file_sql(
            rid(f"chatfile:{slug}"), name, content_type, make(), uploader, 26,
        ))

    sent = 0
    for (slug, kind, title, participants, opener, opened_ago, messages,
         read_to) in CONVERSATIONS:
        conversation_id = rid(f"conversation:{slug}")
        latest_ago = min(hours for _, hours, _, _ in messages)
        statements.append(
            "INSERT INTO chat_conversation (conversation_id, kind, title, "
            "created_by, created_at, latest_seq, last_activity_at) VALUES ("
            f"'{conversation_id}', {q(kind)}, {q(title)}, {q(opener)}, "
            f"now() - interval '{opened_ago} hours', {len(messages)}, "
            f"now() - interval '{latest_ago} hours') "
            "ON CONFLICT (conversation_id) DO NOTHING;"
        )
        for username in participants:
            statements.append(
                "INSERT INTO chat_participant (conversation_id, username, "
                f"last_read_seq, joined_at) VALUES ('{conversation_id}', "
                f"{q(username)}, {read_to.get(username, 0)}, "
                f"now() - interval '{opened_ago} hours') ON CONFLICT DO NOTHING;"
            )
        audience = array(list(participants))
        for seq, (author, hours, body, attachment_slug) in enumerate(messages, start=1):
            message_id = rid(f"message:{slug}:{seq}")
            statements.append(
                "INSERT INTO chat_message (conversation_id, seq, message_id, "
                "author_username, body, sent_at, idempotency_key) VALUES ("
                f"'{conversation_id}', {seq}, '{message_id}', {q(author)}, {q(body)}, "
                f"now() - interval '{hours} hours', {q(f'seed:{slug}:{seq}')}) "
                "ON CONFLICT (message_id) DO NOTHING;"
            )
            if attachment_slug is not None:
                statements.append(
                    "INSERT INTO chat_message_attachment (conversation_id, seq, file_id) "
                    f"VALUES ('{conversation_id}', {seq}, "
                    f"'{rid(f'chatfile:{attachment_slug}')}') ON CONFLICT DO NOTHING;"
                )
            # Audience is the participants and nobody else. This is the one
            # place where an empty array would be a real leak rather than an
            # untidy row: on the stream, empty means everybody signed in.
            statements.append(
                "INSERT INTO collaboration_event (kind, conversation_id, audience, "
                "payload, occurred_at) SELECT 'chat.message', "
                f"'{conversation_id}', {audience}, jsonb_build_object("
                f"'conversation_id', '{conversation_id}'::text, "
                f"'message_id', '{message_id}'::text, 'author', {q(author)}, 'seq', {seq}), "
                f"now() - interval '{hours} hours' "
                "WHERE NOT EXISTS (SELECT 1 FROM collaboration_event e "
                f"WHERE e.payload->>'message_id' = '{message_id}');"
            )
            sent += 1

    psql(db, "BEGIN;\n" + "\n".join(statements) + "\nCOMMIT;\n")
    unread = sum(
        len(messages) - read_to.get(DEV, 0)
        for _, _, _, participants, _, _, messages, read_to in CONVERSATIONS
        if DEV in participants
    )
    print(f"  {len(CONVERSATIONS)} conversations, {sent} messages, "
          f"{len(CHAT_ATTACHMENTS)} attachments, {unread} unread for {DEV}")


def seed_reports(db: str, api_base: str) -> None:
    print("reports")
    existing = {name for (name,) in rows(db, "SELECT name FROM report WHERE archived_at IS NULL")}
    statements = []
    for name, owner, shared, prompt, spec in REPORTS:
        if name in existing:
            print(f"  = {name}")
        else:
            body = {"name": name, "spec": spec}
            if prompt is not None:
                # A report the assistant composed carries the sentence it came
                # from. That sentence is the best explanation of what the report
                # is FOR that anybody will ever write down.
                body["prompt"] = prompt
                body["model"] = "seed"
            status, answer = api("POST", f"{api_base}/api/v1/reports/saved", body)
            if status not in (200, 201):
                print(f"  ! {name}: {status} {answer}")
                continue
            print(f"  + {name:28s} {spec['dataset']}")
        # `create` stamps the caller, and with authentication off the caller is
        # always `development`. Re-owning afterwards is the only way to get a
        # shelf that has more than one author on it.
        statements.append(
            f"UPDATE report SET owner_username = {q(owner)}, shared = {str(shared).lower()} "
            f"WHERE name = {q(name)};"
        )
        statements.append(
            f"UPDATE report_version v SET authored_by = {q(owner)} "
            f"FROM report r WHERE r.report_id = v.report_id AND r.name = {q(name)};"
        )
    if statements:
        psql(db, "BEGIN;\n" + "\n".join(statements) + "\nCOMMIT;\n")


def reset(db: str) -> None:
    """Take out exactly what this script put in, and nothing else."""
    document_ids = ",".join(f"'{rid(f'doc:{row[0]}')}'" for row in [(d[0],) for d in DOCUMENTS])
    file_ids = ",".join(
        [f"'{rid(f'docfile:{d[0]}')}'" for d in DOCUMENTS]
        + [f"'{rid(f'attfile:{slug}')}'" for slug in ATTACHMENTS]
        + [f"'{rid(f'chatfile:{slug}')}'" for slug in CHAT_ATTACHMENTS]
    )
    thread_ids = ",".join(f"'{rid(f'thread:{t[0]}')}'" for t in THREADS)
    conversation_ids = ",".join(
        f"'{rid(f'conversation:{c[0]}')}'" for c in CONVERSATIONS
    )
    names = ",".join(q(report[0]) for report in REPORTS)
    psql(db, f"""
BEGIN;
DELETE FROM collaboration_event WHERE thread_id IN ({thread_ids})
   OR conversation_id IN ({conversation_ids});
DELETE FROM discussion_thread WHERE thread_id IN ({thread_ids});
DELETE FROM chat_conversation WHERE conversation_id IN ({conversation_ids});
DELETE FROM document WHERE document_id IN ({document_ids});
DELETE FROM stored_file WHERE file_id IN ({file_ids});
DELETE FROM report WHERE name IN ({names});
COMMIT;
""")
    print("removed what this script writes (accounts left alone)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="inventory_tanstack",
                        help="the cloud node's database (default: inventory_tanstack)")
    parser.add_argument("--api", default=os.environ.get("ITULAH_API", "http://127.0.0.1:8080"))
    parser.add_argument("--reset", action="store_true",
                        help="delete what this script writes, then stop")
    parser.add_argument("--skip-accounts", action="store_true",
                        help="leave app_user alone; the data still names these usernames")
    arguments = parser.parse_args()
    api_base = arguments.api.rstrip("/")

    if arguments.reset:
        reset(arguments.db)
        return

    if not arguments.skip_accounts:
        password = os.environ.get("ITULAH_SEED_PASSWORD") or getpass(
            "password for the seeded accounts (at least 8 characters): "
        )
        if len(password) < 8:
            sys.exit("that password is shorter than the node will accept")
        seed_accounts(arguments.db, api_base, password)

    seed_documents(arguments.db)
    seed_discussions(arguments.db)
    seed_chat(arguments.db)
    seed_reports(arguments.db, api_base)


if __name__ == "__main__":
    main()
