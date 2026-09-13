import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  KeyRound,
  ListChecks,
  Package,
  RefreshCw,
  Send,
  Tags,
  Truck,
  Upload,
  type LucideIcon,
} from "lucide-react"

/// The navigation registry — one declaration the whole app reads.
///
/// The tab bar draws `tabs`, the app-bar reads a screen's title out of here, and
/// `routes.tsx` builds its tree from the same arrays. A path is declared once,
/// so a tab cannot 404 and a screen cannot be routed with nothing leading to it.
///
/// ## Three kinds of place, not two
///
/// The till this kit came from has two: a destination in the bar, and a pushed
/// detail that hides the bar. A warehouse needs a third.
///
/// The stations are **six**, and DESIGN.md's phone rule is three to five
/// squircles. Tagging and stock-taking are the two that do not fit — not because
/// they are minor (a tagging bench is somebody's whole morning) but because they
/// are worked one at a time, by whoever is at that bench, rather than walked
/// between. So they are `stations`: top-level screens with the tab bar still
/// showing, reached from the work list or the drawer, with no squircle of their
/// own. Making them `pushed` would have hidden the navigation from somebody
/// standing at a station for two hours; putting them in the bar would have made
/// six squircles, which is a bar nobody can hit with a thumb.
export interface NavItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so the two cannot drift.
  readonly path: string
  /// The app-bar title while this screen is showing.
  readonly label: string
  readonly icon: LucideIcon
}

export interface PushedItem extends NavItem {
  /// Where the back chip goes when there is no history to go back to — a reload
  /// on a pushed screen, or a link opened cold. Declared rather than inferred so
  /// the arrow always lands somewhere real.
  readonly back: string
  /// Whether the hamburger drawer put this screen on the stack. Drawer screens
  /// are not part of any station, so nothing in the bar lights up for them.
  readonly fromDrawer?: boolean
}

/// The bar, left to right: the work list first, then the stations goods pass
/// through in the order they move — received, picked, packed, sent.
///
/// Five, and the phone rule's ceiling, so nothing else may join it. The work
/// list earns the first squircle because it is the only screen that answers
/// "what should I be doing" — a floor where everybody has to check four stations
/// to find their work is a floor that checks none of them.
export const tabs: readonly NavItem[] = [
  { path: "/tugas", label: "Tugas", icon: ClipboardList },
  { path: "/terima", label: "Terima", icon: Truck },
  { path: "/ambil", label: "Ambil", icon: ListChecks },
  { path: "/kemas", label: "Kemas", icon: Boxes },
  { path: "/kirim", label: "Kirim", icon: Send },
]

/// The two stations with no squircle. Top-level all the same: the bar stays, the
/// hamburger stays, and nothing in the bar is lit.
export const stations: readonly NavItem[] = [
  { path: "/tag", label: "Tag", icon: Tags },
  { path: "/opname", label: "Opname", icon: ClipboardCheck },
]

/// Screens reached by pushing, not by tapping the bar.
///
/// A drill-in is a full-screen push with a back arrow and **no tab bar**. That
/// rule is what keeps a half-finished count sheet from being escapable by a
/// stray thumb: the way out is Simpan or the back arrow, both of which say what
/// happens to what was typed.
export const pushed: readonly PushedItem[] = [
  { path: "/terima/hitung", label: "Hitung", icon: ClipboardList, back: "/terima" },
  { path: "/terima/periksa", label: "Periksa", icon: ClipboardCheck, back: "/terima" },
  { path: "/tag/kerjaan", label: "Kerjaan tag", icon: Tags, back: "/tag" },
  { path: "/ambil/ronde", label: "Ronde", icon: ListChecks, back: "/ambil" },
  { path: "/kemas/kotak", label: "Isi koli", icon: Package, back: "/kemas" },
  { path: "/kemas/koli", label: "Koli", icon: Boxes, back: "/kemas" },
  { path: "/kirim/muat", label: "Muat", icon: Truck, back: "/kirim" },
  { path: "/opname/lembar", label: "Lembar opname", icon: ClipboardCheck, back: "/opname" },
  {
    path: "/node/sinkron",
    label: "Sinkron",
    icon: RefreshCw,
    back: "/tugas",
    fromDrawer: true,
  },
  {
    path: "/node/antrean",
    label: "Belum terkirim",
    icon: Upload,
    back: "/tugas",
    fromDrawer: true,
  },
  {
    path: "/node/sandi",
    label: "Ganti sandi",
    icon: KeyRound,
    back: "/tugas",
    fromDrawer: true,
  },
]

export const allNavItems: readonly NavItem[] = [...tabs, ...stations, ...pushed]

/// Which tab owns a path, so the bar lights the right squircle for a URL that
/// was pasted in rather than tapped to. Longest match wins; a station returns
/// nothing, which is the whole point of it being one.
export function tabForPath(pathname: string): NavItem | null {
  let best: NavItem | null = null
  for (const tab of tabs) {
    const matches = pathname === tab.path || pathname.startsWith(tab.path + "/")
    if (!matches) continue
    if (best === null || tab.path.length > best.path.length) best = tab
  }
  return best
}

/// The pushed screen at this path, if the path is one. `null` means a top-level
/// screen — a tab or a station — which is the same thing as "show the tab bar
/// and the hamburger".
export function pushedForPath(pathname: string): PushedItem | null {
  return pushed.find((item) => item.path === pathname) ?? null
}

/// What the app-bar should say. Sections are named by the section, pushed
/// details by the record — so a screen title comes from this registry and a
/// record id is added by the screen itself.
export function titleForPath(pathname: string): string {
  return allNavItems.find((item) => item.path === pathname)?.label ?? "Lantai"
}
