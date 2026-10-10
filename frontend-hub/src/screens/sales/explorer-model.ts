import type { ExplorerFigures, ExplorerRow } from "@itulah/contract"

import { dateOf, isoOf, shift } from "@/lib/calendar"
import { day, dateRange, monthYear, weekdayName } from "@/lib/format"

/// The vocabulary of the Sales Explorer, and everything about it that is not
/// drawing: what the rows can be, how a view is written into the address bar
/// and into a saved view, what "this year" means, and the small sums a row is
/// read through.
///
/// **Filter is which data, the tab is the rows, Totals / Per store is how to
/// read them** (owner, 9 Oct 2026, the "Navbar" prototype). Each of those is
/// one field of `ExplorerState` and nothing else carries meaning, which is
/// what lets a whole view be a string.
///
/// One word, "Sales", everywhere: it is what was charged after discounts and
/// returns (`sales_minor`). There is no "net" and no "gross" on this screen.

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type GroupKey =
  | "division"
  | "tag"
  | "article"
  | "sku"
  | "store"
  | "supplier"
  | "month"
  | "session"
  | "payment"

export const GROUPS: readonly {
  readonly value: GroupKey
  readonly label: string
  /// What the tab says on a tablet, where nine labels do not fit a row.
  readonly short: string
  readonly one: string
  readonly many: string
}[] = [
  {
    value: "division",
    label: "Division",
    short: "Division",
    one: "division",
    many: "divisions",
  },
  { value: "tag", label: "Tag", short: "Tag", one: "tag", many: "tags" },
  {
    value: "article",
    label: "Article",
    short: "Article",
    one: "article",
    many: "articles",
  },
  { value: "sku", label: "SKU", short: "SKU", one: "SKU", many: "SKUs" },
  {
    value: "store",
    label: "Store",
    short: "Store",
    one: "store",
    many: "stores",
  },
  {
    value: "supplier",
    label: "Supplier",
    short: "Supplier",
    one: "supplier",
    many: "suppliers",
  },
  {
    value: "month",
    label: "Month",
    short: "Month",
    one: "month",
    many: "months",
  },
  {
    value: "session",
    label: "Cashier session",
    short: "Session",
    one: "cashier session",
    many: "cashier sessions",
  },
  {
    value: "payment",
    label: "Payment method",
    short: "Payment",
    one: "payment method",
    many: "payment methods",
  },
]

const GROUP_KEYS = new Set<string>(GROUPS.map((group) => group.value))

export const groupLabel = (group: GroupKey) =>
  GROUPS.find((one) => one.value === group)?.label ?? group

export function noun(group: GroupKey, n: number): string {
  const found = GROUPS.find((one) => one.value === group)
  return found === undefined ? "rows" : n === 1 ? found.one : found.many
}

/// Months, sessions and payment methods hold no stock: what is on the shelves
/// is now, and belongs to no month, no shift and no tender.
export const noStock = (group: GroupKey) =>
  group === "month" || group === "session" || group === "payment"

/// A row of these is drilled into: its key becomes a filter and the rows go
/// back to articles. A month narrows the period instead; a session or a payment
/// method is not drilled into at all.
export const DRILL: Readonly<Partial<Record<GroupKey, FilterKey>>> = {
  division: "divisions",
  tag: "tags",
  store: "stores",
  supplier: "suppliers",
}

/// Rows that open the record sheet: an article and a SKU.
export const opensSheet = (group: GroupKey) =>
  group === "article" || group === "sku"

/// Whether pressing a row does anything: it drills, narrows a month, or opens
/// the sheet. A session and a payment method are only read.
export const rowOpens = (group: GroupKey) =>
  DRILL[group] !== undefined || group === "month" || opensSheet(group)

/// Rows whose server figures carry the receipts counted under them.
export const hasReceipts = (group: GroupKey) =>
  group === "store" || group === "session" || group === "payment"

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterKey =
  "stores" | "divisions" | "tags" | "suppliers" | "colours" | "sizes"

/// The panes of the filter sheet, in the owner's order. Colour and size are
/// filters here though they are not tabs.
export const FILTERS: readonly {
  readonly key: FilterKey
  readonly label: string
  /// The word the pane's search box says.
  readonly search: string
}[] = [
  { key: "stores", label: "Stores", search: "stores" },
  { key: "divisions", label: "Division", search: "divisions" },
  { key: "tags", label: "Tag", search: "tags" },
  { key: "suppliers", label: "Supplier", search: "suppliers" },
  { key: "colours", label: "Colour", search: "colours" },
  { key: "sizes", label: "Size", search: "sizes" },
]

