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
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  describeBankAccount,
  financeKeys,
  listCompanyBankAccounts,
} from "@/lib/queries/finance"
import { useSiteName } from "@/screens/finance/hooks"
import { BANK_POTS, useMoneyRows } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"

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
  const siteName = useSiteName()
  const described = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
  })
  const [editing, setEditing] = useState<{
    ledger_account_code: string
    site_id: string
    label: string
    existing: CompanyBankAccount | null
  } | null>(null)

  const byBinding = useMemo(() => {
    const table = new Map<string, CompanyBankAccount>()
    for (const account of described.data ?? []) {
      if (account.retired_at !== null) continue
      table.set(`${account.ledger_account_code}@${account.site_id}`, account)
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

  const undescribed = ledger.filter(
    (row) => !byBinding.has(`${row.account_code}@${row.site_id}`)
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Cash &amp; Bank"
        title="Bank Accounts"
        sub="Every account the books keep money in, and what the bank knows it as."
      />

      <div className="flex flex-col gap-4">
        {/* No Suppliers tab.
            
            It held one sentence pointing at the supplier record, which is a
            signpost, not a view — and the signpost argued against the tab it
            was standing in. A supplier's account is a PAYMENT DESTINATION on
            the party we pay; this screen is the accounts we own and control.
            Two different objects, and a tab made them look like two halves of
            one. */}
        <Toolbar>
          <Toolbar.Spacer />
          {undescribed > 0 && (
            <span className="text-[0.875rem] text-warn-fg">
              {undescribed} account(s) nobody has described
            </span>
          )}
        </Toolbar>

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
            <Card className="overflow-hidden">
              <Grid>
                <thead>
                  <tr>
                    {/* The bank and the number are one column, because they
                      are one answer: "BCA 2233445566" is how somebody says
                      which account, and splitting it made the eye travel to
                      finish a phrase. */}
                    <Th>Account</Th>
                    <Th width="11rem">Held by</Th>
                    <Th width="6rem">Type</Th>
                    <Th width="9rem">Unit</Th>
                    {/* The balance keeps its figures and loses its heading.
                      "Per books" is bookkeeping's word for "what we think we
                      have", and the column of money under it needs no label
                      to be read as money. */}
                    <Th align="right" width="9.5rem" />
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => {
                    const known = byBinding.get(
                      `${row.account_code}@${row.site_id}`
                    )
                    return (
                      <tr key={`${row.account_code}-${row.site_id}`}>
                        <Td>
                          <span className="font-medium text-ink">
                            {known?.bank_name ?? (row.qualifier || "—")}
                            {known !== undefined && (
                              <span className="ml-2 font-mono text-[0.875rem] font-normal text-text">
                                {known.account_no}
                              </span>
                            )}
                          </span>
                          {known === undefined ? (
                            <span className="block text-[0.875rem] text-warn-fg">
                              not described yet
                            </span>
                          ) : (
                            <span className="block text-[0.875rem] text-mute">
                              {row.account_name}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {known?.account_holder ?? (
                            <span className="text-mute">—</span>
                          )}
                          {known?.branch != null && (
                            <span className="block text-[0.875rem] text-mute">
                              {known.branch}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {known === undefined ? (
                            <span className="text-mute">—</span>
                          ) : (
                            <Pill>
                              {known.kind === "GIRO" ? "Giro" : "Tabungan"}
                            </Pill>
                          )}
                        </Td>
                        <Td>
                          {siteName(row.site_id)}
                          {known?.is_primary && (
                            <span className="block text-[0.875rem] text-ok-fg">
                              primary here
                            </span>
                          )}
                        </Td>
                        <Td align="right">{money(row.per_books_minor)}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Grid>
            </Card>

            <LabNote>
              The bank column falls back to <code>account_link.source_id</code>{" "}
              — free text, typed on the link — until somebody describes the
              account. Describing it is what gives the number, the holder, the
              branch and the primary flag a home, and it is the same shape 0221
              gave supplier accounts, on purpose: one bank name normalises the
              same way on both halves.
            </LabNote>
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
            key={`${editing.ledger_account_code}@${editing.site_id}`}
            existing={editing.existing}
            busy={save.isPending}
            onSave={(form) =>
              save.mutate({
                ledger_account_code: editing.ledger_account_code,
                site_id: editing.site_id,
                ...form,
              })
            }
          />
        )}
      </Panel>
    </PageContent>
  )
}

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
          hint="As it will be printed: BCA, Bank Mandiri, BRI."
        >
          <Input
            value={bank}
            onChange={(event) => setBank(event.target.value)}
          />
        </Field>
        <Field
          label="Account number"
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
          hint="The name the account is registered under, not the trading name."
        >
          <Input
            value={holder}
            onChange={(event) => setHolder(event.target.value)}
          />
        </Field>
        <Field label="Branch" hint="Optional.">
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

      <Field label="Note" hint="Optional.">
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
