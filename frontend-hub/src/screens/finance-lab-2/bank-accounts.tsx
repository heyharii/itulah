import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type {
  CompanyBankAccount,
  DescribeBankAccountRequest,
} from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/dialog"
import { Pill } from "@/components/ui/pill"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  describeBankAccount,
  financeKeys,
  listAllBills,
  listCompanyBankAccounts,
  listGiros,
} from "@/lib/queries/finance"
import { CardRow, NumberCard } from "@/screens/finance-final/parts"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"
import {
  BANK_POTS,
  useMoney,
  useMoneyRows,
} from "@/screens/finance-lab-2/hooks"
import { Grid, Td, Th } from "@/screens/finance-lab-2/parts"

/// The company's bank accounts — what they are, not where they post.
///
/// Two lists in one, joined on the ledger binding: every account the chart
/// keeps money in, and what we have said about the one at that place. An
/// account nobody has described is shown as exactly that, because the gap is
/// the point: a giro cannot be written from an account whose number nobody
/// recorded, and a statement cannot be filed against a bank nobody named.
///
/// Supplier accounts are NOT here. They are a register of their own
/// (`supplier_bank_account`, 0221) and they live on the supplier record, where
/// somebody paying a bill is already standing.
export function BankAccounts() {
  const { rows: ledger, pending } = useMoneyRows(BANK_POTS)
  const unitName = useUnitName()
  const described = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
  })
  const [editing, setEditing] = useState<{
    ledger_account_code: string
    unit_id: string
    label: string
    existing: CompanyBankAccount | null
  } | null>(null)

  const byBinding = useMemo(() => {
    const table = new Map<string, CompanyBankAccount>()
    for (const account of described.data ?? []) {
      if (account.retired_at !== null) continue
      table.set(`${account.ledger_account_code}@${account.unit_id}`, account)
    }
    return table
  }, [described.data])

  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (request: DescribeBankAccountRequest) =>
      describeBankAccount(request),
    onSuccess: () => {
      setEditing(null)
      void client.invalidateQueries({ queryKey: ["finance", "bank-accounts"] })
    },
  })

  const [needle, setNeedle] = useState("")
  const [unit, setUnit] = useState("")

  // Every account the chart keeps money in, used or not (owner, 2026-10-01).
  // About two hundred of them, so the list can be narrowed by what somebody
  // remembers: the bank, the number, the name or the code, and by the unit.
  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return ledger.filter((row) => {
      if (unit !== "" && row.unit_id !== unit) return false
      if (text === "") return true
      const known = byBinding.get(`${row.account_code}@${row.unit_id}`)
      return [
        known?.bank_name ?? row.qualifier,
        known?.account_no,
        row.account_name,
        row.account_code,
      ].some((field) => (field ?? "").toLowerCase().includes(text))
    })
  }, [ledger, byBinding, needle, unit])

  return (
    <PageContent>
      <PageHeader crumb="Finance · Banking" title="Bank Account" />

      <div className="flex flex-col gap-4">
        <Summary />

        {/* No Suppliers tab.
            
            It held one sentence pointing at the supplier record, which is a
            signpost, not a view — and the signpost argued against the tab it
            was standing in. A supplier's account is a PAYMENT DESTINATION on
            the party we pay; this screen is the accounts we own and control.
            Two different objects, and a tab made them look like two halves of
            one. */}
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        {pending ? (
          <LoadingState>Reading the account map…</LoadingState>
        ) : ledger.length === 0 ? (
          <EmptyState>
            No bank account is mapped yet. Bind a bank meaning to a client
            account on the Account map and it appears here.
          </EmptyState>
        ) : (
          <>
            <Toolbar>
              <Input
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                aria-label="Search"
                className="h-control w-64"
              />
              <UnitSelect
                value={unit}
                onChange={setUnit}
                className="h-control w-44"
                aria-label="Unit"
              />
              <Toolbar.Spacer />
              <span className="text-[0.875rem] text-mute">
                {count(shown.length)}{" "}
                {shown.length === 1 ? "account" : "accounts"}
              </span>
            </Toolbar>
            {shown.length === 0 ? (
              <EmptyState>
                {needle.trim() !== ""
                  ? `No bank account matches “${needle.trim()}”.`
                  : "No bank account in this unit."}
              </EmptyState>
            ) : (
              <Card className="overflow-hidden">
                <Grid>
                  <thead>
                    <tr>
                      {/* The bank and the number are one column, because they
                      are one answer: "BCA 2233445566" is how somebody says
                      which account, and splitting it made the eye travel to
                      finish a phrase. */}
                      <Th>Account</Th>
                      <Th width="9rem">Unit</Th>
                      <Th align="right" width="10rem">
                        Balance
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const known = byBinding.get(
                        `${row.account_code}@${row.unit_id}`
                      )
                      return (
                        <tr key={`${row.account_code}-${row.unit_id}`}>
                          <Td>
                            <span className="font-medium text-ink">
                              {known?.bank_name ?? (row.qualifier || "—")}
                              {known !== undefined && (
                                <span className="ml-2 font-mono text-[0.875rem] font-normal text-text">
                                  {known.account_no}
                                </span>
                              )}
                              {known?.kind === "GIRO" && (
                                <Pill
                                  tone="neutral"
                                  className="ml-2 align-middle"
                                >
                                  Giro
                                </Pill>
                              )}
                            </span>
                            {/* Most accounts are not described yet, so the gap
                              is said once in the toolbar and quietly here. */}
                            <span className="block text-[0.875rem] text-mute">
                              {row.account_name}
                              {known === undefined && (
                                <span className="text-faint">
                                  {" "}
                                  · not described
                                </span>
                              )}
                            </span>
                          </Td>
                          {/* The unit's name alone: its code ("HO") is ours, not
                            what anyone calls it. */}
                          <Td>
                            {unitName(row.unit_id).replace(/^[^·]*· /, "")}
                          </Td>
                          <Td align="right">{money(row.per_books_minor)}</Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Grid>
              </Card>
            )}
          </>
        )}
      </div>

      <Panel
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        title={
          editing?.existing === null
            ? "Describe the account"
            : "Correct the account"
        }
        sub={editing?.label}
      >
        {editing !== null && (
          <DescribeForm
            key={`${editing.ledger_account_code}@${editing.unit_id}`}
            existing={editing.existing}
            busy={save.isPending}
            onSave={(form) =>
              save.mutate({
                ledger_account_code: editing.ledger_account_code,
                unit_id: editing.unit_id,
                ...form,
              })
            }
          />
        )}
      </Panel>
    </PageContent>
  )
}

