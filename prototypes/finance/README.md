# Itulah Finance prototype

Interactive React + TypeScript prototype, isolated from the existing production Finance implementation.

## Open

```sh
cd prototypes/finance
npm install
npm run dev -- --port 5401
```

Open http://localhost:5401. Build with `npm run build`; run the financial transition tests with `npm test`.

## Workspace

All 14 navigation groups and their pages are accessible. The initial workspace is Expenses & Bills → Bills. Use the search command (⌘K / Ctrl+K) to navigate pages, records, and saved views. Switch location or role from the workspace controls. Store roles are scoped to Store Senayan City; Finance roles can select any of 13 stores, HO, and DC.

Data and audit history persist in browser localStorage (`itulah-finance-v1`). All records are fictional. Nothing is transmitted to a bank. Attachment names are retained as metadata; document contents are not uploaded or persisted. CSV import reads actual local text into the prototype and rejects duplicate statement references.

## Demonstration paths

1. **Supplier payment:** Bills → New bill → enter description and accepted line quantities/prices/tax → Save draft → Submit → Approve → Direct pay → Create payment → Submit → Approve → Mark executed. Record the corresponding bank movement or import its CSV. Open Bank Reconciliation, select the payment, Find potential match, Confirm reconciliation. The original bill becomes Paid only after settlement. Partial payments leave an outstanding balance.
2. **Batch payments:** Select eligible Bills, Create payment run, include other open obligations, select account, Prepare run → Approve → Mark executed. Generated payments link to the same source records. A run itself never posts a journal.
3. **Physical cash:** Store → Sales → select a POS closing → Perform cash count → enter denomination counts. Supervisor confirm, Create variance adjustment, submit/approve/post the adjustment. Return to the sales batch and Reconcile cash sales.
4. **EDC settlement:** Receivables → Acquirer / EDC / QRIS → open an unallocated receivable (AR-0009 onward in fresh seed) → Record settlement + MDR. Record the receipt, create the incoming bank transaction, then reconcile. Net bank amount plus MDR clears gross AR. Existing AR-0001–0008 demonstrate already-recorded receipts in Related Transactions.
5. **Bank transfer:** Cash & Bank → Transfers → New transfer. Select BCA and Mandiri. No Party is required. Submit, approve, execute, and match the outgoing bank movement.
6. **HO to Store:** Transfer from BCA to a store cash account. Execution creates the Due From business state. Bank settlement and Confirm received are independent; receiving creates the store Due To and cash entry. Affiliate Balances → select the linked record → Reconcile affiliate requires both confirmations and equal counterparts.
7. **Payroll:** Payroll Runs → September payroll → Approve. Payroll Payable can be paid directly or included in a payment run. Payment Status is a filtered view of canonical payments, not a duplicate payment engine.
8. **Bank-first:** Bank Reconciliation → an unmatched bank line → Create payment/receipt from bank → choose an eligible obligation → Create & reconcile. The normal canonical movement and journals are generated.
9. **Trace:** Every transaction drawer has Summary, Source Documents, Related Transactions, Truth Trace, Accounting, and Audit Trail. All references use canonical IDs. Source invoice face value and accepted business value remain separate.
10. **Control:** Posted records offer Reverse, not destructive deletion. Unmatch before reversing a reconciled movement. Reversals require a reason and retain original journals. August 2026 is seeded as closed; posting into it is blocked. Period Close checks prerequisite records before allowing closure.

Additional interactive examples: asset capitalization/depreciation/disposal; monthly prepaid/deferred-revenue recognition; recurring draft generation and pause/resume; budget locking and revisions; multi-role parties; bank/cash account creation and deactivation; chart/dimension creation; search, filters, sorting, pagination, selection, saved views, CSV exports, print views, and comments/attachment audit events.

## Architecture

- `src/engine.ts`: canonical records, seeded entities, approval/settlement/reversal controls, accounting and audit transactions.
- `src/domains.ts`: asset, schedule, recurring, planning and affiliate actions.
- `src/navigation.ts`: requested menu hierarchy and view mapping.
- `src/main.tsx`: workspace, record forms, canonical filtered views, drawer, matcher and reports.
- `src/style.css`: responsive desktop-first interface.
- `src/engine.test.ts`: meaningful accounting/state-transition regression tests.

## Prototype scope

The end-to-end demonstration flows are interactive. Specialist views reuse the common transaction workspace rather than representing complete production subledgers. Financial reports summarize locally posted examples; they do not constitute statutory financial statements. Prior-period comparisons are explicitly unseeded. Asset depreciation assumes 60 months, recognition schedules 12 months, and loan schedules are illustrative. Cash forecasts are illustrative. Bank allocation supports balanced grouped matching and partial obligations through separate movement records; arbitrary FX and fee allocation engines are not implemented. Payment-run selection uses the remaining available amount per obligation. Roles are local UI perspectives, not server-side authentication. Account opening balances are fixtures; period-close checks demonstrate a subset of the full close policy. Source documents are metadata, not a document vault.

## Verification

Build and 12 automated financial workflow tests pass. Browser verification covered draft creation, submission, approval, direct payment, recorded bank movement, exact-match suggestion, reconciliation to Paid with zero outstanding, and persistence after reload. Desktop and narrower in-app layouts were visually inspected.
