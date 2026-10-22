import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef } from "react"

import { confirm } from "@/components/ui/confirm"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState, LoadingState } from "@/components/ui/states"
import {
  countKey,
  countsKey,
  submitCount,
  useCount,
  type ScannedPiece,
  type StoreCount,
} from "@/lib/counts"
import { describe } from "@/lib/errors"
import { articleId, count, day, moment, pcs as pcsOf, sku as skuText } from "@/lib/format"
import { useHeld } from "@/screens/stock/open-record"
import { FOOT, Row, RowList, SheetSection } from "@/screens/stock/parts"
import { kindLabel, poolName, statusOf } from "@/screens/stock/count-words"
import { useRange } from "@/screens/stock/shared"
import { idempotencyKey } from "@itulah/contract/client"

/// One count, opened over the list. The sweep is done with the handheld, which
/// files its own entries; this sheet only shows what it has filed so far and
/// sends the count. Blind: no expected quantity, difference or match anywhere.

const pcs = pcsOf

// ── The sheet ───────────────────────────────────────────────────────────────

/// `entry` is the count asked for; `undefined` is closed. The sheet keeps the
/// last one while it slides away, and starts afresh for a different count (its
/// own send key, its own reading of what the handheld filed).
export function CountSheet({
  entry,
  onClose,
}: {
  entry: StoreCount | undefined
  onClose: () => void
}) {
  const held = useHeld(entry)
  if (held === undefined) return null
  return (
    <CountSheetFor
      key={held.count_id}
      entry={held}
      open={entry !== undefined}
      onClose={onClose}
    />
  )
}

function CountSheetFor({
  entry,
  open,
  onClose,
}: {
  entry: StoreCount
  open: boolean
  onClose: () => void
}) {
  const active = entry.status === "ACTIVE"
  // Re-read for what the handheld files only while the sheet is open: the held
  // sheet outlives its closing, and a closed one has nobody to show it to.
  const detail = useCount(entry.count_id, active && open)
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

  async function submit() {
    const ok = await confirm(
      total === 0
        ? { title: "Submit an empty count?", action: "Submit count" }
        : {
            title: `Submit ${pcs(total)}?`,
            body: "You can't change it after.",
            action: "Submit count",
          },
    )
    if (ok) send.mutate()
  }

  const sent = !active || send.isSuccess
  const shownTotal = sent && detail.data === undefined ? entry.counted : total
  const status = statusOf(sent && active ? "SUBMITTED" : entry.status)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={poolName(entry.pool_id)}
      badge={<Pill tone={status.tone}>{status.word}</Pill>}
      caption={`${kindLabel(entry.kind)} · Asked ${day(entry.created_at)}`}
      footer={
        sent ? undefined : (
          <div className="flex justify-end">
            <Button
              variant="primary"
              className={`${FOOT} max-md:w-full`}
              disabled={send.isPending || detail.data === undefined}
              onClick={submit}
            >
              {send.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {entry.reason !== null && entry.reason !== "" && (
          <Facts>
            <Fact term="Reason" wide>
              {entry.reason}
            </Fact>
          </Facts>
        )}

        {send.error !== null && (
          <Banner tone="bad">{describe(send.error)}</Banner>
        )}

        {sent ? (
          <Facts>
            <Fact term="Counted">{pcs(shownTotal)}</Fact>
            <Fact term={entry.status === "CLOSED" ? "Closed" : "Sent"}>
              {moment(
                entry.status === "CLOSED"
                  ? (entry.closed_at ?? entry.submitted_at)
                  : entry.submitted_at,
              )}
            </Fact>
          </Facts>
        ) : detail.isError && detail.data === undefined ? (
          <ErrorState
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        ) : detail.data === undefined ? (
          <LoadingState>Reading the count…</LoadingState>
        ) : (
          <Counted scanned={counted} total={total} />
        )}
      </div>
    </Sheet>
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
    <SheetSection title="Counted" aside={pcs(total)}>
      {rows.length === 0 ? (
        <p className="text-meta text-mute">
          Nothing counted yet. Sweep this pool with the handheld.
        </p>
      ) : (
        <RowList>
          {rows.map((row) => (
            <Row
              key={row.sku}
              title={bySku.get(row.sku)?.name ?? skuText(row.sku)}
              sub={
                <span className="font-mono">
                  {articleId(bySku.get(row.sku)?.article_code, row.sku)} ·{" "}
                  {skuText(row.sku)}
                </span>
              }
              figure={count(row.quantity)}
            />
          ))}
        </RowList>
      )}
    </SheetSection>
  )
}
