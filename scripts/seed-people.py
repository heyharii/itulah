#!/usr/bin/env python3
"""Put a workforce into a dev cloud node, so the People screens have something
to show.

A node with fourteen shops and no employees draws an empty Directory — the
screen is correct and the module is bare, which looks the same from the
browser. This writes one head-office team plus a person per shop, each one
taken through the same route a clerk would: register the number, hire it,
enrol the personal data, sign a contract, post them somewhere.

    ITULAH_API=http://127.0.0.1:8080 python3 scripts/seed-people.py

The order below is the only one that works. A number is registered before it
is hired, because an employee record exists before anyone occupies it (that is
what the Directory's empty state says); the posting is dated on the joining
day, because an assignment that starts before the hire is a person posted to a
shop they did not yet work for.

Personal data goes through `POST .../personal-data`, which REFUSES a second
enrolment by design — amendment is the route that leaves a trace. So a re-run
skips anyone already registered rather than trying to rewrite them, and the
script converges instead of erroring.

The NIKs are made up, and made up visibly: sixteen digits that start 3200 and
carry the row index, so nothing here can be mistaken for a real person's
identity number if this database is ever looked at later.

The password is never an argument: read from ITULAH_PASSWORD if set, otherwise
prompted for without echo. Against a node running with authentication off
(`INVENTORY_AUTH_MODE=disabled`), nothing is asked for at all.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from getpass import getpass

API = os.environ.get("ITULAH_API", "http://127.0.0.1:8080").rstrip("/")
USERNAME = os.environ.get("ITULAH_USER", "admin")

# code, name, position, grade, contract kind, place, joined
PEOPLE = [
    ("HO-0001", "Andi Prasetyo", "Head of Retail", "M4", "PKWTT", "ho", "2019-03-04"),
    ("HO-0002", "Sari Wulandari", "Merchandiser", "S3", "PKWTT", "ho", "2020-07-13"),
    ("HO-0003", "Bagus Nugroho", "Buyer", "S3", "PKWTT", "ho", "2021-02-01"),
    ("HO-0004", "Ratih Kusuma", "Finance Officer", "S2", "PKWTT", "ho", "2021-09-06"),
    ("HO-0005", "Dimas Saputra", "IT Support", "S2", "PKWT", "ho", "2025-01-06"),
    # The warehouse team is head office staff: posted to `ho`, and numbered in
    # the HO series. Migration 0230 folded the distribution centre into head
    # office — the owner's decision of 2026-09-13, restated as "ho cuma 1" —
    # so `org_place('dc')` no longer exists and `org_place.kind` no longer
    # admits 'DC'. These three rows posted to "dc" until that landed, and the
    # foreign key refused them from the moment it did.
    #
    # The badge numbers moved too, from `DC-000n` to the HO series. A badge is
    # a number rather than a name, so keeping the old prefix would have been
    # defensible — but it is printed in the Directory, and the owner asked for
    # the letters to stop appearing anywhere a person reads them. `position` is
    # what still says where somebody works, which is the honest place for it:
    # a warehouse supervisor is a warehouse supervisor whichever unit employs
    # them.
    #
    # Migration 0256 then did the same to `site`: `dc` and `dc-01` folded into
    # one row `ho` of kind `HO`, and `org_place.ho.site_id` points at it. The
    # warehouse is still a syncing node that receives goods and runs the
    # handhelds — that node registers as `dc`, in `sync_origin_credential`,
    # which is a third id space and was deliberately left alone. So were the
    # seventy-four pool ids that still begin `dc.`.
    ("HO-0006", "Yusuf Ramadhan", "Warehouse Supervisor", "S3", "PKWTT", "ho", "2020-05-11"),
    ("HO-0007", "Nina Oktaviani", "Inbound Clerk", "S1", "PKWT", "ho", "2025-03-03"),
    ("HO-0008", "Rizal Fadhil", "Picker", "S1", "PKWT", "ho", "2025-06-02"),
    ("ST-0101", "Maya Anggraini", "Store Manager", "S4", "PKWTT", "store-01", "2019-08-19"),
    ("ST-0102", "Fajar Setiawan", "Cashier", "S1", "PKWT", "store-01", "2025-02-10"),
    ("ST-0201", "Lestari Handayani", "Store Manager", "S4", "PKWTT", "store-02", "2020-01-13"),
    ("ST-0202", "Gilang Permana", "Cashier", "S1", "PKWT", "store-02", "2025-04-07"),
    ("ST-0301", "Intan Maharani", "Store Manager", "S4", "PKWTT", "store-03", "2020-11-02"),
    ("ST-0401", "Hendra Wijaya", "Store Manager", "S4", "PKWTT", "store-04", "2021-03-15"),
    ("ST-0501", "Putri Rahmawati", "Store Manager", "S4", "PKWTT", "store-05", "2021-06-07"),
    ("ST-0601", "Adi Kurniawan", "Store Manager", "S4", "PKWTT", "store-06", "2021-10-04"),
    ("ST-0701", "Dewi Safitri", "Store Manager", "S4", "PKWTT", "store-07", "2022-01-10"),
    ("ST-0702", "Rangga Pratama", "Cashier", "S1", "PKWT", "store-07", "2025-05-05"),
    ("ST-0801", "Bayu Santoso", "Store Manager", "S4", "PKWTT", "store-08", "2022-04-11"),
    ("ST-0901", "Tari Novita", "Store Manager", "S4", "PKWTT", "store-09", "2022-08-08"),
    ("ST-1001", "Reza Alfian", "Store Manager", "S4", "PKWTT", "store-10", "2023-01-09"),
    ("ST-1101", "Sinta Melati", "Store Manager", "S4", "PKWTT", "store-11", "2023-05-08"),
    ("ST-1201", "Arif Budiman", "Store Manager", "S4", "PKWTT", "store-12", "2023-09-04"),
    ("ST-1301", "Wulan Pertiwi", "Store Manager", "S4", "PKWTT", "store-13", "2024-02-05"),
]

# A fixed-term contract has to end. One year from the start is the usual first
# PKWT — but a term that has already run out reads as six overdue contracts the
# day the node is seeded, which is a worklist nobody created and nobody can
# clear. So a term that would land in the past is carried forward instead, in
# uneven steps, which is also what makes "contracts running out" show one name
# and not all of them.
FORWARD_DAYS = [30, 75, 120, 200, 280, 365]


def contract_end(starts_on: str, index: int) -> str:
    start = date.fromisoformat(starts_on)
    try:
        natural = start.replace(year=start.year + 1)
    except ValueError:  # 29 February
        natural = start.replace(year=start.year + 1, day=28)
    if natural > date.today():
        return natural.isoformat()
    return (date.today() + timedelta(days=FORWARD_DAYS[index % len(FORWARD_DAYS)])).isoformat()


def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{API}{path}", data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    if token is not None:
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
        print(f"! cannot reach {API}: {error.reason}", file=sys.stderr)
        raise SystemExit(1)


def sign_in() -> str | None:
    _, health = call("GET", "/api/v1/health")
    if not isinstance(health, dict) or health.get("auth") != "enabled":
        print(f"! {API} is running WITHOUT authentication — seeding unauthenticated.")
        return None
    password = os.environ.get("ITULAH_PASSWORD") or getpass(
        f"password for {USERNAME} at {API}: "
    )
    status, body = call(
        "POST", "/api/v1/auth/login", {"username": USERNAME, "password": password}
    )
    if status != 200:
        print(f"! login failed: {status} {body}", file=sys.stderr)
        raise SystemExit(1)
    return body["token"]


def main() -> int:
    token = sign_in()

    status, existing = call("GET", "/api/v1/employees?limit=500", token=token)
    if status != 200:
        print(f"! cannot read the directory: {status} {existing}", file=sys.stderr)
        return 1
    # The route answers with an envelope — rows, cursor, total, facets — so the
    # page is under "rows". `total` is the whole company rather than this page,
    # which is how a seed run can tell a short answer from a small company.
    page = (existing or {}).get("rows") or []
    known = {row.get("employee_code") for row in page}
    if (existing or {}).get("next_cursor"):
        print(
            f"  … the directory has {(existing or {}).get('total')} people and this"
            " read stopped at 500; codes past that page will look new and be"
            " refused as duplicates.",
            file=sys.stderr,
        )

    added = skipped = 0
    failures: list[str] = []
    for index, (code, name, position, grade, kind, place, joined) in enumerate(PEOPLE):
        if code in known:
            skipped += 1
            continue

        status, employee = call(
            "POST", "/api/v1/employees", {"employee_code": code}, token=token
        )
        if status not in (200, 201):
            failures.append(f"register {code}: {status} {employee}")
            continue
        employee_id = employee["employee_id"]

        steps = [
            (
                f"/api/v1/employees/{employee_id}/employment",
                {
                    "transition": "HIRE",
                    "effective_on": joined,
                    "reason": f"joined as {position}",
                },
            ),
            (
                f"/api/v1/employees/{employee_id}/personal-data",
                {
                    "full_name": name,
                    "nik": f"3200{index + 1:012d}",
                    "birth_date": f"{1985 + (index % 15)}-{(index % 12) + 1:02d}-1{index % 8}",
                    "address": f"Jl. Contoh No. {index + 1}, Jakarta",
                },
            ),
            (
                f"/api/v1/employees/{employee_id}/contracts",
                {
                    "kind": kind,
                    "starts_on": joined,
                    "ends_on": contract_end(joined, index) if kind == "PKWT" else None,
                    "position": position,
                    "grade": grade,
                    "reason": "first contract",
                },
            ),
            (
                f"/api/v1/employees/{employee_id}/assignments",
                {
                    "place_id": place,
                    "valid_from": joined,
                    "valid_to": None,
                    "reason": f"posted to {place}",
                },
            ),
        ]
        for path, body in steps:
            status, answer = call("POST", path, body, token=token)
            if status not in (200, 201):
                failures.append(f"{code} {path.rsplit('/', 1)[-1]}: {status} {answer}")
        added += 1
        print(f"+ {code} {name} — {position} at {place}")

    print(
        json.dumps(
            {
                "registered": added,
                "already_there": skipped,
                "failures": failures[:10],
                "failure_count": len(failures),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
