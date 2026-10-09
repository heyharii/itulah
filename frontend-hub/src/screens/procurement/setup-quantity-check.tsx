import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, ListPlus, X } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Problem } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import {
  askQuantityCheck,
  listLineQuantityChecks,
  quantityCheckKeys,
  type QuantityCheck,
  type QuantityCheckCell,
} from "@/lib/queries/quantity-checks"

/// How many answers are open before the rest fold under "Show Earlier".
const ANSWERS_SHOWN = 3

/// When an answer was given, as a sortable number: the newest sorts first.
const answeredAt = (check: QuantityCheck) =>
  Date.parse(check.counted_at ?? check.requested_at) || 0

/// The icon that opens the Quantity Check card. It stands in the sheet's head
/// (the `actions` of the New Articles sheet) and a small dot on it says a
/// request is out, waiting for the warehouse.
export function QuantityCheckToggle({
  open,
  requested,
  onClick,
}: {
  open: boolean
  requested: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-label="Quantity Check"
      aria-expanded={open}
      title="Quantity Check"
      onClick={onClick}
      className={open ? "bg-soft-2" : undefined}
    >
      <span className="relative grid place-items-center">
        <ClipboardCheck />
        {requested && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-canvas"
          />
        )}
      </span>
    </Button>
  )
}

/// The request button, at the far right of the Variants row (owner,
/// 2026-10-10: it stays there; only the answers float). `Request Quantity
/// Check`, then `Requested` while the warehouse has not answered, then
/// `Recount`, which issues a NEW check beside the old answers.
export function QuantityCheckRequest({
  receiptLineId,
  name,
  expected,
  division,
  tags,
}: {
  receiptLineId: string
  name: string
  expected: readonly QuantityCheckCell[]
  division: string
  tags: readonly string[]
}) {
  const client = useQueryClient()
  const checks = useQuery({
    queryKey: quantityCheckKeys.line(receiptLineId),
    queryFn: ({ signal }) => listLineQuantityChecks(receiptLineId, signal),
    refetchInterval: 15_000,
  })
  const ask = useMutation({
    mutationFn: () =>
      askQuantityCheck({
        receipt_line_id: receiptLineId,
        article_name: name.trim() === "" ? "Delivery" : name.trim(),
        expected,
        division: division === "" ? undefined : division,
        tags,
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: quantityCheckKeys.line(receiptLineId),
      }),
  })
  const all = checks.data ?? []
  const asked = all.some((one) => one.status === "REQUESTED")
  const answered = all.some((one) => one.status === "COUNTED")
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        type="button"
        disabled={asked}
        pending={ask.isPending}
        onClick={() => ask.mutate()}
      >
        {asked
          ? "Requested"
          : answered
            ? "Recount"
            : "Request Quantity Check"}
      </Button>
      {ask.error && <Problem error={ask.error} />}
    </div>
  )
}

/// The warehouse's counts of this delivery by colour and size, as a reference
/// while the article is named (owner, 2026-10-06). Nothing waits for them and
/// nothing is checked against them: every check of the line is listed, newest
/// first, as a flat list of what the warehouse found, and "Recount" asks the
/// warehouse again, which issues a NEW check beside the old answers (owner,
/// 2026-10-10).
///
/// It floats at the top right of the sheet as a card over the form, opened
/// from `QuantityCheckToggle`, and covers part of the form without pushing it
/// (owner, 2026-10-10). The wrapper is a zero-height `sticky` box at the very
/// top of the form: the sheet's body is the scroll container, so the card
/// stays at the top right while the form scrolls under it. Its height is held
/// below the sheet's sticky foot.
export function QuantityCheckCard({
  receiptLineId,
  name,
  expected,
  division,
  tags,
  onClose,
}: {
  receiptLineId: string
  /// The name as it stands in the form, kept with the ask so the warehouse
  /// can say which goods it is counting.
  name: string
  /// Every colour x size the form has chosen, in words: the warehouse sheet
  /// opens with one row for each, waiting for its quantity.
  expected: readonly QuantityCheckCell[]
  /// The division code and tag codes the form has chosen: the warehouse sheet
  /// shows them beside the picture, as the form does.
  division: string
  tags: readonly string[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const checks = useQuery({
    queryKey: quantityCheckKeys.line(receiptLineId),
    queryFn: ({ signal }) => listLineQuantityChecks(receiptLineId, signal),
    refetchInterval: 15_000,
  })
  const [earlier, setEarlier] = useState(false)

  // Escape puts the card away first. It is caught before the sheet's own
  // Escape, so one press closes the card and a second closes the sheet.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopImmediatePropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  const all = checks.data ?? []
  // Open requests stand on top; the answers follow, the newest first.
  const requested = all.filter((one) => one.status === "REQUESTED")
  const answered = all
    .filter((one) => one.status === "COUNTED")
    .sort((a, b) => answeredAt(b) - answeredAt(a))
  const asked = requested.length > 0
  const shown = earlier ? answered : answered.slice(0, ANSWERS_SHOWN)

  return (
    // The negative bottom margin takes back the form's own row gap, so this
    // zero-height box leaves no gap above the first field.
    <div className="sticky top-3 z-40 -mb-7 flex h-0 justify-end min-[100rem]:-mb-10">
      <section
        aria-label="Quantity Check"
        className="h-fit max-h-[min(70vh,calc(100dvh-16rem))] w-[20rem] max-w-[calc(100%-2rem)] origin-top-right overflow-y-auto overscroll-contain rounded-card border border-hairline bg-canvas shadow-pop transition-[opacity,transform] duration-150 ease-(--ease-out) starting:scale-95 starting:opacity-0"
      >
        <div className="flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-4">
          <h2 className="text-[0.9375rem] font-medium text-ink">
            Quantity Check
          </h2>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        {requested.map((one) => (
          <div
            key={one.check_id}
            className="border-t border-hairline px-4 py-3 text-[0.875rem] text-mute"
          >
            <div>
              Requested · by {one.requested_by} · {ago(one.requested_at)}
            </div>
            <div className="mt-0.5">Waiting for the warehouse</div>
          </div>
        ))}
        {shown.map((one) => (
          <AnswerBlock key={one.check_id} check={one} />
        ))}
        {answered.length > ANSWERS_SHOWN && (
          <div className="border-t border-hairline px-1.5 py-1.5">
            <Button
              variant="quiet"
              type="button"
              onClick={() => setEarlier((now) => !now)}
            >
              {earlier ? "Hide Earlier" : "Show Earlier"}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

/// One answered check, as a section of the card: who counted and when, then
/// what they found, then the total.
function AnswerBlock({ check }: { check: QuantityCheck }) {
  const total = check.lines.reduce((sum, line) => sum + line.quantity, 0)
  return (
    <div className="border-t border-hairline px-4 py-3">
      <div className="text-[0.875rem] text-mute">
        Counted by {check.counted_by}
        {check.counted_at !== null && ` · ${ago(check.counted_at)}`}
      </div>
      <div className="mt-1.5 flex flex-col">
        {check.lines.map((line, at) => (
          <div
            key={`${line.colour}|${line.size}|${at}`}
            className="flex items-center justify-between gap-3 py-1 text-[0.875rem]"
          >
            <span className="min-w-0 truncate text-ink">
              {line.article ? `${line.article} · ` : ""}
              {line.colour} · {line.size}
            </span>
            <span className="shrink-0 text-ink tabular-nums">
              {count(line.quantity)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-hairline pt-2 text-[0.875rem] text-mute">
        <span>Total</span>
        <span className="tabular-nums">{count(total)} pcs</span>
      </div>
    </div>
  )
}