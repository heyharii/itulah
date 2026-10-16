import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type { JournalEntryRow, PayrollRunView } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadMore,
  LoadingState,
} from "@/components/ui/states"
import { day, money, monthYear } from "@/lib/format"
import {
  financeKeys,
  journalEntry,
  listCompanyBankAccounts,
  listJournal,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import {
  listEmployees,
  listRuns,
  payKeys,
  peopleKeys,
  readHandover,
  settleHandover,
} from "@/lib/queries/people"
import { useCanWrite } from "@/lib/session"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"

/// Payroll as Finance sees it: what HR handed over, and whether it was paid.
///
/// HR hands an approved run to Finance and the accrual journal is posted at
/// that moment. Finance's part is to record that the money went out. Three of
/// these screens are one list cut three ways (`slice`).
type Slice = "all" | "RECEIVED" | "PAID"

function monthName(period: string): string {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return monthYear(new Date(year, month - 1, 1), true)
}

function stateOf(run: PayrollRunView): "RECEIVED" | "PAID" | "NONE" {
  const state = run.handover?.state
  return state === "RECEIVED" || state === "PAID" ? state : "NONE"
}

function StatePill({ run }: { run: PayrollRunView }) {
  const state = stateOf(run)
  return state === "PAID" ? (
    <Pill tone="ok">Paid</Pill>
  ) : state === "RECEIVED" ? (
    <Pill tone="info">With Finance</Pill>
  ) : (
    <Pill tone="neutral">Not handed over</Pill>
  )
}

function useRuns() {
  return useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
  })
}

