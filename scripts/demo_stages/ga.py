"""General Affairs and the fixed-asset books, end to end, for the demo.

Runs after `finance` in demo-populate's ORDER. Everything goes through the
routes the hub's GA and Finance screens call, in the order the domain accepts:

  vendors      the EXPENSE book GA buys from (`/api/v1/suppliers`)
  locations    address and contact for head office (`dc`) and store-01
  purchases    Finance records four EXPENSE bills whose lines say which asset
               class they buy, and POSTS them: the posting mints each asset as
               a DRAFT and hangs it on the journal line (Dr 10xx cost / Cr AP)
  register     GA completes each draft (holder, condition, the build's fields)
               and registers what the company owned before this system (land,
               an old AC, operating equipment, an old receipt printer)
  assessment   Finance capitalises every bought asset (life, method, charge
               kind — software AMORTISATION), the fit-out as IN_PROGRESS (CIP)
  month end    the Sep 2026 depreciation run, the Sep replacement-reserve run
               for the store's display racks, and one write-off (a stolen
               laptop) that takes cost and accumulated depreciation off the
               books with the loss named — asked for by the shop through GA's
               disposal flow, approved, booked by Finance, closed
  upkeep       contracts (lease, cleaning, electricity + water with meter
               readings, AC service), the service schedule, a walk-round
               inspection, a repair, a replacement proposal, a disposal request
  supplies     three requests at three rungs
  paperwork    a GENERAL letter issued and saved as a template, papers filed
               against the vehicle and the cleaning contract, a saved report

Every row can be explained: the amounts are round, each monthly charge divides
exactly, and every journal is written by the server's own posting rules.

# Who does what (sign-in on: demo-populate --password)

  rina  (Cloud, ADMIN)  everything head office does: vendors, locations,
                        Finance's bills, assessment, month end and booking the
                        write-off; GA's register, contracts, schedule, letters;
                        and the SECOND pair of eyes — she approves the repair
                        budget, the replacement and both disposals, and moves
                        the supplies along
  maya  (store node)    files the old AC's repair and the shop's two supply
                        requests from the till, through the store's relay to
                        head office (`/api/v1/store/central/…`), as the store
                        app's /ga pages do
  maya  (Cloud)         what the till has no screen for: the two walk-round
                        inspections, the replacement proposal, and the disposal
                        requests (the old receipt printer, the stolen laptop)
  nina  (Cloud)         head office's own breakdown (the DC rolling door, left
                        OPEN for Rina's approval) and the DC's toner request

Approving is refused to the person who raised the thing (maker != checker), so
with two people the records reach their later rungs: the old AC's repair
APPROVED -> IN_PROGRESS, the replacement APPROVED, the printer's disposal
APPROVED (never capitalised, so Finance has nothing to book and it waits there),
the laptop's disposal POSTED once Finance's write-off is in the books.

With sign-in off (no --password) every call is `development` and the store node
relays for nobody ("this node signs nobody in"): there is no second person, so
the approvals are skipped and the records stay on their first rung (repair OPEN,
replacement PROPOSED, printer disposal REQUESTED), and the stolen laptop is
written off by Finance's own dispose route alone, as before.

# Where this is SQL

Nowhere. Papers go through `/api/v1/files` (bytes kept in Postgres on a
bucket-less node) and then `/api/v1/documents`.

Re-running is safe: every record is looked up by its natural key (supplier
code, invoice number, asset name, contract number, title) before it is written.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, timedelta

# ── the wire ────────────────────────────────────────────────────────────────


RELAY = "/api/v1/store/central/"


class Shop:
    """Head office, asked from the shop's till: `/api/v1/x` goes to the store
    node as `/api/v1/store/central/x` and is relayed for whoever is signed in
    there — the path the store app's /ga pages take."""

    relay = True

    def __init__(self, node):
        self.base, self.token, self.name = node.base, getattr(node, "token", None), f"{node.name} (relay)"


def req(node, method, path, body=None, raw=None, content_type=None):
    """(status, payload). The stage's own caller so a refusal can be read
    rather than end the run, and so raw bytes can be uploaded. Carries the
    node's bearer when it acts as somebody (sign-in on)."""
    if getattr(node, "relay", False) and path.startswith("/api/v1/"):
        path = RELAY + path[len("/api/v1/"):]
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    request = urllib.request.Request(node.base + path, data=data, method=method)
    if data is not None:
        request.add_header("content-type", content_type or "application/json")
    if getattr(node, "token", None):
        request.add_header("Authorization", f"Bearer {node.token}")
    if method != "GET":
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(payload)
        except json.JSONDecodeError:
            return error.code, payload[:300]


REFUSED: list[str] = []


def do(node, label, method, path, body=None, quiet_conflict=True):
    status, answer = req(node, method, path, body)
    if status in (200, 201, 204):
        print(f"  + {label}")
        return answer
    if status == 409 and quiet_conflict:
        print(f"  = {label} ({_msg(answer)})")
        return None
    print(f"  ! {label}: {status} {_msg(answer)}")
    REFUSED.append(f"{label}: {status} {_msg(answer)}")
    return None


def _msg(answer):
    if isinstance(answer, dict):
        return answer.get("error") or answer.get("message") or json.dumps(answer)[:200]
    return str(answer)[:200]


