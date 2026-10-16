import {
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Pill } from "@/components/ui/pill"
import { Tag } from "@/components/ui/tag"
import { SHOW_MISSING, withoutMissing } from "@/lib/features"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  AVAILABILITY_OPENING_POOL,
  availabilityQuery,
  fleetPoolsQuery,
  type AvailabilityItem,
} from "@/lib/queries/inventory"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { Choice } from "@/screens/inventory/parts"
import { placements } from "@/screens/inventory/shared"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import {
  DisplayUnitPicker,
  useDisplayUnit,
  type DisplayUnit,
} from "@/screens/inventory/unit-display"

/// What one pool can still promise, per SKU.
///
/// The equation the server prints in its own answer — `Stock = On Hand +
/// Allotted + Missing` — is the whole screen. On Hand is the number that
/// matters and it is the one that can go negative: allotting is a promise, and
/// a pool is allowed to find out it has promised more than it holds. A negative
/// row here is the same fact the allotments screen calls a shortage.
///
/// Paging is the server's SKU-code cursor, walked as the table scrolls. The
/// rows come in SKU-code order and the table does not re-sort them: sorting
/// the loaded pages by On hand would put "the worst of these" where "the
/// worst" belongs. The over-promised question goes to the server instead, as
/// the Over-promised view (`shortfall=true`), which is every such SKU.
///
/// # Why there is no filter panel here
///
/// Every other list in this module got one on 2026-09-11 and this one did not,
/// which is a decision rather than an omission. This screen is narrowed at the
/// SERVER, twice over: the pool and the needle go on the wire as
/// `source_pool_id` and `q`, and the answer is one cursor page of 200 SKUs out
/// of a pool that holds thousands. A clause evaluated in the browser would
/// narrow THAT PAGE — "on hand below zero" over two hundred rows, while the scroll
/// walks on through pages it never saw — and the reader would have no way to
/// tell the difference between "three SKUs are oversold" and "three of these
/// two hundred are".
///
/// So the panel arrives here when the clause can travel with the request. That
/// is an endpoint change (`/inventory/availability` taking a division, a
/// quantity bound, a negative-on-hand flag), and when it lands this screen
/// becomes a `useFilterState(fields)` one with `counted` options from the
/// response — no table facets — exactly like Sourcing and Articles.

function availabilityColumns(
  display: DisplayUnit
): ColumnDef<TableSetup, AvailabilityItem>[] {
  return [
    {
      id: "article",
      accessorFn: (row) => `${row.article_name} ${row.article_code}`,
      header: "Article",
      size: 260,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="block truncate text-ink">
            {row.original.article_name}
          </span>
          <span className="font-mono text-id text-mute">
            {row.original.article_code}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "sku_code",
      header: "SKU",
      size: 140,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="font-mono text-id text-body">
          {row.original.sku_code}
        </span>
      ),
    },
    {
      id: "variant",
      accessorFn: (row) => `${row.colour ?? ""} ${row.size ?? ""}`,
      header: "Variant",
      size: 150,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="text-body">
          {[row.original.colour, row.original.size]
            .filter(Boolean)
            .join(" · ") || "—"}
        </span>
      ),
    },
    {
      accessorKey: "division_code",
      header: "Division",
      size: 110,
      meta: { card: "hide" },
      cell: ({ row }) =>
        row.original.division_code ? (
          <Tag>{row.original.division_code}</Tag>
        ) : (
          <span className="text-mute">—</span>
        ),
    },
    {
      accessorKey: "stock_qty",
      header: "Stock",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => display.format(row.original.stock_qty),
    },
    {
      accessorKey: "allotted_qty",
      header: "Allotted",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span
          className={
            row.original.allotted_qty > 0 ? "text-info-fg" : "text-mute"
          }
        >
          {display.format(row.original.allotted_qty)}
        </span>
      ),
    },
    {
      accessorKey: "on_hand_qty",
      header: "On Hand",
      size: 110,
      meta: { align: "right", card: "hide" },
      // The decision metric, and the reason the list opens sorted by it: a
      // negative on hand is stock promised twice.
      cell: ({ row }) => (
        <span
          className={
            row.original.on_hand_qty < 0
              ? "font-medium text-bad-fg"
              : row.original.on_hand_qty === 0
                ? "text-mute"
                : "text-ink"
          }
        >
          {display.format(row.original.on_hand_qty)}
        </span>
      ),
    },
    {
      accessorKey: "missing_qty",
      header: "Missing",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span
          className={
            row.original.missing_qty > 0 ? "text-warn-fg" : "text-mute"
          }
        >
          {display.format(row.original.missing_qty)}
        </span>
      ),
    },
    // Four columns that exist only on a card (`cardLead`; a phone): the article
    // over its variant and SKU, what is on hand (the figure the list is read
    // by, red when it was promised twice), stock and allotted on the foot, and
    // the flag for the over-promised.
    {
      id: "head",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      accessorFn: (row) => row.article_name,
      cell: ({ row }) => {
        const variant = [row.original.colour, row.original.size]
          .filter(Boolean)
          .join(" · ")
        return (
          <CardName
            name={row.original.article_name}
            line={
              <>
                {variant !== "" && <>{variant} · </>}
                <span className="font-mono">{row.original.sku_code}</span>
              </>
            }
          />
        )
      },
    },
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      accessorFn: (row) => row.on_hand_qty,
      cell: ({ row }) => (
        <CardFigure
          value={display.format(row.original.on_hand_qty)}
          caption="on hand"
          tone={
            row.original.on_hand_qty < 0
              ? "bad"
              : row.original.on_hand_qty === 0
                ? "quiet"
                : undefined
          }
        />
      ),
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      accessorFn: (row) => row.stock_qty,
      cell: ({ row }) => (
        <span className="tabular-nums">
          Stock {display.format(row.original.stock_qty)} · Allotted{" "}
          {display.format(row.original.allotted_qty)}
        </span>
      ),
    },
    {
      id: "flag",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      accessorFn: (row) => (row.on_hand_qty < 0 ? 1 : 0),
      cell: ({ row }) =>
        row.original.on_hand_qty < 0 ? (
          <Pill tone="bad">Over-promised</Pill>
        ) : null,
    },
  ]
}

