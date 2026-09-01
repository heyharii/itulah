import {
  ArrowLeftRight,
  BarChart3,
  KeyRound,
  Layers,
  PackagePlus,
  RefreshCw,
  Receipt,
  ScanBarcode,
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
/// arrives, what is on the shelf, what it all came to.
export const tabs: readonly TabItem[] = [
  { path: "/sell", label: "Sell", icon: ScanBarcode },
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
]

export const allNavItems: readonly TabItem[] = [...tabs, ...pushed]

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
