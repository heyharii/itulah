import {
  ArchiveX,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRightFromLine,
  BadgeDollarSign,
  BadgePercent,
  Banknote,
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Coins,
  Copy,
  CreditCard,
  FileClock,
  FileMinus,
  Files,
  FileSpreadsheet,
  Filter,
  FolderTree,
  GitBranch,
  HandCoins,
  HardHat,
  Hourglass,
  Kanban,
  KeyRound,
  Landmark,
  Laptop,
  ListTree,
  Package,
  Percent,
  PieChart,
  PiggyBank,
  Printer,
  Receipt,
  ReceiptText,
  Repeat,
  Scale,
  ScanSearch,
  Settings,
  Shapes,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Split,
  Store,
  Table2,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  WalletCards,
  Waves,
  Workflow,
  Wrench,
} from "lucide-react"

import type { AppModule, NavItem, NavSection, NavTab } from "@/lib/navigation"
import {
  useMonthNotOpenCount,
  useOverdueBillCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"
import { useUnagreedLineCount } from "@/screens/finance-lab-2/hooks"

/// Finance as nine doors (owner, 2026-10-16: "sekarang saya lebih suka sedikit
/// menu seperti ini … buat final prototypenya", then "assets sendiri saja, tax
/// gapapa"). Picked from `finance-final-prototype.html`, which corrected the
/// "Workspace kerja" split of `public/prototypes/finance-navigation`.
///
/// # A door
///
/// One row for the screens that answer one job, drawn as tabs under the row's
/// name (`NavItem.tabs`, drawn by `PageHeader`). Where two screens are one
/// place read two ways — Aging and the payment calendar are both "what is
/// due" — they are one tab and a choice of view beside the tabs.
///
/// | Door | Tabs |
/// |---|---|
/// | Overview | — |
/// | Stores | Sales · Settlement · Deposits · Cash · Cash counts |
/// | Payables | Bills · Due dates · Suppliers · Credit notes · Loans |
/// | Cash & Bank | BKK · BKM · Giro · Bank · Advances |
/// | Journal | Jurnal · All Jurnal · Templates |
/// | Assets | Register · Projects · Disposals |
/// | Month End | Checklist · Periods · Accruals · Inventory · Tax |
/// | Reports | Profit and Loss · Balance Sheet · Cash Flow · Ledger · Sales by Division |
/// | Setup | one page of every master (`setup-index.tsx`) |
///
/// # Every screen kept
///
/// Nothing was deleted. A screen that is not a door's first is a `hidden` item
/// below, under the name it had, so ⌘K still finds "Supplier Bills" and lands
/// on Payables › Suppliers. Paths are the frozen tree's of 2026-09-26: a link
/// or a bookmark still lands. Two screens are on no door: Accounts Receivable
/// (no debtor book; card takings go straight to the bank, 2026-10-01) and the
/// Payments Dashboard, which the Overview already holds.
///
/// No row's path is a prefix of another door's: the sidebar lights a row when
/// the address equals one of its paths or starts with it plus a slash.

/// A door's row: the first view of its first tab, lit on every other path its
/// tabs name.
function door(
  row: Omit<NavItem, "path" | "alsoLights"> & { tabs: readonly NavTab[] }
): NavItem {
  const paths = row.tabs.flatMap((tab) => tab.views.map((view) => view.path))
  return { ...row, path: paths[0], alsoLights: paths.slice(1) }
}

const one = (label: string, path: string): NavTab => ({
  label,
  views: [{ label, path }],
})

/// What the Setup page lists, group by group, by path. The page reads the
/// labels and icons off the items themselves.
export const financeSetupGroups: readonly {
  readonly label: string
  readonly paths: readonly string[]
}[] = [
  {
    label: "Accounts",
    paths: [
      "/finance/accounting/chart-of-accounts",
      "/finance/settings/accounts",
      "/finance/setup/dimensions",
    ],
  },
  {
    label: "Posting",
    paths: [
      "/finance/setup/account-links",
      "/finance/setup/posting-readiness",
      "/finance/settings/posting-policies",
      "/finance/settings/permissions",
    ],
  },
  {
    label: "Categories",
    paths: [
      "/finance/setup/pay-components",
      "/finance/setup/expense-categories",
      "/finance/setup/line-categories",
    ],
  },
  {
    label: "Payments",
    paths: [
      "/finance/setup/payment-methods",
      "/finance/setup/shop-payment-methods",
      "/finance/setup/edc-mdr",
      "/finance/setup/giro-templates",
    ],
  },
  {
    label: "Tax",
    paths: ["/finance/tax-setup/types", "/finance/tax-setup/withholding"],
  },
  { label: "Assets", paths: ["/finance/setup/asset-classes"] },
]

export const financeNav: AppModule = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  // No Overview row (owner, 28 Oct 2026): the module lands on the first 7Soft
  // menu, Info Kas Bank. The dashboard stays reachable at its URL and in ⌘K.
  home: "/finance/stores/daily-close",
  base: "/finance",
  moved: [
    // The modules the frozen tree replaced on 2026-09-26.
    "/finance-lab",
    "/finance-lab-2",
    "/finance-final",
    // Rows of the frozen tree that never had a screen, and whose job is not
    // Accounting's in ERPNext either: payroll runs are HR's (Payroll Entry
    // lives in HRMS), and stock value is the Stock app's.
    "/finance/payroll/runs",
    "/finance/reports/payroll-cost",
    "/finance/reports/inventory-valuation",
    "/finance/reports/interunit",
  ],
  sections: [
    {
      items: [
        // ── the nine doors ──
        {
          path: "/finance/dashboard",
          label: "Overview",
          icon: ChartColumn,
        },
      ],
    },
    {
      label: "Daily work",
      chip: true,
      items: [
        door({
          label: "Stores",
          icon: Store,
          tabs: [
            {
              label: "Sales",
              views: [
                { label: "Sales by day", path: "/finance/stores/sales" },
                {
                  label: "Sales postings",
                  path: "/finance/receivables/sales-postings",
                },
              ],
            },
            one("Settlement", "/finance/receivables/card-settlement"),
            one("Deposits", "/finance/cash-bank/deposits"),
            {
              label: "Cash",
              views: [
                { label: "Balances", path: "/finance/stores" },
                {
                  label: "Cash on hand",
                  path: "/finance/stores/cash-on-hand",
                },
                { label: "Petty cash", path: "/finance/stores/petty-cash" },
                {
                  label: "Cashier float",
                  path: "/finance/stores/cashier-float",
                },
                { label: "Positions", path: "/finance/cash-bank/petty-cash" },
                {
                  label: "Movements",
                  path: "/finance/cash-bank/cash-transactions",
                },
              ],
            },
            {
              label: "Cash counts",
              views: [
                { label: "Counts", path: "/finance/stores/cash-counts" },
                { label: "Last counted", path: "/finance/reports/cash-bank" },
              ],
            },
          ],
        }),
        door({
          label: "Payables",
          icon: Receipt,
          badge: "warn",
          useCount: useOverdueBillCount,
          moved: ["/finance/bills"],
          tabs: [
            {
              label: "Bills",
              views: [
                { label: "Bills", path: "/finance/payables/bills" },
                {
                  label: "Recurring bills",
                  path: "/finance/payables/recurring-bills",
                },
              ],
            },
            {
              label: "Due dates",
              views: [
                {
                  label: "Payment calendar",
                  path: "/finance/payables/projection",
                },
                { label: "Aging", path: "/finance/payables/aging" },
              ],
            },
            {
              label: "Suppliers",
              // 7Soft's Info Pembelian (Supplier, Pembelian & Retur,
              // Pelunasan Hutang, Summary Hutang, Kartu Hutang) and its
              // Laporan Pembelian: the same two screens, under the names
              // 7Soft gives them. Paths unchanged.
              views: [
                {
                  label: "Info Pembelian",
                  path: "/finance/payables/supplier-ledger",
                },
                {
                  label: "Laporan Pembelian",
                  path: "/finance/reports/accounts-payable-summary",
                },
              ],
            },
            one("Credit notes", "/finance/payables/credit-notes"),
            one("Loans", "/finance/financing/loans"),
          ],
        }),
        door({
          label: "Cash & Bank",
          icon: Wallet,
          // Amber: an unagreed bank line is a backlog, not a stoppage.
          badge: "warn",
          useCount: useUnagreedLineCount,
          moved: ["/finance/cash-bank/cash-documents"],
          tabs: [
            one("Kas/Bank", "/finance/cash-bank/kas-bank"),
            one("Kartu Kas/Bank", "/finance/cash-bank/kartu"),
            one("BKM", "/finance/cash-bank/bkm"),
            one("BKK", "/finance/cash-bank/bkk"),
            one("Giro", "/finance/cash-bank/giro"),
            {
              label: "Bank",
              views: [
                {
                  label: "Reconciliation",
                  path: "/finance/cash-bank/bank-reconciliation",
                },
                { label: "Accounts", path: "/finance/cash-bank/bank-accounts" },
                {
                  label: "Statement lines",
                  path: "/finance/cash-bank/bank-transactions",
                },
                {
                  label: "Month summary",
                  path: "/finance/reports/bank-reconciliation-summary",
                },
                {
                  label: "Matching rules",
                  path: "/finance/cash-bank/bank-rules",
                },
              ],
            },
            one("Advances", "/finance/receivables/employee"),
          ],
        }),
      ],
    },
    {
      label: "Accounting",
      chip: true,
      items: [
        door({
          label: "Journal",
          icon: BookOpenCheck,
          moved: [
            "/finance/journal",
            "/finance/accounting/adjustments",
            "/finance/accounting/recurring",
            "/finance/payroll/posting",
            "/finance/interunit/financing",
            "/finance/interunit/goods",
            "/finance/interunit/other",
            "/finance/interunit/reconciliation",
          ],
          tabs: [
            one("Jurnal", "/finance/accounting/journal-entries"),
            one("All Jurnal", "/finance/accounting/all-journals"),
            one("Templates", "/finance/setup/journal-templates"),
          ],
        }),
        door({
          label: "Assets",
          icon: Laptop,
          moved: [
            "/finance/assets",
            "/finance/assets/cip",
            "/finance/assets/depreciation",
            "/finance/assets/amortisation",
            "/finance/assets/replacement",
            "/finance/assets/disposal",
            "/finance/reports/asset-nbv",
          ],
          tabs: [
            {
              label: "Register",
              views: [
                { label: "Assets", path: "/finance/assets/capitalization" },
                {
                  label: "By category",
                  path: "/finance/reports/asset-register",
                },
              ],
            },
            one("Projects", "/finance/assets/contractor-projects"),
            one("Disposals", "/finance/reports/asset-disposals"),
          ],
        }),
        door({
          label: "Month End",
          icon: CalendarCheck,
          // The only screen that OPENS a month sits in this door. Nothing can
          // be posted into a month that does not exist, which somebody usually
          // discovers at the till rather than here — hence the badge.
          badge: "warn",
          useCount: useMonthNotOpenCount,
          tabs: [
            {
              label: "Checklist",
              views: [
                { label: "Checklist", path: "/finance/period-close" },
                {
                  label: "Closing voucher",
                  path: "/finance/closing/period-closing-voucher",
                },
              ],
            },
            one("Periods", "/finance/setup/periods"),
            {
              label: "Accruals",
              views: [
                {
                  label: "Unbilled expenses",
                  path: "/finance/payables/accruals",
                },
                {
                  label: "Prepaid expenses",
                  path: "/finance/accounting/prepaids",
                },
                {
                  label: "Accrual balances",
                  path: "/finance/accounting/accruals",
                },
              ],
            },
            {
              label: "Inventory",
              views: [
                {
                  label: "Stock vs ledger",
                  path: "/finance/inventory/stock-vs-ledger",
                },
                { label: "Valuation", path: "/finance/inventory/valuation" },
                {
                  label: "In transit",
                  path: "/finance/inventory/goods-in-transit",
                },
                {
                  label: "Adjustments",
                  path: "/finance/inventory/adjustments",
                },
                {
                  label: "COGS",
                  path: "/finance/inventory/cogs",
                },
              ],
            },
            {
              label: "Tax",
              views: [
                { label: "Tax payables", path: "/finance/tax/payables" },
                { label: "Withheld", path: "/finance/reports/tax-withholding" },
              ],
            },
          ],
        }),
        door({
          label: "Reports",
          icon: TrendingUp,
          moved: ["/finance/reports", "/finance/reports/site-pl"],
          tabs: [
            {
              label: "Profit and loss",
              views: [
                {
                  label: "Standard",
                  path: "/finance/reports/profit-and-loss",
                },
                {
                  label: "By unit, 2 years",
                  path: "/finance/reports/profit-and-loss-by-unit",
                },
                {
                  label: "Expenses by month",
                  path: "/finance/reports/expenses-by-month",
                },
                {
                  label: "By dimension",
                  path: "/finance/reports/dimension-results",
                },
                {
                  label: "Laporan Accounting",
                  path: "/finance/reports/laporan-accounting",
                },
              ],
            },
            {
              label: "Balance sheet",
              views: [
                { label: "Standard", path: "/finance/reports/balance-sheet" },
                {
                  label: "2 years",
                  path: "/finance/reports/balance-sheet-2-years",
                },
                {
                  label: "Changes in equity",
                  path: "/finance/reports/changes-in-equity",
                },
              ],
            },
            one("Cash flow", "/finance/reports/cash-flow"),
            // One book read two ways (owner, 2026-10-16: at most five tabs a
            // door).
            {
              label: "Ledger",
              views: [
                {
                  label: "General Ledger",
                  path: "/finance/accounting/general-ledger",
                },
                {
                  label: "Trial Balance",
                  path: "/finance/accounting/trial-balance",
                },
              ],
            },
            one("Sales by division", "/finance/reports/sales-by-division"),
          ],
        }),
      ],
    },
    {
      label: "Configuration",
      chip: true,
      items: [
        {
          path: "/finance/accounts-setup",
          label: "Setup",
          icon: Settings,
          // Red rather than amber: a posting that needs a role with no account
          // is refused outright, so this is a stoppage and not a backlog.
          badge: "bad",
          useCount: useUnmappedMeaningCount,
          alsoLights: financeSetupGroups.flatMap((group) => group.paths),
        },
        // 7Soft's 25 menus mapped onto these screens, in 7Soft's order
        // (owner, 27 Oct 2026: 7Soft is the primary menu, ERP+ is additive).
        // A page rather than rows: a second set of rows would double every
        // route, and the router builds one route per path.
        {
          path: "/finance/7soft-parity",
          label: "7Soft parity",
          icon: ListTree,
        },
        // 7Soft's two Master menus that had no screen: the opening balance of
        // every account (2.17) and the audit trail (9.12). Their rows sit in
        // Master, in 7Soft's order, below.
        {
          path: "/finance/opening/balances",
          label: "Saldo Awal COA",
          icon: Scale,
        },
        {
          path: "/finance/history",
          label: "History",
          icon: FileClock,
        },
      ],
    },
    {
      items: [
        // ── the screens behind the doors, under the names they had ──
        // Stores
        {
          path: "/finance/stores",
          label: "Store Cash",
          icon: Store,
          hidden: true,
        },
        {
          path: "/finance/stores/cash-on-hand",
          label: "Cash on Hand",
          icon: Banknote,
          hidden: true,
        },
        {
          path: "/finance/stores/petty-cash",
          label: "Petty Cash",
          icon: Wallet,
          hidden: true,
        },
        {
          path: "/finance/stores/cashier-float",
          label: "Cashier Float",
          icon: Coins,
          hidden: true,
        },
        {
          path: "/finance/stores/cash-counts",
          label: "Cash Counts",
          icon: HandCoins,
          hidden: true,
        },
        {
          path: "/finance/receivables/card-settlement",
          label: "Card & EDC Settlement",
          icon: CreditCard,
          hidden: true,
        },
        {
          path: "/finance/receivables/sales-postings",
          label: "Sales Postings",
          icon: FileSpreadsheet,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/deposits",
          label: "Deposits",
          icon: PiggyBank,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/petty-cash",
          label: "Cash Positions",
          icon: Coins,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/cash-transactions",
          label: "Cash Transactions",
          icon: ArrowLeftRight,
          hidden: true,
          moved: ["/finance/cash-bank/transfers"],
        },
        {
          path: "/finance/reports/cash-bank",
          label: "Cash Last Counted",
          icon: Wallet,
          hidden: true,
        },
        // Payables
        {
          path: "/finance/payables/credit-notes",
          label: "Credit Note",
          icon: FileMinus,
          hidden: true,
        },
        {
          path: "/finance/payables/recurring-bills",
          label: "Recurring Bills",
          icon: Repeat,
          hidden: true,
        },
        {
          path: "/finance/payables/projection",
          label: "Payment Projection",
          icon: CalendarClock,
          hidden: true,
        },
        {
          path: "/finance/payables/aging",
          label: "Accounts Payable",
          icon: Hourglass,
          hidden: true,
          moved: ["/finance/reports/ap-aging", "/finance/payroll/payables"],
        },
        {
          path: "/finance/reports/accounts-payable-summary",
          label: "Supplier Bills",
          icon: Hourglass,
          hidden: true,
        },
        {
          path: "/finance/payables/purchase-invoice",
          label: "Purchase Invoices",
          icon: Receipt,
          hidden: true,
        },
        {
          path: "/finance/payables/supplier-ledger",
          label: "Supplier Ledger",
          icon: BookOpenCheck,
          hidden: true,
        },
        {
          path: "/finance/financing/loans",
          label: "Loans",
          icon: Landmark,
          hidden: true,
          moved: [
            "/finance/financing/principal",
            "/finance/financing/installments",
            "/finance/financing/interest",
            "/finance/financing/schedules",
          ],
        },
        // Cash & Bank
        {
          path: "/finance/cash-bank/kartu",
          label: "Kartu Kas/Bank",
          icon: FileSpreadsheet,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bkm",
          label: "BKM",
          icon: ArrowLeftToLine,
          hidden: true,
        },
        // A voucher, new or existing, is a page of its own (owner,
        // 2026-09-29): reached from its register, never a row.
        {
          path: "/finance/cash-bank/bkk/new",
          label: "New BKK",
          icon: ArrowRightFromLine,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bkk/$id",
          label: "BKK",
          icon: ArrowRightFromLine,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bkm/new",
          label: "New BKM",
          icon: ArrowLeftToLine,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bkm/$id",
          label: "BKM",
          icon: ArrowLeftToLine,
          hidden: true,
        },
        {
          path: "/finance/receivables/employee",
          label: "Employee Advances",
          icon: Users,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/giro",
          label: "Giro Board",
          icon: Kanban,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bank-reconciliation",
          label: "Bank Reconciliation",
          icon: Wrench,
          hidden: true,
          moved: ["/finance/bank"],
        },
        {
          path: "/finance/cash-bank/bank-accounts",
          label: "Bank Account",
          icon: Building2,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bank-transactions",
          label: "Bank Transactions",
          icon: Landmark,
          hidden: true,
        },
        {
          path: "/finance/reports/bank-reconciliation-summary",
          label: "Bank Reconciliation Summary",
          icon: ScanSearch,
          hidden: true,
        },
        {
          path: "/finance/cash-bank/bank-rules",
          label: "Bank Rules",
          icon: Filter,
          hidden: true,
        },
        // Off the menu since 2026-10-01: a giro clears on the Giro Board, and
        // BKK pays a bill. Both still read here.
        {
          path: "/finance/cash-bank/bank-clearance",
          label: "Bank Clearance",
          icon: BookOpenCheck,
          hidden: true,
        },
        {
          path: "/finance/payables/payments",
          label: "Payment Entry",
          icon: Banknote,
          hidden: true,
          moved: [
            "/finance/payments",
            "/finance/cash-bank/payments",
            "/finance/payables/advances",
            "/finance/payroll/payments",
          ],
        },
        // Journal
        {
          path: "/finance/accounting/all-journals",
          label: "All Jurnal",
          icon: BookOpenCheck,
          hidden: true,
        },
        {
          path: "/finance/setup/journal-templates",
          label: "Recurring Journal",
          icon: Copy,
          hidden: true,
        },
        // Assets
        {
          path: "/finance/reports/asset-register",
          label: "Fixed Asset Register",
          icon: Table2,
          hidden: true,
        },
        {
          path: "/finance/reports/asset-disposals",
          label: "Asset Disposals",
          icon: ArchiveX,
          hidden: true,
        },
        {
          path: "/finance/assets/contractor-projects",
          label: "Contractor Projects",
          icon: HardHat,
          hidden: true,
        },
        // A store opening or a renovation, read by Finance on the project's
        // own page (0997): GA's page with Costs in front.
        {
          path: "/finance/assets/contractor-projects/$project",
          label: "Project",
          icon: HardHat,
          hidden: true,
        },
        // Month End
        {
          path: "/finance/setup/periods",
          label: "Accounting Period",
          icon: CalendarDays,
          hidden: true,
          moved: ["/finance/periods"],
        },
        {
          path: "/finance/closing/period-closing-voucher",
          label: "Period Closing Voucher",
          icon: CalendarCheck,
          hidden: true,
        },
        {
          path: "/finance/payables/accruals",
          label: "Accruals",
          icon: FileClock,
          hidden: true,
        },
        {
          path: "/finance/accounting/prepaids",
          label: "Prepaids",
          icon: CalendarRange,
          hidden: true,
        },
        {
          path: "/finance/accounting/accruals",
          label: "Accrual Balances",
          icon: FileClock,
          hidden: true,
        },
        {
          path: "/finance/inventory/stock-vs-ledger",
          label: "Stock vs Ledger",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/finance/inventory/valuation",
          label: "Inventory Valuation",
          icon: Boxes,
          hidden: true,
        },
        {
          path: "/finance/inventory/goods-in-transit",
          label: "Goods in Transit",
          icon: Truck,
          hidden: true,
        },
        {
          path: "/finance/inventory/adjustments",
          label: "Stock Adjustments",
          icon: SlidersHorizontal,
          hidden: true,
        },
        {
          path: "/finance/inventory/cogs",
          label: "Cost of Goods Sold",
          icon: Percent,
          hidden: true,
        },
        {
          path: "/finance/tax/payables",
          label: "Tax Payables",
          icon: BadgePercent,
          hidden: true,
          moved: [
            "/finance/tax/credits",
            "/finance/tax/pph",
            "/finance/tax/ppn",
            "/finance/tax/other",
            "/finance/reports/tax",
          ],
        },
        {
          path: "/finance/reports/tax-withholding",
          label: "Tax Withholding Details",
          icon: BadgePercent,
          hidden: true,
        },
        // Reports
        {
          path: "/finance/reports/laporan-accounting",
          label: "Laporan Accounting",
          icon: FileSpreadsheet,
          hidden: true,
        },
        {
          path: "/finance/reports/profit-and-loss-by-unit",
          label: "Profit and Loss by Unit",
          icon: Split,
          hidden: true,
        },
        {
          path: "/finance/reports/expenses-by-month",
          label: "Expenses by Month",
          icon: PieChart,
          hidden: true,
        },
        {
          path: "/finance/reports/dimension-results",
          label: "Dimension Results",
          icon: ChartColumn,
          hidden: true,
        },
        {
          path: "/finance/reports/balance-sheet",
          label: "Balance Sheet",
          icon: Table2,
          hidden: true,
        },
        {
          path: "/finance/reports/balance-sheet-2-years",
          label: "Balance Sheet 2 Years",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/finance/reports/changes-in-equity",
          label: "Statement of Changes in Equity",
          icon: Scale,
          hidden: true,
        },
        {
          path: "/finance/reports/cash-flow",
          label: "Cash Flow",
          icon: Waves,
          hidden: true,
        },
        {
          path: "/finance/accounting/general-ledger",
          label: "General Ledger",
          icon: Files,
          hidden: true,
          moved: ["/finance/ledger", "/finance/reports/general-ledger"],
        },
        {
          path: "/finance/accounting/trial-balance",
          label: "Trial Balance",
          icon: Sigma,
          hidden: true,
          moved: ["/finance/reports/trial-balance"],
        },
        {
          path: "/finance/reports/sales-by-division",
          label: "Sales by Division",
          icon: Shapes,
          hidden: true,
        },
        // Setup, listed on its page by `financeSetupGroups`
        {
          path: "/finance/accounting/chart-of-accounts",
          label: "Chart of Accounts",
          icon: ListTree,
          hidden: true,
          moved: ["/finance/accounts"],
        },
        {
          path: "/finance/settings/accounts",
          label: "Accounts Settings",
          icon: Settings,
          hidden: true,
        },
        {
          path: "/finance/setup/dimensions",
          label: "Accounting Dimension",
          icon: Shapes,
          hidden: true,
        },
        {
          path: "/finance/settings/posting-policies",
          label: "Posting Policies",
          icon: Workflow,
          hidden: true,
        },
        {
          path: "/finance/settings/permissions",
          label: "Permissions",
          icon: KeyRound,
          hidden: true,
        },
        {
          path: "/finance/setup/account-links",
          label: "Account Links",
          icon: GitBranch,
          hidden: true,
          // The old per-site map lived at both of these. Its decisions are
          // links now, and a bookmark to the map lands on them.
          moved: ["/finance/account-map", "/finance/setup/account-map"],
        },
        {
          path: "/finance/setup/posting-readiness",
          label: "Posting Readiness",
          icon: ShieldCheck,
          hidden: true,
        },
        {
          path: "/finance/setup/pay-components",
          label: "Pay Components",
          icon: BadgeDollarSign,
          hidden: true,
        },
        {
          path: "/finance/setup/expense-categories",
          label: "Expense Categories",
          icon: FolderTree,
          hidden: true,
        },
        {
          path: "/finance/setup/line-categories",
          label: "Line Categories",
          icon: Tags,
          hidden: true,
          moved: ["/finance/categories"],
        },
        {
          path: "/finance/setup/payment-methods",
          label: "Mode of Payment",
          icon: WalletCards,
          hidden: true,
        },
        {
          path: "/finance/setup/shop-payment-methods",
          label: "Shop Payment Methods",
          icon: Store,
          hidden: true,
        },
        {
          path: "/finance/setup/edc-mdr",
          label: "EDC & MDR",
          icon: CreditCard,
          hidden: true,
          moved: ["/finance/sales-setup"],
        },
        {
          path: "/finance/setup/giro-templates",
          label: "Giro Templates",
          icon: Printer,
          hidden: true,
          moved: ["/finance/giro-print"],
        },
        {
          path: "/finance/tax-setup/types",
          label: "Tax Types",
          icon: ReceiptText,
          hidden: true,
        },
        {
          path: "/finance/tax-setup/withholding",
          label: "Tax Withholding",
          icon: Percent,
          hidden: true,
        },
        {
          path: "/finance/setup/asset-classes",
          label: "Asset Category",
          icon: Package,
          hidden: true,
        },
        // On no door: no debtor book here, and the Overview holds the cards.
        {
          path: "/finance/receivables/aging",
          label: "Accounts Receivable",
          icon: Hourglass,
          hidden: true,
          moved: ["/finance/receivables/other", "/finance/reports/ar-aging"],
        },
        {
          path: "/finance/payments-dashboard",
          label: "Payments Dashboard",
          icon: ChartColumn,
          hidden: true,
        },
        // 7Soft menus (owner, 28 Oct 2026: "samakan dlu semua menu dan
        // informasi dengan 7soft"). Their rows are drawn by the 7Soft menu
        // below; declared here so each path is routed once.
        //
        // The BKK register lost its route when Kas/Bank became the Cash & Bank
        // door's first tab: a door routes only its first view.
        {
          path: "/finance/cash-bank/bkk",
          label: "BKK",
          icon: ArrowRightFromLine,
          hidden: true,
        },
        {
          path: "/finance/reports/kas-bank",
          label: "Laporan Kas/Bank",
          icon: Printer,
          hidden: true,
        },
        {
          path: "/finance/accounting/info-accounting",
          label: "Info Accounting",
          icon: ScanSearch,
          hidden: true,
        },
        {
          path: "/finance/sales/info",
          label: "Info Penjualan",
          icon: ScanSearch,
          hidden: true,
        },
        {
          path: "/finance/sales/returns",
          label: "Retur Penjualan",
          icon: FileMinus,
          hidden: true,
        },
        {
          path: "/finance/reports/penjualan",
          label: "Laporan Penjualan",
          icon: Printer,
          hidden: true,
        },
        {
          path: "/finance/reports/laporan-keuangan",
          label: "Laporan Keuangan",
          icon: PieChart,
          hidden: true,
        },
        {
          path: "/finance/reports/laporan-manajerial",
          label: "Laporan Manajerial",
          icon: TrendingUp,
          hidden: true,
        },
        {
          path: "/finance/setup/setting-menu",
          label: "Setting Menu",
          icon: SlidersHorizontal,
          hidden: true,
        },
      ],
    },
  ],
}

