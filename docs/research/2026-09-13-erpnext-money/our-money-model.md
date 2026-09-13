# OURS — how money movement is modelled, across four bodies

Body **A** = working tree of `feat/handheld-rfid` (tip `6593b2e`). Body **D** = worktree `/Users/hari/itulah/.claude/worktrees/agent-a0244accbdd9ec95f` (branch `feat/finance-control`). **B** = finance-lab engine. **C** = 11 Sep prototype.

**One-line answer.** A has exactly one money document and it only ever pays supplier bills out of one of four pots. D has **two** coexisting payment documents — `supplier_payment` (PV-, widened) and `cash_document` (KK/KM/TF, generic, three primitives) — plus nine store-money documents, a Payment Ledger (AP/AR sub-ledger), and a batch orchestrator. B is the cleanest *model* of one payment with allocation lines and a six-rung lifecycle, no backend. C draws four money forms: F02 Pembayaran, F03 Penerimaan, F04 Transfer, F05 Giro — Payment Entry split by direction plus an instrument.

## 1A — LIVE
| Document | Table | Migration | Key facts | States | Journal |
|---|---|---|---|---|---|
| Supplier payment | `supplier_payment` + `_allocation` | 0084 (+0220) | `PV-`, `site_id`, `method` ∈ TRANSFER/CASH/GIRO/OTHER, ONE `account_key` ∈ bank_giro/bank_savings/cash/petty_cash + qualifier, `total_minor`; child `(payment_id, invoice_id)` + `amount_minor` | `DRAFT → POSTED`, **no VOID** (0084: "adding a status the code cannot reach would be a promise the module does not keep") | `PAYMENT`/`supplier_payment/1`: one Dr per allocation (`trade_payable` or `non_merchandise_payable` by bill kind) + one Cr money key |
| Bill instalment | `supplier_invoice_payment_term`, view `supplier_invoice_standing` | 0202 | surrogate id (an allocation naming `(invoice_id, seq)` would name a POSITION); `next_due_date` = earliest unpaid (diverges from ERPNext `max()`); `overdue` separate boolean | — | — |
| Payment terms | `payment_term`, `payment_terms_template(+line)` | 0201 | basis DAYS_AFTER_BILL / …MONTH_END; `portion_bps`; `ever_used` | — | — |
| Bank statement + match | `bank_statement(+line)`, `bank_line_match` | 0071, 0213, 0214 | 0213 `allocated_minor`, drops UNIQUE(line_id), keeps UNIQUE(journal_line_id); 0214 counterparty kind ∈ SUPPLIER/CUSTOMER/MEMBER/STAFF/OTHER | matched / booked | matching posts nothing; `book_bank_line` posts `BANK_STATEMENT`/`bank_line/1` |
| Cash count | `cash_count(+note)` | 0216 | stores `per_books_minor`, difference never stored; UNIQUE(account, site, date) | observation → posted | `CASH_COUNT`: Dr/Cr drawer vs `cash_variance` (**unmapped, not in required_semantic_keys — live defect**) |
| Voucher | `voucher(+movement)` | 0090, 0162 | GIFT_CARD/REFUND/GOODWILL; ISSUE/REDEEM/VOID | derived | **none** |
| Bank accounts | `supplier_bank_account`, `company_bank_account` | 0221, 0223 | normalised bank name, digits, holder, branch; company kind GIRO/SAVINGS | live/retired | none ("the map still decides where a posting lands") |
| Till tender (sqlite) | `sale_tender` | sqlite 0020+0028 | CASH/CARD/QRIS/OTHER/VOUCHER | — | **none** (SALE_DAY zero writers) |
| Till drawer (sqlite) | `cash_shift`, `cash_movement` | sqlite 0024 | opening float, blind declared, variance; movements OPENING_FLOAT/DROP/PAYOUT/PICKUP/CORRECTION | OPEN→CLOSED | none, never reaches cloud |
| Store petty cash (sqlite) | `petty_cash_top_up`, `store_expense` | sqlite 0038 | 9 categories; CHECK approved_by <> claimed_by | approved on arrival | **none** — "the centre has nowhere to receive this yet" |
| Customer refund | `sale_return_payment` + allocation/attempts | 0164 | tied to original tender | attempts | none |

