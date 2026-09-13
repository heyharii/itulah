import NumberFlow from "@number-flow/react"

import { cn } from "@/lib/cn"

/// A money figure that MOVES to its new value instead of replacing it.
///
/// ## Why animate a number at all
///
/// Because on this screen a figure changes for a reason, and the reason is
/// invisible. A total that is Rp 4.549.546.000 and then, after a tick of a
/// filter, is Rp 918.000.000 has told you nothing about the relationship
/// between the two — it is simply a different string in the same place. Rolled,
/// the digits that stayed put stay put and the ones that changed are the ones
/// that move, so the change is legible as a change.
///
/// It also answers a question a paged list keeps raising: "did that actually
/// refetch, or am I looking at the old answer?" A number that rolls has
/// answered.
///
/// ## Where it is NOT used
///
/// In table CELLS. Forty rows of rolling digits is a slot machine, and the
/// figures in a list are read by comparing them down the column — which is
/// exactly what movement interrupts. This is for the FEW figures that summarise
/// many rows: a summary line, a KPI, a sheet's headline balance. If a number is
/// one of hundreds on screen, it is text.
///
/// ## Rupiah, not `Intl` inside the component
///
/// The format lives in `lib/format.ts` and is passed as options, so a figure
/// here and a figure in a cell cannot drift into two different groupings — see
/// the note there about `id-ID` staying Indonesian while the interface is
/// English.
export function Figure({
  value,
  className,
  unit = true,
}: {
  /// Whole rupiah — the server's `*_minor`, which for IDR is already whole.
  /// See `lib/format.ts`; there is no division by 100 anywhere.
  value: number
  className?: string
  /// `false` for a column that has already said `Rp` in its heading.
  unit?: boolean
}) {
  return (
    <NumberFlow
      value={value}
      locales="id-ID"
      format={
        unit
          ? { style: "currency", currency: "IDR", maximumFractionDigits: 0 }
          : { maximumFractionDigits: 0 }
      }
      // The same curve and band as everything else that settles in this app,
      // read off the design tokens rather than restated — see `--ease` and
      // `--t-panel` in `styles/index.css`.
      transformTiming={{
        duration: 420,
        easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      }}
      // A digit that is being replaced rather than moved fades; it does not
      // spin through ten values on the way. Spinning reads as a counter
      // counting, which is a claim about work happening that is not true here.
      spinTiming={{ duration: 420, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      opacityTiming={{ duration: 180, easing: "ease-out" }}
      // Somebody who has asked not to be moved gets the number, immediately.
      respectMotionPreference
      className={cn("tabular-nums", className)}
    />
  )
}
