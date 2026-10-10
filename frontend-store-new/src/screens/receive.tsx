import { useMemo, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { CardList } from "@/components/ui/card-list"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { LeadCard } from "@/components/ui/lead-card"
import { Status } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, dateText, day } from "@/lib/format"
import { isoDay } from "@/lib/queries"
import { DeliverySheet } from "@/screens/stock/delivery-sheet"
import {
  byArrival,
  cartons,
  deliveryName,
  resultOf,
  useInbound,
  verdictOf,
} from "@/screens/stock/inbound"
import { useOpenRecord } from "@/screens/stock/open-record"
import { sourceName } from "@/screens/stock/shared"
import type { StoreInboundDelivery } from "@itulah/contract"

/// Receive — the deliveries on their way to this shop, and what arrived.
///
/// **Receiving needs no reader** (owner, 29 Sep 2026). A delivery still in
/// transit carries the word Receive: it opens the delivery as a sheet and takes
/// a blind count per SKU, scanned or typed, without being shown what was
/// packed — the same ceremony a handheld's sweep always was, just without the
/// handheld. This screen is the list of what is still on the road and, for each
/// one already counted, what came in against what was sent.
///
/// **In transit is blind.** The node does not send what was packed until the
/// count is in, and nothing on this screen would draw it if it did
/// (`resultOf`): a count made by somebody who knows the number tends to stop
/// at that number.
///
/// Nothing at the top but the title (the top bar's) and the three figures. In
/// transit / Received / All is the dock's status chip on a phone and a
/// `Segmented` on a desk. A delivery is a card — its surat jalan number, the
/// cartons (or, once counted, the pieces) as the one figure, and in the foot
/// when it left beside Receive, or its verdict once it is in — and opens as a
/// sheet over the list (`?delivery=`). The list polls, so a count finished at
/// another till shows up here without anybody touching this one.
type View = "IN_TRANSIT" | "RECEIVED" | "ALL"

const DAY_MS = 24 * 60 * 60_000

export function Receive() {
  const inbound = useInbound()
  const record = useOpenRecord("delivery")
  const deliveries = inbound.data?.deliveries
  const rows = useMemo(() => deliveries ?? [], [deliveries])
  const checkedAt = inbound.dataUpdatedAt
  /// Null until somebody picks: then the screen opens where the work is — on
  /// what is still coming when anything is, on what arrived when not.
  const [chosen, setChosen] = useState<View | null>(null)

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

  const options = [
    {
      value: "IN_TRANSIT" as const,
      label: "In transit",
      count: inTransit.length,
    },
    { value: "RECEIVED" as const, label: "Received", count: received.length },
    { value: "ALL" as const, label: "All", count: sorted.length },
  ]

  return (
    <Screen counter>
      <DockTools
        status={{
          value: view,
          options,
          onChange: (next) => setChosen(next as View),
        }}
      />

      {deliveries === undefined ? (
        inbound.isError ? (
          <ErrorState
            error={inbound.error}
            onRetry={() => void inbound.refetch()}
          />
        ) : (
          <LoadingState>Reading this shop's deliveries…</LoadingState>
        )
      ) : rows.length === 0 ? (
        <>
          {inbound.isError && (
            <Stale failure={inbound.error} checkedAt={checkedAt} />
          )}
          <EmptyState>No delivery has been sent to this shop yet.</EmptyState>
        </>
      ) : (
        <>
          <KpiStrip>
            <Kpi
              label="In transit"
              value={count(inTransit.length)}
              delta={
                inTransit.length === 0
                  ? "Nothing on its way"
                  : `${cartons(koli)} on the way`
              }
              tone="flat"
            />
            <Kpi
              label="Received today"
              value={count(receivedToday.length)}
              delta={
                receivedToday.length === 0
                  ? "None counted yet"
                  : `${count(unitsToday)} pcs counted`
              }
              tone="flat"
            />
            <Kpi
              label="Pcs missing"
              value={count(missing)}
              delta={
                missing > 0
                  ? `30 days · ${deliveryCount(short)}`
                  : "None in 30 days"
              }
              tone={missing > 0 ? "down" : "flat"}
            />
          </KpiStrip>

          {/* A poll that failed after one that did not is said beside the last
              answer rather than instead of it: one dropped request every
              fifteen seconds must not blank a list somebody is reading. */}
          {inbound.isError && (
            <Stale failure={inbound.error} checkedAt={checkedAt} />
          )}

          {/* The desk's switch; on a phone it is the dock's status chip. */}
          <div className="mb-3.5 flex items-center max-md:hidden">
            <Segmented<View>
              value={view}
              onChange={setChosen}
              options={options.map((one) => ({
                value: one.value,
                label: `${one.label} · ${count(one.count)}`,
              }))}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState>
              {view === "IN_TRANSIT"
                ? "Nothing is on its way to this shop right now."
                : "Nothing has been received yet."}
            </EmptyState>
          ) : (
            <CardList grid>
              {shown.map((one) => (
                <DeliveryCard
                  key={one.delivery_id}
                  delivery={one}
                  selected={record.value === one.delivery_id}
                  onOpen={() => record.open(one.delivery_id)}
                />
              ))}
            </CardList>
          )}

          <p className="mt-4 text-center text-meta text-mute tabular-nums">
            Checked {clock(checkedAt)}
          </p>
        </>
      )}

      <DeliverySheet
        delivery={rows.find((one) => one.delivery_id === record.value)}
        onClose={record.close}
      />
    </Screen>
  )
}