**What a user can express today** (`payments.tsx` ComposerSheet): Location, date, Method (4), Money account (mapped for site), Total paid, Reference, Note, allocation table of bills. **No counterparty, no direction, no paid-to, no deductions, no giro fields, no money-in.**
**Three incompatible money-key constants:** `statements.rs:388` (8 keys), `payments.rs:558` (4 keys), `cash_counts.rs:30` (3 keys). `cashier_float` is mapped, countable, displayable, with **nothing that funds it**.

## 1D — BRANCH feat/finance-control (migrations 0106–0158, branch-only)
### D-1 Generic money document — `cash_document` (0115)
`kind` ∈ PAY/RECEIVE/TRANSFER **derived from the two sides, never chosen**; number `KK-`/`KM-`/`TF-` NULL until approved; from_key/qualifier/account_code/site and to_ side (exactly one spelling each; money cannot arrive where it left); `amount_minor`; `party_kind` ∈ SUPPLIER/EMPLOYEE/OTHER + ids + name; memo NOT NULL; attachment; `statement_line_id`; `giro_number`+`giro_due_date` (only PAY); `journal_entry_id`, `reversal_entry_id`. States `DRAFT → APPROVED → POSTED → REVERSED` one-way (trigger `protect_posted_cash_document`). Posts `CASH_DOC`/`cash_document/1`: Dr to-side at to_site, Cr from-side at from_site; may settle PLE only for `trade_payable`/`non_merchandise_payable` with SUPPLIER, **oldest-first claim**.
0115 verbatim: "A cash document says money left one account and arrived in another, on a date, for a reason, at somebody's instruction. That is the whole model. It is deliberately NOT three tables … The KIND is a fact about the two accounts and not an extra field somebody chooses … Maker and checker are recorded, not enforced apart."

### D-2 Payment Ledger (0143–0145)
`payment_ledger_entry`: control account as **unresolved triple** (account_key+qualifier+site_id); `party_type` ∈ SUPPLIER/ACQUIRER/EMPLOYEE/CUSTOMER/OTHER; voucher/against_voucher; `journal_entry_id` NOT NULL; `side` RECEIVABLE/PAYABLE enum; `settled_minor` re-summed by trigger; `outstanding_minor` GENERATED; `delinked`. `payment_ledger_settlement`: allocation rows. `payment_ledger_as_of(date)` + control equation: PLE outstanding per triple must equal GL balance. Inclusion rule 0143: "**Money moving is NOT sufficient reason.**" IN: bill, payment, card sale, acquirer settlement, store-manager float, payroll payable. OUT: transfers, deposits, fees, remittance, expense on the spot, statement line.

### D-3 Payments lane (10 modules)
`payment_destination` (0151: encrypted number, mask, fingerprint, verification, owner_domain) · `payment_destination_snapshot` (0152: immutable per-payment copy) · `payment_batch(+item)` (0153: **holds no accounting** — "Every executed item is ONE ORDINARY PAY"; `unverified_policy` SKIP/HOLD; DRAFT/READY/PARTIAL/EXECUTED/HELD/CANCELLED; item PENDING/EXECUTED/SKIPPED/FAILED) · `payment_batch_event` (0154 append-only) · `domain/payment.rs` `PaymentPattern` 7 → `primitive()` PAY/RECEIVE/TRANSFER.
**Unwired:** `payment_allocation.rs::settle_through_payment_ledger` is a hard-coded refusal (ALLOCATE/UNMATCH/REVERSE unreachable); `payment_execution.rs` writes cash_document by raw SQL ("a bridge, meant to be deleted") though both lanes are in one tree. **Two payment documents with two allocation models** (named allocations vs oldest-first claim).

