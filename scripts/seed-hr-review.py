#!/usr/bin/env python3
"""Fill every People screen of frontend-hub with a lived-in Indonesian retail
workforce, so the product owner can review each screen against real-looking
data rather than an empty state.

    ITULAH_API=http://127.0.0.1:8188 ITULAH_DB=hr_ga_review \\
    ITULAH_ADMIN_PASSWORD=review-admin-pass-1 ITULAH_SEED_PASSWORD=seed-password-1 \\
    python3 scripts/seed-hr-review.py

Runs on top of `seed-people.py`, `seed-workplace.py`, `seed-hr.py` and
`hr_e2e_seed.sh`; it deletes nothing and resets nothing.

What it adds, around four stores (store-01 … store-04) and head office:

* fifteen more store staff (registered, hired, contracted, posted), each with a
  login, a pay agreement and payroll identity; pay agreements and identities for
  the existing store heads and head office too;
* store shifts, a roster from 1 July to mid-October (head office from
  1 September — July and August are already closed there), and the punches
  those days produced: fingerprint stations at store-01/02, the employee app
  elsewhere, with late arrivals, forgotten punches, absences and overtime;
* leave, overtime orders, attendance corrections and roster swaps in every
  state, decided by somebody other than whoever filed them;
* closed attendance months and payroll runs in every state, with a payroll
  component catalogue (BPJS, overtime, kasbon, incentive) and adjustments;
* expense claims and kasbon advances in every state the ledger allows;
* requisitions, applicants at every stage, interviews, offers and a hire;
  staffing plans; onboarding and separation checklists; employment change
  proposals in every state; three months of performance scores; training
  programs and nominations; uniform issuances; grievances in every state;
  exits with exit interviews and full & final statements.

Everything goes through the API except punches for past days — the route only
stamps "now" — which are written in the exact shape the server writes them
(`postgres::punch::insert_punch`), the way `seed-hr.py` does.

Re-running is safe. Every id the API lets a caller choose is deterministic, so
a repeat answers 409 and is reported `=`. Rows the server numbers itself
(claims, grievances, proposals, applicants, …) are looked up by a natural key
first — the reason or subject this script wrote — and skipped when present.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("ITULAH_API", "http://127.0.0.1:8188").rstrip("/")
DB = os.environ.get("ITULAH_DB", "hr_ga_review")
ADMIN_PASSWORD = os.environ.get("ITULAH_ADMIN_PASSWORD", "review-admin-pass-1")
SEED_PASSWORD = os.environ.get("ITULAH_SEED_PASSWORD", "seed-password-1")
JAKARTA = timezone(timedelta(hours=7))
TODAY = date.fromisoformat(os.environ.get("ITULAH_TODAY", "2026-09-25"))

STORES = ["store-01", "store-02", "store-03", "store-04"]
ROSTER_FROM = date(2026, 7, 1)
ROSTER_TO = date(2026, 10, 11)
HO_ROSTER_FROM = date(2026, 9, 1)
HOLIDAYS = {date(2026, 8, 17), date(2026, 8, 25)}
TERMINALS = {"store-01": "TRM-S01-A", "store-02": "TRM-S02-A"}

# ── the cast ────────────────────────────────────────────────────────────────
# code, name, position, grade, kind, place, joined, contract end, login, base
NEW_PEOPLE = [
    ("ST-0103", "Rina Kartika", "Kasir", "G1", "PKWT", "store-01", "2025-08-04", "2026-10-31", "rina", 5_500_000),
    ("ST-0104", "Yoga Pratama", "Sales associate", "G1", "PKWT", "store-01", "2025-11-03", "2026-11-02", "yoga", 5_450_000),
    ("ST-0105", "Dian Puspita", "Supervisor kasir", "G3", "PKWTT", "store-01", "2022-03-07", None, "dian", 7_200_000),
    ("ST-0106", "Eko Wahyudi", "Staf gudang toko", "G1", "PKWT", "store-01", "2026-01-12", "2027-01-11", "eko", 5_400_000),
    ("ST-0107", "Lukman Hakim", "Staf gudang toko", "G1", "PKWT", "store-01", "2024-09-02", "2026-12-31", "lukman", 5_600_000),
    ("ST-0203", "Anisa Rahma", "Kasir", "G1", "PKWT", "store-02", "2025-09-01", "2026-12-31", "anisa", 5_500_000),
    ("ST-0204", "Bima Saputra", "Sales associate", "G2", "PKWTT", "store-02", "2023-06-05", None, "bima", 6_100_000),
    ("ST-0205", "Citra Lestari", "Sales associate", "G1", "PKWT", "store-02", "2026-02-02", "2027-02-01", "citra", 5_400_000),
    ("ST-0206", "Joko Susilo", "Sales associate", "G1", "PKWT", "store-02", "2024-11-04", "2026-11-03", "joko", 5_600_000),
    ("ST-0302", "Doni Firmansyah", "Kasir", "G1", "PKWT", "store-03", "2025-07-07", "2026-10-15", "doni", 5_500_000),
    ("ST-0303", "Fitri Handayani", "Sales associate", "G1", "PKWT", "store-03", "2025-10-06", "2026-10-05", "fitri", 5_450_000),
    ("ST-0304", "Galih Ramadhan", "Visual merchandiser", "G3", "PKWTT", "store-03", "2023-02-13", None, "galih", 7_000_000),
    ("ST-0305", "Kiki Amelia", "Kasir", "G1", "PKWT", "store-03", "2025-03-10", "2026-12-31", "kiki", 5_500_000),
    ("ST-0402", "Hana Safira", "Kasir", "G2", "PKWTT", "store-04", "2024-04-15", None, "hana", 6_000_000),
    ("ST-0403", "Irfan Maulana", "Sales associate", "G1", "PKWT", "store-04", "2025-12-01", "2026-11-30", "irfan", 5_400_000),
]
# Existing people this script gives a login, pay and a roster to.
# code, login, role, base, place
EXISTING = [
    ("ST-0101", "maya", "SUPERVISOR", 11_500_000, "store-01"),
    ("ST-0102", "fajar", "CASHIER", 5_600_000, "store-01"),
    ("ST-0201", "lestari", "SUPERVISOR", 11_000_000, "store-02"),
    ("ST-0202", "gilang", "CASHIER", 5_500_000, "store-02"),
    ("ST-0301", "intan", "SUPERVISOR", 11_000_000, "store-03"),
    ("ST-0401", "hendra", "SUPERVISOR", 10_800_000, "store-04"),
]
HO_PAY = {
    "HO-0001": 24_000_000, "HO-0002": 9_800_000, "HO-0003": 9_500_000, "HO-0004": 8_900_000,
    "HO-0005": 7_600_000, "HO-0006": 9_200_000, "HO-0008": 5_400_000,
}
HO_ROSTERED = ["HO-0001", "HO-0002", "HO-0003", "HO-0004", "HO-0005", "HO-0006", "HO-0008"]
MANAGER = {"store-01": "maya", "store-02": "lestari", "store-03": "intan", "store-04": "hendra", "ho": "andi"}
MANAGER_CODE = {"store-01": "ST-0101", "store-02": "ST-0201", "store-03": "ST-0301", "store-04": "ST-0401"}
# People whose roster stops early: two leave, one transfers out on 1 October.
ROSTER_UNTIL = {"ST-0206": date(2026, 8, 31), "ST-0305": date(2026, 9, 15), "ST-0304": date(2026, 9, 30)}

BANKS = ["BCA", "Mandiri", "BRI", "BNI"]
PTKP = ["TK/0", "K/0", "K/1", "TK/0", "K/2", "TK/1"]

# ── plumbing ────────────────────────────────────────────────────────────────
refusals: list[str] = []
counts: Counter = Counter()
tokens: dict[str, str] = {}


def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{API}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read().decode()
        try:
            return error.code, json.loads(payload)
        except json.JSONDecodeError:
            return error.code, payload
    except urllib.error.URLError as error:
        sys.exit(f"! cannot reach {API}: {error.reason}")


def message(answer):
    if isinstance(answer, dict):
        return answer.get("error") or answer.get("message") or json.dumps(answer, ensure_ascii=False)[:200]
    return str(answer)[:200]


def login(username, password=None):
    if username in tokens:
        return tokens[username]
    password = password or (ADMIN_PASSWORD if username == "admin" else SEED_PASSWORD)
    status, body = call("POST", "/api/v1/auth/login", {"username": username, "password": password})
    if status != 200:
        refusals.append(f"login {username}: {status} {message(body)}")
        return None
    tokens[username] = body["token"]
    return tokens[username]


def get(path, who="admin"):
    status, answer = call("GET", path, token=login(who))
    if status != 200:
        refusals.append(f"GET {path} as {who}: {status} {message(answer)}")
        return None
    return answer


notes: set[str] = set()


def step(label, method, path, body, who, kind=None, quiet=False, fallback=None, conflict_is_refusal=False):
    """One write. 2xx is `+`, 409 is `=`, anything else is a refusal.

    `fallback` names a head-office login to retry with when the first caller's
    reach does not cover the person — the case of an approved transfer dated
    in the future, which moves reach on the day it is approved (see report)."""
    status, answer = call(method, path, body, login(who))
    if fallback and status == 403 and "does not reach" in message(answer):
        notes.add(f"{who} lost reach over the subject of '{label}' before the move; recorded by {fallback}")
        who = fallback
        status, answer = call(method, path, body, login(who))
    if status in (200, 201, 204):
        if kind:
            counts[kind] += 1
        if not quiet:
            print(f"  + {label}")
    elif status == 409 and not conflict_is_refusal:
        if not quiet:
            print(f"  = {label} ({message(answer)[:90]})")
    else:
        print(f"  ! {label}: {status} {message(answer)}")
        refusals.append(f"{label} [{who}]: {status} {message(answer)}")
    return status, answer


def ok(status):
    return status in (200, 201, 204)


def psql(sql):
    subprocess.run(["psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], check=True)


def psql_rows(sql):
    out = subprocess.run(["psql", "-d", DB, "-At", "-F", "\t", "-c", sql], check=True,
                         capture_output=True, text=True).stdout
    return [line.split("\t") for line in out.splitlines() if line]


def h(*parts, mod=1000):
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest(), 16) % mod


def days(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def hhmm(minute):
    return f"{minute // 60:02d}:{minute % 60:02d}"


# ── the world as it stands ─────────────────────────────────────────────────
class World:
    def __init__(self):
        self.refresh()

    def refresh(self):
        page = get("/api/v1/employees?limit=500") or {"rows": []}
        self.rows = {row["employee_code"]: row for row in page["rows"]}
        self.id = {code: row["employee_id"] for code, row in self.rows.items()}
        self.code_of = {v: k for k, v in self.id.items()}

    def place(self, code):
        for spec in NEW_PEOPLE:
            if spec[0] == code:
                return spec[5]
        for spec in EXISTING:
            if spec[0] == code:
                return spec[4]
        return self.rows.get(code, {}).get("place_id") or "ho"

    def login_of(self, code):
        for spec in NEW_PEOPLE:
            if spec[0] == code:
                return spec[8]
        for spec in EXISTING:
            if spec[0] == code:
                return spec[1]
        return (self.rows.get(code) or {}).get("username")

    def name(self, code):
        return (self.rows.get(code) or {}).get("full_name") or code


def staff_of(place):
    """Everybody this script rosters at a place, in a stable order."""
    if place == "ho":
        return list(HO_ROSTERED)
    codes = [c for c, _, _, _, p in EXISTING if p == place]
    codes += [spec[0] for spec in NEW_PEOPLE if spec[5] == place]
    return sorted(codes)


# ── roster arithmetic, shared by the roster, punches, leave and overtime ───
def rest_weekday(code):
    if code.startswith("HO-"):
        return 6  # Sunday
    if code in MANAGER_CODE.values():
        return 0  # store heads rest on Monday, the quiet day
    return h("rest", code, mod=7)


def plan_for(code, day):
    """REST_DAY, PUBLIC_HOLIDAY or a shift id, or None when not rostered."""
    place_ho = code.startswith("HO-")
    start = HO_ROSTER_FROM if place_ho else ROSTER_FROM
    until = ROSTER_UNTIL.get(code, ROSTER_TO)
    if day < start or day > until:
        return None
    return pattern(code, day)


def pattern(code, day):
    """The standing week, whether or not a roster has been written that far."""
    place_ho = code.startswith("HO-")
    if day in HOLIDAYS:
        return "PUBLIC_HOLIDAY"
    if day.weekday() == rest_weekday(code):
        return "REST_DAY"
    if place_ho:
        return "PAGI"
    if code in MANAGER_CODE.values():
        return "TOKO-PAGI"
    week = day.isocalendar()[1]
    return "TOKO-PAGI" if (week + h("shift", code, mod=2)) % 2 == 0 else "SIANG"


SHIFT_TIMES = {"PAGI": (480, 1020), "TOKO-PAGI": (540, 1020), "SIANG": (780, 1260)}


def workday(code, day):
    return pattern(code, day) in SHIFT_TIMES


def next_workday(code, day):
    while not workday(code, day):
        day += timedelta(days=1)
    return day


# ── phase 1: people, logins, pay and payroll identity ──────────────────────
def phase_people(world):
    print("people")
    for index, (code, name, position, grade, kind, place, joined, ends, username, _base) in enumerate(NEW_PEOPLE):
        row = world.rows.get(code)
        if row is None:
            status, answer = step(f"register {code}", "POST", "/api/v1/employees", {"employee_code": code}, "admin",
                                  kind="employee")
            if not ok(status):
                continue
            world.refresh()
            row = world.rows[code]
        employee = row["employee_id"]
        if row.get("status") not in ("ACTIVE", "TERMINATED"):
            step(f"hire {code}", "POST", f"/api/v1/employees/{employee}/employment",
                 {"transition": "HIRE", "effective_on": joined, "reason": f"bergabung sebagai {position}"}, "admin")
        if not row.get("full_name"):
            step(f"personal data {code}", "POST", f"/api/v1/employees/{employee}/personal-data", {
                "full_name": name, "nik": f"3299{index + 101:012d}",
                "birth_date": f"{1994 + index % 9}-{index % 12 + 1:02d}-{index % 27 + 1:02d}",
                "address": f"Jl. Melati No. {index + 12}, {['Bandung', 'Bekasi', 'Depok', 'Tangerang'][index % 4]}",
            }, "admin")
        if not row.get("position"):
            step(f"contract {code}", "POST", f"/api/v1/employees/{employee}/contracts", {
                "kind": kind, "starts_on": joined, "ends_on": ends, "position": position, "grade": grade,
                "reason": "kontrak pertama",
            }, "admin")
        if not row.get("place_id"):
            step(f"posting {code}", "POST", f"/api/v1/employees/{employee}/assignments",
                 {"place_id": place, "valid_from": joined, "valid_to": None, "reason": f"ditempatkan di {place}"},
                 "admin")
    world.refresh()

    print("logins")
    wanted = [(spec[0], spec[8], "CASHIER") for spec in NEW_PEOPLE]
    wanted += [(code, username, role) for code, username, role, _, _ in EXISTING]
    for code, username, role in wanted:
        row = world.rows.get(code)
        if row is None:
            continue
        if row.get("username"):
            continue
        step(f"login {username} for {code}", "POST", f"/api/v1/employees/{row['employee_id']}/account/provision", {
            "username": username, "display_name": row.get("full_name") or username, "password": SEED_PASSWORD,
            "role": role, "reason": "akun review untuk karyawan ini",
        }, "admin", kind="login")
    world.refresh()

    print("pay agreements and payroll identity")
    pay = {spec[0]: (spec[9], spec[6]) for spec in NEW_PEOPLE}
    for code, _, _, base, _ in EXISTING:
        pay[code] = (base, "2026-01-01")
    for code, base in HO_PAY.items():
        pay[code] = (base, "2026-01-01")
    for index, (code, (base, joined)) in enumerate(sorted(pay.items())):
        employee = world.id.get(code)
        if employee is None:
            continue
        effective = max(joined, "2026-01-01")
        current = get(f"/api/v1/employees/{employee}/pay") or []
        if not current:
            store = not code.startswith("HO-")
            allowances = [{"code": "TRANSPORT", "minor": 350_000 if store else 500_000},
                          {"code": "MAKAN", "minor": 600_000 if store else 750_000}]
            if code in MANAGER_CODE.values():
                allowances.append({"code": "JABATAN", "minor": 1_500_000})
            step(f"pay {code} {base:,}", "POST", f"/api/v1/employees/{employee}/pay", {
                "effective_from": effective, "base_minor": base, "fixed_allowances": allowances,
                "reason": "penyesuaian UMK 2026" if joined < "2026-01-01" else "sesuai kontrak kerja",
            }, "admin", kind="pay agreement", quiet=True)
        identity = get(f"/api/v1/employees/{employee}/payroll-identity") or {}
        name = world.name(code)
        fields = [
            ("bank_name", {"field": "bank_account", "bank_name": BANKS[h('bank', code, mod=4)],
                           "bank_account": f"{h('acct', code, mod=10**10):010d}", "bank_holder": name}),
            ("npwp", {"field": "npwp", "value": f"{h('npwp', code, mod=100):02d}.{h('n2', code):03d}.{h('n3', code):03d}.{h('n4', code, mod=10)}-{h('n5', code):03d}.000"}),
            ("ptkp", {"field": "ptkp", "value": PTKP[h('ptkp', code, mod=len(PTKP))]}),
            ("bpjs_kesehatan", {"field": "bpjs_kesehatan", "value": f"000{h('kes', code, mod=10**10):010d}"}),
            ("bpjs_ketenagakerjaan", {"field": "bpjs_ketenagakerjaan", "value": f"{h('tk', code, mod=10**11):011d}"}),
        ]
        for present, body in fields:
            if identity.get(present):
                continue
            step(f"identity {code} {body['field']}", "POST", f"/api/v1/employees/{employee}/payroll-identity",
                 {**body, "effective_from": effective, "reason": "data dari formulir karyawan"}, "admin",
                 kind="payroll identity field", quiet=True)
    print(f"  pay agreements +{counts['pay agreement']}, identity fields +{counts['payroll identity field']}")

    print("annual leave 2026")
    # The route answers 200 to a repeat of the same entry id rather than 409,
    # so what is new is counted in the ledger, not from the answers.
    before = int(psql_rows("SELECT count(*) FROM leave_ledger_entry WHERE event = 'ALLOCATION'")[0][0])
    for code in sorted(set(pay) | {spec[0] for spec in NEW_PEOPLE}):
        employee = world.id.get(code)
        if employee is None:
            continue
        step(f"12 days for {code}", "POST", f"/api/v1/employees/{employee}/leave-balances", {
            "entry_id": f"alloc-2026-{employee}", "leave_type": "CUTI_TAHUNAN",
            "on": "2026-01-01", "event": "ALLOCATION", "days": 12, "expires_on": None,
        }, "admin", quiet=True)
    after = int(psql_rows("SELECT count(*) FROM leave_ledger_entry WHERE event = 'ALLOCATION'")[0][0])
    counts["leave allocation"] += after - before
    print(f"  allocations +{after - before}")

# ── the time plan: leave, overtime and corrections, declared once ─────────
# Leave: code, request id, type, from, to, outcome, reason, evidence.
LEAVES = [
    ("ST-0103", "LV-ST0103-01", "CUTI_TAHUNAN", "2026-07-20", "2026-07-21", "approve", "mudik ke Cirebon, nikahan sepupu", None),
    ("ST-0103", "LV-ST0103-02", "SAKIT", "2026-08-12", "2026-08-12", "approve", "demam, istirahat sesuai surat dokter", "surat-dokter-rina-0812.pdf"),
    ("ST-0103", "LV-ST0103-03", "CUTI_TAHUNAN", "2026-10-12", "2026-10-13", None, "acara pernikahan kakak di Kuningan", None),
    ("ST-0104", "LV-ST0104-01", "CUTI_TAHUNAN", "2026-09-07", "2026-09-07", "reject", "mengurus SKCK", None),
    ("ST-0104", "LV-ST0104-02", "CUTI_MENIKAH", "2026-11-09", "2026-11-11", None, "menikah, akad di Garut", None),
    ("ST-0105", "LV-ST0105-01", "CUTI_TAHUNAN", "2026-08-03", "2026-08-05", "approve", "liburan keluarga ke Yogyakarta", None),
    ("ST-0105", "LV-ST0105-02", "CUTI_TAHUNAN", "2026-10-19", "2026-10-19", "withdraw", "antar orang tua kontrol ke RS", None),
    ("ST-0102", "LV-ST0102-01", "IZIN", "2026-09-14", "2026-09-14", "approve", "mengurus perpanjangan KTP di Disdukcapil", None),
    ("ST-0106", "LV-ST0106-01", "SAKIT", "2026-07-09", "2026-07-10", "approve", "tipes, rawat jalan", "surat-dokter-eko-0709.pdf"),
    ("ST-0101", "LV-ST0101-01", "CUTI_TAHUNAN", "2026-09-28", "2026-09-30", None, "acara keluarga di Semarang", None),
    ("ST-0202", "LV-ST0202-01", "CUTI_TAHUNAN", "2026-08-24", "2026-08-24", "approve", "keperluan keluarga, sambung libur Maulid", None),
    ("ST-0202", "LV-ST0202-02", "CUTI_TAHUNAN", "2026-10-02", "2026-10-02", None, "menghadiri wisuda adik", None),
    ("ST-0203", "LV-ST0203-01", "SAKIT", "2026-09-03", "2026-09-04", "approve", "radang tenggorokan", "surat-dokter-anisa-0903.pdf"),
    ("ST-0203", "LV-ST0203-02", "CUTI_TAHUNAN", "2026-07-27", "2026-07-27", "reject", "urusan pribadi", None),
    ("ST-0204", "LV-ST0204-01", "CUTI_TAHUNAN", "2026-07-06", "2026-07-08", "approve", "pulang kampung ke Purwokerto", None),
    ("ST-0205", "LV-ST0205-01", "IZIN", "2026-09-21", "2026-09-21", "approve", "wisuda adik di Bandung", None),
    ("ST-0201", "LV-ST0201-01", "CUTI_TAHUNAN", "2026-08-10", "2026-08-11", "approve", "renovasi rumah, harus di tempat", None),
    ("ST-0302", "LV-ST0302-01", "CUTI_TAHUNAN", "2026-09-10", "2026-09-11", "approve", "mengantar istri melahirkan", None),
    ("ST-0302", "LV-ST0302-02", "CUTI_TAHUNAN", "2026-10-05", "2026-10-06", None, "aqiqah anak pertama", None),
    ("ST-0303", "LV-ST0303-01", "SAKIT", "2026-08-18", "2026-08-19", "approve", "gejala DBD, observasi", "surat-dokter-fitri-0818.pdf"),
    ("ST-0303", "LV-ST0303-02", "CUTI_TAHUNAN", "2026-09-30", "2026-09-30", None, "urusan administrasi kampus", None),
    ("ST-0304", "LV-ST0304-01", "CUTI_TAHUNAN", "2026-07-15", "2026-07-17", "approve", "liburan sekolah anak", None),
    ("ST-0305", "LV-ST0305-01", "CUTI_TAHUNAN", "2026-08-27", "2026-08-27", "withdraw", "urusan bank", None),
    ("ST-0402", "LV-ST0402-01", "CUTI_TAHUNAN", "2026-07-29", "2026-07-31", "approve", "menjenguk orang tua di Solo", None),
    ("ST-0402", "LV-ST0402-02", "CUTI_TAHUNAN", "2026-09-24", "2026-09-24", None, "mengurus balik nama motor", None),
    ("ST-0403", "LV-ST0403-01", "SAKIT", "2026-08-06", "2026-08-06", "approve", "sakit gigi, cabut geraham", "surat-dokter-irfan-0806.pdf"),
    ("ST-0403", "LV-ST0403-02", "CUTI_TAHUNAN", "2026-10-26", "2026-10-27", "reject", "liburan ke Bali", None),
    ("HO-0002", "LV-HO0002-01", "CUTI_TAHUNAN", "2026-09-17", "2026-09-18", "approve", "acara keluarga di Malang", None),
    ("HO-0002", "LV-HO0002-02", "CUTI_TAHUNAN", "2026-10-08", "2026-10-09", None, "liburan", None),
    ("HO-0005", "LV-HO0005-01", "SAKIT", "2026-09-08", "2026-09-08", "approve", "migrain, istirahat", "surat-dokter-dimas-0908.pdf"),
    ("HO-0003", "LV-HO0003-01", "CUTI_TAHUNAN", "2026-10-12", "2026-10-16", None, "umrah bersama orang tua", None),
    ("HO-0008", "LV-HO0008-01", "CUTI_TAHUNAN", "2026-09-22", "2026-09-22", "approve", "mengurus surat pindah domisili", None),
]
# Overtime: order id, code, date, minutes, reason, outcome (agree/decline/withdraw/None).
OVERTIME = [
    ("OT-S01-0001", "ST-0103", "2026-07-18", 120, "stock opname tengah tahun", "agree"),
    ("OT-S01-0002", "ST-0105", "2026-07-18", 120, "stock opname tengah tahun", "agree"),
    ("OT-S01-0003", "ST-0106", "2026-08-06", 90, "bongkar kiriman DC susulan", "agree"),
    ("OT-S01-0004", "ST-0104", "2026-08-28", 120, "persiapan promo 9.9", "decline"),
    ("OT-S01-0005", "ST-0102", "2026-09-08", 60, "antrean kasir promo payday", "agree"),
    ("OT-S01-0006", "ST-0103", "2026-09-29", 120, "ganti display koleksi Oktober", None),
    ("OT-S01-0007", "ST-0106", "2026-09-12", 90, "terima barang retur", "withdraw"),
    ("OT-S02-0001", "ST-0204", "2026-07-31", 120, "tutup buku stok akhir bulan", "agree"),
    ("OT-S02-0002", "ST-0202", "2026-08-15", 90, "persiapan promo kemerdekaan", "agree"),
    ("OT-S02-0003", "ST-0203", "2026-09-26", 120, "stock opname kuartal III", None),
    ("OT-S02-0004", "ST-0205", "2026-09-05", 60, "susun ulang rak aksesoris", "decline"),
    ("OT-S03-0001", "ST-0304", "2026-08-29", 180, "ganti visual display 9.9", "agree"),
    ("OT-S03-0002", "ST-0302", "2026-09-17", 60, "rekap setoran promo", "agree"),
    ("OT-S03-0003", "ST-0303", "2026-10-03", 120, "stock opname kuartal III", None),
    ("OT-S04-0001", "ST-0402", "2026-07-11", 120, "bongkar kiriman koleksi baru", "agree"),
    ("OT-S04-0002", "ST-0403", "2026-08-22", 120, "persiapan promo akhir Agustus", "agree"),
]
# Corrections for punches that went missing: code, date, effect, outcome.
CORRECTIONS = [
    ("ST-0103", "2026-07-14", "DEPARTURE", "approve", "lupa absen pulang, mesin antre"),
    ("ST-0104", "2026-08-19", "ARRIVAL", "reject", "jari tidak terbaca saat datang"),
    ("ST-0204", "2026-08-08", "DEPARTURE", "approve", "mesin mati listrik saat pulang"),
    ("ST-0203", "2026-09-16", "DEPARTURE", None, "lupa absen pulang"),
    ("ST-0302", "2026-09-19", "ARRIVAL_AND_DEPARTURE", None, "HP tertinggal, tidak bisa absen via aplikasi"),
    ("ST-0402", "2026-08-13", "DEPARTURE", "approve", "aplikasi error saat absen pulang"),
    ("HO-0005", "2026-09-09", "DEPARTURE", None, "lupa absen pulang, rapat sampai malam"),
    ("ST-0102", "2026-09-23", "DEPARTURE", None, "lupa absen pulang"),
    # Filed by the store head for Fajar, and taken back by her: the running
    # build refuses a cashier's own withdrawal at the role gate (see report).
    ("ST-0102", "2026-09-18", "DEPARTURE", "withdraw", "mesin tidak membaca jari saat pulang", "maya"),
]
ABSENT = {("ST-0104", "2026-08-24"), ("ST-0403", "2026-09-02"), ("ST-0203", "2026-07-22"), ("ST-0303", "2026-09-12")}


def leave_span(code, start, end):
    start = next_workday(code, date.fromisoformat(start))
    end = max(start, date.fromisoformat(end))
    rest = [d.isoformat() for d in days(start, end) if pattern(code, d) == "REST_DAY"]
    return start, end, rest


def leave_days_off():
    """Days an approved leave keeps somebody from the floor."""
    off = set()
    for code, _, _, start, end, outcome, _, _ in LEAVES:
        if outcome == "approve":
            first, last, _ = leave_span(code, start, end)
            off |= {(code, d) for d in days(first, last) if workday(code, d)}
    return off


def overtime_days():
    return {(code, next_workday(code, date.fromisoformat(on))): minutes
            for _, code, on, minutes, _, outcome in OVERTIME if outcome == "agree"}


def correction_days():
    return {(code, next_workday(code, date.fromisoformat(on))): row[2]
            for row in CORRECTIONS for code, on in [row[:2]] if row[3] != "withdraw"}


# ── phase 2: shifts, stations, the roster and what the clock saw ───────────
def parallel(jobs, workers=8):
    """Run independent callables side by side; the server is slow per call,
    not per core."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda job: job(), jobs))


