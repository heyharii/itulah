import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type {
  CompanyBankAccount,
  DescribeBankAccountRequest,
} from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/dialog"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
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
  const [tab, setTab] = useState<"ours" | "suppliers">("ours")
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
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Bank Accounts"
        sub="Every account the books keep money in, and what the bank knows it as."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "ours", label: `Ours · ${ledger.length}` },
              { value: "suppliers", label: "Suppliers" },
            ]}
          />
          <Toolbar.Spacer />
          {tab === "ours" && undescribed > 0 && (
            <span className="text-[0.71875rem] text-warn-fg">
              {undescribed} account(s) nobody has described
            </span>
          )}
        </Toolbar>

        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        {tab === "suppliers" ? (
          <EmptyState>
            A supplier&rsquo;s accounts live on the supplier record, where
            somebody paying a bill is already standing — open{" "}
            <AppLink to="/procurement/suppliers" className="text-accent">
              Procurement · Suppliers
            </AppLink>{" "}
            and read the Bank accounts panel. They are a register of their own
            because a supplier has several, changes banks, and the account we
            paid last March still has to be legible on that payment.
          </EmptyState>
        ) : pending ? (
          <LoadingState>Reading the account map…</LoadingState>
        ) : ledger.length === 0 ? (
          <EmptyState>
            No bank account is mapped yet. Bind a bank meaning to a client
            account on the Account map and it appears here.
          </EmptyState>
        ) : (
          <>
            <Grid>
              <thead>
                <tr>
                  <Th>Bank</Th>
                  <Th width="10rem">Number</Th>
                  <Th width="11rem">Held by</Th>
                  <Th width="6rem">Kind</Th>
                  <Th width="9rem">Location</Th>
                  <Th align="right" width="9.5rem">
                    Per books
                  </Th>
                  <Th width="7rem" />
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
                        </span>
                        <span className="block text-[0.65625rem] text-mute">
                          {row.account_name}
                        </span>
                      </Td>
                      <Td
                        className={
                          known === undefined
                            ? "text-warn-fg"
                            : "font-mono text-[0.6875rem]"
                        }
                      >
                        {known?.account_no ?? "not described yet"}
                      </Td>
                      <Td>
                        {known?.account_holder ?? (
                          <span className="text-mute">—</span>
                        )}
                        {known?.branch != null && (
                          <span className="block text-[0.65625rem] text-mute">
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
                          <span className="block text-[0.65625rem] text-ok-fg">
                            primary here
                          </span>
                        )}
                      </Td>
                      <Td align="right">{money(row.per_books_minor)}</Td>
                      <Td>
                        <Button
                          size="sm"
                          variant={known === undefined ? "primary" : "ghost"}
                          onClick={() =>
                            setEditing({
                              ledger_account_code: row.account_code,
                              site_id: row.site_id,
                              label: `${row.account_name} — ${siteName(row.site_id)}`,
                              existing: known ?? null,
                            })
                          }
                        >
                          {known === undefined ? "Describe" : "Correct"}
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Grid>

            <LabNote>
              The bank column falls back to <code>account_map.qualifier</code> —
              free text, retyped on every mapping row — until somebody describes
              the account. Describing it is what gives the number, the holder,
              the branch and the primary flag a home, and it is the same shape
              0221 gave supplier accounts, on purpose: one bank name normalises
              the same way on both halves.
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
