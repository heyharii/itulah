# Rust review — handheld-rfid uncommitted backend (2026-10-26)

Skill: BeautifulRust `rust-review` (installed in `.claude/skills/`). Read-only review of ~4.9k changed lines in 45 files plus 9 new files. No clippy, test or build was run (8 GB rule). `cargo fmt --check` fails on 13 of the changed files. Each finding comes from one reviewer and has not been checked a second time.

## Status (same day)

M1–M7 are fixed. Two reviewers then ran `rust-review` over the fixes and found nothing that won't compile on reading. Their follow-ups are fixed too:
- **Dossier and hire:** papers on an answered proposal can't be removed; the filer path needs `PROFILE_PROPOSE` and reach; adopt claims the dossier first.
- **Gudang rule:** a stored role that doesn't parse is now an error.
- **Return to HO:** unpick keeps a plan, and the pick key includes the destination.
- **warehouse_send:** keeps a send plan, a retry skips the approval when the goods already left, and the surat jalan comes from the shipment that carries the allotment.

None of this has been compiled.

Still open:
- `dispatch_trip` refuses its own half-finished trip (`sqlite.rs` ~6335). This existed before; a retry of a trip that died midway is still stuck.
- Approving a data update builds the profile from a read outside the transaction, so a direct HO edit in between can be overwritten. The fix is `FOR UPDATE` and compare.
- `remove_document` checks the proposal state and deletes in separate statements, so a small race remains.
- The return board counts To pick twice when one SKU sits in two pools.
- Sub-requests serialise `actor_id`, so a retry by another person gets a Conflict.

## Must fix

| # | Where | Problem | Smallest fix |
|---|---|---|---|
| M1 | `cloud/postgres/sync.rs:1440` | `refuse_second_gudang_writer` checks the request's `inventory_enabled`, but the upsert keeps the stored value through `COALESCE`. A re-register that sends `None` gets past the check, so a second Gudang writer is possible. | Select the stored `inventory_enabled` and role under the existing `FOR UPDATE`, then check the effective values. |
| M2 | `cloud/http/dossier.rs:591-615` | Approving a data update reads PENDING, applies in separate transactions, and claims the row last. Two approvers both apply, and a failed close leaves the change applied but still PENDING. | Claim the row with `UPDATE … WHERE state='PENDING' RETURNING` first, then apply in the same transaction. |
| M3 | `cloud/http/dossier.rs:866-872` | `remove_document` by a non-filer checks only `PROFILE_CHANGE`, with no reach check. HO can delete any pending scan. | Add `reached` / `reachable_proposal` like the other dossier routes. |
| M4 | `cloud/http/hire.rs:642` | The rejection commits before `erase_hire_dossier`. If the erase fails, the KTP/KK/NIK stay for good, because a retry is refused as already decided. | Erase in the same transaction, or log the error and add a sweep for REJECTED proposals that still have a dossier. |
| M5 | `cloud/http/hire.rs:752-786` | `upsert_profile` commits before `adopt_hire_dossier`, so a failure leaves half the state. `PROFILE_CHANGE` is never `require`d. | Add `require(PROFILE_CHANGE)` and move the upsert into the adopt transaction. |
| M6 | `edge/http.rs:2946-2980` | `warehouse_send` writes the send down after it goes out. If `record_send` fails, every retry fails with "Tidak ada lagi yang dikirim", because the ask is gone. The goods leave but the move stays unsent. | Don't fail when the ask is missing; replay the send's idempotent answer. |
| M7 | `edge/store_returns.rs:407-586` | Pick, pack and unpack rebuild their sub-requests from the current board. A retry after success gets a Conflict, and a retry after a partial run gets an idempotency payload mismatch. | Save the plan under `{key}:plan` on the first press and replay it. |

## Should fix

- `edge/http.rs:3086-3101`: printing a surat jalan needs only `InventoryRead`, so a read-only session can make the node write to any host:port. Require `InventoryMove`.
- `edge/http.rs:6687-6706`: a stopped warehouse PC can still POST `/store/movements` and the inbound receipt, and can skip the stop check by leaving out `X-Terminal-Id`.
- `edge/pos_stop.rs:305`: `warehouse_stop` does `.ok().flatten()`, so a DB error counts as "not stopped". Fail closed.
- `edge/warehouse.rs:712, 791`: the `record_receipt` / `record_send` digests are computed but never compared, so the same key with a different body returns the old move.
- `edge/fingerprint.rs:1311-1370`: three writes with no transaction can leave a PENDING submission with no fingerprint.
- `edge/till.rs:163`: `ShiftEdcSlip.expected` is `i64`, but blinding sends `null`. Make it `Option<i64>`.
- `edge/till.rs:1078`: receipt search scans the whole sales history on the writer lock. Use a `hit` CTE and the read handle.
- `edge/store_returns.rs:324`: the board loads every trip, then truncates to 100. Add `ORDER BY … LIMIT 100` in SQL.
- `edge/store_returns.rs:536`: pack with empty `pick_session_ids` may sweep up other picks to the same destination.
- `edge/escpos.rs:151`: `acquirer` goes to the printer without control bytes stripped (`ESC p` kicks the drawer).
- `edge/dc_allotment.rs:2110, 2139`: `unwrap_or_default` on cancel JSON and UUID gives empty lines or a nil UUID, which acks the wrong id.
- `edge/dc_outbound.rs:940`: `upper(epc) = ?` does a full scan per tag inside IMMEDIATE, and request vectors have no size cap.
- `edge/warehouse.rs:368, 527`, `dc_receiving.rs:439`: unchecked `i64` sums on client quantities. Use `checked_add` and a per-line cap.
- `edge/http.rs:2790`: a missing `id` from HO is ignored, so the request returns 201 with no allotment.
- `edge/http.rs:2974`: a missing `shipment_number` is stored as `""`.
- `edge/http.rs:2636`: the receipt and its move are written in two steps (a same-key retry repairs it).
- `cloud/http/mod.rs:5700, 5739`: the PO `version + 1` runs after commit, so a revise opened earlier still matches `If-Match`. Move the bump into the transaction.
- `cloud/dc/rfid_verify.rs:285`: a GET runs a DELETE, outside any transaction.
- `cloud/postgres/sync.rs:2579` + `sync/workflow.rs:1270`: one invalid amend or create fact blocks the Gudang stream, and no test checks that the edge payload passes `validate()`.
- `cloud/postgres/auth_policy.rs:1293`: "not CASHIER" gets a 7-day finger lease. Match on the `Role` enum.
- `cloud/http/dossier.rs:410, 796, 256`: filing writes the record and then each paper in its own transaction.
- `cloud/postgres/allotment_node.rs`: `Row::get` panics on the sync apply path. Use `try_get`.
- `cloud/http/dossier.rs:457`: the HO change queue is unbounded and runs one query per row.
- `edge/sqlite.rs:14944`: bad `note_line_notes` JSON is dropped silently.

## Consider

- `edge/at_head_office.rs:84`: a missing fact row answers `at_head_office`, which risks dropping a sale.
- `edge/dc_allotment.rs:1295`: `ALT-G{seq}` can collide on Central after a node restore or with a second DC.
- `edge/dc_allotment.rs:1024`: `forwarded_input` validates less than `lan_input`.
- `finger_valid_until` is outside the content hash (both reviewers flagged it).
- 403/422 is chosen by matching message text (`http.rs:4887`), `raise_pocket` runs twice, there is an `allow(type_complexity)` with no reason, there are `as i32` casts, `reading()` is quadratic, `percent` loses the sign of a negative value, and `parse_time` falls back to `now()`.
