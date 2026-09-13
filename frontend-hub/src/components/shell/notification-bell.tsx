import { Popover } from "@base-ui/react/popover"
import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { recordRoute } from "@/lib/record-route"
import { moment } from "@/lib/format"
import { POPUP, POSITIONER } from "@/lib/filter-chrome"
import { listNotifications, systemKeys } from "@/lib/queries/system"
import { cn } from "@/lib/utils"

/// Work that came looking for somebody, in the one place every screen has.
///
/// # Why the bar and not the module
///
/// `system/notifications.tsx` has drawn this list well for a while, and almost
/// nobody has seen it: it lives in System, beside Access, Nodes and Sync — the
/// module people open once a quarter. A notification that has to be gone
/// looking for is not a notification, it is a report. So the count moves to the
/// one strip that is on screen in every module, and the full list stays exactly
/// where it is.
///
/// # Five, and then the list
///
/// The popup is a glance, not a screen. It answers "is there anything" and
/// "what is the newest", and anything past that is a reading task that belongs
/// on the page with the filters and the facets.
export function NotificationBell() {
  const feed = useQuery({
    // A CHILD of the screen's key, not the key itself. Both would be a cache
    // entry two callers write with different limits, and whichever resolved
    // first would decide what the other saw — the screen showing eight rows
    // because a bell asked for eight. Nested keeps them apart while leaving
    // the screen's `invalidateQueries` a prefix match, so marking one read
    // there still corrects the count up here.
    queryKey: [...systemKeys.notifications(), "bell", 8] as const,
    queryFn: ({ signal }) => listNotifications(8, signal),
    // The same half-minute the record panel uses. Long enough that walking
    // between modules does not re-ask, short enough that somebody who was told
    // about a fault on the phone finds it here.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const unread = feed.data?.unread ?? 0
  const newest = (feed.data?.items ?? []).slice(0, 5)

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={
          unread === 0 ? "Notifications" : `Notifications, ${unread} unread`
        }
        className="relative grid size-tap place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
      >
        <Bell className="size-[1.0625rem] stroke-[1.55]" />
        {unread > 0 && (
          <span
            className={cn(
              "absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1",
              "bg-accent text-[0.625rem] font-semibold text-white tabular-nums"
            )}
          >
            {/* Past two figures the exact number stops being information and
                starts being a layout problem. */}
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={POSITIONER}
          side="bottom"
          align="end"
          sideOffset={8}
        >
          <Popover.Popup className={cn(POPUP, "w-[22rem] p-0")}>
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[0.8125rem] font-semibold text-ink">
                Notifications
              </span>
              {unread > 0 && (
                <span className="text-[0.6875rem] text-mute tabular-nums">
                  {unread} unread
                </span>
              )}
            </div>

            {newest.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.8125rem] text-mute">
                Nothing is waiting for you.
              </p>
            ) : (
              <ul className="flex flex-col">
                {newest.map((one) => {
                  const to = recordRoute(one.subject_kind, one.subject_id)
                  // The whole row is the target where there is one, rather
                  // than a link on the title: somebody reaching for a
                  // notification is reaching for the thing it is about, and a
                  // 13px word is a small target for a finger on an iPad.
                  const inside = (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          one.read_at === null ? "bg-accent" : "bg-hairline-2"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-[0.8125rem] leading-snug font-medium text-ink">
                          {one.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-snug text-body">
                          {one.body}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] text-mute">
                          {moment(one.created_at)}
                        </p>
                      </div>
                    </>
                  )
                  const skin = cn(
                    "flex gap-2 border-b border-hairline px-3 py-2.5 text-left last:border-b-0",
                    one.read_at === null && "bg-soft"
                  )
                  return (
                    <li key={one.notification_id} className="contents">
                      {to === null ? (
                        // No screen shows this kind by id, so the sentence
                        // stands on its own rather than pretending to lead
                        // somewhere. `lib/record-route.ts` says which.
                        <div className={skin}>{inside}</div>
                      ) : (
                        <AppLink
                          to={to.to}
                          sheet={to.sheet}
                          className={cn(
                            skin,
                            "transition-colors hover:bg-soft-2"
                          )}
                        >
                          {inside}
                        </AppLink>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="border-t border-hairline px-3 py-2">
              <AppLink
                to="/system/notifications"
                className="text-[0.8125rem] font-medium text-accent"
              >
                See everything
              </AppLink>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
