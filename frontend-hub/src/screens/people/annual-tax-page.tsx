import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { money } from "@/lib/format"
import { annualTaxSlips, payKeys } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { AnnualTaxSheet } from "@/screens/people/tax-reports"
import { YEAR_COLUMNS } from "@/screens/people/tax-report-columns"

/// Tax › Annual tax — one year, one row per person: the bukti potong 1721-A1
/// each employee is given. A row opens the form line by line.
export function AnnualTaxPage() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const open = useSheet("taxSlip")
  const slips = useQuery({
    queryKey: payKeys.annualTax(year),
    queryFn: ({ signal }) => annualTaxSlips(year, signal),
    enabled: year >= 2000 && year <= 2100,
  })
  const rows = slips.data ?? []
  const shown = rows.find((row) => row.employee_id === open.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Annual tax"
        sub="Each person's 1721-A1 for the year. A year is settled once its last month has been paid."
        actions={
          <Button
            variant="primary"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(csvName(`1721-A1 ${year}`), toCsv(YEAR_COLUMNS, rows))
            }
          >
            Export CSV
          </Button>
        }
      />

      <Toolbar>
        <Input
          type="number"
          min={2000}
          max={2100}
          aria-label="Tax year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          className="h-8 w-32"
        />
      </Toolbar>

      <Card className="mb-4 overflow-hidden px-4 py-2">
        {queryState(slips, {
          loading: "Adding up the year…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nobody has a slip with tax worked out in {year}.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Employee",
                  { label: "Months", align: "left" },
                  { label: "Gross", align: "right" },
                  { label: "Tax Due", align: "right" },
                  { label: "Withheld", align: "right" },
                  { label: "State", align: "left" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.employee_id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => open.open(row.employee_id)}
                        className="text-left hover:underline"
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.full_name ?? row.employee_code}
                        </span>
                        <span className="text-[0.875rem] text-mute">
                          {row.npwp ?? "no NPWP"}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      {row.from_month}–{row.to_month}
                    </MiniCell>
                    <MiniCell align="right">{money(row.gross_minor)}</MiniCell>
                    <MiniCell align="right">
                      {money(row.tax_due_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.tax_withheld_minor)}
                    </MiniCell>
                    <MiniCell>
                      <Pill tone={row.settled ? "ok" : "warn"}>
                        {row.settled ? "Settled" : "Draft"}
                      </Pill>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </Card>

      <p className="text-meta text-mute">
        A year is settled once its last month has been paid — December, or the
        month somebody left — because that is the month PPh 21 is worked out on
        the whole year by Pasal 17. Until then the form is a draft of the year
        so far.
      </p>

      {shown !== null && (
        <AnnualTaxSheet slip={shown} onClose={() => open.close()} />
      )}
    </PageContent>
  )
}
