# The Gudang server — HO's warehouse keeps working when the internet does not

Written 25 Oct 2026. Owner (Hari): at the Gudang people work against a server
in the building and need no internet; outside they work online against
Central; the data stays in sync and nothing conflicts. "Gudang" here is HO's
warehouse site (CONTEXT.md), not a shop's back room — the "Central Gudang" PC
edition in `pos-desktop` (sqlite 0094) is a store device and a different thing.

Read with: [STORE-SERVER-PLAN.md](STORE-SERVER-PLAN.md) (the node runtime this
reuses), [DC-CLOUD-PLAN.md](DC-CLOUD-PLAN.md) and
[DC-CLOUD-NATIVE.md](DC-CLOUD-NATIVE.md) (how the Gudang moved into Central on
4 Oct), [docs/inventory-fleet.md](docs/inventory-fleet.md) (one writer per
site).

---

## 0. Rulings

| Question | Ruling |
|---|---|
| Who owns the data? | **Central** owns the system and holds the master copy of everything: it lets each server in, says what it may write, keeps every fact, backs it up, and serves every report. |
| Who writes the Gudang's stock? | **The Gudang server holds the pen** for the Gudang's stock and for allotments (allotment is reserving Gudang stock for stores). Central lent it the pen so the Gudang works without the internet. One pen per book, never two. |
| What stays written at Central? | Decisions that cross sites or involve an outside party: prices, POs and suppliers, finance, HR, members. |
| Two roads | **At HO/Gudang (LAN):** PC, C5, printers → Gudang server, no internet needed. **Outside:** hub → Central, which forwards a command to the Gudang server and shows what the server reports back ("waiting for the Gudang" while it is offline). The app picks the road itself: the LAN when the server answers, Central otherwise. |
| Conflicts | Creating is free anywhere (ids are minted where the record is made). Changing goes through the pen holder, with a version. A physical fact wins over a decision that arrives late; the difference becomes a task (e.g. `blocked_picked_quantity`, `sync/workflow.rs:264`). No CRDT, no "last write wins". |
| Database | **SQLite** on the Gudang server — the same runtime as every store server. **PostgreSQL** at Central. |
| Moving the pen | Only on purpose, by the procedure in §3. Never automatic when the line drops: that is how two pens happen. |

---

## 1. Where we are (25 Oct 2026)

- **Live:** osretail.site answers `dc_hosting: cloud`. The Gudang's work is
  `backend/src/cloud/dc/*` (~13k lines) writing Central's own tables. With the
  internet down nothing at the Gudang works and nothing is queued.
- **The Gudang server exists but lags.** `bin/dc.rs` is the edge runtime with
  role DC and still builds. Only Central has: `purchase-counts/recall`,
  `short-picks/continue`, `move-backs`, owed and changes lists (the edge
  answers empty), per-variant counts, zero counts, `koli-rfid/requests*` and
  `koli/{id}/epcs`, `purchase-returns/note`, and allotment amend/cancel for
  node-owned allotments. Only the edge has: packing sessions and boxes with
  RFID capture (the C5 uses these), the RFID evidence ledger, local sign-in,
  daily backups, direct LAN printing.
- **The hub never reaches a Gudang server directly:** even in edge mode it goes
  through the cloud's `/edge` rewrite (`deploy/frontend/gen.mjs:24`).
- **Allotment is Central's** (`cloud/postgres/allotments.rs`,
  `allotment_store_review.rs`; hub `screens/allotment`, ~14k lines), validated
  against Gudang stock.
- **Devices:** C5 Verify talks to Central; label jobs wait 45 s in Central's
  memory for the print bridge (`cloud/dc/print_bridge.rs`).
- **Done today:**
  - several read handles on every node (`edge/sqlite.rs` `read_lock`,
    `INVENTORY_SQLITE_READERS`, default 4);
  - the one-writer guard: no install code and no registration for a
    write-enabled Gudang server while Central runs the Gudang
    (`cloud/postgres/sync.rs` `refuse_second_gudang_writer`, also called from
    `node_enrolment.rs`), and an error at boot if two writers already exist
    (`cloud/dc/common.rs` `warn_if_second_writer`).

---

## 2. Steps, in order

