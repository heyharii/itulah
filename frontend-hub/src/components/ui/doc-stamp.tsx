import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { dayMonth } from "@/lib/format"
import { cn } from "@/lib/utils"
import { STAMP } from "@/screens/procurement/shared"

/// A finished document's stamp, over its corner: the state over the day it was
/// reached, the same rubber date stamp the order list presses on a finished
/// row (owner, 2026-10-14: "kita pake cap untuk dokumen yg selesai"). Laid
/// over the document, not given a row of its own, so what is under it still
/// reads. The parent is `relative`; an open document has no stamp.
const TONE = {
  ok: "text-ok-fg",
  warn: "text-warn-fg",
  bad: "text-bad-fg",
  mute: "text-mute",
} as const

/// How long after a change of the viewer's own went through a stamp still
/// counts as pressed by it: the save, the document read back, and the sheet
/// drawn again under it, on a slow phone. Past that, a stamp that appears is a
/// document opened already finished, and it stands still.
const PRESSED_WITHIN = 8_000

/// Whether a change this tab made has just succeeded. The stamp cannot tell
/// which change finished ITS document, and does not need to: the one stamp that
/// appears straight after Cancel, Close short or Accept is that change's. A
/// change that runs by itself and can finish nothing (a sign-in, seeing MD's
/// changes) says so with `meta: { finishesNothing: true }` and is not counted,
/// or entering Operations would press every cancelled card on the board.
function pressedJustNow(client: QueryClient): boolean {
  const now = Date.now()
  return client
    .getMutationCache()
    .getAll()
    .some(
      (one) =>
        one.state.status === "success" &&
        one.meta?.finishesNothing !== true &&
        now - one.state.submittedAt < PRESSED_WITHIN
    )
}

export function DocStamp({
  word,
  at,
  note,
  tone,
  className,
}: {
  word: string
  /// A short line under the day, in the stamp's own ink — a cancel's reason.
  note?: string | null
  /// The day it was done; the stamp still stands without one.
  at: string | null | undefined
  tone: keyof typeof TONE
  className?: string
}) {
  const client = useQueryClient()
  // Decided once, when the stamp first appears: the press is news then, and a
  // poll redrawing the document later must not press it again.
  const [land] = useState(() => pressedJustNow(client))
  return (
    <span
      aria-hidden
      className={cn(
        STAMP,
        "absolute top-0 right-2 z-10 text-[1.125rem] leading-6",
        TONE[tone],
        land && "stamp-land",
        className
      )}
    >
      {word}
      {at && (
        <span className="block text-[0.9375rem] leading-5 tabular-nums">
          {dayMonth(at)}
        </span>
      )}
      {note && (
        <span className="block max-w-56 text-[0.9375rem] leading-5 font-medium normal-case">
          {note}
        </span>
      )}
    </span>
  )
}
