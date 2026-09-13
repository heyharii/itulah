# Commercial V1 — Data, State, dan Command Contract

Baseline: **1.0 — 12 September 2026**  
Status: kontrak logis turunan [acuan utama](commercial-v1.md) dan [D01–D14 / K01–K06 / INV-01–16](commercial-v1-decisions-and-invariants.md). Bukan migration SQL, API transport final, atau bukti schema saat ini sudah sesuai.

## 1. Prinsip penyimpanan

```text
Configuration -> immutable published versions
Execution     -> immutable completed calculation facts
Value         -> append-only ledger + rebuildable projections
Return        -> original-value reversals + refund obligations
Operations    -> mutable current status + append-only history/attempts
```

Nama entity di bawah adalah logical contract. Implementasi boleh memakai nama/table layout berbeda bila mapping terdokumentasi dan invariants tetap ditegakkan. Denormalization untuk performa tidak boleh membuat authority kedua. Completed facts tidak dihapus atau ditimpa oleh retry, correction, campaign edit, atau repricing.

Semua records mempunyai tenant scope, stable identity, source references, created time, dan audit identity sesuai jenisnya. Currency wajib pada money; IDR disimpan integer rupiah. Waktu UTC dan store timezone snapshot dipisahkan. Tenant/store access divalidasi pada setiap command dan query.

## 2. Configuration entities

| Entity | Minimum fields / hubungan | Aturan |
|---|---|---|
| Price list / version | Identity, currency, published version, scope assignments, validity, hash | Tepat satu resolved list pada konteks; published content immutable |
| Price entry | Version, SKU atau Article target, amount, validity | SKU di atas Article fallback; ambiguity ditolak |
| Markdown / version / item | Identity/version, target, replacement amount, store/time scope | Maksimal satu aktif; tidak melebihi regular |
| Promotion | Stable identity, display metadata, lifecycle, current version reference | Identity tidak berganti saat rule diedit |
| Promotion version | Version number, canonical definition, schedule/store scope, hash, authorization requirements | Definition lengkap; online requirement diturunkan dari constraints, bukan editable bypass |
| Coupon set | Stable promotion ID, mode, expiry/limits, versioned configuration reference | Bukan child dari satu promotion version |
| Coupon code | Set ID, protected canonical code lookup, operational status | Collision canonical ditolak dalam tenant; raw secret tidak masuk traces |
| Campaign / version | Objective, metric, target model/value/unit, period, budget, scope/cohort, guardrails | Measurement scope dan links dipin per activation version |
| Campaign activity | Campaign version, activity type, stable promotion ID dan applicable execution/version mapping | V1 hanya Promotion; historical attribution tidak memakai current joins |
| Loyalty scheme version | Earn rate, eligibility, redemption options, issuance policy, validity/hash | Loyalty authority; engine menerima versioned input |
| Publication / store artifact | Release/version/hash, target store, dependency versions, validity, signature, generation | Complete, verified, atomic activation; tidak membawa private cost/customer secrets |

Promotion executable definition memuat scope, qualification, benefit, compatibility, limits, stores, dan schedule. Compiled product selector harus jelas atas catalog generation tertentu. Campaign metadata tidak diam-diam mengubah executable child rule.

## 3. Checkout dan sale execution

