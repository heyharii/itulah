# POS use cases — web till and store app (9 Oct 2026)

Run: `./remote.sh --config till.config.ts --output .e2e/out/till till` and `./remote.sh --config store.config.ts --output .e2e/out/store store`
(never locally). Map: `maps/pos.md`. Helpers: `support/pos.ts`. Tags: `pos` on all; `bug` on tests guarding a defect; `agent` on TILL-90; `smoke` on one per app.

Status: **pass** · **fail (bug)** = red on purpose, app is wrong · **skip (reason)**.
Actors: dian = cashier (seat Kasir 1), maya = store manager / supervisor, rina = head office.

## Rules this suite lives by
- **Stock is scarce** (store-01 floor ≈ 29 pieces, each SKU 1–3 units). Tests that sell pick units from the *end* of the EPC list and **always put them back** with a supervisor void (`pos.restoreSale`). Two exceptions burn pieces for good: TILL-63 (a DAMAGED return takes one shoe off the floor per run) and STORE-81 (one shoe goes back to the DC per run).
- STORE-70/71 spend DC pieces (`pos.sendDelivery`: allot → pick → pack → ship → depart, ~15 s). Per run: 2 + 2 pieces from the SKUs that still hold stock on `dc.warehouse` (≈23 at provisioning). After ~5 full runs the DC racks are empty and these two fail loudly ("the DC racks hold only N SKU(s)"). This is the documented "create more stock end to end" path; a full PO → DC would be needed to refill.
- The till keeps its token in `sessionStorage`, which e2e sessions do not carry: every till test signs in inside the test (`pos.openCounter` = counted drawers + `ensureShift` by API + the sign-in form). One seat (KASIR-1) on the rig, so the till config runs `workers: 1`.
- Side effects on the shared rig: TILL-73 switches the employee benefit on (`POST /benefit/settings`) and fills maya's balance; TILL-72 spends 10 points of a seeded member; TILL-36 issues a voucher; STORE-91 adds a Rp 300.000 float and a Rp 45.000 expense to petty cash.
- **Never complete a sale with a bag charge in routine runs** (see bug B1). TILL-45 therefore stops before payment; TILL-45b only runs with `RIG_POS_BAG_SALE=1` and the coordinator must be told to unblock the stream afterwards.

