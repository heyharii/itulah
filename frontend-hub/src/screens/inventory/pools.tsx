import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, label as humanise, moment } from "@/lib/format"
import {
  correctPlacement,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  poolDetail,
  type FleetPool,
  type PoolItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Choice } from "@/screens/inventory/parts"
import {
  age,
  percent,
  useActor,
  writablePools,
} from "@/screens/inventory/shared"

/// Every pool the centre can see, its own and every Edge node's.
///
/// The column that is not obvious is **Source**. Cloud keeps a native ledger
/// *and* projects each Edge node's fact positions, and where a site is owned by
/// a live Edge node the Cloud row for it is shadowed: still shown, deliberately
/// excluded from the fleet total, and not writable. Reading the two together
/// without that distinction is exactly how a fleet counts a store twice.
///
/// The sheet is where a placement correction is made, and it is the only write
/// on this screen. That is not an accident of layout: a correction has to name
/// the subject it moves and the evidence behind it, and both of those are on
/// the pool's own page.

const columns: ColumnDef<TableSetup, FleetPool>[] = [
  {
    id: "pool",
    accessorFn: (row) => `${row.label} ${row.id}`,
    header: "Pool",
    size: 230,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <div className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {row.original.label}
        </span>
        <span className="font-mono text-id text-mute">{row.original.id}</span>
      </div>
    ),
  },
  {
    id: "site",
    accessorFn: (row) => row.site_name ?? row.site_id,
    header: "Site",
    size: 160,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="text-body">
        {row.original.site_name ?? row.original.site_id}
      </span>
    ),
  },
  {
    id: "source",
    accessorFn: (row) => row.authority.write_policy,
    header: "Authority",
    size: 150,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => {
      const policy = row.original.authority.write_policy
      return (
        <Tag
          tone={
            policy === "CLOUD_WRITABLE"
              ? "ok"
              : policy === "SHADOWED_READ_ONLY"
                ? "warn"
                : "neutral"
          }
        >
          {policy === "CLOUD_WRITABLE"
            ? "CLOUD"
            : policy === "SHADOWED_READ_ONLY"
              ? "SHADOWED"
              : policy === "OWNER_NODE_ONLY"
                ? "EDGE"
                : "DERIVED"}
        </Tag>
      )
    },
  },
  {
    accessorKey: "stock",
    header: "Stock",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.stock),
  },
  {
    accessorKey: "allotted",
    header: "Allotted",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) =>
      row.original.allotted === null ? (
        <span className="text-mute">—</span>
      ) : (
        count(row.original.allotted)
      ),
  },
  {
    accessorKey: "on_hand",
    header: "On hand",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.on_hand),
  },
  {
    accessorKey: "missing",
    header: "Missing",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    // Sorted on by default: a pool with missing stock is the one somebody has
    // to walk to.
    cell: ({ row }) => (
      <span
        className={
          row.original.missing > 0 ? "font-medium text-bad-fg" : "text-mute"
        }
      >
        {count(row.original.missing)}
      </span>
    ),
  },
  {
    accessorKey: "lost_rate",
    header: "Lost rate",
    size: 120,
    meta: { align: "right", filter: { kind: "number", unit: "%" } },
    cell: ({ row }) =>
      row.original.lost_rate === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="inline-flex items-center justify-end gap-2">
          <Meter
            value={row.original.lost_rate}
            tone={row.original.lost_rate > 0.02 ? "bad" : "warn"}
            className="w-10 min-w-0"
          />
          <span className="tabular-nums">
            {percent(row.original.lost_rate)}
          </span>
        </span>
      ),
  },
  {
    accessorKey: "sync_status",
    header: "Sync",
    size: 110,
    meta: { filter: { kind: "option", format: humanise } },
    cell: ({ row }) => {
      const status = row.original.sync_status
      return (
        <Pill
          tone={
            status === "CURRENT" || status === "LOCAL"
              ? "ok"
              : status === "STALE"
                ? "warn"
                : "info"
          }
        >
          {status === "LOCAL" ? "Cloud" : humanise(status)}
        </Pill>
      )
    },
  },
]