| Entity | Minimum fields / hubungan |
|---|---|
| Checkout | Tenant/store/register, customer, currency, cart revision, state, command identity |
| Quote | ID/revision/hash, expiry, cart snapshot, engine/rule/catalog/tax/loyalty versions, evaluation time, totals, points estimate |
| Authorization | Type, resource ID, checkout/quote revision, generation/fencing token, amount/usage, state, expiry |
| Payment intent | Logical operation, checkout/quote, tender plan, payload fingerprint, durable provider idempotency key/reference, current state |
| Payment attempt / evidence | Intent/tender reference, attempt ID, request time, observed response/event, provider operation reference, result certainty |
| Sale | Original checkout/quote, store/register/customer/currency, completion time, original net merchandise, merchandise tax, charges gross, Amount Due, sync state |
| Sale line | Sale ID, SKU/Article, quantity, aggregated original amounts |
| Sale unit | Stable unit ID, line/unit ordinal, optional EPC/inventory unit, regular/markdown sources, final net/tax/gross, charge allocations, points components |
| Evaluation trace | Input/version hashes, rule eligibility/rejection reasons, candidate outcome/winner evidence, allocation basis and rounding |
| Promotion application | Sale/rule version, benefit kind/stage, applied amounts or points, coupon authorization/redemption references |
| Discount allocation | Application + beneficiary unit, gross discount, ex-tax delta, tax delta, stage, bundle participation/source |
| Points allocation | Sale unit, scheme/rule sources, base/multiplier/fixed components, total awarded |
| Sale tender | Sale/intent reference, CASH/CARD/VOUCHER, confirmed applied amount, provider/auth reference, current outcome evidence |
| Coupon redemption / usage | Stable promotion/set/code, execution version, sale/customer, reservation/consumption references |
| Durable dispatch | Source logical event, version, payload reference, recipients/delivery status; deduplication identity |

Sale original amounts tetap original walaupun ada return. Retained sales adalah derived view dari original + reversals. Sale line qty 3 harus mempunyai tiga identifiable value allocations atau quantity slices ekuivalen yang dapat diretur satu per satu.

Rejected/evaluated offers boleh berada dalam trace terpisah dari applied-only facts. Jika satu storage memuat keduanya, reporting wajib memfilter applied positive benefit; keberadaan row bukan bukti offer digunakan.

Sale tender amount adalah applied amount. Cash handed/change disimpan terpisah. Provider fees/settlement bukan customer tender discount. Sale monetary snapshot tidak membaca saldo voucher saat ini untuk merekonstruksi pembayaran asal.

## 4. Ledger dan scarce resources

| Entity | Data / invariant |
|---|---|
| Voucher | Owner/claim, currency, original value, expiry, ACTIVE/EXPIRED/CANCELLED, balance projection |
| Voucher ledger | Signed amount, ISSUE/REDEEM/RESTORE/authorized adjustment, voucher, logical source, sale/refund/redemption link, actor/reason |
| Voucher authorization | Resource/quote/generation, reserved amount, state, expiry; active holds mengurangi availability |
| Points account | Customer, committed balance projection; pending earning ditampilkan terpisah |
| Points ledger | Signed points, OPENING/EARN/RETURN_REVERSAL/REDEEM_TO_VOUCHER/ADJUSTMENT, immutable source links |
| Loyalty redemption | Customer, scheme version, points amount, voucher value/currency, state, unique issued voucher + ledger references |
| Usage authorization / counter | Stable promotion/customer/code scope, reserved/consumed contribution, ownership, generation |

Ledger sum membuktikan accounting balance. Spendability juga memperhitungkan expiry/status/holds. Negative points dari return reversal adalah sah; jangan otomatis menganggapnya defect. Adjustment bukan cara menutupi selisih tanpa source dan authorization.

K02 menetapkan central voucher/points/coupon/redemption dalam satu transactional boundary Postgres. Resource checks dan mutation harus serializable secara bisnis dengan row locking/conditional mutations serta unique constraints yang tepat. Transaction wrapper saja tidak mencegah double spend. Provider calls tidak dijalankan sambil menahan database locks.

## 5. Return dan refund entities

| Entity | Minimum contract |
|---|---|
| Return request / acceptance | Original sale, requested/accepted time, actor/reason, decision status; tidak menyamakan acceptance dengan payout |
| Return unit claim | Original sale unit, accepted return ID, original gross/charge/tax/points reversal references; at most one accepted claim per unit |
| Refund obligation | Accepted return, original total entitlement, state, remaining unresolved amount |
| Refund allocation | Obligation + original tender, amount, capacity reservation reference; frozen sebelum execution |
| Refund tender operation | Allocation reference, tender type, logical provider operation, state, external reference |
| Refund attempt | Operation, attempt ID/time, request/result/event evidence, failure/unknown reason; tidak membuat allocation baru |
| Reversal facts | Original unit/application/points/charges, accepted return, exact signed reversal, unique logical source |
| Voucher replacement link | Original voucher/tender/allocation, replacement voucher and ISSUE entry, verified recipient/claim |