/// "1 delivery", "3 deliveries" — the strip's small print.
function deliveryCount(n: number): string {
  return `${count(n)} ${n === 1 ? "delivery" : "deliveries"}`
}

/// The hour and minute of the last answer — this list is re-read four times a
/// minute, so the day would be the same word on every look.
function clock(at: number): string {
  return dateText(new Date(at), { hour: "2-digit", minute: "2-digit" })
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
    <Banner tone="bad" className="mb-3.5">
      Could not check for newer deliveries: {describe(failure)}. Showing the
      answer from {clock(checkedAt)}.
    </Banner>
  )
}

/// One delivery as the uniform card: its surat jalan number over where it came
/// from, the cartons on the road — or, once it is counted, the pieces counted —
/// as the one figure, and in the foot when it left or arrived. A delivery still
/// in transit carries Receive; one that is in carries its verdict.
///
/// **Nothing here draws what was packed for a delivery in transit**: the figure
/// is the cartons, which the driver hands over, and only a received delivery
/// has a count to show (`resultOf`).
function DeliveryCard({
  delivery,
  selected,
  onOpen,
}: {
  delivery: StoreInboundDelivery
  selected: boolean
  onOpen: () => void
}) {
  const verdict = verdictOf(delivery)
  const inTransit = delivery.status === "IN_TRANSIT"
  const result = resultOf(delivery)
  return (
    <LeadCard
      onOpen={onOpen}
      selected={selected}
      tone={result !== null && result.missing_units > 0 ? "alert" : undefined}
      title={deliveryName(delivery)}
      lines={[
        delivery.shipment_reference === null
          ? null
          : `From ${sourceName(delivery.source_site_id)}`,
      ]}
      lead={
        result === null
          ? {
              figure: count(delivery.koli_count),
              caption: delivery.koli_count === 1 ? "carton" : "cartons",
            }
          : { figure: count(result.received_units), caption: "pcs counted" }
      }
      foot={{
        info: inTransit ? (
          `Departed ${day(delivery.departed_at)}`
        ) : (
          <>
            Received {day(delivery.received_at)}
            {result !== null && result.missing_units > 0 && (
              <span className="text-bad-fg">
                {" "}
                · {count(result.missing_units)} missing
              </span>
            )}
          </>
        ),
        action: inTransit ? { label: "Receive", onClick: onOpen } : undefined,
        status: inTransit ? undefined : (
          <Status tone={verdict.tone}>{verdict.label}</Status>
        ),
      }}
    />
  )
}
