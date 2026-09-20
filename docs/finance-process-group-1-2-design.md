# Finance Process Design — Group 1 dan Group 2

Status: **draft untuk dikunci sebelum implementasi**  
Scope: Sales & Customer; Store Cash Operations  
COA basis: working seed 144 natural accounts

## Aturan desain

User membuat dokumen bisnis atau menjalankan event operasional. Sistem menentukan konsekuensi akuntansinya. User Store/Unit tidak memilih akun GL, debit, atau kredit.

Jurnal adalah konsekuensi backend dari event yang sudah valid. Jurnal bukan workflow bisnis.

Unit hanya mengelola event operasional dan uang fisik yang memang berada di Unit. Rekening bank berada di bawah kontrol HO. Semua posting yang menyentuh akun Store Cash berasal dari typed business event, bukan generic journal screen.

## Akun natural dalam scope

### Group 1 — Sales & Customer

Direct account:

- Penjualan Barang Dagangan
- Potongan Penjualan
- Retur Penjualan
- Hutang Voucher
- Uang Muka Penjualan

Related consequence, tetap berada dalam kelompok accounting nature masing-masing:

- Harga Pokok Pembelian / HPP
- Persediaan Barang Dagangan

Tender, payment method, voucher, customer, acquirer, supplier, dan inventory item adalah subledger atau dimensi. Mereka bukan akun revenue baru.

### Group 2 — Store Cash Operations

Direct account:

- Cash On Hand — hasil penjualan fisik yang masih di Unit
- Petty Cash — dana operasional Unit
- Modal Kasir — float/change fund kasir

Related consequence, tetap berada dalam kelompoknya sendiri:

- Saldo Affiliasi Pembiayaan
- Saldo Affiliasi Atas Barang
- Piutang Pegawai dan Manajemen
- Bank — Giro
- Bank — Tabungan
- Akun biaya operasional

## Group 1 — Business-event catalog

### G1-01 Completed merchandise sale

| Bagian | Desain |
|---|---|
| Business process | Customer membeli merchandise dan receipt selesai |
| Source document | POS receipt / sale transaction |
| Operational state | `DRAFT → CHECKED_OUT → COMPLETED`; `VOIDED` hanya sebelum completed |
| Recognition point | Saat POS receipt menjadi `COMPLETED` |
| Actor/authority | Store membuat transaksi; POS/system memvalidasi; Finance mengawasi rule |
| Natural accounts | Penjualan Barang Dagangan; tender-side account; HPP; Persediaan Barang Dagangan |
| Subledger/dimensi | `sale_id`, `site_id`, `cost_center_id`, line/item, quantity, price, tender, tax/discount metadata |
| Journal? | Ya, segera atau melalui batch agregasi yang tetap merepresentasikan event completed |
| Behavior | Revenue dan tender ditentukan sistem; HPP/inventory dibuat oleh inventory valuation engine |
| Reconciliation | POS completed vs sales journal; tender total vs cash/acquirer receivable; quantity/HPP vs stock ledger |
| Reversal | Cancellation sebelum posting membatalkan event; setelah completed gunakan return/refund flow, bukan void |

Conceptual consequence:

```text
Dr Cash On Hand / Piutang Acquirer / account tender lain
    Cr Penjualan Barang Dagangan

Dr Harga Pokok Pembelian / HPP
    Cr Persediaan Barang Dagangan
```

Pajak, jika berlaku, mengikuti tax rule yang sudah ditetapkan. POS user tidak memilih akun.

### G1-02 Tender attribution

| Bagian | Desain |
|---|---|
| Business process | Payment method dipilih pada checkout |
| Source document | POS payment/tender line |
| Operational state | `OPEN → CAPTURED`; `FAILED`, `REFUNDED`, atau `REVERSED` bila relevan |
| Recognition point | Saat tender diterima sebagai bagian dari completed sale |
| Actor/authority | Cashier memilih tender bisnis; system menentukan target subledger/account |
| Natural accounts | Cash On Hand untuk cash; piutang acquirer untuk debit/kartu/QRIS; Hutang Voucher untuk voucher redemption/issue context |
| Subledger/dimensi | `tender_type`, `bank_account_id` bila settlement bank, acquirer/merchant ID, authorization/reference |
| Journal? | Menjadi bagian dari journal completed sale atau settlement event |
| Behavior | Auto |
| Reconciliation | Tender POS vs acquirer settlement vs bank statement; cash tender vs cash count |
| Reversal | Reverse tender melalui refund/chargeback/reversal event; jangan edit journal lama |

