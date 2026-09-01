/*
 * Store receiving owns the store-router receiving workflow in the Slowdown
 * client. It deliberately uses the store API (not the cloud projection): a
 * receipt is a single atomic backend command that changes store stock, so the
 * UI never manufactures a local receipt or silently falls back to fixtures.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { getErrorMessage, isApiError, qs, storeApi } from "@/lib/api"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { useAppForm, useSheetForm } from "@/shared/form"

const RECEIVING_COLUMNS = "190px 180px 100px 135px 125px minmax(0,1fr)"

/* The row-hover reveal (`group-hover/row:underline`) elsewhere in the app
 * depends on a `group/row` class on the `<tr>`. VirtualRows' row wrapper
 * carries no such class, but it always sets `role="row"`, which is enough to
 * key off of with an arbitrary variant — the same ancestor-selector idiom
 * already used in ui/sidebar.tsx (`[[data-side=left]_&]:...`). */
const underlineOnRowHover = "[[role=row]:hover_&]:underline"

export interface StoreReceivingRecord {
  id: number
  receivingId: string
  storeId: string
  manifestId: string
  supplierName: string
  referenceNo: string
  status: string
  totalSku: number
  totalQty: number
  receivedBy: string
  notes: string
  receivedAt: string
  completedAt: string
  hasShortage: boolean
  shortageCount: number
  grnNumber: string
  manifestSjNumber: string
  cartonCountExpected: number
  cartonCountActual: number
}

export interface StoreReceivingItem {
  id: number
  itemKey: string
  receivingId: string
  sku: string
  expectedQty: number
  receivedQty: number
  damagedQty: number
  acceptedQty: number
  missingQty: number
  notes: string
  scannedEpcs: string[]
}

export interface StoreReceivingDetail {
  receiving: StoreReceivingRecord
  items: StoreReceivingItem[]
}

interface StoreReceivingSnapshot {
  records: StoreReceivingRecord[] | null
  pending: StoreReceivingRecord[] | null
  errors: Partial<Record<"records" | "pending", string>>
  fetchedAt: string
}

type ResourceState =
  | { status: "loading"; data: null; error: null; reload: () => void }
  | {
      status: "ready"
      data: StoreReceivingSnapshot
      error: null
      reload: () => void
    }
  | { status: "error"; data: null; error: string; reload: () => void }

/** What the store router accepts for a receipt line — the entered values, not
 *  a local balance. Quantities are `number | undefined` rather than a string,
 *  because that is what `NumberField` binds to; an empty box is "not typed",
 *  never a silent zero. */
const receivingLineInput = z.object({
  sku: z.string(),
  expectedQty: z.number().int().min(0).optional(),
  receivedQty: z.number().int().min(0).optional(),
  damagedQty: z.number().int().min(0).optional(),
  notes: z.string(),
})

/** What the store router's atomic receiving command accepts. Cross-line rules
 *  (duplicate SKUs, a receipt with no positive received quantity) cannot be
 *  expressed on one field, so they are `superRefine`d onto the field that
 *  caused them — a line's `sku` or `receivedQty` — instead of one blob above
 *  the sheet. */
const receivingCreateInput = z
  .object({
    supplierName: z.string().trim().min(1, "Supplier name is required."),
    referenceNo: z.string(),
    receivedBy: z.string().trim().min(1, "Received by is required."),
    notes: z.string(),
    items: z.array(receivingLineInput).min(1, "Add at least one receiving line."),
  })
  .superRefine((value, ctx) => {
    const seenSkus = new Set<string>()
    let receivedTotal = 0
    value.items.forEach((line, index) => {
      const sku = line.sku.trim()
      if (!sku) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "sku"],
          message: `SKU is required on line ${index + 1}.`,
        })
        return
      }
      const key = sku.toLowerCase()
      if (seenSkus.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "sku"],
          message: `SKU ${sku} is duplicated; combine it into one line.`,
        })
      }
      seenSkus.add(key)
      const expectedQty = line.expectedQty ?? 0
      const receivedQty = line.receivedQty ?? 0
      const damagedQty = line.damagedQty ?? 0
      if (expectedQty > 0 && receivedQty > expectedQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "receivedQty"],
          message: `Received quantity cannot exceed expected quantity for ${sku}.`,
        })
      }
      if (damagedQty > receivedQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "damagedQty"],
          message: `Damaged quantity cannot exceed received quantity for ${sku}.`,
        })
      }
      receivedTotal += receivedQty
    })
    if (receivedTotal <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "At least one line must have a positive received quantity.",
      })
    }
  })

