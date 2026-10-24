# POS client feedback — contract (23 Oct 2026)

Spec: `pos-classic-prototype.html` (version D, pay look D) and memory note
`project_pos_client_feedback_2026_10_23`. Owner ruled "ikut client".

## Selling
- A typed SKU sells, with a quantity (`3*SKU` / `SKU*3`), also when the store holds
  none (stock goes minus). Wire: `untagged: [{ sku_code }]` one entry per piece (as now).
- A tag recorded at another store / unknown EPC, and an item with no SKU, do NOT sell:
  the node refuses (409) with `"{name or code} tidak ada di toko ini · minta barcode baru"`
  — for the quote too, so the till can show it before Bayar. `UNKNOWN` lines and
  `/store/unmatched/approve` are no longer used by the till.
- Quote `untagged[].kind`: `NO_TAG` (store holds it) or `NOT_IN_STOCK` (goes minus).
  The till shows "★ Stok minus" in Keterangan for NOT_IN_STOCK lines.

## Transaction number (7 letters)
- `receipt_no` = store 2 letters + till letter (A = first till of the store, B…) +
  the till's own running number scrambled into 4 letters:
  `x = (n mod 26^4) * 214013 + 97151 mod 26^4`, written base-26 with A=0.
- Store letters: the site's `receipt_prefix` if set, else the first two letters of the
  site name, uppercase. Unique index on (site, receipt_no); on clash take the next n.
- Sale and quote replies carry `receipt_no`; the cloud keeps it.

## Held sales (Tunda)
- Kept on the store node, not the till: `GET /api/v1/store/held` (today's, any cashier),
  `POST /api/v1/store/held` { basket json, total_minor, pcs } → { id, held_by_name, held_at },
  `POST /api/v1/store/held/{id}/resume` (removes it, returns the basket),
  `DELETE /api/v1/store/held/{id}` with `{ supervisor }` (Kepala toko finger/password).
- Held sales expire at the end of the business day. Closing a shift is refused while
  that till has held sales: "Masih ada n transaksi tunda".

## Shift
- After a cashier closes their shift, the node refuses that user's sign-in on that till
  for the rest of the business day: "{name} sudah tutup kasir hari ini".
- Modal only grows: PICKUP ("Tambah modal kasir") needs `supervisor` (giver); DROP
  ("Setoran sementara") needs `supervisor` (receiver). Both return a slip
  `{ slip_no: "TM-0001" | "ST-0001", amount_minor?, given_by_name, received_by_name, at }`.
  The till stops offering CORRECTION ("Ubah modal kasir").

## Return
- Returned pieces must be tags of the original sale, read by RFID; no manual quantity.
  A return can't be held; cancelling is allowed.

## Member registration
- Required: phone, name, gender (L/P), birth place, birth date; optional address, email.
  Cloud member create accepts these (add columns if missing).