### D-4 Store money lane
| Document | Migration | Number | States | Journal |
|---|---|---|---|---|
| `store_deposit` (+`store_bank_destination`) | 0111 | SB- | PREPARED→DEPOSITED→CONFIRMED / CANCELLED | **two postings**: Dr cash_in_transit / Cr cash [site]; then Dr bank [dc,q] / Cr cash_in_transit |
| `remittance_order(+line,+execution)` | 0112 | REM- | ISSUED / CANCELLED; progress projected per line | **none** — a mandate; trigger refuses over-execution |
| `operating_fund` (+allocation,+settlement,+payroll_payout_task) | 0113 | OF- | derived | ADVANCE: Dr store_manager_receivable / Cr bank[dc]; settle by kind (VENDOR_BILL/PAYROLL/DIRECT_EXPENSE/RETURN) — **lane deleted by owner 7 Sep** |
| `custodian_handover(+item)` | 0113 | HO- | DRAFT→SIGNED (2 signatures) / VOID | RECLASS: same account both legs; party moves in PLE |
| `store_expense` | 0114 | KK-STORE-nn- | DRAFT→APPROVED→POSTED / REJECTED | STORE_EXPENSE: Dr category / Cr petty_cash; CHECK approved_by <> claimed_by; ceiling `STORE_EXPENSE_MANAGER_LIMIT_MINOR = 500_000_00` |
| `petty_cash_replenishment` | 0114 | KK-RPL- | none (posts on creation) | Dr petty_cash[site] / Cr bank[dc,q] |
| `cash_shift`, `cash_movement`, `store_document_counter` | 0110 | — | OPEN→CLOSED (authored at edge) | CASH_SHIFT/FLOAT: Dr cashier_float / Cr cash; /VARIANCE vs cash_variance; movements post nothing; `float_back_entry_id` **no writer** |
| `sales_posting(+line)` | 0107 | — | DRAFT→POSTED→REVERSED, UNIQUE(site, date) | SALE_DAY per tender: cash/revenue_cash; card_receivable_debit/credit; qris_receivable/revenue_qris; **VOUCHER → voucher_liability / revenue_cash**; VAT at frozen bps; COGS absent |

### D-5 Giro (0117–0119)
`giro`: direction OUT/IN, number, bank, site, amount, issue/due dates, exactly one of supplier_payment_id/cash_document_id, issue/clearing entry ids, cleared_line_id, rejected_reason. UNIQUE(bank, direction, number). `ISSUED → DELIVERED → DUE → CLEARED | REJECTED`. Issue rides on the payment's own entry with credit swapped to `giro_outstanding [bank]`; clear posts `GIRO`/`giro/1` Dr giro_outstanding / Cr bank_giro; reject = `poster::reverse(issue_entry_id)` and payment → REVERSED, which **reopens the bill** through the allocation rule. 0117 overturns 0084's "no VOID". Gaps: `giro_insert` only from `post_payment` (cash_document branch and IN direction have no writer); reject with NULL issue_entry_id reverses nothing.

### D-6 Acquirer (0108, 0134–0136)
`tender_reconciliation(+batch_line,+decision)` — shop proves takings per terminal; decisions MATCHED/NO_SETTLEMENT/OTHER_DAY/RETURNED/RETENDER; posts nothing except RETENDER. `sale_tender_retender` posts Dr to_key / Cr from_key (asset side only). `acquirer_settlement(+line,+exception,+report)`: gross/mdr/net (CHECK net = gross − mdr), `bank_statement_line_id` UNIQUE, `DRAFT→CURATED→MATCHED|EXCEPTION`; posts `ACQ_SETTLEMENT`: Dr bank[dc,bank]=net + Dr card_fee[shop,acquirer]=mdr / Cr card_receivable_*[shop,acquirer]=gross, grouped by (site, tender_kind), then affiliate legs. Settles PLE oldest-first **at gross** ("MDR is a cost we bore, not a discount the acquirer negotiated off a debt"). `fee_key` = `card_fee` even for QRIS (client has one account `6010110002`).

