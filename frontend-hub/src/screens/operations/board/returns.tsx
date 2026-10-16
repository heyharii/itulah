import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { PageContent } from "@/components/shell/app-shell"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import type { ReturnToInspect, StoreInboundDelivery } from "@itulah/contract"
import { dc } from "@/lib/api"
import { SHOW_MISSING } from "@/lib/features"
import { ago, count, quantity } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { useSheet } from "@/lib/sheets"
import { useBoardView } from "@/screens/operations/board/board-view"
import {
  BoardHeader,
  Lane,
  Lanes,
  Tile,
} from "@/screens/operations/board/parts"
import { sum } from "@/screens/operations/board/sum"
import {
  StageTable,
  type StageRow,
} from "@/screens/operations/board/stage-table"
import { DeliverySheet } from "@/screens/operations/intake/receive-return-sheet"

/// Same interval as the outbound board's lanes, so the two boards' badges
/// never disagree for longer than one poll.
const POLL_MS = 30_000

/// **Return from store** — a store's own return travelling back to this
/// warehouse, laid out in the order the goods move:
///
/// **On the way** (departed the store, blind) → **Receive count** (at a bay,
/// its count taken or waiting for one) → **In review** (standing in the
/// store's return pool, being inspected) → **Received** (fully inspected).
///
/// The edge node cannot see a store's pre-departure pick list, so there is no
/// "pick list" lane here as there is in the prototype: the first figure this
/// board ever has is the koli count on the lorry, and until the delivery is
/// received the koli stands where the pieces do, exactly as on the receiving
/// screen. Every card opens the delivery's sheet — the count before it is
/// received, the per-SKU comparison after — because that sheet is the one
/// place both halves of the flow already live.
export function StoreReturnsBoard() {
  const shop = useShopName()
  const delivery = useSheet("inbound")
  const viewState = useBoardView("store-returns")
  const [view] = viewState
  const [typed, setTyped] = useState("")
  /// The table's stage (owner, 16 Oct 2026); the lanes already show all four.
  const [tab, setTab] = useState("on-way")
  const needle = typed.trim().toLowerCase()

  const deliveries = useQuery({
    queryKey: keys.storeInbound("ALL"),
    queryFn: ({ signal }) => dc.storeInboundList("ALL", signal),
    refetchInterval: POLL_MS,
  })
  const inspections = useQuery({
    queryKey: keys.returnInspections(),
    queryFn: ({ signal }) => dc.returnInspections(signal),
    refetchInterval: POLL_MS,
  })

  const allDeliveries = deliveries.data ?? []
  const allInspections = inspections.data ?? []

  /// The return pool each received delivery stands in, by its delivery.
  const inspectionOf = useMemo(
    () => new Map(allInspections.map((row) => [row.delivery_id, row])),
    [inspections.data]
  )

  const onWay = allDeliveries.filter((one) => one.status === "IN_TRANSIT")
  /// Counted at a bay, and not yet on the review lane: once a pool row
  /// exists the delivery's count has been received, and its remaining work
  /// is the inspection that lane follows.
  const toCount = allDeliveries.filter((one) => {
    if (one.status !== "RECEIVED") return false
    return !inspectionOf.has(one.delivery_id)
  })
  const reviewing = allInspections.filter((row) => row.waiting_units > 0)
  const inspected = allInspections.filter(
    (row) => row.waiting_units === 0 && row.inspected_units > 0
  )

  /// A card is kept when its store, site id or any of its documents contain
  /// what was typed.
  const keep = (siteId: string, ...docs: (string | null)[]) =>
    needle === "" ||
    [shop(siteId) || siteId, ...docs].some((text) =>
      (text ?? "").toLowerCase().includes(needle)
    )

  const way = onWay.filter((one) =>
    keep(one.source_site_id, one.shipment_reference)
  )
  const counting = toCount.filter((one) =>
    keep(one.source_site_id, one.shipment_reference)
  )
  const review = reviewing.filter((row) =>
    keep(row.source_site_id, row.shipment_reference)
  )
  const done = inspected.filter((row) =>
    keep(row.source_site_id, row.shipment_reference)
  )

  const openSheet = (id: string) => () => delivery.open(id)

  /// Where the count came up short or found extra, as the receiving screen
  /// says it: the comparison is news, the koli count is not.
  const discrepancy = (one: StoreInboundDelivery) => {
    const result = one.result
    if (result === null) return undefined
    const missing = SHOW_MISSING ? result.missing_units : 0
    if (missing === 0 && result.extra_units === 0) return undefined
    return (
      [
        missing > 0 ? `${count(missing)} missing` : null,
        result.extra_units > 0 ? `${count(result.extra_units)} extra` : null,
      ]
        .filter((text) => text !== null)
        .join(" · ") || undefined
    )
  }

  const stage = (id: string, label: string, tone: string, order: number) => ({
    id,
    label,
    tone,
    order,
  })
  const rows: StageRow[] = [
    ...way.map((one) => ({
      key: `way~${one.delivery_id}`,
      stage: stage("on-way", "On the way", "bg-info", 0),
      title: shop(one.source_site_id) || one.source_site_id,
      doc: one.shipment_reference ?? undefined,
      detail: `${count(one.koli_count)} ${one.koli_count === 1 ? "koli" : "koli"}`,
      pieces: one.koli_count,
      at: one.departed_at,
      act: "Count receive",
      onOpen: openSheet(one.delivery_id),
    })),
    ...counting.map((one) => ({
      key: `count~${one.delivery_id}`,
      stage: stage("receive-count", "Receive count", "bg-warn", 1),
      title: shop(one.source_site_id) || one.source_site_id,
      doc: one.shipment_reference ?? undefined,
      detail: `${count(one.koli_count)} ${one.koli_count === 1 ? "koli" : "koli"}`,
      pieces: one.koli_count,
      at: one.received_at,
      flag: discrepancy(one),
      onOpen: openSheet(one.delivery_id),
    })),
    ...review.map((row: ReturnToInspect) => ({
      key: `review~${row.delivery_id}`,
      stage: stage("in-review", "In review", "bg-body", 2),
      title: shop(row.source_site_id) || row.source_site_id,
      doc: row.shipment_reference ?? undefined,
      detail: `${count(row.received_units)} received`,
      pieces: row.waiting_units,
      at: row.received_at,
      onOpen: openSheet(row.delivery_id),
    })),
    ...done.map((row: ReturnToInspect) => ({
      key: `done~${row.delivery_id}`,
      stage: stage("received", "Received", "bg-ok", 3),
      title: shop(row.source_site_id) || row.source_site_id,
      doc: row.shipment_reference ?? undefined,
      detail: `${count(row.inspected_units)} inspected`,
      pieces: row.inspected_units,
      at: row.received_at,
      onOpen: openSheet(row.delivery_id),
    })),
  ]

  const filters = (
    <label className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
      <Input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-label="Search returns"
        placeholder="Search returns"
        className="h-11 w-80 pl-9"
      />
    </label>
  )

  const header = (actions?: React.ReactNode) => (
    <BoardHeader
      board="store-returns"
      title="Return Store"
      actions={actions}
      view={viewState}
    />
  )

  if (deliveries.isPending) {
    return (
      <PageContent fill>
        {header()}
        <LoadingState>Reading the returns…</LoadingState>
      </PageContent>
    )
  }
  if (deliveries.isError) {
    return (
      <PageContent fill>
        {header()}
        <ErrorState
          error={deliveries.error}
          onRetry={() => deliveries.refetch()}
        />
      </PageContent>
    )
  }

  // The strip stands on an empty board too: zeros say "nothing coming back".
  const strip = (
    <KpiStrip className="shrink-0 grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
      <Kpi
        label="On the way"
        value={`${count(sum(way, (one) => one.koli_count))} koli`}
      />
      <Kpi
        label="Receive count"
        value={quantity(
          sum(counting, (one) => one.result?.received_units ?? 0)
        )}
      />
      <Kpi
        label="In review"
        value={quantity(sum(review, (row) => row.waiting_units))}
      />
      <Kpi
        label="Received"
        value={quantity(sum(done, (row) => row.inspected_units))}
      />
    </KpiStrip>
  )

  if (
    [onWay, toCount, reviewing, inspected].every((list) => list.length === 0)
  ) {
    return (
      <PageContent fill>
        {header()}
        {strip}
        <EmptyState>Nothing coming back.</EmptyState>
      </PageContent>
    )
  }

  return (
    <PageContent fill>
      {header(filters)}
      {strip}
      {view === "table" && (
        <SubTabs
          className="shrink-0"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "on-way", label: `On the way ${count(way.length)}` },
            {
              value: "receive-count",
              label: `Receive count ${count(counting.length)}`,
            },
            { value: "in-review", label: `In review ${count(review.length)}` },
            { value: "received", label: `Received ${count(done.length)}` },
          ]}
        />
      )}
      {view === "table" ? (
        <StageTable
          rows={rows.filter((row) => row.stage.id === tab)}
          first="Store"
          empty={
            needle !== ""
              ? "Nothing matches."
              : tab === "received"
                ? "Nothing received yet."
                : tab === "in-review"
                  ? "Nothing in review."
                  : tab === "receive-count"
                    ? "Nothing to count."
                    : "Nothing on the way."
          }
          refresh={[deliveries, inspections]}
        />
      ) : (
        <Lanes board="store-returns">
          <Lane
            id="on-way"
            tone="bg-info"
            title="On the Way"
            pieces={sum(way, (one) => one.koli_count)}
            unit="koli"
            cards={way.length}
          >
            {way.map((one) => (
              <Tile
                key={one.delivery_id}
                to="/operations/intake/returns"
                onOpen={openSheet(one.delivery_id)}
                title={shop(one.source_site_id) || one.source_site_id}
                sub={one.shipment_reference ?? undefined}
                meta={`Left ${ago(one.departed_at)}`}
                pieces={one.koli_count}
                unit="koli"
                act="Count receive"
              />
            ))}
          </Lane>

          <Lane
            id="receive-count"
            tone="bg-warn"
            title="Receive Count"
            pieces={sum(counting, (one) => one.result?.received_units ?? 0)}
            cards={counting.length}
          >
            {counting.map((one) => (
              <Tile
                key={one.delivery_id}
                to="/operations/intake/returns"
                onOpen={openSheet(one.delivery_id)}
                title={shop(one.source_site_id) || one.source_site_id}
                sub={one.shipment_reference ?? undefined}
                meta={
                  one.received_at === null ? undefined : ago(one.received_at)
                }
                pieces={one.result?.received_units ?? 0}
                of={
                  SHOW_MISSING &&
                  one.result !== null &&
                  one.result.missing_units > 0
                    ? one.result.expected_units
                    : undefined
                }
                flag={discrepancy(one)}
              />
            ))}
          </Lane>

          <Lane
            id="in-review"
            tone="bg-body"
            title="In Review"
            pieces={sum(review, (row) => row.waiting_units)}
            cards={review.length}
            problem={inspections.isError ? inspections.error : undefined}
            loading={inspections.isPending}
          >
            {review.map((row) => (
              <Tile
                key={row.delivery_id}
                to="/operations/intake/returns"
                onOpen={openSheet(row.delivery_id)}
                title={shop(row.source_site_id) || row.source_site_id}
                sub={row.shipment_reference ?? undefined}
                meta={`${count(row.received_units)} received`}
                pieces={row.waiting_units}
              />
            ))}
          </Lane>

          <Lane
            id="received"
            tone="bg-ok"
            title="Received"
            pieces={sum(done, (row) => row.inspected_units)}
            cards={done.length}
            problem={inspections.isError ? inspections.error : undefined}
            loading={inspections.isPending}
          >
            {done.map((row) => (
              <Tile
                key={row.delivery_id}
                to="/operations/intake/returns"
                onOpen={openSheet(row.delivery_id)}
                title={shop(row.source_site_id) || row.source_site_id}
                sub={row.shipment_reference ?? undefined}
                meta={
                  row.received_at === null ? undefined : ago(row.received_at)
                }
                pieces={row.inspected_units}
                // Done work recedes, so what is still waiting is what the
                // eye finds.
                className="bg-soft"
              />
            ))}
          </Lane>
        </Lanes>
      )}
      <DeliverySheet id={delivery.value ?? null} onClose={delivery.close} />
    </PageContent>
  )
}
