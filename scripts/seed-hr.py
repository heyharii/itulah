#!/usr/bin/env python3
"""Give one employee a lived-in HR record, so the employee app has something
on every screen: holidays, leave types and balances, a roster, three months of
punches, leave in every state, overtime in every state, corrections, payroll
details, a pay agreement, approved payslips and a few notifications.

    ITULAH_API=http://127.0.0.1:8160 ITULAH_DB=itulah_employee_dev \\
    ITULAH_ADMIN_PASSWORD=... ITULAH_EMPLOYEE_PASSWORD=... \\
    ITULAH_SEED_PASSWORD=... python3 scripts/seed-hr.py

Run `seed-people.py` first, and bind a login to the employee (`--login`,
default `employee`, bound to `--code`, default HO-0007).

Everything goes through the API except two things the API cannot do:
punches for past days (the app route only stamps "now") and notifications
(nothing in HR raises one). Both are written in the exact shape the server
writes them. `ITULAH_SEED_PASSWORD` is given to a second login, `ratih`,
because a payroll run and a correction must be decided by somebody other
than whoever filed them.

Re-running is safe: every write that already happened answers 409 and is
reported as `=`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

API = os.environ.get("ITULAH_API", "http://127.0.0.1:8160").rstrip("/")
DB = os.environ.get("ITULAH_DB", "itulah_employee_dev")
JAKARTA = timezone(timedelta(hours=7))

HOLIDAYS_2026 = [
    ("2026-01-01", "Tahun Baru Masehi", "NATIONAL"),
    ("2026-01-16", "Isra Mikraj", "NATIONAL"),
    ("2026-02-17", "Tahun Baru Imlek", "NATIONAL"),
    ("2026-03-18", "Cuti Bersama Idul Fitri", "CUTI_BERSAMA"),
    ("2026-03-19", "Hari Suci Nyepi", "NATIONAL"),
    ("2026-03-20", "Idul Fitri", "NATIONAL"),
    ("2026-03-21", "Idul Fitri", "NATIONAL"),
    ("2026-03-23", "Cuti Bersama Idul Fitri", "CUTI_BERSAMA"),
    ("2026-04-03", "Wafat Yesus Kristus", "NATIONAL"),
    ("2026-05-01", "Hari Buruh", "NATIONAL"),
    ("2026-05-14", "Kenaikan Yesus Kristus", "NATIONAL"),
    ("2026-05-27", "Idul Adha", "NATIONAL"),
    ("2026-05-31", "Hari Raya Waisak", "NATIONAL"),
    ("2026-06-01", "Hari Lahir Pancasila", "NATIONAL"),
    ("2026-06-16", "Tahun Baru Islam", "NATIONAL"),
    ("2026-08-17", "Hari Kemerdekaan RI", "NATIONAL"),
    ("2026-08-25", "Maulid Nabi Muhammad", "NATIONAL"),
    ("2026-12-24", "Cuti Bersama Natal", "CUTI_BERSAMA"),
    ("2026-12-25", "Hari Raya Natal", "NATIONAL"),
]

ROSTER_FROM = date(2026, 7, 1)
ROSTER_TO = date(2026, 10, 18)
CLOSED_MONTHS = ["2026-07", "2026-08"]

LATE = {"2026-07-08": 504, "2026-08-11": 511, "2026-09-09": 498}
EARLY_LEAVE = {"2026-08-06": 980}
ARRIVAL_ONLY = {"2026-09-17", "2026-08-26"}
NO_PUNCHES = {"2026-09-22"}
OVERTIME_DEPARTURE = {"2026-07-25": 1150, "2026-08-14": 1120}

refusals: list[str] = []


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


def step(label, method, path, body, token):
    status, answer = call(method, path, body, token)
    if status in (200, 201, 204):
        print(f"  + {label}")
    elif status == 409:
        print(f"  = {label} ({message(answer)})")
    else:
        print(f"  ! {label}: {status} {message(answer)}")
        refusals.append(f"{label}: {status} {message(answer)}")
    return status, answer


def message(answer):
    if isinstance(answer, dict):
        return answer.get("error") or answer.get("message") or json.dumps(answer)[:160]
    return str(answer)[:160]


def login(username, password):
    status, body = call("POST", "/api/v1/auth/login", {"username": username, "password": password})
    if status != 200:
        sys.exit(f"! cannot sign in as {username}: {status} {message(body)}")
    return body["token"]


def psql(sql):
    subprocess.run(["psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], check=True)


def days(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def jitter(day, spread):
    return int(hashlib.sha256(day.isoformat().encode()).hexdigest(), 16) % spread


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--login", default="employee")
    parser.add_argument("--code", default="HO-0007")
    arguments = parser.parse_args()

    admin = login("admin", os.environ["ITULAH_ADMIN_PASSWORD"])
    me = login(arguments.login, os.environ["ITULAH_EMPLOYEE_PASSWORD"])
    today = datetime.now(JAKARTA).date()

    _, directory = call("GET", "/api/v1/employees?limit=500", token=admin)
    by_code = {row["employee_code"]: row["employee_id"] for row in directory["rows"]}
    employee = by_code[arguments.code]
    print(f"seeding {arguments.code} ({employee}) as seen by '{arguments.login}'")

    print("second approver")
    seed_password = os.environ["ITULAH_SEED_PASSWORD"]
    step("login ratih", "POST", "/api/v1/auth/users",
         {"username": "ratih", "display_name": "Ratih Kusuma", "password": seed_password, "role": "ADMIN"}, admin)
    step("bind ratih to HO-0004", "POST", f"/api/v1/employees/{by_code['HO-0004']}/account",
         {"username": "ratih", "reason": "Seeded development account for this person"}, admin)
    ratih = login("ratih", seed_password)

    print("holidays")
    step("calendar 2026", "POST", "/api/v1/holiday-calendars", {
        "year": 2026, "reason": "SKB tiga menteri 2026",
        "holidays": [{"date": d, "name": n, "kind": k} for d, n, k in HOLIDAYS_2026],
    }, admin)
    holidays = {d for d, _, _ in HOLIDAYS_2026}

    print("leave types and policy")
    for body in [
        {"code": "CUTI_TAHUNAN", "name": "Cuti Tahunan", "backing": "BALANCE", "max_days": None,
         "payment": "FULL", "requires_evidence": False},
        {"code": "CUTI_SAKIT", "name": "Cuti Sakit", "backing": "AS_CERTIFIED", "max_days": None,
         "payment": "FULL", "requires_evidence": True},
        {"code": "CUTI_MENIKAH", "name": "Cuti Menikah", "backing": "PER_OCCURRENCE", "max_days": 3,
         "payment": "FULL", "requires_evidence": False},
    ]:
        step(f"type {body['code']}", "POST", "/api/v1/leave-types", body, admin)
    step("leave policy v1", "POST", "/api/v1/leave-policy", {
        "version": 1, "effective_from": "2026-01-01", "annual_days": 12, "accrual": "UP_FRONT",
        "carry_forward_days": 6, "carry_forward_expires_on": "03-31", "protected_leave": "CONTINUES",
    }, admin)
    for code, employee_id in sorted(by_code.items()):
        step(f"12 days annual leave for {code}", "POST", f"/api/v1/employees/{employee_id}/leave-balances", {
            "entry_id": f"alloc-2026-{employee_id}", "leave_type": "CUTI_TAHUNAN",
            "on": "2026-01-01", "event": "ALLOCATION", "days": 12, "expires_on": None,
        }, admin)

    print("attendance policy, shift and roster")
    step("attendance policy", "POST", "/api/v1/attendance-policy", {
        "effective_from": "2025-01-01", "late_grace_minutes": 10, "early_leave_grace_minutes": 10,
        "overtime_minimum_minutes": 30, "duplicate_punch_window_minutes": 2, "reason": "kebijakan awal",
    }, admin)
    step("shift PAGI", "POST", "/api/v1/attendance-shifts",
         {"id": "PAGI", "name": "Pagi", "starts_at": "08:00", "ends_at": "17:00", "unpaid_break_minutes": 60}, admin)
    scheduled = []
    for day in days(ROSTER_FROM, ROSTER_TO):
        iso = day.isoformat()
        if iso in holidays:
            body = {"on_date": iso, "plan": "PUBLIC_HOLIDAY", "reason": "hari libur nasional"}
        elif day.weekday() == 6:
            body = {"on_date": iso, "plan": "REST_DAY", "reason": "libur mingguan"}
        else:
            body = {"on_date": iso, "plan": "SCHEDULED", "shift_id": "PAGI", "reason": "jadwal bulanan"}
            scheduled.append(day)
        status, answer = call("POST", f"/api/v1/employees/{employee}/roster", body, admin)
        if status not in (200, 201, 409):
            refusals.append(f"roster {iso}: {status} {message(answer)}")
    print(f"  + {len(scheduled)} scheduled days, {ROSTER_FROM} to {ROSTER_TO}")

    print("overtime")
    step("overtime policy v1", "POST", "/api/v1/overtime-policy",
         {"version": 1, "max_per_day_minutes": 240, "max_per_week_minutes": 1080, "reason": "PP 35/2021"}, admin)
    orders = [
        ("OT-2026-0001", "2026-07-25", 120, "stok opname gudang", True),
        ("OT-2026-0002", "2026-08-14", 90, "bongkar kontainer susulan", True),
        ("OT-2026-0003", "2026-08-28", 120, "persiapan promo akhir bulan", False),
        ("OT-2026-0004", "2026-09-26", 120, "penerimaan barang musim baru", None),
        ("OT-2026-0005", "2026-10-03", 90, "stok opname kuartal", None),
    ]
    for order_id, on, minutes, reason, _ in orders:
        step(f"order {order_id}", "POST", f"/api/v1/employees/{employee}/overtime-orders",
             {"order_id": order_id, "on_date": on, "day_kind": "WORKING", "planned_minutes": minutes, "reason": reason},
             admin)
    for order_id, _, _, _, agreed in orders:
        if agreed is not None:
            step(f"{'agree' if agreed else 'decline'} {order_id}", "POST",
                 f"/api/v1/employees/me/overtime-orders/{order_id}/consent",
                 {"agreed": agreed, "reason": "bersedia lembur" if agreed else "ada keperluan keluarga"}, me)

    print("leave")
    requests = [
        ("LV-2026-001", "CUTI_TAHUNAN", "2026-07-13", "2026-07-15", "acara keluarga di Solo", None, "approve"),
        ("LV-2026-002", "CUTI_SAKIT", "2026-08-20", "2026-08-20", "demam, istirahat dokter", "surat-dokter-0820.pdf", "approve"),
        ("LV-2026-003", "CUTI_TAHUNAN", "2026-09-04", "2026-09-04", "urusan bank", None, "reject"),
        ("LV-2026-004", "CUTI_TAHUNAN", "2026-10-05", "2026-10-06", "menghadiri wisuda adik", None, None),
        ("LV-2026-005", "CUTI_TAHUNAN", "2026-11-02", "2026-11-02", "perpanjang SIM", None, "withdraw"),
    ]
    leave_days: dict[str, str] = {}
    for request_id, kind, start, end, reason, evidence, outcome in requests:
        step(f"file {request_id}", "POST", "/api/v1/employees/me/leave-requests", {
            "request_id": request_id, "leave_type": kind, "from_date": start, "to_date": end,
            "rest_days": [], "evidence": evidence, "reason": reason,
        }, me)
        if outcome in ("approve", "reject"):
            step(f"{outcome} {request_id}", "POST", f"/api/v1/employees/{employee}/leave-requests/{request_id}/{outcome}",
                 {"reason": "disetujui atasan" if outcome == "approve" else "stok opname, jadwal penuh"}, admin)
        if outcome == "withdraw":
            step(f"withdraw {request_id}", "POST", f"/api/v1/employees/me/leave-requests/{request_id}/withdraw",
                 {"reason": "ditarik oleh pemohon"}, me)
        if outcome == "approve":
            for day in days(date.fromisoformat(start), date.fromisoformat(end)):
                leave_days[day.isoformat()] = request_id

    print("punches")
    rows = []
    for day in scheduled:
        iso = day.isoformat()
        if day > today or iso in leave_days or iso in NO_PUNCHES:
            continue
        arrival = LATE.get(iso, 465 + jitter(day, 19))
        punches = [("IN", arrival)]
        if day < today and iso not in ARRIVAL_ONLY:
            departure = OVERTIME_DEPARTURE.get(iso) or EARLY_LEAVE.get(iso) or 1020 + jitter(day, 22)
            punches.append(("OUT", departure))
        for direction, minute in punches:
            recorded = datetime(day.year, day.month, day.day, tzinfo=JAKARTA) + timedelta(minutes=minute)
            punch_id = f"app-{employee}-{day:%Y%m%d}0-{minute:04d}-{direction}"
            rows.append(
                f"('{punch_id}','{employee}','ho','EMPLOYEE_APP',NULL,NULL,'{direction}','{iso}',0,{minute},"
                f"'{recorded.astimezone(timezone.utc).isoformat()}','OK')"
            )
    psql(
        "INSERT INTO attendance_punch (id, employee_id, place_id, source, terminal_id, method, direction,"
        " business_date, day_offset, minute, recorded_at, clock_quality) VALUES "
        + ",".join(rows) + " ON CONFLICT (id) DO NOTHING"
    )
    print(f"  + {len(rows)} punches")

    print("corrections")
    filed = []
    for iso, request_id in sorted(leave_days.items()):
        filed.append(({"business_date": iso, "effect": "APPROVED_LEAVE", "leave_id": request_id,
                       "reason": f"cuti {request_id}"}, True))
    filed.append(({"business_date": "2026-08-26", "effect": "DEPARTURE", "departure": "17:05",
                   "reason": "lupa absen pulang, mesin antre"}, True))
    for body, approve in filed:
        status, answer = step(f"file {body['effect']} {body['business_date']}", "POST",
                              "/api/v1/employees/me/attendance-corrections", body, me)
        if status in (200, 201) and approve:
            pending = [row for row in answer if row["state"] == "PENDING"]
            if pending:
                step(f"approve correction {body['business_date']}", "POST",
                     f"/api/v1/attendance-corrections/{pending[-1]['id']}/decision",
                     {"approve": True, "reason": "sesuai catatan supervisor"}, ratih)

    print("payroll details and pay")
    for body in [
        {"field": "bank_account", "bank_name": "BCA", "bank_account": "5270918834",
         "bank_holder": "Nina Oktaviani"},
        {"field": "npwp", "value": "09.254.294.3-407.000"},
        {"field": "ptkp", "value": "TK/0"},
        {"field": "bpjs_kesehatan", "value": "0001234567891"},
        {"field": "bpjs_ketenagakerjaan", "value": "25038471902"},
    ]:
        step(f"identity {body['field']}", "POST", f"/api/v1/employees/{employee}/payroll-identity",
             {**body, "effective_from": "2025-03-03", "reason": "data dari formulir karyawan baru"}, admin)
    step("pay agreement", "POST", f"/api/v1/employees/{employee}/pay", {
        "effective_from": "2025-03-03", "base_minor": 5_400_000,
        "fixed_allowances": [{"code": "TRANSPORT", "minor": 400_000}, {"code": "MAKAN", "minor": 550_000}],
        "reason": "sesuai kontrak PKWT",
    }, admin)

    print("close months and pay them")
    for period in CLOSED_MONTHS:
        step(f"close {period}", "POST", f"/api/v1/attendance-periods/ho/{period}/closure",
             {"reason": "tutup absensi bulanan"}, admin)
        run = f"PR-{period}-ho"
        step(f"open {run}", "POST", "/api/v1/payroll/runs",
             {"place_id": "ho", "period": period, "reason": f"gaji {period}"}, ratih)
        step(f"submit {run}", "POST", f"/api/v1/payroll/runs/{run}/submission", {"reason": "siap diperiksa"}, ratih)
        step(f"approve {run}", "POST", f"/api/v1/payroll/runs/{run}/approve", {"reason": "diperiksa dan disetujui"}, admin)

    print("notifications")
    notes = [
        ("Cuti disetujui", "Cuti Tahunan 13–15 Jul disetujui.", 70),
        ("Slip gaji Juli tersedia", "Slip gaji periode Juli 2026 sudah bisa dilihat.", 52),
        ("Koreksi absen disetujui", "Jam pulang 26 Agu dicatat 17:05.", 28),
        ("Slip gaji Agustus tersedia", "Slip gaji periode Agustus 2026 sudah bisa dilihat.", 21),
        ("Cuti ditolak", "Cuti 4 Sep ditolak: stok opname, jadwal penuh.", 20),
        ("Permintaan lembur baru", "Lembur 26 Sep, 2 jam — mohon dijawab.", 1),
    ]
    values, recipients = [], []
    for index, (title, body, ago_days) in enumerate(notes):
        note_id = uuid.uuid5(uuid.NAMESPACE_URL, f"seed-hr:{arguments.login}:{title}")
        at = datetime.now(timezone.utc) - timedelta(days=ago_days, hours=index)
        read_at = "NULL" if ago_days < 21 else f"'{(at + timedelta(hours=3)).isoformat()}'"
        values.append(f"('{note_id}','activity','{title}','{body}','{at.isoformat()}')")
        recipients.append(f"('{note_id}','{arguments.login}',{read_at})")
    psql("INSERT INTO notification (notification_id, kind, title, body, created_at) VALUES "
         + ",".join(values) + " ON CONFLICT DO NOTHING")
    psql("INSERT INTO notification_recipient (notification_id, username, read_at) VALUES "
         + ",".join(recipients) + " ON CONFLICT DO NOTHING")
    print(f"  + {len(notes)} notifications")

    print(json.dumps({"refusals": refusals}, indent=2, ensure_ascii=False))
    return 1 if refusals else 0


if __name__ == "__main__":
    raise SystemExit(main())
