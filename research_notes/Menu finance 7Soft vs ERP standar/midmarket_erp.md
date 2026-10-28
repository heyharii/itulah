# Finance menus of mid-market ERPs (ERPNext, Odoo, SAP Business One, Dynamics 365 Business Central, Oracle NetSuite) compared with 7Soft's business-cycle menu

## 1. What are the exact finance-related menus and submenus in each, verbatim?

### Takeaway
Every system splits finance partly by business cycle, but each does it differently.
- **ERPNext v15** has one top-level "Accounting" workspace with child workspaces "Receivables", "Payables" and "Financial Reports", plus a top-level "Assets" workspace.
- **ERPNext v16** (current, 16.52.1) replaces this with a desktop folder named "Accounting". It holds nine sidebars: Invoicing · Payments · Financial Reports · Accounts Setup · Taxes · Banking · Budget · Share Management · Subscription. A v16 patch deletes the Receivables and Payables workspaces.
- **Odoo**'s app menu is Dashboard · Customers · Vendors · Accounting · Reporting · Configuration. Version 19 adds a "Review" menu.
- **SAP Business One** uses business-cycle modules: Financials · Sales - A/R · Purchasing - A/P · Business Partners · Banking.
- **Business Central** groups lists by role. Business Manager uses Finance · Cash Management · Sales · Purchasing. Accountant uses Finance · Journals · Cash Management · Cost Accounting · Fixed Assets · Posted Documents.
- **NetSuite** gives each role a "center". The Classic Center has the tabs Activities · Transactions · Lists · Reports · Documents · Setup ….

### Cited Findings

