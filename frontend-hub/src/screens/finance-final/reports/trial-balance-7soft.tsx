import {
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Day } from "@/components/ui/day"
import { ExportButton } from "@/components/ui/export-button"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { CellMoney } from "@/components/ui/rows-switch"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, label, money } from "@/lib/format"
import {
  accountLedger,
  financeKeys,
  trialBalanceQuery,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  Grid,
  Td,
  Th,
  TotalRow,
  useAskedWindow,
} from "@/screens/finance-final/parts"
import { asPresented, dayBefore } from "@/screens/finance/chart"
import { useAsOf, useSettledWindow } from "@/screens/finance/hooks"
import { UnitSelect, WindowControl } from "@/screens/finance/parts"
import { ReportFilters } from "@/screens/finance/report"
import type { TrialBalanceRow } from "@itulah/contract"

/// 7Soft's Info Accounting, last two tabs: **Neraca Saldo** and **Buku Besar
/// Pembantu**, drawn over the trial balance the hub already reads.
///
/// Both are the same endpoint, `GET /finance/trial-balance`, which answers
/// "every posting up to one date, summed gross, per account". Neraca Saldo is
/// one reading of it (7Soft's "Sampai tanggal"); Buku Besar Pembantu is two —
/// the day before the period opens, and the period's last day — so Awal is the
/// first, Saldo the second, and Debet and Kredit their gross difference. The
/// difference of two gross sums is exact (see `trial-balance.tsx`), which is
/// why this needs no endpoint of its own.
///
/// 7Soft's Buku Besar Pembantu prints every transaction of every account in
/// the range in one grid. Here the range is the summary, one line an account,
/// and a line opens that account's transactions — the General Ledger's rows,
/// for the same period — in a layer. A range of a few hundred accounts with
/// every posting under each is a page nobody can read; the summary is what is
/// checked against the Neraca, the transactions are what explains a line.
///
/// The three controls 7Soft has and this leaves out are technical: record
/// paging (First, Prior, Next, Last, "4 of 303"), Format and Default.

/// What each reading draws on a row of an account, rolled over units.
interface Line {
  readonly code: string
  readonly name: string
  readonly rootClass: string
  readonly depth: number
  /// Gross sums, inception to the reading's date.
  readonly debit: number
  readonly credit: number
}

/// One line per account, the unit dimension summed away. The server answers in
/// the chart's code order and a Map keeps the order it first sees a key in.
function byAccount(rows: readonly TrialBalanceRow[]): Map<string, Line> {
  const table = new Map<string, Line>()
  for (const row of rows) {
    const held = table.get(row.account_code)
    table.set(row.account_code, {
      code: row.account_code,
      name: row.name,
      rootClass: row.root_class,
      depth: row.depth,
      debit: (held?.debit ?? 0) + row.debit_minor,
      credit: (held?.credit ?? 0) + row.credit_minor,
    })
  }
  return table
}

const dot = <span className="text-hairline-strong">·</span>

// ---------------------------------------------------------------------------
// Neraca Saldo
// ---------------------------------------------------------------------------

