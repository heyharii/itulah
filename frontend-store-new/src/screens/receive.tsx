import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Card } from "@/components/ui/card"
import { ScanField } from "@/components/ui/scan-field"
import { Screen } from "@/components/ui/screen"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, dateText, day, pcs } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { fetchInboundScan, isoDay } from "@/lib/queries"
import { DeliverySheet } from "@/screens/stock/delivery-sheet"
import {
  byArrival,
  fromName,
  resultOf,
  useInbound,
} from "@/screens/stock/inbound"
import { useOpenRecord } from "@/screens/stock/open-record"
import type { StoreInboundDelivery } from "@itulah/contract"

/// Receive — the deliveries on their way to this shop, and what arrived.
///
/// **Receiving needs no reader** (owner, 29 Sep 2026). A delivery still in
/// transit carries the word Count receive: it opens the delivery as a sheet
/// that lists every SKU with what was packed and a count already holding that
/// figure, so the shop changes only what differs (owner, 23 Oct 2026: no longer
/// a blind count). This screen is the list of what is still on the road and,
/// for each one already counted, what came in against what was sent.
///
/// **A scan finds the delivery** (owner, 23 Oct 2026): a koli label, a koli QR
/// or a surat jalan number typed or scanned into the field opens that delivery,
/// and a koli label opens with that koli unfolded. The field is the app's one
/// scan field (`ScanField`), the same on every device; a phone's keyboard stays
/// down until it is tapped.
///
/// **Laid out as the hub's Ops receiving list** (owner, 20 Oct 2026): the three
/// figures, tabs To receive / Received, and a calm table — No. ·
/// Delivery note · From · Departed · Koli · Count receive — that is cards on a
/// phone (tabs are then the dock's chip). A delivery is a row — its surat jalan number, the
/// cartons (or, once counted, the pieces) as the one figure, and in the foot
/// when it left beside Receive, or its verdict once it is in — and opens as a
/// sheet over the list (`?delivery=`). The list polls, so a count finished at
/// another till shows up here without anybody touching this one.
///
/// **No On hold tab** (owner, 25 Oct 2026): what was counted beyond a
/// delivery is already said where it is dealt with — the delivery's own sheet
/// while MD reviews it, and Stock › To be returned › Over delivery.
type View = "IN_TRANSIT" | "RECEIVED"

const DAY_MS = 24 * 60 * 60_000

export function Receive() {
  const inbound = useInbound()
  const record = useOpenRecord("delivery")
  const phone = useLayout() === "phone"
  /// The koli a scanned label named, unfolded in the sheet that opens.
  const [koliId, setKoliId] = useState<string | null>(null)
  const scan = async (code: string) => {
    try {
      const found = await fetchInboundScan(code)
      if (found === null) {
        toast.error(`No koli or surat jalan ${code}`)
        return
      }
      setKoliId(found.koli_id)
      record.open(found.delivery_id)
    } catch (error) {
      toast.error(describe(error))
    }
  }
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

  const tabs = [
    {
      value: "IN_TRANSIT" as const,
      label: "To receive",
      count: inTransit.length,
    },
    { value: "RECEIVED" as const, label: "Received", count: received.length },
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

          <ScanField
            autoFocus={!phone}
            onScan={(code) => void scan(code)}
            placeholder="Scan a koli label or delivery note"
            className="mb-3.5"
          />

          <PeopleTabs<View>
            title="Show"
            value={view}
            onChange={setChosen}
            tabs={tabs}
            plainCount
          />

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
        </>
      )}

      <DeliverySheet
        delivery={rows.find((one) => one.delivery_id === record.value)}
        koliId={koliId}
        onClose={() => {
          setKoliId(null)
          record.close()
        }}
      />
    </Screen>
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