def get(node, path):
    status, answer = req(node, "GET", path)
    if status != 200:
        raise SystemExit(f"GET {path} → {status}: {_msg(answer)}")
    return answer


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("rows", "items", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


# ── the calendar ────────────────────────────────────────────────────────────

TODAY = date(2026, 9, 26)


def D(days):
    return (TODAY + timedelta(days=days)).isoformat()


# ── who ─────────────────────────────────────────────────────────────────────
# The demo's people: Rina Kusuma (HR/GA manager, the `development` principal),
# Nina Oktaviani and Yusuf Ramadhan at head office / DC, Maya Anggraini (store
# manager) and Dian Pertiwi (cashier) at store-01.

RINA, NINA, YUSUF, MAYA, DIAN = (
    "Rina Kusuma", "Nina Oktaviani", "Yusuf Ramadhan", "Maya Anggraini", "Dian Pertiwi")


class Who:
    """The nodes each person acts through. With sign-in off every one of them
    is the plain Cloud node (`development`) and `two_people` is False."""

    def __init__(self, cloud, ctx):
        as_user = ctx.get("as_user")
        self.two_people = bool(ctx.get("password")) and as_user is not None
        if self.two_people:
            self.rina = as_user("cloud", "rina")
            self.maya = as_user("cloud", "maya")
            self.maya_shop = Shop(as_user("store", "maya"))
            self.nina = as_user("cloud", "nina")
        else:
            self.rina = self.maya = self.maya_shop = self.nina = cloud


WHO: Who | None = None

# ── the data ────────────────────────────────────────────────────────────────

SUPPLIERS = [
    # code, name, contact, phone, email, address
    ("KENCANA-GA", "Kencana Komputer", "Steven Halim", "022-423-8810", "sales@kencanakomputer.id",
     "Bandung Electronic Center Lt. 2 No. 45"),
    ("SEJUK-GA", "CV Sejuk Teknik Mandiri", "Joko Susilo", "0813-2100-4411", "servis@sejukteknik.co.id",
     "Jl. Soekarno-Hatta 512, Bandung"),
    ("KARYA-GA", "CV Karya Bangun Renovasi", "Ir. Budi Santosa", "0811-2233-5566", "proyek@karyabangun.co.id",
     "Jl. Cibaduyut 90, Bandung"),
    ("AUTO-GA", "PT Auto Mandiri Bekasi", "Heru Gunawan", "021-8250-6677", "fleet@automandiri.co.id",
     "Jl. Kalimalang 88, Bekasi"),
    ("BERSIH-GA", "PT Bersih Prima Jasa", "Wati Susanti", "021-8990-1200", "ops@bersihprima.co.id",
     "Jl. Jababeka Raya Blok B-2, Cikarang"),
    ("PLN-GA", "PT PLN (Persero) UP3 Bekasi", "Layanan Pelanggan", "123", None, "Jl. Ir. H. Juanda 1, Bekasi"),
    ("PDAM-GA", "PDAM Tirta Bhagasasi", "Layanan Pelanggan", "021-8837-0100", None, "Jl. KH. Noer Ali 1, Bekasi"),
    ("REJEKI-GA", "Toko Sumber Rejeki ATK", "Liong", "022-731-2200", None, "Jl. Otto Iskandardinata 300, Bandung"),
]

LOCATIONS = {
    "dc": dict(address="Jl. Industri Raya Blok C-7, Cikarang Barat, Bekasi", kind="Kantor pusat & DC",
               floor_area_sqm=2600, contact_name=NINA, contact_phone="0811-8800-2201",
               notes="Gudang buka 07.00–21.00; bongkar muat lewat gerbang 2"),
    "store-01": dict(address="Jl. Dago No. 118, Bandung", kind="Toko ruko", floor_area_sqm=220,
                     contact_name=MAYA, contact_phone="0812-2200-1101",
                     notes="Bongkar barang pagi sebelum 09.00, parkir depan sempit"),
}


def tech(make, capacity=None, install=None, warranty=None):
    return {k: v for k, v in dict(make=make, capacity=capacity, install=install, warranty=warranty).items() if v}


def it(device, make=None, spec=None, host=None, warranty=None):
    return {k: v for k, v in dict(device=device, make=make, spec=spec, host=host, warranty=warranty).items() if v}


# What Finance bought this month. Each line mints one DRAFT asset when the bill
# posts; the `ga` part is what GA fills in on the register afterwards, the
# `fin` part is Finance's assessment. Cost / life is exact for every line.
#   (class, cost account, site, amount, name, ga, fin)
BILLS = [
    dict(supplier="KENCANA-GA", number="INV/KK/2026/0911", date="2026-09-02", site="dc", lines=[
        ("FFE_KOMPUTER", "1075", "dc", 14_400_000, "Laptop GA — Lenovo ThinkPad E14",
         dict(holder=NINA, condition="BAIK", serial_number="PF4K2M9X",
              specs=it("Laptop", "Lenovo ThinkPad E14 Gen 5", "i5-1335U / 16GB / 512GB", "HO-GA-01", "2029-09-02")),
         dict(life=48, kind="DEPRECIATION")),
        ("FFE_KOMPUTER", "1075", "store-01", 7_200_000, "Laptop kasir toko 01 — HP 240 G9",
         dict(holder=DIAN, condition="BAIK", serial_number="HP240G9-0101",
              specs=it("Laptop", "HP 240 G9", "i3 / 8GB / 256GB", "ST01-LAP1", "2027-09-02")),
         dict(life=48, kind="DEPRECIATION")),
        ("SEVENTH_SOFT_APPLICATION", "1104", "dc", 36_000_000, "Lisensi POS Seventh Soft — 2 outlet",
         dict(condition="BAIK", serial_number="7S-RTL-02", specs={}),
         dict(life=48, kind="AMORTISATION")),
        ("FFE_MUSIC", "1076", "store-01", 6_000_000, "Sound system toko 01 — TOA ZA-2120",
         dict(condition="BAIK", specs={"make": "TOA ZA-2120 + 6 speaker plafon", "power": "120 W"}),
         dict(life=48, kind="DEPRECIATION")),
    ]),
    dict(supplier="SEJUK-GA", number="INV/STM/2026/0905", date="2026-09-05", site="store-01", lines=[
        ("AIR_CONDITIONER", "1067", "store-01", 12_000_000, "AC split toko 01 — Daikin 2 PK",
         dict(condition="BAIK", serial_number="DKN-FTKC50-0101",
              specs=tech("Daikin FTKC50", "2 PK", "2026-09-06", "2028-09-06")),
         dict(life=96, kind="DEPRECIATION")),
    ]),
    dict(supplier="AUTO-GA", number="INV/AMB/2026/0903", date="2026-09-03", site="dc", lines=[
        ("MOBIL", "1071", "dc", 240_000_000, "Mobil box pengiriman — Mitsubishi L300",
         dict(holder=YUSUF, condition="BAIK",
              specs={"make": "Mitsubishi L300 Box", "plate": "B 9412 KXT", "year": "2026", "odo": "120",
                     "chassis": "MMBJNKB40SD012345", "engine": "4N14-123456"}),
         dict(life=96, kind="DEPRECIATION")),
    ]),
    dict(supplier="KARYA-GA", number="INV/KBR/2026/0908", date="2026-09-08", site="dc", lines=[
        ("FFE_OFFICE", "1073", "dc", 9_600_000, "Meja kerja staf HO (8 unit)",
         dict(condition="BAIK", specs={"type": "Meja kerja", "material": "Particle board", "dim": "120x60 cm"}),
         dict(life=48, kind="DEPRECIATION")),
        ("BANGUNAN_TAMBAHAN", "1064", "dc", 60_000_000, "Mezzanine gudang DC",
         dict(condition="BAIK", specs={"area": "180 m2", "floors": "1", "use": "Rak stok musiman"}),
         dict(life=240, kind="DEPRECIATION")),
        ("CONTRACT_IN_PROGRESS", "1113", "store-01", 45_000_000, "Renovasi fasad toko 01 (termin 1)",
         dict(condition="BAIK", specs={}),
         dict(in_progress=True)),
    ]),
]

# What the company owned before this system: on GA's register, never bought
# through these books (so Finance has no cost to assess for them).
#   (number, name, class, site, sub-location, holder, condition, serial, acquired, specs, quantity)
LEGACY = [
    ("AST-GA-001", "Tanah kantor pusat & DC", "TANAH_HAK_MILIK", "dc", None, None, "BAIK", None, "2017-11-20",
     {"cert": "SHM No. 1182/Cikarang Barat", "area": "2.400 m2"}, None),
    ("AST-GA-002", "AC split toko 01 (lama)", "AIR_CONDITIONER", "store-01", "Ruang stok", None, "PERLU_SERVIS",
     "SAM-AR18-0101", "2017-03-01", tech("Samsung AR18", "2 PK", "2017-03-03"), None),
    ("AST-GA-003", "Rak dinding display toko 01", "OE_RAK_2", "store-01", "Dinding kiri & kanan", None, "BAIK",
     None, "2022-04-01", {"material": "Besi + kayu", "dim": "120x40x200 cm", "area": "Dinding", "repl": "ya"}, 12),
    ("AST-GA-004", "Printer struk lama toko 01", "FFE_KOMPUTER", "store-01", "Gudang toko", None, "RUSAK",
     "EPS-U220-0101", "2016-06-01", it("Printer struk", "Epson TM-U220"), None),
]

CONTRACTS = [
    dict(contract_number="SW/ST01/2024-10", contract_type="SEWA_TOKO", counterparty_name="Hj. Siti Aminah",
         site_id="store-01", starts_on="2024-10-01", ends_on="2027-09-30", contract_value_minor=450_000_000,
         is_signed=True, signed_by="Direktur Operasional", reminder_days=120,
         notes="Sewa ruko 2 lantai, dibayar per tahun di muka"),
    dict(contract_number="CL/DC/2026-01", contract_type="JASA_CLEANING", supplier="BERSIH-GA", site_id="dc",
         starts_on="2026-01-01", ends_on="2026-12-31", contract_value_minor=96_000_000, is_signed=True,
         signed_by=RINA, reminder_days=45, notes="4 cleaner shift pagi di DC & kantor"),
    dict(contract_number="CL/ST01/2026-03", contract_type="JASA_CLEANING", supplier="BERSIH-GA", site_id="store-01",
         starts_on="2026-03-01", ends_on="2027-02-28", contract_value_minor=36_000_000, is_signed=True,
         signed_by=RINA, reminder_days=45, notes="1 cleaner harian toko 01"),
    dict(contract_number="PLN/ST01/512300118801", contract_type="LANGGANAN_LISTRIK", supplier="PLN-GA",
         site_id="store-01", starts_on="2024-10-01", customer_number="512300118801", is_signed=True,
         reminder_days=30, notes="B2 / 23.000 VA",
         meter=("kWh", 84_220, [("2026-07-01", 5_940), ("2026-08-01", 6_120)])),
    dict(contract_number="PDAM/ST01/0412118801", contract_type="LANGGANAN_AIR", supplier="PDAM-GA",
         site_id="store-01", starts_on="2024-10-01", customer_number="0412-118801", is_signed=True,
         reminder_days=30, meter=("m³", 1_420, [("2026-07-01", 31), ("2026-08-01", 34)])),
    dict(contract_number="PLN/DC/512300004417", contract_type="LANGGANAN_LISTRIK", supplier="PLN-GA",
         site_id="dc", starts_on="2018-03-01", customer_number="512300004417", is_signed=True,
         reminder_days=30, notes="B3 / 197 kVA",
         meter=("kWh", 1_082_400, [("2026-07-01", 31_200), ("2026-08-01", 32_950)])),
    dict(contract_number="MT/AC/2026-01", contract_type="JASA_MAINTENANCE", objek="AC", supplier="SEJUK-GA",
         site_id="store-01", starts_on="2026-01-01", ends_on="2026-12-31", contract_value_minor=7_200_000,
         is_signed=True, signed_by=RINA, reminder_days=60, notes="Servis AC 3 bulanan toko 01, termasuk isi freon ringan"),
]

SUPPLIES = [
    # site, requester, category, item, quantity, needed (days), estimate, target, PO
    ("store-01", MAYA, "TOKO_KANTOR", "Kantong belanja kertas ukuran M", "1.000 pcs", -2, 1_700_000, "RECEIVED",
     "PO-GA/2026/09/004"),
    ("store-01", MAYA, "ATK", "Kertas struk thermal 80mm", "30 roll", 6, 450_000, "APPROVED", None),
    ("dc", NINA, "ATK", "Toner printer HP 76A", "2 pcs", 14, 1_800_000, "REQUESTED", None),
]
SUPPLY_FLOW = ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED"]


# ── helpers ─────────────────────────────────────────────────────────────────


def tiny_pdf(lines):
    """A one-page PDF so a filed paper previews as a page (seed-ga-review's)."""
    def esc(text):
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = "BT /F1 14 Tf 60 780 Td 20 TL " + " ".join(f"({esc(l)}) Tj T*" for l in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    ]
    out, offsets = "%PDF-1.4\n", []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out.encode()))
        out += f"{n} 0 obj\n{body}\nendobj\n"
    xref = len(out.encode())
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


