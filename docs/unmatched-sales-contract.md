# Unmatched sales — contract (23 Oct 2026)

Owner decisions: a piece the till cannot take from its own store's stock still sells
("barang harus bisa dijual", stock may go minus). The sale always belongs to the
store where the shopper paid; head office matches it later to a piece at a store or
HO, which moves that piece out of that place's stock. Prototypes are the spec:
`pos-classic-prototype.html` (steps 8 Tanpa tag, 9 Tak dikenal) and
`unmatched-sales-prototype.html` (hub `?app=hub`, store app `?app=store`).

## Kinds

| wire | POS label (id) | hub/store label | when |
|---|---|---|---|
| `NO_TAG` | Tanpa tag | No tag | SKU typed, this store holds ≥1 of that SKU on hand |
| `NOT_IN_STOCK` | Luar toko | Not in stock | SKU typed, this store holds none |
| `OTHER` | Dari {place} (or Luar toko when the place is unknown) | Other place | a read tag this store does not hold (unknown EPC, held elsewhere, in transit, already sold) |
| `UNKNOWN` | Tak dikenal | Unknown item | no SKU; Kepala toko names and prices it, finger approval |

## Edge (store node)

`QuoteRequest` and `SaleRequest` gain `#[serde(default)] untagged: Vec<UntaggedLine>`:

```
UntaggedLine {
  sku_code: Option<String>,        // 11 digits, typed off the label
  epc: Option<String>,             // a read tag the till already knows is not held here (optional; the node also classifies `epcs` itself)
  name: Option<String>,            // UNKNOWN only
  unit_price_minor: Option<i64>,   // UNKNOWN only (>0)
  approval_id: Option<String>,     // UNKNOWN only, required at the sale
  supervisor: Option<Supervisor>,  // ignored (kept so older tills still parse)
}
```

- UNKNOWN approval (changed 23 Oct): a finger grant is single-use and short-lived and
  the till re-quotes every ~2 s, so the supervisor never travels on a quote or a sale.
  `POST /api/v1/store/unmatched/approve` `{ name, unit_price_minor, supervisor }` verifies
  the Kepala toko at once (`verify_supervisor`) and stores an approval
  (`unknown_item_approval`: id, name, unit_price_minor, approved_by, created_at,
  used_sale_id) → `201 { approval_id, approved_by, approved_by_name }`. The UNKNOWN line
  carries `approval_id`; a quote verifies nothing for it; the sale checks the approval
  exists, is unused and matches name and price, marks it used in the sale transaction,
  and records `approved_by` as the line's `priced_by`.

- A tag in `epcs` that is on this store's floor sells as today. A tag held in another
  on-hand pool of THIS store (stockroom) sells from that pool. A tag this store does not
  hold (unknown EPC, elsewhere, already sold) never refuses the sale: it becomes an
  `OTHER` unmatched line (SKU from the subject, else EPC chars 2..13).
- SKU lines are priced by the engine like any line (promotions apply). UNKNOWN lines are
  charged their given price, outside promotions and points.
- Quote `lines[]` order (fixed): the tags of `epcs` in request order (held or not), then
  the untagged lines that name a SKU or a tag in request order. UNKNOWN lines are not in
  `lines[]` — only in `untagged[]` — but they are in `total_minor` and `amount_due_minor`.
  `unsellable` stays in the answer, always empty.
- The quote response gains `untagged: Vec<UntaggedQuoteLine>`:
  `{ index (position in request.untagged, or null for a converted epc), epc, kind, sku_code, name, from_place (site name when known), line_total_minor }`
  so the till labels each line.
- Each unmatched line is stored (`unmatched_sale_line`) and travels on the
  `sales.completed` fact as `#[serde(default)] unmatched: Vec<SaleFactUnmatched>`; sale
  totals include them and the cloud's validation counts them.
- `GET /api/v1/store/unmatched?status=open|matched|found` (store app, read-only) relays to
  the cloud with node auth (pattern: `/api/v1/store/benefit/*`).

## Cloud

Table `unmatched_sale_line`: id, sale_id, line_no, site_id, kind, sku_code, epc, name,
unit_price_minor, line_total_minor, sold_at, cashier actor, priced_by (supervisor),
receipt number (as the POS prints it), till label, status `OPEN|MATCHED|FOUND`,
matched_site_id, matched_sku_code, match_doc, matched_by, matched_at, movement_group_id.

HO routes (hub, Sales menu):
- `GET /api/v1/sales/unmatched?status=open|matched|found` →
  `{ rows: [{ id, site_id, site_name, sold_at, receipt_no, till, cashier_name, kind, sku_code, article_name, colour, size, name, price_minor, priced_by_name, status, matched_with, matched_at }] }`
  (`matched_with`: "Transfer from {place}" / "Own stock" / "Count · {doc}").
- `GET /api/v1/sales/unmatched/places` → `[{ site_id, name, is_ho }]` (HO first, then stores A–Z).
- `GET /api/v1/sales/unmatched/stock?site_id=` → `[{ sku_code, article_name, colour, size, on_hand }]`, on_hand > 0.
- `POST /api/v1/sales/unmatched/{id}/match` `{ site_id, sku_code, idempotency_key }` →
  takes one piece of that SKU on hand at that place (cloud movement, cause SALE, to
  Customer, reference `UNMATCHED_SALE`/line id); status MATCHED; `match_doc` = next
  `TRF-####` when the place is not the selling store, else "Own stock". Returns the row.
- Node route for the relay: `GET /api/v1/sync/unmatched?site_id=&status=`.

Not in v1: automatic matching at receive/sweep, FOUND at count close, negative stock in
stock screens.
