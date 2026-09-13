import {
  Archive,
  ArrowLeftRight,
  Banknote,
  BookMarked,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  CreditCard,
  DoorOpen,
  FileStack,
  FileText,
  Gauge,
  HandCoins,
  HardHat,
  Landmark,
  LayoutGrid,
  Network,
  Percent,
  PiggyBank,
  Receipt,
  Repeat,
  Scale,
  ScrollText,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Split,
  Store,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Waves,
  Zap,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Finance, grouped by the work rather than by the balance sheet.
///
/// # The one rule this menu is built on
///
///   *Every account has a home. One account family does not mean one menu.*
///
/// That rule is not a preference; it was earned. An earlier cut of this file
/// checked the eleven groups against the client's chart, found ten account
/// families with nowhere obvious to sit, and proposed ten new menu entries —
/// `Accruals`, `Giro`, `Equity`, `Pre-opening` and so on. That is COA-shaped
/// navigation, and `2012201 ACCRUED EXPENSE` is the counter-example that
/// settles it. One family, 140 leaves, three different owners:
///
///   Gaji YMHD · THR YMHD · BPJS YMHD          → Payroll
///   Telepon · Listrik · Air · Sewa Toko YMHD  → Expenses & Bills
///   Bunga Pinjaman YMHD                       → Financing
///
/// Put the family behind one `Accruals` menu and payroll and financing are
/// mixed back together, which is exactly what grouping by workflow was meant
/// to stop. So the family lives where it is *worked* — three places — and the
/// accountant who needs to see all of it at once gets one consolidated control
/// screen, `Accounting & Close → Accruals & deferrals`. Operational ownership
/// in the domain; accounting control in Accounting.
///
/// The same argument settles the rest of them, and this is where they landed:
///
///   `2012304` Hutang Lain-lain (196)   → Affiliation — these are unit names,
///                                        not general creditors
///   `1011204` BDP Kantong (196)        → Inventory. It is inventory in
///                                        transit; the affiliate credit it
///                                        raises is Affiliation's side of the
///                                        same event, not this one
///   `1011202` Persediaan Kantong (140) → Inventory, as a second class
///   `2012002` Outstanding Giro (70)    → not a menu. A giro is a status a
///                                        Cash & Bank transaction carries,
///                                        outstanding until it clears
///   `3013001` Modal (56)               → Financing → Equity. Not top level:
///                                        retained earnings and the running
///                                        result are produced by the close,
///                                        not entered by anybody
///   `4010113` Penjualan Online (28)    → `Card settlements` widened to
///                                        `Settlements`, filtered by kind
///   `1031802` Pre Opening (28)         → Assets & Projects. It is a deferred
///                                        long-lived cost that amortises, and
///                                        it belongs beside the fit-out it
///                                        paid for
///   `4020110` Management Fee (14)      → Revenue & margin
///   `1031801` Disposed Inventory (14)  → Inventory → Adjustments & loss
///
/// # What is not a menu because it is a report
///
/// Revenue & margin, COGS and payroll expense each had a screen in an earlier
/// cut, and each was a profit-and-loss line with a filter on it. A line of the
/// P&L is a *report*, not a place work happens: nobody opens `COGS` to do
/// something, they open it to read a number, and the number is already on the
/// P&L. So they went to Reports, and the domains kept only the screens where
/// somebody acts.
///
/// # Why only two Reconcile screens
///
/// Cash & bank and Sales are the two places where an outside record has to be
/// matched against ours on a schedule — the bank's statement, and the shop's
/// own takings. Everything else called Reconcile in an earlier cut was really a
/// variance report: Inventory's count-against-books gap belongs on Valuation
/// where the count is, Affiliation's two-sided proof belongs on its overview
/// where the balances are, and Payroll's cost-against-cash check is three
/// numbers that fit in a KPI strip. A menu called Reconcile that does not
/// reconcile against anything external is a report wearing a verb.
///
/// Two more things that look like menus and are not. `Hutang Supplier
/// Suspend` (`2012001002`) is a bill on hold — a status. And a giro, above,
/// is a status. A status that gets its own menu splits one worklist in two and
/// makes "everything I owe" a screen nobody can open.
///
/// # Why not group by accounting classification
///
/// The first cut named its groups Receivables, Payables, Accruals, Prepaids,
/// Interunit — which is how a balance sheet is laid out and not how anybody
/// works. Somebody with a supplier on the phone does not think *payable*; they
/// think *this vendor, this bill, did we pay it*. ERPNext goes the other way,
/// one menu per doctype, which suits an implementer configuring the system and
/// suits nobody doing the month end. We take the QuickBooks shape.
///
/// The classifications did not disappear. They moved to Reports, where they
/// answer a question somebody actually asks.
///
/// # Why Suppliers and Vendors are two menus
///
/// Because the client's own chart splits them, and settles the argument:
///
///   2012001001  Hutang Suppliers Barang Dagangan     → Suppliers
///   2012001002  Hutang Supplier Barang Dagang Suspend
///   2012001003  Hutang Supplier Non Barang Dagang    → Vendors
///
/// Two liability accounts, so two ageing reports, so two menus. Merchandise
/// buying is a weekly rhythm against a purchase order; PLN and the landlord
/// are a monthly rhythm against a meter reading. Same table would serve
/// neither.
///
/// # Why there is no Payments menu
///
/// Paying is an action on a bill, not an object of its own. Their journal says
/// so: `BKK-26-07-00046` is one payment document clearing two accruals and two
/// direct costs — four rows a `Payments` list would show as four payments and
/// a bank statement shows as one line. So `Pay` lives on the bill, and the
/// money movement it causes shows up in Cash & Bank, where the money is.
export const financeLabNav: AppModule = {
  id: "finance-lab",
  label: "Finance baru",
  icon: Landmark,
  home: "/finance-lab",
  sections: [
    {
      items: [{ path: "/finance-lab", label: "Overview", icon: LayoutGrid }],
    },
    {
      label: "Cash & bank",
      items: [
        {
          path: "/finance-lab/cash/accounts",
          label: "Accounts",
          icon: Landmark,
        },
        {
          path: "/finance-lab/cash/transactions",
          label: "Transactions",
          icon: ArrowLeftRight,
        },
        {
          path: "/finance-lab/cash/reconcile",
          label: "Reconcile",
          icon: Scale,
        },
      ],
    },
    {
      label: "Expenses & bills",
      items: [
        { path: "/finance-lab/expenses", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/expenses/suppliers",
          label: "Suppliers",
          icon: Building2,
        },
        { path: "/finance-lab/expenses/vendors", label: "Vendors", icon: Zap },
        { path: "/finance-lab/expenses/bills", label: "Bills", icon: Receipt },
        {
          path: "/finance-lab/expenses/spend",
          label: "Expenses",
          icon: CreditCard,
        },
        {
          path: "/finance-lab/expenses/advances",
          label: "Advances",
          icon: HandCoins,
        },
        {
          path: "/finance-lab/expenses/prepaids",
          label: "Prepaids",
          icon: PiggyBank,
        },
      ],
    },
    {
      label: "Sales",
      items: [
        { path: "/finance-lab/sales", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/sales/reconcile",
          label: "Reconcile",
          icon: Store,
        },
      ],
    },
    {
      label: "Receivables",
      items: [
        { path: "/finance-lab/receivables", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/receivables/balances",
          label: "Receivables",
          icon: Users,
        },
        {
          path: "/finance-lab/receivables/settlements",
          label: "Settlements",
          icon: Coins,
        },
      ],
    },
    {
      label: "Inventory",
      items: [
        { path: "/finance-lab/inventory", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/inventory/valuation",
          label: "Valuation",
          icon: Boxes,
        },
        {
          path: "/finance-lab/inventory/in-transit",
          label: "BDP / in transit",
          icon: Truck,
        },
        {
          path: "/finance-lab/inventory/adjustments",
          label: "Adjustments",
          icon: ClipboardList,
        },
      ],
    },
    {
      label: "Payroll",
      items: [
        { path: "/finance-lab/payroll", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/payroll/payables",
          label: "Payables",
          icon: Wallet,
        },
      ],
    },
    {
      label: "Affiliation",
      items: [
        { path: "/finance-lab/affiliation", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/affiliation/funding",
          label: "Funding",
          icon: Banknote,
        },
        {
          path: "/finance-lab/affiliation/due",
          label: "Due from / due to",
          icon: Split,
        },
        {
          path: "/finance-lab/affiliation/settlements",
          label: "Settlements",
          icon: Network,
        },
      ],
    },
    {
      label: "Assets",
      items: [
        { path: "/finance-lab/assets", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/assets/register",
          label: "Asset register",
          icon: Archive,
        },
        {
          path: "/finance-lab/assets/projects",
          label: "Projects / CIP",
          icon: HardHat,
        },
        {
          path: "/finance-lab/assets/pre-opening",
          label: "Pre-opening",
          icon: DoorOpen,
        },
        {
          path: "/finance-lab/assets/depreciation",
          label: "Depreciation & amortisation",
          icon: TrendingDown,
        },
        {
          path: "/finance-lab/assets/oe-replacement",
          label: "OE replacement",
          icon: Repeat,
        },
      ],
    },
    {
      label: "Tax",
      items: [
        { path: "/finance-lab/tax", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/tax/position",
          label: "Tax position",
          icon: Percent,
        },
        {
          path: "/finance-lab/tax/payments",
          label: "Payments",
          icon: Banknote,
        },
      ],
    },
    {
      label: "Financing",
      items: [
        { path: "/finance-lab/financing", label: "Overview", icon: Gauge },
        {
          path: "/finance-lab/financing/loans",
          label: "Loans",
          icon: Landmark,
        },
        {
          path: "/finance-lab/financing/repayments",
          label: "Repayments",
          icon: CalendarClock,
        },
        { path: "/finance-lab/financing/equity", label: "Equity", icon: Sigma },
      ],
    },
    {
      label: "Accounting & close",
      items: [
        {
          path: "/finance-lab/accounting/journals",
          label: "Journals",
          icon: ScrollText,
        },
        {
          path: "/finance-lab/accounting/adjustments",
          label: "Adjustments",
          icon: SlidersHorizontal,
        },
        {
          path: "/finance-lab/accounting/accruals",
          label: "Accruals & deferrals",
          icon: FileText,
        },
        {
          path: "/finance-lab/accounting/provisions",
          label: "Provisions & reserves",
          icon: ShieldCheck,
        },
        {
          path: "/finance-lab/accounting/rules",
          label: "Schedules & rules",
          icon: ClipboardList,
        },
        {
          path: "/finance-lab/accounting/chart",
          label: "Chart of accounts",
          icon: FileStack,
        },
        {
          path: "/finance-lab/accounting/close",
          label: "Period close",
          icon: CalendarClock,
        },
      ],
    },
    {
      label: "Reports",
      items: [
        {
          path: "/finance-lab/reports/profit-loss",
          label: "Profit & loss",
          icon: TrendingUp,
        },
        {
          path: "/finance-lab/reports/balance-sheet",
          label: "Balance sheet",
          icon: Scale,
        },
        {
          path: "/finance-lab/reports/cash-flow",
          label: "Cash flow",
          icon: Waves,
        },
        {
          path: "/finance-lab/reports/trial-balance",
          label: "Trial balance",
          icon: Sigma,
        },
        {
          path: "/finance-lab/reports/ledger",
          label: "General ledger",
          icon: BookMarked,
        },
        {
          path: "/finance-lab/reports/consolidated",
          label: "Unit / HO / consolidated",
          icon: Network,
        },
      ],
    },
  ],
}
