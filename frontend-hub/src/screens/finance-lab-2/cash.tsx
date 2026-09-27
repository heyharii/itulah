import { useQuery } from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Select } from "@/components/ui/field"
import { Toolbar } from "@/components/ui/segmented"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { financeKeys, listCashCounts } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { CASH_POTS, useMoneyRows } from "@/screens/finance-lab-2/hooks"
import { Grid, LabNote, Td, Th } from "@/screens/finance-lab-2/parts"
import { useUnitName } from "@/screens/finance/hooks"

/// Every place notes and coins sit, and what the books say each holds.
///
/// Not a mirror of Bank Accounts, and deliberately so: cash has no statement
/// arriving from outside, so there is nothing to model an account, a
/// transaction and a reconciliation against. There is a place, a balance, and
/// the last time a person counted it.
export function Cash() {
  const { rows: all, pending } = useMoneyRows(CASH_POTS)
  const unitName = useUnitName()
  const organisation = useUnits()
  // The same list the Cash Counts screen reads, under its own key: one request
  // for both screens, and no chance of the two disagreeing about when a drawer
  // was last counted.
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, null),
    queryFn: ({ signal }) => listCashCounts(signal),
  })
  const lastCount = useMemo(() => {
    // A count is taken at a site; the drawer is in the books of the unit that
    // owns it.
    const unitOfSite = new Map<string, string>()
    for (const one of organisation.data ?? []) {
      for (const site of one.sites) unitOfSite.set(site.id, one.id)
    }
    const table = new Map<string, { on: string; variance: number }>()
    // Newest first from the server, so the first one seen for a drawer is its
    // latest and nothing needs sorting here.
    for (const count of counts.data ?? []) {
      const unitId = unitOfSite.get(count.site_id)
      if (unitId === undefined) continue
      const key = `${count.account_code}@${unitId}`
      if (!table.has(key)) {
        table.set(key, { on: count.counted_on, variance: count.variance_minor })
      }
    }
    return table
  }, [counts.data, organisation.data])

  /// What narrows the list: which KIND of cash, and where.
  ///
  /// Both are pickers rather than a search box, because both are closed
  /// vocabularies — there are three kinds and fourteen units, and every answer
  /// is on the screen already.
  const [pot, setPot] = useState("")
  const [unit, setUnit] = useState("")

  const units = useMemo(
    () =>
      [...new Set(all.map((row) => row.unit_id))]
        .map((id) => ({ value: id, label: unitName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [all, unitName]
  )

  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (pot === "" || row.pot === pot) &&
          (unit === "" || row.unit_id === unit)
      ),
    [all, pot, unit]
  )
  const narrowed = pot !== "" || unit !== ""

  const held = rows.reduce((sum, row) => sum + row.per_books_minor, 0)

  /// The rows in their kinds, in the order `CASH_POTS` declares them — tills
  /// first, then the float, then petty cash. The server already sorts within a
  /// kind by the chart's own order, so this only gathers.
  const groups = useMemo(
    () =>
      CASH_POTS.map((pot) => ({
        pot,
        rows: rows.filter((row) => row.pot === pot),
      })).filter((group) => group.rows.length > 0),
    [rows]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Cash"
        sub="Tills, floats and petty cash — where the notes are, according to the books."
      />

      <Toolbar className="mb-4">
        <Select
          aria-label="Kind of cash"
          value={pot}
          onChange={setPot}
          className="h-8 w-44"
        >
          <option value="">All cash</option>
          {CASH_POTS.map((one) => (
            <option key={one} value={one}>
              {POT_LABEL[one] ?? one}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Unit"
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
        >
          <option value="">All units</option>
          {units.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </Select>
      </Toolbar>

      {pending ? (
        <LoadingState>Reading where the money sits…</LoadingState>
      ) : rows.length === 0 ? (
        narrowed ? (
          <EmptyState>No cash account matches these filters.</EmptyState>
        ) : (
        <EmptyState>
          No cash account is mapped yet. A place money can sit is a meaning
          bound to an account on the Account map.
        </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right" width="11rem">
                    Book Balance
                  </Th>
                  <Th width="14rem">Last Count</Th>
                </tr>
              </thead>
              <tbody>
                {/* Grouped by what KIND of cash it is, and the kind is a gap
                    between groups rather than a column.

                    It WAS a column — a `Cash` / `Petty cash` pill repeated
                    down thirteen identical rows — beside two more that
                    repeated as hard: the ledger code, which is 1101 on every
                    line, and the unit. Six columns of which three carried no
                    information. The account and the place read as one thing
                    now, because that IS one thing: this money, here. */}
                {groups.map((group, groupIndex) => (
                  <Fragment key={group.pot}>
                    {group.rows.map((row, index) => {
                      // Space above the first row of every group after the
                      // first, rather than an empty `<tr>` — which a screen
                      // reader announces as a row with nothing in it.
                      const gap =
                        groupIndex > 0 && index === 0 ? "pt-5" : undefined
                      const seen = lastCount.get(
                        `${row.account_code}@${row.unit_id}`
                      )
                      return (
                        <tr key={`${row.account_code}-${row.unit_id}`}>
                          <Td className={gap}>
                            {/* The POT, not the ledger account.
                                
                                All three kinds of cash post to `1101 Cash On
                                Hand` in this chart, so naming the account
                                printed the same four words above three groups
                                and made them one undifferentiated list. What
                                tells a till from the float in its own drawer
                                from the petty box at head office is the
                                meaning bound to the account — which is what
                                `pot` is, and what the server computed. */}
                            <span className="text-ink">
                              {POT_LABEL[row.pot] ?? row.account_name} ·{" "}
                              {unitName(row.unit_id)}
                            </span>
                            {row.qualifier !== "" && (
                              <span className="block text-[0.875rem] text-mute">
                                {row.qualifier}
                              </span>
                            )}
                          </Td>
                          <Td align="right" className={gap}>
                            <span className="font-medium text-ink">
                              {money(row.per_books_minor)}
                            </span>
                          </Td>
                          <Td className={gap}>
                            {seen === undefined ? (
                              <span className="text-mute">never counted</span>
                            ) : (
                              <>
                                {/* A count that agreed says only when it
                                    happened. "Agreed" was a word in twelve of
                                    thirteen rows, which is a column repeating
                                    itself — and it made the one row that did
                                    NOT agree harder to find, not easier. The
                                    figure still shows where there is one. */}
                                <span className="text-text">
                                  {day(seen.on)}
                                </span>
                                {seen.variance !== 0 && (
                                  <>
                                    <span className="text-mute"> · </span>
                                    <span className="font-medium text-bad-fg">
                                      {seen.variance > 0 ? "+" : ""}
                                      {money(seen.variance)}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </Td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
                <tr>
                  <Td className="pt-5 text-mute">total</Td>
                  <Td align="right" className="pt-5">
                    <span className="font-semibold text-ink">
                      {money(held)}
                    </span>
                  </Td>
                  <Td className="pt-5" />
                </tr>
              </tbody>
            </Grid>
          </Card>

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

/// The three kinds of cash, as a person says them.
const POT_LABEL: Record<string, string> = {
  CASH: "Cash On Hand",
  PETTY_CASH: "Petty Cash",
  CASHIER_FLOAT: "Cashier Float",
}