function PayrollList({
  slice,
  title,
  sub,
}: {
  slice: Slice
  title: string
  sub: string
}) {
  const runs = useRuns()
  const units = useUnits()
  const [open, setOpen] = useState<PayrollRunView | null>(null)
  const unitName = (id: string) =>
    units.data?.find((unit) => unit.id === id)?.name ?? id

  const all = useMemo(() => runs.data ?? [], [runs.data])
  const rows = useMemo(
    () =>
      all
        .filter((run) =>
          slice === "all"
            ? run.handover !== null || run.state === "APPROVED"
            : run.handover?.state === slice
        )
        .sort((a, b) => b.period.localeCompare(a.period)),
    [all, slice]
  )
  const waiting = all
    .filter((run) => run.handover?.state === "RECEIVED")
    .reduce((total, run) => total + (run.handover?.gross_minor ?? 0), 0)
  const year = String(new Date().getFullYear())
  // The card shows rupiah, so it is what was paid this year, not a count.
  const paidThisYear = all
    .filter(
      (run) =>
        run.handover?.state === "PAID" &&
        (run.handover.settled_at ?? "").startsWith(year)
    )
    .reduce((total, run) => total + (run.handover?.gross_minor ?? 0), 0)
  const shown = rows.reduce(
    (total, run) => total + (run.handover?.gross_minor ?? 0),
    0
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Payroll" title={title} sub={sub} />

      {slice === "all" ? (
        <CardRow columns={2}>
          <NumberCard
            label="Waiting to be paid"
            value={waiting}
            tone={waiting > 0 ? "warn" : "ok"}
          />
          <NumberCard label="Paid this year" value={paidThisYear} />
        </CardRow>
      ) : (
        <CardRow columns={2}>
          <NumberCard
            label={slice === "RECEIVED" ? "Total owed" : "Total paid"}
            value={shown}
            tone={slice === "RECEIVED" && shown > 0 ? "warn" : undefined}
          />
          <NumberCard label="Runs" value={rows.length} unit="count" />
        </CardRow>
      )}

      {runs.isPending ? (
        <LoadingState />
      ) : runs.isError ? (
        <ErrorState error={runs.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          {slice === "RECEIVED"
            ? "Nothing owed — every handed-over run is paid"
            : slice === "PAID"
              ? "No payroll run has been paid yet"
              : "No payroll run has reached Finance yet"}
        </EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Month</Th>
              <Th>Unit</Th>
              <Th align="right">People</Th>
              <Th align="right">Gross</Th>
              <Th>Finance state</Th>
              <Th>Handed over</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr
                key={run.id}
                className="cursor-pointer hover:bg-soft"
                onClick={() => setOpen(run)}
              >
                <Td>{monthName(run.period)}</Td>
                <Td>{unitName(run.unit_id)}</Td>
                <Td align="right">{run.handover?.people ?? "—"}</Td>
                <Td align="right">{money(run.handover?.gross_minor)}</Td>
                <Td>
                  <StatePill run={run} />
                </Td>
                <Td>
                  {run.handover
                    ? `${day(run.handover.handed_over_at)} · ${run.handover.handed_over_by}`
                    : "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
      {open !== null && (
        <RunSheet
          run={all.find((run) => run.id === open.id) ?? open}
          unitName={unitName(open.unit_id)}
          isHeadOffice={
            units.data?.find((unit) => unit.id === open.unit_id)?.kind === "HO"
          }
          onClose={() => setOpen(null)}
        />
      )}
    </PageContent>
  )
}

export function PayrollRuns() {
  return (
    <PayrollList
      slice="all"
      title="Payroll Runs"
      sub="Every month HR has handed to Finance, and whether it has been paid."
    />
  )
}

export function PayrollPayables() {
  return (
    <PayrollList
      slice="RECEIVED"
      title="Payroll Payables"
      sub="Gross pay Finance holds the accrual for and has not yet paid out."
    />
  )
}

export function PayrollPayments() {
  return (
    <PayrollList
      slice="PAID"
      title="Employee Payments"
      sub="Payroll runs Finance has recorded as paid."
    />
  )
}

function RunSheet({
  run,
  unitName,
  isHeadOffice,
  onClose,
}: {
  run: PayrollRunView
  unitName: string
  isHeadOffice: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const canWrite = useCanWrite()
  const [reason, setReason] = useState("")
  const [bank, setBank] = useState("")
  const standing = run.handover
  const handover = useQuery({
    queryKey: payKeys.handover(run.id),
    queryFn: ({ signal }) => readHandover(run.id, signal),
    enabled: standing !== null,
  })
  const people = useQuery({
    queryKey: [...peopleKeys.all, "payroll-names", run.unit_id],
    queryFn: ({ signal }) => listEmployees({ unitId: run.unit_id }, signal),
    enabled: standing !== null,
  })
  const banks = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
    enabled: isHeadOffice && standing?.state === "RECEIVED",
  })
  const names = useMemo(
    () =>
      new Map(
        (people.data ?? []).map((person) => [
          person.employee_id,
          person.full_name ?? person.employee_code,
        ])
      ),
    [people.data]
  )
  const settle = useMutation({
    mutationFn: () => {
      const [bank_key, bank_qualifier] = bank.split("|")
      return settleHandover(
        run.id,
        reason.trim(),
        isHeadOffice
          ? { bank_key, bank_qualifier: bank_qualifier ?? "" }
          : undefined
      )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: payKeys.runs() })
      void client.invalidateQueries({ queryKey: payKeys.handover(run.id) })
      void client.invalidateQueries({ queryKey: financeKeys.all })
      onClose()
    },
  })
  const canPay = canWrite && standing?.state === "RECEIVED"

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={`${unitName} · ${monthName(run.period)}`}
      footer={
        canPay ? (
          <div className="flex justify-end gap-2">
            <Button data-cancel variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={settle.isPending}
              disabled={reason.trim() === "" || (isHeadOffice && bank === "")}
              onClick={() => settle.mutate()}
            >
              Record payment
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="Unit">{unitName}</Fact>
          <Fact term="Month">{monthName(run.period)}</Fact>
          <Fact term="Finance state">
            <StatePill run={run} />
          </Fact>
          <Fact term="Gross">{money(standing?.gross_minor)}</Fact>
          <Fact term="People">{standing?.people ?? "—"}</Fact>
          {standing && (
            <>
              <Fact term="Handed over">
                {day(standing.handed_over_at)} · {standing.handed_over_by}
              </Fact>
              <Fact term="Handover reason">{standing.handed_over_reason}</Fact>
            </>
          )}
          {standing?.settled_at && (
            <>
              <Fact term="Paid">
                {day(standing.settled_at)} · {standing.settled_by}
              </Fact>
              <Fact term="Payment reason">{standing.settled_reason}</Fact>
            </>
          )}
        </Facts>

        {standing === null && (
          <Note>
            HR has not handed this run to Finance yet. Nothing is owed until it
            is.
          </Note>
        )}

        {standing !== null && (
          <div>
            <div className="mb-1 text-[0.9375rem] text-mute">Per employee</div>
            {handover.isPending ? (
              <LoadingState />
            ) : handover.isError ? (
              <ErrorState error={handover.error} />
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th align="right">Gross</Th>
                  </tr>
                </thead>
                <tbody>
                  {(handover.data?.lines ?? []).map((line) => (
                    <tr key={line.employee_id}>
                      <Td>
                        {names.get(line.employee_id) ?? (
                          <Code>{line.employee_id}</Code>
                        )}
                      </Td>
                      <Td align="right">{money(line.gross_minor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            )}
          </div>
        )}

        {canPay && (
          <div className="flex flex-col gap-4">
            {isHeadOffice ? (
              <Field label="Paid from" required>
                <Select value={bank} onChange={setBank}>
                  <option value="">Choose a bank account</option>
                  {(banks.data ?? []).map((account) => (
                    <option
                      key={`${account.ledger_account_code}-${account.bank_code}-${account.account_no}`}
                      value={`${account.kind === "SAVINGS" ? "bank_savings" : "bank_giro"}|${account.bank_code}`}
                    >
                      {`${account.bank_code} ${account.account_no}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Note>
                Store staff are paid from the store&apos;s petty cash (Store
                money → payouts); this records the run as paid and posts nothing
                more.
              </Note>
            )}
            <Field label="Reason" required>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {settle.error !== null && (
              <Banner tone="bad">{settle.error.message}</Banner>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/// The accrual entries payroll has posted, newest first. The server filters
/// on the source kind, so the total beside the list is over every entry and
/// not the page held.
export function PayrollPosting() {
  const units = useUnits()
  const [open, setOpen] = useState<JournalEntryRow | null>(null)
  const journal = useInfiniteQuery({
    queryKey: [
      ...financeKeys.journal(null, null, "PAYROLL_RUN", null),
      "pages",
    ],
    queryFn: ({ pageParam, signal }) =>
      listJournal(
        { kind: "PAYROLL_RUN", cursor: pageParam, limit: 100 },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const rows = useMemo(
    () => journal.data?.pages.flatMap((page) => page.rows) ?? [],
    [journal.data]
  )
  const head = journal.data?.pages[0]

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payroll"
        title="Payroll Posting"
        sub="The accrual entries posted when HR handed a run over, and the payments that settled them."
      />
      <CardRow columns={2}>
        <NumberCard label="Entries" value={head?.total ?? null} unit="count" />
        <NumberCard label="Total posted" value={head?.total_minor ?? null} />
      </CardRow>
      {journal.isPending ? (
        <LoadingState />
      ) : journal.isError && journal.data === undefined ? (
        <ErrorState error={journal.error} />
      ) : rows.length === 0 ? (
        <EmptyState>No payroll entry has been posted yet</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th>Memo</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Total debit</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.entry_id}
                className="cursor-pointer hover:bg-soft"
                onClick={() => setOpen(row)}
              >
                <Td>{day(row.posting_date)}</Td>
                <Td>
                  <Code>{row.entry_number}</Code>
                </Td>
                <Td>{row.memo ?? "—"}</Td>
                <Td align="right">{row.line_count}</Td>
                <Td align="right">{money(row.total_minor)}</Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
      <LoadMore query={journal} />
      {open !== null && (
        <EntrySheet
          row={open}
          unitName={(id) => units.data?.find((u) => u.id === id)?.name ?? id}
          onClose={() => setOpen(null)}
        />
      )}
    </PageContent>
  )
}

function EntrySheet({
  row,
  unitName,
  onClose,
}: {
  row: JournalEntryRow
  unitName: (id: string) => string
  onClose: () => void
}) {
  const entry = useQuery({
    queryKey: financeKeys.entry(row.entry_id),
    queryFn: ({ signal }) => journalEntry(row.entry_id, signal),
  })
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={row.entry_number}
    >
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="Date">{day(row.posting_date)}</Fact>
          <Fact term="Memo">{row.memo ?? "—"}</Fact>
          <Fact term="Total">{money(row.total_minor)}</Fact>
          <Fact term="Posted">
            {day(row.posted_at)} · {row.posted_by}
          </Fact>
        </Facts>
        {entry.isPending ? (
          <LoadingState />
        ) : entry.isError ? (
          <ErrorState error={entry.error} />
        ) : (
          <Grid>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Unit</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {entry.data.lines.map((line) => (
                <tr key={line.line_number}>
                  <Td>
                    <Code>{line.account_code}</Code> {line.account_name}
                  </Td>
                  <Td>{unitName(line.unit_id)}</Td>
                  <Td align="right">
                    {line.debit_minor ? money(line.debit_minor) : ""}
                  </Td>
                  <Td align="right">
                    {line.credit_minor ? money(line.credit_minor) : ""}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Grid>
        )}
      </div>
    </Sheet>
  )
}