/// 7Soft menu (owner, 27 Oct 2026; every finance menu a row, 28 Oct 2026).
///
/// The sidebar is 7Soft's menu tree: its groups, its names, its order. Every
/// finance menu of the manual's table of contents is a row, also where the
/// same screen is a tab of another page (BKM, BKK and Pencairan BG are tabs of
/// Info Kas Bank too). Rows outside 7Soft sit under "Di luar 7Soft".
///
/// The dashboard keeps its route and its ⌘K entry but not a row: the module
/// lands on the first 7Soft menu instead (owner, 28 Oct 2026).
///
/// This is a reORDERING of the declaration above, not a second copy of it.
/// Each path still appears exactly once — `routes.tsx` builds one route per
/// item, so a duplicated path would fail when the router is created. Faktur
/// Penjualan (credit sales; the chart has no customer receivable) and History
/// Report (report opens are not logged) have no screen and no row.
/// The icons of the rows whose path is new — the three screens that did not
/// exist when the tree above was written. Every other row reads its icon off
/// the item it already had.
const SEVEN_SOFT_ICON: readonly (readonly [string, NavItem["icon"]])[] = [
  ["/finance/stores/daily-close", CalendarCheck],
  ["/finance/stores/store-cash", Coins],
  ["/finance/accounting/month-end", CalendarClock],
]

