import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { label as humanise, count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  fleetPools,
  inventoryKeys,
  movementsPage,
  type Movement,
  type MovementScope,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { TwoLines } from "@/screens/operations/two-lines"

const PAGE = 100

/// What the warehouse calls each kind of posting.
const CAUSES: Record<string, string> = {
  OPENING: "Opening",
  STORE_RECEIVE: "Store receive",
  NORMAL_MOVE: "Move",
  RETURN_TO_WAREHOUSE: "Return",
  SALE: "Sale",
  CUSTOMER_RETURN: "Customer return",
  SUPPLIER_RETURN: "Return PO",
  PLACEMENT_CORRECTION: "Correction",
  COUNT_SHORTAGE: "Count",
  COUNT_GAIN: "Count",
  FOUND: "Found",
  CONFIRMED_LOST: "Written off",
  DISPOSAL: "Written off",
  IDENTIFICATION: "Receive",
  TAGGING: "Receive",
  HANDED_OVER: "Dispatch",
}

/// The pool a place id sits in: `dc.warehouse:on_hand` → `dc.warehouse`.
const poolOf = (place: string) => {
  const cut = place.lastIndexOf(":")
  return cut === -1 ? null : place.slice(0, cut)
}

interface Row extends Movement {
  readonly in_qty: number | null
  readonly out_qty: number | null
  readonly pool: string
}

/// **Stock ledger** — every movement in and out of the warehouse's pools, newest
/// first. The same ledger Inventory › Movements reads, narrowed to the DC.
export function StockLedger() {
  const [typed, setTyped] = useState("")
  const [pool, setPool] = useState("")
  const phone = useLayout() === "phone"
  const needle = useDebounced(typed.trim(), 400)

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const dcPools = useMemo(
    () => (fleet.data?.items ?? []).filter((one) => one.site_kind === "DC"),
    [fleet.data]
  )
  const names = useMemo(
    () => new Map(dcPools.map((one) => [one.id, one.label])),
    [dcPools]
  )

  const scope = useMemo<MovementScope>(
    () => ({
      ...(needle === "" ? {} : { q: needle }),
      ...(pool === "" ? {} : { pool_id: pool }),
      limit: PAGE,
    }),
    [needle, pool]
  )

  const ledger = useInfiniteQuery({
    queryKey: inventoryKeys.movements(scope),
    queryFn: ({ pageParam, signal }) =>
      movementsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  // The ledger is the whole company's; a row belongs here when either side of
  // it is a warehouse pool.
  const rows = useMemo<Row[]>(() => {
    const mine = new Set(dcPools.map((one) => one.id))
    const out: Row[] = []
    for (const move of ledger.data?.pages.flatMap((page) => page.rows) ?? []) {
      const from = poolOf(move.from)
      const to = poolOf(move.to)
      const fromHere = from !== null && mine.has(from)
      const toHere = to !== null && mine.has(to)
      if (!fromHere && !toHere) continue
      const chosen = pool === "" ? null : pool
      const inHere = chosen === null ? toHere && !fromHere : to === chosen
      const outHere = chosen === null ? fromHere && !toHere : from === chosen
      out.push({
        ...move,
        in_qty: inHere ? move.quantity : null,
        out_qty: outHere ? move.quantity : null,
        pool:
          chosen !== null
            ? (names.get(chosen) ?? chosen)
            : fromHere && toHere
              ? `${names.get(from!) ?? from} → ${names.get(to!) ?? to}`
              : (names.get((fromHere ? from : to)!) ??
                (fromHere ? from : to) ??
                ""),
      })
    }
    return out
  }, [ledger.data, dcPools, names, pool])

  const columns = useMemo<ColumnDef<TableSetup, Row>[]>(
    () => [
      {
        accessorKey: "occurred_at",
        header: "Date",
        size: 150,
        enableSorting: false,
        meta: { card: "hide" },
        cell: ({ row }) => moment(row.original.occurred_at),
      },
      {
        accessorKey: "sku_code",
        header: "Article",
        size: 280,
        enableSorting: false,
        meta: { card: "hide" },
        cell: ({ row }) =>
          row.original.article_name ? (
            <TwoLines
              top={row.original.article_name}
              bottom={row.original.sku_code ?? "—"}
              mono
            />
          ) : (
            <span className="font-mono text-id text-ink">
              {row.original.sku_code ?? "—"}
            </span>
          ),
      },
      {
        accessorKey: "pool",
        header: "Pool",
        size: 220,
        enableSorting: false,
        meta: { card: "hide" },
      },
      {
        accessorKey: "in_qty",
        header: "In",
        size: 80,
        enableSorting: false,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) =>
          row.original.in_qty === null ? "" : count(row.original.in_qty),
      },
      {
        accessorKey: "out_qty",
        header: "Out",
        size: 80,
        enableSorting: false,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) =>
          row.original.out_qty === null ? "" : count(row.original.out_qty),
      },
      {
        accessorKey: "cause",
        header: "Cause",
        size: 160,
        enableSorting: false,
        meta: { card: "hide" },
        cell: ({ row }) =>
          CAUSES[row.original.cause] ?? humanise(row.original.cause),
      },
      {
        id: "document",
        header: "Document",
        size: 180,
        enableSorting: false,
        meta: { mono: true, card: "hide" },
        cell: ({ row }) => row.original.reference_id ?? "—",
      },
      // Four columns that exist only on a card (a phone): the article over its
      // SKU, the pieces that came in or went out, what and where and when and
      // by whom in the foot, and the document it was posted for.
      {
        id: "head",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "title" },
        accessorFn: (row) => row.article_name ?? row.sku_code ?? "",
        cell: ({ row }) => (
          <CardName
            name={row.original.article_name ?? row.original.sku_code ?? "—"}
            code={row.original.article_name ? row.original.sku_code : undefined}
          />
        ),
      },
      {
        id: "lead",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "lead" },
        accessorFn: (row) => row.quantity,
        cell: ({ row }) => {
          const { in_qty, out_qty, quantity } = row.original
          return (
            <CardFigure
              value={
                in_qty !== null
                  ? `+${count(in_qty)}`
                  : out_qty !== null
                    ? `−${count(out_qty)}`
                    : count(quantity)
              }
              caption={
                in_qty !== null ? "in" : out_qty !== null ? "out" : "moved"
              }
            />
          )
        },
      },
      {
        id: "foot",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "foot" },
        accessorFn: (row) => row.occurred_at,
        cell: ({ row }) => (
          <span className="flex flex-col leading-6">
            <span>
              {CAUSES[row.original.cause] ?? humanise(row.original.cause)} ·{" "}
              {row.original.pool}
            </span>
            <span className="tabular-nums">
              {moment(row.original.occurred_at)} · {row.original.actor_id}
            </span>
          </span>
        ),
      },
      {
        id: "doc",
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { align: "right", card: "status" },
        accessorFn: (row) => row.reference_id ?? "",
        cell: ({ row }) =>
          row.original.reference_id === null ? null : (
            <span className="font-mono text-[0.9375rem] text-mute">
              {row.original.reference_id}
            </span>
          ),
      },
      {
        accessorKey: "actor_id",
        header: "By",
        size: 140,
        enableSorting: false,
        meta: { card: "hide" },
      },
    ],
    []
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Row) => row.movement_id,
        manualSorting: true,
        // The card's own columns are drawn on a phone and never on a desk.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            doc: phone,
          },
        },
      }),
      [rows, columns, phone]
    )
  )

  return (
    <PageContent>
      <PageHeader title="Stock Ledger" />
      {/* On a phone the search and the pool are the dock's. */}
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search the ledger",
        }}
        status={{
          value: pool,
          options: [
            { value: "", label: "All pools" },
            ...dcPools
              .filter((one) => !one.is_rollup)
              .map((one) => ({ value: one.id, label: one.label })),
          ],
          onChange: setPool,
        }}
      />
      <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={typed}
          onChange={setTyped}
          label="Search the ledger"
        />
        <Select
          className="h-[2.125rem] w-60 pointer-coarse:h-11"
          value={pool}
          onChange={setPool}
          aria-label="Pool"
        >
          <option value="">All pools</option>
          {dcPools
            .filter((one) => !one.is_rollup)
            .map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
        </Select>
      </div>
      <Card
        aria-busy={ledger.isPlaceholderData || undefined}
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {queryState(ledger, {
          loading: "Reading the ledger…",
          render: () =>
            rows.length === 0 && !ledger.hasNextPage ? (
              <EmptyState>No movements.</EmptyState>
            ) : (
              <DataTable<Row>
                refresh={[ledger]}
                table={table}
                virtualizeAbove={0}
                rowHeight={72}
                more={ledger}
                className="max-h-[calc(100dvh-14rem)] max-md:max-h-none"
                pageScroll={phone}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
