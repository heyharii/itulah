import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { csvName, downloadCsv, toCsv } from "@/lib/csv"
import { count, money } from "@/lib/format"
import {
  annualTaxSlips,
  payKeys,
  taxMethodLabel,
  taxReport,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import type { AnnualTaxSlip, TaxReportRow } from "@itulah/contract"

/// PPh 21 and BPJS, as Talenta's tax reports lay them out: one month across
/// everybody — the figures behind the monthly SPT Masa and the BPJS invoice —
/// and one year per person, the bukti potong 1721-A1.
///
/// Nothing here is worked out in the browser. Every figure is the slip's own,
/// summed by the server from slips built since 0800; a slip from before that
/// carries no tax figures and is not in either report.
export function TaxReports() {
  return (
    <>
      <MonthlyTax />
      <AnnualTax />
    </>
  )
}

function lastMonth(): string {
  const now = new Date()
  now.setDate(1)
  now.setMonth(now.getMonth() - 1)
  return now.toISOString().slice(0, 7)
}

const MONTH_COLUMNS = [
  { label: "Month", value: (row: TaxReportRow) => row.period },
  { label: "Unit", value: (row: TaxReportRow) => row.unit_id },
  { label: "Code", value: (row: TaxReportRow) => row.employee_code },
  { label: "Name", value: (row: TaxReportRow) => row.full_name },
  { label: "NPWP", value: (row: TaxReportRow) => row.npwp },
  { label: "PTKP", value: (row: TaxReportRow) => row.ptkp },
  { label: "TER", value: (row: TaxReportRow) => row.ter_category },
  { label: "Method", value: (row: TaxReportRow) => row.tax_method },
  {
    label: "Taxable gross",
    value: (row: TaxReportRow) => row.taxable_gross_minor,
  },
  { label: "PPh 21", value: (row: TaxReportRow) => row.pph21_minor },
  {
    label: "BPJS employee",
    value: (row: TaxReportRow) => row.bpjs_employee_minor,
  },
  {
    label: "BPJS company",
    value: (row: TaxReportRow) => row.bpjs_company_minor,
  },
] as const

/// One month, everybody the caller reaches.
function MonthlyTax() {
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
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Month">
          <Input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </Field>
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
      </div>

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

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>PPh 21 and BPJS · {period}</CardTitle>
        </CardHeader>
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
                  "PTKP · TER",
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
    </>
  )
}

const YEAR_COLUMNS = [
  { label: "Year", value: (row: AnnualTaxSlip) => row.year },
  { label: "Code", value: (row: AnnualTaxSlip) => row.employee_code },
  { label: "Name", value: (row: AnnualTaxSlip) => row.full_name },
  { label: "NIK", value: (row: AnnualTaxSlip) => row.nik },
  { label: "NPWP", value: (row: AnnualTaxSlip) => row.npwp },
  { label: "PTKP", value: (row: AnnualTaxSlip) => row.ptkp },
  { label: "From month", value: (row: AnnualTaxSlip) => row.from_month },
  { label: "To month", value: (row: AnnualTaxSlip) => row.to_month },
  { label: "1 Gaji", value: (row: AnnualTaxSlip) => row.salary_minor },
  {
    label: "2 Tunjangan PPh",
    value: (row: AnnualTaxSlip) => row.tax_allowance_minor,
  },
  {
    label: "3 Tunjangan lainnya",
    value: (row: AnnualTaxSlip) => row.other_allowances_minor,
  },
  {
    label: "5 Premi asuransi",
    value: (row: AnnualTaxSlip) => row.insurance_minor,
  },
  { label: "7 Bonus/THR", value: (row: AnnualTaxSlip) => row.bonus_thr_minor },
  { label: "8 Bruto", value: (row: AnnualTaxSlip) => row.gross_minor },
  {
    label: "9 Biaya jabatan",
    value: (row: AnnualTaxSlip) => row.biaya_jabatan_minor,
  },
  {
    label: "10 Iuran pensiun",
    value: (row: AnnualTaxSlip) => row.pension_minor,
  },
  { label: "12 Neto", value: (row: AnnualTaxSlip) => row.net_minor },
  { label: "15 PTKP", value: (row: AnnualTaxSlip) => row.ptkp_minor },
  { label: "16 PKP", value: (row: AnnualTaxSlip) => row.taxable_income_minor },
  {
    label: "17 PPh terutang",
    value: (row: AnnualTaxSlip) => row.tax_due_minor,
  },
  {
    label: "20 PPh dipotong",
    value: (row: AnnualTaxSlip) => row.tax_withheld_minor,
  },
  {
    label: "Settled",
    value: (row: AnnualTaxSlip) => (row.settled ? "yes" : "no"),
  },
] as const