const FILTER_KEYS: readonly FilterKey[] = FILTERS.map((one) => one.key)

// ---------------------------------------------------------------------------
// A row, read
// ---------------------------------------------------------------------------

/// The row's name split the way the first column draws it: what it is called,
/// a thin code, and the quiet line under it. The server writes an article as
/// "12345678 · Kemeja Oxford", and a SKU either that way with its colour and
/// size in `detail`, or as "Kemeja Oxford · Black / M" with its code in
/// `detail`; both are read.
export function nameParts(
  group: GroupKey,
  row: ExplorerRow
): { title: string; code: string | null; sub: string | null } {
  if (group === "article" || group === "sku") {
    const found = /^(\d+) · (.+)$/.exec(row.label)
    if (found !== null)
      return { title: found[2], code: found[1], sub: row.detail }
    if (group === "sku" && row.detail !== null)
      return { title: row.label, code: row.detail, sub: null }
  }
  if (group === "month")
    return { title: monthYear(row.key), code: null, sub: null }
  return { title: row.label, code: null, sub: row.detail }
}

/// What a row's key narrows to when it is drilled into, by the label the
/// breadcrumb says.
export const labelOf = (group: GroupKey, row: ExplorerRow) =>
  nameParts(group, row).title

export function dayName(iso: string): string {
  return `${weekdayName(iso)} ${day(iso)}`
}

// ---------------------------------------------------------------------------
// The sums a row is read through
// ---------------------------------------------------------------------------

/// Profit over the sales of the pieces that had a cost: a piece with no cost is
/// not a piece sold at 100% margin. No profit, no margin.
export function marginOf(f: ExplorerFigures): number | null {
  if (f.profit_minor === null) return null
  const whole = f.sales_minor - (f.uncosted_minor ?? 0)
  const value = (f.profit_minor / whole) * 100
  return whole === 0 || !Number.isFinite(value) ? null : value
}

/// Receipts counted under a figure, or nothing when they were not counted (an
/// item filter is on, or an older server).
export const receiptsOf = (f: ExplorerFigures | null | undefined) =>
  f?.receipts ?? null

export function perReceipt(f: ExplorerFigures): number | null {
  const receipts = receiptsOf(f)
  return receipts === null || receipts === 0 ? null : f.sales_minor / receipts
}

/// A row's part of all the sales, as a share out of a hundred.
export function shareOf(f: ExplorerFigures, total: ExplorerFigures) {
  return total.sales_minor === 0
    ? null
    : (f.sales_minor / total.sales_minor) * 100
}

/// The heat of one cell among the stores of its row: the lowest store is almost
/// nothing and the highest is the accent at about 30%, on one scale per row.
/// Nothing for a store that sold nothing, or a row where every store sold the
/// same.
export function rowTint(
  values: readonly (number | null)[]
): (value: number | null) => string | undefined {
  const real = values.filter(
    (value): value is number => value !== null && value > 0
  )
  const low = Math.min(...real)
  const high = Math.max(...real)
  return (value) => {
    if (value === null || value <= 0 || !(high > low)) return undefined
    const alpha = 3 + 27 * ((value - low) / (high - low))
    return `color-mix(in srgb, var(--accent) ${alpha.toFixed(1)}%, transparent)`
  }
}

// ---------------------------------------------------------------------------
// The state of the screen
// ---------------------------------------------------------------------------

export type ViewMode = "totals" | "stores"

/// A step down into a row: which filter it narrowed, to what, and what the
/// filter and the grouping were before, so a step back puts them there.
export interface Crumb {
  readonly group: GroupKey
  readonly filter: FilterKey | "period"
  readonly key: string
  readonly label: string
  readonly was: readonly string[]
}

export interface ExplorerState {
  /// "" is the default (this year), a preset's name, or `from..to`.
  readonly period: string
  readonly group: GroupKey
  readonly view: ViewMode
  /// The per-store table's heat: each store against the others in its row.
  readonly heat: boolean
  readonly stores: readonly string[]
  readonly divisions: readonly string[]
  readonly tags: readonly string[]
  readonly suppliers: readonly string[]
  readonly colours: readonly string[]
  readonly sizes: readonly string[]
  readonly crumbs: readonly Crumb[]
}

export const DEFAULT_STATE: ExplorerState = {
  period: "",
  group: "division",
  view: "totals",
  heat: true,
  stores: [],
  divisions: [],
  tags: [],
  suppliers: [],
  colours: [],
  sizes: [],
  crumbs: [],
}