1. **One-writer guard.** Done 25 Oct.
2. **Read handles.** Done 25 Oct.
3. **One Gudang implementation.** Bring the edge DC up to everything listed in
   §1 that only Central has. `cloud/dc` is the newer behaviour, so it is the
   specification; the code is written for SQLite in the edge. Same
   `/api/v1/dc/*` paths and JSON (`edge::contracts`), so the hub's `dc` client
   works against either. While this runs, `cloud/dc` takes fixes only.
   *Written 25–26 Oct, not yet compiled:* `edge/dc_receiving.rs` (count
   recall, zero and per-variant counts, return note; sqlite 0098) and
   `edge/dc_outbound.rs` (short-pick Continue, move-back list, koli RFID
   verify and the C5's store requests, koli EPCs; sqlite 0097). Still open:
   short-pick FOUND/LOST/CLOSED and MD's accept-short, carton void/takeout
   states, checking a counted variant against the order (the order sends no
   variants), and Central appliers for the node's new facts
   (`dc.short_pick.continued`, `dc.koli_rfid.*`) — until those exist Central
   keeps them in the receipt log only. Short-pick reports and a return's PIC
   never leave the node.
4. **Allotment on the Gudang server.** Create, amend and cancel at the node;
   the node's facts give Central its read copy (hub lists, store
   announcements, reports). An edit made outside HO goes to Central, which
   forwards it as a command; the hub shows "waiting for the Gudang" until the
   node's answer arrives. Central pushes what the matrix needs — store stock,
   store sales, MD rules, articles — as snapshots stamped with their age, the
   way price books reach shops.
   *Written 26 Oct, not yet compiled:* `edge/dc_allotment.rs` (create,
   batch, amend, cancel, work, real owed/changes/acknowledge; sqlite 0099),
   `cloud/postgres/allotment_node.rs` + postgres 1003 (Central forwards an
   amend as `inventory.allotment.amend.v1` and answers 202 PENDING; applies
   the node's `amended.v1` / `created.v1`). Deploy Central before any node
   that sends these facts. Still open: Central's cancel of a node-held
   allotment still uses `cancel.v1` (picked pieces go on to the store);
   opening a carton does not tell Central its cancelled pieces; no guard
   stops a koli holding taken-out pieces from leaving; picked pieces MD gave
   up stop being reserved at once; node creates need `sku_code` until the
   snapshot push exists; Central's `/allotments/{id}/work` refuses
   node-held allotments; the hub does not show PENDING yet.
5. **Operations from the Gudang server.** Build the hub's Operations and
   allotment screens as a static app the node serves (as a store server
   serves `frontend-store-new`). The app tries the node on the LAN first and
   falls back to Central.
6. **Sign-in without Central.** Fingerprint and local password at the node,
   leased like a store's (today a Gudang grant is SSO-only, see
   `docs/cloud-dc-single-sign-on.md`).
7. **Devices on the LAN.** The C5 joins its server like a POS
   (`docs/research/2026-10-24-c5-joins-like-a-pos.md`); label printers are
   driven by the node (`edge/printing.rs`, `edge/zpl.rs`); fixed readers post
   to the node. The print bridge retires.
8. **Move the pen (§3).**
9. **Later, so nothing at the Gudang waits for the line:**
   - a PO made at HO while the line is down is created through the Gudang
     server (its own id) and can be received at once; Central gives the
     number when it arrives. Today a delivery can only be opened against a PO
     the Gudang already holds (`edge/sqlite.rs` ~13998,
     `cloud/dc/receiving.rs` ~434);
   - the surat jalan and koli label carry their contents as a QR, so a shop
     reads what is in a delivery without the internet.

---

## 3. Moving the pen (cut-over), and back

1. Finish the open work: every sealed koli dispatched or unpacked, every
   receipt closed, no pick session open.
2. Install the Gudang server (UPS, SSD) and give it an install code with role
   DC. Approval is refused until step 4 — that is the guard doing its job.
3. Load the Gudang's stock into the node from Central (a snapshot of the HO
   site's pools, by subject).
4. Switch `INVENTORY_DC_HOSTING` off on Central and restart it; approve the
   server. From here the node writes and Central reads.
5. Point devices at the node (C5, printers), check a receipt, a pick and a
   dispatch end to end, then open the doors.

Back to Central (a dead PC with no spare): drain what the node has not sent,
disconnect it, switch hosting on, load the Gudang's position into Central,
work in the cloud until a new server takes the pen the same way.

---

## 4. What still needs the internet afterwards

- Seeing what happened elsewhere during the outage: other stores' latest sales
  and stock, Central's reports. The work itself is not held up; the numbers
  catch up.
- People outside HO changing Gudang things while the Gudang is cut off: their
  change waits for the Gudang.
- Central-only decisions (prices, PO numbers, finance, HR): these need a line to
  Central, which is why HO and the Gudang have fiber + 4G with automatic
  failover and a UPS.

## 5. Risks

| Risk | Answer |
|---|---|
| Two Gudang codebases drift during step 3 | `cloud/dc` frozen to fixes; port area by area against its behaviour; the hub's paths and JSON do not change. |
| Two writers | The guard at both doors (§1), the boot error, and the move only by §3. |
| Gudang server PC dies | Central has every fact the node sent; a cold spare is enrolled as the next generation and refilled from Central (STORE-SERVER-PLAN §5b). Daily local backups cover what was unsent. |
| Matrix too heavy for the node | Read handles (§2.2); Central keeps the heavy reports. |
| Steps 3–7 cannot be tried end to end on the live Central | The guard refuses a writing Gudang server while Central hosts the Gudang, so the node is tested on the demo replica (itulah-demo2) with hosting off, never on osretail.site. |
| "The app tries the LAN first" from a page Central served | An https page cannot call `http://` on the LAN (mixed content, private-network rules). The LAN road is the app the node serves itself, under its own name with a real certificate (e.g. `gudang.<domain>` resolving to the LAN address inside HO, certificate by DNS challenge); Central's hub stays the outside road. |
| The Gudang server is one PC for thirteen stores' supply | A cold spare loses what was unsent and takes 10–15 min; the Gudang gets a **warm standby** (STORE-SERVER-PLAN §5b), promoted by a person, plus its daily backup copied off the box to Central. |
| A dead PC cannot be "drained" for the move back | When the node's disk is lost, Central's position is what the node last sent; the Gudang counts before working in the cloud again. |
