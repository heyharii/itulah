import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { money, moment } from "@/lib/format"
import {
  payKeys,
  ratifyStatutoryRate,
  statutoryRates,
  taxTables,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import {
  ComponentsCard,
  PayslipTemplateCard,
  ScheduleCard,
  StructuresCard,
} from "@/screens/people/payroll-setup"
import { AbsenceRuleCard } from "@/screens/people/absence-rule"
import { OvertimeRuleCard } from "@/screens/people/overtime-rule"
import { percent } from "@/screens/people/slip-lines"
import type { BpjsRates, TaxTableRow } from "@itulah/contract"

/// Settings › Payroll: what PPh 21 and BPJS are worked out from.
///
/// # Rates are data, the law is not
///
/// The BPJS rates and wage caps move — the JP cap every March, JKK with the
/// company's risk class — so head office states them from a date, forward
/// only, and a month already paid keeps the rates it was paid at. The TER
/// tables, Pasal 17 and PTKP are regulation: shown here so a payslip can be
/// checked against them, and changed only by a release.

type RateField = keyof BpjsRates

/// The rates, as a payroll officer reads them: who pays, what, on what.
const FIELDS: readonly {
  readonly key: RateField
  readonly label: string
  readonly kind: "bp" | "cap"
}[] = [
  { key: "kesehatan_employee_bp", label: "Kesehatan · employee", kind: "bp" },
  { key: "kesehatan_company_bp", label: "Kesehatan · company", kind: "bp" },
  { key: "kesehatan_cap_minor", label: "Kesehatan · wage cap", kind: "cap" },
  { key: "jht_employee_bp", label: "JHT · employee", kind: "bp" },
  { key: "jht_company_bp", label: "JHT · company", kind: "bp" },
  { key: "jp_employee_bp", label: "JP · employee", kind: "bp" },
  { key: "jp_company_bp", label: "JP · company", kind: "bp" },
  { key: "jp_cap_minor", label: "JP · wage cap", kind: "cap" },
  { key: "jkk_bp", label: "JKK · company", kind: "bp" },
  { key: "jkm_bp", label: "JKM · company", kind: "bp" },
]

function shown(rates: BpjsRates, field: (typeof FIELDS)[number]): string {
  const value = rates[field.key]
  return field.kind === "bp" ? percent(value) : money(value)
}

export function PayrollSettings() {
  return (
    <>
      <ScheduleCard />
      <StructuresCard />
      <ComponentsCard />
      <AbsenceRuleCard />
      <OvertimeRuleCard />
      <PayslipTemplateCard />
      <BpjsRatesCard />
      <TaxTablesCard />
    </>
  )
}

function BpjsRatesCard() {
  const rates = useQuery({
    queryKey: payKeys.statutoryRates(),
    queryFn: ({ signal }) => statutoryRates(signal),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>BPJS rates</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(rates, {
          loading: "Reading the rates…",
          render: (history) => {
            const current = history[0]
            if (current === undefined) {
              return (
                <Banner tone="warn">
                  No BPJS rates are stated, so every slip is worked out on the
                  rates this system was installed with.
                </Banner>
              )
            }
            return (
              <div className="flex flex-col gap-4">
                <div>
                  <SubHead aside={`from ${current.effective_from}`}>
                    In force
                  </SubHead>
                  {FIELDS.map((field) => (
                    <KeyValue key={field.key} term={field.label}>
                      {shown(current.rates, field)}
                    </KeyValue>
                  ))}
                  <p className="mt-2 text-[0.875rem] text-mute">
                    Charged only to people with a BPJS number on their payroll
                    identity: a Kesehatan number enrols Kesehatan, a
                    Ketenagakerjaan number enrols JHT, JP, JKK and JKM. The
                    company's Kesehatan, JKK and JKM count as the employee's
                    income for PPh 21.
                  </p>
                </div>
                <div>
                  <SubHead>History</SubHead>
                  <Timeline
                    events={history.map((row, index) => ({
                      id: row.effective_from,
                      title: `From ${row.effective_from}`,
                      detail: `${row.ratified_by} · ${row.reason}`,
                      at: moment(row.ratified_at),
                      state: index === 0 ? "current" : "done",
                    }))}
                  />
                </div>
                <StateRates from={current.rates} />
              </div>
            )
          },
        })}
      </div>
    </Card>
  )
}

/// A rate typed as a payroll officer writes it — `0,24` or `2` percent — into
/// hundredths of a percent. `null` when it is not a number.
function toBp(raw: string): number | null {
  const value = Number(raw.replace(",", ".").trim())
  if (raw.trim() === "" || !Number.isFinite(value)) return null
  return Math.round(value * 100)
}

function toMinor(raw: string): number | null {
  const digits = raw.replace(/\D/g, "")
  return digits === "" ? null : Number(digits)
}

function StateRates({ from }: { from: BpjsRates }) {
  const client = useQueryClient()
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<RateField, string>>(() => {
    const out = {} as Record<RateField, string>
    for (const field of FIELDS) {
      const value = from[field.key]
      out[field.key] =
        field.kind === "bp"
          ? (value / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })
          : String(value)
    }
    return out
  })

  const parsed: Partial<BpjsRates> = {}
  let whole = true
  for (const field of FIELDS) {
    const value =
      field.kind === "bp" ? toBp(draft[field.key]) : toMinor(draft[field.key])
    if (value === null) whole = false
    else parsed[field.key] = value
  }

  const state = useMutation({
    mutationFn: () =>
      ratifyStatutoryRate({
        effective_from: effectiveFrom,
        rates: parsed as BpjsRates,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("")
      setEffectiveFrom("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.statutoryRates() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready = whole && effectiveFrom !== "" && reason.trim() !== ""

  return (
    <div>
      <SubHead>State new rates</SubHead>
      <p className="mb-3 text-[0.875rem] text-body">
        From a date after the rates in force — the JP cap every March, a new JKK
        class. A month already paid keeps the rates it was paid at.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            aside={field.kind === "bp" ? "percent" : "rupiah"}
            required
          >
            <Input
              inputMode="decimal"
              value={draft[field.key]}
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: event.target.value })
              }
            />
          </Field>
        ))}
        <Field label="From" required>
          <Day value={effectiveFrom} onChange={setEffectiveFrom} />
        </Field>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="batas upah JP Maret 2027"
          />
        </Field>
      </div>
      {failed !== null && (
        <Banner tone="bad" className="mt-3">
          {failed}
        </Banner>
      )}
      <div className="mt-3">
        <Button
          variant="primary"
          pending={state.isPending}
          disabled={!ready}
          onClick={() => state.mutate()}
        >
          State these rates
        </Button>
      </div>
    </div>
  )
}

