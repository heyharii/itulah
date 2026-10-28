# SMB cloud accounting navigation: QuickBooks Online, Xero, MYOB Business, Sage (Accounting, 50, Intacct)

*Researched 28 Oct 2026. Method notes. central.xero.com, two Lightspeed pages and one Sage KB page would not render for the fetch tool. Xero's current submenu labels therefore come from Xero's own PDF "Your guide to Xero's refreshed navigation" (Xero-branded, hosted by Plus Accounting, Sept 2025). The labels are in screenshots, so I read them by OCR and fixed obvious OCR slips (for example "Manual iournals" became "Manual journals"). "(search excerpt)" marks a fact taken from a search-result summary of the cited page, not from a full read. Menu labels and paths are verbatim. Vendor prose is paraphrased.*

## 1. What are the exact current menu labels and submenus in each product (with the 2024–2026 redesigns)?

### Takeaway
Every SMB product now uses a short top level grouped by business cycle and task:
- **Xero** (Sep 2025): Home · Sales · Purchases · Reporting · Payroll · Accounting · Tax · Contacts · Projects, plus a global "+" create menu.
- **QuickBooks Online** (Intuit Platform UI, 2025–26): +Create · Bookmarks · Home · Feed · Reports · All apps, plus pinned hubs such as Accounting, "Sales & Get Paid" and "Expenses & Bills".
- **MYOB Business** (May 2024): a left vertical menu with Sales, Purchases, Banking, Accounting, Payroll, Products and services, Contacts and Reporting, plus a Create menu.
- **Sage Accounting:** Sales · Purchases (UK) or Expenses (North America) · Banking · Contacts · Products and services · Reporting · Journals/Adjustments · Settings.

Module names (Accounts Receivable, Accounts Payable, Cash Management, General Ledger) survive only in upper-end Sage Intacct and in older Sage 50 desktop editions.

### Cited Findings

