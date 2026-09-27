import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, CheckCheck } from "lucide-react"
import { useMemo, useState } from "react"

import { CentralGate } from "@/components/central-gate"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { cloud, CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { describe } from "@/lib/errors"
import { count, label } from "@/lib/format"
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
/// Kabar row, where somebody goes when they have a moment, and nothing ever
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
/// `frontend-hub/src/screens/system/notifications.tsx`: All / Unread in the
/// header beside the one filled button, and a feed rather than a table — a
/// notification has no metric to compare across rows, it has a sentence, and
/// a 48px cell would truncate the only part that matters. What this adds is
/// the day each one arrived as a band over its rows, because a shop reads this
/// once a day or less and "what came in since yesterday" is the question.
export function News() {
  return (
    <CentralGate what="What head office has told you">
      <ShopNews />
    </CentralGate>
  )
}

const FEED_KEY = [CENTRAL_KEY_PREFIX, "notifications"] as const

/// The one write this screen makes, and the only one the relay allows here:
/// `POST /api/v1/notifications/{id}/read`. Written once so the single mark and
/// the "all" below cannot drift onto two spellings of the path.
function markRead(id: string) {
  return cloud.post(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {})
}

type Slice = "all" | "unread"

function ShopNews() {
  const client = useQueryClient()
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

  const filter = (
    <Segmented<Slice>
      value={slice}
      onChange={setSlice}
      // The hub's compact toolbar size under a mouse, the touch floor under a
      // finger — the same override the Promotions and GA filters carry.
      className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
      options={[
        { value: "all", label: `All · ${count(page?.items.length ?? 0)}` },
        { value: "unread", label: `Unread · ${count(unread)}` },
      ]}
    />
  )
  const clearAll = (
    <Button
      variant="primary"
      className="md:pointer-fine:h-8 md:pointer-fine:px-3"
      disabled={unreadOnScreen.length === 0 || busy}
      onClick={() => readAll.mutate(unreadOnScreen)}
    >
      <CheckCheck />
      {readAll.isPending ? "Marking…" : "Mark all read"}
    </Button>
  )

  return (
    <Screen
      sub={
        unread === 0
          ? "What head office has told this shop. You are up to date."
          : `What head office has told this shop · ${count(unread)} unread`
      }
      actions={
        <>
          {filter}
          {clearAll}
        </>
      }
    >
      {/* The phone has no page header — the bar says "Kabar" — so the filter
          and the one action stand at the top of the page instead. */}
      <div className="mb-4 flex flex-col gap-2 md:hidden">
        {filter}
        {clearAll}
      </div>

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

      <Card>
        {queryState(feed, {
          loading: "Asking head office…",
          render: () =>
            shown.length === 0 ? (
              <EmptyState>
                {slice === "unread"
                  ? "Nothing is unread. Switch to All to see what head office has already told this shop."
                  : "Head office has not sent this shop anything. Faults you report are answered here."}
              </EmptyState>
            ) : (
              groups.map((group) => (
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
              ))
            ),
        })}
      </Card>
    </Screen>
  )
}

/// One thing head office said.
///
/// Unread is the accent dot and the title at ink; read drops both to the grey
/// of text somebody has already dealt with, and stays on the list — hiding what
/// was just cleared would make rows jump away while somebody works down them.
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
    // A grid rather than a row, so the button can stand at the right on a desk
    // and drop under the sentence on a phone — beside it there, it squeezed
    // the message into a column four words wide.
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-b border-hairline px-4 py-3 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto]">
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
          <Tag tone={unread ? "accent" : "neutral"}>{label(item.kind)}</Tag>
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
          // Small under a mouse, as the hub draws it; the touch floor under a
          // finger, where a 32px target in a list of them is a mis-tap.
          className="-my-1 h-8 px-2.5 text-meta max-md:col-start-2 max-md:mt-1 max-md:-ml-2.5 max-md:justify-self-start pointer-coarse:h-tap"
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

function dayLabel(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return "Undated"
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(when) === dayKey(today)) return "Today"
  if (dayKey(when) === dayKey(yesterday)) return "Yesterday"
  return when.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    // The year only when it is not this one: a shop scrolling back past New
    // Year needs it, and everybody else would read it as noise.
    year: when.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

/// The minute, in the shop's own notation — the day is already on the band.
function clock(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return "—"
  return when.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}