## Bugs found (tests stay red)
| ID | Test | Evidence |
|---|---|---|
| B1 | TILL-45b (skipped unless `RIG_POS_BAG_SALE=1`) | **FIXED 10 Oct** — edge sends `charge_total_minor`; cloud checks lines + charges = total (edge/sqlite.rs, cloud/domain/sync.rs). TILL-45b green with `RIG_POS_BAG_SALE=1`. A sale with a "Kantong plastik kecil" (Rp 500) charge is booked at the shop with total_minor 219500 but its lines add up to 219000 (the bag is a `charges[]` entry, not a sale line). `cloud.log` 15:10:27Z: `sync apply stream blocked origin_id=store-01 generation=1 seq=159 reason=sale lines add up to 219000 but the total says 219500`. The cloud refuses that `sales.completed` fact **and blocks every later fact of store-01** (no new sale, stock move or return reaches head office; `GET /api/v1/sales` stopped at 22 rows while the store kept selling). The coordinator patched seq 159 and 461 by hand to unblock. The receipt screen even warns "Selisih … (biaya seperti kantong tidak tercantum di struk)". |
| B2 | TILL-35 | **FIXED 10 Oct** — the till sends cash as handed over (`tenderedMinor`), the node computes change (till.tsx). TILL-35 green. The cash tender is sent as the amount applied (`Payment.complete` → `tenders[].amount_minor = amountMinor`), not the amount handed over. Cashier enters Rp 300.000 for Rp 219.000: the till shows "Kembalian Rp 81.000", but the node's receipt says `paid_minor` 219000, `change_minor` 0 (`GET /store/sales/{id}/receipt`). Through the API the same sale with a 230000 tender gives `change_minor` 11000. |
| B3 | TILL-41b | **Fixed 10 Oct (engine/edge/cloud/till), test data now wrong.** HEMAT50 is quota-limited (100 uses); the node refused it (`CouponNeedsOnlineAuthorization`) and the till had no authorize call. Fix: a capped book coupon becomes a SHARED coupon set at publish (or lazily on first authorize); the till asks the node relay `POST /api/v1/store/coupons/{code}/authorize` when the quote lists the code in `coupons_to_authorize`, re-quotes with the hold, sends it on the sale, and the cloud commits it when the sale fact lands (never blocks sync). Verified by API: 3 plain units (Rp 618.000) → Rp 568.000, cloud HEMAT50 redeemed_count 0→1, hold COMMITTED. TILL-41b still fails, but on its basket: two shoes also get *Diskon 15% Sandal & Sepatu* (Rp 83.700), which beats HEMAT50 (stacking ALONE) — the node returns "another offer gave a better price". The test also compares the till total to an API quote sent without the hold. It needs a plain Rp 300.000+ basket and its quote with `coupon_authorizations` (or no API-quote comparison). |
| B4 | TILL-73 | **FIXED 10 Oct** — a UUID reference passes the card-number screen (src/tender.rs); the cloud then also needed BENEFIT in `edge_sale_tender` (migration 0960). TILL-73 green. Saldo karyawan: the BENEFIT tender's reference is the `sale_ref` UUID (`till.tsx` `saleRef = randomUUID()`); the node refuses references with ≥ 12 digits (`invalid request: a payment reference must not look like a card number`), a UUID has ~20 → the sale is refused ("Tersimpan di terminal") after the balance was already spent at head office. (Also: a cashier cannot spend their own benefit — `forbidden: a cashier does not ring up their own benefit` — so the test uses maya's.) |
| B5 | TILL-61b | **FIXED 10 Oct** — receipt-number pattern allows the hyphenated shop code (screens/returns.tsx). TILL-61b green. The "Itu nomor struk, bukan ID penjualan" hint uses `/^[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]{1,8}$/`; real numbers are `STORE-01-20261009-D3581A` (site code contains a hyphen) so the hint never fires; the cashier only sees the node's `not found`. |
| note | STORE-112 | Observation, not red: with no registered asset and "No supplier on record for this shop", the GA repair sheet cannot be sent (the form stays open silently). |

