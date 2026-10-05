#!/usr/bin/env python3
"""Headless POS integration test: a till sale reaching sales, marketing,
inventory and finance — at the store and in the cloud.

    e2e/pos-flow/provision.sh        # once (or to start over): rig pos-e2e
    python3 e2e/pos-flow/run.py      # the test

Every screen is driven by `agent-browser` (headless Chromium) through the
real apps:

  till   pos-desktop/ui on :5419, behind pos-shim.vite.mjs (the Tauri bridge
         stand-in that forwards `edge_call` to the store node)
  store  frontend-store-new on :5482 → store node :8482
  hub    frontend-hub on :5480      → cloud :8480

The HTTP API is used only to take a baseline, to pick two units that are on
the floor, and to reconcile what the screens show against the nodes — never to
do the work under test. The one exception is reversing an already-posted
sales day: the hub has no Reverse action (see FINDINGS in the report), so the
test calls the route Finance would press if it had one.

What is checked (each one a line in the report):

  till      cashier signs in, rings a shoe on promotion for a member (cash,
            change) and a second article on BCA debit; the totals on screen
            equal the node's own quote
  store     both sales on the node (receipt), both units off the floor, the
            store app's Sales / Stock / Promotions screens show them
  cloud     both sales synced (source EDGE), member points and spend moved,
            the store's stock at the centre dropped by two
  hub       Selling › Sales, Members, Inventory › Stock, Commercial ›
            Promotions agree with the nodes
  finance   the day is generated and posted from the hub's Sales Postings
            screen; the journal balances, carries every sale of the day and
            the COGS entries exist; Journal Entries lists it

Writes runs/pos-e2e/report/<stamp>/{report.json,report.md,*.png}. Exits 1 on
any failed check.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLOUD, STORE = "http://127.0.0.1:8480", "http://127.0.0.1:8482"
TILL_UI, STORE_UI, HUB_UI = "http://localhost:5419", "http://localhost:5482", "http://localhost:5480"
PASSWORD = "Password01"
SITE, SITE_CODE = "store-01", "C001"
MEMBER = "081311110001"  # Sari Wulandari, seeded by the commercial stage
WIB = timezone(timedelta(hours=7))
STAMP = datetime.now(WIB).strftime("%Y%m%d-%H%M%S")
OUT = ROOT / "runs/pos-e2e/report" / STAMP

# ─── results ────────────────────────────────────────────────────────────────

checks: list[dict] = []
findings: list[str] = []


def check(area: str, name: str, ok: bool, detail: str = "") -> bool:
    checks.append({"area": area, "check": name, "ok": bool(ok), "detail": detail})
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {mark} [{area}] {name}{' — ' + detail if detail else ''}", flush=True)
    return bool(ok)


def step(title: str) -> None:
    print(f"\n\033[1m── {title}\033[0m", flush=True)


def rupiah(minor: int) -> str:
    """IDR as the apps print it: Rp 1.234.567 (no minor unit)."""
    return "Rp " + f"{minor:,}".replace(",", ".")


# ─── HTTP (baseline and reconciliation only) ────────────────────────────────


class Api:
    def __init__(self, base: str, username: str):
        self.base = base
        self.token = self._call("POST", "/api/v1/auth/login",
                                {"username": username, "password": PASSWORD})["token"]

    def _call(self, method, path, body=None):
        headers = {"content-type": "application/json"}
        if getattr(self, "token", None):
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.base + path, method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{method} {path} → {error.code}: {error.read()[:300].decode()}")

    def get(self, path):
        return self._call("GET", path)

    def post(self, path, body):
        return self._call("POST", path, body)


def rows(payload, *keys):
    if isinstance(payload, list):
        return payload
    for key in keys + ("items", "rows", "members", "data"):
        if isinstance(payload, dict) and isinstance(payload.get(key), list):
            return payload[key]
    return []


def wait_for(label, probe, timeout=120, every=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = probe()
        if found:
            return found
        time.sleep(every)
    return None


# ─── agent-browser ──────────────────────────────────────────────────────────


class Browser:
    """One named agent-browser session = one headless browser (one app, one
    person), so the till, the store app and the hub never share cookies."""

    def __init__(self, session: str):
        self.session = session

    def run(self, *args: str, check_ok: bool = True, timeout: int = 60) -> str:
        env = dict(os.environ, AGENT_BROWSER_SESSION=self.session)
        done = subprocess.run(["agent-browser", *args], capture_output=True, text=True,
                              env=env, timeout=timeout)
        out = (done.stdout or "") + (done.stderr or "")
        if check_ok and (done.returncode != 0 or out.lstrip().startswith("✗")):
            raise RuntimeError(f"agent-browser {' '.join(args)}: {out.strip()[:400]}")
        return out

    def open(self, url: str, settle_ms: int = 2500) -> None:
        self.run("open", url)
        self.run("wait", str(settle_ms))

    def snapshot(self) -> str:
        return self.run("snapshot", "-i", "-c")

    def text(self) -> str:
        # Intl money formatting puts a no-break space after "Rp".
        return self.run("get", "text", "body").replace("\u00a0", " ").replace("\u202f", " ")

    def ref(self, role: str, name: str, snap: str | None = None) -> str | None:
        """The @ref of the first `role "…name…"` in an interactive snapshot."""
        snap = snap if snap is not None else self.snapshot()
        for line in snap.splitlines():
            match = re.search(rf'- {role}(?: "([^"]*)")? \[[^\]]*ref=(e\d+)', line)
            if match and name.lower() in (match.group(1) or "").lower():
                return "@" + match.group(2)
        return None

    def click(self, role: str, name: str) -> None:
        ref = self.ref(role, name)
        if ref is None:
            raise RuntimeError(f"no {role} named like {name!r} on {self.session}")
        self.run("click", ref)

    def fill(self, role: str, name: str, value: str) -> None:
        ref = self.ref(role, name)
        if ref is None:
            raise RuntimeError(f"no {role} named like {name!r} on {self.session}")
        self.run("fill", ref, value)

    def wait_text(self, needle: str, timeout: float = 20) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if needle.lower() in self.text().lower():
                return True
            time.sleep(0.7)
        return False

    def shot(self, name: str) -> str:
        path = OUT / f"{name}.png"
        self.run("screenshot", str(path), check_ok=False)
        return path.name

    def close(self) -> None:
        self.run("close", check_ok=False)


def sign_in(browser: Browser, username: str, *, user_label: str, pass_label: str,
            button: str, ready: str) -> bool:
    snap = browser.snapshot()
    if browser.ref("button", button, snap) is None:
        return True  # already signed in
    browser.run("fill", browser.ref("textbox", user_label, snap), username)
    browser.run("fill", browser.ref("textbox", pass_label, snap), PASSWORD)
    browser.run("click", browser.ref("button", button, snap))
    return browser.wait_text(ready, 25)


# ─── dev servers ────────────────────────────────────────────────────────────

SERVERS = {
    "till": (5419, ROOT / "pos-desktop/ui",
             ["npx", "vite", "--config", "../../e2e/pos-flow/pos-shim.vite.mjs"],
             {"STORE_TARGET": STORE, "PORT": "5419"}),
    "store": (5482, ROOT / "frontend-store-new", ["npm", "run", "dev", "--", "--port", "5482", "--strictPort"],
              {"VITE_API_TARGET": STORE, "VITE_CLOUD_TARGET": CLOUD}),
    "hub": (5480, ROOT / "frontend-hub", ["npm", "run", "dev", "--", "--port", "5480", "--strictPort"],
            {"VITE_API_TARGET": CLOUD, "VITE_EDGE_TARGET": "http://127.0.0.1:8481"}),
}


def listening(port: int) -> bool:
    # Vite binds `localhost`, which on macOS is often ::1 only.
    try:
        socket.create_connection(("localhost", port), timeout=0.5).close()
        return True
    except OSError:
        return False


def ensure_servers() -> list[subprocess.Popen]:
    started = []
    logs = ROOT / "runs/pos-e2e/logs"
    logs.mkdir(parents=True, exist_ok=True)
    for name, (port, cwd, cmd, env) in SERVERS.items():
        if listening(port):
            continue
        print(f"  starting {name} dev server on :{port}", flush=True)
        started.append(subprocess.Popen(cmd, cwd=cwd, env=dict(os.environ, **env),
                                        stdout=open(logs / f"vite-{name}.log", "w"),
                                        stderr=subprocess.STDOUT))
    for name, (port, *_rest) in SERVERS.items():
        if not wait_for(name, lambda port=port: listening(port), 60, 1):
            raise SystemExit(f"{name} dev server did not come up on :{port}")
    return started


# ─── the test ───────────────────────────────────────────────────────────────


def pick_units(store: Api) -> tuple[dict, dict]:
    """Two units standing on the floor: a shoe the 15% promotion and the
    member points apply to (a marked-down one gets neither), and one other
    article. Chosen from the node's own ledger, so a re-run takes the next
    pair."""
    places = {}
    for move in sorted(rows(store.get("/api/v1/inventory/movements?limit=5000")),
                       key=lambda m: m["occurred_at"]):
        places[move["epc"]] = move["to"]
    catalogue = {row["sku_code"]: row for row in store.get("/api/v1/store/catalog")["items"]}
    floor = sorted(epc for epc, place in places.items() if place == f"{SITE}.floor:on_hand")
    shoes = ("Sneakers", "Loafers", "Sandal")
    shoe = next((e for e in floor if catalogue.get(e[2:13], {}).get("name", "").startswith(shoes)
                 and (lambda q: q.get("discount_total_minor") and q.get("points_earned"))(
                     quote(store, e, MEMBER))), None)
    other = next((e for e in floor if e != shoe
                  and not catalogue.get(e[2:13], {}).get("name", "").startswith(shoes)), None)
    if not shoe or not other:
        raise SystemExit("not enough units on store-01's floor — run e2e/pos-flow/provision.sh again")
    return ({"epc": shoe, "name": catalogue[shoe[2:13]]["name"]},
            {"epc": other, "name": catalogue[other[2:13]]["name"]})


def quote(store: Api, epc: str, member: str | None) -> dict:
    return store.post("/api/v1/store/quote", {"epcs": [epc], "coupon_codes": [],
                                              "customer_id": member, "charges": []})


def member_row(cloud: Api) -> dict:
    return next(iter(rows(cloud.get(f"/api/v1/members?q={MEMBER}"), "members")), {})


def cloud_sales(cloud: Api) -> list[dict]:
    return rows(cloud.get("/api/v1/sales?limit=500"))


def store_total(store: Api) -> int:
    pools = rows(store.get("/api/v1/inventory/pools"))
    return sum(int(p.get("on_hand") or 0) for p in pools)


def today_posting(cloud: Api) -> dict | None:
    today = datetime.now(WIB).date().isoformat()
    live = [p for p in rows(cloud.get(f"/api/v1/finance/sales-postings?site={SITE}"))
            if p.get("business_date") == today and p.get("status") in ("DRAFT", "POSTED")]
    return live[0] if live else None


def till_sale(till: Browser, epc: str, *, member: str | None, pay: str, label: str) -> dict:
    """Ring one unit up on the counter screen and pay. Returns what the
    screen said: total, change, sale id."""
    till.fill("textbox", "Pindai tag", epc)
    till.run("press", "Enter")
    if not till.wait_text("1 unit", 15):
        raise RuntimeError(f"{label}: the basket never showed the scanned unit")
    if member:
        till.fill("textbox", "Nomor member", member)
        till.run("press", "Enter")
        till.wait_text("Perkiraan poin", 10)
    till.run("wait", "1200")
    screen = till.text()
    shot_basket = till.shot(f"till-{label}-basket")
    pay_button = till.ref("button", "Bayar Rp")
    total_text = re.search(r'button "Bayar (Rp [\d.]+)"', till.snapshot())
    total = int(total_text.group(1)[3:].replace(".", "")) if total_text else -1
    till.run("click", pay_button)
    till.wait_text("Metode pembayaran", 10)
    if pay == "CASH":
        till.click("button", "Tunai")
        snap = till.snapshot()
        amounts = [(int(m.group(1).replace(".", "")), m.group(2))
                   for m in re.finditer(r'button "Rp ([\d.]+)" \[ref=(e\d+)\]', snap)]
        tendered, ref = next(((a, r) for a, r in sorted(amounts) if a > total), (total, None))
        if ref:
            till.run("click", "@" + ref)
    else:
        till.click("button", "Debit")
        till.click("radio", "BCA")
        till.fill("textbox", "Kode approval EDC", "771234")
        tendered = total
    till.run("wait", "400")
    till.click("button", "Bayar Rp")
    if not till.wait_text("Lunas", 20):
        raise RuntimeError(f"{label}: payment was not accepted: {till.text()[:300]}")
    till.click("button", "Selesaikan transaksi")
    if not till.wait_text("Transaksi selesai", 30):
        raise RuntimeError(f"{label}: the node did not complete the sale: {till.text()[:300]}")
    done = till.text()
    shot_done = till.shot(f"till-{label}-done")
    sale_id = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", done)
    change = re.search(r"Kembalian\s*(Rp [\d.]+)", done)
    till.click("button", "Transaksi berikutnya")
    till.wait_text("Siap untuk transaksi baru", 10)
    return {"sale_id": sale_id.group(0) if sale_id else None, "total": total,
            "tendered": tendered, "change": change.group(1) if change else None,
            "basket_text": screen, "screens": [shot_basket, shot_done]}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen] = []
    browsers = [Browser("pos-e2e-till"), Browser("pos-e2e-store"), Browser("pos-e2e-hub")]
    till, shop, hub = browsers
    try:
        step("setup — nodes, dev servers, baseline")
        for name, url in (("cloud", CLOUD), ("store", STORE)):
            try:
                urllib.request.urlopen(url + "/api/v1/health", timeout=5)
            except Exception as error:  # noqa: BLE001
                raise SystemExit(f"{name} node at {url} is not answering ({error}); "
                                 "run e2e/pos-flow/provision.sh")
        started = ensure_servers()
        # API sessions are the break-glass/bootstrap admins: a sign-in ends the
        # same person's other sessions, so the people the browsers sign in as
        # (dian, maya, rina) are never used here.
        cloud, store = Api(CLOUD, "admin"), Api(STORE, "admin")
        shoe, other = pick_units(store)
        q_shoe, q_other = quote(store, shoe["epc"], MEMBER), quote(store, other["epc"], None)
        base = {"sales": {s["id"] for s in cloud_sales(cloud)}, "member": member_row(cloud),
                "store_total": store_total(store), "posting": today_posting(cloud)}
        print(f"  shoe  {shoe['epc']} {shoe['name']} → quote {rupiah(q_shoe['total_minor'])}, "
              f"{q_shoe.get('points_earned') or 0} points")
        print(f"  other {other['epc']} {other['name']} → quote {rupiah(q_other['total_minor'])}")
        print(f"  baseline: {len(base['sales'])} sales at the centre, store holds "
              f"{base['store_total']}, Sari has {base['member'].get('points_balance')} points")

        # ── the till ──────────────────────────────────────────────────────
        step("till — dian rings up two sales on POS-01 (pos-desktop/ui, headless)")
        till.run("set", "viewport", "1440", "900")
        till.open(TILL_UI)
        till.run("eval", "localStorage.removeItem('pos-shim:node-config')")
        till.open(TILL_UI)
        check("till", "cashier signs in at the counter",
              sign_in(till, "dian", user_label="Nama pengguna", pass_label="Kata sandi",
                      button="Masuk", ready="Pindai tag"), "dian @ store-01")
        if "Buka shift" in till.text():
            till.fill("textbox", "Modal awal", "500000")
            till.click("button", "Buka shift")
            till.wait_text("Pindai tag", 15)
        till.shot("till-ready")
        sale_a = till_sale(till, shoe["epc"], member=MEMBER, pay="CASH", label="A")
        promo = next((p["name"] for p in q_shoe.get("promotions") or [] if p.get("applied")), "?")
        check("till", "promotion shown on the basket", promo in sale_a["basket_text"], promo)
        check("till", "member points estimated on the basket",
              f"+{q_shoe.get('points_earned')}" in sale_a["basket_text"].replace(" ", ""),
              f"+{q_shoe.get('points_earned')} poin")
        check("till", "sale A total = node quote", sale_a["total"] == q_shoe["total_minor"],
              f"screen {rupiah(sale_a['total'])} vs quote {rupiah(q_shoe['total_minor'])}")
        check("till", "sale A completed (cash, change)", bool(sale_a["sale_id"]),
              f"{sale_a['sale_id']} · tendered {rupiah(sale_a['tendered'])} · change {sale_a['change']}")
        sale_b = till_sale(till, other["epc"], member=None, pay="DEBIT", label="B")
        check("till", "sale B total = node quote", sale_b["total"] == q_other["total_minor"],
              f"screen {rupiah(sale_b['total'])} vs quote {rupiah(q_other['total_minor'])}")
        check("till", "sale B completed (BCA debit)", bool(sale_b["sale_id"]), str(sale_b["sale_id"]))
        sales = {"A": (sale_a, shoe), "B": (sale_b, other)}

        # ── the store node and the store app ──────────────────────────────
        step("store — the shop's node and its back-office app")
        places = {}
        for move in sorted(rows(store.get("/api/v1/inventory/movements?limit=5000")),
                           key=lambda m: m["occurred_at"]):
            places[move["epc"]] = move["to"]
        for key, (sale, unit) in sales.items():
            receipt = None
            try:
                receipt = store.get(f"/api/v1/store/sales/{sale['sale_id']}/receipt")
            except RuntimeError as error:
                receipt = {"error": str(error)}
            check("store", f"sale {key} on the store node", receipt is not None and "error" not in receipt,
                  json.dumps(receipt)[:120] if receipt and "error" in receipt else "receipt readable")
            check("store", f"sale {key}'s unit left the floor",
                  places.get(unit["epc"]) == "external/customer",
                  f"{unit['epc']} → {places.get(unit['epc'])}")
        now_total = store_total(store)
        check("store", "store stock down by two", now_total == base["store_total"] - 2,
              f"{base['store_total']} → {now_total}")

        shop.run("set", "viewport", "1440", "900")
        shop.open(STORE_UI + "/money/sales")
        snap = shop.snapshot()
        user = next((n for n in ("Username", "Nama pengguna", "User") if shop.ref("textbox", n, snap)), None)
        button = next((n for n in ("Sign in", "Masuk", "Log in") if shop.ref("button", n, snap)), None)
        if user and button:
            pw = next((n for n in ("Password", "Kata sandi") if shop.ref("textbox", n, snap)), "Password")
            sign_in(shop, "maya", user_label=user, pass_label=pw, button=button, ready="Sales")
            shop.open(STORE_UI + "/money/sales", 3500)
        text = shop.text()
        shop.shot("store-money-sales")
        check("store", "store app › Money › Sales loads with today's trade",
              "Sales" in text and "Rp" in text and "error" not in text.lower())
        shop.open(STORE_UI + "/stock", 3500)
        text = shop.text()
        shop.shot("store-stock")
        check("store", "store app › Stock shows the node's on-hand",
              str(now_total) in text, f"expects {now_total} on hand")
        shop.open(STORE_UI + "/promotions", 3500)
        text = shop.text()
        shop.shot("store-promotions")
        check("store", "store app › Promotions lists the shoe promotion", "15%" in text,
              "Diskon 15% Sandal & Sepatu")

        # ── the cloud ─────────────────────────────────────────────────────
        step("cloud — sync to head office")
        wanted = {sale_a["sale_id"], sale_b["sale_id"]}
        def arrived():
            present = [s for s in cloud_sales(cloud) if s["id"] in wanted]
            return present if len(present) == len(wanted) else None
        by_id = {s["id"]: s for s in (wait_for("sales at the centre", arrived, 120, 3) or [])}
        for key, (sale, _unit) in sales.items():
            row = by_id.get(sale["sale_id"], {})
            check("cloud", f"sale {key} synced to the centre", row.get("source") == "EDGE"
                  and row.get("status") == "COMPLETED" and row.get("total_minor") == sale["total"],
                  f"{row.get('source')} {row.get('status')} {rupiah(row.get('total_minor') or 0)}")
        check("cloud", "member tagged on the synced sale",
              by_id.get(sale_a["sale_id"], {}).get("customer_id") == MEMBER, MEMBER)
        after = wait_for("member points", lambda: (lambda m: m if (m.get("points_balance") or 0)
                         > (base["member"].get("points_balance") or 0) else None)(member_row(cloud)), 60) \
            or member_row(cloud)
        gained = (after.get("points_balance") or 0) - (base["member"].get("points_balance") or 0)
        check("cloud", "member points credited at the centre", gained == (q_shoe.get("points_earned") or 0),
              f"+{gained} (quote said +{q_shoe.get('points_earned')})")
        check("cloud", "member spend and visits moved",
              (after.get("transaction_count") or 0) == (base["member"].get("transaction_count") or 0) + 1
              and (after.get("spent_minor") or 0) == (base["member"].get("spent_minor") or 0) + sale_a["total"],
              f"{after.get('transaction_count')} visits, {rupiah(after.get('spent_minor') or 0)}")

        # ── the hub ───────────────────────────────────────────────────────
        step("hub — head office reads the same day (frontend-hub, headless)")
        hub.run("set", "viewport", "1440", "900")
        hub.open(HUB_UI + "/sales")
        sign_in(hub, "rina", user_label="Username", pass_label="Password", button="Sign in",
                ready="Selling")
        hub.open(HUB_UI + "/sales", 4000)
        text = hub.text()
        hub.shot("hub-sales")
        site_sales = [s for s in cloud_sales(cloud) if s.get("status") == "COMPLETED"]
        total = sum(s["total_minor"] for s in site_sales)
        match = re.search(r"(Rp [\d.]+) over (\d+) transactions", text)
        check("hub", "Selling › Sales counts the till's sales",
              bool(match) and match.group(2) == str(len(site_sales)) and match.group(1) == rupiah(total),
              f"screen '{match.group(0) if match else '?'}' vs centre {rupiah(total)} over {len(site_sales)}")
        hub.open(HUB_UI + "/members", 4000)
        text = hub.text()
        hub.shot("hub-members")
        lines_ = text.splitlines()
        at = next((i for i, l in enumerate(lines_) if "Sari Wulandari" in l), None)
        line = " ".join(lines_[at:at + 2]) if at is not None else ""
        nums = [n.strip() for n in re.split(r"\t+", line)]
        check("hub", "Members shows Sari's new points and spend",
              str(after.get("points_balance")) in nums and rupiah(after.get("spent_minor") or 0) in line,
              line.strip()[:120])
        hub.open(HUB_UI + "/inventory", 4000)
        text = hub.text()
        hub.shot("hub-inventory")
        store_line = re.search(r"Store 01\s+(\d+) Piece\s+(\d+) Piece", text)
        check("hub", "Inventory › Stock shows the store's new on-hand",
              bool(store_line) and int(store_line.group(1)) == now_total,
              f"hub {store_line.group(1) if store_line else '?'} vs node {now_total}")
        try:
            hub.open(HUB_UI + "/commercial/promotions", 6000)
            text = hub.text()
            hub.shot("hub-promotions")
            check("hub", "Commercial › Promotions lists the promotion the till applied",
                  "Sandal & Sepatu" in text, "Diskon 15% Sandal & Sepatu")
        except RuntimeError as error:
            check("hub", "Commercial › Promotions lists the promotion the till applied", False, str(error)[:160])

        # ── finance ───────────────────────────────────────────────────────
        step("finance — the day reaches the books (hub › Finance › Sales Postings)")
        posting = today_posting(cloud)
        today = datetime.now(WIB).date()
        day_sales = [s for s in site_sales if s.get("site_id") == SITE and datetime.fromisoformat(
            s["completed_at"].replace("Z", "+00:00")).astimezone(WIB).date() == today]
        if posting and posting["status"] == "POSTED" and posting["sale_count"] < len(day_sales):
            findings.append(
                f"{SITE}'s day was already POSTED with {posting['sale_count']} sales when the till rang "
                f"two more; the hub has no Reverse action on Sales Postings and does not flag late sales, "
                f"so the test reversed it through POST /finance/sales-postings/{{id}}/reverse")
            cloud.post(f"/api/v1/finance/sales-postings/{posting['posting_id']}/reverse",
                       {"reason": "e2e: sales rung after the day was posted"})
            check("finance", "posted day reversed to take the late sales", True, posting.get("entry_number") or "")
        hub.open(HUB_UI + "/finance/receivables/sales-postings", 3500)
        hub.click("combobox", "")  # the shop chooser
        hub.run("wait", "500")
        hub.click("option", SITE_CODE)
        hub.run("wait", "2000")
        if today_posting(cloud) is None or today_posting(cloud)["status"] == "DRAFT":
            hub.click("button", "Generate draft")
            hub.run("wait", "3500")
        snap = hub.snapshot()
        hub.shot("hub-sales-posting-draft")
        draft = today_posting(cloud) or {}
        check("finance", "draft carries every sale of the day",
              draft.get("sale_count") == len(day_sales),
              f"{draft.get('sale_count')} sales, {rupiah(draft.get('gross_minor') or 0)}")
        if draft.get("status") == "DRAFT":
            hub.click("button", "Post to ledger")
            hub.run("wait", "800")
            hub.click("button", "Confirm post")
            hub.run("wait", "3500")
        hub.shot("hub-sales-posting-posted")
        posted = today_posting(cloud) or {}
        check("finance", "day posted from the hub", posted.get("status") == "POSTED",
              f"{posted.get('status')} {posted.get('entry_number')}")
        if posted.get("journal_entry_id"):
            journal = cloud.get(f"/api/v1/finance/journal/{posted['journal_entry_id']}")
            lines = journal["lines"]
            debit = sum(l["debit_minor"] for l in lines)
            credit = sum(l["credit_minor"] for l in lines)
            check("finance", "SALE_DAY journal balances", debit == credit,
                  f"Dr {rupiah(debit)} = Cr {rupiah(credit)}")
            check("finance", "journal total = the day's takings",
                  journal["entry"]["total_minor"] == posted["gross_minor"],
                  f"{rupiah(journal['entry']['total_minor'])}")
            bca = sum(l["debit_minor"] for l in lines if "BCA" in (l.get("memo") or ""))
            check("finance", "BCA debit takings carry sale B",
                  bca >= sale_b["total"], f"Piutang Debit Card BCA {rupiah(bca)}")
            cogs = [r for r in rows(cloud.get("/api/v1/finance/journal?kind=COGS_DAY&limit=500"), "rows")
                    if r["source_id"].startswith(posted["posting_id"])]
            live = [r for r in cogs if not r.get("reversed_by") and not r.get("reversal_of")]
            attempts = {r["source_id"].rsplit(":", 1)[-1] for r in live}
            check("finance", "COGS posted for the day, earlier attempts unwound",
                  bool(live) and len(attempts) == 1,
                  f"{len(live)} live HPP entries ({', '.join(sorted(attempts))}), "
                  f"{rupiah(sum(r['total_minor'] for r in live))}")
            hub.open(HUB_UI + "/finance/accounting/journal-entries", 4500)
            text = hub.text()
            hub.shot("hub-journal-entries")
            check("finance", "Journal Entries lists the posted day",
                  posted["entry_number"] in text, posted["entry_number"])
        return 0 if all(c["ok"] for c in checks) else 1
    except Exception as error:  # noqa: BLE001
        check("run", "test ran to the end", False, f"{type(error).__name__}: {error}")
        for browser in browsers:
            browser.shot(f"crash-{browser.session}")
        return 1
    finally:
        for browser in browsers:
            browser.close()
        for proc in started:
            proc.terminate()
        write_report()


def write_report() -> None:
    passed = sum(c["ok"] for c in checks)
    (OUT / "report.json").write_text(json.dumps({"stamp": STAMP, "checks": checks,
                                                 "findings": findings}, indent=2))
    lines = [f"# POS integration — {STAMP}", "", f"{passed}/{len(checks)} checks passed", "",
             "| area | check | result | detail |", "|---|---|---|---|"]
    lines += [f"| {c['area']} | {c['check']} | {'PASS' if c['ok'] else 'FAIL'} | "
              f"{c['detail'].replace('|', '/')} |" for c in checks]
    if findings:
        lines += ["", "## Findings", ""] + [f"- {f}" for f in findings]
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    print(f"\n{passed}/{len(checks)} checks passed — {OUT.relative_to(ROOT)}/report.md", flush=True)


if __name__ == "__main__":
    if shutil.which("agent-browser") is None:
        raise SystemExit("agent-browser is not on PATH (npm i -g agent-browser && agent-browser install)")
    sys.exit(main())
