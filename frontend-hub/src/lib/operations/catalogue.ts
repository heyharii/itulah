import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import {
  fleetPools,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import { sourcePoolsFor } from "@/screens/inventory/shared"

/// What a SKU code IS, for a screen that only has the code.
///
/// A warehouse node answers in SKU codes, because a SKU code is what is
/// printed on the tag and what the ledger moves. It is not what anybody
/// recognises: "11110340102" is not a garment, and a composer that lists forty
/// of them is a screen nobody can work from without the rack in front of them.
export interface Identity {
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly image_url: string | null
  readonly tags: readonly string[]
  readonly colour: string | null
  readonly size: string | null
}

/// The catalogue, by SKU code, read from the centre.
///
/// **It is deliberately the cloud's catalogue and not the node's.** The edge
/// carries a snapshot — `catalog_identities` — and it is the right source for
/// a handheld that may be off the network, but it holds no colour, no size,
/// and a photograph only for articles this DC has personally handled. The
/// composers are used at a desk on a hub that is already talking to the
/// centre, so they read the richer answer and say so plainly when it has not
/// arrived.
///
/// One read for the whole catalogue rather than a lookup per SKU: the
/// availability endpoint answers with every active SKU whatever is asked of
/// it, and forty round trips to name forty rows would be slower than the one
/// that names two thousand.
///
/// This is the reader that wants the WHOLE catalogue: a picklist can name a
/// SKU the warehouse has since emptied, and a line whose name is missing is
/// the bare code again. The allotment matrix asks the same endpoint for
/// `held=true` and gets a different, much smaller answer — which is why the
/// two no longer share a cache key, and why this one is no longer warmed by
/// that screen.
export function useCatalogueIdentity(): ReadonlyMap<string, Identity> {
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    staleTime: 5 * 60 * 1000,
  })

  // Any DC pool names the same catalogue; the warehouse is the one every
  // fleet has. Falling back to the first keeps a fleet that names its
  // warehouse differently from drawing a screen of bare codes.
  const pools = useMemo(
    () => sourcePoolsFor("TO_STORE", fleet.data?.items ?? []),
    [fleet.data]
  )
  const pool =
    pools.find((one) => one.pool_code === "WAREHOUSE")?.id ?? pools[0]?.id ?? ""

  const stock = useQuery({
    queryKey: inventoryKeys.poolAvailability(pool),
    queryFn: ({ signal }) => poolAvailability(pool, {}, signal),
    enabled: pool !== "",
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const byCode = new Map<string, Identity>()
    for (const item of stock.data?.items ?? [])
      byCode.set(item.sku_code, {
        article_id: item.article_id,
        article_code: item.article_code,
        article_name: item.article_name,
        division_code: item.division_code,
        image_url: item.image_url,
        tags: item.tags,
        colour: item.colour,
        size: item.size,
      })
    return byCode
  }, [stock.data])
}