Tender values dapat mencakup `CASH`, `DEBIT_BCA`, `DEBIT_MANDIRI`, `CREDIT_VISA`, `CREDIT_MASTERCARD`, `QRIS`, dan `VOUCHER`. Perbedaan tender tidak membuat natural revenue account baru.

### G1-03 Discount

| Bagian | Desain |
|---|---|
| Business process | Line atau basket diberi discount yang valid |
| Source document | POS sale line / promotion or markdown record |
| Operational state | `PROPOSED → VALIDATED → APPLIED`; `REVERSED` bersama sale/return |
| Recognition point | Saat discount menjadi bagian dari completed sale |
| Actor/authority | System/promotion rule; manual markdown memerlukan permission sesuai policy |
| Natural accounts | Potongan Penjualan; Penjualan Barang Dagangan |
| Subledger/dimensi | `discount_reason`, campaign, member/staff flag, approval reference, line ID |
| Journal? | Ya, sebagai konsekuensi completed sale |
| Behavior | Auto untuk rule; semi-auto/approved untuk manual markdown |
| Reconciliation | POS gross less discount vs net sales; promotion usage vs approved campaign |
| Reversal | Reversal mengikuti sale cancellation/return; tidak membuat akun baru |

Discount reason tetap metadata. Contoh: promotion, member discount, staff discount, manual markdown, plastic bag discount.

Plastic bag tetap mengikuti aturan client: nilai jual Rp1.000 dan discount 100%, sehingga payment line-nya nol. Tidak dibuat natural account penjualan khusus. Perlakuan inventory/HPP kantong dibahas pada Inventory Group.

Conceptual consequence:

```text
Dr tender-side account                         100,000
Dr Potongan Penjualan                            1,000
    Cr Penjualan Barang Dagangan                         101,000
```

Untuk tampilan customer, total yang dibayar tetap Rp100.000.

### G1-04 Void / cancel sebelum completed

| Bagian | Desain |
|---|---|
| Business process | Receipt dibatalkan sebelum menjadi completed |
| Source document | POS receipt |
| Operational state | `DRAFT/CHECKED_OUT → VOIDED` |
| Recognition point | Tidak ada recognition revenue |
| Actor/authority | Cashier sesuai permission; supervisor bila policy mensyaratkan |
| Natural accounts | Tidak ada |
| Subledger/dimensi | Sale ID, reason, actor, timestamp |
| Journal? | Tidak |
| Behavior | Operational only |
| Reconciliation | Void count dan reason vs cashier activity |
| Reversal | Tidak ada jurnal; jika sudah completed, flow ini tidak boleh digunakan |

### G1-05 Return setelah completed

| Bagian | Desain |
|---|---|
| Business process | Customer mengembalikan barang yang sebelumnya sudah terjual |
| Source document | Return/credit note linked ke original sale |
| Operational state | `REQUESTED → APPROVED → ACCEPTED/REJECTED → REFUNDED`; inventory dapat `SELLABLE`, `DAMAGED`, atau `NOT_ACCEPTED` |
| Recognition point | Saat return disetujui dan accepted |
| Actor/authority | Store menerima request; supervisor/MD menentukan acceptance sesuai policy |
| Natural accounts | Retur Penjualan; tender/refund-side account; HPP dan Persediaan bila barang kembali ke stock |
| Subledger/dimensi | Original `sale_id`, item, quantity, reason, condition, refund method |
| Journal? | Ya setelah accepted; refund payment dapat menjadi event terpisah |
| Behavior | Semi-auto setelah approval |
| Reconciliation | Return vs original sale; refund vs tender; stock return vs inventory ledger |
| Reversal | Reversal return hanya melalui approved correction yang merujuk return asli |

Void dan return wajib tetap berbeda. Void berarti transaksi tidak pernah diakui. Return berarti transaksi sudah diakui dan kemudian dibalik sebagian/seluruhnya.

Conceptual consequence jika barang kembali sellable:

```text
Dr Retur Penjualan
    Cr tender/refund-side account

Dr Persediaan Barang Dagangan
    Cr Harga Pokok Pembelian / HPP
```

Jika barang tidak kembali ke sellable inventory, inventory consequence mengikuti disposition rule yang dikunci di Inventory Group.

