# Finance Menu Lock — Neutral Jev Review

Status: **hybrid domain tree selected; supersedes the earlier compact 13-row proposal**

## Correction

The earlier Jev review was framed around a preselected compact 13-row menu. A new neutral review compared the user's comprehensive tree, the compact menu, and a hybrid alternative without assuming that fewer destinations were better.

Jev selected a **hybrid, two-level, role-filtered Finance tree**. The functions in the proposed comprehensive tree were not rejected. Most remain visible Finance domains; operational data entry stays with the domain that owns the underlying event.

## Target Finance tree

```text
FINANCE
├── Overview
│
├── Store                           [Finance monitoring and reconciliation]
│   ├── Sales
│   ├── Sales Reconciliation
│   ├── Expenses
│   ├── Cash
│   │   ├── Petty Cash
│   │   ├── Modal Kasir
│   │   └── Cash On Hand
│   ├── Cash Counts
│   ├── Transactions
│   └── Payment Requests / Status
│
├── Cash & Bank
│   ├── Cash
│   ├── Bank Accounts
│   ├── Bank Transactions
│   ├── Transfers
│   └── Bank Reconciliation
│
├── Expenses & Bills
│   ├── Expenses
│   ├── Bills
│   ├── Outstanding
│   ├── Due / Overdue
│   ├── Aging
│   ├── Expense Claims
│   ├── Recurring Bills
│   └── Suppliers / Vendors          [Procurement cross-link]
│
├── Payments
│   ├── Payment Requests
│   ├── Approvals
│   ├── Payment Runs
│   ├── Scheduled
│   ├── Processing
│   ├── Paid
│   ├── Failed / Returned
│   └── Payment Reconciliation
│
├── Receivables
│   ├── Outstanding
│   ├── Due / Overdue
│   ├── Aging
│   ├── Customer                     [filter]
│   ├── Acquirer / EDC / QRIS        [filter]
│   ├── Employee                     [filter]
│   ├── Affiliate                    [filter]
│   ├── Receipts / Collections       [workspace with named queues]
│   └── Reconciliation
│
├── Inventory                       [Finance accounting view]
│   ├── Overview
│   ├── Valuation
│   ├── BDP / In Transit              [only if retained by Inventory design]
│   └── Accounting Adjustments
│
├── Payroll                         [Finance control view]
│   ├── Overview
│   ├── Payroll Runs                 [HR cross-link]
│   ├── Payroll Payable              [shared filtered payable records]
│   └── Payment Status
│
├── Affiliation
│   ├── Overview
│   ├── Funding
│   ├── Goods / Other Balances
│   ├── Due From / Due To
│   └── Settlements
│
├── Assets                          [Finance asset accounting]
│   ├── Overview
│   ├── Register / GA Cross-link
│   ├── CIP / Projects
│   ├── Pre-opening
│   ├── Depreciation
│   └── OE Replacement
│
├── Tax
│   ├── Overview
│   ├── Position
│   ├── Payable / Receivable
│   ├── Payments                     [cross-link to Payments]
│   └── Reconciliation
│
├── Financing
│   ├── Overview
│   ├── Loans
│   ├── Interest
│   ├── Repayments                   [cross-link to Payments]
│   └── Equity / Owners
│
├── Accounting
│   ├── Journals
│   ├── General Ledger
│   ├── Trial Balance
│   ├── Chart of Accounts
│   ├── Adjustments
│   ├── Recurring Entries
│   ├── Prepaids & Accruals
│   │   ├── Prepaid Register
│   │   ├── Accrual Register
│   │   ├── Due Recognition
│   │   ├── Exceptions
│   │   └── Schedules / History
│   ├── Posting Rules               [restricted]
│   ├── Dimensions                  [restricted]
│   └── Period Close
│
└── Reports
    ├── Profit & Loss
    ├── Balance Sheet
    ├── Cash Flow
    ├── General Ledger              [cross-link to Accounting]
    ├── Trial Balance               [cross-link to Accounting]
    ├── AP Aging
    ├── AR Aging
    ├── Financial Reports
    └── Planning & Performance       [NEEDS_CONFIRMATION]
```

`Advances` is the one proposed top-level group that is not retained. Supplier/purchase advances use the payable register in Expenses & Bills; employee/management advances belong to People operationally and are exposed in Finance Receivables/Reports/Payments as appropriate.

`Payment Instructions` belongs primarily in Payments. Store may expose a contextual request/status link, but must not maintain a second full implementation.

`Suppliers / Vendors` remains owned by GA/Procurement. Expenses & Bills links to the same supplier record instead of maintaining a Finance-owned copy.

Supplier, Payroll, Tax, Affiliate and Financing use the same underlying payable records through contextual filters and cross-links, not separate implementations. Customer, Acquirer, Employee and Affiliate follow the same pattern in Receivables.

Collections is nested inside Receivables as a workspace with named receipt queues. Receivables owns outstanding, aging and allocation; the nested workspace executes and reconciles cash deposits, EDC/card, QRIS, bank receipts and unidentified receipts against the same records.

The `BDP / In Transit` child is conditional. The navigation review does not reverse a prior accounting decision to remove BDP; if that decision is final, this child must be removed or replaced with the applicable inventory reconciliation view.

## Ownership boundaries