## Till (`till/*.e2e.ts`)
| ID | Actor | Preconditions | Steps → expected | Test::title | Status |
|---|---|---|---|---|---|
| TILL-01 | dian | shift open | open `/`, "Masuk ke konter", fill Nama pengguna / Kata sandi, Masuk → counter "Siap untuk transaksi baru", badges Kasir 1 / Web | sign-in.e2e.ts::dian signs in on the till and lands on the counter | pass |
| TILL-02 | dian | – | wrong password → node's sentence `unauthorized: invalid username or password`, card stays, Masuk disabled again | sign-in::TILL-02 | pass |
| TILL-03 | – | – | Masuk disabled until both fields; no PIN tab / fingerprint / Gabungkan in web | sign-in::TILL-03 | pass |
| TILL-04 | – | – | Setelan: read-only node address, no devices/pairing; empty terminal number refused; save returns to the card showing the new id | sign-in::TILL-04 | pass |
| TILL-05 | dian | counter | "Keluar" → card, field empty; reload does not restore the counter | sign-in::TILL-05 | pass |
| TILL-10 | dian | shift closed, seat free | Pilih kasir → "Pakai Kasir 1" → float 500.000 → "Buka shift · Rp 500.000" → counter; node shows OPEN, float 500000 | shift.e2e.ts::TILL-10 | pass |
| TILL-11 | dian, maya | maya holds Kasir 1 | dian's open is refused: "Kasir 1 masih dibuka … Tutup kasir … dulu"; maya's shift stays open | shift::TILL-11 | new |
| TILL-14 | dian | shift open | Shift & kas: "Isi nominalnya.", "Alasan wajib diisi."; Setor 20.000 and Tambah 5.000 listed; node report has −20000 / +5000 | shift::TILL-14 | pass |
| TILL-15 | dian | shift open | Tutup shift: count 4×100.000 + 1×50.000 → Lanjut → Periksa hitungan (Rp 450.000) → Hitung ulang → Lanjut → catatan → "Kunci hitungan & tutup shift" → "Shift ditutup"; node declared 450000 | shift::TILL-15 | pass |
| TILL-20 | dian | shift open | cash sale with change: Bayar total == quote, "Lunas", change shown, card, sale in node window + receipt, unit off floor; void puts it back | sale-cash::TILL-20 | pass |
| TILL-30 | dian | – | Debit → BCA → Kode approval EDC → button "… · Debit BCA" → Lunas / Tanpa kembalian → node CARD tender, ref contains BCA + code | sale-payments::TILL-30 | pass |
| TILL-31 | dian | – | card refusals: no bank, code < 4, card-number-like, more than owed (cash only may exceed) | sale-payments::TILL-31 | pass |
| TILL-32 | dian | – | QRIS + BNI + "Nomor referensi QRIS" → node QRIS tender | sale-payments::TILL-32 | pass |
| TILL-33 | dian | – | Kredit + BRI → CARD tender with BRI | sale-payments::TILL-33 | pass |
| TILL-34 | dian | – | part cash 50.000 ("Bayar sebagian"), "Diterima"/"Sisa", rest on debit → node has CASH 50000 + CARD rest | sale-payments::TILL-34 | pass |
| TILL-35 | dian | – | cash presets + change breakdown "Kembalikan"; receipt must carry the change | sale-payments::TILL-35 | pass (B2 fixed) |
| TILL-36 | dian, rina | voucher issued on cloud | Voucher tile, code, part 50.000 held at head office, cash for the rest; node VOUCHER tender; cloud redeems the voucher after sync | sale-payments::TILL-36 | pass |
| TILL-37 | dian | – | unknown voucher code → node's `not found`, nothing taken | sale-payments::TILL-37 | pass |
| TILL-38 | dian | – | Saldo karyawan: code of 2 digits → "Kode saldo karyawan terdiri dari 6 angka." | sale-payments::TILL-38 | pass |
| TILL-40 | dian | member Sari | shoe + member: promotion row, "Perkiraan poin +N", total == quote; sale syncs to head office | basket::TILL-40 | pass |
| TILL-41 | dian | – | HEMAT50 on a small basket: chip kept, "HEMAT50 belum memberi potongan." | basket::TILL-41 | pass |
| TILL-41b | dian | Rp 300.000+ basket | HEMAT50 should take Rp 50.000 off | basket::TILL-41b | **fail (bug B3)** |
| TILL-42 | dian | – | coupon chip "Lepas kupon HEMAT50" lifts it | basket::TILL-42 | pass |
| TILL-43 | dian | – | Koleksi Wanita 10% row + total == quote, sale completes | basket::TILL-43 | pass |
| TILL-44 | dian | a marked-down unit on the floor | markdown price, no promotion | basket::TILL-44 | skip (stock: both Sandal Slide Karet units were used up by earlier DAMAGED returns on this rig; passes when one is on the floor) |
| TILL-45 | dian | – | Kantong sheet (Gratis / Rp 500 / Rp 1.000), charge line, total == quote with charges, "lepas"; not paid | basket::TILL-45 | pass |
| TILL-45b | dian | fresh rig, `RIG_POS_BAG_SALE=1` | sale with a bag reaches head office and does not block sync | basket::TILL-45b | pass with RIG_POS_BAG_SALE=1 (B1 fixed) |
| TILL-46 | dian | – | duplicate tag, price check "Cek harga", no match, "M1:" member card, unknown tag → "TANPA HARGA" | basket::TILL-46 | pass |
| TILL-47 | dian, maya | – | Tahan → Ditahan → Lanjutkan; Buang → "Ya, buang" → supervisor approval | basket::TILL-47 | pass |
| TILL-48 | dian, maya | – | Batal → reason → wrong supervisor password (kept) → right password → note "Transaksi dibatalkan — … · disetujui maya" | basket::TILL-48 | pass |
| TILL-49 | dian, maya | – | "Lepas <item>" needs the supervisor | basket::TILL-49 | pass |
| TILL-50 | dian | basket | Kunci: wrong password refused, right one opens, basket intact | basket::TILL-50 | pass |
| TILL-51 | dian | – | Dari handheld sheet lists sessions or "Belum ada sesi pindai" | basket::TILL-51 | pass |
| TILL-52 | dian | – | F4 bags, F10 pay, Esc back with basket, F3 Retur | basket::TILL-52 | pass |
| TILL-53 | – | – | `/?display` greets "Selamat datang" without a session | basket::TILL-53 | pass |
| TILL-60 | dian, maya | a sale | Void: find by id, reason, supervisor password → "Penjualan dibatalkan"; unit back on floor; receipt stamped `** BATAL **` | void-return::TILL-60 | pass |
| TILL-61 | dian, maya | a sale | Void refusals: unknown id, no authorisation, wrong password, a cashier as supervisor; nothing voided | void-return::TILL-61 | pass |
| TILL-61b | dian | a sale | receipt number typed as id → "Itu nomor struk…" | void-return::TILL-61b | pass (B5 fixed) |
| TILL-62 | dian, maya | 2-unit sale | Retur: 1 unit, Layak jual, cash → "Retur tercatat", "Masih di tangan … 1 unit", unit on floor, other still sold | void-return::TILL-62 | pass |
| TILL-63 | dian, maya | a sale | Retur "Rusak" + QRIS refund reference → unit not on floor (burns a shoe) | void-return::TILL-63 | pass |
| TILL-64 | dian, maya | a sale | Retur guards: duplicate, product code, garbage, tag not on receipt, over-scan, card-like reference, wrong password | void-return::TILL-64 | pass |
| TILL-70 | dian | – | node unreachable (route abort) → "Tersimpan di terminal", badge "1 belum terkirim", shift cannot close; line back → "Semua penjualan terkirim", sale at node | outbox-redeem::TILL-70 | pass |
| TILL-71 | dian | – | unit sold elsewhere → refused: banner "1 penjualan ditolak node…", "Buang" (confirm) clears | outbox-redeem::TILL-71 | pass |
| TILL-72 | dian | member app request | Tukar poin: validation, wrong code, real 6-digit code → "Poin ditukar" | outbox-redeem::TILL-72 | pass (skips when both seeded members still have a waiting request, ≤ 10 min) |
| TILL-73 | dian, maya, rina | benefit on, maya funded | Saldo karyawan spend of 30.000 + cash rest | outbox-redeem::TILL-73 | pass (B4 fixed) |
| TILL-90 | dian | agent (Haiku) | agent opens payment, pays cash, finishes; exact checks after | agent::TILL-90 | pass (Haiku sufficient, ~50k tokens) |

