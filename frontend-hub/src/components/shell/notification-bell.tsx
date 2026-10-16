import { Popover } from "@base-ui/react/popover"
import type React from "react"
import { useQuery } from "@tanstack/react-query"

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
/// # Why the shell and not the module
///
/// `system/notifications.tsx` has drawn this list well for a while, and almost
/// nobody has seen it: it lives in System, beside Access, Nodes and Sync — the
/// module people open once a quarter. A notification that has to be gone
/// looking for is not a notification, it is a report. So the count moves to
/// what is on screen in every module, and the full list stays exactly where it
/// is.
///
/// # On the orb
///
/// It was a bell on the dark rail, then on the top bar of a tablet, and the
/// phone's Activity tab. All three are one tile of the account orb now
/// (`account-orb.tsx`, owner, 2026-10-16: "E · Floating orb"): its count rides
/// the orb's one badge, and the popup below opens beside the orb.
///
/// # Five, and then the list
///
/// The popup is a glance, not a screen. It answers "is there anything" and
/// "what is the newest", and anything past that is a reading task that belongs
/// on the page with the filters and the facets.

/// The bell's feed: one cache entry behind the orb's badge, the launcher's
/// "unread" line and the Notifications screen.
export function useNotificationFeed() {
  // Live: the stream refreshes this query the moment something arrives or is
  // read elsewhere, and a minute's poll stands in only while it is down
  // (`lib/notification-stream.ts`).
  const stream = useNotificationStream()
  usePushReconcile()
  return useQuery({
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
}

type NotificationFeed = ReturnType<typeof useNotificationFeed>

/// The newest five, opened from the orb. Controlled and triggerless: the orb
/// is the thing pressed, and its tile closes the orb's panel before this one
/// opens beside it — toward the middle of the screen, as the panel grew.
export function NotificationsPopover({
  feed,
  open,
  onOpenChange,
  anchor,
  side,
  align,
}: {
  feed: NotificationFeed
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: React.RefObject<Element | null>
  side: "left" | "right"
  align: "start" | "end"
}) {
  const unread = feed.data?.unread ?? 0
  const newest = (feed.data?.items ?? []).slice(0, 5)

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          className={POSITIONER}
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={10}
          collisionPadding={8}
        >
          <Popover.Popup
            className={cn(POPUP, "w-[22rem] max-w-[calc(100vw-1rem)] p-0")}
            // Following a row or "See everything" is done with the glance;
            // nothing is left behind standing over the screen it opened.
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a") !== null)
                onOpenChange(false)
            }}
          >
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[0.9375rem] font-semibold text-ink">
                Notifications
              </span>
              {unread > 0 && (
                <span className="text-[0.9375rem] text-mute tabular-nums">
                  {unread} unread
                </span>
              )}
            </div>

            {newest.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.9375rem] text-mute">
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
                        <p className="text-[0.9375rem] leading-snug font-medium text-ink">
                          {one.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[0.9375rem] leading-snug text-body">
                          {one.body}
                        </p>
                        <p className="mt-0.5 text-[0.9375rem] text-mute">
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
                className="text-[0.9375rem] font-medium text-accent"
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
