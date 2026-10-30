import { useQueries } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { useLayout } from "@/lib/layout"
import { isoDay } from "@/lib/queries"
import {
  isClosed,
  useDeclarations,
  type ShiftDeclaration,
} from "@/lib/queries/money-declaration"
import {
  cashSalesOf,
  sessionsQuery,
  stageOf,
  tenderTotal,
  usePeople,
  type Session,
} from "@/lib/queries/sessions"
import { cn } from "@/lib/utils"
import { MoneyDeclarationRun } from "@/screens/money/declaration-run"
import {
  BOX,
  STAMP,
  TD,
  TH,
  rowDay,
  stampOf,
} from "@/screens/money/declaration-words"
import { MoneyScreen } from "@/screens/money/parts"
import { money } from "@itulah/contract/money"

/// Money declaration — one row per business day, today on top. A day that is
/// not closed carries the way in where its status would be (Declare, then
/// Continue once a cashier is closed; held back while a POS is still open); a
/// closed day carries a green rubber stamp with its day in it, as procurement
/// stamps a finished order. The whole row opens: today the run, a day past its
/// read-only summary.

/// How far back the list reaches.
const DAYS = 14

interface DayRow {
  readonly day: string
  readonly sessions: readonly Session[]
  readonly closedCount: number
  readonly open: number
  readonly cash: number
  readonly edc: number
  readonly closed: boolean
}

const EDC_TENDERS = ["CARD", "QRIS"] as const

function rowOf(
  day: string,
  sessions: readonly Session[],
  declarations: Readonly<Record<string, ShiftDeclaration>>,
): DayRow {
  const closedCount = sessions.filter((one) =>
    isClosed(declarations[one.report.shift_id]),
  ).length
  return {
    day,
    sessions,
    closedCount,
    open: sessions.filter((one) => stageOf(one.report) === "selling").length,
    cash: sessions.reduce((sum, one) => sum + cashSalesOf(one.report), 0),
    edc: sessions.reduce(
      (sum, one) =>
        sum +
        EDC_TENDERS.reduce(
          (all, kind) => all + tenderTotal(one.report, kind),
          0,
        ),
      0,
    ),
    closed: sessions.length > 0 && closedCount === sessions.length,
  }
}