Remaining capacity dihitung dari seluruh non-cancelled committed allocations; jangan menghitung allocation lalu menambahkan attempts sebagai kewajiban baru. Successful, processing, pending, dan failed-retriable allocations masing-masing mengurangi capacity tepat sekali.

## 6. Logical state machine

Label implementasi boleh berbeda dengan mapping satu-ke-satu terhadap makna bisnis. Transition history harus menyimpan pemicu, actor/evidence, dan timestamp. State tidak boleh maju hanya karena timeout.

### 6.1 Quote / checkout / payment

```text
CREATED -> PRICED -> PAYMENT_PENDING -> PAYMENT_IN_PROGRESS
              |                              |
              |                              +-> UNKNOWN / RECONCILING
              |                              |        |
              |                              |        +-> verified result
              |                              |
              |                              +-> definitive failure / recovery
              |                              |
              |                              +-> all tenders confirmed
              |                                        |
              |                                        v
              |                                   FINALIZING -> COMPLETED
              |
              +-> reprice jika cart/revision/expiry berubah sebelum payment
```

| Transition / action | Guard dan efek |
|---|---|
| EvaluateCart → PRICED | Input sah; no payment/ledger/usage side effect |
| Reserve → PAYMENT_PENDING | Quote valid; resource availability/ownership/generation diperiksa atomic |
| BeginPayment → PAYMENT_IN_PROGRESS | Intent/key tersimpan sebelum external call; quote dipin |
| Timeout → RECONCILING | Hasil belum pasti; holds tidak dilepas hanya karena expiry |
| All confirmed → FINALIZING | Sum confirmed applied tenders = due; zero-due dapat tanpa tender |
| FINALIZING → COMPLETED | Pinned facts, usage/value effects dan durable dispatch konsisten; retry tidak charge ulang |
| Cancel sebelum attempt | Release reservations; cancellation fact |
| Cancel setelah partial success | Catat kompensasi/recovery; CANCELLED hanya setelah kewajiban payment terselesaikan |

Individual payment operation membedakan pending, processing, unknown/reconciling, succeeded, dan definitive failed. Failed satu tender tidak menyatakan tender lain gagal. Reattempt setelah definitive failure tetap terkait logical obligation dan tidak mengubah quote tanpa protocol yang eksplisit.

### 6.2 Authorization / coupon

```text
AVAILABLE -> AUTHORIZED -> COMMITTED
                 |
                 +-> RELEASED / pre-payment EXPIRED -> available bila masih sah
                 |
                 +-> payment unresolved -> tetap held + reconciliation
```

Unique code: UNUSED → RESERVED → CONSUMED. Release kembali UNUSED hanya jika code masih valid dan outcome sudah aman untuk dilepas. Code expired/cancelled tidak menjadi usable akibat release. Shared code tidak berubah globally CONSUMED; penggunaan disimpan per redemption. Late callbacks harus cocok dengan quote/authorization generation.

### 6.3 Loyalty redemption

```text
PENDING -> atomic central commit -> COMPLETED
       \-> definitive abort/rollback -> FAILED
```

Satu logical redemption hanya mempunyai satu business result. Response hilang setelah commit dipulihkan lewat lookup/idempotency; tidak membuat voucher kedua. PENDING audit record, bila dipersist, tidak menjadi bukti points sudah didebit sebelum transaksi utama commit.

### 6.4 Return dan refund

```text
Return decision: REQUESTED -> ACCEPTED
                         \-> REJECTED

Accepted return -> frozen refund obligation
                          |
                          +-> voucher operation
                          +-> card operation
                          +-> cash operation bila applicable
```