def phase_time(world):
    print("shifts")
    step("shift TOKO-PAGI", "POST", "/api/v1/attendance-shifts",
         {"id": "TOKO-PAGI", "name": "Pagi toko", "starts_at": "09:00", "ends_at": "17:00",
          "unpaid_break_minutes": 60}, "admin", kind="shift")

    print("punch stations")
    for place, terminal in TERMINALS.items():
        step(f"station {terminal}", "POST", "/api/v1/attendance-terminals",
             {"terminal_id": terminal, "place_id": place, "name": f"Mesin sidik jari {place.replace('store-', 'Toko ')}",
              "reason": "pasang mesin absensi toko"}, "admin", kind="terminal")
    step("station TRM-S02-B", "POST", "/api/v1/attendance-terminals",
         {"terminal_id": "TRM-S02-B", "place_id": "store-02", "name": "Mesin cadangan gudang Toko 02",
          "reason": "mesin cadangan"}, "admin", kind="terminal")
    stations = {row["id"] if "id" in row else row.get("terminal_id"): row for row in (get("/api/v1/attendance-terminals") or [])}
    backup = stations.get("TRM-S02-B") or {}
    if backup and backup.get("status") == "ACTIVE":
        step("suspend TRM-S02-B", "POST", "/api/v1/attendance-terminals/TRM-S02-B/status",
             {"status": "SUSPENDED", "reason": "sensor rusak, menunggu teknisi"}, "admin")
    fingers = ["RIGHT_INDEX", "LEFT_INDEX"]
    sealed = True
    for place, terminal in TERMINALS.items():
        for code in staff_of(place) if sealed else []:
            employee = world.id[code]
            enrolled = get(f"/api/v1/employees/{employee}/fingerprints") or {}
            rows = enrolled.get("fingers") if isinstance(enrolled, dict) else enrolled
            have = {row.get("finger") for row in (rows or []) if row.get("state", "ENROLLED") == "ENROLLED"}
            for finger in fingers:
                if finger in have:
                    continue
                template = hashlib.sha256(f"{code}{finger}".encode()).hexdigest() * 8
                status, answer = call("POST", f"/api/v1/employees/{employee}/fingerprints",
                                      {"finger": finger, "terminal_id": terminal, "template_hex": template,
                                       "quality": 60 + h("q", code, finger, mod=36),
                                       "reason": "pendaftaran sidik jari"}, login("admin"))
                if ok(status):
                    counts["fingerprint"] += 1
                elif "ATTENDANCE_TEMPLATE_KEY" in message(answer):
                    # A node without a sealing key refuses every template; one
                    # line says so rather than one per finger.
                    refusals.append(f"enrol fingerprints [admin]: {status} {message(answer)[:160]}")
                    sealed = False
                    break
                elif status != 409:
                    refusals.append(f"enrol {code} {finger} [admin]: {status} {message(answer)}")
            if not sealed:
                break
    print(f"  fingerprints +{counts['fingerprint']}")

    print("roster")
    existing = set()
    for place in STORES + ["ho"]:
        for row in get(f"/api/v1/roster?place={place}&from={ROSTER_FROM}&to={ROSTER_TO}") or []:
            existing.add((row["employee_id"], row["on_date"]))
    todo = defaultdict(list)
    for place in STORES + ["ho"]:
        for code in staff_of(place):
            employee = world.id[code]
            for day in days(ROSTER_FROM, ROSTER_TO):
                plan = plan_for(code, day)
                if plan is None or (employee, day.isoformat()) in existing:
                    continue
                body = {"on_date": day.isoformat(), "reason": "jadwal bulanan"}
                if plan in SHIFT_TIMES:
                    body.update(plan="SCHEDULED", shift_id=plan)
                elif plan == "PUBLIC_HOLIDAY":
                    body.update(plan=plan, reason="hari libur nasional")
                else:
                    body.update(plan=plan, reason="libur mingguan")
                todo[(place, employee)].append(body)

    def plan_person(key):
        place, employee = key
        who = "admin" if place == "ho" else MANAGER[place]
        for body in todo[key]:
            status, answer = call("POST", f"/api/v1/employees/{employee}/roster", body, login(who))
            if ok(status):
                counts["roster day"] += 1
            elif status != 409:
                refusals.append(f"roster {world.code_of[employee]} {body['on_date']} [{who}]: {status} {message(answer)}")

    for place in STORES + ["ho"]:  # sign the managers in once, not from eight threads at once
        login("admin" if place == "ho" else MANAGER[place])
    parallel([lambda key=key: plan_person(key) for key in todo])
    print(f"  + {counts['roster day']} roster days")

    print("punches")
    off = leave_days_off()
    overtime = overtime_days()
    corrected = correction_days()
    rows = []
    touched = {}
    for place in STORES + ["ho"]:
        for code in staff_of(place):
            if code == "HO-0007":
                continue
            employee = world.id[code]
            for day in days(ROSTER_FROM, TODAY):
                plan = plan_for(code, day)
                if plan not in SHIFT_TIMES or (code, day) in off or (code, day.isoformat()) in ABSENT:
                    continue
                start, end = SHIFT_TIMES[plan]
                roll = h("day", code, day, mod=100)
                arrival = start - 4 - h("arr", code, day, mod=22)
                if roll < 6:
                    arrival = start + 12 + h("late", code, day, mod=35)
                departure = end + h("dep", code, day, mod=18)
                if (code, day) in overtime:
                    departure = end + overtime[(code, day)] + h("ot", code, day, mod=9)
                elif 96 <= roll:
                    departure = end - 35 - h("early", code, day, mod=30)
                effect = corrected.get((code, day))
                punches = []
                if effect not in ("ARRIVAL", "ARRIVAL_AND_DEPARTURE"):
                    punches.append(("IN", arrival))
                if effect not in ("DEPARTURE", "ARRIVAL_AND_DEPARTURE"):
                    punches.append(("OUT", departure))
                terminal = TERMINALS.get(place)
                for direction, minute in punches:
                    recorded = datetime(day.year, day.month, day.day, tzinfo=JAKARTA) + timedelta(minutes=minute)
                    at = recorded.astimezone(timezone.utc).isoformat()
                    if terminal:
                        # A punch id is at most 64 characters; the station is in its own column.
                        punch_id = f"trm-{employee}-{day:%Y%m%d}0-{minute:04d}-{direction}"
                        rows.append(f"('{punch_id}','{employee}','{place}','TERMINAL','{terminal}','FINGERPRINT',"
                                    f"'{direction}','{day}',0,{minute},'{at}','OK')")
                        touched[terminal] = max(touched.get(terminal, at), at)
                    else:
                        punch_id = f"app-{employee}-{day:%Y%m%d}0-{minute:04d}-{direction}"
                        rows.append(f"('{punch_id}','{employee}','{place}','EMPLOYEE_APP',NULL,NULL,"
                                    f"'{direction}','{day}',0,{minute},'{at}','OK')")
    before = int(psql_rows("SELECT count(*) FROM attendance_punch")[0][0])
    for chunk in range(0, len(rows), 500):
        psql("INSERT INTO attendance_punch (id, employee_id, place_id, source, terminal_id, method, direction,"
             " business_date, day_offset, minute, recorded_at, clock_quality) VALUES "
             + ",".join(rows[chunk:chunk + 500]) + " ON CONFLICT (id) DO NOTHING")
    for terminal, at in touched.items():
        psql(f"UPDATE attendance_terminal SET punched_at = GREATEST(COALESCE(punched_at, '{at}'), '{at}'),"
             f" synced_at = COALESCE(synced_at, '{at}') WHERE id = '{terminal}'")
    after = int(psql_rows("SELECT count(*) FROM attendance_punch")[0][0])
    counts["punch"] += after - before
    print(f"  + {after - before} punches ({len(rows)} planned)")

