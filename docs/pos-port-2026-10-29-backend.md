# POS port 29 Oct 2026 — backend contract

What the store server (edge node, `backend/src/edge`) and head office (`backend/src/cloud`) answer after the 28–29 Oct POS decisions. Written uncompiled: no `cargo check/build/test` was run. Nothing is committed.

Every path is on the store server unless it says "cloud". Every till call carries the usual bearer/cookie session and `x-terminal-id`. Errors use the node's usual problem body; the status codes are 400 Validation, 403 Forbidden, 404 NotFound, 409 Conflict.

Migrations: sqlite `0102_a_return_is_its_own_receipt_and_a_struk_prints_once.sql`, postgres `1006_some_goods_never_come_back_and_a_paper_voucher_is_spent_once.sql`.

---

## 1. No Void and no reprint at the till

| Was | Now |
|---|---|
| `POST /api/v1/store/sales/{sale_id}/void` | **Removed** (the route is gone, so it answers 404/405). A paid struk only comes back by Return. Head office's `POST /api/v1/sales/{id}/void` (cloud) is untouched. |
| `GET /api/v1/store/sales/search?q=&limit=` | **Removed.** See §2. |
| `GET /api/v1/store/shifts/{id}/sales` as a cashier (it returned the last three) | **403** `"Struk dicari dengan nomor lengkapnya"`. Supervisors and admins still get the drawer's list (store app). |
| `POST /api/v1/store/sales/{sale_id}/receipt` (network print) | Prints **once**. A second call is **409** `"Struk <no> sudah dicetak · tidak bisa cetak ulang"`. `copy: true` is always **409** `"Struk <no> tidak bisa cetak ulang"`. When the printer refuses the connection, the print is given back and may be tried again. |
| `POST /api/v1/store/sales/{sale_id}/receipt/escpos` (USB bytes) | The bytes are handed out **once**. The same 409s apply. The till sends the bytes, so the node cannot know whether paper came out. A USB failure after this call still uses up the print. |
| `GET /api/v1/store/sales/{sale_id}/receipt` | Unchanged. It is read-only and the store app uses it. |

Prints are recorded in sqlite `receipt_print(receipt_no PK, printed_at, printed_by)`.

## 2. Receipt lookup — exact struk number only

### `GET /api/v1/store/receipts/{receipt_no}`

Permission: InventoryRead. The match is exact and whole, case-insensitive: the 7-letter till number (`SPAPODH`), a return's own number, or the derived `SITE-YYYYMMDD-XXXXXX` of an old sale. A partial number is **404** `"Struk <NO> tidak ada"`. An empty number is **400** `"ketik nomor struk"`.

200 `ReceiptLookup`:
```jsonc
{
  "kind": "SALE" | "RETURN",          // RETURN = a return's own receipt (never returnable)
  "sale_id": "uuid" | null,           // null for a return that rang no replacement
  "return_id": "uuid" | null,         // set when this is a return's receipt
  "status": "PAID" | "VOIDED" | "RETURNED" | "RETURN",   // RETURNED = anything came back against it ("Di-return")
  "receipt": ReceiptDocument,         // the paper (see below)
  "returnable": true,
  "refusal": null | "Struk return tidak bisa di-return · barang hasil tukar tidak bisa ditukar lagi"
                  | "Struk ini sudah dibatalkan" | "Semua barang struk ini sudah dikembalikan"
                  | "Barang di struk ini tidak bisa ditukar" | "Retur untuk struk ini sudah lewat batas <tanggal>.",
  "return_by": "2026-11-04" | null,   // last day written on the sale
  "returned_in": [ { "return_id": "uuid", "receipt_no": "SPAXXXX" | null, "occurred_at": "…" } ],
  "pieces": [                          // SALE only; empty on RETURN
    { "epc": "E280…" | null, "sku_code": "00000004103", "name": "…",
      "charged_minor": 150000, "returned": false, "exchangeable": true }
  ]
}
```

`ReceiptDocument` gains `exchange_until: string | null`: the sale's `return_by`, printed "Bisa ditukar s/d …", and null on a return's receipt. Each `ReceiptLine` gains `exchangeable: boolean`. These hold on every receipt route, including `GET /api/v1/store/sales/{id}/receipt`.

`ReceiptDocument` also has three new fields for returns. Each defaults when absent.
- `returned_from: string | null`: on a return's receipt, the original struk number, printed "Return dari".
- `returned_in: string[]`: on an original, the return receipt numbers ("Di-return di"). It is not printed.
- `forfeited_minor: number`: on a return's receipt, the value not paid out. It is printed "Selisih tidak diuangkan".

