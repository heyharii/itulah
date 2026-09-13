import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, moment, money } from "@/lib/format"
import { analyticsKeys, salesWindow } from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useWindow } from "@/screens/finance/hooks"
import { LocationSelect, SiteName, WindowControl } from "@/screens/finance/parts"

/// Every sale as a row, with what it posted to.
///
/// The last of the Reports group, built to the family rules Profit & Loss
/// settled — same toolbar order, same cards above the table, same total rules,
/// one `TotalRow` at the foot. Read that file's opening comment for the four.
/// A register has no tree to indent, which is the only rule it does not use.
///
/// # The unit is a filter here too, as of 2026-09-14
///
/// This report used to insist on a unit. `GET /reports/sales/window` had
/// `site_id` as a REQUIRED field and refused with `missing field site_id`, so
/// a register was one shop at a time and there was no consolidated receipt
/// list to draw. That was the one place in the module where the unit was not
/// an optional server filter, and it has been fixed on the server: the field
/// is optional and an absent one means every unit, exactly like every other
/// finance endpoint. An empty select is now the whole chain.
///
/// `GET /api/v1/sales` does answer across every unit, and it is not a way out:
/// it takes `site_id`, `status` and `limit` and **no dates at all**. Narrowing
/// its answer to the window in the toolbar would mean cutting a wider answer up
/// in the browser, which is exactly what this module's one rule about the unit
/// dimension forbids. The register therefore stands on the windowed endpoint
/// alone, and says so.
///
/// # Why two of ERPNext's columns are empty here, and why they are still drawn
///
/// ERPNext's Sales Register prints Customer and — through a column per income
/// account used in the period — what each invoice posted to. Both are named in
/// this table and both are `—`, because drawing the shape honestly is worth
/// more than hiding the gap:
///
///  * **Customer.** Filled as of 2026-09-14. It used to be a field the
///    database had and the endpoint dropped: selected for the detail read and
///    absent from this one. Most rows are still a dash, because a walk-in is
///    not a member — that is the sale, not the wire.
///  * **Income account.** Sales reach the general ledger as of 2026-09-14:
///    `SALE_DAY` posts one entry per unit per trading day, crediting
///    `4010110001 Penjualan Barang Dagangan`. But the entry is per DAY, so no
///    row here owns one, and the column says which rung the posting happens on
///    rather than naming a voucher that does not exist per sale. Note what it
///    credits: the GROSS. Nothing splits the output tax into a liability,
///    because no tax meaning is mapped — so the ledger recognises more revenue
///    than the till's own net, and the Sales screen says so on its face.
export function SalesRegister() {
  const range = useWindow()
  const [site, setSite] = useState("")

  const register = useQuery({
    queryKey: analyticsKeys.window(site, range.from, range.to),
    queryFn: ({ signal }) =>
      salesWindow({ siteId: site, from: range.from, to: range.to }, signal),
    // No `enabled` guard: an empty select is a legitimate question now — the
    // whole chain — and guarding it left the page saying "loading" forever
    // about a request nobody had sent. That guard was right while the endpoint
    // refused a missing `site_id`; it stopped being right when the field
    // became optional on 2026-09-14.
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Reports"
        title="Sales Register"
        sub="Every sale as a row, with what it posted to."
      />

      <Toolbar>
        <WindowControl range={range} />
        <LocationSelect
          value={site}
          onChange={setSite}
          emptyLabel="Every location"
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box left blank and a
            date box filled with today look identical to a reader; this
            sentence is what tells them which report they are looking at. */}
        <span className="text-[0.71875rem] text-mute">
          {range.chip}
          {site === "" ? (
            " · every unit"
          ) : (
            <>
              {" · "}
              <SiteName id={site} />
            </>
          )}
        </span>
      </Toolbar>

      {(
        queryState(register, {
          loading: "Reading the receipts…",
          render: (takings) => {
            const sales = takings.sales
            return (
              <div className="flex flex-col gap-4">
                <CardRow columns={4}>
                  <NumberCard
                    label="Net"
                    value={sales.net_minor}
                    note="Before tax, over the whole window"
                  />
                  <NumberCard
                    label="Tax"
                    value={sales.tax_minor}
                    note="What the receipts charged"
                  />
                  <NumberCard
                    label="Total"
                    value={sales.gross_minor}
                    note={`${count(sales.count)} completed sales, averaging ${money(sales.average_minor)}`}
                  />
                  <NumberCard
                    label="Refunds"
                    value={takings.returns.refund_total_minor}
                    note={`${count(takings.returns.count)} returns in the window`}
                  />
                </CardRow>

                {takings.transactions.length === 0 ? (
                  <EmptyState>
                    This shop rang up nothing in this window. Nothing to
                    register, which is a fact about the window rather than a
                    fault.
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="11rem">Date</Th>
                        <Th width="14rem">Document</Th>
                        <Th width="10rem">Customer</Th>
                        <Th width="9rem">Unit</Th>
                        <Th width="10rem">Mode of payment</Th>
                        <Th align="right" width="9rem">
                          Net
                        </Th>
                        <Th align="right" width="8rem">
                          Tax
                        </Th>
                        <Th align="right" width="9rem">
                          Total
                        </Th>
                        <Th width="12rem">Income account</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {takings.transactions.map((sale) => (
                        <tr key={sale.id}>
                          <Td>{moment(sale.completed_at)}</Td>
                          <Td>
                            <Code>{sale.sale_number}</Code>
                          </Td>
                          {/* `customer_id` reaches the wire as of
                              2026-09-14; it used to be selected for the detail
                              read and dropped from this one. Most sales have
                              none — a walk-in is not a member — and that is a
                              fact about the sale, so it draws as a dash. */}
                          <Td>
                            {sale.customer_id === null ? (
                              <span className="text-faint">—</span>
                            ) : (
                              <Code>{sale.customer_id}</Code>
                            )}
                          </Td>
                          {/* The ROW's unit, not the window's. While this
                              report insisted on one shop they were the same
                              string; now that an empty select means the whole
                              chain, `takings.site_id` is the filter that was
                              asked for — null — and every row would have
                              claimed to belong to the same place. */}
                          <Td>
                            <SiteName id={sale.site_id} />
                          </Td>
                          <Td>
                            {sale.methods.length === 0 ? (
                              <span className="text-faint">—</span>
                            ) : (
                              sale.methods.join(" + ")
                            )}
                          </Td>
                          <Td align="right">{money(sale.net_minor)}</Td>
                          <Td align="right">{money(sale.tax_minor)}</Td>
                          <Td align="right">{money(sale.total_minor)}</Td>
                          {/* Sales DO reach the ledger as of 2026-09-14 —
                              `SALE_DAY` posts one entry per unit per trading
                              day — but the posting is per DAY, not per sale, so
                              no row here can name an entry of its own. What it
                              can name is the account every sale in a posted day
                              lands in. A day nobody has posted shows nothing,
                              which is the honest difference between the two. */}
                          <Td>
                            <span className="text-mute">
                              per day, not per sale
                            </span>
                          </Td>
                        </tr>
                      ))}

                      {/* The window's totals, not the list's. `sales/window`
                          adds up over the whole span and caps the receipts it
                          returns, so a truncated list still foots to a true
                          figure — which is the only reason truncating it is
                          tolerable at all. */}
                      <TotalRow>
                        <Td>Window total</Td>
                        <Td>
                          <span className="font-normal text-mute">
                            {count(sales.count)} sales
                          </span>
                        </Td>
                        <Td />
                        <Td />
                        <Td />
                        <Td align="right">{money(sales.net_minor)}</Td>
                        <Td align="right">{money(sales.tax_minor)}</Td>
                        <Td align="right">{money(sales.gross_minor)}</Td>
                        <Td />
                      </TotalRow>
                    </tbody>
                  </Grid>
                )}

                {takings.transactions_truncated && (
                  <Note>
                    <b>
                      The list stops at {count(takings.transactions_limit)}{" "}
                      receipts; {count(sales.count)} were rung up.
                    </b>{" "}
                    The totals above and below are over the whole window
                    regardless — the server adds them up before it cuts the
                    list — so the foot of this table is right even though the
                    rows above it are not all of them. Narrow the dates to see
                    the rest.
                  </Note>
                )}

                {sales.voided_count > 0 && (
                  <Note>
                    {count(sales.voided_count)} sales were voided in this window
                    and are not rows here.{" "}
                    <code className="font-mono text-[0.6875rem]">
                      sales/window
                    </code>{" "}
                    counts them and lists only completed receipts, which is the
                    right register — a void is not a sale — but it does mean
                    this page cannot show you <i>which</i> ones.
                  </Note>
                )}

                <Note>
                  <b>Two columns are drawn empty, and neither is guesswork.</b>{" "}
                  <b>Customer:</b>{" "}
                  <code className="font-mono text-[0.6875rem]">
                    sale.customer_id
                  </code>{" "}
                  is on the record — the till fills it in when a member signs in
                  — but neither{" "}
                  <code className="font-mono text-[0.6875rem]">
                    GET /reports/sales/window
                  </code>{" "}
                  nor{" "}
                  <code className="font-mono text-[0.6875rem]">
                    GET /sales
                  </code>{" "}
                  puts it on the wire. <b>Income account:</b> no sale has ever
                  reached the general ledger.{" "}
                  <code className="font-mono text-[0.6875rem]">
                    journal_entry.source_kind
                  </code>{" "}
                  reserves{" "}
                  <code className="font-mono text-[0.6875rem]">SALE_DAY</code>{" "}
                  for exactly this posting and nothing writes one, so there is
                  no account for a receipt to have landed in — and that is the
                  same reason Profit &amp; Loss shows nothing under class 4
                  PENDAPATAN. Until a sales posting exists, what the till took
                  and what the books earned are two different questions with one
                  answer between them.
                </Note>

                <Note>
                  <b>One unit at a time, and that is the endpoint's rule rather
                  than this page's.</b>{" "}
                  <code className="font-mono text-[0.6875rem]">
                    GET /reports/sales/window
                  </code>{" "}
                  requires{" "}
                  <code className="font-mono text-[0.6875rem]">site_id</code>,
                  so unlike every other report here the unit is not an optional
                  filter.{" "}
                  <code className="font-mono text-[0.6875rem]">
                    GET /api/v1/sales
                  </code>{" "}
                  does answer across every unit, but it takes no dates at all —
                  only{" "}
                  <code className="font-mono text-[0.6875rem]">site_id</code>,{" "}
                  <code className="font-mono text-[0.6875rem]">status</code> and{" "}
                  <code className="font-mono text-[0.6875rem]">limit</code> — so
                  a register over a window cannot stand on it without cutting a
                  wider answer up in the browser. A chain-wide receipt register
                  needs the windowed endpoint to take an optional{" "}
                  <code className="font-mono text-[0.6875rem]">site_id</code>,
                  or the list endpoint to take a window.
                </Note>
              </div>
            )
          },
        })
      )}
    </PageContent>
  )
}