export function Pools() {
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState("all")
  const pool = useSheet("pool")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "missing", desc: true },
  ])

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const rows = useMemo(() => {
    const items = fleet.data?.items ?? []
    if (scope === "counted") {
      return items.filter((item) => item.authority.included_in_fleet_total)
    }
    if (scope === "edge") {
      return items.filter((item) => item.source_type === "EDGE_FACT_POSITION")
    }
    return items
  }, [fleet.data, scope])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: FleetPool) => `${row.origin_id}/${row.id}`,
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

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Pools"
        sub="Where the stock is standing, on this node and on every node that reports to it."
      />

      <SubTabs
        tabs={[
          { value: "all", label: "Every pool" },
          { value: "counted", label: "Counted in the fleet" },
          { value: "edge", label: "Edge-owned" },
        ]}
        value={scope}
        onChange={setScope}
      />

      {fleet.data && fleet.data.fleet_total === null && (
        <Banner tone="warn" className="mb-3.5">
          {fleet.data.aggregation_policy}
        </Banner>
      )}

      <Toolbar>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pools"
          className="h-8 w-64"
        />
        <FilterBar model={filters} table={table} />
        <Toolbar.Spacer />
        {fleet.data && (
          <span className="text-[0.71875rem] text-mute tabular-nums">
            Sightings counted over the last {fleet.data.observed_window_hours}h
            · loss measured over {fleet.data.lost_risk_window_days} days
          </span>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(fleet, {
          loading: "Reading every node…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {scope === "all"
                  ? "This node has no active operational pool."
                  : "No pool matches this slice."}
              </EmptyState>
            ) : (
              <DataTable<FleetPool>
                table={table}
                onRowClick={(row) => pool.open(row.id)}
                isSelected={(row) => row.id === pool.value}
                className="max-h-[calc(100vh-19rem)]"
              />
            ),
        })}
      </Card>

      <PoolSheet id={pool.value ?? null} onClose={pool.close} />
    </PageContent>
  )
}

/// A correction as it is composed. The subject is picked from the holding table
/// rather than typed, but it is part of the same act and part of the same
/// draft: a chosen row with no evidence beside it is exactly the half-made
/// correction the server refuses.
interface CorrectionDraft {
  subject: PoolItem | null
  destination: string
  quantity: string
  reason: string
  evidence: string
}

