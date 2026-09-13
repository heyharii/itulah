import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money, moment } from "@/lib/format"
import { useStatementLines, useStatements } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"
import { useSiteName } from "@/screens/finance/hooks"

type Tab = "transactions" | "imports"

/// Every line the bank has reported, and the files they arrived in.
///
/// In ERPNext a Bank Transaction is an ordinary document with an ordinary list
/// view — which is also where its multi-select and bulk actions live, and the
/// reason they are not on the reconciliation screen. The same split holds here:
/// this is the list, the reconciliation tool is one decision at a time.
///
/// The second tab has no counterpart in ERPNext at all. They have no statement
/// document — the file is a one-off import job, and the closing balance is
/// typed into a filter. Ours is a record with a period and the bank's own
/// opening and closing balances, which is what makes the difference on the
/// reconciliation screen auditable a month later.
export function BankTransactions() {
  const statements = useStatements()
  const siteName = useSiteName()
  const [tab, setTab] = useState<Tab>("transactions")
  const [chosen, setChosen] = useState<string | null>(null)

  // Its own memo so the identity is stable: a fresh [] every render would
  // re-run every memo downstream of it.
  const rows = useMemo(() => statements.data?.rows ?? [], [statements.data])
  const statement = useMemo(
    () => rows.find((row) => row.statement_id === chosen) ?? rows[0],
    [rows, chosen]
  )
  const lines = useStatementLines(statement?.statement_id ?? null)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Bank Transactions"
        sub="What the bank said happened, and which file said it."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "transactions", label: "Transactions" },
              { value: "imports", label: "Imports" },
            ]}
          />
          {tab === "transactions" && rows.length > 0 && (
            <Select
              aria-label="Statement"
              value={statement?.statement_id ?? ""}
              onChange={setChosen}
              className="h-8 w-[22rem]"
            >
              {rows.map((row) => (
                <option key={row.statement_id} value={row.statement_id}>
                  {row.account_name} — {row.site_id} · {day(row.period_start)} →{" "}
                  {day(row.period_end)}
                </option>
              ))}
            </Select>
          )}
          <Toolbar.Spacer />
          <span className="text-[0.71875rem] text-mute">
            {statements.data === undefined
              ? null
              : `${count(statements.data.total)} statements · ${count(statements.data.total_unmatched)} lines unreconciled`}
          </span>
        </Toolbar>

        {statements.isPending ? (
          <LoadingState>Reading what has arrived…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            Nothing has been imported yet. A statement arrives either from the
            mailbox gateway or from a paste on Finance → Cash &amp; bank.
          </EmptyState>
        ) : tab === "imports" ? (
          <Grid>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th width="10rem">Location</Th>
                <Th width="12rem">Period</Th>
                <Th align="right" width="9rem">
                  Opening
                </Th>
                <Th align="right" width="9rem">
                  Closing
                </Th>
                <Th align="right" width="7rem">
                  Lines
                </Th>
                <Th width="12rem">Imported</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.statement_id}>
                  <Td>
                    <span className="font-medium text-ink">
                      {row.account_name}
                    </span>
                    <span className="block font-mono text-[0.65625rem] text-mute">
                      {row.account_code}
                    </span>
                  </Td>
                  <Td>{siteName(row.site_id)}</Td>
                  <Td>
                    {day(row.period_start)} → {day(row.period_end)}
                  </Td>
                  <Td align="right">{money(row.opening_minor)}</Td>
                  <Td align="right">{money(row.closing_minor)}</Td>
                  <Td align="right">
                    {count(row.matched_count)} / {count(row.line_count)}
                  </Td>
                  <Td className="text-mute">
                    {moment(row.imported_at)}
                    <span className="block text-[0.65625rem]">
                      {row.imported_by}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Grid>
        ) : lines.isPending ? (
          <LoadingState>Reading the statement…</LoadingState>
        ) : (
          <>
            <Grid>
              <thead>
                <tr>
                  <Th width="5.5rem">Date</Th>
                  <Th>Description</Th>
                  <Th align="right" width="7.5rem">
                    Deposit
                  </Th>
                  <Th align="right" width="7.5rem">
                    Withdrawal
                  </Th>
                  <Th width="8rem">Reference</Th>
                  <Th width="9rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {(lines.data ?? []).map((row) => (
                  <tr key={row.line_id}>
                    <Td>{day(row.value_date)}</Td>
                    <Td>
                      <span className="text-ink">{row.description}</span>
                      {row.matched_entry_number !== null && (
                        <span className="block text-[0.65625rem] text-mute">
                          {row.matched_entry_number}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {row.credit_minor === 0 ? "—" : money(row.credit_minor)}
                    </Td>
                    <Td align="right">
                      {row.debit_minor === 0 ? "—" : money(row.debit_minor)}
                    </Td>
                    <Td className="font-mono text-[0.6875rem] text-mute">
                      {row.reference ?? "—"}
                    </Td>
                    <Td>
                      {row.matched_journal_line_id === null ? (
                        <Pill>Unreconciled</Pill>
                      ) : (
                        <Pill tone="ok">Reconciled</Pill>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Grid>

            <LabNote>
              Three things belong on this list and are not here yet, all of them
              ours rather than ERPNext&rsquo;s: multi-select with bulk actions,
              the rules sheet that proposes a meaning from a description, and
              the mailbox sources that feed the Imports tab. They are named here
              so nobody looks for them on the reconciliation screen.
            </LabNote>
          </>
        )}
      </div>
    </PageContent>
  )
}