### D-7 Inter-unit — no document (0120–0122)
`journal_line.counter_site_id` + deferred trigger `journal_line_balances_per_site`; 0121 removes the 0098/0084 refusals; 0122 maps 52 rows `(semantic_key, owner_site, '<KIND>:<counterparty>')`, KIND ∈ BARANG/PEMBIAYAAN. `balancing_legs` emits affiliate_payable [unit, KIND:dc] / affiliate_receivable [dc, KIND:unit] per unbalanced unit. GOODS_SOURCES = STORE_DEPOSIT/REMITTANCE/TRANSFER → BARANG, else PEMBIAYAAN. **No settle button** ("agreeing is a property somebody checks"); `INTERUNIT_SETTLE` declared, no writer.

### D-8 Advance & deductions (0133)
`supplier_advance(+application)` AV-, PO NOT NULL: Dr advance_purchase / Cr bank; apply Dr trade_payable / Cr advance_purchase on its own date. `supplier_invoice.withholding_code` ∈ PPH23_SERVICE/PPH23_RENT_EQUIPMENT/PPH23_ROYALTY/PPH42_RENT_PROPERTY ("a property of what was bought, lives on the bill"). `supplier_payment` + `withholding_minor`, `bank_charge_minor`, `withholding_key` ∈ pph23_payable/pph_final_payable: Dr bank_admin_fee / Cr money = total − withheld + charge / Cr withholding_key = withheld; payable debited gross.

### D-9 Vocabulary (0116, 0128, 0140, 0155)
`transaction_category` ~50 choosable + ~20 refusal-only: family, direction, semantic_key+qualifier, `source_document` ∈ 13 kinds, requires_party/reference/approval, domains, `bank_postable`, `refusal`. Notables: receivable_employee, receivable_store_head, financing_bank_loan, equity_* (refused from bank line), tax_*, transfer_* (interunit ones refused → INTERUNIT_SETTLE). `bank_rule(+proposal)` "A rule PROPOSES. It never posts." 0128 closed list of 31 source_kind. 0140 `purpose` so `(source_kind, source_id, purpose)` unique.

## 1B — finance-lab engine
Payment: `direction` OUT/IN, `counterparty` string, `source` CASH/PETTY_CASH/BANK{id} (one side only), `allocations[]` → `OPEN_ITEM` (PAYABLE/ACCRUAL/ADVANCE/INTERUNIT/RECEIVABLE) or `DIRECT_EXPENSE`; total derived. Statuses `REQUESTED→APPROVED→INSTRUCTED→SETTLED→RECONCILED` + FAILED (→INSTRUCTED|CANCELLED), CANCELLED; **only SETTLED posts, once**; APPROVED requires FINANCE_MANAGER. `outstanding()` vs `reserved()` two questions. Verbs PAY_PROCUREMENT · PAY_BILL · PAY_OE_REPLACEMENT · PAY_PAYROLL · RECEIVE_FUNDS · RECORD_EXPENSE · DEPOSIT_TAKINGS. Cross-unit refused. Rules: money_transfer (alt to/from over BANK/CASH/PETTY), takings_deposit (**Dr AFFILIATE_GOODS_PAYABLE / Cr CASH** — no in-transit; differs from D), interunit_funding (funding_type required), giro_issued/cleared, card_settlement (Dr BANK balancing + Dr CARD_FEE / Cr CARD_RECEIVABLE gross).

## 1C — prototype
F02 Pembayaran (Penerima, Rekening sumber, Metode → giro opens F05, Nominal = Σ alokasi, Alokasi kewajiban S03 "satu payment ID lintas menu", Tanggal rencana ≠ eksekusi, Referensi bank, Bukti bayar) · F03 Penerimaan (Pihak pengirim "belum dikenali masuk antrean alokasi, bukan pendapatan otomatis", Rekening tujuan, Sumber ∈ invoice/settlement/modal/lainnya) · F04 Transfer (asal ≠ tujuan; beda unit → Antarunit; Biaya transfer as own line; Penanggung jawab penerima) · F05 Giro (Pembayaran sumber, bank determines outstanding account, nomor unik per bank, tanggal terbit/jatuh tempo/cair-ditolak terpisah). S03 Alokasi; S04 Mutasi. Ladders: Pembayaran & penerimaan `Draf; disetujui; diproses; tereksekusi; gagal; dibalik` (six); Giro `Draf; diterbitkan; cair; ditolak; dibatalkan`. `sumberUang`: BCA→Mandiri & setoran toko → Kas & Bank; pencairan pinjaman & setoran modal → Pendanaan; payroll → Payroll; pengembalian uang muka → Tagihan. "Pembayarannya hanya satu. Di detail tagihan ia riwayat pelunasan; di Kas & Bank ia pelaksanaan dan pemeriksaan bank."

