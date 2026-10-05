import { PackageCheck, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, day } from "@/lib/format"
import { isoDay } from "@/lib/queries"
import { DeliveryDetail, DeliverySheet } from "@/screens/stock/delivery-sheet"
import {
  INBOUND_POLL_MS,
  byArrival,
  deliveryName,
  resultOf,
  useInbound,
  verdictOf,
} from "@/screens/stock/inbound"
import { StockStrip, Toolbar } from "@/screens/stock/parts"
import type { StoreInboundDelivery } from "@itulah/contract"

/// Receive — the deliveries on their way to this shop, and what arrived.
///
/// **Receiving needs no reader** (owner, 29 Sep 2026). Opening a delivery
/// still in transit offers Receive: a blind count per SKU, scanned or typed,
/// without being shown what was packed — the same ceremony a handheld's sweep
/// always was, just without the handheld. This screen is the list of what is
/// still on the road and, for each one already counted, what came in against
/// what was sent.
///
/// **In transit is blind.** The node does not send what was packed until the
/// count is in, and nothing on this screen would draw it if it did
/// (`resultOf`): a count made by somebody who knows the number tends to stop
/// at that number.
///
/// Laid out as the other Stock screens: the figures across the top, a filter
/// over a table, and a row opening its delivery in a sheet — a sheet rather
/// than in place, because a received delivery is a record with a table of its
/// own inside it. The list polls, so a count finished at another till shows up
/// here without anybody touching this one.
export function Receive() {
  const inbound = useInbound()
  const deliveries = inbound.data?.deliveries

  return (
    <Screen className="[&>div:first-child]:md:mb-6">
      <StockStrip />
      {deliveries === undefined ? (
        inbound.isError ? (
          <Card>
            <Unreadable
              error={inbound.error}
              onRetry={() => void inbound.refetch()}
            />
          </Card>
        ) : (
          <LoadingState>Reading this shop's deliveries…</LoadingState>
        )
      ) : (
        <Deliveries
          rows={deliveries}
          checkedAt={inbound.dataUpdatedAt}
          // A failed poll is said beside the last answer rather than instead
          // of it — the Sync screen's rule. One dropped request every fifteen
          // seconds must not blank a list somebody is reading.
          failure={inbound.isError ? inbound.error : null}
        />
      )}
    </Screen>
  )
}

type View = "IN_TRANSIT" | "RECEIVED" | "ALL"

const DAY_MS = 24 * 60 * 60_000

