"""people — a month of HR behind every People, Me and Store-HR screen.

Runs last (after finance and ga), on top of what demo-seed.sh left: five
people (Rina, HR manager at head office; Nina and Yusuf at head office/DC;
Maya and Dian at store-01), their contracts, pay, payroll identity, leave
grant, the next two weeks of roster, and who may sign in at which node.

What it adds, in the order the domain accepts it:

  attendance  the last two working weeks rostered (PAGI), a fingerprint
              terminal at store-01 and at head office, and the punches those
              terminals delivered (Dian late once, Rina staying two agreed
              hours late once)
  requests    leave (Dian's filed by Maya and approved by Rina; Nina's and
              Rina's own pending), overtime (Rina's ordered by Yusuf and
              agreed; Dian's awaiting her answer), expense claims (Dian's filed
              by Maya and approved by Rina; Rina's own submitted), Rina's
              grievance, a roster swap, a promotion proposal
  talent      a hire proposal from Maya approved by head office, its applicant,
              interview and offer; a training programme with participants; the
              month's performance scores; an onboarding checklist; a uniform
  payroll     components and ratified rates, Maya's incentive for Dian, the
              month's attendance closed at both places, then the September run
              at store-01 (opened and submitted by Maya) and at head office
              (opened and submitted by Yusuf), each approved by Rina, handed to
              Finance (the accrual journal), head office's settled from the
              Giro BCA; the HR scheduler run once

## Who acts

Signed in (`--password`, a rig with sign-in required), every step is done by
the person whose job it is, through the door that person uses:

  rina   the cloud, signed in as herself (HR manager, Admin): head office's
         decisions — approvals, the catalogue, the offer, the handover
  maya   store-01's till: signed in at the STORE node, whose relay
         (`/api/v1/store/central/…`) carries her HR calls to the cloud — the
         path the store app's /hr screens take. Payroll is not on the relay
         list, so she opens and submits store-01's run at the cloud, signed in
         as herself (a Supervisor, bounded to her posting)
  yusuf  the cloud, as himself: the DC node relays nothing, and his posting
  nina   (head office) is what bounds what he may order or submit

Maker ≠ checker is therefore true on every four-eyes step: Maya or Yusuf
signs a payroll run, Rina approves it; Maya files, Rina decides.

With sign-in off (no password) every direct call is `development` = Rina and
the store node refuses to relay (it signs nobody in). The module then falls
back to what the rig allows: it sends the node's relay request itself
(`x-relay-origin` + `x-relay-user`, signed with the node's sync key), and sets
the payroll submission's signer by SQL (`sign_submission`), because no route
can carry a second person there.

The punches are the stations' own delivery in both modes: the node's machine
route, signed with the node's sync key (a person never reaches it, and the
edge's own punch route takes only "now", not two weeks back).

Re-runnable: every write is keyed (ids, codes, titles) and skipped when found.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WIB = timezone(timedelta(hours=7))

TODAY = date.today()
PERIOD = TODAY.strftime("%Y-%m")
MONTH_FIRST = TODAY.replace(day=1)


def rows(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("rows", "items", "data", "results"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def say(text):
    print(f"  {text}", flush=True)


def working_days_before(day: date, count: int):
    out, d = [], day - timedelta(days=1)
    while len(out) < count:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def next_working_day(day: date, skip: int = 0):
    d = day
    while True:
        d += timedelta(days=1)
        if d.weekday() < 5:
            if skip == 0:
                return d
            skip -= 1


# ---------------------------------------------------------------------------
# the rig: sync key (punch delivery) and, with sign-in off, the relay and the
# one SQL step

def rig_env(cloud_base: str) -> dict:
    port = cloud_base.rstrip("/").rsplit(":", 1)[-1]
    for env in sorted((ROOT / "runs").glob("*/env")):
        values = {}
        for line in env.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
        if values.get("CLOUD_PORT") == port:
            return values
    return {}


class Relay:
    """The call a node sends on behalf of the person signed in at it."""

    def __init__(self, cloud, origin: str, user_id: str, name: str, sync_key: str):
        self.cloud, self.origin, self.user_id, self.name, self.key = (
            cloud, origin, user_id, name, sync_key)

    def call(self, method, path, body=None, ok=(200, 201)):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.cloud.base + path, data=data, method=method)
        req.add_header("content-type", "application/json")
        req.add_header("x-sync-key", self.key)
        req.add_header("x-relay-origin", self.origin)
        req.add_header("x-relay-user", self.user_id)
        if method != "GET":
            req.add_header("Idempotency-Key", str(uuid.uuid4()))
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                status, payload = resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                status, payload = error.code, json.loads(raw)
            except json.JSONDecodeError:
                status, payload = error.code, raw[:300].decode("utf-8", "replace")
        if ok and status not in ok:
            raise SystemExit(f"relay {self.name}@{self.origin} {method} {path} → {status}: {payload}")
        return payload

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)


class Till:
    """A person signed in at a store node: their HR calls go up through the
    node's relay, exactly as the store app's /hr screens send them. Callers
    write the cloud's own path (`/api/v1/employees/…`); the prefix is added
    here, the way `frontend-store-new/src/lib/cloud.ts` does."""

    PREFIX = "/api/v1/store/central/"

    def __init__(self, node):
        self.node, self.name = node, node.name

    def call(self, method, path, body=None, ok=(200, 201)):
        if not path.startswith("/api/v1/"):
            raise SystemExit(f"till path must be the cloud's /api/v1/… path: {path}")
        return self.node.call(method, self.PREFIX + path[len("/api/v1/"):], body, ok)

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body):
        return self.call("POST", path, body)


def psql(db: str, sql: str) -> str:
    return subprocess.run(["psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql],
                          check=True, capture_output=True, text=True).stdout.strip()


class Cast:
    """Who does what, and through which door (see the module doc)."""

    def __init__(self, cloud, ctx, env):
        self.rina = cloud
        password, as_user = ctx.get("password"), ctx.get("as_user")
        self.signed_in = bool(password and as_user)
        if self.signed_in:
            self.maya_till = Till(as_user("store", "maya"))
            self.maya = as_user("cloud", "maya")
            self.yusuf = as_user("cloud", "yusuf")
            self.nina = as_user("cloud", "nina")
            self.sync_key = os.environ.get("SYNC_KEY") or env.get("SYNC_KEY") or ""
            self.db = ""
            return
        # Sign-in off: the node's relay request, sent by this stage, and the
        # payroll signer set by SQL. Everything else is `development`.
        self.sync_key = os.environ.get("SYNC_KEY") or env.get("SYNC_KEY") or ""
        self.db = os.environ.get("DEMO_DB") or env.get("DB_NAME") or ""
        users = {u["username"]: u["id"] for u in rows(cloud.get("/api/v1/auth/users"))}
        self.maya_till = Relay(cloud, "store-01", users["maya"], "maya", self.sync_key)
        self.yusuf = Relay(cloud, "dc", users["yusuf"], "yusuf", self.sync_key)
        self.nina = Relay(cloud, "dc", users["nina"], "nina", self.sync_key)
        self.maya = cloud  # sign-in off: `development`, signer fixed by sign_submission

    def payroll_maker(self, place):
        """Who opens and submits a place's run: its own signatory."""
        if self.signed_in:
            return {"store-01": self.maya, "ho": self.yusuf}[place]
        return self.rina

    def sign(self, run_id, place):
        if not self.signed_in:
            sign_submission(self.db, run_id, {"store-01": "maya", "ho": "yusuf"}[place])