### G1-06 Voucher issue / sale

| Bagian | Desain |
|---|---|
| Business process | Customer membeli voucher sebelum merchandise revenue earned |
| Source document | Voucher issue transaction / POS voucher sale |
| Operational state | `ISSUED → ACTIVE → PARTIALLY_REDEEMED → REDEEMED/EXPIRED/VOIDED` |
| Recognition point | Saat uang diterima untuk voucher, liability diakui; bukan merchandise revenue |
| Actor/authority | POS/system issue; Finance owns liability policy |
| Natural accounts | Hutang Voucher; tender-side account |
| Subledger/dimensi | `voucher_id`, face value, balance, issue date, expiry, status, customer reference |
| Journal? | Ya |
| Behavior | Auto |
| Reconciliation | Issued balance + redemption + expiry/void = Hutang Voucher; tender vs bank/cash |
| Reversal | Void only according to voucher policy and before redemption; all reversals preserve voucher history |

Conceptual consequence:

```text
Dr Cash / Bank / tender-side account
    Cr Hutang Voucher
```

### G1-07 Voucher redemption

| Bagian | Desain |
|---|---|
| Business process | Customer uses voucher against merchandise |
| Source document | Completed sale with voucher tender line |
| Operational state | `ACTIVE → REDEEMED/PARTIALLY_REDEEMED` |
| Recognition point | Merchandise sale is completed; voucher liability is consumed |
| Actor/authority | Cashier selects/validates voucher; system checks balance/status |
| Natural accounts | Penjualan Barang Dagangan; Hutang Voucher; residual tender account; HPP; Persediaan |
| Subledger/dimensi | Voucher ID, sale ID, redeemed amount, remaining balance |
| Journal? | Ya |
| Behavior | Auto |
| Reconciliation | Voucher subledger vs Hutang Voucher; sale total vs tender split |
| Reversal | Reverse redemption with linked correction; restore voucher balance only through controlled flow |

Example Rp700.000 merchandise, Rp500.000 voucher, Rp200.000 cash:

```text
Dr Hutang Voucher                         500,000
Dr Cash / other tender                    200,000
    Cr Penjualan Barang Dagangan                    700,000
```

Voucher redemption is not a sales discount.

### G1-08 Uang Muka Penjualan

| Bagian | Desain |
|---|---|
| Business process | Customer pays before the supported merchandise obligation is completed |
| Source document | Deposit/pre-order document, if the business confirms the flow |
| Operational state | `RECEIVED → ALLOCATED → FULFILLED/REFUNDED/EXPIRED` |
| Recognition point | Cash receipt creates liability; revenue only when the underlying sale is completed |
| Actor/authority | HO/Finance defines policy; Store records approved document |
| Natural accounts | Uang Muka Penjualan; tender-side account; later Penjualan Barang Dagangan |
| Subledger/dimensi | Deposit/order ID, customer, allocation, expiry, fulfillment |
| Journal? | Supported, but exact process remains confirmation-dependent |
| Behavior | Semi-auto after business rule is confirmed |
| Reconciliation | Deposit subledger to Uang Muka Penjualan; allocation to completed sales |
| Reversal | Refund or reallocation through linked approved event |

## Group 2 — Business-event catalog

### G2-01 Completed cash sale held by Unit

| Bagian | Desain |
|---|---|
| Business process | Completed POS sale with `CASH` tender; physical proceeds remain at Unit |
| Source document | Completed POS sale/tender |
| Operational state | `COMPLETED → HELD_AT_UNIT → REMITTED` |
| Recognition point | Sale recognition follows G1-01; cash custody is recorded with the completed tender |
| Actor/authority | Store controls physical cash; system posts consequence |
| Natural accounts | Cash On Hand; Penjualan Barang Dagangan; HPP/Persediaan as applicable |
| Subledger/dimensi | Site/cost center, cash drawer/secure location, sale day, cash batch |
| Journal? | Yes, through completed sale |
| Behavior | Auto |
| Reconciliation | Completed cash tender vs cash count and remittance declaration |
| Reversal | Sales return/refund or approved cash correction; never edit original journal |

### G2-02 Petty cash funding/replenishment

