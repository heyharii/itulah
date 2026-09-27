import { cn } from "@/lib/utils"

/// Two panels side by side: what was expected, and what was found.
///
/// The prototype's `.alloc`, and the shape of the two moments in this
/// warehouse where a number is checked against another number — a verifier
/// reading a blind count against a purchase order, and an RFID sweep read
/// against a box's fixed target.
///
/// It is a component rather than a grid written twice because the thing that
/// matters is what happens **between** the columns: the difference. A pair of
/// lists laid out separately lets a screen show two totals and leave the
/// subtraction to the reader, which is exactly the mistake — DESIGN.md's rule
/// is to show the proof and surface only the discrepancy.
///
/// On a narrow screen the two panels stack and the divider becomes a rule, so
/// the comparison survives a handheld rather than scrolling sideways.
export function Allocation({
  left,
  right,
  className,
  children,
}: {
  left: { readonly label: React.ReactNode; readonly total?: React.ReactNode }
  right: { readonly label: React.ReactNode; readonly total?: React.ReactNode }
  className?: string
  /// `<AllocationRow>`s. They span both columns, so a SKU's expected and found
  /// numbers sit on one line and can be read across.
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-inner border border-hairline",
        className
      )}
    >
      <div className="grid grid-cols-2 border-b border-hairline bg-soft">
        <Head {...left} />
        <Head {...right} className="border-l border-hairline" />
      </div>
      <div>{children}</div>
    </div>
  )
}

function Head({
  label,
  total,
  className,
}: {
  label: React.ReactNode
  total?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-3.5 py-2 text-eyebrow font-semibold text-mute uppercase",
        className
      )}
    >
      <span className="truncate">{label}</span>
      {total !== undefined && (
        <span className="shrink-0 text-ink tabular-nums">{total}</span>
      )}
    </div>
  )
}

/// One thing counted twice.
///
/// The difference is the point, so it is the emphasised value and it carries
/// the tone: `{ok}` when the two agree, `{bad}` when they do not. Nothing
/// here is `{warn}` — a variance is not a delay, it is a disagreement, and
/// amber would say the warehouse should wait rather than look.
export function AllocationRow({
  name,
  sub,
  expected,
  found,
  difference,
  action,
}: {
  name: React.ReactNode
  sub?: React.ReactNode
  expected: React.ReactNode
  found: React.ReactNode
  /// Absent while nothing has been found yet — a line not swept is not a line
  /// that disagrees.
  difference?: { readonly value: React.ReactNode; readonly agrees: boolean }
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-tap flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-3.5 py-2 last:border-b-0">
      <span className="min-w-[8rem] flex-1">
        <span className="block truncate font-mono text-id text-ink">
          {name}
        </span>
        {sub && (
          <span className="block truncate text-[0.875rem] text-mute">
            {sub}
          </span>
        )}
      </span>
      <span className="w-14 shrink-0 text-right text-[0.875rem] text-body tabular-nums">
        {expected}
      </span>
      <span className="w-14 shrink-0 text-right text-[0.875rem] font-medium text-ink tabular-nums">
        {found}
      </span>
      {difference && (
        <span
          className={cn(
            "w-16 shrink-0 text-right text-[0.875rem] font-semibold tabular-nums",
            difference.agrees ? "text-ok-fg" : "text-bad-fg"
          )}
        >
          {difference.value}
        </span>
      )}
      {action}
    </div>
  )
}