type ReceivingLineDraft = z.infer<typeof receivingLineInput>
type ReceivingCreateDraft = z.infer<typeof receivingCreateInput>

const EMPTY_LINE: ReceivingLineDraft = {
  sku: "",
  expectedQty: undefined,
  receivedQty: undefined,
  damagedQty: 0,
  notes: "",
}

const initialDraft = (): ReceivingCreateDraft => ({
  supplierName: "",
  referenceNo: "",
  receivedBy: "",
  notes: "",
  items: [{ ...EMPTY_LINE }],
})

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

function integer(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return fallback
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true"
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseReceiving(value: unknown): StoreReceivingRecord {
  const record = asRecord(value)
  if (!record)
    throw new Error("Store router returned an invalid receiving row.")
  const receivingId = text(record.receiving_id) || text(record.id)
  if (!receivingId) {
    throw new Error("Store router returned a receiving row without an id.")
  }
  return {
    id: integer(record.id),
    receivingId,
    storeId: text(record.store_id, "—"),
    manifestId: text(record.manifest_id),
    supplierName: text(record.supplier_name, "—"),
    referenceNo: text(record.reference_no),
    status: text(record.status, "unknown"),
    totalSku: integer(record.total_sku),
    totalQty: integer(record.total_qty),
    receivedBy: text(record.received_by, "—"),
    notes: text(record.notes),
    receivedAt: text(record.received_at),
    completedAt: text(record.completed_at),
    hasShortage: booleanValue(record.has_shortage),
    shortageCount: integer(record.shortage_count),
    grnNumber: text(record.grn_number),
    manifestSjNumber: text(record.manifest_sj_number),
    cartonCountExpected: integer(record.carton_count_expected),
    cartonCountActual: integer(record.carton_count_actual),
  }
}

function parseReceivingItem(value: unknown): StoreReceivingItem {
  const record = asRecord(value)
  if (!record)
    throw new Error("Store router returned an invalid receiving item.")
  return {
    id: integer(record.id),
    itemKey: text(record.item_key),
    receivingId: text(record.receiving_id),
    sku: text(record.sku, "—"),
    expectedQty: integer(record.expected_qty),
    receivedQty: integer(record.received_qty),
    damagedQty: integer(record.damaged_qty),
    acceptedQty: integer(record.accepted_qty),
    missingQty: integer(record.missing_qty),
    notes: text(record.notes),
    scannedEpcs: arrayValue(record.scanned_epcs).filter(
      (item): item is string => typeof item === "string"
    ),
  }
}

function parseDetail(value: unknown): StoreReceivingDetail {
  const record = asRecord(value)
  if (!record)
    throw new Error("Store router returned an invalid receiving detail.")
  const receiving = parseReceiving(record.receiving ?? record)
  return {
    receiving,
    items: arrayValue(record.items).map(parseReceivingItem),
  }
}

function parseList(
  value: unknown,
  key: "items" | "deliveries"
): StoreReceivingRecord[] {
  const record = asRecord(value)
  const rows = record ? record[key] : value
  return arrayValue(rows).map(parseReceiving)
}

async function fetchStoreReceiving(
  signal: AbortSignal
): Promise<StoreReceivingSnapshot> {
  const results = await Promise.allSettled([
    storeApi.get<unknown>(`/v1/receiving/list${qs({ limit: 50 })}`, { signal }),
    storeApi.get<unknown>("/v1/receiving/pending", { signal }),
  ])
  if (signal.aborted) {
    throw new DOMException("The request was cancelled", "AbortError")
  }

  const errors: StoreReceivingSnapshot["errors"] = {}
  let firstFailure: unknown
  const read = (
    index: number,
    key: keyof StoreReceivingSnapshot["errors"]
  ): unknown => {
    const result = results[index]
    if (result.status === "fulfilled") return result.value
    firstFailure ??= result.reason
    errors[key] = getErrorMessage(result.reason, "Store router request failed.")
    return null
  }

  const listPayload = read(0, "records")
  const pendingPayload = read(1, "pending")
  let records: StoreReceivingRecord[] | null = null
  let pending: StoreReceivingRecord[] | null = null

  if (listPayload !== null) {
    try {
      records = parseList(listPayload, "items")
    } catch (error: unknown) {
      errors.records = getErrorMessage(
        error,
        "Store router returned invalid receiving rows."
      )
    }
  }
  if (pendingPayload !== null) {
    try {
      pending = parseList(pendingPayload, "deliveries")
    } catch (error: unknown) {
      errors.pending = getErrorMessage(
        error,
        "Store router returned invalid pending rows."
      )
    }
  }

  if (records === null && pending === null) {
    throw (
      firstFailure ??
      new Error(Object.values(errors)[0] ?? "Store receiving is unavailable.")
    )
  }

  return { records, pending, errors, fetchedAt: new Date().toISOString() }
}

async function fetchStoreReceivingDetail(
  receivingId: string,
  signal?: AbortSignal
): Promise<StoreReceivingDetail> {
  const payload = await storeApi.get<unknown>(
    `/v1/receiving/${encodeURIComponent(receivingId)}`,
    signal ? { signal } : undefined
  )
  return parseDetail(payload)
}

export interface StoreReceivingCreateInput {
  supplierName: string
  referenceNo?: string
  receivedBy: string
  notes?: string
  items: Array<{
    sku: string
    expectedQty: number
    receivedQty: number
    damagedQty: number
    notes?: string
  }>
}

async function createStoreReceiving(
  input: StoreReceivingCreateInput,
  signal?: AbortSignal
): Promise<StoreReceivingDetail> {
  const payload = await storeApi.post<unknown>(
    "/v1/receiving/create",
    {
      supplier_name: input.supplierName,
      ...(input.referenceNo ? { reference_no: input.referenceNo } : {}),
      received_by: input.receivedBy,
      ...(input.notes ? { notes: input.notes } : {}),
      items: input.items.map((item) => ({
        sku: item.sku,
        expected_qty: item.expectedQty,
        received_qty: item.receivedQty,
        damaged_qty: item.damagedQty,
        ...(item.notes ? { notes: item.notes } : {}),
      })),
    },
    signal ? { signal } : undefined
  )
  return parseDetail(payload)
}

function formatDate(value: string): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value.slice(0, 16)
    : date.toLocaleString()
}