| Bagian | Desain |
|---|---|
| Business process | HO funds or replenishes Unit operational cash fund |
| Source document | Approved petty cash funding/transfer instruction plus receipt evidence |
| Operational state | `REQUESTED → APPROVED → FUNDED → RECEIVED → CLOSED/RECONCILED` |
| Recognition point | When Unit actually receives the fund |
| Actor/authority | HO approves and funds; Unit acknowledges receipt; Finance owns posting |
| Natural accounts | Petty Cash; likely HO bank and/or approved inter-unit funding consequence |
| Subledger/dimensi | Site, petty cash fund, funding instruction, bank account, recipient |
| Journal? | Yes when economic cash movement occurs |
| Behavior | Semi-auto/approved; no generic account selection by Store |
| Reconciliation | HO bank payment vs Unit receipt vs petty cash balance and receipts |
| Reversal | Refund/return or approved correction linked to funding document |

### G2-03 Petty cash operational payment

| Bagian | Desain |
|---|---|
| Business process | Unit pays an approved small operating expense from petty cash |
| Source document | Expense document, receipt, approval, petty cash voucher |
| Operational state | `DRAFT → SUBMITTED → APPROVED → PAID → RECONCILED` or `REJECTED` |
| Recognition point | Approved expense payment / valid supporting evidence according to expense policy |
| Actor/authority | Store submits; approver/HO approves; Finance derives expense account |
| Natural accounts | Petty Cash; derived operating expense account |
| Subledger/dimensi | Site, expense category, supplier/payee, receipt, approval, tax if applicable |
| Journal? | Yes after approval/payment |
| Behavior | Semi-auto; account is derived from expense category |
| Reconciliation | Petty cash disbursement vs approved vouchers, physical cash, and replenishment |
| Reversal | Refund/reimbursement or approved correction; retain original evidence |

### G2-04 Modal Kasir custody handover

| Bagian | Desain |
|---|---|
| Business process | Cashier receives or returns custody of the existing float |
| Source document | Shift open/close handover record and cash count evidence |
| Operational state | `SAFE → HANDED_TO_CASHIER → RETURNED_TO_SAFE`; exception `MISSING/VARIANCE` |
| Recognition point | Custody event only |
| Actor/authority | Cashier and witness/supervisor; Store controls custody |
| Natural accounts | None for normal handover |
| Subledger/dimensi | Site, till, cashier, shift, custody chain, expected amount, counted amount |
| Journal? | **No** |
| Behavior | Operational/control only |
| Reconciliation | Custody chain and count evidence vs expected Modal Kasir balance |
| Reversal | Correct custody record or approved variance event; never treat opening/closing shift itself as GL movement |

### G2-05 Modal Kasir float increase/decrease

| Bagian | Desain |
|---|---|
| Business process | HO officially adds or receives back part of the cashier float |
| Source document | Approved float adjustment/funding/return instruction |
| Operational state | `REQUESTED → APPROVED → FUNDED/RETURNED → RECEIVED → RECONCILED` |
| Recognition point | Economic float amount actually changes |
| Actor/authority | HO approves; Store acknowledges; Finance posts |
| Natural accounts | Modal Kasir; corresponding HO funding/return consequence |
| Subledger/dimensi | Site, till/float, instruction, custody, amount, bank/cash evidence |
| Journal? | Yes |
| Behavior | Semi-auto/approved |
| Reconciliation | Float subledger and physical custody vs Modal Kasir GL |
| Reversal | Approved return/funding correction, not shift close/open |

### G2-06 Cash count

| Bagian | Desain |
|---|---|
| Business process | Store counts physical cash against expected balance |
| Source document | Cash count sheet/count session |
| Operational state | `OPEN → COUNTED → WITNESSED/APPROVED → RECONCILED`; `EXCEPTION` if variance |
| Recognition point | Control evidence only |
| Actor/authority | Store counts; witness/approver confirms where required |
| Natural accounts | None automatically |
| Subledger/dimensi | Site, drawer/fund, cashier, shift/day, expected, physical, variance, witness |
| Journal? | **No** |
| Behavior | Operational/control only |
| Reconciliation | Count vs POS tender, petty cash vouchers, remittance, and custody records |
| Reversal | Correct/recount with reason; any accounting treatment requires separate approved event |

The variance must not automatically post to employee receivable, other expense, other income, or any other account.

### G2-07 Sales proceeds remittance/deposit declaration

