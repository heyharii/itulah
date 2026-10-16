import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Minus, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  moveBack,
  owedWork,
  type MoveBackResult,
} from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { idempotencyKey } from "@itulah/contract/client"

import { owedBySku, type MoveBackTarget } from "@/screens/operations/board/owed"

/// **Move back**: the Gudang undoes its own work, or works off what MD took
/// out. Picked → Pick List, Packed → Picked, Packed → Pick List. Partial, per
/// SKU and quantity. Never from a carton on a trip — the server refuses, and
/// says so here, inline, where it was asked for.
///
/// It is a physical thing, so it asks first. Reached from a card's Move back
/// button, from dropping a card on an earlier lane (a desk), and from a
/// carton's sheet. A desk draws it as a dialog in the middle; a phone, as the
/// hub's bottom sheet, with the lines stacked and the foot pinned.
///
/// The lines come from where the pieces are now — a carton's manifest, or a
/// shop's waiting pieces by SKU off the picklists the Pack sheet reads — and
/// the quantities start at what MD took out when the card is owed, else all.
/// Pieces MD already took out go back first and are not asked for again (the
/// server settles them; the sentence under the lines says how many).

const WHERE = { picked: "Picked", pick: "Picklist" } as const

/// What `target` opens: the dialog when it is a target, nothing when `null`.
/// The last target stays drawn while the dialog fades out, and every opening
/// starts a fresh body — new quantities, a new idempotency key.
export function MoveBackDialog({
  target,
  onClose,
  onMoved,
}: {
  target: MoveBackTarget | null
  onClose: () => void
  /// Told what the server did, once, before the dialog closes: a carton's own
  /// sheet closes itself when its carton was emptied.
  onMoved?: (result: MoveBackResult) => void
}) {
  const [shown, setShown] = useState<{
    target: MoveBackTarget
    opened: number
  } | null>(null)
  if (target !== null && shown?.target !== target)
    setShown({ target, opened: (shown?.opened ?? 0) + 1 })
  if (shown === null) return null
  return (
    <Mover
      key={shown.opened}
      target={shown.target}
      open={target !== null}
      onClose={onClose}
      onMoved={onMoved}
    />
  )
}

interface SourceLine {
  readonly sku: string
  /// The carton it is in, or the allotments whose picklists hold it.
  readonly where: string
  readonly now: number
}

/// What is on the source now, by SKU, and whether every read behind it has
/// settled (a figure from a stale cache is not one to prefill from).
function useSource(target: MoveBackTarget) {
  const packed = target.from === "packed"
  const manifest = useQuery({
    queryKey: keys.manifest(target.koliId ?? ""),
    queryFn: ({ signal }) => dc.koliManifest(target.koliId ?? "", signal),
    enabled: packed && target.koliId !== undefined,
  })
  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
    enabled: !packed,
  })
  const rounds = useMemo(
    () =>
      (picklists.data ?? []).filter(
        (round) =>
          round.destination_id === target.destinationId && round.waiting > 0
      ),
    [picklists.data, target.destinationId]
  )
  const sessions = useQueries({
    queries: rounds.map((round) => ({
      queryKey: keys.pickRound(round.session.session_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dc.pickSession(round.session.session_id, signal),
      enabled: !packed,
    })),
  })

  let lines: SourceLine[] | undefined
  let carton: string | null = null
  let fetching: boolean
  let error: unknown = null
  let retry: () => void
  if (packed) {
    fetching = manifest.isFetching
    error = manifest.error
    retry = () => void manifest.refetch()
    if (manifest.data !== undefined) {
      carton = manifest.data.koli.koli_number
      const by = new Map<string, number>()
      // One carton can hold a SKU for two allotments: added up, since a
      // Move back is asked by SKU.
      for (const line of manifest.data.lines)
        by.set(line.sku_code, (by.get(line.sku_code) ?? 0) + line.quantity)
      lines = [...by].map(([sku, now]) => ({ sku, where: carton ?? "", now }))
    }
  } else {
    fetching = picklists.isFetching || sessions.some((one) => one.isFetching)
    error = picklists.error ?? sessions.find((one) => one.error)?.error ?? null
    retry = () => {
      void picklists.refetch()
      for (const one of sessions) void one.refetch()
    }
    if (
      picklists.data !== undefined &&
      sessions.every((one) => one.data !== undefined)
    ) {
      const by = new Map<string, { now: number; from: Set<string> }>()
      rounds.forEach((round, index) => {
        for (const line of sessions[index]?.data?.lines ?? []) {
          if (line.waiting <= 0) continue
          const row = by.get(line.sku_code) ?? {
            now: 0,
            from: new Set<string>(),
          }
          row.now += line.waiting
          if (round.allotment_number !== null)
            row.from.add(round.allotment_number)
          by.set(line.sku_code, row)
        }
      })
      lines = [...by].map(([sku, row]) => ({
        sku,
        where: [...row.from].sort().join(", "),
        now: row.now,
      }))
    }
  }
  return { lines, carton, fetching, error, retry }
}