Per operation: PENDING → PROCESSING → SUCCEEDED, definitive FAILED, atau UNKNOWN/RECONCILING. Failed-retriable tetap kewajiban terbuka. Cancelled voucher memerlukan operator; jangan me-label refund succeeded sebelum resolution.

Aggregate refund: PENDING jika belum selesai; PARTIALLY_SUCCEEDED jika sebagian allocation telah selesai; SUCCEEDED hanya bila semua kewajiban selesai. Needs attention/failed-attempt reason ditampilkan bersama outstanding amount. `FAILED` tidak berarti kewajiban hilang. Accepted return tetap accepted saat retry berlangsung.

Duplicate/older provider callback tidak boleh menurunkan state tanpa bukti baru. Genuine late failure memerlukan reconciliation fact/audit dan pemulihan kewajiban terkait; jangan menghapus success history atau mengulang tender lain.

### 6.5 Offline sync

```text
LOCAL_COMPLETED -> PENDING_SYNC -> RECEIVED / VALIDATING -> ACCEPTED
                                                    \-> NEEDS_RECONCILIATION
```

Cloud acceptance posts earning/analytics sekali. Needs reconciliation tidak otomatis membatalkan completed local sale atau menilai ulang dengan current rules. Raw input dan alasan penolakan evidence tetap tersedia. Dashboard menampilkan data freshness per store.

## 7. Command contract

Setiap mutation menerima tenant/actor context, logical command identity, payload fingerprint, dan references/version yang relevan. Response menyertakan durable business object ID/state, bukan hanya pesan sukses. Pure queries tidak memerlukan mutation idempotency, tetapi tetap mencatat input/version untuk evidence.

| Command | Input utama | Guard / hasil |
|---|---|---|
| EvaluateCart | Cart units, store/customer/coupon, config versions, time, charges | Pure quote + trace + expected points; explicit invalid/timeout |
| ValidatePublication | Candidate version + targets + dependencies | Diagnostics lengkap; conflict/invalid config memblok publish |
| Publish / ActivateArtifact | Pinned release, target, digest/signature/generation | Durable publication; per-store verified atomic activation |
| AuthorizeCoupon | Quote, code/set, customer, generation | Online bila constrained; atomic reservation, no consumption |
| AuthorizeVoucher | Quote, voucher/claim, requested applied amount | Currency/owner/status/capacity check; atomic hold |
| BeginPayment | Quote revision/hash, authorizations, tender plan | Durable intent dan provider keys, freeze quote |
| RecordPaymentResult | Logical provider operation + trusted result evidence | Verify mapping/dedupe; no implicit new charge |
| ReconcilePayment | Existing operation/reference | Query/process authoritative evidence; keep unknown honest |
| FinalizeSale | Pinned checkout/payment facts | Confirmed coverage; immutable facts + one-time effects + dispatch |
| CancelCheckout | Checkout, reason, revision | Pre-attempt release atau post-success compensation workflow |
| RedeemPointsToVoucher | Customer, scheme/option version, logical request | Central atomic debit + issue; return existing voucher on retry |
| AcceptReturn | Original sale units, reason, policy authorization | Claim once, original values, frozen allocation/capacity, reversal once |
| ExecuteRefund | Existing allocation/tender operation | Amount immutable; only unresolved obligation attempted |
| ReconcileRefund | Existing provider operation/evidence | Resolve unknown/late failure without duplicate value |
| SyncOfflineSale | Original facts, artifact/time evidence, logical sale ID | Validate original context; dedupe acceptance and projections |
| Rebuild / Reconcile projections | Scope, cutoff, source/version | Same ledger/fact totals; report missing evidence/differences |

Business errors harus spesifik: price missing/ambiguous, config invalid/expired, not eligible, capacity insufficient, authorization stale, idempotency conflict, payment unresolved, return unit already accepted, evidence incomplete. Transport HTTP codes/exact payload schema diturunkan saat implementasi (OPEN-07), tidak ditebak oleh UI.