/// The trial balance as of one day: Kode, Nama, Debet, Kredit — each account's
/// net balance on the side it belongs to — with the total of each side and
/// Selisih, which must be nil.
export function NeracaSaldo({ switcher }: { switcher: React.ReactNode }) {
  const [unit, setUnit] = useState("")
  const asOf = useAsOf()
  const [opened] = useState(asOf.value)
  // An emptied date asks for nothing new; the read stays where it was.
  const wanted = asOf.value === "" ? opened : asOf.value
  const asked = useDeferredValue(wanted)
  const askedUnit = useDeferredValue(unit)
  const stale = asked !== wanted || askedUnit !== unit

  const trial = useSuspenseQuery(trialBalanceQuery(asked, askedUnit || null))

  const lines = useMemo(
    () =>
      [...byAccount(trial.data.rows).values()].map((line) => {
        const net = line.debit - line.credit
        return {
          ...line,
          net,
          left: net > 0 ? net : 0,
          right: net < 0 ? -net : 0,
        }
      }),
    [trial.data.rows]
  )
  const totalDebit = lines.reduce((sum, line) => sum + line.left, 0)
  const totalCredit = lines.reduce((sum, line) => sum + line.right, 0)
  const selisih = totalDebit - totalCredit
  const cut = trial.data.rows.length < trial.data.total

  const build = (): ExportSheet | null =>
    lines.length === 0
      ? null
      : {
          filename: `Neraca-Saldo-${monthStamp(asked)}`,
          sheet: "Neraca Saldo",
          title: "Neraca Saldo",
          subtitle: `Sampai tanggal ${day(asked)}`,
          columns: [
            { header: "Kode", kind: "text", width: 14 },
            { header: "Nama", kind: "text", width: 44 },
            { header: "Debet", kind: "money" },
            { header: "Kredit", kind: "money" },
          ],
          rows: lines.map((line) => [
            line.code,
            line.name,
            line.left === 0 ? null : line.left,
            line.right === 0 ? null : line.right,
          ]),
          totalRow: [null, "Total", totalDebit, totalCredit],
        }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Trial Balance"
        actions={<ExportButton build={build} disabled={lines.length === 0} />}
      />

      <ReportFilters>
        {switcher}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <label className="flex items-center gap-1.5 text-[0.9375rem] text-mute">
          Sampai tanggal
          <Day
            value={asOf.value}
            onChange={asOf.set}
            className="h-8 w-40"
            label="Sampai tanggal"
          />
        </label>
      </ReportFilters>

      {!trial.data.balanced && (
        <Banner tone="bad" className="mb-3">
          <b className="font-semibold">This trial balance does not balance.</b>{" "}
          The server totals debits {money(trial.data.total_debit_minor)} against
          credits {money(trial.data.total_credit_minor)}. Every entry is checked
          when it is posted, so this means something got past the database —
          tell somebody before anything else is posted.
        </Banner>
      )}
      {cut && (
        <Banner tone="warn" className="mb-3">
          The chart is larger than one page of this report, so the lines and
          totals below cover only what arrived. Narrow by unit to bring it
          inside one page.
        </Banner>
      )}

      <KpiStrip>
        <Kpi label="Total Debet" value={money(totalDebit)} />
        <Kpi label="Total Kredit" value={money(totalCredit)} />
        <Kpi
          label="Selisih"
          value={
            selisih === 0 ? (
              money(0)
            ) : (
              <span className="text-bad-fg">{money(selisih)}</span>
            )
          }
        />
      </KpiStrip>

      <div className="list-swap" aria-busy={stale || undefined}>
        {lines.length === 0 ? (
          <EmptyState>
            Nothing has been posted up to {day(asked)}
            {askedUnit === "" ? ", in any unit" : " in this unit"}.
          </EmptyState>
        ) : (
          <Grid followRows giveUp={[[3, 4]]}>
            <thead>
              <tr>
                <Th width="9rem">Kode</Th>
                <Th>Nama</Th>
                <Th align="right" width="10rem">
                  Debet
                </Th>
                <Th align="right" width="10rem">
                  Kredit
                </Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.code}>
                  <Td>
                    <AppLink
                      to="/finance/accounting/general-ledger"
                      sheet={{ key: "account", value: line.code }}
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                    >
                      {line.code}
                    </AppLink>
                  </Td>
                  <Td className="max-w-0 text-ink">
                    <span className="block truncate" title={line.name}>
                      {line.name}
                    </span>
                  </Td>
                  <Td align="right">
                    {line.left === 0 ? dot : <CellMoney minor={line.left} />}
                  </Td>
                  <Td align="right">
                    {line.right === 0 ? dot : <CellMoney minor={line.right} />}
                  </Td>
                </tr>
              ))}
              <TotalRow>
                <Td />
                <Td>Total of {count(lines.length)} accounts</Td>
                <Td align="right">{money(totalDebit)}</Td>
                <Td align="right">{money(totalCredit)}</Td>
              </TotalRow>
            </tbody>
          </Grid>
        )}
      </div>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Buku Besar Pembantu
// ---------------------------------------------------------------------------

