import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { dc } from "@/lib/api"
import { keys } from "@/lib/operations/keys"
import { allotmentsUnfilled, inventoryKeys } from "@/lib/queries/inventory"
import type { ClosedShortLine } from "@itulah/contract"

/// **Which cartons were sealed short.**
///
/// The DC records "Close short" on the *allotment line*, not on a carton: the
/// shop was allotted N, M were packed, the other N−M were given up
/// (`ClosedShortLine`: allotted · packed · closed_short). A carton does not
/// carry that figure, so it is derived here: a carton is **Closed short** when
/// it is the *last* carton sealed for an allotment that was later closed
/// short — the carton after which nothing more was packed — and its short is
/// what that allotment gave up. Every other carton is **Completed**.
///
/// The link from a carton to its allotment is its manifest lines
/// (`allotment_id`); only cartons for a shop that has a Close short on record
/// are read, so a quiet DC reads no manifests at all.
///
/// Limits (what the backend would have to record to remove them): the node
/// lists only the last 200 closed-short lines, and an allotment fed by
/// several cartons has one short, not one per carton — so it is put on the
/// last of them.
export function usePackingShort(): ReadonlyMap<string, number> {
  const unfilled = useQuery({
    queryKey: inventoryKeys.allotmentsUnfilled(),
    queryFn: ({ signal }) => allotmentsUnfilled(signal),
  })
  const list = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

  const closed = useMemo(() => {
    const byAllotment = new Map<string, number>()
    const shops = new Set<string>()
    for (const line of unfilled.data?.closed ?? ([] as ClosedShortLine[])) {
      if (line.closed_short <= 0) continue
      byAllotment.set(
        line.allotment_id,
        (byAllotment.get(line.allotment_id) ?? 0) + line.closed_short
      )
      shops.add(line.destination_id)
    }
    return { byAllotment, shops }
  }, [unfilled.data])

  const candidates = useMemo(
    () =>
      (list.data ?? []).filter(
        (koli) =>
          koli.sealed_at !== null && closed.shops.has(koli.destination_store_id)
      ),
    [list.data, closed.shops]
  )

  const manifests = useQueries({
    queries: candidates.map((koli) => ({
      queryKey: keys.manifest(koli.koli_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.koliManifest(koli.koli_id, signal),
    })),
  })

  return useMemo(() => {
    // For each closed allotment, its cartons newest first; the first is last.
    const last = new Map<string, { koliId: string; sealed: number }>()
    for (const one of manifests) {
      const manifest = one.data
      if (!manifest || manifest.koli.sealed_at === null) continue
      const sealed = Date.parse(manifest.koli.sealed_at)
      for (const line of manifest.lines) {
        if (!closed.byAllotment.has(line.allotment_id)) continue
        const seen = last.get(line.allotment_id)
        if (!seen || sealed > seen.sealed)
          last.set(line.allotment_id, { koliId: manifest.koli.koli_id, sealed })
      }
    }
    const short = new Map<string, number>()
    for (const [allotmentId, { koliId }] of last)
      short.set(
        koliId,
        (short.get(koliId) ?? 0) + (closed.byAllotment.get(allotmentId) ?? 0)
      )
    return short
  }, [manifests, closed.byAllotment])
}