function bracket(rows: readonly TaxTableRow[], index: number): string {
  const row = rows[index]
  const previous = index === 0 ? null : rows[index - 1]
  if (row.upto_minor === null) {
    return `above ${money(previous?.upto_minor ?? 0)}`
  }
  return previous === null
    ? `up to ${money(row.upto_minor)}`
    : `${money((previous.upto_minor ?? 0) + 1)} – ${money(row.upto_minor)}`
}

function TaxTablesCard() {
  const tables = useQuery({
    queryKey: payKeys.taxTables(),
    queryFn: ({ signal }) => taxTables(signal),
  })
  const [category, setCategory] = useState<"A" | "B" | "C">("A")

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>PPh 21 tables</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(tables, {
          loading: "Reading the tables…",
          render: (law) => {
            const ter = law.ter.find((table) => table.category === category)
            return (
              <div className="flex flex-col gap-4">
                <p className="text-[0.875rem] text-body">
                  Every month but the last: gross × the TER rate of the table
                  the PTKP status selects (PP 58/2023). In December, or the
                  month employment ends: the year's Pasal 17 tax on its actual
                  income, less biaya jabatan ({percent(law.biaya_jabatan_bp)},
                  at most {money(law.biaya_jabatan_month_cap_minor)} a month)
                  and the employee's JHT and JP, less what the other months
                  withheld (PMK 168/2023).
                </p>

                <div>
                  <SubHead>PTKP</SubHead>
                  <MiniTable
                    head={[
                      "Status",
                      { label: "A year", align: "right" },
                      "TER",
                    ]}
                  >
                    {law.ptkp.map((row) => (
                      <MiniRow key={row.status}>
                        <MiniCell>{row.status}</MiniCell>
                        <MiniCell align="right">
                          {money(row.amount_minor)}
                        </MiniCell>
                        <MiniCell align="right">
                          {law.ter.find((table) =>
                            table.ptkp.includes(row.status)
                          )?.category ?? "—"}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>

                <div>
                  <SubHead
                    aside={
                      <Segmented
                        options={[
                          { value: "A", label: "TER A" },
                          { value: "B", label: "TER B" },
                          { value: "C", label: "TER C" },
                        ]}
                        value={category}
                        onChange={setCategory}
                      />
                    }
                  >
                    Monthly TER
                  </SubHead>
                  {ter !== undefined && (
                    <>
                      <p className="mb-2 text-[0.875rem] text-mute">
                        For {ter.ptkp.join(", ")} · {ter.rows.length} rows
                      </p>
                      <MiniTable
                        head={[
                          "Monthly gross",
                          { label: "Rate", align: "right" },
                        ]}
                      >
                        {ter.rows.map((row, index) => (
                          <MiniRow key={index}>
                            <MiniCell>{bracket(ter.rows, index)}</MiniCell>
                            <MiniCell align="right">
                              {percent(row.rate_bp)}
                            </MiniCell>
                          </MiniRow>
                        ))}
                      </MiniTable>
                    </>
                  )}
                </div>

                <div>
                  <SubHead>Pasal 17 · the year</SubHead>
                  <MiniTable
                    head={[
                      "Taxable income a year",
                      { label: "Rate", align: "right" },
                    ]}
                  >
                    {law.pasal_17.map((row, index) => (
                      <MiniRow key={index}>
                        <MiniCell>{bracket(law.pasal_17, index)}</MiniCell>
                        <MiniCell align="right">
                          {percent(row.rate_bp)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>
              </div>
            )
          },
        })}
      </div>
    </Card>
  )
}
