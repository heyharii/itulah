import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  Boxes,
  Building2,
  Briefcase,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Clock4,
  Gauge,
  Hammer,
  HandCoins,
  Handshake,
  KeyRound,
  Layers,
  LayoutGrid,
  Package,
  PackagePlus,
  RefreshCw,
  Scale,
  Send as SendIcon,
  Server,
  Sun,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Fingerprint,
  GraduationCap,
  HeartHandshake,
  Receipt,
  Repeat2,
  Percent,
  PlayCircle,
  Megaphone,
  TicketPercent,
  TrendingDown,
  UserCheck,
  type LucideIcon,
} from "lucide-react"

/// The navigation registry — one declaration the whole app reads.
///
/// The shape is the hub's (`frontend-hub/src/lib/navigation.ts`), on the
/// owner's instruction of 2026-09-25 that the till should look and move like
/// the console: a dark rail of **modules** at the edge, a light sidebar of the
/// active module's **screens** beside it, and a bar over the page carrying the
/// breadcrumb. The rail draws `modules`, the sidebar draws the active module's
/// `sections`, the phone's bottom bar draws `phoneTabs`, and `routes.tsx`
/// builds the router from the same arrays — so a row cannot 404 and a screen
/// cannot exist with nothing leading to it.
///
/// What is NOT the hub's is the set of modules. A shop has a counter, a range,
/// a stockroom, a till's takings, its people and its premises; head office's
/// finance, procurement and master data are not here because `store_router`
/// cannot answer them.

export interface NavItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so it cannot drift.
  readonly path: string
  readonly label: string
  readonly icon: LucideIcon
  /// Routed and linkable, but not a row in the sidebar: a screen somebody
  /// arrives at from another screen (the payment step, a product's card), not
  /// one they set out for.
  readonly hidden?: boolean
  /// Where the back link goes on a hidden screen when there is no history to
  /// go back to — a reload, or a link opened cold.
  readonly back?: string
  /// Old paths this screen used to answer at. `routes.tsx` redirects them
  /// here, carrying their search, so a bookmark made before the move still
  /// lands on the screen it named.
  readonly moved?: readonly string[]
}

export interface NavSection {
  /// Absent for the first group, which sits directly under the module title.
  readonly label?: string
  readonly items: readonly NavItem[]
}

export interface AppModule {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /// Where the module's rail tile lands. Always the first visible item.
  readonly home: string
  readonly sections: readonly NavSection[]
}

// ── The range ───────────────────────────────────────────────────────────────

const catalogue: AppModule = {
  id: "catalogue",
  label: "Catalogue",
  icon: LayoutGrid,
  home: "/catalogue",
  sections: [
    {
      items: [
        { path: "/catalogue", label: "Catalogue", icon: LayoutGrid },
        {
          path: "/catalogue/product",
          label: "Product",
          icon: LayoutGrid,
          hidden: true,
          back: "/catalogue",
        },
      ],
    },
  ],
}

// ── What is on ───────────────────────────────────────────────────────────────
//
// Everything head office has put on offer at this shop, read from the price
// book the node already holds — so it answers with the line down. The hub's
// Commercial module (`frontend-hub/src/screens/commercial`) is where these
// are written; this is where a shop reads them.

const promotions: AppModule = {
  id: "promotions",
  label: "Promotions",
  icon: Percent,
  home: "/promotions",
  sections: [
    {
      items: [
        {
          path: "/promotions",
          label: "Promotions",
          icon: Percent,
          moved: ["/catalogue/offers"],
        },
        { path: "/promotions/campaigns", label: "Campaigns", icon: Megaphone },
        {
          path: "/promotions/price-drops",
          label: "Price drops",
          icon: TrendingDown,
        },
        {
          path: "/promotions/vouchers",
          label: "Vouchers",
          icon: TicketPercent,
        },
      ],
    },
  ],
}

// ── The stockroom ───────────────────────────────────────────────────────────

const stock: AppModule = {
  id: "stock",
  label: "Stock",
  icon: Layers,
  home: "/stock",
  sections: [
    {
      items: [
        { path: "/stock", label: "On hand", icon: Layers },
        { path: "/receive", label: "Receive", icon: PackagePlus },
        { path: "/stock/send", label: "Send", icon: SendIcon },
        { path: "/stock/movements", label: "Movements", icon: ArrowLeftRight },
      ],
    },
  ],
}

