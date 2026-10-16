import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import type { AnnualTaxSlip } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { money } from "@/lib/format"
import { annualTaxSlips, payKeys } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { AnnualTaxSheet } from "@/screens/people/tax-reports"
import { YEAR_COLUMNS, taxMonths } from "@/screens/people/tax-report-columns"

const NO_SLIPS: AnnualTaxSlip[] = []

const columns: ColumnDef<TableSetup, AnnualTaxSlip>[] = [
  {
    id: "who",
    accessorFn: (row) => row.full_name ?? row.employee_code,
    header: "Employee",
    size: 260,
    meta: { card: "hide" },
    cell: ({ row }) => row.original.full_name ?? row.original.employee_code,
  },
  {
    id: "months",
    accessorFn: (row) => row.from_month,
    header: "Months",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => taxMonths(row.original),
  },
  {
    accessorKey: "gross_minor",
    header: "Gross",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => money(row.original.gross_minor),
  },
  {
    accessorKey: "tax_due_minor",
    header: "Tax due",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => money(row.original.tax_due_minor),
  },
  {
    accessorKey: "tax_withheld_minor",
    header: "Withheld",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => money(row.original.tax_withheld_minor),
  },
  {
    accessorKey: "settled",
    header: "State",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <Status tone={row.original.settled ? "ok" : "info"}>
        {row.original.settled ? "Settled" : "Draft"}
      </Status>
    ),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the person
  // over their NPWP and span, the tax due as the figure with what was
  // withheld under it, and where the year stands.
  {
    id: "head",
    accessorFn: (row) => row.full_name ?? row.employee_code,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={row.original.full_name ?? row.original.employee_code}
        line={[
          row.original.npwp ?? "no NPWP",
          `${taxMonths(row.original)} · gross ${money(row.original.gross_minor)}`,
        ]}
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.tax_due_minor,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={money(row.original.tax_due_minor)}
        caption={`withheld ${money(row.original.tax_withheld_minor)}`}
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.settled,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <Status tone={row.original.settled ? "ok" : "info"}>
        {row.original.settled ? "Settled" : "Draft"}
      </Status>
    ),
  },
]

/// Pay › Tax › 1721-A1 — one year, one row per person: the bukti potong
/// 1721-A1 each employee is given. A row opens the form line by line. A year is
/// settled once its last month has been paid; until then the form is a draft.
export function AnnualTaxPage() {
  const phone = useLayout() === "phone"
  const [year, setYear] = useState(() => new Date().getFullYear())
  const open = useSheet("taxSlip")
  const slips = useQuery({
    queryKey: payKeys.annualTax(year),
    queryFn: ({ signal }) => annualTaxSlips(year, signal),
    enabled: year >= 2000 && year <= 2100,
  })
  const rows = slips.data ?? NO_SLIPS
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AnnualTaxSlip) => row.employee_id,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [rows, phone]
    )
  )
  const shown = rows.find((row) => row.employee_id === open.value) ?? null
  const exportCsv = () =>
    downloadCsv(csvName(`1721-A1 ${year}`), toCsv(YEAR_COLUMNS, rows))

  return (
    <PageContent>
      <PageHeader
        title="1721-A1"
        actions={
          !phone && (
            <Button disabled={rows.length === 0} onClick={exportCsv}>
              Export CSV
            </Button>
          )
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

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(slips, {
          loading: "Adding up the year…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing has been worked out for {year}.</EmptyState>
            ) : (
              <DataTable<AnnualTaxSlip>
                refresh={[slips]}
                table={table}
                onRowClick={(row) => open.open(row.employee_id)}
                isSelected={(row) => row.employee_id === open.value}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      <div className="mb-4 md:hidden">
        <Button
          className="w-full"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </div>

      {shown !== null && (
        <AnnualTaxSheet slip={shown} onClose={() => open.close()} />
      )}
    </PageContent>
  )
}
