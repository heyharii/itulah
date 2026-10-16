import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { financeKeys, listBills } from "@/lib/queries/finance"
import { useSiteLabel } from "@/lib/queries/organisation"
import { Grid, Td, Th } from "@/screens/finance-lab-2/parts"
import { useSupplierName } from "@/screens/finance/hooks"

type Scope = "open" | "overdue" | "paid" | "all"

/// One row per supplier invoice.
///
/// # What a bill is, and is not
///
/// A bill is the invoice a supplier sent and the payable it creates:
///
/// ```text
/// Dr Inventory / Expense   50 jt
/// Cr Supplier Payable      50 jt
/// ```
///
/// No cash moves. Paying it is a PAYMENT, which is a different document in a
/// different module, and the two are kept apart here deliberately — a list
/// that mixed them would answer "what do we owe" and "what did we pay" in one
/// column and neither of them well.
///
/// # Why overdue sorts above everything
///
/// The default is open bills, overdue first, then by due date ascending.
/// That order is the job: the next thing somebody does with this screen is
/// pay whatever is latest, and a list sorted by entry date makes them find it.
export function Bills() {
  const [scope, setScope] = useState<Scope>("open")
  const [needle, setNeedle] = useState("")
  const siteName = useSiteLabel()
  const supplierName = useSupplierName()

  const bills = useQuery({
    // Its own entry under the bills prefix. `financeKeys.bills(null)` holds
    // the ROWS for five other screens (and `useSupplierName`); this one reads
    // the whole page, and sharing the key put a page object where they expect
    // an array — Finance New → Bills, then Finance → Payments, crashed with
    // "object is not iterable". The prefix still catches every invalidation.
    queryKey: [...financeKeys.bills(null), "page"],
    queryFn: ({ signal }) => listBills({}, signal),
  })

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (bills.data?.rows ?? [])
      .filter((row) => {
        if (scope === "open" && row.outstanding_minor === 0) return false
        if (scope === "overdue" && !row.overdue) return false
        if (scope === "paid" && row.outstanding_minor !== 0) return false
        if (text === "") return true
        return [
          row.invoice_number,
          supplierName(row.supplier_id, row.supplier_name),
          siteName(row.site_id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(text)
      })
      .sort((a, b) => {
        // Overdue first, and within it the one that has waited longest.
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
        if (a.overdue && b.overdue) return b.days_overdue - a.days_overdue
        // Then by when it falls due. A bill with no due date agreed sorts
        // last: nothing can be late that was never promised a day.
        if (a.due_date === null) return 1
        if (b.due_date === null) return -1
        return a.due_date.localeCompare(b.due_date)
      })
  }, [bills.data, scope, needle, siteName, supplierName])

  const owed = rows.reduce((sum, row) => sum + row.outstanding_minor, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Expenses &amp; Bills"
        title="Bills"
        sub="What suppliers have invoiced, and what is still owed on it."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "open", label: "Open" },
              { value: "overdue", label: "Overdue" },
              { value: "paid", label: "Paid" },
              { value: "all", label: "All" },
            ]}
          />
          <span className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
            <input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              aria-label="Search bills"
              className="h-8 w-64 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.9375rem] text-ink outline-none placeholder:text-body focus:border-accent"
            />
          </span>
          <Toolbar.Spacer />
          <span className="text-[0.9375rem] text-mute">
            {count(rows.length)} bill(s) · {money(owed)} outstanding
          </span>
        </Toolbar>

        {bills.isPending ? (
          <LoadingState>Reading the bills…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            {scope === "open"
              ? "Nothing is outstanding."
              : "No bill matches this filter."}
          </EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Vendor</Th>
                  <Th width="10rem">Invoice No.</Th>
                  <Th width="7rem">Bill Date</Th>
                  <Th width="7rem">Due Date</Th>
                  <Th align="right" width="9rem">
                    Amount
                  </Th>
                  <Th align="right" width="9rem">
                    Outstanding
                  </Th>
                  <Th width="8rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.invoice_id}>
                    <Td>
                      <span className="text-ink">
                        {supplierName(row.supplier_id, row.supplier_name)}
                      </span>
                      <span className="block text-[0.9375rem] text-mute">
                        {siteName(row.site_id)}
                      </span>
                    </Td>
                    <Td className="font-mono text-[0.9375rem]">
                      {row.invoice_number}
                    </Td>
                    <Td>{day(row.invoice_date)}</Td>
                    <Td>
                      {row.due_date === null ? (
                        <span className="text-mute">—</span>
                      ) : (
                        <span className={row.overdue ? "text-bad-fg" : ""}>
                          {day(row.due_date)}
                        </span>
                      )}
                    </Td>
                    <Td align="right">{money(row.total_minor)}</Td>
                    <Td align="right">
                      {row.outstanding_minor === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        <span className="font-medium text-ink">
                          {money(row.outstanding_minor)}
                        </span>
                      )}
                    </Td>
                    {/* Two facts, one pill: how late it is beats what the
                        document's own status field says. A bill can be
                        POSTED and eleven days overdue, and only one of those
                        is news. */}
                    <Td>
                      {row.overdue ? (
                        <Pill tone="bad">
                          {count(row.days_overdue)} days late
                        </Pill>
                      ) : row.outstanding_minor === 0 ? (
                        <Pill tone="ok">Paid</Pill>
                      ) : (
                        <Pill>{row.payment_state}</Pill>
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
