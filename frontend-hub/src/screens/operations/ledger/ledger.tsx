import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { label as humanise, count, moment } from "@/lib/format"
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
import { TwoLines } from "@/screens/operations/two-lines"

const PAGE = 100

/// What the Gudang calls each kind of posting.
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

/// **Stock ledger** — every movement in and out of the Gudang's pools, newest
/// first. The same ledger Inventory › Movements reads, narrowed to the DC.
export function StockLedger() {
  const [typed, setTyped] = useState("")
  const [pool, setPool] = useState("")
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
  // it is a Gudang pool.
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
        cell: ({ row }) => moment(row.original.occurred_at),
      },
      {
        accessorKey: "sku_code",
        header: "Article",
        size: 280,
        enableSorting: false,
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
      },
      {
        accessorKey: "in_qty",
        header: "In",
        size: 80,
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.in_qty === null ? "" : count(row.original.in_qty),
      },
      {
        accessorKey: "out_qty",
        header: "Out",
        size: 80,
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.out_qty === null ? "" : count(row.original.out_qty),
      },
      {
        accessorKey: "cause",
        header: "Cause",
        size: 160,
        enableSorting: false,
        cell: ({ row }) =>
          CAUSES[row.original.cause] ?? humanise(row.original.cause),
      },
      {
        id: "document",
        header: "Document",
        size: 180,
        enableSorting: false,
        meta: { mono: true },
        cell: ({ row }) => row.original.reference_id ?? "—",
      },
      {
        accessorKey: "actor_id",
        header: "By",
        size: 140,
        enableSorting: false,
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
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader title="Stock Ledger" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Search the ledger"
            className="h-11 w-80 pl-9"
          />
        </label>
        <Select
          className="h-11 w-60"
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
      <Card className="overflow-hidden">
        {queryState(ledger, {
          loading: "Reading the ledger…",
          render: () =>
            rows.length === 0 && !ledger.hasNextPage ? (
              <EmptyState>No movements.</EmptyState>
            ) : (
              <DataTable<Row>
                table={table}
                virtualizeAbove={0}
                rowHeight={72}
                more={ledger}
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>
    </PageContent>
  )
}