/// Accounts from one code to another over a period: Awal, Debet, Kredit,
/// Saldo, with the four totals under them. A line opens the account's
/// transactions.
export function BukuBesarPembantu({ switcher }: { switcher: React.ReactNode }) {
  const [unit, setUnit] = useState("")
  const [from, setFrom] = useState("")
  const [until, setUntil] = useState("")
  const range = useSettledWindow()
  const asked = useAskedWindow(range)
  const askedUnit = useDeferredValue(unit)
  const stale = asked.stale || askedUnit !== unit
  const before = useMemo(() => dayBefore(asked.from), [asked.from])
  const account = useSheet("account")

  const [opening, closing] = useSuspenseQueries({
    queries: [
      trialBalanceQuery(before, askedUnit || null),
      trialBalanceQuery(asked.to, askedUnit || null),
    ],
  })

  const lines = useMemo(() => {
    const was = byAccount(opening.data.rows)
    const low = from.trim()
    const high = until.trim()
    return (
      [...byAccount(closing.data.rows).values()]
        .filter(
          (line) =>
            (low === "" || line.code >= low) &&
            // "s.d. 1011" takes every account that starts with it, not only the
            // one whose code is exactly 1011.
            (high === "" || line.code <= high || line.code.startsWith(high))
        )
        .map((line) => {
          const old = was.get(line.code)
          const awal = (old?.debit ?? 0) - (old?.credit ?? 0)
          const saldo = line.debit - line.credit
          return {
            code: line.code,
            name: line.name,
            rootClass: line.rootClass,
            // Read as the account's nature reads it, so a payable's balance is
            // a positive figure as 7Soft prints it.
            awal: asPresented(awal, line.rootClass),
            debet: line.debit - (old?.debit ?? 0),
            kredit: line.credit - (old?.credit ?? 0),
            saldo: asPresented(saldo, line.rootClass),
          }
        })
        // An account that did not move and held nothing is not a line of this
        // period.
        .filter(
          (line) =>
            line.awal !== 0 ||
            line.debet !== 0 ||
            line.kredit !== 0 ||
            line.saldo !== 0
        )
    )
  }, [opening.data.rows, closing.data.rows, from, until])

  const sameNature =
    lines.length > 0 &&
    lines.every(
      (line) =>
        (line.rootClass === "1" || line.rootClass >= "5") ===
        (lines[0].rootClass === "1" || lines[0].rootClass >= "5")
    )
  const sum = (pick: (line: (typeof lines)[number]) => number) =>
    lines.reduce((total, line) => total + pick(line), 0)
  const cut =
    closing.data.rows.length < closing.data.total ||
    opening.data.rows.length < opening.data.total

  const build = (): ExportSheet | null =>
    lines.length === 0
      ? null
      : {
          filename: `Buku-Besar-Pembantu-${monthStamp(asked.to)}`,
          sheet: "Buku Besar Pembantu",
          title: "Buku Besar Pembantu",
          subtitle: `${day(asked.from)} – ${day(asked.to)}`,
          columns: [
            { header: "Kode", kind: "text", width: 14 },
            { header: "Nama", kind: "text", width: 44 },
            { header: "Awal", kind: "money" },
            { header: "Debet", kind: "money" },
            { header: "Kredit", kind: "money" },
            { header: "Saldo", kind: "money" },
          ],
          rows: lines.map((line) => [
            line.code,
            line.name,
            line.awal,
            line.debet,
            line.kredit,
            line.saldo,
          ]),
          totalRow: [
            null,
            "Total",
            sameNature ? sum((line) => line.awal) : null,
            sum((line) => line.debet),
            sum((line) => line.kredit),
            sameNature ? sum((line) => line.saldo) : null,
          ],
        }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Trial Balance"
        actions={<ExportButton build={build} disabled={lines.length === 0} />}
      />

      <ReportFilters>
        {switcher}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Input
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="Account"
          aria-label="Account from"
          className="h-8 w-36"
          inputMode="numeric"
        />
        <span className="text-[0.9375rem] text-mute">s.d.</span>
        <Input
          value={until}
          onChange={(event) => setUntil(event.target.value)}
          placeholder="Account"
          aria-label="Account until"
          className="h-8 w-36"
          inputMode="numeric"
        />
        <span className="text-[0.9375rem] text-mute">Periode</span>
        <WindowControl range={range} />
      </ReportFilters>

      {cut && (
        <Banner tone="warn" className="mb-3">
          The chart is larger than one page of this report, so the lines and
          totals below cover only what arrived. Narrow the account range or the
          unit.
        </Banner>
      )}

      <div className="list-swap" aria-busy={stale || undefined}>
        {!asked.valid ? (
          <EmptyState>
            Choose a start date that is on or before the end date.
          </EmptyState>
        ) : lines.length === 0 ? (
          <EmptyState>
            No account in this range held or moved anything between{" "}
            {day(asked.from)} and {day(asked.to)}.
          </EmptyState>
        ) : (
          <Grid followRows giveUp={[[3, 4]]}>
            <thead>
              <tr>
                <Th width="9rem">Kode</Th>
                <Th>Nama</Th>
                <Th align="right" width="9.5rem">
                  Awal
                </Th>
                <Th align="right" width="9.5rem">
                  Debet
                </Th>
                <Th align="right" width="9.5rem">
                  Kredit
                </Th>
                <Th align="right" width="10rem">
                  Saldo
                </Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.code}
                  className="cursor-pointer"
                  onClick={() => account.open(line.code)}
                >
                  <Td>
                    <button
                      type="button"
                      onClick={() => account.open(line.code)}
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                    >
                      {line.code}
                    </button>
                  </Td>
                  <Td className="max-w-0 text-ink">
                    <span className="block truncate" title={line.name}>
                      {line.name}
                    </span>
                  </Td>
                  <Td align="right">
                    {line.awal === 0 ? dot : <CellMoney minor={line.awal} />}
                  </Td>
                  <Td align="right">
                    {line.debet === 0 ? dot : <CellMoney minor={line.debet} />}
                  </Td>
                  <Td align="right">
                    {line.kredit === 0 ? (
                      dot
                    ) : (
                      <CellMoney minor={line.kredit} />
                    )}
                  </Td>
                  <Td align="right" className="font-medium text-ink">
                    {line.saldo === 0 ? dot : <CellMoney minor={line.saldo} />}
                  </Td>
                </tr>
              ))}
              <TotalRow>
                <Td />
                <Td>Total of {count(lines.length)} accounts</Td>
                <Td align="right">
                  {sameNature ? money(sum((line) => line.awal)) : "—"}
                </Td>
                <Td align="right">{money(sum((line) => line.debet))}</Td>
                <Td align="right">{money(sum((line) => line.kredit))}</Td>
                <Td align="right">
                  {sameNature ? money(sum((line) => line.saldo)) : "—"}
                </Td>
              </TotalRow>
            </tbody>
          </Grid>
        )}
      </div>

      <AccountTransactions
        code={account.value ?? null}
        from={asked.from}
        to={asked.to}
        unit={askedUnit}
        onClose={account.close}
      />
    </PageContent>
  )
}