def paragraph(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


# ── the writers ─────────────────────────────────────────────────────────────


def seed_vendors(cloud):
    print("vendors (EXPENSE book)")
    have = {r["supplier_code"]: r for r in rows(get(cloud, "/api/v1/suppliers?limit=500&category=EXPENSE"))}
    have.update({r["supplier_code"]: r for r in rows(get(cloud, "/api/v1/suppliers?limit=500"))})
    for code, name, contact, phone, email, address in SUPPLIERS:
        if code in have:
            print(f"  = {code} {name}")
            continue
        row = do(cloud, f"{code} {name}", "POST", "/api/v1/suppliers", {
            "supplier_code": code, "name": name, "contact_name": contact, "phone": phone, "email": email,
            "address": address, "status": "ACTIVE", "category": "EXPENSE", "is_pkp": False,
            "default_payment_terms_code": "NET_30"})
        if row:
            have[code] = row
    return {code: row["supplier_id"] for code, row in have.items()}


def seed_locations(cloud):
    print("locations")
    have = {r["site_id"]: r for r in get(cloud, "/api/v1/ga/locations")}
    for site, detail in LOCATIONS.items():
        if have.get(site, {}).get("address"):
            print(f"  = {site} detail")
            continue
        do(cloud, f"{site} detail", "PATCH", f"/api/v1/ga/locations/{site}", detail)


def seed_purchases(cloud, suppliers):
    """Finance records and posts the capital bills; the posting mints drafts."""
    print("capital purchases (Finance: EXPENSE bills, posted)")
    existing = {r["invoice_number"]: r for r in rows(get(cloud, "/api/v1/finance/bills?limit=500"))}
    for bill in BILLS:
        number = bill["number"]
        row = existing.get(number)
        if row is None:
            subtotal = sum(line[3] for line in bill["lines"])
            row = do(cloud, f"bill {number} Rp {subtotal:,}", "POST", "/api/v1/finance/bills", {
                "invoice_number": number, "supplier_id": suppliers[bill["supplier"]], "supplier_name": None,
                "site_id": bill["site"], "invoice_date": bill["date"],
                "due_date": (date.fromisoformat(bill["date"]) + timedelta(days=30)).isoformat(),
                "subtotal_minor": subtotal, "tax_minor": 0, "discount_minor": 0,
                "note": "Pembelian aset — diajukan GA", "kind": "EXPENSE",
                "lines": [{"account_code": acct, "site_id": site, "amount_minor": amount,
                           "asset_class_code": klass, "memo": name}
                          for klass, acct, site, amount, name, _ga, _fin in bill["lines"]],
            })
            if row is None:
                continue
        else:
            print(f"  = bill {number}")
        if row.get("status") not in ("POSTED", "PAID", "PARTIALLY_PAID"):
            do(cloud, f"post {number}", "POST", f"/api/v1/finance/bills/{row['invoice_id']}/post", {})


def ga_assets(cloud):
    return {r["name"]: r for r in rows(get(cloud, "/api/v1/ga/assets?limit=1000"))}


def seed_register(cloud):
    print("register (GA completes the drafts, registers what was already owned)")
    by_name = ga_assets(cloud)
    for bill in BILLS:
        for klass, _acct, site, _amount, name, ga, _fin in bill["lines"]:
            row = by_name.get(name)
            if row is None:
                REFUSED.append(f"draft for '{name}' was not minted by {bill['number']}")
                print(f"  ! no draft for {name}")
                continue
            if row.get("holder") == ga.get("holder") and row.get("specs") == ga.get("specs") and \
                    row.get("serial_number") == ga.get("serial_number"):
                print(f"  = {row['asset_number']} {name}")
                continue
            patch = {"condition": ga["condition"], "specs": ga["specs"],
                     "serial_number": ga.get("serial_number"), "holder": ga.get("holder")}
            do(cloud, f"{row['asset_number']} {name} completed", "PATCH", f"/api/v1/ga/assets/{row['asset_id']}", patch)
    for number, name, klass, site, sub, holder, condition, serial, acquired, specs, quantity in LEGACY:
        if name in by_name:
            print(f"  = {number} {name}")
            continue
        do(cloud, f"{number} {name}", "POST", "/api/v1/ga/assets", {
            "asset_number": number, "name": name, "class_code": klass, "site_id": site, "sub_location": sub,
            "holder": holder, "condition": condition, "serial_number": serial, "acquired_on": acquired,
            "specs": specs, "notes": "Aset sebelum sistem ini; tercatat di register GA", "quantity": quantity})
    by_name = ga_assets(cloud)
    # Where the new AC hangs, said by the one act that moves a thing.
    ac = by_name.get("AC split toko 01 — Daikin 2 PK")
    if ac and not ac.get("sub_location"):
        do(cloud, "AC toko 01 → area penjualan", "POST", f"/api/v1/ga/assets/{ac['asset_id']}/transfer", {
            "to_site": "store-01", "to_sub_location": "Area penjualan", "to_holder": None,
            "reason": "Dipasang di area penjualan oleh CV Sejuk Teknik", "occurred_on": "2026-09-06"})
    car = by_name.get("Mobil box pengiriman — Mitsubishi L300")
    if car:
        hub = get(cloud, f"/api/v1/ga/assets/{car['asset_id']}")
        note = "STNK & plat nomor diterima dari dealer; unit masuk pool kendaraan DC"
        if not any(e.get("reason") == note for e in hub.get("events", [])):
            do(cloud, "note on the delivery van", "POST", f"/api/v1/ga/assets/{car['asset_id']}/notes",
               {"reason": note, "occurred_on": "2026-09-10"})
    return ga_assets(cloud)


def seed_assessment(cloud):
    print("assessment (Finance capitalises what the bills bought)")
    fin = {r["name"]: r for r in rows(get(cloud, "/api/v1/finance/assets?limit=1000"))}
    for bill in BILLS:
        for klass, _acct, site, amount, name, _ga, basis in bill["lines"]:
            row = fin.get(name)
            if row is None:
                continue
            if row.get("decision"):
                print(f"  = {row['asset_number']} {name} ({row['decision']})")
                continue
            if basis.get("in_progress"):
                body = {"decision": "IN_PROGRESS", "capitalized_cost_minor": amount, "salvage_value_minor": None,
                        "useful_life_months": None, "method": None, "charge_kind": None, "in_service_on": None,
                        "reason": f"Termin 1 renovasi fasad, {bill['number']}; selesai perkiraan Nov 2026"}
            else:
                body = {"decision": "CAPITALIZE", "capitalized_cost_minor": amount, "salvage_value_minor": 0,
                        "useful_life_months": basis["life"], "method": "STRAIGHT_LINE",
                        "charge_kind": basis["kind"], "in_service_on": bill["date"],
                        "reason": f"Dibeli lewat {bill['number']}; umur {basis['life']} bulan sesuai kebijakan kelas"}
            do(cloud, f"{row['asset_number']} {name} → {body['decision']}", "POST",
               f"/api/v1/finance/assets/{row['asset_id']}/assess", body)


def seed_month_end(cloud):
    print("month end Sep 2026 (depreciation + amortisation, replacement reserve)")
    status = get(cloud, "/api/v1/finance/assets/depreciation/status?period=2026-09")
    run = do(cloud, "depreciation run 2026-09", "POST", "/api/v1/finance/assets/depreciation/run?period=2026-09", {})
    if run:
        print(f"    posted {run.get('posted_count')} · skipped {run.get('skipped_count')} · "
              f"Rp {run.get('posted_total_minor', 0):,}")
    else:
        print(f"    status before: {json.dumps(status)[:200]}")

    # The store's display racks are operating equipment: not capitalised, a
    # monthly reserve against replacing them instead (0139).
    rates = rows(get(cloud, "/api/v1/finance/assets/reserve/rates?site=store-01&class=OE_RAK_2"))
    if rates:
        print("  = reserve rate OE_RAK_2 @ store-01")
    else:
        do(cloud, "reserve rate OE_RAK_2 @ store-01 Rp 250,000/bln", "POST", "/api/v1/finance/assets/reserve/rates", {
            "class_code": "OE_RAK_2", "site_id": "store-01", "effective_from": "2026-09-01",
            "monthly_charge_minor": 250_000, "note": "12 rak dinding, ganti tiap 4 tahun"})
    reserve = get(cloud, "/api/v1/finance/assets/reserve/status?period=2026-09")
    if json.dumps(reserve).find('"posted"') >= 0 and _reserve_done(reserve):
        print("  = reserve run 2026-09")
    else:
        do(cloud, "reserve run 2026-09", "POST", "/api/v1/finance/assets/reserve/run?period=2026-09", {})


def _reserve_done(status):
    for key in ("posted_count", "charged_count", "posted"):
        value = status.get(key) if isinstance(status, dict) else None
        if isinstance(value, int) and value > 0:
            return True
    return False


LAPTOP = "Laptop kasir toko 01 — HP 240 G9"
LAPTOP_LOST_ON = "2026-09-25"
LAPTOP_REASON = "Laptop kasir hilang dari toko 01 tgl 24/09; laporan polisi LP/B/412/IX/2026"


def seed_write_off(cloud):
    """The stolen laptop. Signed in: Maya asks GA to let it go (LOST), Rina
    approves, Finance books the write-off (the only journal: cost and
    accumulated depreciation out, the loss named), and closes the request.
    Signed out: Finance's own dispose route alone, as before."""
    print("disposal (the shop's stolen laptop: GA request → approval → Finance write-off)")
    who = WHO or Who(cloud, {})
    fin = {r["name"]: r for r in rows(get(cloud, "/api/v1/finance/assets?limit=1000"))}
    row = fin.get(LAPTOP)
    if row is None:
        return
    number = row["asset_number"]

    def book():
        return do(who.rina, f"{number} written off by Finance (hilang, laporan polisi)", "POST",
                  f"/api/v1/finance/assets/{row['asset_id']}/dispose", {
                      "disposed_on": LAPTOP_LOST_ON, "proceeds_minor": 0, "method": "WRITTEN_OFF",
                      "memo": LAPTOP_REASON})

    if not who.two_people:
        if row.get("disposed_on"):
            print(f"  = {number} written off {row['disposed_on']}")
        else:
            book()
        return

    request = next((d for d in rows(get(cloud, "/api/v1/ga/disposals?limit=1000"))
                    if d.get("reason") == LAPTOP_REASON), None)
    if request is None:
        if row.get("disposed_on"):
            # Written off before there was a second person to ask (a signed-out
            # run): the books are right, and a request for a thing already
            # gone would be refused.
            print(f"  = {number} written off {row['disposed_on']} (without a GA request)")
            return
        request = do(who.maya, f"{number} disposal requested by maya (LOST)", "POST", "/api/v1/ga/disposals", {
            "asset_id": row["asset_id"], "method": "LOST", "proceeds_minor": None,
            "reason": LAPTOP_REASON, "requested_on": LAPTOP_LOST_ON})
        if request is None:
            return
    else:
        print(f"  = {number} disposal request ({request['status']})")
    if request["status"] == "REQUESTED":
        request = do(who.rina, f"{number} disposal approved by rina", "POST",
                     f"/api/v1/ga/disposals/{request['disposal_id']}/decide",
                     {"approve": True, "note": "Laporan polisi terlampir; hapus buku, tanpa hasil"}) or request
    if request["status"] != "APPROVED":
        return
    if row.get("disposed_on"):
        print(f"  = {number} written off {row['disposed_on']}")
    elif book() is None:
        return
    do(who.rina, f"{number} disposal closed → POSTED", "POST",
       f"/api/v1/ga/disposals/{request['disposal_id']}/close", {})


def seed_contracts(cloud, suppliers):
    print("contracts")
    have = {r["contract_number"]: r for r in rows(get(cloud, "/api/v1/ga/contracts?limit=1000")) if r["contract_number"]}
    for spec in CONTRACTS:
        spec = dict(spec)
        meter = spec.pop("meter", None)
        supplier = spec.pop("supplier", None)
        if supplier:
            spec["supplier_id"] = suppliers.get(supplier)
        number = spec["contract_number"]
        row = have.get(number)
        if row is None:
            row = do(cloud, number, "POST", "/api/v1/ga/contracts", spec)
            if row is None:
                continue
        else:
            print(f"  = {number}")
        if row["status"] == "DRAFT":
            row = do(cloud, f"{number} → ACTIVE", "PATCH", f"/api/v1/ga/contracts/{row['contract_id']}",
                     {"status": "ACTIVE"}) or row
        have[number] = row
        if meter:
            unit, reading, months = meter
            done = {r["period"] for r in get(cloud, f"/api/v1/ga/contracts/{row['contract_id']}/meter-readings")}
            for period, usage in months:
                opening, closing = reading, reading + usage
                reading = closing
                if period in done:
                    print(f"  = {number} {period[:7]}")
                    continue
                first = date.fromisoformat(period)
                read_on = (date(first.year + first.month // 12, first.month % 12 + 1, 2)).isoformat()
                do(cloud, f"{number} {period[:7]} {usage} {unit}", "POST",
                   f"/api/v1/ga/contracts/{row['contract_id']}/meter-readings",
                   {"period": period, "unit": unit, "opening": opening, "closing": closing, "read_on": read_on})
    return {n: r["contract_id"] for n, r in have.items()}


def seed_upkeep(cloud, assets, contracts, suppliers):
    print("service schedule")
    tasks = {r["title"]: r for r in rows(get(cloud, "/api/v1/ga/maintenance-tasks?limit=1000"))}
    ac_new = assets.get("AC split toko 01 — Daikin 2 PK")
    car = assets.get("Mobil box pengiriman — Mitsubishi L300")
    for title, asset, site, kind, value, due, contract, supplier, notes in [
        ("Servis AC berkala — Toko 01", ac_new, None, "MONTHS", 3, D(71), "MT/AC/2026-01", "SEJUK-GA",
         "Cuci indoor + outdoor, cek freon"),
        ("Servis mobil box tiap 10.000 km", car, None, "KM", 10_000, None, None, None, "Servis pertama di km 1.000"),
        ("Cek APAR — Toko 01", None, "store-01", "MONTHS", 6, D(-5), None, None, "Cek tekanan & tanggal isi ulang APAR"),
    ]:
        if title in tasks:
            print(f"  = {title}")
            continue
        row = do(cloud, title, "POST", "/api/v1/ga/maintenance-tasks", {
            "asset_id": asset["asset_id"] if asset else None, "site_id": site, "title": title,
            "interval_kind": kind, "interval_value": value, "next_due": due,
            "contract_id": contracts.get(contract) if contract else None,
            "supplier_id": suppliers.get(supplier) if supplier else None, "notes": notes})
        if row:
            tasks[title] = row

    print("inspection, repair, replacement, disposal request")
    who = WHO or Who(cloud, {})
    old_ac = assets.get("AC split toko 01 (lama)")
    findings = "Kompresor bunyi keras, hembusan tidak dingin; freon bocor di sambungan"
    inspection = None
    if old_ac:
        have = [r for r in rows(get(cloud, "/api/v1/ga/inspections?limit=1000")) if r.get("findings") == findings]
        inspection = have[0] if have else do(who.maya, "inspection AC lama toko 01 RUSAK (maya)", "POST",
                                             "/api/v1/ga/inspections", {
            "asset_id": old_ac["asset_id"], "inspected_on": D(-4), "inspected_by": MAYA, "result": "RUSAK",
            "findings": findings, "task_id": None})
    rack = assets.get("Rak dinding display toko 01")
    if rack:
        ok = "Semua rak kokoh, baut dinding aman"
        if not any(r.get("findings") == ok for r in rows(get(cloud, "/api/v1/ga/inspections?limit=1000"))):
            do(who.maya, "inspection rak toko 01 BAIK (maya)", "POST", "/api/v1/ga/inspections", {
                "asset_id": rack["asset_id"], "inspected_on": D(-12), "inspected_by": MAYA, "result": "BAIK",
                "findings": ok, "task_id": None})

    # The old AC's breakdown is filed from the shop's till (the store app's
    # /ga/repairs), and its budget approved at head office by somebody else.
    repairs = {r["title"]: r for r in rows(get(cloud, "/api/v1/ga/repairs?limit=1000"))}
    repair = repairs.get("AC lama ruang stok toko 01 tidak dingin")
    if repair is None and old_ac:
        repair = do(who.maya_shop, "repair AC lama toko 01 filed by maya at the till (OPEN)", "POST",
                    "/api/v1/ga/repairs", {
            "site_id": "store-01", "asset_id": old_ac["asset_id"], "objek": None,
            "title": "AC lama ruang stok toko 01 tidak dingin", "supplier_id": suppliers.get("SEJUK-GA"),
            "estimated_cost_minor": 1_750_000, "failure_at": D(-4),
            "inspection_id": inspection["inspection_id"] if inspection else None,
            "notes": "Estimasi CV Sejuk: tambal pipa + isi freon"})
    elif repair:
        print(f"  = repair AC lama toko 01 ({repair['status']})")
    if repair and who.two_people:
        if repair["status"] == "OPEN":
            repair = do(who.rina, "repair AC lama toko 01 budget Rp 1,750,000 approved by rina (APPROVED)",
                        "POST", f"/api/v1/ga/repairs/{repair['repair_id']}/approve-budget",
                        {"approved_budget_minor": 1_750_000}) or repair
        if repair["status"] == "APPROVED":
            repair = do(who.rina, "repair AC lama toko 01 → IN_PROGRESS", "POST",
                        f"/api/v1/ga/repairs/{repair['repair_id']}/move",
                        {"to": "IN_PROGRESS", "note": "CV Sejuk tambal pipa + isi freon sambil menunggu unit baru"}) \
                or repair
    if "Rolling door gudang DC macet" not in repairs:
        do(who.nina, "repair rolling door DC raised by nina (OPEN, menunggu persetujuan)", "POST", "/api/v1/ga/repairs", {
            "site_id": "dc", "asset_id": None, "objek": "BANGUNAN", "title": "Rolling door gudang DC macet",
            "supplier_id": suppliers.get("KARYA-GA"), "estimated_cost_minor": 1_200_000, "failure_at": D(-2),
            "inspection_id": None, "notes": "Pintu gerbang 2 tersangkut di tengah; bongkar muat lewat gerbang 1"})
    else:
        print(f"  = repair rolling door DC ({repairs['Rolling door gudang DC macet']['status']})")

    replacement_reason = "AC toko 01 umur 9 tahun, freon bocor berulang — lebih murah ganti unit inverter"
    replacement = next((r for r in rows(get(cloud, "/api/v1/ga/replacements?limit=1000"))
                        if r.get("reason") == replacement_reason), None)
    if replacement is None and old_ac:
        replacement = do(who.maya, "replacement AC lama toko 01 proposed by maya (PROPOSED)", "POST",
                         "/api/v1/ga/replacements", {
            "old_asset_id": old_ac["asset_id"], "repair_id": repair["repair_id"] if repair else None,
            "reason": replacement_reason, "supplier_id": suppliers.get("SEJUK-GA"), "proposed_on": D(-3)})
    elif replacement:
        print(f"  = replacement AC lama toko 01 ({replacement['status']})")
    if replacement and who.two_people and replacement["status"] == "PROPOSED":
        do(who.rina, "replacement AC lama toko 01 approved by rina (APPROVED)", "POST",
           f"/api/v1/ga/replacements/{replacement['replacement_id']}/move", {"to": "APPROVED", "new_asset_id": None})

    # Never capitalised (on GA's register only), so once approved there is no
    # cost for Finance to book: it waits at APPROVED for the scrap man.
    printer = assets.get("Printer struk lama toko 01")
    disposal_reason = "Printer dot-matrix tidak dipakai sejak POS baru, suku cadang habis"
    disposal = next((r for r in rows(get(cloud, "/api/v1/ga/disposals?limit=1000"))
                     if r.get("reason") == disposal_reason), None)
    if disposal is None and printer:
        disposal = do(who.maya, "disposal request printer lama toko 01 by maya (REQUESTED)", "POST",
                      "/api/v1/ga/disposals", {
            "asset_id": printer["asset_id"], "method": "SCRAPPED", "proceeds_minor": None,
            "reason": disposal_reason, "requested_on": D(-1)})
    elif disposal:
        print(f"  = disposal printer lama toko 01 ({disposal['status']})")
    if disposal and who.two_people and disposal["status"] == "REQUESTED":
        do(who.rina, "disposal printer lama toko 01 approved by rina (APPROVED)", "POST",
           f"/api/v1/ga/disposals/{disposal['disposal_id']}/decide",
           {"approve": True, "note": "Tidak tercatat di buku aset; serahkan ke pengepul besi"})


def seed_supplies(cloud):
    print("supplies")
    have = {(r["site_id"], r["item"]): r for r in rows(get(cloud, "/api/v1/ga/supplies?limit=1000"))}
    people = WHO or Who(cloud, {})
    # The shop files its own asks from the till; head office's are Nina's.
    # Rina moves every one of them up the ladder.
    askers = {MAYA: (people.maya_shop, "maya at the till"), NINA: (people.nina, "nina")}
    for site, who, category, item, quantity, needed, estimate, target, po in SUPPLIES:
        row = have.get((site, item))
        if row is None:
            asker, label = askers.get(who, (people.rina, "rina"))
            row = do(asker, f"{item} [{site}] filed by {label}", "POST", "/api/v1/ga/supplies", {
                "site_id": site, "requested_by": who, "category_code": category, "item": item,
                "quantity": quantity, "needed_by": D(needed), "estimated_cost_minor": estimate, "notes": None})
            if row is None:
                continue
        else:
            print(f"  = {item} [{site}]")
        while row["status"] in SUPPLY_FLOW and SUPPLY_FLOW.index(row["status"]) < SUPPLY_FLOW.index(target):
            nxt = SUPPLY_FLOW[SUPPLY_FLOW.index(row["status"]) + 1]
            moved = do(people.rina, f"{item} → {nxt}", "POST", f"/api/v1/ga/supplies/{row['request_id']}/move",
                       {"to": nxt, "po_reference": po if nxt == "ORDERED" else None})
            if moved is None:
                break
            row = moved


def seed_letters(cloud):
    print("letters")
    title_line = "Pemberitahuan jadwal servis AC toko 01"
    letters = rows(get(cloud, "/api/v1/letters?kind=GENERAL"))
    # The list row carries the letter's facts flat (`reference` at the top).
    letter = next((l for l in letters if title_line in json.dumps(l.get("body") or l.get("facts") or {})
                   or l.get("reference") == "GA/ST01/IX/2026"
                   or (l.get("facts") or {}).get("reference") == "GA/ST01/IX/2026"), None)
    if letter is None:
        drafted = do(cloud, "draft GENERAL letter", "POST", "/api/v1/letters",
                     {"kind": "GENERAL", "subject_id": "", "template_id": None})
        if drafted is None:
            return
        letter_id = drafted.get("letter_id") or drafted.get("letter", {}).get("letter_id")
        body = {"type": "doc", "content": [
            paragraph(title_line),
            paragraph("Dengan hormat, bersama ini kami sampaikan bahwa servis berkala AC toko 01 oleh "
                      "CV Sejuk Teknik Mandiri dijadwalkan pada 6 Desember 2026 pukul 07.00–09.00, "
                      "sebelum toko buka."),
            paragraph("Mohon kepala toko menyiapkan akses ke ruang stok dan area penjualan. "
                      "Atas perhatiannya kami ucapkan terima kasih."),
        ]}
        do(cloud, "letter content", "PATCH", f"/api/v1/letters/{letter_id}", {
            "body": body, "facts": {"reference": "GA/ST01/IX/2026", "counterparty": f"{MAYA} — Kepala Toko 01",
                                    "place": "Bekasi"}})
        do(cloud, "issue letter", "POST", f"/api/v1/letters/{letter_id}/issue", {})
    else:
        letter_id = letter["letter_id"]
        print("  = GENERAL letter")
    templates = rows(get(cloud, "/api/v1/letters/templates?kind=GENERAL"))
    if any(t.get("name") == "Pemberitahuan jadwal servis" for t in templates):
        print("  = template")
    else:
        do(cloud, "template 'Pemberitahuan jadwal servis'", "POST", "/api/v1/letters/templates",
           {"kind": "GENERAL", "name": "Pemberitahuan jadwal servis", "from_letter": letter_id})


def seed_papers(cloud, assets, contracts):
    print("papers (library)")
    papers = [
        ("asset", (assets.get("Mobil box pengiriman — Mitsubishi L300") or {}).get("asset_id"), "STNK", "B 9412 KXT",
         "STNK Mitsubishi L300 Box", "Samsat Kab. Bekasi", "2026-09-10", "2031-09-10", ["GA", "Aset"]),
        ("contract", contracts.get("CL/DC/2026-01"), "Kontrak", "CL/DC/2026-01",
         "Kontrak jasa cleaning DC 2026", "PT Bersih Prima Jasa", "2025-12-20", "2026-12-31", ["GA", "Legal"]),
        ("contract", contracts.get("SW/ST01/2024-10"), "Kontrak", "SW/ST01/2024-10",
         "Perjanjian sewa ruko toko 01", "Hj. Siti Aminah", "2024-09-15", "2027-09-30", ["GA", "Legal"]),
    ]
    for kind, subject, doc_type, doc_number, title, issuer, issued, expires, folder in papers:
        if subject is None:
            continue
        filed = rows(get(cloud, f"/api/v1/documents?subject_kind={kind}&subject_id={subject}&limit=200"))
        if any(d.get("doc_number") == doc_number for d in filed):
            print(f"  = {doc_type} {doc_number}")
            continue
        name = f"{doc_type}-{doc_number}".replace(" ", "").replace("/", "-") + ".pdf"
        status, stored = req(cloud, "POST", "/api/v1/files?" + urllib.parse.urlencode(
            {"name": name, "type": "application/pdf"}),
            raw=tiny_pdf([title, f"{doc_type}  No. {doc_number}", f"Diterbitkan oleh: {issuer}",
                          f"Tanggal terbit: {issued}", f"Berlaku s/d: {expires}"]),
            content_type="application/pdf")
        if status not in (200, 201):
            REFUSED.append(f"upload {name}: {status} {_msg(stored)}")
            continue
        do(cloud, f"{doc_type} {doc_number}", "POST", "/api/v1/documents", {
            "file_id": stored["file_id"], "file_name": name, "content_type": "application/pdf",
            "title": title, "path_tokens": folder, "language": "indonesian", "doc_date": issued,
            "doc_type": doc_type, "doc_number": doc_number, "issuer": issuer, "issued_on": issued,
            "expires_on": expires, "tags": [], "links": [{"subject_kind": kind, "subject_id": subject}]})


def seed_report(cloud):
    print("reports")
    name = "Penjualan harian per toko"
    saved = rows(get(cloud, "/api/v1/reports/saved"))
    if any(r.get("name") == name for r in saved):
        print(f"  = {name}")
        return
    do(cloud, name, "POST", "/api/v1/reports/saved", {"name": name, "spec": {
        "dataset": "sale", "period": {"kind": "relative", "last": 30, "unit": "day"}, "grain": "day",
        "group_by": ["site_id"], "measures": ["net"], "sort": {"key": "net", "desc": True}, "limit": 500,
        "present": {"kpis": ["net"], "chart": [], "table": []}}})


# ── what the pages read ─────────────────────────────────────────────────────


def verify(cloud):
    print("\nwhat each page reads")
    empty = []

    def show(label, n):
        print(f"  {'·' if n else '!'} {label}: {n}")
        if not n:
            empty.append(label)

    def total(path):
        payload = get(cloud, path)
        return payload.get("total", len(rows(payload))) if isinstance(payload, dict) else len(payload)

    show("/assets", total("/api/v1/ga/assets?limit=200"))
    for page, build in (("audio", "AUDIO"), ("ffe", "FFE"), ("it", "IT"), ("oe", "OE"), ("projects", "CIP"),
                        ("property", "LAND,BUILDING"), ("software", "SOFTWARE"), ("technical", "TECH"),
                        ("vehicles", "VEHICLE")):
        show(f"/assets/{page} (build={build})", total(f"/api/v1/ga/assets?build={build}"))
    show("/maintenance (repairs)", total("/api/v1/ga/repairs?limit=200"))
    show("/maintenance/schedule (tasks)", total("/api/v1/ga/maintenance-tasks?limit=200"))
    show("/maintenance/schedule (inspections)", total("/api/v1/ga/inspections?limit=100"))
    show("/maintenance/replacements", total("/api/v1/ga/replacements?limit=200"))
    show("disposals", total("/api/v1/ga/disposals?limit=200"))
    show("/contracts/cleaning", total("/api/v1/ga/contracts?type=JASA_CLEANING&limit=200"))
    show("/contracts/utilities", total("/api/v1/ga/contracts?group=LANGGANAN&limit=200"))
    show("/supplies", total("/api/v1/ga/supplies?limit=200"))
    show("/vendors (EXPENSE)", total("/api/v1/suppliers?category=EXPENSE"))
    show("/locations (with detail)", sum(1 for r in get(cloud, "/api/v1/ga/locations") if r.get("address")))
    show("/letters", total("/api/v1/letters"))
    show("/library (documents)", total("/api/v1/documents?limit=200"))
    show("/reports (saved)", total("/api/v1/reports/saved"))
    overview = get(cloud, "/api/v1/ga/overview")
    show("/ga overview sections filled", sum(1 for k, v in overview.items() if isinstance(v, list) and v))
    fin = rows(get(cloud, "/api/v1/finance/assets?limit=1000"))
    show("/finance/assets/capitalization (assessed)", sum(1 for r in fin if r.get("decision")))
    show("  CIP (IN_PROGRESS)", sum(1 for r in fin if r.get("decision") == "IN_PROGRESS"))
    show("  amortisation (AMORTISATION charged)", sum(1 for r in fin if r.get("charge_kind") == "AMORTISATION"
                                                   and r.get("last_depreciated_month")))
    show("  depreciation (charged Sep)", sum(1 for r in fin if r.get("last_depreciated_month")))
    show("  disposal (disposed)", sum(1 for r in fin if r.get("disposed_on")))
    show("  replacement reserve rates", len(rows(get(cloud, "/api/v1/finance/assets/reserve/rates"))))
    place = get(cloud, "/api/v1/ga/locations/store-01")
    for key in ("assets", "contracts", "repairs", "tasks", "supplies"):
        show(f"store /ga · store-01 {key}", len(place.get(key) or []))

    def statuses(path, key):
        return ", ".join(f"{r.get(key) or r.get('title') or r.get('asset_name')}: {r['status']}"
                         for r in rows(get(cloud, path)))
    print("  where the approvals stand")
    print(f"    repairs       {statuses('/api/v1/ga/repairs?limit=200', 'title')}")
    print(f"    replacements  {statuses('/api/v1/ga/replacements?limit=200', 'old_asset_name')}")
    print(f"    disposals     {statuses('/api/v1/ga/disposals?limit=200', 'asset_name')}")

    who = WHO or Who(cloud, {})
    if who.two_people:
        # The store app's /ga pages, asked the way the till asks them: through
        # the store node's relay, signed in as Maya (frontend-store-new's
        # lib/queries/ga.ts). Every one must come back with rows.
        print("  store app /ga pages (store node relay, signed in as maya)")
        for label, path, count in (
            ("/ga (place store-01)", "/api/v1/ga/locations/store-01",
             lambda p: sum(len(p.get(k) or []) for k in ("assets", "contracts", "repairs", "tasks", "supplies"))),
            ("/ga/assets", "/api/v1/ga/assets?site=store-01", lambda p: p.get("total", len(rows(p)))),
            ("/ga/contracts (place contracts)", "/api/v1/ga/locations/store-01",
             lambda p: len(p.get("contracts") or [])),
            ("/ga/contracts (types)", "/api/v1/ga/contract-types?site=store-01", lambda p: len(rows(p))),
            ("/ga/servicing", "/api/v1/ga/maintenance-tasks?site=store-01&limit=500",
             lambda p: len(rows(p))),
            ("/ga/repairs", "/api/v1/ga/repairs?site=store-01&limit=500", lambda p: len(rows(p))),
            ("/ga/repairs (objects)", "/api/v1/ga/repair-objects", lambda p: len(rows(p))),
            ("/ga/supplies", "/api/v1/ga/supplies?site=store-01&limit=500", lambda p: len(rows(p))),
            ("/ga/supplies (categories)", "/api/v1/ga/supply-categories", lambda p: len(rows(p))),
        ):
            status, payload = req(who.maya_shop, "GET", path)
            if status != 200:
                print(f"  ! store {label}: {status} {_msg(payload)}")
                empty.append(f"store {label} ({status})")
                continue
            show(f"store {label}", count(payload))
    return empty


def run(cloud, dc, store, ctx):
    global TODAY, WHO
    WHO = Who(cloud, ctx)
    cloud = WHO.rina
    TODAY = date.fromisoformat(get(cloud, "/api/v1/ga/overview")["generated_on"])
    print(f"  GA as of {TODAY}" + (" · signed in: rina, maya (Cloud + till), nina" if WHO.two_people
                                   else " · sign-in off: every step is `development`"))
    suppliers = seed_vendors(cloud)
    seed_locations(cloud)
    seed_purchases(cloud, suppliers)
    assets = seed_register(cloud)
    seed_assessment(cloud)
    seed_month_end(cloud)
    seed_write_off(cloud)
    contracts = seed_contracts(cloud, suppliers)
    seed_upkeep(cloud, assets, contracts, suppliers)
    seed_supplies(cloud)
    seed_letters(cloud)
    seed_papers(cloud, assets, contracts)
    seed_report(cloud)
    empty = verify(cloud)
    ctx["ga"] = {"suppliers": suppliers, "contracts": contracts}
    if REFUSED:
        print("\nrefused:\n  " + "\n  ".join(REFUSED))
    if empty:
        print("\nstill empty: " + ", ".join(empty))
