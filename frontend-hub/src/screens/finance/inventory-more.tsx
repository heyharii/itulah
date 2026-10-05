import { useQuery } from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, dateText, day, money } from "@/lib/format"
import {
  cogsByMonth,
  financeKeys,
  goodsInTransit,
  stockAdjustments,
  type CogsMonthRow,
  type GoodsInTransitRow,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import {
  CardRow,
  Code,
  Grid,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { UnitRail } from "@/screens/finance/inventory"

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

// ---------------------------------------------------------------------------
// Goods in transit
// ---------------------------------------------------------------------------

export function GoodsInTransitScreen() {
  const [tab, setTab] = useState("road")
  const [needle, setNeedle] = useState("")
  const result = useQuery({
    queryKey: financeKeys.goodsInTransit(),
    queryFn: ({ signal }) => goodsInTransit(signal),
  })
  const rows = useMemo(() => result.data ?? [], [result.data])
  const road = rows.filter((row) => row.status === "ON_THE_ROAD")
  const short = rows.filter((row) => row.status === "SHORT")
  const roadValue = sum(road, (row) => row.value_minor)
  const shortValue = sum(short, (row) => row.value_minor)

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
        crumb="Finance · Inventory"
        title="Goods in Transit"
        sub="BDP (1031): goods head office has sent and the shop has not counted in yet."
      />
      {result.isPending ? (
        <LoadingState>Reading the goods on the road…</LoadingState>
      ) : result.isError ? (
        <ErrorState
          error={result.error}
          onRetry={() => void result.refetch()}
        />
      ) : (
        <>
          <CardRow>
            <NumberCard
              label="On the road"
              value={roadValue}
              note={`${count(sum(road, (row) => row.quantity))} pieces`}
            />
            <NumberCard
              label="Short at count"
              value={shortValue}
              tone={shortValue > 0 ? "warn" : undefined}
              note="Not in the box when the shop counted — settle as found or lost"
            />
            <NumberCard label="Total on 1031" value={roadValue + shortValue} />
          </CardRow>
          <div className="mt-5">
            <SubTabs
              tabs={[
                { value: "road", label: "On the road" },
                { value: "short", label: "Short at count" },
                { value: "all", label: "All" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <Toolbar>
              <Input
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                aria-label="Search goods in transit"
                className="h-control w-72"
              />
            </Toolbar>
            {groups.length === 0 ? (
              <EmptyState>
                {needle.trim() !== ""
                  ? "Nothing matches."
                  : tab === "short"
                    ? "Nothing is short at count."
                    : "Nothing is on the road."}
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Surat jalan</Th>
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
                                  <span className="text-[0.875rem] text-mute">
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
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Cost of goods sold
// ---------------------------------------------------------------------------

function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`
}

export function CogsScreen() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [unit, setUnit] = useState<string | null>(null)
  const result = useQuery({
    queryKey: financeKeys.cogs(year),
    queryFn: ({ signal }) => cogsByMonth(year, signal),
  })

  const months = useMemo(() => {
    const map = new Map<number, CogsMonthRow>()
    for (const row of result.data ?? []) {
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

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Inventory"
        title="Cost of Goods Sold"
        sub="What the stock that was sold cost, against what it sold for — per month and per unit."
      />
      <div className="flex items-start gap-6">
        <UnitRail value={unit} onChange={setUnit} />
        <div className="min-w-0 flex-1">
          <SubTabs
            tabs={[
              { value: String(thisYear), label: String(thisYear) },
              { value: String(thisYear - 1), label: String(thisYear - 1) },
            ]}
            value={String(year)}
            onChange={(value) => setYear(Number(value))}
          />
          {result.isPending ? (
            <LoadingState>Reading sales and cost…</LoadingState>
          ) : result.isError ? (
            <ErrorState
              error={result.error}
              onRetry={() => void result.refetch()}
            />
          ) : (
            <>
              <div className="mt-4">
                <CardRow>
                  <NumberCard label="Net sales" value={revenue} />
                  <NumberCard label="Cost of goods sold" value={cogs} />
                  <NumberCard
                    label="Gross margin"
                    value={margin}
                    note={`${percent(margin, revenue)} margin`}
                  />
                </CardRow>
              </div>
              <div className="mt-5">
                {months.length === 0 ? (
                  <EmptyState>No sales booked in {year}.</EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Month</Th>
                        <Th align="right">Net sales</Th>
                        <Th align="right">COGS</Th>
                        <Th align="right">Gross margin</Th>
                        <Th align="right">Margin %</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((row) => (
                        <tr key={row.month}>
                          <Td>
                            {dateText(new Date(year, row.month - 1, 1), {
                              month: "long",
                            })}
                          </Td>
                          <Td align="right">{money(row.revenue_minor)}</Td>
                          <Td align="right">{money(row.cogs_minor)}</Td>
                          <Td align="right">{money(row.gross_margin_minor)}</Td>
                          <Td align="right">
                            {percent(row.gross_margin_minor, row.revenue_minor)}
                          </Td>
                        </tr>
                      ))}
                      <TotalRow>
                        <Td>Total</Td>
                        <Td align="right">{money(revenue)}</Td>
                        <Td align="right">{money(cogs)}</Td>
                        <Td align="right">{money(margin)}</Td>
                        <Td align="right">{percent(margin, revenue)}</Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                )}
              </div>
            </>
          )}
        </div>
      </div>
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
  const [tab, setTab] = useState("waiting")
  // The unit's name alone, as every Finance screen shows it (no code prefix).
  const units = useUnits()
  const unitLabel = (id: string) =>
    (units.data ?? []).find((unit) => unit.id === id)?.name ?? id
  const result = useQuery({
    queryKey: financeKeys.stockAdjustments(),
    queryFn: ({ signal }) => stockAdjustments(signal),
  })
  const rows = useMemo(() => result.data ?? [], [result.data])
  const booked = rows.filter((row) => row.state === "BOOKED")
  const waiting = rows.filter((row) => row.state !== "BOOKED")
  const bookedValue = sum(booked, (row) => row.value_minor)
  const waitingValue = sum(waiting, (row) => row.value_minor)
  const shown = tab === "waiting" ? waiting : booked

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Inventory"
        title="Stock Adjustments"
        sub="Stock value that changed for any reason other than buying, moving or selling: counts, losses, write-offs."
      />
      {result.isPending ? (
        <LoadingState>Reading the adjustments…</LoadingState>
      ) : result.isError ? (
        <ErrorState
          error={result.error}
          onRetry={() => void result.refetch()}
        />
      ) : (
        <>
          <CardRow columns={2}>
            <NumberCard label="Booked" value={bookedValue} />
            <NumberCard
              label="Waiting to be settled"
              value={waitingValue}
              tone={waitingValue !== 0 ? "warn" : undefined}
              note="Short at count or missing — not yet found or written off"
            />
          </CardRow>
          <div className="mt-5">
            <SubTabs
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
      )}
    </PageContent>
  )
}
