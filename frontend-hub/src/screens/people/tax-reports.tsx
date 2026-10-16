import { Pill } from "@/components/ui/pill"
import { KeyValue, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { money } from "@/lib/format"
import { taxMonths } from "@/screens/people/tax-report-columns"
import type { AnnualTaxSlip } from "@itulah/contract"

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

export function AnnualTaxSheet({
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
        <Fact term="Masa perolehan">{taxMonths(slip)}</Fact>
        <Fact term="NIK">{slip.nik ?? "—"}</Fact>
        <Fact term="NPWP">{slip.npwp ?? "—"}</Fact>
      </Facts>
      <div className="mt-4">
        <AnnualTaxLines slip={slip} />
      </div>
    </Sheet>
  )
}