function Mover({
  target,
  open,
  onClose,
  onMoved,
}: {
  target: MoveBackTarget
  open: boolean
  onClose: () => void
  onMoved?: (result: MoveBackResult) => void
}) {
  const phone = useLayout() === "phone"
  const shopName = useShopName()
  const catalogue = useCatalogueIdentity()
  const client = useQueryClient()
  const packed = target.from === "packed"

  const source = useSource(target)
  const owed = useQuery({
    queryKey: keys.owed(),
    queryFn: ({ signal }) => owedWork(signal),
  })
  const owedMap = useMemo(
    () => owedBySku(owed.data ?? [], target),
    [owed.data, target]
  )
  const hasOwed = owedMap.size > 0

  /// Where the pieces go. Out of a carton MD took pieces from they go back to
  /// the Pick List (nobody wants them any more); otherwise to Picked, where
  /// they can still be packed again. Out of the pick area there is one place.
  const [choice, setChoice] = useState<"picked" | "pick" | null>(
    target.to ?? null
  )
  const to: "picked" | "pick" = packed
    ? (choice ?? (hasOwed ? "pick" : "picked"))
    : "pick"

  /// How many of each SKU go back. Set once, when what is on the source has
  /// been read fresh: owed → what MD took out, else everything.
  const [qty, setQty] = useState<Readonly<Record<string, number>> | null>(null)
  const lines = source.lines
  if (
    qty === null &&
    lines !== undefined &&
    !source.fetching &&
    !owed.isFetching
  )
    setQty(
      Object.fromEntries(
        lines.map((line) => [
          line.sku,
          hasOwed ? Math.min(line.now, owedMap.get(line.sku) ?? 0) : line.now,
        ])
      )
    )
  const qtyOf = (line: SourceLine) =>
    Math.max(0, Math.min(line.now, qty?.[line.sku] ?? 0))
  const set = (line: SourceLine, next: number) =>
    setQty((was) => ({
      ...was,
      [line.sku]: Math.max(0, Math.min(line.now, next)),
    }))
  const fill = (how: "all" | "none" | "owed") =>
    setQty(
      Object.fromEntries(
        (lines ?? []).map((line) => [
          line.sku,
          how === "all"
            ? line.now
            : how === "none"
              ? 0
              : Math.min(line.now, owedMap.get(line.sku) ?? 0),
        ])
      )
    )

  let moved = 0
  let already = 0
  let total = 0
  for (const line of lines ?? []) {
    const q = qtyOf(line)
    moved += q
    already += Math.min(q, owedMap.get(line.sku) ?? 0)
    total += line.now
  }
  const again = moved - already
  const everything = total > 0 && moved === total

  const outcome = (() => {
    if (moved === 0) return "Choose what goes back."
    const parts: string[] = []
    if (packed && source.carton !== null)
      parts.push(
        everything
          ? `${source.carton} opened · label void`
          : `${source.carton} reopened · label reprinted`
      )
    parts.push(
      to === "picked"
        ? `${quantity(moved)} join the picked pile`
        : `${quantity(moved)} back to stock`
    )
    if (to === "pick")
      parts.push(
        again > 0 ? `${count(again)} to pick again` : "nothing to pick again"
      )
    if (already > 0)
      parts.push(`${count(already)} of them were already taken out by MD`)
    return parts.join(" · ")
  })()

  // New per opening, never per attempt: a retry after a dropped connection
  // lands once.
  const [key] = useState(() => idempotencyKey())
  const submit = useMutation({
    mutationFn: () =>
      moveBack({
        idempotency_key: key,
        destination_id: target.destinationId,
        from: target.from,
        to,
        koli_id: packed ? (target.koliId ?? null) : null,
        lines: (lines ?? [])
          .map((line) => ({ sku_code: line.sku, quantity: qtyOf(line) }))
          .filter((line) => line.quantity > 0),
      }),
    onSuccess: (result) => {
      // Every list on the board moved: pieces left a carton or the pick area,
      // a picklist asks again, MD's owed work shrank.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
      toast.success(said(result, to))
      onMoved?.(result)
      onClose()
    },
  })

  const ready = lines !== undefined && qty !== null
  const where = packed ? "Koli" : "Picklist"
  const sub = ready
    ? `${count(total)} ${total === 1 ? "pc" : "pcs"} · now ${packed ? "packed" : "picked"}`
    : undefined
  const id = ready
    ? packed
      ? (source.carton ?? undefined)
      : [...new Set(lines.map((line) => line.where).filter(Boolean))]
          .sort()
          .join(", ") || undefined
    : undefined

  const name = (sku: string) => {
    const identity = catalogue.get(sku)
    return (
      [identity?.article_name, identity?.colour, identity?.size]
        .filter(Boolean)
        .join(" · ") || sku
    )
  }

  const body = !ready ? (
    source.error !== null && !source.fetching ? (
      <ErrorState error={source.error} onRetry={source.retry} />
    ) : (
      <LoadingState>
        {packed ? "Reading the koli…" : "Reading what is picked…"}
      </LoadingState>
    )
  ) : lines.length === 0 ? (
    <p className="py-10 text-center text-[0.9375rem] text-body">
      Nothing is waiting here any more.
    </p>
  ) : (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {packed ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="To">
            {(["picked", "pick"] as const).map((one) => (
              <button
                key={one}
                type="button"
                aria-pressed={to === one}
                onClick={() => setChoice(one)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-4 text-[0.9375rem] font-medium transition-[color,background-color,border-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 max-md:h-11",
                  to === one
                    ? "border-accent bg-accent-bg text-accent"
                    : "border-hairline-2 bg-canvas text-body hover:border-hairline-strong hover:text-ink"
                )}
              >
                {WHERE[one]}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {hasOwed && (
            <Button
              variant="quiet"
              size="sm"
              className="max-md:h-11"
              onClick={() => fill("owed")}
            >
              MD&apos;s edit
            </Button>
          )}
          <Button
            variant="quiet"
            size="sm"
            className="max-md:h-11"
            onClick={() => fill("all")}
          >
            All
          </Button>
          <Button
            variant="quiet"
            size="sm"
            className="max-md:h-11"
            onClick={() => fill("none")}
          >
            None
          </Button>
        </div>
      </div>

      {phone ? (
        <ul className="flex flex-col overflow-hidden rounded-inner border border-hairline">
          {lines.map((line) => {
            const q = qtyOf(line)
            return (
              <li
                key={line.sku}
                className={cn(
                  "flex flex-col gap-3 border-b border-hairline px-3.5 py-3",
                  q === 0 && "bg-soft"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[0.9375rem] [overflow-wrap:anywhere] text-ink">
                      {name(line.sku)}
                    </div>
                    <div className="font-mono text-[0.9375rem] break-all text-mute">
                      {line.sku}
                      {line.where !== "" && ` · ${line.where}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-[0.9375rem] whitespace-nowrap text-body tabular-nums">
                    Now{" "}
                    <span className="font-semibold text-ink">
                      {count(line.now)}
                    </span>
                  </div>
                </div>
                <Stepper
                  block
                  value={q}
                  max={line.now}
                  label={`Put back ${line.sku}`}
                  padLabel={name(line.sku)}
                  onChange={(next) => set(line, next)}
                />
                <Split moving={q} keeping={line.now - q} />
              </li>
            )
          })}
          <li className="flex items-center justify-between gap-3 bg-soft-2 px-3.5 py-3 text-[0.9375rem] font-medium text-ink tabular-nums">
            <span>Total</span>
            <span>
              {count(total)} now · {count(moved)} back
            </span>
          </li>
        </ul>
      ) : (
        <div className="overflow-hidden rounded-inner border border-hairline">
          <table className="w-full border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-hairline text-left text-[0.9375rem] text-body">
                <th className="h-9 w-12 px-3 font-normal">No.</th>
                <th className="h-9 px-3 font-normal">SKU</th>
                <th className="h-9 px-3 font-normal">{where}</th>
                <th className="h-9 w-20 px-3 text-right font-normal">Now</th>
                <th className="h-9 w-56 px-3 text-center font-normal">
                  Put back
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const q = qtyOf(line)
                return (
                  <tr
                    key={line.sku}
                    className={cn(
                      "border-b border-hairline",
                      q === 0 && "bg-soft"
                    )}
                  >
                    <td className="px-3 py-2 text-mute tabular-nums">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{name(line.sku)}</div>
                      <div className="font-mono text-[0.9375rem] text-mute">
                        {line.sku}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[0.9375rem] text-body">
                      {line.where}
                    </td>
                    <td className="px-3 py-2 text-right text-body tabular-nums">
                      {count(line.now)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-center gap-1">
                        <Stepper
                          value={q}
                          max={line.now}
                          label={`Put back ${line.sku}`}
                          padLabel={name(line.sku)}
                          onChange={(next) => set(line, next)}
                        />
                        <Split moving={q} keeping={line.now - q} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-soft-2 font-medium text-ink tabular-nums">
                <td className="h-10 px-3" />
                <td className="px-3" colSpan={2}>
                  Total
                </td>
                <td className="px-3 text-right">{count(total)}</td>
                <td className="px-3 text-center">{count(moved)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )

  const title = `Put back from ${shopName(target.destinationId)}`
  const foot = (
    <SheetFooter
      onCancel={onClose}
      cancelLabel="Keep"
      note={ready && lines.length > 0 ? outcome : undefined}
      error={submit.error}
      primary={{
        label:
          moved > 0
            ? `Put back ${quantity(moved)} to ${WHERE[to]}`
            : "Put back",
        pendingLabel: "Putting back…",
        pending: submit.isPending,
        disabled: !ready || moved === 0,
        onClick: () => submit.mutate(),
      }}
    />
  )

  // A phone: the hub's own bottom sheet — full height, the foot pinned above
  // the home bar, the lines stacked.
  if (phone) {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={title}
        id={id}
        caption={sub}
        footer={foot}
      >
        {body}
      </Sheet>
    )
  }

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn even when this opens over a carton's sheet: Base UI skips a
          // nested dialog's backdrop by default.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[46rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline-2 bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0 flex-1">
              <BaseDialog.Title className="text-card-title font-semibold text-ink">
                {title}
              </BaseDialog.Title>
              {(id !== undefined || sub !== undefined) && (
                <p className="mt-0.5 text-[0.9375rem] text-mute tabular-nums">
                  {id !== undefined && <span className="font-mono">{id}</span>}
                  {id !== undefined && sub !== undefined && " · "}
                  {sub}
                </p>
              )}
            </div>
            <BaseDialog.Close
              render={
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X />
                </Button>
              }
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
          <div className="shrink-0 border-t border-hairline px-5 py-4">
            {foot}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// What a line does under the stepper: how many go back and how many stay
/// where they are ("Move back 10 · Keep 20", owner 10 Oct 2026). Keep is what
/// is on the source now less what moves, so it is known for every line.
function Split({ moving, keeping }: { moving: number; keeping: number }) {
  return (
    <span className="text-[0.9375rem] text-mute tabular-nums">
      Put back <span className="text-ink">{count(moving)}</span> · Keep{" "}
      <span className="text-ink">{count(keeping)}</span>
    </span>
  )
}

/// A quantity picked with a thumb or typed: − , the number, + . The number is
/// the hub's `Input` with `inputMode="numeric"`, so on a phone it opens the
/// number pad and the keyboard never covers the row. `block` stretches it to
/// the row's width (a phone's stacked line).
function Stepper({
  value,
  max,
  label,
  padLabel,
  block = false,
  onChange,
}: {
  value: number
  max: number
  label: string
  padLabel: string
  block?: boolean
  onChange: (next: number) => void
}) {
  return (
    <span
      className={cn(
        "items-center gap-2",
        block ? "flex w-full" : "inline-flex"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={`One less, ${label}`}
        disabled={value <= 0}
        className="max-md:size-11"
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <Input
        value={String(value)}
        inputMode="numeric"
        aria-label={label}
        padLabel={padLabel}
        maxLength={String(max).length}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "")
          onChange(digits === "" ? 0 : Math.min(max, Number(digits)))
        }}
        className={cn(
          "h-8 text-center tabular-nums max-md:h-11",
          block ? "min-w-0 flex-1" : "w-16"
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={`One more, ${label}`}
        disabled={value >= max}
        className="max-md:size-11"
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </span>
  )
}

/// The receipt: what moved, where, and what the server did to the labels.
function said(result: MoveBackResult, to: "picked" | "pick"): string {
  const parts = [`${quantity(result.moved)} put back to ${WHERE[to]}`]
  const reprinted = result.kolis.filter((one) => one.label_reprint).length
  if (reprinted > 0)
    parts.push(reprinted === 1 ? "label reprinted" : "labels reprinted")
  const emptied = result.kolis.filter((one) => one.emptied)
  if (emptied.length > 0)
    parts.push(`${emptied.map((one) => one.koli_number).join(", ")} emptied`)
  if (to === "pick" && result.to_pick_again > 0)
    parts.push(`${quantity(result.to_pick_again)} to pick again`)
  return parts.join(" · ")
}