/// The parameters of a view in the address bar. One key carries them all (see
/// `useExplorerState`), so they are written as a query string of their own,
/// and only where they differ from the default.
const SHORT: Readonly<Record<FilterKey, string>> = {
  stores: "st",
  divisions: "dv",
  tags: "tg",
  suppliers: "sp",
  colours: "cl",
  sizes: "sz",
}

export function encodeState(state: ExplorerState): string {
  const out = new URLSearchParams()
  if (state.period !== "") out.set("p", state.period)
  if (state.group !== DEFAULT_STATE.group) out.set("g", state.group)
  if (state.view !== DEFAULT_STATE.view) out.set("v", state.view)
  if (!state.heat) out.set("h", "0")
  for (const key of FILTER_KEYS) {
    if (state[key].length > 0) out.set(SHORT[key], state[key].join(","))
  }
  if (state.crumbs.length > 0)
    out.set(
      "cr",
      JSON.stringify(
        state.crumbs.map((crumb) => [
          crumb.group,
          crumb.filter,
          crumb.key,
          crumb.label,
          crumb.was,
        ])
      )
    )
  return out.toString()
}

const listOf = (value: string | null): string[] =>
  (value ?? "").split(",").filter((item) => item !== "")

function crumbsOf(raw: string | null): Crumb[] {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: Crumb[] = []
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length < 5) continue
      const [group, filter, key, label, was] = item as unknown[]
      if (
        typeof group !== "string" ||
        !GROUP_KEYS.has(group) ||
        typeof filter !== "string" ||
        !(filter === "period" || FILTER_KEYS.includes(filter as FilterKey)) ||
        typeof key !== "string" ||
        typeof label !== "string" ||
        !Array.isArray(was)
      )
        continue
      out.push({
        group: group as GroupKey,
        filter: filter as Crumb["filter"],
        key,
        label,
        was: was.map(String),
      })
    }
    return out
  } catch {
    return []
  }
}

export function decodeState(raw: string | undefined): ExplorerState {
  if (raw === undefined || raw === "") return DEFAULT_STATE
  const p = new URLSearchParams(raw)
  const group = p.get("g") ?? ""
  const view = p.get("v")
  const period = p.get("p") ?? ""
  const lists = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, listOf(p.get(SHORT[key]))])
  ) as Record<FilterKey, string[]>
  return {
    period: validPeriod(period) ? period : "",
    group: GROUP_KEYS.has(group) ? (group as GroupKey) : DEFAULT_STATE.group,
    view: view === "stores" ? "stores" : "totals",
    heat: p.get("h") !== "0",
    ...lists,
    crumbs: crumbsOf(p.get("cr")),
  }
}

/// Filters that are on: every pane with something picked. What the badge on
/// Filter counts.
export function filterCount(state: ExplorerState): number {
  return FILTER_KEYS.filter((key) => state[key].length > 0).length
}

export const withoutFilters = (state: ExplorerState): ExplorerState => ({
  ...state,
  stores: [],
  divisions: [],
  tags: [],
  suppliers: [],
  colours: [],
  sizes: [],
  crumbs: [],
})

export function withFilter(
  state: ExplorerState,
  key: FilterKey | "period",
  value: readonly string[]
): ExplorerState {
  return key === "period"
    ? { ...state, period: value[0] ?? "" }
    : { ...state, [key]: value }
}

/// A step down into a row: that row's key becomes the filter and the grouping
/// goes back to articles, the thing a person drills toward.
export function drillInto(
  state: ExplorerState,
  filter: FilterKey | "period",
  key: string,
  label: string
): ExplorerState {
  const was =
    filter === "period"
      ? state.period === ""
        ? []
        : [state.period]
      : state[filter]
  return {
    ...withFilter(state, filter, [key]),
    group: "article",
    crumbs: [...state.crumbs, { group: state.group, filter, key, label, was }],
  }
}

/// Back out to `depth` steps: every step beyond puts its filter and its
/// grouping back as they were.
export function unwind(state: ExplorerState, depth: number): ExplorerState {
  let next = state
  for (let i = state.crumbs.length - 1; i >= depth; i--) {
    const crumb = state.crumbs[i]
    next = { ...withFilter(next, crumb.filter, crumb.was), group: crumb.group }
  }
  return { ...next, crumbs: state.crumbs.slice(0, depth) }
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export interface SavedView {
  readonly id: string
  readonly name: string
  /// The whole combination, as the address bar writes it.
  readonly state: string
}

const VIEWS_KEY = "hub.sales-explorer.views"
const NONE: readonly SavedView[] = []
let cache: readonly SavedView[] | null = null
const listeners = new Set<() => void>()

function readViews(): readonly SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown)
    if (!Array.isArray(parsed)) return NONE
    return parsed.filter(
      (one): one is SavedView =>
        typeof one === "object" &&
        one !== null &&
        typeof (one as SavedView).id === "string" &&
        typeof (one as SavedView).name === "string" &&
        typeof (one as SavedView).state === "string"
    )
  } catch {
    // Storage switched off: a view cannot be kept, and the screen still works.
    return NONE
  }
}

