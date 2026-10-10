import {
  BookOpen,
  Boxes,
  Landmark,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Shirt,
  ShoppingCart,
  Store,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react"

import type { SectionCode } from "@/lib/queries/invitations"
import { allotmentNav } from "@/screens/allotment/nav"
import { assistantNav } from "@/screens/assistant/nav"
import { commercialNav } from "@/screens/commercial/nav"
import { executiveNav } from "@/screens/executive/nav"
import { financeNav } from "@/screens/finance/nav"
import { homeNav } from "@/screens/home/nav"
import { meNav } from "@/screens/me/nav"
import { mobileNav } from "@/screens/mobile/nav"
import { inventoryNav } from "@/screens/inventory/nav"
import { masterNav, useNewArticlesCount } from "@/screens/master/nav"
import { merchandiseArticlesNav } from "@/screens/merchandise/nav"
import { membersNav } from "@/screens/members/nav"
import { operationsNav } from "@/screens/operations/nav"
import { peopleNav } from "@/screens/people/nav"
import { procurementNav } from "@/screens/procurement/nav"
import { reportsNav } from "@/screens/reports/nav"
import { salesNav } from "@/screens/sales/nav"
import { storesNav } from "@/screens/stores/nav"
import { systemNav } from "@/screens/system/nav"
import { lettersNav } from "@/screens/letters/nav"
import { assetsNav } from "@/screens/assets/nav"
import { contractsNav } from "@/screens/contracts/nav"
import { maintenanceNav, serviceScheduleNav } from "@/screens/maintenance/nav"
import { vendorsNav } from "@/screens/vendors/nav"
import { chatNav, discussionsNav, libraryNav } from "@/screens/workplace/nav"
import { gaOverviewNav } from "@/screens/ga/nav"
import { gaLocationsNav } from "@/screens/locations/nav"
import { gaSuppliesNav } from "@/screens/supplies/nav"

/// The navigation registry — one declaration the whole app reads.
///
/// The sidebar draws `modules` as its rows and the active module's `sections`
/// as the sub-items under it, the command palette flattens the lot, and
/// `routes.tsx` builds its tree from the same array. That single source is the point: this app covers ~147 cloud
/// endpoints, and the way a surface that size goes wrong is a screen that
/// exists but is reachable from nowhere, or a nav entry pointing at a route
/// somebody renamed. Both become impossible when there is one list.
///
/// A module maps to a family of endpoints on the cloud node, so "does every
/// backend function have a home?" is answered by reading this file against
/// `src/cloud/http/mod.rs`.

/// Whom a nav item is for, when it is not for everyone.
///
/// One value, and only one, because the split the business actually has is
/// binary: head office is the **employer** — contracts, pay, and every rule the
/// places are measured against — and a store or DC manager runs a place inside
/// those rules. There is no third audience, and a screen only a place manager
/// needs does not exist: everything they do, head office also reads.
///
/// The caller's rung is deliberately NOT part of this. Whether an HR assistant
/// may *set* the attendance policy as well as read it is `required_role`'s
/// answer, re-checked on the route; encoding it here as well would be a second
/// copy of the ladder, kept in a file the server never reads.
///
/// **This hides rows; it does not grant anything.** Every bound is enforced
/// server-side, and ⌘K can still reach a hidden path — where the screen shows
/// the server's refusal, which is the honest outcome. A menu filtered to what
/// somebody can use is a convenience; the route that refuses is the control.
export type Audience = "employer"

export interface NavItem {
  /// Absolute path. Must match a route in `routes.tsx` — the router is built
  /// from these, so it cannot drift.
  readonly path: string
  readonly label: string
  /// What the phone's bottom bar calls it when the full label does not fit a
  /// fifth of the width ("Orders" for Purchase Orders). Absent: the label.
  readonly short?: string
  readonly icon: LucideIcon
  /// Which tint the count wears. Only read when `useCount` returns a number
  /// above zero — on its own it draws nothing, which is why the modules that
  /// declared it before there was anything to draw are unaffected.
  readonly badge?: "bad" | "warn"
  /// A React hook the sidebar may call to get this item's count.
  ///
  /// A hook and not a number, because the count is live and this file is a
  /// static declaration read by four different things — the rail, the sidebar,
  /// the palette and the router. A number here would mean all four paid for a
  /// fetch; a hook is called by exactly one of them, on exactly the rows that
  /// declare it, and only while its module is the one on screen.
  ///
  /// It must be safe to call on every render and must not throw while its data
  /// is loading. Return `null` for "not asked yet" — distinct from `0`, which
  /// means asked and answered "nothing", and both draw nothing.
  readonly useCount?: () => number | null | undefined
  /// Who this item is for. Absent means everyone who can see the module.
  ///
  /// Unlike `hidden`, which is a fixed property of the screen, this is answered
  /// per caller by the module's `useAudience`. A module that declares neither
  /// is unaffected by any of it.
  readonly audience?: Audience
  /// Paths this screen used to answer at, redirected here.
  ///
  /// The item-level twin of `AppModule.moved`, and for a case that one cannot
  /// express: Suppliers moved BETWEEN modules on 2026-09-12, so redirecting
  /// `/master/suppliers` to the new module's `home` would land somebody on the
  /// order book rather than on the screen they asked for. These redirect to
  /// `path` — the screen itself — carrying their search parameters, so a link
  /// with `?supplier=` still opens the record it named.
  ///
  /// Not nav entries: `routes.tsx` generates redirects from them, and a row in
  /// ⌘K that opens a redirect is a row naming a page nobody can point at.
  readonly moved?: readonly string[]
  /// Routed and findable, but not a sub-item in the sidebar.
  ///
  /// For a screen its module reaches by a link from another screen rather than
  /// by navigating to it cold — a price amendment opened from a notification,
  /// a supplier item opened from the catalogue it belongs to. The path still
  /// has to be declared here — that is what routes it, what makes `AppLink`
  /// accept it and what puts it in ⌘K — but a sidebar is a list of places
  /// somebody sets out for, and these are places somebody arrives at.
  readonly hidden?: boolean
  /// Other paths this row is the parent of, so opening one lights this row.
  ///
  /// Router's own matching lights a row whose path is a PREFIX of where you
  /// are, except on the module's home and base, which match exactly — they are
  /// a prefix of every other path in the module. That leaves a hidden screen
  /// with nothing lit when its parent row is one of those, or when it shares
  /// no prefix with the row it belongs to: Overtime lives under Roster,
  /// Replacements under Repairs, since each stopped being a row of its own on
  /// 2026-09-27.
  ///
  /// Without it, arriving at `/people/overtime` from the Roster button
  /// leaves every row in the column unlit — and a sidebar with nothing lit
  /// reads as a screen that does not belong to anything.
  readonly alsoLights?: readonly string[]
  /// Drawn under the department's **More** fold rather than as a row of its
  /// own.
  ///
  /// The owner's menu of 2026-09-28 names the handful of screens each
  /// department is opened for. Everything else that exists stays one click
  /// further down, under a fold at the foot of the department — not hidden,
  /// not deleted. Routed, linkable and in ⌘K exactly as before: this moves
  /// where the sidebar draws the row and nothing else.
  readonly more?: boolean
  /// Named in the menu, not built yet: drawn greyed with a "Soon" mark, inert,
  /// and left out of ⌘K.
  ///
  /// The path is still declared, and routes to `Placeholder` like any path
  /// with no screen, so the day the screen lands is one line in its folder's
  /// screen map and the flag coming off — not a menu edit.
  readonly soon?: boolean
}

export interface NavSection {
  /// Absent for the first group, which sits directly under the workspace chip.
  readonly label?: string
  readonly items: readonly NavItem[]
  /// Drawn among the department's own rows as a sub-menu: a heading that
  /// folds its rows.
  ///
  /// Closed until you are inside it — arriving at one of its rows opens it.
  /// Folded, the heading wears its rows' counts: a stoppage inside a closed
  /// group is still seen. Needs a `label`; without one the rows are drawn
  /// flat, as before.
  readonly fold?: boolean
}

export interface AppModule {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /// Where the module's own row lands. Always the first item of the first
  /// section, so the row and its first sub-item are the same screen.
  readonly home: string
  /// The URL prefix this module owns, when that is not the same as `home`.
  ///
  /// For most modules the two are one string: `/finance` is both where the row
  /// lands and the prefix every finance screen sits under. Procurement is the
  /// exception. Its first screen is Sourcing, and naming that screen's URL
  /// `/procurement` — the shape every other module uses — put a word on the
  /// address bar that is the name of the DEPARTMENT rather than of the page,
  /// so the one screen in the module whose URL did not say what it was was the
  /// one people arrived at first.
  ///
  /// Splitting the two is what lets Sourcing live at `/procurement/sourcing`
  /// while `/procurement/orders` still draws the procurement sidebar:
  /// `moduleForPath` matches on this, and only the sidebar's row reads `home`.
  readonly base?: string
  /// Paths this module used to be reachable at, redirected to `home`.
  ///
  /// A screen that is retired or absorbed leaves its URL behind in people's
  /// history, in their bookmarks and in the links they have sent each other,
  /// and a 404 is a worse answer than the screen they wanted. `/documents` is
  /// the one today: the Library absorbed it, so `/documents` lands there and
  /// the `?document=` that came with it opens the same sheet it always did.
  ///
  /// Not nav entries — `routes.tsx` generates redirects from these, and a row
  /// in ⌘K that opens a redirect is a row that names a page nobody can point
  /// at any more.
  readonly moved?: readonly string[]
  readonly sections: readonly NavSection[]
  /// Draw a hairline above this module's row, in a domain drawn as one flat
  /// list.
  ///
  /// GA is the domain that has one: ten one-row modules read as one column,
  /// and three hairlines split it into the day's work, the registers and the
  /// documents without spending a word on each group — the rule a later
  /// unlabelled section already follows inside a module. It replaced a
  /// labelled `sidebarSection` and a GA-only special case in the sidebar on
  /// 2026-09-27, when the owner asked for a shorter menu.
  readonly divider?: boolean
  /// The count on the module's own row, drawn only while the module is
  /// collapsed — expanded, its sub-items carry their own and the same number
  /// twice is noise.
  ///
  /// Declared on the module rather than summed from its items, and that is a
  /// hooks rule and not a preference: summing would mean calling one hook per
  /// item inside a loop, and the sidebar draws ten modules of differing
  /// lengths. One hook, called unconditionally by one row. The module composes
  /// its own hooks inside it, where calling three in a fixed order is ordinary.
  readonly useCount?: () => number | null | undefined
  /// Which tint that count wears. Worst wins: a module holding one stoppage and
  /// four backlogs is red.
  readonly badge?: "bad" | "warn"
  /// Who the caller is, as far as this module's items are concerned.
  ///
  /// A hook and not a value, for the reason `useCount` is one: the answer comes
  /// from the server and this file is a static declaration read by four
  /// different things. Called unconditionally by the one component that draws
  /// a module row, exactly like `useCount`, so it is never a hook in a loop.
  ///
  /// Return `null` for "not answered yet" — distinct from an answer, and read
  /// as *not yet* rather than as *no*: an item that appears a moment after the
  /// menu is drawn is better than one that vanishes from under the cursor.
  readonly useAudience?: () => Audience | null
  /// Drawn as an icon in the strip above the module list, not as a row in it.
  ///
  /// For the screens that are not part of the business: a conversation, a file,
  /// a report you pull from wherever you are standing. The module list is a map
  /// of what the company does — bought, held, sold, what it cost, who did it —
  /// and a chat window is not one of those. Filed among them, "Workplace" read
  /// as a department nobody works in.
  ///
  /// It changes only where the sidebar draws the row. Routing, ⌘K,
  /// `moduleForPath` and the active highlight treat an aside exactly like any
  /// other module, which is the point: one flag, not a second kind of nav
  /// entry that four readers would each have to learn.
  readonly aside?: boolean
  /// Drawn desaturated and inert. Honest about what is not built yet, rather
  /// than a live tile that opens an empty screen.
  readonly soon?: boolean
  /// Routed and findable, but not a row in the sidebar.
  ///
  /// The module-level twin of `NavItem.hidden`, and for the same reason: the
  /// screens are still built and still reachable — by a pasted URL, by ⌘K, by
  /// a link from a notification — but the module is not a place the sidebar
  /// invites anyone into. Everything except the sidebar's own layout keeps
  /// treating it as an ordinary module, so nothing about routing changes.
  readonly hidden?: boolean
}

/// The rail, left to right. Home first — it is where `/` lands and the one
/// page that belongs to no department — then the reading order of the
/// business: what is bought, what is held, what is sold, what it cost, who did
/// it.
export const modules: readonly AppModule[] = [
  homeNav,
  executiveNav,
  commercialNav,
  masterNav,
  merchandiseArticlesNav,
  inventoryNav,
  allotmentNav,
  procurementNav,
  storesNav,
  salesNav,
  operationsNav,
  membersNav,
  financeNav,
  peopleNav,
  lettersNav,
  gaOverviewNav,
  vendorsNav,
  gaLocationsNav,
  contractsNav,
  assetsNav,
  maintenanceNav,
  serviceScheduleNav,
  gaSuppliesNav,
  libraryNav,
  systemNav,
]

/// The icon strip above those rows.
///
/// Screens that are not places in the business: ways of talking to each other
/// about it, and the reports somebody kept. Each is a single destination, so
/// each is declared as a one-screen module — which the shell already knows not
/// to unfold. See `aside` on `AppModule`.
export const asides: readonly AppModule[] = [
  discussionsNav,
  chatNav,
  reportsNav,
]

/// The asides drawn in the top bar beside Ask rather than at the rail's foot:
/// talking to each other is what somebody checks while working, and the foot
/// of the rail is the last place the eye goes. The rail skips these.
export const topBarAsides: readonly AppModule[] = [discussionsNav, chatNav]

/// Routed, reachable, and drawn nowhere.
///
/// The assistant was taken out of the strip on the owner's instruction. Its
/// ROUTE is deliberately kept: links to it exist in saved messages and in
/// people's tabs, and a removed menu row is a tidying decision while a removed
/// route is a 404 for somebody who did nothing wrong. ⌘J still opens it.
///
/// This is the list to put a screen on when it should stop being offered
/// without ceasing to exist — a distinction the `asides` array cannot make,
/// because that array is read for both the strip and the router.
const unlisted: readonly AppModule[] = [assistantNav, mobileNav, meNav]

/// Modules and asides together, which is what everything except the sidebar's
/// own layout actually wants: the router builds from this, ⌘K flattens it, and
/// `moduleForPath` resolves against it. An aside differs from a module in one
/// respect only — where its row is drawn — so nothing else here distinguishes
/// them.
const everyModule: readonly AppModule[] = [...modules, ...asides, ...unlisted]

/// The sub-items the sidebar draws under a module, in declaration order.
///
/// One definition, because three things ask the question — the sub-list, the
/// count that rides on the module's own row, and the check that a module has
/// anything to expand at all — and three spellings of `filter(!hidden)` drift
/// the day somebody adds a fourth.
export function visibleItems(
  module: AppModule,
  audience?: Audience | null
): readonly NavItem[] {
  return module.sections.flatMap((section) =>
    section.items.filter(shown(audience))
  )
}

/// One item's visibility, so the module row's "does this unfold" and the
/// sub-list it unfolds into cannot answer differently.
///
/// They already had: the row asked `visibleItems`, the list re-spelled
/// `filter(!hidden)` inline. Two spellings of one rule is what this function's
/// own doc warned about, and adding a second dimension to it is exactly when
/// the drift would have started to matter.
export function shown(audience?: Audience | null): (item: NavItem) => boolean {
  return (item) =>
    !item.hidden && (item.audience === undefined || item.audience === audience)
}

/// The rows a module draws as its own: visible, and not under More.
export function primaryItems(
  module: AppModule,
  audience?: Audience | null
): readonly NavItem[] {
  return visibleItems(module, audience).filter((item) => !item.more)
}

/// What a module puts under its department's More fold, section by section,
/// so the fold keeps the headings the rows had before they moved into it.
export function moreSections(
  module: AppModule,
  audience?: Audience | null
): readonly NavSection[] {
  return module.sections
    .map((section) => ({
      label: section.label,
      items: section.items.filter(
        (item) => shown(audience)(item) && item.more === true
      ),
    }))
    .filter((section) => section.items.length > 0)
}

/// Every nav item, flattened — the command palette's list, and the assertion
/// that a path appears exactly once across the whole registry.
export const allNavItems: readonly (NavItem & { module: AppModule })[] =
  everyModule.flatMap((module) =>
    module.sections.flatMap((section) =>
      section.items.map((item) => ({ ...item, module }))
    )
  )

/// ── domains ──────────────────────────────────────────────────────────────
///
/// The bar across the top is this list and only this list: the parts of the
/// business, not the modules. It is short on purpose and it does not grow when
/// screens do — a module moves between domains when the company changes its
/// mind about who owns what, and that is an edit to one array rather than to
/// the navigation.
///
/// The cut is the owner's, ruled 2026-09-13. Home is not a domain: it is what
/// the mark in the corner opens. System, Reports and the assistant are
/// deliberately absent — still routed, still reachable by ⌘K, simply not
/// offered a chip until somebody decides where they live.
export interface AppDomain {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  /// Module ids, in the order their screens should stack in the sidebar.
  readonly modules: readonly string[]
  /// The count on the department's own row, drawn only while it is folded.
  /// Opt-in per department: a hook called on every screen, so only cheap ones.
  readonly useCount?: () => number | null | undefined
  readonly badge?: "bad" | "warn"
}

const allDomains: readonly AppDomain[] = [
  // First, ahead of the departments (owner, 2026-09-25): the one place the
  // whole business is read at once, before anybody goes into a part of it.
  {
    id: "executive",
    label: "Executive",
    icon: LayoutDashboard,
    modules: ["executive"],
  },
  // The departments in the owner's order of 2026-09-28 — the order goods and
  // money move through the company: bought, described, handled at the
  // warehouse, held, priced, sold, paid for; then the people and the places.
  {
    id: "buying",
    label: "Procurement",
    icon: ShoppingCart,
    modules: ["procurement"],
  },
  {
    id: "merchandise",
    label: "Merchandise",
    icon: Shirt,
    modules: ["merchandise-articles", "allotment"],
  },
  // Ops stands apart from Inventory for a reason that is not taste: every one
  // of its screens talks to a DC node behind its own login, so a domain that
  // mixed them would ask for a second password halfway down its own sidebar.
  { id: "ops", label: "Ops", icon: Truck, modules: ["operations"] },
  { id: "inventory", label: "Inventory", icon: Boxes, modules: ["inventory"] },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    modules: ["commercial"],
  },
  {
    // `selling` stays the id — links and saved state name it — while the
    // label is the owner's word (2026-09-28). Sales leads now: its rows are
    // the department's own, and Stores and Members sit under its More fold.
    id: "selling",
    label: "Sales",
    icon: Store,
    modules: ["sales", "stores", "members"],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Landmark,
    // One module since 2026-09-26: the tree the owner froze replaced Finance,
    // Finance baru, Finance final and the "Finance New" chip's lab. Laid out
    // as ERPNext's Accounting sidebar since 2026-09-28 — see
    // `screens/finance/nav.ts`.
    modules: ["finance"],
  },
  { id: "hr", label: "HR", icon: Users, modules: ["people"] },
  {
    id: "ga",
    label: "GA",
    icon: MessagesSquare,
    // One row per place, in the order of how often it is opened (owner,
    // 2026-09-27, when the menu was cut from eighteen rows to ten): what wants
    // looking at; the day's work — what the places ask for, what broke, what
    // is due for a service; the registers — what we own, what we have agreed,
    // where we operate from, who we deal with; and the documents — the
    // letters that go out and the files the company keeps (moved here from the
    // icon strip on the owner's word, 2026-09-26). The hairlines between the
    // four are each group's first module's `divider`.
    //
    // Conversations stay on the strip (`asides`) with their routes untouched.
    modules: [
      "ga-overview",
      "ga-supplies",
      "maintenance",
      "maintenance-schedule",
      "ga-assets",
      "contracts",
      "ga-locations",
      "vendors",
      "letters",
      "library",
    ],
  },
  // The reference tables, in one menu (owner, 2026-10-04): the article and
  // the words it is described with, and the parties the company buys from.
  // Last on the rail because nobody opens the app to visit master data —
  // they arrive at it from the work that needs a record — but it is its own
  // department now, no longer folded under Merchandise. The new-articles
  // count rides this row: the queue belongs to the article, and the article
  // lives here.
  {
    id: "master",
    label: "Master",
    icon: BookOpen,
    modules: ["master"],
    useCount: useNewArticlesCount,
    badge: "warn",
  },
]