## 2. The union — 26 movements
| # | Movement | Modelled by | Document | Legs |
|---|---|---|---|---|
| 1 | Pay supplier bill | A D B C | supplier_payment / cash_document PAY | Dr trade_payable / Cr money |
| 2 | Pay expense/vendor bill | A D B C | same, kind=EXPENSE | Dr non_merchandise_payable / Cr money |
| 3 | Direct expense, no bill | D B C (not A: "a payment against no bill is a bank line") | cash_document + category | Dr category key / Cr money |
| 4 | Petty cash spend at store | D (A sqlite only) | store_expense | Dr category / Cr petty_cash |
| 5 | Petty cash replenishment | D | petty_cash_replenishment | Dr petty_cash[site] / Cr bank[dc] |
| 6 | Cashier float placement | D (A: nothing funds it) | cash_shift FLOAT | Dr cashier_float / Cr cash |
| 7 | Daily takings deposit | D B C (not A) | store_deposit | D: via cash_in_transit; B: Dr AFFILIATE_GOODS_PAYABLE / Cr CASH — **not the same entry** |
| 8 | Remittance order | D | remittance_order | none |
| 9 | Bank→bank transfer | D B C (A: inexpressible) | cash_document TRANSFER | Dr to / Cr from |
| 10 | Giro issue/clear/reject | D B C (A: word only, clears instantly) | giro | issue Cr giro_outstanding; clear Dr giro_outstanding / Cr bank; reject = REVERSAL |
| 11 | Acquirer settlement | D B C (A none) | acquirer_settlement | Dr bank net + Dr card_fee / Cr card_receivable gross |
| 12 | Voucher sale / redeem | redeem D; **sale nobody** | voucher_movement | redeem Dr voucher_liability / Cr revenue_cash |
| 13 | Employee advance | D partly, B, C | cash_document PAY category advance; no liquidation ladder | Dr advance / Cr money; B liquidate Dr expense / Cr advance |
| 14 | Staff loan | D category, C | receivable_employee / receivable_store_head | Dr employee_receivable / Cr money; recovery **nowhere** |
| 15 | Payroll payout | D B C (A: 13 routes, no journal) | payment_batch → cash_document PAY ×n, or payroll_payout_task | Dr payroll_payable / Cr bank or store_manager_receivable |
| 16 | Inter-unit | D B C | D: no document — poster legs | affiliate_payable/receivable pairs |
| 17 | Loan | D category, B, C | none | B: Dr INTEREST + BANK_LOAN / Cr BANK |
| 18 | Customer refund | **nobody posts** | sale_return_payment (no journal) | — |
| 19 | Tax payment | D B C | cash_document tax_* | Dr tax payable / Cr money; liability from withholding_minor |
| 20 | Inter-unit cash settlement | D refused on purpose | INTERUNIT_SETTLE no writer | — |
| 21 | Asset purchase | A D | bill line coded to the asset (0099: "the bill line IS the acquisition") | Dr asset code / Cr trade_payable |
| 22 | Supplier advance | D | supplier_advance | Dr advance_purchase / Cr bank; apply on own date |
| 23 | Capital / drawings | D declared+refused, C | — | — |
| 24 | Cash count / variance | A D | cash_count / cash_shift VARIANCE | vs cash_variance |
| 25 | Custodian handover | D | custodian_handover | same account both legs |
| 26 | Bank charge / interest | D | cash_document from bank line | Dr bank_admin_fee / Cr bank_giro |
**No document anywhere (10):** voucher issue (liability unrecorded); customer refund document; loan document/schedule; advance liquidation; staff-loan recovery; inter-unit cash settlement; cashier float return; capital/drawings; store money at all in A; payroll payout in A.