# ---------------------------------------------------------------------------

def run(cloud, dc, store, ctx):
    print("\n\033[1m── demo-populate: people — attendance, requests, talent, payroll\033[0m", flush=True)
    staff = {r["employee_code"]: r for r in rows(cloud.get("/api/v1/employees?limit=100"))}
    missing = [c for c in ("HO-0001", "HO-0006", "HO-0007", "ST-0101", "ST-0102") if c not in staff]
    if missing:
        raise SystemExit(f"people: demo-seed people missing: {missing}")
    rina, nina, yusuf, maya, dian = (staff[c]["employee_id"] for c in
                                     ("HO-0001", "HO-0006", "HO-0007", "ST-0101", "ST-0102"))
    # Who may sign in at which node (Maya, Dian at store-01; Yusuf, Nina at the
    # DC) is demo-seed's: a relay is believed only for a person assigned there.
    cast = Cast(cloud, ctx, rig_env(cloud.base))
    say("acting: " + ("Rina at the cloud, Maya at store-01's till (node relay) and at the cloud "
                      "for payroll, Yusuf and Nina at the cloud" if cast.signed_in else
                      "sign-in off — `development` at the cloud, relays sent with the node key"))

    ctx.update(people={"rina": rina, "nina": nina, "yusuf": yusuf, "maya": maya, "dian": dian})
    everyone = {"rina": rina, "nina": nina, "yusuf": yusuf, "maya": maya, "dian": dian}
    place_of = {"rina": "ho", "nina": "ho", "yusuf": "ho", "maya": "store-01", "dian": "store-01"}

    past = working_days_before(TODAY, 10)
    past = [d for d in past if d >= MONTH_FIRST] or past

    attendance(cloud, cast.sync_key, everyone, place_of, past)
    requests(cast, everyone, past)
    talent(cast, everyone)
    payroll(cast, everyone)
    scheduler(cloud)


