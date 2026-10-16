import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { TaxReportRow } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { count, money, monthYear } from "@/lib/format"
import { payKeys, taxReport, useReachableUnits } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { CardFigure, CardName, PhoneCards } from "@/components/ui/phone-cards"
import {
  MONTH_COLUMNS,
  lastMonth,
  taxMethodWord,
} from "@/screens/people/tax-report-columns"

/// Pay › Tax › PPh 21 & BPJS — one month across everybody the caller reaches:
/// the figures behind the monthly SPT Masa and the BPJS invoice.
///
/// Nothing here is worked out in the browser. Every figure is the slip's own,
/// summed by the server from slips built since 0800; a slip from before that
/// carries no tax figures and is not in the report.
export function TaxReportPage() {
  const phone = useLayout() === "phone"
  const [period, setPeriod] = useState(lastMonth)
  const report = useQuery({
    queryKey: payKeys.taxReport(period),
    queryFn: ({ signal }) => taxReport(period, signal),
    enabled: /^\d{4}-\d{2}$/.test(period),
  })
  const rows = report.data ?? []
  const reachable = useReachableUnits()
  /// A unit by its name; the report only carries the id.
  const unitName = (id: string) =>
    reachable.data?.find((one) => one.id === id)?.name ?? id
  /// The tax profile in a few words: PTKP, TER category, and the method when
  /// the company bears or adds the tax.
  const profile = (row: TaxReportRow) =>
    [row.ptkp ?? "—", row.ter_category ?? "—", taxMethodWord(row.tax_method)]
      .filter((one) => one !== null)
      .join(" · ")
  const sum = (pick: (row: TaxReportRow) => number | null) =>
    rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0)

  const exportCsv = () =>
    downloadCsv(csvName(`PPh21 BPJS ${period}`), toCsv(MONTH_COLUMNS, rows))

  return (
    <PageContent>
      <PageHeader
        title="PPh 21 & BPJS"
        actions={
          !phone && (
            <Button
              variant="ghost"
              disabled={rows.length === 0}
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          )
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

      <Card className="overflow-hidden px-4 py-2 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        {queryState(report, {
          loading: "Adding up the month…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing has been worked out for {monthYear(period)}.
              </EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={rows}
                rowId={(row) => `${row.run_id}-${row.employee_id}`}
                spec={{
                  title: (row) => (
                    <CardName
                      name={row.full_name ?? row.employee_code}
                      line={
                        <>
                          <span className="block">
                            {unitName(row.unit_id)} · {row.npwp ?? "no NPWP"}
                          </span>
                          <span className="block">
                            {profile(row)}
                            {row.final_tax_month === true && " · year settled"}
                          </span>
                        </>
                      }
                    />
                  ),
                  lead: (row) =>
                    row.pph21_minor === null ? (
                      <CardFigure
                        value="—"
                        caption="not worked out"
                        tone="quiet"
                      />
                    ) : (
                      <CardFigure
                        value={money(row.pph21_minor)}
                        caption="PPh 21"
                      />
                    ),
                  foot: (row) => (
                    <span className="flex flex-col leading-6">
                      <span>
                        BPJS from pay {money(row.bpjs_employee_minor)}
                      </span>
                      <span>Company {money(row.bpjs_company_minor)}</span>
                    </span>
                  ),
                }}
              />
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "Unit", align: "left" },
                  { label: "NPWP", align: "left" },
                  { label: "PTKP · TER", align: "left" },
                  { label: "Taxable Gross", align: "right" },
                  { label: "PPh 21", align: "right" },
                  { label: "BPJS Employee", align: "right" },
                  { label: "BPJS Company", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.run_id}-${row.employee_id}`}>
                    <MiniCell>
                      <span className="text-ink">
                        {row.full_name ?? row.employee_code}
                      </span>
                    </MiniCell>
                    <MiniCell>{unitName(row.unit_id)}</MiniCell>
                    <MiniCell>{row.npwp ?? "—"}</MiniCell>
                    <MiniCell>{profile(row)}</MiniCell>
                    <MiniCell align="right">
                      {row.taxable_gross_minor === null
                        ? "—"
                        : money(row.taxable_gross_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.pph21_minor === null ? (
                        <Status tone="warn">Not worked out</Status>
                      ) : (
                        <>
                          {row.final_tax_month === true && (
                            <span className="mr-2 text-mute">year settled</span>
                          )}
                          {money(row.pph21_minor)}
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

      {/* On a phone the export is the last thing on the page, not the first. */}
      <div className="mt-4 md:hidden">
        <Button
          className="w-full"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </div>
    </PageContent>
  )
}