#### Versions and how labels were obtained
- **ERPNext versions:** the current releases are v16.52.1 (published 2026-10-22) and v15.124.1 (2026-10-22). Labels below come from the workspace, sidebar and desktop-icon JSON files on the `version-15` and `version-16` branches. — [frappe/erpnext releases](https://github.com/frappe/erpnext/releases)
- **Odoo:** Community menus come from `addons/account/views/account_menuitem.xml` on branches 17.0, 18.0 and 19.0. A menu with no `name` takes its label from its action's name, which was resolved from the module's view files. Enterprise-only menus come from the `:menuselection:` paths in the official documentation sources (odoo/documentation, branches 18.0 and 19.0). — [odoo/odoo account views 18.0](https://github.com/odoo/odoo/tree/18.0/addons/account/views); [odoo/documentation 18.0 accounting](https://github.com/odoo/documentation/tree/18.0/content/applications/finance/accounting); [odoo/documentation 19.0 accounting](https://github.com/odoo/documentation/tree/19.0/content/applications/finance/accounting)
- **Business Central:** labels come from the AL source of the Role Center pages in the BC code-history mirror, branch `w1-29` (newest branch; mirror last pushed 2026-10-02). Branches w1-24 … w1-29 exist. — [StefanMaron/MSDyn365BC.Code.History](https://github.com/StefanMaron/MSDyn365BC.Code.History)
- **SAP B1:** the folder tree comes from a 2025 B1 SDK add-on library. Leaf labels come from SAP Learning, SAP Help (9.0/9.1 pages are marked as older) and the SAP Community. — [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **NetSuite:** labels come from the Oracle NetSuite online help, which carries no version number and was read in October 2026.

#### ERPNext v15: workspaces (module "Accounts" and "Assets")
Labels are verbatim. The `links` array lists the cards; the on-screen order is set by each workspace's content block.
- **`Accounting` (top-level):**
  - Shortcuts: "Learn Accounting", "Chart of Accounts", "Sales Invoice", "Purchase Invoice", "Journal Entry", "Payment Entry", "Accounts Receivable", "General Ledger", "Trial Balance", "Dashboard".
  - "Accounting Masters": Company · Chart of Accounts · Accounts Settings · Fiscal Year · Accounting Dimension · Finance Book · Accounting Period · Payment Term.
  - "Payments": Payment Entry · Journal Entry · Journal Entry Template · Terms and Conditions · Mode of Payment.
  - "Tax Masters": Sales Taxes and Charges Template · Purchase Taxes and Charges Template · Item Tax Template · Tax Category · Tax Rule · Tax Withholding Category · Lower Deduction Certificate.
  - "Cost Center and Budgeting": Chart of Cost Centers · Budget · Accounting Dimension · Cost Center Allocation · Budget Variance Report · Monthly Distribution.
  - "Opening and Closing": Opening Invoice Creation Tool · Chart of Accounts Importer · Period Closing Voucher.
  - "Banking": Bank · Bank Account · Bank Clearance · Bank Reconciliation Tool · Bank Reconciliation Statement · Plaid Settings.
  - "Multi Currency": Currency · Currency Exchange · Exchange Rate Revaluation.
  - "Subscription Management": Subscription Plan · Subscription · Subscription Settings.
  - "Share Management": Shareholder · Share Transfer · Share Ledger · Share Balance.
  - Source: [accounting.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/accounting/accounting.json)
- **`Receivables` (parent_page = Accounting):**
  - Shortcuts: POS Invoice · Cost Center · Sales Invoice · Journal Entry · Payment Entry · Accounts Receivable.
  - "Invoicing": Sales Invoice · Customer.
  - "Payments": Payment Entry · Payment Request · Payment Reconciliation · Payment Gateway Account.
  - "Dunning": Dunning · Dunning Type.
  - "Reports": Accounts Receivable · Accounts Receivable Summary · Sales Register · Item-wise Sales Register · Sales Order Analysis · Delivered Items To Be Billed.
  - Source: [receivables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json)
- **`Payables` (parent_page = Accounting):**
  - Shortcuts: Accounts Payable · Purchase Invoice · Journal Entry · Payment Entry.
  - "Invoicing": Purchase Invoice · Supplier.
  - "Payments": Payment Entry · Journal Entry · Payment Reconciliation.
  - "Reports": Accounts Payable · Accounts Payable Summary · Purchase Register · Item-wise Purchase Register · Purchase Order Analysis · Received Items To Be Billed · Supplier Ledger Summary.
  - Source: [payables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/payables/payables.json)
- **`Financial Reports` (parent_page = Accounting):**
  - "Profitability": Gross Profit · Profitability Analysis · Sales Invoice Trends · Purchase Invoice Trends.
  - "Financial Statements": Trial Balance · Profit and Loss Statement · Balance Sheet · Cash Flow · Consolidated Financial Statement.
  - "Ledgers": General Ledger · Customer Ledger Summary · Supplier Ledger Summary.
  - "Other Reports": Trial Balance for Party · Payment Period Based On Invoice Date · Sales Partners Commission · Customer Credit Balance · Sales Payment Summary · Address And Contacts · UAE VAT 201.
  - Source: [financial_reports.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/financial_reports/financial_reports.json)
- **`Assets` (top-level):**
  - Shortcuts: Asset · Asset Category · Fixed Asset Register · Dashboard.
  - "Assets": Asset · Location · Asset Category · Asset Movement.
  - "Maintenance": Asset Maintenance Team · Asset Maintenance · Asset Maintenance Log · Asset Value Adjustment · Asset Repair · Asset Capitalization.
  - "Reports": Asset Depreciation Ledger · Asset Depreciations and Balances · Asset Maintenance · Asset Activity.
  - Source: [assets.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/assets/workspace/assets/assets.json)
- **No Banking workspace in v15:** the Accounts module ships only the accounting, financial_reports, payables and receivables workspaces. Banking is a card inside "Accounting". — [v15 workspace folder](https://github.com/frappe/erpnext/tree/version-15/erpnext/accounts/workspace)

#### ERPNext v16: desktop folder plus sidebars
- **Desktop "Accounting" folder:** v16 adds Desktop Icons. A Folder icon "Accounting" contains, in idx order: Invoicing · Payments · Financial Reports · Accounts Setup · Taxes · Banking · Budget · Share Management · Subscription. Each one links to a "Workspace Sidebar". "Assets" is a separate icon under the parent "ERPNext". — [desktop_icon folder v16](https://github.com/frappe/erpnext/tree/version-16/erpnext/desktop_icon); [banking.json example](https://github.com/frappe/erpnext/blob/version-16/erpnext/desktop_icon/banking.json)
- **Sidebar "Invoicing":**
  - Top items: Home · Dashboard · Chart of Accounts.
  - Section "Receivables": Customer · Sales Invoice · Credit Note · Accounts Receivable.
  - Section "Payables": Supplier · Purchase Invoice · Debit Note · Accounts Payable.
  - Section "Payments": Payment Entry · Journal Entry · Payment Request · Payment Order · Payment Reconciliation · Unreconcile Payment · Process Payment Reconciliation · Repost Accounting Ledger · Repost Payment Ledger.
  - Section "Reports": General Ledger · Trial Balance · Financial Reports.
  - Last item: "Settings", which opens Accounts Settings.
  - Source: [workspace_sidebar/invoicing.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/invoicing.json)
- **Sidebar "Payments":**
  - Top item: Dashboard.
  - Section "Payments": the same nine items as in Invoicing.
  - Section "Reports": Accounts Receivable · Accounts Payable · General Ledger · Trial Balance · Financial Reports.
  - Source: [workspace_sidebar/payments.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/payments.json)
- **Sidebar "Financial Reports":**
  - "Financial Reports": Balance Sheet · Profit and Loss · Cash Flow · Trial Balance · Consolidated Report · Custom Financial Statement · Financial Report Template.
  - "Ledgers": General Ledger · Customer Ledger · Supplier Ledger.
  - "Registers": Accounts Receivable · Accounts Payable · AR Summary · AP Summary · Sales Register · Purchase Register · Item-wise sales Register · Item-wise Purchase Register.
  - "Profitability": Gross Profit · Profitability Analysis · Sales Invoice Trends · Purchase Invoice Trends.
  - "Other Reports": Trial Balance for Party · Payment Period Based On Invoice Date · Sales Partners Commission · Customer Credit Balance · Sales Payment Summary · Address And Contacts · UAE VAT 201.
  - Source: [workspace_sidebar/financial_reports.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/financial_reports.json)
- **Workspace "Accounting" (the v16 home page)** has these cards:
  - "Financial Statements": Profit and Loss · Balance Sheet · Cash Flow · Trial Balance · General Ledger · Consolidated Report · Custom Financial Statement · Consolidated Trial Balance · Financial Ratios.
  - "Receivables & Payables": Accounts Receivable · Accounts Receivable Summary · Accounts Payable · Accounts Payable Summary · Customer Ledger Summary · Supplier Ledger Summary · Trial Balance for Party · Customer Credit Balance · Payment Period Based On Invoice Date.
  - "Registers & Profitability": Sales Register · Purchase Register · Item-wise registers · Gross Profit · Profitability Analysis · Gross and Net Profit Report · Deferred Revenue and Expense · invoice trends · Sales Payment Summary.
  - "Tax & Compliance": TDS Computation Summary · Tax Withholding Details · UAE VAT 201 · VAT Audit Report · South Africa VAT Settings · IRS 1099 · Electronic Invoice Register.
  - "Invoicing & Payments": Payment Request · Payment Order · Dunning · Invoice Discounting · Subscription · Subscription Plan.
  - "Banking": Bank Reconciliation (old) · Bank Transaction · Bank Statement Import · Bank · Bank Account Type · Bank Account Subtype · Bank Guarantee · Plaid Settings · Bank Reconciliation Statement · Bank Clearance Summary.
  - "Reconciliation": Payment Reconciliation · Process Payment Reconciliation · Unreconcile Payment.
  - "Opening & Closing": COA Importer · Opening Invoice Tool · Accounting Period · FX Revaluation · Period Closing Voucher · Process Deferred Accounting.
  - "Ledger Tools": Repost Accounting Ledger · Repost Payment Ledger · Ledger Merge · Ledger Health Monitor · Process Statement Of Accounts.
  - "Share Management".
  - "Setup": Currency · Finance Book · Journal Entry Template · Tax Category · Tax Withholding Group · Deduction Certificate · Dunning Type · Cheque Print Template · Currency Exchange Settings · Subscription Settings.
  - Source: [accounting.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/workspace/accounting/accounting.json)
- **A second, newer "Sidebar" doctype for the Accounts module:** created 2026-08-16, modified 2026-10-04, titled "Accounts".
  - Top items: Home · Dashboard · Chart of Accounts · Sales Invoice · Purchase Invoice · Payment Entry · Journal Entry.
  - "Reports": General Ledger · Trial Balance · Trial Balance for Party · Profit and Loss · Balance Sheet · Cash Flow · Consolidated Report · Profitability Analysis · Accounts Receivable · Accounts Payable.
  - "Banking": "Banking" (URL `/banking`) · Bank Account · Bank Clearance.
  - "Taxes": Sales Tax Template · Purchase Tax Template · Item Tax Template · Tax Rule · Tax Withholding Category.
  - "Budgeting": Budget · Cost Center Allocation · Monthly Distribution · Budget Variance.
  - "Setup": Company · Fiscal Year · Chart of Cost Centers · Accounting Dimension · Account Category · Financial Report Template · Mode of Payment · Payment Terms Template · Currency Exchange · Settings.
  - Source: [accounts/sidebar/accounts/accounts.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/sidebar/accounts/accounts.json)
- **New React Banking app:** the v16 branch contains a separate React + Vite "banking" front-end at the repository root. The sidebar opens it at URL `/banking`. — [banking/ folder v16](https://github.com/frappe/erpnext/tree/version-16/banking)
- **Receivables and Payables removed:** patch `v16_0/remove_payables_receivables_workspace` runs `delete_doc_if_exists` on "Workspace Sidebar" and "Workspace" for "Receivables" and "Payables". — [patch](https://github.com/frappe/erpnext/blob/version-16/erpnext/patches/v16_0/remove_payables_receivables_workspace.py)
- **Sidebar "Assets":**
  - Top items: Home · Dashboard · Asset · Depreciation Schedule · Asset Capitalization · Asset Movement.
  - "Maintenance": Asset Maintenance Team · Asset Maintenance · Asset Maintenance Log · Asset Value Adjustment · Asset Repair.
  - "Reports": Fixed Asset Register · Asset Depreciation Ledger · Asset Depreciations and Balances · Asset Maintenance · Asset Activity.
  - "Setup": Item · Asset Category · Location.
  - Last item: Settings.
  - Source: [workspace_sidebar/assets.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/assets.json)

#### Odoo 17 / 18 / 19: Community menu tree (labels verbatim)
- **Root menu:** in Community the root `menu_finance` (sequence 55) is named "Invoicing" in all three versions. — [17.0 XML](https://github.com/odoo/odoo/blob/17.0/addons/account/views/account_menuitem.xml); [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml); [19.0 XML](https://github.com/odoo/odoo/blob/19.0/addons/account/views/account_menuitem.xml)
- **The docs use both roots:** they write Enterprise paths with the root "Accounting" (e.g. "Accounting ‣ Customers ‣ Invoices") and also use "Invoicing ‣ Customers ‣ Invoices". — [odoo/documentation 18.0](https://github.com/odoo/documentation/tree/18.0/content/applications/finance/accounting)
- **18.0 menu tree:**
  - "Dashboard".
  - "Customers": Invoices · Credit Notes · Receipts (only for the group `account.group_sale_receipts`) · Payments · Products · Customers.
  - "Vendors": Bills · Refunds · Receipts (group `account.group_purchase_receipts`) · Payments · Products · Vendors.
  - "Accounting": Journal Entries · Journal Items · Analytic Items.
  - "Reporting": "Statement Reports" · "Partner Reports" · "Management" (Invoice Analysis · Analytic Report).
  - "Configuration":
    - Settings.
    - "Invoicing": Payment Terms · Incoterms.
    - "Banks": Add a Bank Account · Reconciliation Models.
    - "Accounting": Chart of Accounts · Taxes · Journals · Reporting · Currencies · Fiscal Positions · Multi-Ledger · Tax Groups.
    - "Online Payments".
    - "Management": Product Categories · Cash Roundings.
    - "Analytic Accounting": Analytic Distribution Models · Analytic Accounts · Analytic Plans.
  - Labels that come from action names: action_move_out_invoice = "Invoices", action_move_out_refund_type = "Credit Notes", action_move_in_invoice = "Bills", action_move_in_refund_type = "Refunds", action_move_journal_line = "Journal Entries", action_account_moves_all = "Journal Items".
  - Sources: [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml); [18.0 account views (action names)](https://github.com/odoo/odoo/tree/18.0/addons/account/views)
- **17.0 differences from 18.0:**
  - "Accounting" has sub-folders "Journals" (Journal Entries · Journal Items), "Management" (Analytic Items), "Generate Entries" and "Actions".
  - "Vendors" also has "Bank Accounts".
  - "Reporting" has no "Partner Reports" folder in the Community XML; it has "Statement Reports" and "Management" (Invoice Analysis · "Analytic Reporting").
  - Source: [17.0 XML](https://github.com/odoo/odoo/blob/17.0/addons/account/views/account_menuitem.xml)
- **19.0 differences from 18.0:**
  - "Customers": Invoices · Credit Notes · Payments · Products · Customers (no Receipts).
  - "Vendors": Bills · Refunds · Payments · Products · Vendors.
  - "Accounting" now holds "Transactions" (Journal Entries · Analytic Items) and "Closing".
  - New top menu "Review", holding "Control" (Journal Items) and "Logs".
  - "Reporting" adds "Taxes & Fiscal".
  - "Configuration":
    - Settings.
    - "Accounting": Chart of Accounts · Taxes · Journals · Reporting · Currencies · Fiscal Positions · Multi-Ledger · Tax Groups · Cash Roundings.
    - "Invoicing": Payment Terms · Incoterms · Product Categories.
    - "Online Payments".
    - "Analytic Accounting".
    - The "Banks" folder is gone.
  - Sources: [19.0 XML](https://github.com/odoo/odoo/blob/19.0/addons/account/views/account_menuitem.xml); [19.0 account views](https://github.com/odoo/odoo/tree/19.0/addons/account/views)
- **Enterprise / Accounting-app paths documented for 18.0 (selection, verbatim):**
  - "Accounting ‣ Accounting ‣ …": Lock Dates · Reconcile · Assets · Loans · Analytic Budgets.
  - "Accounting ‣ Customers ‣ Direct Debit Mandates".
  - "Customers ‣ Batch Payments" and "Vendors ‣ Batch Payments".
  - "Accounting ‣ Reporting ‣ …": Aged Receivable · Aged Payable · Partner Ledger · Profit and Loss · Trial Balance · Tax Report · Tax Return · Deferred Revenue · Deferred Expense · Budget Report · Audit Trail · Loans Analysis.
  - "Accounting ‣ Configuration ‣ …": Follow-up Levels · Online Synchronization · Assets Models · Tax Units · Account Groups · Horizontal Groups.
  - "Accounting ‣ Configuration ‣ Settings ‣ …": Default Accounts · Fiscal Periods · Customer Payments.
  - Source: [odoo/documentation 18.0 accounting sources](https://github.com/odoo/documentation/tree/18.0/content/applications/finance/accounting); e.g. [batch.rst](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/batch.html), [year_end](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html)
- **Paths the 19.0 docs add:**
  - "Accounting ‣ Accounting ‣ Tax Returns".
  - "Accounting ‣ Review ‣ …": Annual Report · Audit Trail · Inventory Valuation · Journal Items · Loans Analysis · Unrealized Currencies · Deferred Revenues.
  - "Accounting ‣ Reporting ‣ General Ledger".
  - "Accounting ‣ Configuration ‣ Check".
  - Sources: [annual-report 19.0](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/annual-report.html); [tax_returns 19.0](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/tax_returns.html); [odoo/documentation 19.0](https://github.com/odoo/documentation/tree/19.0/content/applications/finance/accounting)

#### SAP Business One 10.0: main menu
- **Main-menu modules, in file order:** Administration · Financials · CRM · Opportunities · Sales - A/R · Purchasing - A/P · Business Partners · Banking · Inventory · Resources · Production · MRP · Service · Human Resources · Project Management · Reports. "Excel Report and Interactive Analysis" sits under Reports. — [SAPUtils MenuItem.cs (third-party B1 SDK library, last pushed 2025-09-14)](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **Folders (sub-menus); the source lists folders only, not leaf items:**
  - Financials: Internal Reconciliations · Budget Setup · Cost Accounting · Revaluation · Financial Reports. Financial Reports holds Electronic Reports · Accounting (Aging · Tax) · Financial · Comparison · Budget Reports.
  - Sales - A/R: Sales Reports (Electronic Reports).
  - Purchasing - A/P: Purchasing Reports (Electronic Reports).
  - Business Partners: Internal Reconciliations · Business Partner Reports (Electronic Reports · Aging · Internal Reconciliation).
  - Banking: Incoming Payments · Deposits · Outgoing Payments · Bill of Exchange · Bank Statements and External Reconciliations · Banking Reports (Electronic Reports · External Reconciliation · Bill of Exchange).
  - Administration: System Initialization (Authorizations · Opening Balances) · Setup (General · Financials · Business Partners · Banking) · Utilities · Approval Process.
  - Source: [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **Leaf items confirmed elsewhere:**
  - "Banking → Bank Statements and External Reconciliations → Reconciliation" and "… → Manual Reconciliation", plus the windows "Bank Statement Processing" and "Process External Bank Statement". — [SAP Learning: Exploring the Bank Account Reconciliation Options](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/exploring-the-bank-account-reconciliation-options-1)
  - "Banking" → "Bank Statements and External Reconciliations" → "Process External Bank Statement" (older page). — [SAP Help, B1 9.0](https://help.sap.com/saphelp_sbo900/helpdata/en/b5/d6e30623dc4fb6b3dfbebfbd435bd0/content.htm)
- **Other banking windows and paths:**
  - "Payment Wizard", "Payment Means window", "House Bank Accounts - Setup window" and "Payment Orders Report by Business Partner". — [SAP Learning: Handling Payments](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
  - "Banking > Outgoing Payments > Void Checks for Payment". — [SAP Community answer](https://answers.sap.com/questions/3535377/void-printed-check-issue.html)
  - Printable Banking documents: Incoming payments, Deposits, Outgoing payments, Checks for payments. — [SAP Press blog](https://blog.sap-press.com/how-to-print-documents-in-sap-business-one)
- **Recurring postings:** templates are defined in "the Recurring Postings window in the Financials module" (search snippet). — [SAP Learning: Posting Templates and Recurring Posting](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/utilizing-posting-templates-and-recurring-posting-1)

#### Dynamics 365 Business Central v29 (`w1-29`): Role Centers
AL captions contain "&" access-key markers, which are removed below.
- **Business Manager** (Caption 'Business Manager'):
  - Navigation bar: Customers · Vendors · Items · Bank Accounts · Chart of Accounts.
  - "Finance": General Journals · Chart of Accounts · G/L Account Categories · G/L Budgets · Fixed Assets · Financial Reporting · Sales Budgets · Purchase Budgets · Sales Analysis Reports · Purchase Analysis Reports · Inventory Analysis Reports · VAT Returns · Currencies · Employees · VAT Statements · Dimensions · Allocation Accounts · Posted General Journals.
  - "Cash Management": Cash Flow Forecasts · Chart of Cash Flow Accounts · Cash Flow Manual Revenues · Cash Flow Manual Expenses · Cash Receipt Journals · Payment Journals · Bank Accounts · Bank Acc. Statements · Payment Recon. Journals · Direct Debit Collections · Payment Terms · Bank Deposits · Bank Account Reconciliations.
  - "Sales": Customers · Items · Item Charges · Sales Quotes · Sales Orders · Blanket Sales Orders · Sales Invoices · Sales Credit Memos · Sales Return Orders · Reminders · Finance Charge Memos · Posted Sales Invoices · Posted Sales Credit Memos · Posted Sales Return Receipts · Posted Sales Shipments · Issued Reminders · Issued Finance Charge Memos.
  - "Purchasing": Vendors · Incoming Documents · Item Charges · Purchase Quotes · Purchase Orders · Blanket Purchase Orders · Purchase Invoices · Purchase Credit Memos · Purchase Return Orders · Posted Purchase Invoices · Posted Purchase Credit Memos · Posted Purchase Receipts · Posted Purchase Return Shipments.
  - Create actions: Sales Quote · Sales Order · Sales Invoice · Purchase Quote · Purchase Order · Purchase Invoice.
  - Action group "New": Customer · Vendor.
  - Action group "Payments": Reconcile Imported Payments · Import Bank Transactions... · Register Customer Payments · Create Vendor Payments.
  - "Reports → Financial Statements": Balance Sheet · Income Statement · Statement of Cash Flows · Statement of Retained Earnings · Sales Taxes Collected.
  - Source: [BusinessManagerRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al)
- **Accountant** (profile description "Functionality for finance staff performing any AR or AP work and managerial reporting."):
  - Navigation bar: Chart of Accounts · Bank Accounts · Customers · Vendors · Balance (twice, as filtered lists) · Purchase Orders · Incoming Documents · Purchase Invoices · EC Sales List · VAT Returns · Budgets · VAT Statements.
  - "Finance": General Journals · Recurring General Journals · Chart of Accounts · G/L Account Categories · Currencies · Employees · VAT Statements · Analysis Views · Financial Reporting · Deferrals · Dimensions · Partners · IC Chart of Accounts · Intercompany Dimensions · Accounting Periods · Number Series · Bank Account Posting Groups.
  - "Journals": General Journals · Recurring General Journals · Purchase Journals · Sales Journals · IC General Journals · Posted General Journals.
  - "Cash Management": Cash Receipt Journals · Payment Journals · Bank Accounts · Direct Debit Collections · Payment Recon. Journals · Bank Acc. Statements · Payment Terms · Bank Deposit · Cash Flow Forecasts · Chart of Cash Flow Accounts · Cash Flow Manual Revenues · Cash Flow Manual Expenses · Bank Account Reconciliations.
  - "Cost Accounting": Cost Types · Cost Centers · Cost Objects · Cost Allocations · Cost Budgets.
  - "Fixed Assets": Fixed Assets · Fixed Assets G/L Journals · Fixed Assets Journals · Fixed Assets Reclass. Journals · Insurance · Insurance Journals · Recurring Fixed Asset Journals.
  - "Posted Documents": Posted Sales Invoices · Posted Sales Credit Memos · Posted Purchase Invoices · Posted Purchase Credit Memos · Issued Reminders · Issued Fin. Charge Memos · G/L Registers · Posted Bank Deposits · Cost Accounting Registers · Cost Accounting Budget Registers.
  - Report group "G/L Reports": … Trial Balance by Period · Fiscal Year Balance · Balance Comp. - Prev. Year · Closing Trial Balance · Dimensions - Total.
  - Report group "Customers and Vendors": Aged Accounts Receivable (Obsolete) · Aged Accounts Payable (Obsolete) · Reconcile Cust. and Vend. Accs.
  - Other report groups: "Cash Flow", "VAT Reports", "Cost Accounting".
  - Action group "Payments": Cash Receipt Journal · Payment Journal.
  - Action group "Tasks": Calculate Depreciation · Import Consolidation from Database · Bank Account Reconciliation · Payment Reconciliation Journals · Adjust Exchange Rates · Post Inventory Cost to G/L · Calc. and Post VAT Settlement.
  - Action group "Create": Create Reminders · Create Finance Charge Memos.
  - Sources: [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al); [Accountant.Profile.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/Accountant.Profile.al)
- **Bookkeeper** (profile description "Functionality for finance staff handling day-to-day financials, such as creating invoices, paying bills, and balancing bank statements."):
  - Navigation bar: Chart of Accounts · Bank Accounts · Bank Deposit · Customers · Balance · Vendors · Balance · Payment on Hold · VAT Statements · Purchase Invoices · Purchase Orders · Sales Invoices · Sales Orders · Approvals · Cash Receipt Journals · Payment Journals · General Journals · Recurring General Journals.
  - "Posted Documents": Posted Sales Shipments · Posted Sales Invoices · Posted Return Receipts · Posted Sales Credit Memos · Posted Purchase Receipts · Posted Purchase Invoices · Posted Return Shipments · Posted Purchase Credit Memos · Issued Reminders · Issued Fi. Charge Memos · G/L Registers · Posted Bank Deposit List.
  - "Approvals": Requests Sent for Approval · Requests to Approve.
  - "Administration": Currencies · Accounting Periods · Number Series.
  - Sources: [BookkeeperRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BookkeeperRoleCenter.Page.al); [BookKeeper.Profile.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BookKeeper.Profile.al)

#### Oracle NetSuite: centers and menu paths
- **Centers:** "A center is assigned to each standard role" (search snippet), and "the Accounting Center's tabbed pages provide data and links that are relevant for Accountants, Bookkeepers, Payroll Managers, and Clerks". — [NetSuite Help: Centers](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_164208316196.html)
- **Classic Center tabs:** the Standard Classic Center (Administrator and Payroll Setup roles) shows Activities · Payments (Payroll Setup role only) · Transactions · Lists · Reports · Documents · Setup · Customization · Support · SuiteApps. — [Standard Classic Center](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1105102602.html)
- **Transactions paths in Oracle help:**
  - "Transactions > Bank > Make Deposits" and "… > List". — [Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)
  - "Transactions > Bank > Write Checks" (search snippet). — [Printing a Single Check](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1546118.html)
  - "Transactions > Financial > Make Journal Entries > Import" (search snippet). — [Single Journal Entry Import](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N433632.html)
  - "Transactions > Sales > Invoice Sales Orders (Administrator)" (search snippet). — [Invoicing Sales Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1219162.html)
- **Center-style paths in current help:**
  - "Go to _Customers > Accounts Receivable > Accept Customer Payments_". — [Applying a Payment on the Customer Payment Page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)
  - "Go to _Opportunities > Transactions > Cash Sales_". — [Entering a Cash Sale](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1244457.html)
- **Classic paths from third parties:**
  - "Transactions > Sales > Create Invoices". — [BlueSnap guide](https://support.bluesnap.com/docs/create-a-transaction-record)
  - "Transactions > Sales > Enter Cash Sales". — [Sovos docs](https://docs.sovos.com/indirect-tax/indirect-tax-products/tax-determination/netsuite-legacy-tax-connector-for-tax-determination/cash-sales-and-refunds/create-a-cash-sale)
  - "Transactions > Payables > Enter Bills" and Pay Bills. — [NetSuite user-group training, Session 5](https://netsuiteorg.atlassian.net/wiki/spaces/DOC/pages/58490916)
- **Reports:**
  - "Reports > Vendors/Payables > A/P Aging" (Oracle, search snippet). — [A/P Aging Summary Report](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1529519.html)
  - "Reports > Customer/Receivables > A/R Aging" (third-party). — [Kolleno](https://www.kolleno.com/?p=9446)
- **Setup:**
  - "Setup > Accounting > Manage GL > Manage Accounting Periods". — [Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
  - "Setup > Company > Enable Features" (Accounting subtab) (search snippet). — [Enable Accounting Basic Features](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1110092533.html)

### Inferences
Side-by-side map of the 7Soft menu onto each ERP. Each cell is drawn from the findings in this file. "(unverified)" marks a leaf seen only in older or third-party material, or not seen at all.

| 7Soft | ERPNext v16 (v15) | Odoo 18/19 | SAP B1 10.0 | BC v29 | NetSuite |
|---|---|---|---|---|---|
| Master › COA | Invoicing sidebar "Chart of Accounts" (v15 Accounting Masters) | Configuration › Accounting › Chart of Accounts | Financials › Chart of Accounts (unverified leaf) | Finance › Chart of Accounts; nav bar | Setup / Lists (unverified) |
| Master › Saldo Awal COA | Opening & Closing: Opening Invoice Tool, COA Importer; JE "Opening Entry" | Onboarding "Chart of Accounts and their opening balances" | Administration › System Initialization › Opening Balances | (gap) | (gap) |
| Master › Setting COA | Company › Accounts tab › Default Accounts; Mode of Payment › Accounts | Journals (bank/cash accounts, outstanding accounts); Settings › Default Accounts; Fiscal Positions | Administration › Setup › Financials › G/L Account Determination | Posting groups (Customer/Vendor/Bank Account/General Posting Setup …) | (gap) |
| Pembelian › Info (Supplier · Pembelian & Retur · Pelunasan · Summary · Kartu) | Invoicing › Payables + AP, AP Summary, Supplier Ledger (v15 Payables workspace) | Vendors menu + Partner Reports (Aged Payable, Partner Ledger) | Purchasing - A/P + Business Partners › BP Reports › Aging | Purchasing group; Vendors "Balance"; Aged Accounts Payable | Payables + Reports › Vendors/Payables |
| Penjualan › Info | Invoicing › Receivables + AR, AR Summary, Customer Ledger (v15 Receivables) | Customers menu + Partner Reports (Aged Receivable, Partner Ledger) | Sales - A/R + Business Partners | Sales group; Customers "Balance"; Aged Accounts Receivable | Sales; Customers › Accounts Receivable; Reports › Customer/Receivables |
| Penjualan Cash/POS | Selling › POS (POS Invoice → POS Closing Entry → consolidated Sales Invoice) | Point of Sale app; session closing posts journal entry | A/R Invoice + Payment (third-party source) | none in role centers | Cash Sale |
| Kas-Bank › BKM/BKK | Payments sidebar: Payment Entry (Receive/Pay), Journal Entry (Bank/Cash Entry) | Customers/Vendors › Payments; Accounting › Reconcile | Banking › Incoming Payments / Outgoing Payments | Cash Management › Cash Receipt Journals / Payment Journals | Accept Customer Payments / Pay Bills / Write Checks / Make Deposits |
| Kas-Bank › Pencairan BG | Bank Clearance (Cheque Number/Date, Clearance Date) | Batch Payments (deposit); outstanding accounts; Argentina deferred checks | Banking › Deposits (postdated checks) | no PDC object in W1 base app | Make Deposits (Undeposited Funds) |
| GL › Transaksi Jurnal | Journal Entry | Accounting › Journal Entries | Financials › Journal Entry (unverified leaf) | General Journals / Journals group | Transactions › Financial › Make Journal Entries |
| GL › Closing Periode | Period Closing Voucher; Accounting Period; Accounts Frozen Till Date | Accounting › Accounting › Lock Dates | Posting periods (lesson title only) | Accounting Periods; Allow Posting From/To | Manage Accounting Periods › Period Close Checklist |
| Analisa › Laporan Keuangan | Financial Reports sidebar | Reporting › Statement Reports | Financials › Financial Reports › Financial | Reports › Financial Statements | Reports › Financial (unverified) |

- **Two families of menu design:**
  - *Cycle-owned documents*: SAP B1 and BC Business Manager. Like 7Soft, each cycle menu owns its invoices and returns.
  - *Finance-owned documents*: ERPNext and Odoo. Customer and vendor invoices sit inside the accounting app, under menus split by party side.
- **ERPNext v16 regroups by function:** it moves away from v15's per-cycle workspaces (Receivables/Payables) toward function sidebars: Invoicing, Payments, Banking, Taxes and Setup. Receivables and Payables survive only as sections inside "Invoicing".
- **Closest analogue to 7Soft's separate "Kas-Bank" module:** BC's "Cash Management" group, which holds the receipt and payment journals that settle invoices. ERPNext v16's separate "Payments" and "Banking" sidebars are the next closest.

### Gaps
- **SAP B1 leaf labels are not verified.** No official 10.0 menu listing was found for leaves such as "Chart of Accounts", "Journal Entry", "Journal Vouchers", "Period-End Closing", "A/R Invoice", "A/R Credit Memo", "Check Register", "Checks for Payment" (as a menu leaf), "Postdated Check Deposit" or "G/L Account Determination" (as a window in Setup › Financials). The SAP Help Portal 10.0 pages are rendered by script and could not be read; SAPUtils lists folders only.
- **NetSuite Classic Center menus are incomplete.** The full list of Transactions categories could not be confirmed, in particular whether "Customers"/"Vendors" categories still exist or are now "Sales"/"Payables". The items under "Lists > Accounting" and the Accounting Center's tab names are also unconfirmed. Oracle's current help writes paths per center ("Customers > Accounts Receivable > …"), and the Classic Center page lists tabs only.
- **ERPNext v16: which sidebar a live site shows is unknown.** The repository has two sidebar systems: "Workspace Sidebar" files (created 2025-10/11) and the newer "Sidebar" doctype files (created 2026-08-16). Which one a live 16.52 site renders was not tested. The Workspace Sidebar JSON for Banking, Accounts Setup, Taxes, Budget, Share Management and Subscription was not found in the repository, although desktop icons point to them.
- **Odoo Enterprise menu tree is not public.** The enterprise source repository is private, so only documented paths are known.

## 2. Is AR/AP a menu of its own ("Receivables / Payables", "Customers / Vendors") or inside Sales/Purchasing ("Sales – A/R")? Who owns the invoice document?

### Takeaway
- **ERPNext and Odoo:** the accounting module owns the invoice, and AR/AP appear as finance menus. Odoo has "Customers"/"Vendors" menus inside the Invoicing/Accounting app.
- **ERPNext confirms the owner's point:** payables are not filed under Buying.
  - v15 has workspaces "Payables" and "Receivables" as child pages of "Accounting". Buying and Selling are separate top-level workspaces holding orders, items and pricing; they cross-list Purchase/Sales Invoice but carry no payment documents.
  - v16 deletes the Payables/Receivables workspaces. Their content becomes "Payables"/"Receivables" sections in the "Invoicing" sidebar, and payments move to a shared "Payments" sidebar. v16 Buying/Selling home pages also cross-list the AP/AR reports.
- **SAP B1:** the cycle modules "Sales - A/R" and "Purchasing - A/P" own the invoices. Payments sit in "Banking" and partner balances in "Business Partners".
- **BC Business Manager:** invoices sit in the "Sales"/"Purchasing" groups. The Accountant role center has no Sales or Purchasing group at all.
- **NetSuite:** invoices are under "Transactions > Sales" and bills under "Transactions > Payables". Customer payment receipt is under "Customers > Accounts Receivable".

### Cited Findings
- **ERPNext:**
  - The Sales Invoice doctype is defined in the Accounts module folder (`erpnext/accounts/doctype/sales_invoice`). Its fields include "Include Payment (POS)", "Is Return (Credit Note)" and "Update Stock". — [sales_invoice.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/sales_invoice/sales_invoice.json)
  - v15 "Receivables" is a child page of "Accounting" with the cards Invoicing (Sales Invoice · Customer), Payments, Dunning and Reports. — [receivables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json)
  - v16 Invoicing sidebar sections "Receivables" (Customer · Sales Invoice · Credit Note · Accounts Receivable) and "Payables" (Supplier · Purchase Invoice · Debit Note · Accounts Payable). — [invoicing.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/invoicing.json)
  - The v16 Selling module sidebar also lists Customer · Sales Invoice and the reports "Accounts Receivable" and "Accounts Receivable Summary". — [selling sidebar v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/selling/sidebar/selling/selling.json)
- **Odoo:**
  - "Customers" (Invoices · Credit Notes · Payments · Products · Customers) and "Vendors" (Bills · Refunds · Payments · Products · Vendors) are submenus of the `account` module's root menu "Invoicing". — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml)
  - The docs' customer invoice path is "Accounting ‣ Customers ‣ Invoices". — [odoo/documentation 18.0](https://github.com/odoo/documentation/tree/18.0/content/applications/finance/accounting)
- **SAP B1:**
  - The modules are "Sales - A/R" and "Purchasing - A/P", separate from "Business Partners" (Internal Reconciliations, Business Partner Reports › Aging) and "Banking" (Incoming Payments, Deposits, Outgoing Payments). — [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
  - A/R Invoice + Payment, A/R Reserve Invoice and A/R Invoice share object code 13; A/R Down Payment Invoice is 203 (search snippet). — [Packt via O'Reilly](https://www.oreilly.com/library/view/mastering-sql-queries/9781849682367/apas02.html)
- **BC:**
  - Business Manager's "Sales" group lists Sales Invoices · Sales Credit Memos · Posted Sales Invoices; "Purchasing" lists Purchase Invoices · Posted Purchase Invoices. — [BusinessManagerRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al)
  - The Accountant role center groups are Finance, Journals, Cash Management, Cost Accounting, Fixed Assets and Posted Documents. There is no Sales or Purchasing group; "Purchase Invoices" appears only on the navigation bar. — [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al)
  - The AR/AP control accounts live on "Customer Posting Group" ("Receivables Account") and "Vendor Posting Group" ("Payables Account"). — [CustomerPostingGroup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Sales/Customer/CustomerPostingGroup.Table.al); [VendorPostingGroup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Purchases/Vendor/VendorPostingGroup.Table.al)
- **NetSuite:**
  - "invoicing a sales order, or billing, converts an approved sales order into an invoice or cash sale" (search snippet). — [Invoicing Sales Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1219162.html)
  - Customer payments go through "Customers > Accounts Receivable > Accept Customer Payments". — [Customer Payment page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)
  - "Invoices are transactions with payment terms. They create a Receivable for future payment. Cash Sales assume the payment has already been made" (search snippet). — [NetSuite user-group training, Session 6](https://netsuiteorg.atlassian.net/wiki/spaces/DOC/pages/58490922)

#### ERPNext: Payables/Receivables versus Buying/Selling, side by side (v15 and v16, labels verbatim)
- **v15 names and nesting:** "Accounting" is top-level, with child pages "Payables", "Receivables" and "Financial Reports" (parent_page = Accounting). "Buying" (module Buying) and "Selling" (module Selling) are separate top-level workspaces. — [accounting.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/accounting/accounting.json); [payables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/payables/payables.json); [receivables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json); [buying.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/buying/workspace/buying/buying.json); [selling.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/selling/workspace/selling/selling.json)
- **v15 "Payables":**
  - Shortcuts: Accounts Payable · Purchase Invoice · Journal Entry · Payment Entry.
  - "Invoicing": Purchase Invoice · Supplier.
  - "Payments": Payment Entry · Journal Entry · Payment Reconciliation.
  - "Reports": Accounts Payable · Accounts Payable Summary · Purchase Register · Item-wise Purchase Register · Purchase Order Analysis · Received Items To Be Billed · Supplier Ledger Summary.
  - Source: [payables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/payables/payables.json)
- **v15 "Buying":**
  - Shortcuts: Item · Learn Procurement · Material Request · Purchase Order · Purchase Analytics · Purchase Order Analysis · Dashboard.
  - "Buying": Material Request · Purchase Order · Purchase Invoice · Request for Quotation · Supplier Quotation.
  - "Items & Pricing": Item · Item Price · Price List · Product Bundle · Item Group · Promotional Scheme · Pricing Rule.
  - "Settings": Buying Settings · Purchase Taxes and Charges Template · Terms and Conditions Template.
  - "Supplier": Supplier · Supplier Group · Contact · Address.
  - "Supplier Scorecard": four scorecard doctypes.
  - "Key Reports": Purchase Analytics · Purchase Order Analysis · Supplier-Wise Sales Analytics · Items to Order and Receive · Purchase Order Trends · Procurement Tracker.
  - "Other Reports": Items To Be Requested · Item-wise Purchase History · Purchase Receipt Trends · Purchase Invoice Trends · Subcontracted Raw Materials To Be Transferred · Subcontracted Item To Be Received · Supplier Quotation Comparison · Material Requests for which Supplier Quotations are not created · Supplier Addresses And Contacts.
  - "Regional": Import Supplier Invoice.
  - Has no Payment Entry and no Accounts Payable report.
  - Source: [buying.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/buying/workspace/buying/buying.json)
- **v15 "Receivables":**
  - Shortcuts: POS Invoice · Cost Center · Sales Invoice · Journal Entry · Payment Entry · Accounts Receivable.
  - "Invoicing": Sales Invoice · Customer.
  - "Payments": Payment Entry · Payment Request · Payment Reconciliation · Payment Gateway Account.
  - "Dunning": Dunning · Dunning Type.
  - "Reports": Accounts Receivable · Accounts Receivable Summary · Sales Register · Item-wise Sales Register · Sales Order Analysis · Delivered Items To Be Billed.
  - Source: [receivables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json)
- **v15 "Selling":**
  - Shortcuts: Learn Sales Management · Point of Sale · Item · Sales Order · Sales Analytics · Dashboard.
  - "Selling": Customer · Quotation · Sales Order · Sales Invoice · Blanket Order · Sales Partner · Sales Person.
  - "Items and Pricing": item and pricing doctypes plus Shipping Rule · Coupon Code.
  - "Settings": Selling Settings · Terms and Conditions Template · Sales Taxes and Charges Template · Lead Source · Customer Group · Contact · Address · Territory · Campaign.
  - "Point of Sale": Point-of-Sale Profile · POS Settings · POS Opening Entry · POS Closing Entry · Loyalty Program · Loyalty Point Entry.
  - "Key Reports": Sales Analytics · Sales Order Analysis · Sales Funnel · Sales Order Trends · Quotation Trends · Customer Acquisition and Loyalty · Inactive Customers · Sales Person-wise Transaction Summary · Item-wise Sales History.
  - "Other Reports": … Sales Invoice Trends · Customer Credit Balance · Customers Without Any Sales Transactions · Sales Partners Commission · target-variance reports.
  - Has no Payment Entry and no Accounts Receivable report.
  - Source: [selling.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/selling/workspace/selling/selling.json)
- **v16 Payables/Receivables:** the patch deletes the "Receivables" and "Payables" Workspace and Workspace Sidebar records. Their content lives in the "Invoicing" sidebar:
  - "Receivables": Customer · Sales Invoice · Credit Note · Accounts Receivable.
  - "Payables": Supplier · Purchase Invoice · Debit Note · Accounts Payable.
  - "Payments" (also a separate "Payments" sidebar): Payment Entry · Journal Entry · Payment Request · Payment Order · Payment Reconciliation ….
  - Sources: [patch](https://github.com/frappe/erpnext/blob/version-16/erpnext/patches/v16_0/remove_payables_receivables_workspace.py); [invoicing.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/invoicing.json)
- **v16 "Buying" workspace (home page):**
  - "Purchase Reports": Purchase Analytics · Purchase Order Analysis · Purchase Register · Item-wise Purchase Register · Item-wise Purchase History · Purchase Order Trends · Purchase Receipt Trends · Purchase Invoice Trends · Supplier Quotation Comparison · Procurement Tracker · Item Wise Consumption.
  - "Order Status Reports": Requested Items to Order and Receive · Items To Be Requested · Received Items To Be Billed · Billed Items To Be Received.
  - "Supplier Reports": Accounts Payable · Accounts Payable Summary · Supplier Ledger Summary · Supplier Addresses And Contacts.
  - "Subcontracting Reports".
  - "Setup": Tax Template · Terms Template · Pricing Rule · Blanket Order · Supplier Scorecard Criteria/Variable/Standing.
  - Source: [buying.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/buying/workspace/buying/buying.json)
- **v16 "Buying" sidebars:**
  - Workspace Sidebar: Home · Dashboard · Material Request · Request for Quotation · Supplier Quotation · Purchase Order · Purchase Invoice; "Setup" (Supplier · Supplier Group · Item · Price List · Address · Contacts · Supplier Scorecard …); "Reports" (Purchase Analytics … Supplier Addresses And Contacts, with no AP report); Settings. — [workspace_sidebar/buying.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/buying.json)
  - The newer module "Sidebar": Home · Dashboard · Supplier · Material Request · Request for Quotation · Supplier Quotation · Purchase Order · Purchase Receipt · Purchase Invoice; "Reports" (Purchase Analytics · Purchase Order Analysis · Purchase Register · Supplier Quotation Comparison · Accounts Payable · Accounts Payable Summary); "Items"; "Setup". — [buying/sidebar/buying/buying.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/buying/sidebar/buying/buying.json)
- **v16 "Selling" workspace (home page):**
  - "Sales Reports": Sales Analytics · Sales Register · Gross Profit · Item-wise Sales Register · Item-wise Sales History · Sales Order Analysis · Sales Order Trends · Quotation Trends · Sales Invoice Trends · Territory-wise Sales · Lost Quotations.
  - "Customer Reports": Accounts Receivable · Accounts Receivable Summary · Customer Credit Balance · Inactive Customers · Customers Without Any Sales Transactions · Customer Acquisition and Loyalty · Payment Terms Status for Sales Order · Customer-wise Item Price.
  - "Sales Team Reports".
  - "Pricing".
  - "Point of Sale": POS Opening Entry · POS Closing Entry · Loyalty Program · POS Settings.
  - "Setup".
  - Source: [selling.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/selling/workspace/selling/selling.json)
- **v16 "Selling" sidebar:** Home · Dashboard · Quotation · Sales Order · Sales Invoice; "POS" (POS · POS Profile · POS Invoice · POS Opening Entry · POS Closing Entry · POS Invoice Merge Log · POS Settings · Loyalty Program · Loyalty Point Entry); "Items & Pricing"; "Setup" (Customer · Customer Group · … · Tax Template …); "Reports" (Sales Register · Item-wise Sales Register · Sales Analytics … with no AR report); Settings. — [workspace_sidebar/selling.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/selling.json)
- **What sits where:**
  - *Accounting side only* (Accounting/Payables/Receivables in v15; Invoicing/Payments in v16): Payment Entry, Journal Entry, Payment Reconciliation, Payment Request, Dunning and Supplier/Customer Ledger. These never appear in Buying or Selling in either version.
  - *Both sides*: Purchase Invoice and Sales Invoice.
  - *AR/AP aging reports*: only on the accounting side in v15. v16 also cross-lists them in Buying "Supplier Reports", Selling "Customer Reports" and the newer Buying Sidebar "Reports".
  - Sources: the files above.

#### One line each for the other systems
- **Odoo:** "Customers" (Invoices · Credit Notes · Payments · Products · Customers) and "Vendors" (Bills · Refunds · Payments · Products · Vendors) are menus of the accounting app, whose root is "Invoicing" in Community. Invoices and payments sit together there. — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml)
- **SAP B1:** documents live in the cycle modules "Sales - A/R" and "Purchasing - A/P" (each with its own Reports folder). Payments are in "Banking" (Incoming Payments / Outgoing Payments), and AR/AP aging is in "Business Partners › Business Partner Reports › Aging". — [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **Business Central:** Business Manager's "Sales" and "Purchasing" groups hold the invoices (Sales Invoices / Purchase Invoices and their posted versions). Settlements sit in "Cash Management" (Cash Receipt Journals · Payment Journals), and there is no separate AR/AP menu. The Accountant role center has no Sales or Purchasing group. — [BusinessManagerRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al); [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al)
- **NetSuite:**
  - Invoices and cash sales are under "Transactions > Sales" (Create Invoices / Enter Cash Sales; third-party). — [BlueSnap](https://support.bluesnap.com/docs/create-a-transaction-record); [Sovos](https://docs.sovos.com/indirect-tax/indirect-tax-products/tax-determination/netsuite-legacy-tax-connector-for-tax-determination/cash-sales-and-refunds/create-a-cash-sale)
  - Bills are under "Transactions > Payables" (Enter Bills / Pay Bills). — [netsuiteorg training](https://netsuiteorg.atlassian.net/wiki/spaces/DOC/pages/58490916)
  - Customer receipts are at "Customers > Accounts Receivable > Accept Customer Payments" (Oracle, center-style path). — [Customer Payment page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)

### Inferences
- **ERPNext separates procurement from payables.** It is the only benchmark with menus literally named "Payables"/"Receivables" (v15 workspaces; v16 Invoicing sections), kept apart from Buying/Selling. Buying/Selling cover orders, items and pricing; Payables/Receivables cover invoice, party, payment and aging. 7Soft instead files Hutang/Piutang info inside Pembelian/Penjualan, which is closer to SAP B1 ("Sales - A/R", "Purchasing - A/P") and BC Business Manager (Sales/Purchasing groups).
- **v16 hedges both ways.** It keeps AR/AP in accounting ("Invoicing") but adds AP/AR reports to the Buying/Selling home pages.
- **7Soft is closest to SAP B1 and BC Business Manager.** In all three, Pembelian/Penjualan-style cycle menus contain the invoice and return documents.
- **7Soft's "Info Penjualan/Pembelian" tab set is closest to ERPNext v15's Receivables/Payables workspaces.** Those workspaces combine party, invoice, payment and AR/AP reports on one page.
- **The current direction is toward accounting-owned invoices.** ERPNext v16 cross-lists the Sales Invoice in both Selling and Accounting, and Odoo puts invoices in accounting even when they come from the Sales app.

### Gaps
- **NetSuite Classic labels:** the exact Classic "Transactions" category labels for invoices and payments in 2026 were not verified ("Sales" vs "Customers"; "Payables" vs "Vendors").
- **Odoo document ownership:** whether Odoo's Sales app has its own invoice menu was not checked, though this is outside the finance menu.

## 3. Where do customer and supplier "info" screens live (ledger card, statement, aging, summary)?

### Takeaway
None of the five has a single tabbed "Info" screen like 7Soft's. Each spreads the same views across reports:
- an aging report (AR/AP aging);
- a per-party ledger (the "card");
- a summary;
- in some systems, a statement tool.

ERPNext and Odoo put these views in finance report menus. SAP B1 puts them under "Business Partners" and "Financials › Financial Reports". BC exposes them as filtered Customer/Vendor lists plus aging reports. NetSuite puts them under "Reports > Customer/Receivables" and "Vendors/Payables".

### Cited Findings
- **ERPNext v16** has two places for these views:
  - The "Receivables & Payables" card: Accounts Receivable · Accounts Receivable Summary · Accounts Payable · Accounts Payable Summary · Customer Ledger Summary · Supplier Ledger Summary · Trial Balance for Party · Customer Credit Balance · Payment Period Based On Invoice Date.
  - The "Ledger Tools" card, which includes "Process Statement Of Accounts".
  - Source: [accounting.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/workspace/accounting/accounting.json)
- **ERPNext v16 Financial Reports sidebar** uses the short labels "Customer Ledger", "Supplier Ledger", "AR Summary" and "AP Summary". — [financial_reports.json sidebar](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/financial_reports.json)
- **ERPNext v15** keeps these reports per side:
  - Receivables › Reports: Accounts Receivable · Accounts Receivable Summary · Sales Register.
  - Payables › Reports: Accounts Payable · Accounts Payable Summary · Purchase Register · Supplier Ledger Summary.
  - Financial Reports › Ledgers: General Ledger · Customer Ledger Summary · Supplier Ledger Summary.
  - Sources: [receivables.json](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json); [payables.json](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/payables/payables.json); [financial_reports.json](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/financial_reports/financial_reports.json)
- **Odoo:**
  - Community 18.0/19.0 has a "Reporting › Partner Reports" folder. — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml)
  - The Enterprise docs fill it with "Accounting ‣ Reporting ‣ Partner Ledger", "… ‣ Aged Receivable" and "… ‣ Aged Payable". Follow-ups are configured at "Accounting ‣ Configuration ‣ Follow-up Levels". — [odoo/documentation 18.0](https://github.com/odoo/documentation/tree/18.0/content/applications/finance/accounting)
- **SAP B1:**
  - "Business Partners › Business Partner Reports" contains "Aging" and "Internal Reconciliation".
  - "Financials › Financial Reports › Accounting" contains "Aging".
  - Both "Financials" and "Business Partners" have an "Internal Reconciliations" folder.
  - Source: [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **BC:**
  - Accountant navigation bar: "Customers", "Vendors" and two "Balance" items (customers/vendors filtered to those with a balance). Report group "Customers and Vendors": Aged Accounts Receivable · Aged Accounts Payable · Reconcile Cust. and Vend. Accs. — [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al)
  - Bookkeeper navigation bar adds "Payment on Hold". — [BookkeeperRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BookkeeperRoleCenter.Page.al)
  - The base app contains the pages "Customer Ledger Entries" and "Apply Customer Entries". — [w1-29 tree: Sales/Receivables](https://github.com/StefanMaron/MSDyn365BC.Code.History/tree/w1-29/BaseApp/Source/Base%20Application/Sales/Receivables)
- **NetSuite:**
  - "Reports > Vendors/Payables > A/P Aging" (Oracle, search snippet). — [A/P Aging Summary Report](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1529519.html)
  - "Reports > Customer/Receivables > A/R Aging" (third-party). — [Kolleno](https://www.kolleno.com/?p=9446)
  - The vendor record's "Financial Tab > Transactions" (user-group wiki). — [netsuiteorg Session 5](https://netsuiteorg.atlassian.net/wiki/spaces/DOC/pages/58490916)

### Inferences
- **"Kartu Hutang/Piutang" (party ledger card)** corresponds to ERPNext General Ledger or Customer/Supplier Ledger Summary, Odoo Partner Ledger, and BC Customer/Vendor Ledger Entries.
- **"Summary Hutang/Piutang"** corresponds to ERPNext AR/AP Summary and the Balance lists in BC.
- **"Pelunasan" tab** corresponds to payment lists filtered by party: ERPNext Payment Entry, Odoo Customers/Vendors › Payments, SAP B1 Incoming/Outgoing Payments.
- **7Soft's one-screen, many-tabs layout is a distinctive UX.** No benchmark ERP has one screen per party side with these tabs.

### Gaps
- **Statement document per party:** not verified. ERPNext's "Process Statement Of Accounts" was confirmed only by its label; Odoo's follow-up reports, BC's "Statement" report and NetSuite statements were not checked.

## 4. Where does settlement of invoices happen? Is it a Payment Entry in AR/AP, or a cash/bank voucher? (vs 7Soft BKM/BKK from Kas-Bank)

### Takeaway
- **ERPNext's Payment Entry is a cash/bank voucher.** It has Payment Type Receive/Pay/Internal Transfer, a party, accounts paid from and to, and a "Payment References" table of invoices. This makes it the direct equivalent of 7Soft BKM/BKK. In v16 it lives in the "Payments" sidebar, separate from "Banking".
- **Odoo** registers payments from the invoice or from Customers/Vendors › Payments. With outstanding accounts configured, a payment stays "In payment" until it is matched with a bank transaction under Accounting › Reconcile.
- **SAP B1** settles from Banking › Incoming/Outgoing Payments by ticking open invoices; a "Payment on Account" leaves both sides open.
- **BC** settles in Cash Management journals (Cash Receipt / Payment Journals) or "Register Customer Payments". These are journal vouchers in the cash module, the closest analogue of 7Soft's Kas-Bank BKM/BKK.
- **NetSuite** uses "Accept Customer Payments" (Apply subtab) and Pay Bills, then "Make Deposits" moves money out of Undeposited Funds.

### Cited Findings
- **ERPNext Payment Entry (v16) fields:**
  - "Payment Type" options: Receive / Pay / Internal Transfer.
  - "Mode of Payment" · "Party Type" · "Account Paid From" · "Account Paid To" · "Company Bank Account".
  - "Payment References" table · "Payment Deductions or Loss" table.
  - "Cheque/Reference No" · "Cheque/Reference Date" · "Clearance Date".
  - Source: [payment_entry.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/payment_entry/payment_entry.json)
- **ERPNext Journal Entry "Entry Type" options:** Journal Entry · Inter Company Journal Entry · Bank Entry · Cash Entry · Credit Card Entry · Debit Note · Credit Note · Contra Entry · Excise Entry · Write Off Entry · Opening Entry · Depreciation Entry · Asset Disposal · Periodic Accounting Entry · Exchange Rate Revaluation · Exchange Gain Or Loss · Deferred Revenue · Deferred Expense. — [journal_entry.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/journal_entry/journal_entry.json)
- **ERPNext settlement tools:**
  - v16 "Payments" sidebar: Payment Entry · Journal Entry · Payment Request · Payment Order · Payment Reconciliation · Unreconcile Payment · Process Payment Reconciliation. — [payments.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/payments.json)
  - Accounts Settings has a checkbox "Make Payment via Journal Entry". — [accounts_settings.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/accounts_settings/accounts_settings.json)
- **Odoo:**
  - "If a payment is **not linked to an invoice or bill**, the customer has an outstanding credit with the company, or the company has an outstanding debit with a vendor."
  - Outstanding accounts are configured "in the Incoming Payments and Outgoing Payments tabs of a bank" journal.
  - With outstanding accounts, the payment is reflected in "an outstanding receipts or payments account", and the invoice shows "In payment" until it is reconciled with a bank transaction.
  - "If the main bank account is set as the outstanding account on the bank journal's payment method … [the invoice moves] to the Paid status without requiring bank reconciliation."
  - Source: [Odoo 18 Payments](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments.html)
- **Odoo menus:** customer and vendor payments are at "Customers ‣ Payments" (action "Customer Payments") and "Vendors ‣ Payments" ("Vendor Payments"). Reconciliation is at "Accounting ‣ Accounting ‣ Reconcile" (Enterprise docs). — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml); [Odoo 19 bank reconciliation](https://www.odoo.com/documentation/19.0/applications/finance/accounting/bank/reconciliation.html)
- **SAP B1 payments:**
  - "In the middle area, you select open transactions for payment from the table by using the checkbox in the Selected column."
  - "When you post a payment, the system reconciles the payment with the selected invoices, and closes the transactions."
  - "If the payment was posted as a Payment on Account, the invoices and the payment stay open."
  - Source: [SAP Learning: Handling Payments](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
- **SAP B1 shortcut document:** "A/R Invoice + Payment" is described as a special A/R invoice where "the bill and the Payment created at the same time" (third-party). — [Firebear blog](https://firebearstudio.com/blog/?p=45927)
- **BC:**
  - "Cash Management" contains Cash Receipt Journals · Payment Journals · Payment Recon. Journals · Bank Deposits · Bank Account Reconciliations. The Business Manager "Payments" actions are Reconcile Imported Payments · Import Bank Transactions... · Register Customer Payments · Create Vendor Payments. — [BusinessManagerRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al)
  - The pages "Payment Registration", "Cash Receipt Journal", "Payment Journal" and "Apply Customer Entries" exist in the base app. — [PaymentRegistration.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Bank/Payment/PaymentRegistration.Page.al); [CashReceiptJournal.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/GeneralLedger/Journal/CashReceiptJournal.Page.al); [ApplyCustomerEntries.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Sales/Receivables/ApplyCustomerEntries.Page.al)
  - When an invoice and payment posted with different posting groups are applied, "Business Central transfers the amounts between the G/L accounts to balance them". — [MS Learn: Posting group setup](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-posting-groups)
- **NetSuite customer payments:**
  - "On the **Apply** subtab, enter the amount received…"; "Click the **Credits** subtab to apply open credit memos"; "Click the **Deposits** subtab to apply a customer prepayment to an invoice".
  - "In the **A/R Account** field, select a posting account for this transaction."
  - Choose "**Undep. Funds**" if the bank isn't credited until the deposit, or "Account" for a payment already deposited.
  - Source: [Customer Payment page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)
- **NetSuite deposits:** "When you record a deposit, NetSuite moves funds from Undeposited Funds to the bank account ledger to keep your bank balances accurate. If you record customer payments directly to a bank account instead of Undeposited Funds, you don't need to create deposits for those amounts." — [Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)

### Inferences
- **Two places for settlement:**
  - *AR/AP-side payment documents*: Odoo, SAP B1 and NetSuite (Incoming/Outgoing Payments, Customer Payment).
  - *Cash/bank journal vouchers*: BC Cash Receipt/Payment Journals.
  - ERPNext's Payment Entry is a hybrid: a voucher that posts directly to a cash/bank account and allocates against invoices.
- **7Soft BKM/BKK fits ERPNext Payment Entry (Receive=BKM, Pay=BKK) or a BC cash receipt/payment journal.** Both put the cash/bank account first and the invoices second, as 7Soft does.
- **Menu placement differs:** ERPNext v16 lists Payment Entry under "Payments" (next to Invoicing). BC lists the journals under "Cash Management", like 7Soft's Kas-Bank.

### Gaps
- **Multi-invoice settlement mechanics:** not verified in source for ERPNext (Get Outstanding Invoices) or BC (Applies-to ID).

## 5. How are post-dated cheques / giro handled (Odoo PDC, SAP B1 checks, ERPNext cheque fields plus Bank Clearance)?

### Takeaway
- **ERPNext:** no separate PDC document. Cheque number and date fields sit on Payment Entry and Journal Entry. The Bank Clearance tool then stamps a "Clearance Date" per cheque, and the "Bank Clearance Summary" report lists cleared items.
- **SAP B1** is the only one with a classic PDC flow. Checks received post to a "checks received" clearing account. The Deposit window moves them to the bank and treats checks due in a chosen date range as postdated. Older releases had a "Postdated Check Deposit" menu.
- **Odoo:** no generic PDC menu in the 18.0 docs. It uses outstanding accounts and Batch Payments (deposit slips). True deferred checks exist only in the Argentina localization ("Own Checks", "Third Party Checks").
- **BC (W1) and NetSuite:** no PDC objects found. NetSuite uses Undeposited Funds and then Make Deposits.

### Cited Findings
- **ERPNext cheque fields and Bank Clearance:**
  - Payment Entry: "Cheque/Reference No", "Cheque/Reference Date", "Clearance Date". — [payment_entry.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/payment_entry/payment_entry.json)
  - Journal Entry: "Reference Number", "Reference Date", "Clearance Date". — [journal_entry.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/journal_entry/journal_entry.json)
  - Bank Clearance fields: Account · Account Currency · From Date · To Date · Bank Account · "Include Reconciled Entries" · "Include POS Transactions" · table "Payment Entries". — [bank_clearance.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/bank_clearance/bank_clearance.json)
  - Bank Clearance row columns: Payment Document · Payment Entry · Against Account · Amount · Posting Date · Cheque Number · Cheque Date · Clearance Date. — [bank_clearance_detail.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/bank_clearance_detail/bank_clearance_detail.json)
- **ERPNext menu placement:**
  - v15 "Banking" card: Bank Clearance · Bank Reconciliation Tool · Bank Reconciliation Statement. — [accounting.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/accounting/accounting.json)
  - v16 "Banking" card: "Bank Reconciliation (old)" · "Bank Clearance Summary" · "Bank Guarantee"; "Setup" card: "Cheque Print Template". — [accounting.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/workspace/accounting/accounting.json)
  - The newer Accounts sidebar's "Banking" section: Banking (`/banking`) · Bank Account · Bank Clearance. — [accounts sidebar v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/sidebar/accounts/accounts.json)
- **SAP B1 checks received:** "The incoming payment credits the customer account and debits the checks received account." "When the deposit is made, the checks received account is credited and the bank account is debited." — [SAP Learning: Handling Payments](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/handling-payments-1)
- **SAP B1 postdated checks (older material, B1 2007–9.x era, from search snippets):**
  - Path: "Banking module ® Deposits ® Deposit ® Choose the Checks tab".
  - "Consider From… To…" sets the due-date range "considered as postdated checks"; the default is the next day to fiscal year-end.
  - "Considered Until" sets the date up to which checks are "considered as cash checks".
  - An older separate menu "Banking > Deposits > Postdated Check Deposit" existed, reportedly unavailable in the US/Canada localizations.
  - Sources: [SAP Community archive thread](https://archive.sap.com/discussions/thread/1064954); [SAP Answers: postdated check deposit (2009)](https://answers.sap.com/questions/5427419/postdated-check-deposit.html)
- **SAP B1 Web Client deposits:** the Web Client uses "the Deposit option to document and manage the transactions with the bank". Predefined clearing accounts are used automatically for incoming cash, check or card payments, and a deposit transfers the funds from the clearing account to the house bank account (paraphrased by the fetch tool). — [SAP Learning: Processing Deposits (Web Client)](https://learning.sap.com/courses/utilizing-sap-business-one-web-client-accounting/processing-deposits)
- **SAP B1 checks paid out:**
  - "Checks that are not tied to a document are represented by the ChecksforPayment object" (10.0 SDK, search snippet). — [SAP B1 10.0 SDK: Payments_Checks](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~Payments_Checks.html)
  - Banking also has a "Bill of Exchange" folder, with matching Banking Reports. — [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs)
- **Odoo batch payments:**
  - Batch payments group payments "to generate a detailed deposit slip or a single electronic payment file". They let you "Group incoming cash or check payments into batches to print bank deposit slips".
  - Enabled at "Configuration ‣ Settings" › "Customer Payments" › "Batch Payments"; this "enables both customer *and* vendor batch payments".
  - Menus: "Customers ‣ Batch Payments" and "Vendors ‣ Batch payments".
  - Source: [Odoo 18 Batch payments](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/batch.html)
- **Odoo outgoing checks:** "Accounting ‣ Configuration ‣ Settings" › "Vendor Payments" › enable "Checks", which sets up the "Checks" payment method for printing. — [Odoo 18 Pay by checks](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/pay_checks.html)
- **Odoo Argentina localization (deferred checks):**
  - Bank journal "Outgoing Payments" tab: enable "Use electronic and deferred checks". Registering a payment asks for "Check Cash-In Date"; "To manage deferred checks, the Check Cash-In Date must be set in the future."
  - Menu "Accounting ‣ Vendors ‣ Own Checks" lists own checks, pre-filtered to those not yet matched with a bank statement; a "Void Check" button cancels one.
  - Third-party checks need journals with the payment methods "New Third Party Checks" and "Existing Third Party Checks".
  - Source: [Odoo 18 Argentina](https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/argentina.html)
- **Odoo docs search:** in the 18.0 accounting and localization docs, a search for "post-dated / postdated / PDC / deferred check / third-party check" matched only the Argentina page. — [odoo/documentation 18.0](https://github.com/odoo/documentation/tree/18.0/content/applications/finance)
- **BC W1 v29:** the base app has a "Check Ledger Entries" page. No object path containing "PostDated" exists in the base-app tree. — [CheckLedgerEntries.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Bank/Check/CheckLedgerEntries.Page.al); [w1-29 tree](https://github.com/StefanMaron/MSDyn365BC.Code.History/tree/w1-29)
- **NetSuite:**
  - "If you receive payment by cash or check and your bank account is not credited until you actually make the deposit, select **Undep. Funds**." — [Customer Payment page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)
  - "If you move a cleared cash sale transaction to Undeposited Funds, NetSuite returns it to an uncleared status." — [Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)

### Inferences
- **7Soft's "Pencairan BG" (bilyet giro clearing)** maps to these mechanisms:
  - SAP B1's Deposit of postdated checks (checks-received clearing account → bank): the closest functional equivalent.
  - ERPNext's Bank Clearance (stamping a clearance date): the closest UI equivalent, but it does not move money between accounts.
  - Odoo's outstanding receipts account plus bank reconciliation: functionally a clearing step.
  - NetSuite's Undeposited Funds plus Make Deposits.
- **Only SAP B1 places the giro-clearing step under Banking › Deposits**, as 7Soft places it under Kas-Bank. ERPNext places Bank Clearance under Banking (v15 card; v16 sidebar section).

### Gaps
- **No official 10.0 source for SAP B1 postdated checks.** The 10.0-era Deposit window layout and the "Postdated Check Deposit" menu were not confirmed; the cited sources are 2008–2009 community threads.
- **Odoo 19 "Accounting ‣ Configuration ‣ Check" is unclear.** It appears in the closing and tax-return docs, so it is probably closing/audit checks rather than cheques; not verified.
- **BC and NetSuite localizations:** BC localizations (e.g., APAC/Middle East) and NetSuite country add-ons may have PDC features; not researched.

## 6. Where are default/posting accounts configured (vs 7Soft "Setting COA")?

### Takeaway
- **ERPNext:** default slots sit on the Company record (Accounts tab › "Default Accounts" and related sections). Mode of Payment maps each payment mode to a Default Account per company.
- **Odoo:** spreads defaults across journals (bank/cash accounts, outstanding receipts/payments accounts), "Settings ‣ Default Accounts" and Fiscal Positions.
- **SAP B1:** one window, "G/L Account Determination", under Administration › Setup › Financials, with tabs Sales · Purchasing · General · Inventory. This is closest to 7Soft's single "Setting COA".
- **BC:** a matrix of posting groups (Customer/Vendor/Bank Account/Inventory/FA posting groups, General Posting Setup, VAT Posting Setup).

### Cited Findings
- **ERPNext Company record (v16, display order):**
  - Tab "Accounts" › section "Default Accounts": Default Bank Account · Default Cash Account · Default Receivable Account · Default Payable Account · Write Off Account · Unrealized Profit / Loss Account · Default Cost of Goods Sold Account · Default Income Account · Default Payment Discount Account · Default Cost Center.
  - Section "Exchange Gain / Loss": Exchange Gain / Loss Account · Unrealized Exchange Gain/Loss Account.
  - Section "Round Off": Round Off Account · Round Off Cost Center · Round Off for Opening.
  - Section "Deferred Accounting": Default Deferred Revenue Account · Default Deferred Expense Account.
  - Section "Advance Payments": Default Advance Received Account · Default Advance Paid Account.
  - Section "Fixed Asset Defaults": Accumulated Depreciation Account · Depreciation Expense Account · Gain/Loss Account on Asset Disposal · Asset Depreciation Cost Center · Capital Work In Progress Account · Asset Received But Not Billed.
  - Elsewhere: stock defaults such as "Default Inventory Account", "Stock Adjustment Account" and "Stock Received But Not Billed".
  - Source: [company.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/setup/doctype/company/company.json)
- **ERPNext Mode of Payment:** fields "Mode of Payment", "Type" (Cash / Bank / General / Phone), "Accounts" (child table with Company · Default Account) and "Enabled". In v16 it appears under the Accounts sidebar "Setup". — [mode_of_payment.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/mode_of_payment/mode_of_payment.json); [accounts sidebar](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/sidebar/accounts/accounts.json)
- **ERPNext POS Profile account fields:** Write Off Account · Write Off Cost Center · Account for Change Amount · Income Account · Expense Account · Cost Center. — [pos_profile.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/pos_profile/pos_profile.json)
- **Odoo:**
  - Outstanding accounts are set in the bank journal's "Incoming Payments" and "Outgoing Payments" tabs. — [Odoo 18 Payments](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments.html)
  - Documented path "Accounting ‣ Configuration ‣ Settings ‣ Default Accounts". — [Odoo 18 multi-currency](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/multi_currency.html)
  - Configuration › Accounting holds "Fiscal Positions" and "Journals" in every version. — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml)
  - Each POS Payment Method selects a "Journal" (Cash or Bank). — [Odoo 18 POS payment methods](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html)
- **SAP B1:**
  - "In the G/L Account Determination window, you define the default G/L accounts to be used in transactions."
  - With the traditional method, "The values that you define under the tabs … are defaulted into all 3 levels" (warehouse, item group, item).
  - With "Enable Advanced G/L Account Determination", the window works at company level, and rules by criteria such as item, warehouse or ship-to country take priority.
  - The window is in "the Financials Setup area of the Administration module".
  - Source: [SAP Learning: Exploring the Chart of Accounts](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/exploring-the-chart-of-accounts-1)
- **SAP B1 path and tabs:**
  - Path "Administration › Setup › Financials › G/L Account Determination › Inventory" (B1 9.1 help, older). — [SAP Help 9.1](https://help.sap.com/saphelp_sbo91/helpdata/en/45/06b8ab7d720487e10000000a155369/content.htm)
  - Tab breakdown (Sales, Purchasing, General, Inventory; General holds rounding, opening-balance and period-end closing accounts) per a partner guide. — [Vision33 PDF](https://vision33.com/hubfs/ARedesign%202018/Tips%20and%20Tricks/Tips%20and%20Tricks%20PDF/sapb1-gl-determinations-edited-by-vision33.pdf)
  - Customer reconciliation accounts sit on the Sales › General area. — [sap-b1-blog](https://sap-b1-blog.com/en/sap-business-one/finance-in-sap-business-one/sap-business-one-g-l-account-determination-sales-purchasing/)
  - The tab and field details above come from search snippets of these third-party and older pages.
- **BC posting groups (MS Learn, updated 2025-10-01):**
  - "Posting groups map entities to general ledger accounts. … The transaction values go to the accounts specified in the posting group for that particular entity."
  - The pages are: Gen. Business Posting Groups, Gen. Product Posting Groups, General Posting Setup, Customer Posting Groups, Vendor Posting Groups, Inventory Posting Groups / Inventory Posting Setup, Bank Account Posting Groups, FA Posting Groups, and the tax (VAT) posting setups.
  - Source: [MS Learn: Posting group setup](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-posting-groups)
- **BC posting group fields (W1 v29):**
  - Customer Posting Group: "Receivables Account", "Service Charge Acc.", "Payment Disc. Debit Acc.", "Invoice Rounding Account", "Additional Fee Account", "Interest Account", "Debit/Credit Curr. Appln. Rndg. Acc.", "Debit/Credit Rounding Account", "Payment Disc. Credit Acc.", "Payment Tolerance Debit/Credit Acc.", "Add. Fee per Line Account".
  - Vendor Posting Group: "Payables Account" plus similar fields.
  - Bank Account Posting Group: "G/L Account No.".
  - General Posting Setup: "Sales Account", "Sales Credit Memo Account", "Sales Line Disc. Account", "Purch. Account", "Purch. Credit Memo Account", "COGS Account", "Inventory Adjmt. Account", "Sales Prepayments Account", "Purch. Prepayments Account", and others.
  - Sources: [CustomerPostingGroup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Sales/Customer/CustomerPostingGroup.Table.al); [VendorPostingGroup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Purchases/Vendor/VendorPostingGroup.Table.al); [BankAccountPostingGroup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Bank/BankAccount/BankAccountPostingGroup.Table.al); [GeneralPostingSetup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/GeneralLedger/Setup/GeneralPostingSetup.Table.al)
- **BC menu placement:** "Bank Account Posting Groups" is a link in the Accountant role center's "Finance" group. — [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al)
- **NetSuite:**
  - Enabling A/R "creates the system-generated Accounts Receivable account" (search snippet). — [Enable Accounting Basic Features](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1110092533.html)
  - "If you have only one Accounts Receivable account listed in the Chart of Accounts, NetSuite defaults this account as the posting account for customer payments." — [Customer Payment page](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1288824.html)

### Inferences
- **Closest one-to-one match for 7Soft "Setting COA":** SAP B1 G/L Account Determination (one window of named slots by tab), then ERPNext Company › Default Accounts (one section of named slots).
- **BC posting groups are more granular.** They are per customer group, product group and bank group, so a 7Soft-style single slot list would map to a single posting group in each table.
- **7Soft's cash/bank account slots** correspond to ERPNext Mode of Payment › Accounts and Odoo bank/cash journals.

### Gaps
- **Field-level defaults not verified:** NetSuite Accounting Preferences default accounts, Odoo Settings › Default Accounts fields, and ERPNext party-level (Customer/Supplier "Accounts") and item-level defaults were not checked.
- **SAP B1 10.0 field list:** the field list per G/L Account Determination tab was not verified from a 10.0 source.

## 7. Where do period close, opening balances and user permissions live?

### Takeaway
- **Period close** is a menu item in every system:
  - ERPNext: "Period Closing Voucher" plus "Accounting Period" (per-document-type locks); v16 also has Company › "Accounts Closing" (frozen-till date).
  - Odoo: "Accounting ‣ Accounting ‣ Lock Dates".
  - BC: "Accounting Periods" plus "Allow Posting From/To" in General Ledger Setup and User Setup.
  - NetSuite: "Manage Accounting Periods" › Period Close Checklist.
  - SAP B1: posting periods (menu path unverified).
- **Opening balances:**
  - ERPNext: Opening Invoice Tool, COA Importer and Journal Entry "Opening Entry".
  - SAP B1: Administration › System Initialization › Opening Balances.
  - Odoo: the onboarding step.
- **Permissions sit outside the finance menus** (roles/groups), with some finance-specific role fields.

### Cited Findings
- **ERPNext Period Closing Voucher fields:** Transaction Date · Fiscal Year · Company · Closing Account Head · Period Start Date · Period End Date · Remarks · GL Entry Processing Status. — [period_closing_voucher.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/period_closing_voucher/period_closing_voucher.json)
- **ERPNext Accounting Period fields:** Period Name · Start Date · End Date · Company · Disabled · Closed Documents (child: Document Type · Closed) · Exempted Role. — [accounting_period.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/accounting_period/accounting_period.json)
- **ERPNext frozen-till date:**
  - v15 Accounts Settings: "Accounts Frozen Till Date" and "Role Allowed to Set Frozen Accounts and Edit Frozen Entries". — [accounts_settings.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/doctype/accounts_settings/accounts_settings.json)
  - v16 moves this to Company › tab "Accounts Closing": "Accounts Frozen Till Date" and "Roles Allowed to Set and Edit Frozen Account Entries". — [company.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/setup/doctype/company/company.json)
- **ERPNext menu labels:** v15 card "Opening and Closing" (Opening Invoice Creation Tool · Chart of Accounts Importer · Period Closing Voucher); v16 card "Opening & Closing" (COA Importer · Opening Invoice Tool · Accounting Period · FX Revaluation · Period Closing Voucher · Process Deferred Accounting). — [accounting.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/accounting/accounting.json); [accounting.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/workspace/accounting/accounting.json)
- **ERPNext opening flags:**
  - Journal Entry: "Is Opening" (No/Yes) and Entry Type "Opening Entry". — [journal_entry.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/journal_entry/journal_entry.json)
  - Sales Invoice: "Is Opening Entry". — [sales_invoice.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/sales_invoice/sales_invoice.json)
- **ERPNext finance role fields** in Accounts Settings: "Role allowed to bypass credit limit", "Role Allowed to over bill". v16 also adds "Enable Immutable Ledger". — [accounts_settings.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/accounts_settings/accounts_settings.json)
- **Odoo lock dates (18.0):**
  - "To set a Lock Everything date, go to Accounting ‣ Accounting ‣ Lock Dates. In the Lock Journal Entries window, set the Lock Everything date".
  - "a Hard Lock date can be set … in Accounting ‣ Accounting ‣ Lock Dates"; "The Hard Lock date field is irreversible".
  - Year-end profit is shown via an account named "Undistributed Profits/Losses".
  - Source: [Odoo 18 Year-end closing](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html)
- **Odoo 17.0** uses the same "Accounting ‣ Accounting ‣ Lock …" path. — [odoo/documentation 17.0 year_end.rst](https://github.com/odoo/documentation/blob/17.0/content/applications/finance/accounting/reporting/year_end.rst)
- **Odoo 19.0** adds "Accounting ‣ Accounting ‣ Tax Returns", and its Community menu has a new "Accounting › Closing" folder. — [Odoo 19 tax returns](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/tax_returns.html); [19.0 XML](https://github.com/odoo/odoo/blob/19.0/addons/account/views/account_menuitem.xml)
- **Odoo fiscal periods and opening balances:**
  - "Accounting ‣ Configuration ‣ Settings ‣ Fiscal Periods" (field "Last Day"; option "Fiscal Years").
  - The Accounting onboarding banner covers the "Chart of Accounts and their opening balances".
  - Sources: [Odoo 18 Get started](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started.html); [year_end](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html)
- **Odoo permissions** are user groups attached to menus, for example `account.group_account_readonly`, `account.group_account_invoice`, `account.group_account_manager`, `account.group_account_basic` (18+) and `base.group_system` (Settings). — [18.0 XML](https://github.com/odoo/odoo/blob/18.0/addons/account/views/account_menuitem.xml)
- **SAP B1:** Administration › System Initialization contains "Authorizations" and "Opening Balances"; Administration also has "Approval Process". — [SAPUtils MenuItem.cs](https://github.com/EricRamirezS/SAPUtils/blob/HEAD/SAPUtils/Models/Menu/MenuItem.cs). The SAP course has a lesson titled "Working with the Posting Periods Process" (title only). — [SAP Learning: Exploring the Chart of Accounts](https://learning.sap.com/courses/handling-accounting-in-sap-business-one/exploring-the-chart-of-accounts-1)
- **BC period close:**
  - "Accounting Periods" appears in Accountant › Finance and in Bookkeeper › "Administration" (with Currencies · Number Series).
  - The Accountant's G/L Reports group includes "Closing Trial Balance" and "Fiscal Year Balance".
  - The base app contains the "Close Income Statement" report and the "Accounting Periods" page.
  - Sources: [AccountantRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/AccountantRoleCenter.Page.al); [BookkeeperRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BookkeeperRoleCenter.Page.al); [CloseIncomeStatement.Report.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/GeneralLedger/Setup/CloseIncomeStatement.Report.al); [AccountingPeriods.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Foundation/Period/AccountingPeriods.Page.al)
- **BC posting windows:**
  - General Ledger Setup: "Allow Posting From", "Allow Posting To", "Allow Deferral Posting From/To" and DateFormula variants. — [GeneralLedgerSetup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/GeneralLedger/Setup/GeneralLedgerSetup.Table.al)
  - User Setup (per user): "Allow Posting From", "Allow Posting To", "Approver ID", "Sales Amount Approval Limit", "Purchase Amount Approval Limit", "Request Amount Approval Limit". — [UserSetup.Table.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/System/User/UserSetup.Table.al)
- **NetSuite Period Close Checklist:**
  - "Go to _Setup > Accounting > Manage GL > Manage Accounting Periods_", then click the Checklist icon. "Tasks are listed in the order in which they should be completed."
  - The tasks are Lock A/R · Lock A/P · Lock Payroll · Lock All, then inventory reviews, "Revalue Open Foreign Currency Balances", and others, ending with "Close" › "Close Period".
  - Source: [Using the Period Close Checklist](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html)
- **NetSuite roles** are managed at "Setup > Users/Roles > Manage Roles". — [Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)

### Inferences
- **"Closing Periode" (GL) has two meanings in the benchmark systems:**
  - *Lock dates/periods*: Odoo Lock Dates, ERPNext Accounting Period and Frozen Till Date, BC Allow Posting From/To, NetSuite Lock A/R/A/P.
  - *Closing entries*: ERPNext Period Closing Voucher, BC Close Income Statement.
  - 7Soft may combine both in one menu.
- **"Saldo Awal COA" (Master):** only SAP B1 has a dedicated "Opening Balances" menu (System Initialization). ERPNext spreads it across tools and Journal Entry types; Odoo puts it in onboarding.
- **"User & Group" / "Setting Menu":** in all five these live in system administration, not in finance menus. BC User Setup's posting window per user is the notable finance-specific permission.

### Gaps
- **SAP B1:** the 10.0 menu paths for "Posting Periods" and "Period-End Closing" were not verified.
- **BC:** the opening-balance tools (e.g., configuration packages or data migration) and the "Close Year" action label were not verified.
- **NetSuite:** opening balances and the year-end retained-earnings mechanism were not verified.

## 8. How is POS / cash retail sales posted to finance, and where does it appear in the menu?

### Takeaway
- **ERPNext:** POS sits in the Selling sidebar, not in Accounting. POS Invoices made during a shift are consolidated by the POS Closing Entry, through a "POS Invoice Merge Log", into a Sales Invoice flagged "Is Consolidated". From v16, POS Settings can make the POS screen create Sales Invoices directly.
- **Odoo:** POS is its own app. Closing a session ("Close Session" → "Closing Control") posts one session journal entry in the POS journal, plus payment moves per payment method.
- **NetSuite:** "Cash Sale" is a distinct transaction from "Invoice". It posts to Undeposited Funds or a bank account.
- **SAP B1:** offers "A/R Invoice + Payment".
- **BC role centers:** contain no POS item.

### Cited Findings
- **ERPNext menu placement:**
  - v16 Selling Workspace Sidebar "POS" section: POS (page `point-of-sale`) · POS Profile · POS Invoice · POS Opening Entry · POS Closing Entry · POS Invoice Merge Log · POS Settings. — [workspace_sidebar/selling.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/workspace_sidebar/selling.json)
  - The newer Selling "Sidebar" has POS · POS Profile · POS Invoice. — [selling sidebar](https://github.com/frappe/erpnext/blob/version-16/erpnext/selling/sidebar/selling/selling.json)
  - v15 Receivables has a shortcut "POS Invoice". — [receivables.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/workspace/receivables/receivables.json)
- **ERPNext POS Settings:**
  - v16 adds "Invoice Type Created via POS Screen" (options Sales Invoice / POS Invoice) and "Create Ledger Entries for Change Amount". — [pos_settings.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/pos_settings/pos_settings.json)
  - v15 POS Settings has only POS Field / POS Search Fields. — [pos_settings.json v15](https://github.com/frappe/erpnext/blob/version-15/erpnext/accounts/doctype/pos_settings/pos_settings.json)
- **ERPNext POS Closing Entry fields:** Period Start Date · Period End Date · Posting Date · Company · POS Profile · Cashier · Modes of Payment · Payment Reconciliation · Grand Total · Net Total · Total Quantity · Taxes · Linked Invoices · POS Opening Entry · Status · POS Transactions · Sales Invoice Transactions · Taxes and Charges. — [pos_closing_entry.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/pos_closing_entry/pos_closing_entry.json)
- **ERPNext consolidation:**
  - The closing entry imports `consolidate_pos_invoices` and `unconsolidate_pos_invoices` and checks "POS Invoice is already consolidated" and "Sales Invoice is already consolidated". — [pos_closing_entry.py](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/pos_closing_entry/pos_closing_entry.py)
  - The merge log's `process_merging_into_sales_invoice` sets `sales_invoice.is_consolidated = 1` and stores `consolidated_invoice`; returns are merged into credit notes (`process_merging_into_credit_notes`). — [pos_invoice_merge_log.py](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/pos_invoice_merge_log/pos_invoice_merge_log.py)
- **ERPNext Sales Invoice POS fields:** "Include Payment (POS)" (`is_pos`), "POS Profile", "Sales Invoice Payment" table and "Is Consolidated". — [sales_invoice.json v16](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/sales_invoice/sales_invoice.json)
- **ERPNext bank side:** Bank Clearance has "Include POS Transactions". — [bank_clearance.json](https://github.com/frappe/erpnext/blob/version-16/erpnext/accounts/doctype/bank_clearance/bank_clearance.json)
- **Odoo session closing (18.0):**
  - "click the **menu icon** … and Close Session". Doing so "opens the Closing Control pop-up screen", where you count cash.
  - Once you "close and post the POS session", the session report is available. "It is strongly advised to close your POS session at the end of each day."
  - Previous sessions are at "Point of Sale ‣ Orders ‣ Sessions".
  - Source: [Odoo 18 Point of Sale](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html)
- **Odoo payment methods:** at "Point of Sale ‣ Configuration ‣ Payment Methods ‣ New", select the "Journal": "Choose Cash … for cash payments, or Bank … for card payments". "Identify Customer" restricts a method to registered customers. — [Odoo 18 POS payment methods](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/payment_methods.html)
- **Odoo source:** `pos_session` closing (`action_pos_session_closing_control` → `_validate_session` → `_create_account_move`) creates the move in `self.config_id.journal_id`. Helpers include `_create_bank_payment_moves`, `_create_combine_account_payment`, `_create_split_account_payment`, `_create_cash_statement_lines_and_cash_move_lines` and `_create_invoice_receivable_lines`. — [pos_session.py 18.0](https://github.com/odoo/odoo/blob/18.0/addons/point_of_sale/models/pos_session.py)
- **Odoo POS menus documented in 18.0 and 19.0:**
  - "Point of Sale ‣ Orders ‣ Orders", "Point of Sale ‣ Reporting ‣ Orders" and "Point of Sale ‣ Configuration ‣ Payment Methods".
  - 19.0 adds "Point of Sale ‣ Orders ‣ Customers" and "Point of Sale ‣ Configuration ‣ Coins/Bills".
  - Sources: [odoo/documentation 18.0 POS](https://github.com/odoo/documentation/tree/18.0/content/applications/sales/point_of_sale); [19.0 POS](https://github.com/odoo/documentation/tree/19.0/content/applications/sales/point_of_sale)
- **NetSuite Cash Sale:**
  - "Enter a cash sale when you receive payment for goods or services at the time of delivery."
  - Choose "Undeposited Funds" for cash or check payments not yet credited, or "Deposit To" a bank account for card payments credited automatically.
  - Path: "Opportunities > Transactions > Cash Sales".
  - Source: [Entering a Cash Sale](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1244457.html)
- **NetSuite deposits:** the Making Deposits page refers to amounts "received for a cash sale, invoice, or other transaction" and lists Undeposited Funds payments on its Payments subtab. — [Making Deposits](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1542431.html)
- **NetSuite undeposited cash sales:** a Cash Sale stays undeposited until it is included in a Bank Deposit (Oracle community). — [Oracle community thread](https://community.oracle.com/netsuite/english/discussion/4514592/nsc-understanding-cash-sale-status-and-ensuring-the-transaction-is-deposited)
- **SAP B1:** "A/R Invoice + Payment" is "used to automate receipts for quick transactions" (third-party). — [Firebear blog](https://firebearstudio.com/blog/?p=45927)
- **BC:** none of the Business Manager, Accountant or Bookkeeper role-center menus contains a POS entry (full caption lists in Q1). — [BusinessManagerRoleCenter.Page.al](https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-29/BaseApp/Source/Base%20Application/Finance/RoleCenters/BusinessManagerRoleCenter.Page.al)

### Inferences
- **7Soft "Penjualan Cash/POS" placement:**
  - Its placement under Penjualan matches ERPNext (POS under Selling) and NetSuite (Cash Sale as a sales transaction).
  - In Odoo, POS is a separate app whose accounting is summarised per session.
- **Posting granularity varies:**
  - Per shift/session: ERPNext POS Closing Entry and Odoo session move.
  - Per receipt: NetSuite Cash Sale and SAP B1 A/R Invoice + Payment.
- **POS takings to bank:** NetSuite's Undeposited Funds → Make Deposits and SAP B1's clearing-account → Deposit are the clearest models.

### Gaps
- **SAP B1 POS:** no native SAP B1 POS menu found; the details of SAP's retail add-ons were not researched.
- **BC POS:** BC POS options (partner apps) and cash sales via a payment method with a balancing account were not verified.
- **ERPNext v16 default:** the default value of "Invoice Type Created via POS Screen" was not checked.