/// The pool's own page: what is in it, what is lost from it, what has been
/// read in it, what has moved through it, and what has been counted of it.
function PoolSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const detail = useQuery({
    queryKey: inventoryKeys.pool(id ?? ""),
    queryFn: ({ signal }) => poolDetail(id!, signal),
    enabled: id !== null,
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const correct = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: CorrectionDraft) =>
      correctPlacement({
        idempotency_key: idempotencyKey(),
        actor_id: actor,
        occurred_at: null,
        reason: draft.reason,
        evidence_reference: draft.evidence,
        notes: null,
        line: {
          subject_id: draft.subject?.subject_id ?? null,
          epc: null,
          quantity: Number(draft.quantity),
          from: `${id}:on_hand`,
          to: `${draft.destination}:on_hand`,
        },
      }),
    onSuccess: () => {
      // Both pools changed, and so did the fleet totals they roll into. The
      // destination is not named as a key of its own: `pool` is invalidated by
      // prefix so the pool being corrected *into* is refetched too.
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      // The subject and what proved it. Where it actually is, and how many, are
      // what the next row off the same shelf is corrected to as well.
      form.setFieldValue("subject", null)
      form.setFieldValue("reason", "")
      form.setFieldValue("evidence", "")
    },
  })

  const form = useForm({
    defaultValues: {
      subject: null,
      destination: "",
      quantity: "1",
      reason: "",
      evidence: "",
    } as CorrectionDraft,
    onSubmit: ({ value }) => correct.mutate(value),
  })

  const destinations = useMemo(
    () =>
      writablePools(fleet.data?.items ?? [])
        .filter((item) => item.id !== id)
        .map((item) => ({
          value: item.id,
          label: `${item.site_id} · ${item.label}`,
        })),
    [fleet.data, id]
  )

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "pool", id }}
      onOpenChange={(open) => !open && onClose()}
      id={id ?? undefined}
      title={detail.data?.summary.label ?? "Pool"}
    >
      {queryState(detail, {
        loading: "Opening the pool…",
        render: (pool) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-1.5">
              <Tag>{pool.summary.group}</Tag>
              <Tag>{pool.summary.pool_code}</Tag>
              {pool.summary.is_rollup && <Tag tone="warn">ROLLUP</Tag>}
            </div>

            <Facts>
              <Fact term="Site">
                {pool.summary.site_name ?? pool.summary.site_id}
              </Fact>
              <Fact term="Stock">{count(pool.summary.stock)}</Fact>
              <Fact term="On hand">{count(pool.summary.on_hand)}</Fact>
              <Fact term="Allotted">{count(pool.summary.allotted ?? 0)}</Fact>
              <Fact term="Missing">{count(pool.summary.missing)}</Fact>
              <Fact term="Seen">{count(pool.summary.observed ?? 0)}</Fact>
              <Fact term="Lost">{count(pool.summary.lost_quantity ?? 0)}</Fact>
              <Fact term="Lost rate">{percent(pool.summary.lost_rate)}</Fact>
            </Facts>

            <section>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Holding
                <span className="ml-1.5 font-normal text-mute">
                  {count(pool.items.length)}
                </span>
              </h4>
              {pool.items.length === 0 ? (
                <p className="text-meta text-body">
                  Nothing sits in this pool.
                </p>
              ) : (
                <form.Subscribe
                  selector={(state) => state.values.subject?.subject_id ?? null}
                >
                  {(picked) => (
                    <MiniTable head={["Subject", "SKU", "Qty"]}>
                      {pool.items.map((item) => (
                        <tr
                          key={item.subject_id}
                          onClick={() => form.setFieldValue("subject", item)}
                          className={`cursor-pointer border-t border-hairline ${
                            picked === item.subject_id
                              ? "bg-accent-bg"
                              : "hover:bg-soft"
                          }`}
                        >
                          <td className="py-2 pr-2">
                            <span className="block text-[0.8125rem] text-ink">
                              {item.article_name ?? item.subject_type}
                            </span>
                            <span className="font-mono text-[0.65625rem] text-mute">
                              {item.epc ?? item.barcode ?? item.subject_id}
                            </span>
                          </td>
                          <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
                            {item.sku_code ?? "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {count(item.quantity)}
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  )}
                </form.Subscribe>
              )}
            </section>

            {pool.missing.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Missing from here
                </h4>
                <MiniTable head={["Subject", "Age", "Qty"]}>
                  {pool.missing.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2 font-mono text-[0.65625rem] text-body">
                        {item.epc ?? item.sku_code ?? item.subject_id}
                      </td>
                      <td className="py-2 text-right text-warn-fg">
                        {age(item.age_hours)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.quantity)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            {pool.movements.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Recent movements
                </h4>
                <MiniTable head={["Cause", "Route", "Qty"]}>
                  {pool.movements.map((movement) => (
                    <tr
                      key={movement.movement_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <Tag>{movement.cause}</Tag>
                        <span className="mt-0.5 block text-[0.65625rem] text-mute">
                          {moment(movement.occurred_at)}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono text-[0.65625rem] text-body">
                        {movement.from} → {movement.to}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(movement.quantity)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            {pool.counts.length > 0 && (
              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Counted
                </h4>
                <MiniTable
                  head={["Reason", "Kind", { label: "Status", align: "right" }]}
                >
                  {pool.counts.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.8125rem] text-ink">
                        {item.reason}
                      </td>
                      <td className="py-2 text-right">
                        <Tag>{item.kind}</Tag>
                      </td>
                      <td className="py-2 text-right">
                        <Pill
                          tone={item.status === "CLOSED" ? "ok" : "info"}
                          className="ml-auto"
                        >
                          {humanise(item.status)}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </section>
            )}

            <section className="border-t border-hairline pt-4">
              <h4 className="mb-1 text-card-title font-semibold text-ink">
                Correct a placement
              </h4>
              <p className="mb-3 text-[0.71875rem] text-mute">
                A sighting is evidence, not a movement — the ledger is never
                corrected on its own. Pick the subject above, say where it
                actually is, and name what proves it.
              </p>

              {correct.isError && (
                <Banner tone="bad" className="mb-3">
                  {correct.error instanceof Error
                    ? correct.error.message
                    : "The correction was refused."}
                </Banner>
              )}
              {correct.isSuccess && correct.data && (
                <Banner tone="ok" className="mb-3">
                  Posted as movement group {correct.data.movement_group_id}.
                </Banner>
              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  form.handleSubmit()
                }}
                className="flex flex-col gap-3"
              >
                <form.Field name="subject">
                  {(field) => (
                    <Field label="Subject">
                      <Input
                        readOnly
                        value={
                          field.state.value
                            ? (field.state.value.epc ??
                              field.state.value.sku_code ??
                              field.state.value.subject_id)
                            : ""
                        }
                        placeholder="Choose a row above"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="destination">
                  {(field) => (
                    <Field label="Actually in">
                      <Choice
                        value={field.state.value}
                        onChange={field.handleChange}
                        options={destinations}
                        placeholder="Choose a pool"
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
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="reason">
                  {(field) => (
                    <Field label="Reason">
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="Found on the floor during the morning sweep"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="evidence">
                  {(field) => (
                    <Field
                      label="Evidence"
                      hint="A photograph, a count id, a note number. The server refuses a correction without one."
                    >
                      <Input
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        placeholder="COUNT-2026-08-31-DC"
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) =>
                    state.values.subject !== null &&
                    state.values.destination !== "" &&
                    state.values.reason.trim() !== "" &&
                    state.values.evidence.trim() !== "" &&
                    Number(state.values.quantity) > 0 &&
                    actor !== ""
                  }
                >
                  {(ready) => (
                    <Button
                      type="submit"
                      variant="dark"
                      disabled={!ready || correct.isPending}
                    >
                      {correct.isPending ? "Posting…" : "Correct placement"}
                    </Button>
                  )}
                </form.Subscribe>
                {actor === "" && (
                  <p className="text-[0.71875rem] text-mute">
                    Sign in before posting: the ledger records who moved the
                    stock and the server has no default.
                  </p>
                )}
              </form>
            </section>
          </div>
        ),
      })}
    </Sheet>
  )
}
