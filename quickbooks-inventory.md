# QuickBooks interface inventory

## Scope and inspection notes

- Source page inspected: QuickBooks Online `Bank transactions` (`/app/banking?jobId=accounting`).
- Workspace shown by the app: **Sample Company**.
- This inventory records visible navigation and controls from the connected account. No transaction was categorized, posted, matched, reconciled, excluded, or edited; no bank was linked; no settings were changed.
- Date and transaction filters were opened to read their options and closed without applying a filter. Table settings were opened and closed without changing a preference.
- This is an observed inventory of the current navigation and Banking page, not a claim that every QuickBooks feature or workflow has been explored.

## Global navigation

- Header: global search; Integrations; Help; Settings; Intuit account; Intuit Intelligence chat.
- Main navigation: Create, Bookmarks, Home, Feed, Reports, All apps, Customize.
- Accounting: Bank transactions, Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, Recurring transactions, My accountant.
- Expenses & Bills: Overview, Expense transactions, Vendors, Bills, Bill payments, Mileage, Contractors, 1099s.
- Sales & Get Paid: Overview, Sales transactions, Invoices, Recurring payments, Sales orders, Sales channels, QuickBooks payouts, Products & services.
- Customer Hub: Overview, Customers & leads, Estimates, Appointments, Reviews.
- Payroll is a direct link.
- Team: Employees, Contractors, Workers' comp.
- Time: Time entries, Schedule.
- Inventory: Overview, Inventory, Purchase orders, Item receipts, Sales orders, Shipping labels.
- Sales Tax: Overview.
- Business Tax: Overview, Tax summary.
- Lending: Overview.
- Marketing is a direct link.

## Accounting → Bank transactions

### Header and account selector

- Page title: Bank transactions.
- Header actions: Update accounts, Open requests, Link account, and a separate Link account menu.
- Account cards/selectors observed: Checking, Savings, Mastercard. Each card shows transaction count, bank balance, QuickBooks posted balance, and an Edit action. Edit and Link account were not opened because they lead to account configuration/connection flows.
- Utility actions: Switch to previous version and Go to bank register.

### Status, search, filters, and paging

- Transaction status tabs: Review, Accepted, Excluded. Review was selected on arrival.
- Search input with a search button.
- Date filter presets: All dates, Custom, Today, Yesterday, This week, This month, This quarter, This year.
- Custom date range has From and To date inputs with calendar buttons, plus Reset and Apply.
- Transaction types: All transactions, Money in, Money out, Ready to post, Suggested matches, Transfers, Rules, Missing From/To, Uncategorized.
- Paging shows the displayed range, page number, and previous/next controls. A table page-size preference is available in Settings.
- Output actions: Print and Export to CSV.

### Table columns and row controls

- Visible columns: row selection; Date; Bank description; Spent; Received; Files/attachments; Requests/conversation; From/To; Match/Categorize; Action.
- Optional columns from table settings: Check No., Customer, Product/Service.
- Row controls observed: attachment button, Start a conversation, customer/vendor picker, category picker, AI recommendations, View AI suggestions or match information, and a row action labelled Post or Match depending on the transaction.
- These row actions can alter or post financial records, so they were recorded from the UI and not activated.

### Table settings (observed values; left unchanged)

- **Columns:** Date (required/on); Check No. (off); Bank description (required/on); Spent (required/on); Received (required/on); Files (on); Requests (on); From/To (on); Customer (off); Product/Service (off); Match/Categorize (required/on); Action (required/on). The menu says columns can be dragged to reorder.
- **Automation:** Add new vendors control is shown and enabled.
- **Other preferences:** Group and sort by column (off); Show amount as spent and received (on); Make date field editable (off); Show full bank description (off); Copy full bank description to memo (off); Alternate row color (on); Show match/categorize toggle inline (off); Warn if missing vendor/customer (off).
- **Page size:** 50 selected; options 75, 100, 200, 300.

## Prototype coverage guidance

The separate QuickBooks prototype should reproduce the observed Bank transactions screen with synthetic rows and local-only controls. Mark other modules or workflows as not inspected until they are directly explored. The menu inventory above is navigation discovery only; it does not describe the fields or behavior of each linked module.

## Additional Accounting pages inspected

### Integration transactions

- Connector catalog cards observed: Amazon Business Purchases, Shopify, PayPal, Squarespace, Square, Wix / Website by Wix, Etsy, eBay, Amazon, WooCommerce, and BigCommerce.
- Card actions: Learn more and Connect free integration.
- These actions would leave the catalog or start linking an external service; they were not activated. No filters or transaction list were visible on the inspected screen.

### Receipts

