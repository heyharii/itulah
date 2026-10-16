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
  return (
    <span
      aria-hidden
      className={cn(
        STAMP,
        "absolute top-0 right-2 z-10 text-[1.125rem] leading-6",
        TONE[tone],
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