SWAPS = [
    ("ST-0103", "ST-0104", "2026-09-30", "approve", "kuliah pagi, minta tukar hari"),
    ("ST-0203", "ST-0205", "2026-10-01", None, "antar ibu kontrol ke dokter"),
    ("ST-0302", "ST-0303", "2026-10-02", "reject", "acara keluarga di Bogor"),
    ("ST-0402", "ST-0403", "2026-10-07", None, "janji dengan notaris"),
    # A store head's own swap, so a withdrawal can be shown: the running build
    # refuses a cashier's own withdrawal at the role gate (see report).
    ("ST-0401", "ST-0403", "2026-10-08", "withdraw", "rapat area manager di kantor pusat"),
    ("ST-0106", "ST-0107", "2026-10-04", None, "rapat wali murid di sekolah anak"),
]


def decider_for(code, place):
    """Store staff are decided by their store head; heads and head office by Andi."""
    if place == "ho" or code in MANAGER_CODE.values():
        return "andi"
    return MANAGER[place]


def own_or_behalf(world, code):
    """The login that files for somebody, and the path segment it files under."""
    username = world.login_of(code)
    if username:
        return username, "me"
    return "yusuf", world.id[code]


# ── phase 3: leave, overtime, corrections and swaps ────────────────────────
def phase_requests(world):
    print("leave requests")
    states = {}
    for code in {row[0] for row in LEAVES}:
        for row in get(f"/api/v1/employees/{world.id[code]}/leave-requests") or []:
            states[row["id"]] = row
    for code, request_id, kind, start, end, outcome, reason, evidence in LEAVES:
        place = world.place(code)
        employee = world.id[code]
        filer, segment = own_or_behalf(world, code)
        first, last, rest = leave_span(code, start, end)
        if request_id not in states:
            status, answer = step(f"file {request_id} {code} {kind} {first}..{last}", "POST",
                                  f"/api/v1/employees/{segment}/leave-requests", {
                                      "request_id": request_id, "leave_type": kind, "from_date": first.isoformat(),
                                      "to_date": last.isoformat(), "rest_days": rest, "evidence": evidence,
                                      "reason": reason}, filer, kind="leave request")
            if not ok(status):
                continue
            states[request_id] = answer
        state = states[request_id]["state"]
        decider = decider_for(code, place)
        if state == "PENDING" and outcome in ("approve", "reject"):
            status, answer = step(f"{outcome} {request_id}", "POST",
                                  f"/api/v1/employees/{employee}/leave-requests/{request_id}/{outcome}",
                                  {"reason": "disetujui, jadwal sudah diatur" if outcome == "approve"
                                   else "jadwal toko penuh, mohon ajukan tanggal lain"}, decider,
                                  kind=f"leave {outcome}")
            if ok(status):
                states[request_id] = answer
        if state == "PENDING" and outcome == "withdraw":
            status, answer = step(f"withdraw {request_id}", "POST",
                                  f"/api/v1/employees/{segment}/leave-requests/{request_id}/withdraw",
                                  {"reason": "rencana batal"}, filer, kind="leave withdraw")
            if ok(status):
                states[request_id] = answer

    print("overtime orders")
    orders = {}
    for code in {row[1] for row in OVERTIME}:
        for row in get(f"/api/v1/employees/{world.id[code]}/overtime-orders") or []:
            orders[row["id"]] = row
    for order_id, code, on, minutes, reason, outcome in OVERTIME:
        place = world.place(code)
        employee = world.id[code]
        day = next_workday(code, date.fromisoformat(on))
        if order_id not in orders:
            status, answer = step(f"order {order_id} {code} {day} {minutes}m", "POST",
                                  f"/api/v1/employees/{employee}/overtime-orders", {
                                      "order_id": order_id, "on_date": day.isoformat(), "day_kind": "WORKING",
                                      "planned_minutes": minutes, "reason": reason}, MANAGER[place],
                                  kind="overtime order")
            if not ok(status):
                continue
            orders[order_id] = answer
        if orders[order_id]["state"] != "AWAITING_CONSENT" or outcome is None:
            continue
        if outcome == "withdraw":
            step(f"withdraw {order_id}", "POST", f"/api/v1/employees/{employee}/overtime-orders/{order_id}/withdrawal",
                 {"reason": "barang retur ditunda ke minggu depan"}, MANAGER[place], kind="overtime withdraw")
        else:
            step(f"{outcome} {order_id}", "POST", f"/api/v1/employees/me/overtime-orders/{order_id}/consent",
                 {"agreed": outcome == "agree",
                  "reason": "bersedia lembur" if outcome == "agree" else "ada keperluan keluarga malam itu"},
                 world.login_of(code), kind=f"overtime {outcome}")

    print("attendance corrections")
    filed = {}
    for place in STORES + ["ho"]:
        for row in get(f"/api/v1/attendance-corrections?place={place}&pending=false") or []:
            filed.setdefault((row["employee_id"], row["business_date"], row["effect"]), []).append(row)

    def file_and_decide(code, day, body, outcome, why, behalf=None):
        employee = world.id[code]
        place = world.place(code)
        key = (employee, day.isoformat(), body["effect"])
        rows = filed.get(key)
        filer, segment = (behalf, employee) if behalf else own_or_behalf(world, code)
        if not rows:
            status, answer = step(f"file {body['effect']} {code} {day}", "POST",
                                  f"/api/v1/employees/{segment}/attendance-corrections",
                                  {**body, "business_date": day.isoformat(), "reason": why}, filer,
                                  kind="correction", quiet=body["effect"] == "APPROVED_LEAVE")
            if not ok(status):
                return
            rows = [row for row in answer if row["effect"] == body["effect"]]
        pending = [row for row in rows if row["state"] == "PENDING"]
        if not pending or outcome is None:
            return
        if outcome == "withdraw":
            step(f"withdraw correction {code} {day}", "POST",
                 f"/api/v1/attendance-corrections/{pending[-1]['id']}/withdrawal",
                 {"approve": False, "reason": "ternyata tercatat di mesin"}, filer, kind="correction withdraw")
        else:
            step(f"{outcome} correction {body['effect']} {code} {day}", "POST",
                 f"/api/v1/attendance-corrections/{pending[-1]['id']}/decision",
                 {"approve": outcome == "approve",
                  "reason": "sesuai catatan supervisor" if outcome == "approve"
                  else "CCTV menunjukkan datang pukul 09:40"},
                 decider_for(code, place), kind=f"correction {outcome}", quiet=body["effect"] == "APPROVED_LEAVE")

    for code, request_id, kind, start, end, outcome, _, _ in LEAVES:
        if outcome != "approve":
            continue
        first, last, _ = leave_span(code, start, end)
        for day in days(first, min(last, TODAY)):
            if workday(code, day):
                file_and_decide(code, day, {"effect": "APPROVED_LEAVE", "leave_id": request_id}, "approve",
                                f"cuti {request_id}")
    for code, on, effect, outcome, why, *behalf in CORRECTIONS:
        day = next_workday(code, date.fromisoformat(on))
        start, end = SHIFT_TIMES[pattern(code, day)]
        body = {"effect": effect}
        if effect in ("ARRIVAL", "ARRIVAL_AND_DEPARTURE"):
            body["arrival"] = hhmm(start - 7)
        if effect in ("DEPARTURE", "ARRIVAL_AND_DEPARTURE"):
            body["departure"] = hhmm(end + 6)
        file_and_decide(code, day, body, outcome, why, behalf[0] if behalf else None)
    print(f"  corrections +{counts['correction']}")

    print("roster swaps")
    for code, other, on, outcome, reason in SWAPS:
        employee = world.id[code]
        place = world.place(code)
        mine = [row for row in get(f"/api/v1/employees/{employee}/roster-swaps") or [] if row["on_date"] == on]
        if not mine:
            status, answer = step(f"swap {code}↔{other} {on}", "POST", "/api/v1/roster-swaps",
                                  {"with_employee_id": world.id[other], "on_date": on, "reason": reason},
                                  world.login_of(code), kind="roster swap")
            if not ok(status):
                continue
            mine = [answer]
        swap = mine[-1]
        if swap["state"] != "PENDING" or outcome is None:
            continue
        if outcome == "withdraw":
            step(f"withdraw swap {code} {on}", "POST", f"/api/v1/roster-swaps/{swap['id']}/withdrawal", None,
                 world.login_of(code), kind="swap withdraw")
        else:
            step(f"{outcome} swap {code} {on}", "POST", f"/api/v1/roster-swaps/{swap['id']}/decision",
                 {"approved": outcome == "approve",
                  "reason": "sudah dikonfirmasi keduanya" if outcome == "approve" else "hari itu ada visit area manager"},
                 MANAGER[place], kind=f"swap {outcome}")