/// The three figures above the list: what is held, what is about to leave, and
/// what has left on paper but not yet through the bank.
///
/// # Three figures, not four
///
/// "Coming in" was asked for and is not here, on purpose. Nothing in the
/// backend dates an expected receipt: this client is a cash-and-card retailer,
/// so there is no customer invoice to fall due, a card settlement carries no
/// due date, and the only dated money owed TO us is the odd giro received —
/// which, shown alone, would read as "all we expect" and be wrong. The day
/// the books know when a receivable lands, it is one more card in this row.
///
/// Going out is read exactly as Payment Projection reads its payable rows —
/// posted bills still outstanding, and giros we issued that have not cleared —
/// through the same two queries, so the figure here and the page it came from
/// cannot differ. Only what is payable counts: drafts, recurring templates and
/// open orders are estimates, and are left on that page.
function Summary() {
  const overview = useMoney()
  const bills = useQuery({
    queryKey: [...financeKeys.bills("POSTED", null), "projection"],
    queryFn: ({ signal }) => listAllBills("POSTED", undefined, signal),
    staleTime: 30_000,
  })
  const giros = useQuery({
    queryKey: ["finance", "giros", "projection", "OUT"] as const,
    queryFn: ({ signal }) =>
      listGiros({ direction: "OUT", limit: 1000 }, signal),
    staleTime: 30_000,
  })

  // Held, in every pot the money is physically or contractually ours in.
  // Card receivables are owed by a scheme and not held, so they are not here.
  // A giro we have written and the bank has not paid is a negative row in
  // the bank pot (`giro_outstanding`), and it is counted: it is already
  // promised, which is what makes this the figure that is actually free.
  const held = useMemo(() => {
    if (overview.data === undefined) return null
    return overview.data.rows
      .filter((row) => row.pot !== "CARD_RECEIVABLE")
      .reduce((sum, row) => sum + row.per_books_minor, 0)
  }, [overview.data])

  const out = useMemo(() => {
    if (bills.data === undefined || giros.data === undefined) return null
    const today = todayIso()
    const horizon = new Date()
    horizon.setDate(horizon.getDate() + 30)
    const until = isoDay(horizon)
    let ahead = 0
    let overdue = 0
    const add = (due: string, amount: number) => {
      if (due < today) overdue += amount
      else if (due <= until) ahead += amount
    }
    for (const bill of bills.data) {
      if (bill.outstanding_minor <= 0 || bill.due_date === null) continue
      add(bill.due_date, bill.outstanding_minor)
    }
    for (const giro of giros.data) {
      if (!NOT_CLEARED.has(giro.status)) continue
      add(giro.due_date, giro.amount_minor)
    }
    return { ahead, overdue }
  }, [bills.data, giros.data])

  const waiting = useMemo(() => {
    if (giros.data === undefined) return null
    const open = giros.data.filter((giro) => NOT_CLEARED.has(giro.status))
    return {
      count: open.length,
      amount: open.reduce((sum, giro) => sum + giro.amount_minor, 0),
      late: open.filter((giro) => giro.days_overdue > 0).length,
    }
  }, [giros.data])

  return (
    <CardRow>
      <NumberCard label="Cash & bank balance" value={held} />
      <NumberCard
        label="Going out · next 30 days"
        value={out === null ? null : out.ahead}
        note={
          out !== null && out.overdue > 0
            ? `+ ${money(out.overdue)} overdue`
            : "Bills and giros that fall due"
        }
        tone={out !== null && out.overdue > 0 ? "warn" : undefined}
      />
      <NumberCard
        label="Giros not cleared"
        value={waiting === null ? null : waiting.amount}
        note={
          waiting === null
            ? undefined
            : waiting.count === 0
              ? "Every giro we issued has cleared"
              : `${count(waiting.count)} issued${
                  waiting.late > 0 ? ` · ${count(waiting.late)} past due` : ""
                }`
        }
        tone={waiting !== null && waiting.late > 0 ? "warn" : undefined}
      />
    </CardRow>
  )
}

