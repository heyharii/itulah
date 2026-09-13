import {
  BellRing,
  Boxes,
  ArrowLeftRight,
  BarChart3,
  CalendarCheck,
  CalendarRange,
  HandCoins,
  Inbox,
  Scale,
  Sunrise,
  TrendingUp,
  KeyRound,
  Layers,
  LayoutGrid,
  PackagePlus,
  RefreshCw,
  Receipt,
  ScanBarcode,
  Sparkles,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

/// The navigation registry — one declaration the whole app reads.
///
/// The tab bar draws `tabs`, the app-bar reads a screen's title out of here,
/// and `routes.tsx` builds its tree from the same arrays. A path is declared
/// once, so a tab cannot 404 and a screen cannot be routed with nothing
/// leading to it.
///
/// The shape is not the console's. There is no rail and no sidebar, because
/// DESIGN.md's phone expression has neither: **three to five destinations in a
/// floating squircle bar, everything else behind the hamburger**. Four is what
/// this till has — sell, receive, stock, reports — and that is not a
/// simplification of the console's nine modules, it is the whole of what
/// `store_router` can do.

export interface TabItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so the two cannot drift.
  readonly path: string
  /// The app-bar title while this screen is showing.
  readonly label: string
  readonly icon: LucideIcon
}

export interface PushedItem extends TabItem {
  /// Where the back chip goes when there is no history to go back to — a
  /// reload on a pushed screen, or a link opened cold. Declared rather than
  /// inferred so the arrow always lands somewhere real.
  readonly back: string
  /// Whether the hamburger drawer put this screen on the stack. Drawer screens
  /// are not part of any tab, so nothing in the bar lights up for them.
  readonly fromDrawer?: boolean
}

/// The bar, left to right, in the order a shift uses them: what is sold, what
/// the shop has, what arrives, what is on the shelf, what it all came to.
///
/// Five, and DESIGN.md's phone rule is **three to five**, so this is the last
/// one that fits. The catalogue earns it over the drawer because it is not a
/// setting: it is answered out loud to a customer, on the floor, away from the
/// counter, several times an hour — and a destination somebody reaches that
/// often behind a hamburger is a destination they walk to the till for instead.
export const tabs: readonly TabItem[] = [
  { path: "/sell", label: "Sell", icon: ScanBarcode },
  { path: "/catalogue", label: "Catalogue", icon: LayoutGrid },
  { path: "/receive", label: "Receive", icon: PackagePlus },
  { path: "/stock", label: "Stock", icon: Layers },
  { path: "/reports", label: "Reports", icon: BarChart3 },
]

