import { Button } from "@/components/ui/button"
import { LeadFigure } from "@/components/ui/lead-card"
import { netOf, signedMoney, type PayLine } from "@/lib/queries/payroll"
import { cn } from "@/lib/utils"
import { money } from "@itulah/contract/money"

/// One person's month — the kit's lead-figure card (`LeadCard`), drawn here
/// because its foot carries TWO acts, "Cancel adjustment" and "Adjust", where
/// the kit's card allows one. Same box, same head, same hairline foot.
///
///   ┌──────────────────────────────────────────────────┐
///   │ Siti Rahma                                    —  │  the person, and
///   │ Cashier · 21 days · late 2× · 0 absent     Total │  their total
///   ├──────────────────────────────────────────────────┤
///   │ Adjustment +Rp 205.000 · Insentif +Rp 150.000 …  │  the shop's lines
///   │                      [Cancel adjustment] [Adjust]│
///   └──────────────────────────────────────────────────┘
///
/// No breakdown of HO's components, and no "take-home": the total is the one
/// figure, and it is HO's. Until the centre relays it (`total` is `null`) the
/// figure is a dash, said as one.
export function PayCard({
  title,
  line,
  total,
  lines,
  editable,
  cancelled,
  flash,
  busy,
  problem,
  onAdjust,
  onCancel,
  onUndo,
}: {
  title: React.ReactNode
  /// Role and the month's facts, one grey line.
  line: React.ReactNode
  total: number | null
  lines: readonly PayLine[]
  /// The month is still the shop's to change.
  editable: boolean
  /// The lines were just cancelled from this card: it says so, and offers
  /// them back where "Cancel adjustment" was.
  cancelled: boolean
  /// Lit for a moment after a save, so the eye finds the card that changed.
  flash: boolean
  /// A cancel or an undo is on its way.
  busy: "cancel" | "undo" | null
  /// The centre's refusal of this card's cancel or undo, said on the card it
  /// happened to.
  problem: string | null
  onAdjust: () => void
  onCancel: () => void
  onUndo: () => void
}) {
  const hasFoot =
    editable || lines.length > 0 || cancelled || problem !== null
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-card border border-hairline shadow-soft transition-colors ease-(--ease-out)",
        // In at once, out slowly: the wash is the answer to the save, and it
        // fades rather than blinks.
        flash ? "bg-accent-bg duration-0" : "bg-canvas duration-700",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="line-clamp-2 text-card-title font-semibold break-words text-ink">
            {title}
          </h3>
          <p className="text-[0.875rem] text-body tabular-nums">{line}</p>
        </div>
        <div className="shrink-0">
          {total === null ? (
            <LeadFigure value="—" caption="Total" muted />
          ) : (
            <LeadFigure value={money(total)} />
          )}
        </div>
      </div>
      {hasFoot && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-b-card border-t border-hairline px-4 py-3">
          {(cancelled || lines.length > 0) && (
            <p className="min-w-0 flex-1 basis-56 text-[0.875rem] text-mute tabular-nums">
              {cancelled ? "Adjustment cancelled" : <Lines lines={lines} />}
            </p>
          )}
          {editable && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {cancelled ? (
                <Button
                  variant="quiet"
                  size="card"
                  pending={busy === "undo"}
                  onClick={onUndo}
                >
                  {busy === "undo" ? "Undoing…" : "Undo"}
                </Button>
              ) : (
                lines.length > 0 && (
                  <Button
                    variant="quiet"
                    size="card"
                    pending={busy === "cancel"}
                    onClick={onCancel}
                  >
                    {busy === "cancel" ? "Cancelling…" : "Cancel adjustment"}
                  </Button>
                )
              )}
              <Button
                variant="tint"
                size="card"
                disabled={busy !== null}
                onClick={onAdjust}
              >
                Adjust
              </Button>
            </div>
          )}
          {problem !== null && (
            <p role="alert" className="basis-full text-[0.875rem] text-bad-fg">
              {problem}
            </p>
          )}
        </div>
      )}
    </article>
  )
}

/// "Adjustment +Rp 205.000 · Insentif penjualan +Rp 150.000 · Selisih kas
/// −Rp 45.000" — the net first, then each line in the shop's own words.
function Lines({ lines }: { lines: readonly PayLine[] }) {
  if (lines.length === 0) return null
  const net = netOf(lines)
  return (
    <>
      Adjustment{" "}
      <Signed value={net} className="font-semibold" />
      {lines.map((one) => (
        <span key={one.id}>
          {" · "}
          {one.name}{" "}
          <Signed value={one.sign * one.amountMinor} />
        </span>
      ))}
    </>
  )
}

/// A signed amount in its colour: green added, red taken off.
function Signed({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap",
        value > 0 ? "text-ok-fg" : value < 0 ? "text-bad-fg" : "text-body",
        className,
      )}
    >
      {signedMoney(value)}
    </span>
  )
}
