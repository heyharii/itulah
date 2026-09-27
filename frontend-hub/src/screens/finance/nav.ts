import {
  Archive,
  ArrowLeftRight,
  BadgeDollarSign,
  BadgePercent,
  Banknote,
  BookOpenCheck,
  Boxes,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CircleDollarSign,
  ClipboardList,
  Coins,
  Copy,
  CreditCard,
  FileClock,
  FileSpreadsheet,
  FileStack,
  FileText,
  Files,
  FolderTree,
  Gauge,
  GitBranch,
  HandCoins,
  HardHat,
  Hourglass,
  KeyRound,
  Landmark,
  Layers,
  ListChecks,
  Lock,
  Merge,
  Network,
  Package,
  PackageCheck,
  PenLine,
  Percent,
  PiggyBank,
  Printer,
  Receipt,
  ReceiptText,
  Recycle,
  RefreshCw,
  Repeat,
  Scale,
  ScrollText,
  Send,
  Settings,
  Shapes,
  ShieldCheck,
  ShoppingBag,
  Sigma,
  SlidersHorizontal,
  Split,
  Store,
  Table2,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  UserRoundCheck,
  Users,
  UsersRound,
  Vault,
  Wallet,
  WalletCards,
  Warehouse,
  Waves,
  Workflow,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import {
  useMonthNotOpenCount,
  useOverdueBillCount,
  useUnmappedMeaningCount,
} from "@/screens/finance/badges"
import { useUnagreedLineCount } from "@/screens/finance-lab-2/hooks"

/// Finance, as the owner froze it on 2026-09-26.
///
/// The groups and the rows under them are the structure, and they are not
/// re-argued screen by screen: from here what changes is a screen's fields,
/// workflow and posting rules, never where it sits. The one addition to the
/// frozen tree is **Setup**, added on the owner's say-so the same day —
/// Account Map is a stoppage (a posting whose meaning has no account is
/// refused), and a stoppage with nowhere in the sidebar to wear its badge is
/// one nobody sees until the till does.
///
/// On 2026-09-27 the owner asked for the setup rows to follow ERPNext's
/// Accounting workspace: Setup (Chart of Accounts moved in, and the masters
/// Finance now edits without a developer), Opening & Closing, Tax Setup and
/// Settings. Those four groups are the second addition.
///
/// # What it replaced
///
/// Four modules under two chips — Finance, Finance baru (`finance-lab`, a
/// simulation with no network calls), Finance final and Finance lab 2 — which
/// between them drew Trial Balance four times and Journal three. The live
/// screens that answer a row below are routed here from wherever they were
/// written (`index.ts` names each one's file); the rest are still on disk and
/// routed nowhere. A row with no screen yet renders `Placeholder`, which says
/// so, rather than a plausible page over nothing.
///
/// # Rows the tree names twice
///
/// **Payments** is two jobs. Under Cash & Bank it is money actually leaving a
/// bank — the execution, `payment-batches` on the node. Under Payables it is
/// the Payment Entry that settles bills. **Trial Balance**, **General Ledger**
/// and the two agings sit under Reports as well as under the work that
/// produces them, and those are one screen with two doors, not two
/// implementations that can disagree.
///
/// # Paths
///
/// `/finance/<group>/<row>`, and no row's path is a prefix of another's: the
/// sidebar lights a row when the address equals its path OR starts with it
/// plus a slash, so a prefix would light two rows at once. The groups are
/// headings and own no path — `/finance/assets` is a redirect, not a screen.
export const financeNav: AppModule = {
  id: "finance",
  label: "Finance",
  icon: Landmark,
  home: "/finance",
  // The modules this one replaced. Their bases land on Overview; the old
  // `/finance/*` screens that moved are redirected row by row, below.
  moved: ["/finance-lab", "/finance-lab-2", "/finance-final"],
  sections: [
    {
      items: [{ path: "/finance", label: "Overview", icon: Gauge }],
    },
    {
      /// Where money actually moves. Every external bank account is head
      /// office's; a store holds Cash on Hand, Petty Cash and Modal Kasir, and
      /// that is not a banking menu of its own.
      label: "Cash & Bank",
      items: [
        {
          path: "/finance/cash-bank/bank-accounts",
          label: "Bank Accounts",
          icon: Building2,
        },
        {
          path: "/finance/cash-bank/cash-transactions",
          label: "Cash Transactions",
          icon: ArrowLeftRight,
        },
        { path: "/finance/cash-bank/payments", label: "Payments", icon: Send },
        {
          path: "/finance/cash-bank/transfers",
          label: "Transfers",
          icon: Repeat,
        },
        {
          path: "/finance/cash-bank/petty-cash",
          label: "Petty Cash",
          icon: Coins,
        },
        { path: "/finance/cash-bank/giro", label: "Giro", icon: ScrollText },
        {
          path: "/finance/cash-bank/deposits",
          label: "Deposits",
          icon: PiggyBank,
        },
        {
          path: "/finance/cash-bank/bank-reconciliation",
          label: "Bank Reconciliation",
          icon: Scale,
          // Amber: an unagreed bank line is a backlog, not a stoppage.
          badge: "warn",
          useCount: useUnagreedLineCount,
          moved: ["/finance/bank"],
        },
      ],
    },
    {
      /// Not a debtor book: a till sale settles as it is rung up. What is owed
      /// here is mostly the acquirer's — POS / EDC → card receivable →
      /// settlement → bank HO — plus employees and the odd other party.
      label: "Receivables",
      items: [
        {
          path: "/finance/receivables/card-settlement",
          label: "Card & EDC Settlement",
          icon: CreditCard,
        },
        {
          path: "/finance/receivables/employee",
          label: "Employee Receivables",
          icon: Users,
        },
        {
          path: "/finance/receivables/other",
          label: "Other Receivables",
          icon: HandCoins,
        },
        {
          path: "/finance/receivables/aging",
          label: "Aging",
          icon: Hourglass,
        },
        // The daily bridge from POS receipts to the ledger. Not a row of the
        // frozen tree, and still a screen Executive links into, so it stays
        // routed beside the settlement it feeds.
        {
          path: "/finance/receivables/sales-postings",
          label: "Sales Postings",
          icon: FileSpreadsheet,
          hidden: true,
        },
      ],
    },
    {
      /// Head office's external payables: bill → AP → payment → bank HO. A
      /// store's own expense arrives here as HO's bill and reaches the store
      /// through Interunit, never as a store payable.
      label: "Payables",
      items: [
        {
          path: "/finance/payables/bills",
          label: "Supplier Bills",
          icon: Receipt,
          // Recorded, not posted, and past due. Amber: the money is late, but
          // nothing is stopped by it.
          badge: "warn",
          useCount: useOverdueBillCount,
          moved: ["/finance/bills"],
        },
        {
          path: "/finance/payables/advances",
          label: "Supplier Advances",
          icon: Wallet,
        },
        {
          path: "/finance/payables/payments",
          label: "Payments",
          icon: Banknote,
          moved: ["/finance/payments"],
        },
        { path: "/finance/payables/aging", label: "Aging", icon: Hourglass },
      ],
    },
    {
      /// HR computes the result; Finance accrues it, owes it and pays it.
      label: "Payroll",
      items: [
        {
          path: "/finance/payroll/runs",
          label: "Payroll Runs",
          icon: ClipboardList,
        },
        {
          path: "/finance/payroll/payables",
          label: "Payroll Payables",
          icon: ReceiptText,
        },
        {
          path: "/finance/payroll/payments",
          label: "Employee Payments",
          icon: UserRoundCheck,
        },
        {
          path: "/finance/payroll/posting",
          label: "Payroll Posting",
          icon: BookOpenCheck,
        },
      ],
    },
    {
      /// Inventory owns quantity and lifecycle; Finance owns the value, and
      /// never edits stock.
      label: "Inventory Valuation",
      items: [
        {
          path: "/finance/inventory/value",
          label: "Inventory Value",
          icon: Boxes,
        },
        {
          path: "/finance/inventory/in-transit",
          label: "Goods in Transit",
          icon: Truck,
        },
        { path: "/finance/inventory/cogs", label: "COGS", icon: ShoppingBag },
        {
          path: "/finance/inventory/adjustments",
          label: "Stock Adjustments",
          icon: SlidersHorizontal,
        },
        {
          path: "/finance/inventory/reconciliation",
          label: "Reconciliation",
          icon: ListChecks,
        },
      ],
    },
    {
      /// Asset identity is GA's register; book value is Finance's.
      label: "Assets",
      items: [
        {
          path: "/finance/assets/capitalization",
          label: "Capitalization",
          icon: Archive,
          moved: ["/finance/assets"],
        },
        { path: "/finance/assets/cip", label: "CIP", icon: HardHat },
        {
          path: "/finance/assets/depreciation",
          label: "Depreciation",
          icon: TrendingDown,
        },
        {
          path: "/finance/assets/amortisation",
          label: "Amortisation",
          icon: CalendarRange,
        },
        {
          path: "/finance/assets/replacement",
          label: "Replacement Accounting",
          icon: Recycle,
        },
        { path: "/finance/assets/disposal", label: "Disposal", icon: Trash2 },
      ],
    },
    {
      /// HO ↔ store, in three lanes and only three: financing (1057 / 2028),
      /// goods (1058 / 2029) and other (1059). The balancer writes these
      /// entries; nobody keys an interunit journal for a normal event.
      label: "Interunit",
      items: [
        {
          path: "/finance/interunit/financing",
          label: "Financing",
          icon: Network,
        },
        {
          path: "/finance/interunit/goods",
          label: "Goods",
          icon: PackageCheck,
        },
        { path: "/finance/interunit/other", label: "Other", icon: Split },
        {
          path: "/finance/interunit/reconciliation",
          label: "Reconciliation",
          icon: Merge,
        },
      ],
    },
    {
      /// The company and an outside lender or principal. Not Interunit →
      /// Financing, which is head office and a store.
      label: "Financing",
      items: [
        {
          path: "/finance/financing/loans",
          label: "Loans",
          icon: Landmark,
        },
        {
          path: "/finance/financing/principal",
          label: "Principal / Owner Funding",
          icon: Vault,
        },
        {
          path: "/finance/financing/installments",
          label: "Installments",
          icon: CalendarDays,
        },
        {
          path: "/finance/financing/interest",
          label: "Interest",
          icon: Percent,
        },
        {
          path: "/finance/financing/schedules",
          label: "Schedules",
          icon: CalendarClock,
        },
      ],
    },
    {
      label: "Tax",
      items: [
        {
          path: "/finance/tax/payables",
          label: "Tax Payables",
          icon: BadgePercent,
        },
        {
          path: "/finance/tax/credits",
          label: "Tax Prepaids / Credits",
          icon: CircleDollarSign,
        },
        { path: "/finance/tax/pph", label: "PPh", icon: FileText },
        { path: "/finance/tax/ppn", label: "PPN", icon: Calculator },
        { path: "/finance/tax/other", label: "Other Tax", icon: Layers },
      ],
    },
    {
      /// The kernel, not where transactions start: POS, Inventory,
      /// Procurement, GA, HR and the bank post themselves. A manual entry is
      /// for adjustment, reclassification, opening, correction and the
      /// exceptional event.
      label: "Accounting",
      items: [
        {
          path: "/finance/accounting/journal-entries",
          label: "Journal Entries",
          icon: BookOpenCheck,
          moved: ["/finance/journal"],
        },
        {
          path: "/finance/accounting/general-ledger",
          label: "General Ledger",
          icon: Files,
          moved: ["/finance/ledger"],
        },
        {
          path: "/finance/accounting/trial-balance",
          label: "Trial Balance",
          icon: Sigma,
        },
        {
          path: "/finance/accounting/accruals",
          label: "Accruals",
          icon: FileClock,
        },
        {
          path: "/finance/accounting/prepaids",
          label: "Prepaids",
          icon: CalendarRange,
        },
        {
          path: "/finance/accounting/recurring",
          label: "Recurring Entries",
          icon: RefreshCw,
        },
        {
          path: "/finance/accounting/adjustments",
          label: "Adjustments",
          icon: PenLine,
        },
      ],
    },
    {
      /// A control centre, not a posting menu: every check the month waits
      /// on, then the close. No monthly P&L → retained earnings.
      items: [
        { path: "/finance/period-close", label: "Period Close", icon: Lock },
      ],
    },
    {
      label: "Reports",
      items: [
        {
          path: "/finance/reports/balance-sheet",
          label: "Balance Sheet",
          icon: Table2,
        },
        {
          path: "/finance/reports/profit-and-loss",
          label: "Profit & Loss",
          icon: TrendingUp,
          moved: ["/finance/reports"],
        },
        {
          path: "/finance/reports/cash-flow",
          label: "Cash Flow",
          icon: Waves,
        },
        {
          path: "/finance/reports/trial-balance",
          label: "Trial Balance",
          icon: Sigma,
        },
        {
          path: "/finance/reports/general-ledger",
          label: "General Ledger",
          icon: Files,
        },
        {
          path: "/finance/reports/ap-aging",
          label: "AP Aging",
          icon: Hourglass,
        },
        {
          path: "/finance/reports/ar-aging",
          label: "AR Aging",
          icon: Hourglass,
        },
        {
          path: "/finance/reports/cash-bank",
          label: "Cash & Bank",
          icon: Wallet,
        },
        {
          path: "/finance/reports/payroll-cost",
          label: "Payroll Cost",
          icon: UsersRound,
        },
        {
          path: "/finance/reports/inventory-valuation",
          label: "Inventory Valuation",
          icon: Warehouse,
        },
        {
          path: "/finance/reports/asset-nbv",
          label: "Asset / NBV",
          icon: Archive,
        },
        { path: "/finance/reports/tax", label: "Tax", icon: Percent },
        {
          path: "/finance/reports/interunit",
          label: "Interunit",
          icon: Network,
        },
        {
          path: "/finance/reports/site-pl",
          label: "Store / Site P&L",
          icon: Store,
        },
        // The P&L cut by an accounting dimension (division, cost center,
        // project) — the report beside Accounting Dimensions in Setup.
        {
          path: "/finance/reports/dimension-results",
          label: "Dimension Results",
          icon: ChartColumn,
        },
      ],
    },
    {
      /// Done once and then not thought about — until it is wrong, and then
      /// every posting that leans on it is wrong the same way.
      ///
      /// Ordered as ERPNext's Accounting workspace orders its Setup card
      /// (Chart of Accounts, Accounting Dimension, Mode of Payment, Journal
      /// Entry Template, …), with our own masters beside them. Every master
      /// here decides where money lands through an account link, and each row
      /// has a "Link accounts" that opens Account Links on it.
      label: "Setup",
      items: [
        {
          // Moved here from Accounting on the owner's say-so (ERPNext keeps
          // the chart under Setup). The path is kept, so every link to it
          // still lands.
          path: "/finance/accounting/chart-of-accounts",
          label: "Chart of Accounts",
          icon: FileStack,
          moved: ["/finance/accounts"],
        },
        {
          path: "/finance/setup/dimensions",
          label: "Accounting Dimensions",
          icon: Shapes,
        },
        {
          path: "/finance/setup/payment-methods",
          label: "Payment Methods",
          icon: WalletCards,
        },
        {
          path: "/finance/setup/shop-payment-methods",
          label: "Shop Payment Methods",
          icon: Store,
        },
        {
          path: "/finance/setup/journal-templates",
          label: "Journal Entry Templates",
          icon: Copy,
        },
        {
          path: "/finance/setup/expense-categories",
          label: "Expense Categories",
          icon: FolderTree,
        },
        {
          path: "/finance/setup/pay-components",
          label: "Pay Components",
          icon: BadgeDollarSign,
        },
        {
          path: "/finance/setup/asset-classes",
          label: "Asset Classes",
          icon: Package,
        },
        {
          path: "/finance/setup/account-links",
          label: "Account Links",
          icon: GitBranch,
          // The old per-site map lived at both of these. Its decisions are
          // links now, and a bookmark to the map lands on them.
          moved: ["/finance/account-map", "/finance/setup/account-map"],
        },
        {
          path: "/finance/setup/posting-readiness",
          label: "Posting Readiness",
          icon: ShieldCheck,
          // Red rather than amber: a posting that needs a role with no
          // account is refused outright, so this is a stoppage and not a
          // backlog. The badge sits on the screen that counts the gaps.
          badge: "bad",
          useCount: useUnmappedMeaningCount,
        },
        {
          path: "/finance/setup/line-categories",
          label: "Line Categories",
          icon: Tags,
          moved: ["/finance/categories"],
        },
        {
          path: "/finance/setup/edc-mdr",
          label: "EDC & MDR",
          icon: CreditCard,
          moved: ["/finance/sales-setup"],
        },
        {
          path: "/finance/setup/giro-templates",
          label: "Giro Templates",
          icon: Printer,
          moved: ["/finance/giro-print"],
        },
      ],
    },
    {
      /// ERPNext's Opening & Closing: the months that exist, and a range's
      /// result moved into retained earnings.
      label: "Opening & Closing",
      items: [
        // The only screen that OPENS a month. Nothing can be posted into a
        // month that does not exist, which somebody usually discovers at the
        // till rather than here — hence the badge.
        {
          path: "/finance/setup/periods",
          label: "Fiscal Periods",
          icon: CalendarDays,
          badge: "warn",
          useCount: useMonthNotOpenCount,
          moved: ["/finance/periods"],
        },
        {
          path: "/finance/closing/period-closing-voucher",
          label: "Period Closing Voucher",
          icon: CalendarCheck,
        },
      ],
    },
    {
      /// ERPNext's Taxes card: the tax masters. Labelled apart from the Tax
      /// group above, which is where tax is owed, paid and filed.
      label: "Tax Setup",
      items: [
        {
          path: "/finance/tax-setup/withholding",
          label: "Tax Withholding Category",
          icon: Percent,
        },
        {
          path: "/finance/tax-setup/types",
          label: "Tax Types",
          icon: ReceiptText,
        },
      ],
    },
    {
      /// ERPNext's Settings card: Accounts Settings, and the two policies
      /// that sit beside it here — how posting runs, and who may do what.
      label: "Settings",
      items: [
        {
          path: "/finance/settings/accounts",
          label: "Accounts Settings",
          icon: Settings,
        },
        {
          path: "/finance/settings/posting-policies",
          label: "Posting Policies",
          icon: Workflow,
        },
        {
          path: "/finance/settings/permissions",
          label: "Role Permissions",
          icon: KeyRound,
        },
      ],
    },
  ],
}