/// One year, one row per person: the 1721-A1 each employee is given.
function AnnualTax() {
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
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Tax year">
          <Input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </Field>
        <Button
          variant="ghost"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(csvName(`1721-A1 ${year}`), toCsv(YEAR_COLUMNS, rows))
          }
        >
          Export CSV
        </Button>
      </div>

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Bukti potong 1721-A1 · {year}</CardTitle>
        </CardHeader>
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
                  "Months",
                  { label: "Gross", align: "right" },
                  { label: "Tax due", align: "right" },
                  { label: "Withheld", align: "right" },
                  "",
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
    </>
  )
}

/// The form, line by line, numbered as DJP numbers it.
export function AnnualTaxLines({ slip }: { slip: AnnualTaxSlip }) {
  return (
    <>
      <SubHead>Penghasilan bruto</SubHead>
      <KeyValue term="1. Gaji">{money(slip.salary_minor)}</KeyValue>
      <KeyValue term="2. Tunjangan PPh">
        {money(slip.tax_allowance_minor)}
      </KeyValue>
      <KeyValue term="3. Tunjangan lainnya, lembur">
        {money(slip.other_allowances_minor)}
      </KeyValue>
      <KeyValue term="5. Premi asuransi oleh pemberi kerja">
        {money(slip.insurance_minor)}
      </KeyValue>
      <KeyValue term="7. Bonus, THR">{money(slip.bonus_thr_minor)}</KeyValue>
      <KeyValue term="8. Jumlah bruto">{money(slip.gross_minor)}</KeyValue>
      <SubHead>Pengurangan</SubHead>
      <KeyValue term="9. Biaya jabatan">
        {money(slip.biaya_jabatan_minor)}
      </KeyValue>
      <KeyValue term="10. Iuran pensiun, JHT, JP">
        {money(slip.pension_minor)}
      </KeyValue>
      <SubHead>Penghitungan PPh 21</SubHead>
      <KeyValue term="12. Penghasilan neto">{money(slip.net_minor)}</KeyValue>
      <KeyValue term={`15. PTKP (${slip.ptkp ?? "—"})`}>
        {money(slip.ptkp_minor)}
      </KeyValue>
      <KeyValue term="16. PKP setahun">
        {money(slip.taxable_income_minor)}
      </KeyValue>
      <KeyValue term="17. PPh 21 terutang">
        {money(slip.tax_due_minor)}
      </KeyValue>
      <KeyValue term="20. PPh 21 telah dipotong">
        {money(slip.tax_withheld_minor)}
      </KeyValue>
    </>
  )
}

function AnnualTaxSheet({
  slip,
  onClose,
}: {
  slip: AnnualTaxSlip
  onClose: () => void
}) {
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={slip.employee_id}
      title={`1721-A1 · ${slip.full_name ?? slip.employee_code}`}
    >
      <Pill tone={slip.settled ? "ok" : "warn"}>
        {slip.settled ? "Settled" : "Draft — the year is not over"}
      </Pill>
      <Facts>
        <Fact term="Year">{slip.year}</Fact>
        <Fact term="Masa perolehan">
          {slip.from_month}–{slip.to_month}
        </Fact>
        <Fact term="NIK">{slip.nik ?? "—"}</Fact>
        <Fact term="NPWP">{slip.npwp ?? "—"}</Fact>
      </Facts>
      <div className="mt-4">
        <AnnualTaxLines slip={slip} />
      </div>
    </Sheet>
  )
}
