import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"

/// The small pieces every screen here is made of.
///
/// A section, a labelled value, an empty state, a wait and a failure. They are
/// together in one file because they are the same decision repeated: on a
/// phone this app is a stack of short lists, and a screen that invented its
/// own spacing for each would read as five apps.

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card size="sm" className={cn("gap-3", className)}>
      {title !== undefined && (
        <CardHeader className="flex flex-row items-center gap-2">
          <CardTitle className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </CardTitle>
          {action !== undefined && <div className="ml-auto">{action}</div>}
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

/// A label and its value, side by side until the value is too long for a phone
/// to hold both on one line — hence `flex-wrap` and a value that is allowed to
/// take the whole width rather than being truncated. A masked bank account cut
/// off at the ellipsis would defeat the point of showing it.
export function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-medium">{children}</span>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  )
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  )
}

/// A failure, in the server's own words.
///
/// The API answers a refusal with a sentence written for a person; repeating
/// it is more use than "something went wrong". Anything that is not an
/// `ApiError` never reached the server at all, and says so.
export function Failure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="py-6 text-center text-[13px] text-destructive">
      {error instanceof ApiError
        ? error.message
        : "Could not reach the server."}
    </p>
  )
}

/// The three states of a list, in the order they happen.
///
/// Every screen here does this, and doing it by hand each time is how one of
/// them ends up rendering an empty list while a request is still in flight.
export function Async<T>({
  query,
  empty,
  children,
}: {
  query: {
    isPending: boolean
    error: unknown
    data: T | undefined
  }
  empty?: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  if (query.isPending) {
    return <Loading />
  }
  if (query.error !== null && query.error !== undefined) {
    return <Failure error={query.error} />
  }
  if (query.data === undefined) {
    return <Failure error={undefined} />
  }
  if (Array.isArray(query.data) && query.data.length === 0 && empty) {
    return <Empty>{empty}</Empty>
  }
  return <>{children(query.data)}</>
}
