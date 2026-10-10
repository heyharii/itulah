import type { LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { CardTableHead as CardHead } from "@/components/ui/card-table"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

/// The pieces the Money screens share — Sales, Reconciliation, Expenses, Cash
/// count and Reports — in the template's grammar (`screens/catalogue.tsx`):
/// nothing on a phone but the title and the figures, every choice in the dock,
/// records as lead-figure cards; on a desk the hub's table where a table is the
/// right shape.
///
/// Kept in the module rather than in `components/ui/` because every piece here
/// knows something about money on this node — which tenders exist, how a day is
/// spelled, which way a difference points — and a primitive that knew that
/// would stop being a primitive.

// ── The frame ───────────────────────────────────────────────────────────────

/// A Money screen's frame: the hub's `PageHeader` on a desk (with its actions),
/// and on a phone nothing but the page — the title is the top bar's, the
/// choices are the dock's, and the one thing the screen makes is a `Fab`.
///
/// The module's other screens are not drawn across the top of a phone: a strip
/// of five chips scrolled sideways, and nothing scrolls sideways there. They
/// are in the navigation drawer (More), and on a desk in the sidebar.
export function MoneyScreen({
  actions,
  children,
}: {
  /// The desk's header actions. A phone has no header: it puts these in the
  /// dock (`Fab`, or the ⚙ sheet's `actions`).
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return <Screen actions={actions}>{children}</Screen>
}

/// The desk's row of controls above a list. A phone has none: every one of them
/// is a dock chip or a row of the ⚙ sheet there (`DockTools`).
export function DeskBar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 max-md:hidden",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// Which span a screen covers — the hub's compact segmented control on a desk
/// with a mouse, the touch floor anywhere a finger is.
export function SpanPicker<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { readonly value: T; readonly label: React.ReactNode }[]
  value: T
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <Segmented<T>
      options={options}
      value={value}
      onChange={onChange}
      className={cn(
        "md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8",
        className,
      )}
    />
  )
}

/// The three spans Expenses and Reports offer, and the one the URL carries when
/// it is none of them — `?span=90` carried over from Sales is still the span
/// on screen, and the control names it rather than showing nothing chosen.
export const SPANS = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const

export function spanChoices(current: string): readonly {
  readonly value: string
  readonly label: string
}[] {
  if (SPANS.some((one) => one.value === current)) return SPANS
  return [...SPANS, { value: current, label: `${current} days` }]
}

// ── Lists ───────────────────────────────────────────────────────────────────

/// The money screens' names for the kit's card-and-table list.
export {
  CardTable as Rows,
  CardTableHead as CardHead,
} from "@/components/ui/card-table"

/// A chart in a card, with the numbers that read it written under it — never
/// the chart alone. The chart is as wide as the card on every screen (the
/// container measures it); `note` is the sentence a figure needs ("Busiest:
/// Tue 06 Oct 2026 · Rp 1.200.000").
export function ChartCard({
  title,
  sub,
  aside,
  note,
  children,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  aside?: React.ReactNode
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHead title={title} sub={sub} aside={aside} />
      <div className="px-2 pt-4 pb-2 md:px-4">{children}</div>
      {note !== undefined && (
        <p className="px-4 pb-3.5 text-meta text-body tabular-nums">{note}</p>
      )}
    </Card>
  )
}

/// Two lines in one cell — a name and what it is — with an optional glyph
/// tile on a desk, the way the hub's registers set a thing and its number.
export function TwoLine({
  top,
  under,
  icon: Glyph,
}: {
  top: React.ReactNode
  under?: React.ReactNode
  icon?: LucideIcon
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {Glyph !== undefined && (
        <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body max-md:hidden">
          <Glyph className="size-4 stroke-[1.7]" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{top}</span>
        {under !== undefined && under !== null && under !== "" && (
          <span className="block truncate text-meta text-mute">{under}</span>
        )}
      </span>
    </span>
  )
}

// ── Inside a sheet ──────────────────────────────────────────────────────────

/// A titled block inside a sheet: the facts grid says what the record is, a
/// section says what it holds.
export function SheetSection({
  title,
  aside,
  children,
}: {
  title: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-card-title font-semibold text-ink">{title}</h3>
        {aside !== undefined && (
          <span className="text-meta text-mute tabular-nums">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}
