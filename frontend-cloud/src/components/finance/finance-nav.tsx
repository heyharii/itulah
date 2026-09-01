import { cn } from "@/lib/utils"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  Banknote,
  BookOpen,
  Boxes,
  Building2,
  ClipboardList,
  HandCoins,
  LayoutGrid,
  Landmark,
  Receipt,
  Wallet,
} from "lucide-react"

/// The ten groups of finance, and every screen in them.
///
/// # Why the unbuilt screens are listed
///
/// Because a finance module is a shape before it is a set of features, and
/// somebody has to be able to see that shape to trust it. Nine tenths of this
/// list is not built yet; hiding it would make the module look like four
/// screens that happen to exist, and the first question would be "where is
/// everything else". Showing it greyed says: here is the whole of finance, here
/// is where we are.
///
/// The alternative — dead links that render an empty page — is the worst of
/// both: it looks finished and behaves broken.
///
/// # Why the groups map onto the client's own chart
///
/// Each group is a region of CENTRAL FASHION STORE's account tree rather than a
/// generic ERP menu. `accounts` on each group is what it stands for, and it is
/// shown in the group header, so somebody who knows the chart can see straight
/// away which part of their books a screen is about.
/// The finance routes that exist. A union rather than `string`, because
/// TanStack's `<Link to>` is typed against the route tree and a plain string
/// would need a cast at every call — which is how a typo becomes a dead link
/// that still compiles.
export type FinanceRoute =
  | "/finance"
  | "/finance/accounts"
  | "/finance/account-map"
  | "/finance/journal"
  | "/finance/ledger"
  | "/finance/trial-balance"
  | "/finance/periods"
  | "/finance/payables/bills"
  | "/finance/payables/giro"
  | "/finance/payables/discounts"
  | "/finance/payables/non-merchandise"
  | "/finance/payables/affiliate"
  | "/finance/payables/accrued"
  | "/finance/expenses/selling"
  | "/finance/expenses/payroll"
  | "/finance/expenses/admin"
  | "/finance/expenses/maintenance"
  | "/finance/expenses/rent"
  | "/finance/expenses/prepaid"
  | "/finance/cash/position"
  | "/finance/cash/bank"
  | "/finance/receivables/cards"
  | "/finance/receivables/other"
  | "/finance/receivables/inter-unit"
  | "/finance/receivables/doubtful"
  | "/finance/receivables/other-income"
  | "/finance/inventory/value"
  | "/finance/inventory/in-transit"
  | "/finance/inventory/bags"
  | "/finance/inventory/cogs"
  | "/finance/inventory/damage"
  | "/finance/assets/depreciation"
  | "/finance/assets/intangibles"
  | "/finance/assets/other"
  | "/finance/loans/long-term"
  | "/finance/loans/current"
  | "/finance/loans/interest"
  | "/finance/reports/balance-sheet"
  | "/finance/reports/profit-loss"
  | "/finance/reports/by-location"
  | "/finance/reports/expenses"
  | "/finance/reports/assets"

interface FinanceItem {
  readonly label: string
  readonly to?: FinanceRoute
  /// The client account family this screen is about, in their numbering.
  readonly accounts?: string
  readonly ready?: boolean
}

interface FinanceGroup {
  readonly id: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly items: readonly FinanceItem[]
}