function statusLabel(value: string): string {
  return value
    ? value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Unknown"
}

function statusClass(value: string): string {
  const normalized = value.toLowerCase()
  if (["completed", "received"].includes(normalized)) return "text-grass"
  if (["pending", "in_progress", "draft"].includes(normalized))
    return "text-honey"
  if (["cancelled", "rejected"].includes(normalized)) return "text-ember"
  return "text-ink-3"
}

function ErrorState({ message }: { message: string }) {
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

function ReceivingTable({
  title,
  rows,
  onOpen,
}: {
  title: string
  rows: StoreReceivingRecord[] | null
  onOpen: (row: StoreReceivingRecord) => void
}) {
  return (
    <section className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
        <h2 className="text-xs font-semibold text-ink">{title}</h2>
        <span className="font-mono text-[10.5px] text-ink-4">
          {rows === null ? "—" : rows.length.toLocaleString()}
        </span>
      </div>
      {rows === null ? (
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-1.5 px-6 text-center text-ink-4">
          <span className="font-mono text-sm">—</span>
          <span className="text-xs font-medium text-ink-2">
            Feed unavailable
          </span>
          <span className="max-w-[500px] text-[11px] leading-[1.45]">
            No local receipt state is shown when the store router cannot be
            read.
          </span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-1.5 px-6 text-center text-ink-4">
          <span className="font-mono text-sm">—</span>
          <span className="text-xs font-medium text-ink-2">
            No receipts returned
          </span>
          <span className="text-[11px] leading-[1.45]">
            The store router answered successfully, but this feed is empty.
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <VirtualRows
            rows={rows}
            rowKey={(row) => row.receivingId}
            columns={RECEIVING_COLUMNS}
            rowHeight={54}
            className="min-w-[820px]"
            onRowClick={(row) => onOpen(row)}
            header={
              <>
                <span className="pl-3.5">Receipt / GRN</span>
                <span className="px-3">Supplier / reference</span>
                <span className="px-3">Status</span>
                <span className="px-3 text-right">SKU / units</span>
                <span className="px-3 text-right">Shortage</span>
                <span className="pr-3.5 pl-3">Received</span>
              </>
            }
            renderRow={(row) => (
              <>
                <span role="gridcell" className="pl-3.5">
                  <button
                    type="button"
                    className={cn(
                      "text-left font-mono text-[11px] font-medium text-ink underline-offset-2",
                      underlineOnRowHover
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpen(row)
                    }}
                  >
                    {row.receivingId}
                  </button>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {row.grnNumber || "No GRN number"}
                  </span>
                </span>
                <span role="gridcell" className="px-3">
                  <span className="block truncate text-[11.5px] text-ink-2">
                    {row.supplierName || "—"}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {row.referenceNo || row.manifestId || "No reference"}
                  </span>
                </span>
                <span role="gridcell" className="px-3">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-[11.5px] font-medium",
                      statusClass(row.status)
                    )}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {statusLabel(row.status)}
                  </span>
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-[11.5px] text-ink-2">
                  {row.totalSku.toLocaleString()} /{" "}
                  {row.totalQty.toLocaleString()}
                </span>
                <span
                  role="gridcell"
                  className={cn(
                    "px-3 text-right font-mono text-[11.5px]",
                    row.hasShortage ? "text-ember" : "text-ink-4"
                  )}
                >
                  {row.hasShortage ? row.shortageCount.toLocaleString() : "—"}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3 font-mono text-[11px] text-ink-3">
                  {formatDate(row.receivedAt)}
                </span>
              </>
            )}
          />
        </div>
      )}
    </section>
  )
}

