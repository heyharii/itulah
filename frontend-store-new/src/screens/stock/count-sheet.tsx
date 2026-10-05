import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { RecordSheet } from "@/components/ui/record-sheet"
import { ErrorState, LoadingState } from "@/components/ui/states"
import {
  countKey,
  countsKey,
  submitCount,
  useCount,
  type CountStatus,
  type ScannedPiece,
  type StoreCount,
} from "@/lib/counts"
import { describe } from "@/lib/errors"
import { count, day, moment } from "@/lib/format"
import { cn } from "@/lib/utils"
import { poolName, statusOf } from "@/screens/stock/count-words"
import { useRange } from "@/screens/stock/shared"
import { idempotencyKey } from "@itulah/contract/client"

/// One count, opened over the list. The sweep is done with the handheld, which
/// files its own entries; this sheet only shows what it has filed so far and
/// sends the count. Blind: no expected quantity, difference or match anywhere.

/// Dot, then word — the app's grammar for a state.
export function CountStatusWord({ status }: { status: CountStatus }) {
  const { word, dot } = statusOf(status)
  return (
    <span className="inline-flex items-center gap-2 text-cell text-body">
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {word}
    </span>
  )
}

const pieces = (n: number) => `${count(n)} ${n === 1 ? "piece" : "pieces"}`

// ── The sheet ───────────────────────────────────────────────────────────────

export function CountSheet({
  entry,
  onClose,
}: {
  entry: StoreCount
  onClose: () => void
}) {
  const active = entry.status === "ACTIVE"
  const detail = useCount(entry.count_id, active)
  const client = useQueryClient()
  const sendKey = useRef(idempotencyKey())

  const counted = (detail.data?.scanned ?? []).filter(
    (piece) => piece.found_quantity > 0,
  )
  const total = counted.reduce((sum, piece) => sum + piece.found_quantity, 0)

  const send = useMutation({
    mutationFn: () => submitCount(entry.count_id, sendKey.current),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: countsKey() })
      void client.invalidateQueries({ queryKey: countKey(entry.count_id) })
    },
  })

  function submit() {
    const ok = window.confirm(
      total === 0
        ? "Submit an empty count?"
        : `Submit ${pieces(total)}? You can't change it after.`,
    )
    if (ok) send.mutate()
  }

  const sent = !active || send.isSuccess
  const shownTotal = sent && detail.data === undefined ? entry.counted : total

  return (
    <RecordSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={poolName(entry.pool_id)}
      badge={
        <CountStatusWord status={sent && active ? "SUBMITTED" : entry.status} />
      }
      caption={[
        `Asked ${day(entry.created_at)}`,
        entry.reason !== null && entry.reason !== "" ? entry.reason : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      footer={
        sent ? undefined : (
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={send.isPending || detail.data === undefined}
              onClick={submit}
            >
              {send.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-2">
          <p className="text-card-title font-medium text-ink">
            {entry.status === "CLOSED" ? "Closed." : "Sent to head office."}
          </p>
          <p className="text-[1.5rem] leading-8 font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {pieces(shownTotal)}
          </p>
          {entry.submitted_at !== null && (
            <p className="text-meta text-mute">{moment(entry.submitted_at)}</p>
          )}
        </div>
      ) : detail.isError && detail.data === undefined ? (
        <ErrorState
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      ) : detail.data === undefined ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-7">
          <p className="text-meta text-mute">
            Sweep this pool with the handheld.
          </p>
          {send.error !== null && (
            <p className="text-meta text-bad-fg">{describe(send.error)}</p>
          )}
          <Counted scanned={counted} total={total} />
        </div>
      )}
    </RecordSheet>
  )
}

// ── What is counted ─────────────────────────────────────────────────────────

function Counted({
  scanned,
  total,
}: {
  scanned: readonly ScannedPiece[]
  total: number
}) {
  const { bySku } = useRange()
  /// By SKU, the one filed most recently first.
  const rows = useMemo(() => {
    const byCode = new Map<
      string,
      { sku: string; quantity: number; at: number }
    >()
    scanned.forEach((piece, index) => {
      const row = byCode.get(piece.sku_code)
      if (row === undefined) {
        byCode.set(piece.sku_code, {
          sku: piece.sku_code,
          quantity: piece.found_quantity,
          at: index,
        })
      } else {
        row.quantity += piece.found_quantity
        row.at = index
      }
    })
    return [...byCode.values()].sort((a, b) => b.at - a.at)
  }, [scanned])

  return (
    <section>
      <p className="text-[1.5rem] leading-8 font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {pieces(total)}
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-meta text-mute">Nothing counted yet.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-card border border-hairline">
          {rows.map((row) => (
            <div
              key={row.sku}
              className="flex h-16 items-center gap-4 border-t border-hairline px-4 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">
                  {bySku.get(row.sku)?.name ?? row.sku}
                </span>
                <span className="mt-1 block truncate font-mono text-id text-mute">
                  {row.sku}
                </span>
              </span>
              <span className="font-medium text-ink tabular-nums">
                {count(row.quantity)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