/// Issued, delivered or due — written on paper and not yet through the bank.
/// `CLEARED` is done, `REJECTED` bounced, `VOIDED` was cancelled before it
/// could clear; none of them is money still to leave.
const NOT_CLEARED: ReadonlySet<string> = new Set(["ISSUED", "DELIVERED", "DUE"])

function DescribeForm({
  existing,
  busy,
  onSave,
}: {
  existing: CompanyBankAccount | null
  busy: boolean
  onSave: (form: {
    bank_name: string
    account_no: string
    account_holder: string
    branch: string | null
    kind: string
    is_primary: boolean
    note: string | null
  }) => void
}) {
  const [bank, setBank] = useState(existing?.bank_name ?? "")
  const [number, setNumber] = useState(existing?.account_no ?? "")
  const [holder, setHolder] = useState(existing?.account_holder ?? "")
  const [branch, setBranch] = useState(existing?.branch ?? "")
  const [kind, setKind] = useState(existing?.kind ?? "GIRO")
  const [primary, setPrimary] = useState(existing?.is_primary ?? false)
  const [note, setNote] = useState(existing?.note ?? "")

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Bank"
          required
          hint="As it will be printed: BCA, Bank Mandiri, BRI."
        >
          <Input
            value={bank}
            onChange={(event) => setBank(event.target.value)}
          />
        </Field>
        <Field
          label="Account number"
          required
          hint="Typed the way the passbook groups it."
        >
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field
          label="Held by"
          required
          hint="The name the account is registered under, not the trading name."
        >
          <Input
            value={holder}
            onChange={(event) => setHolder(event.target.value)}
          />
        </Field>
        <Field label="Branch">
          <Input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={setKind} aria-label="Kind">
            <option value="GIRO">Giro — current account</option>
            <option value="SAVINGS">Tabungan — savings</option>
          </Select>
        </Field>
        <Field
          label="Primary here"
          hint="The one this place pays out of unless somebody says otherwise."
        >
          <Select
            value={primary ? "yes" : "no"}
            onChange={(next) => setPrimary(next === "yes")}
            aria-label="Primary here"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
        </Field>
      </div>

      <Field label="Note">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </Field>

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={
            busy ||
            bank.trim() === "" ||
            number.trim() === "" ||
            holder.trim() === ""
          }
          onClick={() =>
            onSave({
              bank_name: bank.trim(),
              account_no: number.trim(),
              account_holder: holder.trim(),
              branch: branch.trim() === "" ? null : branch.trim(),
              kind,
              is_primary: primary,
              note: note.trim() === "" ? null : note.trim(),
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
