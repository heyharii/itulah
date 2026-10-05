import {
  SlidersHorizontal,
  Truck,
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
  HandCoins,
  Copy,
  CreditCard,
  FileClock,
  HardHat,
  FileMinus,
  Files,
  FileSpreadsheet,
  Filter,
  FolderTree,
  GitBranch,
  Hourglass,
  Kanban,
  KeyRound,
  Landmark,
  Laptop,
  ListTree,
  Lock,
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
  Split,
  Store,
  Table2,
  Tags,
  TrendingUp,
  Users,
  Wallet,
  WalletCards,
  Waves,
  Workflow,
  Wrench,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import {
  useMonthNotOpenCount,
  useOverdueBillCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"
import { useUnagreedLineCount } from "@/screens/finance-lab-2/hooks"

/// Finance, as a menu and its sub-menus (owner, 2026-09-29: "kita ga mau ada
/// ini" of the sidebar switcher; "tiru saja … tapi kita mau menunya grouping
/// seperti biasa saja, seperti menu sub menu").
///
/// # ERPNext's groups
///
/// Copied from ERPNext's Accounting as its demo site draws it
/// (erpnext-demo.frappe.cloud, `/app/accounting` and the three workspaces
/// under it): Payables, Receivables and Financial Reports, and the Accounting
/// workspace's own cards — Payments, Banking, Tax Masters, Accounting
/// Masters. ERPNext's labels, ERPNext's rows in ERPNext's order within each
/// group, each screen once. A row ERPNext has and we have no screen for is
/// left out. The one row of ours standing in ERPNext's place is Sales
/// Postings, where ERPNext has Sales Invoice: the day's till receipts are how
/// a sale reaches the ledger here.
///
/// # What ERPNext does not have
///
/// Our own screens — Card & EDC, petty cash, loans, accruals, the month-end
/// checklist, Finance's half of assets, and the setup behind account links —
/// sit under the department's **More**, each under the heading of the group
/// it is kin to. Not deleted: routed, linkable and in ⌘K as before.
///
/// # Paths
///
/// `/finance/<group>/<row>`, kept from the frozen tree of 2026-09-26 so every
/// link and bookmark still lands — a row moving to another group does not
/// move its URL. No row's path is a prefix of another's: the sidebar lights a
/// row when the address equals its path OR starts with it plus a slash.
export const financeNav: AppModule = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  home: "/finance/dashboard",
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
        // Home is gone (owner, 2026-10-01); the Dashboard is the front page
        // and is called Overview. `/finance` is still routed, just not a row.
        {
          path: "/finance/dashboard",
          label: "Overview",
          icon: ChartColumn,
        },
      ],
    },
    {
      // Each shop's money (owner, 2026-10-01): the three cash boxes, daily
      // sales against the drawer and the bank, and the cash counts.
      label: "Stores",
      fold: true,
      items: [
        { path: "/finance/stores", label: "Overview", icon: Store },
        { path: "/finance/stores/sales", label: "Sales by Day", icon: Receipt },
        {
          path: "/finance/stores/cash-on-hand",
          label: "Cash on Hand",
          icon: Banknote,
        },
        {
          path: "/finance/stores/petty-cash",
          label: "Petty Cash",
          icon: Wallet,
        },
        {
          path: "/finance/stores/cashier-float",
          label: "Cashier Float",
          icon: Coins,
        },
        {
          path: "/finance/stores/cash-counts",
          label: "Cash Counts",
          icon: HandCoins,
        },
      ],
    },
    {
      // What the stock is worth, and whether the books agree (owner,
      // 2026-10-01): one article is bought once, so value = pieces × PO cost.
      label: "Inventory",
      fold: true,
      items: [
        {
          path: "/finance/inventory/valuation",
          label: "Inventory Valuation",
          icon: Boxes,
        },
        {
          path: "/finance/inventory/stock-vs-ledger",
          label: "Stock vs Ledger",
          icon: Scale,
        },
        {
          path: "/finance/inventory/goods-in-transit",
          label: "Goods in Transit",
          icon: Truck,
        },
        {
          path: "/finance/inventory/cogs",
          label: "Cost of Goods Sold",
          icon: Percent,
        },
        {
          path: "/finance/inventory/adjustments",
          label: "Stock Adjustments",
          icon: SlidersHorizontal,
        },
      ],
    },
    {
      /// Head office's external payables: bill → AP → payment → bank HO. A
      /// store's own expense arrives here as HO's bill and reaches the store
      /// through Interunit, never as a store payable.
      label: "Payables",
      fold: true,
      items: [
        {
          path: "/finance/payables/bills",
          label: "Purchase Invoice",
          icon: Receipt,
          badge: "warn",
          useCount: useOverdueBillCount,
          moved: ["/finance/bills"],
        },
        // Goods sent back, or a price corrected after the bill was agreed:
        // the supplier's credit, absorbed by the next bill or refunded
        // (Jurnal's Kredit Memo, owner 2026-10-01: "credit memo perlu").
        {
          path: "/finance/payables/credit-notes",
          label: "Credit Note",
          icon: FileMinus,
        },
        // What a supplier is expected to invoice every month: the promise a
        // draft bill is raised from, and what Payment Projection reads.
        {
          path: "/finance/payables/recurring-bills",
          label: "Recurring Bills",
          icon: Repeat,
        },
        // Costs booked before their bill, each waiting for the bill that
        // replaces it (owner, 2026-10-01). Beside Recurring Bills: those are
        // the bills that will come, these are the ones that have not yet.
        {
          path: "/finance/payables/accruals",
          label: "Accruals",
          icon: FileClock,
        },
        {
          path: "/finance/payables/aging",
          label: "Accounts Payable",
          icon: Hourglass,
          moved: ["/finance/reports/ap-aging", "/finance/payroll/payables"],
        },
        {
          path: "/finance/reports/accounts-payable-summary",
          // Was "AP Summary" (owner, 2026-10-01): everything owed, per supplier.
          label: "Supplier Bills",
          icon: Hourglass,
        },
        // Kartu Hutang: one supplier's movements with a running balance.
        {
          path: "/finance/payables/supplier-ledger",
          label: "Supplier Ledger",
          hidden: true, // owner, 2026-10-01: same as Supplier bills
          icon: BookOpenCheck,
        },
        // Owner, 2026-09-29 (`FINANCE-CONNECT-BRIEF.md`): "kita di payables
        // perlu projection ya ... atau ada calendar payment jg biar enak? ...
        // both digabung lah ya". One screen, not two: a calendar with no
        // itemised list under it cannot be read for what to pay, and a list
        // with no calendar answers a different question than the owner asked.
        {
          path: "/finance/payables/projection",
          label: "Payment Projection",
          icon: CalendarClock,
        },
        // ERPNext keeps loans in its Lending app. Ours are owed like a bill
        // and paid like one.
        {
          path: "/finance/financing/loans",
          label: "Loans",
          icon: Landmark,
          moved: [
            "/finance/financing/principal",
            "/finance/financing/installments",
            "/finance/financing/interest",
            "/finance/financing/schedules",
          ],
        },
      ],
    },
    {
      /// Not a debtor book: a till sale settles as it is rung up. What is owed
      /// here is mostly the acquirer's — POS / EDC → card receivable →
      /// settlement → bank HO.
      label: "Receivables",
      fold: true,
      items: [
        // Off the menu since 2026-09-29 ("receivable hapus deh") except Card &
        // EDC Settlement, back on 2026-10-01: the one receivable a shop has.
        {
          path: "/finance/receivables/sales-postings",
          label: "Sales Postings",
          icon: FileSpreadsheet,
          more: true,
        },
        {
          path: "/finance/receivables/aging",
          label: "Accounts Receivable",
          icon: Hourglass,
          more: true,
          moved: ["/finance/receivables/other", "/finance/reports/ar-aging"],
        },
        {
          path: "/finance/receivables/card-settlement",
          label: "Card & EDC Settlement",
          icon: CreditCard,
        },
        {
          path: "/finance/receivables/employee",
          label: "Employee Advances",
          icon: Users,
          more: true,
        },
      ],
    },
    {
      label: "Payments",
      fold: true,
      items: [
        {
          path: "/finance/payables/payments",
          label: "Payment Entry",
          // Off the menu (owner, 2026-10-01): BKK pays a bill (Settle bills)
          // and BKM takes money in. Routed, in ⌘K, and the register of every
          // supplier payment still reads here.
          hidden: true,
          icon: Banknote,
          moved: [
            "/finance/payments",
            "/finance/cash-bank/payments",
            "/finance/payables/advances",
            "/finance/payroll/payments",
          ],
        },
        // The client's own cash vouchers from SeventhSoft — Bukti Kas Keluar
        // and Bukti Kas Masuk — in the Klasik layout the owner picked, beside
        // Payment Entry (owner, 2026-09-29: "payment entry tetap ada deh,
        // tapi ada jg bkm bkk").
        {
          path: "/finance/cash-bank/bkk",
          label: "BKK",
          icon: ArrowRightFromLine,
          moved: ["/finance/cash-bank/cash-documents"],
        },
        {
          path: "/finance/cash-bank/bkm",
          label: "BKM",
          icon: ArrowLeftToLine,
        },
        // The document itself, new or existing, is its own page rather than a
        // sheet over the register above — the owner's call, and the same
        // device `/stores/$unit` uses for the one other record this app
        // addresses by path. Routed and findable — the register's own rows
        // link here, and a pasted link still lands on one — but `hidden` so
        // it is not four more rows repeating BKK/BKM's own names.
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
          path: "/finance/accounting/journal-entries",
          label: "Journal Entry",
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
        },
        {
          path: "/finance/setup/journal-templates",
          label: "Recurring Journal",
          icon: Copy,
        },
        {
          path: "/finance/setup/payment-methods",
          label: "Mode of Payment",
          icon: WalletCards,
        },
        // The cash documents (BKM / BKK) and petty cash: ERPNext's Cash
        // Entry, kept as the screens the finance team already works in.
        {
          path: "/finance/cash-bank/cash-transactions",
          label: "Cash Transactions",
          icon: ArrowLeftRight,
          more: true,
          moved: ["/finance/cash-bank/transfers"],
        },
        {
          path: "/finance/cash-bank/petty-cash",
          label: "Petty Cash",
          icon: Coins,
          more: true,
        },
        {
          path: "/finance/payments-dashboard",
          label: "Payments Dashboard",
          icon: ChartColumn,
          more: true,
        },
      ],
    },
    {
      /// Every external bank account is head office's; a store holds Cash on
      /// Hand, Petty Cash and Modal Kasir, and deposits it here.
      label: "Banking",
      fold: true,
      items: [
        {
          path: "/finance/cash-bank/bank-accounts",
          label: "Bank Account",
          icon: Building2,
        },
        // The giros, as a board: each one moves Written → Delivered → Due →
        // Cleared or Bounced, and a board shows where every one stands.
        {
          path: "/finance/cash-bank/giro",
          label: "Giro Board",
          icon: Kanban,
        },
        {
          path: "/finance/cash-bank/bank-clearance",
          label: "Bank Clearance",
          icon: BookOpenCheck,
          // Off the menu (owner, 2026-10-01): a giro clears on the Giro Board,
          // and money from the card schemes is Card & EDC Settlement.
          hidden: true,
        },
        // The statement lines as uploaded, reconciled or not yet — ERPNext's
        // Bank Transaction list (owner, 2026-09-29: "bisa jadi upload
        // transaction tapi belum recon").
        {
          path: "/finance/cash-bank/bank-transactions",
          label: "Bank Transactions",
          icon: Landmark,
        },
        {
          path: "/finance/cash-bank/bank-reconciliation",
          label: "Bank Reconciliation",
          icon: Wrench,
          // Amber: an unagreed bank line is a backlog, not a stoppage.
          badge: "warn",
          useCount: useUnagreedLineCount,
          moved: ["/finance/bank"],
        },
        // What a recurring narration means ("BIAYA ADM" is always bank
        // charges): a rule proposes, a person accepts on the reconciliation.
        {
          path: "/finance/cash-bank/bank-rules",
          label: "Bank Rules",
          icon: Filter,
        },
        {
          path: "/finance/cash-bank/deposits",
          label: "Deposits",
          icon: PiggyBank,
          more: true,
        },
        // ERPNext's Cheque Print Template, for the giro.
        {
          path: "/finance/setup/giro-templates",
          label: "Giro Templates",
          icon: Printer,
          more: true,
          moved: ["/finance/giro-print"],
        },
      ],
    },
    {
      label: "Financial Reports",
      fold: true,
      items: [
        {
          path: "/finance/accounting/general-ledger",
          label: "General Ledger",
          icon: Files,
          moved: ["/finance/ledger", "/finance/reports/general-ledger"],
        },
        {
          path: "/finance/accounting/trial-balance",
          label: "Trial Balance",
          icon: Sigma,
          moved: ["/finance/reports/trial-balance"],
        },
        {
          path: "/finance/reports/profit-and-loss",
          label: "Profit and Loss",
          icon: TrendingUp,
          moved: ["/finance/reports", "/finance/reports/site-pl"],
        },
        {
          path: "/finance/reports/balance-sheet",
          label: "Balance Sheet",
          icon: Table2,
        },
        {
          path: "/finance/reports/cash-flow",
          label: "Cash Flow",
          icon: Waves,
        },
        /// The client's own two comparison reports from 7Soft, kept so nobody
        /// has to learn a new way to read the year against the last:
        /// "Laba Rugi GL per Cabang 2 Tahunan" and "Laporan Neraca Central 2
        /// Tahunan". A year read up to a month, beside the year before it.
        {
          path: "/finance/reports/profit-and-loss-by-unit",
          label: "Profit and Loss by Unit",
          icon: Split,
        },
        {
          path: "/finance/reports/balance-sheet-2-years",
          label: "Balance Sheet 2 Years",
          icon: Scale,
        },
        /// The P&L cut by an accounting dimension (division, cost center,
        /// project) — ours, where ERPNext has Profitability Analysis.
        {
          path: "/finance/reports/dimension-results",
          label: "Dimension Results",
          icon: ChartColumn,
          more: true,
        },
        {
          path: "/finance/reports/cash-bank",
          label: "Cash & Bank",
          icon: Wallet,
          more: true,
        },
        /// 7Soft's "Summary Penjualan per Divisi by HPP rata-rata": sales,
        /// cost and gross profit per division.
        {
          path: "/finance/reports/sales-by-division",
          label: "Sales by Division",
          icon: Shapes,
        },
        // Picked from the Mekari Jurnal comparison (owner, 2026-10-01).
        {
          path: "/finance/reports/changes-in-equity",
          label: "Statement of Changes in Equity",
          icon: Scale,
        },
        // Every expense account month by month, grouped by its heading in
        // the chart — Jurnal's "pengeluaran per kategori".
        {
          path: "/finance/reports/expenses-by-month",
          label: "Expenses by Month",
          icon: PieChart,
        },
        {
          path: "/finance/reports/bank-reconciliation-summary",
          label: "Bank Reconciliation Summary",
          icon: ScanSearch,
        },
      ],
    },
    {
      /// ERPNext's Assets, filed under Finance (owner, 2026-09-29: "assets masuk
      /// accounting saja"). The book-value half: identity, locations and
      /// maintenance are GA's register.
      label: "Assets",
      fold: true,
      items: [
        {
          path: "/finance/assets/capitalization",
          label: "Asset",
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
        },
        // Work paid ahead to a contractor and invoiced over months, split
        // into assets at the end (owner, 2026-10-01).
        {
          path: "/finance/assets/contractor-projects",
          label: "Contractor Projects",
          icon: HardHat,
        },
        {
          path: "/finance/setup/asset-classes",
          label: "Asset Category",
          icon: Package,
        },
        {
          path: "/finance/reports/asset-register",
          label: "Fixed Asset Register",
          icon: Table2,
        },
        {
          path: "/finance/reports/asset-disposals",
          label: "Asset Disposals",
          icon: ArchiveX,
        },
      ],
    },
    {
      // "Tax", not "Tax Masters" (owner, 2026-10-01): every tax the client
      // owes — PPh 21, 23, 25, 29, PPN, PBB — not only what is withheld.
      label: "Tax",
      fold: true,
      items: [
        {
          path: "/finance/tax-setup/withholding",
          label: "Tax Withholding",
          icon: Percent,
        },
        // PPh 23 / 4(2) kept back at payment, the list behind the monthly
        // return. ERPNext's Tax Withholding Details.
        {
          path: "/finance/reports/tax-withholding",
          label: "Tax Withholding Details",
          icon: BadgePercent,
        },
        {
          path: "/finance/tax/payables",
          label: "Tax Payables",
          icon: BadgePercent,
          moved: [
            "/finance/tax/credits",
            "/finance/tax/pph",
            "/finance/tax/ppn",
            "/finance/tax/other",
            "/finance/reports/tax",
          ],
        },
        {
          path: "/finance/tax-setup/types",
          label: "Tax Types",
          icon: ReceiptText,
        },
      ],
    },
    {
      /// Done once and then not thought about — until it is wrong, and then
      /// every posting that leans on it is wrong the same way.
      label: "Accounting Masters",
      fold: true,
      items: [
        {
          path: "/finance/accounting/chart-of-accounts",
          label: "Chart of Accounts",
          icon: ListTree,
          moved: ["/finance/accounts"],
        },
        {
          path: "/finance/settings/accounts",
          label: "Accounts Settings",
          icon: Settings,
        },
        // The only screen that OPENS a month. Nothing can be posted into a
        // month that does not exist, which somebody usually discovers at the
        // till rather than here — hence the badge.
        {
          path: "/finance/setup/periods",
          label: "Accounting Period",
          icon: CalendarDays,
          badge: "warn",
          useCount: useMonthNotOpenCount,
          moved: ["/finance/periods"],
        },
        {
          path: "/finance/setup/dimensions",
          label: "Accounting Dimension",
          icon: Shapes,
          more: true,
        },
        {
          path: "/finance/setup/account-links",
          label: "Account Links",
          icon: GitBranch,
          more: true,
          // The old per-site map lived at both of these. Its decisions are
          // links now, and a bookmark to the map lands on them.
          moved: ["/finance/account-map", "/finance/setup/account-map"],
        },
        {
          path: "/finance/setup/posting-readiness",
          label: "Posting Readiness",
          icon: ShieldCheck,
          more: true,
          // Red rather than amber: a posting that needs a role with no
          // account is refused outright, so this is a stoppage and not a
          // backlog. Home's "Needs attention" carries it too.
          badge: "bad",
          useCount: useUnmappedMeaningCount,
        },
        {
          path: "/finance/setup/shop-payment-methods",
          label: "Shop Payment Methods",
          icon: Store,
          more: true,
        },
        {
          path: "/finance/setup/edc-mdr",
          label: "EDC & MDR",
          icon: CreditCard,
          more: true,
          moved: ["/finance/sales-setup"],
        },
        {
          path: "/finance/setup/expense-categories",
          label: "Expense Categories",
          icon: FolderTree,
          more: true,
        },
        {
          path: "/finance/setup/line-categories",
          label: "Line Categories",
          icon: Tags,
          more: true,
          moved: ["/finance/categories"],
        },
        {
          path: "/finance/setup/pay-components",
          label: "Pay Components",
          icon: BadgeDollarSign,
        },
        {
          path: "/finance/settings/posting-policies",
          label: "Posting Policies",
          icon: Workflow,
          more: true,
        },
        {
          path: "/finance/settings/permissions",
          label: "Permissions",
          icon: KeyRound,
          more: true,
        },
      ],
    },
    {
      /// The month-end work that leads up to the closing voucher.
      label: "Closing",
      fold: true,
      items: [
        {
          path: "/finance/accounting/accruals",
          label: "Accruals",
          icon: FileClock,
          more: true,
        },
        {
          path: "/finance/accounting/prepaids",
          label: "Prepaids",
          icon: CalendarRange,
          more: true,
        },
        {
          path: "/finance/period-close",
          label: "Period Close",
          icon: Lock,
        },
        {
          path: "/finance/closing/period-closing-voucher",
          label: "Period Closing Voucher",
          icon: CalendarCheck,
        },
      ],
    },
  ],
}
