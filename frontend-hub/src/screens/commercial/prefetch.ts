import { queryOptions } from "@tanstack/react-query"

import {
  warmInfinite,
  warmQuery,
  type PrefetchContext,
  type PrefetchMap,
} from "@/lib/prefetch"
import {
  changeKeys,
  listPriceChanges,
  priceEventPagesQuery,
} from "@/lib/queries/changes"
import {
  articlePricesPagesQuery,
  campaignIntents,
  campaignPagesQuery,
  commercialFleet,
  commercialKeys,
  commercialUsage,
  intentKeys,
  offerCounts,
  promotionPagesQuery,
} from "@/lib/queries/commercial"
import { voucherPagesQuery } from "@/lib/queries/vouchers"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"

/// What Marketing (the `commercial` folder) asks first, before the screen is
/// open (`lib/prefetch.ts`). Every list goes through the factory its screen
/// uses (`lib/queries/commercial.ts`, `vouchers.ts`, `changes.ts`), so the key
/// and the request are the screen's own; the small reads beside a list are
/// built here from the same key helpers and fetch functions, the way the
/// screen builds them, and name the screen they mirror.

/// Usage per rule and per campaign: the Usage column of Promotions and the
/// "Budget used" meter of Campaigns. Mirrors both screens (default options).
const usageQuery = () =>
  queryOptions({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

/// The size of the estate, the denominator beside "Stores" on Promotions,
/// Campaigns and History. Mirrors those screens (default options).
const fleetQuery = () =>
  queryOptions({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

/// Division and tag names, so a scope reads "Pria" rather than `PRIA`.
/// Mirrors Promotions and Pricelist (default staleTime, as Pricelist has it;
/// Promotions' five minutes only decides when it asks again).
const termsQuery = (kind: "divisions" | "tags") =>
  queryOptions({
    queryKey: vocabularyKeys.list(kind),
    queryFn: ({ signal }) => listTerms(kind, signal),
  })

/// The view lives in the address bar (`q`, `f`): a link that carries one asks
/// for exactly that, and the screen does so itself — the default is not what
/// it will want.
const carriesView = (search: PrefetchContext["search"]) =>
  search.q !== undefined || search.f !== undefined

export const prefetch: PrefetchMap = {
  // Promotions opens on Usage, highest first, every tab "All". Mirrors
  // `scope` in `promotions.tsx` (`DEFAULT_SORT`, `SORTS.usage`). While idle
  // only the page and its Usage; a hover or a visit adds the shops count and
  // the division / tag names the rows read.
  "/commercial/promotions": async (client, { reason, search }) => {
    if (carriesView(search) || search.campaign !== undefined) return
    await Promise.all([
      warmInfinite(client, promotionPagesQuery({ sort: "usage", desc: true })),
      warmQuery(client, usageQuery()),
      ...(reason === "warm"
        ? []
        : [
            warmQuery(client, fleetQuery()),
            warmQuery(client, termsQuery("divisions")),
            warmQuery(client, termsQuery("tags")),
          ]),
    ])
  },

  // Campaigns opens on Budget used, highest first. Mirrors `scope` in
  // `campaigns.tsx` (`DEFAULT_SORT`, `SORTS.spent`) and the four reads whose
  // figures sit in its rows: offers per campaign, usage, stated objectives,
  // the shops count. Hover only.
  "/commercial/campaigns": async (client, { search }) => {
    if (carriesView(search)) return
    await Promise.all([
      warmInfinite(
        client,
        campaignPagesQuery({ sort: "budget_used", desc: true })
      ),
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
      warmQuery(client, fleetQuery()),
    ])
  },

  // The Pricelist: the first page of the final price (what the till charges a
  // walk-in shopper), as `scope` in `pricelist.tsx` builds it with nothing
  // typed or filtered. The slowest read in the system — pricing is styles
  // times shops — so a hover or a visit only, never idle.
  "/commercial/prices": async (client, { search }) => {
    if (carriesView(search)) return
    await Promise.all([
      warmInfinite(client, articlePricesPagesQuery("STORE", { final: true })),
      warmQuery(client, termsQuery("divisions")),
      warmQuery(client, termsQuery("tags")),
    ])
  },

  // Vouchers opens on every voucher, newest first; the page carries the
  // ledger strip too. Mirrors `scope` in `vouchers.tsx` with nothing chosen.
  "/commercial/vouchers": async (client, { search }) => {
    if (carriesView(search)) return
    await warmInfinite(client, voucherPagesQuery({}))
  },

  // Changes opens on what is still outstanding (`settled` off). Mirrors
  // `list` in `changes.tsx`; its clauses and tabs are applied in the browser,
  // so any address-bar view still wants this answer.
  "/commercial/changes": async (client) => {
    await warmQuery(
      client,
      queryOptions({
        queryKey: changeKeys.list(false),
        queryFn: ({ signal }) => listPriceChanges(false, signal),
      })
    )
  },

  // History opens on every kind of event at every shop. Mirrors `events` in
  // `history.tsx` (`kindsOf("ALL")` is none); a shop or a kind in the address
  // bar (`site`, `log-kind`) is another question.
  "/commercial/history": async (client, { search }) => {
    if (search.site !== undefined || search["log-kind"] !== undefined) return
    await Promise.all([
      warmInfinite(client, priceEventPagesQuery(null, [])),
      warmQuery(client, fleetQuery()),
    ])
  },
}

/// Idle warm-up: Promotions is the Marketing screen opened most that is also
/// cheap (two small reads). The Pricelist is hover only; the Overview
/// (performance reports over thirty days) is not prefetched at all.
export const warm = { "/commercial/promotions": 8 }
