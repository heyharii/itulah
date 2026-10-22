import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { articleId, count, dateText, day, pcs, sku } from "@/lib/format"
import {
  fetchOnHold,
  isoDay,
  onHoldKey,
  type StoreOnHoldLine,
} from "@/lib/queries"
import { DeliverySheet } from "@/screens/stock/delivery-sheet"
import {
  byArrival,
  fromName,
  resultOf,
  useInbound,
} from "@/screens/stock/inbound"
import { useOpenRecord } from "@/screens/stock/open-record"
import { useRange } from "@/screens/stock/shared"
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
/// **Laid out as the hub's Ops receiving list** (owner, 20 Oct 2026): the three
/// figures, tabs To receive / Received (/ On hold), and a calm table — No. ·
/// Delivery note · From · Departed · Koli · Count receive — that is cards on a
/// phone (tabs are then the dock's chip). A delivery is a row — its surat jalan number, the
/// cartons (or, once counted, the pieces) as the one figure, and in the foot
/// when it left beside Receive, or its verdict once it is in — and opens as a
/// sheet over the list (`?delivery=`). The list polls, so a count finished at
/// another till shows up here without anybody touching this one.
type View = "IN_TRANSIT" | "RECEIVED" | "HOLD"

const DAY_MS = 24 * 60 * 60_000

export function Receive() {
  const inbound = useInbound()
  /// What the shop counted and could not book: set aside until MD answers.
  const onHold = useQuery({
    queryKey: onHoldKey(),
    queryFn: ({ signal }) => fetchOnHold(signal),
    refetchInterval: 15_000,
  })
  const record = useOpenRecord("delivery")
  const deliveries = inbound.data?.deliveries
  const rows = useMemo(() => deliveries ?? [], [deliveries])
  const checkedAt = inbound.dataUpdatedAt
  const holdLines = onHold.data ?? []
  /// Null until somebody picks: then the screen opens where the work is — on
  /// what is still coming when anything is, on what arrived when not.
  const [chosen, setChosen] = useState<View | null>(null)

  const sorted = useMemo(() => [...rows].sort(byArrival), [rows])
  const inTransit = sorted.filter((one) => one.status === "IN_TRANSIT")
  const received = sorted.filter((one) => one.status === "RECEIVED")
  const picked = chosen ?? (inTransit.length > 0 ? "IN_TRANSIT" : "RECEIVED")
  const view = picked === "HOLD" && holdLines.length === 0 ? "RECEIVED" : picked
  const shown = view === "IN_TRANSIT" ? inTransit : received

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
    (one) =>
      (resultOf(one)?.received_units ?? 0) + (resultOf(one)?.extra_units ?? 0),
  )
  const missing = sum(recent, (one) => resultOf(one)?.missing_units ?? 0)

  const holdPcs = holdLines.reduce((total, one) => total + one.on_hold, 0)
  const tabs = [
    {
      value: "IN_TRANSIT" as const,
      label: "To receive",
      count: inTransit.length,
    },
    { value: "RECEIVED" as const, label: "Received", count: received.length },
    ...(holdLines.length > 0
      ? [{ value: "HOLD" as const, label: "On hold", count: holdPcs }]
      : []),
  ]

  const columns: ListColumn<StoreInboundDelivery>[] = [
    {
      id: "no",
      header: "No.",
      className: "w-16",
      align: "right",
      card: "hide",
      cell: (one) => (
        <span className="text-mute tabular-nums">
          {shown.indexOf(one) + 1}
        </span>
      ),
    },
    {
      id: "note",
      header: "Delivery note",
      card: "title",
      cell: (one) => (
        <span className="font-mono text-id text-ink">
          {one.shipment_reference ?? "—"}
        </span>
      ),
    },
    {
      id: "from",
      header: "From",
      cell: (one) => (
        <span className="text-ink">{fromName(one.source_site_id)}</span>
      ),
    },
    {
      id: "departed",
      header: "Departed",
      cell: (one) => day(one.departed_at),
    },
    {
      id: "koli",
      header: "Koli",
      align: "right",
      cell: (one) => count(one.koli_count),
    },
    {
      id: "action",
      header: "",
      align: "right",
      card: "status",
      cell: (one) => {
        if (one.status === "IN_TRANSIT")
          return (
            <Button
              variant="primary"
              size="card"
              onClick={(event) => {
                event.stopPropagation()
                record.open(one.delivery_id)
              }}
            >
              Count receive
            </Button>
          )
        const result = resultOf(one)
        const short = result !== null && result.missing_units > 0
        return (
          <span className={short ? "text-bad-fg" : "text-ok-fg"}>
            Received {day(one.received_at)}
            {short && ` · ${count(result.missing_units)} missing`}
          </span>
        )
      },
    },
  ]

  return (
    <Screen counter>
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
            <Kpi label="To receive" value={`${count(koli)} koli`} />
            <Kpi label="Received today" value={pcs(unitsToday)} />
            <Kpi
              label="Missing"
              value={
                <span className={missing > 0 ? "text-bad-fg" : undefined}>
                  {pcs(missing)}
                </span>
              }
            />
          </KpiStrip>

          {/* A poll that failed after one that did not is said beside the last
              answer rather than instead of it: one dropped request every
              fifteen seconds must not blank a list somebody is reading. */}
          {inbound.isError && (
            <Stale failure={inbound.error} checkedAt={checkedAt} />
          )}

          <PeopleTabs<View>
            title="Show"
            value={view}
            onChange={setChosen}
            tabs={tabs}
            plainCount
          />

          {view === "HOLD" ? (
            <OnHold lines={holdLines} />
          ) : (
            <Card className="overflow-hidden max-md:overflow-visible">
              <ListTable
                rows={shown}
                columns={columns}
                rowKey={(one) => one.delivery_id}
                onOpen={(one) => record.open(one.delivery_id)}
                roomy
                empty={
                  view === "IN_TRANSIT"
                    ? "Nothing is on its way to this shop right now."
                    : "Nothing has been received yet."
                }
              />
            </Card>
          )}
        </>
      )}

      <DeliverySheet
        delivery={rows.find((one) => one.delivery_id === record.value)}
        onClose={record.close}
      />
    </Screen>
  )
}

