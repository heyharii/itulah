import { Link } from "@tanstack/react-router"

import { Async, Panel } from "@/components/bits"
import { cn } from "@/lib/utils"
import { dateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/hr/queries"

/// What happened while you were on the floor.
///
/// Reading one marks it read and takes you where it points, because a
/// notification is a signpost and not a document: leaving somebody on this
/// screen after they tapped "your payslip is ready" would make them go and
/// find it themselves. One that points nowhere in this app is still marked
/// read on a tap — otherwise the badge could never be cleared.
export function Notifications() {
  const notifications = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const unread = notifications.data?.unread ?? 0

  return (
    <Panel
      title="Recent"
      action={
        unread > 0 && (
          <Button
            size="sm"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        )
      }
    >
      <Async
        query={{
          isPending: notifications.isPending,
          error: notifications.error,
          data: notifications.data?.items,
        }}
        empty="Nothing has happened yet."
      >
        {(list) => (
          <div className="-mx-2 flex flex-col divide-y divide-hairline">
            {list.map((item) => {
              const unread = item.read_at === null
              const body = (
                <div className="flex items-start gap-3">
                  {/* A dot, not a bold row: the difference has to survive
                      being read at arm's length in a stockroom. */}
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      unread ? "bg-accent" : "bg-hairline-2"
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-cell text-ink",
                        unread ? "font-semibold" : "font-medium"
                      )}
                    >
                      {item.subject}
                    </p>
                    <p className="text-cell text-body">{item.body}</p>
                    <p className="mt-0.5 text-meta text-mute">
                      {dateTime(item.created_at)}
                      {unread && " · unread"}
                    </p>
                  </div>
                </div>
              )
              const read = () => {
                if (unread) markRead.mutate(item.notification_id)
              }
              return (
                <div key={item.notification_id}>
                  {item.link === null ? (
                    <button
                      type="button"
                      onClick={read}
                      className="block w-full rounded-inner px-2 py-3 text-left transition-colors hover:bg-soft-2"
                    >
                      {body}
                    </button>
                  ) : (
                    <Link
                      to={item.link}
                      onClick={read}
                      className="block rounded-inner px-2 py-3 transition-colors hover:bg-soft-2"
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