- Tabs: For review and Reviewed.
- Receipt upload entry points: Upload receipts menu and Upload from this device. The page also shows a drag-and-drop area. No file was selected or uploaded.
- List actions: Filter, Export, Settings, column sorting/resizing, and page navigation.
- Table columns: bulk selection, Receipt, Created by, Date, Vendor, Payment account, Amount / Tax, Category, Action. The list was empty, so row-specific actions remain unknown.
- Filter fields: Dates (Custom, Since 365 Days Ago, This Month, This Quarter, This Year, Last Month, Last Quarter, Last Year); From and To; Account/Category; Amount condition (Between, Less Than, Greater Than, Equals); Minimum and Maximum; Reset, Apply, Close.
- Customize drawer: Sort (currently Date descending); Rows per page (10), row height (Comfortable), Alternate row color; configurable columns Created by, Date, Vendor, Payment account, Amount / Tax, Category. Receipt and Action remain visible outside the configurable column list.
- The page offers receipt ingestion by upload or drag/drop. Its email-ingestion address was deliberately not copied into this inventory.

### Reconcile

- Current state is an onboarding panel: Connect now, Video tutorials, and Get started.
- No reconciliation list, fields, or filters were visible before starting setup. Get started and bank connection were not activated because later steps may affect financial records or account connections.

### Rules

- Tabs: Bank rules and Integration rules.
- Empty list controls: New rule and its adjacent menu; search by name or conditions; status filter (All rules); Settings.
- Table columns: selection, Priority, Rule name, Applied to, Conditions, Settings, Auto-post, Status, Actions. The list showed zero rows.
- The adjacent New rule menu includes Export rules (disabled) and Import rules. Import and rule creation were not activated.
- A static onboarding illustration shows a sample rule form with name, transaction direction, account, conditions, and an Add a condition affordance; it is not an active saved rule.

### Chart of accounts

- Controls: Filter by name or number; account scope filter (All, Created by users, Balance sheet accounts, Profit and loss accounts, Locked accounts only, Unlocked accounts only, Parent accounts only, Subaccounts only); Run report; New account and adjacent menu; Batch edit; Export chart of accounts; Print; Customize.
- Table columns: selection, Name, Account type, Detail type, QuickBooks balance, Bank balance, Action. Column headers expose sort/filter menus and resize controls.
- Per-row actions include View register or Run report, each with an adjacent action menu. No account was edited, selected, opened, or exported. Account names and balances are not copied into this inventory.
- The visible list contains 75 accounts per page with page navigation.

### Recurring transactions

- Controls: Filter by Name + Filter, an All state label, Reminder List and its menu, New, Manage recurring payments, Print, Settings.
- Filter fields: Template Type (All, Scheduled, Reminder, Unscheduled) and Transaction Type (All, Bill, Non-Posting Charge, Check, Non-Posting Credit, Credit Card Credit, Credit Memo, Deposit, Estimate, Expense, Invoice, Journal Entry, Payment, Refund, Sales Receipt, Transfer, Vendor Credit, Purchase Order); Reset, Apply, Close.
- Table columns: Template Name, Type, TXN Type, Interval, Previous Date, Next Date, Customer/Vendor, Amount, Action. Example rows were visible; their labels and amounts are omitted here. Per-row controls include Edit and an action menu. No template was opened, edited, generated, or deleted.

## Coverage status

- Banking page: detailed visible-screen inventory recorded above.
- Accounting: Integration transactions, Receipts, Reconcile, Rules, Chart of accounts, and Recurring transactions now have visible-screen notes.
- Other Accounting destinations (including My accountant) and the remaining Expenses & Bills, Sales & Get Paid, Customer Hub, Team, Time, Inventory, tax, lending, and reports pages are still uninspected beyond their sidebar labels.

### Bills

- Tabs: For review, Unpaid, Paid, Recurring. The inspected Unpaid list has Vendor and Bill Date controls, a Filters popover, Print, Export, and Table settings.
- Filters: Vendor selector; Bill Date preset/date-range control; advanced Status (All, Overdue, Due today, Due soon, Due later) and Category; Apply, Reset, Close.
- Visible columns: selection, Vendor, Due date, Bill amount, Open balance, Status, Action. Per-row action shown: Schedule payment and adjacent menu. These payment controls were not activated.
- Table settings: default columns Vendor, Due Date, Bill Amount, Open Balance, Status; optional Bill Pay ACH info, Source, Bill No., Bill Date, Category, Class, Location, Memo, Attachments. Rows per page (50), row height (Cozy), Alternate row color (off); current sort is Due Date ascending. Preferences were left unchanged.
- Header actions: Manage email settings, Pay bills and its menu, Add bill and its menu. A receipt-to-bills email ingestion banner is present; its private address is intentionally omitted. No payment, bill entry, import, or email setting was used.

### Bill payments

