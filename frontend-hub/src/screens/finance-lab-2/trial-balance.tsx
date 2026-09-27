import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { count, money } from "@/lib/format"
import { financeKeys, trialBalance } from "@/lib/queries/finance"
import {
  CardRow,
  Grid,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-lab-2/parts"
import { useLocations, useSiteName } from "@/screens/finance/hooks"

/// Every account with a balance, and the proof that they agree.
///
/// # What this screen is for, and what it is not
///
/// It is the one report that can say the books are WRONG. A balance sheet that
/// does not balance still draws; a trial balance whose debits and credits
/// differ is a statement that something is unposted, half-posted or posted
/// twice — so `balanced` is the first thing on the glass, before any account.
///
/// The word on the card is BALANCED, not "agreed". A trial balance is named
/// after the thing it does; "agree" is audit English for the same fact and is
/// the harder of the two to guess. One screen, one word.
///
/// It is not a drill-down. An account whose figure looks wrong is opened on
/// **General Ledger**, which is the screen built for reading postings in order.
export function TrialBalance() {
  const [asOf, setAsOf] = useState(today)
  const [site, setSite] = useState("")
  const [needle, setNeedle] = useState("")
  const [root, setRoot] = useState("")
  const places = useLocations()
  const siteName = useSiteName()

  const units = useMemo(
    () =>
      [
        ...new Set((places.data?.locations ?? []).map((row) => row.site_id)),
      ].sort(),
    [places.data]
  )

  const balance = useQuery({
    queryKey: financeKeys.trialBalance(asOf, site || null),
    queryFn: ({ signal }) =>
      trialBalance(
        { as_of: asOf, site: site || undefined, limit: 500 },
        signal
      ),
  })

  const data = balance.data

  /// Narrowed in the browser, and only the ROWS.
  ///
  /// The totals below come from the server and are figures about the WHOLE
  /// ledger — `trialBalance` says so on its own signature. Recomputing them
  /// from what is on screen would let a search turn an unbalanced ledger into
  /// a balanced-looking one, which is the exact failure this report exists to
  /// catch.
  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (data?.rows ?? []).filter((row) => {
      if (root !== "" && row.root_class !== root) return false
      if (text === "") return true
      return `${row.account_code} ${row.name}`.toLowerCase().includes(text)
    })
  }, [data, needle, root])

  const roots = useMemo(
    () => [...new Set((data?.rows ?? []).map((row) => row.root_class))].sort(),
    [data]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Accounting"
        title="Trial Balance"
        sub="Every account with a balance, and whether the two sides balance."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Day
            value={asOf}
            onChange={setAsOf}
            placeholder="As at"
            label="As at"
            clearable={false}
            className="h-8 w-36"
          />
          <Select
            aria-label="Unit"
            value={site}
            onChange={setSite}
            className="h-8 w-44"
          >
            <option value="">Every location</option>
            {units.map((one) => (
              <option key={one} value={one}>
                {siteName(one)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Class"
            value={root}
            onChange={setRoot}
            className="h-8 w-36"
          >
            <option value="">All classes</option>
            {roots.map((one) => (
              <option key={one} value={one}>
                Class {one}
              </option>
            ))}
          </Select>
          <span className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
            <input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Account code or name"
              aria-label="Search accounts"
              className="h-8 w-56 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink outline-none placeholder:text-body focus:border-accent"
            />
          </span>
        </Toolbar>

        {/* The verdict, before the table. An unbalanced ledger is not a note
            at the bottom of a report; it is the report. */}
        {data !== undefined && !data.balanced && (
          <Banner tone="bad">
            The books do not balance:{" "}
            {money(data.total_debit_minor - data.total_credit_minor)} more on
            one side than the other, across {count(data.ledger_rows)} posting
            line(s). Every statement drawn from these numbers carries the same
            difference.
          </Banner>
        )}

        {data !== undefined && (
          <CardRow>
            <NumberCard label="Total debits" value={data.total_debit_minor} />
            <NumberCard label="Total credits" value={data.total_credit_minor} />
            <NumberCard
              label={data.balanced ? "Balanced" : "Out of balance"}
              value={data.total_debit_minor - data.total_credit_minor}
              tone={data.balanced ? "ok" : "bad"}
              note={`${count(data.ledger_rows)} posting lines`}
            />
          </CardRow>
        )}

        {balance.isPending ? (
          <LoadingState>Reading the books…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            {needle.trim() === "" && root === ""
              ? "Nothing has been posted up to this day."
              : "No account matches this search."}
          </EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th width="9rem">Unit</Th>
                  <Th align="right" width="11rem">
                    Debit
                  </Th>
                  <Th align="right" width="11rem">
                    Credit
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.account_code}@${row.site_id ?? "-"}`}>
                    <Td>
                      <span className="text-ink">{row.name}</span>
                      <span className="ml-2 font-mono text-[0.875rem] text-mute">
                        {row.account_code}
                      </span>
                    </Td>
                    <Td>
                      {row.site_id === null ? (
                        <span className="text-mute">—</span>
                      ) : (
                        siteName(row.site_id)
                      )}
                    </Td>
                    {/* A zero on one side is not a figure, it is the absence of
                        one — drawn muted so the column the eye scans is the
                        side that actually carries the balance. */}
                    <Td align="right">
                      {row.debit_minor === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        money(row.debit_minor)
                      )}
                    </Td>
                    <Td align="right">
                      {row.credit_minor === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        money(row.credit_minor)
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          </Card>
        )}
      </div>
    </PageContent>
  )
}
