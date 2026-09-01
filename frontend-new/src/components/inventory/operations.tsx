/*
 * Inventory operations owns the browser read surface for physical workflows.
 * Internal exposes cycle-count, DC-operation, and supplier-return projections.
 * Store receiving is rendered by the store-router slice below; outbound
 * commands remain absent until their authoritative routes are available.
 */

import { useEffect, useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import {
  fetchCycleCountVariance,
  fetchInboundReturnDetail,
  useInventoryOperations,
  type CycleCountOperation,
  type CycleCountVariance,
  type DcOperation,
  type HoReceivingBatch,
  type InboundReturnDetail,
  type InboundReturnOperation,
} from "@/components/inventory/api"
import {
  useDisposeInboundReturn,
  useInspectInboundReturn,
  useScheduleInboundReturnPickup,
} from "@/components/inventory/mutations"
import { StoreReceiving } from "@/components/inventory/store-receiving"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const CYCLE_COUNT_COLUMNS = "190px 150px 120px 130px minmax(0,1fr)"
const RECEIVING_BATCH_COLUMNS = "190px 155px 150px 135px 110px minmax(0,1fr)"
const DC_OPERATION_COLUMNS = "140px 190px 130px 130px 90px minmax(0,1fr)"
const INBOUND_RETURN_COLUMNS = "170px 130px minmax(0,1fr) 125px 105px 150px"

/* The row-hover reveal (`group-hover/row:`) elsewhere in the app depends on a
 * `group/row` class on the `<tr>`. VirtualRows' row wrapper carries no such
 * class, but it always sets `role="row"`, which is enough to key off of with
 * an arbitrary variant — the same ancestor-selector idiom already used in
 * ui/sidebar.tsx (`[[data-side=left]_&]:...`). */
const underlineOnRowHover = "[[role=row]:hover_&]:underline"

type Selection =
  | { kind: "count"; row: CycleCountOperation }
  | { kind: "return"; row: InboundReturnOperation }

type ReturnDisposition =
  "restock" | "write_off" | "reject_to_supplier" | "donate"

const RETURN_DISPOSITIONS: Array<{
  value: ReturnDisposition
  label: string
}> = [
  { value: "restock", label: "Restock" },
  { value: "write_off", label: "Write off" },
  { value: "reject_to_supplier", label: "Return to supplier" },
  { value: "donate", label: "Donate" },
]

type Detail =
  | { kind: "count"; value: CycleCountVariance }
  | { kind: "return"; value: InboundReturnDetail }

function dateLabel(value: string): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : date.toLocaleString()
}

