import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { money, moment } from "@/lib/format"
import {
  defineComponent,
  payKeys,
  ratifyComponentRate,
  retireComponent,
  retireSalaryStructure,
  saveSalaryStructure,
  salaryStructuresQuery,
  payComponentsQuery,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import { AllowanceLines } from "@/screens/people/payroll-setup"
import {
  CardFoot,
  ListCard,
  RowOpen,
  SheetFooter,
} from "@/screens/people/settings-kit"
import { bpOf, digits, useOpener } from "@/screens/people/settings-lib"
import { percent } from "@/screens/people/slip-lines"
import type { PayComponentView, SalaryStructureView } from "@itulah/contract"
import { awaiting } from "@/screens/people/awaiting"

/// Settings › Salary structures & components — what a payslip is made of.
///
/// A salary structure is a named base and set of fixed allowances; applying one
/// on somebody's Pay tab copies it into their dated pay agreement, so changing
/// a structure later rewrites nobody's pay. A pay component is what a payslip
/// may carry beyond that — an allowance per day, overtime, a percentage, a
/// one-off — defined once, with its figure ratified from a date. PPh 21, BPJS
/// and THR are the system's own.
export function PayComponentSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"

  const structure = useOpener<SalaryStructureView>()
  const component = useOpener<PayComponentView>()

  return (
    <PageContent>
      {canWrite && (
        <Fab label="New structure" onClick={() => structure.show()} />
      )}
      <PageHeader
        crumb="People"
        title="Salary Structures & Components"
        sub="The named pay packages an agreement is filled from, and the components a payslip may carry."
        actions={
          !phone &&
          canWrite && (
            <>
              <Button onClick={() => component.show()}>New component</Button>
              <Button variant="primary" onClick={() => structure.show()}>
                New structure
              </Button>
            </>
          )
        }
      />

      <ListCard title="Salary structures">
        {awaiting(salaryStructuresQuery(), {
          loading: "Reading the structures…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No structure yet. New structure names a base and the fixed
                allowances that go with it.
              </EmptyState>
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
                      <RowOpen onClick={() => structure.show(row)}>
                        {row.name}
                      </RowOpen>
                      <span className="ml-2 font-mono text-id text-mute">
                        {row.code}
                      </span>
                    </MiniCell>
                    <MiniCell>
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
                      {row.retired && <Pill tone="neutral">Retired</Pill>}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <ListCard
        title="Pay components"
        foot={
          canWrite ? (
            <CardFoot label="New component" onClick={() => component.show()} />
          ) : undefined
        }
      >
        {awaiting(payComponentsQuery(), {
          loading: "Reading the components…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No component yet. New component defines one, and its figure is
                ratified from a date.
              </EmptyState>
            ) : (
              <MiniTable head={["Component", "Kind", "Figure", ""]}>
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <RowOpen onClick={() => component.show(row)}>
                        {row.label}
                      </RowOpen>
                      <span className="ml-2 font-mono text-id text-mute">
                        {row.code}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      {row.kind === "EARNING" ? "Earning" : "Deduction"}
                      {row.employer_borne ? " · company" : ""}
                    </MiniCell>
                    <MiniCell>
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
                      ) : null}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </ListCard>

      <StructureSheet
        key={`s-${structure.n}`}
        open={structure.isOpen}
        onClose={structure.hide}
        row={structure.item}
        canWrite={canWrite}
      />
      <NewComponentSheet
        key={`nc-${component.n}-${component.item === null ? "new" : "old"}`}
        open={component.isOpen && component.item === null}
        onClose={component.hide}
      />
      <ComponentSheet
        key={`c-${component.n}`}
        open={component.isOpen && component.item !== null}
        onClose={component.hide}
        row={component.item}
        canWrite={canWrite}
      />
    </PageContent>
  )
}

// ── salary structures ───────────────────────────────────────────────────────

interface Line {
  code: string
  amount: string
}

/// A structure: new from the header, or restated from a row. Saving under an
/// existing code restates it; Retire takes it out of the choices.
function StructureSheet({
  open,
  onClose,
  row,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  row: SalaryStructureView | null
  canWrite: boolean
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [base, setBase] = useState(
    row?.base_minor == null ? "" : String(row.base_minor)
  )
  const [lines, setLines] = useState<Line[]>(
    row && row.allowances.length > 0
      ? row.allowances.map((one) => ({
          code: one.code,
          amount: String(one.minor),
        }))
      : [{ code: "", amount: "" }]
  )
  const [reason, setReason] = useState("")

  const done = () => {
    void client.invalidateQueries({ queryKey: payKeys.structures() })
    onClose()
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
    onSuccess: done,
  })
  const retire = useMutation({
    mutationFn: () => retireSalaryStructure(row?.code ?? "", "no longer used"),
    onSuccess: done,
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={row?.code}
      title={row ? row.name : "New structure"}
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={canWrite ? () => save.mutate() : undefined}
          saveLabel={row ? "Restate" : "Submit"}
          pending={save.isPending}
          disabled={
            code.trim() === "" || name.trim() === "" || reason.trim() === ""
          }
          danger={
            canWrite &&
            row &&
            !row.retired && (
              <Button
                variant="danger"
                pending={retire.isPending}
                onClick={() => retire.mutate()}
              >
                Retire
              </Button>
            )
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={save.error ?? retire.error} />
        <p className="text-[0.9375rem] text-body">
          Applying a structure on somebody&rsquo;s Pay tab copies it into their
          dated pay agreement — changing it later rewrites nobody&rsquo;s pay.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required>
            <Input
              value={code}
              disabled={row !== null}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Base" aside="rupiah, optional">
          <Input
            inputMode="numeric"
            value={base}
            onChange={(event) => setBase(event.target.value)}
          />
        </Field>
        <AllowanceLines lines={lines} onChange={setLines} />
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
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

function basisLabel(basis: string): string {
  if (basis === "STATUTORY") return "Worked out by the system"
  return BASES.find((one) => one.value === basis)?.label ?? basis
}

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

function NewComponentSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
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
      void client.invalidateQueries({ queryKey: payKeys.components() })
      onClose()
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New component"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => define.mutate()}
          saveLabel="Define component"
          pendingLabel="Defining…"
          pending={define.isPending}
          disabled={
            code.trim() === "" || label.trim() === "" || reason.trim() === ""
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={define.error} />
        <p className="text-[0.9375rem] text-body">
          Defined once; its figure is ratified from a date afterwards, from the
          component&rsquo;s own row.
        </p>
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Label" required>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
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
              <option value="STATUTORY_BASE">Base plus fixed allowances</option>
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
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// A component: what it is, the figure in force, and — for one that can be
/// priced — the form that ratifies a new figure from a date. Retire is the
/// one destructive act.
function ComponentSheet({
  open,
  onClose,
  row,
  canWrite,
}: {
  open: boolean
  onClose: () => void
  row: PayComponentView | null
  canWrite: boolean
}) {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [amount, setAmount] = useState("")
  const [rate, setRate] = useState("")
  const [cap, setCap] = useState("")
  const [divisor, setDivisor] = useState("173")
  const [multiplier, setMultiplier] = useState("")
  const [why, setWhy] = useState("")

  const priceable =
    row !== null &&
    !row.retired &&
    row.basis !== "STATUTORY" &&
    row.basis !== "PER_OCCASION"

  const done = () => {
    void client.invalidateQueries({ queryKey: payKeys.components() })
    onClose()
  }
  const ratify = useMutation({
    mutationFn: () => {
      const body: Parameters<typeof ratifyComponentRate>[1] = {
        effective_from: from,
        reason: why.trim(),
      }
      switch (row?.basis) {
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
      return ratifyComponentRate(row?.code ?? "", body)
    },
    onSuccess: done,
  })
  const retire = useMutation({
    mutationFn: () => retireComponent(row?.code ?? "", "no longer used"),
    onSuccess: done,
  })

  const canRetire =
    canWrite && row !== null && !row.retired && row.basis !== "STATUTORY"

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={row?.code}
      title={row?.label ?? "Component"}
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={canWrite && priceable ? () => ratify.mutate() : undefined}
          saveLabel="Ratify"
          pendingLabel="Ratifying…"
          pending={ratify.isPending}
          disabled={from === "" || why.trim() === ""}
          danger={
            canRetire && (
              <Button
                variant="danger"
                pending={retire.isPending}
                onClick={() => retire.mutate()}
              >
                Retire
              </Button>
            )
          }
        />
      }
    >
      {row && (
        <div className="flex flex-col gap-4">
          <Facts>
            <Fact term="Kind">
              {row.kind === "EARNING" ? "Earning" : "Deduction"}
              {row.employer_borne ? " · company" : ""}
            </Fact>
            <Fact term="Worked out">{basisLabel(row.basis)}</Fact>
            <Fact term="In force">
              {row.awaiting_rate ? "No rate yet" : rateSummary(row)}
            </Fact>
            <Fact term="Defined">{moment(row.defined_at)}</Fact>
          </Facts>
          {row.retired && (
            <p className="text-[0.9375rem] text-mute">
              Retired{row.retired_by ? ` by ${row.retired_by}` : ""}
              {row.retired_reason ? ` — ${row.retired_reason}` : ""}.
            </p>
          )}
          <Problem error={ratify.error ?? retire.error} />

          {canWrite && priceable && (
            <div>
              <SubHead>Ratify a figure</SubHead>
              <div className="flex flex-col gap-3.5">
                <Field label="From" required>
                  <Day value={from} onChange={setFrom} />
                </Field>
                {(row.basis === "FIXED_AMOUNT" ||
                  row.basis === "RATE_PER_UNIT") && (
                  <Field
                    label={
                      row.basis === "FIXED_AMOUNT"
                        ? "Amount a month"
                        : "Amount each"
                    }
                    required
                  >
                    <Input
                      inputMode="numeric"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </Field>
                )}
                {row.basis === "SHARE_OF_BASE" && (
                  <>
                    <Field label="Percent" required>
                      <Input
                        inputMode="decimal"
                        value={rate}
                        onChange={(event) => setRate(event.target.value)}
                      />
                    </Field>
                    <Field label="Wage cap" aside="rupiah, optional">
                      <Input
                        inputMode="numeric"
                        value={cap}
                        onChange={(event) => setCap(event.target.value)}
                      />
                    </Field>
                  </>
                )}
                {row.basis === "FRACTION_OF_BASE_PER_UNIT" && (
                  <>
                    <Field label="Hours in a month" required>
                      <Input
                        inputMode="numeric"
                        value={divisor}
                        onChange={(event) => setDivisor(event.target.value)}
                      />
                    </Field>
                    <Field
                      label="Multiplier"
                      aside="percent, 150 = 1,5×"
                      required
                    >
                      <Input
                        inputMode="decimal"
                        value={multiplier}
                        onChange={(event) => setMultiplier(event.target.value)}
                      />
                    </Field>
                  </>
                )}
                <Field label="Why" required>
                  <Input
                    value={why}
                    onChange={(event) => setWhy(event.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