# ── phase 4: components, kasbon, closing the months and paying them ────────
COMPONENTS = [
    # code, label, kind, basis, base, unit, rate numbers
    ("BPJS_KES", "BPJS Kesehatan (karyawan 1%)", "DEDUCTION", "SHARE_OF_BASE", "STATUTORY_BASE", None,
     {"rate_bp": 100, "cap_minor": 120_000}),
    ("BPJS_JHT", "BPJS Ketenagakerjaan JHT (karyawan 2%)", "DEDUCTION", "SHARE_OF_BASE", "STATUTORY_BASE", None,
     {"rate_bp": 200}),
    ("BPJS_JP", "BPJS Jaminan Pensiun (karyawan 1%)", "DEDUCTION", "SHARE_OF_BASE", "STATUTORY_BASE", None,
     {"rate_bp": 100, "cap_minor": 105_474}),
    ("LEMBUR_JAM1", "Lembur hari kerja, jam pertama", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "STATUTORY_BASE",
     "OVERTIME_WORKDAY_FIRST_HOUR", {"hours_divisor": 173, "multiplier_bp": 15_000}),
    ("LEMBUR_JAM2", "Lembur hari kerja, jam berikutnya", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "STATUTORY_BASE",
     "OVERTIME_WORKDAY_LATER", {"hours_divisor": 173, "multiplier_bp": 20_000}),
    ("LEMBUR_LIBUR", "Lembur hari istirahat", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "STATUTORY_BASE",
     "OVERTIME_REST_DAY", {"hours_divisor": 173, "multiplier_bp": 20_000}),
    ("LEMBUR_HARI_RAYA", "Lembur hari libur resmi", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "STATUTORY_BASE",
     "OVERTIME_HOLIDAY", {"hours_divisor": 173, "multiplier_bp": 20_000}),
    ("INSENTIF", "Insentif penjualan", "EARNING", "PER_OCCASION", None, None, None),
    ("KASBON", "Potongan kasbon", "DEDUCTION", "PER_OCCASION", None, None, None),
]
# Closed months and how far each run gets: place, period, last step.
RUNS = [
    ("store-01", "2026-07", "handover"), ("store-01", "2026-08", "approve"),
    ("store-02", "2026-07", "approve"), ("store-02", "2026-08", "submit"),
    ("store-03", "2026-07", "approve"), ("store-03", "2026-08", "open"),
    ("store-04", "2026-07", "approve"),
]
# Kasbon: code, purpose, amount, how far it gets, monthly instalment recovered in August.
ADVANCES = [
    ("ST-0302", "Kasbon biaya persalinan istri", 2_000_000, "pay", 500_000),
    ("ST-0202", "Kasbon perbaikan motor", 1_000_000, "request", None),
    ("ST-0102", "Kasbon biaya masuk sekolah anak", 1_500_000, "approve", None),
    ("ST-0403", "Kasbon sewa kos", 800_000, "cancel", None),
]
# One-off earnings: place, period, code, amount, reason.
INCENTIVES = [
    ("store-01", "2026-07", "ST-0105", 750_000, "insentif penjualan Juli, 112% target"),
    ("store-01", "2026-08", "ST-0103", 400_000, "insentif kasir akurat Agustus"),
    ("store-03", "2026-08", "ST-0304", 600_000, "insentif display 9.9 terbaik area"),
    ("store-02", "2026-08", "ST-0204", 500_000, "insentif penjualan Agustus, 108% target"),
]


