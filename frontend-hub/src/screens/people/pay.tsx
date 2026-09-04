import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { KeyValue } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day, money, moment } from "@/lib/format"
import {
  agreePay,
  amendPayrollIdentity,
  listEmployees,
  payKeys,
  peopleKeys,
  readPay,
  readPayrollIdentity,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// What somebody is paid, and who they are to payroll.
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

export function Pay() {
  const [employeeId, setEmployeeId] = useState("")

  const team = useQuery({
    queryKey: peopleKeys.employees({ limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ limit: 1000 }, signal),
  })
  const records = useQuery({
    queryKey: payKeys.pay(employeeId),
    queryFn: ({ signal }) => readPay(employeeId, signal),
    enabled: employeeId !== "",
  })
  const identity = useQuery({
    queryKey: payKeys.identity(employeeId),
    queryFn: ({ signal }) => readPayrollIdentity(employeeId, signal),
    enabled: employeeId !== "",
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People · Pay"
        title="Pay agreements"
        sub="What somebody is on, from when, and who agreed it."
        actions={
          <Select
            value={employeeId}
            onChange={setEmployeeId}
            aria-label="Employee"
          >
            <option value="">Choose somebody…</option>
            {(team.data ?? []).map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        }
      />

      {employeeId === "" ? (
        <Card className="overflow-hidden">
          <EmptyState>
            Choose somebody to see what they are paid. Pay is head office's to
            read as well as to write — a shop manager who could read the team's
            salaries would know what everybody earns, and that is not a rota
            question.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4 overflow-hidden">
            <CardHeader>
              <CardTitle>Agreements</CardTitle>
            </CardHeader>
            {queryState(records, {
              loading: "Reading the history…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>
                    No agreement yet. That is not an agreement worth nothing —
                    it is a person nobody has agreed terms with.
                  </EmptyState>
                ) : (
                  <div className="px-4 pb-4">
                    <Timeline
                      events={rows.map((record, index) => ({
                        id: record.effective_from,
                        title: `${money(record.base_minor)} base · ${money(record.statutory_base_minor)} with allowances`,
                        detail: `${day(record.effective_from)} · ${record.agreed_by} · ${record.reason}`,
                        at: moment(record.agreed_at),
                        // The last is the one in force, unless it is dated
                        // ahead — which the server permits and a reader should
                        // be able to see from the date beside it.
                        state: index === rows.length - 1 ? "current" : "done",
                      }))}
                    />
                  </div>
                ),
            })}
          </Card>

          <Card className="mb-4 overflow-hidden">
            <CardHeader>
              <CardTitle>Payroll identity</CardTitle>
            </CardHeader>
            {queryState(identity, {
              loading: "Reading the record…",
              render: (record) => (
                <div className="px-4 pb-4">
                  {!record.payable && (
                    <Banner tone="bad" className="mb-3">
                      No account on record, so this person cannot be paid — and
                      a payment file that fails at the bank fails for everybody
                      in it.
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
                  <KeyValue term="NPWP">{record.npwp ?? "—"}</KeyValue>
                  <KeyValue term="PTKP">{record.ptkp ?? "—"}</KeyValue>
                  <KeyValue term="BPJS Kesehatan">
                    {record.bpjs_kesehatan ?? "—"}
                  </KeyValue>
                  <KeyValue term="BPJS Ketenagakerjaan">
                    {record.bpjs_ketenagakerjaan ?? "—"}
                  </KeyValue>
                </div>
              ),
            })}
          </Card>

          <AgreePay employeeId={employeeId} />
          <SetAccount employeeId={employeeId} />
        </>
      )}
    </PageContent>
  )
}

function AgreePay({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [base, setBase] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const agree = useMutation({
    mutationFn: () =>
      agreePay(employeeId, {
        effectiveFrom,
        baseMinor: Number(base) || 0,
        allowances: [],
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: payKeys.pay(employeeId) })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Agree new pay</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Banner tone="info">
          A new agreement supersedes the one before it from its own date. It
          cannot be filed behind the latest — a backdated raise is paid as a
          rapel, not by rewriting a month already settled.
        </Banner>
        <Field label="Effective from">
          <Day value={effectiveFrom} onChange={setEffectiveFrom} />
        </Field>
        <Field label="Base" hint="Whole rupiah.">
          <Input
            type="number"
            min={1}
            value={base}
            onChange={(event) => setBase(event.target.value)}
          />
        </Field>
        <Field label="Why" hint="Recorded against the agreement, and required.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="kenaikan tahunan"
          />
        </Field>
        <div>
          <Button
            variant="dark"
            disabled={
              effectiveFrom === "" ||
              Number(base) <= 0 ||
              reason.trim() === "" ||
              agree.isPending
            }
            onClick={() => agree.mutate()}
          >
            Agree it
          </Button>
        </div>
      </div>
    </Card>
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
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Where the money goes</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Banner tone="info">
          The holder's name matters as much as the number: an Indonesian
          transfer is rejected on a name mismatch, and one rejection fails the
          whole payroll file.
        </Banner>
        <Field label="Bank">
          <Input
            value={bank}
            onChange={(event) => setBank(event.target.value)}
            placeholder="BCA"
          />
        </Field>
        <Field label="Account number" hint="Digits only. Shown back as four.">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </Field>
        <Field label="Account holder">
          <Input
            value={holder}
            onChange={(event) => setHolder(event.target.value)}
          />
        </Field>
        <Field label="Why" hint="Recorded against the amendment, and required.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="rekening gaji"
          />
        </Field>
        <div>
          <Button
            variant="dark"
            disabled={
              bank.trim() === "" ||
              number.trim() === "" ||
              holder.trim() === "" ||
              reason.trim() === "" ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            Record it
          </Button>
        </div>
      </div>
    </Card>
  )
}