// ── The takings ─────────────────────────────────────────────────────────────

const money: AppModule = {
  id: "money",
  label: "Money",
  icon: Wallet,
  home: "/money/sales",
  sections: [
    {
      items: [
        { path: "/money/sales", label: "Sales", icon: TrendingUp },
        { path: "/money/reconciliation", label: "Reconciliation", icon: Scale },
        { path: "/money/expenses", label: "Expenses", icon: HandCoins },
        { path: "/reports", label: "Reports", icon: BarChart3 },
      ],
    },
  ],
}

// ── The people ──────────────────────────────────────────────────────────────
//
// The shop's face of the People prototype (`prototypes/hr-v3/hr.html`, role
// "HR toko", `navModel()`): the same menu head office has, minus Setup and the
// HRMS map — a shop records what happened (who came, who asked for leave, who
// worked late, what was spent) and head office owns the rules and the money.
// Fourteen screens in the prototype's four groups and its order; Payroll is a
// shop's month close, not a run.

const people: AppModule = {
  id: "people",
  label: "People",
  icon: Users,
  home: "/hr/overview",
  sections: [
    {
      items: [
        {
          path: "/hr/overview",
          label: "Overview",
          icon: Gauge,
          moved: ["/hr/today"],
        },
        {
          path: "/hr/directory",
          label: "Directory",
          icon: Users,
          moved: ["/hr/team"],
        },
      ],
    },
    {
      label: "Time",
      items: [
        { path: "/hr/roster", label: "Roster", icon: CalendarRange },
        { path: "/hr/attendance", label: "Attendance", icon: Fingerprint },
        {
          path: "/hr/leave",
          label: "Leave",
          icon: Sun,
          moved: ["/hr/requests"],
        },
        { path: "/hr/overtime", label: "Overtime", icon: Clock4 },
      ],
    },
    {
      label: "Pay",
      items: [
        {
          path: "/hr/payroll",
          label: "Payroll",
          icon: PlayCircle,
          moved: ["/hr/period"],
        },
        { path: "/hr/expenses", label: "Expenses", icon: Receipt },
        { path: "/hr/benefits", label: "Benefits", icon: HeartHandshake },
      ],
    },
    {
      label: "Talent",
      items: [
        {
          path: "/hr/recruitment",
          label: "Recruitment",
          icon: Briefcase,
          moved: ["/hr/interviews"],
        },
        {
          path: "/hr/lifecycle",
          label: "Onboarding & exit",
          icon: ClipboardList,
          moved: ["/hr/tasks"],
        },
        {
          path: "/hr/changes",
          label: "Employment changes",
          icon: Repeat2,
        },
        { path: "/hr/performance", label: "Performance", icon: Target },
        { path: "/hr/training", label: "Training", icon: GraduationCap },
      ],
    },
  ],
}

// ── The premises ────────────────────────────────────────────────────────────
//
// General affairs for THIS shop only: the hub's GA domain
// (`frontend-hub/src/screens/{ga,assets,contracts,maintenance,supplies}`) cut
// down to what a shop has — its own assets, the contracts that keep it open
// (rent, services, insurance, permits, utilities), its repairs and servicing,
// and what it asks head office for. Vendors, letters and the other places'
// registers are head office's and are not here. The client's own chart of
// accounts carries the same split per shop (C001–C013): rent, fixed assets
// and operating equipment, repairs, utilities, permits and insurance.
//
// Overview first, then the three registers a shop READS — what it holds, the
// deals it runs under, what is scheduled to be serviced — and last the two
// places it ASKS: a repair when something breaks, supplies when something
// runs out. Every screen is answered by head office through the calls the
// edge→cloud relay allowlists, always for this node's own site.
const ga: AppModule = {
  id: "ga",
  label: "GA",
  icon: Building2,
  home: "/ga",
  sections: [
    {
      items: [{ path: "/ga", label: "Overview", icon: Gauge }],
    },
    {
      label: "Premises",
      items: [
        {
          path: "/ga/assets",
          label: "Assets",
          icon: Boxes,
          moved: ["/shop/assets"],
        },
        { path: "/ga/contracts", label: "Contracts", icon: Handshake },
        { path: "/ga/servicing", label: "Servicing", icon: CalendarClock },
      ],
    },
    {
      label: "Requests",
      items: [
        { path: "/ga/repairs", label: "Repairs", icon: Hammer },
        { path: "/ga/supplies", label: "Supplies", icon: Package },
      ],
    },
  ],
}

