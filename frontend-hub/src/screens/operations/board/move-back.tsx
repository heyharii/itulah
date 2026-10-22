import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Minus, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { ZoomPhoto } from "@/components/ui/photo-viewer"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { dc } from "@/lib/api"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, quantity, sku as skuNumber } from "@/lib/format"
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
/// carton's sheet. A sheet on every device, each line with its picture.
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
  let error: unknown
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
  const colourway = useColourwayFill()
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
  const back = target.back === true
  const to: "picked" | "pick" = back
    ? "pick"
    : packed
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
          hasOwed
            ? Math.min(line.now, owedMap.get(line.sku) ?? 0)
            : back && !packed
              ? 0
              : line.now,
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
    if (back) {
      if (packed && source.carton !== null)
        parts.push(
          everything
            ? `${source.carton} opened · label void`
            : `${source.carton} reopened · label reprinted`
        )
      parts.push(`${quantity(moved)} to pick again`)
      return parts.join(" · ")
    }
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
      if (back)
        toast.success(`${quantity(result.moved)} back to Picklist`, {
          description: [
            shopName(target.destinationId),
            ...result.kolis
              .filter((one) => one.emptied)
              .map((one) => `${one.koli_number} emptied`),
          ].join(" · "),
        })
      else toast.success(...said(result, to))
      onMoved?.(result)
      onClose()
    },
  })

  const ready = lines !== undefined && qty !== null
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
        .join(" · ") || skuNumber(sku)
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
        {packed && !back ? (
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
        <div className="flex items-center gap-2">
          {hasOwed && (
            <Button variant="ghost" size="card" onClick={() => fill("owed")}>
              MD&apos;s edit
            </Button>
          )}
          <Button variant="primary" size="card" onClick={() => fill("all")}>
            All
          </Button>
          <Button variant="ghost" size="card" onClick={() => fill("none")}>
            None
          </Button>
        </div>
      </div>

      <div>
        <div className="flex h-9 items-center gap-3 border-b border-hairline text-body max-md:hidden">
          <span className="w-11 shrink-0" />
          <span className="min-w-0 flex-1">SKU</span>
          <span className="w-20 shrink-0 text-right">Quantity</span>
          <span className="w-[10.5rem] shrink-0 text-center">
            {back ? "Back to Picklist" : "Put back"}
          </span>
        </div>
        <ul className="flex flex-col">
          {lines.map((line) => {
            const q = qtyOf(line)
            const identity = catalogue.get(line.sku)
            const colours = colourway(identity?.colour ?? null)
            return (
              <li
                key={line.sku}
                className="border-row-line flex min-h-[4.25rem] items-center gap-3 border-t py-2.5 first:border-t-0 max-md:flex-wrap"
              >
                <ZoomPhoto
                  url={identity?.image_url ?? null}
                  name={name(line.sku)}
                  className="rounded-[9px]"
                  placeholder={
                    <Thumbnail
                      url={null}
                      name={identity?.article_name ?? ""}
                      division={identity?.division_code}
                      colours={colours}
                      className="size-72 rounded-card"
                    />
                  }
                >
                  <Thumbnail
                    url={identity?.image_url ?? null}
                    name={identity?.article_name ?? ""}
                    division={identity?.division_code}
                    colours={colours}
                    className="size-11 rounded-[9px]"
                  />
                </ZoomPhoto>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium [overflow-wrap:anywhere] text-ink">
                    {name(line.sku)}
                  </span>
                  <span className="block text-body tabular-nums [overflow-wrap:anywhere]">
                    {skuNumber(line.sku)}
                    {line.where !== "" && ` · ${line.where}`}
                  </span>
                </span>
                <span className="w-20 shrink-0 text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
                  <span className="font-normal text-body md:hidden">Quantity </span>
                  {count(line.now)}
                </span>
                <span className="flex shrink-0 justify-center md:w-[10.5rem] max-md:w-full">
                  <Stepper
                    block={phone}
                    value={q}
                    max={line.now}
                    label={`${back ? "Back to Picklist" : "Put back"} ${skuNumber(line.sku)}`}
                    padLabel={name(line.sku)}
                    onChange={(next) => set(line, next)}
                  />
                </span>
              </li>
            )
          })}
        </ul>
        <div className="flex h-12 items-center gap-3 border-t border-hairline font-semibold text-ink tabular-nums">
          <span className="min-w-0 flex-1 md:pl-14">Total</span>
          <span className="w-20 shrink-0 text-right">{count(total)}</span>
          <span className="w-[10.5rem] shrink-0 text-center max-md:w-auto max-md:pl-3">
            <span className="font-normal text-body md:hidden">Back </span>
            {count(moved)}
          </span>
        </div>
      </div>
    </div>
  )

  const title = back
    ? `Back to Picklist · ${shopName(target.destinationId)}`
    : `Put back from ${shopName(target.destinationId)}`
  const foot = (
    <SheetFooter
      onCancel={onClose}
      cancelLabel="Keep"
      note={ready && lines.length > 0 ? outcome : undefined}
      error={submit.error}
      primary={{
        label: back
          ? moved > 0
            ? `Back to Picklist · ${quantity(moved)}`
            : "Back to Picklist"
          : moved > 0
            ? // Everything MD took out: it goes to the racks, nothing is
              // picked again, so the button says so.
              `Put back ${quantity(moved)} to ${to === "pick" && again === 0 ? "stock" : WHERE[to]}`
            : "Put back",
        pendingLabel: back ? "Sending back…" : "Putting back…",
        pending: submit.isPending,
        disabled: !ready || moved === 0,
        onClick: () => submit.mutate(),
      }}
    />
  )

  // One sheet on every device (owner, 21 Oct 2026: "jadikan ini sheet dan
  // ada fotonya"): the lines with their pictures, the foot pinned.
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      id={id}
      caption={sub}
      size="table"
      footer={foot}
    >
      {body}
    </Sheet>
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
function said(
  result: MoveBackResult,
  to: "picked" | "pick"
): [string, { description: string }] {
  // Nothing to pick again: it went to the racks, not to the Picklist.
  const parts: string[] = [
    to === "pick" && result.to_pick_again === 0 ? "Back in stock" : WHERE[to],
  ]
  const reprinted = result.kolis.filter((one) => one.label_reprint).length
  if (reprinted > 0)
    parts.push(reprinted === 1 ? "label reprinted" : "labels reprinted")
  const emptied = result.kolis.filter((one) => one.emptied)
  if (emptied.length > 0)
    parts.push(`${emptied.map((one) => one.koli_number).join(", ")} emptied`)
  if (to === "pick" && result.to_pick_again > 0)
    parts.push(`${quantity(result.to_pick_again)} to pick again`)
  return [
    `${quantity(result.moved)} put back`,
    { description: parts.join(" · ") },
  ]
}
