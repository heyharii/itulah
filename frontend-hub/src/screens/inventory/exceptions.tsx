import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { RefreshStamp } from "@/components/ui/refresh-stamp"
import { Facts, Fact, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { ago, count, label as humanise, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  activateCount,
  createCount,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  movementsPage,
  resolveMissing,
  type MovementScope,
  type MissingItem,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"

import { cn } from "@/lib/utils"
import {
  useSuspenseExceptionCases,
  type ExceptionCase,
  type ExceptionKind,
  type ReceivedShipmentRow,
} from "@/screens/inventory/exceptions-data"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import {
  signed,
  useActor,
  useSuspenseSiteLabel,
} from "@/screens/inventory/shared"

/// The Exceptions inbox: every case the live feeds hold — the ledger's own
/// missing balances, tags the readers saw somewhere else, and surat jalan the
/// stores signed for short — as one queue with the case beside it. A case
/// leaves when somebody resolves it, not when it is read.
///
/// The pane layout and the case sheet follow the prototype's variant C
/// (`renderC`/`renderCase` in `inventory-control-options.html`), drawn with
/// the hub's own two-pane grammar.

/// How old a case reads as somebody's problem.
const OVERDUE_DAYS = 30

const KIND_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "Missing", label: "Missing" },
  { value: "Extra", label: "Extra" },
  { value: "Seen elsewhere", label: "Seen elsewhere" },
]

const KIND_TONE: Record<ExceptionKind, "bad" | "warn" | "info"> = {
  Missing: "bad",
  Extra: "info",
  "Seen elsewhere": "warn",
}

function isMissingRow(raw: ExceptionCase["raw"]): raw is MissingItem {
  return "status" in raw
}

function isGapRow(raw: ExceptionCase["raw"]): raw is ReceivedShipmentRow {
  return "receipt_id" in raw
}

function KindDot({ kind }: { kind: ExceptionKind }) {
  const tone = KIND_TONE[kind]
  return (
    <span
      aria-hidden
      className={cn(
        "size-[5px] shrink-0 rounded-full",
        tone === "bad" && "bg-bad",
        tone === "warn" && "bg-warn",
        tone === "info" && "bg-info"
      )}
    />
  )
}

function ageText(days: number | null): string {
  if (days === null) return "—"
  if (days <= 0) return "today"
  return `${days} d`
}

/// A case on a card (a phone), the same card as every list (owner,
/// 2026-10-06): what it is about over its SKU, the signed quantity it leads
/// with, a foot that says which kind, where and how old, and a "Counting" pill
/// while a count already covers it.
function caseColumns(
  placeName: (siteId: string | null | undefined) => string
): ColumnDef<TableSetup, ExceptionCase>[] {
  return [
    {
      id: "head",
      accessorFn: (row) => row.article ?? row.sku ?? row.doc ?? row.id,
      header: "",
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[1rem] font-semibold break-words text-ink">
              {one.article ?? one.sku ?? one.doc ?? one.id}
            </span>
            {one.article !== null && one.sku !== null && (
              <span className="font-mono text-[0.9375rem] font-normal text-mute">
                {one.sku}
              </span>
            )}
          </span>
        )
      },
    },
    {
      id: "lead",
      accessorFn: (row) => row.qty,
      header: "",
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span
            className={cn(
              "text-[1.5rem] leading-tight font-semibold tracking-tight",
              row.original.qty < 0 ? "text-bad-fg" : "text-warn-fg"
            )}
          >
            {signed(row.original.qty)}
          </span>
          <span className="text-[0.9375rem] text-mute">pcs</span>
        </span>
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.ageDays ?? -1,
      header: "",
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => {
        const one = row.original
        return (
          <span className="flex flex-col leading-6">
            <span className="inline-flex items-center gap-2 text-ink">
              <KindDot kind={one.kind} />
              {one.kind}
            </span>
            <span className="tabular-nums">
              {placeName(one.place)}
              {" · "}
              <span
                className={cn(
                  one.ageDays !== null &&
                    one.ageDays > OVERDUE_DAYS &&
                    "font-medium text-bad-fg"
                )}
              >
                {ageText(one.ageDays)}
              </span>
            </span>
          </span>
        )
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: "",
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) =>
        row.original.status === "Counting" ? (
          <Pill tone="info">Counting</Pill>
        ) : null,
    },
  ]
}

