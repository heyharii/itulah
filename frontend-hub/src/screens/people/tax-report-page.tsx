import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { TaxReportRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { count, money } from "@/lib/format"
import { payKeys, taxMethodLabel, taxReport } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { MONTH_COLUMNS, lastMonth } from "@/screens/people/tax-report-columns"

/// Tax › PPh 21 & BPJS — one month across everybody the caller reaches: the
/// figures behind the monthly SPT Masa and the BPJS invoice.
///
/// Nothing here is worked out in the browser. Every figure is the slip's own,
/// summed by the server from slips built since 0800; a slip from before that
/// carries no tax figures and is not in the report.
export function TaxReportPage() {
  const [period, setPeriod] = useState(lastMonth)
  const report = useQuery({
    queryKey: payKeys.taxReport(period),
    queryFn: ({ signal }) => taxReport(period, signal),
    enabled: /^\d{4}-\d{2}$/.test(period),
  })
  const rows = report.data ?? []
  const sum = (pick: (row: TaxReportRow) => number | null) =>
    rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0)

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="PPh 21 & BPJS"
        sub="One month across everybody: the figures behind the monthly tax return and the BPJS invoice."
        actions={
          <Button
            variant="ghost"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                csvName(`PPh21 BPJS ${period}`),
                toCsv(MONTH_COLUMNS, rows)
              )
            }
          >
            Export CSV
          </Button>
        }
      />

      <Toolbar>
        <Input
          type="month"
          aria-label="Month"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className="h-8 w-44"
        />
      </Toolbar>

      <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="People paid" value={count(rows.length)} />
        <Kpi
          label="PPh 21"
          value={rows.length === 0 ? "—" : money(sum((row) => row.pph21_minor))}
        />
        <Kpi
          label="BPJS from pay"
          value={
            rows.length === 0
              ? "—"
              : money(sum((row) => row.bpjs_employee_minor))
          }
        />
        <Kpi
          label="BPJS the company pays"
          value={
            rows.length === 0
              ? "—"
              : money(sum((row) => row.bpjs_company_minor))
          }
        />
      </KpiStrip>

      <Card className="overflow-hidden px-4 py-2">
        {queryState(report, {
          loading: "Adding up the month…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No payroll for {period} has been worked out with tax yet. A run
                built for the month shows here as soon as it exists, draft or
                not.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "PTKP · TER", align: "left" },
                  { label: "Taxable gross", align: "right" },
                  { label: "PPh 21", align: "right" },
                  { label: "BPJS employee", align: "right" },
                  { label: "BPJS company", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.run_id}-${row.employee_id}`}>
                    <MiniCell>
                      <span className="block text-[0.875rem] text-ink">
                        {row.full_name ?? row.employee_code}
                      </span>
                      <span className="text-[0.875rem] text-mute">
                        {row.unit_id} · {row.npwp ?? "no NPWP"}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      {row.ptkp ?? "—"} · {row.ter_category ?? "—"}
                      {row.tax_method !== null &&
                        row.tax_method !== "GROSS" && (
                          <>
                            {" "}
                            <Pill tone="info">
                              {taxMethodLabel(row.tax_method)}
                            </Pill>
                          </>
                        )}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.taxable_gross_minor === null
                        ? "—"
                        : money(row.taxable_gross_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.pph21_minor === null ? (
                        <Pill tone="warn">Not worked out</Pill>
                      ) : (
                        <>
                          {money(row.pph21_minor)}
                          {row.final_tax_month === true && (
                            <span className="block text-[0.875rem] text-mute">
                              year settled
                            </span>
                          )}
                        </>
                      )}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.bpjs_employee_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.bpjs_company_minor)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>
    </PageContent>
  )
}
