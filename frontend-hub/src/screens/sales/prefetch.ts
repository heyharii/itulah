import { today } from "@/lib/calendar"
import { warmData, warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import {
  explorerOptionsQuery,
  explorerRowsQuery,
  type ExplorerQuery,
} from "@/screens/sales/explorer-data"
import { DEFAULT_STATE, resolvePeriod } from "@/screens/sales/explorer-model"

/// What Sales asks first, before the screen is open (`lib/prefetch.ts`).

/// The question the Explorer opens with: the default view (this year, by
/// division, totals) over the days the options say there are sales for. Built
/// the way `explorer.tsx` builds `query`; if that screen's defaults move (its
/// `ARTICLE_COUNTS`, the per-store view), this moves with `DEFAULT_STATE`.
function openingQuestion(range: { from: string; to: string }): ExplorerQuery {
  return {
    from: range.from,
    to: range.to,
    group: DEFAULT_STATE.group,
    stores: DEFAULT_STATE.stores,
    divisions: DEFAULT_STATE.divisions,
    suppliers: DEFAULT_STATE.suppliers,
    tags: DEFAULT_STATE.tags,
    colours: DEFAULT_STATE.colours,
    sizes: DEFAULT_STATE.sizes,
    q: "",
    matrix: false,
    articles: false,
  }
}

export const prefetch: PrefetchMap = {
  "/sales/explorer": async (client, { search }) => {
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
    await warmInfinite(client, explorerRowsQuery(openingQuestion(range)))
  },
}

/// Warmed while idle, first of all: the screen the owner opens most.
export const warm = { "/sales/explorer": 1 }
