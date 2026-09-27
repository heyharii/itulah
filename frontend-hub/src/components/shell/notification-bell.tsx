import { Popover } from "@base-ui/react/popover"
import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"

import { PushControl } from "@/components/shell/push-control"
import { AppLink } from "@/components/ui/app-link"
import { recordRoute } from "@/lib/record-route"
import { moment } from "@/lib/format"
import { POPUP, POSITIONER } from "@/lib/filter-chrome"
import {
  fallbackInterval,
  useNotificationStream,
} from "@/lib/notification-stream"
import { listNotifications, systemKeys } from "@/lib/queries/system"
import { usePushReconcile } from "@/lib/use-push-reconcile"
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
/// # On the rail
///
/// It sat in the bar at the top right, as a grey bell among three other grey
/// glyphs, and was not found — asked after on 2026-09-24 by somebody looking
/// straight at it. It lives on the dark rail now, above the icon strip, where
/// it is the only thing that can turn blue: a badge on near-black is seen from
/// across the room, and on the bar it was one more mark in a row of marks.
///
/// # Five, and then the list
///
/// The popup is a glance, not a screen. It answers "is there anything" and
/// "what is the newest", and anything past that is a reading task that belongs
/// on the page with the filters and the facets.
export function NotificationBell({
  tone = "light",
}: {
  /// `rail` draws it for the dark column and opens the popup to its right.
  tone?: "light" | "rail"
}) {
  const rail = tone === "rail"
  // Live: the stream refreshes this query the moment something arrives or is
  // read elsewhere, and a minute's poll stands in only while it is down
  // (`lib/notification-stream.ts`).
  const stream = useNotificationStream()
  usePushReconcile()
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
    refetchInterval: fallbackInterval(stream.state),
  })

  const unread = feed.data?.unread ?? 0
  const newest = (feed.data?.items ?? []).slice(0, 5)

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={
          unread === 0 ? "Notifications" : `Notifications, ${unread} unread`
        }
        title="Notifications"
        className={cn(
          "relative grid place-items-center rounded-inner transition-colors",
          rail
            ? "size-8 text-rail-mute hover:bg-rail-2 hover:text-rail-ink data-[popup-open]:bg-rail-3 data-[popup-open]:text-rail-ink"
            : "size-8 text-line-ico hover:bg-soft-2 hover:text-text data-[popup-open]:bg-soft-2 data-[popup-open]:text-ink pointer-coarse:size-tap"
        )}
      >
        <Bell
          className={cn("stroke-[1.55]", rail ? "size-4" : "size-[1.0625rem]")}
        />
        {unread > 0 && (
          <span
            className={cn(
              "absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1",
              "bg-accent text-[0.875rem] font-semibold text-white tabular-nums",
              // A ring in the rail's own colour, so the badge reads as sitting
              // ON the bell rather than overlapping it.
              rail && "-top-0.5 -right-0.5 ring-2 ring-rail"
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
          side={rail ? "right" : "bottom"}
          align="end"
          sideOffset={8}
        >
          <Popover.Popup className={cn(POPUP, "w-[22rem] p-0")}>
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[0.875rem] font-semibold text-ink">
                Notifications
              </span>
              {unread > 0 && (
                <span className="text-[0.875rem] text-mute tabular-nums">
                  {unread} unread
                </span>
              )}
            </div>

            {newest.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.875rem] text-mute">
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
                        <p className="text-[0.875rem] leading-snug font-medium text-ink">
                          {one.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[0.875rem] leading-snug text-body">
                          {one.body}
                        </p>
                        <p className="mt-0.5 text-[0.875rem] text-mute">
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

            <PushControl className="border-t border-hairline px-3 py-2.5" />

            <div className="border-t border-hairline px-3 py-2">
              <AppLink
                to="/system/notifications"
                className="text-[0.875rem] font-medium text-accent"
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
