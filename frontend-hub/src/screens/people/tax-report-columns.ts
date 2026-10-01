import type { AnnualTaxSlip, TaxReportRow } from "@itulah/contract"

/// The columns of the two tax exports, kept out of the page files: a `.tsx`
/// screen may export only components.

export const MONTH_COLUMNS = [
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

export const YEAR_COLUMNS = [
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

/// The month before this one, `YYYY-MM` — the month whose payroll has
/// usually been worked out by the time somebody asks for its tax.
export function lastMonth(): string {
  const now = new Date()
  now.setDate(1)
  now.setMonth(now.getMonth() - 1)
  return now.toISOString().slice(0, 7)
}
