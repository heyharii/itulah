import { Link } from "@tanstack/react-router"

import { Async, Panel } from "@/components/bits"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { dateTime } from "@/lib/format"
import { useMarkNotificationRead, useNotifications } from "@/lib/hr/queries"

/// The routes a notification is allowed to point at.
///
/// A link arrives from the server, and a server-supplied string handed
/// straight to the router is a link to anywhere — a route this app does not
/// have, or one it does but should not be reachable this way. Matching it
/// against the list of places this screen can legitimately send somebody makes
/// an unknown link inert rather than a navigation.
const destinations = ["/leave", "/overtime", "/pay", "/attendance"] as const

function destination(
  link: string | null
): (typeof destinations)[number] | null {
  return destinations.find((known) => known === link) ?? null
}

/// What happened while you were on the floor.
///
/// Reading one marks it read and takes you where it points, because a
/// notification is a signpost and not a document: leaving somebody on this
/// screen after they tapped "your payslip is ready" would make them go and
/// find it themselves.
export function Notifications() {
  const notifications = useNotifications()
  const markRead = useMarkNotificationRead()

  return (
    <Panel title="Recent">
      <Async query={notifications} empty="Nothing has happened yet.">
        {(list) => (
          <div className="flex flex-col">
            {list.map((item, index) => {
              const unread = item.read_at === null
              const body = (
                <div className="flex items-start gap-3">
                  {/* A dot, not a bold row: the difference has to survive
                      being read at arm's length in a stockroom. */}
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      unread ? "bg-destructive" : "bg-transparent"
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[13px]",
                        unread ? "font-semibold" : "font-medium"
                      )}
                    >
                      {item.subject}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dateTime(item.created_at)}
                      {unread && " · unread"}
                    </p>
                  </div>
                </div>
              )
              const to = destination(item.link)
              return (
                <div key={item.notification_id}>
                  {index > 0 && <Separator className="my-1" />}
                  {to === null ? (
                    <div className="px-2 py-3">{body}</div>
                  ) : (
                    <Link
                      to={to}
                      onClick={() => {
                        if (unread) {
                          markRead.mutate(item.notification_id)
                        }
                      }}
                      className="-mx-2 block rounded-lg px-2 py-3 transition-colors hover:bg-muted/60"
                    >
                      {body}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Async>
    </Panel>
  )
}