- Page is visible in navigation but returns “Looks like you don't have access”; no table, filters, or actions can be inventoried without a company administrator changing access.

### Mileage

- Initial onboarding prompt offers Add a trip manually and Skip for now. Opening the page reveals tax-year selector, potential deduction summary, business-trip totals, vehicle summary, Unreviewed/Business/Personal/All tabs, trip search, and an empty trip table with Date, Location, Distance, Potential Deductions, Vehicle, Type.
- Add trip form fields: date, distance (mi), Start point, End point, Business/Personal, Business purpose, Vehicle, Round Trip switch; Save and Close. The blank form was closed without saving. The page also exposes Add trip menu and Manage vehicles; these were not activated.

### Contractors

- Controls: Search contractors, Active status filter, View 1099 filings, Prepare 1099s, Add a contractor, Bulk pay contractors, Table settings, paging. Contractor cards include a status and W-9 readiness indicator, View Last Payment, Write check, and row menu; no contractor record, payment, or check was opened or changed.
- Table settings show sort by name (ascending) and rows per page (50).
- Add a contractor form fields: Name, Email, and a checked-by-default option to email the contractor to complete their profile; Add contractor and Close. The form was closed without entering data or sending an invite.
- Actual contractor identity and payment details are excluded from this inventory.

### 1099s

- E-file landing tab presents Try autofilled forms and Prep my own via QuickBooks flows, filing information/pricing, and FAQs. No filing/preparation flow was started.
- Tabs include E-file, Recipients & W-9s, Completed forms. Recipient/W-9 and completed-form details were not opened because they expose tax identity data. No form was prepared, filed, or sent.

## Expenses & Bills coverage status

- Detailed visible-screen notes now cover Expense transactions, Vendors, Bills, Mileage, Contractors, and the 1099 E-file landing page.
- Bill payments is access-restricted. Expense overview remains a loading/skeleton state without usable fields. Forms, settings, payment controls, and record-level actions with financial consequences were not submitted or activated.

## Sales & Get Paid pages inspected

### Sales transactions

- Summary cards link to estimates, unbilled income, overdue invoices, open invoices/credits, and recently paid transactions. Controls: Batch actions, Type, Date, Customer, Status, Delivery method, Transaction errors, Create invoice, New transaction, Print, Export, Quick links, Table settings.
- Type options: All transactions, Invoices, Estimates, Change orders, Credit memos, Sales Receipts, Unbilled Income, Money received, Recently paid. Date options: All, Custom dates, Today, Yesterday, This week, Last week, This month, Last month, Last 30 days, This quarter, Last quarter, Last 3 months, Last 6 months, Last 12 months, Year to date, This year, and 2025. Status options: All, Open, Overdue, Paid, Pending, Accepted, Closed, Converted, Declined, Expired, Voided. Delivery method: Any, Send later, Print later. Errors: None, Delivery errors, Payment processing errors.
- Default columns: Date, Type, No., Customer, Memo, Amount, Status, Action. Optional columns: Due date, Balance, Method, Email, Aging, Last Delivered, Attachments, Total before sales tax, Sales tax. Row actions can include View/Edit, Receive payment, Print, Convert to invoice/Create invoice, and More actions; none were used. Sample record values are excluded.
- New transaction menu: Invoice, Import invoices, Payment, Estimate, Payment Link, Sales Receipt, Credit Memo, Refund Receipt, Delayed Credit, Delayed Charge, Time Activity, Sales Order.
- Blank invoice form was opened then left unsaved. Fields observed: Customer; Terms; Invoice date; Due date; Tags; line item Product or service, Description, Quantity, Rate, Amount, Tax; customer payment instructions; Note to customer; Internal customer notes; Memo on statement; Attachments; Discount (% or currency); Sales tax rate; Charge a deposit; Edit totals. Actions include add/paste/clear line items, Print or download, Make recurring, Save, Review and send, and form customization/manage controls. The unsaved invoice was discarded.

### Invoices

- Tabs: All invoices. Moneybar summary links: unpaid, overdue, not due yet, paid, not deposited, deposited. Filters: Status (All, Needs attention, Unpaid, Overdue, Not due, Paid, Not deposited, Deposited) and Date (Today, Yesterday, This week, Last week, This month, Last month, Last 30 days, This quarter, Last quarter, Last 3 months, Last 6 months, Last 12 months, Year to date, This year, 2025).
- Table columns: selection, Date, No., Customer, Amount, Status, Action. Table settings make Invoice number, Balance, and Due date optional; page size 50/100/200/300. Actions: Create invoice and its menu, Table settings, row View/Edit, Receive payment, Print, More actions; no action that changes a record was used.
- An Add files area offers spreadsheet/file-based invoice creation; no file was selected or uploaded.

### Recurring payments