## 8. Atomicity, uniqueness, dan recovery

| Boundary | Harus atomic / recoverable | Pembuktian |
|---|---|---|
| Reserve scarce resource | Check capacity + reserve owner/generation | Dua connection overlap, bukan hanya sequential retry |
| Points-to-voucher | Check/debit points + voucher + ISSUE + completed result | Crash setiap step tidak menyisakan setengah efek |
| BeginPayment | Persist intent/key sebelum provider request | Response lost after actual success tidak double charge |
| FinalizeSale | Dependent execution facts/effects committed konsisten + durable dispatch | Crash/restart melanjutkan finalization saja |
| AcceptReturn | Unique unit claim + reversal/obligation + frozen tender capacity | Dua concurrent returns tidak memakai capacity/unit sama |
| Refund execution | One logical effect per allocation; attempts terpisah | Retry partial success tidak mengulang sukses |
| Offline acceptance | One acceptance/earning/analytics effect per original sale | Duplicate/out-of-order sync aman |

Central DB dan Store DB tidak dianggap satu distributed transaction. Bila dependent facts melintasi boundary, implementasi harus menyediakan durable protocol/outbox/inbox dan recovery yang membuktikan INV-01–16. Jangan menandai distributed transaction selesai hanya karena publish event berhasil.

Uniqueness minimum: tenant+command+logical key; provider operation mapping; ledger logical source/effect; voucher per loyalty redemption; accepted claim per sale unit; refund restoration/replacement source; event consumer effect identity. Key sama dengan payload berbeda adalah conflict, bukan success replay.

Locks diambil dalam urutan stabil; no external HTTP dalam locked transaction. Hold expiry ketika payment unknown mengirim pekerjaan reconciliation, bukan membebaskan balance/code. Jika provider idempotency window habis, cari existing operation sebelum membuat request baru.

## 9. Publication dan parity

```text
Author draft -> Validate -> Simulate -> Freeze release
      -> Compile per store -> Sign / durable publish
      -> Store verify scope/hash/signature/dependencies/validity/generation
      -> Atomic activate -> Activation acknowledgement
```

Simulation memakai semantics sama tanpa reserve/consume/debit atau payment. Published snapshot lengkap dan immutable. Rejected artifact tidak menimpa active pointer; active lama hanya digunakan selama masih sah. Delivery, verification, activation, dan sale usage merupakan bukti berbeda.

Parity membandingkan hasil semantik/canonical hash untuk identik input/version di Store dan Cloud: chosen outcomes, per-unit values, allocations, rounding, reasons. Timestamp pengiriman/log attempt bukan bagian hash kalkulasi. Private costs, customer secrets, dan raw coupon/voucher secrets tidak dibocorkan dalam artifact atau client evidence.

## 10. Audit dan akses

Simpan actor, source operation, source unit/tender, definition versions, quote hash, authorization generation, evaluation/completion/acceptance times, reason adjustments, provider references, dan event delivery history. Client read-only melihat toko/tenant yang berhak dilihat dengan customer/codes/payment details dimasking.

Role mapping dan approval thresholds masih konfigurasi implementasi. Hak melihat bukti tidak memberikan hak mengubah ledger, menerima return, issue voucher, atau retry refund. Repair manual wajib lewat authorized audited command dan tetap mempertahankan source facts.

## 11. Definition of ready untuk schema/API

Sebelum physical schema/API dianggap sesuai, sediakan mapping entity/command/state → implementasi; constraint dan transaction-boundary evidence; round-trip canonical definition; recovery protocol; authorization checks; original snapshot retention; migration/compatibility strategy; serta hasil tes relevan di [matriks](commercial-v1-acceptance-test-plan.md).

Dokumen ini tidak mengunci SQL column names, enum transport, Rust types, provider SDK, atau deployment topology. Pilihan teknis boleh berbeda selama outcome dan invariants sama; perubahan makna bisnis mengikuti change control.