The stamp on a returned original is now `** DI-RETURN **` (it was `** RETUR **`).

How a return's receipt looks:
- The pieces that came back come first, as `quantity: -1` with a negative `line_total_minor`. The replacements follow.
- `subtotal_minor` is the sum of all line totals, so it can be negative.
- `discount_minor` is 0.
- `total_minor` is the difference paid, or 0 when nothing was paid.
- The internal credit tender (`OTHER`, whose reference is the original sale id) is left off `tenders`.
- `footer` is null: there is no return promise on a return.
- With no replacement, `sale_id` holds the return id, there are no tenders, and every total is 0.

### `POST /api/v1/store/receipts/{receipt_no}/escpos`
Body `{ paper?: "NARROW"|"WIDE", drawer?: "PRINTER_PULSE"|"MANUAL"|"NONE", copy?: false }`. It returns `{ sale_id, receipt_no, bytes, escpos_hex }` once, then 409 as in §1. This is how a return with no replacement prints, since it has no sale id.

### `POST /api/v1/store/receipts/{receipt_no}/print`
Body: same as `PrintReceiptRequest` (`printer_host`, `printer_port`, `paper`, `drawer`, `copy`), or empty to use the recorded printer. It returns `{ sale_id, receipt_no, printer, bytes }` once, then 409.

## 3. Return = its own receipt

### `POST /api/v1/store/returns` (and the same handler at `POST /api/v1/store/exchanges`)

The old money-refund body (`ReturnRequest` with `refund_method`) is **no longer routed**. Nothing is paid out at the till.

Request `ExchangeRequest`:
```jsonc
{
  "sale_id": "uuid",                 // from GET /receipts/{no}
  "returned_epcs": ["E280…"],        // tags read back (sold tag)
  "returned_skus": ["00000004103"],  // pieces sold without a tag, one entry per piece
  "replacement_epcs": [],            // OPTIONAL now; stock tags going out
  "tenders": [],                     // only for a dearer replacement: the difference, normal SaleTender list
  "reason": "…" | null,
  "supervisor": { "username": "bima", "authorization": "<finger grant>" },   // Kepala toko, still required
  "idempotency_key": "…"
}
```

Rules enforced:
- The original must be `COMPLETED`. Otherwise **409** `sale … is VOIDED and cannot be exchanged against`.
- A return's receipt can never be returned. This covers the replacement sale of a return, and of an exchange from before this change. **409** `"Struk return tidak bisa di-return · barang hasil tukar tidak bisa ditukar lagi"`.
- Each piece must have been sold on that struk and must not already be returned. **409** `EPC … has already been returned` or `SKU … di struk ini semua sudah dikembalikan`. A struk may be returned against more than once, for different pieces.
- Window: the sale's own `return_by` (policy days, placeholder 7). After it, **409** `"Retur untuk struk ini sudah lewat batas <tanggal>."`.
- Non-exchangeable goods: **409** `"<nama> tidak bisa ditukar."`. See §3b.
- No replacement plus any tenders: **400** `a return with no replacement takes no payment; send no tenders`.
- A replacement that costs the same or less plus tenders: **400** `the returned pieces already cover the replacement; send no tenders`.
- A dearer replacement with no tenders: **400** `… take the <owed> difference`. Tenders are ordinary tenders: several EDC lines, voucher, points voucher, benefit, cash.

Response 201 `ExchangeResult` (**shape changed**):
```jsonc
{
  "sale_id": "uuid" | null,          // replacement sale; null when nothing went out   (was string)
  "receipt_no": "SPAXXXX",           // the RETURN's receipt: the replacement sale's number, or its own
  "return_id": "uuid",
  "original_sale_id": "uuid",
  "original_receipt_no": "SPAPODH",  // NEW — "Return dari"
  "returned_minor": 300000,          // value of pieces back
  "replacement_minor": 0,
  "credit_minor": 0,                 // min(returned, replacement)
  "owed_minor": 0,                   // max(0, replacement − returned) = paid by tenders
  "unused_credit_minor": 300000,     // FORFEITED, not paid out (stored as return_receipt.forfeited_minor)
  "paid_minor": 0, "change_minor": 0,
  "approved_by": "bima", "occurred_at": "…",
  "sale": SaleResult | null,         // was always present
  "returned": ReturnResult
}
```
A return with no replacement takes the next 7-letter number at the seat of the cashier's drawer. It comes from the same run as that seat's sales, so the two never clash. Stored in sqlite `return_receipt` with `from_sale_id`, `replacement_sale_id`, `back_minor`, `replacement_minor`, `paid_minor` and `forfeited_minor`.

