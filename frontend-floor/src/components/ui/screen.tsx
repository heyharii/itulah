import { cn } from "@/lib/utils"

/// What a screen must leave clear at its foot, so the last card fades under the
/// furniture as a scroll cue rather than being hidden behind it.
///
///  - `tabs` — the floating squircles and their 18px float.
///  - `both` — the squircles *and* a floating summary bar above them.
///  - `none` — a pushed screen, which has neither; it owns its own foot.
const CLEARANCE = {
  // Written against the home indicator, not beside it. `FloatingBar` and
  // `TabBar` both offset themselves by `env(safe-area-inset-bottom)`, so a
  // fixed padding here is short by exactly that inset on every phone that has
  // one — and what gets clipped is the last card's controls, under an opaque
  // bar, where they cannot be tapped.
  tabs: "pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))]",
  both: "pb-[calc(16rem+env(safe-area-inset-bottom,0px))]",
  none: "pb-6",
} as const

/// The scrolling body of a screen.
///
/// The page never scrolls; this does. That is what keeps the app-bar pinned and
/// the tab bar floating instead of both being dragged up the screen by a rubber
/// band.
export function Screen({
  foot = "tabs",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  foot?: keyof typeof CLEARANCE
}) {
  return (
    <div
      className={cn(
        // 16px side gutters, matching the frames. The list runs to the edges of
        // that gutter and no further; nothing here is inset twice.
        "min-h-0 flex-1 overflow-y-auto px-4",
        // On a counter screen the column stops growing. DESIGN.md caps the
        // content column and centres it; without that a two-field form is
        // 1440px of white with a hairline somewhere in the middle, which is
        // what a phone layout looks like when nobody stopped it.
        "md:mx-auto md:w-full md:max-w-[60rem] md:px-7",
        CLEARANCE[foot],
        className,
      )}
      {...props}
    />
  )
}

/// A titled group inside a screen. Whitespace separates; one hairline divides;
/// nothing gets a box around it just for being a group.
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
            <h2 className="text-section font-medium text-mute">{title}</h2>
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

/// A stack of record cards — the one list grammar this app has.
export function CardList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2.5", className)} {...props} />
}

/// The summary-and-action card that floats over a top-level screen.
///
/// This is DESIGN.md's **floating card** — all corners rounded at `{r.sheet}`,
/// ~16px side margins, clear of the home indicator, no drag handle — used for
/// what a phone-shaped till needs at the foot of a basket: the number, and the
/// one black button.
///
/// It floats rather than being a sticky opaque bar because the tab bar is
/// already down there, and two full-width bars stacked at the foot of a phone
/// is the shape this language spent its whole responsive section avoiding. A
/// card above the squircles reads as one system; a bar above them reads as two.
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
        // 54px squircle + its 18px float + 12px of air, then the home indicator.
        "fixed inset-x-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] z-40",
        "overflow-hidden rounded-sheet border border-hairline bg-canvas shadow-float",
        className,
      )}
    >
      {children}
    </div>
  )
}

/// The foot of a **pushed** screen, where there is no tab bar to make room for.
///
/// Opaque rather than a fade, because what sits above it is a number somebody
/// is about to take money against, and a gradient over that is unreadable.
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
        "pb-safe sticky bottom-0 z-20 shrink-0 border-t border-hairline bg-canvas px-4 pt-3",
        className,
      )}
    >
      {/* Capped to the same measure as `Screen`, so the one action lines up
          with the column above it instead of stretching the full width of a
          counter monitor. */}
      <div className="mx-auto w-full max-w-[60rem] pb-3 md:px-3">{children}</div>
    </div>
  )
}