| Bagian | Desain |
|---|---|
| Business process | Unit declares remittance of sales proceeds to HO/bank process |
| Source document | Store remittance/deposit declaration and supporting evidence |
| Operational state | `DECLARED → APPROVED → RECEIVED/MATCHED → RECONCILED`; exception `DISPUTED` |
| Recognition point | The declaration records operational intent; bank receipt is the evidence of actual bank movement |
| Actor/authority | Unit declares physical amount; HO/Finance controls bank and reconciliation |
| Natural accounts | Cash On Hand; Saldo Affiliasi Atas Barang may be the Unit-side consequence; Bank — Giro/Tabungan on actual receipt |
| Subledger/dimensi | Deposit ID, site, bank_account_id, declared amount, receipt/reference, dates |
| Journal? | Needs final posting design; operational declaration itself must not invent bank receipt |
| Behavior | Semi-auto after bank evidence/approved policy |
| Reconciliation | Declaration vs bank statement; current version assumes bank receipt equals declared amount |
| Reversal | Correct declaration or approved discrepancy event; never silently alter the amount |

For the current version, do not introduce cash-in-transit, partial receipt, shortage, or overage flows. Bank reconciliation may match the declaration to the actual statement later.

## Explicit forbidden flows

### Group 1

- Separate natural revenue accounts for cash, debit card, credit card, or QRIS.
- Revenue recognition when the voucher is issued.
- Treating voucher redemption as sales discount.
- Treating a completed sale as void.
- Treating a pre-completion void as return.
- Making POS users choose HPP, inventory, debit, credit, or credit-side accounts.
- Creating a special sales natural account for plastic shopping bags.

### Group 2

- Generic Store journal screen for cash accounts.
- Transfers among Cash On Hand, Petty Cash, and Modal Kasir.
- Using Cash On Hand as a normal operating expense wallet.
- Posting a journal on shift open or shift close.
- Posting a journal automatically from cash count variance.
- Assuming a bank receipt, shortage, overage, or cash-in-transit event without evidence.
- Giving Unit users access to company bank accounts or bank posting.

## Needs confirmation

1. Exact supported business flow and document for Uang Muka Penjualan/pre-order.
2. Whether `bank receipt = declared deposit` is sufficient beyond the first release.
3. Final journal shape for Store remittance, including the use of Saldo Affiliasi Atas Barang.
4. Whether HPP is posted per completed sale, per sale-day batch, or by another valuation batch; recognition must still trace to completed sales.
5. Return disposition and HPP treatment when returned goods are damaged or not sellable.
6. Voucher expiry, breakage, partial redemption, cancellation, refund, and customer identity rules.
7. Approval limits for manual markdown, petty cash payment, float change, return, and cash variance investigation.
8. Exact account/dimension policy for bank settlement, acquirer fees, and payment reconciliation.
9. Whether cash count variance has a later approved accounting event and who owns it.
10. Whether plastic bag inventory/HPP treatment belongs in the next Inventory Group design.

## Locked decisions

- Working basis remains 144 natural accounts; no other natural account is changed in this task.
- `Hutang Supplier Barang Dagang - Suspend` is removed from the working seed.
- `Hutang Lain-lain`, `Pendapatan lain-lain`, `Pendapatan (Biaya) Lain-lain`, and `Hutang Voucher` remain.
- One merchandise revenue account is used; tender is a subledger/dimension.
- Sale recognition occurs at POS `COMPLETED`, not close-of-day or bank settlement.
- Discount reason is metadata, not a natural account.
- Plastic bag is recorded as Rp1.000 sale with 100% discount; no special sales account here.
- Void before completion is not a sale and does not use Retur Penjualan.
- Return after completion uses Retur Penjualan and may reverse inventory depending on disposition.
- Voucher issue increases Hutang Voucher; voucher redemption consumes that liability and is not a discount.
- Uang Muka Penjualan is retained but its detailed process remains unconfirmed.
- HPP and inventory consequences are system-generated.
- Cash On Hand, Petty Cash, and Modal Kasir are distinct and cannot be used interchangeably.
- Shift open/close and normal cash count create no journal.
- Store cash accounts cannot be transferred directly among one another.
- Unit handles physical cash; HO controls bank accounts.
- Store users perform business documents, not GL selection.

## Unresolved before coding

The design is ready for review, but the unresolved items above must be answered before the corresponding posting rules are implemented. Coding can begin after the locked decisions are accepted and the needs-confirmation items are either resolved or explicitly marked as deferred behavior.

