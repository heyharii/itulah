# Goods flow build — 1 Oct 2026

The prototypes in the repo root (`receive-review-prototype.html`, `outbound-board-prototype.html`,
`md-flows-prototype.html`, `ops-stock-prototype.html`, `returns-prototype.html`) moving into
frontend-hub. Owner rulings that override the prototypes:

- Every shortage (pick, pack, transit, store receive, HO receive, count) is **Missing**. A supplier's
  short/over against a PO is not Missing — it is settled on the PO.
- Missing: **Move** (found, Ops and Inventory) or **Write off** (Inventory only → Stock Adjustment).
  Finance only sees the journal; no approval step. Age shown; over 30 days is red.
- No inspect step for store returns. No Lost on the outbound board (removed).
- A store never starts a return; Merchandise asks. The store has **no pick flow**: one **Sent**
  button per request. HO counts it in (Receiving › Store returns) → that store's return stock.
- Return to supplier: over-delivery (from a PO, nothing back, closes at hand-over) or from HO return
  stock with a reason and a **Settle by** agreed with the supplier: Replacement · Refund · Credit note.
  The supplier may settle in any mix; tracked in rupiah until nothing is owed, or Buying closes it short.
  Replacement goods are counted by Ops Receiving; refunds (BKM) and credit notes by Finance.
- Copy: no explanatory subtitles, notes or footnotes. Short labels. Rows spacious (two-line cells breathe).

## Ops menu

Receiving (PO | Store returns) · Printing · Outbound (To stores | To suppliers | Spread) · Stock (+ Missing) · Count.
Node/Sync/Account move to System.

## API contracts (new — backend being written alongside)

### Cloud · supplier returns (RETURN_TO_SUPPLIER allotments + their terms)
```
GET  /api/v1/supplier-returns                       → { items: SupplierReturn[] }
POST /api/v1/supplier-returns                       body NewSupplierReturn → SupplierReturn
POST /api/v1/supplier-returns/{allotment_id}/settlements  body NewSettlement → SupplierReturn
POST /api/v1/supplier-returns/{allotment_id}/close-short  body { reason: string } → SupplierReturn

SupplierReturn {
  allotment_id: string; allotment_number: string;
  supplier_id: string; supplier_name: string | null;
  reason: "OVER_DELIVERY" | "ITEM_MISMATCH";   // 0828: the owner's two, 2026-10-04
  settle_by: "REPLACEMENT" | "REFUND" | "CREDIT_NOTE";
  status: "TO_HAND_OVER" | "WAITING" | "PARTLY_SETTLED" | "SETTLED" | "CLOSED_SHORT";
  quantity: number;              // pcs on the return
  value_minor: number;           // rupiah value at the cost it was bought at
  settled_minor: number;         // sum of settlements
  owed_minor: number;            // value - settled, 0 once settled or closed short
  raised_by: string; raised_at: string;
  handed_over_at: string | null;
  closed_short_reason: string | null;
  letter_id: string | null;      // the surat issued on confirm (SJR series)
  letter_number: string | null;
  lines: { sku_code: string; article_name: string | null; quantity: number; unit_cost_minor: number }[];
  settlements: { kind: "REPLACEMENT" | "REFUND" | "CREDIT_NOTE"; quantity: number | null;
                 amount_minor: number; reference: string | null; recorded_by: string; recorded_at: string }[];
}
NewSupplierReturn { supplier_id: string; reason; settle_by; source_pool_id: string;
                    lines: { sku_code: string; quantity: number }[]; note?: string | null }
NewSettlement { kind; quantity?: number | null /* REPLACEMENT */; amount_minor?: number | null /* REFUND, CREDIT_NOTE */;
                reference?: string | null }
```
Confirming a return (the POST) issues its surat in the same transaction: a
`SUPPLIER_RETURN` letter (surat jalan retur supplier, series `SJR`), drawn from
the allotment — reason, person in charge, generation date, the goods with the
reason beside them, a QR that opens the letter in the register, and two
signature blocks: the person in charge and the supplier's receiving
acknowledgement. It prints in English, as the purchase order does (owner,
2026-10-04). Over-delivery returns stay on `GET /api/v1/purchase-returns`
(unchanged).