## 3. Structural comparison with a Payment-Entry-shaped design
| Element | A | D | B | C |
|---|---|---|---|---|
| payment_type | absent (Pay only) | `cash_document.kind` PAY/RECEIVE/TRANSFER **derived** | direction OUT/IN, no transfer | split across F02/F03/F04 |
| counterparty | absent on header | party_kind+ids+name; PLE party_type +ACQUIRER/CUSTOMER | string | Penerima / Pihak pengirim |
| paid_from/paid_to | one side | **both**, meaning+qualifier OR code, each with site | one side | asal/tujuan |
| references[] | bills only, sum = header, DRAFT reserves | PLE settlement, any open item; **write path stub** | OPEN_ITEM or DIRECT_EXPENSE | S03 |
| unallocated → advance | illegal | permit_remainder + reason; supplier_advance | no | "sumber yang sah" |
| deductions[] | absent | closed: withholding_minor/key ∈2, bank_charge_minor | DIRECT_EXPENSE lines | Biaya transfer |
| instrument | method + text reference | method + giro_number/due on both docs + giro register | two rules | F05 |
| ladder | DRAFT→POSTED | DRAFT→APPROVED→POSTED→REVERSED | 6 + FAILED/CANCELLED | 6 |

**Verdict per movement: 15 of 26 are one Payment document; 11 are not.** The eleven: posts nothing (remittance, cash_movement, tender recon), posts twice on two dates (store deposit, giro, cash shift), different control (store expense ceiling + maker≠checker, custodian handover 2 signatures, acquirer settlement 4 states + 13 books, cash count, voucher).

## 4. Verdict
### 4a. Does D already implement a PE-shaped model? Yes in design (better than ERPNext in 3 places: kind derived not chosen; control account stored as unresolved triple making the GL-vs-subledger equation checkable; immutable destination snapshot), no in wiring (allocation write path stub; execution bridge raw SQL; two payment documents with two allocation models).
### 4b. Ladders: B and C converge on six rungs; the two over D's four are INSTRUCTED and FAILED — on D they exist only inside payment_batch_item (a single payment cannot fail). D gains RECONCILED free from bank_line_match. Everyone keeps reversal-as-mirror; D strictest (REVERSED → anything refused: "the second reversal would balance perfectly while doubling the money").
### 4c. (a) widen supplier_payment: cheap, but number carries no direction (KK/KM/TF), 0084's four triggers assume allocations = header, one-sided FK → wide half-null row; nothing gained for the 11. (b) merge D: everything above; cost 116 commits/48 migrations, 0106 + sqlite 0020 collisions, two payment docs, two stubs, no INSTRUCTED/FAILED on single payment, flagged duplications (counted_cash vs declared_cash; float_back no writer; reconciled_through believed not checked). (c) per-movement docs: refusals name where to go; but money position = union of nine tables (`store_cash_position` exists for that reason) and 11 numbering prefixes.

**Two-tier shape the four bodies imply:** Tier 1 = one Payment document (cash_document absorbs supplier_payment; kind derived, both sides first-class, number carries direction) with B/C's six-rung ladder (INSTRUCTED/FAILED promoted off batch item; RECONCILED read from bank_line_match). Tier 2 = own documents for the 11, all already written on D. **Seam = the Payment Ledger**, whose inclusion rule ("Money moving is NOT sufficient reason") is the test for which tier a movement belongs to.

## Five things to carry forward
1. D is a PE-shaped design, better than ERPNext in three places. 2. Two edits turn the lane on (allocation write path; execution via cash_* fns). 3. D carries two payment documents with two allocation models — that is the real merge decision. 4. B and C converged on six rungs; D lacks INSTRUCTED/FAILED for single payments. 5. Ten movements have no document; two are money leaks (gift cards sold = unrecorded liability; float return declared, no writer).
