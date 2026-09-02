import { cn } from "@/lib/utils"

/// The frame every screen sits in: a 58px icon rail, an optional 248px
/// sidebar on `{soft}`, and a scrolling `{soft}` well — matching
/// `inventory-prototype.html`. Cards float white on that well. There is no
/// wrapping dashboard card; that chrome is what made this still read as shadcn.
///
/// The rail carries two different things and keeps them apart on purpose —
/// where you are (the nav, fixed) above what you are looking at (the facets,
/// which belong to the screen and change with it). A screen with nothing to
/// facet simply passes none, and the rail is just the nav.
///
/// `section` is the third possibility, and it is deliberately exclusive with
/// the facets rather than additional to them. Finance has ten groups and needs
/// a standing list of them; buying screens have filters. A layout that could
/// show both would be four columns on a laptop, which leaves the table — the
/// thing anybody actually came to read — about as wide as a phone. So a screen
/// picks one, and finance screens put their filters in a sheet from the header.
export function AppShell({
  nav,
  section,
  facets,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  nav: React.ReactNode
  /// A standing sub-navigation for a whole area of the app.
  section?: React.ReactNode
  facets?: React.ReactNode
  children: React.ReactNode
}) {
  const aside = section ?? facets
  return (
    <div
      {...props}
      data-cloudhub=""
      className={cn(
        "grid min-h-0 flex-1 grid-cols-1 bg-[var(--os-canvas,#fff)]",
        aside === undefined
          ? "lg:grid-cols-[58px_minmax(0,1fr)]"
          : "lg:grid-cols-[58px_248px_minmax(0,1fr)]",
        className,
      )}
    >
      {/* `os-rail` is not paint — it names this element for the page
          transition, which is how the rail stays put while the screen beside
          it changes. The one part of the frame that is the same on every
          screen should not be part of what fades. See `index.css`. */}
      <aside className="os-rail hidden shrink-0 flex-col items-center overflow-y-auto border-r border-[var(--os-hairline,#eeeef1)] bg-[var(--os-canvas,#fff)] lg:flex">
        {nav}
      </aside>
      {aside !== undefined && (
        <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-r border-[var(--os-hairline,#eeeef1)] bg-[var(--os-soft,#f7f7f8)] lg:flex">
          <div className="min-h-0 flex-1 overflow-y-auto px-[0.6875rem] py-[0.8125rem]">
            {aside}
          </div>
        </aside>
      )}
      <main className="flex min-h-0 min-w-0 flex-col overflow-auto bg-[var(--os-soft,#f7f7f8)]">
        <div className="mx-auto flex w-full max-w-[77.5rem] flex-1 flex-col px-[1.875rem] pt-6 pb-14">
          {children}
        </div>
      </main>
    </div>
  )
}

/// The page header in flow on the well — crumb, title, sub, pill actions.
/// Not a strip inside a card: `inventory-prototype.html` `.phead`.
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  children,
  className,
}: {
  /// The area this screen belongs to. Optional: a screen that is its own area
  /// does not need to say so twice.
  eyebrow?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-os-header=""
      className={cn(
        "mb-4 flex shrink-0 items-start justify-between gap-[1.125rem]",
        className,
      )}
    >
      {/* Sizes in rem, not px: the 0.9 density is baked into the root font
          size, so rem-based type lands exactly where the prototype's zoomed
          type lands. Written as px here, this header was the one thing on the
          screen that did not scale with everything else. */}
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="mb-[0.3125rem] truncate text-[0.75rem] font-medium text-[var(--os-mute,#a6a6ad)]">
            {eyebrow}
          </p>
        )}
        <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-[-0.022em] text-[var(--os-ink,#1d1d1f)]">
          {title}
        </h1>
        {subtitle !== undefined && (
          <p className="mt-[0.1875rem] truncate text-[0.8125rem] text-[var(--os-body,#74747b)]">
            {subtitle}
          </p>
        )}
      </div>
      {children !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-[0.4375rem] pt-[0.1875rem]">
          {children}
        </div>
      )}
    </div>
  )
}

/// A white hairline card floating on the `{soft}` well. Tables and lists live
/// in one of these; merch tiles *are* these, and do not need another wrap.
export function ScreenCard({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("os-card min-h-0 overflow-hidden", className)}
      {...props}
    >
      {children}
    </div>
  )
}

/// The scrolling body under a page header. Defaults to a floating card so
/// every menu's list sits on the well the same way inventory's `.tblcard` does.
/// Pass `card={false}` when the children are already cards (sourcing grid).
export function ScreenBody({
  card = true,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  card?: boolean
}) {
  if (!card) {
    return (
      <div className={cn("min-h-0 flex-1", className)} {...props}>
        {children}
      </div>
    )
  }
  return (
    <ScreenCard className={cn("min-h-0 flex-1 overflow-auto", className)} {...props}>
      {children}
    </ScreenCard>
  )
}

/// Nothing to show, said in a way that distinguishes the three reasons for it:
/// still loading, refused, or genuinely empty.
///
/// Quiet body copy on the well — never a grey empty-state illustration, never
/// an amber "something might be wrong". A problem is `{bad}` text plus a pill
/// action; loading is the same quiet sentence with no spinner, because a
/// spinner on a 400ms fetch is a flash and a spinner on a hang is a lie that
/// something is still happening.
export function ScreenState({
  tone = "quiet",
  children,
  action,
}: {
  tone?: "quiet" | "problem"
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-60 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p
        className={cn(
          "max-w-[28em] text-[0.78125rem] leading-relaxed font-normal",
          tone === "problem"
            ? "text-[var(--os-bad,#d05151)]"
            : "text-[var(--os-body,#74747b)]",
        )}
      >
        {children}
      </p>
      {action}
    </div>
  )
}

/// An in-page notice that is not a toast and not a dialog: the page stays,
/// the fact sits under the header as a tinted strip.
export function ScreenBanner({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: "ok" | "warn" | "bad" | "info"
  children: React.ReactNode
  onDismiss?: () => void
}) {
  const paint = {
    ok: "bg-[var(--os-ok-bg,#eaf5ee)] text-[var(--os-ok,#2e9e5b)]",
    warn: "bg-[var(--os-warn-bg,#f8f1de)] text-[var(--os-warn,#b7791f)]",
    bad: "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)]",
    info: "bg-[var(--os-info-bg,#ddebfa)] text-[var(--os-info,#2f86d8)]",
  }[tone]
  return (
    <div
      role={tone === "bad" || tone === "warn" ? "alert" : "status"}
      className={cn(
        "mb-3.5 flex items-start gap-2 rounded-[var(--os-r-inner,9px)] px-3.5 py-2 text-[0.71875rem]",
        paint,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss !== undefined && (
        <button type="button" onClick={onDismiss} className="ml-auto shrink-0 underline">
          Dismiss
        </button>
      )}
    </div>
  )
}
