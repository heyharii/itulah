import { today } from "@/lib/calendar"
import {
  warmData,
  warmInfinite,
  warmQuery,
  type PrefetchContext,
  type PrefetchMap,
  type Prefetcher,
} from "@/lib/prefetch"
import {
  recentReturnsQuery,
  recentSalesQuery,
  returnsPageQuery,
} from "@/lib/queries/storeops"
import { breakdownQuery } from "@/screens/sales/breakdown-data"
import type { By } from "@/screens/sales/breakdown"
import {
  explorerOptionsQuery,
  explorerRowsQuery,
  type ExplorerQuery,
} from "@/screens/sales/explorer-data"
import {
  DEFAULT_STATE,
  PAGE_OF,
  resolvePeriod,
  type GroupKey,
} from "@/screens/sales/explorer-model"
import { OPENS_ON } from "@/screens/sales/period"
import { RETURNS_OPENING_SCOPE } from "@/screens/sales/returns-data"
import { seriesQuery } from "@/screens/sales/series-data"
import { spanOf } from "@itulah/contract/reporting"

/// What Sales asks first, before the screen is open (`lib/prefetch.ts`). The
/// screens below read these answers with `useSuspense…` inside a `<Suspense>`,
/// so the server starts them too and streams the real page.

/// The span Sales and Store ranking open on (`usePeriod` with nothing in the
/// address bar): thirty days, a column a day. A link that names a resolution or
/// a count asks for exactly that, and the screen does so itself.
const carriesSpan = (search: PrefetchContext["search"]) =>
  search.bucket !== undefined || search.span !== undefined

/// The year so far, the window every "Sales by …" report opens on
/// (`useYearToDate`), for every unit and every division.
function yearToDate(by: By) {
  const to = today()
  return { by, from: `${to.slice(0, 4)}-01-01`, to, unit: "", division: "" }
}

const breakdown =
  (by: By): Prefetcher =>
  (client) =>
    warmQuery(client, breakdownQuery(yearToDate(by)))

/// The question a page of the Explorer opens with: its grouping, this year,
/// totals, over the days the options say there are sales for. Built the way
/// `explorer.tsx` builds `query`; if that screen's defaults move (its
/// `ARTICLE_COUNTS`, the opening tab), this moves with `DEFAULT_STATE`.
function openingQuestion(
  range: { from: string; to: string },
  group: GroupKey
): ExplorerQuery {
  return {
    from: range.from,
    to: range.to,
    group,
    stores: DEFAULT_STATE.stores,
    divisions: DEFAULT_STATE.divisions,
    suppliers: DEFAULT_STATE.suppliers,
    tags: DEFAULT_STATE.tags,
    colours: DEFAULT_STATE.colours,
    sizes: DEFAULT_STATE.sizes,
    q: "",
    matrix: false,
    months: false,
    articles: false,
  }
}

/// A page of the Explorer, opening on its own rows. Mirrors `ExplorerBody` in
/// `explorer.tsx`.
const explorer =
  (group: GroupKey): Prefetcher =>
  async (client, { search }) => {
    // The view lives in the address bar (`f`, `q`). A link that carries one
    // asks for exactly that, and the screen does so itself — the default is
    // not what it will want.
    if (search.f !== undefined || search.q !== undefined) return
    // The default period needs the first and last day with sales, so the
    // options come first (warm from the device's copy when there is one).
    const options = await warmData(client, explorerOptionsQuery())
    const range = resolvePeriod(
      DEFAULT_STATE.period,
      today(),
      options.latest_day,
      options.earliest_day
    )
    await warmInfinite(client, explorerRowsQuery(openingQuestion(range, group)))
  }

export const prefetch: PrefetchMap = {
  // Every grouping's page opens on its own rows (`PAGE_OF`).
  [PAGE_OF.division]: explorer("division"),
  [PAGE_OF.tag]: explorer("tag"),
  [PAGE_OF.article]: explorer("article"),
  [PAGE_OF.sku]: explorer("sku"),
  [PAGE_OF.store]: explorer("store"),
  [PAGE_OF.session]: explorer("session"),
  [PAGE_OF.payment]: explorer("payment"),
  [PAGE_OF.supplier]: explorer("supplier"),
  [PAGE_OF.po]: explorer("po"),

  // The fleet's takings over the opening span. Mirrors `SalesBody` in
  // `sales.tsx`; the span before it only fills in the arrows and is read by a
  // plain hook, so it is not asked for here.
  "/sales": async (client, { search }) => {
    if (carriesSpan(search)) return
    await warmQuery(client, seriesQuery(spanOf("day", OPENS_ON.day)))
  },
  // The same read, ranked by store. Mirrors `AnalyticsBody` in `analytics.tsx`.
  "/sales/analytics": async (client, { search }) => {
    if (carriesSpan(search)) return
    await warmQuery(client, seriesQuery(spanOf("day", OPENS_ON.day)))
  },

  // The one cut the Explorer cannot make: the year so far by campaign.
  // Mirrors `BreakdownReport` in `breakdown.tsx` with no unit and no division
  // chosen.
  "/sales/by-campaign": breakdown("campaign"),

  // The refund desk opens on the biggest refunds, nothing searched or
  // filtered. Mirrors `ReturnsList` in `returns.tsx`.
  "/sales/returns": async (client) => {
    await warmInfinite(client, returnsPageQuery(RETURNS_OPENING_SCOPE))
  },

  // Shop Floor: the last 500 sales and returns. Mirrors `ShopFloor` in
  // `overview.tsx`.
  "/sales/overview": async (client) => {
    await Promise.all([
      warmQuery(client, recentSalesQuery()),
      warmQuery(client, recentReturnsQuery()),
    ])
  },
}

/// Warmed while idle, first of all: the screen the owner opens most.
export const warm = { "/sales/by-store": 1 }