/// The rail's column, top to bottom, in the order a shift reaches for them.
export const modules: readonly AppModule[] = [
  catalogue,
  promotions,
  stock,
  money,
  people,
  ga,
]

/// This machine: the one module that is about the node rather than the shop.
/// It sits at the foot of the rail as a bare icon, the way the hub's System
/// does, because it is opened when something is wrong rather than every hour.
export const nodeModule: AppModule = {
  id: "node",
  label: "This node",
  icon: Server,
  home: "/node/sync",
  sections: [
    {
      items: [
        { path: "/node/sync", label: "Sync", icon: RefreshCw },
        { path: "/node/tills", label: "Till approvals", icon: UserCheck },
        { path: "/node/password", label: "Change password", icon: KeyRound },
      ],
    },
  ],
}

/// What head office has said to this shop — the hub's bell. Not a module a
/// shop works in, so it is a bell in the bar and an icon at the rail's foot
/// rather than a tile in the column.
export const newsModule: AppModule = {
  id: "news",
  label: "Kabar",
  icon: BellRing,
  home: "/news",
  sections: [
    {
      items: [
        {
          path: "/news",
          label: "Kabar",
          icon: BellRing,
          moved: ["/shop/news"],
        },
      ],
    },
  ],
}

export const allModules: readonly AppModule[] = [
  ...modules,
  newsModule,
  nodeModule,
]

export const allNavItems: readonly NavItem[] = allModules.flatMap((module) =>
  module.sections.flatMap((section) => section.items),
)

/// Whether a module earns a sidebar column at all. One screen does not: a
/// column holding a single row is a column saying what the rail already said,
/// and the width is worth more to the grid beside it (the catalogue).
export function hasSidebar(module: AppModule): boolean {
  return visibleSections(module).flatMap((section) => section.items).length > 1
}

/// The sidebar's rows for a module: everything that is not `hidden`.
export function visibleSections(module: AppModule): readonly NavSection[] {
  return module.sections
    .map((section) => ({
      label: section.label,
      items: section.items.filter((item) => item.hidden !== true),
    }))
    .filter((section) => section.items.length > 0)
}

/// The phone's bottom bar. A phone has no rail and no sidebar, so the four
/// places a shop goes most sit under the thumb and everything else is behind
/// the last tab, which opens the same rail and sidebar as a drawer.
export const phoneTabs: readonly AppModule[] = [catalogue, stock, money, people]

/// The nav entry at this exact path, or the longest one it sits under.
export function screenForPath(pathname: string): NavItem | undefined {
  let best: NavItem | undefined
  for (const item of allNavItems) {
    const matches =
      pathname === item.path || pathname.startsWith(`${item.path}/`)
    if (matches && item.path.length > (best?.path.length ?? -1)) best = item
  }
  return best
}

/// The module that owns a path — by the screen it resolves to, not by a URL
/// prefix, because the stockroom owns `/receive` and the takings own
/// `/reports`, neither of which shares a prefix with its module's home.
export function moduleForPath(pathname: string): AppModule {
  const screen = screenForPath(pathname)
  if (screen !== undefined) {
    const owner = allModules.find((module) =>
      module.sections.some((section) => section.items.includes(screen)),
    )
    if (owner !== undefined) return owner
  }
  return modules[0]
}

/// Where the app opens, and where a screen with nowhere else to go returns.
/// Selling is not here: the counter runs on the POS app (`pos-desktop`), and
/// this app is the shop's back office.
export const homePath = modules[0].home

/// What the bar and the tab title say for a path.
export function titleForPath(pathname: string): string {
  return screenForPath(pathname)?.label ?? "Till"
}

/// The HR screens, for the People module's own strip on a phone — where the
/// sidebar is a drawer and moving between fourteen related screens by opening
/// it each time is a tap too many every time.
export const hrItems: readonly NavItem[] = visibleSections(people).flatMap(
  (section) => section.items,
)