export const FINANCE_GROUPS: readonly FinanceGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutGrid,
    items: [{ label: "Worklist", to: "/finance", ready: true }],
  },
  {
    id: "payables",
    label: "Payables",
    icon: ClipboardList,
    items: [
      { label: "Supplier Bills", accounts: "2012001001", to: "/finance/payables/bills", ready: true },
      { label: "Payments", accounts: "1011002 · 1011003" },
      { label: "Outstanding Giro", accounts: "2012002", to: "/finance/payables/giro", ready: true },
      { label: "Purchase Discounts", accounts: "8010110003", to: "/finance/payables/discounts", ready: true },
      { label: "Non-Merchandise", accounts: "2012001003", to: "/finance/payables/non-merchandise", ready: true },
      { label: "Affiliate Payables", accounts: "2012301 · 2012302", to: "/finance/payables/affiliate", ready: true },
      { label: "Accrued Expenses", accounts: "2012201", to: "/finance/payables/accrued", ready: true },
    ],
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: Receipt,
    items: [
      { label: "Expense Bills", accounts: "6* · 70101 · 70103" },
      { label: "Selling", accounts: "60101", to: "/finance/expenses/selling", ready: true },
      { label: "Payroll", accounts: "60102", to: "/finance/expenses/payroll", ready: true },
      { label: "Admin & General", accounts: "60103", to: "/finance/expenses/admin", ready: true },
      { label: "Repairs & Maintenance", accounts: "60104", to: "/finance/expenses/maintenance", ready: true },
      { label: "Rent", accounts: "70101", to: "/finance/expenses/rent", ready: true },
      { label: "Prepaid & Advances", accounts: "1011301 · 1011303", to: "/finance/expenses/prepaid", ready: true },
    ],
  },
  {
    id: "cash",
    label: "Cash & Bank",
    icon: Banknote,
    items: [
      { label: "Cash Position", accounts: "1011001", to: "/finance/cash/position", ready: true },
      { label: "Bank Position", accounts: "1011002-4", to: "/finance/cash/bank", ready: true },
      { label: "Movements", accounts: "" },
      { label: "Bank Reconciliation" },
      { label: "Store Deposits" },
      { label: "Cash Variance", accounts: "8010110002" },
    ],
  },
  {
    id: "receivables",
    label: "Receivables",
    icon: HandCoins,
    items: [
      { label: "Card Receivables", accounts: "1011101", to: "/finance/receivables/cards", ready: true },
      { label: "Settlement", accounts: "6010110002" },
      { label: "Other Receivables", accounts: "1011102", to: "/finance/receivables/other", ready: true },
      { label: "Inter-unit", accounts: "1021401-3", to: "/finance/receivables/inter-unit", ready: true },
      { label: "Doubtful Debt", accounts: "1011103", to: "/finance/receivables/doubtful", ready: true },
      { label: "Other Income & Rent", accounts: "8010110004-7", to: "/finance/receivables/other-income", ready: true },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & COGS",
    icon: Boxes,
    items: [
      { label: "Inventory Value", accounts: "1011201001", to: "/finance/inventory/value", ready: true },
      { label: "Goods in Transit", accounts: "1011203", to: "/finance/inventory/in-transit", ready: true },
      { label: "Shopping Bags", accounts: "1011202 · 1011204", to: "/finance/inventory/bags", ready: true },
      { label: "Cost of Goods", accounts: "5010110001", to: "/finance/inventory/cogs", ready: true },
      { label: "Stock Count Variance", accounts: "8010110006" },
      { label: "Damage Allowance", accounts: "1011299", to: "/finance/inventory/damage", ready: true },
    ],
  },
  {
    id: "assets",
    label: "Fixed Assets",
    icon: Building2,
    items: [
      { label: "Asset Register", accounts: "10215" },
      { label: "Depreciation", accounts: "10216 · 70102", to: "/finance/assets/depreciation", ready: true },
      { label: "Disposal" },
      { label: "Intangibles", accounts: "10217", to: "/finance/assets/intangibles", ready: true },
      { label: "Other Assets", accounts: "10318", to: "/finance/assets/other", ready: true },
    ],
  },
  {
    id: "loans",
    label: "Loans & Financing",
    icon: Landmark,
    items: [
      { label: "Long-term Loans", accounts: "20224", to: "/finance/loans/long-term", ready: true },
      { label: "Current Portion", accounts: "20125", to: "/finance/loans/current", ready: true },
      { label: "Interest", accounts: "80201", to: "/finance/loans/interest", ready: true },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: BookOpen,
    items: [
      { label: "Chart of Accounts", to: "/finance/accounts", ready: true },
      { label: "Account Map", to: "/finance/account-map", ready: true },
      { label: "Journal Entries", to: "/finance/journal", ready: true },
      { label: "General Ledger", to: "/finance/ledger", ready: true },
      { label: "Trial Balance", to: "/finance/trial-balance", ready: true },
      { label: "Period Close", to: "/finance/periods", ready: true },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: Wallet,
    items: [
      { label: "Balance Sheet", accounts: "1 · 2 · 3", to: "/finance/reports/balance-sheet", ready: true },
      { label: "Profit & Loss", accounts: "4–8", to: "/finance/reports/profit-loss", ready: true },
      { label: "P&L by Location", to: "/finance/reports/by-location", ready: true },
      { label: "Expense Report", accounts: "6 · 7", to: "/finance/reports/expenses", ready: true },
      { label: "Fixed Asset Report", accounts: "10215 · 10216", to: "/finance/reports/assets", ready: true },
    ],
  },
]

/// The standing list of where finance can go.
///
/// Every group is always visible and always open. An accordion would hide nine
/// groups to save the height of about six rows, and the thing it would hide is
/// exactly the map somebody is trying to learn. The column scrolls instead —
/// scrolling a list you can see is a smaller cost than remembering a list you
/// cannot.
export function FinanceNav() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  return (
    <nav aria-label="Finance" className="flex flex-col gap-3 pb-4 text-[13px]">
      {FINANCE_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="text-muted-foreground flex items-center gap-1.5 px-2 pb-1">
            <group.icon className="size-3.5 shrink-0" />
            <span className="truncate text-[11px] font-medium tracking-wide uppercase">
              {group.label}
            </span>
          </div>
          <ul>
            {group.items.map((item) => (
              <li key={item.label}>
                <FinanceLink item={item} path={path} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/// One entry: a link if it exists, and otherwise an honest placeholder.
///
/// The placeholder still shows the client account family it will be about. That
/// is the difference between "not done" and "not thought about", and it is the
/// thing somebody reviewing this module actually wants to know.
function FinanceLink({ item, path }: { item: FinanceItem; path: string }) {
  const shared =
    "flex items-baseline justify-between gap-2 rounded-md px-2 py-1 leading-5"
  if (item.to === undefined || item.ready !== true) {
    return (
      <span
        className={cn(shared, "text-muted-foreground/45")}
        title="Not built yet"
        aria-disabled
      >
        <span className="truncate">{item.label}</span>
        {item.accounts !== undefined && item.accounts !== "" && (
          <span className="shrink-0 font-mono text-[10px] opacity-70">{item.accounts}</span>
        )}
      </span>
    )
  }
  // `/finance` is the overview and must not light up for every child route.
  const here = item.to === "/finance" ? path === "/finance" : path.startsWith(item.to)
  return (
    <Link
      to={item.to}
      className={cn(
        shared,
        "hover:bg-muted transition-colors",
        here && "bg-muted font-medium",
      )}
    >
      <span className="truncate">{item.label}</span>
      {item.accounts !== undefined && item.accounts !== "" && (
        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
          {item.accounts}
        </span>
      )}
    </Link>
  )
}