/// The final menu (owner, 28 Oct 2026): 15 rows in 6 groups, as drawn in
/// `finance-menu-final-prototype.html`. Reports and Setup are rows with no
/// heading. Every other screen keeps its route and its ⌘K entry, hidden.
///
/// A row carries its own path and label: it must not borrow the Stores door,
/// whose path is only the first view of its first tab. Daily close, Store
/// cash and Month end have screens of their own in `index.ts`; the old
/// sales-by-day and period-close screens keep their routes, off the menu.
const SEVEN_SOFT_GROUP: readonly (readonly [
  string,
  readonly (readonly [string, string])[],
])[] = [
  [
    "Stores",
    [
      ["/finance/stores/daily-close", "Daily close"],
      ["/finance/stores/store-cash", "Store cash"],
    ],
  ],
  [
    "Cash & Bank",
    [
      ["/finance/cash-bank/kas-bank", "Cash & Bank"],
      ["/finance/cash-bank/bkk", "BKK"],
      ["/finance/cash-bank/bkm", "BKM"],
      ["/finance/cash-bank/giro", "Giro"],
      ["/finance/cash-bank/bank-reconciliation", "Bank reconciliation"],
    ],
  ],
  [
    "Payables",
    [
      ["/finance/payables/bills", "Bills"],
      ["/finance/payables/supplier-ledger", "Suppliers"],
    ],
  ],
  [
    "Accounting",
    [
      ["/finance/accounting/journal-entries", "Journal"],
      ["/finance/accounting/info-accounting", "Ledger"],
      ["/finance/assets/capitalization", "Assets"],
      ["/finance/accounting/month-end", "Month end"],
    ],
  ],
  ["", [["/finance/reports/laporan-accounting", "Reports"]]],
  ["", [["/finance/accounts-setup", "Setup"]]],
]

{
  const every = financeNav.sections.flatMap((section) => section.items)
  const byPath = new Map(every.map((item) => [item.path, item]))
  const icon = new Map(SEVEN_SOFT_ICON)
  const shown = new Set<string>()

  const sections: NavSection[] = [
    ...SEVEN_SOFT_GROUP.map(([group, rows]) => ({
      ...(group === "" ? {} : { label: group, chip: true }),
      items: rows.map(([path, label]) => {
        shown.add(path)
        const item = byPath.get(path)
        return {
          ...item,
          path,
          label,
          icon: item?.icon ?? icon.get(path) ?? Landmark,
          hidden: false,
        }
      }),
    })),
    {
      // The dashboard keeps its route and its ⌘K entry; it is only off the
      // menu, so a bookmark still lands and nothing 404s.
      items: [
        ...every
          .filter((item) => item.path === "/finance/dashboard")
          .map((item) => ({ ...item, hidden: true })),
        ...every
          .filter(
            (item) =>
              !shown.has(item.path) && item.path !== "/finance/dashboard"
          )
          .map((item) => ({ ...item, hidden: true })),
      ],
    },
  ]

  const mutable = financeNav as unknown as { sections: readonly NavSection[] }
  mutable.sections = sections
}
