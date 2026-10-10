import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState } from "@/components/ui/states"
import { ago, count, quantity, type Tone } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { koliQuery } from "@/lib/operations/queries"
import { prefetchKoliDetail } from "@/screens/operations/prefetch"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { PackSheets } from "@/screens/operations/packing/packing"
import { PackingCell } from "@/screens/operations/packing/packing-cell"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { usePackingShort } from "@/screens/operations/packing/packing-short"
import { ROOMY } from "@/screens/operations/roomy"
import type { Koli } from "@itulah/contract"

/// **Packing lists** — one per sealed carton.
///
/// The packing list is what prints when a carton is sealed, so this is the
/// list of every carton the DC has sealed, newest first. A row opens the same
/// carton sheet Packing and the Outbound board open — in place, so the URL
/// stays here — and its Print button is that sheet's.
interface Row {
  readonly koli: Koli
  readonly shop: string
  readonly status: { readonly text: string; readonly tone: Tone }
  /// Pieces the allotment gave up after this carton — 0 when it took everything.
  readonly short: number
}

type Tab = "all" | "completed" | "short"

/// Where the carton is, in the three words a bench uses. The node derives
/// `position` from containment; everything before the road is still ready.
function statusOf(position: string): Row["status"] {
  switch (position.toLowerCase()) {
    case "in_transit":
      return { text: "In transit", tone: "info" }
    case "delivered":
      return { text: "Received", tone: "ok" }
    default:
      return { text: "Ready to dispatch", tone: "warn" }
  }
}

