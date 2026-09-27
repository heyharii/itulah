import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PushControl } from "@/components/shell/push-control"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label, moment } from "@/lib/format"
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  systemKeys,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { recordRoute } from "@/lib/record-route"
import type { SheetKey } from "@/lib/sheets"
import { saying } from "@/screens/system/units"
import type { Notification } from "@itulah/contract"

/// Work that came looking for somebody.
///
/// Written as a feed rather than a `<DataTable>`, and the difference is not
/// cosmetic. A list table exists to compare rows on computed metrics; a
/// notification has no metric — it has a sentence somebody wrote when the thing
/// happened, and squeezing that into a 38px cell would truncate the only part
/// that matters. Everything the record carries is on the page, so there is no
/// detail sheet and nothing to open.
///
/// Read and unread are shown together by default, which is the server's own
/// choice: a list that hid what you just cleared would flicker items away as
/// you worked through it.

/// Where a notification leads.
///
/// One line, because the translation from a record to a screen moved to
/// `lib/record-route.ts` the moment a second surface needed it: the bell in the
/// top bar asks the identical question, and two copies would have drifted the
/// first time a route changed. What was here — one kind, an amendment — is now
/// one row in that table beside the rest.
function target(
  notification: Notification
): { to: string; sheet?: { key: SheetKey; value: string } } | null {
  return recordRoute(notification.subject_kind, notification.subject_id)
}

type Slice = "unread" | "all"

export function Notifications() {
  const client = useQueryClient()
  const [slice, setSlice] = useState<Slice>("all")

  const page = useQuery({
    queryKey: systemKeys.notifications(),
    queryFn: ({ signal }) => listNotifications(50, signal),
  })

  const read = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: systemKeys.notifications() }),
  })

  const readAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: systemKeys.notifications() }),
  })

  const shown = useMemo(() => {
    const items = page.data?.items ?? []
    return slice === "unread"
      ? items.filter((item) => item.read_at === null)
      : items
  }, [page.data, slice])

  const unread = page.data?.unread ?? 0

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Notifications"
        sub={
          unread === 0
            ? "Nothing is waiting for you."
            : `${count(unread)} still waiting for you.`
        }
        actions={
          <>
            <Segmented<Slice>
              options={[
                { value: "all", label: "All" },
                { value: "unread", label: "Unread" },
              ]}
              value={slice}
              onChange={setSlice}
            />
            <Button
              variant="primary"
              disabled={unread === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              {readAll.isPending ? "Clearing…" : "Mark all read"}
            </Button>
          </>
        }
      />

      {(readAll.isError || read.isError) && (
        <Banner tone="bad" className="mb-3">
          {saying(readAll.error ?? read.error)}
        </Banner>
      )}

      {/* The count is not the length of the list: the server caps what it sends
          so a screen opened after a bad week does not fetch four hundred rows,
          and a badge that quietly said "50" would be a badge nobody trusts. */}
      {page.data && page.data.items.length < unread && (
        <Banner tone="info" className="mb-3">
          Showing the most recent {count(page.data.items.length)} of{" "}
          {count(unread)} unread. Clearing these will reveal the rest.
        </Banner>
      )}

      {/* Whether this device is woken when something arrives. Here as well as
          in the bell's popup because on a phone this screen IS the bell. */}
      <Card className="mb-3 p-3">
        <PushControl />
      </Card>

      <Card className="overflow-hidden">
        {queryState(page, {
          loading: "Loading what is waiting…",
          render: () =>
            shown.length === 0 ? (
              slice === "unread" ? (
                <EmptyState>
                  Nothing is unread. Switch to All to see what has already been
                  dealt with.
                </EmptyState>
              ) : (
                <EmptyState>
                  Nothing has been raised for you. Notifications are written by
                  the work that caused them, so an empty list means an
                  uneventful week rather than a missing feed.
                </EmptyState>
              )
            ) : (
              <ul>
                {shown.map((item) => {
                  const to = target(item)
                  const isUnread = item.read_at === null
                  return (
                    <li
                      key={item.notification_id}
                      className="flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
                    >
                      <span
                        aria-hidden
                        className={
                          isUnread
                            ? "mt-1.5 size-[0.375rem] shrink-0 rounded-full bg-accent"
                            : "mt-1.5 size-[0.375rem] shrink-0 rounded-full bg-hairline-strong"
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              isUnread
                                ? "text-[0.875rem] font-medium text-ink"
                                : "text-[0.875rem] text-body"
                            }
                          >
                            {item.title}
                          </span>
                          <Tag tone={isUnread ? "accent" : "neutral"}>
                            {label(item.kind)}
                          </Tag>
                          {item.origin_id && <Tag>{item.origin_id}</Tag>}
                        </div>
                        <p className="mt-0.5 text-[0.875rem] text-body">
                          {item.body}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[0.875rem] text-mute">
                          <span className="tabular-nums">
                            {moment(item.created_at)}
                          </span>
                          {to && (
                            <AppLink
                              to={to.to}
                              sheet={to.sheet}
                              className="font-medium text-accent hover:underline"
                            >
                              Open the record
                            </AppLink>
                          )}
                        </div>
                      </div>
                      {isUnread && (
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={read.isPending}
                          onClick={() => read.mutate(item.notification_id)}
                        >
                          Mark read
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ),
        })}
      </Card>
    </PageContent>
  )
}