export function Exceptions() {
  // The title stands at once; the cases wait for the feeds and the register of
  // places and stream in with them (the server starts the reads too).
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Exceptions"
        sub="What the books and the floor disagree about, waiting on a person."
      />
      <Suspense fallback={<LoadingState>Reading the exceptions…</LoadingState>}>
        <ExceptionInbox />
      </Suspense>
    </PageContent>
  )
}

function ExceptionInbox() {
  const { cases, feeds } = useSuspenseExceptionCases()
  const [kind, setKind] = useState<string>("")
  const [needle, setNeedle] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const placeName = useSuspenseSiteLabel()
  const phone = useLayout() === "phone"
  /// A phone opens a case in a sheet; a desk keeps it beside the list.
  const [sheetOpen, setSheetOpen] = useState(false)

  /// Client-side over what the feeds already answered: the searches behind
  /// these rows are the server's, and re-asking them per keystroke would only
  /// change which rows are hidden, not which rows exist.
  const filtered = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (kind === "" && q === "") return cases
    return cases.filter((one) => {
      if (kind !== "" && one.kind !== kind) return false
      if (q === "") return true
      return [
        one.sku ?? "",
        one.article ?? "",
        one.poolLabel,
        one.doc ?? "",
        placeName(one.place),
      ].some((value) => value.toLowerCase().includes(q))
    })
  }, [cases, kind, needle, placeName])

  /// A selection that fell out of the filter falls back to the first row,
  /// like the prototype's queue does.
  const active = useMemo(() => {
    if (filtered.length === 0) return null
    return filtered.find((one) => one.id === selectedId) ?? filtered[0]
  }, [filtered, selectedId])

  const cardColumnsOf = useMemo(() => caseColumns(placeName), [placeName])
  const phoneTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: filtered,
        columns: cardColumnsOf,
        getRowId: (row: ExceptionCase) => row.id,
      }),
      [filtered, cardColumnsOf]
    )
  )
  const kindCount = (value: string) =>
    cases.filter((one) => value === "" || one.kind === value).length

  return (
    <>
      {phone ? (
        <>
          {/* The kind is the status button and the search the field, in the
          dock, as on every list (owner, 2026-10-06). */}
          <DockTools
            search={{
              value: needle,
              onChange: setNeedle,
              label: "Search Exceptions",
            }}
            status={{
              value: kind,
              options: [
                { value: "", label: "All cases", count: kindCount("") },
                ...KIND_OPTIONS.map((one) => ({
                  value: one.value,
                  label: one.label,
                  count: kindCount(one.value),
                })),
              ],
              onChange: setKind,
            }}
          />
          {filtered.length === 0 ? (
            <EmptyState>Nothing here</EmptyState>
          ) : (
            <DataTable<ExceptionCase>
              refresh={feeds}
              table={phoneTable}
              onRowClick={(row) => {
                setSelectedId(row.id)
                setSheetOpen(true)
              }}
              pageScroll
              cardsApart
              cardLead
              cardSort={false}
            />
          )}
          <Sheet
            open={sheetOpen && active !== null}
            onOpenChange={setSheetOpen}
            title="Exception"
            caption={active?.kind}
          >
            {active !== null && (
              <CasePanel key={active.id} one={active} placeName={placeName} />
            )}
          </Sheet>
        </>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
              <Choice value={kind} onChange={setKind} options={KIND_OPTIONS} />
              <Input
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                className="h-8 w-full max-w-56 text-[0.9375rem] sm:w-56"
              />
              <RefreshStamp queries={feeds} className="ml-auto" />
              <span className="text-[0.9375rem] text-mute">
                {count(filtered.length)} cases
              </span>
            </div>
            {filtered.length === 0 ? (
              <EmptyState>Nothing here</EmptyState>
            ) : (
              filtered.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  onClick={() => setSelectedId(one.id)}
                  className={cn(
                    "flex w-full flex-col gap-1.5 border-b border-hairline px-4 py-3 text-left transition-colors last:border-b-0",
                    one.id === active?.id ? "bg-soft" : "hover:bg-soft/60"
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-ink">
                      {one.article ?? one.sku ?? one.doc ?? one.id}
                      {one.article !== null && one.sku !== null && (
                        <span className="ml-1.5 font-mono text-[0.9375rem] font-normal text-mute">
                          · {one.sku}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        one.qty < 0 ? "text-bad-fg" : "text-warn-fg"
                      )}
                    >
                      {signed(one.qty)}
                    </span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] text-mute">
                    <KindDot kind={one.kind} />
                    <span className="shrink-0">{one.kind}</span>
                    <span className="min-w-0 truncate">
                      {placeName(one.place)}
                    </span>
                    {one.status === "Counting" && (
                      <Pill tone="info" className="shrink-0">
                        Counting
                      </Pill>
                    )}
                    <span
                      className={cn(
                        "ml-auto shrink-0 tabular-nums",
                        one.ageDays !== null &&
                          one.ageDays > OVERDUE_DAYS &&
                          "font-medium text-bad-fg"
                      )}
                    >
                      {ageText(one.ageDays)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </Card>
          {active === null ? (
            <Card>
              <EmptyState>Nothing here</EmptyState>
            </Card>
          ) : (
            <CasePanel key={active.id} one={active} placeName={placeName} />
          )}
        </div>
      )}
    </>
  )
}

/// The selected case, with its figures, its facts, its movement and the
/// writes that close it.
function CasePanel({
  one,
  placeName,
}: {
  one: ExceptionCase
  placeName: (siteId: string | null | undefined) => string
}) {
  const client = useQueryClient()
  const actor = useActor()

  const missingRow = isMissingRow(one.raw) ? one.raw : null
  const gapRow = isGapRow(one.raw) ? one.raw : null

  /// The pool's own balances, for the figures. The same fleet read the feed
  /// mapped places with — one fetch, shared cache.
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const poolRow = fleet.data?.items.find((item) => item.id === one.pool) ?? null

  const figures: {
    label: string
    value: React.ReactNode
    tone?: "bad"
  }[] =
    missingRow !== null
      ? [
          // The book already carries the shortage the count posted, so the
          // pre-count book is the book minus the (negative) variance.
          {
            label: "Book",
            value: poolRow === null ? "—" : count(poolRow.stock - one.qty),
          },
          {
            label: "Counted",
            value: poolRow === null ? "—" : count(poolRow.stock),
          },
          {
            label: "Seen",
            value:
              poolRow === null || poolRow.observed === null
                ? "—"
                : count(poolRow.observed),
          },
          { label: "Variance", value: signed(one.qty), tone: "bad" },
        ]
      : gapRow !== null
        ? [
            { label: "Sent", value: count(gapRow.sent_qty) },
            { label: "Received", value: count(gapRow.received_qty) },
            { label: "Found since", value: count(gapRow.found_qty) },
            { label: "Gap", value: count(gapRow.open_gap_qty), tone: "bad" },
          ]
        : []

  /// The pool's recent movements for this SKU — the ledger's own account of
  /// how the piece got here. Server-narrowed: the pool matches either side
  /// of a posting, and the house order is newest first.
  const movementScope = useMemo<MovementScope | null>(() => {
    if (missingRow === null || one.sku === null || one.pool === "") return null
    return { q: one.sku, pool_id: one.pool, limit: 5 }
  }, [missingRow, one.sku, one.pool])
  const movements = useQuery({
    queryKey:
      movementScope === null
        ? inventoryKeys.movements()
        : inventoryKeys.movements(movementScope),
    queryFn: ({ signal }) => movementsPage(movementScope!, signal),
    enabled: movementScope !== null,
  })

  const refreshStock = () => {
    client.invalidateQueries({ queryKey: inventoryKeys.missing() })
    client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
    client.invalidateQueries({ queryKey: ["inventory", "pools"] })
  }

  /// Found and lost — the same writes the missing list makes, spent on this
  /// one row's whole balance.
  const resolve = useMutation({
    mutationFn: ({ outcome }: { outcome: "found" | "lost" }) => {
      const row = missingRow!
      return resolveMissing(row.id, outcome, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
        quantity: null,
        destination_pool_id: null,
        reason: outcome === "found" ? "Found" : "Written off",
        reference: null,
      })
    },
    onSuccess: (_receipt, { outcome }) => {
      setWrote(
        outcome === "found"
          ? "Found — moved back into stock"
          : "Written off · Stock adjustment"
      )
      refreshStock()
    },
  })

  /// A write that went through, held in the receipt dialog until it is read.
  /// One state for the three writes this panel can make.
  const [wrote, setWrote] = useState<string | null>(null)

  /// A receive gap has no row in `:missing` to resolve — the store simply
  /// never booked the pieces in. The ask is a count on the store's own
  /// stockroom, created and activated in one go; what it finds books the
  /// truth, whichever way it falls.
  const askCount = useMutation({
    mutationFn: async () => {
      const row = gapRow!
      if (poolRow === null)
        throw new Error("The store's stockroom is not in the fleet read yet.")
      const created = await createCount({
        site_id: poolRow.site_id,
        pool_id: poolRow.id,
        // The gap names a surat jalan, not a SKU, so the count is a cycle of
        // the stockroom rather than a targeted sweep.
        kind: "CYCLE",
        sku_ids: [],
        epcs: [],
        reason: `Receive gap · ${row.shipment_number}`,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
      return activateCount(created.id, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      })
    },
    onSuccess: () => {
      setWrote("Count asked")
      client.invalidateQueries({ queryKey: inventoryKeys.counts() })
      refreshStock()
    },
  })

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-hairline px-5 py-4">
        <div className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
          <span className="truncate font-mono text-id text-mute">{one.id}</span>
          <KindDot kind={one.kind} />
          <span
            className={cn(
              "shrink-0 font-medium",
              KIND_TONE[one.kind] === "bad" && "text-bad-fg",
              KIND_TONE[one.kind] === "warn" && "text-warn-fg",
              KIND_TONE[one.kind] === "info" && "text-info-fg"
            )}
          >
            {one.status === "Counting" ? "Counting" : one.kind}
          </span>
          {one.status === "Counting" && (
            <Pill tone="info" className="shrink-0">
              Counting
            </Pill>
          )}
        </div>
        <h2 className="text-card-title font-semibold text-ink">
          {one.article ?? one.doc ?? one.id}
          {(one.sku !== null || one.doc !== null) && (
            <span className="ml-1.5 font-mono text-[0.9375rem] font-normal text-mute">
              · {one.sku ?? one.doc}
            </span>
          )}
        </h2>
        <MetricRow>
          {figures.map((figure) => (
            <Metric
              key={figure.label}
              label={figure.label}
              value={figure.value}
              tone={figure.tone === "bad" ? "bad" : undefined}
            />
          ))}
        </MetricRow>
      </div>

      <div className="flex flex-col gap-6 px-5 py-4">
        <section>
          <h3 className="mb-3 text-card-title font-semibold text-ink">Case</h3>
          <Facts>
            <Fact term="Type">
              <span className="inline-flex items-center gap-1.5">
                <KindDot kind={one.kind} />
                {one.kind}
              </span>
            </Fact>
            <Fact term="Place">{placeName(one.place)}</Fact>
            <Fact term="Pool">
              {one.poolLabel === "" ? "—" : one.poolLabel}
            </Fact>
            <Fact term="From">
              {one.from}
              {one.doc !== null ? ` · ${one.doc}` : ""}
            </Fact>
            <Fact term="SKU">{one.sku ?? "—"}</Fact>
            <Fact term="Age">
              <span
                className={cn(
                  one.ageDays !== null &&
                    one.ageDays > OVERDUE_DAYS &&
                    "font-medium text-bad-fg"
                )}
              >
                {ageText(one.ageDays)}
              </span>
            </Fact>
            <Fact term="Last seen">
              {one.lastSeenAt === null
                ? "—"
                : `${moment(one.lastSeenAt)} · ${ago(one.lastSeenAt)}`}
            </Fact>
          </Facts>
        </section>

        <section>
          <h3 className="mb-3 text-card-title font-semibold text-ink">
            Movement
          </h3>
          {gapRow !== null ? (
            <ol className="flex flex-col">
              <TimelineRow
                when={moment(gapRow.received_at)}
                title={`Received short at ${gapRow.destination_name}`}
                sub={gapRow.shipment_number}
                qty={`−${count(gapRow.open_gap_qty)}`}
                tone="bad"
              />
            </ol>
          ) : one.sku === null ? (
            <p className="text-[0.9375rem] text-mute">
              No SKU on this row — nothing to trace through the ledger.
            </p>
          ) : (
            queryState(movements, {
              loading: "Reading the movements…",
              render: (page) =>
                page.rows.length === 0 ? (
                  <p className="text-[0.9375rem] text-mute">
                    Nothing has been posted for this SKU at this pool.
                  </p>
                ) : (
                  <ol className="flex flex-col">
                    {page.rows.map((row) => (
                      <TimelineRow
                        key={row.movement_id}
                        when={moment(row.occurred_at)}
                        title={humanise(row.cause)}
                        sub={`${row.from.replace(/:(on_hand|missing)$/, "")} → ${row.to.replace(/:(on_hand|missing)$/, "")}`}
                        qty={count(row.quantity)}
                      />
                    ))}
                  </ol>
                ),
            })
          )}
        </section>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-hairline px-5 py-4">
        {resolve.isError && (
          <Banner tone="bad">
            {resolve.error instanceof Error
              ? resolve.error.message
              : "Refused."}
          </Banner>
        )}
        {askCount.isError && (
          <Banner tone="bad">
            {askCount.error instanceof Error
              ? askCount.error.message
              : "Refused."}
          </Banner>
        )}
        {gapRow !== null && one.pool === "" && (
          <p className="text-[0.9375rem] text-mute">
            The store&rsquo;s stockroom is not in the fleet read — ask for the
            count from the store&rsquo;s own page.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {missingRow !== null && (
            <>
              <Button
                variant="soft"
                pending={resolve.isPending}
                disabled={actor === ""}
                onClick={() => resolve.mutate({ outcome: "found" })}
              >
                Found
              </Button>
              <ConfirmButton
                label="Confirm lost"
                tone="danger"
                variant="danger"
                title="Confirm lost?"
                confirmLabel="Confirm lost"
                description={`Posts ${signed(one.qty)} pcs out of ${
                  one.poolLabel === "" ? one.pool : one.poolLabel
                } as confirmed lost. The case leaves the inbox.`}
                pending={resolve.isPending}
                disabled={actor === ""}
                onConfirm={() => resolve.mutateAsync({ outcome: "lost" })}
              />
            </>
          )}
          {gapRow !== null && (
            <Button
              variant="primary"
              pending={askCount.isPending}
              disabled={actor === "" || one.pool === ""}
              onClick={() => askCount.mutate()}
            >
              Ask for a count
            </Button>
          )}
        </div>
      </div>
      <SavedDialog
        open={wrote !== null}
        onOpenChange={(next) => {
          if (!next) setWrote(null)
        }}
        title={wrote ?? ""}
      />
    </Card>
  )
}

/// One row of the case's timeline: when, what happened, and how many.
function TimelineRow({
  when,
  title,
  sub,
  qty,
  tone,
}: {
  when: string
  title: string
  sub?: string
  qty?: string
  tone?: "bad"
}) {
  return (
    <li className="relative flex items-baseline gap-3 border-l border-hairline py-1.5 pl-4">
      <span
        aria-hidden
        className="absolute top-[0.9rem] size-[5px] -translate-x-1/2 rounded-full bg-mute"
      />
      <span className="w-24 shrink-0 text-[0.9375rem] text-mute tabular-nums">
        {when}
      </span>
      <span className="min-w-0 flex-1 text-[0.9375rem] text-ink">
        {title}
        {sub !== undefined && (
          <span className="block truncate font-mono text-id text-mute">
            {sub}
          </span>
        )}
      </span>
      {qty !== undefined && (
        <span
          className={cn(
            "shrink-0 font-medium text-ink tabular-nums",
            tone === "bad" && "text-bad-fg"
          )}
        >
          {qty}
        </span>
      )}
    </li>
  )
}
