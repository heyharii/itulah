import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { dc } from "@/lib/api"
import {
  useEdgeCloudSignIn,
  useEdgeIdentity,
  useEdgeNodeIdentity,
} from "@/lib/edge-session"
import { keys } from "@/lib/operations/keys"
import { useIdentity } from "@/lib/session"
import type { PurchaseCountAwaitingVerification } from "@itulah/contract"

type Count = PurchaseCountAwaitingVerification

/// The counts waiting for a review, by PO number.
///
/// Read only once this browser holds a DC session (or the DC runs open): the
/// list asks nothing of a warehouse nobody here has been signed in to.
export function useCountsAwaiting() {
  const where = useEdgeNodeIdentity()
  const session = useEdgeIdentity()
  const enabled = where.data?.auth === "DISABLED" || session.data != null
  const query = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
    enabled,
  })
  const byPo = new Map<string, Count[]>()
  for (const row of query.data ?? []) {
    byPo.set(row.po_number, [...(byPo.get(row.po_number) ?? []), row])
  }
  return byPo
}

/// The POs whose count the buyer sent back to the Gudang to count again.
/// Read like `useCountsAwaiting`: nothing is asked until this browser holds a
/// DC session.
export function useRecountingPos() {
  const where = useEdgeNodeIdentity()
  const session = useEdgeIdentity()
  const enabled = where.data?.auth === "DISABLED" || session.data != null
  const query = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
    enabled,
  })
  const recounting = new Set<string>()
  for (const line of query.data ?? []) {
    // `!= null`: a line the Gudang never sent back may omit the field, and
    // `undefined !== null` would call every order a recount.
    if (line.recount_reason != null) recounting.add(line.po_number)
  }
  return recounting
}

/// Open the DC session in the background, once, for a buyer who has the
/// assignment — so the list can say which orders have a count waiting without
/// anybody visiting Operations first. A refusal is not shown here: the review
/// dialog's own gate says why when somebody asks for it.
export function useSilentDcSignIn() {
  const cloud = useIdentity()
  const session = useEdgeIdentity()
  const where = useEdgeNodeIdentity()
  const signIn = useEdgeCloudSignIn()
  const tried = useRef<string | null>(null)
  const username = cloud.data?.username ?? null
  const originId = where.data?.node_id ?? null
  const open = where.data?.auth === "DISABLED"
  const needed =
    !open &&
    username !== null &&
    originId !== null &&
    !session.isPending &&
    (session.data ?? null) === null
  const mutate = signIn.mutate
  const busy = signIn.isPending
  useEffect(() => {
    if (!needed || busy) return
    const key = `${username}:${originId}`
    if (tried.current === key) return
    tried.current = key
    mutate({ originId })
  }, [needed, busy, username, originId, mutate])
}

/// The same POs with the reason the buyer gave for the recount, by PO number —
/// what the order's sheet says under "Sent back to count".
export function useRecountReasons() {
  const where = useEdgeNodeIdentity()
  const session = useEdgeIdentity()
  const enabled = where.data?.auth === "DISABLED" || session.data != null
  const query = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
    enabled,
  })
  const reasons = new Map<string, string>()
  for (const line of query.data ?? []) {
    if (line.recount_reason != null && !reasons.has(line.po_number))
      reasons.set(line.po_number, line.recount_reason)
  }
  return reasons
}
