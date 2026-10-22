import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { acknowledgeChanges, type DcChange } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"

/// The warehouse has seen what MD changed (owner, 10 Oct 2026; since 15 Oct
/// there is no "Got it" — opening the work is seeing it, see `useSeenOnOpen`).
/// Awareness only, nothing moves; afterwards the change is gone from
/// `GET /api/v1/dc/changes`, so the tags, the standalone Cancelled card and
/// the picker's banner all drop with it. The board's lanes are refetched too:
/// a fully cancelled picklist leaves the To pick list once it is acknowledged.
export function useAcknowledgeChanges() {
  const client = useQueryClient()
  return useMutation({
    // Seeing finishes nothing, and it mostly runs by itself on opening the
    // work: a stamp drawn after it was not pressed by it (`DocStamp`).
    meta: { finishesNothing: true },
    mutationFn: (items: readonly DcChange[]) => acknowledgeChanges(items),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.changes() })
      void client.invalidateQueries({ queryKey: keys.picklistsToPick() })
      void client.invalidateQueries({ queryKey: keys.picklists() })
      void client.invalidateQueries({ queryKey: keys.owed() })
    },
    onError: () => toast.error("Could not acknowledge. Try again."),
  })
}

/// Opening the work counts as seeing MD's change (allotment-ops-prototype,
/// approved 15 Oct 2026: no "Got it"). While `open`, every change in `items`
/// is acknowledged once; the blue dot on its card goes with it. A sheet that
/// still needs the change after this (the picker's banner, what a refused
/// line means) keeps its own copy from the moment it opened.
export function useSeenOnOpen(items: readonly DcChange[], open: boolean) {
  const acknowledge = useAcknowledgeChanges()
  const sent = useRef(new Set<string>())
  const idOf = (one: DcChange) =>
    `${one.allotment_id}~${one.destination_id}~${one.at}`
  const signature = open ? items.map(idOf).join("|") : ""
  useEffect(() => {
    if (signature === "") return
    const fresh = items.filter((one) => !sent.current.has(idOf(one)))
    if (fresh.length === 0) return
    for (const one of fresh) sent.current.add(idOf(one))
    acknowledge.mutate(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
}