- Page is an onboarding view for payment setup, with Set up payments and View sample recurring payment. The payment setup action was not started. The read-only sample shows Edit/Email view/Payor view/Receipt view tabs, Customer, Product/service line area, internal customer notes, statement memo, total, and Activate payments; the sample was closed without edits.

### Sales orders

- Page shows an onboarding view and Create sales order. The new form was inspected then discarded without saving. Fields: Customer name, Contact info, Mailing address, Sales order number/date, Terms, Due date; line-item Product/service, Description, Qty, Rate, Amount, Tax; Note to customer, Internal memo, Attachments; Discount, Sales tax, Deposit request. It also has customization, discounts/fees, design, and customer reports panels. No customer or item data from the prefilled sample form is copied here.

### Sales channels and QuickBooks payouts

- Sales channels is a setup screen with Connect sales channel and learning links; no channel was connected.
- QuickBooks payouts is a setup screen with Get started; no payment setup was started. Neither page displayed a list, filters, or record actions before setup.

### Products & services

- List controls: All Lists; More menu; New product/service; low-stock and out-of-stock filters; search; Filter; Print list; Export to Excel; Settings. Visible columns: Name, SKU, Type, Sales description, Sales price, Cost, Taxable, Qty on hand, Reorder point, Action.
- New product/service type menu: Inventory, Non-inventory, Service, Bundle. The blank Service form shows Name, SKU, image controls, Category, Description, “I sell this product/service to my customers,” Sales price/rate, Income account, Sales tax, Purchasing information, and a “I purchase this product/service from a vendor” checkbox. Show more and Save and close are available. Form closed without saving. Sample item names, costs, quantities, and prices are omitted.

## Customer Hub pages inspected

### Customers & leads

- Tabs: Customers and Leads; Leads was empty in this tenant. Customers controls: Customer types, New customer and menu, moneybar links, Search, Print, Export, Settings, paging. Default columns: Name, Company name, Phone, Open balance, Action. Optional columns: Address, Mobile, Email, Sales tax, Customer type, Attachments; Include inactive; page size 50/75/100/150/300. Per-customer actions can include Receive payment, Create invoice, and an adjacent menu. No customer record was opened or acted on. Names, contact details, and balances are not copied.
- New customer form sections and fields: **Name and contact** (Title, First name, Middle name, Last name, Suffix, Company name, required Customer display name, Email, Phone number, Cc, Bcc, Mobile number, Fax, Other, Website, Name to print on checks, Is a sub-customer); **Communication permissions** (email consent notice); **Addresses** (Billing street 1/2, City, State, ZIP, Country, Shipping address, default shipping address, saved addresses); **Notes and attachments**; **Payments** (Primary payment method, Terms, Sales form delivery options, invoice language, Credit Limit); **Additional info** (Customer type, exemption details, taxable switch, Default tax code, Opening balance, As of); **Custom fields**; **Relationships & Sales** (Sources, Referred by, Job title, Role, Preferred contact method, Industry, Social media). The form was closed without data entry or save.

### Estimates

- Controls: Create estimate; Batch actions (disabled); Status and Date filters; table settings; paging. Default columns: Date, No., Customer, Amount, Status, Action. Rows show View/Edit, Print, More actions. Existing sample record values were excluded and no row was opened.
- Filters shown: Status and Date (default Last 12 months); filter menus were not opened on this page.
- Blank estimate form fields: Customer; Estimate date; Expiration date; Accepted by; Accepted date; line item Product/service, Description, Qty, Rate, Amount, Tax rate, Tax; customer payment instructions; Note to customer; Memo on statement; Attachments; Discount (% or currency); Sales tax rate; Deposit request (% or currency); Edit totals. Form actions include Export/Paste line items, Add product/service, Clear all lines, Print or download, Make recurring, Save, Review and send, customization/manage controls. Manage sections show Customization, Discounts and fees, Design, Progress invoicing, Scheduling. Intro tip was dismissed; blank estimate was closed without saving. E-signature activation and payment activation were not used.

### Appointments

- First-visit setup asks whether to schedule yourself or let the customer schedule; it was closed without choosing. List view controls: Settings, Schedule appointment, List/Calendar view, Upcoming/Past, Customer name, Date range (All appointments), Clear filters. No upcoming appointments were listed.
- New appointment first step: Scheduling type (Schedule an appointment or Invite a contact to schedule), Appointment type (In-person appointment or Video call), Customer/Lead selector, Back, Next. It was closed before selecting a contact or continuing, so later scheduling fields remain uninspected. No invitation or appointment was sent.

### Reviews

- Table headers: Date, Customer, Rating, Feedback/Testimonial, Actions. The page returned “Something isn't working / Try again later”; no rows, filters, or actions could be inspected.
