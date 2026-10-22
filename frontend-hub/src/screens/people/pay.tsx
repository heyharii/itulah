import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day, money, moment, monthYear } from "@/lib/format"
import {
  agreePay,
  amendPayrollIdentity,
  employeePayslips,
  payKeys,
  readPay,
  readPayrollIdentity,
  resetPayslipPassword,
  salaryStructures,
  taxMethodLabel,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { Quiet } from "@/screens/people/parts"
import { AllowanceLines } from "@/screens/people/payroll-setup"
import { SlipBreakdown } from "@/screens/people/slip-view"

/// What somebody is paid, and who they are to payroll — the Pay tab of the
/// employee's sheet.
///
/// # On the person, not on a screen of its own
///
/// This was the Pay agreements screen: pick somebody from a list, then read
/// and write their pay. The owner asked for a shorter menu on 2026-09-27, and
/// a salary is one person's fact, so it is a tab on that person's sheet in
/// Employees — where the rest of their employment already is — and the
/// screen, its route and the button to it from Payroll are gone. Head office
/// alone is offered the tab (`tabsFor` in `directory.tsx`); the server's own
/// bound on pay is the control.
///
/// # A salary is a history
///
/// There is no "current salary" field to edit, because that is the field a
/// raise overwrites — taking February's payslip with it. Every agreement is
/// dated and every earlier one survives, so what a closed month was paid from
/// stays answerable. Backdating is refused by the server; a genuine backdated
/// raise is paid as a *rapel* in a current period, visibly.
///
/// # The account number is never shown
///
/// Four digits, behind dots. Somebody checking their own account confirms four
/// digits, and a directory that carried whole account numbers is a directory
/// worth stealing. There is no route that serves the number, so there is
/// nothing here to reveal.
export function PayPanel({ employeeId }: { employeeId: string }) {
  const records = useQuery({
    queryKey: payKeys.pay(employeeId),
    queryFn: ({ signal }) => readPay(employeeId, signal),
  })
  const identity = useQuery({
    queryKey: payKeys.identity(employeeId),
    queryFn: ({ signal }) => readPayrollIdentity(employeeId, signal),
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Agreements</SubHead>
        {queryState(records, {
          loading: "Reading the history…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>
                No agreement yet. That is not an agreement worth nothing — it is
                a person nobody has agreed terms with.
              </Quiet>
            ) : (
              <Timeline
                events={rows.map((record, index) => ({
                  id: record.effective_from,
                  title: `${money(record.base_minor)} base · ${money(record.statutory_base_minor)} with allowances`,
                  // What the allowances are, not only their sum.
                  detail: `${day(record.effective_from)} · ${record.agreed_by} · ${record.reason}${
                    record.fixed_allowances.length > 0
                      ? ` · ${record.fixed_allowances
                          .map((line) => `${line.code} ${money(line.minor)}`)
                          .join(", ")}`
                      : ""
                  }`,
                  at: moment(record.agreed_at),
                  // The last is the one in force, unless it is dated ahead —
                  // which the server permits and a reader should be able to
                  // see from the date beside it.
                  state: index === rows.length - 1 ? "current" : "done",
                }))}
              />
            ),
        })}
      </div>

      <div>
        <SubHead>Payroll identity</SubHead>
        {queryState(identity, {
          loading: "Reading the record…",
          render: (record) => (
            <>
              {!record.payable && (
                <Banner tone="bad" className="mb-3">
                  No account on record, so this person cannot be paid — and a
                  payment file that fails at the bank fails for everybody in it.
                </Banner>
              )}
              <KeyValue term="Bank">{record.bank_name ?? "—"}</KeyValue>
              {/* Four digits. There is no route that serves the rest. */}
              <KeyValue term="Account">
                {record.bank_account_masked ?? "—"}
              </KeyValue>
              <KeyValue term="Account holder">
                {record.bank_holder ?? "—"}
              </KeyValue>
              {record.ptkp === null && (
                <Banner tone="warn" className="mb-3">
                  No PTKP status, so PPh 21 cannot be worked out and this
                  person's slips show no take-home pay until one is recorded.
                </Banner>
              )}
              <KeyValue term="NPWP">{record.npwp ?? "—"}</KeyValue>
              <KeyValue term="PTKP">{record.ptkp ?? "—"}</KeyValue>
              <KeyValue term="PPh 21">
                {taxMethodLabel(record.tax_method)}
              </KeyValue>
              <KeyValue term="BPJS Kesehatan">
                {record.bpjs_kesehatan ?? "—"}
              </KeyValue>
              <KeyValue term="BPJS Ketenagakerjaan">
                {record.bpjs_ketenagakerjaan ?? "—"}
              </KeyValue>
            </>
          ),
        })}
      </div>

      <AgreePay employeeId={employeeId} />
      <SetTaxIdentity employeeId={employeeId} />
      <SetAccount employeeId={employeeId} />
      <ResetPayslipPassword employeeId={employeeId} />
      <EmployeePayslips employeeId={employeeId} />
    </div>
  )
}

/// The payslips of approved runs, newest month first. A row opens the slip
/// Payroll › Payslips opens (`SlipBreakdown`).
function EmployeePayslips({ employeeId }: { employeeId: string }) {
  const [openRun, setOpenRun] = useState<string | null>(null)
  const slips = useQuery({
    queryKey: payKeys.employeeSlips(employeeId),
    queryFn: ({ signal }) => employeePayslips(employeeId, signal),
  })
  const shown = slips.data?.find((slip) => slip.run_id === openRun) ?? null

  return (
    <div>
      <SubHead>Payslips</SubHead>
      {queryState(slips, {
        loading: "Reading the payslips…",
        render: (rows) =>
          rows.length === 0 ? (
            <Quiet>No approved payslip yet.</Quiet>
          ) : (
            <MiniTable head={["Month", "Gross", "Deductions", "Take-home"]}>
              {rows.map((slip) => (
                <MiniRow key={slip.run_id}>
                  <MiniCell>
                    <button
                      type="button"
                      onClick={() => setOpenRun(slip.run_id)}
                      className="text-left text-[0.9375rem] text-ink hover:underline"
                    >
                      {monthYear(slip.period)}
                    </button>
                  </MiniCell>
                  <MiniCell align="right">{money(slip.gross_minor)}</MiniCell>
                  <MiniCell align="right">
                    {money(slip.deduction_total_minor)}
                  </MiniCell>
                  <MiniCell align="right">{money(slip.net_minor)}</MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}

      {shown !== null && (
        <Sheet
          open
          onOpenChange={(next) => {
            if (!next) setOpenRun(null)
          }}
          id={`Payslip · ${monthYear(shown.period)}`}
          title={shown.full_name ?? shown.employee_code}
          footer={
            <SheetFooter
              cancelLabel="Close"
              onCancel={() => setOpenRun(null)}
            />
          }
        >
          {shown.withheld && (
            <Banner tone="warn" className="mb-4">
              Pay is held on this run.
            </Banner>
          )}
          <SlipBreakdown slip={shown} />
        </Sheet>
      )}
    </div>
  )
}

/// A forgotten payslip password: forget it, and the employee chooses a new
/// one the next time they open their payslips. HR never learns it.
function ResetPayslipPassword({ employeeId }: { employeeId: string }) {
  const reset = useMutation({
    mutationFn: () => resetPayslipPassword(employeeId),
  })
  return (
    <div>
      <SubHead>Payslip password</SubHead>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          pending={reset.isPending}
          onClick={() => reset.mutate()}
        >
          Reset payslip password
        </Button>
        {reset.data !== undefined && (
          <span className="text-[0.9375rem] text-mute">
            {reset.data.reset
              ? "Reset. They choose a new one when they next open their payslips."
              : "None was set."}
          </span>
        )}
      </div>
      {reset.error !== null && (
        <Banner tone="bad" className="mt-2">
          {reset.error.message}
        </Banner>
      )}
    </div>
  )
}

function AgreePay({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [base, setBase] = useState("")
  const [lines, setLines] = useState<{ code: string; amount: string }[]>([])
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const structures = useQuery({
    queryKey: payKeys.structures(),
    queryFn: ({ signal }) => salaryStructures(signal),
  })

  /// A structure is copied, not linked: its base and allowances land in the
  /// form, and what is agreed is what the form says when it is sent.
  const apply = (code: string) => {
    const structure = (structures.data ?? []).find((one) => one.code === code)
    if (structure === undefined) return
    if (structure.base_minor !== null) setBase(String(structure.base_minor))
    setLines(
      structure.allowances.map((line) => ({
        code: line.code,
        amount: String(line.minor),
      }))
    )
  }

  const allowances = lines
    .filter((line) => line.code.trim() !== "")
    .map((line) => ({
      code: line.code.trim().toUpperCase(),
      minor: Number(line.amount.replace(/\D/g, "")) || 0,
    }))

  const agree = useMutation({
    mutationFn: () =>
      agreePay(employeeId, {
        effectiveFrom,
        baseMinor: Number(base) || 0,
        allowances,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.pay(employeeId) })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const live = (structures.data ?? []).filter((one) => !one.retired)

  return (
    <div className="flex flex-col gap-3">
      <SubHead>Agree new pay</SubHead>
      {failed !== null && <Banner tone="bad">{failed}</Banner>}
      <Banner tone="info">
        A new agreement supersedes the one before it from its own date. It
        cannot be filed behind the latest — a backdated raise is paid as back
        pay, not by rewriting a month already settled.
      </Banner>
      {live.length > 0 && (
        <Field label="Start from a salary structure">
          <Select value="" onChange={apply}>
            <option value="">Choose a structure…</option>
            {live.map((structure) => (
              <option key={structure.code} value={structure.code}>
                {structure.name}
                {structure.total_minor !== null
                  ? ` · ${money(structure.total_minor)}`
                  : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Effective from" required>
        <Day value={effectiveFrom} onChange={setEffectiveFrom} />
      </Field>
      <Field label="Base" hint="Whole rupiah." required>
        <Input
          type="number"
          min={1}
          value={base}
          onChange={(event) => setBase(event.target.value)}
        />
      </Field>
      <AllowanceLines lines={lines} onChange={setLines} />
      <Field
        label="Why"
        hint="Recorded against the agreement, and required."
        required
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div>
        <Button
          variant="primary"
          pending={agree.isPending}
          disabled={
            effectiveFrom === "" ||
            Number(base) <= 0 ||
            reason.trim() === "" ||
            allowances.some((line) => line.minor <= 0)
          }
          onClick={() => agree.mutate()}
        >
          Agree it
        </Button>
      </div>
    </div>
  )
}

function SetAccount({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const [bank, setBank] = useState("")
  const [number, setNumber] = useState("")
  const [holder, setHolder] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      amendPayrollIdentity(employeeId, {
        field: "bank_account",
        bankName: bank.trim(),
        bankAccount: number.trim(),
        bankHolder: holder.trim(),
        effectiveFrom: new Date().toISOString().slice(0, 10),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setNumber("")
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.identity(employeeId) })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <div className="flex flex-col gap-3">
      <SubHead>Where the money goes</SubHead>
      {failed !== null && <Banner tone="bad">{failed}</Banner>}
      <Banner tone="info">
        The holder's name matters as much as the number: an Indonesian transfer
        is rejected on a name mismatch, and one rejection fails the whole
        payroll file.
      </Banner>
      <Field label="Bank" required>
        <Input value={bank} onChange={(event) => setBank(event.target.value)} />
      </Field>
      <Field
        label="Account number"
        hint="Digits only. Shown back as four."
        required
      >
        <Input
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
      </Field>
      <Field label="Account holder" required>
        <Input
          value={holder}
          onChange={(event) => setHolder(event.target.value)}
        />
      </Field>
      <Field
        label="Why"
        hint="Recorded against the amendment, and required."
        required
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={
            bank.trim() === "" ||
            number.trim() === "" ||
            holder.trim() === "" ||
            reason.trim() === ""
          }
          onClick={() => save.mutate()}
        >
          Record it
        </Button>
      </div>
    </div>
  )
}

const PTKP_STATUSES = [
  "TK/0",
  "TK/1",
  "TK/2",
  "TK/3",
  "K/0",
  "K/1",
  "K/2",
  "K/3",
] as const

const TAX_FIELDS = [
  { value: "ptkp", label: "PTKP status" },
  { value: "tax_method", label: "Who bears PPh 21" },
  { value: "npwp", label: "NPWP" },
  { value: "bpjs_kesehatan", label: "BPJS Kesehatan number" },
  { value: "bpjs_ketenagakerjaan", label: "BPJS Ketenagakerjaan number" },
] as const

/// What PPh 21 and BPJS are worked out from, one fact at a time — each change
/// dated and signed, as the account is. A BPJS number is what enrols somebody
/// in that programme: nobody is charged for BPJS without one.
function SetTaxIdentity({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const [field, setField] = useState<string>("ptkp")
  const [value, setValue] = useState<string>("TK/0")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      amendPayrollIdentity(employeeId, {
        field,
        value: value.trim(),
        effectiveFrom: new Date().toISOString().slice(0, 10),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: payKeys.identity(employeeId) })
      void client.invalidateQueries({ queryKey: payKeys.runs() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const choose = (next: string) => {
    setField(next)
    setValue(next === "ptkp" ? "TK/0" : next === "tax_method" ? "GROSS" : "")
  }

  return (
    <div className="flex flex-col gap-3">
      <SubHead>Tax and BPJS</SubHead>
      <Field label="What" required>
        <Select value={field} onChange={choose}>
          {TAX_FIELDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Value" required>
        {field === "ptkp" ? (
          <Select value={value} onChange={setValue}>
            {PTKP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        ) : field === "tax_method" ? (
          <Select value={value} onChange={setValue}>
            {["GROSS", "GROSS_UP", "NETTO"].map((method) => (
              <option key={method} value={method}>
                {taxMethodLabel(method)}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={value}
            inputMode="numeric"
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>
      <Field label="Why" required>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {failed !== null && <Banner tone="bad">{failed}</Banner>}
      <div>
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={value.trim() === "" || reason.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