/// Screens reached by pushing, not by tapping the bar.
///
/// A drill-in is a full-screen push with a back arrow and **no tab bar** —
/// DESIGN.md is explicit that a pushed detail hides it. That rule is what keeps
/// a payment screen from being escapable by a stray thumb halfway through
/// taking money.
export const pushed: readonly PushedItem[] = [
  { path: "/sell/tender", label: "Payment", icon: Wallet, back: "/sell" },
  { path: "/sell/receipt", label: "Receipt", icon: Receipt, back: "/sell" },
  {
    path: "/sell/queue",
    label: "Not yet sent",
    icon: ArrowLeftRight,
    back: "/sell",
  },
  { path: "/sell/returns", label: "Returns", icon: Undo2, back: "/sell" },
  // The drawer. Reached from the function board rather than the tab bar: it is
  // pressed twice a day, at the two ends of a shift, and a destination in the
  // bar is a destination somebody taps by accident mid-sale.
  { path: "/till/shift", label: "Shift", icon: Wallet, back: "/sell" },
  {
    path: "/catalogue/product",
    label: "Product",
    icon: LayoutGrid,
    back: "/catalogue",
  },
  // Not a tab of its own. What is on is a question about the range, asked while
  // looking at the range, so it is reached from the catalogue rather than from
  // a sixth squircle that would break the bar's own rule.
  {
    path: "/catalogue/offers",
    label: "Promotions",
    icon: Sparkles,
    back: "/catalogue",
  },
  {
    path: "/stock/movements",
    label: "Movements",
    icon: ArrowLeftRight,
    back: "/stock",
  },
  {
    path: "/node/sync",
    label: "Sync",
    icon: RefreshCw,
    back: "/sell",
    fromDrawer: true,
  },
  {
    path: "/node/password",
    label: "Change password",
    icon: KeyRound,
    back: "/sell",
    fromDrawer: true,
  },
  // ── The money screens ─────────────────────────────────────────────────────
  //
  // Reached from the sidebar on a desk and from the drawer on a phone, and
  // never from the tab bar: they are read at the end of a shift by whoever is
  // responsible for the takings, not tapped between customers. That is also
  // why they are `pushed` — a manager reading yesterday's trade with the tab
  // bar still lit would be one thumb away from ringing a sale into it.
  {
    path: "/money/sales",
    label: "Sales",
    icon: TrendingUp,
    back: "/sell",
    fromDrawer: true,
  },
  {
    path: "/money/reconciliation",
    label: "Reconciliation",
    icon: Scale,
    back: "/sell",
    fromDrawer: true,
  },
  {
    path: "/money/expenses",
    label: "Expenses",
    icon: HandCoins,
    back: "/sell",
    fromDrawer: true,
  },
  // ── The people screens ────────────────────────────────────────────────────
  //
  // The first thing in this app that addresses HEAD OFFICE rather than the
  // node behind the counter: the Edge has no employee, no roster and no leave,
  // and a shop's rota is a fact about the company rather than about the
  // shop's machine. See `lib/cloud.ts`.
  //
  // Five entries and no more, which is `prototypes/hr/menu-final.md`'s own
  // ruling on what a store gets — Ringkasan, Karyawan, Jadwal & Kehadiran,
  // Cuti & Lembur, Laporan — with Payroll and Pengaturan withheld from a shop
  // there and withheld here. Reports is the one of the five with nothing
  // behind it: there is no store-scoped HR report route at the centre, and a
  // nav entry whose endpoint does not exist is worse than a missing entry.
  //
  // Pushed rather than tabbed, like the money screens and for the same reason:
  // read once or twice a day by whoever is responsible for the shop's people,
  // never tapped between customers.
  //
  // No `fromDrawer` on any of them, and it is a statement of fact rather than
  // an omission: the hamburger in `components/shell/till-shell.tsx` is a
  // hand-written list, not one generated from this flag, and it does not carry
  // a People section. Below `md` these are reached by URL and then by the
  // module's own strip. Adding that section to the drawer is the one change
  // that closes it — and the flag should be set here on the same day.
  { path: "/hr/today", label: "Today", icon: Sunrise, back: "/sell" },
  // The four below fall back to Today rather than to Sell, because a cold
  // reload inside the module should leave somebody in the module.
  {
    path: "/hr/roster",
    label: "Roster",
    icon: CalendarRange,
    back: "/hr/today",
  },
  {
    path: "/hr/requests",
    label: "Leave & overtime",
    icon: Inbox,
    back: "/hr/today",
  },
  { path: "/hr/team", label: "Team", icon: Users, back: "/hr/today" },
  {
    path: "/hr/period",
    label: "Month close",
    icon: CalendarCheck,
    back: "/hr/today",
  },
  // ── The premises ──────────────────────────────────────────────────────────
  //
  // What head office has on its register for THIS shop, read-only: a shop can
  // check what it is holding and cannot add to it, which is the owner's
  // ruling. Addresses the centre like the HR screens above and for the same
  // reason — the Edge has no asset register, because what the company owns is
  // a fact about the company.
  //
  // Pushed and not a sixth tab: DESIGN.md's phone rule is three to five, and a
  // list read at a stock-take does not displace one of the five.
  {
    path: "/shop/assets",
    label: "Assets",
    icon: Boxes,
    back: "/sell",
    fromDrawer: true,
  },
  // What head office has told this shop. In the drawer and never in the
  // app-bar: a count over the selling screen during a queue is an
  // interruption, not news. The console's own bell is in its top bar because
  // a desk is not a counter.
  {
    path: "/shop/news",
    label: "Kabar",
    icon: BellRing,
    back: "/sell",
    fromDrawer: true,
  },
]

export const allNavItems: readonly TabItem[] = [...tabs, ...pushed]

