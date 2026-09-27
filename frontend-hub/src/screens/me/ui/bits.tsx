import { Card, CardHeader, CardTitle } from "@/screens/me/ui/card"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { isUnbound } from "@/screens/me/data/api"

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
    <Card className={className}>
      {title !== undefined && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {action}
        </CardHeader>
      )}
      <div
        className={cn(
          "flex flex-col gap-3 px-4 pb-4",
          title === undefined && "pt-4"
        )}
      >
        {children}
      </div>
    </Card>
  )
}

/// Items separated by a hairline, without a separator element between each.
export function List({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col divide-y divide-hairline [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0",
        className
      )}
    >
      {children}
    </div>
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
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-cell">
      <span className="text-body">{label}</span>
      <span className="num font-medium text-ink">{children}</span>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-meta text-body">{children}</p>
}

/// A quiet sentence, not a skeleton: a spinner on a 400ms fetch is a flash.
export function Loading() {
  return <p className="py-6 text-center text-meta text-body">Loading…</p>
}

/// A failure, in the server's own words.
///
/// The API answers a refusal with a sentence written for a person; repeating
/// it is more use than "something went wrong". Anything that is not an
/// `ApiError` never reached the server at all, and says so.
///
/// Except the one refusal that is not about this screen at all: a login with no
/// employment record behind it. The server's sentence for that names the
/// username and reads like a crash; what the person needs is who fixes it.
export function Failure({ error }: { error: unknown }) {
  if (isUnbound(error)) return <Unbound />
  return (
    <p role="alert" className="py-6 text-center text-meta text-bad">
      {error instanceof ApiError
        ? error.message
        : "Could not reach the server."}
    </p>
  )
}

/// This login is not linked to an employee yet — HR's to fix, said as such.
export function Unbound() {
  return (
    <div
      role="status"
      className="rounded-inner bg-warn-bg px-4 py-3 text-cell text-warn-fg"
    >
      <p className="font-medium">
        Your login is not linked to an employee record yet.
      </p>
      <p className="mt-0.5 text-meta">
        There is nothing of yours to show here until HR links it.
      </p>
    </div>
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
