import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import { accountLedger, trialBalanceQuery } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { todayIso } from "@/screens/finance/chart"
import {
  AccountPicker,
  UnitSelect,
  type PickedAccount,
} from "@/screens/finance/parts"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import type { TrialBalanceRow } from "@itulah/contract"

/// The Ledger: 7Soft's Info Accounting without its journal tabs (those are the
/// Journal screen's). Accounts — every account with where it opened the month,
/// what moved and where it stands; Buku besar pembantu — one account's card;
/// Neraca saldo — the trial balance to a day.
///
/// Every figure is the server's: the trial balance (Accounts and Neraca saldo,
/// asked twice for Accounts — at the month's start and today) and one account's
/// ledger (Buku besar pembantu). Nothing is totalled in the browser that the
/// server states itself.

type Tab = "accounts" | "sub" | "tb"

interface AccountLine {
  readonly code: string
  readonly name: string
  readonly rootClass: string
  readonly debit: number
  readonly credit: number
}

function byAccount(rows: readonly TrialBalanceRow[]): AccountLine[] {
  const table = new Map<string, AccountLine>()
  for (const row of rows) {
    const held = table.get(row.account_code)
    table.set(row.account_code, {
      code: row.account_code,
      name: row.name,
      rootClass: row.root_class,
      debit: (held?.debit ?? 0) + row.debit_minor,
      credit: (held?.credit ?? 0) + row.credit_minor,
    })
  }
  return [...table.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/// The client's chart, in the headings the Ledger prints between accounts.
const GROUPS: readonly (readonly [string, (code: string) => boolean])[] = [
  ["Kas & Setara Kas", (c) => c.startsWith("10110")],
  ["Piutang", (c) => c.startsWith("10111")],
  ["Persediaan", (c) => c.startsWith("10112")],
  ["Biaya dibayar dimuka", (c) => c.startsWith("10113")],
  ["Aset tetap", (c) => /^102(15|16|17)|^103/.test(c)],
  ["Hutang", (c) => c.startsWith("2")],
  ["Ekuitas", (c) => c.startsWith("3")],
  ["Pendapatan", (c) => c.startsWith("4")],
  ["HPP", (c) => c.startsWith("5")],
  ["Beban", (c) => /^[67]/.test(c)],
  ["Pendapatan & biaya lain", (c) => c.startsWith("8")],
]

function groupOf(line: AccountLine): string {
  return (
    GROUPS.find(([, test]) => test(line.code))?.[0] ?? label(line.rootClass)
  )
}

/// Assets, costs and the 80x debit accounts read as Dr − Cr; the rest as Cr − Dr.
function signed(line: AccountLine, debit: number, credit: number): number {
  return /^[1567]/.test(line.code) || /^80[23]/.test(line.code)
    ? debit - credit
    : credit - debit
}

function monthStart(today: string): string {
  return `${today.slice(0, 8)}01`
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function lastMonth(today: string): { from: string; to: string } {
  const to = dayBefore(monthStart(today))
  return { from: `${to.slice(0, 8)}01`, to }
}

export function InfoAccounting() {
  const [tab, setTab] = useState<Tab>("accounts")
  const [picked, setPicked] = useState<PickedAccount | null>(null)

  return (
    <PageContent>
      <PageHeader crumb="Finance · Accounting" title="Ledger" />
      <Toolbar
        lead={
          <SubTabs
            value={tab}
            onChange={(next) => setTab(next as Tab)}
            tabs={[
              { value: "accounts", label: "Accounts" },
              {
                value: "sub",
                label: "Buku besar pembantu",
                short: "Buku besar",
              },
              { value: "tb", label: "Neraca saldo", short: "Neraca" },
            ]}
          />
        }
      />
      {tab === "accounts" && (
        <AccountsTab
          onOpen={(account) => {
            setPicked(account)
            setTab("sub")
          }}
        />
      )}
      {tab === "sub" && <SubTab picked={picked} onPick={setPicked} />}
      {tab === "tb" && (
        <NeracaTab
          onOpen={(account) => {
            setPicked(account)
            setTab("sub")
          }}
        />
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/// Every account that holds a balance or moved this month, under its heading:
/// Saldo awal (the day before the month), Mutasi (the difference) and Saldo.
/// A row opens that account's Buku besar pembantu.
function AccountsTab({ onOpen }: { onOpen: (account: PickedAccount) => void }) {
  const [today] = useState(todayIso)
  const [unit, setUnit] = useState("")
  const [needle, setNeedle] = useState("")
  const opening = dayBefore(monthStart(today))
  const [now, before] = useQueries({
    queries: [
      trialBalanceQuery(today, unit === "" ? null : unit),
      trialBalanceQuery(opening, unit === "" ? null : unit),
    ],
  })

  const grouped = useMemo(() => {
    const awal = new Map(
      byAccount(before.data?.rows ?? []).map((line) => [
        line.code,
        signed(line, line.debit, line.credit),
      ])
    )
    const lines = byAccount(now.data?.rows ?? [])
    const q = needle.trim().toLowerCase()
    return GROUPS.map(([name]) => name)
      .concat(
        [...new Set(lines.map(groupOf))].filter(
          (name) => !GROUPS.some(([known]) => known === name)
        )
      )
      .map((name) => {
        const rows = lines
          .filter((line) => groupOf(line) === name)
          .filter(
            (line) =>
              q === "" ||
              line.code.includes(q) ||
              line.name.toLowerCase().includes(q)
          )
          .map((line) => {
            const saldo = signed(line, line.debit, line.credit)
            const start = awal.get(line.code) ?? 0
            return { line, awal: start, mutasi: saldo - start, saldo }
          })
        return {
          name,
          rows,
          total: rows.reduce((sum, row) => sum + row.saldo, 0),
        }
      })
      .filter((group) => group.rows.length > 0)
  }, [now.data, before.data, needle])

  return (
    <>
      <Toolbar>
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search accounts"
          placeholder="Account code or name"
        />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        {/* The prototype's own reading of the bar: the period (`202610`) to
            today, not the day twice. */}
        <span className="text-[0.9375rem] text-mute">
          {today.slice(0, 4)}
          {today.slice(5, 7)} · to {day(today)}
        </span>
      </Toolbar>
      {queryState(now, {
        loading: "Reading the accounts…",
        render: () =>
          grouped.length === 0 ? (
            <EmptyState>No account matches.</EmptyState>
          ) : (
            <Grid followRows>
              <thead>
                <tr>
                  <Th width="10rem">Kode</Th>
                  <Th>Account</Th>
                  <Th align="right" width="12rem">
                    Saldo awal
                  </Th>
                  <Th align="right" width="12rem">
                    Mutasi
                  </Th>
                  <Th align="right" width="12rem">
                    Saldo
                  </Th>
                </tr>
              </thead>
              <tbody>
                {grouped.flatMap((group) => [
                  <tr key={`g-${group.name}`} className="bg-soft">
                    <Td colSpan={5} className="font-medium text-ink">
                      {group.name}{" "}
                      <span className="text-mute">· {money(group.total)}</span>
                    </Td>
                  </tr>,
                  ...group.rows.map(({ line, awal, mutasi, saldo }) => (
                    <tr
                      key={line.code}
                      className="cursor-pointer hover:bg-soft"
                      onClick={() =>
                        onOpen({
                          account_code: line.code,
                          name: line.name,
                          category_family: null,
                        })
                      }
                    >
                      <Td className="font-mono text-accent">{line.code}</Td>
                      <Td className="max-w-0 text-ink">
                        <span className="block truncate" title={line.name}>
                          {line.name}
                        </span>
                      </Td>
                      <Td align="right">{money(awal)}</Td>
                      <Td align="right">
                        {mutasi === 0 ? (
                          <span className="text-mute">0</span>
                        ) : (
                          `${mutasi > 0 ? "+" : ""}${money(mutasi)}`
                        )}
                      </Td>
                      <Td align="right">{money(saldo)}</Td>
                    </tr>
                  )),
                ])}
              </tbody>
            </Grid>
          ),
      })}
      {before.isError && (
        <Banner tone="warn" className="mt-3">
          The opening balances could not be read, so Saldo awal and Mutasi are
          not complete.
        </Banner>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Buku besar pembantu
// ---------------------------------------------------------------------------

/// One account's card for this month or last: the movements with the running
/// balance, then Awal, Debet, Kredit and Saldo akhir.
function SubTab({
  picked,
  onPick,
}: {
  picked: PickedAccount | null
  onPick: (account: PickedAccount | null) => void
}) {
  const [today] = useState(todayIso)
  const [unit, setUnit] = useState("")
  const [per, setPer] = useState<"this" | "last">("this")
  const span =
    per === "this" ? { from: monthStart(today), to: today } : lastMonth(today)
  const ledger = useQuery({
    queryKey: [
      "finance",
      "ledger-screen",
      "sub",
      picked?.account_code,
      unit,
      span.from,
      span.to,
    ],
    queryFn: ({ signal }) =>
      accountLedger(
        picked!.account_code,
        {
          unit: unit === "" ? undefined : unit,
          from: span.from,
          to: span.to,
          limit: 500,
        },
        signal
      ),
    enabled: picked !== null,
  })

  return (
    <>
      <Toolbar>
        {picked === null ? (
          <div className="w-96 max-w-full">
            <AccountPicker allowGroups onPick={onPick} />
          </div>
        ) : (
          <>
            <span className="text-[0.9375rem] text-ink">
              <span className="font-mono">{picked.account_code}</span>{" "}
              {picked.name}
            </span>
            <Button variant="primary" onClick={() => onPick(null)}>
              Change account
            </Button>
          </>
        )}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <FilterChips
          label="Period"
          value={per}
          onChange={(next) => setPer(next === "last" ? "last" : "this")}
          options={[
            { value: "this", label: "This month" },
            { value: "last", label: "Last month" },
          ]}
        />
      </Toolbar>
      {picked === null ? (
        <EmptyState>Pick an account to read its ledger.</EmptyState>
      ) : (
        queryState(ledger, {
          loading: "Reading the ledger…",
          render: (book) => (
            <>
              {book.next_cursor !== null && (
                <Banner tone="warn" className="mb-3">
                  The first {count(book.rows.length)} of {count(book.total)}{" "}
                  movements are listed. The figures below cover the whole
                  period.
                </Banner>
              )}
              <Grid followRows>
                <thead>
                  <tr>
                    <Th width="8rem">Tanggal</Th>
                    <Th width="13rem">No</Th>
                    <Th>Keterangan</Th>
                    <Th align="right" width="11rem">
                      Debet
                    </Th>
                    <Th align="right" width="11rem">
                      Kredit
                    </Th>
                    <Th align="right" width="12rem">
                      Saldo
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-mute">
                    <Td>{day(span.from)}</Td>
                    <Td>Saldo awal</Td>
                    <Td />
                    <Td />
                    <Td />
                    <Td align="right">{money(book.opening_minor)}</Td>
                  </tr>
                  {book.rows.map((row) => (
                    <tr key={row.line_id}>
                      <Td>{day(row.posting_date)}</Td>
                      <Td>
                        <AppLink
                          to="/finance/accounting/journal-entries"
                          sheet={{ key: "entry", value: row.entry_id }}
                          className="font-mono text-accent hover:underline"
                        >
                          {row.entry_number}
                        </AppLink>
                      </Td>
                      <Td className="max-w-0 text-body">
                        <span className="block truncate" title={row.memo ?? ""}>
                          {row.memo ?? "—"}
                        </span>
                      </Td>
                      <Td align="right">
                        {row.debit_minor === 0 ? "" : money(row.debit_minor)}
                      </Td>
                      <Td align="right">
                        {row.credit_minor === 0 ? "" : money(row.credit_minor)}
                      </Td>
                      <Td align="right">{money(row.running_minor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
              <KpiStrip className="mt-6 grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
                <Kpi label="Awal" value={money(book.opening_minor)} />
                <Kpi label="Debet" value={money(book.window_debit_minor)} />
                <Kpi label="Kredit" value={money(book.window_credit_minor)} />
                <Kpi label="Saldo akhir" value={money(book.closing_minor)} />
              </KpiStrip>
            </>
          ),
        })
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Neraca saldo
// ---------------------------------------------------------------------------

/// The trial balance to one day: Sampai tanggal, Refresh to read it at the date
/// typed, then Kode, Nama, Debet, Kredit under their headings, with the total of
/// each side and Selisih, which must be nil.
function NeracaTab({ onOpen }: { onOpen: (account: PickedAccount) => void }) {
  const [typed, setTyped] = useState(todayIso)
  const [asked, setAsked] = useState(typed)
  const trial = useQuery(trialBalanceQuery(asked))
  const lines = useMemo(
    () =>
      byAccount(trial.data?.rows ?? []).map((line) => {
        const net = line.debit - line.credit
        return { ...line, left: net > 0 ? net : 0, right: net < 0 ? -net : 0 }
      }),
    [trial.data?.rows]
  )
  const groups = useMemo(() => {
    const names = [
      ...GROUPS.map(([name]) => name),
      ...new Set(lines.map(groupOf)),
    ]
    return [...new Set(names)]
      .map((name) => ({
        name,
        rows: lines.filter(
          (line) => groupOf(line) === name && (line.left || line.right)
        ),
      }))
      .filter((group) => group.rows.length > 0)
  }, [lines])
  const totalDebit = lines.reduce((sum, line) => sum + line.left, 0)
  const totalCredit = lines.reduce((sum, line) => sum + line.right, 0)
  const selisih = totalDebit - totalCredit

  return (
    <>
      <Toolbar>
        <label className="flex items-center gap-2.5 text-[0.9375rem] text-mute">
          Sampai tanggal
          <Day
            value={typed}
            onChange={setTyped}
            className="h-control w-44"
            label="Sampai tanggal"
          />
        </label>
        <Button
          variant="primary"
          pending={trial.isFetching}
          disabled={typed === ""}
          onClick={() => setAsked(typed)}
        >
          Refresh
        </Button>
        <Toolbar.Spacer />
        <span className="text-[0.9375rem] text-mute">{day(asked)}</span>
      </Toolbar>
      {trial.data !== undefined && !trial.data.balanced && (
        <Banner tone="bad" className="mb-3">
          This trial balance does not balance: the server totals debits{" "}
          {money(trial.data.total_debit_minor)} against credits{" "}
          {money(trial.data.total_credit_minor)}.
        </Banner>
      )}
      {queryState(trial, {
        loading: "Adding up the accounts…",
        render: () =>
          lines.length === 0 ? (
            <EmptyState>Nothing has been posted up to {day(asked)}.</EmptyState>
          ) : (
            <Grid followRows>
              <thead>
                <tr>
                  <Th width="10rem">Kode</Th>
                  <Th>Nama</Th>
                  <Th align="right" width="13rem">
                    Debet
                  </Th>
                  <Th align="right" width="13rem">
                    Kredit
                  </Th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) => [
                  <tr key={`g-${group.name}`} className="bg-soft">
                    <Td colSpan={4} className="font-medium text-ink">
                      {group.name}
                    </Td>
                  </tr>,
                  ...group.rows.map((line) => (
                    <tr
                      key={line.code}
                      className="cursor-pointer hover:bg-soft"
                      onClick={() =>
                        onOpen({
                          account_code: line.code,
                          name: line.name,
                          category_family: null,
                        })
                      }
                    >
                      <Td className="font-mono text-accent">{line.code}</Td>
                      <Td className="max-w-0 text-ink">
                        <span className="block truncate" title={line.name}>
                          {line.name}
                        </span>
                      </Td>
                      <Td align="right">
                        {line.left === 0 ? "" : money(line.left)}
                      </Td>
                      <Td align="right">
                        {line.right === 0 ? "" : money(line.right)}
                      </Td>
                    </tr>
                  )),
                ])}
                <TotalRow>
                  <Td>Total</Td>
                  <Td>
                    Selisih{" "}
                    <span className={selisih !== 0 ? "text-bad-fg" : ""}>
                      {money(selisih)}
                    </span>
                  </Td>
                  <Td align="right">{money(totalDebit)}</Td>
                  <Td align="right">{money(totalCredit)}</Td>
                </TotalRow>
              </tbody>
            </Grid>
          ),
      })}
    </>
  )
}