/// ── The desk's navigation ───────────────────────────────────────────────────
///
/// Added 2026-09-13, on the owner's instruction, and it is a real departure
/// from what this app's README says: there was no sidebar here, by design.
/// What the design did not survive is its own second half — the floating tab
/// bar is drawn `md:hidden`, and the desk was supposed to carry the same
/// destinations on its function board. Nothing ever drew that board, so every
/// screen wider than 768px had NO navigation at all: an app-bar with a
/// hamburger holding four account items, and no way to reach Catalogue,
/// Receive, Stock or Reports at all.
///
/// So the counter gets the console's own column, in the console's own tokens,
/// and the phone keeps its squircles. One registry still, and the sections
/// below are an ORDER over paths already declared above — a screen cannot
/// appear here without existing, and `routes.tsx` still throws if it does.
///
/// Money is first because that is the order the desk is used in: whoever opens
/// this on a laptop opened it to read the takings, and whoever is selling is
/// looking at the tab bar on a tablet, where Sell is still first.
export interface NavSection {
  readonly label: string
  readonly paths: readonly string[]
}

/// The HR screens, in the order `prototypes/hr/menu-final.md` sets out — the
/// summary first, because `#/people/overview/today` is the screen the owner
/// pointed at, then the week, then what is waiting, then who works here, then
/// signing the month off.
///
/// Named rather than written inline because **two** navigations draw them: the
/// column below at `md+`, and the module's own strip on a phone, where there is
/// no column. One list, so the two cannot disagree about what HR contains.
const HR_PATHS = [
  "/hr/today",
  "/hr/roster",
  "/hr/requests",
  "/hr/team",
  "/hr/period",
] as const

export const sidebar: readonly NavSection[] = [
  {
    label: "Money",
    paths: [
      "/money/sales",
      "/money/reconciliation",
      "/money/expenses",
      "/reports",
      "/till/shift",
    ],
  },
  {
    label: "Counter",
    paths: ["/sell", "/catalogue", "/receive", "/stock"],
  },
  // Last, under Counter and above the node's own two screens, because it is
  // the section a shop opens least: the rota is read at the start of a day and
  // the month is closed once. Putting people above the counter would rank a
  // monthly job over an hourly one.
  {
    label: "HR",
    paths: HR_PATHS,
  },
  {
    label: "The shop",
    paths: ["/shop/news", "/shop/assets"],
  },
  {
    label: "This node",
    paths: ["/node/sync", "/node/password"],
  },
]

/// Resolve declared paths to the entries that declare them. Throws at module
/// load on a path no nav entry claims, for the same reason `routes.tsx` does: a
/// row that leads nowhere should fail in the console on boot, not under a
/// manager's thumb at closing time.
function resolve(paths: readonly string[]): readonly TabItem[] {
  return paths.map((path) => {
    const item = allNavItems.find((entry) => entry.path === path)
    if (item === undefined) {
      throw new Error(`navigation names "${path}", which no nav entry declares`)
    }
    return item
  })
}

export const sidebarSections: readonly {
  label: string
  items: readonly TabItem[]
}[] = sidebar.map((section) => ({
  label: section.label,
  items: resolve(section.paths),
}))

/// The HR screens for the module's own strip.
///
/// That strip exists because this app's single-navigation rule leaves people
/// nowhere to go below `md`: the column is drawn `md:hidden`-inverted, and the
/// floating squircle bar — which is the phone's navigation — is hidden on a
/// pushed screen, which every HR screen is. A five-screen module with no way
/// to move between its own screens on a phone is four screens nobody reaches.
export const hrItems: readonly TabItem[] = resolve(HR_PATHS)

/// Which tab owns a path, so the bar lights the right squircle for a URL that
/// was pasted in rather than tapped to. Longest match wins.
export function tabForPath(pathname: string): TabItem | null {
  let best: TabItem | null = null
  for (const tab of tabs) {
    const matches = pathname === tab.path || pathname.startsWith(tab.path + "/")
    if (!matches) continue
    if (best === null || tab.path.length > best.path.length) best = tab
  }
  return best
}

/// The pushed screen at this path, if the path is one. `null` means a top-level
/// screen, which is the same thing as "show the tab bar and the hamburger".
export function pushedForPath(pathname: string): PushedItem | null {
  return pushed.find((item) => item.path === pathname) ?? null
}

/// What the app-bar should say. DESIGN.md: sections are named by the section,
/// pushed details by the record — so a screen title comes from one registry and
/// a record id is added by the screen itself.
export function titleForPath(pathname: string): string {
  return allNavItems.find((item) => item.path === pathname)?.label ?? "Till"
}