def phase_pay(world):
    # Every money step here posts a journal, and this node has no accounting
    # month open at all; the finance lane refuses "no accounting period exists".
    print("accounting months")
    have = get("/api/v1/finance/periods", "andi") or {}
    rows = have.get("rows", have.get("periods", [])) if isinstance(have, dict) else have
    labels = {f"{row.get('year')}-{int(row.get('month', 0)):02d}" for row in rows if isinstance(row, dict)}
    for month in (7, 8, 9):
        if f"2026-{month:02d}" not in labels:
            step(f"open accounting month 2026-{month:02d}", "POST", "/api/v1/finance/periods",
                 {"year": 2026, "month": month}, "andi", kind="accounting month")

    print("payroll components")
    known = {row["code"] for row in get("/api/v1/payroll/components") or []}
    for code, label, kind, basis, base, unit, numbers in COMPONENTS:
        if code not in known:
            body = {"code": code, "label": label, "kind": kind, "basis": basis, "reason": "katalog komponen gaji 2026"}
            if base:
                body["base_ref"] = base
            if unit:
                body["unit"] = unit
            step(f"component {code}", "POST", "/api/v1/payroll/components", body, "admin", kind="pay component")
        if numbers and not (get(f"/api/v1/payroll/components/{code}/rates") or []):
            step(f"rate {code}", "POST", f"/api/v1/payroll/components/{code}/rates",
                 {"effective_from": "2026-01-01", **numbers,
                  "reason": "PP 44/2015, Perpres 64/2020, PP 35/2021"}, "andi", kind="component rate")

    print("kasbon")
    advances = {}
    for place in STORES:
        for row in get(f"/api/v1/finance/advances?site={place}&limit=200", "andi") or []:
            if row.get("employee_id"):
                advances[(row["employee_id"], row["purpose"])] = row
    recover = []
    for code, purpose, amount, reach, instalment in ADVANCES:
        employee = world.id[code]
        place = world.place(code)
        row = advances.get((employee, purpose))
        if row is None:
            # The handler admits a Supervisor, but the route gate puts every
            # finance write at ADMIN, so head office records the request.
            status, answer = step(f"ask {purpose} for {code}", "POST", "/api/v1/finance/advances", {
                "site_id": place, "party_type": "EMPLOYEE", "employee_id": employee, "purpose": purpose,
                "amount_minor": amount, "note": f"diajukan kepala toko {MANAGER[place]}, potong gaji bertahap"},
                "ratna", kind="advance")
            if not ok(status):
                continue
            row = answer.get("advance", answer)
        advance_id = row["advance_id"]
        if row["status"] == "REQUESTED" and reach in ("approve", "pay"):
            status, answer = step(f"approve {row['advance_number']}", "POST",
                                  f"/api/v1/finance/advances/{advance_id}/approve", None, "andi",
                                  kind="advance approve")
            if ok(status):
                row = answer.get("advance", answer)
        if row["status"] == "REQUESTED" and reach == "cancel":
            step(f"cancel {row['advance_number']}", "POST", f"/api/v1/finance/advances/{advance_id}/cancel",
                 {"reason": "karyawan batal mengambil"}, "andi", kind="advance cancel")
        if row["status"] == "APPROVED" and reach == "pay":
            status, answer = step(f"pay {row['advance_number']}", "POST",
                                  f"/api/v1/finance/advances/{advance_id}/pay",
                                  {"posting_date": "2026-07-24", "cash_key": "cash"}, "ratna", kind="advance pay")
            if ok(status):
                row = answer.get("advance", answer)
        if instalment and row["status"] in ("PAID", "PARTIALLY_SETTLED", "SETTLED"):
            recover.append((place, "2026-08", code, instalment, advance_id))

    print("payroll adjustments")
    filed = defaultdict(list)
    for place in STORES:
        for period in ("2026-07", "2026-08"):
            for row in get(f"/api/v1/payroll/adjustments?place={place}&period={period}") or []:
                filed[(place, period)].append(row)

    def adjust(place, period, code, component, amount, reason, advance_id=None):
        employee = world.id[code]
        if any(row["employee_id"] == employee and row["component_code"] == component
               for row in filed[(place, period)]):
            return
        body = {"place_id": place, "period": period, "employee_id": employee, "component_code": component,
                "amount_minor": amount, "reason": reason}
        if advance_id:
            body["advance_id"] = advance_id
        step(f"{component} {code} {period} {amount:,}", "POST", "/api/v1/payroll/adjustments", body,
             MANAGER[place], kind="payroll adjustment")

    for place, period, code, amount, reason in INCENTIVES:
        adjust(place, period, code, "INSENTIF", amount, reason)
    for place, period, code, amount, advance_id in recover:
        adjust(place, period, code, "KASBON", amount, "cicilan kasbon 1 dari 3", advance_id)

    print("attendance periods")
    periods = {}
    for place in STORES:
        for row in get(f"/api/v1/attendance-periods?place={place}") or []:
            periods[(place, row["period"][:7])] = row
    for place, period, _ in RUNS:
        row = periods.get((place, period)) or {}
        if row.get("status") != "CLOSED":
            step(f"close {place} {period}", "POST", f"/api/v1/attendance-periods/{place}/{period}/closure",
                 {"reason": "absensi bulanan sudah diperiksa"}, MANAGER[place], kind="period close")

    print("payroll runs")
    runs = {row["id"]: row for row in get("/api/v1/payroll/runs") or []}
    order = ["open", "submit", "approve", "handover"]
    for place, period, last in RUNS:
        run_id = f"PR-{period}-{place}"
        manager = MANAGER[place]
        if run_id not in runs:
            status, answer = step(f"open {run_id}", "POST", "/api/v1/payroll/runs",
                                  {"place_id": place, "period": period, "reason": f"gaji {period}"}, manager,
                                  kind="payroll run")
            if not ok(status):
                continue
            runs[run_id] = answer
        state = runs[run_id]["state"]
        target = order.index(last)
        if state == "DRAFT" and target >= 1:
            status, answer = step(f"submit {run_id}", "POST", f"/api/v1/payroll/runs/{run_id}/submission",
                                  {"reason": "slip sudah dicek kepala toko"}, manager, kind="payroll submit")
            state = answer["state"] if ok(status) else state
        if state == "SUBMITTED" and target >= 2:
            status, answer = step(f"approve {run_id}", "POST", f"/api/v1/payroll/runs/{run_id}/approve",
                                  {"reason": "diperiksa HR pusat, sesuai absensi"}, "andi", kind="payroll approve")
            state = answer["state"] if ok(status) else state
        if state == "APPROVED" and target >= 3:
            status, _ = call("GET", f"/api/v1/payroll/runs/{run_id}/finance-handover", token=login("andi"))
            if status == 404:
                step(f"hand {run_id} to finance", "POST", f"/api/v1/payroll/runs/{run_id}/finance-handover",
                     {"reason": "gaji Juli siap dibayar"}, "ratna", kind="payroll handover")

# ── phase 5: claims and grievances ─────────────────────────────────────────
CLAIM_TYPES = [("DINAS", "Uang harian dinas luar kota"), ("MEDIS", "Biaya berobat"),
               ("PERLENGKAPAN", "Perlengkapan toko")]
