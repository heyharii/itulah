import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { balanceMatrix, financeKeys } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

/// What one family of the client's chart holds, at each of the fourteen
/// locations.
///
/// # Why one screen and not fifteen
///
/// Cash position, bank position, card receivables, inter-unit balances,
/// inventory value, goods in transit, accrued expenses, loans — every one of
/// them is the same question asked of a different subtree: *what is this worth,
/// per location*. The client's codes already carry the tree, so the only thing
/// that differs between those screens is which code they start from.
///
/// Writing fifteen components would mean fifteen places for the money to be
/// formatted slightly differently, and fifteen chances for one of them to
/// quietly stop rolling a subtree up. This is the one.
///
/// # Why the table is dense
///
/// Fourteen locations plus a total is fifteen columns of money. That only fits
/// if the numbers are compact and the chrome is thin — so the location headers
/// are the site ids rather than names, right-aligned tabular figures throughout,
/// and a zero renders as a dash. A grid full of "Rp 0" is a grid nobody can
/// find the real numbers in.
export function PositionScreen({
  family,
  title,
  note,
}: {
  /// Any code in the client's chart. The screen shows one row per account a
  /// rung below it.
  family: string
  title: string
  /// What this screen is and is not, when that needs saying — a balance view of
  /// the asset accounts is not a register of individual assets, and the screen
  /// should not let anyone believe otherwise.
  note?: string
}) {
  const matrix = useQuery({
    queryKey: financeKeys.balances(family),
    queryFn: ({ signal }) => balanceMatrix(family, undefined, signal),
  })

  if (matrix.isPending) {
    return (
      <Frame title={title}>
        <ScreenState>Adding it up…</ScreenState>
      </Frame>
    )
  }
  if (matrix.error !== null) {
    return (
      <Frame title={title}>
        <ScreenState tone="problem">
          {matrix.error instanceof Error ? matrix.error.message : "could not load the balances"}
        </ScreenState>
      </Frame>
    )
  }

  const { rows, locations, column_totals, grand_total_minor, family_name, as_of } = matrix.data
  const moved = rows.some((row) => row.total_minor !== 0)

  return (
    <Frame title={title} subtitle={`${family} · ${family_name}`}>
      {note !== undefined && (
        <p className="text-muted-foreground shrink-0 border-b px-3.5 py-1.5 text-[11.5px]">
          {note}
        </p>
      )}
      {!moved ? (
        <ScreenState>
          Nothing has been posted to {family_name} yet, at any location. These accounts
          exist in the client's chart and are waiting for their first entry.
        </ScreenState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="text-[12.5px]">
            <thead className="bg-card sticky top-0 z-10">
              <tr className="text-muted-foreground text-[10.5px]">
                <th className="bg-card sticky left-0 z-20 border-b px-3 py-1.5 text-left font-medium">
                  Account
                </th>
                {locations.map((site) => (
                  <th
                    key={site}
                    className="border-b px-2 py-1.5 text-right font-mono font-medium"
                  >
                    {/* The site id, not its name. Fourteen names do not fit and
                        the ids are what the codes themselves carry. */}
                    {site === "dc" ? "HO" : site.replace("store-", "C0")}
                  </th>
                ))}
                {/* Pinned right for the same reason the account is pinned
                    left: fifteen money columns will not fit, so the two that
                    frame every row have to stay put while the middle scrolls. */}
                <th className="bg-card sticky right-0 z-20 border-b border-l px-3 py-1.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.account_code} className="hover:bg-muted/40 border-b">
                  <td className="bg-card sticky left-0 z-10 px-3 py-1">
                    <Link
                      to="/finance/ledger"
                      search={{ account: row.account_code }}
                      className="flex items-baseline gap-2 hover:underline"
                    >
                      <span className="text-muted-foreground shrink-0 font-mono text-[10.5px] tabular-nums">
                        {row.account_code}
                      </span>
                      <span className="max-w-72 truncate">{row.name}</span>
                    </Link>
                  </td>
                  {row.cells.map((cell, index) => (
                    <Cell key={locations[index]} value={cell} />
                  ))}
                  <td
                    className={cn(
                      "bg-card sticky right-0 z-10 border-l px-3 py-1 text-right font-mono font-medium tabular-nums",
                      row.total_minor < 0 && "text-amber-700",
                    )}
                  >
                    {row.total_minor === 0 ? "–" : money(row.total_minor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-card sticky bottom-0">
              <tr className="text-[12px] font-medium">
                <td className="bg-card sticky left-0 z-10 border-t px-3 py-1.5">Total</td>
                {column_totals.map((total, index) => (
                  <td
                    key={locations[index]}
                    className="border-t px-2 py-1.5 text-right font-mono tabular-nums"
                  >
                    {total === 0 ? "–" : money(total)}
                  </td>
                ))}
                <td className="bg-card sticky right-0 z-10 border-t border-l px-3 py-1.5 text-right font-mono tabular-nums">
                  {money(grand_total_minor)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="text-muted-foreground px-3 py-2 text-[11px]">
            As at {as_of}. Every figure is summed from the journal on this request —
            nothing here is stored.
          </p>
        </div>
      )}
    </Frame>
  )
}

/// A zero is a dash.
///
/// Most cells in most of these tables are zero — fourteen locations, and a
/// given account is usually live at three of them. Printing "Rp 0" fourteen
/// times a row makes the numbers that matter impossible to find.
function Cell({ value }: { value: number }) {
  return (
    <td
      className={cn(
        "px-2 py-1 text-right font-mono tabular-nums",
        value === 0 && "text-muted-foreground/30",
        value < 0 && "text-amber-700",
      )}
    >
      {value === 0 ? "–" : money(value)}
    </td>
  )
}

function Frame({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title={title} subtitle={subtitle} />
      {children}
    </AppShell>
  )
}
