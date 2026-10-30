/// How many days a piece may come back after it was sold (client, 28 Oct 2026).
///
/// The number is the company's, set in the hub and carried to the shop by the
/// node, so the till never writes one down: Bayar reads it to tell the shopper
/// "Bisa ditukar s/d <date>". Until the node has answered — or when it has no
/// such route — nothing is claimed.

import { useEffect, useState } from "react"

import { edge } from "@/edge"

/// `GET /api/v1/store/exchange-policy` — `{ days, require_hang_tag,
/// require_receipt }`: whole days from the sale that a piece may be exchanged,
/// and the two conditions the hub's Return policy asks for.
export const exchangePolicy = () =>
  edge<{ readonly days: number; readonly require_hang_tag?: boolean; readonly require_receipt?: boolean }>(
    "GET",
    "/api/v1/store/exchange-policy",
  )

/// The promise as the till says it. Both conditions hold until the node says
/// otherwise: an older node that does not send them still asks for both.
export type ExchangePromise = {
  readonly days: number | null
  readonly hangTag: boolean
  readonly receipt: boolean
}

const UNKNOWN: ExchangePromise = { days: null, hangTag: true, receipt: true }
let known: ExchangePromise | undefined

/// The promise, asked once while this window lives.
export function useExchangePromise(): ExchangePromise {
  const [promise, setPromise] = useState<ExchangePromise>(known ?? UNKNOWN)
  useEffect(() => {
    if (known !== undefined) return
    let alive = true
    void exchangePolicy().then((reply) => {
      const body = reply.body
      const got: ExchangePromise = {
        days: reply.ok && typeof body?.days === "number" && body.days > 0 ? body.days : null,
        hangTag: body?.require_hang_tag !== false,
        receipt: body?.require_receipt !== false,
      }
      // A failed ask is asked again with the next Bayar.
      if (reply.ok) known = got
      if (alive) setPromise(got)
    })
    return () => {
      alive = false
    }
  }, [])
  return promise
}

/// The days, asked once while this window lives; null while unknown.
export function useExchangeDays(): number | null {
  return useExchangePromise().days
}
