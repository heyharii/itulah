import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { SubHead } from "@/components/ui/rows"
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

/// The request button, at the far right of the Variants row (owner,
/// 2026-10-10: it stays there; the answers stand in the column). `Request
/// Quantity Check`, then `Requested` while the warehouse has not answered,
/// then `Recount`, which issues a NEW check beside the old answers.
export function QuantityCheckRequest({
  receiptLineId,
  name,
  expected,
  division,
  tags,
  placement,
}: {
  receiptLineId: string
  name: string
  expected: readonly QuantityCheckCell[]
  division: string
  tags: readonly string[]
  /// `variants`: the first request, in the Variants row; it leaves once the
  /// line has any check. `box`: Recount, and Requested while one is open, in
  /// the box at the top right (owner, 2026-10-10).
  placement: "variants" | "box"
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
  if (placement === "variants" && (checks.isPending || all.length > 0))
    return null
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
/// It stands in a column to the right of the form when the sheet is wide
/// enough, and under the Variants heading when it is not; the caller draws it
/// in whichever place the container allows (see `DeliverySetup`).
export function QuantityCheckPanel({
  receiptLineId,
  name,
  expected,
  division,
  tags,
  showEmpty = false,
}: {
  receiptLineId: string
  name: string
  expected: readonly QuantityCheckCell[]
  division: string
  tags: readonly string[]
  /// The box at the top right stands before the first request, saying so;
  /// the copy under Variants (a narrow sheet) is silent until there is
  /// something to read.
  showEmpty?: boolean
}) {
  const checks = useQuery({
    queryKey: quantityCheckKeys.line(receiptLineId),
    queryFn: ({ signal }) => listLineQuantityChecks(receiptLineId, signal),
    refetchInterval: 15_000,
  })
  const [earlier, setEarlier] = useState(false)

  const all = checks.data ?? []
  // Open requests stand on top; the answers follow, the newest first.
  const requested = all.filter((one) => one.status === "REQUESTED")
  const answered = all
    .filter((one) => one.status === "COUNTED")
    .sort((a, b) => answeredAt(b) - answeredAt(a))
  const shown = earlier ? answered : answered.slice(0, ANSWERS_SHOWN)

  if (all.length === 0) {
    return showEmpty ? (
      <div className="flex flex-col gap-3">
        <SubHead className="mb-0">Quantity Check</SubHead>
        <p className="text-[0.875rem] text-mute">Nothing requested yet.</p>
      </div>
    ) : null
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SubHead className="mb-0">Quantity Check</SubHead>
        <QuantityCheckRequest
          receiptLineId={receiptLineId}
          name={name}
          expected={expected}
          division={division}
          tags={tags}
          placement="box"
        />
      </div>
      {requested.map((one) => (
        <div key={one.check_id} className="text-[0.875rem] text-mute">
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
        <Button
          variant="quiet"
          className="self-start"
          onClick={() => setEarlier((now) => !now)}
        >
          {earlier ? "Hide Earlier" : "Show Earlier"}
        </Button>
      )}
    </div>
  )
}

/// One answered check: who counted and when, then what they found. Flat and
/// small, because it sits inside the box at the top right: no border of its
/// own, 14px rows, and the article named once when every row is the same one.
function AnswerBlock({ check }: { check: QuantityCheck }) {
  const total = check.lines.reduce((sum, line) => sum + line.quantity, 0)
  const articles = new Set(check.lines.map((line) => line.article ?? ""))
  const common = articles.size === 1 ? ([...articles][0] ?? "") : ""
  return (
    <div className="text-[0.875rem]">
      <div className="pb-1 text-mute">
        Counted by {check.counted_by}
        {check.counted_at !== null && ` · ${ago(check.counted_at)}`}
      </div>
      {common !== "" && (
        <div className="pb-1 font-medium text-ink">{common}</div>
      )}
      {check.lines.map((line, at) => (
        <div
          key={`${line.colour}|${line.size}|${at}`}
          className="flex items-center justify-between gap-3 border-t border-hairline py-1.5"
        >
          <span className="min-w-0 truncate text-ink">
            {common === "" && line.article ? `${line.article} · ` : ""}
            {line.colour} · {line.size}
          </span>
          <span className="shrink-0 text-ink tabular-nums">
            {count(line.quantity)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-1.5 text-mute">
        <span>Total</span>
        <span className="tabular-nums">{count(total)} pcs</span>
      </div>
    </div>
  )
}
