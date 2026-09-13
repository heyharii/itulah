import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { closePeriod, financeKeys, listPeriods, openPeriod } from "@/lib/finance"
import { cn } from "@/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock, LockOpen } from "lucide-react"
import { useState } from "react"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/// The months the books are kept in, and whether they are still open.
///
/// # Why a month has to be opened before anything can be posted into it
///
/// Because "post it into whatever month the date says" is how a mistyped year
/// puts an invoice in 2062. A period that has to exist first turns that from a
/// silent success into a refusal naming the month — and the refusal comes from
/// the database, not from a check in the browser.
///
/// # Why closing cannot race a posting
///
/// The trigger that gates posting reads the period row `FOR SHARE`. A close
/// running at the same moment as a posting either waits for it or makes it
/// wait; there is no interleaving in which a month closes and a late entry
/// slips in behind it.
export function PeriodsScreen() {
  const client = useQueryClient()
  const [pending, setPending] = useState<{ year: number; month: number } | null>(null)
  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["finance"] })
  }
  const open = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) => openPeriod(year, month),
    onSuccess: invalidate,
  })
  const close = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) => closePeriod(year, month),
    onSuccess: () => {
      setPending(null)
      invalidate()
    },
  })

  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1
  const rows = periods.data ?? []
  const hasCurrent = rows.some((p) => p.year === thisYear && p.month === thisMonth)

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader
        title="Period Close"
        subtitle={rows.length === 0 ? undefined : `${rows.length} months`}
      >
        {!hasCurrent && (
          <Button
            size="sm"
            className="h-7 text-[12px]"
            disabled={open.isPending}
            onClick={() => open.mutate({ year: thisYear, month: thisMonth })}
          >
            Open {MONTHS[thisMonth - 1]} {thisYear}
          </Button>
        )}
      </ScreenHeader>

      {periods.isPending ? (
        <ScreenState>Loading…</ScreenState>
      ) : periods.error !== null ? (
        <ScreenState tone="problem">
          {periods.error instanceof Error ? periods.error.message : "could not load periods"}
        </ScreenState>
      ) : rows.length === 0 ? (
        <ScreenState
          action={
            <Button
              size="sm"
              disabled={open.isPending}
              onClick={() => open.mutate({ year: thisYear, month: thisMonth })}
            >
              Open {MONTHS[thisMonth - 1]} {thisYear}
            </Button>
          }
        >
          No accounting period exists yet, so nothing can be posted at all — the database
          refuses an entry whose month nobody has opened. Open the current month to start.
        </ScreenState>
      ) : (
        <ScreenBody>
          <table className="w-full text-[13px]">
            <thead className="bg-card sticky top-0 border-b">
              <tr className="text-muted-foreground text-[11px]">
                <th className="px-3.5 py-1.5 text-left font-medium">Month</th>
                <th className="px-3 py-1.5 text-left font-medium">Status</th>
                <th className="px-3 py-1.5 text-right font-medium">Entries</th>
                <th className="px-3 py-1.5 text-left font-medium">Closed by</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((period) => {
                const closed = period.status === "CLOSED"
                const confirming =
                  pending?.year === period.year && pending?.month === period.month
                return (
                  <tr key={`${period.year}-${period.month}`} className="border-b">
                    <td className="px-3.5 py-1.5">
                      {MONTHS[period.month - 1]} {period.year}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]",
                          closed
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-50 text-emerald-700",
                        )}
                      >
                        {closed ? (
                          <Lock className="size-3" />
                        ) : (
                          <LockOpen className="size-3" />
                        )}
                        {closed ? "Closed" : "Open"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {period.entry_count}
                    </td>
                    <td className="text-muted-foreground px-3 py-1.5">
                      {period.closed_by ?? ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {!closed &&
                        (confirming ? (
                          <span className="flex items-center justify-end gap-1.5">
                            {/* Closing is not reversible from this screen, so
                                the confirmation says what it will seal rather
                                than asking "are you sure" about a number
                                nobody has been shown. */}
                            <span className="text-muted-foreground text-[11px]">
                              Seal {period.entry_count}{" "}
                              {period.entry_count === 1 ? "entry" : "entries"}?
                            </span>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={close.isPending}
                              onClick={() =>
                                close.mutate({ year: period.year, month: period.month })
                              }
                            >
                              Close
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => setPending(null)}
                            >
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() =>
                              setPending({ year: period.year, month: period.month })
                            }
                          >
                            Close month
                          </Button>
                        ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {close.error !== null && (
            <p className="text-destructive px-3.5 py-2 text-[12px]">
              {close.error instanceof Error ? close.error.message : "could not close"}
            </p>
          )}
        </ScreenBody>
      )}
    </AppShell>
  )
}
