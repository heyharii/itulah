#!/usr/bin/env python3
"""Give every General Affairs screen in frontend-hub something to show, so
the product owner can walk through all of them: an estate of fourteen places
(the DC and thirteen shops), about sixty things in the register, the deals
behind the bills with a meter history, the service schedule, the walk-rounds,
repairs on every rung, replacements, disposals, supply requests on every rung
and a few bills GA hands to Finance.

    GA_API=http://127.0.0.1:8187 \\
    GA_CHECKER_API=http://127.0.0.1:8188 GA_CHECKER_USER=andi \\
    GA_CHECKER_PASSWORD=... python3 scripts/seed-ga-review.py

`GA_API` is a node with auth disabled, where every call is made as the same
principal. `GA_CHECKER_API` is a node with auth required ON THE SAME DATABASE,
and it is used for exactly one kind of call: the three acts GA refuses to the
person who raised the record (approving a repair's budget, a replacement, a
disposal). Maker != checker is the point of those acts, so the seed does not
look for a way round it — it signs in as somebody else.

Run `seed-ga-demo.sh` first if you want its five assets and three contracts;
this script neither needs nor touches them.

# Everything goes through the API

Every row here is written by the same writer a GA screen calls, so it is
validated exactly as a person's typing is. That includes the vendors
(`/api/v1/suppliers`) and the papers (`/api/v1/files` then
`/api/v1/documents`, which is how a scan with an expiry date reaches the
overview). There is no SQL in this file.

The five parties `seed-ga-demo.sh` wrote straight into `supplier` landed in
the MERCHANDISE book, because that is the column's default; the Vendors
screen opens on EXPENSE, where PLN and the landlord belong. They are moved
there through the same PATCH the screen uses, and nothing else about them
changes.

# What this cannot fill, and why

`draft_assets` on the overview and every "billed" / "actual cost" figure are
read back from bills Finance has POSTED. GA files bills only as DRAFTs
(`/api/v1/ga/bill-requests`), and posting one is a Finance act with a journal
behind it — a GA seed has no business writing the books.

# Dates

Everything that decides a standing — a contract's end, a service's due date,
a paper's expiry — is counted from the business day the node itself reports
(`/api/v1/ga/overview`'s `generated_on`), so "hampir habis" and "terlambat"
stay true whichever day this runs on.

# Re-running is safe

Every record has a natural key the script looks up before writing — the asset
number, the contract number, a repair's title, a request's item and place — and
a ladder is only climbed from wherever the row already stands. What already
happened is reported as `=`; a 409 from the server is reported the same way.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

API = os.environ.get("GA_API", "http://127.0.0.1:8187").rstrip("/")
CHECKER_API = os.environ.get("GA_CHECKER_API", "http://127.0.0.1:8188").rstrip("/")
CHECKER_USER = os.environ.get("GA_CHECKER_USER", "andi")

refusals: list[str] = []
tally: dict[str, dict[str, int]] = {}


# ── the wire ────────────────────────────────────────────────────────────────


def call(method, path, body=None, token=None, base=API, raw=None, content_type=None, headers=None):
    if raw is not None:
        data = raw
    else:
        data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{base}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", content_type or "application/json")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read().decode()
        try:
            return error.code, json.loads(payload)
        except json.JSONDecodeError:
            return error.code, payload


def message(answer):
    if isinstance(answer, dict):
        return answer.get("error") or answer.get("message") or json.dumps(answer)[:200]
    return str(answer)[:200]


def count(kind, outcome):
    tally.setdefault(kind, {"+": 0, "=": 0, "!": 0})[outcome] += 1


def step(kind, label, method, path, body=None, token=None, base=API, headers=None):
    status, answer = call(method, path, body, token, base, headers=headers)
    if status in (200, 201, 204):
        print(f"  + {label}")
        count(kind, "+")
    elif status == 409:
        print(f"  = {label} ({message(answer)})")
        count(kind, "=")
    else:
        print(f"  ! {label}: {status} {message(answer)}")
        refusals.append(f"{kind} · {label}: {status} {message(answer)}")
        count(kind, "!")
    return status, answer


def same(kind, label):
    print(f"  = {label}")
    count(kind, "=")


def get(path):
    status, answer = call("GET", path)
    if status != 200:
        sys.exit(f"! GET {path}: {status} {message(answer)}")
    return answer


# ── the calendar ────────────────────────────────────────────────────────────

TODAY = date.today()


def D(days):
    return (TODAY + timedelta(days=days)).isoformat()


def month_start(offset):
    """The first day of the month `offset` months from this one."""
    month = TODAY.month - 1 + offset
    return date(TODAY.year + month // 12, month % 12 + 1, 1)


# ── a paper to file ─────────────────────────────────────────────────────────


def tiny_pdf(lines):
    """A one-page PDF with a few lines of text, so a filed scan previews as a
    page rather than as a broken file. ASCII only: the base-14 fonts carry no
    other encoding worth trusting."""
    def escape(text):
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stream = "BT /F1 14 Tf 60 780 Td 20 TL " + " ".join(f"({escape(line)}) Tj T*" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    ]
    out = "%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out.encode()))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out.encode())
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


# ── the data ────────────────────────────────────────────────────────────────
#
# Head office is `dc` — the `site` table's own id for the HO/DC, kind HO —
# and the shops are `store-01` to `store-13`.

LOCATIONS = {
    "dc": ("Jl. Industri Raya Blok C-7, Cikarang Barat, Bekasi", "Kantor pusat & DC", 2600, "Maya Lestari (GA)", "0811-8800-2201", "Gudang buka 07.00–21.00; bongkar muat lewat gerbang 2"),
    "store-02": ("Jl. Dago No. 118, Bandung", "Toko ruko", 210, "Dewi Anggraini", "0812-2200-1102", "Parkir depan sempit, bongkar pagi sebelum 09.00"),
    "store-03": ("Jl. Margonda Raya No. 350, Depok", "Toko ruko", 260, "Hendra Saputra", "0812-2200-1103", "Renovasi layout Sep 2026"),
    "store-04": ("Jl. Pajajaran No. 41, Bogor", "Toko ruko", 190, "Lina Marlina", "0812-2200-1104", None),
    "store-05": ("Plaza Nusa Indah Lt. 1 Unit 1-27, Bandung", "Toko mall", 320, "Sari Wulandari", "0812-2200-1105", "Jam bongkar mall 06.00–09.00, lapor security loading dock"),
    "store-06": ("Jl. Ahmad Yani No. 72, Cimahi", "Toko ruko", 180, "Rizky Pratama", "0812-2200-1106", None),
    "store-07": ("Jl. Siliwangi No. 15, Garut", "Toko ruko", 240, "Agus Setiawan", "0812-2200-1107", "Genset cadangan di belakang, listrik sering padam"),
    "store-08": ("Jl. HZ Mustofa No. 201, Tasikmalaya", "Toko ruko", 230, "Nur Aisyah", "0812-2200-1108", None),
    "store-09": ("Jl. Siliwangi No. 88, Cirebon", "Toko ruko", 200, "Fajar Nugroho", "0812-2200-1109", "Sewa gedung habis Agu 2026, perpanjangan sedang dinegosiasi"),
    "store-10": ("Jl. Suryakencana No. 9, Sukabumi", "Toko ruko", 170, "Wulan Sari", "0812-2200-1110", "Atap area fitting room bocor saat hujan"),
    "store-11": ("Jl. Tuparev No. 60, Karawang", "Toko ruko", 250, "Eko Prasetyo", "0812-2200-1111", None),
    "store-12": ("Jl. Kiansantang No. 5, Purwakarta", "Toko ruko", 160, "Putri Handayani", "0812-2200-1112", None),
    "store-13": ("Jl. Veteran No. 23, Purwakarta", "Toko baru (fit-out)", 280, "Dimas Aditya", "0812-2200-1113", "Rencana buka Nov 2026"),
}

# The five `seed-ga-demo.sh` wrote; moved to the EXPENSE book, see the docstring.
DEMO_SUPPLIERS = ["PLN-GA", "PDAM-GA", "CLEANING-GA", "BENGKEL-GA", "PEMILIK-GA"]

SUPPLIERS = [
    # code, name, contact, phone, email, address, default account
    ("SEJUK-GA", "CV Sejuk Teknik Mandiri", "Joko Susilo", "0813-2100-4411", "servis@sejukteknik.co.id", "Jl. Soekarno-Hatta 512, Bandung", None),
    ("DAYA-GA", "PT Daya Prima Genset", "Anton Wibisono", "021-8990-2231", "cs@dayaprima.co.id", "Kawasan Jababeka Blok F-3, Cikarang", None),
    ("KENCANA-GA", "Kencana Komputer", "Steven Halim", "022-423-8810", "sales@kencanakomputer.id", "Bandung Electronic Center Lt. 2 No. 45", "6050"),
    ("TERANG-GA", "Terang Elektrik", "Ujang Supriatna", "0812-9001-7722", None, "Jl. Kopo 221, Bandung", "6054"),
    ("KARYA-GA", "CV Karya Bangun Renovasi", "Ir. Budi Santosa", "0811-2233-5566", "proyek@karyabangun.co.id", "Jl. Cibaduyut 90, Bandung", None),
    ("HAMA-GA", "Basmi Hama Prima", "Rina Kartika", "0821-1155-9080", "order@basmihama.id", "Jl. Raya Bogor Km 30, Depok", None),
    ("GARDA-GA", "PT Garda Satria Pratama", "Kapten (Purn.) Darmawan", "021-8832-4400", "ops@gardasatria.co.id", "Jl. Jend. Sudirman 12, Bekasi", None),
    ("WAHANA-GA", "PT Asuransi Wahana Proteksi", "Melati Kusuma", "021-5790-1200", "klaim@wahanaproteksi.co.id", "Menara Wahana Lt. 9, Jakarta Selatan", None),
    ("MANDALA-GA", "Mandala Rental Kendaraan", "Heru Gunawan", "021-8250-6677", "fleet@mandalarental.co.id", "Jl. Kalimalang 88, Bekasi", None),
    ("NUSANET-GA", "PT NusaNet Media", "Customer Care", "1500-688", "corporate@nusanet.id", "Jl. Gatot Subroto Kav. 21, Jakarta", "6059"),
    ("REJEKI-GA", "Toko Sumber Rejeki ATK", "Liong", "022-731-2200", None, "Jl. Otto Iskandardinata 300, Bandung", "6041"),
]


def tech(make, capacity=None, install=None, warranty=None):
    return {k: v for k, v in {"make": make, "capacity": capacity, "install": install, "warranty": warranty}.items() if v}


def it(device, make=None, spec=None, host=None, warranty=None):
    return {k: v for k, v in {"device": device, "make": make, "spec": spec, "host": host, "warranty": warranty}.items() if v}


def car(make, plate, year, odo, chassis=None, engine=None):
    return {k: v for k, v in {"make": make, "plate": plate, "year": year, "odo": odo, "chassis": chassis, "engine": engine}.items() if v}


# number, name, class, site, sub-location, holder, condition, serial, acquired, specs, quantity
ASSETS = [
    # ── head office and the DC
    ("AST-RV-001", "Gedung kantor pusat & DC", "BANGUNAN_UTAMA", "dc", None, None, "BAIK", None, "2018-03-01", {"area": "1.800 m2", "floors": "2", "use": "Kantor pusat & gudang DC"}, None),
    ("AST-RV-002", "Tanah kantor pusat & DC", "TANAH_HAK_MILIK", "dc", None, None, "BAIK", None, "2017-11-20", {"cert": "SHM No. 1182/Cikarang Barat", "area": "2.400 m2"}, None),
    ("AST-RV-003", "Genset DC 150 kVA", "GENSET", "dc", "Ruang genset", None, "BAIK", "CMS-C150-778120", "2023-03-15", tech("Cummins C150D5", "150 kVA", "2023-03-20", "2026-03-20"), None),
    ("AST-RV-004", "AC kantor lantai 2", "AIR_CONDITIONER", "dc", "Lt. 2 ruang Finance", None, "BAIK", "DKN-FTKC35-55102", "2022-07-01", tech("Daikin FTKC35", "1,5 PK", "2022-07-05", "2025-07-05"), None),
    ("AST-RV-005", "Mobil box pengiriman", "MOBIL", "dc", "Pool kendaraan", "Yusuf (driver)", "BAIK", None, "2021-02-10", car("Mitsubishi L300 Box", "B 9412 KXT", "2021", "128450", "MMBJNKB40MD012345", "4D56CJ-123456"), None),
    ("AST-RV-006", "Mobil operasional GA", "MOBIL", "dc", "Pool kendaraan", "Bagus Santoso", "BAIK", None, "2023-05-15", car("Toyota Avanza 1.3 G", "B 1287 PJK", "2023", "41200", "MHKM1BA3JPK004512"), None),
    ("AST-RV-007", "Motor kurir dokumen", "SEPEDA_MOTOR", "store-02", None, None, "BAIK", None, "2022-08-01", car("Honda Beat CBS", "D 3561 UJM", "2022", "38900"), None),
    ("AST-RV-008", "Laptop GA", "FFE_KOMPUTER", "dc", "Ruang GA", "Maya Lestari", "BAIK", "PF4K2M9X", "2025-03-01", it("Laptop", "Lenovo ThinkPad E14 Gen 5", "i5-1335U / 16GB / 512GB", "HO-GA-01", "2028-02-28"), None),
    ("AST-RV-009", "Laptop Finance", "FFE_KOMPUTER", "dc", "Ruang Finance", "Ratih Kusuma", "BAIK", "N7NRKD01", "2023-12-01", it("Laptop", "ASUS ExpertBook B1", "i5 / 8GB / 512GB", "HO-FIN-03", "2026-11-30"), None),
    ("AST-RV-010", "NAS server arsip", "FFE_KOMPUTER", "dc", "Ruang server", None, "BAIK", "2280QXR01923", "2024-06-10", it("NAS", "Synology DS923+", "4 x 4TB RAID 5", "HO-NAS-01", "2027-06-10"), None),
    ("AST-RV-011", "Meja kerja staf HO", "FFE_OFFICE", "dc", "Lt. 2", None, "BAIK", None, "2018-04-01", {"type": "Meja kerja", "material": "Particle board", "dim": "120x60 cm"}, 12),
    ("AST-RV-012", "Rak gudang heavy duty", "OE_RAK_4", "dc", "Gudang DC", None, "BAIK", None, "2018-05-01", {"material": "Besi", "dim": "200x60x240 cm", "area": "Gudang", "repl": "tidak"}, 40),
    ("AST-RV-013", "Kasur & lemari mess karyawan", "FFE_STAFF_HOUSE_MESS", "dc", "Mess karyawan", None, "BAIK", None, "2024-01-15", {"type": "Kasur + lemari 2 pintu", "material": "Kayu / busa"}, 6),
    ("AST-RV-014", "Lisensi Opti-Tex (pola & marker)", "OPTI_TEX_SYSTEM", "dc", None, None, "BAIK", "OTX-2024-0091", "2024-02-01", {}, None),
    ("AST-RV-015", "Lisensi POS Seventh Soft 14 outlet", "SEVENTH_SOFT_APPLICATION", "dc", None, None, "BAIK", "7S-RTL-14", "2023-01-01", {}, None),
    ("AST-RV-016", "Fit-out toko 13 (dalam pengerjaan)", "CONTRACT_IN_PROGRESS", "store-13", None, None, "BAIK", None, "2026-08-01", {}, None),
    ("AST-RV-017", "Biaya pra-operasi toko 13", "PRE_OPENING", "store-13", None, None, "BAIK", None, "2026-08-15", {}, None),
    # ── the shops
    ("AST-RV-018", "CCTV DVR 16 kanal", "INSTALASI_MEKANIKAL_ELEKTRIKAL", "store-01", "Ruang kepala toko", None, "BAIK", "HK7216-88120", "2024-03-01", tech("Hikvision DS-7216HGHI", "16 kamera"), None),
    ("AST-RV-019", "Mesin kasir POS 1", "FFE_KOMPUTER", "store-01", "Kasir 1", None, "BAIK", "PFX3316-0091", "2023-01-10", it("POS", "Posiflex PS-3316 + Epson TM-T82", "i3 / 8GB", "ST01-POS1", "2026-01-10"), None),
    ("AST-RV-020", "Sound system toko", "FFE_MUSIC", "store-01", None, None, "BAIK", None, "2023-01-10", {"make": "TOA ZA-2120 + 6 speaker plafon", "power": "120 W"}, None),
    ("AST-RV-021", "AC split toko 02", "AIR_CONDITIONER", "store-02", "Area penjualan", None, "BAIK", "PNS-24WKP-1102", "2022-04-10", tech("Panasonic CS-PN24WKP", "2,5 PK", "2022-04-12"), None),
    ("AST-RV-022", "Mesin kasir POS toko 02", "FFE_KOMPUTER", "store-02", "Kasir", None, "BAIK", "PFX3316-0102", "2023-01-10", it("POS", "Posiflex PS-3316", "i3 / 8GB", "ST02-POS1"), None),
    ("AST-RV-023", "Rak dinding display", "OE_RAK_2", "store-02", "Dinding kiri & kanan", None, "BAIK", None, "2022-04-01", {"material": "Besi + kayu", "dim": "120x40x200 cm", "area": "Dinding", "repl": "ya"}, 24),
    ("AST-RV-024", "AC split toko 03", "AIR_CONDITIONER", "store-03", "Area penjualan", None, "BAIK", "SHP-AHX24-1103", "2021-09-01", tech("Sharp AH-X24", "2,5 PK", "2021-09-03"), None),
    ("AST-RV-025", "Rak gondola tengah", "OE_RAK_1", "store-03", "Area tengah", None, "BAIK", None, "2021-09-01", {"material": "Besi", "dim": "120x60x150 cm", "area": "Tengah", "repl": "ya"}, 10),
    ("AST-RV-026", "AC split toko 04", "AIR_CONDITIONER", "store-04", "Area penjualan", None, "BAIK", "LG-S24-1104", "2020-11-01", tech("LG Dual Inverter S24", "2,5 PK", "2020-11-03"), None),
    ("AST-RV-027", "Mesin kasir POS toko 04", "FFE_KOMPUTER", "store-04", "Kasir", None, "BAIK", "PFX3316-0104", "2023-01-10", it("POS", "Posiflex PS-3316", "i3 / 8GB", "ST04-POS1"), None),
    ("AST-RV-028", "CCTV DVR 8 kanal toko 04", "INSTALASI_MEKANIKAL_ELEKTRIKAL", "store-04", "Ruang kepala toko", None, "PERLU_SERVIS", "DH-XVR5108-44", "2019-02-01", tech("Dahua XVR5108", "8 kamera"), None),
    ("AST-RV-029", "AC cassette toko 05 (depan)", "AIR_CONDITIONER", "store-05", "Area depan", None, "BAIK", "DKN-FCNQ36-0501", "2025-01-05", tech("Daikin FCNQ36 cassette", "4 PK", "2025-01-08", "2027-01-08"), None),
    ("AST-RV-030", "AC cassette toko 05 (belakang)", "AIR_CONDITIONER", "store-05", "Area belakang", None, "BAIK", "DKN-FCNQ36-0502", "2025-01-05", tech("Daikin FCNQ36 cassette", "4 PK", "2025-01-08", "2027-01-08"), None),
    ("AST-RV-031", "Mesin kasir POS toko 05", "FFE_KOMPUTER", "store-05", "Kasir 1", None, "BAIK", "PFX3316-0105", "2025-01-05", it("POS", "Posiflex PS-3316", "i5 / 8GB", "ST05-POS1", "2028-01-05"), None),
    ("AST-RV-032", "Neon box fasad toko 05", "FFE_EXTERIOR", "store-05", "Fasad", None, "BAIK", None, "2025-01-05", {"type": "Neon box LED", "material": "Akrilik + rangka hollow", "dim": "600x120 cm"}, None),
    ("AST-RV-033", "Sound system toko 05", "FFE_MUSIC", "store-05", None, None, "BAIK", None, "2025-01-05", {"make": "Bose FreeSpace + amplifier", "power": "240 W", "warranty": "2027-01-05"}, None),
    ("AST-RV-034", "AC split toko 06", "AIR_CONDITIONER", "store-06", "Area penjualan", None, "BAIK", "GRE-24-1106", "2022-02-01", tech("Gree GWC-24", "2,5 PK"), None),
    ("AST-RV-035", "Mesin kasir POS toko 06", "FFE_KOMPUTER", "store-06", "Kasir", None, "BAIK", "PFX3316-0106", "2023-01-10", it("POS", "Posiflex PS-3316", "i3 / 8GB", "ST06-POS1"), None),
    ("AST-RV-036", "Manekin full body dewasa", "OE_PATUNG_FULL_BODI_DEWASA", "store-06", "Etalase", None, "BAIK", None, "2022-02-01", {"material": "Fiberglass", "area": "Etalase depan"}, 8),
    ("AST-RV-037", "AC split toko 07", "AIR_CONDITIONER", "store-07", "Area penjualan", None, "BAIK", "PNS-24WKP-1107", "2022-06-01", tech("Panasonic CS-PN24WKP", "2,5 PK"), None),
    ("AST-RV-038", "Genset toko 07 25 kVA", "GENSET", "store-07", "Halaman belakang", None, "PERLU_SERVIS", "DNY-DCA25-0707", "2021-05-01", tech("Denyo DCA-25ESK", "25 kVA", "2021-05-10"), None),
    ("AST-RV-039", "CCTV DVR toko 07", "INSTALASI_MEKANIKAL_ELEKTRIKAL", "store-07", "Ruang kepala toko", None, "BAIK", "HK7208-0707", "2022-06-01", tech("Hikvision DS-7208", "8 kamera"), None),
    ("AST-RV-040", "AC split toko 08 (lama)", "AIR_CONDITIONER", "store-08", "Area penjualan", None, "PERLU_SERVIS", "SAM-AR24-1108", "2017-03-01", tech("Samsung AR24", "2,5 PK", "2017-03-03"), None),
    ("AST-RV-041", "CCTV DVR toko 08", "INSTALASI_MEKANIKAL_ELEKTRIKAL", "store-08", "Ruang kepala toko", None, "RUSAK", "HK7216-0808", "2020-08-01", tech("Hikvision DS-7216", "16 kamera"), None),
    ("AST-RV-042", "AC split toko 09", "AIR_CONDITIONER", "store-09", "Area penjualan", None, "BAIK", "DKN-FTKC60-1109", "2023-10-01", tech("Daikin FTKC60", "2,5 PK", "2023-10-03", "2026-10-03"), None),
    ("AST-RV-043", "Mesin kasir POS toko 09", "FFE_KOMPUTER", "store-09", "Kasir", None, "PERLU_SERVIS", "IBM-SV4-0909", "2019-01-15", it("POS", "Toshiba SurePOS 500", "Celeron / 4GB", "ST09-POS1"), None),
    ("AST-RV-044", "AC split toko 10", "AIR_CONDITIONER", "store-10", "Area penjualan", None, "BAIK", "PNS-24WKP-1110", "2022-06-01", tech("Panasonic CS-PN24WKP", "2,5 PK"), None),
    ("AST-RV-045", "Genset toko 10 (lama)", "GENSET", "store-10", "Halaman belakang", None, "RUSAK", "HND-EG6500-1010", "2016-04-01", tech("Honda EG6500CXS", "5,5 kVA", "2016-04-05"), None),
    ("AST-RV-046", "AC split toko 11", "AIR_CONDITIONER", "store-11", "Area penjualan", None, "BAIK", "LG-S24-1111", "2023-02-01", tech("LG Dual Inverter S24", "2,5 PK"), None),
    ("AST-RV-047", "AC lama ruang stok toko 11", "AIR_CONDITIONER", "store-11", "Ruang stok", None, "RUSAK", "NAT-CS12-1111", "2016-01-10", tech("National CS-C12", "1,5 PK", "2016-01-12"), None),
    ("AST-RV-048", "AC split toko 12", "AIR_CONDITIONER", "store-12", "Area penjualan", None, "BAIK", "GRE-24-1112", "2024-05-01", tech("Gree GWC-24", "2,5 PK", "2024-05-03", "2027-05-03"), None),
    ("AST-RV-049", "Mesin kasir POS toko 12", "FFE_KOMPUTER", "store-12", "Kasir", None, "BAIK", "PFX3316-0112", "2024-05-01", it("POS", "Posiflex PS-3316", "i5 / 8GB", "ST12-POS1", "2027-05-01"), None),
    ("AST-RV-050", "AC cassette toko 13", "AIR_CONDITIONER", "store-13", "Area penjualan", None, "BAIK", "DKN-FCNQ42-1301", "2026-09-01", tech("Daikin FCNQ42 cassette", "5 PK", "2026-09-10", "2028-09-10"), None),
    # ── on their way out
    ("AST-RV-051", "Printer struk lama toko 04", "FFE_KOMPUTER", "store-04", "Gudang toko", None, "RUSAK", "EPS-U220-0404", "2016-06-01", it("Printer struk", "Epson TM-U220"), None),
    ("AST-RV-052", "Motor Supra X 125 (2012)", "SEPEDA_MOTOR", "dc", "Pool kendaraan", None, "RUSAK", None, "2012-09-01", car("Honda Supra X 125", "B 6624 KCL", "2012", "96400"), None),
    ("AST-RV-053", "Rak kayu display lama", "OE_RAK_3", "store-09", "Gudang toko", None, "RUSAK", None, "2015-03-01", {"material": "Kayu", "dim": "100x40x180 cm", "area": "Gudang", "repl": "ya"}, 6),
    ("AST-RV-054", "Laptop kasir toko 10", "FFE_KOMPUTER", "store-10", "Kasir", "Wulan Sari", "BAIK", "HP240G8-1010", "2021-07-01", it("Laptop", "HP 240 G8", "i3 / 8GB", "ST10-LAP1"), None),
    ("AST-RV-055", "Meja kasir lama toko 06", "FFE_TOKO_DAN_GUDANG", "store-06", "Gudang toko", None, "BAIK", None, "2016-02-01", {"type": "Meja kasir", "material": "Kayu jati belanda", "dim": "180x60 cm"}, None),
]

# number -> (condition, reason): corrections after registering, so the hub
# shows a CONDITION line in the history.
CONDITION_CHANGES = {
    "AST-RV-005": "PERLU_SERVIS",
    "AST-RV-026": "RUSAK",
}

# number, to site, to sub-location, to holder, reason, days ago
TRANSFERS = [
    ("AST-RV-007", "dc", "Pool kendaraan", "Dimas (kurir HO)", "Ditarik ke HO untuk kurir dokumen antar toko", -40),
    ("AST-RV-025", "store-07", "Area tengah", None, "Toko 03 ganti layout; rak gondola dipindah ke toko 07 yang butuh tambahan", -18),
    ("AST-RV-009", "store-05", "Ruang kepala toko", "Sari Wulandari", "Dipinjamkan ke kepala toko 05 selama laptop toko diperbaiki", -7),
]

NOTES = [
    ("AST-RV-005", "Ganti oli mesin & filter di km 128.000 (Bengkel Sejahtera)", -12),
    ("AST-RV-003", "Uji beban bulanan 30 menit normal; solar tersisa 60%", -20),
    ("AST-RV-029", "Garansi unit aktif s/d Jan 2027, kartu garansi disimpan di map GA", -200),
]

# asset number (or contract number), doc type, doc number, title, issuer, issued, expires
DOCUMENTS = [
    ("asset", "AST-RV-005", "STNK", "B 9412 KXT", "STNK Mitsubishi L300 Box", "Samsat Kab. Bekasi", -345, 20),
    ("asset", "AST-RV-005", "KIR", "BKS-KIR-2026-04417", "Buku uji KIR L300 Box", "Dishub Kab. Bekasi", -170, 12),
    ("asset", "AST-RV-006", "STNK", "B 1287 PJK", "STNK Toyota Avanza", "Samsat Kab. Bekasi", -130, 235),
    ("asset", "AST-RV-006", "BPKB", "BPKB-T-0098812", "BPKB Toyota Avanza", "Polda Metro Jaya", -840, None),
    ("asset", "AST-RV-007", "STNK", "D 3561 UJM", "STNK Honda Beat", "Samsat Kota Bandung", -375, -10),
    ("asset", "AST-RV-003", "SLO", "SLO-GST-2023-11820", "Sertifikat laik operasi genset DC", "Disnaker Kab. Bekasi", -900, 75),
    ("asset", "AST-RV-029", "Garansi", "DKN-WR-0501", "Kartu garansi AC cassette toko 05", "Daikin Indonesia", -628, 470),
    ("asset", "AST-RV-002", "SHM", "SHM No. 1182", "Sertifikat hak milik tanah DC", "BPN Kab. Bekasi", -3200, None),
    ("contract", "AS/PROP/2025-01", "Polis", "POL-WP-2025-778812", "Polis asuransi properti semua toko", "PT Asuransi Wahana Proteksi", -346, 19),
    ("contract", "IZ/ST13/2026", "NIB", "NIB-9120301128822", "Nomor induk berusaha toko 13", "OSS / DPMPTSP Purwakarta", -20, 55),
]


def contracts():
    """The deals, with windows counted from today so the standing is what the
    label says. Keys: the register's own field names, plus `target` (the
    status to leave it at), `archive` (a reason, to archive it) and `meter`
    (unit, starting reading, six months of usage)."""
    return [
        # SEWA
        dict(contract_number="SW/ST02/2024-11", contract_type="SEWA_TOKO", counterparty_name="Hj. Siti Aminah", site_id="store-02",
             starts_on=D(36 - 730), ends_on=D(36), contract_value_minor=480_000_000, is_signed=True, signed_by="Direktur Operasional",
             reminder_days=90, notes="Sewa ruko 2 lantai; opsi perpanjang 2 tahun, harga naik maks 10%", target="ACTIVE"),
        dict(contract_number="SW/ST05/2025-01", contract_type="SEWA_TOKO", counterparty_name="PT Plaza Nusa Indah (pengelola mall)", site_id="store-05",
             starts_on=D(-268), ends_on=D(1558), contract_value_minor=2_100_000_000, is_signed=True, signed_by="Direktur Utama",
             reminder_days=180, notes="Unit 1-27, service charge ditagih terpisah per bulan", target="ACTIVE"),
        dict(contract_number="SW/ST09/2023-09", contract_type="SEWA_TOKO", counterparty_name="Bpk. Rudi Hartono", site_id="store-09",
             starts_on=D(-25 - 1095), ends_on=D(-25), contract_value_minor=360_000_000, is_signed=True, signed_by="Direktur Operasional",
             reminder_days=90, notes="Habis; perpanjangan masih negosiasi harga", target="ACTIVE"),
        dict(contract_number="SW/ST13/2026-11", contract_type="SEWA_TOKO", counterparty_name="CV Griya Niaga Purwakarta", site_id="store-13",
             starts_on=D(37), ends_on=D(37 + 1095), contract_value_minor=540_000_000, is_signed=True, signed_by="Direktur Utama",
             reminder_days=120, notes="Toko baru; masa fit-out 6 minggu bebas sewa", target="ACTIVE"),
        dict(contract_number="SW/MESS/2026-01", contract_type="SEWA_RUMAH", counterparty_name="Bpk. Hendra Wijaya", site_id="dc",
             starts_on=D(-268), ends_on=D(97), contract_value_minor=54_000_000, is_signed=True, signed_by="Manajer GA",
             reminder_days=120, notes="Mess karyawan DC, 6 kamar", target="ACTIVE"),
        dict(contract_number="LS/KDR/2024-07", contract_type="SEWA_KENDARAAN", supplier="MANDALA-GA", site_id="dc",
             starts_on=D(-451), ends_on=D(644), contract_value_minor=312_000_000, is_signed=True, signed_by="Direktur Keuangan",
             reminder_days=90, notes="Leasing 2 unit Gran Max pick-up, termasuk servis berkala", target="ACTIVE"),
        # LANGGANAN
        dict(contract_number="PLN/ST02/512300118802", contract_type="LANGGANAN_LISTRIK", supplier="PLN-GA", site_id="store-02",
             starts_on="2023-05-01", customer_number="512300118802", is_signed=True, reminder_days=30, notes="B2 / 41.500 VA", target="ACTIVE",
             meter=("kWh", 184_220, [7_940, 8_310, 8_720, 9_105, 8_860, 8_540])),
        dict(contract_number="PLN/DC/512300004417", contract_type="LANGGANAN_LISTRIK", supplier="PLN-GA", site_id="dc",
             starts_on="2018-03-01", customer_number="512300004417", is_signed=True, reminder_days=30, notes="B3 / 197 kVA", target="ACTIVE",
             meter=("kWh", 1_082_400, [31_200, 32_950, 34_100, 35_800, 34_900, 33_700])),
        dict(contract_number="PDAM/ST02/0412118802", contract_type="LANGGANAN_AIR", supplier="PDAM-GA", site_id="store-02",
             starts_on="2023-05-01", customer_number="0412-118802", is_signed=True, reminder_days=30, target="ACTIVE",
             meter=("m³", 4_120, [38, 41, 45, 47, 44, 42])),
        dict(contract_number="PDAM/ST05/0412330521", contract_type="LANGGANAN_AIR", supplier="PDAM-GA", site_id="store-05",
             starts_on="2025-01-01", customer_number="0412-330521", is_signed=True, reminder_days=30, target="ACTIVE",
             meter=("m³", 610, [22, 25, 24, 28, 26, 23])),
        dict(contract_number="NET/DC/2025-05", contract_type="LANGGANAN_TELEKOM", supplier="NUSANET-GA", site_id="dc",
             starts_on=D(-500), ends_on=D(230), contract_value_minor=66_000_000, customer_number="NN-HO-0091", is_signed=True,
             signed_by="Manajer GA", reminder_days=30, notes="Dedicated fiber 100 Mbps + IP publik", target="ACTIVE"),
        dict(contract_number="NET/ST03/2023-02", contract_type="LANGGANAN_TELEKOM", supplier="NUSANET-GA", site_id="store-03",
             starts_on="2023-02-01", ends_on="2026-01-31", contract_value_minor=12_600_000, customer_number="NN-ST03-0218", is_signed=True,
             reminder_days=30, notes="Paket broadband lama", target="TERMINATED", archive="Diganti paket fiber baru; berhenti Jan 2026"),
        # JASA
        dict(contract_number="CL/DC/2025-10", contract_type="JASA_CLEANING", supplier="CLEANING-GA", site_id="dc",
             starts_on=D(-345), ends_on=D(20), contract_value_minor=96_000_000, is_signed=True, signed_by="Manajer GA",
             reminder_days=45, notes="4 cleaner shift pagi + 1 shift sore di DC & kantor", target="ACTIVE"),
        dict(contract_number="MT/AC/2026-01", contract_type="JASA_MAINTENANCE", objek="AC", supplier="SEJUK-GA", site_scope="ALL_STORES",
             starts_on=D(-267), ends_on=D(97), contract_value_minor=78_000_000, is_signed=True, signed_by="Manajer GA",
             reminder_days=60, notes="Servis AC 3 bulanan semua toko, termasuk isi freon ringan", target="ACTIVE"),
        dict(contract_number="MT/GENSET/DC-2026", contract_type="JASA_MAINTENANCE", objek="POWER_PLANT", supplier="DAYA-GA", site_id="dc",
             asset="AST-RV-003", starts_on=D(-200), ends_on=D(165), contract_value_minor=36_000_000, is_signed=True,
             signed_by="Manajer GA", reminder_days=60, notes="Uji beban bulanan & servis 250 jam genset DC", target="ACTIVE"),
        dict(contract_number="MT/PEST/2025-11", contract_type="JASA_MAINTENANCE", objek="BANGUNAN", supplier="HAMA-GA", site_scope="ALL_STORES",
             starts_on=D(-315), ends_on=D(50), contract_value_minor=46_800_000, is_signed=True, signed_by="Manajer GA",
             reminder_days=60, notes="Pest control bulanan (tikus, kecoa, rayap) semua toko", target="ACTIVE"),
        dict(contract_number="MT/SEC/DC-2026", contract_type="JASA_MAINTENANCE", objek="BANGUNAN", supplier="GARDA-GA", site_id="dc",
             starts_on=D(-176), ends_on=D(554), contract_value_minor=432_000_000, is_signed=True, signed_by="Direktur Operasional",
             reminder_days=90, notes="Jasa keamanan: 6 satpam 3 shift di DC (dicatat sebagai maintenance bangunan — belum ada tipe kontrak keamanan)",
             target="ACTIVE"),
        # ASURANSI
        dict(contract_number="AS/PROP/2025-01", contract_type="ASURANSI_PROPERTI", supplier="WAHANA-GA", site_scope="ALL_STORES",
             starts_on=D(-346), ends_on=D(19), contract_value_minor=186_000_000, is_signed=True, signed_by="Direktur Keuangan",
             reminder_days=60, notes="All risk + gempa bumi, nilai pertanggungan stok & bangunan 13 toko", target="ACTIVE"),
        dict(contract_number="AS/KDR/2026-03", contract_type="ASURANSI_KENDARAAN", supplier="WAHANA-GA", site_id="dc",
             starts_on=D(-208), ends_on=D(157), contract_value_minor=14_500_000, is_signed=True, signed_by="Manajer GA",
             reminder_days=45, notes="Comprehensive L300 Box & Avanza", target="ACTIVE"),
        # IZIN
        dict(contract_number="IZ/ST13/2026", contract_type="IZIN_USAHA", counterparty_name="DPMPTSP Kab. Purwakarta", site_id="store-13",
             starts_on=D(10), ends_on=D(10 + 1825), contract_value_minor=7_500_000, is_signed=False,
             reminder_days=90, notes="PBG/SLF & izin usaha toko baru — berkas masih dilengkapi", target="DRAFT"),
        dict(contract_number="IZ/KIR/L300-2026", contract_type="IZIN_KENDARAAN", counterparty_name="Dishub Kab. Bekasi (uji KIR)", site_id="dc",
             starts_on=D(-170), ends_on=D(12), contract_value_minor=350_000, is_signed=True,
             reminder_days=30, notes="Uji KIR 6 bulanan Mitsubishi L300 Box B 9412 KXT", target="ACTIVE"),
        # DISEWAKAN
        dict(contract_number="DS/ST05/ATM-2026", contract_type="DISEWAKAN_GEDUNG", counterparty_name="Bank Nusantara Jaya (booth ATM)", site_id="store-05",
             starts_on=D(-100), ends_on=D(630), contract_value_minor=36_000_000, is_signed=True, signed_by="Direktur Keuangan",
             reminder_days=60, notes="Sewa 2 m2 area depan untuk 1 mesin ATM", target="ACTIVE"),
    ]


# title, asset or site, interval, value, next due (days from today or None),
# contract number, supplier code, notes, paused
TASKS = [
    ("Servis AC berkala — Toko 02", ("asset", "AST-RV-021"), "MONTHS", 3, -12, "MT/AC/2026-01", "SEJUK-GA", "Cuci indoor + outdoor, cek freon", False),
    ("Servis AC berkala — Toko 05", ("asset", "AST-RV-029"), "MONTHS", 3, 3, "MT/AC/2026-01", "SEJUK-GA", None, False),
    ("Servis AC berkala — Kantor pusat", ("asset", "AST-RV-004"), "MONTHS", 3, 40, "MT/AC/2026-01", "SEJUK-GA", None, False),
    ("Uji beban genset DC bulanan", ("asset", "AST-RV-003"), "MONTHS", 1, 5, "MT/GENSET/DC-2026", "DAYA-GA", "30 menit dengan beban gudang", False),
    ("Servis genset 250 jam — Toko 07", ("asset", "AST-RV-038"), "MONTHS", 6, -4, None, "DAYA-GA", "Ganti oli, filter solar & filter udara", False),
    ("Pest control bulanan — Toko 03", ("site", "store-03"), "MONTHS", 1, 2, "MT/PEST/2025-11", "HAMA-GA", None, False),
    ("Pest control bulanan — Toko 09", ("site", "store-09"), "MONTHS", 1, -20, "MT/PEST/2025-11", "HAMA-GA", "Kunjungan Agustus terlewat, toko tutup renovasi", False),
    ("Servis rutin L300 tiap 10.000 km", ("asset", "AST-RV-005"), "KM", 10_000, None, None, "BENGKEL-GA", "Terakhir di km 128.000", False),
    ("Servis Avanza 6 bulanan", ("asset", "AST-RV-006"), "MONTHS", 6, 60, None, "BENGKEL-GA", None, False),
    ("Cek APAR & hydrant — DC", ("site", "dc"), "DAYS", 90, None, None, None, "Cek tekanan & tanggal isi ulang APAR", False),
    ("Pembersihan talang & atap — Toko 10", ("site", "store-10"), "MONTHS", 6, -35, None, "KARYA-GA", None, False),
    ("Backup & cek kesehatan NAS", ("asset", "AST-RV-010"), "DAYS", 30, 14, None, None, None, False),
    ("Kalibrasi timbangan gudang DC", ("site", "dc"), "MONTHS", 12, 120, None, None, "Ditunda — timbangan baru sedang diadakan", True),
]

# asset, days ago, inspector, result, findings, task title (the task's next
# due then counts from this day)
INSPECTIONS = [
    ("AST-RV-026", -9, "Lina Marlina", "RUSAK", "Kompresor tidak jalan, ruangan panas; freon kemungkinan habis", None),
    ("AST-RV-041", -15, "Nur Aisyah", "RUSAK", "DVR restart sendiri tiap 10 menit, 5 kamera no signal", None),
    ("AST-RV-021", -30, "Dewi Anggraini", "PERHATIAN", "Filter kotor, hembusan kurang dingin di siang hari", None),
    ("AST-RV-005", -6, "Yusuf (driver)", "PERHATIAN", "Rem depan bunyi, kampas tinggal 2 mm", None),
    ("AST-RV-023", -45, "Dewi Anggraini", "BAIK", "Semua rak kokoh, baut dinding aman", None),
    ("AST-RV-035", -3, "Rizky Pratama", "RUSAK", "Layar sentuh kasir tidak merespons, transaksi pindah ke laptop", None),
    ("AST-RV-032", -11, "Sari Wulandari", "PERHATIAN", "2 dari 8 modul LED neon box mati", None),
    ("AST-RV-006", -60, "Bagus Santoso", "BAIK", "Kondisi prima, ban & oli baik", None),
    ("AST-RV-001", -84, "Maya Lestari", "BAIK", "APAR gudang 12 unit tekanan normal, hydrant uji semprot OK", "Cek APAR & hydrant — DC"),
]

# title, site, asset, objek (when no asset), supplier, estimate, days ago,
# target, inspection findings to link, notes
REPAIRS = [
    ("AC toko 04 tidak dingin", "store-04", "AST-RV-026", None, "SEJUK-GA", 2_750_000, -9, "OPEN", "Kompresor tidak jalan", None),
    ("POS toko 06 layar sentuh mati", "store-06", "AST-RV-035", None, "KENCANA-GA", 1_850_000, -3, "OPEN", "Layar sentuh kasir", None),
    ("Atap bocor area fitting room toko 10", "store-10", None, "BANGUNAN", "KARYA-GA", 6_500_000, -5, "OPEN", None, "Talang tersumbat, 3 lembar genteng metal retak"),
    ("Toilet karyawan mampet toko 12", "store-12", None, "BANGUNAN", "KARYA-GA", 750_000, -1, "OPEN", None, None),
    ("DVR CCTV toko 08 restart terus", "store-08", "AST-RV-041", None, "KENCANA-GA", 1_400_000, -15, "APPROVED", "DVR restart", None),
    ("Rem depan mobil box bunyi", "dc", "AST-RV-005", None, "BENGKEL-GA", 1_200_000, -6, "APPROVED", "Rem depan bunyi", None),
    ("Neon box toko 05 dua modul LED mati", "store-05", "AST-RV-032", None, "TERANG-GA", 900_000, -11, "APPROVED", "modul LED", None),
    ("Genset toko 07 susah start", "store-07", "AST-RV-038", None, "DAYA-GA", 3_200_000, -21, "IN_PROGRESS", None, "Aki soak & injektor kotor"),
    ("Rolling door toko 03 macet", "store-03", None, "BANGUNAN", "KARYA-GA", 1_500_000, -14, "IN_PROGRESS", None, None),
    ("Laptop Finance baterai drop", "dc", "AST-RV-009", None, "KENCANA-GA", 1_100_000, -10, "IN_PROGRESS", None, "Unit pengganti dipinjamkan dari toko 05"),
    ("AC kantor pusat bocor air", "dc", "AST-RV-004", None, "SEJUK-GA", 650_000, -28, "COMPLETED", None, "Selang drain tersumbat"),
    ("Pengecatan ulang fasad toko 07", "store-07", None, "CAT", "KARYA-GA", 8_500_000, -40, "COMPLETED", None, None),
    ("Ganti kampas rem motor kurir", "dc", "AST-RV-007", None, "BENGKEL-GA", 350_000, -35, "CLOSED", None, None),
    ("Isi solar & oli genset DC", "dc", None, "GENSET_BBM", "DAYA-GA", 2_400_000, -50, "CLOSED", None, "200 liter solar + oli 15W-40"),
    ("Kaca etalase toko 09 retak", "store-09", None, "FFE", "KARYA-GA", 2_000_000, -19, "CANCELLED", None, "Diklaim ke asuransi properti, tidak lewat perbaikan"),
]

# old asset, reason, supplier, days ago, target, repair title
REPLACEMENTS = [
    ("AST-RV-040", "AC toko 08 umur 9 tahun, kompresor sudah 2x servis besar — lebih murah ganti unit inverter", "SEJUK-GA", -4, "PROPOSED", None),
    ("AST-RV-043", "Mesin kasir toko 09 lambat dan tidak kompatibel dengan update POS 2026", "KENCANA-GA", -12, "APPROVED", None),
    ("AST-RV-028", "DVR 8 kanal toko 04 sering hang; diganti DVR 16 kanal agar gudang ikut terpantau", "KENCANA-GA", -20, "PURCHASED", None),
    ("AST-RV-047", "AC ruang stok toko 11 (2016) bocor freon berulang, suku cadang tidak tersedia", "SEJUK-GA", -33, "INSTALLED", None),
    ("AST-RV-045", "Genset toko 10 (2016) mati total setelah banjir; tidak ekonomis diperbaiki", "DAYA-GA", -60, "CLOSED", None),
]

# asset, method, proceeds, reason, days ago, target, decision note
DISPOSALS = [
    ("AST-RV-051", "SCRAPPED", None, "Printer dot-matrix sudah tidak dipakai sejak POS baru, suku cadang habis", -6, "REQUESTED", None),
    ("AST-RV-055", "DONATED", None, "Meja kasir lama disumbangkan ke koperasi karyawan", -2, "REQUESTED", None),
    ("AST-RV-052", "SOLD", 3_500_000, "Motor 2012 biaya servis melebihi nilai; dijual ke karyawan lewat lelang internal", -25, "APPROVED", "Harga sesuai taksiran bengkel"),
    ("AST-RV-053", "SCRAPPED", None, "Rak kayu lapuk dan rayapan; tidak layak dipakai", -48, "POSTED", "Sudah dibongkar, dibuang dengan berita acara"),
    ("AST-RV-054", "LOST", None, "Laptop kasir toko 10 tidak ditemukan saat stock opname aset Agustus", -30, "REJECTED", "Laptop ditemukan di gudang toko 10; kembali ke register"),
]

# site, requester, category, item, quantity, needed (days), estimate, target,
# PO (for ORDERED and after), rejection reason, notes
SUPPLIES = [
    ("store-03", "Hendra Saputra", "TOKO_KANTOR", "Kantong belanja kertas ukuran M", "2.000 pcs", 10, 3_400_000, "REQUESTED", None, None, "Stok tinggal 1 minggu"),
    ("store-07", "Agus Setiawan", "LISTRIK", "Lampu LED 18W", "24 pcs", 7, 1_080_000, "REQUESTED", None, None, None),
    ("store-11", "Eko Prasetyo", "RUMAH_TANGGA", "Cairan pembersih lantai 5L", "6 jerigen", 5, 540_000, "REQUESTED", None, None, None),
    ("dc", "Maya Lestari", "ATK", "Toner printer HP 76A", "4 pcs", 14, 3_600_000, "REQUESTED", None, None, None),
    ("store-12", "Putri Handayani", "TOKO_KANTOR", "Hanger plastik dewasa", "500 pcs", 20, 1_750_000, "REQUESTED", None, None, "Untuk koleksi musim baru"),
    ("store-05", "Sari Wulandari", "ATK", "Kertas struk thermal 80mm", "50 roll", 6, 750_000, "APPROVED", None, None, None),
    ("dc", "Maya Lestari", "MESS", "Kasur busa mess 90x200", "2 pcs", 21, 2_200_000, "APPROVED", None, None, None),
    ("store-09", "Fajar Nugroho", "LISTRIK", "Kabel roll 15m", "2 pcs", 8, 380_000, "APPROVED", None, None, None),
    ("store-02", "Dewi Anggraini", "TOOLS", "Tangga lipat aluminium 2m", "1 unit", 4, 850_000, "ORDERED", "PO-GA/2026/09/014", None, None),
    ("store-13", "Dimas Aditya", "TELEPON", "Pesawat telepon kantor", "2 unit", 30, 700_000, "ORDERED", "PO-GA/2026/09/017", None, "Untuk pembukaan toko 13"),
    ("store-06", "Rizky Pratama", "RUMAH_TANGGA", "Sapu, pel & ember set", "3 set", -3, 420_000, "RECEIVED", "PO-GA/2026/09/009", None, None),
    ("store-01", "Rina", "TOKO_KANTOR", "Label harga & tag gun", "5 box", -1, 1_250_000, "RECEIVED", "PO-GA/2026/09/011", None, None),
    ("dc", "Maya Lestari", "ATK", "ATK bulanan HO (September)", "1 paket", -15, 2_150_000, "BILLED", "PO-GA/2026/09/002", None, None),
    ("store-08", "Nur Aisyah", "TOKO_KANTOR", "Kursi kasir ergonomis", "2 unit", 12, 3_800_000, "REJECTED", None, "Di luar anggaran Q3; ajukan ulang di Q4", None),
    ("store-04", "Lina Marlina", "RUMAH_TANGGA", "Dispenser air panas-dingin", "1 unit", 9, 1_650_000, "REJECTED", None, "Pantry toko sudah punya dispenser; pakai yang ada", None),
]

SUPPLY_FLOW = ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "BILLED"]
REPAIR_FLOW = ["OPEN", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED"]
REPLACEMENT_FLOW = ["PROPOSED", "APPROVED", "PURCHASED", "INSTALLED", "CLOSED"]


# ── the writers ─────────────────────────────────────────────────────────────


def seed_suppliers():
    print("vendors")
    page = get("/api/v1/suppliers?limit=500")
    by_code = {row["supplier_code"]: row for row in page["rows"]}
    for code in DEMO_SUPPLIERS:
        row = by_code.get(code)
        if row is None:
            refusals.append(f"vendor · {code}: not in the register (run seed-ga-demo.sh first)")
            count("vendor", "!")
        elif row.get("category") == "EXPENSE":
            same("vendor", f"{code} already in the EXPENSE book")
        else:
            # The vendor master is written with an idempotency key and an
            # If-Match on the version the list showed, like the screen does.
            step("vendor", f"{code} → EXPENSE book", "PATCH", f"/api/v1/suppliers/{row['supplier_id']}", {"category": "EXPENSE"},
                 headers={"idempotency-key": f"seed-ga-review:{code}:expense", "if-match": f'"{row["version"]}"'})
    for code, name, contact, phone, email, address, account in SUPPLIERS:
        if code in by_code:
            same("vendor", f"{code} {name}")
            continue
        status, answer = step("vendor", f"{code} {name}", "POST", "/api/v1/suppliers", {
            "supplier_code": code, "name": name, "contact_name": contact, "phone": phone, "email": email,
            "address": address, "status": "ACTIVE", "category": "EXPENSE", "expense_account_code": account,
        }, headers={"idempotency-key": f"seed-ga-review:{code}"})
        if status in (200, 201):
            by_code[code] = answer
    if any(code not in by_code for code, *_ in SUPPLIERS):
        by_code = {row["supplier_code"]: row for row in get("/api/v1/suppliers?limit=500")["rows"]}
    return {code: row["supplier_id"] for code, row in by_code.items()}


def seed_locations():
    print("locations")
    have = {row["site_id"]: row for row in get("/api/v1/ga/locations")}
    for site, (address, kind, area, contact, phone, notes) in LOCATIONS.items():
        if site not in have:
            refusals.append(f"location · {site}: no such site")
            count("location", "!")
            continue
        if have[site].get("address"):
            same("location", f"{site} detail")
            continue
        step("location", f"{site} detail", "PATCH", f"/api/v1/ga/locations/{site}", {
            "address": address, "kind": kind, "floor_area_sqm": area, "contact_name": contact,
            "contact_phone": phone, "notes": notes,
        })


def seed_assets():
    print("register")
    page = get("/api/v1/ga/assets?limit=1000")
    by_number = {row["asset_number"]: row for row in page["rows"]}
    for number, name, klass, site, sub, holder, condition, serial, acquired, specs, quantity in ASSETS:
        if number in by_number:
            same("asset", f"{number} {name}")
            continue
        status, answer = step("asset", f"{number} {name}", "POST", "/api/v1/ga/assets", {
            "asset_number": number, "name": name, "class_code": klass, "site_id": site, "sub_location": sub,
            "holder": holder, "condition": condition, "serial_number": serial, "acquired_on": acquired,
            "specs": specs, "notes": None, "quantity": quantity,
        })
        if status in (200, 201):
            by_number[number] = answer

    print("condition corrections")
    for number, condition in CONDITION_CHANGES.items():
        row = by_number.get(number)
        if row is None:
            continue
        if row["condition"] == condition:
            same("asset condition", f"{number} {condition}")
            continue
        status, answer = step("asset condition", f"{number} → {condition}", "PATCH", f"/api/v1/ga/assets/{row['asset_id']}",
                              {"condition": condition})
        if status == 200:
            by_number[number] = answer

    print("transfers")
    for number, to_site, to_sub, to_holder, reason, ago in TRANSFERS:
        row = by_number.get(number)
        if row is None:
            continue
        if row["site_id"] == to_site:
            same("asset transfer", f"{number} already at {to_site}")
            continue
        status, answer = step("asset transfer", f"{number} {row['site_id']} → {to_site}", "POST",
                              f"/api/v1/ga/assets/{row['asset_id']}/transfer",
                              {"to_site": to_site, "to_sub_location": to_sub, "to_holder": to_holder,
                               "reason": reason, "occurred_on": D(ago)})
        if status == 200:
            by_number[number] = answer

    print("notes")
    for number, reason, ago in NOTES:
        row = by_number.get(number)
        if row is None:
            continue
        hub = get(f"/api/v1/ga/assets/{row['asset_id']}")
        if any(event["reason"] == reason for event in hub["events"]):
            same("asset note", f"{number}: {reason[:40]}")
            continue
        step("asset note", f"{number}: {reason[:40]}", "POST", f"/api/v1/ga/assets/{row['asset_id']}/notes",
             {"reason": reason, "occurred_on": D(ago)})
    return {number: row["asset_id"] for number, row in by_number.items()}


def seed_contracts(suppliers, assets):
    print("contracts")
    page = get("/api/v1/ga/contracts?limit=1000")
    by_number = {row["contract_number"]: row for row in page["rows"] if row["contract_number"]}
    for spec in contracts():
        spec = dict(spec)
        target = spec.pop("target")
        archive = spec.pop("archive", None)
        meter = spec.pop("meter", None)
        supplier = spec.pop("supplier", None)
        asset = spec.pop("asset", None)
        number = spec["contract_number"]
        if supplier:
            spec["supplier_id"] = suppliers.get(supplier)
        if asset:
            spec["asset_id"] = assets.get(asset)

        row = by_number.get(number)
        if row is None:
            status, row = step("contract", number, "POST", "/api/v1/ga/contracts", spec)
            if status not in (200, 201):
                continue
            by_number[number] = row
        else:
            same("contract", number)

        # DRAFT -> ACTIVE -> TERMINATED, from wherever the row stands.
        ladder = ["DRAFT", "ACTIVE", "TERMINATED"]
        while not row["archived"] and ladder.index(row["status"]) < ladder.index(target):
            nxt = ladder[ladder.index(row["status"]) + 1]
            status, answer = step("contract status", f"{number} → {nxt}", "PATCH",
                                  f"/api/v1/ga/contracts/{row['contract_id']}", {"status": nxt})
            if status != 200:
                break
            row = answer

        if meter:
            unit, reading, usages = meter
            have = {r["period"] for r in get(f"/api/v1/ga/contracts/{row['contract_id']}/meter-readings")}
            for offset, usage in zip(range(-len(usages), 0), usages):
                period = month_start(offset)
                opening, closing = reading, reading + usage
                reading = closing
                if period.isoformat() in have:
                    same("meter reading", f"{number} {period:%Y-%m}")
                    continue
                read_on = (month_start(offset + 1) + timedelta(days=1)).isoformat()
                step("meter reading", f"{number} {period:%Y-%m} {usage} {unit}", "POST",
                     f"/api/v1/ga/contracts/{row['contract_id']}/meter-readings",
                     {"period": period.isoformat(), "unit": unit, "opening": opening, "closing": closing, "read_on": read_on})

        if archive:
            if row["archived"]:
                same("contract archive", f"{number} archived")
            else:
                status, answer = step("contract archive", f"{number} archived", "POST",
                                      f"/api/v1/ga/contracts/{row['contract_id']}/archive",
                                      {"archived": True, "reason": archive})
                if status == 200:
                    row = answer
        by_number[number] = row
    return {number: row["contract_id"] for number, row in by_number.items()}


def seed_documents(assets, contracts_by_number):
    print("papers")
    for kind, key, doc_type, doc_number, title, issuer, issued, expires in DOCUMENTS:
        subject = assets.get(key) if kind == "asset" else contracts_by_number.get(key)
        if subject is None:
            continue
        filed = get(f"/api/v1/documents?subject_kind={kind}&subject_id={subject}&limit=200")
        if any(doc.get("doc_number") == doc_number for doc in filed):
            same("document", f"{doc_type} {doc_number}")
            continue
        file_name = f"{doc_type}-{doc_number}".replace(" ", "").replace("/", "-").replace(".", "") + ".pdf"
        lines = [title, f"{doc_type}  No. {doc_number}", f"Diterbitkan oleh: {issuer}", f"Tanggal terbit: {D(issued)}"]
        if expires is not None:
            lines.append(f"Berlaku s/d: {D(expires)}")
        status, stored = call("POST", "/api/v1/files?" + urllib.parse.urlencode({"name": file_name, "type": "application/pdf"}),
                              raw=tiny_pdf(lines), content_type="application/pdf")
        if status not in (200, 201):
            refusals.append(f"document · upload {file_name}: {status} {message(stored)}")
            count("document", "!")
            continue
        step("document", f"{doc_type} {doc_number}" + (f" (s/d {D(expires)})" if expires is not None else ""), "POST",
             "/api/v1/documents", {
                 "file_id": stored["file_id"], "file_name": file_name, "content_type": "application/pdf",
                 "title": title, "path_tokens": ["GA", "Legal" if kind == "contract" else "Aset"],
                 "language": "indonesian", "doc_date": D(issued), "doc_type": doc_type, "doc_number": doc_number,
                 "issuer": issuer, "issued_on": D(issued), "expires_on": D(expires) if expires is not None else None,
                 "tags": [], "links": [{"subject_kind": kind, "subject_id": subject}],
             })


def seed_tasks(assets, contracts_by_number, suppliers):
    print("service schedule")
    have = {row["title"]: row for row in get("/api/v1/ga/maintenance-tasks?limit=1000")["rows"]}
    for title, (on, key), interval, value, due, contract, supplier, notes, paused in TASKS:
        row = have.get(title)
        if row is None:
            body = {
                "asset_id": assets.get(key) if on == "asset" else None,
                "site_id": key if on == "site" else None,
                "title": title, "interval_kind": interval, "interval_value": value,
                "next_due": D(due) if due is not None else None,
                "contract_id": contracts_by_number.get(contract) if contract else None,
                "supplier_id": suppliers.get(supplier) if supplier else None, "notes": notes,
            }
            status, row = step("maintenance task", title, "POST", "/api/v1/ga/maintenance-tasks", body)
            if status not in (200, 201):
                continue
            have[title] = row
        else:
            same("maintenance task", title)
        if paused and row["status"] != "PAUSED":
            # The title rides along although it does not change: the writer
            # reads an absent title from a row it never selected it into, and
            # answers 500 (ga_maintenance_task_update).
            step("maintenance task pause", f"{title} → PAUSED", "PATCH", f"/api/v1/ga/maintenance-tasks/{row['task_id']}",
                 {"status": "PAUSED", "title": title})
    return {title: row["task_id"] for title, row in have.items()}


def seed_inspections(assets, tasks):
    print("walk-rounds")
    have = get("/api/v1/ga/inspections?limit=1000")["rows"]
    seen = {(row["asset_id"], row["findings"]): row for row in have}
    for number, ago, inspector, result, findings, task in INSPECTIONS:
        asset_id = assets.get(number)
        if asset_id is None:
            continue
        if (asset_id, findings) in seen:
            same("inspection", f"{number} {result}")
            continue
        status, row = step("inspection", f"{number} {result}", "POST", "/api/v1/ga/inspections", {
            "asset_id": asset_id, "inspected_on": D(ago), "inspected_by": inspector, "result": result,
            "findings": findings, "task_id": tasks.get(task) if task else None,
        })
        if status in (200, 201):
            seen[(asset_id, findings)] = row
    return list(seen.values())


def seed_repairs(assets, suppliers, inspections, checker):
    print("repairs")
    have = {(row["title"], row["site_id"]): row for row in get("/api/v1/ga/repairs?limit=1000")["rows"]}
    for title, site, asset, objek, supplier, estimate, ago, target, finding, notes in REPAIRS:
        row = have.get((title, site))
        if row is None:
            inspection = None
            if finding and asset:
                inspection = next((i["inspection_id"] for i in inspections
                                   if i["asset_id"] == assets.get(asset) and finding in i["findings"]), None)
            status, row = step("repair", f"{title} [{site}]", "POST", "/api/v1/ga/repairs", {
                "site_id": site, "asset_id": assets.get(asset) if asset else None, "objek": objek, "title": title,
                "supplier_id": suppliers.get(supplier), "estimated_cost_minor": estimate, "failure_at": D(ago),
                "inspection_id": inspection, "notes": notes,
            })
            if status not in (200, 201):
                continue
        else:
            same("repair", f"{title} [{site}]")

        if target == "CANCELLED":
            if row["status"] in ("OPEN", "APPROVED", "IN_PROGRESS"):
                step("repair move", f"{title} → CANCELLED", "POST", f"/api/v1/ga/repairs/{row['repair_id']}/move",
                     {"to": "CANCELLED", "note": notes})
            continue
        if row["status"] not in REPAIR_FLOW:
            continue
        while REPAIR_FLOW.index(row["status"]) < REPAIR_FLOW.index(target):
            nxt = REPAIR_FLOW[REPAIR_FLOW.index(row["status"]) + 1]
            if nxt == "APPROVED":
                # The budget is a second person's act; see the docstring.
                budget = (estimate // 100_000 + 1) * 100_000 if estimate else 0
                status, answer = step("repair move", f"{title} → APPROVED (budget by {CHECKER_USER})", "POST",
                                      f"/api/v1/ga/repairs/{row['repair_id']}/approve-budget",
                                      {"approved_budget_minor": budget}, checker, CHECKER_API)
            else:
                status, answer = step("repair move", f"{title} → {nxt}", "POST", f"/api/v1/ga/repairs/{row['repair_id']}/move",
                                      {"to": nxt, "note": None})
            if status != 200:
                break
            row = answer
        have[(title, site)] = row
    return {title: row["repair_id"] for (title, _), row in have.items()}


def seed_replacements(assets, suppliers, checker):
    print("replacements")
    have = {row["reason"]: row for row in get("/api/v1/ga/replacements?limit=1000")["rows"]}
    for number, reason, supplier, ago, target, _repair in REPLACEMENTS:
        row = have.get(reason)
        if row is None:
            status, row = step("replacement", f"{number}", "POST", "/api/v1/ga/replacements", {
                "old_asset_id": assets.get(number), "repair_id": None, "reason": reason,
                "supplier_id": suppliers.get(supplier), "proposed_on": D(ago),
            })
            if status not in (200, 201):
                continue
        else:
            same("replacement", number)
        while REPLACEMENT_FLOW.index(row["status"]) < REPLACEMENT_FLOW.index(target):
            nxt = REPLACEMENT_FLOW[REPLACEMENT_FLOW.index(row["status"]) + 1]
            if nxt == "APPROVED":
                status, answer = step("replacement move", f"{number} → APPROVED (by {CHECKER_USER})", "POST",
                                      f"/api/v1/ga/replacements/{row['replacement_id']}/move", {"to": nxt},
                                      checker, CHECKER_API)
            else:
                # INSTALLED with no new asset named: the server mints the copy.
                status, answer = step("replacement move", f"{number} → {nxt}", "POST",
                                      f"/api/v1/ga/replacements/{row['replacement_id']}/move", {"to": nxt, "new_asset_id": None})
            if status != 200:
                break
            row = answer


def seed_disposals(assets, checker):
    print("disposals")
    have = {row["reason"]: row for row in get("/api/v1/ga/disposals?limit=1000")["rows"]}
    for number, method, proceeds, reason, ago, target, note in DISPOSALS:
        row = have.get(reason)
        if row is None:
            status, row = step("disposal", f"{number} {method}", "POST", "/api/v1/ga/disposals", {
                "asset_id": assets.get(number), "method": method, "proceeds_minor": proceeds,
                "reason": reason, "requested_on": D(ago),
            })
            if status not in (200, 201):
                continue
        else:
            same("disposal", f"{number} {method}")
        if row["status"] == "REQUESTED" and target in ("APPROVED", "POSTED", "REJECTED"):
            approve = target != "REJECTED"
            status, answer = step("disposal decision", f"{number} {'approved' if approve else 'rejected'} by {CHECKER_USER}",
                                  "POST", f"/api/v1/ga/disposals/{row['disposal_id']}/decide",
                                  {"approve": approve, "note": note}, checker, CHECKER_API)
            if status != 200:
                continue
            row = answer
        if row["status"] == "APPROVED" and target == "POSTED":
            step("disposal decision", f"{number} closed (booked) by {CHECKER_USER}", "POST",
                 f"/api/v1/ga/disposals/{row['disposal_id']}/close", None, checker, CHECKER_API)


def seed_supplies():
    print("supplies")
    have = {(row["site_id"], row["item"]): row for row in get("/api/v1/ga/supplies?limit=1000")}
    for site, who, category, item, quantity, needed, estimate, target, po, rejected, notes in SUPPLIES:
        row = have.get((site, item))
        if row is None:
            status, row = step("supply request", f"{item} [{site}]", "POST", "/api/v1/ga/supplies", {
                "site_id": site, "requested_by": who, "category_code": category, "item": item,
                "quantity": quantity, "needed_by": D(needed), "estimated_cost_minor": estimate, "notes": notes,
            })
            if status not in (200, 201):
                continue
        else:
            same("supply request", f"{item} [{site}]")
        if target == "REJECTED":
            if row["status"] == "REQUESTED":
                step("supply move", f"{item} → REJECTED", "POST", f"/api/v1/ga/supplies/{row['request_id']}/move",
                     {"to": "REJECTED", "rejected_reason": rejected})
            continue
        while row["status"] in SUPPLY_FLOW and SUPPLY_FLOW.index(row["status"]) < SUPPLY_FLOW.index(target):
            nxt = SUPPLY_FLOW[SUPPLY_FLOW.index(row["status"]) + 1]
            status, answer = step("supply move", f"{item} → {nxt}", "POST", f"/api/v1/ga/supplies/{row['request_id']}/move",
                                  {"to": nxt, "po_reference": po if nxt == "ORDERED" else None})
            if status != 200:
                break
            row = answer
        have[(site, item)] = row
    return {item: row["request_id"] for (_, item), row in have.items()}


def seed_bill_requests(suppliers, contracts_by_number, repairs, supplies):
    """Three drafts GA hands to Finance: a month of electricity, a finished
    repair and a delivered supply. The account is left to the server's
    suggestion, as the GA form does. A second run answers 409 on the invoice
    number, which is the supplier's own."""
    print("bill requests (drafts for Finance)")
    last = month_start(-1)
    bills = [
        ("PLN-GA", f"PLN-512300118802-{last:%y%m}", -5, 15, 13_420_000, 1_476_200,
         dict(site_id="store-02", contract_id=contracts_by_number.get("PLN/ST02/512300118802"), service_period_start=last.isoformat(),
              service_period_end=(month_start(0) - timedelta(days=1)).isoformat(), memo=f"Listrik toko 02 {last:%B %Y}")),
        ("SEJUK-GA", "INV/STM/2026/0912", -3, 27, 650_000, 0,
         dict(site_id="dc", repair_id=repairs.get("AC kantor pusat bocor air"), memo="Perbaikan drain AC kantor lt. 2")),
        ("REJEKI-GA", "SRJ-0921-0336", -1, 29, 420_000, 0,
         dict(site_id="store-06", supply_request_id=supplies.get("Sapu, pel & ember set"), memo="Sapu, pel & ember 3 set")),
    ]
    for supplier, number, invoiced, due, subtotal, tax, line in bills:
        if any(v is None for k, v in line.items() if k.endswith("_id")):
            refusals.append(f"bill request · {number}: its GA record is missing")
            count("bill request", "!")
            continue
        step("bill request", f"{supplier} {number}", "POST", "/api/v1/ga/bill-requests", {
            "supplier_id": suppliers.get(supplier), "invoice_number": number, "invoice_date": D(invoiced),
            "due_date": D(due), "subtotal_minor": subtotal, "tax_minor": tax,
            "note": "Diajukan GA dari seed review", "lines": [{**line, "amount_minor": subtotal}],
        })


