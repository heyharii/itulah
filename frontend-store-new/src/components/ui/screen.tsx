import { useRouterState } from "@tanstack/react-router"

import { PageHeader } from "@/components/ui/page-header"
import { titleForPath } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// What a screen must leave clear at its foot, so the last card is not hidden
/// behind something fixed over it.
///
///  - `tabs` — nothing floats over the page; the hub's gutter is enough.
///  - `both` — a `FloatingBar` summary sits over the foot of the page.
///  - `none` — the screen owns its foot (an `ActionBar` below it).
///
/// The phone's bottom bar is not in this list: the shell pads its scroll area
/// clear of it, so no screen has to know it is there.
const CLEARANCE = {
  tabs: "pb-10 md:pb-14",
  both: "pb-[calc(9rem+env(safe-area-inset-bottom,0px))]",
  none: "pb-6",
} as const

/// The scrolling body of a screen — the hub's `PageContent` measure and
/// gutters (`frontend-hub/src/components/shell/app-shell.tsx`), with the page's
/// title drawn by the hub's `PageHeader` on a desk.
///
/// It scrolls itself rather than leaning on the shell's scroll area, because
/// the screens that are *worked* rather than read keep something fixed under
/// the column — the basket's total, the payment button — as a sibling after
/// it, and that sibling only stays put when this box is the one that moves.
///
/// The header is desk-only: on a phone the bar already says the screen's name
/// in the same words, and a second copy directly under it is a line of
/// nothing on a 375px screen.
export function Screen({
  foot = "tabs",
  counter = false,
  header = true,
  title,
  sub,
  actions,
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  foot?: keyof typeof CLEARANCE
  /// Let this screen use the whole counter monitor instead of the reading
  /// measure. The till and the payment step are worked, not read: a basket in
  /// a 960px strip down the middle of a 1440px monitor is a basket somebody
  /// scrolls while a customer waits.
  counter?: boolean
  /// `false` for a screen that draws its own heading — a product's card, whose
  /// title is the product rather than the word "Product".
  header?: boolean
  /// Overrides the nav entry's label as the page title.
  title?: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto", CLEARANCE[foot])}
      {...props}
    >
      <div
        className={cn(
          "mx-auto w-full px-4 pt-4 md:px-[1.875rem] md:pt-6",
          counter ? "max-w-[100rem]" : "max-w-[72rem]",
          className,
        )}
      >
        {header && (
          <PageHeader
            className="max-md:hidden"
            title={title ?? titleForPath(pathname)}
            sub={sub}
            actions={actions}
          />
        )}
        {children}
      </div>
    </div>
  )
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("mb-5", className)}>
      {(title !== undefined || action !== undefined) && (
        <div className="mb-2.5 flex min-h-6 items-center justify-between gap-3">
          {title !== undefined ? (
            <h2 className="text-section font-semibold text-ink">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/// Records one under the other, the gap a card list uses everywhere.
export function CardList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2.5", className)} {...props} />
}

/// A summary that floats over the foot of the page — the basket's running
/// total while more is scanned. Over the phone's bottom bar there, level with
/// the page's own foot on a desk.
export function FloatingBar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-20",
        "md:sticky md:inset-x-auto md:bottom-4 md:mx-auto md:w-full md:max-w-[72rem] md:px-[1.875rem]",
        className,
      )}
    >
      <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-float">
        {children}
      </div>
    </div>
  )
}

/// The one action a screen ends on, pinned under its column.
export function ActionBar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "pb-safe sticky bottom-0 z-20 shrink-0 border-t border-hairline bg-canvas px-4 pt-3 md:px-[1.875rem]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-[72rem] pb-3">{children}</div>
    </div>
  )
}
