import { useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Fragment, Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, day, money, percentOf, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  cogsQuery,
  goodsInTransitQuery,
  stockAdjustmentsQuery,
  type CogsMonthRow,
  type GoodsInTransitRow,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  CardRow,
  Code,
  Grid,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { UnitDock, UnitPick } from "@/screens/finance/inventory"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { PhoneFigures } from "@/screens/finance/parts"

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

// ---------------------------------------------------------------------------
// Goods in transit
// ---------------------------------------------------------------------------

export function GoodsInTransitScreen() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Inventory"
          title="Goods in Transit"
          className="max-md:hidden"
        >
          Reading the goods on the road…
        </ScreenPending>
      }
    >
      <GoodsInTransit />
    </Suspense>
  )
}

function GoodsInTransit() {
  const [tab, setTab] = useState("road")
  const [needle, setNeedle] = useState("")
  const result = useSuspenseQuery(goodsInTransitQuery())
  const rows = result.data
  const road = rows.filter((row) => row.status === "ON_THE_ROAD")
  const short = rows.filter((row) => row.status === "SHORT")
  const roadValue = sum(road, (row) => row.value_minor)
  const shortValue = sum(short, (row) => row.value_minor)
  const phone = useLayout() === "phone"

  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase()
    return rows
      .filter((row) =>
        tab === "road"
          ? row.status === "ON_THE_ROAD"
          : tab === "short"
            ? row.status === "SHORT"
            : true
      )
      .filter(
        (row) =>
          q === "" ||
          (row.shipment_reference ?? "").toLowerCase().includes(q) ||
          (row.article_code ?? "").toLowerCase().includes(q) ||
          (row.article_name ?? "").toLowerCase().includes(q) ||
          row.destination_name.toLowerCase().includes(q)
      )
  }, [rows, tab, needle])

  const groups = useMemo(() => {
    const map = new Map<string, GoodsInTransitRow[]>()
    for (const row of shown) {
      const key = row.shipment_reference ?? "—"
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return [...map.entries()]
  }, [shown])

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Goods in Transit"
      />
      <>
        <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
          <Kpi
            label="On the road"
            value={money(roadValue)}
            delta={quantity(sum(road, (row) => row.quantity))}
            tone="flat"
          />
          <Kpi
            label="Short at count"
            value={
              <span className={shortValue > 0 ? "text-warn-fg" : undefined}>
                {money(shortValue)}
              </span>
            }
            delta="Not in the box when the shop counted — settle as found or lost"
            tone="flat"
          />
          <Kpi label="In transit" value={money(roadValue + shortValue)} />
        </KpiStrip>

        <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
          <SubTabs
            // The three views are the status button in the dock on a phone.
            className="max-md:hidden"
            tabs={[
              { value: "road", label: "On the road" },
              { value: "short", label: "Short at count" },
              { value: "all", label: "All" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <ExpandingSearch
            value={needle}
            onChange={setNeedle}
            label="Search goods in transit"
          />
        </div>
        <DockTools
          search={{
            value: needle,
            onChange: setNeedle,
            label: "Search goods in transit",
          }}
          status={{
            value: tab,
            options: [
              { value: "road", label: "On the road" },
              { value: "short", label: "Short at count" },
              { value: "all", label: "All" },
            ],
            onChange: setTab,
          }}
        />

        <div>
          {groups.length === 0 ? (
            <EmptyState>
              {needle.trim() !== ""
                ? "Nothing matches."
                : tab === "short"
                  ? "Nothing is short at count."
                  : "Nothing is on the road."}
            </EmptyState>
          ) : phone ? (
            <PhoneList
              rows={shown.map((row) => ({
                key: row.allotment_line_id,
                title: row.article_name ?? "—",
                code: row.article_code ?? row.sku_code,
                lead: (
                  <CardFigure
                    value={money(row.value_minor)}
                    caption={`${count(row.quantity)} pcs`}
                  />
                ),
                alert: row.status === "SHORT",
                foot: (
                  <span className="block">
                    <span className="block">
                      {row.shipment_reference ?? "—"}
                      {row.koli_number !== null && ` · Koli ${row.koli_number}`}
                    </span>
                    <span className="block">
                      To {row.destination_name} · sent {day(row.dispatched_on)}
                      {" · "}
                      <span
                        className={
                          row.status === "ON_THE_ROAD" && row.days > 3
                            ? "text-warn-fg"
                            : undefined
                        }
                      >
                        {count(row.days)} {row.days === 1 ? "day" : "days"}
                      </span>
                    </span>
                  </span>
                ),
              }))}
            />
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Delivery note</Th>
                  <Th>To</Th>
                  <Th>Article</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Value</Th>
                  <Th>Sent</Th>
                  <Th align="right">Days</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([reference, lines]) => (
                  <Fragment key={reference}>
                    {lines.map((row, index) => (
                      <tr key={row.allotment_line_id}>
                        <Td>
                          {index === 0 && (
                            <div className="flex flex-col">
                              <Code>{reference}</Code>
                              {row.koli_number !== null && (
                                <span className="text-[0.9375rem] text-mute">
                                  Koli {row.koli_number}
                                </span>
                              )}
                            </div>
                          )}
                        </Td>
                        <Td>{row.destination_name}</Td>
                        <Td>
                          <div className="flex flex-col">
                            <Code>{row.article_code ?? row.sku_code}</Code>
                            <span className="text-ink">
                              {row.article_name ?? "—"}
                            </span>
                          </div>
                        </Td>
                        <Td align="right">{count(row.quantity)}</Td>
                        <Td align="right">{money(row.value_minor)}</Td>
                        <Td>{day(row.dispatched_on)}</Td>
                        <Td
                          align="right"
                          className={
                            row.status === "ON_THE_ROAD" && row.days > 3
                              ? "text-warn-fg"
                              : undefined
                          }
                        >
                          {count(row.days)}
                        </Td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td align="right">
                    {count(sum(shown, (row) => row.quantity))}
                  </Td>
                  <Td align="right">
                    {money(sum(shown, (row) => row.value_minor))}
                  </Td>
                  <Td />
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
          )}
        </div>
      </>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Cost of goods sold
// ---------------------------------------------------------------------------

function percent(part: number, whole: number): string {
  return percentOf(part, whole)
}

/// One month per row. On a phone the same columns are the card: the month,
/// then what it sold, what that cost and what was left.
const cogsColumns: ColumnDef<TableSetup, CogsMonthRow>[] = [
  {
    id: "month",
    accessorFn: (row) => row.month,
    header: "Month",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) =>
      dateText(new Date(row.original.year, row.original.month - 1, 1), {
        month: "long",
      }),
  },
  {
    accessorKey: "revenue_minor",
    header: "Net sales",
    size: 180,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.revenue_minor),
  },
  {
    accessorKey: "cogs_minor",
    header: "COGS",
    size: 180,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.cogs_minor),
  },
  {
    accessorKey: "gross_margin_minor",
    header: "Gross margin",
    size: 180,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.gross_margin_minor),
  },
  {
    id: "margin_percent",
    accessorFn: (row) =>
      row.revenue_minor === 0 ? 0 : row.gross_margin_minor / row.revenue_minor,
    header: "Margin %",
    size: 130,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      percent(row.original.gross_margin_minor, row.original.revenue_minor),
  },
]

export function CogsScreen() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Inventory"
          title="Cost of Goods Sold"
          className="max-md:hidden"
        >
          Reading sales and cost…
        </ScreenPending>
      }
    >
      <Cogs />
    </Suspense>
  )
}

function Cogs() {
  const phone = useLayout() === "phone"
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [unit, setUnit] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  // The year answers at once; the figures trail it, and the ones in hand stay
  // on screen until the next are read.
  const result = useSuspenseQuery(cogsQuery(useDeferredValue(year)))

  const months = useMemo(() => {
    const map = new Map<number, CogsMonthRow>()
    for (const row of result.data) {
      if (unit !== null && row.unit_id !== unit) continue
      const one = map.get(row.month) ?? {
        unit_id: unit ?? "",
        unit_name: "",
        year: row.year,
        month: row.month,
        revenue_minor: 0,
        cogs_minor: 0,
        gross_margin_minor: 0,
      }
      one.revenue_minor += row.revenue_minor
      one.cogs_minor += row.cogs_minor
      one.gross_margin_minor += row.gross_margin_minor
      map.set(row.month, one)
    }
    return [...map.values()].sort((a, b) => b.month - a.month)
  }, [result.data, unit])

  const revenue = sum(months, (row) => row.revenue_minor)
  const cogs = sum(months, (row) => row.cogs_minor)
  const margin = sum(months, (row) => row.gross_margin_minor)

  const [measure, fit] = useColumnFit(cogsColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: months,
        columns: cogsColumns,
        getRowId: (row: CogsMonthRow) => String(row.month),
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [months, sorting, phone, fit]
    )
  )

  const years = [
    { value: String(thisYear), label: String(thisYear) },
    { value: String(thisYear - 1), label: String(thisYear - 1) },
  ]

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Cost of Goods Sold"
      />

      <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Net sales" value={money(revenue)} />
        <Kpi label="Cost of goods sold" value={money(cogs)} />
        <Kpi
          label="Gross margin"
          value={money(margin)}
          delta={`${percent(margin, revenue)} margin`}
          tone="flat"
        />
      </KpiStrip>

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <SubTabs
          // The years are the status button in the dock on a phone.
          className="max-md:hidden"
          tabs={years}
          value={String(year)}
          onChange={(value) => setYear(Number(value))}
        />
        <UnitPick value={unit} onChange={setUnit} />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <UnitDock value={unit} onChange={setUnit} />
      <DockTools
        sort={dockSortOf(table)}
        status={{
          value: String(year),
          options: years,
          onChange: (value) => setYear(Number(value)),
        }}
      />

      {months.length === 0 ? (
        <EmptyState>No sales booked in {year}.</EmptyState>
      ) : (
        <div ref={measure}>
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<CogsMonthRow>
              table={table}
              refresh={[result]}
              pageScroll
              cardsApart
              cardSort={false}
              summary={{
                month: "Total",
                revenue_minor: money(revenue),
                cogs_minor: money(cogs),
                gross_margin_minor: money(margin),
                margin_percent: percent(margin, revenue),
              }}
            />
          </Card>
        </div>
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Stock adjustments
// ---------------------------------------------------------------------------

function kindText(kind: string): string {
  if (kind === "SHORT_AT_COUNT") return "Short at count"
  if (kind === "MISSING") return "Missing"
  if (kind === "STOCK_COUNT") return "Stock count"
  const words = kind.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function StockAdjustmentsScreen() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Inventory"
          title="Stock Adjustments"
          className="max-md:hidden"
        >
          Reading the adjustments…
        </ScreenPending>
      }
    >
      <StockAdjustments />
    </Suspense>
  )
}

function StockAdjustments() {
  const [tab, setTab] = useState("waiting")
  // The unit's name alone, as every Finance screen shows it (no code prefix).
  const units = useUnits()
  const unitLabel = (id: string) =>
    (units.data ?? []).find((unit) => unit.id === id)?.name ?? id
  const result = useSuspenseQuery(stockAdjustmentsQuery())
  const rows = result.data
  const booked = rows.filter((row) => row.state === "BOOKED")
  const waiting = rows.filter((row) => row.state !== "BOOKED")
  const bookedValue = sum(booked, (row) => row.value_minor)
  const waitingValue = sum(waiting, (row) => row.value_minor)
  const shown = tab === "waiting" ? waiting : booked
  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Stock Adjustments"
        sub="Stock value that changed for any reason other than buying, moving or selling: counts, losses, write-offs."
      />
      <>
        <PhoneFigures
          items={[
            { label: "Booked", value: bookedValue },
            {
              label: "Waiting to be settled",
              value: waitingValue,
              tone: waitingValue !== 0 ? "warn" : undefined,
            },
          ]}
        />
        <div className="max-md:hidden">
          <CardRow columns={2}>
            <NumberCard label="Booked" value={bookedValue} />
            <NumberCard
              label="Waiting to be settled"
              value={waitingValue}
              tone={waitingValue !== 0 ? "warn" : undefined}
              note="Short at count or missing — not yet found or written off"
            />
          </CardRow>
        </div>
        <div className="mt-5 max-md:mt-0">
          <SubTabs
            className="mb-3.5"
            tabs={[
              { value: "waiting", label: "Waiting" },
              { value: "booked", label: "Booked" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {shown.length === 0 ? (
            <EmptyState>
              {tab === "waiting"
                ? "Nothing waiting — every short or missing piece has been found or written off."
                : "No adjustment has been booked yet."}
            </EmptyState>
          ) : phone ? (
            <PhoneList
              rows={shown.map((row, index) => ({
                key: `${row.reference}-${index}`,
                title: kindText(row.kind),
                code: row.reference,
                line: row.description,
                lead: (
                  <CardFigure
                    value={money(row.value_minor)}
                    tone={row.value_minor < 0 ? "bad" : undefined}
                    caption={
                      row.quantity === null
                        ? undefined
                        : `${count(row.quantity)} pcs`
                    }
                  />
                ),
                foot: `${day(row.on_date)} · ${unitLabel(row.unit_id)}`,
              }))}
            />
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Unit</Th>
                  <Th>Reference</Th>
                  <Th>What</Th>
                  <Th>Description</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={`${row.reference}-${index}`}>
                    <Td>{day(row.on_date)}</Td>
                    <Td>{unitLabel(row.unit_id)}</Td>
                    <Td>
                      <Code>{row.reference}</Code>
                    </Td>
                    <Td>{kindText(row.kind)}</Td>
                    <Td className="text-mute">{row.description}</Td>
                    <Td align="right">
                      {row.quantity === null ? "—" : count(row.quantity)}
                    </Td>
                    <Td
                      align="right"
                      className={
                        row.value_minor < 0 ? "text-bad-fg" : undefined
                      }
                    >
                      {money(row.value_minor)}
                    </Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">
                    {money(sum(shown, (row) => row.value_minor))}
                  </Td>
                </TotalRow>
              </tbody>
            </Grid>
          )}
        </div>
      </>
    </PageContent>
  )
}