export function Availability() {
  // The title stands at once; the pool waits for the fleet and its first page
  // and streams in with them (the server starts the reads too).
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="On Hand & Shortfall"
        sub="What one pool can still promise, SKU by SKU."
      />
      <Suspense fallback={<LoadingState>Reading the pool…</LoadingState>}>
        <AvailabilityPool />
      </Suspense>
    </PageContent>
  )
}

function AvailabilityPool() {
  const phone = useLayout() === "phone"
  const [pool, setPool] = useState(AVAILABILITY_OPENING_POOL)
  const [text, setText] = useState("")
  const [view, setView] = useState<"all" | "short">("all")

  // Debounced: every keystroke folds the pool's ledger again.
  const needle = useDebounced(text.trim(), 400)
  const shortfall = view === "short"

  const pools = useSuspenseQuery(fleetPoolsQuery())

  // Shared with the prefetcher (`screens/inventory/prefetch.ts`). The deferred
  // question keeps the rows in hand on screen while the next one is read.
  const askedPool = useDeferredValue(pool)
  const askedNeedle = useDeferredValue(needle)
  const askedShortfall = useDeferredValue(shortfall)
  const page = useSuspenseInfiniteQuery(
    availabilityQuery(askedPool, askedNeedle, askedShortfall)
  )

  const rows = useMemo(
    () => page.data.pages.flatMap((one) => one.items) as AvailabilityItem[],
    [page.data]
  )

  const total = page.data.pages[0]

  const display = useDisplayUnit()
  const columns = useMemo(
    () => withoutMissing(availabilityColumns(display)),
    [display]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AvailabilityItem) => row.sku_id,
        // The server orders by SKU code and nothing else; see above.
        enableSorting: false,
        // The card's own columns are drawn on a phone and never on a desk.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            flag: phone,
          },
        },
      }),
      [rows, columns, phone]
    )
  )

  const poolOptions = useMemo(
    () =>
      placements(pools.data.items).map((item) => ({
        value: item.id,
        label: `${item.site_id} · ${item.label}`,
      })),
    [pools.data]
  )

  return (
    <>
      {/* The pool's own figures are over the whole matching set and arrive on
          every page; the first page's are the ones to show. A phone draws them
          as the one card of two to a row, as every list's figures. */}
      <KpiStrip
        className={
          SHOW_MISSING
            ? "grid-cols-2 md:grid-cols-4 xl:grid-cols-4"
            : "grid-cols-2 md:grid-cols-3 xl:grid-cols-3"
        }
      >
        <Kpi
          label="Stock"
          value={total === undefined ? "—" : display.format(total.stock_qty)}
        />
        <Kpi
          label="Allotted"
          value={total === undefined ? "—" : display.format(total.allotted_qty)}
        />
        <Kpi
          label="On hand"
          value={
            total === undefined ? (
              "—"
            ) : (
              <span
                className={total.on_hand_qty < 0 ? "text-bad-fg" : undefined}
              >
                {display.format(total.on_hand_qty)}
              </span>
            )
          }
        />
        {SHOW_MISSING && (
          <Kpi
            label="Missing"
            value={
              total === undefined ? "—" : display.format(total.missing_qty)
            }
          />
        )}
      </KpiStrip>

      <Toolbar>
        <Choice
          value={pool}
          onChange={setPool}
          options={poolOptions}
          className="max-w-72"
        />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search"
          className="h-8 w-64"
        />
        <Toolbar.Spacer />
        <DisplayUnitPicker display={display} />
        <Segmented
          options={[
            { value: "all", label: "Every SKU" },
            { value: "short", label: "Over-promised" },
          ]}
          value={view}
          onChange={setView}
        />
      </Toolbar>

      <Card
        aria-busy={
          askedPool !== pool ||
          askedNeedle !== needle ||
          askedShortfall !== shortfall ||
          undefined
        }
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {rows.length === 0 ? (
          <EmptyState>
            {needle !== ""
              ? `Nothing in this pool matches “${needle}”.`
              : shortfall
                ? "Nothing in this pool is promised beyond what it holds."
                : "This pool holds no SKU the catalogue still lists as active."}
          </EmptyState>
        ) : (
          <>
            <DataTable<AvailabilityItem>
              refresh={[page]}
              table={table}
              more={page}
              className="max-h-[calc(100dvh-21rem)]"
              cardSort={false}
              cardsApart
              cardLead
            />
            <div className="border-t border-hairline px-4 py-2.5 text-[0.9375rem] text-mute tabular-nums max-md:border-t-0 max-md:px-1">
              {count(total.total_items)} SKUs
              <span className="ml-3">{total.inventory_equation}</span>
            </div>
          </>
        )}
      </Card>
    </>
  )
}