### 3b. Exchange window and non-exchangeable goods

`GET /api/v1/store/return-policy` returns `ReturnPolicySnapshot`:
```jsonc
{ "setting": { "max_days": 7, "require_hang_tag": true, "require_receipt": true,
               "same_item_exchange": true, "same_item_same_cost": true, "same_item_same_supplier": true },
  "rules": [ { "name": "Pakaian dalam", "scope_kind": "DIVISION"|"TAG"|"ARTICLE"|"GLOBAL",
               "targets": ["…"], "max_days": 7, "exchangeable": false } ] }
```

`GET /api/v1/store/exchange-policy` returns `{ "days": 7, "require_hang_tag": true, "require_receipt": true }`. It is the same promise, under the name the UI asked for.

The quote (`POST /api/v1/store/quote`) has `QuotedLine.exchangeable: boolean` on every line, for Bayar's "Tidak bisa ditukar: …".

Each catalogue row also says whether the piece may come back. `GET /api/v1/store/catalog` rows have a new `exchangeable: boolean`, which defaults to true. The page ETag is now `"<generation>-<policyVersion>"`, so a policy change is not hidden behind a 304.

The rule is not a column on the article. It is a return policy with `exchangeable: false`:
- An ARTICLE policy is the per-article flag.
- A DIVISION or TAG policy covers a category, such as underwear.
- The most specific match decides. Among equally specific matches, a single "no" wins.
- A non-exchangeable policy gives no window, and it does not shorten the date printed for the rest of the basket.

Head office sets it with cloud `POST/PUT` on the existing return-policy routes. The `SaveReturnPolicyRequest` body gains `exchangeable?: boolean` (default true), and `ReturnPolicyRow` gains `exchangeable`.

No underwear policy is seeded, because the division and tag codes are not known. Head office has to create one.

## 4. Payments

No new till routes. What exists and what changed:
- **Several EDC lines per sale**: this already worked. Send one `SaleTender` per slip: `{ method: "CARD"|"QRIS", acquirer: "BCA", card_kind: "DEBIT"|"CREDIT" (CARD only), amount_minor }`. The machine is the bank (`acquirer`). Non-cash tenders together may not exceed the total.
- **Paper voucher: one use, no change** (new, cloud):
  - `voucher.single_use` defaults to **true**.
  - When a hold is committed, or on a direct redeem, whatever the basket did not take is forfeited in the same transaction. This is a `FORFEIT` movement, and the voucher becomes `SPENT`.
  - The till's `POST /api/v1/store/vouchers/{code}/check` answer gains `single_use: boolean`, so the till can say "sisa hangus" first.
  - Cloud `IssueVoucherRequest` gains `single_use?: boolean`. Send false for a gift card that keeps its rest.
  - Vouchers made from points are issued `single_use = false`.
- **Points**: unchanged from e31930ea. Use `POST /api/v1/store/points/redeem-requests`, then `/{id}/progress` and `/{id}/cancel`. The shopper approves in the app or reads back the 6-digit WhatsApp code.
- **Employee benefit by finger**: unchanged. Use `POST /api/v1/auth/fingerprints/benefit`, then `POST /api/v1/store/benefit/lookup|spend` with `{finger}`.

## 5. Tutup kasir

`POST /api/v1/store/shifts/{id}/close` with `CloseShiftRequest` is still one submission:
```jsonc
{ "declared_cash_minor": 1517000,
  "counted": [ { "value_minor": 100000, "pieces": 10 }, … ],   // must add up to declared
  "edc_slips": [ { "machine_id": "BCA", "slips": 2 }, … ],
  "idempotency_key": "…" }
```
- **New:** when `edc_slips` is sent at all, every machine that `GET /shifts/{id}/edc-machines` names must be counted. Otherwise **400** `"Hitung struk EDC <Mandiri> dulu"`. A close with no slips still closes, as the store app's supervisor close does.
- `POST /api/v1/store/shifts/{id}/movements`:
  - **`PICKUP` (Tambah modal) needs no finger now.** A `supervisor` grant may still be sent; it is verified and named as the giver. Without one, the TM slip's `given_by_name` is `""`, left for a pen.
  - `FLOAT_RETURN` (Setor modal) still needs the Kepala toko's finger.
  - `DROP` (Setoran sementara) is unchanged. It needs the finger, and `counted` may carry denominations.

`ShiftReport` gains the fields the closing paper needs:
- `float_added_minor`: Tambah modal total.
- `drops_minor`: Setoran sementara total.
- `float_end_minor`: **Modal Akhir** = opening + Tambah − Setor modal.
- `movements[].slip_no`: `TM-0004`, `SM-0002` or `ST-0008`, printed beside each move.

