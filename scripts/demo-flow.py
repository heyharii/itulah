"""One full pass: sourcing -> PO -> receiving -> setup -> tagging -> print.

Every stage is timed, because the question that matters on a demo floor is not
whether it works but how long somebody stands there waiting. Sync cycles are
five seconds, so the waits are quantised to that and nothing here can be
faster than the cycle it is waiting on.
"""
import sys, uuid, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from demo_flow import *

SIZES = [("02", "S"), ("03", "M"), ("04", "L")]


def one_pass(index, env, sink_before):
    cloud = Node(CLOUD).login("admin", env["INVENTORY_BOOTSTRAP_ADMIN_PASSWORD"])
    dc = Node(DC)
    marks, t0 = [], time.time()

    def mark(label):
        marks.append((label, time.time() - t0))

    tag = f"R{index}-{time.strftime('%H%M%S')}"
    PO = f"PO-{tag}"
    QTY = 6
    _, items = cloud.call("GET", "/api/v1/supplier-items?limit=3")
    item = (items["items"] if isinstance(items, dict) else items)[0]["item"]
    c, _ = cloud.call("POST", "/api/v1/purchase-orders", {
        "po_number": PO, "supplier_id": "SUP02",
        "supplier_name": "Anugerah Garmen Sejahtera", "destination_site_id": "dc-01",
        "origin_kind": "SOURCING", "currency": "IDR", "created_by": "admin",
        "lines": [{"article_code": item["supplier_item_code"], "article_name": item["name"],
                   "division_code": "MENSWEAR", "tags": [], "ordered_quantity": QTY,
                   "unit_price_minor": 55000}]})
    assert c == 201, f"PO ditolak: {c}"
    mark("sourcing + PO di cloud")

    def line():
        _, b = dc.call("GET", "/api/v1/dc/purchase-orders")
        return next((r for r in b["items"] if r["po_number"] == PO), None)
    ln = wait_for("PO turun", line, 150, 3)
    assert ln, "PO tidak turun ke laptop"
    mark("PO turun ke laptop")

    _, rc = dc.call("POST", "/api/v1/dc/goods-receipts",
                    {"supplier_id": "SUP02", "actor_id": "admin",
                     "idempotency_key": str(uuid.uuid4())})
    _, cnt = dc.call("POST", "/api/v1/dc/purchase-counts",
                     {"receipt_id": rc["receipt_id"], "po_line_id": ln["po_line_id"],
                      "counted_quantity": QTY, "actor_id": "checker",
                      "idempotency_key": str(uuid.uuid4())})
    c, ver = dc.call("POST", "/api/v1/dc/purchase-verifications",
                     {"count_id": cnt["count_id"], "verifier_actor_id": "verifier",
                      "decision": "Accept", "invoice_unit_price_minor": 55000,
                      "idempotency_key": str(uuid.uuid4())})
    assert c == 201, f"verify ditolak: {c} {ver}"
    c, _ = dc.call("POST", f"/api/v1/dc/goods-receipts/{rc['receipt_id']}/invoice",
                   {"receipt_id": rc["receipt_id"],
                    "invoice_number": f"INV-{uuid.uuid4().hex[:6].upper()}",
                    "invoice_total_minor": 330000, "actor_id": "admin",
                    "idempotency_key": str(uuid.uuid4())})
    assert c == 200, f"faktur ditolak: {c}"
    mark("terima + count + verify + faktur")

    def unid():
        _, b = cloud.call("GET", "/api/v1/article-setups/unidentified")
        rows = b.get("items", b) if isinstance(b, dict) else b
        return next((r for r in rows if r.get("po_number") == PO), None) if rows else None
    row = wait_for("baris naik ke cloud", unid, 180, 4)
    assert row, "baris tidak sampai ke cloud"
    mark("naik ke cloud (applied)")

    c, s = cloud.call("POST", "/api/v1/article-setups", {
        "receipt_line_id": row["receipt_line_id"], "article_code": None,
        "article_name": f"Tights 200 Den {tag}", "division_code": "MENSWEAR",
        "tags": [], "image_url": None, "currency": "IDR",
        "colours": [{"colour_digit": "1", "colour_code": "BLACK"}],
        "variants": [{"colour_digit": "1", "size_code": code, "quantity": 2,
                      "base_price_minor": 99000} for code, _ in SIZES],
        "created_by": "admin"})
    assert c == 201, f"setup ditolak: {c} {s}"
    c, _ = cloud.call("POST", f"/api/v1/article-setups/{s['session_id']}/issue",
                      {"issued_by": "admin"})
    assert c == 200, f"issue ditolak: {c}"
    mark("setup artikel + terbitkan tagging")

    def job():
        _, b = dc.call("GET", "/api/v1/dc/tagging-jobs")
        rows = b.get("items", b) if isinstance(b, dict) else b
        return next((j for j in rows if j["article_name"].endswith(tag)), None) if rows else None
    jb = wait_for("tagging job turun", job, 180, 4)
    assert jb, "tagging job tidak turun"
    mark("tagging job turun ke laptop")

    c, ses = dc.call("POST", "/api/v1/dc/print-sessions", {
        "job_id": jb["job_id"], "printer_host": "127.0.0.1", "printer_port": 9100,
        "label_width_mm": 58, "label_height_mm": 40, "chunk_size": 10, "actor_id": "admin"})
    assert c == 201, f"sesi cetak ditolak: {c} {ses}"
    c, run = dc.call("POST", f"/api/v1/dc/print-sessions/{ses['session_id']}/run",
                     {"actor_id": "admin"})
    assert c == 200 and run["printed"] == QTY, f"cetak: {run}"
    mark("cetak 6 label")
    return marks, run["printed"]


def main():
    passes = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    env = render_env()
    for i in range(1, passes + 1):
        print(f"\n{'='*62}\nPUTARAN {i}\n{'='*62}")
        started = time.time()
        try:
            marks, printed = one_pass(i, env, 0)
        except AssertionError as error:
            print(f"  GAGAL: {error}")
            return 1
        previous = 0.0
        for label, at in marks:
            print(f"  {at-previous:6.1f}s  {label}")
            previous = at
        print(f"  ------  total {marks[-1][1]:.1f}s, {printed} label dengan EPC")
    return 0


if __name__ == "__main__":
    sys.exit(main())