function Deliveries({
  rows,
  checkedAt,
  failure,
}: {
  rows: readonly StoreInboundDelivery[]
  checkedAt: number
  failure: unknown
}) {
  /// Null until somebody picks: then the screen opens where the work is —
  /// on what is still coming when anything is, on what arrived when not.
  const [chosen, setChosen] = useState<View | null>(null)
  /// The delivery whose sheet is open, by id, so it is read from each poll.
  const [opened, setOpened] = useState<string | null>(null)
  const live =
    opened === null ? undefined : rows.find((one) => one.delivery_id === opened)

  const sorted = useMemo(() => [...rows].sort(byArrival), [rows])
  const inTransit = sorted.filter((one) => one.status === "IN_TRANSIT")
  const received = sorted.filter((one) => one.status === "RECEIVED")
  const view = chosen ?? (inTransit.length > 0 ? "IN_TRANSIT" : "RECEIVED")
  const shown =
    view === "ALL" ? sorted : view === "IN_TRANSIT" ? inTransit : received

  // "Today" and "the last thirty days" as of the answer on screen, not the
  // clock: the figures and the rows under them are then the same moment.
  const today = isoDay(new Date(checkedAt))
  const recent = received.filter(
    (one) =>
      one.received_at !== null &&
      checkedAt - Date.parse(one.received_at) <= 30 * DAY_MS,
  )
  const receivedToday = received.filter(
    (one) =>
      one.received_at !== null && isoDay(new Date(one.received_at)) === today,
  )
  const sum = (
    list: readonly StoreInboundDelivery[],
    pick: (one: StoreInboundDelivery) => number,
  ) => list.reduce((running, one) => running + pick(one), 0)
  const koli = sum(inTransit, (one) => one.koli_count)
  const unitsToday = sum(
    receivedToday,
    (one) => resultOf(one)?.received_units ?? 0,
  )
  const missing = sum(recent, (one) => resultOf(one)?.missing_units ?? 0)
  const short = recent.filter(
    (one) => (resultOf(one)?.missing_units ?? 0) > 0,
  ).length

  if (rows.length === 0) {
    return (
      <>
        {failure !== null && <Stale failure={failure} checkedAt={checkedAt} />}
        <Card>
          <EmptyState>
            No delivery has been sent to this shop yet. When the DC or head
            office sends one, it shows here as in transit — then receive it with
            a count when it arrives.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      <StatStrip className="md:grid-cols-3">
        <Stat
          label="In transit"
          value={count(inTransit.length)}
          sub={
            inTransit.length === 0
              ? "Nothing on its way"
              : `${count(koli)} koli on the way`
          }
        />
        <Stat
          label="Received today"
          value={count(receivedToday.length)}
          sub={
            receivedToday.length === 0
              ? "None counted yet"
              : `${count(unitsToday)} units counted`
          }
        />
        <Stat
          label="Units missing"
          value={count(missing)}
          tone={missing > 0 ? "bad" : undefined}
          sub={
            missing > 0
              ? `30 days · ${deliveryCount(short)}`
              : "None in 30 days"
          }
        />
      </StatStrip>

      {failure !== null && <Stale failure={failure} checkedAt={checkedAt} />}

      <Toolbar>
        <Segmented<View>
          value={view}
          onChange={setChosen}
          // The compact control under a mouse, the touch floor under a finger
          // — the Movements filter's classes, with less padding on a phone,
          // where three labels with their counts only just share 343px.
          className="md:w-auto [&>button]:px-2 [&>button]:whitespace-nowrap md:[&>button]:px-3.5 pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
          options={[
            {
              value: "IN_TRANSIT",
              label: `In transit · ${count(inTransit.length)}`,
            },
            {
              value: "RECEIVED",
              label: `Received · ${count(received.length)}`,
            },
            { value: "ALL", label: `All · ${count(sorted.length)}` },
          ]}
        />
        <p className="text-meta text-mute tabular-nums md:text-right">
          Checked {clock(checkedAt)} · every {INBOUND_POLL_MS / 1000} seconds
        </p>
      </Toolbar>

      <Card>
        <ListTable
          roomy
          rows={shown}
          columns={COLUMNS}
          rowKey={(one) => one.delivery_id}
          detail={(one) => <DeliveryDetail delivery={one} />}
          onOpen={(one) => setOpened(one.delivery_id)}
          empty={
            view === "IN_TRANSIT"
              ? "Nothing is on its way to this shop right now."
              : "Nothing has been received yet."
          }
        />
      </Card>

      {live !== undefined && (
        <DeliverySheet delivery={live} open onClose={() => setOpened(null)} />
      )}
    </>
  )
}

/// "1 delivery", "3 deliveries" — the stat strip's small print.
function deliveryCount(n: number): string {
  return `${count(n)} ${n === 1 ? "delivery" : "deliveries"}`
}

/// The hour and minute of the last answer — this list is re-read four times a
/// minute, so the day would be the same word on every look.
function clock(at: number): string {
  return new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// A poll that failed after one that did not.
function Stale({
  failure,
  checkedAt,
}: {
  failure: unknown
  checkedAt: number
}) {
  return (
    <Banner tone="bad" className="mb-4">
      Could not check for newer deliveries: {describe(failure)}. This is what
      the node said at {clock(checkedAt)}.
    </Banner>
  )
}

/// The node never answered this screen at all — `ErrorState`'s sentence, with
/// the one line that says what could not be read.
function Unreadable({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  return (
    <div className="mx-auto flex max-w-[28em] flex-col items-center gap-4 px-4 py-12 text-center">
      <div>
        <p className="text-cell font-medium text-ink">
          Cannot read this shop's deliveries.
        </p>
        <p className="mt-1 text-meta text-bad">{describe(error)}</p>
      </div>
      <Button variant="ghost" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/// The received count as one line: what came in over what was sent, then the
/// difference in its colour. Null for anything not received — this column is
/// where an in-transit delivery would give its number away.
function Result({ delivery }: { delivery: StoreInboundDelivery }) {
  const result = resultOf(delivery)
  if (delivery.status === "IN_TRANSIT") {
    return <span className="text-meta text-mute">Not received yet</span>
  }
  if (result === null) return <span className="text-mute">—</span>
  return (
    <span className="tabular-nums">
      <span className="font-medium text-ink">
        {count(result.received_units)}
      </span>
      <span className="text-mute"> / {count(result.expected_units)}</span>
      {result.missing_units > 0 && (
        <span className="ml-2.5 text-bad-fg">
          {count(result.missing_units)} missing
        </span>
      )}
    </span>
  )
}

/// The phone's second line: when, how many koli — and the result
/// in words, or the quiet note that it is still to be counted.
function phoneLine(delivery: StoreInboundDelivery): string {
  return [
    `departed ${day(delivery.departed_at)}`,
    `${count(delivery.koli_count)} koli`,
  ].join(" · ")
}

function phoneResult(delivery: StoreInboundDelivery): string {
  if (delivery.status === "IN_TRANSIT") return "Not received yet"
  const result = resultOf(delivery)
  if (result === null) return `Received ${day(delivery.received_at)}`
  return [
    `${count(result.received_units)} of ${count(result.expected_units)} received`,
    result.missing_units > 0 ? `${count(result.missing_units)} missing` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

const COLUMNS: readonly ListColumn<StoreInboundDelivery>[] = [
  {
    id: "delivery",
    header: "Delivery",
    className: "max-w-[16rem]",
    cell: (delivery) => {
      const Glyph = delivery.status === "IN_TRANSIT" ? Truck : PackageCheck
      return (
        <span className="block w-full">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico max-md:hidden [&_svg]:size-[0.9375rem]">
              <Glyph aria-hidden />
            </span>
            <span className="block min-w-0 truncate font-medium text-ink">
              {deliveryName(delivery)}
            </span>
          </span>
        </span>
      )
    },
  },
  {
    id: "departed",
    header: "Departed",
    card: "hide",
    cell: (delivery) => (
      <span className="text-body tabular-nums">
        {day(delivery.departed_at)}
      </span>
    ),
  },
  {
    id: "received",
    header: "Received",
    card: "hide",
    className: "max-xl:hidden",
    cell: (delivery) =>
      delivery.received_at === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="text-body tabular-nums">
          {day(delivery.received_at)}
        </span>
      ),
  },
  {
    id: "koli",
    header: "Koli",
    align: "right",
    card: "hide",
    className: "w-16",
    cell: (delivery) => (
      <span className="tabular-nums">{count(delivery.koli_count)}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (delivery) => {
      const verdict = verdictOf(delivery)
      return <Pill tone={verdict.tone}>{verdict.label}</Pill>
    },
  },
  {
    id: "result",
    header: "Result",
    card: "hide",
    // In transit, the row's action: it opens the sheet straight into the
    // count (the press reaches the row, which opens the sheet).
    cell: (delivery) =>
      delivery.status === "IN_TRANSIT" ? (
        <Button variant="primary" className="h-9">
          Count receive
        </Button>
      ) : (
        <Result delivery={delivery} />
      ),
  },
  {
    id: "phone-facts",
    header: "",
    card: "meta",
    className: "hidden",
    cell: phoneLine,
  },
  {
    id: "phone-result",
    header: "",
    card: "meta",
    className: "hidden",
    cell: phoneResult,
  },
]