# ── what the screens will read ──────────────────────────────────────────────


def verify():
    print("\nwhat each screen reads")
    empty = []

    def show(label, n, detail=""):
        print(f"  {'·' if n else '!'} {label}: {n}{('  ' + detail) if detail else ''}")
        if not n:
            empty.append(label)

    def facets(rows):
        return ", ".join(f"{f['value']} {f['count']}" for f in rows)

    overview = get("/api/v1/ga/overview")
    for section in ("draft_assets", "expiring_documents", "expiring_contracts", "due_maintenance",
                    "open_repairs", "replacements", "supply_requests"):
        show(f"/ga overview · {section}", len(overview[section]))

    assets = get("/api/v1/ga/assets?limit=1000")
    show("/assets register", assets["total"], "builds: " + facets(assets["facets"]["builds"]))
    for build in ("LAND,BUILDING", "TECH", "VEHICLE", "FFE", "IT", "AUDIO", "OE", "SOFTWARE", "DEFERRED,CIP"):
        show(f"/assets build {build}", get(f"/api/v1/ga/assets?build={build}")["total"])
    show("/assets forms (asset-builds)", len(get("/api/v1/ga/asset-builds")["builds"]))
    hub = get(f"/api/v1/ga/assets/{next(r['asset_id'] for r in assets['rows'] if r['asset_number'] == 'AST-RV-005')}")
    show("/assets hub AST-RV-005 · events", len(hub["events"]))
    show("/assets hub AST-RV-005 · documents", len(hub["documents"]))

    page = get("/api/v1/ga/contracts?limit=1000")
    show("/contracts register", page["total"], "standing: " + facets(page["facets"]["standings"]))
    for group in ("SEWA", "JASA", "ASURANSI", "IZIN", "LANGGANAN", "DISEWAKAN"):
        show(f"/contracts group {group}", get(f"/api/v1/ga/contracts?group={group}")["total"])
    show("/contracts/utilities (LISTRIK+AIR+TELEKOM)", get("/api/v1/ga/contracts?type=LANGGANAN_LISTRIK,LANGGANAN_AIR,LANGGANAN_TELEKOM")["total"])
    show("/contracts/cleaning", get("/api/v1/ga/contracts?type=JASA_CLEANING")["total"])
    show("/contracts archived", get("/api/v1/ga/contracts?archived=true")["total"])
    show("/contracts types", len(get("/api/v1/ga/contract-types")))
    pln = next(r for r in page["rows"] if r["contract_number"] == "PLN/ST02/512300118802")
    show("/contracts hub PLN toko 02 · meter readings", len(get(f"/api/v1/ga/contracts/{pln['contract_id']}")["meter_readings"]))
    polis = next(r for r in page["rows"] if r["contract_number"] == "AS/PROP/2025-01")
    show("/contracts hub polis properti · documents", len(get(f"/api/v1/ga/contracts/{polis['contract_id']}")["documents"]))

    locations = get("/api/v1/ga/locations")
    show("/locations", len(locations), f"{sum(1 for r in locations if r['address'])} with detail")
    place = get("/api/v1/ga/locations/store-05")
    show("/locations hub store-05", sum(len(place[k]) for k in ("assets", "contracts", "repairs", "tasks", "supplies", "utilities")),
         ", ".join(f"{k} {len(place[k])}" for k in ("assets", "contracts", "repairs", "tasks", "supplies", "utilities")))

    tasks = get("/api/v1/ga/maintenance-tasks?limit=1000")
    show("/maintenance/schedule tasks", tasks["total"], "status: " + facets(tasks["facets"]["statuses"]))
    inspections = get("/api/v1/ga/inspections?limit=1000")
    show("/maintenance/schedule inspections", inspections["total"], "result: " + facets(inspections["facets"]["results"]))
    repairs = get("/api/v1/ga/repairs?limit=1000")
    show("/maintenance repairs", repairs["total"], "status: " + facets(repairs["facets"]["statuses"]))
    show("/maintenance repair objects", len(get("/api/v1/ga/repair-objects")))
    replacements = get("/api/v1/ga/replacements?limit=1000")
    show("/maintenance/replacements", replacements["total"], "status: " + facets(replacements["facets"]["statuses"]))
    disposals = get("/api/v1/ga/disposals?limit=1000")
    show("/maintenance/replacements disposals", disposals["total"], "status: " + facets(disposals["facets"]["statuses"]))
    for label, path, rows in (("replacement", "replacements", replacements["rows"]), ("disposal", "disposals", disposals["rows"])):
        if rows:
            status, _ = call("GET", f"/api/v1/ga/{path}/{rows[0][f'{label}_id']}")
            if status != 200:
                print(f"  ! /maintenance {label} hub: GET /api/v1/ga/{path}/{{id}} answers {status} — the node has no such route")
                empty.append(f"/maintenance {label} hub (GET /api/v1/ga/{path}/{{id}} → {status})")

    supplies = get("/api/v1/ga/supplies?limit=1000")
    by_status: dict[str, int] = {}
    for row in supplies:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
    show("/supplies", len(supplies), ", ".join(f"{k} {v}" for k, v in sorted(by_status.items())))
    show("/supplies categories", len(get("/api/v1/ga/supply-categories")))
    show("/vendors EXPENSE book", get("/api/v1/suppliers?category=EXPENSE&limit=500")["total"])
    return empty


