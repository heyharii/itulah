import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { money, moment } from "@/lib/format"
import {
  defineComponent,
  payComponents,
  payKeys,
  payrollSchedules,
  ratifyComponentRate,
  retireComponent,
  retireSalaryStructure,
  salaryStructures,
  saveSalaryStructure,
  statePayrollSchedule,
  payslipTemplate,
  savePayslipTemplate,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { percent } from "@/screens/people/slip-lines"
import type { PayComponentView, PayslipTemplate } from "@itulah/contract"

/// Settings › Payroll, the half that shapes pay rather than taxes it: when the
/// attendance month closes and pay goes out, the salary structures a pay
/// agreement is filled from, and the components a payslip may carry.

const digits = (raw: string): number | null => {
  const only = raw.replace(/\D/g, "")
  return only === "" ? null : Number(only)
}

const bpOf = (raw: string): number | null => {
  const value = Number(raw.replace(",", ".").trim())
  return raw.trim() === "" || !Number.isFinite(value)
    ? null
    : Math.round(value * 100)
}

// ── the schedule ────────────────────────────────────────────────────────────

const PRORATE_LABEL: Record<string, string> = {
  CALENDAR: "calendar days",
  WORKDAYS_6: "working days, Monday to Saturday",
  WORKDAYS_5: "working days, Monday to Friday",
}

const PRORATE_CHOICES = Object.entries(PRORATE_LABEL).map(([value, label]) => ({
  value,
  label,
}))

export function ScheduleCard() {
  const client = useQueryClient()
  const schedules = useQuery({
    queryKey: payKeys.schedules(),
    queryFn: ({ signal }) => payrollSchedules(signal),
  })
  const [from, setFrom] = useState("")
  const [cutoff, setCutoff] = useState("")
  const [payDay, setPayDay] = useState("")
  const [prorate, setProrate] = useState<string | null>("CALENDAR")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      statePayrollSchedule({
        effective_from: from,
        cutoff_day: digits(cutoff),
        pay_day: digits(payDay),
        prorate_basis: prorate ?? "CALENDAR",
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.schedules() })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Payroll schedule</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(schedules, {
          loading: "Reading the schedule…",
          render: (rows) => {
            const current = rows[0]
            return current === undefined ? null : (
              <div>
                <SubHead aside={`from ${current.effective_from}`}>
                  In force
                </SubHead>
                <KeyValue term="Attendance month">
                  {current.cutoff_day === null
                    ? "the calendar month"
                    : `the ${current.cutoff_day + 1}th of last month to the ${current.cutoff_day}th`}
                </KeyValue>
                <KeyValue term="Prorated by">
                  {PRORATE_LABEL[current.prorate_basis] ??
                    current.prorate_basis}
                </KeyValue>
                <KeyValue term="Pay day">
                  {current.pay_day === null
                    ? "the last day of the month"
                    : `the ${current.pay_day}th (a short month pays on its last day)`}
                </KeyValue>
                <p className="mt-2 text-[0.875rem] text-mute">
                  Leave, overtime and rostered days are counted over the
                  attendance month; salary is prorated over the calendar month.
                </p>
              </div>
            )
          },
        })}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="Cut-off day" aside="1–28, empty for the calendar month">
            <Input
              inputMode="numeric"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
            />
          </Field>
          <Field label="Pay day" aside="1–31, empty for the last day">
            <Input
              inputMode="numeric"
              value={payDay}
              onChange={(e) => setPayDay(e.target.value)}
            />
          </Field>
          <Field label="Prorate a part month by">
            <Select value={prorate ?? "CALENDAR"} onChange={setProrate}>
              {PRORATE_CHOICES.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={from === "" || reason.trim() === ""}
            onClick={() => save.mutate()}
          >
            State this schedule
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ── salary structures ───────────────────────────────────────────────────────

interface Line {
  code: string
  amount: string
}

export function StructuresCard() {
  const client = useQueryClient()
  const structures = useQuery({
    queryKey: payKeys.structures(),
    queryFn: ({ signal }) => salaryStructures(signal),
  })
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [base, setBase] = useState("")
  const [lines, setLines] = useState<Line[]>([{ code: "", amount: "" }])
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const done = () => {
    setFailed(null)
    void client.invalidateQueries({ queryKey: payKeys.structures() })
  }
  const save = useMutation({
    mutationFn: () =>
      saveSalaryStructure({
        code: code.trim(),
        name: name.trim(),
        base_minor: digits(base),
        allowances: lines
          .filter((line) => line.code.trim() !== "")
          .map((line) => ({
            code: line.code.trim().toUpperCase(),
            minor: digits(line.amount) ?? 0,
          })),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      done()
      setCode("")
      setName("")
      setBase("")
      setLines([{ code: "", amount: "" }])
      setReason("")
    },
    onError: (error: Error) => setFailed(error.message),
  })
  const retire = useMutation({
    mutationFn: (which: string) =>
      retireSalaryStructure(which, "tidak dipakai lagi"),
    onSuccess: done,
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Salary structures</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-[0.875rem] text-body">
          A named base and set of fixed allowances. Applying one on somebody's
          Pay tab copies it into their dated pay agreement — changing a
          structure later rewrites nobody's pay.
        </p>
        {queryState(structures, {
          loading: "Reading the structures…",
          render: (rows) =>
            rows.length === 0 ? (
              <p className="text-[0.875rem] text-mute">No structure yet.</p>
            ) : (
              <MiniTable
                head={[
                  "Structure",
                  "Allowances",
                  { label: "Base", align: "right" },
                  { label: "Total", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <span className="block text-ink">{row.name}</span>
                      <span className="font-mono text-mute">{row.code}</span>
                    </MiniCell>
                    <MiniCell align="left">
                      {row.allowances.length === 0
                        ? "—"
                        : row.allowances
                            .map((line) => `${line.code} ${money(line.minor)}`)
                            .join(" · ")}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.base_minor === null ? "—" : money(row.base_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.total_minor === null ? "—" : money(row.total_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.retired ? (
                        <Pill tone="neutral">Retired</Pill>
                      ) : (
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => retire.mutate(row.code)}
                        >
                          Retire
                        </Button>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}

        <SubHead>Define or restate</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="KASIR"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kasir toko"
            />
          </Field>
          <Field label="Base" aside="rupiah, optional">
            <Input
              inputMode="numeric"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </Field>
        </div>
        <AllowanceLines lines={lines} onChange={setLines} />
        <Field label="Why" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" || name.trim() === "" || reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save structure
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// Fixed allowance lines, code and amount — shared by a structure and a pay
/// agreement.
export function AllowanceLines({
  lines,
  onChange,
}: {
  lines: readonly Line[]
  onChange: (lines: Line[]) => void
}) {
  const set = (index: number, patch: Partial<Line>) =>
    onChange(
      lines.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.875rem] font-medium text-ink">
        Fixed allowances
      </span>
      {lines.map((line, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={line.code}
            onChange={(e) => set(index, { code: e.target.value })}
            placeholder="MAKAN"
            className="w-40"
          />
          <Input
            inputMode="numeric"
            value={line.amount}
            onChange={(e) => set(index, { amount: e.target.value })}
            placeholder="rupiah a month"
          />
          <Button
            variant="quiet"
            onClick={() => onChange(lines.filter((_, at) => at !== index))}
            aria-label="Remove this allowance"
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...lines, { code: "", amount: "" }])}
        >
          Add an allowance
        </Button>
      </div>
    </div>
  )
}

// ── pay components ──────────────────────────────────────────────────────────

const BASES = [
  { value: "FIXED_AMOUNT", label: "A fixed amount every month" },
  { value: "SHARE_OF_BASE", label: "A percentage of the wage" },
  { value: "RATE_PER_UNIT", label: "An amount per counted unit" },
  {
    value: "FRACTION_OF_BASE_PER_UNIT",
    label: "Hourly wage × multiplier (overtime)",
  },
  { value: "PER_OCCASION", label: "A one-off, filed per person per month" },
] as const

const UNITS = [
  {
    value: "OVERTIME_WORKDAY_FIRST_HOUR",
    label: "Overtime, first hour of a workday",
  },
  {
    value: "OVERTIME_WORKDAY_LATER",
    label: "Overtime, later hours of a workday",
  },
  { value: "OVERTIME_REST_DAY", label: "Overtime on a rest day" },
  { value: "OVERTIME_HOLIDAY", label: "Overtime on a holiday" },
  {
    value: "OVERTIME_REST_DAY_NEXT_HOUR",
    label: "Rest day, the hour after the first tier (extra)",
  },
  {
    value: "OVERTIME_REST_DAY_BEYOND",
    label: "Rest day, hours beyond that (extra)",
  },
  {
    value: "OVERTIME_HOLIDAY_NEXT_HOUR",
    label: "Holiday, the hour after the first tier (extra)",
  },
  {
    value: "OVERTIME_HOLIDAY_BEYOND",
    label: "Holiday, hours beyond that (extra)",
  },
  { value: "ROSTERED_DAY", label: "Rostered day" },
  { value: "LEAVE_DAY_TAKEN", label: "Leave day taken" },
] as const

function rateSummary(component: PayComponentView): string {
  if (component.basis === "STATUTORY")
    return "worked out by law and the BPJS rates"
  if (component.basis === "PER_OCCASION") return "filed per person per month"
  const rate = component.rate
  if (rate === null) return "no rate yet"
  switch (component.basis) {
    case "FIXED_AMOUNT":
      return money(rate.amount_minor ?? 0)
    case "SHARE_OF_BASE":
      return `${percent(rate.rate_bp ?? 0)}${rate.cap_minor !== null ? ` up to ${money(rate.cap_minor)}` : ""}`
    case "RATE_PER_UNIT":
      return `${money(rate.rate_minor ?? 0)} each`
    case "FRACTION_OF_BASE_PER_UNIT":
      return `1/${rate.hours_divisor ?? "—"} × ${percent(rate.multiplier_bp ?? 0)}`
    default:
      return "—"
  }
}

export function ComponentsCard() {
  const client = useQueryClient()
  const components = useQuery({
    queryKey: payKeys.components(),
    queryFn: ({ signal }) => payComponents(signal),
  })
  const [failed, setFailed] = useState<string | null>(null)
  const refresh = () => {
    setFailed(null)
    void client.invalidateQueries({ queryKey: payKeys.components() })
  }

  // Define
  const [code, setCode] = useState("")
  const [label, setLabel] = useState("")
  const [kind, setKind] = useState<"EARNING" | "DEDUCTION">("EARNING")
  const [basis, setBasis] = useState<string>("FIXED_AMOUNT")
  const [baseRef, setBaseRef] = useState("STATUTORY_BASE")
  const [unit, setUnit] = useState<string>("ROSTERED_DAY")
  const [reason, setReason] = useState("")
  const needsBase =
    basis === "SHARE_OF_BASE" || basis === "FRACTION_OF_BASE_PER_UNIT"
  const needsUnit =
    basis === "RATE_PER_UNIT" || basis === "FRACTION_OF_BASE_PER_UNIT"
  const define = useMutation({
    mutationFn: () =>
      defineComponent({
        code: code.trim().toUpperCase(),
        label: label.trim(),
        kind,
        basis,
        base_ref: needsBase ? baseRef : null,
        unit: needsUnit ? unit : null,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      refresh()
      setCode("")
      setLabel("")
      setReason("")
    },
    onError: (error: Error) => setFailed(error.message),
  })

  // Ratify
  const [which, setWhich] = useState("")
  const [from, setFrom] = useState("")
  const [amount, setAmount] = useState("")
  const [rate, setRate] = useState("")
  const [cap, setCap] = useState("")
  const [divisor, setDivisor] = useState("173")
  const [multiplier, setMultiplier] = useState("")
  const [why, setWhy] = useState("")
  const target = (components.data ?? []).find((one) => one.code === which)
  const ratify = useMutation({
    mutationFn: () => {
      const body: Parameters<typeof ratifyComponentRate>[1] = {
        effective_from: from,
        reason: why.trim(),
      }
      switch (target?.basis) {
        case "FIXED_AMOUNT":
          body.amount_minor = digits(amount)
          break
        case "SHARE_OF_BASE":
          body.rate_bp = bpOf(rate)
          body.cap_minor = digits(cap)
          break
        case "RATE_PER_UNIT":
          body.rate_minor = digits(amount)
          break
        case "FRACTION_OF_BASE_PER_UNIT":
          body.hours_divisor = digits(divisor)
          body.multiplier_bp = bpOf(multiplier)
          break
      }
      return ratifyComponentRate(which, body)
    },
    onSuccess: () => {
      refresh()
      setWhy("")
    },
    onError: (error: Error) => setFailed(error.message),
  })
  const retire = useMutation({
    mutationFn: (code: string) => retireComponent(code, "tidak dipakai lagi"),
    onSuccess: refresh,
    onError: (error: Error) => setFailed(error.message),
  })

  const priceable = (components.data ?? []).filter(
    (one) =>
      !one.retired && one.basis !== "STATUTORY" && one.basis !== "PER_OCCASION"
  )

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Pay components</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-[0.875rem] text-body">
          What a payslip may carry beyond base and fixed allowances: an
          allowance per day, overtime, a percentage, a one-off. A component is
          defined once and its figure is ratified from a date. PPh 21, BPJS and
          THR are the system's own.
        </p>
        {queryState(components, {
          loading: "Reading the components…",
          render: (rows) => (
            <MiniTable head={["Component", "Kind", "Figure", ""]}>
              {rows.map((row) => (
                <MiniRow key={row.code}>
                  <MiniCell>
                    <span className="block text-ink">{row.label}</span>
                    <span className="font-mono text-mute">{row.code}</span>
                  </MiniCell>
                  <MiniCell align="left">
                    {row.kind === "EARNING" ? "Earning" : "Deduction"}
                    {row.employer_borne ? " · company" : ""}
                  </MiniCell>
                  <MiniCell align="left">
                    {row.awaiting_rate ? (
                      <Pill tone="warn">No rate yet</Pill>
                    ) : (
                      rateSummary(row)
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {row.basis === "STATUTORY" ? (
                      <Pill tone="neutral">System</Pill>
                    ) : row.retired ? (
                      <Pill tone="neutral">Retired</Pill>
                    ) : (
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => retire.mutate(row.code)}
                      >
                        Retire
                      </Button>
                    )}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
        })}

        {failed !== null && <Banner tone="bad">{failed}</Banner>}

        <SubHead>Define a component</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="UANG_MAKAN"
            />
          </Field>
          <Field label="Label" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Uang makan"
            />
          </Field>
          <Field label="Kind" required>
            <Select
              value={kind}
              onChange={(value) => setKind(value as "EARNING" | "DEDUCTION")}
            >
              <option value="EARNING">Earning</option>
              <option value="DEDUCTION">Deduction</option>
            </Select>
          </Field>
          <Field label="How it is worked out" required>
            <Select value={basis} onChange={setBasis}>
              {BASES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {needsBase && (
            <Field label="Of" required>
              <Select value={baseRef} onChange={setBaseRef}>
                <option value="STATUTORY_BASE">
                  Base plus fixed allowances
                </option>
                <option value="BASE">Base only</option>
              </Select>
            </Field>
          )}
          {needsUnit && (
            <Field label="Counted per" required>
              <Select value={unit} onChange={setUnit}>
                {UNITS.filter(
                  (option) =>
                    basis === "RATE_PER_UNIT" ||
                    option.value.startsWith("OVERTIME")
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button
            variant="primary"
            pending={define.isPending}
            disabled={
              code.trim() === "" || label.trim() === "" || reason.trim() === ""
            }
            onClick={() => define.mutate()}
          >
            Define component
          </Button>
        </div>

        <SubHead>Ratify a figure</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Component" required>
            <Select value={which} onChange={setWhich}>
              <option value="">Choose…</option>
              {priceable.map((one) => (
                <option key={one.code} value={one.code}>
                  {one.label} ({one.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          {(target?.basis === "FIXED_AMOUNT" ||
            target?.basis === "RATE_PER_UNIT") && (
            <Field
              label={
                target.basis === "FIXED_AMOUNT"
                  ? "Amount a month"
                  : "Amount each"
              }
              required
            >
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}
          {target?.basis === "SHARE_OF_BASE" && (
            <>
              <Field label="Percent" required>
                <Input
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </Field>
              <Field label="Wage cap" aside="rupiah, optional">
                <Input
                  inputMode="numeric"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              </Field>
            </>
          )}
          {target?.basis === "FRACTION_OF_BASE_PER_UNIT" && (
            <>
              <Field label="Hours in a month" required>
                <Input
                  inputMode="numeric"
                  value={divisor}
                  onChange={(e) => setDivisor(e.target.value)}
                />
              </Field>
              <Field label="Multiplier" aside="percent, 150 = 1,5×" required>
                <Input
                  inputMode="decimal"
                  value={multiplier}
                  onChange={(e) => setMultiplier(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Why" required>
            <Input value={why} onChange={(e) => setWhy(e.target.value)} />
          </Field>
        </div>
        <div>
          <Button
            variant="primary"
            pending={ratify.isPending}
            disabled={which === "" || from === "" || why.trim() === ""}
            onClick={() => ratify.mutate()}
          >
            Ratify
          </Button>
        </div>
        {target?.rate !== null && target !== undefined && (
          <p className="text-[0.875rem] text-mute">
            In force for {target.label}: {rateSummary(target)}
            {target.rate !== null ? ` since ${target.rate.effective_from}` : ""}
            {target.defined_at !== undefined
              ? ` · defined ${moment(target.defined_at)}`
              : ""}
          </p>
        )}
      </div>
    </Card>
  )
}

/// The payslip template, as Talenta's payslip settings: what the slip says
/// around its figures, whether the employee sees what the company pays on top,
/// and whether opening one's own payslips takes a password of its own.
export function PayslipTemplateCard() {
  const template = useQuery({
    queryKey: payKeys.payslipTemplate(),
    queryFn: ({ signal }) => payslipTemplate(signal),
  })
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Payslip</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(template, {
          loading: "Reading the template…",
          render: (current) => <TemplateForm current={current} />,
        })}
      </div>
    </Card>
  )
}

function TemplateForm({ current }: { current: PayslipTemplate }) {
  const client = useQueryClient()
  const [name, setName] = useState(current.company_name ?? "")
  const [address, setAddress] = useState(current.company_address ?? "")
  const [footer, setFooter] = useState(current.footer ?? "")
  const [contributions, setContributions] = useState(
    current.show_company_contributions
  )
  const [locked, setLocked] = useState(current.password_required)
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const blank = (text: string) => (text.trim() === "" ? null : text.trim())

  const save = useMutation({
    mutationFn: () =>
      savePayslipTemplate({
        company_name: blank(name),
        company_address: blank(address),
        footer: blank(footer),
        show_company_contributions: contributions,
        password_required: locked,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.payslipTemplate() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Company name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
      <Field label="Closing note" aside="printed under the figures">
        <Textarea
          rows={2}
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
        />
      </Field>
      <Checkbox
        label="Show employees what the company pays on top (BPJS share, borne tax)"
        checked={contributions}
        onChange={setContributions}
      />
      <Checkbox
        label="Employees open their payslips with a password of their own"
        hint="Separate from their login. Head office is never asked for it."
        checked={locked}
        onChange={setLocked}
      />
      <Field label="Why" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {failed !== null && <Banner tone="bad">{failed}</Banner>}
      <div>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={reason.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save payslip settings
        </Button>
      </div>
    </div>
  )
}
