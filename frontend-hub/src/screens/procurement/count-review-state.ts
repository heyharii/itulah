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
  // Without a session nothing is asked, and what an earlier session left in
  // the cache is not the warehouse today: a review already done stayed on the
  // list as "Review Count" (owner, 2026-10-10).
  for (const row of enabled ? (query.data ?? []) : []) {
    byPo.set(row.po_number, [...(byPo.get(row.po_number) ?? []), row])
  }
  return byPo
}

/// The POs whose count the buyer sent back to the warehouse to count again.
/// Read like `useCountsAwaiting`: nothing is asked until this browser holds a
/// DC session.
export function useRecountingPos() {
  const where = useEdgeNodeIdentity()
  const session = useEdgeIdentity()
  const enabled = where.data?.auth === "DISABLED" || session.data != null
  const query = useQuery({
    queryKey: keys.purchaseSummary(),
    queryFn: ({ signal }) => dc.purchaseSummary(signal),
    enabled,
  })
  const recounting = new Set<string>()
  for (const one of enabled ? (query.data?.recounts ?? []) : [])
    recounting.add(one.po_number)
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
    queryKey: keys.purchaseSummary(),
    queryFn: ({ signal }) => dc.purchaseSummary(signal),
    enabled,
  })
  const reasons = new Map<string, string>()
  for (const one of enabled ? (query.data?.recounts ?? []) : [])
    reasons.set(one.po_number, one.reason)
  return reasons
}

/// The POs whose count the warehouse took back before anybody reviewed it, by
/// PO number: who, when, and the pieces the recalled count came to. What the
/// order's sheet says under "Recalled by the warehouse".
export function useRecalls() {
  const where = useEdgeNodeIdentity()
  const session = useEdgeIdentity()
  const enabled = where.data?.auth === "DISABLED" || session.data != null
  const query = useQuery({
    queryKey: keys.purchaseSummary(),
    queryFn: ({ signal }) => dc.purchaseSummary(signal),
    enabled,
  })
  const recalls = new Map<string, { by: string; at: string; was: number }>()
  for (const one of enabled ? (query.data?.recounts ?? []) : []) {
    if (one.recalled_by)
      recalls.set(one.po_number, {
        by: one.recalled_by,
        at: one.recalled_at ?? "",
        was: one.was ?? 0,
      })
  }
  return recalls
}