# ---------------------------------------------------------------------------
# attendance

# (arrive, leave) in minutes past midnight, by person; exceptions by day index.
SHIFT_IN, SHIFT_OUT = 8 * 60, 17 * 60
NORMAL = {"rina": (7 * 60 + 52, 17 * 60 + 5), "nina": (7 * 60 + 48, 17 * 60 + 3),
          "yusuf": (7 * 60 + 45, 17 * 60 + 8), "maya": (7 * 60 + 50, 17 * 60 + 6),
          "dian": (7 * 60 + 55, 17 * 60 + 2)}
TERMINALS = {"store-01": ("FP-STORE01-1", "Mesin absen kasir Store 01", "store-01"),
             "ho": ("FP-HO-1", "Mesin absen lobi Head Office", "dc")}


def attendance(cloud, sync_key, everyone, place_of, past):
    # The last two working weeks, rostered: demo-seed planned only forwards.
    start, end = past[0], past[-1]
    have = set()
    for place in ("ho", "store-01"):
        for day in rows(cloud.get(f"/api/v1/roster?place={place}&from={start}&to={end}")):
            have.add((day.get("employee_id"), day.get("on_date")))
    added = 0
    for who, emp in everyone.items():
        for d in past:
            if (emp, d.isoformat()) in have:
                continue
            cloud.post(f"/api/v1/employees/{emp}/roster", {
                "on_date": d.isoformat(), "plan": "SCHEDULED", "shift_id": "PAGI",
                "reason": "demo: jadwal dua minggu terakhir"})
            added += 1
    say(f"roster: {len(past)} past working days × 5 people ({added} new)")

    # One fingerprint station per place, everyone enrolled on theirs.
    registered = {t["id"] for t in rows(cloud.get("/api/v1/attendance-terminals"))}
    for place, (tid, name, _origin) in TERMINALS.items():
        if tid not in registered:
            cloud.post("/api/v1/attendance-terminals", {
                "terminal_id": tid, "place_id": place, "name": name,
                "reason": "demo: mesin sidik jari terpasang"})
    # No fingerprint enrolment: the rig cloud has no ATTENDANCE_TEMPLATE_KEY,
    # and without it the enrol route refuses (templates are sealed, never
    # stored in the clear). Punch delivery does not depend on it.
    say("terminals: FP-STORE01-1 at store-01, FP-HO-1 at head office")

    # The punches each station delivered. Dian is late on the second Tuesday;
    # Rina stays two hours on the Wednesday Yusuf ordered (see requests).
    # A closed month takes no punch, so a re-run after payroll sends nothing.
    closed = {(place, p.get("period")) for place in TERMINALS
              for p in rows(cloud.get(f"/api/v1/attendance-periods?place={place}"))
              if p.get("status") == "CLOSED"}
    late_day = [d for d in past if d.weekday() == 1][-1]
    ot_day = overtime_day(past)
    by_origin = {}
    for who, emp in everyone.items():
        tid, _name, origin = TERMINALS[place_of[who]]
        for d in past:
            if (place_of[who], f"{d:%Y-%m}") in closed:
                continue
            arrive, leave = NORMAL[who]
            if who == "dian" and d == late_day:
                arrive = 8 * 60 + 25
            if who == "rina" and d == ot_day:
                leave = 19 * 60 + 4
            for direction, minute in (("IN", arrive), ("OUT", leave)):
                at = datetime.combine(d, time(minute // 60, minute % 60), WIB)
                by_origin.setdefault(origin, []).append({
                    "punch_id": f"demo-{emp[-8:]}-{d:%Y%m%d}-{direction}",
                    "employee_id": emp, "terminal_id": tid, "direction": direction,
                    "business_date": d.isoformat(), "minute": minute,
                    "recorded_at": at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "clock_quality": "OK"})
    if not by_origin:
        say("punches: already delivered (the month is closed)")
    for origin, punches in by_origin.items():
        result = terminal_post(cloud, sync_key, origin, punches)
        say(f"punches from {origin}: {result.get('accepted')} new, {result.get('duplicate')} already in"
            + (f", refused {result['refused'][:2]}" if result.get("refused") else ""))


def overtime_day(past):
    return [d for d in past if d.weekday() == 2][-1]


def terminal_post(cloud, sync_key, origin, punches):
    # The station's own route: a node delivering what its terminals read,
    # signed with the node's sync key (no session reaches this route).
    req = urllib.request.Request(cloud.base + "/api/v1/attendance/punches", method="POST",
                                 data=json.dumps({"origin_id": origin, "punches": punches}).encode())
    req.add_header("content-type", "application/json")
    req.add_header("x-sync-key", sync_key)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------------------
# requests: leave, overtime, claims, voice, swap, change

def requests(cast, everyone, past):
    cloud, as_maya, as_yusuf, as_nina = cast.rina, cast.maya_till, cast.yusuf, cast.nina
    rina, dian, maya, nina, yusuf = (everyone[k] for k in ("rina", "dian", "maya", "nina", "yusuf"))
    next_month = (TODAY.replace(day=28) + timedelta(days=4)).replace(day=1)

    # Leave. Dian's day off next week: Maya files it for her at the till (a
    # cashier's rung cannot write through a store node) and head office
    # approves it.
    leave_ids = {r["id"] for r in rows(cloud.get(f"/api/v1/employees/{dian}/leave-requests"))}
    dian_day = next_working_day(TODAY + timedelta(days=(4 - TODAY.weekday()) % 7 or 7) - timedelta(days=1))
    if "demo-leave-dian-1" not in leave_ids:
        as_maya.post(f"/api/v1/employees/{dian}/leave-requests", {
            "request_id": "demo-leave-dian-1", "leave_type": "CUTI_TAHUNAN",
            "from_date": dian_day.isoformat(), "to_date": dian_day.isoformat(),
            "rest_days": [], "reason": "Acara keluarga di Garut"})
        cloud.post(f"/api/v1/employees/{dian}/leave-requests/demo-leave-dian-1/approve",
                   {"reason": "Pengganti kasir sudah diatur kepala toko"})
    # Rina's own, two days in the second week of next month, waiting.
    rina_ids = {r["id"] for r in rows(cloud.get(f"/api/v1/employees/{rina}/leave-requests"))}
    if "demo-leave-rina-1" not in rina_ids:
        d1 = next_working_day(next_month + timedelta(days=6))
        d2 = next_working_day(d1)
        cloud.post(f"/api/v1/employees/{rina}/leave-requests", {
            "request_id": "demo-leave-rina-1", "leave_type": "CUTI_TAHUNAN",
            "from_date": d1.isoformat(), "to_date": d2.isoformat(), "rest_days": [],
            "reason": "Mudik ke Yogyakarta"})
    # Nina asks for a day at the end of next month (her own request, signed in
    # as herself); it waits for head office (Rina) — the row in the queues.
    nina_ids = {r["id"] for r in rows(cloud.get(f"/api/v1/employees/{nina}/leave-requests"))}
    if "demo-leave-nina-1" not in nina_ids:
        d = next_working_day(next_month + timedelta(days=13))
        as_nina.post(f"/api/v1/employees/{nina}/leave-requests", {
            "request_id": "demo-leave-nina-1", "leave_type": "CUTI_TAHUNAN",
            "from_date": d.isoformat(), "to_date": d.isoformat(), "rest_days": [],
            "reason": "Wisuda adik di Semarang"})
    say(f"leave: Dian {dian_day} filed by Maya, approved by Rina; Nina's and Rina's own pending")

    # Overtime. Yusuf ordered Rina's two hours for the month's system audit and
    # she agreed; Maya asks Dian for next week's stock count, not yet answered.
    ot = overtime_day(past)
    orders = {o["id"]: o for o in rows(cloud.get(f"/api/v1/employees/{rina}/overtime-orders"))}
    if "demo-ot-rina-1" not in orders:
        as_yusuf.post(f"/api/v1/employees/{rina}/overtime-orders", {
            "order_id": "demo-ot-rina-1", "on_date": ot.isoformat(), "day_kind": "WORKING",
            "planned_minutes": 120, "reason": "Audit data absensi akhir bulan"})
        orders["demo-ot-rina-1"] = {"state": "ORDERED"}
    if orders["demo-ot-rina-1"].get("state") not in ("AGREED",):
        cloud.post(f"/api/v1/employees/{rina}/overtime-orders/demo-ot-rina-1/consent",
                   {"agreed": True, "reason": "Siap"})
    dian_orders = {o["id"] for o in rows(cloud.get(f"/api/v1/employees/{dian}/overtime-orders"))}
    if "demo-ot-dian-1" not in dian_orders:
        count_day = next_working_day(next_month - timedelta(days=1), 1)
        as_maya.post(f"/api/v1/employees/{dian}/overtime-orders", {
            "order_id": "demo-ot-dian-1", "on_date": count_day.isoformat(), "day_kind": "WORKING",
            "planned_minutes": 120, "reason": "Stock opname awal bulan"})
    say(f"overtime: Rina {ot} ordered by Yusuf, agreed; Dian's awaiting her answer")

    # Expense claims. Dian's taxi to deliver a customer's order, filed for her
    # by Maya at the till and approved by head office; Rina's own trip to
    # store-01, submitted and waiting for somebody else to decide.
    claims = rows(cloud.get("/api/v1/expense-claims"))
    def has_claim(emp, text):
        return any(c.get("employee_id") == emp and text in json.dumps(c) for c in claims)
    if not has_claim(dian, "Antar pesanan pelanggan"):
        c = as_maya.post("/api/v1/expense-claims", {"employee_id": dian, "lines": [{
            "type_code": "TRANSPORT", "description": "Antar pesanan pelanggan ke Dago",
            "spent_on": past[-3].isoformat(), "claimed_minor": 45000}],
            "reason": "Taksi online antar pesanan"})
        cid = c.get("claim_id") or c.get("id")
        as_maya.post(f"/api/v1/expense-claims/{cid}/submission", {"reason": "Struk terlampir"})
        detail = c
        lines = [{"line_id": l.get("line_id") or l.get("id"), "sanctioned_minor": l.get("claimed_minor")}
                 for l in detail.get("lines", [])]
        cloud.post(f"/api/v1/expense-claims/{cid}/decision",
                   {"approve": True, "reason": "Sesuai struk", "lines": lines})
    if not has_claim(rina, "Kunjungan ke Store 01"):
        c = cloud.post("/api/v1/expense-claims", {"lines": [
            {"type_code": "TRANSPORT", "description": "Kunjungan ke Store 01 — tol dan parkir",
             "spent_on": past[-4].isoformat(), "claimed_minor": 68000},
            {"type_code": "MAKAN", "description": "Makan malam lembur audit absensi",
             "spent_on": ot.isoformat(), "claimed_minor": 55000}],
            "reason": "Kunjungan ke Store 01 dan lembur audit"})
        cid = c.get("claim_id") or c.get("id")
        cloud.post(f"/api/v1/expense-claims/{cid}/submission", {"reason": "Bukti terlampir"})
    say("claims: Dian Rp 45.000 (filed by Maya) approved by Rina; Rina's Rp 123.000 submitted")

    # Voice: Rina raises one about the weekend rota.
    if not any("rotasi akhir pekan" in json.dumps(g) for g in rows(cloud.get("/api/v1/grievances"))):
        cloud.post("/api/v1/grievances", {
            "type_code": "JADWAL", "subject": "Pembagian shift akhir pekan",
            "description": "Mohon rotasi akhir pekan yang lebih merata antar staf HO."})
    say("voice: Rina's grievance about weekend rotation")

    # Swap: Rina asks Nina to take her shift next Tuesday.
    swap_day = next_working_day(TODAY, 1)
    swaps = rows(cloud.get("/api/v1/roster-swaps/pending")) + rows(cloud.call("GET", "/api/v1/roster-swaps", ok=None))
    if not any(s.get("with_employee_id") == nina or nina in json.dumps(s) for s in swaps):
        cloud.call("POST", "/api/v1/roster-swaps", {
            "with_employee_id": nina, "on_date": swap_day.isoformat(),
            "reason": "Ada rapat BPJS pagi hari di kantor cabang"}, ok=(200, 201))
    say(f"swap: Rina ↔ Nina on {swap_day}, pending")

    # Change: Maya proposes Dian's promotion to senior cashier grade.
    props = rows(cloud.get("/api/v1/change-proposals"))
    if not any(p.get("employee_id") == dian for p in props):
        as_maya.post(f"/api/v1/employees/{dian}/change-proposals", {
            "kind": "PROMOTION", "props": [{"field": "grade", "to_text": "G3"}],
            "effective_on": next_month.isoformat(),
            "reason": "Kinerja kasir konsisten di atas target"})
    say("change: Maya proposes Dian G2 → G3, pending")


# ---------------------------------------------------------------------------
# talent: recruitment, training, performance, lifecycle, benefits

def talent(cast, everyone):
    cloud, as_maya = cast.rina, cast.maya_till
    rina, dian, maya, nina = (everyone[k] for k in ("rina", "dian", "maya", "nina"))
    start = next_working_day(TODAY + timedelta(days=14))

    proposals = rows(cloud.get("/api/v1/hire-proposals"))
    hp = next((p for p in proposals if "Putri Ayu" in json.dumps(p.get("versions"))), None)
    if hp is None:
        hp = as_maya.post("/api/v1/hire-proposals", {
            "place_id": "store-01", "position": "Kasir", "headcount": 1, "need": "ADDITION",
            "candidate_name": "Putri Ayu", "start_on": start.isoformat(), "contract_kind": "PKWT",
            "contract_ends_on": (start + timedelta(days=364)).isoformat(),
            "base_pay_minor": 5400000, "reason": "Jam buka akhir pekan bertambah"})
    hp_id = hp["id"]
    if hp.get("state") in (None, "PROPOSED", "PENDING", "SUBMITTED"):
        cloud.call("POST", f"/api/v1/hire-proposals/{hp_id}/decision",
                   {"decision": "APPROVE", "reason": "Sesuai rencana tenaga kerja"}, ok=(200, 201, 409))
    # The year's staffing plan for store-01 the requisition sits inside.
    if not rows(cloud.get("/api/v1/recruitment/plans")):
        cloud.post("/api/v1/recruitment/plans", {
            "place_id": "store-01", "position": "Kasir", "span": f"{TODAY.year}-Q4",
            "headcount": 1, "cost_minor": 5400000 * 3, "reason": "Tambahan kasir akhir pekan Q4"})
    applicants = rows(cloud.get("/api/v1/recruitment/applicants"))
    app = next((a for a in applicants if a.get("name") == "Putri Ayu"), None)
    if app is None:
        app = cloud.post(f"/api/v1/recruitment/proposals/{hp_id}/applicants",
                         {"name": "Putri Ayu", "phone": "0812-3000-0021", "source": "WALK_IN"})
    interviews = rows(as_maya.get(f"/api/v1/recruitment/applicants/{app['id']}/interviews"))
    if not interviews:
        at = datetime.combine(TODAY - timedelta(days=2), time(10, 0), WIB).isoformat()
        iv = as_maya.post(f"/api/v1/recruitment/applicants/{app['id']}/interviews", {
            "scheduled_at": at, "interviewer_employee_id": maya, "reason": "Wawancara kasir"})
        as_maya.post(f"/api/v1/recruitment/interviews/{iv['id']}/result", {
            "result": "PASS", "ratings": {"komunikasi": 4, "ketelitian": 4, "pelayanan": 5},
            "note": "Pengalaman kasir 1 tahun di minimarket", "reason": "Lolos wawancara"})
    if not any(o.get("applicant_id") == app["id"] for o in rows(cloud.get("/api/v1/recruitment/offers"))):
        cloud.post(f"/api/v1/recruitment/applicants/{app['id']}/offer", {
            "base_minor": 5400000, "grade": "G1", "starts_on": start.isoformat(), "term": "PKWT",
            "reason": "Sesuai proposal yang disetujui"})
    say("recruitment: Q4 plan; Maya's Kasir requisition approved; Putri Ayu interviewed, offer out")

    programs = rows(cloud.get("/api/v1/training-programs"))
    prog = next((p for p in programs if p.get("title") == "Service Excellence untuk Kasir"), None)
    if prog is None:
        created = cloud.post("/api/v1/training-programs", {
            "title": "Service Excellence untuk Kasir", "on_date": start.isoformat(),
            "place": "Head Office", "cost_minor": 750000, "reason": "Program triwulan IV"})
        prog = rows(created)[0] if isinstance(created, list) else created
        for emp in (dian, maya):
            cloud.post(f"/api/v1/training-programs/{prog['id']}/participants",
                       {"employee_id": emp, "reason": "Nominasi kepala toko"})
    say("training: Service Excellence untuk Kasir, Dian and Maya nominated")

    period_day = f"{PERIOD}-01"
    scores = rows(cloud.get(f"/api/v1/performance/scores?period={period_day}"))
    if not any(s.get("employee_id") == dian for s in scores):
        as_maya.call("PUT", f"/api/v1/employees/{dian}/performance/{period_day}",
                     {"kpi_pct": 104, "manager_score": 4, "reason": "Akurasi kas 100%, sekali terlambat"})
    if not any(s.get("employee_id") == maya for s in scores):
        cloud.call("PUT", f"/api/v1/employees/{maya}/performance/{period_day}",
                   {"kpi_pct": 98, "manager_score": 4, "reason": "Target penjualan hampir tercapai"})
    say(f"performance: {PERIOD} scores for Dian (by Maya) and Maya (by Rina)")

    tasks = rows(cloud.get("/api/v1/lifecycle/tasks"))
    if not any(t.get("employee_id") == dian for t in tasks):
        cloud.call("POST", f"/api/v1/employees/{dian}/lifecycle-tasks", {"kind": "ONBOARDING"},
                   ok=(200, 201, 409))
    say("lifecycle: onboarding checklist for Dian")

    issued = rows(cloud.call("GET", f"/api/v1/employees/{dian}/uniform-issuances", ok=None))
    if not issued:
        as_maya.call("POST", f"/api/v1/employees/{dian}/uniform-issuances", {
            "issued_on": TODAY.isoformat(), "sets": 2, "reason": "Jatah seragam tahunan"}, ok=(200, 201))
    say("benefits: Dian's uniform issued by Maya")


# ---------------------------------------------------------------------------
# payroll

COMPONENTS = [
    # code, label, kind, basis, base_ref, unit, rate
    ("LEMBUR", "Upah lembur jam pertama", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "BASE",
     "OVERTIME_WORKDAY_FIRST_HOUR", {"hours_divisor": 173, "multiplier_bp": 15000}),
    ("LEMBUR_LANJUT", "Upah lembur jam berikutnya", "EARNING", "FRACTION_OF_BASE_PER_UNIT", "BASE",
     "OVERTIME_WORKDAY_LATER", {"hours_divisor": 173, "multiplier_bp": 20000}),
    ("UANG_MAKAN", "Uang makan harian", "EARNING", "RATE_PER_UNIT", None, "ROSTERED_DAY",
     {"rate_minor": 25000}),
    ("INSENTIF", "Insentif penjualan", "EARNING", "PER_OCCASION", None, None, {}),
    ("BPJS_KES", "BPJS Kesehatan karyawan 1%", "DEDUCTION", "SHARE_OF_BASE", "BASE", None,
     {"rate_bp": 100, "cap_minor": 12000000}),
    ("BPJS_JHT", "BPJS JHT karyawan 2%", "DEDUCTION", "SHARE_OF_BASE", "BASE", None, {"rate_bp": 200}),
    ("BPJS_JP", "BPJS Jaminan Pensiun karyawan 1%", "DEDUCTION", "SHARE_OF_BASE", "BASE", None,
     {"rate_bp": 100, "cap_minor": 10547400}),
]


def payroll(cast, everyone):
    cloud, as_maya = cast.rina, cast.maya_till
    dian = everyone["dian"]
    have = {c["code"]: c for c in rows(cloud.get("/api/v1/payroll/components"))}
    for code, label, kind, basis, base_ref, unit, rate in COMPONENTS:
        if code not in have:
            body = {"code": code, "label": label, "kind": kind, "basis": basis, "reason": "demo: komponen gaji"}
            if base_ref:
                body["base_ref"] = base_ref
            if unit:
                body["unit"] = unit
            cloud.post("/api/v1/payroll/components", body)
        rates = rows(cloud.get(f"/api/v1/payroll/components/{code}/rates"))
        if rate and not rates:
            cloud.post(f"/api/v1/payroll/components/{code}/rates", {
                "effective_from": f"{TODAY.year}-01-01", **rate, "reason": "demo: tarif berlaku"})
    say(f"components: {len(COMPONENTS)} defined, rates ratified")

    adjustments = rows(cloud.get(f"/api/v1/payroll/adjustments?place=store-01&period={PERIOD}"))
    if not any(a.get("employee_id") == dian for a in adjustments):
        as_maya.post("/api/v1/payroll/adjustments", {
            "place_id": "store-01", "period": PERIOD, "employee_id": dian,
            "component_code": "INSENTIF", "amount_minor": 300000,
            "reason": "Penjualan tertinggi minggu ketiga"})
    say("adjustment: Maya files Rp 300.000 incentive for Dian")

    # The month's attendance, closed by each place: Maya at the till for
    # store-01, Rina for head office. Last month first: it was paid before the
    # system existed, and left open it reads as "attendance still open, payroll
    # cannot be built" on both the store's and head office's screens.
    year, month = (int(x) for x in PERIOD.split("-"))
    previous = f"{year - (month == 1)}-{(month - 2) % 12 + 1:02d}"
    for place, actor in (("store-01", as_maya), ("ho", cloud)):
        for period in (previous, PERIOD):
            periods = rows(cloud.get(f"/api/v1/attendance-periods?place={place}"))
            if not any(p.get("period") == period and p.get("status") == "CLOSED" for p in periods):
                actor.post(f"/api/v1/attendance-periods/{place}/{period}/closure",
                           {"reason": "Tutup absensi untuk payroll"})
    say(f"attendance {previous} and {PERIOD} closed at store-01 (Maya) and head office (Rina)")

    # The run is the place's: its own signatory opens it and submits it
    # (Maya for store-01, Yusuf for head office), and Rina — who works at
    # neither desk's signature — approves. Handover and payment are hers too.
    runs = {r["place_id"]: r for r in rows(cloud.get("/api/v1/payroll/runs")) if r.get("period") == PERIOD}
    for place in ("store-01", "ho"):
        maker = cast.payroll_maker(place)
        run = runs.get(place) or maker.post("/api/v1/payroll/runs", {
            "place_id": place, "period": PERIOD, "reason": f"Payroll {PERIOD}"})
        rid = run["id"]
        if run.get("state") == "DRAFT":
            run = maker.post(f"/api/v1/payroll/runs/{rid}/submission",
                             {"reason": "Data absensi dan insentif sudah dicek"})
            cast.sign(rid, place)
        if run.get("state") == "SUBMITTED":
            run = cloud.post(f"/api/v1/payroll/runs/{rid}/approve", {"reason": "Disetujui HO"})
        handover = cloud.call("GET", f"/api/v1/payroll/runs/{rid}/finance-handover", ok=None)
        if not isinstance(handover, dict) or "error" in handover:
            handover = cloud.post(f"/api/v1/payroll/runs/{rid}/finance-handover",
                                  {"reason": "Diserahkan ke Finance untuk dibayar"})
        if place == "ho" and handover.get("state") != "PAID":
            handover = cloud.post(f"/api/v1/payroll/runs/{rid}/finance-handover/settlement", {
                "reason": "Transfer gaji dari Giro BCA", "bank_key": "bank_giro", "bank_qualifier": "BCA"})
        slips = rows(cloud.get(f"/api/v1/payroll/runs/{rid}/slips"))
        signed = [h for h in run.get("history") or [] if h.get("step") in ("SUBMITTED", "APPROVED")]
        who = ", ".join(f"{h.get('step').lower()} by "
                        f"{h.get('actor') or (h.get('authorization') or {}).get('actor')}" for h in signed)
        say(f"payroll {rid}: {run.get('state')} ({who or 'history not shown'}), {len(slips)} slips, "
            f"handover {handover.get('state')}")


def sign_submission(db, run_id, username):
    # Sign-in OFF only (a signed-in run submits as the signatory herself).
    # SQL, because no route can carry this for a second person on such a rig:
    # submission is the place's signature and approval head office's, by two
    # different people (`PayrollRun::approve`), but with auth disabled every
    # direct call is `development`, and `/submission` is not on the relay list
    # a store could send it through. The run went through the route; this sets
    # only who signed that submission to the place's own signatory.
    if not db:
        raise SystemExit("people: cannot find the rig database to sign the submission")
    psql(db, f"""
      UPDATE payroll_run
         SET history = (SELECT jsonb_agg(CASE WHEN step->>'step' = 'SUBMITTED'
                                              THEN jsonb_set(step - 'actor', '{{authorization,actor}}', to_jsonb('{username}'::text))
                                              ELSE step END ORDER BY ord)
                          FROM jsonb_array_elements(history) WITH ORDINALITY AS h(step, ord))
       WHERE id = '{run_id}'""")


def scheduler(cloud):
    if not rows(cloud.get("/api/v1/hr-scheduler/runs")):
        cloud.call("POST", "/api/v1/hr-scheduler/run-now", {"reason": "Jalankan tugas HR harian"}, ok=(200, 201, 202))
    say("hr scheduler: ran once")
