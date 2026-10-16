import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { inventoryKey } from "@/lib/queries"
import { placeLabel, type PlaceCode } from "@/screens/stock/shared"
import { idempotencyKey } from "@itulah/contract/client"

/// The state behind Stock's one write — typing how many pieces of each SKU go
/// from one place to another, then sending them as one Submit.
///
/// `POST /store/movements/by-sku` moves a count of one SKU; there is no tag in
/// it. A Submit is one request per line, each with its own key, so a retry
/// after the wifi blinked lands on the same movement instead of walking the
/// pieces twice. A line that fails stops the run: the lines already sent stay
/// sent (and the toast can undo them), the rest stay in the panel.

export interface Line {
  readonly sku: string
  readonly quantity: number
}

interface Sent extends Line {
  readonly from: PlaceCode
  readonly to: PlaceCode
}

interface Request {
  readonly sku_code: string
  readonly quantity: number
  readonly from: PlaceCode
  readonly to: PlaceCode
  readonly reason: string
  readonly idempotency_key: string
}

const TOAST = "stock-move"

export function useStockMove() {
  const client = useQueryClient()
  const [moving, setMoving] = useState(false)
  const [to, setTo] = useState<PlaceCode>("floor")
  const [rejectFrom, setRejectFrom] = useState<"floor" | "warehouse">("floor")
  const [quantities, setQuantities] = useState<ReadonlyMap<string, number>>(
    new Map(),
  )
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  /// One key per line, held until that line is sent — see the header.
  const keys = useRef(new Map<string, string>())

  /// Where a piece comes from follows from where it goes; Reject is the one
  /// place that has to ask.
  const from: PlaceCode =
    to === "reject" ? rejectFrom : to === "floor" ? "warehouse" : "floor"

  const lines: readonly Line[] = [...quantities].map(([sku, quantity]) => ({
    sku,
    quantity,
  }))
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0)

  const refresh = () => client.invalidateQueries({ queryKey: inventoryKey() })

  function post(request: Request) {
    return node.post<unknown>("/api/v1/store/movements/by-sku", request, {
      headers: { "Idempotency-Key": request.idempotency_key },
    })
  }

  const clear = () => {
    setQuantities(new Map())
    setFailure(null)
  }

  /// Choosing a different route drops what was typed: the amounts were
  /// clamped to another place.
  function choose(next: PlaceCode) {
    setMoving(true)
    if (next !== to || !moving) clear()
    setTo(next)
  }

  function chooseSource(next: "floor" | "warehouse") {
    if (next === rejectFrom) return
    clear()
    setRejectFrom(next)
  }

  function set(sku: string, quantity: number) {
    setQuantities((current) => {
      const next = new Map(current)
      if (quantity > 0) next.set(sku, quantity)
      else next.delete(sku)
      return next
    })
  }

  function cancel() {
    clear()
    setMoving(false)
  }

  async function undo(sent: readonly Sent[]) {
    toast.dismiss(TOAST)
    try {
      for (const one of sent) {
        await post({
          sku_code: one.sku,
          quantity: one.quantity,
          from: one.to,
          to: one.from,
          reason: `Undo: moved to ${placeLabel(one.to)}`,
          idempotency_key: idempotencyKey(),
        })
      }
      toast.success("Move undone", { id: TOAST, duration: 5_000 })
    } catch (error) {
      toast.error(describe(error), { id: TOAST, duration: 8_000 })
    } finally {
      void refresh()
    }
  }

  function said(sent: readonly Sent[]) {
    const total = sent.reduce((sum, one) => sum + one.quantity, 0)
    toast.success(
      `Moved ${total} ${total === 1 ? "pc" : "pcs"} to ${placeLabel(sent[0].to)}`,
      {
        id: TOAST,
        duration: 10_000,
        action: { label: "Undo", onClick: () => void undo(sent) },
      },
    )
  }

  async function submit() {
    if (pending || lines.length === 0) return
    setPending(true)
    setFailure(null)
    const route = { from, to }
    const sent: Sent[] = []
    try {
      for (const line of lines) {
        const id = `${line.sku}|${from}|${to}|${line.quantity}`
        const key = keys.current.get(id) ?? idempotencyKey()
        keys.current.set(id, key)
        await post({
          sku_code: line.sku,
          quantity: line.quantity,
          ...route,
          reason: `Move to ${placeLabel(to)}`,
          idempotency_key: key,
        })
        keys.current.delete(id)
        sent.push({ ...line, ...route })
      }
      clear()
      setMoving(false)
      said(sent)
    } catch (error) {
      // The lines that went are no longer waiting to be sent.
      const done = new Set(sent.map((one) => one.sku))
      setQuantities((current) => {
        const next = new Map(current)
        for (const sku of done) next.delete(sku)
        return next
      })
      setFailure(describe(error))
      if (sent.length > 0) said(sent)
    } finally {
      setPending(false)
      void refresh()
    }
  }

  return {
    moving,
    to,
    from,
    rejectFrom,
    quantities,
    lines,
    pieces,
    pending,
    failure,
    choose,
    chooseSource,
    set,
    cancel,
    submit,
  }
}

export type StockMove = ReturnType<typeof useStockMove>