These were already there:
- `opening_float_minor`: Modal awal / Saldo Awal.
- `float_returned_minor` and `float_returned_to`.
- `closed_at`: the Ditutup time.
- `counted`: the money by denomination.
- `edc_slips`: machine name and slips.

## Not done / open
- Points and member points are not taken back on a return, and an employee benefit is not given back on one. Neither was done before this change.
- Return money is not synced to head office as a fact of its own. Head office sees the replacement sale (with its `OTHER` credit tender) and the stock movement only. The forfeited value stays in the store's sqlite.
- "Harga akhir tidak bisa ditukar" (final-price goods) is not enforced. It is unclear whether this means markdown goods, and the 28 Oct owner rule in postgres 1005 says a markdown is not a reason to refuse.
- Card On us / Off us (Kartu bank sama / bank lain) has no tender field yet.
- The prototype refuses a second return on a struk already "Di-return". The server allows one for other pieces, per the task brief.
- `tests/testdata/routes.json` was edited by hand for the changed routes. It was already missing `/api/v1/store/exchanges` before this change.

## Reconciliation with `docs/pos-port-2026-10-29-ui-needs.md`

The UI needs list arrived just before this was finished. Row by row:

| # | UI asks | Backend now | Mismatch to fix in the UI |
|---|---|---|---|
| 1 | `GET /store/exchange-policy` → `{days}` | Added: `{days, require_hang_tag, require_receipt}` | none |
| 2 | `QuotedLine.exchangeable` | Added | none. Promo/final-price pieces are not marked, see "Not done". |
| 3 | receipt lines `exchangeable`; `exchange_until`; `return_of_receipt_no`; negative qty for pieces back | `ReceiptLine.exchangeable` ✓; `exchange_until` ✓; the "from" number is called **`returned_from`**; pieces back are `quantity: -1`, `line_total_minor` negative ✓ | Read `returned_from`, not `return_of_receipt_no`. |
| 4 | `GET /store/sales/search` with `kind` and `status` | **Removed.** Use `GET /store/receipts/{receipt_no}`. It answers `kind: SALE \| RETURN`, `status: PAID \| VOIDED \| RETURNED \| RETURN`, `returnable` and `refusal`. | Switch the Struk/Return lookup to `/receipts/{no}`. A partial number now gets 404. |
| 5 | `POST /store/returns` with the old `ReturnRequest` + `refund:false` | `/store/returns` takes the **`ExchangeRequest`** body (`sale_id`, `returned_epcs`, `returned_skus`, optional `replacement_epcs`, `tenders`, `supervisor`, `idempotency_key`). The old shape is refused as a bad body. The reply has `receipt_no`, `return_id`, `sale_id` (null with no replacement) and `original_receipt_no`. A return's receipt is refused with 409. | Send the ExchangeRequest body. Drop `refund`/`refund_method`. Print with `POST /store/receipts/{receipt_no}/escpos`, which works with no sale id. |
| 6 | credit capped at the replacement total; rest forfeited; one struk | ✓ (`unused_credit_minor` / receipt `forfeited_minor`) | none |
| 7 | voucher authorize with `single_use`, `face_minor` | Not taken from the till. Single use is the voucher's own flag at head office (default true). Authorize the amount as today, and commit forfeits the rest. `vouchers/{code}/check` says `single_use`. | Stop sending `single_use`/`face_minor` (ignored); read `single_use` from check. |
| 8 | points by WhatsApp code | unchanged ✓ | none |
| 9 | new ESC/POS paper layout; refuse `copy:true` | `copy:true` → 409 ✓, and each struk prints once ✓. **The paper layout was not changed.** It still uses the old 32/48-column layout, plus "Return dari" and "Selisih tidak diuangkan". | Layout is open backend work (`edge/escpos.rs::render`). |
| 10 | void unused | Route removed ✓ | none |
| 11 | PICKUP with no supervisor; slip in the reply | ✓ The slip comes back with `given_by_name: ""` when there is no finger. | none |
| 12 | `CashMovementView.slip_no` | ✓ | none |
| 13 | `shop_name`, `shop_line_1/2` on shift report and slips | **Not added.** Read them from the receipt document, or ask. | open |
| 14 | `edc_slips` on the close reply | ✓ Already there: `{machine_id, machine_name, slips, expected}`, with `expected` null for a cashier. | none |
| 15 | MODAL AWAL slip at opening | **Not added.** | open |
