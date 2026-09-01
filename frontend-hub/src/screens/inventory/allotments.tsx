import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import {
  Lifecycle,
  Timeline,
  type TimelineEvent,
} from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, day, label as humanise, moment, toneFor } from "@/lib/format"
import {
  allotmentDetail,
  allotmentsByStore,
  availability,
  cancelAllotment,
  createAllotment,
  executeAllotment,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listAllotments,
  type AllotmentRow,
  type CreateAllotmentLine,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import {
  fixedDestinationFor,
  sitesOf,
  sourcePoolsFor,
  useActor,
  type AllotmentKind,
} from "@/screens/inventory/shared"

/// Allotments — goods promised out of a pool.
///
/// The number to read is **remaining**: accepted minus picked minus cancelled,
/// which is what is still reserved and has not moved. It is the quantity
/// holding stock out of everybody else's reach, so the list opens sorted by it.
///
/// `accepted` rather than `quantity` is what everything is measured against. An
/// allotment a DC owns counts as nothing until that DC accepts it, so 300
/// ordered with 0 accepted is a real and common state — and 0 is what can be
/// picked. The same ownership decides whether picking is possible here at all:
/// the centre may only execute an allotment no DC owns, because picking is the
/// warehouse's act and raising a movement nobody made would be inventing stock
/// history.

const TYPES = [
  { value: "TO_STORE", label: "To store" },
  { value: "RETURN_TO_DC", label: "Return to DC" },
  { value: "RETURN_TO_SUPPLIER", label: "Return to supplier" },
]

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DC_COMPLETED", label: "DC completed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
]

/// The road from allotted to arrived, in the order goods travel it. Each stage
/// counts pieces that have reached at least that far, so the numbers only fall
/// from left to right — and where they fall is where the goods are.
const STAGES = [
  { key: "total_accepted_quantity", label: "Accepted" },
  { key: "total_picked_quantity", label: "Picked" },
  { key: "total_packed_quantity", label: "Packed" },
  { key: "total_shipment_quantity", label: "Shipment" },
  { key: "total_dispatched_quantity", label: "Dispatched" },
  { key: "total_in_transit_quantity", label: "In transit" },
  { key: "total_received_quantity", label: "Received" },
] as const

const columns: ColumnDef<TableSetup, AllotmentRow>[] = [
  {
    accessorKey: "allotment_number",
    header: "Allotment",
    size: 150,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.allotment_number}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    size: 160,
    meta: { filter: { kind: "option", format: humanise } },
    cell: ({ row }) => <Tag>{row.original.type}</Tag>,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 140,
    meta: { filter: { kind: "option", format: humanise } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {humanise(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Raised",
    size: 120,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    accessorKey: "total_accepted_quantity",
    header: "Accepted",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => (
      <span
        className={
          row.original.total_accepted_quantity === 0 &&
          row.original.total_quantity > 0
            ? "text-warn-fg"
            : undefined
        }
      >
        {count(row.original.total_accepted_quantity)}
      </span>
    ),
  },
  {
    accessorKey: "total_picked_quantity",
    header: "Picked",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.total_picked_quantity),
  },
  {
    accessorKey: "total_received_quantity",
    header: "Received",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.total_received_quantity),
  },
  {
    accessorKey: "remaining_quantity",
    header: "Remaining",
    size: 120,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    // The decision metric: anything above zero is stock nobody else can have.
    cell: ({ row }) => (
      <span
        className={
          row.original.remaining_quantity > 0
            ? "font-medium text-info-fg"
            : "text-mute"
        }
      >
        {count(row.original.remaining_quantity)}
      </span>
    ),
  },
]

