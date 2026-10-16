import { queryOptions } from "@tanstack/react-query"

import {
  warmInfinite,
  warmQuery,
  type PrefetchContext,
  type PrefetchMap,
} from "@/lib/prefetch"
import { priceChangesQuery, priceEventPagesQuery } from "@/lib/queries/changes"
import {
  articlePricesPagesQuery,
  campaignIntents,
  campaignPagesQuery,
  commercialFleetQuery,
  commercialKeys,
  commercialUsage,
  intentKeys,
  offerCounts,
  promotionPagesQuery,
} from "@/lib/queries/commercial"
import { voucherPagesQuery } from "@/lib/queries/vouchers"
import { termsQuery } from "@/lib/queries/vocabulary"

/// What Marketing (the `commercial` folder) asks first, before the screen is
/// open (`lib/prefetch.ts`). Every list goes through the factory its screen
/// uses (`lib/queries/commercial.ts`, `vouchers.ts`, `changes.ts`), so the key
/// and the request are the screen's own.
///
/// What the screens in `prefetch` below read first — the page of a list, the
/// shops beside History — they read with `useSuspense…` inside a `<Suspense>`,
/// so the server starts those too and streams the real page. The small reads
/// beside a list (usage, the shops count, the division and tag names, offers
/// per campaign) fill in cells and are read by plain hooks, so they are asked
/// for in the browser only; the Pricelist is read by plain hooks throughout
/// (`browserOnly`).

/// Usage per rule and per campaign: the Usage column of Promotions and the
/// "Budget used" meter of Campaigns. Mirrors both screens (default options).
const usageQuery = () =>
  queryOptions({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

/// The view lives in the address bar (`q`, `f`): a link that carries one asks
/// for exactly that, and the screen does so itself — the default is not what
/// it will want.
const carriesView = (search: PrefetchContext["search"]) =>
  search.q !== undefined || search.f !== undefined

/// Entries whose screens read the answer with a plain hook. The server renders
/// such a screen's skeleton (a plain `useQuery` never reads a query the server
/// started), so a head start there would only make the client's first render
/// differ from the HTML: these run in the browser only.
const browserOnly: PrefetchMap = {
  // The Pricelist: the first page of the final price (what the till charges a
  // walk-in shopper), as `scope` in `pricelist.tsx` builds it with nothing
  // typed or filtered. The slowest read in the system — pricing is styles
  // times shops, a second or two even warm — so it is neither streamed from
  // the server nor warmed while idle: a hover or a visit only.
  "/commercial/prices": async (client, { search }) => {
    if (carriesView(search)) return
    await Promise.all([
      warmInfinite(client, articlePricesPagesQuery("STORE", { final: true })),
      warmQuery(client, termsQuery("divisions")),
      warmQuery(client, termsQuery("tags")),
    ])
  },
}

export const prefetch: PrefetchMap = {
  ...(import.meta.env.SSR ? {} : browserOnly),

  // Promotions opens on Usage, highest first, every tab "All". Mirrors `scope`
  // in `PromotionBook` (`promotions.tsx`; `DEFAULT_SORT`, `SORTS.usage`). The
  // page is what the screen waits for; its Usage column, the shops count and
  // the division / tag names the rows read fill in behind it, so only a hover
  // or a visit in the browser adds them.
  "/commercial/promotions": async (client, { reason, search }) => {
    if (carriesView(search) || search.campaign !== undefined) return
    await Promise.all([
      warmInfinite(client, promotionPagesQuery({ sort: "usage", desc: true })),
      ...(import.meta.env.SSR
        ? []
        : [
            warmQuery(client, usageQuery()),
            ...(reason === "warm"
              ? []
              : [
                  warmQuery(client, commercialFleetQuery()),
                  warmQuery(client, termsQuery("divisions")),
                  warmQuery(client, termsQuery("tags")),
                ]),
          ]),
    ])
  },

  // Campaigns opens on Budget used, highest first. Mirrors `scope` in
  // `CampaignBook` (`campaigns.tsx`; `DEFAULT_SORT`, `SORTS.spent`). The page
  // is what the screen waits for; the four reads whose figures sit in its rows
  // — offers per campaign, usage, stated objectives, the shops count — fill in
  // behind it, so they are asked for in the browser only.
  "/commercial/campaigns": async (client, { search }) => {
    if (carriesView(search)) return
    await Promise.all([
      warmInfinite(
        client,
        campaignPagesQuery({ sort: "budget_used", desc: true })
      ),
      ...(import.meta.env.SSR
        ? []
        : [
            warmQuery(
              client,
              queryOptions({
                queryKey: commercialKeys.offerCounts(),
                queryFn: ({ signal }) => offerCounts(signal),
              })
            ),
            warmQuery(client, usageQuery()),
            warmQuery(
              client,
              queryOptions({
                queryKey: intentKeys.list(),
                queryFn: ({ signal }) => campaignIntents(signal),
              })
            ),
            warmQuery(client, commercialFleetQuery()),
          ]),
    ])
  },

  // Vouchers opens on every voucher, newest first; the page carries the
  // ledger strip too. Mirrors `scope` in `VoucherBook` (`vouchers.tsx`) with
  // nothing chosen.
  "/commercial/vouchers": async (client, { search }) => {
    if (carriesView(search)) return
    await warmInfinite(client, voucherPagesQuery({}))
  },

  // Changes opens on what is still outstanding (`settled` off). Mirrors
  // `ChangeList` in `changes.tsx`; its clauses and tabs are applied in the
  // browser, so any address-bar view still wants this answer.
  "/commercial/changes": async (client) => {
    await warmQuery(client, priceChangesQuery(false))
  },

  // History opens on every kind of event at every shop. Mirrors `PriceLog` in
  // `history.tsx` (`kindsOf("ALL")` is none); a shop or a kind in the address
  // bar (`site`, `log-kind`) is another question.
  "/commercial/history": async (client, { search }) => {
    if (search.site !== undefined || search["log-kind"] !== undefined) return
    await Promise.all([
      warmInfinite(client, priceEventPagesQuery(null, [])),
      warmQuery(client, commercialFleetQuery()),
    ])
  },
}

/// Idle warm-up: Promotions is the Marketing screen opened most that is also
/// cheap (two small reads). The Pricelist is hover only; the Overview
/// (performance reports over thirty days) is not prefetched at all.
export const warm = { "/commercial/promotions": 8 }
