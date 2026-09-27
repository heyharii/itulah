#!/usr/bin/env python3
"""Discussions and chat for the demo cast, already under way.

    python3 scripts/demo-workplace.py --db sim_rig_demo

The demo people are the ones `demo-seed.sh` hires: Rina (head office HR, who is
`development` on an auth-disabled rig), Nina and Yusuf at the DC, Maya and Dian
at store-01. The threads point at things that exist in the demo — SUP-001,
SUP-002 and their supplier items — so a click on a subject lands somewhere.

The writing is `seed-workplace.py`'s: same tables, same `collaboration_event`
rows, same uuid5 ids, and the same reason it is SQL (on an auth-disabled node
every API post would be authored by `development`). Only the content differs.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "seed_workplace", Path(__file__).with_name("seed-workplace.py"))
workplace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workplace)

# Rina Kusuma, HR manager: `development` on an auth-disabled rig, `rina` on one
# that requires sign-in (demo-seed passes --rina accordingly).
DEV = next((sys.argv[i + 1] for i, arg in enumerate(sys.argv[:-1]) if arg == "--rina"),
           workplace.DEV)

# (slug, subject kind, subject id, note, title, status, tags, opener, opened
#  hours ago, [(author, hours ago, body, is_solution)], viewers, bookmarkers,
#  attachment slugs)
THREADS = [
    (
        "demo-sup001-leadtime", "supplier", "SUP-001", "PT Garmen Nusantara",
        "Lead time PT Garmen Nusantara untuk kemeja — 14 atau 21 hari?",
        "open", ["pemasok", "lead-time"], "yusuf", 30,
        [
            ("yusuf", 30,
             "Pak Budi dari PT Garmen Nusantara bilang kemeja oxford sekarang "
             "butuh 21 hari, bukan 14. Kalau kita tetap pesan dengan asumsi 14 "
             "hari, stok toko akan kosong seminggu.", False),
            ("maya", 27,
             "Di store-01 kemeja putih ukuran 03 dan 04 paling cepat habis. "
             "Kalau lead time jadi 21 hari, tolong pesanan berikutnya dimajukan.", False),
            (DEV, 20,
             "Saya catat. Untuk PO berikutnya kita pakai 21 hari sampai pemasok "
             "konfirmasi tertulis.", False),
        ],
        ["yusuf", "maya", "nina", DEV], ["yusuf"], [],
    ),
    (
        "demo-receiving-count", "supplier", "SUP-001", "Penerimaan DC",
        "Hitungan penerimaan beda dengan surat jalan — siapa yang verifikasi?",
        "resolved", ["penerimaan", "prosedur"], "nina", 50,
        [
            ("nina", 50,
             "Kiriman kaos basic kemarin: surat jalan 40 pcs, hitungan saya "
             "36 pcs. Saya sudah catat di floor app, statusnya menunggu "
             "verifikasi.", False),
            ("yusuf", 46,
             "Sudah saya hitung ulang, memang 36. Selisih 4 pcs saya setujui "
             "sebagai kurang kirim, bukan hilang di gudang.", False),
            ("yusuf", 45,
             "Aturannya: yang menghitung (checker) tidak boleh sekaligus "
             "memverifikasi. Nina hitung, saya verifikasi.", True),
            (DEV, 40, "Terima kasih, prosedurnya sudah jelas.", False),
        ],
        ["nina", "yusuf", DEV], [DEV], [],
    ),
    (
        "demo-sneakers-size", "supply_item", "SS-SNK-01", "Sneakers Kanvas Low · CV Sepatu Sejahtera",
        "Sneakers kanvas: ukuran 07 perlu ditambah untuk store-01?",
        "open", ["assortment", "toko"], "maya", 12,
        [
            ("maya", 12,
             "Pelanggan store-01 banyak tanya ukuran 07. Minggu ini sudah lima "
             "orang pulang tanpa beli.", False),
            ("dian", 10,
             "Dari catatan kasir, permintaan ukuran 07 memang paling sering "
             "tidak terlayani.", False),
            ("yusuf", 6,
             "Di DC tersisa sedikit. Saya usulkan pesanan berikutnya ke CV "
             "Sepatu Sejahtera ditambah untuk ukuran 07.", False),
        ],
        ["maya", "dian", "yusuf", DEV], ["maya"], [],
    ),
]

# (slug, kind, title, participants, opener, opened hours ago,
#  [(author, hours ago, body, attachment slug)], {username: last read seq})
CONVERSATIONS = [
    (
        "demo-dc-intake", "GROUP", "Penerimaan DC",
        ["yusuf", "nina", DEV], "yusuf", 8,
        [
            ("yusuf", 8, "Truk PT Garmen Nusantara sudah di dock. Mulai bongkar.", None),
            ("nina", 7, "Koli 1–6 sudah masuk, sedang saya hitung.", None),
            ("nina", 6, "Hitungan selesai, sudah saya kirim untuk diverifikasi.", None),
            ("yusuf", 5, "Sudah saya verifikasi. Barang bisa lanjut ke tagging.", None),
        ],
        {"yusuf": 4, "nina": 4, DEV: 2},
    ),
    (
        "demo-store01", "GROUP", "Store 01",
        ["maya", "dian", DEV], "maya", 6,
        [
            ("maya", 6, "Pagi. Hari ini ada kiriman dari DC, tolong siapkan rak depan.", None),
            ("dian", 5, "Siap Bu. Kasir juga sudah buka jam 10.", None),
            ("maya", 3, "Bu Rina, jadwal shift minggu depan sudah bisa dilihat?", None),
            (DEV, 2, "Sudah, semua shift PAGI. Cek di menu Attendance.", None),
        ],
        {"maya": 4, "dian": 3, DEV: 3},
    ),
    (
        "demo-dm-maya", "DIRECT", None,
        [DEV, "maya"], "maya", 4,
        [
            ("maya", 4, "Bu, Dian mau ambil cuti tanggal 10. Saldonya masih cukup?", None),
            (DEV, 3, "Masih 12 hari. Minta Dian ajukan lewat menu Leave ya.", None),
        ],
        {DEV: 1, "maya": 2},
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default="sim_rig_demo")
    parser.add_argument("--rina", default=workplace.DEV, help="Rina's username")
    args = parser.parse_args()
    workplace.THREADS = THREADS
    workplace.CONVERSATIONS = CONVERSATIONS
    workplace.DEV = DEV
    workplace.ATTACHMENTS = {}
    workplace.CHAT_ATTACHMENTS = {}
    workplace.seed_discussions(args.db)
    workplace.seed_chat(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
