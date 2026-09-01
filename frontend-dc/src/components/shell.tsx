import { Link, useRouterState } from "@tanstack/react-router"

import { DESTINATIONS } from "@/lib/destinations"
import { useOperationCounts, type OperationCounts } from "@/lib/queries"
import { cn } from "@/lib/utils"

function useActivePath(): string {
  return useRouterState({ select: (state) => state.location.pathname })
}

function isActive(path: string, to: string): boolean {
  return to === "/" ? path === "/" : path.startsWith(to)
}

/// The rail, from `md` up. Icons only until `lg`, where the labels fit beside
/// them — a warehouse monitor is wide, a mounted tablet is not.
export function Rail({ counts }: { counts: OperationCounts }) {
  const path = useActivePath()
  return (
    <nav
      aria-label="Operations"
      className="bg-sidebar hidden shrink-0 flex-col gap-1 overflow-y-auto border-r p-2 md:flex md:w-[76px] lg:w-52"
    >
      {DESTINATIONS.map((destination) => {
        const waiting = destination.waiting(counts)
        const on = isActive(path, destination.to)
        const Icon = destination.icon
        return (
          <Link
            key={destination.to}
            to={destination.to}
            className={cn(
              "relative flex min-h-(--tap) items-center gap-3 rounded-xl px-2 text-[13px] font-medium transition-colors",
              "max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:py-2 max-lg:text-[10.5px]",
              on
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-5 shrink-0" />
            <span className="truncate">{destination.label}</span>
            {waiting > 0 && <Badge count={waiting} className="lg:ml-auto lg:static" />}
          </Link>
        )
      })}
    </nav>
  )
}

/// The bottom bar, below `md`. Five destinations, thumb-height, and the safe
/// area under them so the last row is not hidden by a home indicator.
export function TabBar({ counts }: { counts: OperationCounts }) {
  const path = useActivePath()
  const tabs = DESTINATIONS.filter((destination) => destination.onTabBar === true)
  return (
    <nav
      aria-label="Operations"
      className="bg-background/92 fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((destination) => {
        const waiting = destination.waiting(counts)
        const on = isActive(path, destination.to)
        const Icon = destination.icon
        return (
          <Link
            key={destination.to}
            to={destination.to}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium",
              on ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5.5" />
            <span>{destination.label}</span>
            {waiting > 0 && <Badge count={waiting} />}
          </Link>
        )
      })}
    </nav>
  )
}

function Badge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground absolute top-1 right-2 grid h-4 min-w-4 place-items-center rounded-full px-1 font-mono text-[10px] leading-none tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

/// The frame every operations screen sits in.
export function OperationsShell({
  header,
  children,
}: {
  header: React.ReactNode
  children: React.ReactNode
}) {
  const counts = useOperationCounts()
  return (
    <div className="flex min-h-svh flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        <Rail counts={counts} />
        <main className="min-w-0 flex-1 pb-24 md:pb-0">{children}</main>
      </div>
      <TabBar counts={counts} />
    </div>
  )
}

/// The strip at the top of a screen: what this is, how much of it there is,
/// and the actions that apply to the whole of it.
export function ScreenHeader({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h1 className="font-heading truncate text-lg font-medium tracking-tight">
          {title}
        </h1>
        {subtitle !== undefined && (
          <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
        )}
      </div>
      {children !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  )
}

/// The body of a screen: one column on a handheld, two where there is room.
export function ScreenBody({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-4 p-4 sm:p-6", className)}>{children}</div>
  )
}

/// Nothing to show, said in a way that keeps the three reasons apart: still
/// loading, refused, or genuinely empty.
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
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p
        className={cn(
          "max-w-md text-sm",
          tone === "problem" ? "text-destructive" : "text-muted-foreground",
        )}
        role={tone === "problem" ? "alert" : undefined}
      >
        {children}
      </p>
      {action}
    </div>
  )
}

/// A short sentence explaining a rule the server enforces.
///
/// These are not decoration. Every one of them names something that has caught
/// somebody out — a list nobody authors, a quantity deliberately withheld, a
/// box whose contents become final — and the alternative to saying it on the
/// screen is a document nobody reads.
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2.5 text-xs leading-relaxed">
      {children}
    </p>
  )
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  bad: "bg-destructive/12 text-destructive",
} as const

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

/// One number worth reading across the room.
export function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: "good" | "warn" | "bad"
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span
        className={cn(
          "font-mono text-xl leading-none font-medium tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  )
}