| Finance destination | Primary operational owner | Finance responsibility |
|---|---|---|
| Store | Operations/Store | Monitoring, reconciliation, exceptions and accounting evidence |
| Cash & Bank | Finance/Treasury | Bank master context, transactions, transfers and bank reconciliation |
| Payments | Finance/Treasury | Controlled execution lifecycle and maker-checker |
| Expenses & Bills | Finance/AP with Store/GA/claimant as source owners | Source documents, claims, validation, outstanding, aging and settlement control |
| Receivables | Finance with source subledgers | Outstanding, aging, allocation/collection and settlement control |
| Accounting > Prepaids & Accruals | Finance/Accounting | Registers, recognition schedules, accrual review and exceptions |
| Inventory | Inventory | Finance valuation, HPP, BDP and controlled accounting adjustments |
| Payroll | HR/People | Finance payable, payment and reconciliation control |
| Affiliation | Finance/HO | Funding, goods/other distinction, due-from/due-to reconciliation and settlement |
| Assets | GA for physical custody | Finance capitalization, depreciation, CIP, amortization and disposal accounting |
| Tax | Finance/Tax | Position, obligations, payments and reconciliation |
| Financing | Finance | Loan/owner lifecycle, schedules, interest and repayment |
| Accounting | Finance/General Accounting | Journal, ledger, COA, rules, adjustments and close |
| Reports | Finance | Financial statements and aging |

## Jev decisions

Neutral first pass:

- Overall shape: `hybrid_tree` — probability 0.79.
- Store: retain a Finance monitoring/reconciliation workspace — probability 0.95.
- Cash & Bank: retain group — probability 0.98.
- Payables: the first pass retained a group — probability 0.98; the later detailed review folded its views into Expenses & Bills while retaining the same AP control records.
- Inventory: retain Finance accounting view — probability 0.79.
- Payroll: retain Finance control group — probability 0.96.
- Assets: retain Finance asset accounting group — probability 1.00.
- Tax: retain group — probability 0.98.
- Financing: retain group — probability 0.98.
- Accounting: retain parent group — probability 0.83.
- Reports: retain group — probability 0.91.
- Two-level navigation: probability 0.94.
- Role-filtered navigation: probability 1.00.

Targeted tie-break after providing the actual business lifecycle:

- Payments remains a separate group — probability 1.00.
- Receivables remains a separate group — probability 1.00.
- Prepaids & Accruals remains a separate group — probability 1.00.
- Affiliation remains a separate restricted group — probability 1.00.
- Advances is context-split rather than a persistent group — probability 0.96.

Detailed-menu consolidation review:

- Accept the detailed menu with consolidation — probability 1.00.
- Expenses & Bills source documents and payable controls remain distinct views over one workspace — later review probability 0.95.
- Receivables control stays distinct from Collections execution, while both may share one parent workspace — probability 1.00.
- Supplier/Vendor master stays in Procurement — probability 1.00.
- Payable and receivable types become filters/cross-links — probability 0.99–1.00.
- Collections uses named queues/tabs — probability 0.99.
- Store exposes Payment Request/status; Payment Instructions stay in Payments — probability 1.00.
- GL and Trial Balance have one implementation under Accounting; Reports links to them — probability 1.00.
- Accounting Dimensions stay in restricted Accounting setup — probability 0.93.
- Final detailed hybrid lock was preferred over compact 13 — probability 0.83 versus 0.01 for compact.

Accounting-placement review:

- Payments is a Treasury execution lifecycle, not General Accounting — probability 1.00.
- Payments remains top-level — probability 0.92.
- Moving Payments under Accounting would hide Treasury ownership and weaken segregation — probability 1.00.
- Receivables and Collections are distinct lifecycles — probability 1.00.
- In the final menu, Collections becomes named queues/tabs within Receivables; Jev approved this corrected placement with probability 1.00.
- Prepaids are accounting registers/schedules — probability 1.00.
- Accruals are accounting/close recognition workflows — probability 1.00.
- Prepaids & Accruals belongs under Accounting — probability 0.99.
- Period Close certifies and cross-links these schedules rather than owning duplicate records — probability 1.00.

Dimensions and Line Categories/Posting Rules must remain separate concepts. Their exact screen composition can be decided during interaction design without changing the menu ownership.

## Final residual review

After applying the source/control boundaries above, Jev found **no material duplicate** with probability 0.86. It also confirmed the following boundaries:

- Store Expenses versus Expenses & Bills: source entry versus AP control — probability 0.97.
- Store Cash versus Cash & Bank: physical cash custody versus Treasury control — probability 0.97.
- Inventory Adjustments versus Accounting Adjustments: operational quantity/value correction versus financial journal correction — probability 1.00.
- Payroll Payable reuses shared payable records through a filtered view; confidence was moderate at probability 0.69.
- Finance control and audit do not need another top-level group; Overview exception queues and Period Close certification/history are sufficient — probability 0.88.

The only unresolved candidate is `Planning & Performance`. Jev gave Budget/Planning a 0.40 probability of being a missing domain versus 0.36 for no missing domain, with low confidence 0.26 because no client budgeting workflow has been supplied. It therefore appears under Reports as `NEEDS_CONFIRMATION` and is not part of the locked implementation scope until the client confirms budgeting, forecasting, variance review and ownership.

## Comparison with ERPNext

ERPNext demonstrates that AP/AR, banking/payments, assets, taxes, loans, GL/reporting, dimensions and close are legitimate accounting domains. The target adopts that domain visibility and the use of contextual child views and permissions.

The target does not copy ERPNext's whole document model. Unit identity remains a dimension/site, operational processes keep their own owners, and bank accounts remain subledger records controlled by HO.

## Comparison with the current frontend

The current four Finance surfaces and standalone Assets/Vendors are not kept as parallel modules. Existing routes must be mapped into the target tree, with one source implementation for every job. Duplicate Assets, Payments, Bank Reconciliation, Period Close, categories and Chart of Accounts routes are consolidated.

Role filtering controls what users see; server authorization controls what they can do. A manager may see most groups, while Store, AP, Treasury, Tax and Accounting specialists see only their applicable destinations and actions.
