import { useQuery, type QueryClient } from "@tanstack/react-query"

import {
  getSetupDraft,
  saveSetupDraft,
  setupDraftKeys,
} from "@/lib/queries/setup-drafts"
import type { SetupDraft } from "@/screens/procurement/setup-draft"

/// The base price set from a New articles card's Set min. price popup, per
/// delivery line, before the line's form is ever opened. The form starts from
/// it when it has no draft of its own.
///
/// Kept on the server, in the line's shared draft (0956) as `setup_price`
/// (owner, 25 Oct 2026: a price set on one laptop did not show on the next —
/// it had lived in this browser only). A form draft saved since carries its
/// own base price, which is read when `setup_price` is gone.

/// A line's draft payload: the form's fields, and the card's price beside them.
type Stored = Partial<SetupDraft> & { readonly setup_price?: number }

const priceKey = (receiptLineId: string) =>
  [...setupDraftKeys.line(receiptLineId), "price"] as const

function priceOf(payload: Stored | undefined): number | null {
  if (payload === undefined) return null
  if (typeof payload.setup_price === "number" && payload.setup_price > 0)
    return payload.setup_price
  const base = Number(payload.pricing?.base)
  return Number.isFinite(base) && base > 0 ? base : null
}

/// The price kept for a line, read again every 10 s like every hub table.
export function useSetupPrice(receiptLineId: string | null): number | null {
  const kept = useQuery({
    queryKey: priceKey(receiptLineId ?? ""),
    queryFn: async ({ signal }) => {
      const id = receiptLineId ?? ""
      const draft = await getSetupDraft(id, signal)
      const onServer = priceOf(draft?.payload as Stored | undefined)
      if (onServer !== null) return onServer
      // A price set before it was kept on the server lives in this browser:
      // it goes up once, then every desk reads it.
      const local = localPrice(id)
      if (local === null) return null
      await saveSetupDraft(id, {
        ...((draft?.payload ?? {}) as Stored),
        setup_price: local,
      } as unknown as SetupDraft)
      return local
    },
    enabled: receiptLineId !== null,
    refetchInterval: 10_000,
  })
  return kept.data ?? null
}

/// What an earlier version of this screen kept in this browser.
function localPrice(receiptLineId: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem("central.new-articles.prices") ?? "{}") as Record<string, number>
    const value = all[receiptLineId]
    return typeof value === "number" && value > 0 ? value : null
  } catch {
    return null
  }
}

/// Keep `base` for the line on the server, beside whatever form draft is there.
export async function writeSetupPrice(
  client: QueryClient,
  receiptLineId: string,
  base: number
) {
  client.setQueryData(priceKey(receiptLineId), base)
  const current = await getSetupDraft(receiptLineId)
  const payload = {
    ...((current?.payload ?? {}) as Stored),
    setup_price: base,
  } as unknown as SetupDraft
  await saveSetupDraft(receiptLineId, payload)
  await client.invalidateQueries({ queryKey: priceKey(receiptLineId) })
}

/// Whether a stored payload is a form draft (it has tabs), not only a price.
export function isFormDraft(payload: unknown): payload is SetupDraft {
  return (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { tabs?: unknown }).tabs)
  )
}