/// Departments left out of THIS build, by id — `VITE_HIDE_DOMAINS=hr,ga` when
/// the hub is built for the public demo. Their screens and routes stay; only
/// the menu stops offering them.
const hidden = new Set(
  String(import.meta.env.VITE_HIDE_DOMAINS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
)
/// The mark on a department's icon is what its own rows add up to (the owner,
/// 2026-10-04: "kalau di sidebar dalam ada angkanya, sidebar luar ada
/// penandanya"). A department that declares its own total keeps it; any other
/// is given the sum of the counts on its modules and their visible rows, so a
/// number inside the column can never sit under an icon that says nothing.
///
/// The hooks are collected once, here, from constant arrays — the same ones in
/// the same order on every render — which is what keeps calling them from
/// inside one function safe. The function is not named `use…` on purpose: the
/// hooks are not a loop over data that changes.
function withRailCount(domain: AppDomain): AppDomain {
  if (domain.useCount !== undefined) return domain
  const reads: (() => number | null | undefined)[] = []
  let tint: "bad" | "warn" | undefined
  for (const module of modulesOfDomain(domain)) {
    if (module.useCount !== undefined) {
      reads.push(module.useCount)
      if (module.badge === "bad" || tint === undefined) tint = module.badge
      continue
    }
    for (const section of module.sections) {
      for (const item of section.items) {
        if (item.useCount === undefined || item.hidden) continue
        reads.push(item.useCount)
        if (item.badge === "bad" || tint === undefined) tint = item.badge
      }
    }
  }
  if (reads.length === 0) return domain
  const total = (): number | null => {
    let sum = 0
    let any = false
    for (const read of reads) {
      const value = read()
      if (typeof value === "number") {
        sum += value
        any = true
      }
    }
    return any ? sum : null
  }
  return { ...domain, useCount: total, badge: domain.badge ?? tint ?? "warn" }
}

export const domains: readonly AppDomain[] = allDomains
  .filter((domain) => !hidden.has(domain.id))
  .map(withRailCount)

/// The modules of the departments this build leaves out. The menu skips them
/// because `domains` does; this is for the surfaces that list screens by some
/// other road — ⌘K, search hits — and would otherwise hand somebody the very
/// screen the deployment chose not to offer.
export const hiddenModuleIds: ReadonlySet<string> = new Set(
  allDomains.filter((domain) => hidden.has(domain.id)).flatMap((d) => d.modules)
)

/// Whether a path belongs to a department this build leaves out.
export function isHiddenPath(pathname: string): boolean {
  return (
    hiddenModuleIds.size > 0 && hiddenModuleIds.has(moduleForPath(pathname).id)
  )
}

/// The modules of a domain, in declared order, skipping any that no longer
/// exist — a rename in one file should dim a chip, not crash the shell.
export function modulesOfDomain(domain: AppDomain): readonly AppModule[] {
  return domain.modules
    .map((id) => everyModule.find((module) => module.id === id))
    .filter((module): module is AppModule => module !== undefined)
}

/// The domains the sidebar and the launcher show: those with at least one
/// module that is not `hidden`.
export const shownDomains: readonly AppDomain[] = domains.filter((domain) =>
  modulesOfDomain(domain).some((module) => !module.hidden)
)

/// Where `/` lands: Home while it is shown, else the first shown department.
export const landingPath: string = homeNav.hidden
  ? (modulesOfDomain(shownDomains[0]).find((module) => !module.hidden)?.home ??
    homeNav.home)
  : homeNav.home

/// Whether a domain's modules are one flat list of screens rather than several
/// labelled groups.
///
/// The heading above a group says which module its rows belong to. When GA
/// was six modules of one screen each, that heading was the same word twice,
/// six times down the column, and the owner asked for it gone on
/// 2026-09-13 — the day it read flat. It stopped being flat when Assets grew
/// three rows and Contracts six, and it is flat again since 2026-09-27: those
/// became chips on their screens, so every GA module is one row. The question
/// is asked of the modules, so the headings went by themselves.
///
/// Read off the modules rather than declared on the domain, so the heading
/// is never a flag to remember — a domain where one module has four screens
/// and its neighbour has one still needs every heading, or the neighbour's
/// lone row reads as a fifth screen of the module above it.
export function flatDomain(modules: readonly AppModule[]): boolean {
  return modules.every((module) => visibleItems(module).length <= 1)
}

/// Which domain a module belongs to, or `undefined` for the ones deliberately
/// left out of the bar (home, system, reports, the assistant).
export function domainForModule(id: string): AppDomain | undefined {
  return domains.find((domain) => domain.modules.includes(id))
}

export function domainForPath(pathname: string): AppDomain | undefined {
  return domainForModule(moduleForPath(pathname).id)
}

/// Where a department's row lands: its first own row that is built.
///
/// Not simply the first module's `home` any more. Since the menu of
/// 2026-09-28 a department's rows are what it is opened for, and the first
/// of them is where it should open — Sales opens on Sales by store, not on
/// Stores, which now sits under its More fold. A department with no own row
/// that is built falls back to the old answer.
export function domainHome(domain: AppDomain): string {
  const modules = modulesOfDomain(domain)
  for (const module of modules) {
    const first = primaryItems(module).find((item) => !item.soon)
    if (first) return first.path
  }
  return modules[0]?.home ?? "/"
}

/// Which module owns a path, by longest matching `home`. Used by the sidebar to
/// light the right row and unfold the right module for a URL that was pasted in
/// rather than clicked to.
export function moduleForPath(pathname: string): AppModule {
  // Longest matching base wins, so a module at `/finance/assets` would beat
  // one at `/finance`. The comparison runs only among modules that actually
  // match: seeding `best` with `modules[0]` and comparing lengths against it
  // meant a short home like `/finance` could never displace a longer
  // non-matching one like `/commercial`, and every finance URL drew the
  // commercial sidebar.
  let best: AppModule | null = null
  for (const module of everyModule) {
    // The prefix the module OWNS, which is `home` for every module that has
    // not had to separate the two — see `AppModule.base`.
    const base = module.base ?? module.home
    const matches = pathname === base || pathname.startsWith(base + "/")
    if (!matches) continue
    const incumbent = best === null ? "" : (best.base ?? best.home)
    if (base.length > incumbent.length) best = module
  }
  return best ?? modules[0]
}

/// The nav item a path is on: the one with the longest path that is the path
/// or a prefix of it, so a record under `/finance/bills/42` is on "Bills".
export function screenForPath(
  pathname: string
): (typeof allNavItems)[number] | undefined {
  let best: (typeof allNavItems)[number] | undefined
  for (const item of allNavItems) {
    const matches =
      pathname === item.path || pathname.startsWith(item.path + "/")
    if (matches && item.path.length > (best?.path.length ?? -1)) best = item
  }
  return best
}

/// ── sections ─────────────────────────────────────────────────────────────
///
/// Which department a module belongs to, as the server's job roles name it
/// (`lib/queries/invitations.ts`'s `SectionCode`) — the ONE place this app
/// maps a module id to a section, so a caller's role can hide the departments
/// it does not hold without every module file learning about roles.
///
/// A module absent from this map is unaffected — Home, Executive, Profile,
/// the assistant and the two conversation asides carry no department and are
/// never hidden by a section. That is a deliberate default, not an oversight:
/// this app fails OPEN on a module the owner has not sorted into a section
/// yet, rather than hiding a screen nobody asked to have hidden.
const SECTION_OF_MODULE: Readonly<Record<string, SectionCode>> = {
  commercial: "marketing",
  master: "merchandise",
  "merchandise-articles": "merchandise",
  allotment: "merchandise",
  inventory: "inventory",
  procurement: "procurement",
  sales: "sales",
  members: "sales",
  operations: "operations",
  finance: "finance",
  people: "people",
  "ga-overview": "ga",
  "ga-supplies": "ga",
  maintenance: "ga",
  "maintenance-schedule": "ga",
  "ga-assets": "ga",
  contracts: "ga",
  "ga-locations": "ga",
  vendors: "ga",
  letters: "ga",
  library: "ga",
  system: "system",
  reports: "reports",
  stores: "stores",
}

export function sectionOfModule(module: AppModule): SectionCode | undefined {
  return SECTION_OF_MODULE[module.id]
}

/// Whether a caller holding these sections (or bypassing the check entirely)
/// is offered this module's row.
///
/// A module with no section (see above) is always allowed — the check only
/// ever narrows a module that HAS one.
export function moduleAllowed(
  module: AppModule,
  sections: readonly SectionCode[],
  bypass: boolean
): boolean {
  if (bypass) return true
  const section = sectionOfModule(module)
  return section === undefined || sections.includes(section)
}
