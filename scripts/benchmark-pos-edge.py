#!/usr/bin/env python3
"""benchmark-pos-edge — the till's money path, measured.

Phase 0 of POS-PERFORMANCE-PLAN.md: a throwaway store-edge node on a temp
SQLite file, seeded with 5,000 SKUs + price book + EPCs on the floor, then:

  1. whole-book catalog sync (what the desk pulls at open, 500-row pages)
  2. POST /store/quote   — 5-EPC basket, median/p99 over N runs
  3. POST /store/sales   — 5-line cash sale, sequential then 8 workers
  4. GET  receipt        — durable-row reconstruction
  5. the same sale load WHILE a reader streams 100 RFID rows/s
  6. the same sale load WHILE one max-size (2,000-sighting) sweep lands
  7. EXPLAIN QUERY PLAN for the three hot lookups, after shutdown

Numbers are only honest from a RELEASE build (the harness's own rule —
a debug Rust build is commonly 10-50x slower):

  cd backend && cargo build --release --bin store
  python3 scripts/benchmark-pos-edge.py
  python3 scripts/benchmark-pos-edge.py --sales 100 --workers 8 --keep

Stdlib only, same discipline as scripts/loadtest-crud.py. Nothing outside the
temp directory is touched; the node is killed by the PID this script holds.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RFID_PATH = "/api/v1/rfid/observations"
SKU_COUNT = 5_000
PLACE_FLOOR = "store-07.floor:on_hand"


def bench_epc(i: int) -> str:
    """The i-th bench tag: 24 hex digits, as a reader reports one. The node
    refuses an RFID read that is not hex, so `EPC-00001` no longer files."""
    return f"{i:024X}"


def sign_rfid(device_key: str, device_id: str, ts: int, seq: int, body: bytes) -> str:
    signing_key = hashlib.sha256(device_key.encode()).hexdigest()
    digest = hashlib.sha256(body).hexdigest()
    canonical = f"POST\n{RFID_PATH}\n{device_id}\n{ts}\n{seq}\n{digest}"
    return hmac.new(signing_key.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def post(url: str, body: dict | bytes, headers: dict | None = None, timeout: float = 30):
    payload = body if isinstance(body, bytes) else json.dumps(body).encode()
    head = {"Content-Type": "application/json"}
    if headers:
        head.update(headers)
    req = urllib.request.Request(url, data=payload, headers=head, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, json.loads(res.read() or b"null")


def get(url: str, token: str | None = None, timeout: float = 30):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, json.loads(res.read() or b"null")


def pctl(sorted_ms: list[float], q: float) -> float:
    if not sorted_ms:
        return float("nan")
    idx = min(len(sorted_ms) - 1, max(0, round(q / 100 * (len(sorted_ms) - 1))))
    return sorted_ms[idx]


def stats(ms: list[float]) -> dict:
    s = sorted(ms)
    return {"n": len(s), "p50": pctl(s, 50), "p95": pctl(s, 95), "p99": pctl(s, 99),
            "min": s[0] if s else float("nan"), "max": s[-1] if s else float("nan")}


class Node:
    def __init__(self, binary: str, port: int, db: Path, workdir: Path, admin_password: str):
        self.binary, self.port, self.db = binary, port, db
        self.base = f"http://127.0.0.1:{port}"
        self.proc: subprocess.Popen | None = None
        self.env = {
            **os.environ,
            "BIND_ADDR": f"127.0.0.1:{port}",
            "INVENTORY_SITE_ID": "store-07",
            "INVENTORY_NODE_ID": "bench-store-edge",
            "INVENTORY_NODE_ROLE": "STORE",
            "INVENTORY_DATABASE_PATH": str(db),
            "INVENTORY_AUTH_MODE": "required",
            "INVENTORY_BOOTSTRAP_ADMIN_PASSWORD": admin_password,
            "RUST_LOG": "inventory_backend=error,tower_http=error",
        }
        self.log_path = workdir / "store.log"
        self.log = None

    def start(self):
        self.log = self.log_path.open("ab")
        self.proc = subprocess.Popen([self.binary], cwd=str(ROOT / "backend"),
                                     env=self.env, stdout=self.log, stderr=self.log)
        deadline = time.time() + 60
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"node exited early; see store.log in workdir")
            try:
                status, body = get(f"{self.base}/api/v1/health")
                if status == 200:
                    return body
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(0.2)
        raise RuntimeError("node did not become healthy within 60s")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=10)
        if self.log:
            self.log.close()


def seed(db: Path, skus: int):
    con = sqlite3.connect(db)
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(days=1)).isoformat()
    con.execute("BEGIN")
    con.execute(
        "INSERT INTO commercial_publication (id, version, name, effective_from,"
        " effective_to, activated_at) VALUES ('pub-bench-1', 1, 'bench', ?, NULL, ?)",
        (day_ago, day_ago),
    )
    con.execute(
        "INSERT INTO commercial_tax_rule (publication_id, tax_category, rate_bps,"
        " tax_inclusive) VALUES ('pub-bench-1', 'STANDARD', 1100, 1)",
    )
    con.executemany(
        "INSERT INTO commercial_price_rule (publication_id, sku_id, sku_code, site_id,"
        " channel, sellable, currency, unit_price_minor, tax_category)"
        " VALUES ('pub-bench-1', ?, ?, NULL, 'STORE', 1, 'IDR', ?, 'STANDARD')",
        [(f"fixture-{i}", f"B{i:05d}", 100_000 + (i % 50) * 1_000) for i in range(skus)],
    )
    con.executemany(
        "INSERT INTO catalog_item (sku_code, name, uom, barcode, tax_category, active,"
        " generation, updated_at) VALUES (?, ?, 'PCS', ?, 'STANDARD', 1, 1, ?)",
        [(f"B{i:05d}", f"SKU Bench {i}", f"899{i:010d}", now.isoformat()) for i in range(skus)],
    )
    con.execute(
        "INSERT INTO catalog_state (singleton, snapshot_id, generation, item_count,"
        " content_hash, activated_at) VALUES (1, 'bench-snapshot', 1, ?, 'bench', ?)",
        (skus, now.isoformat()),
    )
    subjects = []
    for i in range(skus):
        subjects.append((str(uuid.uuid4()), bench_epc(i), f"B{i:05d}",
                         100_000 + (i % 50) * 1_000))
    con.executemany(
        "INSERT INTO inventory_subject (id, subject_type, epc, sku_code, quantity,"
        " unit_price_minor, created_at) VALUES (?, 'UNIT', ?, ?, 1, ?, ?)",
        [(sid, epc, sku, price, now.isoformat()) for sid, epc, sku, price in subjects],
    )
    con.executemany(
        "INSERT INTO inventory_projection (subject_id, place_id, quantity, updated_at)"
        " VALUES (?, ?, 1, ?)",
        [(sid, PLACE_FLOOR, now.isoformat()) for sid, _, _, _ in subjects],
    )
    key_hash = hashlib.sha256(b"bench-device-key").hexdigest()
    week = (now + timedelta(days=7)).isoformat()
    con.execute(
        "INSERT INTO edge_rfid_device (device_id, label, auth_key_sha256, active,"
        " valid_until, last_sequence, policy_version, updated_at)"
        " VALUES ('BENCH-READER', 'Bench reader', ?, 1, ?, 0, 1, ?)",
        (key_hash, week, now.isoformat()),
    )
    con.execute(
        "INSERT INTO edge_rfid_device_pool (device_id, pool_id)"
        " VALUES ('BENCH-READER', 'store-07.floor')"
    )
    con.commit()
    con.close()


class RfidStream(threading.Thread):
    """Consolidated sightings, ~rows-per-second through the real signed path."""

    def __init__(self, base: str, rows_per_second: int, batch: int):
        super().__init__(daemon=True)
        self.base, self.rps, self.batch = base, rows_per_second, batch
        self.stop_flag = threading.Event()
        self.errors: list[str] = []
        self.seq = int(time.time() * 1000)
        self.sent = 0

    def run(self):
        interval = self.batch / self.rps
        n = 0
        while not self.stop_flag.is_set():
            started = time.perf_counter()
            n += 1
            sightings = [
                {"epc": bench_epc((n * self.batch + j) % SKU_COUNT), "rssi": -50,
                 "antenna": "A1", "read_count": 1}
                for j in range(self.batch)
            ]
            payload = {
                "site_id": "store-07",
                "pool": "store-07.floor",
                "reader_session_id": "BENCH-SESSION",
                "observed_at": datetime.now(timezone.utc).isoformat(),
                "idempotency_key": f"bench-{uuid.uuid4()}",
                "observations": sightings,
            }
            body = json.dumps(payload, separators=(",", ":")).encode()
            ts = int(time.time())
            self.seq += 1
            headers = {
                "X-Device-Id": "BENCH-READER",
                "X-Device-Timestamp": str(ts),
                "X-Device-Sequence": str(self.seq),
                "X-Device-Signature": sign_rfid("bench-device-key", "BENCH-READER",
                                                ts, self.seq, body),
            }
            try:
                post(f"{self.base}{RFID_PATH}", body, headers)
                self.sent += len(sightings)
            except Exception as error:  # noqa: BLE001 — record, keep streaming
                self.errors.append(str(error)[:120])
            remaining = interval - (time.perf_counter() - started)
            if remaining > 0:
                self.stop_flag.wait(remaining)

    def stop(self):
        self.stop_flag.set()
        self.join(timeout=5)


def fmt(row: dict) -> str:
    return (f"{row['n']:>5}  {row['p50']:8.1f}  {row['p95']:8.1f}  {row['p99']:8.1f}"
            f"  {row['max']:8.1f}")


HEADER = f"{'n':>5}  {'p50 ms':>8}  {'p95 ms':>8}  {'p99 ms':>8}  {'max ms':>8}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bin", default=str(ROOT / "backend/target/release/store"))
    parser.add_argument("--port", type=int, default=18482)
    parser.add_argument("--skus", type=int, default=SKU_COUNT)
    parser.add_argument("--sales", type=int, default=60, help="sales per scenario")
    parser.add_argument("--lines", type=int, default=5, help="EPCs per basket")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--rfid-rps", type=int, default=100)
    parser.add_argument("--admin-password", default="bench-admin-pass")
    parser.add_argument("--keep", action="store_true", help="keep the work dir")
    args = parser.parse_args()

    binary = Path(args.bin)
    if not binary.exists():
        print(f"missing {binary} — build it first:\n"
              f"  cd backend && cargo build --release --bin store", file=sys.stderr)
        return 2

    workdir = Path(tempfile.mkdtemp(prefix="pos-bench-"))
    db = workdir / "bench.sqlite3"
    node = Node(str(binary), args.port, db, workdir, args.admin_password)
    token = None
    try:
        print(f"work dir {workdir}")
        node.start()                      # first boot: migrations apply
        node.stop()
        print(f"seeding {args.skus} SKUs + EPCs + price book …")
        seed(db, args.skus)
        node.start()                      # second boot: the one we measure
        admin_password = args.admin_password
        _, login = post(f"{node.base}/api/v1/auth/login",
                        {"username": "admin", "password": admin_password})
        token = login["token"]
        auth = {"Authorization": f"Bearer {token}"}

        _, shift = post(f"{node.base}/api/v1/store/shifts",
                        {"terminal_id": "KASIR-1", "opening_float_minor": 1_000_000,
                         "actor_id": "admin", "idempotency_key": "bench-shift-1"},
                        auth)
        shift_id = shift.get("shift", {}).get("id") or shift.get("id")

        # ── 1. whole-book catalog sync (the desk's open-of-day pull) ─────────
        cursor, pages, page_ms, t0 = None, 0, [], time.perf_counter()
        while True:
            started = time.perf_counter()
            _, page = get(f"{node.base}/api/v1/store/catalog?limit=500"
                          + (f"&cursor={cursor}" if cursor else ""), token)
            page_ms.append((time.perf_counter() - started) * 1000)
            pages += 1
            cursor = page.get("next_cursor")
            if cursor is None:
                break
        whole_ms = (time.perf_counter() - t0) * 1000
        print(f"\ncatalog whole-book sync: {pages} pages, {whole_ms:.0f} ms total"
              f" ({args.skus} SKUs), per-page {stats(page_ms)}")

        # EPC allocator: every sale consumes fresh tags off the floor.
        next_epc = 0
        epc_lock = threading.Lock()

        last_sale_id = None

        def take_epcs(k: int) -> list[str]:
            nonlocal next_epc
            with epc_lock:
                batch = [bench_epc(next_epc + j) for j in range(k)]
                next_epc += k
            return batch

        def do_quote(_i: int) -> float:
            epcs = take_epcs(args.lines)
            started = time.perf_counter()
            post(f"{node.base}/api/v1/store/quote", {"epcs": epcs,
                 "coupon_codes": [], "charges": []}, auth)
            return (time.perf_counter() - started) * 1000

        def do_sale(_i: int) -> float:
            nonlocal last_sale_id
            epcs = take_epcs(args.lines)
            started = time.perf_counter()
            _, result = post(f"{node.base}/api/v1/store/sales",
                             {"epcs": epcs, "coupon_codes": [], "charges": [],
                              "customer_id": None,
                              "tenders": [{"method": "CASH", "amount_minor": 10_000_000}],
                              "actor_id": "admin",
                              "idempotency_key": f"bench-sale-{uuid.uuid4()}"}, auth)
            last_sale_id = result.get("sale_id") or last_sale_id
            return (time.perf_counter() - started) * 1000

        def run_scenario(name: str, fn, count: int, workers: int) -> dict:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                ms = list(pool.map(fn, range(count)))
            row = stats(ms)
            print(f"{name:<44} {fmt(row)}")
            return row

        print(f"\n{HEADER}\n{'─' * 58}")

        # ── 2. quote, sequential + concurrent ────────────────────────────────
        quote_seq = run_scenario(f"quote ({args.lines}-EPC, sequential)",
                                 do_quote, args.sales, 1)
        quote_con = run_scenario(f"quote ({args.lines}-EPC, {args.workers} workers)",
                                 do_quote, args.sales, args.workers)

        # ── 3. sale, sequential + concurrent ─────────────────────────────────
        sale_seq = run_scenario(f"sale 5-line cash (sequential)",
                                do_sale, args.sales, 1)
        sale_con = run_scenario(f"sale 5-line cash ({args.workers} workers)",
                                do_sale, args.sales, args.workers)

        # ── 4. receipt (reconstruction from durable rows) ────────────────────
        def do_receipt(_i: int) -> float:
            started = time.perf_counter()
            get(f"{node.base}/api/v1/store/sales/{last_sale_id}/receipt", token)
            return (time.perf_counter() - started) * 1000

        receipt = None
        if last_sale_id:
            receipt = run_scenario("GET receipt (durable reconstruction)",
                                   do_receipt, min(args.sales, 30), 1)
        else:
            print("GET receipt — skipped: no sale id captured")

        # ── 5. sale load WHILE a reader streams args.rfid-rps rows/s ─────────
        stream = RfidStream(node.base, args.rfid_rps, batch=20)
        stream.start()
        print(f"\nRFID stream up: ~{args.rfid_rps} rows/s in 20-sighting batches")
        sale_rfid = run_scenario(f"sale 5-line cash ({args.workers} workers,"
                                 f" RFID {args.rfid_rps} rows/s)",
                                 do_sale, args.sales, args.workers)
        stream.stop()
        if stream.errors:
            print(f"  rfid stream errors: {len(stream.errors)} (first: "
                  f"{stream.errors[0]})")

        # ── 6. one max-size sweep (2,000 sightings in ONE transaction) ───────
        burst = RfidStream(node.base, 1, batch=1)
        burst.start()
        time.sleep(0.5)
        big_seq = int(time.time() * 1000) + 10_000
        big = [{"epc": bench_epc(j % args.skus), "rssi": -50, "read_count": 1}
               for j in range(2_000)]
        payload = {"site_id": "store-07", "pool": "store-07.floor",
                   "reader_session_id": "BENCH-SWEEP",
                   "observed_at": datetime.now(timezone.utc).isoformat(),
                   "idempotency_key": f"bench-sweep-{uuid.uuid4()}",
                   "observations": big}
        body = json.dumps(payload, separators=(",", ":")).encode()
        ts = int(time.time())
        headers = {"X-Device-Id": "BENCH-READER", "X-Device-Timestamp": str(ts),
                   "X-Device-Sequence": str(big_seq),
                   "X-Device-Signature": sign_rfid("bench-device-key",
                                                   "BENCH-READER", ts, big_seq, body)}
        print(f"\nfiring one 2,000-sighting sweep mid-load …")
        stall_ms: list[float] = []

        def stall_probe(i: int) -> float:
            return do_sale(i)

        burst_thread_stop = threading.Event()
        probes = ThreadPoolExecutor(max_workers=args.workers)
        futures = [probes.submit(stall_probe, i) for i in range(args.sales)]
        time.sleep(0.05)
        sweep_started = time.perf_counter()
        try:
            post(f"{node.base}{RFID_PATH}", body, headers, timeout=60)
        finally:
            sweep_ms = (time.perf_counter() - sweep_started) * 1000
        sale_during = stats([f.result() for f in futures])
        probes.shutdown()
        burst.stop()
        print(f"sweep POST itself: {sweep_ms:.0f} ms; sales during sweep:")
        print(f"{'sale during 2000-row sweep':<44} {fmt(sale_during)}")

        # ── verdict against the plan's SLOs ──────────────────────────────────
        print(f"\nSLO check (POS-PERFORMANCE-PLAN §2: interactive p99 ≤ 100 ms):")
        for name, row in [("quote seq", quote_seq), ("quote conc", quote_con),
                          ("sale seq", sale_seq), ("sale conc", sale_con),
                          ("sale+rfid", sale_rfid), ("sale+sweep", sale_during),
                          ("receipt", receipt)]:
            if row is None:
                continue
            verdict = "OK " if row["p99"] <= 100 else "OVER"
            print(f"  {verdict} {name:<12} p99 {row['p99']:7.1f} ms")

        # ── 6b. crash + idempotency gate (Phase 5.3/5.4) ─────────────────────
        # One sale, replayed twice: once in-process, once after kill -9 and a
        # cold restart. The replay must answer with the SAME sale id and the
        # receipt must still reconstruct — under synchronous=NORMAL this is
        # the guarantee that matters (process death loses nothing; only an OS
        # crash inside a checkpoint window can, and that is the documented
        # operator tradeoff).
        crash_req = {
            "epcs": take_epcs(args.lines),
            "coupon_codes": [],
            "charges": [],
            "customer_id": None,
            "tenders": [{"method": "CASH", "amount_minor": 10_000_000}],
            "actor_id": "admin",
            "idempotency_key": f"bench-crash-{uuid.uuid4()}",
        }
        _, first = post(f"{node.base}/api/v1/store/sales", crash_req, auth)
        crash_sale_id = first["sale_id"]
        _, replay_same_process = post(f"{node.base}/api/v1/store/sales", crash_req, auth)
        same_process_ok = replay_same_process["sale_id"] == crash_sale_id
        node.proc.kill()
        node.proc.wait()
        node.start()
        _, receipt_after = get(
            f"{node.base}/api/v1/store/sales/{crash_sale_id}/receipt", token
        )
        _, replay_after = post(f"{node.base}/api/v1/store/sales", crash_req, auth)
        crash_ok = (
            same_process_ok
            and replay_after["sale_id"] == crash_sale_id
            and bool(receipt_after)
        )
        print(f"\ncrash + idempotency gate (kill -9 → restart → replay):")
        print(f"  same id in-process : {'OK' if same_process_ok else 'FAIL'}")
        print(f"  receipt after kill : {'OK' if receipt_after else 'FAIL'}")
        print(f"  same id after kill : "
              f"{'OK' if replay_after['sale_id'] == crash_sale_id else 'FAIL'}")
        if not crash_ok:
            print("  GATE FAILED")
            return 1

        # ── 7. EXPLAIN the three hot lookups ─────────────────────────────────
        node.stop()
        con = sqlite3.connect(db)
        print("\nEXPLAIN QUERY PLAN (hot lookups):")
        for label, sql in [
            ("projection by (subject,place)",
             "SELECT quantity FROM inventory_projection"
             " WHERE subject_id='x' AND place_id='y'"),
            ("subject by epc",
             f"SELECT id FROM inventory_subject WHERE epc='{bench_epc(1)}'"),
            ("sale_line by sku (reporting path)",
             "SELECT COUNT(*) FROM sale_line WHERE sku_code='B00001'"),
        ]:
            plan = con.execute(f"EXPLAIN QUERY PLAN {sql}").fetchall()
            detail = "; ".join(r[3] for r in plan)
            print(f"  {label}: {detail}")
        con.close()
        print(f"\nwork dir kept at {workdir}" if args.keep
              else f"\ncleaning {workdir}")
        return 0
    finally:
        node.stop()
        if not args.keep:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
