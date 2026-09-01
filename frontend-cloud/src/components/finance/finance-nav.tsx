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
      { label: "Supplier Bills", accounts: "2012001001" },
      { label: "Payments", accounts: "1011002 · 1011003" },
      { label: "Outstanding Giro", accounts: "2012002" },
      { label: "Purchase Discounts", accounts: "8010110003" },
      { label: "Non-Merchandise", accounts: "2012001003" },
      { label: "Affiliate Payables", accounts: "2012301 · 2012302" },
      { label: "Accrued Expenses", accounts: "2012201" },
    ],
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: Receipt,
    items: [
      { label: "Expense Bills", accounts: "6* · 70101 · 70103" },
      { label: "Selling", accounts: "60101" },
      { label: "Payroll", accounts: "60102" },
      { label: "Admin & General", accounts: "60103" },
      { label: "Repairs & Maintenance", accounts: "60104" },
      { label: "Rent", accounts: "70101" },
      { label: "Prepaid & Advances", accounts: "1011301 · 1011303" },
    ],
  },
  {
    id: "cash",
    label: "Cash & Bank",
    icon: Banknote,
    items: [
      { label: "Cash Position", accounts: "1011001" },
      { label: "Bank Position", accounts: "1011002-4" },
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
      { label: "Card Receivables", accounts: "1011101" },
      { label: "Settlement", accounts: "6010110002" },
      { label: "Other Receivables", accounts: "1011102" },
      { label: "Inter-unit", accounts: "1021401-3" },
      { label: "Doubtful Debt", accounts: "1011103" },
      { label: "Other Income & Rent", accounts: "8010110004-7" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & COGS",
    icon: Boxes,
    items: [
      { label: "Inventory Value", accounts: "1011201001" },
      { label: "Goods in Transit", accounts: "1011203" },
      { label: "Shopping Bags", accounts: "1011202 · 1011204" },
      { label: "Cost of Goods", accounts: "5010110001" },
      { label: "Stock Count Variance", accounts: "8010110006" },
      { label: "Damage Allowance", accounts: "1011299" },
    ],
  },
  {
    id: "assets",
    label: "Fixed Assets",
    icon: Building2,
    items: [
      { label: "Asset Register", accounts: "10215" },
      { label: "Depreciation", accounts: "10216 · 70102" },
      { label: "Disposal" },
      { label: "Intangibles", accounts: "10217" },
      { label: "Other Assets", accounts: "10318" },
    ],
  },
  {
    id: "loans",
    label: "Loans & Financing",
    icon: Landmark,
    items: [
      { label: "Long-term Loans", accounts: "20224" },
      { label: "Current Portion", accounts: "20125" },
      { label: "Interest", accounts: "80201" },
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
      { label: "Balance Sheet", accounts: "1 · 2 · 3" },
      { label: "Profit & Loss", accounts: "4–8" },
      { label: "P&L by Location" },
      { label: "Expense Report", accounts: "6 · 7" },
      { label: "Fixed Asset Report", accounts: "10215 · 10216" },
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
