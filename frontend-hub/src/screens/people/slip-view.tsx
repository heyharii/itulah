import { KeyValue, SubHead, TotalsLadder } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { money } from "@/lib/format"
import { taxMethodLabel } from "@/lib/queries/people"
import { lineBasis } from "@/screens/people/slip-lines"
import type { PayrollSlipRow } from "@itulah/contract"

/// One payslip, laid out the way the Talenta prototype's payslip is: what was
/// earned, what was taken off, what the company paid on top, and the tax
/// behind the PPh 21 line.
///
/// Every line says what it was worked out from (`2 % × Rp10.000.000`), because
/// the one question somebody disputing a payslip asks is *why* a figure is
/// what it is — and the slip row carries every input for exactly that.

function Line({
  label,
  basis,
  amount,
}: {
  label: string
  basis: string | null
  amount: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-0">
      <span className="min-w-0">
        <span className="block text-[0.9375rem] text-ink">{label}</span>
        {basis !== null && (
          <span className="block text-[0.9375rem] text-mute">{basis}</span>
        )}
      </span>
      <span className="shrink-0 text-[0.9375rem] text-ink tabular-nums">
        {money(amount)}
      </span>
    </div>
  )
}

export function SlipBreakdown({ slip }: { slip: PayrollSlipRow }) {
  const prorated =
    slip.days_paid !== null &&
    slip.days_in_month !== null &&
    slip.days_paid < slip.days_in_month
  const deductions = slip.deductions.reduce(
    (sum, line) => sum + line.amount_minor,
    0
  )

  return (
    <div className="flex flex-col gap-4">
      {slip.components_incomplete_because !== null && (
        <Banner tone="warn">{slip.components_incomplete_because}</Banner>
      )}

      <div>
        <SubHead>Earnings</SubHead>
        <Line
          label="Base salary"
          basis={
            prorated
              ? `prorated: ${slip.days_paid} of ${slip.days_in_month} days`
              : null
          }
          amount={slip.base_minor}
        />
        {slip.fixed_allowances.map((allowance) => (
          <Line
            key={allowance.code}
            label={allowance.code}
            basis={prorated ? "fixed allowance, prorated" : "fixed allowance"}
            amount={allowance.minor}
          />
        ))}
        {slip.earnings.map((line) => (
          <Line
            key={line.component_code}
            label={line.label}
            basis={lineBasis(line)}
            amount={line.amount_minor}
          />
        ))}
      </div>

      <div>
        <SubHead>Deductions</SubHead>
        {slip.deductions.length === 0 ? (
          <p className="py-2 text-[0.9375rem] text-mute">Nothing taken off.</p>
        ) : (
          slip.deductions.map((line) => (
            <Line
              key={line.component_code}
              label={line.label}
              basis={lineBasis(line)}
              amount={line.amount_minor}
            />
          ))
        )}
      </div>

      <TotalsLadder
        rows={[
          { label: "Gross", value: money(slip.gross_minor) },
          {
            label: "Deductions",
            value:
              slip.deduction_total_minor === null
                ? "not worked out"
                : money(-slip.deduction_total_minor),
          },
        ]}
        total={{
          label: "Take-home pay",
          value:
            slip.net_minor === null ? "not worked out" : money(slip.net_minor),
        }}
      />
      {slip.deduction_total_minor === null && deductions > 0 && (
        <p className="text-[0.9375rem] text-mute">
          The lines above come to {money(deductions)}, but the total is not
          stated while something on this slip is missing.
        </p>
      )}

      {slip.company_contributions.length > 0 && (
        <div>
          <SubHead aside={money(slip.company_borne_minor ?? 0)}>
            Paid by the company
          </SubHead>
          {slip.company_contributions.map((line) => (
            <Line
              key={line.component_code}
              label={line.label}
              basis={lineBasis(line)}
              amount={line.amount_minor}
            />
          ))}
          <p className="mt-1 text-[0.9375rem] text-mute">
            On top of gross, and not taken from pay.
          </p>
        </div>
      )}

      {slip.absent_days !== null && slip.absent_days > 0 && (
        <div>
          <SubHead>Attendance</SubHead>
          <KeyValue term="Days absent">
            {slip.absent_days} of {slip.rostered_days} rostered
          </KeyValue>
        </div>
      )}

      <div>
        <SubHead>PPh 21</SubHead>
        <KeyValue term="PTKP">
          {slip.ptkp === null
            ? "not recorded"
            : `${slip.ptkp} · TER ${slip.ter_category ?? "—"}`}
        </KeyValue>
        <KeyValue term="Borne">{taxMethodLabel(slip.tax_method)}</KeyValue>
        {slip.taxable_gross_minor !== null && (
          <KeyValue term="Taxable gross">
            {money(slip.taxable_gross_minor)}
          </KeyValue>
        )}
        {slip.pph21_minor !== null && (
          <KeyValue
            term={
              slip.final_tax_month === true
                ? "Settled for the year"
                : "This month"
            }
          >
            {slip.pph21_minor < 0
              ? `${money(-slip.pph21_minor)} returned`
              : money(slip.pph21_minor)}
          </KeyValue>
        )}
        {slip.final_tax_month === true && (
          <p className="mt-1 text-[0.9375rem] text-mute">
            The last month of the tax year: the year's Article 17 tax on its
            actual income, less what the other months withheld (PMK 168/2023).
          </p>
        )}
      </div>
    </div>
  )
}
