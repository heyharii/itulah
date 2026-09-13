import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { financeKeys, listCashCounts } from "@/lib/queries/finance"
import { CASH_POTS, useMoneyRows } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"
import { useSiteName } from "@/screens/finance/hooks"

/// Every place notes and coins sit, and what the books say each holds.
///
/// Not a mirror of Bank Accounts, and deliberately so: cash has no statement
/// arriving from outside, so there is nothing to model an account, a
/// transaction and a reconciliation against. There is a place, a balance, and
/// the last time a person counted it.
export function Cash() {
  const { rows, pending } = useMoneyRows(CASH_POTS)
  const siteName = useSiteName()
  // The same list the Cash Counts screen reads, under its own key: one request
  // for both screens, and no chance of the two disagreeing about when a drawer
  // was last counted.
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, null),
    queryFn: ({ signal }) => listCashCounts(signal),
  })
  const lastCount = useMemo(() => {
    const table = new Map<string, { on: string; variance: number }>()
    // Newest first from the server, so the first one seen for a drawer is its
    // latest and nothing needs sorting here.
    for (const count of counts.data ?? []) {
      const key = `${count.account_code}@${count.site_id}`
      if (!table.has(key)) {
        table.set(key, { on: count.counted_on, variance: count.variance_minor })
      }
    }
    return table
  }, [counts.data])

  const held = rows.reduce((sum, row) => sum + row.per_books_minor, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Cash"
        sub="Tills, floats and petty cash — where the notes are, according to the books."
      />

      {pending ? (
        <LoadingState>Reading where the money sits…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState>
          No cash account is mapped yet. A place money can sit is a meaning
          bound to an account on the Account map.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Grid>
            <thead>
              <tr>
                <Th>Place</Th>
                <Th width="9rem">Type</Th>
                <Th width="10rem">Location</Th>
                <Th width="9rem">Ledger</Th>
                <Th align="right" width="9rem">
                  Balance per books
                </Th>
                <Th width="10rem">Last count</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.account_code}-${row.site_id}`}>
                  <Td>
                    <span className="font-medium text-ink">
                      {row.account_name}
                    </span>
                    {row.qualifier !== "" && (
                      <span className="block text-[0.65625rem] text-mute">
                        {row.qualifier}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Pill>{POT_LABEL[row.pot] ?? row.pot}</Pill>
                  </Td>
                  <Td>{siteName(row.site_id)}</Td>
                  <Td className="font-mono text-[0.6875rem] text-mute">
                    {row.account_code}
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-ink">
                      {money(row.per_books_minor)}
                    </span>
                  </Td>
                  <Td>
                    {(() => {
                      const seen = lastCount.get(
                        `${row.account_code}@${row.site_id}`
                      )
                      if (seen === undefined) {
                        return <span className="text-mute">never counted</span>
                      }
                      return (
                        <>
                          {day(seen.on)}{" "}
                          {seen.variance === 0 ? (
                            <Pill tone="ok">agreed</Pill>
                          ) : (
                            <span className="text-bad-fg">
                              {seen.variance > 0 ? "+" : ""}
                              {money(seen.variance)}
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </Td>
                </tr>
              ))}
              <tr>
                <Td />
                <Td />
                <Td />
                <Td className="text-mute">total</Td>
                <Td align="right">
                  <span className="font-semibold text-ink">{money(held)}</span>
                </Td>
                <Td />
              </tr>
            </tbody>
          </Grid>

          <LabNote>
            <b>Last count</b> is the column this screen exists to make somebody
            look at: a drawer whose last count says &ldquo;never&rdquo; is a
            drawer nothing has ever contradicted. Counting one is done on{" "}
            <b>Cash Counts</b>.
          </LabNote>
        </div>
      )}
    </PageContent>
  )
}

const POT_LABEL: Record<string, string> = {
  CASH: "Cash",
  PETTY_CASH: "Petty cash",
  CASHIER_FLOAT: "Cashier float",
}
