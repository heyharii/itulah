import { cn } from "@/lib/utils"

/// The frame every buying screen sits in: a rail on the left, one card on the
/// right.
///
/// The rail carries two different things and keeps them apart on purpose —
/// where you are (the nav, fixed) above what you are looking at (the facets,
/// which belong to the screen and change with it). A screen with nothing to
/// facet simply passes none, and the rail is just the nav.
export function AppShell({
  nav,
  facets,
  children,
}: {
  nav: React.ReactNode
  facets?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden lg:flex">
        <div className="shrink-0 px-2 pt-2">{nav}</div>
        {facets !== undefined && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4">{facets}</div>
        )}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-2 lg:pl-0">
        <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm">
          {children}
        </div>
      </main>
    </div>
  )
}

/// The 52px strip at the top of the card: what this is, how much of it there
/// is, and the actions that apply to all of it.
export function ScreenHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-13 shrink-0 items-center justify-between gap-3 border-b pr-2.5 pl-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined && (
          <span className="text-muted-foreground shrink-0 font-mono text-[11.5px]">
            {subtitle}
          </span>
        )}
      </div>
      {children !== undefined && (
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      )}
    </div>
  )
}

/// Nothing to show, said in a way that distinguishes the three reasons for it:
/// still loading, refused, or genuinely empty.
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
          "max-w-md text-xs",
          tone === "problem" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
      {action}
    </div>
  )
}