#### Xero: current "refreshed navigation" (rolled out 8–30 Sep 2025)
- Rollout: the new navigation was rolled out gradually from 8 to 30 September 2025. The old "Business" menu was split into "Sales" and "Purchases", "Reporting" moved to the main bar, a dedicated Tax menu was added, settings were made reachable from every dropdown, and the right-hand panel was revamped. The article is dated 16 Oct 2025. — [UHY Hacker Young](https://www.uhy-uk.com/insights/whats-new-xero-dext-autumn-2025)
- Top bar order, as shown in Xero's guide screenshot: **Home · Sales · Purchases · Reporting · Payroll · Accounting · Tax · Contacts · Projects**. On the right are **+** (create), **JAX** ("Just Ask Xero", beta), **Search**, **Help**, **Notifications** and **Apps**. Xero says navigation may vary by region, plan and permissions. — [Xero guide PDF (Sept 2025)](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **+ / CREATE NEW** menu: Invoice · Payment link · Bill · Contact · Quote · Purchase order · Manual journal · Spend money · Receive money · Transfer money. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Sales**: Sales overview · Invoices · Progress payments · Payment links · Online payments · Quotes · Products and services · Inventory plus · Customers · Sales settings. "Customers" jumps to the customers section of the Contacts menu. "Sales settings" opens the sales section of the new settings page. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Purchases**: Purchases overview · Bills · Purchase orders · Expenses · Suppliers · Purchases settings. "Suppliers" jumps to the suppliers section of Contacts. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Reporting**, standard user:
  - All reports
  - ANALYTICS POWERED BY SYFT: Dashboards · Cash flow manager · Visualisations
  - FAVOURITE REPORTS: Account Transactions · Aged Payables Summary · Aged Receivables Summary · Balance Sheet · Profit and Loss
  - ANALYTICS: Short-term cash flow · Business snapshot
  - Reporting settings
  - An **Advisor user** also gets ADVISER REPORTS: Business Finance Advisor Pack · Company - Annual Accounts.
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Accounting**, standard user:
  - BANKING: Bank accounts · Bank rules
  - ACCOUNTING TOOLS: Chart of accounts · Fixed assets · Manual journals
  - Accounting settings
  - An **Advisor user** also gets: Find and recode · Assurance dashboard · History and notes.
  - Xero describes the menu as the place for tools that get the books ready for period end. "Bank rules" is new in this menu.
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Tax**: regional menus, each with its own permission settings.
  - AU: Activity Statement · Taxable Payments Annual Report · Tax settings
  - US: Sales tax · 1099 · Tax settings
  - UK: VAT Returns · CIS Contractor · CIS Subcontractor (CIS Suffered) · Tax settings. Partnership tax appears if enabled.
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Contacts**: All contacts · Customers · Suppliers · GROUPS (examples shown: VIP customers, Top customers) · Contacts settings. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Projects**: All projects · Time entries · Staff time overview · Projects settings. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Payroll** varies by region:
  - AU: Payroll overview; EMPLOYEE MANAGEMENT: Employees · Leave · Timesheets; PAYROLL PROCESSING: Pay employees · Superannuation · Single Touch Payroll; ADMINISTRATION: Payroll history · Payroll settings
  - UK: … Pay employees · Pension filings · RTI filings · Taxes and filings · Payroll settings
  - US (Gusto-style): Dashboard · Run payroll · Time off · Reports · Integration settings
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Settings**: settings now sit in every dropdown and on one central settings page, reached from the organisation menu. Sections include General (Organisation details · Users · Subscription · Connected apps · Email settings) and Sales (Invoice settings · Online payments …). The organisation menu shows Files · Settings · Subscription and billing · organisation switcher · Add new organisation · My Xero. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **Home** (formerly "Dashboard") opens on "Business overview":
  - bank-account cards showing Statement balance against Balance in Xero, with "Reconcile 20 items" and "View account transactions"
  - "Invoices owed to you", "Bills to pay" and "Net profit or loss" cards
  - a Tasks list: items to be reconciled, overdue invoices, invoices awaiting approval, bills awaiting approval, overdue bills
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- A Dec 2025 third-party guide confirms the bar as Organization Menu, Home Page, Sales, Purchases, Reporting, Accounting, Tax, Contacts and Projects. — [Accounting Stuff, 20 Dec 2025](https://accountingstuff.com/blog/how-to-use-xero)
- Beta announcement dated 12 Aug 2025 (updated 29 Aug 2025). Xero cites 30,000 beta testers. — [Xero blog](https://blog.xero.com/product-updates/new-navigation-homepage-coming-soon/)
- **OLDER (before Sep 2025)** "Business" menu, from the guide's OLD column: Analytics · Short-term cash flow · Business snapshot · Invoices · Payment links · Online payments · Quotes · Sales Overview · Bills to Pay · Purchase Orders · Purchase overview · Expense Claims · Products and Services. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- **OLDER (Dec 2018 layout):**
  - Business: Invoices, Quotes, Purchase orders, Bills, Sales/Purchases overview, Products and services (formerly "Inventory"), Expense claims
  - Accounting: Bank accounts, Reports, Advanced
  - Advanced, left column: Find and Recode, Manual Journals, Fixed Assets. Right column: Chart of Accounts, Tracking Categories and other former Settings items.
  - "+" menu: Manual Journals, Spend Money, Receive Money, Transfer Money
  - — [Insightful Accountant, 5 Dec 2018](https://insightfulaccountant.com/accounting-tech/general-ledger/xero-in-on-xero-the-new-layout/)

#### QuickBooks Online: current Intuit Platform menu (help pages updated 5 Aug 2026)
- Left menu: **+Create** (a new transaction, project, task or goal) · **Bookmarks** · **Home** (widgets) · **Feed** (an AI-generated summary of recent transactions and the state of your finances) · **Reports** · **All apps** (task hubs). **Pinned** apps default to **Accounting, Sales, Customers** and can be changed under **Customize**. Hubs named on the page are Accounting, Time and Projects. Added services such as Payroll appear at the bottom of All apps. The page covers Advanced, Essentials, Plus, Simple Start, Free, Lite and Solopreneur. — [Intuit: Understand the menu in QuickBooks on the Intuit Platform](https://quickbooks.intuit.com/learn-support/en-us/help-article/bookkeeping-processes/understand-navigation-menu-quickbooks-online/L310NeoHY_US_en_US)
- Invoice path: **All apps > Sales & Get Paid > Invoices**. Unpaid invoices post to the "Accounts Receivable (A/R)" account. A customer record also has an Invoices tab. — [Intuit: Understand invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/understand-invoices-quickbooks-online/L52ENtVfF_US_en_US)
- Bill path: **All apps > Expenses & Bills > Bills**. Manual entry is **+ Create > Bill**. The Bills list has **For review** and **Unpaid** tabs. — [Intuit: Enter bills](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/enter-bills-record-bill-payments-quickbooks-online/L1e9Ce5J7_US_en_US)
- Reconcile path: **All apps > Accounting > Reconcile**. An AI option reads an uploaded statement (Plus, Advanced and similar tiers). — [Intuit: Learn the reconcile workflow](https://quickbooks.intuit.com/learn-support/en-us/help-article/reconciliation-reports/learn-reconcile-workflow-quickbooks/L8ZibUuVE_US_en_US) (search excerpt)
- The Sales & Get Paid hub also holds Sales transactions, QuickBooks payouts and payment links. — [Intuit: Find out when QuickBooks Payments deposits customer payments](https://quickbooks.intuit.com/learn-support/en-us/help-article/receive-payments/find-quickbooks-payments-deposits-customer/L80Fh7CSV_US_en_US) (search excerpt)
- Redesigned interface for accountants (page metadata Aug–Oct 2025):
  - Accountant Tools move to a **My Menu** section at the top of the left bar.
  - Users can revert to the classic view from the gear icon, but the classic interface will be phased out.
  - AI agents and expanded **Customer Hub** tools were slated for November.
  - — [Intuit: How QuickBooks Online's new interface impacts accountants](https://quickbooks.intuit.com/global/resources/accountants/quickbooks-new-interface-updates-advisors-faqs/)
- **OLDER (Aug 2023):** Intuit merged Business View and Accountant View into one menu based on Accountant View, in two phases (opt-in, then gradual rollout). "Banking" was renamed **"Transactions"**. — [Firm of the Future (pub. 9 Aug 2023, mod. 18 Apr 2024)](https://www.firmofthefuture.com/product-update/quickbooks-navigation-business-view/); [Intuit CA: Business and Accountant view consolidation](https://quickbooks.intuit.com/ca/resources/accountants/business-and-accountant-view-consolidation/) (search excerpt)
- **OLDER (2022 "Business view"):**
  - UK: Get things done · Business overview · Get paid & pay · Customers & leads · Employees · Bookkeeping · VAT · Apps — [Intuit Community, May 2022](https://quickbooks.intuit.com/community/help-articles-128/understand-the-navigation-menu-in-quickbooks-online-284796)
  - Canada: Business overview (Cash flow, Reports, Planner, Projects) · Get paid & pay (Customers, Invoices, Time, Suppliers) · Payroll (Payroll features, Time) · Bookkeeping (Transactions, Banking, Expenses, Chart of Accounts, Tags). The old menu was kept as "Accountant View". — [Intuit Canada news (Jan 2022)](https://quickbooks.intuit.com/ca/resources/news/new-business-view-navigation-menu-coming-to-quickbooks)
- **OLDER (2017):**
  - Top level: Dashboard · Banking · Sales · Expenses · Employees · Reports · Taxes · Apps · Accounting
  - Sales: Invoices, All Sales, Customers, Products and Services
  - Expenses: Expenses, Vendors
  - Accounting: Chart of Accounts, Reconcile
  - Banking: Bank accounts and credit cards, Bank Rules
  - — [Insightful Accountant, 27 Feb 2017](https://insightfulaccountant.com/accounting-tech/general-ledger/qbo-new-navigation-bar/); [QuickBooks blog (2017)](https://quickbooks.intuit.com/blog/whats-new/quickbooks-launches-new-navigation-to-make-you-more-efficient/)

#### MYOB Business (AU/NZ): current layout since 1 May 2024
- Redesign: the navigation bar moved to the left-hand side, the menu options were revamped, and a new "create" section was added. The post says the changes went live "Wednesday, May 1" (page last updated 9 Apr 2026). MYOB says the functionality did not change. — [MYOB: The new MYOB Business experience is coming to you](https://www.myob.com/au/resources/post/the-new-myob-business-experience-is-coming-to-you)
- The main menu "has moved to the side". The **Create** menu is where you create transactions and records such as invoices, bills, employees, contacts and product items. Other changes: Inventory became **Products & services**, In tray became **Uploads**, and recurring transactions moved out of Sales and Purchases. Settings (⚙️) and a Business menu remain. — [MYOB: Vertical menu and simplified language](https://www.myob.com/au/support/myob-business/get-started/new-side-menu-and-language-in-myob-business)
- Clicking your initials opens the Business menu: My Account, App Marketplace, switch business. — [MYOB announcement](https://www.myob.com/au/resources/post/the-new-myob-business-experience-is-coming-to-you) (search excerpt)
- MYOB describes the areas as follows:
  - Sales: selling to customers and tracking what you are owed
  - Purchases: buying from suppliers and tracking what you owe
  - Banking: money in and out of bank accounts
  - Payroll
  - Inventory
  - Contacts
  - Reports: insight plus ATO/IR compliance
  - It also points to the Dashboard's **Up next** list and the **Create** menu.
  - — [MYOB: Welcome to MYOB Business](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business)
- Menu paths in current help:
  - **Accounting > Create general journal** and **Accounting > General journals** — [MYOB: Adding and finding journal entries](https://www.myob.com/au/support/myob-business/accounting/general-journals/adding-and-finding-journal-entries)
  - **Sales > Customer statements** — [MYOB NZ: Customer statements](https://www.myob.com/nz/support/myob-business/sales/customer-statements)
  - **Sales > Record invoice payment** — [MYOB: Receiving payments](https://www.myob.com/au/support/myob-business/sales/receiving-payments) (search excerpt)
  - **Banking > Bank transactions** and **Banking > Reconcile accounts** — [MYOB: Reconciling your bank accounts](https://www.myob.com/au/support/myob-business/banking/reconciling-your-bank-accounts) (search excerpt)
  - **Reporting > Reports**, Banking section — [MYOB: Fixing out of balance bank reconciliations](https://www.myob.com/au/support/myob-business/banking/reconciling-your-bank-accounts/fixing-out-of-balance-bank-reconciliations) (search excerpt)
- **Sibling desktop product (AccountRight)** still uses "command centres", for example Banking command centre > Spend Money / Receive Money / Transfer Money, and Accounts command centre > Record Journal Entry. — [MYOB: Adding and finding journal entries](https://www.myob.com/au/support/myob-business/accounting/general-journals/adding-and-finding-journal-entries)

#### Sage Accounting (cloud, formerly Sage Business Cloud Accounting)
- UK, under **Settings > Business Settings > Navigation and Data Grids**, there are two options:
  - **Standard**, which Sage recommends for all businesses: a Reporting menu, "Sales" and "Purchases" titles, and an **Adjustments** menu holding Journals and Corrections.
  - **Advanced**: an accounting-based structure for accountants, with **"Sales Ledger"** and **"Purchase Ledger"** titles and an **Accountant** menu that holds Journals, Corrections and reports.
  - — [Sage UK KB (10 Aug 2023, mod. 25 Mar 2024)](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101215)
- A UK Sage Accounting **Start**-tier user reported these tabs: Summary · Sales · Cashbook · Contacts · Banking · Adjustments · Reports · Settings. There was no Purchases tab; replies said purchase invoices need Standard. This is anecdotal (forum). — [Sage Community Hub](https://communityhub.sage.com/gb/sage-accounting-and-individual/f/sage-accounting-start-general-discussion/259769/purchase-tab)
- North America (Canada KB, created 4 Mar 2024, modified 16 Apr 2026):
  - **Sales**: Quotes & Estimates · Sales Invoices (invoices and customer receipts) · Quick Entries · Sales Credit Notes
  - **Expenses**: Vendor Bills · Quick Entries · Vendor Credit Notes
  - **Banking**:
    - New > Bank Account
    - New > Sale/Receipt, with tabs Customer Receipt / Other Receipt / Vendor Refund
    - New > Expense/Payment, with tabs Vendor Payment / Other Payment / Customer Refund
    - New > Bank Transfer
    - Reconcile
    - Make Recurring
  - **Contacts**: Customers / Vendors (Manage > Statements)
  - **Products and services**
  - **Reporting**: Tax Returns; More > Accounts Receivable / Accounts Payable / General Ledger
  - **Journals**: New Journal
  - **Settings**: About your Business · Currencies · Record and Transaction Settings · Chart of Accounts (under Financial Settings) · User Management · Document Preferences · Card Payments · PayPal and Paya
  - — [Sage CA KB: Feature and report access](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191311190)

#### Sage 50 (desktop; older-style navigation)
- **US** Navigation Centers: Business Status · Customers & Sales · Vendors & Purchases · Inventory & Services · Employees & Payroll · Banking · System. Some editions add My Dashboard, Jobs and Cloud & Mobile. Each center is organised by business area. — [Sage 50 US help (2019)](https://help-sage50.na.sage.com/en-us/2019/Content/Basics/Navigation/Navigation_Bar.htm)
- **Canada** (2023 help): the Enhanced view has module pages such as Customers & Sales, Vendors & Purchases and Projects. A Banking module covers transfers, deposits and reconciliation, and there is a Company module. The Classic view uses tabs and some of its modules differ. — [Sage 50 CA help (2023)](https://help-sage50.na.sage.com/en-ca/core/2023/Content/CommonTasks/HomeWindow.htm)

#### Sage Intacct (upper end)
- An **application switcher** sits on the left of the nav bar. Selecting an application name (for example Accounts Payable, Accounts Receivable, General Ledger, Cash Management) opens that application's menu of tasks, lists and reports. To find an AR sales invoice you open Accounts Receivable. The AP ledger and supplier aging reports run from the application menu. Configuration is under each app's Setup tab, and Favorites is a personal cross-app menu. — [Sage Intacct help: All about navigating](https://www.intacct.com/ia/docs/en_GB/help_action/Intacct_basics/New_to_Sage_Intacct/all-about-navigating-intacct.htm)
- Menus can open on click or on hover (user preference). — [Sage Intacct help: Display preferences](https://www.intacct.com/ia/docs/en_US/help_action/Intacct_basics/Personal_preferences/display-prefs.htm) (search excerpt)
- The 2026 R3 (August 2026) release added a cross-product "product switcher" (Sage Expense Management, HR) to the nav bar. — [Intellitec Solutions (partner)](https://intellitecsolutions.com/what-matters-to-you-in-the-2026-r3-sage-intacct-updates/) (search excerpt)

### Inferences
- How the labels line up across products (built from the findings above):

| 7Soft | Xero (2025) | QBO (2025–26) | MYOB Business (2024) | Sage Accounting | Sage Intacct |
|---|---|---|---|---|---|
| Master | Contacts; Sales > Products and services; Accounting > Chart of accounts; Settings | Customers (pinned) / Customer Hub; settings gear | Contacts; Products & services; Categories (Chart of accounts) | Contacts; Products and services; Settings > Chart of Accounts | per-app Setup / lists |
| Pembelian (+AP) | Purchases | Expenses & Bills | Purchases | Purchases (UK) / Expenses (NA) / Purchase Ledger (Advanced) | Purchasing + Accounts Payable |
| Penjualan (+AR) | Sales | Sales & Get Paid | Sales | Sales / Sales Ledger (Advanced) | Order Entry + Accounts Receivable |
| Kas-Bank | Accounting > BANKING; + Spend/Receive/Transfer money | Accounting hub (Reconcile); "Transactions" | Banking | Banking | Cash Management |
| GL / close | Accounting > ACCOUNTING TOOLS; lock dates in settings | Accounting hub; Settings > Close the books | Accounting | Journals / Adjustments / Accountant | General Ledger |
| Analisa | Reporting (+ Analytics by Syft) | Reports; Feed | Reporting | Reporting | Reports / Dashboards |
| Fasilitas | central Settings page + "… settings" in each menu; Advisor "History and notes" | Settings gear | ⚙ Settings; Business menu | Settings | Company / Setup |

- Sage Intacct's "Purchasing" and "Order Entry" are not in the fetched Intacct page. They come from general knowledge and still need checking (see Gaps).
- The structural difference from 7Soft is small at the top level: all of these products group by cycle. Three things differ:
  1. **Contacts** is its own top-level menu (Xero, MYOB, Sage) rather than sitting inside Master.
  2. **Tax** has become its own top-level menu (Xero 2025).
  3. Creation is one global **"+"/Create** menu (Xero, QBO, MYOB), not a "new" item inside each module.
- QBO is the outlier. Its current top level is not a cycle list but a launcher (Home, Feed, Reports, All apps), and the cycle hubs (Sales & Get Paid, Expenses & Bills, Accounting) sit one level down as pinnable apps.

### Gaps
- **QBO hub label:** "Expenses & Pay Bills" was not found in any Intuit page fetched. The US help (updated 5 Aug 2026) says "Expenses & Bills". Regional variants are unverified.
- **QBO hub contents:** the full contents of each QBO hub (Accounting, Sales & Get Paid, Expenses & Bills, Customer Hub, Taxes/Sales tax) are not documented in the pages fetched.
- **Xero:** the NZ Tax submenu was garbled by OCR. Whether users can switch back to the old navigation is unconfirmed: one search excerpt said no, but the fetched campaign page only mentions a 24-hour return to the old dashboard ([Xero campaign page](https://www.xero.com/campaign/new-homepage-navigation/)).
- **MYOB:** the exact order and full list of MYOB Business left-menu items are not given in text on any fetched MYOB page. The menus are evidenced only through help paths.
- **Sage:** the full current UK Sage Accounting Standard menu is not documented in the pages fetched. Sage 50 Accounts UK (desktop) was not researched. The fetched Sage Intacct page names only AP, AR, GL and Cash Management, not the full application list.

## 2. Do SMB tools use "Sales / Purchases (Expenses)" or "Accounts Receivable / Payable" as menu names? Where do customer statements, aged receivables/payables and the customer/supplier ledger live?

### Takeaway
SMB tools name menus by cycle: Sales/Purchases (Xero, MYOB, Sage UK), Sales/Expenses (Sage North America), or task phrases ("Sales & Get Paid", "Expenses & Bills" in QBO). "Receivable" and "Payable" survive in three places:
- report titles, such as Xero "Aged Receivables Summary" and Sage NA "Reporting > More > Accounts Receivable"
- accountant-mode toggles, such as Sage Advanced "Sales Ledger" and "Purchase Ledger"
- the mid-market product, where Sage Intacct's applications are named "Accounts Receivable" and "Accounts Payable"

Statements sit under Sales (MYOB) or on the customer contact (Sage, and Xero via the Invoices page). Aging lives in Reporting. The "ledger card" is the contact record.

### Cited Findings
- Xero: Sales and Purchases are top-level menus, and Sales > Customers and Purchases > Suppliers deep-link into Contacts. "Aged Receivables Summary" and "Aged Payables Summary" are default Favourite reports under Reporting. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- Xero: users asked for "Statements" to be added to the Sales dropdown because sending month-end statements means going through the full Invoices page (about 170–185 votes; Xero says it is monitoring). So statements are not a Sales menu item in the 2025 navigation. — [Xero Product Ideas: Add 'Statements' to Sales drop down](https://productideas.xero.com/forums/967121-users-setup/suggestions/50284551-navigation-add-statements-to-sales-drop-down-m) (search excerpt)
- Xero: users asked for Products & Services under Purchases as well, because it is only under Sales. — [Xero Product Ideas](https://productideas.xero.com/forums/967121-users-setup/suggestions/50486964-navigation-access-product-services-from-both-s) (search excerpt)
- QBO: the hubs are "Sales & Get Paid" and "Expenses & Bills". The AR concept appears as the "Accounts Receivable (A/R)" account behind unpaid invoices. A customer's own page has an Invoices tab, and a parent customer's statement includes sub-customer invoices set to "Bill parent customer". — [Intuit: Understand invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/understand-invoices-quickbooks-online/L52ENtVfF_US_en_US); [Intuit: Enter bills](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/enter-bills-record-bill-payments-quickbooks-online/L1e9Ce5J7_US_en_US)
- QBO (older, 2017): Sales held Invoices, All Sales, Customers and Products and Services. Expenses held Expenses and Vendors. — [Insightful Accountant 2017](https://insightfulaccountant.com/accounting-tech/general-ledger/qbo-new-navigation-bar/)
- MYOB Business: Sales is described as tracking what you are owed, and Purchases as tracking what you owe. — [MYOB: Welcome](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business)
- MYOB Business: statements are at **Sales > Customer statements**, in two types: Invoice (open items as at a date) and Activity (date range with running balance). — [MYOB NZ: Customer statements](https://www.myob.com/nz/support/myob-business/sales/customer-statements)
- MYOB 2024 renames:
  - "Customer returns" → **"Sales returns and credits"**
  - "Supplier returns" → **"Purchase returns and debits"**
  - "Create invoice payment" → **"Record invoice payment"**
  - "Create supplier payment" → **"Record supplier payment"**
  - — [MYOB: Vertical menu and simplified language](https://www.myob.com/au/support/myob-business/get-started/new-side-menu-and-language-in-myob-business)
- Sage Accounting UK: the Standard navigation uses "Sales" and "Purchases". The Advanced navigation renames them **"Sales Ledger"** and **"Purchase Ledger"**. — [Sage UK KB](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101215)
- Sage Accounting NA:
  - Contacts, Customers lets you view, edit, see transactions and statements.
  - Manage, Statements produces customer and vendor statements.
  - Aged balances are at **Reporting, More, Accounts Receivable** and **Reporting, More, Accounts Payable**.
  - Sales, Sales Invoices covers invoices and customer receipts. Expenses, Vendor Bills covers vendor payments.
  - — [Sage CA KB](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191311190)
- Sage Accounting UK statements: **Contacts > Customers > Manage > Statements**, in Standard and Plus only. The statement type is set in Settings > Business settings > Statement settings ("All activity" or "Outstanding items only"). — [Sage UK KB: Customer statements](https://gb-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?solutionid=222001000101184&hypermediatext=null); [Sage help: Statement settings](https://help.accounting.sage.com/en-gb/accounting/settings/statements.html) (search excerpt)
- Sage 50 US uses "Customers & Sales" and "Vendors & Purchases", not AR/AP. — [Sage 50 US help](https://help-sage50.na.sage.com/en-us/2019/Content/Basics/Navigation/Navigation_Bar.htm)
- Sage Intacct uses **Accounts Receivable** and **Accounts Payable** as application names. The AP ledger and supplier aging run from the AP menu. — [Sage Intacct help](https://www.intacct.com/ia/docs/en_GB/help_action/Intacct_basics/New_to_Sage_Intacct/all-about-navigating-intacct.htm)

### Inferences
- 7Soft putting receivables under Penjualan and payables under Pembelian matches the SMB convention, where Sales includes getting paid and Purchases includes paying bills.
- Where 7Soft differs from the SMB pattern:
  - **Aging:** SMB tools put aging (and the AR/AP detail reports) in the central Reporting menu, not inside Sales or Purchases.
  - **Ledger card:** the customer/supplier ledger card is the contact record (Contacts > Customers > activity/transactions), not a report inside Sales.
  - **Statements:** placement is inconsistent across vendors, and Xero users complain about it. A menu item under Sales (MYOB) is the most discoverable option seen.
- "Accounts Receivable/Payable" as menu names signals an accountant audience. Sage only offers them behind the Advanced toggle, and only Intacct uses them by default.

### Gaps
- Not verified for current QBO: where customer statements are and what the A/R aging report is called.
- Not verified for MYOB Business: the path to the aged receivables/payables report. The only path found ("Reports > Index to Reports > Sales") is AccountRight wording on a shared page.

## 3. Is the bank feed / reconciliation the centre of the app, and how does it relate to receipts and payments? (Compare 7Soft BKM/BKK)

### Takeaway
Yes, for Xero, MYOB and QBO. The home screen and Banking/Accounting menus lead with bank accounts, "Reconcile N items" and matching feed lines to invoices and bills. Receipts and payments that are not invoice settlements are quick transactions: Xero and MYOB AccountRight call them Spend money, Receive money and Transfer money; Sage calls them Banking > New > Sale/Receipt and Expense/Payment, with **Other Receipt** and **Other Payment** tabs. These are the closest analogues of 7Soft's BKM and BKK. In SMB tools they are usually created while matching a bank-feed line, not typed in advance as numbered vouchers.

### Cited Findings
- Xero Home opens with bank-account cards comparing Statement balance with Balance in Xero, with "Reconcile 20 items" and "View account transactions". The Tasks list starts with items to be reconciled. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- Xero beta feedback shaped what appears in the banking widget. — [Xero blog, Aug 2025](https://blog.xero.com/product-updates/new-navigation-homepage-coming-soon/)
- Xero's global **+** menu holds Spend money, Receive money, Transfer money and Manual journal. Accounting > BANKING holds Bank accounts and Bank rules, and Bank rules was newly added to that menu. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf); [Xero Product Ideas (13 Oct 2025)](https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/46193578-navigation-bank-rules-add-to-accounting-menu) (search excerpt)
- Xero (older, 2018): the "+" menu already held Spend Money, Receive Money and Transfer Money, and Bank accounts was the first item under Accounting. — [Insightful Accountant 2018](https://insightfulaccountant.com/accounting-tech/general-ledger/xero-in-on-xero-the-new-layout/)
- MYOB Business recommends connecting the bank account so you can match money in and out of the feed against entered invoices and bills. — [MYOB: Welcome](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business)
- MYOB's 2024 renames reframe feeds in plain language:
  - "Set up a bank feed" → "Connect a bank account"
  - "Manage bank feeds" → "Manage bank accounts"
  - "Allocate transaction" → "Categorise transaction"
  - — [MYOB: Vertical menu and simplified language](https://www.myob.com/au/support/myob-business/get-started/new-side-menu-and-language-in-myob-business)
- MYOB reconciliation:
  - **Banking > Bank transactions** has All, Not matched and Matched views, then Reconcile.
  - Manual reconciliation is **Banking > Reconcile accounts**.
  - The reconciliation report is **Reporting > Reports > Banking**.
  - — [MYOB: Reconciling your bank accounts](https://www.myob.com/au/support/myob-business/banking/reconciling-your-bank-accounts); [MYOB: Fixing out-of-balance reconciliations](https://www.myob.com/au/support/myob-business/banking/reconciling-your-bank-accounts/fixing-out-of-balance-bank-reconciliations) (search excerpts)
- MYOB AccountRight (desktop) still puts Spend Money, Receive Money and Transfer Money in the Banking command centre. — [MYOB: Adding and finding journal entries](https://www.myob.com/au/support/myob-business/accounting/general-journals/adding-and-finding-journal-entries)
- QBO history:
  - 2017: Banking moved to the top of the navigation at customers' request, and Bank Rules got its own tab. — [QuickBooks blog 2017](https://quickbooks.intuit.com/blog/whats-new/quickbooks-launches-new-navigation-to-make-you-more-efficient/)
  - 2023: "Banking" was renamed "Transactions". — [Firm of the Future](https://www.firmofthefuture.com/product-update/quickbooks-navigation-business-view/)
  - Now: Reconcile sits at All apps > Accounting > Reconcile, with AI statement upload. — [Intuit reconcile workflow](https://quickbooks.intuit.com/learn-support/en-us/help-article/reconciliation-reports/learn-reconcile-workflow-quickbooks/L8ZibUuVE_US_en_US) (search excerpt)
- QBO: QuickBooks Payments combines each day's sales receipts and paid invoices into one deposit record, reviewed under QuickBooks payouts. — [Intuit: QuickBooks Payments deposits](https://quickbooks.intuit.com/learn-support/en-us/help-article/receive-payments/find-quickbooks-payments-deposits-customer/L80Fh7CSV_US_en_US) (search excerpt)
- Sage Accounting NA banking:
  - **Banking, New, Sale/Receipt**, with tabs **Customer Receipt / Other Receipt / Vendor Refund**
  - **Banking, New, Expense/Payment**, with tabs **Vendor Payment / Other Payment / Customer Refund**
  - **Banking, New, Bank Transfer**, **Banking > Reconcile** and **Make Recurring**
  - Cash is handled as an account: open the Cash account, then New Entry, then Bank Deposit.
  - — [Sage CA KB](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191311190)
- Sage Accounting UK Start tier shows a **Cashbook** tab alongside Banking. — [Sage Community Hub](https://communityhub.sage.com/gb/sage-accounting-and-individual/f/sage-accounting-start-general-discussion/259769/purchase-tab)
- Sage 50 CA has a Banking module for transfers, deposits and reconciliation. Sage Intacct has a Cash Management application, and double-clicking it opens an overview. — [Sage 50 CA help](https://help-sage50.na.sage.com/en-ca/core/2023/Content/CommonTasks/HomeWindow.htm); [Percipient](https://percipient.co.uk/a-simple-guide-to-navigating-sage-intacct/) (search excerpt)

### Inferences
- **Mapping to 7Soft:**
  - BKM ≈ Xero/MYOB "Receive money" ≈ Sage "Other Receipt" (non-invoice), with "Customer Receipt" for invoice settlement.
  - BKK ≈ "Spend money" ≈ Sage "Other Payment", with "Vendor Payment" for bills.
  - Bank-to-bank or cash-to-bank transfer ≈ "Transfer money" / "Bank Transfer".
  - 7Soft's split between invoice settlement (pelunasan, in Penjualan/Pembelian) and BKM/BKK (in Kas-Bank) mirrors Sage. Sage offers both paths for the same receipt: from Sales Invoices, and from the Banking > Customer Receipt tab.
- **Order of work:** SMB tools reverse 7Soft's order. 7Soft is voucher first, reconcile later. SMB tools are feed line first, then match to an invoice or bill, or create Spend/Receive money, so reconciliation falls out of the work. Cash-on-hand or petty cash without a feed is treated as another bank account (Sage's Cash account, Bank Deposit).
- **Voucher numbering:** none of the SMB menus expose voucher-type numbering (BKM/BKK series) as a concept. They expose transaction types (Spend/Receive/Transfer).

### Gaps
- No dedicated bilyet giro or post-dated cheque clearing register was found in any SMB menu researched, and no source addressed it.
- The full QBO "+ Create" list (Expense, Check, Bank deposit, Sales receipt, Receive payment) was not verified this session. An older Intuit page uses "+ New > Receive payment" (search excerpt only).

## 4. Where do manual journals, chart of accounts, opening balances, fixed assets, period lock/close and tax live?

### Takeaway
Accountant-only tools collect in one **Accounting** menu:
- Xero: Bank accounts, Bank rules, Chart of accounts, Fixed assets, Manual journals, plus advisor-only Find and recode, Assurance dashboard and History and notes
- MYOB: Accounting > Create general journal
- QBO: the Accounting hub, including Reconcile

Locks and opening balances live in **Settings** (QBO Close the books, Xero financial settings, MYOB business settings). Tax is a top-level **Tax** menu in Xero since 2025. In Sage NA it sits in Reporting, and in QBO's 2017 and 2022 layouts it was a "Taxes"/"VAT" menu.

### Cited Findings
- Xero Accounting:
  - Standard users get Bank accounts · Bank rules · Chart of accounts · Fixed assets · Manual journals · Accounting settings.
  - Advisors also get Find and recode · Assurance dashboard · History and notes.
  - Manual journal is also in the **+** create menu.
  - — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- Xero lock dates: third-party guides give conflicting paths (Accounting > Advanced > Financial Settings; Settings > General Settings > Financial Settings; Settings > Advanced settings > Financial settings). All agree on two locks: a period lock that binds everyone except advisers, and an adviser lock that binds everyone. Changing them needs the Adviser role. — [Chargebee docs](https://chargebee.com/docs/2.0/integrations/articles-and-faq/how-to-check-the-lock-date-in-xero.html); [Wise-Sync FAQ](https://cw.wise-sync.com/support/solutions/articles/36000041312-faq-setting-and-working-with-lock-dates-in-xero) (search excerpts)
- Xero conversion (opening) balances: setting a conversion date creates an automatic lock on earlier dates. The older path was Accounting > Advanced > Conversion Balances and may be outdated. — [AccountingWEB thread](https://www.accountingweb.co.uk/node/75932) (search excerpt)
- Xero Tax menu items by region are listed in section 1. Xero US help now opens with Tax > Sales tax. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf); [Xero help: Sales tax report](https://help.xero.com/us/Report_SalesTaxAudit) (search excerpt)
- QBO period close:
  - **Settings ⚙ > Account and settings > Advanced > Accounting > Close the books**, with a closing date and a password option.
  - The **Exceptions to Closing Date** report is under Reports.
  - Only primary or company admins can edit closed books.
  - — [Intuit: Close your books](https://quickbooks.intuit.com/learn-support/en-us/help-articles/how-to-close-the-books/00/262219); [Intuit: Edit closed books](https://quickbooks.intuit.com/learn-support/en-us/help-article/customer-company-settings/edit-closed-books/L76xHuaZ5_US_en_US) (search excerpts)
- QBO, older layouts:
  - 2017: Accounting held Chart of Accounts and Reconcile, and Chart of Accounts was also under the Gear. — [Insightful Accountant 2017](https://insightfulaccountant.com/accounting-tech/general-ledger/qbo-new-navigation-bar/)
  - 2022 Business view: Bookkeeping held Transactions, Banking, Expenses, Chart of Accounts and Tags. — [Intuit Canada news](https://quickbooks.intuit.com/ca/resources/news/new-business-view-navigation-menu-coming-to-quickbooks)
  - 2022 UK Business view: "VAT" was a top-level item. — [Intuit Community 2022](https://quickbooks.intuit.com/community/help-articles-128/understand-the-navigation-menu-in-quickbooks-online-284796)
- MYOB Business journals: **Accounting > Create general journal** and **Accounting > General journals**. You can roll back a closed financial year to post a journal, then close it again. — [MYOB: Adding and finding journal entries](https://www.myob.com/au/support/myob-business/accounting/general-journals/adding-and-finding-journal-entries)
- MYOB Business opening balances must match the opening balance date set in the Financial year section of Business settings. — [MYOB: Enter category opening balances](https://www.myob.com/au/support/myob-business/get-started/setting-up/set-up-accounts/enter-account-opening-balances) (search excerpt)
- MYOB 2024 chart-of-accounts renames:
  - "Chart of accounts" → **"Categories (Chart of accounts)"**
  - "Account" → **"Category"**
  - "Account number" → **"Category code"**
  - "Linked account" → **"Linked category"**
  - "Account type" → **"Type"**
  - — [MYOB: Vertical menu and simplified language](https://www.myob.com/au/support/myob-business/get-started/new-side-menu-and-language-in-myob-business)
- MYOB Essentials (the older sibling product) set the lock under Settings > Business details ("Lock my data up to and including"). — [MYOB Essentials help: Locking periods](https://help.myob.com/wiki/display/ea/Locking+periods) (search excerpt)
- MYOB Business puts tax compliance (ATO/IR) under Reports. — [MYOB: Welcome](https://www.myob.com/au/support/myob-business/get-started/welcome-to-myob-business)
- Sage Accounting NA:
  - **Journals, New Journal**
  - Chart of Accounts under **Settings > Financial Settings**
  - GST/HST return under **Reporting, Tax Returns**
  - Tax rates are picked per transaction from a "Tax Rates" menu.
  - — [Sage CA KB](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191311190)
- Sage Accounting UK: the Standard **Adjustments** menu holds Journals and Corrections. In Advanced they move to the **Accountant** menu with reports. — [Sage UK KB](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101215)

### Inferences
- 7Soft's GL module (journal, period close, reports) corresponds to Xero's Accounting plus Reporting. SMB tools do not show "close period" as a menu item: it is a setting (QBO Close the books, Xero lock dates, MYOB business settings), and in Xero it is restricted to advisers.
- Journals are increasingly treated as advisor-only. Sage keeps them in "Adjustments" (Standard) or "Accountant" (Advanced). Xero adds advisor-only tools to the Accounting menu.
- Xero's regional Tax menu, with its own permissions, is the most direct model for an Indonesian tax area (PPN/e-Faktur, PPh) separate from GL.

### Gaps
- Not verified for current QBO: where Chart of accounts, Journal entry, Fixed assets (QBO Advanced) and the sales-tax hub sit in the 2025–26 UI.
- Not found: the period-end or lock-date path in Sage Accounting UK and NA, and the lock-periods path in the current MYOB Business UI.
- Fixed assets in MYOB Business and Sage Accounting was not researched.
- No official current Xero path for lock dates or conversion balances could be fetched, because central.xero.com did not render.

## 5. How do these tools handle retail POS sales and businesses with no credit sales?

### Takeaway
SMB ledgers do not take each till receipt. POS connectors post one summary per day or per register closure, usually as an invoice that is settled straight away by one payment line per payment type. The bank-feed deposit or settlement is then matched to those payments. Receivables in a cash-and-card retailer are therefore transient (opened and closed the same day), and reconciliation happens in the bank feed.

### Cited Findings
- **Lightspeed Retail (X-Series) → Xero:**
  - Closing a register creates an accounts-receivable invoice in Xero, plus a COGS bill if enabled.
  - Each payment type's total is recorded as a payment against the closure invoice. On-account sales are excluded because they post to their own invoice.
  - Batched deposits, such as weekly card settlements, are matched against the invoices for each closure.
  - Lightspeed does not advise on account mapping and refers merchants to an accountant.
  - — [Lightspeed X-Series support: Register closure and reconciliation with Xero](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534183802779-Register-closure-and-reconciliation-with-Xero) (search excerpt; page returned 403)
- **A2X (Shopify, including Shopify POS) → Xero/QBO:**
  - A2X posts summarized entries through Xero's invoice API, so they appear as invoices and Xero's auto-reconciliation can match the payout in the bank feed. — [Xero App Store: A2X](https://apps.xero.com/us/industry/retail/app/a2x) (search excerpt)
  - Shopify Payments sends one daily payout that combines online and in-store sales. Cash, EFTPOS, Afterpay and PayPal arrive separately. Gateways are posted as separate entries, data can be split by POS location, and gateway fees must be booked by the merchant because Shopify does not pass them through. — [A2X blog, 15 Dec 2023](https://www.a2xaccounting.com/blog/shopify-pos-accounting-quickbooks-xero-a2x)
- **Square → QBO (operated by Amaka):**
  - Square describes the sync as one summarised daily invoice, intended to speed up bank reconciliation. — [Square Help: QuickBooks Online and Square](https://squareup.com/help/ca/en/article/7707-quickbooks-online-and-square) (search excerpt)
  - Amaka can post a daily summary invoice or one invoice per order. Default accounts are Square Sales (income), Square Tips and Square Gift Cards (other current liabilities) and Square Fees (expense). Setup is Express, Advanced or Guided. — [Amaka: Square + QuickBooks guide](https://amaka.com/help/guide/square/quickbooks/) (search excerpt)
- QBO natively merges sales receipts and paid invoices into one daily deposit record (QuickBooks payouts). — [Intuit: QuickBooks Payments deposits](https://quickbooks.intuit.com/learn-support/en-us/help-article/receive-payments/find-quickbooks-payments-deposits-customer/L80Fh7CSV_US_en_US) (search excerpt)
- Sage Accounting NA records cash banking as a Bank Deposit from the Cash account. — [Sage CA KB](https://ca-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=240304191311190)

### Inferences
- For a retailer with no credit sales, the SMB pattern is a daily (or per register closure) sales summary per store. Each payment type maps to its own account: cash in drawer, card/EDC, QRIS/e-wallet, gift cards and tips as liabilities, fees as expense. These accounts act as clearing accounts until the bank deposit or processor settlement line is matched. It is posted as an "invoice + immediate payments" so that bank-feed matching works.
- Because the receivable is opened and closed the same day, Sales/AR aging stays empty for pure retail. The real control point is clearing-account balances against bank settlements. That argues for putting POS takings under Banking or Kas-Bank reconciliation rather than under Penjualan receivables.

### Gaps
- Vendor wording that explicitly calls these accounts "clearing accounts" (Lightspeed payment-type mapping, Amaka Square setup) was not retrieved: one page returned 403 and others were only seen in search excerpts.
- Native POS-summary features inside Xero, QBO, MYOB or Sage (as opposed to third-party connectors) were not researched.
- Shopify POS → QBO specifics and MYOB/Sage POS connectors were not covered.

## 6. What UX rationale do vendors and reviewers give for task-based naming versus accounting naming (non-accountant owners versus finance teams)?

### Takeaway
Vendors justify plain, task-based names by pointing to non-accountant owners. MYOB says not everyone is an accountant, Intuit says new users could not find things in a crowded menu, and Xero cites simpler labels and logical groupings that match how businesses work. But accountants who support those owners pushed back against a separate "owner" menu: Intuit dropped its dual Business/Accountant views in 2023 for one menu built on Accountant View. The surviving pattern is one plain-language menu with advisor-gated extras (Xero), an opt-in accountant toggle (Sage Advanced), or a vocabulary swap that leaves functions unchanged (MYOB).

### Cited Findings
- Xero 2025: the guide says the refresh makes things easier to find and to move from task to task, using simpler labels and logical groupings. Sales and Purchases were separated to match how users work. Tax went into regional menus with their own permissions so it is easier to find. — [Xero guide PDF](https://www.plusaccounting.co.uk/wp-content/uploads/2025/09/Your_Guide_To_Xeros_New_Navigation.pdf)
- Xero 2025 (reported): Sales and Purchases were split to fit how businesses actually work, reports moved up so they are no longer buried, and settings were centralised so they are always one click away. — [Fastlane, 19 Jan 2026](https://fastlane-global.com/hk/blog/xero-refreshed-navigation-2026/)
- Xero beta testers: an accountant (Reach CPA, British Columbia) called the separate Sales and Purchases menus a big improvement and liked Tax being prominent. He also asked to hide provincial tax options that don't apply to a client. A Sydney planner praised the cleaner home. — [Xero blog, Aug 2025](https://blog.xero.com/product-updates/new-navigation-homepage-coming-soon/)
- Xero's homepage aims to show key metrics and jobs to be done at a glance, based on customer feedback. — [Xero campaign page](https://www.xero.com/campaign/new-homepage-navigation/)
- Xero friction after launch: requests to add Statements to Sales and Products & Services to Purchases (see section 2). — [Xero Product Ideas](https://productideas.xero.com/forums/967121-users-setup/suggestions/50284551-navigation-add-statements-to-sales-drop-down-m)
- Intuit 2022 (Business view): new customers found it hard to find things because the menu had too many options. The new layout was built on recommended terminology and groupings and on the tasks customers try to complete, then tested before rollout. Users could switch views at any time. — [Intuit Canada news](https://quickbooks.intuit.com/ca/resources/news/new-business-view-navigation-menu-coming-to-quickbooks)
- Intuit 2023 reversal:
  - Accountants said a completely different client menu made it hard to guide clients.
  - Business View had been written so clients see features in their own language. Intuit said it was moving to the same language in both views and consolidated on the Accountant View menu.
  - — [Firm of the Future](https://www.firmofthefuture.com/product-update/quickbooks-navigation-business-view/)
  - Intuit Canada adds that working with clients on a different navigation path was difficult and frustrating for professionals. — [Intuit CA consolidation page](https://quickbooks.intuit.com/ca/resources/accountants/business-and-accountant-view-consolidation/) (search excerpt)
- Intuit 2025 (Intuit Platform UI): Intuit says the change simplifies workflows, improves navigation and gives a cleaner workspace. Accountant tools move into "My Menu" and the classic UI will be phased out. — [Intuit accountant FAQ](https://quickbooks.intuit.com/global/resources/accountants/quickbooks-new-interface-updates-advisors-faqs/)
- Intuit 2017: a reviewer expected clients to find their way around more easily, and said the Accounting menu made Chart of Accounts and Reconcile easy for accountants to direct clients to. — [Insightful Accountant 2017](https://insightfulaccountant.com/accounting-tech/general-ledger/qbo-new-navigation-bar/)
- MYOB 2024:
  - MYOB changed wording to cut financial jargon and accounting terms because not every user is an accountant.
  - It calls "category" a more familiar word than "account", and says the side menu makes things easier to find. — [MYOB: Vertical menu and simplified language](https://www.myob.com/au/support/myob-business/get-started/new-side-menu-and-language-in-myob-business)
  - Its SME general manager framed the goal as making MYOB less daunting for small businesses, and MYOB says functionality did not change. — [MYOB announcement](https://www.myob.com/au/resources/post/the-new-myob-business-experience-is-coming-to-you)
- Sage Accounting: Standard (Sales/Purchases, Reporting, Adjustments) is recommended for all businesses. Advanced reorganises the menus by traditional accounting practice, in accounting terms (Sales Ledger, Purchase Ledger, Accountant), for accountants. — [Sage UK KB](https://gb-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=222001000101215)
- Sage Intacct keeps module naming (Accounts Payable, Accounts Receivable, General Ledger, Cash Management) for finance teams, with click or hover menus, Favorites and drag-to-reorder apps. — [Sage Intacct help](https://www.intacct.com/ia/docs/en_GB/help_action/Intacct_basics/New_to_Sage_Intacct/all-about-navigating-intacct.htm)

### Inferences
- **Three strategies for two audiences:**
  1. One plain menu with role-gated advisor items (Xero: the Advisor user sees Find and recode, Assurance dashboard, History and notes, Adviser reports).
  2. A user-chosen toggle (Sage Standard/Advanced; QBO Business/Accountant view in 2022–23, later abandoned).
  3. A vocabulary swap that leaves functions unchanged (MYOB "Category" for "Account").
- Intuit's reversal is the strongest evidence that two parallel menus cost more in owner-accountant support friction than they save in owner learnability.
- For a 7Soft comparison, the SMB consensus supports keeping cycle-named modules (Purchasing, Sales, Banking, Accounting, Reporting, Settings) with plain task verbs inside, for example "Record invoice payment" and "Receive money". Accountant-only tools (journals, locks, find and recode, history) go behind permission rather than into a separate vocabulary.

### Gaps
- No independent usability research (for example Nielsen Norman Group) or Accounting Today / Accountex coverage of the 2024–2026 redesigns was retrieved. Reviewer commentary here is limited to beta-tester quotes, partner blogs and forum feature requests.
- No vendor published task-success metrics for the redesigns.
