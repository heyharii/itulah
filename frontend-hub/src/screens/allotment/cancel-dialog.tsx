import { useShopName } from "@/components/operations/outbound-papers"
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { useQuery } from "@tanstack/react-query"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Textarea } from "@/components/ui/field"
import { pendingLabel } from "@/components/ui/pending-label"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Problem } from "@/components/ui/states"
import { count, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { allotmentWork } from "@/lib/operations/changes"
import {
  ALLOTMENT_CHANGE_REASONS,
  inventoryKeys,
  type AllotmentLine,
} from "@/lib/queries/inventory"
import {
  reasonOf,
  roomOf,
  stagesOf,
  storesOf as storesOfLines,
  type Stages,
} from "@/screens/allotment/amend-data"
import { cn } from "@/lib/utils"

/// One of MD's reasons for cancelling or editing, as a row of chips that wrap
/// (nothing scrolls sideways on a phone). Pressing the chosen one again lets it
/// go. 36px on a desk, 44px under a thumb.
export function ReasonChips({
  value,
  onChange,
  label = "Reason",
  required = false,
}: {
  value: string | null
  onChange: (value: string | null) => void
  label?: string
  /// A star after the label, as `Field` draws it: the act cannot go without one.
  required?: boolean
}) {
  const name = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={name} className="text-[0.9375rem] font-medium text-text">
        {label}
        {required && (
          <>
            <span aria-hidden className="ml-0.5 text-bad">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={name}
        className="flex flex-wrap gap-2"
      >
        {ALLOTMENT_CHANGE_REASONS.map((one) => {
          const on = value === one
          return (
            <button
              key={one}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? null : one)}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3.5 text-[0.9375rem] font-medium whitespace-nowrap transition-[color,background-color,border-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] max-md:h-11",
                on
                  ? "border-transparent bg-dark text-on-dark"
                  : "border-hairline-2 bg-canvas text-body hover:bg-soft-2 hover:text-ink"
              )}
            >
              {one}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/// "2 stores", "1 store".
function storesOf(n: number): string {
  return `${count(n)} ${n === 1 ? "store" : "stores"}`
}

/// "Kemang", "Kemang and Senopati", "4 stores".
function whoOf(names: readonly string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return storesOf(names.length)
}

/// How a stage's row reads: what the warehouse has picked or packed is work to
/// undo, so label, figure and line are amber; anything already dispatched
/// cannot be undone and is red (owner, 10 Oct 2026). Still to pick is quiet.
const TONE = {
  quiet: { figure: "text-ink", detail: "text-mute" },
  warn: { figure: "text-warn-fg", detail: "text-warn-fg" },
  bad: { figure: "text-bad-fg", detail: "text-bad-fg" },
} as const

/// Cancelling an allotment, or only the stores MD ticked, with what it costs
/// said before it is done (allotment-ops-prototype, "Cancel dialog: what
/// happens to the pieces, stage by stage").
///
/// A cancel is "everything not dispatched down to nothing": To pick is simply
/// removed; Picked and Packed are put back by the warehouse; Dispatched stays
/// at the store. When part is already dispatched the dialog says "Cancel the
/// rest" and adds one line asking the store to return those pieces — there is
/// no flow behind that line yet, it is the reminder. No reason is asked (model
/// C, 11 Oct 2026): what is cancelled is in the history.
///
/// A desk gets a dialog in the middle; a phone gets the same parts in a drawer
/// from the bottom, the foot pinned and its two buttons 44px — the shape the
/// kit's `Dialog` takes, with a foot that does not scroll away.
///
/// A `simple` cancel — a DC-owned allotment, or a return — has no stage answer
/// (the work route is the cloud's own, for goods going to a store): it keeps
/// the old sentence and still asks for a reason.
export function CancelDialog({
  open,
  onOpenChange,
  id,
  number,
  simple,
  toPack,
  scope,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  id: string
  number: string
  simple: boolean
  /// Pieces still to pack — what a simple cancel says it releases.
  toPack: number
  /// What is being cancelled, when it is not `simple`: the lines of the stores
  /// ticked (or every line), and whether that is the whole allotment.
  scope?: { lines: readonly AllotmentLine[]; whole: boolean }
  /// The cancel, as the write's promise: the dialog waits on it, shuts when it
  /// succeeds and says why when it fails.
  onConfirm: (reason: string) => Promise<unknown>
}) {
  const phone = useLayout() === "phone"
  const [why, setWhy] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  // A fresh form every time it opens — "adjusting state during render", as the
  // kit's `Dialog` does for its reason box.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setWhy(null)
      setNote("")
      setFailure(null)
    }
  }

  // Read when the dialog opens, and again every time it does: what the
  // warehouse has done since is what the cancel costs now. Only the whole
  // allotment's koli count comes from it; the stages are the scope's own lines.
  const work = useQuery({
    queryKey: inventoryKeys.allotmentWork(id),
    queryFn: ({ signal }) => allotmentWork(id, signal),
    enabled: open && !simple && scope?.whole === true,
    refetchOnMount: "always",
  })
  // The store as the board names it ("C001 · Cikupa").
  const shop = useShopName()
  const lines = scope?.lines ?? []
  const stages = stagesOf(lines)
  const named = (store: { id: string; name: string }) => {
    const board = shop(store.id)
    return board === store.id ? store.name : board
  }
  /// The stores in the scope with pieces at a stage, by name.
  const at = (of: (one: Stages) => number) =>
    storesOfLines(lines)
      .filter((store) => of(stagesOf(store.lines)) > 0)
      .map(named)
  const names = storesOfLines(lines).map(named)
  const nothingToCancel = !simple && roomOf(lines) === 0
  /// Part is dispatched already: what is cancelled is "the rest".
  const rest = !simple && stages.dispatched > 0
  const ready = !nothingToCancel && (!simple || why !== null) && !waiting
  const koli = scope?.whole === true ? work.data?.packed.koli : undefined

  const rows = simple
    ? []
    : [
        {
          key: "pick",
          label: "To pick",
          pieces: stages.toPick,
          detail: `${whoOf(at((one) => one.toPick))} · removed`,
          tone: "quiet" as const,
        },
        {
          key: "picked",
          label: "Picked",
          pieces: stages.picked,
          detail: `${whoOf(at((one) => one.picked))} · the warehouse puts it back`,
          tone: "warn" as const,
        },
        {
          key: "packed",
          label: koli === undefined ? "Packed" : `Packed · ${count(koli)} koli`,
          pieces: stages.packed,
          detail: `${whoOf(at((one) => one.packed))} · the warehouse puts it back`,
          tone: "warn" as const,
        },
        {
          key: "dispatched",
          label: "Dispatched",
          pieces: stages.dispatched,
          detail: `Stays at ${whoOf(at((one) => one.dispatched))}`,
          tone: "bad" as const,
        },
      ].filter((one) => one.pieces > 0)
  const gone = at((one) => one.dispatched)
  const who = whoOf(names)
  const title = simple
    ? `Cancel ${number}?`
    : scope?.whole === true
      ? rest
        ? `Cancel the rest of ${number}?`
        : `Cancel ${number}?`
      : rest
        ? `Cancel the rest for ${who}?`
        : `Cancel ${who}?`
  const verb = simple
    ? "Cancel allotment"
    : rest
      ? "Cancel the rest"
      : scope?.whole === true
        ? "Cancel allotment"
        : `Cancel ${names.length === 1 ? "store" : storesOf(names.length)}`

  const confirm = () => {
    if (!ready) return
    setWaiting(true)
    setFailure(null)
    void Promise.resolve(
      onConfirm(why === null ? "Cancelled" : reasonOf(why, note))
    )
      .then(
        () => onOpenChange(false),
        (error: unknown) => setFailure(error)
      )
      .finally(() => setWaiting(false))
  }

  const Parts: { Title: React.ElementType; Close: React.ElementType } = phone
    ? Drawer
    : BaseDialog

  const body = (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5 md:pt-5">
      <Parts.Title className="text-card-title font-semibold text-ink">
        {title}
      </Parts.Title>

      {simple ? (
        <p className="text-[0.9375rem] leading-relaxed text-body">
          {quantity(toPack)} still to pack is released. Anything already picked
          stays picked.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((one) => (
            <li
              key={one.key}
              className="flex flex-col gap-0.5 border-t border-hairline py-2.5 first:border-t-0 first:pt-0"
            >
              <span
                className={cn(
                  "flex items-baseline justify-between gap-3 text-[0.9375rem]",
                  TONE[one.tone].figure
                )}
              >
                <span className="font-medium">{one.label}</span>
                <span className="tabular-nums">{quantity(one.pieces)}</span>
              </span>
              <span
                className={cn(
                  "text-[0.9375rem] [overflow-wrap:anywhere]",
                  TONE[one.tone].detail
                )}
              >
                {one.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {rest && (
        <p className="text-[0.9375rem] [overflow-wrap:anywhere] text-body">
          Ask {gone.length === 1 ? gone[0] : "the stores"} to return the{" "}
          {quantity(stages.dispatched)}.
        </p>
      )}

      {nothingToCancel && (
        <p className="text-[0.9375rem] text-body">
          Nothing left to cancel · everything is dispatched
        </p>
      )}

      {simple && (
        <>
          <ReasonChips value={why} onChange={setWhy} required />

          <Field label="Note">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </>
      )}

      <Problem error={failure} />
    </div>
  )

  // Side by side on every width, Keep quiet and the act last — the sheet
  // foot's own order. Pinned under the body, so a long form scrolls above it.
  const foot = (
    <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3 max-md:[&>*]:h-11 max-md:[&>*]:flex-1">
      <Parts.Close render={<Button variant="quiet">Keep</Button>} />
      <Button
        variant="danger"
        pending={waiting}
        disabled={!ready && !waiting}
        onClick={confirm}
      >
        {waiting ? pendingLabel(verb) : verb}
      </Button>
    </div>
  )

  if (phone) {
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange}>
        {body}
        {foot}
      </PhoneDrawer>
    )
  }

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          // Drawn even when this dialog opens on top of a sheet: Base UI skips
          // a nested dialog's backdrop by default.
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline-2 bg-canvas shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
          {body}
          {foot}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