function DetailSheet({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: StoreReceivingDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <SheetShell
      open={detail !== null || loading || error !== null}
      eyebrow="Store receiving"
      title={detail?.receiving.receivingId ?? "Loading receipt"}
      onRequestClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className={sheetButton.secondary}
          >
            Close
          </button>
        </>
      }
    >
      {loading && (
        <div className="flex min-h-[220px] items-center justify-center gap-2 text-xs text-ink-4">
          <span className="size-4 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
          Loading receipt detail…
        </div>
      )}
      {error && <ErrorState message={error} />}
      {detail && !loading && (
        <div className="space-y-3.5 px-[18px] pt-4 pb-[18px]">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Supplier", detail.receiving.supplierName || "—"],
              [
                "Reference",
                detail.receiving.referenceNo ||
                  detail.receiving.manifestId ||
                  "—",
              ],
              ["Received by", detail.receiving.receivedBy],
              ["Received", formatDate(detail.receiving.receivedAt)],
              ["GRN", detail.receiving.grnNumber || "—"],
              ["Store", detail.receiving.storeId],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-panel bg-inset px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                <div className="pb-1 text-[10px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                  {label}
                </div>
                <div className="truncate text-[11.5px] text-ink-2">{value}</div>
              </div>
            ))}
          </div>
          {detail.receiving.notes && (
            <div className="rounded-panel bg-inset px-2.5 py-2 text-[11px] leading-[1.45] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
              {detail.receiving.notes}
            </div>
          )}
          <div className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="border-b border-line bg-inset px-3 py-2 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              Received lines
            </div>
            {detail.items.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-ink-4">
                No item lines returned.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-[10px] [&>th]:font-semibold [&>th]:text-ink-4 [&>th]:uppercase">
                      <th>SKU</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right">Received</th>
                      <th className="text-right">Accepted</th>
                      <th className="text-right">Damaged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr
                        key={
                          item.itemKey ||
                          `${item.receivingId}:${item.id}:${item.sku}`
                        }
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-3 py-2 font-mono text-ink-2">
                          <span className="block">{item.sku}</span>
                          {item.notes && (
                            <span className="block text-[10px] text-ink-4">
                              {item.notes}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-3">
                          {item.expectedQty.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-2">
                          {item.receivedQty.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-grass">
                          {item.acceptedQty.toLocaleString()}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono",
                            item.damagedQty > 0 ? "text-ember" : "text-ink-4"
                          )}
                        >
                          {item.damagedQty.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {detail.receiving.hasShortage && (
            <div className="rounded-panel bg-ember/5 px-3 py-2 text-[11px] leading-[1.45] text-ember shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ember)_24%,transparent)]">
              {detail.receiving.shortageCount.toLocaleString()} unit(s) short
              against the recorded expected quantities.
            </div>
          )}
        </div>
      )}
    </SheetShell>
  )
}