### Store node · returns Merchandise asked for
```
GET  /api/v1/store/return-requests                   → { items: StoreReturnAsk[] }
POST /api/v1/store/return-requests/{allotment_id}/send body { idempotency_key: string } → { shipment_number: string; quantity: number }

StoreReturnAsk { allotment_id: string; allotment_number: string; requested_at: string;
                 quantity: number; lines: { sku_code: string; name: string | null; quantity: number }[] }
```
`send` picks, packs, seals and dispatches the whole request in one act; the Gudang then sees it on
`GET /api/v1/dc/inbound?status=IN_TRANSIT` like any store return.

### Removed
`POST /api/v1/inventory/shipments/received/{receipt_id}/lost`, migration 0717 `receiving_gap_settlement`,
`WriteOffRequest`, `ReceivedShipment.lost_qty`.

## Build status (1 Oct, end of day) — all written, nothing compiled or run yet

### Backend (Rust) — needs `cargo build`, `make contract`, route catalogue bless (own lines only), integration tests
- Cloud `supplier_returns.rs` + migration **0717** (supplier_return, _cost, _settlement); routes `/api/v1/supplier-returns*` (Supervisor). `SupplierReturnLine.article_code` added.
- Cloud `received_shipments.rs` (no lost write-off any more), `sku_suppliers.rs`.
- Cloud counts: over-count closes an open Missing of the same subject+pool as **FOUND** (cloud path) — `counts.rs`; count detail lines carry `article_name`.
- Cloud missing rows: `article_name`, `missing_cause`, `missing_reference_type/id`; movements rows: `article_name`.
- Transit shorts: migration **0718** `edge_transit_short`; `issue_waiting_transit_shorts_tx` on heartbeat (capability `inventory.transit_short.v1`); command `inventory.in_transit.short.v1` (sync/transfer.rs) → edge `apply_in_transit_short` books in-transit → Missing (COUNT_SHORTAGE, ref STORE_RECEIPT); release takes a piece out of Missing (FOUND) before handing over.
- Edge official count adjust: an over-count of an EPC that is Missing in that pool → FOUND instead of rejecting.
- Edge: `/api/v1/store/return-requests` (+ `/{id}/send` = pick → pack+seal → dispatch trip); sqlite migration **0071** (tagging_job.receipt_line_id) and TaggingWorkJob `po_number/supplier_name/delivered_at`; PurchaseWorkLine `recount_reason`.
- Cloud `article_history.rs`: `GET /api/v1/inventory/articles/{article_code}/history` (Cashier) → ArticleHistory — PO ordered, allotment created/cancelled, movements grouped per group+leg with the PO/receipt of goods-receipt groups. One answer, no paging (one PO per article).
- Close short per line (allotment-v1 §7): cloud `allotment_close_short.rs` — `GET /api/v1/inventory/allotments/unfilled` (lines whose SKU supply at the source pool is below what is still to pack, i.e. after the short-pick RFID count booked Missing) and `POST /api/v1/inventory/allotments/{id}/close-short`; written as `cancelled_quantity` on progress + event ALLOTMENT_CANCELLED ref CLOSE_SHORT; command `inventory.allotment.close_short.v1` (capability `inventory.allotment_close_short.v1`, DC) → edge `apply_allotment_close_short`. No result fact: a line packed past it refuses the command.
- Contract TS hand-written in ts-rs shape for: UnfilledList, UnfilledLine, ClosedShortLine, AllotmentCloseShortRequest/Line, ArticleHistory, ArticleHistoryEvent, ReceivedShipment, SkuSupplier(List), MissingRow, MovementRow, TaggingWorkJob, PurchaseWorkLine — `make contract` must reproduce them.

### Frontend (hub, store app) — needs `tsc -b`, browser pass on the rig
- Ops: menu Receiving · Printing · Outbound · Stock · Count · Stock ledger; Node → System. Receiving tabs, Count (RFID task list only), Stock ledger, Outbound To stores | To suppliers | Spread, Printing per PO, short pick → RFID count task, Ops › Stock (option A, in progress).
- Buying: Review count (moved from Ops, `?verify=`), Recounting, Return to supplier with settlements + Close short + Expect replacement (Rp 0 PO `RPL-…`, settles on accept).
- Inventory: Missing (Move / Write off, From/Age), Counts review (Book/Counted/Becomes, article names).
- MD: Return to HO New return; Top up; Cancel and re-allot (save rule relaxed in those modes).
- Finance: Credit note visible + "Settles return"; BKM "Refund for return".
- Store app: Return to HO with one Sent button (Send screen removed).

### Deferred
- Nothing for Ops. Top up removed (owner: a new allotment instead).