/// **On hold** (owner, 17–18 Oct 2026): what the shop counted beyond what
/// its delivery said — more of a SKU than was sent, or an article nobody sent.
/// It is not stock: set it aside. MD answers the trip's review; what goes
/// back to HO then says so here, and what MD kept is in stock and leaves the
/// list by itself. One row per article, named, not counted.
function OnHold({ lines }: { lines: readonly StoreOnHoldLine[] }) {
  const { bySku } = useRange()
  const columns: ListColumn<StoreOnHoldLine>[] = [
    {
      id: "article",
      header: "Article",
      card: "title",
      className: "whitespace-normal",
      cell: (one) => (
        <span className="block">
          <span className="font-medium text-ink">
            {one.name ?? bySku.get(one.sku_code)?.name ?? sku(one.sku_code)}
          </span>
          <span className="block font-mono text-id text-mute">
            {articleId(bySku.get(one.sku_code)?.article_code, one.sku_code)} ·{" "}
            {sku(one.sku_code)}
          </span>
        </span>
      ),
    },
    {
      id: "note",
      header: "Delivery note",
      cell: (one) => (
        <span className="font-mono text-id">{one.shipment_reference ?? "—"}</span>
      ),
    },
    {
      id: "pcs",
      header: "Pieces",
      align: "right",
      cell: (one) => pcs(one.on_hold),
    },
    {
      id: "state",
      header: "",
      align: "right",
      card: "status",
      cell: (one) =>
        one.state === "RETURN_TO_HO" ? (
          <Pill tone="bad">Return to HO</Pill>
        ) : (
          <Pill tone="neutral">Waiting for MD</Pill>
        ),
    },
  ]
  return (
    <Card className="overflow-hidden max-md:overflow-visible">
      <ListTable
        rows={lines}
        columns={columns}
        rowKey={(one) => `${one.delivery_id}:${one.sku_code}`}
        roomy
        empty="Nothing is on hold."
      />
    </Card>
  )
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

