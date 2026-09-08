import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ColumnDef,
  ExpandedState,
  SortingState,
} from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { Dial } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { ago, count, label as humanise, moment } from "@/lib/format"
import {
  correctPlacement,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listCounts,
  poolDetail,
  type FleetPool,
  type PoolItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
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

/// One line of the tree: a site, or a pool standing in it.
///
/// A row type of its own rather than `FleetPool`, because a site is not a pool
/// and pretending otherwise would mean inventing an id, a group and a sync
/// status for something that has none.
export interface PoolRow {
  readonly key: string
  readonly label: string
  /// The pool this row is, or null on a site row.
  readonly pool: FleetPool | null
  readonly stock: number
  readonly on_hand: number
  readonly allotted: number | null
  /// Distinct tags sighted in the observation window — null where there was
  /// never anything to sight: Cloud holds each Edge node's fact positions but
  /// not the readings behind them, so an Edge row has no observation rather
  /// than an observation of nought.
  readonly observed: number | null
  readonly missing: number
  /// The latest count of this pool whatever its status, so one opened this
  /// morning reads as counted today rather than as never counted.
  readonly last_count: string | null
  /// False on the Cloud row for a site a live Edge node owns. Those rows are
  /// shown — they hold the last numbers the centre saw — but they are NOT in
  /// the site's total, because the Edge row for the same pool is. Reading the
  /// two together without that distinction is exactly how a fleet counts a
  /// store twice.
  readonly counted: boolean
  readonly subRows?: readonly PoolRow[]
}

/// A quantity that may be absent, and an absence that is not a nought.
function figure(value: number | null) {
  return value === null ? <span className="text-mute">—</span> : count(value)
}

/// Stock, then what it is made of, then what is wrong with it.
///
/// The order is the inventory equation the server states in the same response
/// — `Stock = On hand + Allotted + Missing` — with the two readings that are
/// *about* the number rather than in it on the outside: **Observed** is what a
/// scanner actually saw of it, and **Last count** is when a person last stood
/// in front of it. A row whose ring is empty and whose last count says Never
/// is a number nobody has checked, and those two columns are the only place
/// this table says so.
const columns: ColumnDef<TableSetup, PoolRow>[] = [
  {
    id: "pool",
    accessorFn: (row) => row.label,
    header: "Pool",
    size: 320,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => {
      const site = row.original.pool === null
      return (
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={{ paddingLeft: `${row.depth * 1.125}rem` }}
        >
          {row.getCanExpand() ? (
            // A real button, even though the whole row toggles too: the row is
            // a click target and this is the keyboard's way in.
            <button
              type="button"
              aria-expanded={row.getIsExpanded()}
              aria-label={`${row.getIsExpanded() ? "Collapse" : "Expand"} ${row.original.label}`}
              onClick={(event) => {
                event.stopPropagation()
                row.toggleExpanded()
              }}
              className="grid size-4 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 transition-transform",
                  row.getIsExpanded() && "rotate-90"
                )}
              />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span
            className={
              site
                ? "truncate font-medium text-ink"
                : row.original.counted
                  ? "truncate text-text"
                  : "truncate text-mute"
            }
          >
            {row.original.label}
          </span>
          {!site && !row.original.counted && (
            <span className="shrink-0 text-[0.625rem] text-mute">
              not counted
            </span>
          )}
        </div>
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
    accessorKey: "on_hand",
    header: "On hand",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.on_hand),
  },
  {
    accessorKey: "allotted",
    header: "Allotted",
    size: 100,
    meta: {
      align: "right",
      priority: 2,
      filter: { kind: "number", unit: "pcs" },
    },
    cell: ({ row }) => figure(row.original.allotted),
  },
  {
    accessorKey: "observed",
    header: "Observed",
    size: 120,
    meta: {
      align: "right",
      priority: 3,
      filter: { kind: "number", unit: "tags" },
    },
    cell: ({ row }) => {
      const { observed, stock } = row.original
      if (observed === null) return <span className="text-mute">—</span>
      return (
        <span className="inline-flex items-center gap-1.5">
          <Dial value={stock > 0 ? observed / stock : 0} />
          {count(observed)}
        </span>
      )
    },
  },
  {
    accessorKey: "missing",
    header: "Missing",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
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
    accessorKey: "last_count",
    header: "Last count",
    size: 120,
    meta: { priority: 3, filter: { kind: "date" } },
    cell: ({ row }) =>
      row.original.last_count === null ? (
        <span className="text-mute">Never</span>
      ) : (
        ago(row.original.last_count)
      ),
  },
]

/// The pool table on its own, without page chrome.
///
/// Split out so `/inventory` can show every pool under its KPIs without a
/// second page header — a page cannot carry two of those, and the one-page
/// view is the whole point of the module now having a single row.
///
/// `Pools` below is the same body under its own header, kept routed and
/// findable in ⌘K for anyone who arrives at a pool from a link.
export function PoolsBody() {
  const [query, setQuery] = useState("")
  const pool = useSheet("pool")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "missing", desc: true },
  ])
  /// Semua tertutup. Empat belas baris situs muat tanpa gulir; seratus dua
  /// belas pool terbuka adalah daftar yang tak seorang pun minta.
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  /// The count board, for one column of this table.
  ///
  /// The fleet read carries balances and no history, so when a pool was last
  /// counted is only knowable from here. Its failure costs the column and
  /// nothing else: a board that will not load leaves every row reading
  /// "Never", which is what an uncounted pool reads as anyway — losing the
  /// whole table over it would be the worse trade.
  const counts = useQuery({
    queryKey: inventoryKeys.counts(),
    queryFn: ({ signal }) => listCounts(signal),
  })

  /// The newest count per pool, from a board the server hands over already
  /// partitioned. Whichever moment the count actually reached — closed,
  /// submitted, activated, or merely created — is the one that counts as
  /// "last": a count still open is not a pool nobody has been to.
  const lastCounts = useMemo(() => {
    const newest = new Map<string, string>()
    const board = counts.data
    if (!board) return newest
    for (const record of [
      ...board.drafts,
      ...board.active,
      ...board.needs_review,
      ...board.history,
    ]) {
      const when =
        record.closed_at ??
        record.submitted_at ??
        record.activated_at ??
        record.created_at
      const held = newest.get(record.pool_id)
      if (held === undefined || Date.parse(when) > Date.parse(held)) {
        newest.set(record.pool_id, when)
      }
    }
    return newest
  }, [counts.data])

  /// The pools of one site, folded into the row that stands for the site.
  ///
  /// **Only rows the server counts are added up.** 160 rows describe 112 pools:
  /// where a live Edge node owns a site, the Cloud row for the same pool is
  /// shadowed and carries `included_in_fleet_total: false`, and the four
  /// outbound stage rollups carry it too — because their own leaves are what
  /// count. Summing every row gives 7.001 for a fleet the server puts at 4.401.
  /// So the total follows the server's own policy rather than a second opinion,
  /// and the rows it leaves out are still shown, dimmed and labelled.
  const tree = useMemo<PoolRow[]>(() => {
    const items = fleet.data?.items ?? []

    const bySite = new Map<string, FleetPool[]>()
    for (const item of items) {
      const list = bySite.get(item.site_id)
      if (list) list.push(item)
      else bySite.set(item.site_id, [item])
    }

    return [...bySite.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([siteId, pools]) => {
        const children: PoolRow[] = pools
          .slice()
          .sort(
            (a, b) =>
              a.display_order - b.display_order || a.id.localeCompare(b.id)
          )
          .map((item) => ({
            key: `${item.origin_id}/${item.id}`,
            label: item.label,
            pool: item,
            stock: item.stock,
            on_hand: item.on_hand,
            allotted: item.allotted,
            observed: item.observed,
            missing: item.missing,
            last_count: lastCounts.get(item.id) ?? null,
            counted: item.authority.included_in_fleet_total,
          }))

        const counted = children.filter((child) => child.counted)
        const sum = (pick: (row: PoolRow) => number) =>
          counted.reduce((total, row) => total + pick(row), 0)
        /// The same fold over a column that is allowed to be absent. A site
        /// where nothing can be allotted or nothing can be sighted reports no
        /// reading, not a reading of nought — a nought is a claim.
        const known = (pick: (row: PoolRow) => number | null) => {
          const readable = counted.filter((row) => pick(row) !== null)
          return readable.length === 0
            ? null
            : readable.reduce((total, row) => total + (pick(row) ?? 0), 0)
        }
        /// The site was last counted when the most recently counted pool in it
        /// was — including the pools its total leaves out, because somebody did
        /// stand there and count them.
        const latest = children.reduce<string | null>(
          (newest, row) =>
            row.last_count !== null &&
            (newest === null || Date.parse(row.last_count) > Date.parse(newest))
              ? row.last_count
              : newest,
          null
        )

        return {
          key: `site/${siteId}`,
          label: pools[0].site_name ?? siteId,
          pool: null,
          stock: sum((row) => row.stock),
          on_hand: sum((row) => row.on_hand),
          allotted: known((row) => row.allotted),
          observed: known((row) => row.observed),
          missing: sum((row) => row.missing),
          last_count: latest,
          counted: true,
          subRows: children,
        }
      })
  }, [fleet.data, lastCounts])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: tree,
        columns: filters.columns,
        getRowId: (row: PoolRow) => row.key,
        getSubRows: (row: PoolRow) => row.subRows as PoolRow[] | undefined,
        // Searching flattens the tree on purpose: a match three sites down is
        // not findable behind a chevron, and a filtered hierarchy that keeps
        // its parents is a hierarchy of one row each.
        filterFromLeafRows: true,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          expanded,
          sorting,
        },
        onExpandedChange: setExpanded,
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [tree, filters.columns, filters.columnFilters, query, expanded, sorting]
    )
  )

  return (
    <>
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
            tree.length === 0 ? (
              <EmptyState>
                This node has no active operational pool.
              </EmptyState>
            ) : (
              <DataTable<PoolRow>
                table={table}
                // A pool row opens its own page; a site row has none, so the
                // whole row is the chevron's click target rather than a dead
                // strip beside a 14-pixel control.
                onRowClick={(row) => {
                  if (row.pool) pool.open(row.pool.id)
                  else table.getRow(row.key).toggleExpanded()
                }}
                // `row.pool?.id === pool.value` was `undefined === undefined`
                // on every site row with no sheet open, which tinted all
                // fourteen of them as selected.
                isSelected={(row) =>
                  row.pool !== null && row.pool.id === pool.value
                }
                className="max-h-[calc(100vh-16rem)]"
              />
            ),
        })}
      </Card>

      <PoolSheet id={pool.value ?? null} onClose={pool.close} />
    </>
  )
}

export function Pools() {
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Pools"
        sub="Where the stock is standing, on this node and on every node that reports to it."
      />
      <PoolsBody />
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
                      variant="primary"
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