/// The saved views of this browser. A stable array between writes, so a
/// component can subscribe to it.
export function savedViews(): readonly SavedView[] {
  if (cache === null) cache = readViews()
  return cache
}

export function subscribeViews(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

function writeViews(next: readonly SavedView[]) {
  cache = next
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(next))
  } catch {
    // The list lives for this session; it will not be here tomorrow.
  }
  listeners.forEach((fn) => fn())
}

/// What a saved view keeps: everything but the drill path.
const kept = (state: ExplorerState): string =>
  encodeState({ ...state, crumbs: [] })

export function saveView(name: string, state: ExplorerState): SavedView {
  const trimmed = name.trim()
  const existing = savedViews().find((one) => one.name === trimmed)
  const view: SavedView = {
    id: existing?.id ?? `saved-${Date.now().toString(36)}`,
    name: trimmed,
    state: kept(state),
  }
  writeViews([...savedViews().filter((one) => one.id !== view.id), view])
  return view
}

export function deleteView(id: string) {
  writeViews(savedViews().filter((one) => one.id !== id))
}

/// A saved view opens the screen as it was saved.
export const applyView = (view: SavedView): ExplorerState =>
  decodeState(view.state)

/// Whether the screen still reads as this saved view.
export const stillView = (state: ExplorerState, view: SavedView) =>
  kept(state) === view.state

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const PRESETS: readonly { value: string; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
]

const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/

function validPeriod(value: string): boolean {
  if (value === "") return true
  if (PRESETS.some((one) => one.value === value)) return true
  const found = RANGE.exec(value)
  return found !== null && found[1] <= found[2]
}

export interface Range {
  readonly from: string
  readonly to: string
}

export const rangeOf = (period: string): Range | null => {
  const found = RANGE.exec(period)
  return found === null ? null : { from: found[1], to: found[2] }
}

const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`

function lastOfMonth(iso: string): string {
  const at = dateOf(iso)
  return isoOf(new Date(at.getFullYear(), at.getMonth() + 1, 0))
}

/// The most days the server will read in one question (three years).
const LONGEST = 3 * 365

/// The days a period means. "This month" and "this year" are to date, but a
/// month or a year with no sales at all in the summary — the load-test data
/// ends in 2025 — is never what somebody opens a report to see, so each falls
/// back to the whole calendar month or year of the latest sales day, and "last
/// month" follows it. "All time" is the first sales day to the last, held to
/// what the server will read. The default is this year.
export function resolvePeriod(
  period: string,
  today: string,
  latest: string | null,
  earliest: string | null = null
): Range {
  const custom = rangeOf(period)
  if (custom !== null) return custom
  const year = today.slice(0, 4)
  const monthStale = latest !== null && latest < firstOfMonth(today)
  const yearStale = latest !== null && latest < `${year}-01-01`
  switch (period) {
    case "month":
      return monthStale
        ? { from: firstOfMonth(latest), to: lastOfMonth(latest) }
        : { from: firstOfMonth(today), to: today }
    case "last": {
      const before = shift(firstOfMonth(monthStale ? latest : today), -1)
      return { from: firstOfMonth(before), to: before }
    }
    case "all": {
      const to = latest ?? today
      const from = earliest ?? `${to.slice(0, 4)}-01-01`
      const floor = shift(to, -LONGEST)
      return { from: from < floor ? floor : from, to }
    }
    default:
      return yearStale
        ? {
            from: `${latest.slice(0, 4)}-01-01`,
            to: `${latest.slice(0, 4)}-12-31`,
          }
        : { from: `${year}-01-01`, to: today }
  }
}

/// The last day anything can be asked about: today, or the latest sales day
/// when the summary stops before it. The calendar's shortcuts count from it.
export const anchorDay = (today: string, latest: string | null) =>
  latest !== null && latest < today ? latest : today

/// "01–30 Sep 2026", the way the kit says a window of days.
export const periodLabel = (range: Range) => dateRange(range.from, range.to)
