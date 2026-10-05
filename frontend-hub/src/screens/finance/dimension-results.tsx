import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { dimensionResults, financeKeys } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { useWindow } from "@/screens/finance/hooks"
import { useDimensions } from "@/screens/finance/master-data"
import { Amount, UnitSelect, WindowControl } from "@/screens/finance/parts"

/// The profit and loss cut by one accounting dimension — per division, per
/// cost center, per project — over a window, closing vouchers left out.
///
/// The row with no value is the lines that carry none, so the rows add up to
/// the whole P&L; it is also what a person reads before making the dimension
/// required, because every line in it is a line that would then be refused.
export function DimensionResults() {
  const range = useWindow()
  const dimensions = useDimensions()
  const [picked, setPicked] = useState("")
  const [unit, setUnit] = useState("")

  const dimension = picked !== "" ? picked : (dimensions.data?.[0]?.code ?? "")
  const names = new Map(
    (dimensions.data ?? [])
      .find((one) => one.code === dimension)
      ?.values.map((value) => [value.value_code, value.name]) ?? []
  )

  const results = useQuery({
    queryKey: financeKeys.dimensionResults(
      dimension,
      range.from,
      range.to,
      unit || null
    ),
    queryFn: ({ signal }) =>
      dimensionResults(
        { dimension, from: range.from, to: range.to, unit: unit || null },
        signal
      ),
    enabled: dimension !== "",
  })

  const total = (
    key:
      | "revenue_minor"
      | "gross_profit_minor"
      | "net_operating_profit_minor"
      | "net_profit_minor"
  ) => (results.data ?? []).reduce((sum, row) => sum + row[key], 0)

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
          {(dimensions.data ?? []).map((one) => (
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
          <EmptyState>
            {dimensions.isPending
              ? "Reading the dimensions…"
              : "No accounting dimension is defined yet."}
          </EmptyState>
        ) : (
          queryState(results, {
            loading: "Cutting the profit and loss…",
            render: (rows) =>
              rows.length === 0 ? (
                <EmptyState>
                  Nothing posted to the profit and loss in this window.
                </EmptyState>
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
                          <Amount
                            minor={row.net_profit_minor}
                            muteZero
                            warnNegative
                          />
                        </Td>
                      </tr>
                    ))}
                    <TotalRow>
                      <Td>Total</Td>
                      <Td align="right">
                        <Amount minor={total("revenue_minor")} />
                      </Td>
                      <Td align="right">
                        <Amount
                          minor={total("gross_profit_minor")}
                          warnNegative
                        />
                      </Td>
                      <Td align="right">
                        <Amount
                          minor={total("net_operating_profit_minor")}
                          warnNegative
                        />
                      </Td>
                      <Td align="right">
                        <Amount
                          minor={total("net_profit_minor")}
                          warnNegative
                        />
                      </Td>
                    </TotalRow>
                  </tbody>
                </Grid>
              ),
          })
        )}
      </Card>
    </PageContent>
  )
}
