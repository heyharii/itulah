import { useSuspenseQuery } from "@tanstack/react-query"
import { Suspense, useDeferredValue, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { dimensionResultsQuery, dimensionsQuery } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { useSettledWindow } from "@/screens/finance/hooks"
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { Amount, UnitSelect, WindowControl } from "@/screens/finance/parts"
import { FactsSheet } from "@/screens/finance/phone-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { DimensionResult } from "@itulah/contract"

/// The profit and loss cut by one accounting dimension — per division, per
/// cost center, per project — over a window, closing vouchers left out.
///
/// The row with no value is the lines that carry none, so the rows add up to
/// the whole P&L; it is also what a person reads before making the dimension
/// required, because every line in it is a line that would then be refused.
export function DimensionResults() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Reports" title="Dimension Results">
          Reading the dimensions…
        </ScreenPending>
      }
    >
      <DimensionResultsScreen />
    </Suspense>
  )
}

function DimensionResultsScreen() {
  const range = useSettledWindow()
  const dimensions = useSuspenseQuery(dimensionsQuery())
  const [picked, setPicked] = useState("")
  const [unit, setUnit] = useState("")

  const dimension = picked !== "" ? picked : (dimensions.data[0]?.code ?? "")
  const names = new Map(
    dimensions.data
      .find((one) => one.code === dimension)
      ?.values.map((value) => [value.value_code, value.name]) ?? []
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Reports"
        title="Dimension Results"
        sub="The profit and loss cut by one accounting dimension. Lines with no value are one row, so the rows add up to the whole."
      />

      <Toolbar>
        <Select
          value={dimension}
          onChange={setPicked}
          className="h-8 w-48"
          aria-label="Dimension"
        >
          {dimensions.data.map((one) => (
            <option key={one.code} value={one.code}>
              {one.name}
            </option>
          ))}
        </Select>
        <WindowControl range={range} />
        <UnitSelect value={unit} onChange={setUnit} className="h-8 w-48" />
      </Toolbar>

      <Card className="overflow-hidden">
        {dimension === "" ? (
          <EmptyState>No accounting dimension is defined yet.</EmptyState>
        ) : (
          <Suspense
            fallback={<LoadingState>Cutting the profit and loss…</LoadingState>}
          >
            <Cut
              dimension={dimension}
              from={range.from}
              to={range.to}
              unit={unit}
              names={names}
            />
          </Suspense>
        )}
      </Card>
    </PageContent>
  )
}

/// The cut itself. The dimension, the window and the unit answer at once in
/// the bar above; the rows trail them, and the ones in hand stay (dimmed)
/// until the next are read.
function Cut({
  dimension,
  from,
  to,
  unit,
  names,
}: {
  dimension: string
  from: string
  to: string
  unit: string
  names: ReadonlyMap<string, string>
}) {
  const phone = useLayout() === "phone"
  const [shown, setShown] = useState<DimensionRow | "total" | null>(null)
  const results = useSuspenseQuery(
    dimensionResultsQuery(
      useDeferredValue(dimension),
      useDeferredValue(from),
      useDeferredValue(to),
      useDeferredValue(unit) || null
    )
  )

  const total = (
    key:
      | "revenue_minor"
      | "gross_profit_minor"
      | "net_operating_profit_minor"
      | "net_profit_minor"
  ) => results.data.reduce((sum, row) => sum + row[key], 0)

  return queryState(results, {
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>
          Nothing posted to the profit and loss in this window.
        </EmptyState>
      ) : phone ? (
        <>
          <PhoneList>
            {rows.map((row) => (
              <PhoneCard
                key={row.value_code ?? "\u0000none"}
                title={
                  row.value_code === null
                    ? "No value"
                    : (names.get(row.value_code) ?? row.value_code)
                }
                line={row.value_code ?? undefined}
                muted={row.value_code === null}
                lead={money(row.net_profit_minor)}
                caption="net profit"
                tone={row.net_profit_minor < 0 ? "bad" : undefined}
                foot={`Revenue ${money(row.revenue_minor)}`}
                onOpen={() => setShown(row)}
              />
            ))}
            <PhoneCard
              title="Total"
              lead={money(total("net_profit_minor"))}
              caption="net profit"
              tone={total("net_profit_minor") < 0 ? "bad" : undefined}
              foot={`Revenue ${money(total("revenue_minor"))}`}
              onOpen={() => setShown("total")}
            />
          </PhoneList>
          <FactsSheet
            open={shown !== null}
            onClose={() => setShown(null)}
            title={
              shown === null || shown === "total"
                ? "Total"
                : shown.value_code === null
                  ? "No value"
                  : (names.get(shown.value_code) ?? shown.value_code)
            }
            id={
              shown === null || shown === "total"
                ? undefined
                : (shown.value_code ?? undefined)
            }
            facts={factsOf(
              shown === "total"
                ? {
                    revenue_minor: total("revenue_minor"),
                    gross_profit_minor: total("gross_profit_minor"),
                    net_operating_profit_minor: total(
                      "net_operating_profit_minor"
                    ),
                    net_profit_minor: total("net_profit_minor"),
                  }
                : shown
            )}
          />
        </>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Value</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Gross profit</Th>
              <Th align="right">Net operating profit</Th>
              <Th align="right">Net profit</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.value_code ?? "\u0000none"}>
                <Td>
                  {row.value_code === null ? (
                    <span className="text-mute">No value</span>
                  ) : (
                    <>
                      <span className="text-ink">
                        {names.get(row.value_code) ?? row.value_code}
                      </span>{" "}
                      <Code>{row.value_code}</Code>
                    </>
                  )}
                </Td>
                <Td align="right">
                  <Amount minor={row.revenue_minor} muteZero />
                </Td>
                <Td align="right">
                  <Amount
                    minor={row.gross_profit_minor}
                    muteZero
                    warnNegative
                  />
                </Td>
                <Td align="right">
                  <Amount
                    minor={row.net_operating_profit_minor}
                    muteZero
                    warnNegative
                  />
                </Td>
                <Td align="right">
                  <Amount minor={row.net_profit_minor} muteZero warnNegative />
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td align="right">
                <Amount minor={total("revenue_minor")} />
              </Td>
              <Td align="right">
                <Amount minor={total("gross_profit_minor")} warnNegative />
              </Td>
              <Td align="right">
                <Amount
                  minor={total("net_operating_profit_minor")}
                  warnNegative
                />
              </Td>
              <Td align="right">
                <Amount minor={total("net_profit_minor")} warnNegative />
              </Td>
            </TotalRow>
          </tbody>
        </Grid>
      ),
  })
}

type DimensionRow = DimensionResult

/// The four figures of a row, as the sheet a card opens lists them.
function factsOf(
  row: Pick<
    DimensionRow,
    | "revenue_minor"
    | "gross_profit_minor"
    | "net_operating_profit_minor"
    | "net_profit_minor"
  > | null
) {
  if (row === null) return []
  return [
    { label: "Revenue", value: money(row.revenue_minor) },
    { label: "Gross profit", value: money(row.gross_profit_minor) },
    {
      label: "Net operating profit",
      value: money(row.net_operating_profit_minor),
    },
    { label: "Net profit", value: money(row.net_profit_minor) },
  ]
}
