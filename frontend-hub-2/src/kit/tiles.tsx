import { Figure } from "@/kit/figure"
import { cn } from "@/lib/cn"

/// The summary row above a list.
///
/// ## What a tile is FOR, and the rule that keeps it honest
///
/// A tile answers a question the list below cannot answer by being read. "How
/// much is overdue" is not visible in four hundred rows; it is the reason the
/// screen was opened. A tile that merely repeats something already legible —
/// the row count above a list that says its count in the footer — is spending
/// the most valuable band on the page saying nothing.
///
/// So: **at most five, and each one is a decision somebody makes.** Beyond that
/// they stop being read; a wall of eight figures is scanned as a texture.
///
/// ## The note under the figure is not decoration
///
/// It carries the scope. A figure with no scope is a number somebody will quote
/// in a meeting with the wrong period attached — `Rp 70.000.000` means nothing
/// until it says *across 8 open bills, as at 11 Sep*. This is the same argument
/// as `kit/scope.tsx`, one level down.
export function Tiles({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line grid shrink-0 grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-5">
      {children}
    </div>
  )
}

export function Tile({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string
  /// A number gets rolled by `Figure`; anything else is drawn as given.
  ///
  /// Rolled only HERE and never in a table cell — forty rolling rows is a slot
  /// machine, and figures in a list are read by comparing down the column,
  /// which is exactly what movement interrupts. See `kit/figure.tsx`.
  value: number | React.ReactNode
  note?: React.ReactNode
  tone?: "ok" | "bad" | "warn"
  /// Makes the tile a filter. A figure somebody can press is a figure they can
  /// ask about — "which eight bills" is the next question every time.
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="text-label text-ink-3 block">{label}</span>
      <span
        className={cn(
          "text-metric mt-0.5 block font-semibold tabular-nums",
          tone === "ok" && "text-ok-ink",
          tone === "bad" && "text-bad-ink",
          tone === "warn" && "text-warn-ink",
        )}
      >
        {typeof value === "number" ? <Figure value={value} /> : value}
      </span>
      {note && (
        <span className="text-meta text-ink-4 mt-0.5 block">{note}</span>
      )}
    </>
  )

  if (!onClick) {
    return (
      <div className="border-line border-r px-4 py-2.5 last:border-r-0">
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line hover:bg-hover border-r px-4 py-2.5 text-left transition-colors last:border-r-0"
    >
      {body}
    </button>
  )
}
