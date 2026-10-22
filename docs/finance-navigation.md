# Finance navigation

17 October 2026. Source: `frontend-hub/src/screens/finance/nav.ts`.

The sidebar keeps nine destinations. Overview stands first; the other menus
are grouped by the work they support. A menu has at most five tabs. Each tab
opens a page; related ways of reading that work use the labelled View choice.
On phones, the same tabs and views are available from the menu's dock button.

| Group | Menu | Tabs |
| --- | --- | --- |
| — | Overview | Cash and bank, payables, cash flow and inventory figures; needs attention; upcoming and overdue payments; supporting charts |
| Daily work | Stores | Sales · Settlement · Deposits · Cash · Cash counts |
| Daily work | Payables | Bills · Due dates · Suppliers · Credit notes · Loans |
| Daily work | Cash & Bank | BKK · BKM · Giro · Bank · Advances |
| Accounting | Journal | Entries · Templates |
| Accounting | Assets | Register · Projects · Disposals |
| Accounting | Month End | Checklist · Periods · Accruals · Inventory · Tax |
| Accounting | Reports | Profit and loss · Balance sheet · Cash flow · Ledger · Sales by division |
| Configuration | Setup | Searchable groups: Accounts · Posting · Categories · Payments · Tax · Assets |

Settlement and deposits are independent tabs rather than views of sales.
Credit notes are independent of bills, advances of outgoing cash documents,
disposals of the asset register, and periods of the closing checklist.
Recurring bills remain a view of Bills. The due-date calendar and aging remain
views of Due dates. Bank contains reconciliation, accounts, statement lines,
the month summary, and matching rules.

The Overview's figures and chart headings link to the supporting screens.
Payment rows open the corresponding bill or journal entry; giro rows open
the Giro board. Exact KPI amounts are available on the compact figures.

All 86 registered routes, 59 tab destinations and 17 Setup destinations are
retained. This update changes navigation, the Overview and the Setup index;
it does not establish that every transaction form and legacy report has been
migrated to the current design system.