# code, filer (None = own login), posted on, lines, reason, outcome, sanction per line (partial)
CLAIMS = [
    ("ST-0103", None, "2026-09-23", [("LOKAL", "Ojek antar dokumen setoran ke bank", "2026-09-22", 35_000)],
     "antar dokumen setoran", "draft", None),
    ("ST-0105", "maya", "2026-09-19", [("TAKSI", "Taksi setor uang ke BCA Dago", "2026-09-18", 85_000),
                                        ("LOKAL", "Parkir bank", "2026-09-18", 10_000)],
     "setoran tunai hari Jumat", "submit", None),
    ("ST-0104", "maya", "2026-09-16", [("TAKSI", "Taksi ambil stok dari Toko 02", "2026-09-15", 95_000)],
     "ambil stok darurat dari Toko 02", "return", None),
    ("ST-0204", "lestari", "2026-08-22", [("DINAS", "Uang harian training di kantor pusat", "2026-08-20", 200_000),
                                           ("TAKSI", "Taksi pulang pergi kantor pusat", "2026-08-20", 120_000)],
     "training product knowledge di HO", "approve", None),
    ("ST-0203", "lestari", "2026-09-03", [("MEDIS", "Obat flu dan radang", "2026-09-02", 150_000)],
     "berobat radang tenggorokan", "reject", None),
    ("ST-0304", "intan", "2026-08-28", [("PERLENGKAPAN", "Lakban, kabel ties, double tape display", "2026-08-27", 245_000)],
     "perlengkapan ganti display 9.9", "pay", None),
    ("ST-0402", "hendra", "2026-09-10", [("TAKSI", "Taksi antar barang transfer ke Toko 01", "2026-09-09", 175_000)],
     "antar barang transfer antar toko", "approve", [150_000]),
    ("ST-0302", "intan", "2026-09-20", [("LOKAL", "Ojek beli uang receh", "2026-09-19", 40_000)],
     # Filed and submitted only. Withdrawing a claim is what this row did on
     # the first run, and the server then cannot read it back (see report):
     # every list that includes it answers 400.
     "tukar uang receh untuk kasir", "submit", None),
    ("HO-0002", None, "2026-09-12", [("DINAS", "Uang harian kunjungan toko Bandung", "2026-09-10", 400_000),
                                      ("TAKSI", "Taksi bandara - toko", "2026-09-10", 180_000)],
     "kunjungan merchandising ke toko Bandung", "submit", None),
    ("ST-0101", None, "2026-09-08", [("LOKAL", "Parkir dan tol kunjungan Toko 02", "2026-09-07", 60_000)],
     "kunjungan koordinasi ke Toko 02", "pay", None),
]
GRIEVANCE_TYPES = [("FASILITAS", "Fasilitas & keselamatan kerja"), ("UPAH", "Upah & tunjangan")]
# code, filer (None = own), type, subject, description, against, outcome
GRIEVANCES = [
    ("ST-0202", None, "JADWAL", "Shift siang terus tiga minggu berturut-turut",
     "Saya mendapat shift siang tiga minggu berturut-turut sementara rekan lain bergantian. Mohon rotasi yang adil.",
     None, None),
    ("ST-0203", None, "FASILITAS", "AC ruang istirahat rusak sejak awal bulan",
     "AC di ruang istirahat karyawan mati sejak 1 September, ruangan sangat panas saat jam istirahat.",
     None, "valid"),
    ("ST-0403", None, "PERLAKUAN", "Ditegur keras di depan pelanggan",
     "Saya ditegur dengan suara keras di depan pelanggan karena display belum rapi. Saya merasa dipermalukan.",
     "ST-0401", "investigate"),
    ("ST-0305", None, "UPAH", "Uang lembur Juli belum masuk slip",
     "Lembur tanggal 18 Juli belum tercantum di slip gaji Juli.", None, "invalid"),
    ("ST-0205", "lestari", "JADWAL", "Pembagian libur akhir pekan",
     "Citra meminta jatah libur Sabtu atau Minggu minimal sekali sebulan.", None, "withdraw"),
    ("HO-0008", "yusuf", "FASILITAS", "Forklift gudang sering mogok",
     "Forklift di gudang pusat mogok tiga kali minggu ini, pekerja mengangkat manual.", None, None),
]


def phase_money_and_voice(world):
    print("claim types")
    known = {row["code"] for row in get("/api/v1/expense-claim-types") or []}
    for code, name in CLAIM_TYPES:
        if code not in known:
            step(f"claim type {code}", "POST", "/api/v1/expense-claim-types", {"code": code, "name": name},
                 "admin", kind="claim type")

    print("expense claims")
    for code, filer, posted_on, lines, reason, outcome, sanction in CLAIMS:
        employee = world.id[code]
        place = world.place(code)
        listed = get(f"/api/v1/expense-claims?employee={employee}", "andi")
        if listed is None:
            continue  # unreadable, so it cannot be told apart from absent; never file twice
        existing = [row for row in listed if row["history"] and row["history"][0]["reason"] == reason]
        filer = filer or world.login_of(code)
        if existing:
            claim = existing[-1]
        else:
            body = {"lines": [{"type_code": t, "description": d, "spent_on": s, "claimed_minor": m}
                              for t, d, s, m in lines], "reason": reason, "posted_on": posted_on}
            if filer != world.login_of(code):
                body["employee_id"] = employee
            status, claim = step(f"claim {code} {reason}", "POST", "/api/v1/expense-claims", body, filer,
                                 kind="expense claim")
            if not ok(status):
                continue
        claim_id = claim["claim_id"]
        if claim["state"] == "DRAFT" and outcome != "draft" and not any(
                event["action"] == "RETURNED" for event in claim["history"]):
            status, answer = step(f"submit {claim['claim_number']}", "POST",
                                  f"/api/v1/expense-claims/{claim_id}/submission", {"reason": "mohon diganti"},
                                  filer, kind="claim submit")
            claim = answer if ok(status) else claim
        if claim["state"] != "SUBMITTED":
            continue
        if outcome == "withdraw":
            step(f"withdraw {claim['claim_number']}", "POST", f"/api/v1/expense-claims/{claim_id}/withdrawal",
                 {"reason": "sudah diganti dari kas kecil"}, filer, kind="claim withdraw")
        elif outcome == "return":
            step(f"return {claim['claim_number']}", "POST", f"/api/v1/expense-claims/{claim_id}/returnal",
                 {"reason": "lampirkan foto struk taksi"}, "andi", kind="claim return")
        elif outcome in ("approve", "pay", "reject"):
            body = {"approve": outcome != "reject",
                    "reason": "sesuai kebijakan klaim" if outcome != "reject"
                    else "rawat jalan ditanggung BPJS Kesehatan, bukan klaim kantor"}
            if outcome != "reject":
                # An approval names what it sanctions, line by line.
                amounts = sanction or [line["claimed_minor"] for line in claim["lines"]]
                body["lines"] = [{"line_id": line["line_id"], "sanctioned_minor": amount}
                                 for line, amount in zip(claim["lines"], amounts)]
            if sanction:
                body["reason"] = "taksi dibatasi Rp150.000 sesuai kebijakan"
            status, answer = step(f"{'approve' if outcome != 'reject' else 'reject'} {claim['claim_number']}",
                                  "POST", f"/api/v1/expense-claims/{claim_id}/decision", body, "andi",
                                  kind=f"claim {'approve' if outcome != 'reject' else 'reject'}",
                                  conflict_is_refusal=True)
            claim = answer if ok(status) else claim
        if outcome == "pay" and claim["state"] == "APPROVED":
            step(f"pay {claim['claim_number']}", "POST", f"/api/v1/expense-claims/{claim_id}/payout",
                 {"paid_on": max(posted_on, "2026-09-01") if posted_on >= "2026-09-01" else posted_on},
                 MANAGER[place] if place != "ho" else "andi", kind="claim pay")

    print("grievance types")
    known = {row["code"] for row in get("/api/v1/grievance-types") or []}
    for code, name in GRIEVANCE_TYPES:
        if code not in known:
            step(f"grievance type {code}", "POST", "/api/v1/grievance-types", {"code": code, "name": name},
                 "admin", kind="grievance type")

    print("grievances")
    listed = get("/api/v1/grievances", "andi")
    if listed is None:
        return
    on_file = {row["subject"]: row for row in listed}
    for code, filer, kind, subject, description, against, outcome in GRIEVANCES:
        filer = filer or world.login_of(code)
        row = on_file.get(subject)
        if row is None:
            body = {"type_code": kind, "subject": subject, "description": description}
            if filer != world.login_of(code):
                body["employee_id"] = world.id[code]
                body["reason"] = "disampaikan lisan kepada atasan"
            if against:
                body["against_employee"] = world.id[against]
            status, row = step(f"grievance {code} {subject[:40]}", "POST", "/api/v1/grievances", body, filer,
                               kind="grievance")
            if not ok(status):
                continue
        gid = row["grievance_id"]
        if row["state"] == "OPEN" and outcome == "withdraw":
            step(f"withdraw grievance {code}", "POST", f"/api/v1/grievances/{gid}/withdrawal",
                 {"reason": "sudah dibicarakan langsung dengan kepala toko"}, filer, kind="grievance withdraw")
            continue
        if row["state"] == "OPEN" and outcome in ("investigate", "valid", "invalid"):
            status, answer = step(f"investigate grievance {code}", "POST", f"/api/v1/grievances/{gid}/investigation",
                                  {"note": "wawancara pelapor dan dua rekan kerja, cek CCTV dan jadwal"}, "ratna",
                                  kind="grievance investigate")
            row = answer if ok(status) else row
        if row["state"] == "INVESTIGATED" and outcome in ("valid", "invalid"):
            step(f"resolve grievance {code} {outcome}", "POST", f"/api/v1/grievances/{gid}/resolution",
                 {"valid": outcome == "valid",
                  "detail": "AC diganti unit baru 15 Sep, GA menjadwalkan servis rutin" if outcome == "valid"
                  else "lembur 18 Juli dibayar di slip Juli baris lembur; pelapor sudah diberi penjelasan"},
                 "andi", kind="grievance resolve")

