import { Banner } from "@/components/ui/states"
import { problemOf } from "@/lib/problem"
import { cn } from "@/lib/utils"

/// A sheet's three non-record states, written once.
///
/// The 6 Oct 2026 audit found about ninety loading phrases ("Loading…" 21×,
/// "Loading the order…", "Opening the pool…", a bare "…"), empty states that
/// explained the button instead of the emptiness, and read errors drawn at the
/// top, the bottom or not at all. A sheet already shows its id from the URL, so
/// each of these is small and sits at the left where the record will be.

/// "Reading the supplier…" — and one quiet row where the record will be.
/// `what` is the thing in lower case ("supplier", "order", "count").
///
/// Not the screen's centred `LoadingState`: that is a band for a whole page,
/// and in a sheet it left 100px of blank air per section.
export function SheetLoading({
  what,
  className,
}: {
  what: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col gap-3", className)}
    >
      <p className="text-[0.9375rem] text-mute">Reading the {what}…</p>
      <div
        aria-hidden
        className="flex flex-col gap-2.5 motion-safe:animate-pulse"
      >
        <span className="h-3.5 w-2/3 rounded-full bg-soft" />
        <span className="h-3.5 w-1/2 rounded-full bg-soft" />
      </div>
    </div>
  )
}

/// Nothing here: one quiet line, and the action that fixes it. The line says
/// what is missing ("No orders yet"), not how the button works.
export function SheetEmpty({
  children,
  action,
  className,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <p className="text-[0.9375rem] text-mute">{children}</p>
      {action}
    </div>
  )
}

/// A read that failed: the server's sentence in a banner, and Try again.
/// (A failed write is `<Problem>` above the foot — `SheetFooter error`.)
export function SheetError({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  return (
    <Banner tone="bad" className={className}>
      {problemOf(error) ?? "The server could not be reached."}
      {onRetry !== undefined && (
        <>
          {" "}
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </>
      )}
    </Banner>
  )
}

/// `queryState` for a record sheet, as a component: "Reading the {what}…",
/// then a read error with Try again, then the record. A refresh that failed
/// over a record already on screen keeps the record and says so above it.
///
/// ```tsx
/// <SheetQuery query={detail} what="supplier">
///   {(supplier) => <Facts>…</Facts>}
/// </SheetQuery>
/// ```
export function SheetQuery<T>({
  query,
  what,
  children,
}: {
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    data: T | undefined
    refetch: () => unknown
  }
  what: string
  children: (data: T) => React.ReactNode
}) {
  if (query.isPending) return <SheetLoading what={what} />
  if (query.isError && query.data === undefined)
    return (
      <SheetError error={query.error} onRetry={() => void query.refetch()} />
    )
  return (
    <>
      {query.isError && (
        <SheetError
          error={query.error}
          onRetry={() => void query.refetch()}
          className="mb-6"
        />
      )}
      {children(query.data as T)}
    </>
  )
}
