# Retail POS finance for a multi-store, no-credit retailer: what replaces a credit-invoicing "Penjualan" menu

Research date: 28 Oct 2026. Products covered: ERPNext (v15/v16), Odoo 18, Dynamics 365 Commerce, LS Central 29.0, Oracle Retail Sales Audit / Xstore, NetSuite SCIS, SAP (POS DM / Customer Checkout + B1), Shopify POS, Lightspeed X-Series. Pre-2025 information is dated inline. "(search summary)" means the claim comes from a search-result digest of that URL, not from a full-page fetch.

---

## 1. Daily sales audit and reconciliation (till vs system): what exists and where it sits

### Takeaway
Every product has a per-shift or per-store-day "close and reconcile" record. It compares expected takings per payment method with counted or declared amounts, applies a tolerance, and posts a summary to the ledger. The records are ERPNext POS Closing Entry, Odoo session closing, D365 statements, LS Central statements, Oracle Sales Audit store/day, NetSuite SCIS End of Day, Shopify cash-tracking sessions and Lightspeed register closures. Retail-specialist suites keep this record in the store/retail back office, not in Finance.

### Cited Findings

#### ERPNext (Frappe)
- Each POS sale first creates a POS Invoice that works as a "sub-ledger". Sales "do not affect the stock and accounting ledgers until a Closing POS Voucher is submitted for that session". Closing produces "a single sales invoice which merges all the intermediate invoices created throughout the day", which "only creates 3-4 ledger entries". The page was updated 2026-02-26 and describes the v13 POS refactor. — [ERPNext docs: POS Invoice Consolidation](https://docs.frappe.io/erpnext/pos-invoice-consolidation)
- The Closing Entry links to its Opening Entry to fetch the period's POS invoices. Submitting it creates sales invoices grouped by customer, merges returns into a credit note, and writes a POS Invoice Merge Log. (search summary; the fetched consolidation page does not itself state the grouping by customer.) — [ERPNext docs (md)](https://docs.frappe.io/erpnext/pos-invoice-consolidation.md); [Frappe forum, v13 POS announcement](https://discuss.frappe.io/t/feature-erpnext-v13-new-point-of-sale-beta-testing)
- The POS Closing Entry payment table has these columns per Mode of Payment: Opening Amount, Expected Amount, Closing Amount, Difference (DocType "POS Closing Entry Detail", module "Accounts"). — [ERPNext source, pos_closing_entry_detail.json](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/accounts/doctype/pos_closing_entry_detail/pos_closing_entry_detail.json)
- The Opening Entry "sets the session start and can capture opening cash if required". On Closing Entry: "Submit — stock and accounting postings occur" (page updated 2026-09-29). — [ERPNext docs: POS workflows](https://docs.frappe.io/erpnext/pos-workflows.md)
- ERPNext's own business-type guide describes the POS flow as POS Profile → POS Invoice → immediate payment → POS Closing. It is meant for stores "where the Customer receives goods and pays in the same interaction" and is "not designed for long fulfilment cycles, negotiated project billing, or complex credit control". The guide says to confirm who is responsible for cash differences. — [ERPNext docs: accounting workflows by business type](https://docs.frappe.io/erpnext/accounting-workflows-by-business-type)
- **2026 change:** in the `version-16` branch, POS Settings has a field "Invoice Type Created via POS Screen" with options Sales Invoice / POS Invoice and **default "Sales Invoice"**. Its description reads: "The system will create a Sales Invoice or a POS Invoice from the POS interface based on this setting." The file was modified 2026-03-16, module "Accounts". The `develop` branch also has "Create Ledger Entries for Change Amount". — [ERPNext source v16, pos_settings.json](https://raw.githubusercontent.com/frappe/erpnext/version-16/erpnext/accounts/doctype/pos_settings/pos_settings.json); [develop](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/accounts/doctype/pos_settings/pos_settings.json)
- The `version-15` POS Settings has no invoice-type field. It has only two table fields and was last modified 2021-04-19. — [ERPNext source v15, pos_settings.json](https://raw.githubusercontent.com/frappe/erpnext/version-15/erpnext/accounts/doctype/pos_settings/pos_settings.json)
- v16 is in point releases (e.g., v16.37.0). v16.34.2 includes a fix for multi-currency POS Sales Invoice records. (search summary) — [newreleases: v16.37.0](https://newreleases.io/project/github/frappe/erpnext/release/v16.37.0); [v16.34.2](https://newreleases.io/project/github/frappe/erpnext/release/v16.34.2)

#### Odoo 18
- Payment methods are set at Point of Sale > Configuration > Payment Methods: "Choose Cash to use this payment method for cash payments, or Bank to use it for card payments". A bank journal adds "Use a Payment Terminal", and "Identify Customer" limits the method to registered customers. — [Odoo 18 docs: payment methods](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html)
- The Odoo 18 source describes posting at session close. Journal help text: "Defines the journal where to book the accumulated payments (or individual payment if Identify Customer is true) after closing the session. For cash journal, we directly write to the default account in the journal via statement lines. For bank journal, we write to the outstanding account specified in this payment method." — [Odoo 18 source, pos_payment_method.py](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/models/pos_payment_method.py)
- Older Odoo docs (v12, c. 2018): at closing the user sees a summary per payment method, validates, and posts the closing entries. — [Odoo 12 docs](https://www.odoo.com/documentation/user/12.0/point_of_sale/overview/start.html)
- A third-party blog says an accepted cash difference is booked as a profit/loss entry. — [Deploymonkey](https://deploymonkey.com/blog/odoo-pos-closing-session-error-fix)

#### Dynamics 365 Commerce (docs dated Jan–Feb 2026)
- Statement posting "account[s] for the transactions that occur in the Store Commerce app". POS transactions are pulled to headquarters through the distribution schedule. Statements are created, calculated and posted, either manually or by batch. — [MS Learn: Retail statements](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)
- Calculation uses register tender declarations as the counted amount (or a manual count) and shows the difference per payment method. "The statement is posted only if this difference is less than the maximum posting difference that you define for the store." The statement method can be Total, Staff, POS terminal or Shift. Stores open past midnight can use "End of business day" and "Post as business day". Shifts must be closed before statements are created. — [MS Learn: Retail statements](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)
- Posting "creates sales orders and invoices for the sales in the statement". It "aggregates cash and carry sales onto one sales order, and invoices the default customer assigned to the store", with separate orders for identified customers. It "automatically creates payment journals for the payments in the statement, and updates the inventory". — [MS Learn: Retail statements](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)
- From version 10.0.11, store managers review, adjust and finalise shift financials in POS ("financial reconciliation in store"). This needs trickle-feed order creation ("Retail statements - Trickle feed") and "Enable financial reconciliation in store" in the POS functionality profile. Close shift checks computed vs declared amounts against the statement thresholds. — [MS Learn: Financial reconciliation in store](https://learn.microsoft.com/en-us/dynamics365/commerce/fin-recon) (search summary); [MS Learn: Cash management](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt)
- A store setting decides whether tender declarations are summed or only the last one is used. — [MS Learn: Store configurations for statements](https://learn.microsoft.com/en-us/dynamics365/commerce/tasks/store-configurations-retail-statements) (search summary)

#### LS Central 29.0 (2026, on Business Central)
- The Statement table holds unposted statements. One statement per store totals the Transaction Header amounts since the last calculation. Posting moves them "into the relevant applications, the general ledger, the inventory or the purchase and payables". It is "an essential part of the end-of-day procedure", and the counted amount is filled from the tender declaration. — [LS Central Help: Statement table](https://help.lscentral.lsretail.com/Content/Fields/T_99001487.htm)
- Statements are calculated and posted after POS sales, End-of-Day or Tender Declaration, and the Z-Report. "Auto. Calculate Statement" runs through a Scheduler job (codeunit 99001479), and parallel batch posting is available. — [LS Central Help: Calculating and Posting Statements](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Calculating-And-Posting-Statements.htm)
- In a vendor test, parallel posting cut the time to post 100 statements by 72% (search summary). — [LS Retail performance PDF](https://portal.lsretail.com/media/3eoa4c5o/ls-central-performance-improvements.pdf)
- During calculation, LS Central can compare the highest transaction number in the store database with each POS terminal and show which terminals are missing transactions (search summary). — [LS Central Help: check transactions on POS in statement calculation](https://help.lscentral.lsretail.com/Content/LS-Retail/POS/How-To/How-To-Check-Transactions-On-POS-In-Statement-Calculation.htm)

#### Oracle Retail Sales Audit (ReSA) / Xstore
- Sales Audit validates "the totals from POS and OMS against the calculated totals of transactions" and reports the variance "as an over or short value". It balances cashiers, registers or a whole store day. It imports RTLogs with duplicate filtering, applies user-defined totals and audit rules, and generates errors that are fixed or overridden in interactive audit. When all errors are cleared, the store/day becomes "Audited" and is exported to Merchandising, Retail Insights, SIM, "General Ledger applications" and "other financial systems". (v19.3; older doc set) — [Oracle: Sales Audit overview 19.3](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/19.3/rsaat/sales-audit-overview.htm)
- Each total's definition says which systems it is exported to. "Sales totals are not typically interfaced to external systems, like the General Ledger, from Sales Audit", because Merchandising posts sales with cost of sales; tender totals go to the GL (search summary). — [Oracle: Configuring totals and audit rules (latest)](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/latest/rsaim/configuring-totals-and-audit-rules.htm)
- The unit of work is either a transaction (exported once error-free) or a store day (exported only when the whole day is clean). Corrections after export are re-sent by "full disclosure", which backs out the old values first (search summary). — [Oracle ReSA implementation guide 16.0](https://docs.oracle.com/cd/E79623_01/rms/pdf/160C/html/impl_guide/ReSA.htm); [Oracle RMFCS 24.0.101 Sales Audit](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/24.0.101.0/rmsoa/sales-audit.htm)
- Auditor screens include Store Day Summary (error list, over/short totals, missing transactions, import/export log) and General Ledger Transactions (search summary). — [Oracle ReSA auditing 19.3](https://docs.oracle.com/cd/E79792_01/resa/pdf/193000/html/user_guide/resa-auditing.htm)

#### NetSuite (SuiteCommerce InStore)
- The clerk enters an Initial Loan at shift start and an End of Day transaction at shift close, with bill counts by denomination; the count is reconciled against SCIS sales (search summary). — [NetSuite Help (mirror): SCIS cash drawer operations](https://oracle.hydrogen.sagittarius.connect.product.adaptavist.com/en/cloud/saas/netsuite/ns-online-help/section_1517855522.html); [Anchor Group guide](https://www.anchorgroup.tech/blog/scis-standard-cash-drawer-operations-suitecommerce-instore)
- An SCIS sale paid by one payment method becomes a Cash Sale; split-payment sales go to an Invoice. Both are listed at Transactions > Sales > Enter Cash Sales > List (search summary). — [NetSuite Help (mirror): Sales Transactions](https://oracle.hydrogen.sagittarius.connect.product.adaptavist.com/en/cloud/saas/netsuite/ns-online-help/section_4290511404.html)

#### SAP
- POS IDocs carry store data to PIPE (POS Data Management): WPUBON (receipts), WPUUMS (aggregated sales), WPUTAB (tenders), WPUFIB ("Transfer Financial Transactions to PIPE"), and others. Tender data cannot travel in WPUUMS; WPUTAB must be sent as well. — [SAP Help (CAR): POS IDocs](https://help.sap.com/saphelp_car200/helpdata/en/52/5fc4520c89a81ae10000000a44538d/content.htm); [SAP Help (CAR): WPUTAB](https://help.sap.com/saphelp_car200/helpdata/en/4c/6ac4520c89a81ae10000000a44538d/content.htm)
- Unofficial community answers: WPUUMS creates a billing document for aggregated sales plus a goods-movement material document (2015). WPUFIB carries financial transactions such as payment on account (2010). — [SAP Community 2015](https://answers.sap.com/questions/11560630/transaction-document-for-retail-idoc-type.html); [SAP archive 2010](https://archive.sap.com/discussions/thread/1678552)
- SAP Customer Checkout → Business One: receipts go through the B1if monitor and are then posted to B1 (2021 blog). Day-end closings are also sent to B1 (KBA 3087228 covers failed transmission). A receipt imported twice causes an overpayment in the cash-desk closing (KBA 2584350). — [SAP blog 2021](https://blogs.sap.com/2021/07/01/post-multiple-receipts-from-sap-b1if-monitor-to-sap-businessone/); [SAP KBA 3087228](https://userapps.support.sap.com/sap/support/knowledge/en/3087228); [SAP KBA 2584350](https://userapps.support.sap.com/sap/support/knowledge/en/2584350)

#### Shopify POS / Lightspeed X-Series
- Shopify's retail cash-tracking report shows expected vs counted cash (discrepancy summary), a cash-payments summary and a session list, with CSV export. — [Shopify changelog](https://changelog.shopify.com/posts/simplified-cash-reconciliation-for-retail-stores)
- The CashTrackingSession API (2026-10) has `totalDiscrepancy`, expected and counted balances, adjustments, and cash sales and refunds. — [Shopify dev: CashTrackingSession](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CashTrackingSession)
- Lightspeed X-Series sends an accounts-receivable invoice to Xero for each register closure. Payments can be posted to a clearing account. Where closure payments are part of a weekly deposit or card-processor settlement, "you'll need to match that payment to the invoice for all the applicable register closures" (search summary; direct fetch returned 403). — [Lightspeed: Register closure and reconciliation with Xero](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero)

### Inferences
- The shared pattern has five steps:
  1. Declare at the till or shift.
  2. Open a store-day (or shift) statement with expected vs counted amounts per payment method.
  3. Apply tolerance thresholds and assign accountability for differences.
  4. Post one summary to the GL and inventory.
  5. Keep an exception queue for problem transactions.

  This "statement / sales audit" record is what replaces a credit-invoicing "Penjualan" list.
- D365 and ERPNext still create an invoice document at posting: D365 to the store's default customer, ERPNext as a consolidated or paid Sales Invoice. It is system-made and paid at once. Users never manage it as a receivable.
- ERPNext v16 defaults POS output to a (paid) Sales Invoice. Even a general-purpose ERP now treats a POS sale as a paid sales document, not a credit sale waiting for collection.

### Gaps
- The D365 menu path for the Statements list was not retrieved; only the store and payment-method paths are confirmed (see section 2).
- Not verified: whether ERPNext v16 in "Sales Invoice" mode still consolidates at POS Closing or posts per sale.
- No official Odoo 18/19 page describing the closing journal entries was found. The Odoo findings rest on source-code help text and third-party pages.

---

## 2. Store cash: float/modal, cash count, petty cash, safe drop, bank deposit (setoran)

### Takeaway
Retail suites model store cash as a chain: till float → safe/store bank → bank deposit (in transit) → bank, with counted declarations at each hand-off. D365 and LS Central post safe and bank drops to separate GL or bank accounts. Xstore keeps the till float out of the deposit. NetSuite parks takings in "Undeposited Funds" until a deposit is recorded. Petty cash is barely documented in the retail POS modules.

### Cited Findings
- **D365, two modes:**
  - "One-sided" cash transactions reconcile store cash.
  - "Two-sided" transactions (cash traceability) make the receiving cashier reconcile each movement.
  - Safes are set up at Retail and Commerce > Channels > Stores > All stores > Set up > Safes.
  - Operations: Declare start amount, Tender removal, Float entry, Safe drop, Bank drop, Tender declaration, Blind close, Manage safe.
  - Safe management needs a dedicated register that is not used for sales. Money left in the safe is not carried to the next day; the start amount must be declared again.

  (page dated 2026-01-20) — [MS Learn: Cash management overview](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt)
- D365 GL effect: "The system supports posting the safe drops and bank drops into the appropriate general ledger (GL) accounts, as defined on the Tender page". "When the Bank drop operation is used to move money from the safe to the bank, the money is reduced from the safe drop GL and increased in the bank drop GL". "Float entry and Tender removal aren't recorded in any specific GL". All cash operations support foreign currency from 10.0.38. — [MS Learn: Cash management overview](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt)
- D365 payment-method posting is set per store at Retail and Commerce > Channels > Stores > All stores > Set up > Payment methods > Posting:
  - choose ledger account or bank account for receipts;
  - set a difference account, plus a "Maximum difference amount" above which differences go to a second account;
  - optionally post bank drops to a separate ledger or bank account with a bank transaction type;
  - optionally post safe drops to a separate account.

  (page dated 2026-02-11) — [MS Learn: Payment configurations for statements](https://learn.microsoft.com/en-us/dynamics365/commerce/tasks/payment-configurations-retail-statements)
- D365 posting parameters can merge all safe drops or bank drops into one journal line per statement (search summary). — [MS Learn: Commerce posting parameters](https://learn.microsoft.com/en-us/dynamics365/commerce/dev-itpro/commerce-posting-parameters)
- **LS Central Safe Management** (search summary):
  - At end of day, managers calculate and post statements, handle uncounted bags and start bank deposits.
  - Safe Statements reconcile the expected amount with the physical count.
  - Posting closes open bags and creates Safe Ledger Entries, which are the immutable audit trail.
  - At the POS tender declaration the cashier enters the fixed float and then a "Bank Amount"; the rest is posted uncounted.
  - Each tender type decides whether it goes to the bank or the safe; "Exclude Coins to Bank" is an option.
  - Safe Transfer documents move money between the safe and a bank or G/L account.

  Sources: [LS Central Help: Safe Management](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Safe-Management.htm); [Setting definitions for safe](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Setting-Definitions-For-Safe.htm); [Money from Bank or G/L Account](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Money-From-Bank-Or-G-L-Account.htm?TocPath=LS%C2%A0Central%7CBackOffice%7CStore+Management%7CSafe+Management%7CMoving+Money%7C_____3)
- In LS Central, after a statement is posted the store safe balance should equal the Fixed Float (example: 1500). — [LS Central Help: Calculating and Posting Statements](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Calculating-And-Posting-Statements.htm)
- LS Central tender types need a G/L or bank account before a statement can post, plus a G/L account for the difference between transaction and counted amounts. A separate "Bank Diff. G/L Acc." also exists (search summary). — [LS Central Help: Tender Type](https://help.lscentral.lsretail.com/content/Fields/T_99001462.htm); [Bank Diff. G/L Acc.](https://help.lscentral.lsretail.com/Content/Fields/T_99001462_1006.htm)
- **Oracle Xstore** (versions 18–24, search summary):
  - The store bank (safe) has audit-count, cash-deposit and bank-deposit functions; bank deposit takes money out of the store bank for the bank.
  - A mid-day deposit moves funds to the safe.
  - The till float is the cash counted and kept out of the bank deposit.
  - Store close requires the store bank to be counted and reconciled and safe bags to be declared.
  - Register close prompts for the deposit amount.

  Sources: [Xstore 19.0 store open/close](https://docs.oracle.com/cd/E62106_01/xpos/pdf/190/html/mobile_user_guide/store_open_close.htm); [Xstore 20.0 till management](https://docs.oracle.com/cd/E62106_01/xpos/pdf/200/html/mobile_user_guide/till_management.htm); [Xstore 24.0 register open and close](https://docs.oracle.com/en/industries/retail/retail-xstore-point-of-service/24.0/rpxmo/register-open-and-close.htm)
- **ERPNext:**
  - A Mode of Payment "identifies how money is received or paid, such as cash, bank transfer, card, or check".
  - Each Company has one default ledger per mode.
  - "Selecting a Mode of Payment does not by itself create a General Ledger entry."
  - For branch-specific retail payments, use separate POS Profiles with their own payment accounts.
  - "The label Cash does not make the linked ledger a cash account." A cash mode linked to a bank-type ledger shows up in Bank Reconciliation.

  (updated 2026-07-31) — [ERPNext docs: Mode of Payment](https://docs.frappe.io/erpnext/user/manual/en/mode-of-payment)
- **NetSuite:**
  - A Cash Sale stays undeposited until it is included in a Bank Deposit (Transactions > Bank > Make Deposits).
  - Recording the deposit moves the money from Undeposited Funds to the bank ledger.
  - Payments posted straight to a bank account need no deposit.

  Sources: [NetSuite Help: Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html); [NetSuite community](https://community.oracle.com/netsuite/english/discussion/4514592/nsc-understanding-cash-sale-status-and-ensuring-the-transaction-is-deposited)
- **SAP:** WPUFIB carries POS financial transactions; a secondary summary says this covers pay-in and pay-out. — [SAP Help (CAR)](https://help.sap.com/saphelp_car200/helpdata/en/52/5fc4520c89a81ae10000000a44538d/content.htm); [Scribd POSDM summary (secondary)](https://www.scribd.com/document/235343105/POSDM)
- **Lightspeed → Xero:** the error "Xero can't accept negative payments" happens when a closure's cash payments are smaller than its negative cash movements. Lightspeed's fix is to book that closure manually in Xero. — [Lightspeed support](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533976140315-Xero-Error-Register-Closure-Xero-can-t-accept-negative-payments)
- **Indonesian practice (vendor blogs and bank pages):**
  - The *laporan tutup kasir* reconciles drawer cash with sales at the end of a shift or day and is checked by a supervisor. — [HashMicro](https://www.hashmicro.com/id/blog/laporan-tutup-kasir/)
  - The bank *slip setoran* validates a cash deposit. — [Jurnal.id](https://www.jurnal.id/id/blog/prosedur-penerimaan-kas/)
  - Banks offer cash pick-up: [BCA Cash Pickup](https://www.bca.co.id/en/bisnis/solusi/cash-management/Collection/Cash-Pickup). CIMB Niaga's 2026 disclosure lists trip, processing and insurance fees. — [CIMB Niaga RIPLAY 2026](https://www.cimbniaga.co.id/content/dam/cimb/tb/2026/riplay/umum/RIPLAY%20Umum_Layanan%20Fund%20Administration%20Ver%202.0_Cash%20Pick%20Up.pdf)
  - Deposits made after the bank cut-off are booked the next working day, which creates "deposit in transit". — [HashMicro](https://www.hashmicro.com/id/blog/deposit-in-transit-adalah/)

### Inferences
- A no-credit retailer's cash area needs four stages with their own accounts or registers:
  1. Till float (*modal*), kept fixed rather than posted daily (LS Central's fixed-float model).
  2. Store safe (*brankas*).
  3. Deposit in transit (*setoran dalam perjalanan*, cash pick-up).
  4. Bank.

  Each hand-off carries a counted amount and a person (D365 "two-sided" traceability, LS Central safe ledger).
- Over/short should go to a difference account per store or payment method, with a threshold that escalates large differences (D365 "Maximum difference amount"). Who bears the difference (cashier vs company) is a policy field, which ERPNext's guide also flags.

### Gaps
- Petty cash (*kas kecil*) at stores is not documented in the retail POS modules retrieved. LS Central has an "Income/Expense Account" table, but its content was not fetched. D365 income/expense POS operations were not retrieved.
- No source covered Indonesian chains' internal SOPs (limits on cash held in-store, frequency of *setoran*, who signs).

---

## 3. Card/EDC and QRIS settlement: acquirer receivable, MDR, timing (product side)

### Takeaway
Most products put card and QR takings in a clearing ("outstanding", "undeposited", "intermediary") account until the acquirer's credit is matched in bank reconciliation: Odoo, NetSuite, Lightspeed/Xero, SAP B1, A2X. D365, LS Central and ERPNext also allow posting a tender straight to a bank account, which is the client's current choice. None of the docs retrieved models MDR natively at the POS; the fee shows up as the gap between gross takings and the net bank credit.

### Cited Findings
- **Odoo 18:**
  - For bank journals, closing writes to the payment method's Outstanding Account, "used as outstanding account when creating accounting payment records for bank payments".
  - The Intermediary Account "Overrides the company's receivable account (for Point of Sale) used in the journal entries".
  - "Identify Customer" splits entries per customer and "could slow down the closing process".
  - Integration options include "Terminal" and "Bank App (QR Code)".

  — [Odoo 18 source, pos_payment_method.py](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/models/pos_payment_method.py)
- Older Odoo (13/14): "only the cash payment method generate a cash register/bank statement"; non-cash methods created no payment journal entries. A community module added statements for non-cash methods (dated). — [OCA module pos_no_cash_bank_statement (v14)](https://pypi.org/project/odoo14-addon-pos-no-cash-bank-statement/14.0.1.0.3.dev2/)
- **NetSuite:** Undeposited Funds avoids a lag between book and bank, and "recording a deposit moves funds from Undeposited Funds to the bank account ledger" (search summary). — [NetSuite Help: Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)
- In Celigo's Shopify → NetSuite flow, charges and refunds must sit in Undeposited Funds so the payout flow can create the deposit. — [Celigo](https://docs.celigo.com/hc/en-us/articles/360051020692)
- **D365:** each store payment method posts to "a ledger account or bank account", with a difference account. — [MS Learn: Payment configurations](https://learn.microsoft.com/en-us/dynamics365/commerce/tasks/payment-configurations-retail-statements)
- **LS Central:** Tender Type Card Setup has an Account Type and Account No. per card type (inherited from the tender type, editable) and a "Difference G/L Acc." per card (search summary). — [LS Central Help: Account Type, Tender Type Card Setup](https://help.lscentral.lsretail.com/Content/Fields/T_99001464_19.htm); [Difference G/L Acc.](https://help.lscentral.lsretail.com/Content/Fields/T_99001464_22.htm)
- **ERPNext:** a Mode of Payment maps to one default cash or bank ledger per Company. — [ERPNext docs: Mode of Payment](https://docs.frappe.io/erpnext/user/manual/en/mode-of-payment)
- **Lightspeed → Xero:** the clearing account is normally a current asset with a code of 6 characters or fewer. Card-processor settlements must be matched to the closure invoices they cover. Lightspeed "cannot advise which accounts to map to" (search summary). — [Lightspeed support](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero)
- **A2X (Shopify):** payout amounts that don't match bank deposits are adjusted against the "Shopify Clearing Account". — [A2X support](https://support.a2xaccounting.com/en/articles/8897665-shopify-installment-payouts-in-january-2024)
- **SAP Business One:** cash, check and credit-card payments are posted to a clearing or temporary account (search summary of an SAP Learning course). — [SAP Learning](https://learning.sap.com/courses/utilizing-sap-business-one-web-client-accounting-es/handling-incoming-and-outgoing-payments)
- **Indonesian vendor guidance:** QRIS, e-wallet and EDC payments have different MDR cuts and settlement schedules, so the bank credit can differ from the sales value. — [Majoo](https://majoo.id/custom/erp-solution/rekonsiliasi-otomatis)

### Inferences
- Booking card and QRIS straight to the EDC bank is a supported option (D365, LS Central and ERPNext all allow a bank account per tender). It leaves two reconciling items on every day's bank line:
  - timing: H+1 calendar day, H+2 after the cut-off (section 10);
  - MDR: deducted or billed (unverified, section 10).

  A clearing account per acquirer bank ("EDC/QRIS dalam proses settlement") is what most products use to absorb both.
- If the client keeps direct-to-bank posting, the finance menu still needs a settlement-matching screen. Per EDC bank per day, it shows:
  - gross by card class (debit on-us, debit off-us, credit, QRIS ≤ Rp100k, QRIS > Rp100k);
  - expected MDR;
  - expected credit date;
  - actual credit and the difference.

### Gaps
- No product doc retrieved has built-in MDR computation per card class. MDR seems to be booked at bank reconciliation or by custom rules.
- Chargebacks and disputed card transactions were not researched.

---

## 4. Gift cards / vouchers and loyalty points as liabilities

### Takeaway
Under IFRS 15, which Indonesia applies as PSAK 115 (PSAK 72 renumbered from 1 Jan 2024), unredeemed gift cards and vouchers are contract liabilities. Loyalty points defer part of the revenue. Native retail tools differ: Shopify reports gift-card sales as liabilities, while ERPNext's loyalty program books an expense at redemption and does not mention a liability.

### Cited Findings
- PSAK 115 is the renumbered PSAK 72 under IAI's new classification from 1 Jan 2024, with unchanged substance. It is based on IFRS 15, and the five-step model creates contract assets and contract liabilities. — [Jurnalku (PSAK 115 study)](https://jurnalku.org/index.php/jolas/article/view/1655); [PNJ proceedings](https://prosiding.pnj.ac.id/index.php/SNAM/article/view/5685)
- Gift cards are customers' unexercised rights; the amount is a contract liability until redemption. Expected breakage is recognised in proportion to the pattern of rights exercised, not up front. Amounts owed to others (e.g., a government) are liabilities (B44–B47). — [IFRS Community: breakage](https://ifrscommunity.com/knowledge-base/revenue-from-customers-unexercised-rights-breakage/); [BDO: IFRS 15 vouchers](https://www.bdo.co.uk/en-gb/insights/business-edge/business-edge-2017/ifrs-15-in-the-spotlight); [CPDbox](https://www.cpdbox.com/ifrs-revenue-from-breakage/)
- Loyalty schemes (customer options) are likely to defer revenue until the extra goods or services are delivered (BDO, 2017). — [BDO](https://www.bdo.co.uk/en-gb/insights/business-edge/business-edge-2017/ifrs-15-in-the-spotlight)
- **ERPNext Loyalty Program** (updated 2026-07-25):
  - An "Expense Account" is "used for the loyalty benefit".
  - A conversion factor sets point value; expiry is in days.
  - Loyalty Point Entry is the points ledger.
  - The page mentions no liability or deferred-revenue entry for points earned.

  — [ERPNext docs: Loyalty Program](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program)
- **Shopify:** gift-card sales are excluded from sales reports and shown under Finances Summary > Liabilities > Gift card sales; the value counts as sales when redeemed. Outstanding balances sit in the Liabilities report. Community posts (2025) report that a redesign removed the liabilities section, which is unverified. — [Shopify community](https://community.shopify.com/t/whats-the-difference-between-gift-card-payments-and-sales-in-a-finance-summary-report/103087); [Shopify community: gift cards not in sales](https://community.shopify.com/t/why-arent-gift-card-sales-appearing-in-my-sales-reports/28298/2); [Shopify community: report redesign](https://community.shopify.com/t/shopify-has-changed-their-finance-summary-report-no-longer-a-report/414614)

### Inferences
- A no-credit retailer still has customer-side balances: vouchers or gift cards sold, store credit from returns, loyalty points. Any prefunded rupiah balance spent at the till is also a liability until redeemed; the client's employee "benefit balance" may qualify, depending on how it is funded. These belong in a "Customer & stored-value balances" area (liability roll-forward: issued, redeemed, expired/breakage, closing balance), not in a Sales menu.
- ERPNext's native loyalty (expense at redemption) is simpler than PSAK 115. A deferral would need a manual or custom journal.

### Gaps
- Native gift-card and voucher accounting in Odoo 18/19, D365 Commerce and LS Central was not retrieved. Only an Odoo third-party vendor page turned up, so it is excluded.
- No Indonesian guidance was found on breakage or on VAT for vouchers (PPN on *voucher* under PMK rules).

---

## 5. Returns and refunds

### Takeaway
In POS-centric products, returns run through the same till close as sales: netted in the store-day statement or consolidated into a credit note. They are not a separate finance menu. Cash refunds reduce expected drawer cash, and integrations can fail when refunds exceed cash sales.

### Cited Findings
- ERPNext merges POS returns into a credit note when the session's invoices are consolidated (search summary). — [ERPNext docs (md)](https://docs.frappe.io/erpnext/pos-invoice-consolidation.md)
- Shopify's CashTrackingSession tracks cash refunds alongside cash sales, expected and counted balances, and discrepancy. — [Shopify dev](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CashTrackingSession)
- Lightspeed → Xero rejects a register closure when its cash payments are smaller than its negative cash movements; the closure must be booked manually. — [Lightspeed support](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533976140315-Xero-Error-Register-Closure-Xero-can-t-accept-negative-payments)
- D365 statements include all transactions selected for the period; posting creates the orders, invoices and payment journals. — [MS Learn: Retail statements](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)

### Inferences
- In the finance menu, returns are a column and exception type in the daily store close (refund by tender, by cashier, approvals), not their own document list.
- Card and QRIS refunds need a link to the settlement view, because the acquirer nets or reverses them.

### Gaps
- Not found:
  - Indonesian EDC refund mechanics (void before settlement vs refund after settlement) and how acquirers net refunds;
  - QRIS refund rules;
  - D365 and LS Central return posting details.

---

## 6. Consignment / concession sales (konsinyasi, department-store counters)

### Takeaway
Consignment is central to Indonesian department stores: Matahari reported consignment as over 63% of gross sales (2017). A brand with counters inside department stores is the consignor. It holds stock at the store's location, receives sell-through reports, and has a real receivable from the department store net of commission. No product in scope documents a dedicated "outbound consignment receivable" menu.

### Cited Findings
- Matahari Department Store: consignment products remained the largest source of sales, over 63% of total gross sales (April 2017, older). — [Bareksa 2017](https://www.bareksa.com/berita/berita-ekonomi-terkini/2017-04-27/matahari-department-store-pertahankan-laba-di-tengah-turunnya-angka-penjualan/amp)
- Ramayana earns a sales commission per consignment item sold and holds goods entrusted by suppliers. Kontan says the consignment margin is lower than direct purchase. A 2018 report says RALS pushed consignment fashion because of higher margin; the two sources conflict. — [Kontan: Ramayana konsinyasi](https://industri.kontan.co.id/news/ramayana-melestarikan-konsinyasi); [Bisnis 2018](https://market.bisnis.com/read/20180721/192/819088/kuartal-ii20118-penjualan-rals-tumbuh-45)
- Concession model: the host "sells the goods for us and receives a commission", billed at the agreed payment interval from the sales data sent. — [beeline Group: concessions](https://edi.beeline-group.com/welcome/business/concessions)
- 1C ERP (not in scope, as a reference model): the consignee notifies the consignor of third-party sales and issues a commission invoice; the contract may offset commission against sales proceeds. — [1C ERP](https://content.1cerp.1ci.com/x/3DrJAg)
- Odoo: the community pattern is one stock location per consignment customer and invoicing what the customer reports as sold; no native invoice-on-sale report was found. A third-party module (Kaz Customer Consignment, Odoo 17–19) automates consignment locations and reporting. — [Odoo forum](https://www.odoo.com/forum/help-1/question/17843/); [Odoo Apps: kaz_customer_consignment](https://apps.odoo.com/apps/modules/18.0/kaz_customer_consignment)

### Inferences
- For a brand with department-store counters, consignment is the one place a trade receivable survives in a no-credit business. The flow:
  1. Transfer stock to a consignee location (the department store).
  2. Receive the periodic sales report (e.g., monthly).
  3. Invoice the department store: gross less commission, or gross with commission expense.
  4. Follow the receivable until the store pays on its cycle.

  This deserves its own "Konsinyasi" area, or a sub-area of "Other receivables", with stock-at-consignee reconciliation.
- If the client also takes supplier goods on consignment (inbound), the payable to the consignor arises only on sell-through. This sits in purchasing/payables, not sales.

### Gaps
- LS Central consignment or concession documentation was not found.
- Current (2025–2026) Indonesian department-store payment terms and commission rates for consignors were not found.

---

## 7. Marketplace payouts

### Takeaway
Marketplace takings are a receivable (seller balance) settled net of platform fees. ERP integrations treat them like card settlements: a clearing account per platform, matched per payout.

### Cited Findings
- Shopee deducts admin fees automatically when funds are released to the seller balance. Details are in Rincian Pesanan / Rincian Penghasilan (2025). — [BigSeller](https://www.bigseller.com/blog/articleDetails/3983/biaya-administrasi-penjual-shopee.htm)
- From 20 July 2025, Shopee charges a Rp1,250 order-processing fee per completed order. — [Katadata](https://katadata.co.id/amp/digital/e-commerce/685a7d4856939/daftar-biaya-dalam-transaksi-shopee-bagi-penjual-ataupun-pembeli/)
- Category-based admin percentages applied (e.g., 8% for category A, Dec 2024; may be outdated). — [IDX Channel](https://www.idxchannel.com/technology/admin-shopee-berapa-cek-besarannya-bagi-penjual/all)
- The payout pattern in integrations: A2X adjusts mismatched payouts against a platform clearing account, and Celigo requires Undeposited Funds so payouts create deposits. — [A2X](https://support.a2xaccounting.com/en/articles/8897665-shopify-installment-payouts-in-january-2024); [Celigo](https://docs.celigo.com/hc/en-us/articles/360051020692)
- Indonesian vendor guidance: reconcile delivery-platform income (GoFood/GrabFood) separately, because credits arrive net of commission (F&B, analogous). — [Jurnal.id](https://www.jurnal.id/id/blog/rekonsiliasi-kas-restoran/)

### Inferences
- Marketplaces fit next to card and QRIS under a "Settlements" heading: gross sales by platform, fees (commission, admin, processing), expected payout, actual withdrawal to bank.

### Gaps
- Not researched: Tokopedia/TikTok Shop, Lazada and Zalora payout timing and fee structures in 2026, and whether the client sells on marketplaces at all.

---

## 8. Receivables that remain without customer credit, and where ERPs put them

### Takeaway
Even with zero customer credit, a retailer still carries:
- card/QRIS acquirer receivables (in transit);
- marketplace balances;
- consignment receivables from department stores;
- employee advances;
- deposits and prepayments (rent, utilities, supplier down-payments).

ERPs put the first group in clearing accounts tied to payment methods or bank reconciliation, employee advances in HR/expenses, and the rest in GL "other receivables". None of them sits in a customer-invoicing Sales menu.

### Cited Findings
- Acquirer and in-transit receivables:
  - Odoo's POS "Intermediary Account" (receivable for POS) and bank "Outstanding Account". — [Odoo 18 source](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/models/pos_payment_method.py)
  - NetSuite's Undeposited Funds. — [NetSuite Help](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)
  - Lightspeed's clearing account (current asset). — [Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero)
  - SAP B1's clearing/temporary account for card payments. — [SAP Learning](https://learning.sap.com/courses/utilizing-sap-business-one-web-client-accounting-es/handling-incoming-and-outgoing-payments)
- D365 creates sales orders and invoices to the store's default customer and settles them with payment journals at statement posting. An AR document exists but is cleared at once. — [MS Learn: Retail statements](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)
- Employee advances (Frappe HR, updated 2026-02-04):
  - Under Human Resources > Expense Claims > Employee Advance.
  - The advance account comes from the Company's "Default Employee Advance Account".
  - "The GL entry is created only when the Payment Entry (or Journal Entry) is submitted against the advance."
  - Settlement is by Expense Claim or Return.

  — [Frappe HR: Employee Advance](https://docs.frappe.io/hr/employee-advance)
- Consignment receivable: see section 6 (Odoo community pattern and third-party module).
- Marketplace receivable: see section 7.

### Inferences
- For the client, these are "other receivables", not "customer receivables". A clean grouping:
  - in-transit and settlement accounts under Cash & Bank (card/QRIS, cash pick-up);
  - a small "Other receivables" register for consignment, marketplace, employee advances (*kasbon*), deposits (*sewa*, utilities) and supplier down-payments.

  Each needs ageing and a reconciliation owner.
- Mall rent deposits and rent paid in advance are typically large for Indonesian store chains. They belong under prepayments/deposits with amortisation, not receivables (inference; not researched).

### Gaps
- No vendor doc was retrieved for rent deposits or prepaid rent, nor for the Indonesian tax angles (PPh 4(2) on building rent withheld by tenants). Both are outside what was fetched.
- Supplier down-payments (*uang muka pembelian*) and bilyet giro handling were not researched here.

---

## 9. Does Finance keep a "Sales" area, or does sales posting move to Store/Retail + Cash management?

### Takeaway
Retail-specialist suites put sales capture, statements and sales audit in a Store/Retail back office: D365 Commerce headquarters, LS Central BackOffice > Store Management, Oracle Sales Audit inside Merchandising, SAP POS DM/PIPE. Finance receives summary postings and keeps cash/bank, payables and GL. General ERPs (ERPNext, NetSuite) keep POS documents inside Accounts or Sales transaction menus, but the documents are paid cash sales or auto-consolidated invoices, not credit invoicing.

### Cited Findings
- **D365:** statements, payment-method posting and safes are configured per store under Retail and Commerce > Channels > Stores > All stores in Commerce headquarters. — [MS Learn: Payment configurations](https://learn.microsoft.com/en-us/dynamics365/commerce/tasks/payment-configurations-retail-statements); [MS Learn: Cash management](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt)
- **LS Central:**
  - The help TOC files "Calculating and Posting Statements" under LS Central > BackOffice > Store Management. — [LS Central Help (TocPath)](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Calculating-And-Posting-Statements.htm?TocPath=LS%C2%A0Central%7CBackOffice%7CStore+Management%7C_____6)
  - Safe management sits under BackOffice > Store Management > Safe Management > Moving Money. — [LS Central Help (TocPath)](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Money-From-Bank-Or-G-L-Account.htm?TocPath=LS%C2%A0Central%7CBackOffice%7CStore+Management%7CSafe+Management%7CMoving+Money%7C_____3)
  - "Posting Exception" sits under LS Central > BackOffice > Sales. — [LS Central Help (TocPath)](https://help.lscentral.lsretail.com/Content/LS-Retail/Posting-Exception/Posting-Exception.htm?TocPath=LS%C2%A0Central%7CBackOffice%7CSales+)
- **Oracle:** Sales Audit is part of the Merchandising Foundation suite. It exports audited store/day totals to Merchandising and the GL; sales totals usually reach the GL via Merchandising, tender totals go directly. — [Oracle: Sales Audit overview](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/19.3/rsaat/sales-audit-overview.htm); [Oracle: totals config](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/latest/rsaim/configuring-totals-and-audit-rules.htm)
- **SAP:** POS data goes to PIPE (POS Data Management) by IDoc. Sales (WPUUMS), tenders (WPUTAB) and financial transactions (WPUFIB) are separate streams into retail and finance documents. — [SAP Help (CAR)](https://help.sap.com/saphelp_car200/helpdata/en/52/5fc4520c89a81ae10000000a44538d/content.htm)
- **Odoo:** Point of Sale is its own app, documented under the "sales" applications path (`/applications/sales/point_of_sale/`). Payment methods are configured in POS, and postings land in Accounting journals at session close. — [Odoo 18 docs](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html); [Odoo 18 source](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/models/pos_payment_method.py)
- **ERPNext:** POS Settings and POS Closing Entry Detail belong to the "Accounts" module, and v16 defaults POS output to a Sales Invoice. — [ERPNext v16 pos_settings.json](https://raw.githubusercontent.com/frappe/erpnext/version-16/erpnext/accounts/doctype/pos_settings/pos_settings.json); [pos_closing_entry_detail.json](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/accounts/doctype/pos_closing_entry_detail/pos_closing_entry_detail.json)
- **NetSuite:** POS sales are Cash Sales (Transactions > Sales > Enter Cash Sales), and deposits sit at Transactions > Bank > Make Deposits (search summary). — [NetSuite Help (mirror)](https://oracle.hydrogen.sagittarius.connect.product.adaptavist.com/en/cloud/saas/netsuite/ns-online-help/section_4290511404.html); [NetSuite Help: Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)
- **Lightspeed:** register closures are managed in the POS (Reporting > Register Closure) and pushed to Xero as one AR invoice per closure (search summary). — [Lightspeed: resend closure](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534276521115-How-to-resend-a-register-closure-to-Xero); [Lightspeed: Register closure and reconciliation](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero)

### Inferences
- The vendor consensus: a no-credit retailer's finance menu has no Sales (invoicing) area. It has the end of a store-takings pipeline: statements and sales audit posted from the store/retail side, then cash and bank, settlements, and other receivables.
- Where a "Sales" word survives (ERPNext Sales Invoice, D365 sales orders to the default customer, NetSuite Cash Sale), the document is system-generated and paid. Users review it in the daily close, not in a credit-invoicing list.

### Gaps
- No vendor states in prose "do not keep a Sales area in Finance"; this is inferred from menu and TOC placement.
- "Store accounting" as a D365 term was not found.
- The D365 menu location of the Statements list itself was not retrieved.

---

## 10. Indonesian specifics: QRIS MDR, EDC on-us/off-us settlement, daily deposit, store-takings reconciliation

### Takeaway
From **1 Oct 2026**, Bank Indonesia set QRIS MDR at **0% for transactions up to Rp100,000 for all merchants**; micro merchants stay at 0% up to Rp500,000. Above the thresholds, banks still charge 0.7% for small, medium and large merchants and 0.3% for micro. EDC card takings typically settle **H+1 calendar day** if the EDC is settled before the bank's cut-off (BCA: 22:00 WIB), otherwise H+2. Debit MDR is about 0.15% on-us and 1% off-us; credit cards run about 1.8–2% at the banks checked. Store-takings reconciliation in Indonesia matches three things per shift or day: physical cash, the POS report, and bank/EDC/QRIS credits.

### Cited Findings

#### QRIS MDR
- **BI News Release No. 28/159/DKom (17 Aug 2026):**
  - "expansion of its 0% QRIS Merchant Discount Rate (MDR) policy, effective from 1st October 2026"
  - "The 0% MDR will continue to apply to micro merchants for transactions up to Rp500,000"
  - The 0% rate "will also be expanded to all other merchants (small, medium and large) for transactions up to Rp100,000", "from the previous rate of 0.7%"

  — [Bank Indonesia News Release](https://www.bi.go.id/en/publikasi/ruang-media/news-release/Pages/sp_2815926.aspx)
- **BTN's merchant tariff from 1 Oct 2026:**
  - all categories 0% up to Rp100,000 per transaction;
  - UMI 0% up to Rp500,000, 0.3% above Rp500,000;
  - UKE/UME/UBE 0.7% above Rp100,000;
  - education 0.6%, SPBU 0.4%;
  - BLU/PSO/G2P/P2G 0%.

  (Kontan, 1 Oct 2026) — [Kontan](https://keuangan.kontan.co.id/news/kebijakan-mdr-qris-0-berlaku-mulai-1-oktober-2026-btn-sesuaikan-tarif-merchant)
- JawaPos (18 Aug 2026) reports the same policy announced by BI's Destry Damayanti. — [JawaPos](https://www.jawapos.com/ekonomi/2608170260/mulai-oktober-2026-bi-gratiskan-mdr-qris-untuk-semua-merchant)
- In mid-August 2026, DANA said it was waiting for implementing rules. — [Kontan](https://keuangan.kontan.co.id/news/ini-respons-dana-soal-perluasan-kebijakan-mdr-qris-0-mulai-oktober-2026)
- Previous step: from 1 Dec 2024, 0% QRIS MDR for micro merchants up to Rp500,000, up from Rp100,000 before. — [Bisnis.com, 16 Oct 2024](https://ekonomi.bisnis.com/read/20241016/9/1808129/mulai-1-desember-2024-transaksi-qris-maksimal-rp500000-bebas-biaya-di-pedagang-kecil)
- VAT (PPN) applies only to the provider's MDR service fee, so a 0% MDR carries Rp0 PPN. — [IKPI](https://ikpi.or.id/bi-transaksi-qris-hingga-rp500-ribu-di-merchant-usaha-mikro-tak-kena-ppn/)
- The same BI release launched the Indonesia Credit Card (issuers include BCA, Mandiri, BNI, BRI, CIMB Niaga, Permata, Mega, BSI), used through QRIS Scan or Tap. QRIS in H1 2026: 12.55 billion transactions, Rp1.12 quadrillion (+93.92% yoy), 44.86 million merchants. — [Bank Indonesia News Release](https://www.bi.go.id/en/publikasi/ruang-media/news-release/Pages/sp_2815926.aspx)

#### EDC settlement and card MDR
- **BCA:**
  - "Settlement adalah instruksi dari Merchant kepada BCA untuk mengkreditkan dana hasil transaksi" (covers debit, credit, QRIS, Flazz).
  - Payment is H+1 calendar day if settled before 22:00 WIB; settling after 22:00 means H+2.
  - If the merchant doesn't settle, the EDC can't be used the next day.
  - The EDC prints a settlement slip; Android EDCs show reports; proof can be emailed.

  (Aug 2024) — [BCA Edukatips](https://www.bca.co.id/id/informasi/edukatips/2024/08/07/07/58/apa-itu-settlement-pengertian-dan-cara-settlement-edc-bca-dengan-mudah)
- **Mandiri definitions and MDR:** On Us means a Mandiri card on a Mandiri EDC; Off Us means another bank's card on a Mandiri EDC.
  - regular debit: on-us 0.15%, off-us 1%;
  - education debit: 0.15% / 0.75%;
  - SPBU debit: 0.15% / 0.50%;
  - credit cards (Visa, Mastercard, JCB, UnionPay): 1.80% on-us and off-us;
  - QRIS regular: 0.70%.

  The page may predate 1 Oct 2026. — [Bank Mandiri EDC](https://www.bankmandiri.co.id/en/edc)
- BTN lists debit on-us 0.15% and credit 2.00%. — [BTN EDC](https://btn.co.id/en/business/jasa-layanan/e-channels/edc)
- BCA Prioritas offers special credit MDR "hingga 1,8%" when the settlement account is at BCA. — [BCA Prioritas](https://prioritas.bca.co.id/en/Privilege/BCA-Privilege/Merchant-BCA)
- BI's GPN debit caps (2017, older): on-us at most 0.15% (previously free), off-us at most 1% (previously about 2–3%). A 2019 source cites an off-us range of 0.50–1%. — [Kontan 2017](https://keuangan.kontan.co.id/news/tarif-edc-naik-jadi-015-ini-penjelasan-bca); [Bisnis 2017](https://finansial.bisnis.com/read/20171206/90/715703/transaksi-debit-interbank-berbayar-ini-alasan-bank-sentral); [Bisnis 2019](https://finansial.bisnis.com/read/20190710/90/1122455/implementasi-gpn-masih-sisahkan-banyak-pekerjaan-rumah)
- In Oct 2019 BI said "Saat ini BI tidak mengatur KK" (it does not regulate credit-card MDR; older). — [Bisnis 2019](https://finansial.bisnis.com/read/20191006/90/1155959/bi-gpn-masih-fokus-debit-dan-qr)
- MDR is charged to the merchant, not the consumer. — [Kontan](https://keuangan.kontan.co.id/news/beban-mdr-hanya-untuk-merchant)

#### QRIS settlement timing
- BRI settles QRIS on H+1 between 06:30 and 10:00 WIB, with a 23:30 WIB transaction cut-off. — [BRI developers: QRIS](https://developers.bri.co.id/en/product/qris)
- BCA multi-settlement pays out four times a day: static QRIS automatically, dynamic QRIS after the merchant settles on EDC/APOS, funds in about 1–2 hours (Jul 2024). A Sept 2024 BCA article says up to five times a day; the counts conflict. — [BCA, Jul 2024](https://www.bca.co.id/id/informasi/news-and-features/2024/07/23/09/45/bisnis-lebih-lancar-dengan-pencairan-dana-otomatis-multi-settlement); [BCA, Sep 2024](https://www.bca.co.id/en/informasi/edukatips/2024/09/12/03/46/kenali-fitur-multi-settlement-qris-di-edc-bca-dan-qris-statis)
- BI (Mar 2024, older): "Hampir 55% PJP bisa menyelesaikan settlement ... QRIS dalam H+0". — [Bisnis 2024](https://finansial.bisnis.com/read/20240320/90/1751162/ada-pedagang-masih-ogah-pakai-qris-bi-upayakan-percepatan-settlement)

#### How Indonesian retail finance reconciles store takings (vendor / academic sources)
- Reconciliation matches physical cash, the POS sales report and bank/EDC/QRIS credits, per shift rather than at month-end. Delivery-platform income is reconciled separately because it arrives net of commission. — [Mekari Jurnal](https://www.jurnal.id/id/blog/rekonsiliasi-kas-restoran/)
- A university community-service checklist for cashiers covers opening balance, sorting by denomination, and POS totals vs EDC/QRIS proofs. — [Unmas e-journal](https://e-journal.unmas.ac.id/index.php/seminarfeb/article/download/14212/10311)
- Bridging POS and EDC reduces mis-keyed amounts and eases daily reconciliation. — [HashMicro](https://www.hashmicro.com/id/blog/mesin-pos-dan-edc/)
- The QRIS merchant dashboard helps match payments to daily reports. — [Accurate](https://accurate.id/aplikasi-kasir/cara-menerima-pembayaran-qris/)
- The cashier's EOD (*tutup shift*) is the reconciliation step for sales. — [HashMicro EOD Kasir](https://www.hashmicro.com/id/blog/pengertian-eod-kasir/)
- Daily deposits and cash pick-up: see section 2 (BCA Cash Pickup, CIMB Niaga RIPLAY 2026, slip setoran, deposit in transit).

### Inferences
- A 13-store fashion chain is almost certainly not UMI, so from 1 Oct 2026 QRIS MDR is 0% on tickets ≤ Rp100,000 and 0.7% on larger ones. Expected MDR has to be computed per transaction, not as a flat % of daily QRIS totals. Most fashion tickets exceed Rp100k, so the saving is limited.
- Card takings from day D arrive on D+1 calendar day (D+2 if the EDC is settled late), and each EDC bank has its own on-us/off-us mix. A daily store close therefore never equals the same day's bank credit. Booking straight to bank needs either a clearing step or a settlement-matching report.
- Settling every EDC before the cut-off is a store-close checklist item, since a missed settlement delays funds and blocks the terminal the next day.

### Gaps
- Not found:
  - the PADG number implementing the Oct 2026 QRIS change;
  - the official UMI turnover threshold BI uses for QRIS (Mandiri's page, as returned, gives a garbled figure);
  - whether QRIS payments funded by the new Indonesia Credit Card follow QRIS MDR or card MDR.
- Not confirmed from primary sources: whether acquirers credit **net of MDR** or bill MDR separately (with PPN invoices), or whether this varies by bank.
- No current (2025–2026) BI rule on credit-card MDR caps was found; the 2017 GPN caps were not re-verified as current.
- No published SOP from a named Indonesian fashion chain was found. Practice sources are software vendors (Jurnal, Majoo, HashMicro, Accurate), so they have a promotional bias.

---

## 11. Synthesis for the objective: what replaces 7Soft "Penjualan", and how to group the finance menu

### Takeaway
For a POS-only, no-credit retailer, vendor practice replaces a credit-invoicing "Penjualan" menu with a **store-takings pipeline**: daily store close and statement (expected vs counted vs posted, by payment method), then **cash and safe**, **card/QRIS/marketplace settlements**, **customer stored-value liabilities** and **other receivables**. Payables, the giro register and GL stay as usual.

### Cited Findings
- **Store-day statement as the sales document:**
  - D365 statements post sales orders/invoices to a default store customer, payment journals and inventory, within a maximum posting difference. — [MS Learn](https://learn.microsoft.com/en-us/dynamics365/commerce/retail-statements)
  - LS Central statements post to GL, inventory and purchases/payables at end of day. — [LS Central Help](https://help.lscentral.lsretail.com/Content/Fields/T_99001487.htm)
  - Oracle Sales Audit exports an audited store/day to the GL. — [Oracle](https://docs.oracle.com/en/industries/retail/retail-merchandising-foundation-cloud/19.3/rsaat/sales-audit-overview.htm)
  - The ERPNext POS Closing Entry holds opening, expected, closing and difference amounts per mode of payment. — [ERPNext source](https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/accounts/doctype/pos_closing_entry_detail/pos_closing_entry_detail.json)
- **Cash chain with separate accounts:** D365 posts safe and bank drops to separate GL or bank accounts. — [MS Learn](https://learn.microsoft.com/en-us/dynamics365/commerce/cash-mgmt). LS Central keeps a safe ledger and bank deposits. — [LS Central Help](https://help.lscentral.lsretail.com/Content/LS-Retail/Safe-Management/Safe-Management.htm)
- **Clearing accounts for non-cash tenders:** see the Odoo outstanding/intermediary accounts [source](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/point_of_sale/models/pos_payment_method.py), NetSuite Undeposited Funds [docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html) and the Lightspeed clearing account [support](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero).
- **Indonesian settlement facts that drive a settlement view:** H+1/H+2 timing [BCA](https://www.bca.co.id/id/informasi/edukatips/2024/08/07/07/58/apa-itu-settlement-pengertian-dan-cara-settlement-edc-bca-dengan-mudah), on-us/off-us MDR [Mandiri](https://www.bankmandiri.co.id/en/edc), and QRIS tiers from 1 Oct 2026 [BI](https://www.bi.go.id/en/publikasi/ruang-media/news-release/Pages/sp_2815926.aspx).
- **Gift-card and loyalty liabilities under PSAK 115/IFRS 15:** [IFRS Community](https://ifrscommunity.com/knowledge-base/revenue-from-customers-unexercised-rights-breakage/); [Jurnalku](https://jurnalku.org/index.php/jolas/article/view/1655)

### Inferences
These are the researcher's proposal, built from the patterns above; they are not vendor text.

1. **Store takings** (replaces "Penjualan")
   - Daily close per store (statement): payment-method lines, expected vs counted vs posted, status (open → checked → posted), posting to GL and stock in one summary entry.
   - Over/short (*selisih kas*): threshold, accountability, approval.
   - Returns and refunds review, exceptions (missing till uploads, unposted transactions).
   - This mirrors D365 statements, LS Central statements and Oracle store/day audit.
2. **Cash & safe**
   - Store float (*modal*, fixed), safe (*brankas*), bank deposits (*setoran*) and cash pick-up in transit, petty cash (*kas kecil*).
   - BKK/BKM vouchers, keeping the client's 7Soft forms, are covered by another note.
3. **Settlements**
   - Card/EDC per acquirer bank: debit on-us, debit off-us, credit; expected MDR; expected vs actual credit date and amount.
   - QRIS per acquirer, with the ≤ Rp100k 0% tier.
   - Marketplaces, if any.
   - This keeps the client's direct-to-bank booking but adds the matching view. Alternatively, switch to a per-bank clearing account as Odoo, NetSuite and Lightspeed do.
4. **Customer balances (liabilities)**
   - Vouchers/gift cards, store credit, loyalty points, prefunded benefit balances: issued, redeemed, expired, outstanding.
5. **Other receivables**
   - Consignment (department-store counters; the only true trade receivable), marketplace balances, employee advances (*kasbon*), deposits and prepayments (*sewa*, utilities), supplier down-payments.
6. **Purchasing & payables** (unchanged)
   - Supplier invoices, payments by transfer, bilyet giro issued (giro register and clearing).
7. **Bank & GL**
   - Bank reconciliation, which matches settlement credits and deposits; journals, COA, period close, reports (daily sales by store and payment method, MDR cost, over/short trend).

Sales-side reports move to store takings and reporting: sales per store, per payment method, per cashier. There is no AR ageing for walk-in customers.

### Gaps
- What 7Soft's "Penjualan" menu contains item by item is outside this note.
- Not researched: Indonesian VAT for retail POS sales (*faktur pajak digunggung*, e-Faktur/Coretax treatment for end consumers) and bilyet giro handling in standard ERPs. Both affect the final menu.
- Not verified against official docs: menu grouping in Odoo 19 (released after Odoo 18) and the D365 Statements list path.
