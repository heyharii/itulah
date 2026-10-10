import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, CheckCheck } from "lucide-react"
import { useMemo, useState } from "react"

import { DockPortal } from "@/components/shell/dock"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CardGroup } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { cloud, CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { describe } from "@/lib/errors"
import { count, dateText, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type { Notification, NotificationPage } from "@itulah/contract"

/// What head office has told this shop.
///
/// # Why this is a screen and not a bell
///
/// The console puts its count on the rail, on screen in every module, and
/// that is right for somebody sitting at a desk. This app spends its day beside
/// a counter with a customer in front of it, and a badge that lights up during
/// a queue is an interruption rather than news. So the count lives on the
/// Discuss row, where somebody goes when they have a moment, and nothing ever
/// appears over the screen they are working in.
///
/// # Only two kinds of thing reach a shop
///
/// The answer to something this shop reported, and anything that names this
/// shop. That is not a filter drawn here — the server decides an audience when
/// the notification is raised, and a shop manager is simply not in the audience
/// for a supplier's price amendment. What arrives is already theirs.
///
/// # Drawn as the hub's Notifications
///
/// `frontend-hub/src/screens/system/notifications.tsx`: a feed rather than a
/// table — a notification has no metric to compare across rows, it has a
/// sentence, and a 48px cell would truncate the only part that matters. On a
/// phone each is a card under its day (`CardGroup`), with the one button on its
/// foot; the slice (All / Unread) is behind the dock's ⚙ and the screen's one
/// act, "Mark all read", is the wide button in the dock. On a desk the same
/// feed is one list with the day as a band, and the slice and the act are in
/// the page header. What this adds is the day each one arrived: a shop reads
/// this once a day or less and "what came in since yesterday" is the question.
///
/// The Notices tab of Discuss (`screens/discuss.tsx`), which supplies the gate
/// and the tab switch.
export type DiscussTab = "chat" | "notices"

/// The Chat / Notices switch as the dock's status chip on a phone.
// eslint-disable-next-line react-refresh/only-export-components -- a value both tabs of Discuss read
export function tabStatus(
  tab: DiscussTab,
  onTab: (tab: DiscussTab) => void,
  unread: number,
) {
  return {
    value: tab,
    options: [
      {
        value: "chat",
        label: "Chat",
        count: unread > 0 ? unread : undefined,
      },
      { value: "notices", label: "Notices" },
    ],
    onChange: (next: string) => onTab(next as DiscussTab),
  }
}

/// The same switch on a desk, in the page header.
export function TabSwitch({
  tab,
  onTab,
  unread,
}: {
  tab: DiscussTab
  onTab: (tab: DiscussTab) => void
  unread: number
}) {
  return (
    <Segmented<DiscussTab>
      value={tab}
      onChange={onTab}
      options={[
        {
          value: "chat",
          label: unread > 0 ? `Chat · ${count(unread)}` : "Chat",
        },
        { value: "notices", label: "Notices" },
      ]}
    />
  )
}

export function Notices({
  tab,
  onTab,
  unread: chatUnread,
}: {
  tab: DiscussTab
  onTab: (tab: DiscussTab) => void
  unread: number
}) {
  return <ShopNews tab={tab} onTab={onTab} chatUnread={chatUnread} />
}

const FEED_KEY = [CENTRAL_KEY_PREFIX, "notifications"] as const

/// The one write this screen makes, and the only one the relay allows here:
/// `POST /api/v1/notifications/{id}/read`. Written once so the single mark and
/// the "all" below cannot drift onto two spellings of the path.
function markRead(id: string) {
  return cloud.post(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {})
}

type Slice = "all" | "unread"

function ShopNews({
  tab,
  onTab,
  chatUnread,
}: {
  tab: DiscussTab
  onTab: (tab: DiscussTab) => void
  chatUnread: number
}) {
  const client = useQueryClient()
  const phone = useLayout() === "phone"
  const [slice, setSlice] = useState<Slice>("all")

  const feed = useQuery({
    queryKey: FEED_KEY,
    queryFn: ({ signal }) =>
      cloud.get<NotificationPage>("/api/v1/notifications?limit=50", { signal }),
  })

  const refresh = () => client.invalidateQueries({ queryKey: FEED_KEY })

  const read = useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: refresh,
  })

  /// "Mark all read", made of the single mark.
  ///
  /// The relay passes exactly two notification calls to head office — the
  /// list and one read — and the centre's own read-all is not one of them. So
  /// this walks the unread rows on screen and marks each, one after another
  /// rather than fifty at once: the relay is the shop's one line to head
  /// office, and a burst of parallel writes down it is the thing most likely
  /// to fail half way. Whatever stopped it, the list is re-read afterwards, so
  /// what is on screen is always head office's answer, not this loop's count.
  const readAll = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      let cleared = 0
      for (const id of ids) {
        await markRead(id)
        cleared += 1
      }
      return cleared
    },
    onSettled: refresh,
  })

  const page = feed.data
  const unread = page?.unread ?? 0
  const unreadOnScreen = useMemo(
    () =>
      (page?.items ?? [])
        .filter((item) => item.read_at === null)
        .map((item) => item.notification_id),
    [page],
  )
  const shown = useMemo(() => {
    const items = page?.items ?? []
    return slice === "unread"
      ? items.filter((item) => item.read_at === null)
      : items
  }, [page, slice])
  const groups = useMemo(() => byDay(shown), [shown])

  const busy = read.isPending || readAll.isPending
  const nothingToClear = unreadOnScreen.length === 0 || busy
  const markAll = () => readAll.mutate(unreadOnScreen)

  const sliceChoices = [
    { value: "all", label: `All · ${count(page?.items.length ?? 0)}` },
    { value: "unread", label: `Unread · ${count(unread)}` },
  ] as const

  return (
    <Screen
      actions={
        <>
          <TabSwitch tab={tab} onTab={onTab} unread={chatUnread} />
          <Segmented<Slice>
            value={slice}
            onChange={setSlice}
            options={sliceChoices}
          />
          <Button variant="primary" disabled={nothingToClear} onClick={markAll}>
            <CheckCheck />
            {readAll.isPending ? "Marking…" : "Mark all read"}
          </Button>
        </>
      }
    >
      {/* The phone's dock: Chat / Notices as the status chip, the slice behind
          the ⚙, and the one act as the wide button beside them. */}
      <DockTools
        status={tabStatus(tab, onTab, chatUnread)}
        views={[
          {
            title: "Show",
            value: slice,
            options: sliceChoices,
            onChange: (next) => setSlice(next as Slice),
          },
        ]}
      />
      <DockPortal slot="action">
        <button
          type="button"
          disabled={nothingToClear}
          onClick={markAll}
          className="dock-wide inline-flex h-9 w-full items-center justify-center rounded-full bg-cta px-5 text-[0.875rem] font-semibold whitespace-nowrap text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96] disabled:opacity-50"
        >
          {readAll.isPending ? "Marking…" : "Mark all read"}
        </button>
      </DockPortal>

      {readAll.isSuccess && (
        <Banner tone="ok" className="mb-3">
          {readAll.data === 0
            ? "There was nothing left to mark."
            : `${count(readAll.data)} marked as read.`}
        </Banner>
      )}
      {(read.isError || readAll.isError) && (
        <Banner tone="bad" className="mb-3">
          {describe(readAll.error ?? read.error)}
        </Banner>
      )}

      {/* The count is not the length of the list: head office caps what it
          sends, so a shop opening this after a long week does not fetch four
          hundred rows — and a figure that quietly said "50" would be a figure
          nobody trusts. */}
      {page !== undefined && unreadOnScreen.length < unread && (
        <Banner tone="info" className="mb-3">
          Showing the most recent {count(unreadOnScreen.length)} of{" "}
          {count(unread)} unread. Marking these read brings up the rest.
        </Banner>
      )}

      {queryState(feed, {
        loading: "Reading what head office has sent…",
        render: () =>
          shown.length === 0 ? (
            <EmptyState>
              {slice === "unread"
                ? "Nothing is unread."
                : "Head office has not sent this shop anything."}
            </EmptyState>
          ) : phone ? (
            groups.map((group) => (
              <CardGroup
                key={group.key}
                heading={group.label}
                aside={count(group.items.length)}
              >
                {group.items.map((item) => (
                  <NewsCard
                    key={item.notification_id}
                    item={item}
                    busy={busy}
                    onRead={() => read.mutate(item.notification_id)}
                  />
                ))}
              </CardGroup>
            ))
          ) : (
            <Card>
              {groups.map((group) => (
                <section
                  key={group.key}
                  aria-label={group.label}
                  className="border-t border-hairline first:border-t-0"
                >
                  {/* The hub's heading band — the list table's `{soft}` row —
                      carrying the day instead of column names. */}
                  <h2 className="flex h-9 items-center gap-2 border-b border-hairline bg-soft px-4 text-eyebrow font-medium text-body">
                    {group.label}
                    <span className="text-mute tabular-nums">
                      {count(group.items.length)}
                    </span>
                  </h2>
                  <ul>
                    {group.items.map((item) => (
                      <NewsRow
                        key={item.notification_id}
                        item={item}
                        busy={busy}
                        onRead={() => read.mutate(item.notification_id)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </Card>
          ),
      })}
    </Screen>
  )
}

/// One thing head office said, as a phone's card: the sentence somebody wrote
/// under its title, and on the foot when it came and the one button. Unread is
/// the accent dot before the title; read drops to the grey of something dealt
/// with and stays on the list — hiding what was just cleared would make cards
/// jump away while somebody works down them.
function NewsCard({
  item,
  busy,
  onRead,
}: {
  item: Notification
  busy: boolean
  onRead: () => void
}) {
  const unread = item.read_at === null
  return (
    <LeadCard
      title={
        <span className="flex items-start gap-2">
          {unread && (
            <span
              aria-hidden
              className="mt-[0.5625rem] size-1.5 shrink-0 rounded-full bg-accent"
            />
          )}
          <span className={cn(!unread && "font-medium text-body")}>
            {item.title}
          </span>
        </span>
      }
      lines={[item.body]}
      foot={{
        info: `${kindWord(item.kind)} · ${clock(item.created_at)}${unread ? "" : " · read"}`,
        action: unread
          ? { label: "Mark read", onClick: onRead, disabled: busy }
          : undefined,
      }}
    />
  )
}

/// One thing head office said, as a desk's feed row.
///
/// Unread is the accent dot and the title at ink; read drops both to the grey
/// of text somebody has already dealt with.
///
/// No deep link out of here, on purpose: this app has no screen that shows a
/// purchase order or a bill, and a row that led nowhere would be worse than one
/// that plainly does not offer to. The sentence is the whole message — that is
/// why the server writes it as one.
function NewsRow({
  item,
  busy,
  onRead,
}: {
  item: Notification
  busy: boolean
  onRead: () => void
}) {
  const unread = item.read_at === null
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-hairline px-4 py-3 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          "mt-[0.4375rem] size-1.5 shrink-0 rounded-full",
          unread ? "bg-accent" : "bg-hairline-strong",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "text-cell",
              unread ? "font-medium text-ink" : "text-body",
            )}
          >
            {item.title}
          </span>
          <Tag tone={unread ? "accent" : "neutral"}>{kindWord(item.kind)}</Tag>
        </div>
        <p className="mt-0.5 text-meta leading-relaxed text-body">
          {item.body}
        </p>
        <p className="mt-1 text-pill text-mute tabular-nums">
          {clock(item.created_at)}
          {unread ? "" : " · read"}
        </p>
      </div>
      {unread && (
        <Button
          variant="quiet"
          aria-label={`Mark “${item.title}” as read`}
          className="-my-1"
          disabled={busy}
          onClick={onRead}
        >
          <Check />
          Mark read
        </Button>
      )}
    </li>
  )
}

interface Day {
  readonly key: string
  readonly label: string
  readonly items: readonly Notification[]
}

/// What kind of notice it is, in words: `store.exception.escalated` →
/// "Store exception escalated".
function kindWord(kind: string): string {
  return label(kind.replace(/[._]+/g, " "))
}

/// The feed cut into days, newest first — in the order the server sent it, so
/// a group never reorders what is inside it.
function byDay(items: readonly Notification[]): Day[] {
  const days: { key: string; label: string; items: Notification[] }[] = []
  for (const item of items) {
    const key = dayKey(new Date(item.created_at))
    const last = days[days.length - 1]
    if (last !== undefined && last.key === key) {
      last.items.push(item)
    } else {
      days.push({ key, label: dayLabel(item.created_at), items: [item] })
    }
  }
  return days
}

/// The local calendar day, as a key. Local, not UTC: a notice raised at 06:30
/// in Jakarta is this morning's, not yesterday's.
function dayKey(when: Date): string {
  if (Number.isNaN(when.getTime())) return "undated"
  return `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`
}

/// "Today", "Yesterday", then `Tue 06 Oct 2026` — the house date with its
/// weekday, which a feed read once a day is glad of.
function dayLabel(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return "Undated"
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(when) === dayKey(today)) return "Today"
  if (dayKey(when) === dayKey(yesterday)) return "Yesterday"
  return `${dateText(when, { weekday: "short" })} ${dateText(when, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`
}

/// The minute, 24-hour — the day is already on the band.
function clock(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return "—"
  return dateText(when, { hour: "2-digit", minute: "2-digit", hour12: false })
}