function statusLabel(value: string): string {
  if (!value) return "Unknown"
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusClass(value: string): string {
  const normalized = value.toLowerCase()
  if (
    ["completed", "closed", "restocked", "dispatched", "verified"].includes(
      normalized
    )
  ) {
    return "text-grass"
  }
  if (["inspected", "in_progress", "picked_up", "open"].includes(normalized)) {
    return "text-honey"
  }
  if (
    ["discrepancy", "cancelled", "returned_to_supplier"].includes(normalized)
  ) {
    return "text-ember"
  }
  return "text-ink-3"
}

function CellStatus({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[11.5px] font-medium",
        statusClass(value)
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {statusLabel(value)}
    </span>
  )
}

function EmptySection({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-[128px] flex-col items-center justify-center gap-1.5 px-6 text-center text-ink-4">
      <span className="grid size-8 place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <span className="font-mono text-sm">—</span>
      </span>
      <span className="text-xs font-medium text-ink-2">{title}</span>
      <span className="max-w-[520px] text-[11px] leading-[1.45]">{detail}</span>
    </div>
  )
}

function SectionHeading({
  title,
  count,
}: {
  title: string
  count: number | null
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
      <h2 className="text-xs font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      <span className="font-mono text-[10.5px] text-ink-4">
        {count === null ? "—" : count.toLocaleString()}
      </span>
    </div>
  )
}

function SourceError({ message }: { message: string }) {
  return (
    <div className="m-3.5 flex items-start gap-2 rounded-panel bg-ember/5 px-3 py-2.5 text-[11px] leading-[1.45] text-ember shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ember)_24%,transparent)]">
      <Icon
        path={paths.alert}
        size={14}
        width={1.8}
        className="mt-px shrink-0"
      />
      <span>{message}</span>
    </div>
  )
}

function CycleCounts({
  rows,
  onOpen,
}: {
  rows: CycleCountOperation[] | null
  onOpen: (row: CycleCountOperation) => void
}) {
  return (
    <section className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <SectionHeading title="Cycle counts" count={rows?.length ?? null} />
      {rows === null ? (
        <EmptySection
          title="Cycle-count projection unavailable"
          detail="Internal did not return this read model. No local count history is shown as a substitute."
        />
      ) : rows.length === 0 ? (
        <EmptySection
          title="No cycle counts"
          detail="No cycle-count records have been returned for the current account scope."
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualRows
            rows={rows}
            rowKey={(row) => row.id}
            columns={CYCLE_COUNT_COLUMNS}
            rowHeight={50}
            className="min-w-[760px]"
            onRowClick={(row) => onOpen(row)}
            header={
              <>
                <span className="pl-3.5">Count</span>
                <span className="px-3">Scope</span>
                <span className="px-3">Sample</span>
                <span className="px-3">Status</span>
                <span className="pr-3.5 pl-3">Created</span>
              </>
            }
            renderRow={(row) => (
              <>
                <span role="gridcell" className="pl-3.5">
                  <button
                    type="button"
                    className={cn(
                      "text-left font-mono text-[11.5px] font-medium text-ink underline-offset-2",
                      underlineOnRowHover
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(row)
                    }}
                  >
                    {row.id}
                  </button>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {row.sampleStrategy} · {row.initiatedBy}
                  </span>
                </span>
                <span role="gridcell" className="px-3 text-[11.5px] text-ink-2">
                  <span className="block truncate">{row.scope}</span>
                  {row.targetStoreIds.length > 0 && (
                    <span className="block truncate text-[10.5px] text-ink-4">
                      {row.targetStoreIds.join(", ")}
                    </span>
                  )}
                </span>
                <span role="gridcell" className="px-3 font-mono text-[11.5px] text-ink-2">
                  {row.sampleSize.toLocaleString()} SKU
                  {row.sampleSize === 1 ? "" : "s"}
                </span>
                <span role="gridcell" className="px-3">
                  <CellStatus value={row.status} />
                </span>
                <span role="gridcell" className="pr-3.5 pl-3 font-mono text-[11px] text-ink-3">
                  {dateLabel(row.createdAt)}
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  )
}

function receivingStageLabel(stage: number): string {
  switch (stage) {
    case 1:
      return "GRN logged"
    case 2:
      return "Variant split"
    case 3:
      return "RFID print"
    case 4:
      return "RFID bind"
    case 5:
      return "Closed"
    default:
      return stage > 0 ? `Stage ${stage}` : "Unknown stage"
  }
}

function ReceivingBatches({ rows }: { rows: HoReceivingBatch[] | null }) {
  const ordered = useMemo(
    () =>
      rows
        ? [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [],
    [rows]
  )
  return (
    <section className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <SectionHeading
        title="HO receiving batches"
        count={rows?.length ?? null}
      />
      {rows === null ? (
        <EmptySection
          title="Receiving batch queue unavailable"
          detail="Internal did not return the HO inventory-processing queue. No local receiving state is shown as a substitute."
        />
      ) : rows.length === 0 ? (
        <EmptySection
          title="No receiving batches"
          detail="No HO receiving batches have been returned for the current account scope."
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualRows
            rows={ordered}
            rowKey={(row) => row.id}
            columns={RECEIVING_BATCH_COLUMNS}
            rowHeight={50}
            className="min-w-[850px]"
            header={
              <>
                <span className="pl-3.5">Batch</span>
                <span className="px-3">PO / GRN</span>
                <span className="px-3">Supplier</span>
                <span className="px-3">Stage</span>
                <span className="px-3 text-right">Bound / total</span>
                <span className="pr-3.5 pl-3">Updated</span>
              </>
            }
            renderRow={(row) => (
              <>
                <span role="gridcell" className="pl-3.5">
                  <span className="block truncate font-mono text-[11px] text-ink-2">
                    {row.id}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {row.metaComplete
                      ? "Metadata complete"
                      : "Metadata incomplete"}
                  </span>
                </span>
                <span role="gridcell" className="px-3">
                  <span className="block truncate font-mono text-[11px] text-ink-2">
                    {row.poId}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {row.grnId}
                  </span>
                </span>
                <span role="gridcell" className="truncate px-3 font-mono text-[11px] text-ink-2">
                  {row.supplierId}
                </span>
                <span role="gridcell" className="px-3">
                  <span
                    className={cn(
                      "text-[11.5px] font-medium",
                      row.stage === 5 ? "text-grass" : "text-honey"
                    )}
                  >
                    {receivingStageLabel(row.stage)}
                  </span>
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-[11.5px] text-ink-2">
                  {row.boundCount.toLocaleString()} /{" "}
                  {row.totalUnits.toLocaleString()}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3 font-mono text-[11px] text-ink-3">
                  {dateLabel(row.updatedAt)}
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  )
}

function DcOperations({ rows }: { rows: DcOperation[] | null }) {
  const ordered = useMemo(
    () =>
      rows
        ? [...rows].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        : [],
    [rows]
  )
  return (
    <section className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <SectionHeading
        title="DC outbound projection"
        count={rows?.length ?? null}
      />
      {rows === null ? (
        <EmptySection
          title="DC outbound projection unavailable"
          detail="Internal has no command surface for picking, packing, or dispatch here; this section only reads synced DC edge events."
        />
      ) : rows.length === 0 ? (
        <EmptySection
          title="No DC operation events"
          detail="The cloud projection has not received picking, packing, or shipment events for this scope."
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualRows
            rows={ordered}
            rowKey={(row) => `${row.operationType}:${row.dcId}:${row.entityId}`}
            columns={DC_OPERATION_COLUMNS}
            rowHeight={50}
            className="min-w-[820px]"
            header={
              <>
                <span className="pl-3.5">Stage</span>
                <span className="px-3">Entity</span>
                <span className="px-3">Status</span>
                <span className="px-3">Destination</span>
                <span className="px-3 text-right">Count</span>
                <span className="pr-3.5 pl-3">Event time</span>
              </>
            }
            renderRow={(row) => (
              <>
                <span role="gridcell" className="pl-3.5 text-[11.5px] text-ink-2">
                  {row.operationType === "picking_wave"
                    ? "Picking wave"
                    : row.operationType === "packing"
                      ? "Packing"
                      : row.operationType === "shipment"
                        ? "Shipment"
                        : statusLabel(row.operationType)}
                </span>
                <span role="gridcell" className="px-3">
                  <span className="block truncate font-mono text-[11px] text-ink-2">
                    {row.entityId}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {row.dcId}
                  </span>
                </span>
                <span role="gridcell" className="px-3">
                  <CellStatus value={row.status} />
                  {row.missingCount > 0 && (
                    <span className="block text-[10.5px] text-ember">
                      {row.missingCount} missing
                    </span>
                  )}
                </span>
                <span role="gridcell" className="truncate px-3 text-[11.5px] text-ink-3">
                  {row.destination || "—"}
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-[11.5px] text-ink-2">
                  {row.itemCount.toLocaleString()}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3 font-mono text-[11px] text-ink-3">
                  {dateLabel(row.occurredAt)}
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  )
}

function InboundReturns({
  rows,
  onOpen,
}: {
  rows: InboundReturnOperation[] | null
  onOpen: (row: InboundReturnOperation) => void
}) {
  return (
    <section className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <SectionHeading
        title="Inbound supplier returns"
        count={rows?.length ?? null}
      />
      {rows === null ? (
        <EmptySection
          title="Supplier-return projection unavailable"
          detail="Internal did not return the inbound-return queue. No static return records are shown."
        />
      ) : rows.length === 0 ? (
        <EmptySection
          title="No inbound returns"
          detail="No store-to-HO return records have been returned for the current account scope."
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualRows
            rows={rows}
            rowKey={(row) => row.id}
            columns={INBOUND_RETURN_COLUMNS}
            rowHeight={50}
            className="min-w-[820px]"
            onRowClick={(row) => onOpen(row)}
            header={
              <>
                <span className="pl-3.5">Return</span>
                <span className="px-3">Store</span>
                <span className="px-3">Reason</span>
                <span className="px-3">Status</span>
                <span className="px-3 text-right">Items</span>
                <span className="pr-3.5 pl-3">Received</span>
              </>
            }
            renderRow={(row) => (
              <>
                <span role="gridcell" className="pl-3.5">
                  <button
                    type="button"
                    className={cn(
                      "text-left font-mono text-[11.5px] font-medium text-ink underline-offset-2",
                      underlineOnRowHover
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(row)
                    }}
                  >
                    {row.returnNumber}
                  </button>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {row.id}
                  </span>
                </span>
                <span role="gridcell" className="truncate px-3 font-mono text-[11px] text-ink-2">
                  {row.storeId}
                </span>
                <span role="gridcell" className="truncate px-3 text-[11.5px] text-ink-3">
                  {row.reason}
                </span>
                <span role="gridcell" className="px-3">
                  <CellStatus value={row.status} />
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-[11.5px] text-ink-2">
                  {row.itemsCount.toLocaleString()}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3 font-mono text-[11px] text-ink-3">
                  {dateLabel(row.receivedAt)}
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  )
}

function DetailBody({ detail }: { detail: Detail }) {
  if (detail.kind === "count") {
    return (
      <div className="space-y-4 px-[18px] pt-4 pb-[18px]">
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Items", detail.value.totalItems],
            ["Counted", detail.value.countedItems],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
            >
              <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                {label}
              </div>
              <div className="font-mono text-[15px] text-ink">
                {String(value)}
              </div>
            </div>
          ))}
        </div>
        {detail.value.items.length === 0 ? (
          <EmptySection
            title="No count lines"
            detail="Internal returned no item-level variance rows for this count."
          />
        ) : (
          <div className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="grid grid-cols-[minmax(0,1fr)_70px_70px_70px] gap-2 border-b border-line bg-inset px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              <span>SKU</span>
              <span className="text-right">Book</span>
              <span className="text-right">Count</span>
              <span className="text-right">Variance</span>
            </div>
            <div className="max-h-[360px] overflow-auto">
              {detail.value.items.map((item) => {
                const variance =
                  item.variance ??
                  (item.countedQty === undefined
                    ? undefined
                    : item.countedQty - item.expectedQty)
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[minmax(0,1fr)_70px_70px_70px] gap-2 border-b border-line px-3 py-2 last:border-b-0"
                  >
                    <span className="truncate font-mono text-[11px] text-ink-2">
                      {item.sku}
                    </span>
                    <span className="text-right font-mono text-[11px] text-ink-3">
                      {item.expectedQty}
                    </span>
                    <span className="text-right font-mono text-[11px] text-ink-3">
                      {item.countedQty ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "text-right font-mono text-[11px]",
                        variance === undefined
                          ? "text-ink-4"
                          : variance < 0
                            ? "text-ember"
                            : variance > 0
                              ? "text-grass"
                              : "text-ink-4"
                      )}
                    >
                      {variance === undefined
                        ? "—"
                        : `${variance > 0 ? "+" : ""}${variance}`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 px-[18px] pt-4 pb-[18px]">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Store", detail.value.storeId],
          ["Status", statusLabel(detail.value.status)],
          ["Items", detail.value.itemsCount],
          ["Received", dateLabel(detail.value.receivedAt)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {label}
            </div>
            <div className="truncate text-[12px] text-ink">{String(value)}</div>
          </div>
        ))}
      </div>
      {detail.value.inspectorNotes && (
        <div className="rounded-panel bg-honey/10 px-3 py-2.5 text-[11.5px] leading-[1.45] text-ink-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--honey)_30%,transparent)]">
          {detail.value.inspectorNotes}
        </div>
      )}
      {detail.value.items.length === 0 ? (
        <EmptySection
          title="No return lines"
          detail="Internal returned no item-level lines for this inbound return."
        />
      ) : (
        <div className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="grid grid-cols-[minmax(0,1fr)_55px_88px_120px] gap-2 border-b border-line bg-inset px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
            <span>SKU</span>
            <span className="text-right">Qty</span>
            <span>Condition</span>
            <span>Disposition</span>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {detail.value.items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_55px_88px_120px] gap-2 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="truncate font-mono text-[11px] text-ink-2">
                  {item.sku}
                </span>
                <span className="text-right font-mono text-[11px] text-ink-3">
                  {item.qty}
                </span>
                <span className="truncate text-[11px] text-ink-3">
                  {item.condition || "—"}
                </span>
                <span className="truncate text-[11px] text-ink-3">
                  {item.disposition || "Pending inspection"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-[1.45] text-ink-4">
        The detail is sourced from Internal. Inventory changes are made only by
        its inspection/disposal workflow; no stock movement is inferred in the
        browser.
      </p>
    </div>
  )
}

function ReturnActions({
  detail,
  dispositions,
  notes,
  busy,
  error,
  onDispositionChange,
  onNotesChange,
  onPickup,
  onInspect,
  onDispose,
}: {
  detail: InboundReturnDetail
  dispositions: Partial<Record<string, ReturnDisposition>>
  notes: string
  busy: "pickup" | "inspect" | "dispose" | null
  error: string | null
  onDispositionChange: (itemID: string, value: ReturnDisposition) => void
  onNotesChange: (value: string) => void
  onPickup: () => void
  onInspect: () => void
  onDispose: () => void
}) {
  const status = detail.status.toLowerCase()
  const final = ["restocked", "returned_to_supplier", "cancelled"].includes(
    status
  )
  const canInspect =
    ["received", "requested", "pending_approval", "picked_up"].includes(
      status
    ) && detail.items.length > 0
  const canDispose = status === "inspected"
  const canPickup = ["received", "requested", "pending_approval"].includes(
    status
  )

  if (final) {
    return (
      <p className="text-[11px] leading-[1.45] text-ink-4">
        This return is already finalised. No further inventory action is
        available from this screen.
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-panel bg-inset p-3 shadow-[inset_0_0_0_1px_var(--line)]">
      <div>
        <div className="text-[11.5px] font-semibold text-ink">
          Return workflow
        </div>
        <p className="pt-1 text-[10.5px] leading-[1.45] text-ink-4">
          Inspection records one disposition per line. Dispose is the
          irreversible backend step that posts restock or write-off movements.
        </p>
      </div>

      {canInspect && (
        <>
          <div className="space-y-2">
            {detail.items.map((item) => (
              <label
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_155px] items-center gap-2 text-[11px]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-ink-2">
                    {item.sku}
                  </span>
                  <span className="block text-ink-4">
                    {item.qty.toLocaleString()} unit
                  </span>
                </span>
                <select
                  value={dispositions[item.id] ?? ""}
                  onChange={(event) =>
                    onDispositionChange(
                      item.id,
                      event.target.value as ReturnDisposition
                    )
                  }
                  className="h-[30px] rounded-control bg-field px-2 text-[11px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                  aria-label={`Disposition for ${item.sku}`}
                >
                  <option value="">Select disposition</option>
                  {RETURN_DISPOSITIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Inspection notes (optional)"
            rows={2}
            className="w-full resize-y rounded-control bg-field px-2.5 py-2 text-[11px] leading-[1.4] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={onInspect}
            className="inline-flex h-[30px] items-center rounded-control bg-ink px-2.5 text-[11px] font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
          >
            {busy === "inspect" ? "Saving inspection…" : "Record inspection"}
          </button>
        </>
      )}

      {canDispose && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={onDispose}
          className="inline-flex h-[30px] items-center rounded-control bg-ember px-2.5 text-[11px] font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
        >
          {busy === "dispose" ? "Posting disposition…" : "Dispose return"}
        </button>
      )}

      {canPickup && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={onPickup}
          className="inline-flex h-[30px] items-center rounded-control bg-surface px-2.5 text-[11px] font-medium text-ink shadow-btn transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
        >
          {busy === "pickup" ? "Updating…" : "Schedule pickup"}
        </button>
      )}

      {error && (
        <div className="rounded-panel bg-ember/5 px-2.5 py-2 text-[11px] leading-[1.45] text-ember shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ember)_24%,transparent)]">
          {error}
        </div>
      )}
    </div>
  )
}

export function InventoryOperations() {
  const resource = useInventoryOperations(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [returnDispositions, setReturnDispositions] = useState<
    Partial<Record<string, ReturnDisposition>>
  >({})
  const [returnNotes, setReturnNotes] = useState("")
  const [returnActionError, setReturnActionError] = useState<string | null>(
    null
  )
  const schedulePickup = useScheduleInboundReturnPickup()
  const inspectReturn = useInspectInboundReturn()
  const disposeReturn = useDisposeInboundReturn()
  const returnBusy = schedulePickup.isPending
    ? "pickup"
    : inspectReturn.isPending
      ? "inspect"
      : disposeReturn.isPending
        ? "dispose"
        : null

  useEffect(() => {
    if (!selection) return
    const controller = new AbortController()
    let active = true
    if (selection.kind === "count") {
      fetchCycleCountVariance(selection.row.id, controller.signal).then(
        (value) => {
          if (active) setDetail({ kind: "count", value })
        },
        (error: unknown) => {
          if (
            active &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setDetailError(
              error instanceof Error
                ? error.message
                : "Unable to load count detail."
            )
          }
        }
      )
    } else {
      fetchInboundReturnDetail(selection.row.id, controller.signal).then(
        (value) => {
          if (active) setDetail({ kind: "return", value })
        },
        (error: unknown) => {
          if (
            active &&
            !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setDetailError(
              error instanceof Error
                ? error.message
                : "Unable to load return detail."
            )
          }
        }
      )
    }
    return () => {
      active = false
      controller.abort()
    }
  }, [selection])

  const openDetail = (next: Selection) => {
    setSelection(next)
    setDetail(null)
    setDetailError(null)
    setReturnDispositions({})
    setReturnNotes("")
    setReturnActionError(null)
  }

  const runReturnAction = async (action: "pickup" | "inspect" | "dispose") => {
    if (!selection || selection.kind !== "return" || returnBusy) return
    const returnID = selection.row.id
    const returnDetail = detail?.kind === "return" ? detail.value : null
    if (!returnDetail) return
    setReturnActionError(null)
    if (action === "inspect") {
      const missing = returnDetail.items.find(
        (item) => !item.id || !returnDispositions[item.id]
      )
      if (missing) {
        setReturnActionError(
          "Select a disposition for every return line before recording inspection."
        )
        return
      }
    }
    if (action === "dispose") {
      if (returnDetail.status.toLowerCase() !== "inspected") {
        setReturnActionError(
          "Internal only allows disposal after the return is inspected."
        )
        return
      }
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Dispose this return? Internal will post restock/write-off movements and this cannot be undone."
        )
      ) {
        return
      }
    }
    try {
      if (action === "pickup") {
        await schedulePickup.mutateAsync(returnID)
      } else if (action === "inspect") {
        await inspectReturn.mutateAsync({
          id: returnID,
          inspection: {
            inspectorNotes: returnNotes.trim() || undefined,
            items: returnDetail.items.map((item) => ({
              id: item.id,
              sku: item.sku,
              qty: item.qty,
              name: item.name || undefined,
              condition: item.condition || undefined,
              disposition: returnDispositions[item.id] as ReturnDisposition,
            })),
          },
        })
      } else {
        await disposeReturn.mutateAsync(returnID)
      }
      /* Each mutation invalidates the operations worklist and this return's
       * own detail itself, so there is no resource.reload() here. */
      setSelection(null)
    } catch (error: unknown) {
      setReturnActionError(
        error instanceof Error
          ? error.message
          : "Internal could not complete this return action."
      )
    }
  }

  const snapshot = resource.data
  const totalRows = snapshot
    ? (snapshot.cycleCounts?.length ?? 0) +
      (snapshot.dcOperations?.length ?? 0) +
      (snapshot.receivingBatches?.length ?? 0) +
      (snapshot.inboundReturns?.length ?? 0)
    : null

  return (
    <div className="p-3.5">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold tracking-[-0.01em] text-ink">
            Physical operations
          </h1>
          <p className="pt-1 text-[11.5px] leading-[1.45] text-ink-3">
            Live read models from Internal, with supplier-return actions routed
            through its authoritative inspection and disposal workflows.
          </p>
        </div>
        <button
          type="button"
          onClick={resource.reload}
          disabled={resource.status === "loading"}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-50"
        >
          <Icon path={paths.arrowUp} size={13} width={2} />
          {resource.status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <StoreReceiving />

      {resource.status === "loading" && (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center text-ink-4">
          <span className="size-4 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
          <span className="text-xs text-ink-2">
            Loading physical operations
          </span>
          <span className="max-w-[440px] text-[11px]">
            Reading cycle counts, DC edge projections, and inbound returns from
            Internal.
          </span>
        </div>
      )}
      {resource.status === "error" && (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center">
          <Icon
            path={paths.alert}
            size={18}
            width={1.8}
            className="text-ember"
          />
          <span className="text-xs font-medium text-ink-2">
            Physical operations could not be loaded
          </span>
          <span className="max-w-[460px] text-[11px] leading-[1.45] text-ink-4">
            {resource.errorMessage}
          </span>
          <button
            type="button"
            onClick={resource.reload}
            className="mt-1 inline-flex h-[28px] items-center rounded-control bg-ink px-2.5 text-[11px] font-medium text-surface hover:opacity-85"
          >
            Retry
          </button>
        </div>
      )}
      {resource.status === "success" && snapshot && (
        <>
          <div className="mb-3.5 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Cycle counts", snapshot.cycleCounts?.length ?? null],
              ["DC projection rows", snapshot.dcOperations?.length ?? null],
              ["Receiving batches", snapshot.receivingBatches?.length ?? null],
              ["Inbound returns", snapshot.inboundReturns?.length ?? null],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                  {label}
                </div>
                <div className="font-mono text-[15px] text-ink">
                  {value === null ? "—" : String(value)}
                </div>
              </div>
            ))}
          </div>
          {Object.entries(snapshot.errors).map(([key, message]) => (
            <SourceError
              key={key}
              message={`${statusLabel(key)}: ${message}`}
            />
          ))}
          <div className="space-y-3.5">
            <CycleCounts
              rows={snapshot.cycleCounts}
              onOpen={(row) => openDetail({ kind: "count", row })}
            />
            <ReceivingBatches rows={snapshot.receivingBatches} />
            <DcOperations rows={snapshot.dcOperations} />
            <InboundReturns
              rows={snapshot.inboundReturns}
              onOpen={(row) => openDetail({ kind: "return", row })}
            />
          </div>
          <p className="pt-3 text-[10.5px] text-ink-4">
            {totalRows === null
              ? ""
              : `${totalRows.toLocaleString()} projection rows loaded`}{" "}
            · fetched {dateLabel(snapshot.fetchedAt)}
          </p>
          <div className="mt-3.5 flex items-start gap-2 rounded-panel bg-honey/10 px-3 py-2.5 text-[11px] leading-[1.45] text-ink-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--honey)_30%,transparent)]">
            <Icon
              path={paths.alert}
              size={14}
              width={1.8}
              className="mt-px shrink-0 text-honey"
            />
            <span>
              Store receiving is shown above against the store-router contract.
              The DC outbound section is a projection of picking, packing, and
              shipment events the DC node emits; cloud-hub exposes no command to
              start or advance that work, so every section here is read-only
              apart from the supplier-return actions.
            </span>
          </div>
        </>
      )}

      <SheetShell
        open={selection !== null}
        eyebrow={
          selection?.kind === "count"
            ? "Cycle-count detail"
            : "Inbound-return detail"
        }
        title={
          selection?.kind === "count"
            ? selection.row.id
            : (selection?.row.returnNumber ?? "")
        }
        onRequestClose={() => setSelection(null)}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setSelection(null)}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {!detail && !detailError && (
          <div className="flex min-h-[220px] items-center justify-center gap-2 text-xs text-ink-4">
            <span className="size-3.5 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
            Loading detail…
          </div>
        )}
        {detailError && <SourceError message={detailError} />}
        {detail && <DetailBody detail={detail} />}
        {detail?.kind === "return" && (
          <div className="px-[18px] pb-[18px]">
            <ReturnActions
              detail={detail.value}
              dispositions={returnDispositions}
              notes={returnNotes}
              busy={returnBusy}
              error={returnActionError}
              onDispositionChange={(itemID, value) =>
                setReturnDispositions((current) => ({
                  ...current,
                  [itemID]: value,
                }))
              }
              onNotesChange={setReturnNotes}
              onPickup={() => void runReturnAction("pickup")}
              onInspect={() => void runReturnAction("inspect")}
              onDispose={() => void runReturnAction("dispose")}
            />
          </div>
        )}
      </SheetShell>
    </div>
  )
}