/// One account's transactions over the period, in a layer: 7Soft's grid of
/// Tanggal, No Jurnal, Keterangan, Debet, Kredit and Saldo, with the
/// account's Awal, Debet, Kredit and Saldo Akhir above it.
function AccountTransactions({
  code,
  from,
  to,
  unit,
  onClose,
}: {
  code: string | null
  from: string
  to: string
  unit: string
  onClose: () => void
}) {
  const ledger = useQuery({
    queryKey: financeKeys.ledger(code ?? "", unit || null, from, to, {
      limit: 200,
    }),
    queryFn: ({ signal }) =>
      accountLedger(
        code ?? "",
        { unit: unit || undefined, from, to, limit: 200 },
        signal
      ),
    enabled: code !== null,
  })

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={code ?? undefined}
      title={ledger.data?.account_name ?? "Account"}
      size="wide"
    >
      {queryState(ledger, {
        loading: "Reading the transactions…",
        render: (data) => (
          <div className="flex flex-col gap-4">
            <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Awal" value={money(data.opening_minor)} />
              <Kpi label="Debet" value={money(data.window_debit_minor)} />
              <Kpi label="Kredit" value={money(data.window_credit_minor)} />
              <Kpi label="Saldo Akhir" value={money(data.closing_minor)} />
            </KpiStrip>
            {data.rows.length === 0 ? (
              <EmptyState>
                Nothing moved in this account between {day(data.from)} and{" "}
                {day(data.to)}.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="7rem">Tanggal</Th>
                    <Th>No Jurnal</Th>
                    <Th align="right" width="8.5rem">
                      Debet
                    </Th>
                    <Th align="right" width="8.5rem">
                      Kredit
                    </Th>
                    <Th align="right" width="9rem">
                      Saldo
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.line_id}>
                      <Td>{day(row.posting_date)}</Td>
                      <Td className="whitespace-normal">
                        <span className="font-mono text-[0.9375rem] text-ink">
                          {row.entry_number}
                        </span>
                        <span className="block text-[0.9375rem] text-mute">
                          {row.memo !== null && row.memo !== ""
                            ? row.memo
                            : label(row.source_kind)}
                        </span>
                      </Td>
                      <Td align="right">
                        {row.debit_minor === 0 ? dot : money(row.debit_minor)}
                      </Td>
                      <Td align="right">
                        {row.credit_minor === 0 ? dot : money(row.credit_minor)}
                      </Td>
                      <Td align="right" className="font-medium text-ink">
                        {money(row.running_minor)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            )}
            {data.next_cursor !== null && (
              <p className="text-[0.9375rem] text-mute">
                The first {count(data.rows.length)} of {count(data.total)}{" "}
                transactions.{" "}
              </p>
            )}
            {code !== null && (
              <AppLink
                to="/finance/accounting/general-ledger"
                sheet={{ key: "account", value: code }}
                className="text-[0.9375rem] text-accent hover:underline"
              >
                Open in the General Ledger
              </AppLink>
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}