export function Allotments() {
  const [tab, setTab] = useState("all")
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [store, setStore] = useState("")
  const [query, setQuery] = useState("")
  const [composing, setComposing] = useState(false)
  const allotment = useSheet("allotment")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "remaining_quantity", desc: true },
  ])

  const list = useQuery({
    queryKey: inventoryKeys.allotmentList(type, status),
    queryFn: ({ signal }) => listAllotments(type, status, signal),
    enabled: tab === "all",
  })

  const byStore = useQuery({
    queryKey: inventoryKeys.allotmentsByStore(store),
    queryFn: ({ signal }) => allotmentsByStore(store, signal),
    enabled: tab === "store" && store !== "",
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const source = tab === "all" ? list : byStore
  const rows = useMemo(
    () => (source.data?.items ?? []) as AllotmentRow[],
    [source.data]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: AllotmentRow) => row.id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const stores = useMemo(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => ({
        value: site.site_id,
        label: site.site_name,
      })),
    [fleet.data]
  )

  const shortages = source.data?.shortages ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Allotments"
        sub="What has been promised out of a pool, and how far it has actually travelled."
      />

      <SubTabs
        tabs={[
          { value: "all", label: "Every allotment" },
          { value: "store", label: "By store" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Toolbar>
        {tab === "all" ? (
          <>
            <Choice
              value={type}
              onChange={setType}
              options={TYPES}
              placeholder="Every type"
            />
            <Choice
              value={status}
              onChange={setStatus}
              options={STATUSES}
              placeholder="Every status"
            />
          </>
        ) : (
          <Choice
            value={store}
            onChange={setStore}
            options={stores}
            placeholder="Choose a store"
            className="max-w-72"
          />
        )}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-48"
        />
        <FilterBar model={filters} table={table} />
        <Toolbar.Spacer />
        <Button onClick={() => setComposing(true)}>
          <Plus />
          New allotment
        </Button>
      </Toolbar>

      {shortages.length > 0 && (
        <Card className="mb-[1.125rem] overflow-hidden">
          <CardHeader>
            <CardTitle>Promised more than the pool holds</CardTitle>
            <span className="text-[0.75rem] text-mute tabular-nums">
              {count(shortages.length)}
            </span>
          </CardHeader>
          <div className="border-t border-hairline px-4 py-3">
            <p className="mb-2.5 text-[0.71875rem] text-mute">
              On Hand is Stock minus Allotted, so a negative reading means the
              allotments standing against this pool add up to more than the
              goods in it. The server reports it rather than preventing it —
              allotting is a promise, and a warehouse is allowed to find out it
              cannot keep one.
            </p>
            <MiniTable
              head={["Article", "SKU", "Stock", "Allotted", "Short by"]}
            >
              {shortages.map((item) => (
                <tr key={item.sku_id} className="border-t border-hairline">
                  <td className="py-2 pr-2 text-[0.8125rem] text-ink">
                    {item.article_name}
                  </td>
                  <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
                    {item.sku_code}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {count(item.stock_qty)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {count(item.allotted_qty)}
                  </td>
                  <td className="py-2 text-right font-medium text-bad-fg tabular-nums">
                    {count(item.shortage_qty)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>
        </Card>
      )}

      {tab === "store" && store === "" ? (
        <Card>
          <EmptyState>
            Choose a store to see everything owed to it, and its lifetime
            per-SKU pipeline.
          </EmptyState>
        </Card>
      ) : (
        <>
          {tab === "store" && byStore.data && (
            <Card className="mb-[1.125rem] px-4 py-3.5">
              <MetricRow>
                <Metric
                  label="Ordered"
                  value={count(
                    byStore.data.sku_summary.reduce(
                      (total, sku) => total + sku.quantity,
                      0
                    )
                  )}
                />
                <Metric
                  label="Received"
                  value={count(
                    byStore.data.sku_summary.reduce(
                      (total, sku) => total + sku.received_quantity,
                      0
                    )
                  )}
                />
                <Metric
                  label="Still owed"
                  value={count(
                    byStore.data.sku_summary.reduce(
                      (total, sku) => total + sku.remaining_quantity,
                      0
                    )
                  )}
                  tone="warn"
                />
                <Metric
                  label="SKUs"
                  value={count(byStore.data.sku_summary.length)}
                />
              </MetricRow>
              <p className="mt-3 text-[0.71875rem] text-mute">
                This summary spans every allotment ever addressed to{" "}
                {byStore.data.destination_name} — not only the ones listed
                below.
              </p>
            </Card>
          )}

          <Card className="overflow-hidden">
            {queryState(source, {
              loading: "Reading the allotment book…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {type === "" && status === "" && query === ""
                      ? "Nothing has been allotted out of any pool yet."
                      : "No allotment matches these filters."}
                  </EmptyState>
                ) : (
                  <DataTable<AllotmentRow>
                    table={table}
                    onRowClick={(row) => allotment.open(row.id)}
                    isSelected={(row) => row.id === allotment.value}
                    className="max-h-[calc(100vh-22rem)]"
                  />
                ),
            })}
          </Card>

          {tab === "all" &&
            list.data &&
            list.data.by_destination.length > 0 && (
              <Card className="mt-[1.125rem] overflow-hidden">
                <CardHeader>
                  <CardTitle>Owed, by destination</CardTitle>
                </CardHeader>
                <div className="border-t border-hairline px-4 py-1">
                  {list.data.by_destination.map((rollup) => (
                    <KeyValue
                      key={`${rollup.destination_type}/${rollup.destination_id}`}
                      term={rollup.destination_name ?? rollup.destination_id}
                    >
                      {count(rollup.remaining_quantity)} of{" "}
                      {count(rollup.total_quantity)}
                    </KeyValue>
                  ))}
                </div>
                <p className="px-4 pt-1 pb-3.5 text-[0.71875rem] text-mute">
                  Computed across every allotment in the book, not across the
                  rows above — it answers "what is owed to this store", not
                  "what is on screen".
                </p>
              </Card>
            )}
        </>
      )}

      <AllotmentSheet id={allotment.value ?? null} onClose={allotment.close} />
      <Composer open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

function AllotmentSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [reason, setReason] = useState("")
  const [line, setLine] = useState("")
  const [pickQuantity, setPickQuantity] = useState("1")

  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id ?? ""),
    queryFn: ({ signal }) => allotmentDetail(id!, signal),
    enabled: id !== null,
  })

  // Both writes change the same two things: this record, and every list that
  // sums it. The list keys carry the filters, so the whole `allotments` prefix
  // goes — a cancelled allotment leaves one filtered list and joins another.
  const invalidate = () => {
    client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
    client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
  }

  const cancel = useMutation({
    mutationFn: () =>
      cancelAllotment(id!, {
        reason,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: invalidate,
  })

  const execute = useMutation({
    mutationFn: () =>
      executeAllotment(id!, {
        allotment_line_id: line,
        quantity: Number(pickQuantity),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: invalidate,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "allotment", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.allotment_number}
      title={detail.data ? humanise(detail.data.type) : "Allotment"}
    >
      {queryState(detail, {
        loading: "Opening the allotment…",
        render: (record) => {
          const owned = record.activation_target_origin_id !== null
          const reached = STAGES.findIndex((stage) => record[stage.key] === 0)
          const events: TimelineEvent[] = record.events.map((event) => ({
            id: event.id,
            title: humanise(event.event_type),
            detail: `${event.actor_id} · ${count(event.quantity)} pieces · reserve ${event.remaining_delta >= 0 ? "+" : ""}${event.remaining_delta}`,
            at: moment(event.occurred_at),
            state: "done",
          }))

          return (
            <div className="flex flex-col gap-5">
              <Lifecycle
                steps={STAGES.map((stage, index) => ({
                  label: stage.label,
                  state:
                    record[stage.key] > 0
                      ? "done"
                      : index === (reached === -1 ? STAGES.length : reached)
                        ? "current"
                        : "todo",
                }))}
              />

              <div className="flex flex-wrap gap-1.5">
                <Pill tone={toneFor(record.status)}>
                  {humanise(record.status)}
                </Pill>
                {owned && (
                  <Pill tone="info">
                    {record.edge_application_status === "ACCEPTED"
                      ? "Accepted by the DC"
                      : record.edge_application_status === "REJECTED"
                        ? "Refused by the DC"
                        : "Waiting on the DC"}
                  </Pill>
                )}
                {!record.received_projection_consistent && (
                  <Pill tone="bad">Receipt evidence disagrees</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Raised by">{record.created_by}</Fact>
                <Fact term="Raised">{moment(record.created_at)}</Fact>
                <Fact term="Owner">
                  {record.activation_target_origin_id ?? "This node"}
                </Fact>
                <Fact term="Notes">{record.notes ?? "—"}</Fact>
              </Facts>

              {record.cancellation && (
                <Banner
                  tone={
                    record.cancellation.outcome === "APPLIED"
                      ? "ok"
                      : record.cancellation.outcome === null
                        ? "info"
                        : "warn"
                  }
                >
                  {record.cancellation.outcome === null
                    ? `Cancellation of ${count(record.cancellation.requested_quantity)} requested by ${record.cancellation.requested_by}; the DC has not answered. Nothing is released until it does.`
                    : `${humanise(record.cancellation.outcome)} — ${count(record.cancellation.cancelled_quantity ?? 0)} released, ${count(record.cancellation.blocked_picked_quantity ?? 0)} already picked and blocked.`}
                </Banner>
              )}

              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Lines
                </h4>
                <MiniTable
                  head={["SKU", "Qty", "Accepted", "Picked", "Received"]}
                >
                  {record.lines.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2">
                        <span className="block text-[0.8125rem] text-ink">
                          {item.article_name}
                        </span>
                        <span className="font-mono text-[0.65625rem] text-mute">
                          {item.sku_code} · {item.source_pool_id} →{" "}
                          {item.destination_id}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.accepted_quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.picked_quantity)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.received_quantity)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>

                <TotalsLadder
                  className="mt-3"
                  rows={[
                    { label: "Ordered", value: count(record.total_quantity) },
                    {
                      label: "Accepted",
                      value: count(record.total_accepted_quantity),
                    },
                    {
                      label: "Cancelled",
                      value: count(record.total_cancelled_quantity),
                    },
                  ]}
                  total={{
                    label: "Still reserved",
                    value: count(record.remaining_quantity),
                  }}
                />
              </section>

              {record.movements.length > 0 && (
                <section>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    Ledger movements
                  </h4>
                  <MiniTable head={["Route", "Cause", "Qty"]}>
                    {record.movements.map((movement) => (
                      <tr
                        key={movement.movement_id}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2 font-mono text-[0.65625rem] text-body">
                          <AppLink
                            to="/inventory/pools"
                            sheet={{
                              key: "pool",
                              value: movement.from.replace(/:.*$/, ""),
                            }}
                            className="hover:text-ink"
                          >
                            {movement.from}
                          </AppLink>{" "}
                          →{" "}
                          <AppLink
                            to="/inventory/pools"
                            sheet={{
                              key: "pool",
                              value: movement.to.replace(/:.*$/, ""),
                            }}
                            className="hover:text-ink"
                          >
                            {movement.to}
                          </AppLink>
                        </td>
                        <td className="py-2 text-right">
                          <Tag>{movement.cause}</Tag>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {count(movement.quantity)}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                </section>
              )}

              {events.length > 0 && (
                <section>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    History
                  </h4>
                  <Timeline events={events} />
                </section>
              )}

              <section className="border-t border-hairline pt-4">
                {(cancel.isError || execute.isError) && (
                  <Banner tone="bad" className="mb-3">
                    {(cancel.error ?? execute.error) instanceof Error
                      ? ((cancel.error ?? execute.error) as Error).message
                      : "The server refused the request."}
                  </Banner>
                )}

                {owned ? (
                  <p className="mb-3 text-[0.71875rem] text-mute">
                    A DC owns this allotment, so picking happens there against
                    the activation command — not here.
                  </p>
                ) : (
                  <div className="mb-4 flex flex-col gap-3">
                    <Field
                      label="Pick against a line"
                      hint="Partial picks are expected; press again until nothing remains."
                    >
                      <Choice
                        value={line}
                        onChange={setLine}
                        options={record.lines.map((item) => ({
                          value: item.id,
                          label: `${item.sku_code} · ${count(item.remaining_allotted)} left`,
                        }))}
                        placeholder="Choose a line"
                        className="h-9 w-full max-w-none"
                      />
                    </Field>
                    <Field label="Quantity">
                      <Input
                        type="number"
                        min={1}
                        value={pickQuantity}
                        onChange={(event) =>
                          setPickQuantity(event.target.value)
                        }
                      />
                    </Field>
                    <Button
                      variant="soft"
                      disabled={
                        line === "" ||
                        actor === "" ||
                        Number(pickQuantity) <= 0 ||
                        execute.isPending
                      }
                      onClick={() => execute.mutate()}
                    >
                      {execute.isPending ? "Picking…" : "Pick"}
                    </Button>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Field
                    label="Cancel what is still reserved"
                    hint="Whole-allotment, never per line. Nothing already picked comes back."
                  >
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Why it is being released"
                    />
                  </Field>
                  <Button
                    variant="danger"
                    disabled={
                      reason.trim() === "" || actor === "" || cancel.isPending
                    }
                    onClick={() => cancel.mutate()}
                  >
                    {cancel.isPending ? "Asking…" : "Cancel allotment"}
                  </Button>
                </div>
              </section>
            </div>
          )
        },
      })}
    </Sheet>
  )
}

/// The allotment as it is built. The first five fields are the line builder —
/// they are not sent, they are how a line gets made — and `lines` is what the
/// server is actually given. They live on one draft because they are one act:
/// a builder holding a SKU that no longer suits the type is exactly the bug
/// that keeping them apart invites.
interface AllotmentDraft {
  kind: AllotmentKind
  pool: string
  store: string
  sku: string
  quantity: string
  notes: string
  lines: CreateAllotmentLine[]
}

/// Raising one. Not a record, so it is not a URL sheet: there is nothing yet to
/// link anybody to.
function Composer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const actor = useActor()

  const create = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: AllotmentDraft) =>
      createAllotment({
        type: draft.kind,
        lines: draft.lines,
        notes: draft.notes.trim() === "" ? null : draft.notes,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      // Every filtered list gains a row, and the source pool now has less on
      // hand than it did a second ago.
      client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      client.invalidateQueries({ queryKey: ["inventory", "availability"] })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // The lines and the note, which were this allotment. The type and the
      // pool are where the next one is most likely raised from too.
      form.setFieldValue("lines", [])
      form.setFieldValue("notes", "")
    },
  })

  const form = useForm({
    defaultValues: {
      kind: "TO_STORE",
      pool: "",
      store: "",
      sku: "",
      quantity: "1",
      notes: "",
      lines: [],
    } as AllotmentDraft,
    onSubmit: ({ value }) => create.mutate(value),
  })

  // The two the reads are keyed by. Subscribed rather than read off
  // `form.state`, because a query key that does not re-render is a query that
  // never refetches.
  const kind = useStore(form.store, (state) => state.values.kind)
  const pool = useStore(form.store, (state) => state.values.pool)

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const stock = useQuery({
    queryKey: inventoryKeys.availability(pool, "", ""),
    queryFn: ({ signal }) => availability(pool, "", "", signal),
    enabled: open && pool !== "",
  })

  const pools = useMemo(
    () => sourcePoolsFor(kind, fleet.data?.items ?? []),
    [kind, fleet.data]
  )
  const stores = useMemo(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => ({
        value: site.site_id,
        label: site.site_name,
      })),
    [fleet.data]
  )
  const fixed = fixedDestinationFor(kind)

  const skuOf = (id: string) =>
    stock.data?.items.find((item) => item.sku_id === id)?.sku_code ?? id

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New allotment"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <p className="text-[0.71875rem] text-mute">
          Each type has its own legal source pool and its own legal destination,
          and the server checks both. Only the pools it will accept are offered.
        </p>

        {create.isError && (
          <Banner tone="bad">
            {create.error instanceof Error
              ? create.error.message
              : "The allotment was refused."}
          </Banner>
        )}
        {create.isSuccess && create.data && (
          <Banner tone="ok">
            {create.data.allotment_number} raised.{" "}
            {create.data.execution_authority === "EDGE_DC"
              ? `Nothing is reserved here yet — an activation command is on its way to ${create.data.activation_target_origin_id}, and the goods count as promised only once that node accepts.`
              : "Reserved on this node immediately."}
          </Banner>
        )}

        <form.Field name="kind">
          {(field) => (
            <Field label="Type">
              <Choice
                value={field.state.value}
                onChange={(value) => {
                  field.handleChange(value as AllotmentKind)
                  // A pool legal for one type is not legal for another, and a
                  // line already built out of the old one is not either.
                  form.setFieldValue("pool", "")
                  form.setFieldValue("lines", [])
                }}
                options={TYPES}
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="pool">
          {(field) => (
            <Field label="Out of">
              <Choice
                value={field.state.value}
                onChange={field.handleChange}
                options={pools.map((item) => ({
                  value: item.id,
                  label: `${item.site_id} · ${item.label}`,
                }))}
                placeholder="Choose a pool"
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="store">
          {(field) => (
            <Field label="To">
              {fixed ? (
                <Input readOnly value={fixed.destination_id} />
              ) : (
                <Choice
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={stores}
                  placeholder="Choose a store"
                  className="h-9 w-full max-w-none"
                />
              )}
            </Field>
          )}
        </form.Field>

        <form.Field name="sku">
          {(field) => (
            <Field
              label="SKU"
              hint={
                stock.data
                  ? `${count(stock.data.total_items)} SKUs in this pool · ${count(stock.data.on_hand_qty)} on hand`
                  : "Choose a pool first."
              }
            >
              <Choice
                value={field.state.value}
                onChange={field.handleChange}
                disabled={pool === ""}
                options={(stock.data?.items ?? []).map((item) => ({
                  value: item.sku_id,
                  label: `${item.sku_code} · ${item.article_name} · ${item.on_hand_qty} free`,
                }))}
                placeholder="Choose a SKU"
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="quantity">
          {(field) => (
            <Field label="Quantity">
              <Input
                type="number"
                min={1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="lines" mode="array">
          {(lines) => (
            <>
              <form.Subscribe
                selector={(state) => ({
                  sku: state.values.sku,
                  store: state.values.store,
                })}
              >
                {(chosen) => (
                  <Button
                    variant="ghost"
                    disabled={
                      chosen.sku === "" || (!fixed && chosen.store === "")
                    }
                    onClick={() => {
                      const draft = form.state.values
                      const chosenPool = pools.find(
                        (item) => item.id === draft.pool
                      )
                      const destination = fixed ?? {
                        destination_type: "STORE" as const,
                        destination_id: draft.store,
                      }
                      if (
                        !chosenPool ||
                        draft.sku === "" ||
                        Number(draft.quantity) <= 0
                      )
                        return
                      lines.pushValue({
                        source_site_id: chosenPool.site_id,
                        source_pool_id: chosenPool.id,
                        destination_type: destination.destination_type,
                        destination_id: destination.destination_id,
                        sku_id: draft.sku,
                        quantity: Number(draft.quantity),
                      })
                      // The SKU only: the next line is usually out of the same
                      // pool to the same place in the same quantity.
                      form.setFieldValue("sku", "")
                    }}
                  >
                    <Plus />
                    Add line
                  </Button>
                )}
              </form.Subscribe>

              {lines.state.value.length > 0 && (
                <MiniTable
                  head={["SKU", "To", { label: "Qty", align: "right" }, ""]}
                >
                  {lines.state.value.map((item, index) => (
                    <tr
                      key={`${item.sku_id}-${index}`}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2 font-mono text-[0.65625rem] text-body">
                        {skuOf(item.sku_id)}
                      </td>
                      <td className="py-2 text-right text-[0.71875rem] text-body">
                        {item.destination_id}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.quantity)}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => lines.removeValue(index)}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              )}
            </>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <Field label="Notes">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Optional"
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.lines.length}>
          {(built) => (
            <Button
              type="submit"
              variant="dark"
              disabled={built === 0 || actor === "" || create.isPending}
            >
              {create.isPending ? "Raising…" : "Raise allotment"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