/**
 * The direct-receiving sheet. Create-only and never fetches a row, so
 * resetting via TanStack's own `form.reset` inside an effect (mirroring the
 * original hand-rolled reset) never has an async gap to flash a stale draft
 * across, and it keeps `SheetShell` mounted continuously so its open/close
 * slide keeps animating.
 */
function CreateSheet({
  open,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: StoreReceivingCreateInput) => Promise<StoreReceivingDetail>
  onCreated: (detail: StoreReceivingDetail) => void
}) {
  const { busy, error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: initialDraft(),
    validators: { onChange: receivingCreateInput },
    onSubmit: async ({ value }) => {
      const items = value.items.map((line) => ({
        sku: line.sku.trim(),
        expectedQty: line.expectedQty ?? 0,
        receivedQty: line.receivedQty ?? 0,
        damagedQty: line.damagedQty ?? 0,
        notes: line.notes.trim() || undefined,
      }))
      const receivedTotal = items.reduce((sum, item) => sum + item.receivedQty, 0)
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Record ${items.length} SKU line(s) and ${receivedTotal.toLocaleString()} received unit(s)? Internal will commit stock and cannot undo this receipt.`
        )
      ) {
        return
      }
      await run(async () => {
        let created: StoreReceivingDetail
        try {
          created = await onCreate({
            supplierName: value.supplierName.trim(),
            referenceNo: value.referenceNo.trim() || undefined,
            receivedBy: value.receivedBy.trim(),
            notes: value.notes.trim() || undefined,
            items,
          })
        } catch (cause: unknown) {
          throw new Error(describeStoreError(cause), { cause })
        }
        onCreated(created)
      })
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset(initialDraft())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <SheetShell
      open={open}
      eyebrow="Atomic store command"
      title="Record direct receiving"
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      size="wide"
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={sheetButton.secondary}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void form.handleSubmit()}
            disabled={busy}
            className={sheetButton.primary}
          >
            {busy ? "Recording…" : "Record receipt"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-4 px-[18px] pt-4 pb-[18px]"
      >
        <div className="rounded-panel bg-honey/10 px-3 py-2.5 text-[11px] leading-[1.45] text-ink-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--honey)_30%,transparent)]">
          This is the store router&apos;s single-step atomic command. Enter the
          supplier document and physical quantities yourself; Slowdown does not
          infer expected stock. On submit, Internal writes the receipt, stock
          movements, event log, and any damaged-item disposition in one
          transaction.
        </div>
        <form.FormError message={error} />
        <div className="grid gap-3 md:grid-cols-2">
          <form.AppField name="supplierName">
            {(field) => <field.TextField label="Supplier name" required />}
          </form.AppField>
          <form.AppField name="referenceNo">
            {(field) => <field.TextField label="Supplier reference" placeholder="Recommended for idempotency" />}
          </form.AppField>
          <form.AppField name="receivedBy">
            {(field) => <field.TextField label="Received by" required placeholder="Employee ID or name" />}
          </form.AppField>
          <form.AppField name="notes">
            {(field) => <field.TextField label="Receipt notes" />}
          </form.AppField>
        </div>
        <div className="overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
          <div className="flex items-center justify-between border-b border-line bg-inset px-3 py-2">
            <div>
              <div className="text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                Physical lines
              </div>
              <div className="pt-0.5 text-[10.5px] text-ink-4">
                Expected, received, and damaged are entered values, not a local
                balance.
              </div>
            </div>
            <button
              type="button"
              onClick={() => form.pushFieldValue("items", { ...EMPTY_LINE })}
              className="inline-flex h-[28px] items-center rounded-control bg-surface px-2 text-[11px] font-medium text-ink shadow-btn hover:bg-hover"
            >
              Add line
            </button>
          </div>
          <form.Subscribe selector={(state) => state.values.items.length}>
            {(itemCount) => (
              <div className="space-y-3 p-3">
                {Array.from({ length: itemCount }, (_, index) => (
                  // Lines have no id of their own until saved; the index is
                  // the only stable identity while a receipt is being drafted.
                  <div
                    key={index}
                    className="grid gap-2 rounded-panel bg-inset p-2.5 shadow-[inset_0_0_0_1px_var(--line)] md:grid-cols-[minmax(150px,1.3fr)_100px_100px_100px_minmax(150px,1fr)_auto] md:items-end"
                  >
                    <form.AppField name={`items[${index}].sku`}>
                      {(field) => <field.TextField label="SKU" required />}
                    </form.AppField>
                    <form.AppField name={`items[${index}].expectedQty`}>
                      {(field) => <field.NumberField label="Expected" required min={0} step={1} />}
                    </form.AppField>
                    <form.AppField name={`items[${index}].receivedQty`}>
                      {(field) => <field.NumberField label="Received" required min={0} step={1} />}
                    </form.AppField>
                    <form.AppField name={`items[${index}].damagedQty`}>
                      {(field) => <field.NumberField label="Damaged" min={0} step={1} />}
                    </form.AppField>
                    <form.AppField name={`items[${index}].notes`}>
                      {(field) => <field.TextField label="Line notes" />}
                    </form.AppField>
                    <button
                      type="button"
                      disabled={itemCount === 1}
                      onClick={() => form.removeFieldValue("items", index)}
                      className="h-[30px] rounded-control px-2 text-[11px] text-ink-3 hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </form.Subscribe>
        </div>
      </form>
    </SheetShell>
  )
}

function describeStoreError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401) {
      return "Store receiving needs store-router authorization. Sign in through /v1/ops/auth/login or configure the store session; the cloud session is not a store bearer token."
    }
    if (error.status === 403) {
      return "The current store session is authenticated but is not authorized for receiving. Ask a store supervisor to grant the receiving permission."
    }
    if (
      error.status === 404 ||
      error.message === "The backend returned HTML instead of JSON"
    ) {
      return "The store-router receiving route is unavailable at the configured endpoint. Check the Vite /store-api proxy or VITE_STORE_API_URL; no local receipt data is shown."
    }
    if (error.kind === "network" || error.kind === "timeout") {
      return "The store-router backend could not be reached. Configure VITE_STORE_API_URL or start the store router behind the /store-api proxy."
    }
  }
  return getErrorMessage(
    error,
    "Store receiving is unavailable from the configured store router."
  )
}

function useStoreReceiving(enabled = true): ResourceState {
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<ResourceState["status"]>("loading")
  const [data, setData] = useState<StoreReceivingSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = () => {
    setState("loading")
    setData(null)
    setError(null)
    setReloadKey((key) => key + 1)
  }

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    fetchStoreReceiving(controller.signal).then(
      (next) => {
        if (!active) return
        setData(next)
        setState("ready")
      },
      (reason: unknown) => {
        if (
          !active ||
          (reason instanceof DOMException && reason.name === "AbortError")
        )
          return
        setError(describeStoreError(reason))
        setState("error")
      }
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [enabled, reloadKey])

  if (state === "ready" && data)
    return { status: state, data, error: null, reload }
  if (state === "error")
    return {
      status: state,
      data: null,
      error: error ?? "Store receiving is unavailable.",
      reload,
    }
  return { status: "loading", data: null, error: null, reload }
}

export function StoreReceiving() {
  const resource = useStoreReceiving()
  const [selected, setSelected] = useState<StoreReceivingRecord | null>(null)
  const [detail, setDetail] = useState<StoreReceivingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const rows = resource.data?.records ?? null
  const pending = resource.data?.pending ?? null
  const totalQty = useMemo(
    () => (rows ?? []).reduce((sum, row) => sum + row.totalQty, 0),
    [rows]
  )
  const shortageQty = useMemo(
    () => (rows ?? []).reduce((sum, row) => sum + row.shortageCount, 0),
    [rows]
  )

  const openDetail = (row: StoreReceivingRecord) => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setSelected(row)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    void fetchStoreReceivingDetail(row.receivingId, controller.signal).then(
      (next) => {
        if (detailRequest.current !== controller) return
        setDetail(next)
        setDetailLoading(false)
      },
      (reason: unknown) => {
        if (detailRequest.current !== controller) return
        if (reason instanceof DOMException && reason.name === "AbortError")
          return
        setDetailError(describeStoreError(reason))
        setDetailLoading(false)
      }
    )
  }

  const closeDetail = () => {
    detailRequest.current?.abort()
    detailRequest.current = null
    setSelected(null)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(false)
  }

  const onReceiptCreated = (created: StoreReceivingDetail) => {
    resource.reload()
    setSelected(created.receiving)
    setDetail(created)
    setDetailError(null)
    setDetailLoading(false)
  }

  const detailOpen = selected !== null || detailLoading || detailError !== null

  return (
    <section className="space-y-3.5 rounded-panel bg-surface p-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink">
              Store receiving
            </h2>
            <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              store-router · live
            </span>
          </div>
          <p className="pt-1 text-[11.5px] leading-[1.45] text-ink-3">
            Reads receipts from the store&apos;s SQLite workflow. Create uses
            Internal&apos;s atomic receiving command and is never persisted in
            browser memory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-[11px] font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] hover:brightness-105"
          >
            <Icon path={paths.plus} size={13} width={2} />
            Record receipt
          </button>
          <button
            type="button"
            onClick={resource.reload}
            disabled={resource.status === "loading"}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-[11px] font-medium text-ink shadow-btn hover:bg-hover disabled:cursor-wait disabled:opacity-50"
          >
            <Icon path={paths.arrowUp} size={13} width={2} />
            Refresh
          </button>
        </div>
      </div>

      {resource.status === "loading" && (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center text-ink-4">
          <span className="size-4 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
          <span className="text-xs font-medium text-ink-2">
            Loading store receipts
          </span>
          <span className="text-[11px]">
            Reading /v1/receiving/list and /v1/receiving/pending from
            store-router.
          </span>
        </div>
      )}
      {resource.status === "error" && (
        <div className="min-h-[220px] pt-1">
          <ErrorState message={resource.error} />
          <p className="px-3.5 text-[11px] leading-[1.45] text-ink-4">
            Endpoint used:{" "}
            <span className="font-mono">{storeApi.baseUrl}/v1/receiving/*</span>
            . The cloud session and cloud inventory projection are not used as a
            fallback.
          </p>
          <button
            type="button"
            onClick={resource.reload}
            className="mx-3.5 mt-3 inline-flex h-[28px] items-center rounded-control bg-ink px-2.5 text-[11px] font-medium text-surface hover:opacity-85"
          >
            Retry
          </button>
        </div>
      )}
      {resource.status === "ready" && resource.data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Receipts", rows?.length ?? null],
              ["Pending feed", pending?.length ?? null],
              ["Received units", totalQty],
              ["Shortage units", shortageQty],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
              >
                <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
                  {label}
                </div>
                <div className="font-mono text-[15px] text-ink">
                  {value === null ? "—" : Number(value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          {resource.data.errors.records && (
            <ErrorState message={`Receipts: ${resource.data.errors.records}`} />
          )}
          {resource.data.errors.pending && (
            <ErrorState
              message={`Pending feed: ${resource.data.errors.pending}`}
            />
          )}
          <ReceivingTable
            title="All store receipts"
            rows={rows}
            onOpen={openDetail}
          />
          <ReceivingTable
            title="Pending endpoint feed"
            rows={pending}
            onOpen={openDetail}
          />
          <p className="text-[10.5px] text-ink-4">
            Read at {formatDate(resource.data.fetchedAt)} · the pending endpoint
            currently returns the store router&apos;s completed delivery feed;
            its naming is retained from the backend contract.
          </p>
        </>
      )}

      <DetailSheet
        detail={detailOpen ? detail : null}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
      />
      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createStoreReceiving}
        onCreated={onReceiptCreated}
      />
    </section>
  )
}