Not covered (no engine / out of scope): Tauri desktop shell (fingerprint & PIN sign-in and supervisor approval, Chainway R3 button, USB printer / receipt printing and drawer, customer-display window, peripherals, device joining / pairing, "Kasir menunggu"), Android tablet till, the 10-minute idle lock countdown ("Layar terkunci dalam N detik" / "Saya di sini"), E-Wallet tile (not in the fallback list, payment-methods master empty), unseen: Gratis lines (buy-X-get-Y promotions), receipt preview sheet (code path never opened from the UI).

## Store app (`store/*.e2e.ts`)
| ID | Actor | Steps → expected | Test | Status |
|---|---|---|---|---|
| STORE-01 | maya | sign-in form → lands on /catalogue | sign-in::STORE-01 | pass |
| STORE-02 | maya | wrong password refused | sign-in::STORE-02 | pass |
| STORE-03 | – | deep link without session shows the door | sign-in::STORE-03 | pass |
| STORE-10…46 | maya | each of the 37 routes (catalogue, promotions ×4, stock ×5, money ×5, reports, news, node ×3, HR ×12, GA ×6) opens and shows its own word | nav::STORE-10 … STORE-46 | pass |
| STORE-47 | maya | unknown address falls back to a screen | nav::STORE-47 | pass |
| STORE-60 | maya | Stock pools (Stockroom / Shop floor / Return stock), Missing filter ("Nothing missing."), pool sheet with Last movements | stock::STORE-60 | pass |
| STORE-61 | maya | Move stock floor → stockroom → floor via the sheet; ledger agrees (undone) | stock::STORE-61 | pass |
| STORE-62 | maya | move guards: barcode, garbage, same place, Drop it | stock::STORE-62 | pass |
| STORE-63 | dian | cashier's move refused by the node, nothing moves | stock::STORE-63 | pass |
| STORE-64 | maya | Stock ledger: a sale is a movement out; In/Out filters; search; "No match for …" / "Show the last 500" | stock::STORE-64 | pass |
| STORE-70 | maya | delivery in transit counted blind, matches → "Complete", Received, node result 2/0 missing | receive::STORE-70 | pass |
| STORE-71 | maya | count guards (edit, remove), an extra and a missing piece → "1 missing", "Tags missing", Received tab | receive::STORE-71 | pass |
| STORE-80 | maya | HO-opened count: listed under To count, empty until the handheld sweeps, Submit asks first, moves to Done | count-return::STORE-80 | pass |
| STORE-81 | maya | HO return request: listed, Pack and send (confirm) → banner "… pcs on the way to HO", a piece left the floor | count-return::STORE-81 | pass |
| STORE-82 | dian | empty states of Return to HO and Count | count-return::STORE-82 | pass |
| STORE-90 | maya | Sales (Today): totals and receipt count equal the node's window; Cashiers / Payment / 30 days views | money::STORE-90 | pass |
| STORE-91 | maya, rina | New float counted with a second supervisor (maya as her own counter refused; rina accepted), then New expense; petty-cash figures match the node | money::STORE-91 | pass |
| STORE-92 | maya | expense over the tin refused client-side; over Rp 500.000 asks Finance's approval code | money::STORE-92 | pass |
| STORE-93 | maya | Reports: takings, "In the drawer" = node's cash_expected, "How it was paid" | money::STORE-93 | pass |
| STORE-94 | maya | Cash count screen: boxes and Past counts; Count opens a sheet (the count itself is not submitted) | money::STORE-94 | pass |
| STORE-100 | maya | Catalogue by article: count, search, product sheet with price | catalogue-node::STORE-100 | pass |
| STORE-101 | maya | by SKU: row, Price source, Barcode | catalogue-node::STORE-101 | pass |
| STORE-102 | maya | promotions running == node offers; campaigns / price changes / vouchers lists | catalogue-node::STORE-102 | pass |
| STORE-103 | maya | Sync figures from the node, Send now | catalogue-node::STORE-103 | pass |
| STORE-105 | maya | Change password guards (mismatch, wrong current); password is never changed | catalogue-node::STORE-105 | pass |
| STORE-106 | dian | Sign out → door (own login, so the shared session stays valid) | catalogue-node::STORE-106 | pass |
| STORE-110 | maya | Discuss: message in "Store 01" reaches head office | office::STORE-110 | pass |
| STORE-111 | maya | GA supply request created and listed | office::STORE-111 | pass |
| STORE-112 | maya | GA repair with no supplier/asset cannot be sent | office::STORE-112 | pass (documents behaviour, see note) |

Not exercised in the store app: HR/GA flows beyond the smoke opens and the GA/chat round trips above (they belong to the HR / GA suites), Cash count *submission* (needs the cloud store-cash box setup), Promotions/Price-changes/Vouchers *creation* (read-only here), Till approvals approve/reject (needs a joining desktop till), real password change.

## Shared-file notes
No edits to shared files were needed. `workers: 1` on the till config is deliberate (one seat). Agent model: Haiku was enough for TILL-90; nothing here needs Sonnet.