# ── phase 6: talent — requisitions to exits ────────────────────────────────
# place, position, headcount, need, candidate, start, kind, ends, base, reason, outcome
REQUISITIONS = [
    ("store-01", "Kasir", 1, "REPLACEMENT", "Sekar Ayu", "2026-10-19", "PKWT", "2027-10-18", 5_500_000,
     "pengganti Lukman yang mengundurkan diri", "APPROVE"),
    ("store-02", "Sales associate", 2, "ADDITION", "Rudi Hartanto", "2026-10-05", "PKWT", "2027-10-04", 5_450_000,
     "jam buka diperpanjang sampai 22.00 mulai Oktober", "APPROVE"),
    ("store-03", "Kasir", 1, "REPLACEMENT", "Wulan Sari", "2026-10-12", "PKWT", "2027-10-11", 5_500_000,
     "pengganti Kiki yang resign 15 September", None),
    ("store-04", "Staf gudang toko", 1, "ADDITION", "Bayu Firmansyah", "2026-10-12", "PKWT", "2027-10-11", 5_400_000,
     "volume penerimaan barang naik", "RETURN"),
    ("store-02", "Visual merchandiser", 1, "ADDITION", "Laras Ayuningtyas", "2026-10-12", "PKWTT", None, 7_000_000,
     "display toko perlu ditangani khusus", "REJECT"),
    ("store-04", "Kasir", 1, "ADDITION", "Nadia Putri", "2026-10-05", "PKWT", "2027-10-04", 5_500_000,
     "kasir kedua untuk akhir pekan", "OPEN"),
]
DECISION_REASON = {
    "APPROVE": "sesuai rencana tenaga kerja semester II",
    "RETURN": "lampirkan data penerimaan barang 3 bulan terakhir",
    "REJECT": "visual merchandiser ditangani tim area, bukan per toko",
    "OPEN": "sesuai rencana tenaga kerja semester II",
}
# candidate of the requisition -> applicants: name, phone, source, referrer, path
APPLICANTS = {
    "Sekar Ayu": [
        ("Sekar Ayu", "0812-2211-3401", "WALK_IN", None, "offer"),
        ("Taufik Hidayat", "0813-4410-2290", "JOBSTREET", None, "shortlist"),
        ("Melati Suryani", "0857-3301-7788", "REFERRAL", "ST-0105", "new"),
        ("Andre Wijaya", "0821-9087-1123", "INSTAGRAM", None, "fail"),
    ],
    "Rudi Hartanto": [
        ("Rudi Hartanto", "0812-7765-4410", "REFERRAL", "ST-0204", "hire"),
        ("Nabila Zahra", "0878-1122-9034", "JOBSTREET", None, "declined"),
        ("Fadli Rahman", "0819-5543-2210", "WALK_IN", None, "scheduled"),
        ("Siti Nurhaliza", "0852-6611-7702", "KALIBRR", None, "new"),
    ],
}
PLANS = [
    ("store-01", "Kasir", "2026-H2", 4, 22_000_000), ("store-01", "Sales associate", "2026-H2", 3, 16_350_000),
    ("store-02", "Sales associate", "2026-H2", 5, 27_250_000), ("store-03", "Kasir", "2026-H2", 3, 16_500_000),
    ("store-04", "Sales associate", "2026-H2", 3, 16_200_000), ("ho", "Payroll specialist", "2026-H2", 1, 10_500_000),
]
# code, filer, kind, props, effective, reason, outcome
CHANGES = [
    ("ST-0102", "maya", "PROMOTION", [("position", "Supervisor kasir"), ("grade", "G3"), ("base_minor", 6_800_000)],
     "2026-10-01", "kasir terbaik 3 bulan berturut-turut, siap memimpin shift", "approve"),
    ("ST-0402", "hendra", "SALARY", [("base_minor", 6_400_000)], "2026-10-01",
     "penyesuaian gaji setelah 2 tahun, kinerja konsisten", "approve"),
    ("ST-0304", "intan", "TRANSFER", [("place_id", "store-05")], "2026-10-01",
     "Toko 05 butuh visual merchandiser untuk renovasi", "approve"),
    ("ST-0104", "maya", "TRANSFER", [("place_id", "store-04")], "2026-10-15",
     "domisili pindah ke dekat Toko 04", None),
    ("ST-0204", "lestari", "PROMOTION", [("position", "Supervisor kasir"), ("grade", "G3")], "2026-11-01",
     "calon supervisor untuk jam buka baru", None),
    ("ST-0302", "intan", "SALARY", [("base_minor", 5_900_000)], "2026-10-01",
     "kenaikan gaji karena beban kasir bertambah", "reject"),
    ("ST-0205", "lestari", "TRANSFER", [("place_id", "store-03")], "2026-10-15",
     "mengisi kekosongan kasir Toko 03", "withdraw"),
    ("ST-0206", "lestari", "SEPARATION", [], "2026-08-31", "mengundurkan diri, pindah ke luar kota", "approve"),
    ("ST-0305", "intan", "SEPARATION", [], "2026-09-15", "mengundurkan diri, melanjutkan kuliah", "approve"),
    ("ST-0107", "maya", "SEPARATION", [], "2026-10-15", "kontrak tidak diperpanjang atas permintaan sendiri", None),
]
TRAINING = [
    ("Service Excellence Batch 3", "2026-07-22", "Kantor pusat, Jakarta", 750_000,
     ["ST-0103", "ST-0104", "ST-0203", "ST-0205", "ST-0303", "ST-0403"], True),
    ("Product Knowledge Koleksi Fall/Winter 2026", "2026-08-20", "Kantor pusat, Jakarta", 350_000,
     ["ST-0204", "ST-0304", "ST-0402", "ST-0105"], True),
    ("Kasir: Uang Palsu & Transaksi EDC", "2026-09-15", "Toko 03", 400_000,
     ["ST-0302", "ST-0105", "ST-0202", "ST-0102"], True),
    ("K3 & Penggunaan APAR", "2026-10-08", "Toko 01", 1_200_000, ["ST-0106", "ST-0102", "ST-0103"], False),
    ("Leadership untuk Kepala Toko", "2026-10-21", "Kantor pusat, Jakarta", 2_500_000,
     ["ST-0101", "ST-0201", "ST-0301", "ST-0401"], False),
]


def phase_talent(world):
    print("requisitions")
    proposals = {(row["place_id"], row["versions"][-1]["candidate_name"]): row
                 for row in get("/api/v1/hire-proposals", "andi") or []}
    approved = {}
    for place, position, headcount, need, candidate, start, kind, ends, base, reason, outcome in REQUISITIONS:
        row = proposals.get((place, candidate))
        if row is None:
            status, row = step(f"requisition {place} {position} ({candidate})", "POST", "/api/v1/hire-proposals", {
                "place_id": place, "position": position, "headcount": headcount, "need": need,
                "candidate_name": candidate, "start_on": start, "contract_kind": kind, "contract_ends_on": ends,
                "base_pay_minor": base, "reason": reason}, MANAGER[place], kind="requisition")
            if not ok(status):
                continue
        if row["state"] == "PROPOSED" and outcome:
            decision = "APPROVE" if outcome == "OPEN" else outcome
            status, answer = step(f"{decision} requisition {candidate}", "POST",
                                  f"/api/v1/hire-proposals/{row['id']}/decision",
                                  {"decision": decision, "reason": DECISION_REASON[outcome]}, "andi",
                                  kind=f"requisition {decision.lower()}")
            row = answer if ok(status) else row
        if outcome == "OPEN" and row["state"] == "APPROVED" and not row.get("employee_ids"):
            step(f"open employment ST-0404 for {candidate}", "POST", f"/api/v1/hire-proposals/{row['id']}/employment",
                 {"employee_code": "ST-0404", "reason": "kandidat menerima, mulai 5 Oktober"}, "ratna",
                 kind="employment opened")
        if row["state"] in ("APPROVED", "FILLED"):
            approved[candidate] = row

    print("staffing plans")
    have = {(row["place_id"], row["position"], row["span"]) for row in get("/api/v1/recruitment/plans") or []}
    for place, position, span, headcount, cost in PLANS:
        if (place, position, span) not in have:
            step(f"plan {place} {position} {span}", "POST", "/api/v1/recruitment/plans", {
                "place_id": place, "position": position, "span": span, "headcount": headcount,
                "cost_minor": cost, "reason": "rencana tenaga kerja semester II"}, "ratna", kind="staffing plan")

    print("applicants, interviews and offers")
    applicants = {(row["proposal_id"], row["name"]): row for row in get("/api/v1/recruitment/applicants") or []}
    offers = {row["applicant_id"]: row for row in get("/api/v1/recruitment/offers") or []}
    for requisition, people in APPLICANTS.items():
        proposal = approved.get(requisition)
        if proposal is None:
            continue
        place = proposal["place_id"]
        manager = MANAGER[place]
        interviewer = world.id[MANAGER_CODE[place]]
        version = proposal["versions"][-1]
        for index, (name, phone, source, referrer, path) in enumerate(people):
            row = applicants.get((proposal["id"], name))
            if row is None:
                body = {"name": name, "phone": phone, "source": source}
                if referrer:
                    body["referrer_employee_id"] = world.id[referrer]
                status, row = step(f"applicant {name}", "POST",
                                   f"/api/v1/recruitment/proposals/{proposal['id']}/applicants", body, manager,
                                   kind="applicant")
                if not ok(status):
                    continue
            aid = row["id"]

            def move(stage, note=None):
                nonlocal row
                status, answer = step(f"{name} → {stage}", "POST", f"/api/v1/recruitment/applicants/{aid}/stage",
                                      {"stage": stage, "note": note, "reason": "hasil seleksi"}, "ratna",
                                      kind="applicant stage")
                row = answer if ok(status) else row

            if path == "new":
                continue
            if row["stage"] == "NEW":
                move("SHORTLIST", "CV sesuai, pengalaman ritel")
            if path == "shortlist":
                continue
            if row["stage"] == "SHORTLIST":
                move("INTERVIEW")
            interviews = get(f"/api/v1/recruitment/applicants/{aid}/interviews") or []
            if not interviews:
                when = (datetime(2026, 9, 14 + index * 2, 10, 0, tzinfo=JAKARTA) if path != "scheduled"
                        else datetime(2026, 9, 29, 14, 0, tzinfo=JAKARTA))
                status, answer = step(f"interview {name}", "POST", f"/api/v1/recruitment/applicants/{aid}/interviews",
                                      {"scheduled_at": when.astimezone(timezone.utc).isoformat(),
                                       "interviewer_employee_id": interviewer, "reason": "wawancara kepala toko"},
                                      manager, kind="interview")
                interviews = [answer] if ok(status) else []
            if path == "scheduled" or not interviews:
                continue
            interview = interviews[-1]
            if interview["result"] == "SCHEDULED":
                passed = path != "fail"
                ratings = ({"komunikasi": 4, "pelayanan": 4 + index % 2, "kerapian": 4} if passed
                           else {"komunikasi": 2, "pelayanan": 2, "kerapian": 3})
                step(f"interview result {name}", "POST", f"/api/v1/recruitment/interviews/{interview['id']}/result",
                     {"result": "PASS" if passed else "FAIL", "ratings": ratings,
                      "note": "ramah, paham POS" if passed else "belum siap kerja shift",
                      "reason": "hasil wawancara"}, manager, kind="interview result")
            if path == "fail":
                if row["stage"] == "INTERVIEW":
                    move("REJECTED", "tidak lolos wawancara")
                continue
            offer = offers.get(aid)
            if offer is None:
                status, offer = step(f"offer {name}", "POST", f"/api/v1/recruitment/applicants/{aid}/offer", {
                    "base_minor": version["base_pay_minor"], "grade": "G1", "starts_on": version["start_on"],
                    "term": "PKWT 12 bulan", "reason": "lolos wawancara"}, "ratna", kind="offer")
                if not ok(status):
                    continue
            if row["stage"] == "INTERVIEW":
                move("OFFER", "penawaran dikirim")
            if offer["state"] == "WAITING" and path in ("hire", "declined"):
                status, answer = step(f"offer {name} {'accepted' if path == 'hire' else 'declined'}", "POST",
                                      f"/api/v1/recruitment/offers/{offer['id']}/decision",
                                      {"accepted": path == "hire",
                                       "reason": "kandidat menandatangani surat penawaran" if path == "hire"
                                       else "kandidat menerima tawaran di tempat lain"}, "andi",
                                      kind="offer decision")
                offer = answer if ok(status) else offer
            if path == "hire" and offer["state"] == "ACCEPTED" and not offer.get("hired_employee_id"):
                step(f"hire {name}", "POST", f"/api/v1/recruitment/offers/{offer['id']}/hire",
                     {"reason": "mulai kerja sesuai penawaran"}, "ratna", kind="hired from offer")

    print("employment change proposals")
    for code, filer, kind, props, effective, reason, outcome in CHANGES:
        employee = world.id[code]
        mine = [row for row in get(f"/api/v1/employees/{employee}/change-proposals") or []
                if row["kind"] == kind and row["reason"] == reason]
        if mine:
            row = mine[-1]
        else:
            body = {"kind": kind, "effective_on": effective, "reason": reason,
                    "props": [{"field": f, **({"to_minor": v} if isinstance(v, int) else {"to_text": v})}
                              for f, v in props]}
            status, row = step(f"{kind} {code}", "POST", f"/api/v1/employees/{employee}/change-proposals", body,
                               filer, kind="change proposal")
            if not ok(status):
                continue
        if row["state"] != "PENDING" or outcome is None:
            continue
        if outcome == "withdraw":
            step(f"withdraw {kind} {code}", "POST", f"/api/v1/change-proposals/{row['id']}/withdrawal", None,
                 filer, kind="change withdraw")
        else:
            step(f"{outcome} {kind} {code}", "POST", f"/api/v1/change-proposals/{row['id']}/decision",
                 {"approved": outcome == "approve",
                  "reason": "disetujui HR pusat" if outcome == "approve" else "tunggu penilaian kinerja Desember",
                  "note": None}, "andi", kind=f"change {outcome}")
    world.refresh()