/// `phone`: the card's own columns exist on a phone only, so a desk's and a
/// tablet's columns are exactly what they were.
function columnsFor(phone: boolean): ColumnDef<TableSetup, Row>[] {
  const cards: ColumnDef<TableSetup, Row>[] = [
    // Four columns that exist only on a card (`cardLead`; a phone): the shop
    // over the carton's number and age, the pieces it holds, the packing
    // result on the foot's left and where the carton is on its right.
    {
      id: "head",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      accessorFn: (row) => row.shop,
      cell: ({ row }) => (
        <CardName
          name={row.original.shop}
          line={
            <>
              <span className="font-mono">{row.original.koli.koli_number}</span>
              {" · "}
              {ago(row.original.koli.sealed_at)}
            </>
          }
        />
      ),
    },
    {
      id: "lead",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      accessorFn: (row) => row.koli.unit_count,
      cell: ({ row }) => (
        <CardFigure
          value={count(row.original.koli.unit_count)}
          caption={row.original.koli.unit_count === 1 ? "pc" : "pcs"}
        />
      ),
    },
    {
      id: "foot",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      accessorFn: (row) => row.short,
      cell: ({ row }) =>
        row.original.short > 0 ? (
          <Status tone="warn">
            Closed short · −{quantity(row.original.short)}
          </Status>
        ) : (
          <Status tone="ok">Completed</Status>
        ),
    },
    {
      id: "where",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      accessorFn: (row) => row.status.text,
      cell: ({ row }) => (
        <Pill tone={row.original.status.tone}>{row.original.status.text}</Pill>
      ),
    },
  ]

  return [
    {
      id: "number",
      header: "Packing List",
      size: 220,
      enableSorting: false,
      meta: { card: "hide" },
      accessorFn: (row) => row.koli.koli_number,
      cell: ({ row }) => (
        <span className="font-mono text-[0.875rem] text-ink">
          {row.original.koli.koli_number}
        </span>
      ),
    },
    {
      id: "shop",
      header: "Shop",
      size: 240,
      enableSorting: false,
      meta: { card: "hide", grow: 140 },
      accessorFn: (row) => row.shop,
      cell: ({ row }) => (
        <span className="truncate font-medium text-ink">
          {row.original.shop}
        </span>
      ),
    },
    {
      id: "pieces",
      header: "Pcs",
      size: 120,
      enableSorting: false,
      meta: { align: "right", card: "hide" },
      accessorFn: (row) => row.koli.unit_count,
      cell: ({ row }) => `${quantity(row.original.koli.unit_count)}`,
    },
    {
      id: "sealed",
      header: "Sealed",
      size: 150,
      enableSorting: false,
      meta: { card: "hide", priority: 2 },
      accessorFn: (row) => row.koli.sealed_at,
      cell: ({ row }) => (
        <span className="tabular-nums">{ago(row.original.koli.sealed_at)}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 190,
      enableSorting: false,
      meta: { card: "hide" },
      accessorFn: (row) => row.status.text,
      cell: ({ row }) => (
        <Pill tone={row.original.status.tone}>{row.original.status.text}</Pill>
      ),
    },
    {
      id: "packing",
      header: "Packing",
      size: 280,
      enableSorting: false,
      meta: { card: "hide" },
      accessorFn: (row) => (row.short > 0 ? "Closed short" : "Completed"),
      cell: ({ row }) => <PackingCell short={row.original.short} />,
    },
    ...(phone ? cards : []),
  ]
}

export function PackingLists() {
  const client = useQueryClient()
  const opened = useSheet("koli")
  const shopName = useShopName()
  const [typed, setTyped] = useState("")
  const [tab, setTab] = useState<Tab>("all")
  const shorts = usePackingShort()
  const phone = useLayout() === "phone"
  const columns = useMemo(() => columnsFor(phone), [phone])

  const list = useQuery(koliQuery())

  const searched = useMemo<Row[]>(() => {
    const needle = typed.trim().toLowerCase()
    return (list.data ?? [])
      .filter((one) => one.sealed_at !== null)
      .map((koli) => ({
        koli,
        shop: shopName(koli.destination_store_id),
        status: statusOf(koli.position),
        short: shorts.get(koli.koli_id) ?? 0,
      }))
      .filter(
        (row) =>
          needle === "" ||
          row.koli.koli_number.toLowerCase().includes(needle) ||
          row.shop.toLowerCase().includes(needle)
      )
      .sort(
        (a, b) =>
          Date.parse(b.koli.sealed_at ?? "") -
            Date.parse(a.koli.sealed_at ?? "") ||
          b.koli.koli_number.localeCompare(a.koli.koli_number)
      )
  }, [list.data, typed, shopName, shorts])

  const shortCount = searched.filter((row) => row.short > 0).length
  const rows = useMemo(
    () =>
      searched.filter((row) =>
        tab === "all" ? true : tab === "short" ? row.short > 0 : row.short === 0
      ),
    [searched, tab]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Row) => row.koli.koli_id,
        manualSorting: true,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader title="Packing Lists" />
      <SubTabs
        // The status is the dock's on a phone (below).
        className="max-md:hidden"
        value={tab}
        onChange={(next) => setTab(next as Tab)}
        tabs={[
          { value: "all", label: `All · ${count(searched.length)}` },
          {
            value: "completed",
            label: `Completed · ${count(searched.length - shortCount)}`,
          },
          { value: "short", label: `Closed short · ${count(shortCount)}` },
        ]}
      />
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search packing lists",
        }}
        status={{
          value: tab,
          options: [
            { value: "all", label: "All", count: searched.length },
            {
              value: "completed",
              label: "Completed",
              count: searched.length - shortCount,
            },
            { value: "short", label: "Closed short", count: shortCount },
          ],
          onChange: (next) => setTab(next as Tab),
        }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 max-md:hidden">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Search packing lists"
            className="h-11 w-80 pl-9"
          />
        </label>
      </div>
      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the packing lists…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {tab === "short"
                  ? "No packing lists closed short."
                  : "No packing lists yet."}
              </EmptyState>
            ) : (
              <DataTable<Row>
                refresh={[list]}
                table={table}
                touch
                pageScroll
                className={ROOMY}
                onRowClick={(row) => opened.open(row.koli.koli_id)}
                onRowIntent={(row) =>
                  void prefetchKoliDetail(client, row.koli.koli_id)
                }
                isSelected={(row) => row.koli.koli_id === opened.value}
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>
      <PackSheets />
    </PageContent>
  )
}
