#!/usr/bin/env python3
"""Counts — and the exceptions they raise — on a demo rig, through the API.

    psql postgresql:///sim_rig_demo -v ON_ERROR_STOP=1 -f scripts/seed-inventory-demo.sql
    python3 scripts/seed-inventory-demo.py --cloud http://127.0.0.1:8180

Runs after the SQL seed, which gives stores 02–09 a stock history. Every
count here goes the way a person would take it, so the rows left behind are
the rows the apps leave:

  store-02 floor      approved, three pieces short → Missing (exceptions)
  store-06 warehouse  approved, two pieces short   → Missing (exceptions)
  store-04 floor      approved, nothing short     → Closed, last count today
  store-03 floor      counted, sent to review     → To review
  store-05 warehouse  started                     → Counting

A count of a pool that already has one open is skipped, so a re-run does
nothing new.
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
import uuid


class Cloud:
    def __init__(self, base: str, token: str | None):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("content-type", "application/json")
        if self.token:
            request.add_header("authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raise SystemExit(f"{method} {path} → {error.code}: {error.read().decode()[:300]}")


def login(base: str, username: str, password: str) -> str | None:
    try:
        return Cloud(base, None).call(
            "POST", "/api/v1/auth/login", {"username": username, "password": password}
        )["token"]
    except SystemExit:
        return None  # a rig with sign-in off: every call is `development`


def key() -> str:
    return str(uuid.uuid4())


def run(cloud: Cloud, actor: str, site: str, pool: str, reason: str, short: int, until: str) -> None:
    open_ = cloud.call("GET", f"/api/v1/inventory/counts?pool_id={pool}&limit=50")
    if any(row["status"] != "CLOSED" for row in open_.get("rows", [])) or (
        until == "CLOSED" and open_.get("rows")
    ):
        print(f"  {pool}: already counted, skipped")
        return
    created = cloud.call("POST", "/api/v1/inventory/counts", {
        "site_id": site, "pool_id": pool, "kind": "FULL", "sku_ids": [], "epcs": [],
        "reason": reason, "actor_id": actor, "idempotency_key": key(),
    })
    count_id = created["id"]
    cloud.call("POST", f"/api/v1/inventory/counts/{count_id}/activate",
               {"actor_id": actor, "idempotency_key": key()})
    if until == "ACTIVE":
        print(f"  {pool}: counting")
        return
    detail = cloud.call("GET", f"/api/v1/inventory/counts/{count_id}")
    entries = []
    # The short pieces are spread across the pool (every seventh line), so
    # they fall on different articles rather than three pieces of one.
    lines = detail["lines"]
    missed = {(index * 7) % len(lines) for index in range(short)} if lines else set()
    for index, line in enumerate(lines):
        found = line["expected_quantity"]
        if index in missed:
            found = max(0, found - 1)
        entries.append({"subject_id": line["subject_id"], "epc": None, "found_quantity": found})
    cloud.call("POST", f"/api/v1/inventory/counts/{count_id}/entries",
               {"actor_id": actor, "idempotency_key": key(), "entries": entries})
    cloud.call("POST", f"/api/v1/inventory/counts/{count_id}/submit",
               {"actor_id": actor, "idempotency_key": key()})
    if until == "REVIEW":
        print(f"  {pool}: to review")
        return
    cloud.call("POST", f"/api/v1/inventory/counts/{count_id}/approve",
               {"actor_id": actor, "idempotency_key": key()})
    print(f"  {pool}: approved, {short} pieces short")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cloud", default="http://127.0.0.1:8180")
    parser.add_argument("--user", default="rina")
    parser.add_argument("--password", default="Password01")
    args = parser.parse_args()

    token = login(args.cloud, args.user, args.password)
    cloud = Cloud(args.cloud, token)
    actor = args.user if token else "development"

    print("counts on stores 02–06")
    run(cloud, actor, "store-02", "store-02.floor", "Monthly count", 3, "CLOSED")
    run(cloud, actor, "store-06", "store-06.warehouse", "Stockroom check", 2, "CLOSED")
    run(cloud, actor, "store-04", "store-04.floor", "Monthly count", 0, "CLOSED")
    run(cloud, actor, "store-03", "store-03.floor", "Monthly count", 1, "REVIEW")
    run(cloud, actor, "store-05", "store-05.warehouse", "Stockroom check", 0, "ACTIVE")


if __name__ == "__main__":
    main()