def hired_from_offers(world):
    """The records recruitment minted, by the name they were hired under."""
    applicants = {row["id"]: row for row in get("/api/v1/recruitment/applicants") or []}
    minted = {}
    for offer in get("/api/v1/recruitment/offers") or []:
        if offer.get("hired_employee_id") and offer["applicant_id"] in applicants:
            applicant = applicants[offer["applicant_id"]]
            minted[applicant["name"]] = (offer["hired_employee_id"], applicant["place_id"], offer)
    return minted


def phase_growth(world):
    print("new joiners' records")
    joiners = [("ST-0404", "Nadia Putri", "store-04", "Kasir", "2026-10-05", "2027-10-04", 5_500_000)]
    for name, (employee, place, offer) in hired_from_offers(world).items():
        joiners.append((world.code_of.get(employee, employee), name, place, "Sales associate", offer["starts_on"],
                        "2027-10-04", offer["base_minor"]))
    world.refresh()
    for index, (code, name, place, position, start, ends, base) in enumerate(joiners):
        row = world.rows.get(code)
        if row is None:
            continue
        employee = row["employee_id"]
        if not row.get("full_name"):
            step(f"personal data {name}", "POST", f"/api/v1/employees/{employee}/personal-data", {
                "full_name": name, "nik": f"3299{index + 201:012d}", "birth_date": f"{2000 + index}-03-1{index}",
                "address": f"Jl. Kenanga No. {index + 3}, Bekasi"}, "ratna", kind="joiner record")
        if not row.get("position"):
            step(f"contract {name}", "POST", f"/api/v1/employees/{employee}/contracts", {
                "kind": "PKWT", "starts_on": start, "ends_on": ends, "position": position, "grade": "G1",
                "reason": "kontrak pertama sesuai penawaran"}, "ratna", kind="joiner record")
        if not get(f"/api/v1/employees/{employee}/pay"):
            step(f"pay {name}", "POST", f"/api/v1/employees/{employee}/pay", {
                "effective_from": start, "base_minor": base,
                "fixed_allowances": [{"code": "TRANSPORT", "minor": 350_000}, {"code": "MAKAN", "minor": 600_000}],
                "reason": "sesuai surat penawaran"}, "ratna", kind="joiner record")
    world.refresh()

    print("onboarding and separation checklists")
    for code in ("ST-0404", "ST-0106"):
        employee = world.id.get(code)
        if employee and not [t for t in get(f"/api/v1/employees/{employee}/lifecycle-tasks") or []
                             if t["kind"] == "ONBOARDING"]:
            step(f"open onboarding {code}", "POST", f"/api/v1/employees/{employee}/lifecycle-tasks",
                 {"kind": "ONBOARDING"}, "ratna", kind="checklist opened")
    # who closes which task, per person: template ids to close
    plan = {
        "ST-0106": {"kontrak", "esign", "dok", "size", "bpjs", "seragam", "akun", "roster", "training"},
        "ST-0404": {"kontrak", "bpjs"},
        "ST-0206": {"serah", "seragam-kembali", "akun-off", "exit", "fnf"},
        "ST-0305": {"serah", "seragam-kembali"},
    }
    for name, (employee, _, _) in hired_from_offers(world).items():
        plan[employee] = {"kontrak", "akun", "bpjs"}
    for key, templates in plan.items():
        employee = world.id.get(key, key)
        code = world.code_of.get(employee, key)
        place = world.place(code) if code in world.rows else None
        for task in get(f"/api/v1/employees/{employee}/lifecycle-tasks") or []:
            if task["state"] != "PENDING" or task["template_id"] not in templates:
                continue
            if task["owner"] == "EMPLOYEE":
                who, path = world.login_of(code), f"/api/v1/employees/me/lifecycle-tasks/{task['template_id']}/completion"
            else:
                who = {"IT": "admin", "HEAD_OFFICE": "ratna"}.get(task["owner"]) or MANAGER.get(place or "", "andi")
                path = f"/api/v1/lifecycle/tasks/{task['id']}/completion"
            if not who:
                continue
            step(f"{code} {task['kind'].lower()} · {task['template_id']}", "POST", path,
                 {"reason": "sudah dikerjakan"}, who, kind="checklist task done", quiet=True)
    print(f"  tasks closed +{counts['checklist task done']}")

    print("performance")
    periods = ["2026-06-01", "2026-07-01", "2026-08-01"]
    people = [spec[0] for spec in NEW_PEOPLE] + [spec[0] for spec in EXISTING] + HO_ROSTERED
    for code in people:
        employee = world.id[code]
        place = world.place(code)
        have = {row["period"] for row in get(f"/api/v1/employees/{employee}/performance") or []}
        for period in periods:
            if period in have or (code.startswith("HO-") and period == "2026-06-01"):
                continue
            kpi = 82 + h("kpi", code, period, mod=36)
            score = 3 + (kpi >= 100) + (kpi >= 110) - (kpi < 90)
            if code in MANAGER_CODE.values() or place == "ho":
                who = "ratna" if code == "HO-0001" else "andi"
            else:
                who = MANAGER[place]
            note = ("melampaui target, pertahankan" if kpi >= 110 else "sesuai target" if kpi >= 100
                    else "perlu pendampingan penjualan" if kpi < 90 else "mendekati target")
            step(f"score {code} {period}", "PUT", f"/api/v1/employees/{employee}/performance/{period}",
                 {"kpi_pct": float(kpi), "manager_score": min(score, 5), "note": note,
                  "reason": "penilaian bulanan"}, who, kind="performance score", quiet=True, fallback="andi")
    print(f"  scores +{counts['performance score']}")

    print("training")
    programs = {row["title"]: row for row in get("/api/v1/training-programs") or []}
    for title, on, where, cost, nominees, done in TRAINING:
        program = programs.get(title)
        if program is None:
            status, answer = step(f"program {title}", "POST", "/api/v1/training-programs", {
                "title": title, "on_date": on, "place": where, "cost_minor": cost,
                "reason": "kalender pelatihan semester II"}, "ratna", kind="training program")
            if not ok(status):
                continue
            program = next(row for row in answer if row["title"] == title)
        if program["participants"] < len(nominees):
            for code in nominees:
                place = world.place(code)
                who = "andi" if code in MANAGER_CODE.values() else MANAGER[place]
                step(f"nominate {code} → {title}", "POST", f"/api/v1/training-programs/{program['id']}/participants",
                     {"employee_id": world.id[code], "reason": "direkomendasikan atasan"}, who,
                     kind="training nomination", quiet=True, fallback="andi")
        if done and program["state"] != "DONE":
            step(f"complete {title}", "POST", f"/api/v1/training-programs/{program['id']}/completion", None, "ratna",
                 kind="training done")
    print(f"  nominations +{counts['training nomination']}")

    print("uniforms")
    for code in [spec[0] for spec in NEW_PEOPLE] + [spec[0] for spec in EXISTING]:
        employee = world.id[code]
        place = world.place(code)
        if get(f"/api/v1/employees/{employee}/uniform-issuances"):
            continue
        joined = next((spec[6] for spec in NEW_PEOPLE if spec[0] == code), "2026-01-15")
        issued = max(joined, "2026-01-15")
        who = "andi" if code in MANAGER_CODE.values() else MANAGER[place]
        step(f"uniform {code}", "POST", f"/api/v1/employees/{employee}/uniform-issuances",
             {"issued_on": issued, "sets": 2, "reason": "jatah seragam tahunan"}, who, kind="uniform issuance",
             quiet=True, fallback="andi")
    print(f"  issuances +{counts['uniform issuance']}")

    print("exits")
    for code, complete, final_pay, settle in [("ST-0206", True, 2_380_000, True), ("ST-0305", False, 3_150_000, False)]:
        employee = world.id[code]
        interviews = get(f"/api/v1/exit-interviews?employee={employee}") or []
        if not interviews:
            status, answer = step(f"exit interview {code}", "POST", "/api/v1/exit-interviews",
                                  {"employee_id": employee}, "ratna", kind="exit interview")
            interviews = [answer] if ok(status) else []
        if complete and interviews and interviews[-1]["state"] == "PENDING":
            step(f"complete exit interview {code}", "POST",
                 f"/api/v1/exit-interviews/{interviews[-1]['exit_id']}/completion",
                 {"stance": "EXIT_CONFIRMED",
                  "summary": "Pindah ikut keluarga ke Surabaya. Puas dengan tim, menyarankan jadwal shift diumumkan "
                             "dua minggu sebelumnya."}, "ratna", kind="exit interview done")
        statements = get(f"/api/v1/full-and-final-statements?employee={employee}") or []
        if not [s for s in statements if s["state"] != "CANCELLED"]:
            status, answer = step(f"full & final {code}", "POST", "/api/v1/full-and-final-statements", {
                "employee_id": employee, "transaction_on": "2026-09-10" if settle else "2026-09-30",
                "final_pay_minor": final_pay, "assets": []}, "ratna", kind="full & final")
            statements = [answer] if ok(status) else []
        live = [s for s in statements if s["state"] == "DRAFT"]
        if settle and live:
            step(f"settle full & final {code}", "POST",
                 f"/api/v1/full-and-final-statements/{live[-1]['fnf_id']}/settlement", None, "andi",
                 kind="full & final settled")


# ── main ───────────────────────────────────────────────────────────────────
PHASES = []


def main() -> int:
    only = set(sys.argv[1:])
    for name in ("admin", "andi", "ratna"):
        if login(name) is None:
            sys.exit(f"! cannot sign in as {name}")
    world = World()
    for phase in PHASES:
        if only and phase.__name__.removeprefix("phase_") not in only:
            continue
        phase(world)
    print()
    print("counts:", json.dumps(dict(sorted(counts.items())), ensure_ascii=False, indent=2))
    for line in sorted(notes):
        print("note:", line)
    print(f"refusals ({len(refusals)}):")
    for line in refusals:
        print("  -", line)
    return 1 if refusals else 0


if __name__ == "__main__":
    PHASES.extend(value for key, value in list(globals().items()) if key.startswith("phase_"))
    raise SystemExit(main())