export function MoneyDeclaration() {
  const phone = useLayout() === "phone"
  const declarations = useDeclarations()
  const today = isoDay(new Date())
  const days = Array.from({ length: DAYS }, (_, back) => {
    const at = new Date()
    at.setDate(at.getDate() - back)
    return isoDay(at)
  })
  const reads = useQueries({
    queries: days.map((day) => ({
      ...sessionsQuery(day),
      refetchInterval: day === today ? 30_000 : undefined,
    })),
  })
  const rows = days.flatMap((day, index) => {
    const sessions = reads[index]?.data?.sessions ?? []
    // A day without a drawer is not a row of zeros: it is not there at all
    // (Hari, 30 Oct 2026: "bukan nol, emang ga ada").
    return sessions.length > 0 ? [rowOf(day, sessions, declarations)] : []
  })

  const [run, setRun] = useState<string | null>(null)
  const [summary, setSummary] = useState<DayRow | null>(null)
  const open = (row: DayRow) => {
    if (row.closed) setSummary(row)
    else if (row.open === 0 && row.sessions.length > 0) setRun(row.day)
  }

  const status = (row: DayRow) =>
    // A day nobody has sold on yet has nothing to declare.
    row.sessions.length === 0 ? (
      <span className="text-mute">—</span>
    ) : row.closed ? (
      <span className={cn(STAMP, "text-ok-fg")}>
        Closed
        <span className="block tabular-nums">{stampOf(row.day)}</span>
      </span>
    ) : (
      <Button
        variant="primary"
        size="sm"
        disabled={row.open > 0}
        onClick={(event) => {
          event.stopPropagation()
          setRun(row.day)
        }}
      >
        {row.closedCount > 0 ? "Continue" : "Declare"}
      </Button>
    )
  const pending = reads[0]?.isPending ?? false
  // A cashier is served every drawer blind (the node withholds the figures,
  // `blind_for_cashier`), and a blind drawer cannot be summed: say so instead
  // of a day of zeros (Hari, 30 Oct 2026: closing had cash, this read 0).
  const blind = reads.some((read) => read.data?.blind === true)

  if (blind) {
    return (
      <MoneyScreen>
        <Card>
          <div className="px-5 py-8">
            <p className="text-card-title font-medium text-ink">
              Sign in as the store head to declare money
            </p>
            <p className="mt-2 text-body">
              A cashier's count stays blind, so the drawers' figures are not shown
              to this account.
            </p>
          </div>
        </Card>
      </MoneyScreen>
    )
  }

  return (
    <MoneyScreen>
      <Card>
        {phone ? (
          <ul>
            {rows.length === 0 && (
              <li className="px-4 py-10 text-center text-mute">
                {pending ? "Reading the Days…" : "No POS Opened Yet"}
              </li>
            )}
            {rows.map((row) => (
              <li
                key={row.day}
                className="border-b border-hairline last:border-b-0"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => open(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open(row)
                  }}
                  className="flex min-h-[4.75rem] items-center justify-between gap-3 px-3.5 py-3 active:bg-soft"
                >
                  <span className="min-w-0">
                    <span className="block text-card-title font-medium text-ink">
                      {rowDay(row.day)}
                    </span>
                    <span className="mt-1 block text-meta text-body tabular-nums">
                      {row.closedCount}/{row.sessions.length} closed ·{" "}
                      {money(row.cash + row.edc)}
                    </span>
                  </span>
                  {status(row)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            {/* The date and the status keep their own widths; the four
                figures share what is left evenly, side by side. */}
            <table className="w-full min-w-[46rem] table-fixed border-collapse text-cell">
              <colgroup>
                <col className="w-[9.5rem]" />
                <col />
                <col />
                <col />
                <col />
                <col className="w-[15rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={cn(TH, "text-right")}>Cashiers Closed</th>
                  <th className={cn(TH, "text-right")}>Cash</th>
                  <th className={cn(TH, "text-right")}>EDC</th>
                  <th className={cn(TH, "text-right")}>Total</th>
                  <th className={TH}>Money Declaration Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.day}
                    tabIndex={0}
                    onClick={() => open(row)}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        event.key === "Enter"
                      )
                        open(row)
                    }}
                    className="h-[4.75rem] cursor-pointer border-b border-hairline outline-none last:border-b-0 hover:bg-soft/60 focus-visible:bg-soft"
                  >
                    <td className="px-3.5 whitespace-nowrap text-text">
                      {rowDay(row.day)}
                    </td>
                    <td className="px-3.5 text-right whitespace-nowrap text-text tabular-nums">
                      {row.closedCount}/{row.sessions.length}
                    </td>
                    <td className="px-3.5 text-right whitespace-nowrap text-text tabular-nums">
                      {money(row.cash)}
                    </td>
                    <td className="px-3.5 text-right whitespace-nowrap text-text tabular-nums">
                      {money(row.edc)}
                    </td>
                    <td className="px-3.5 text-right whitespace-nowrap text-text tabular-nums">
                      {money(row.cash + row.edc)}
                    </td>
                    <td className="px-3.5 whitespace-nowrap">{status(row)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-mute"
                    >
                      {pending ? "Reading the Days…" : "No POS Opened Yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {run !== null && (
        <MoneyDeclarationRun day={run} onClose={() => setRun(null)} />
      )}
      <DaySummary
        row={summary}
        declarations={declarations}
        onClose={() => setSummary(null)}
      />
    </MoneyScreen>
  )
}

/// A closed day, read-only: what it came to and each cashier underneath.
function DaySummary({
  row,
  declarations,
  onClose,
}: {
  row: DayRow | null
  declarations: Readonly<Record<string, ShiftDeclaration>>
  onClose: () => void
}) {
  const people = usePeople()
  const latest = row?.sessions
    .map((one) => declarations[one.report.shift_id])
    .filter((one) => one?.closedAt !== undefined)
    .at(-1)
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={row === null ? "" : `Money Declaration · ${rowDay(row.day)}`}
      caption={
        latest === undefined || latest === null
          ? undefined
          : `Closed ${latest.closedAt} · ${latest.closedBy}`
      }
      width="wide"
    >
      {row !== null && (
        <>
          <Facts className="grid-cols-3">
            <Fact term="Cash">{money(row.cash)}</Fact>
            <Fact term="EDC">{money(row.edc)}</Fact>
            <Fact term="Cashiers Closed">
              {row.closedCount}/{row.sessions.length}
            </Fact>
          </Facts>
          <div className={cn(BOX, "mt-6")}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Cashier</th>
                  <th className={cn(TH, "text-right")}>Cash</th>
                  <th className={cn(TH, "text-right")}>EDC</th>
                  <th className={TH}>Closed</th>
                </tr>
              </thead>
              <tbody>
                {row.sessions.map((one) => (
                  <tr key={one.report.shift_id}>
                    <td className={TD}>
                      {people.nameOf(one.report.opened_by)}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {money(cashSalesOf(one.report))}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      {money(
                        EDC_TENDERS.reduce(
                          (all, kind) => all + tenderTotal(one.report, kind),
                          0,
                        ),
                      )}
                    </td>
                    <td className={TD}>
                      {declarations[one.report.shift_id]?.closedAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={cn(TD, "border-b-0 font-semibold text-ink")}>
                    Total
                  </td>
                  <td
                    className={cn(
                      TD,
                      "border-b-0 text-right font-semibold text-ink",
                    )}
                  >
                    {money(row.cash)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "border-b-0 text-right font-semibold text-ink",
                    )}
                  >
                    {money(row.edc)}
                  </td>
                  <td className={cn(TD, "border-b-0")} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Sheet>
  )
}
