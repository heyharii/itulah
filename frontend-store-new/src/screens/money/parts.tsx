import { useRouterState } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"
import { useEffect, useRef } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { allModules, visibleSections } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { growth, growthLabel } from "@itulah/contract/reporting"

/// The pieces the four Money screens share — Sales, Reconciliation, Expenses
/// and Reports — drawn in the hub's grammar (`frontend-hub/src/screens/sales/`
/// and `finance-final/`): a page header on a desk, a toolbar of compact
/// controls, figures in a stat strip, lists in a card with a head band.
///
/// Kept in the module rather than in `components/ui/` because every piece here
/// knows something about money on this node — which tenders exist, how a day is
/// spelled, which way a difference points — and a primitive that knew that
/// would stop being a primitive.

// ── The frame ───────────────────────────────────────────────────────────────

/// A Money screen's frame: the hub's `PageHeader` on a desk, and on a phone the
/// module's own screens as a strip with the screen's actions under it.
///
/// The header is desk-only (`Screen` hides it under `md`), so a primary action
/// passed to it alone would not exist on a phone at all. It is drawn a second
/// time below the strip there — the same move `GaScreen` makes.
export function MoneyScreen({
  sub,
  actions,
  children,
}: {
  sub?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Screen sub={sub} actions={actions}>
      <MoneyStrip />
      {actions !== undefined && (
        <div className="mb-4 flex flex-wrap gap-2 md:hidden [&>*]:flex-1">
          {actions}
        </div>
      )}
      {children}
    </Screen>
  )
}

/// Sales, Reconciliation, Expenses and Reports, below `md` only.
///
/// Money is a bottom-bar tab, but the tab lands on Sales and the other three
/// are behind the drawer — three taps to reach a screen that sits beside the
/// one on show. Above `md` the sidebar already lists them, and a second copy
/// would be the duplication the People and GA strips also refuse. Read from
/// the registry, so a screen added to the module appears here by itself.
function MoneyStrip() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const strip = useRef<HTMLElement>(null)
  // Four chips nearly fit a phone; "nearly" is the reason the current one is
  // brought into view rather than assumed to be.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>("[data-status=active]")
      ?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [pathname])

  const module = allModules.find((one) => one.id === "money")
  if (module === undefined) return null
  const items = visibleSections(module).flatMap((section) => section.items)
  return (
    <nav
      ref={strip}
      aria-label="Money"
      className="-mx-4 mb-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 py-1 md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <AppLink
            key={item.path}
            to={item.path}
            className="flex h-11 shrink-0 items-center gap-2 rounded-inner border border-hairline bg-canvas px-3.5 text-nav font-medium text-body shadow-soft data-[status=active]:border-accent/30 data-[status=active]:bg-accent-bg data-[status=active]:font-semibold data-[status=active]:text-accent"
          >
            <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55]" />
            {item.label}
          </AppLink>
        )
      })}
    </nav>
  )
}

/// The row of controls above what they control: the span on the left, what it
/// resolves to on the right. Stacked on a phone.
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
      {children}
    </div>
  )
}

/// Which span a screen covers — the hub's compact segmented control on a desk
/// with a mouse, the 44px touch floor anywhere a finger is.
///
/// The same classes the Promotions and GA filters carry, so every toolbar in
/// the app has one height at one width.
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

/// The band a card opens with: what it is, the span or count it covers, and
/// anything that belongs beside the title — a total, a control.
export function CardHead({
  title,
  sub,
  aside,
  className,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-card-title font-semibold text-ink">{title}</h2>
        {sub !== undefined && (
          <p className="mt-0.5 text-meta text-mute">{sub}</p>
        )}
      </div>
      {aside !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{aside}</div>
      )}
    </div>
  )
}

/// A quiet sentence under a card — the footnote a figure needs to be read
/// right, set where the eye lands after reading it.
export function Note({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn("mt-3 text-meta leading-relaxed text-mute", className)}>
      {children}
    </p>
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

/// The two-column fact grid a record opens with — the hub sheet's `Facts`.
export function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">{children}</dl>
}

export function Fact({
  term,
  wide = false,
  children,
}: {
  term: React.ReactNode
  /// Spans both columns — a reason, a note.
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-meta text-body">{term}</dt>
      <dd
        className={cn(
          "mt-1 text-[0.875rem] leading-[1.375rem] text-ink tabular-nums",
          wide ? "break-words" : "truncate",
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/// A titled block inside a sheet.
export function SheetBlock({
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
          <span className="text-meta text-mute">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}

// ── Figures ─────────────────────────────────────────────────────────────────

/// How a span compares with the one it is measured against — the hub's
/// `Delta` (`frontend-hub/src/screens/sales/delta.tsx`).
///
/// The sign is in the text and in the arrow, never only in the colour, and
/// down is tinted quietly rather than painted as failure: a shop is down
/// against a fortnight with a sale in it, and a screen that shouted at every
/// red number would be shouted past within a week.
export function Delta({
  now,
  before,
  against,
  className,
}: {
  now: number
  before: number
  /// The span being compared against, for the tooltip.
  against?: string
  className?: string
}) {
  const fraction = growth(now, before)
  // Nothing to divide by. "new" says what happened — nothing was sold in the
  // span before — where a percentage would be infinity or a lie.
  if (fraction === null) {
    return (
      <span className={cn("text-pill text-mute", className)}>
        {now > 0 ? "new" : "—"}
      </span>
    )
  }
  const flat = Math.abs(fraction) < 0.005
  return (
    <span
      className={cn(
        "text-pill font-medium whitespace-nowrap tabular-nums",
        flat ? "text-mute" : fraction > 0 ? "text-ok-fg" : "text-bad-fg",
        className,
      )}
      title={`${growthLabel(fraction)} against ${against ?? "the span before"}`}
    >
      <span aria-hidden>{flat ? "→" : fraction > 0 ? "↑" : "↓"}</span>{" "}
      {flat ? "0%" : growthLabel(fraction)}
    </span>
  )
}