def main() -> int:
    global TODAY
    overview = get("/api/v1/ga/overview")
    TODAY = date.fromisoformat(overview["generated_on"])
    print(f"seeding GA on {API} as of {TODAY} (the node's business day)")

    password = os.environ.get("GA_CHECKER_PASSWORD")
    if not password:
        sys.exit("! GA_CHECKER_PASSWORD is not set: the second pair of eyes needs to sign in")
    status, body = call("POST", "/api/v1/auth/login", {"username": CHECKER_USER, "password": password}, base=CHECKER_API)
    if status != 200:
        sys.exit(f"! cannot sign in as {CHECKER_USER} on {CHECKER_API}: {status} {message(body)}")
    checker = body["token"]

    suppliers = seed_suppliers()
    seed_locations()
    assets = seed_assets()
    contract_ids = seed_contracts(suppliers, assets)
    seed_documents(assets, contract_ids)
    tasks = seed_tasks(assets, contract_ids, suppliers)
    inspections = seed_inspections(assets, tasks)
    repairs = seed_repairs(assets, suppliers, inspections, checker)
    seed_replacements(assets, suppliers, checker)
    seed_disposals(assets, checker)
    supplies = seed_supplies()
    seed_bill_requests(suppliers, contract_ids, repairs, supplies)

    empty = verify()
    print("\ntally (+ written, = already there, ! refused)")
    for kind, outcome in tally.items():
        print(f"  {kind:24} +{outcome['+']:<3} ={outcome['=']:<3} !{outcome['!']}")
    print(json.dumps({"refusals": refusals, "empty": empty}, indent=2, ensure_ascii=False))
    return 1 if refusals else 0


if __name__ == "__main__":
    raise SystemExit(main())
