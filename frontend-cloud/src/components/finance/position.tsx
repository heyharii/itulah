import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { balanceMatrix, financeKeys } from "@/lib/finance"
import { money } from "@/lib/money"
import { dataTableFeatures, type DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { BalanceRow } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

/// What one family of the client's chart holds, at each of the fourteen
/// units.
///
/// # Why one screen and not fifteen
///
/// Cash position, bank position, card receivables, inter-unit balances,
/// inventory value, goods in transit, accrued expenses, loans — every one of
/// them is the same question asked of a different subtree: *what is this worth,
/// per unit*. The client's codes already carry the tree, so the only thing
/// that differs between those screens is which code they start from.
///
/// Writing fifteen components would mean fifteen places for the money to be
/// formatted slightly differently, and fifteen chances for one of them to
/// quietly stop rolling a subtree up. This is the one.
///
/// # Why the table is dense
///
/// Fourteen units plus a total is fifteen columns of money. That only fits
/// if the numbers are compact and the chrome is thin — so the unit headers
/// are the site ids rather than names, right-aligned tabular figures throughout,
/// and a zero renders as a dash. A grid full of "Rp 0" is a grid nobody can
/// find the real numbers in.
///
/// # Why the columns are built rather than written
///
/// The units are data — they come back with the balances, and a screen that
/// hard-coded fourteen of them would be wrong the day the client opens a
/// fifteenth. Building the column list from `units` also buys the thing
/// this screen most wanted and a hand-written table could not give it: every
/// unit sorts. "Which shop is holding the cash" was previously answered by
/// reading fourteen numbers across a row, once per row.
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

  const units = useMemo(() => matrix.data?.units ?? [], [matrix.data])
  const rows = useMemo(() => [...(matrix.data?.rows ?? [])], [matrix.data])
  const columns = useMemo(() => positionColumns(units), [units])

  const [sorting, setSorting] = useState<SortingState>([])
  const table = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: rows,
        columns,
        getRowId: (row: BalanceRow) => row.account_code,
        state: { sorting, pagination: { pageIndex: 0, pageSize: Math.max(1, rows.length) } },
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting],
    ),
  )

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

  const { column_totals, grand_total_minor, family_name, as_of } = matrix.data
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
          Nothing has been posted to {family_name} yet, at any unit. These accounts
          exist in the client's chart and are waiting for their first entry.
        </ScreenState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="text-[12.5px]">
            <thead className="bg-card sticky top-0 z-10">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="text-muted-foreground text-[10.5px]">
                  {group.headers.map((header, index) => (
                    <th
                      key={header.id}
                      className={cn(
                        "border-b px-2 py-1.5 text-right font-medium",
                        // The account is pinned left and the total right for
                        // the same reason: fifteen money columns will not fit,
                        // so the two that frame every row have to stay put
                        // while the middle scrolls.
                        index === 0 && "bg-card sticky left-0 z-20 px-3 text-left",
                        index === group.headers.length - 1 &&
                          "bg-card sticky right-0 z-20 border-l px-3",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40 border-b">
                  {row.getVisibleCells().map((cell, index) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-2 py-1 text-right font-mono tabular-nums",
                        index === 0 && "bg-card sticky left-0 z-10 px-3 text-left font-sans",
                        index === row.getVisibleCells().length - 1 &&
                          "bg-card sticky right-0 z-10 border-l px-3 font-medium",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-card sticky bottom-0">
              <tr className="text-[12px] font-medium">
                <td className="bg-card sticky left-0 z-10 border-t px-3 py-1.5">Total</td>
                {column_totals.map((total, index) => (
                  <td
                    key={units[index]}
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

/// The account, one column per unit, and the row's own total.
///
/// The unit cells read out of `cells` by index rather than by key, because
/// that is how the server sends them: aligned with `units`, so a unit
/// with nothing posted is a zero and not a gap. "No cash at store 07" and "we
/// never asked about store 07" look the same in a sparse map and are very
/// different things to an accountant.
function positionColumns(
  units: readonly string[],
): ColumnDef<DataTableFeatures, BalanceRow>[] {
  return [
    {
      accessorKey: "account_code",
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
      cell: ({ row }) => (
        <Link
          to="/finance/ledger"
          search={{ account: row.original.account_code }}
          className="flex items-baseline gap-2 hover:underline"
        >
          <span className="text-muted-foreground shrink-0 font-mono text-[10.5px] tabular-nums">
            {row.original.account_code}
          </span>
          <span className="max-w-72 truncate">{row.original.name}</span>
        </Link>
      ),
    },
    ...units.map(
      (unit, index): ColumnDef<DataTableFeatures, BalanceRow> => ({
        id: unit,
        // The unit id, not its name. Fourteen names do not fit and the ids are
        // what the codes themselves carry.
        //
        // TODO(0603): this used to read `site === "dc" ? "HO" : …`, naming
        // head office by a literal id, which 0603 forbids — head office is the
        // unit of kind `HO`. This read carries unit ids only, so head office
        // currently renders as its raw id; it needs the unit's `code` (HO,
        // C001…) from a read that carries it, or a `kind` to test against.
        accessorFn: (row: BalanceRow) => row.cells[index] ?? 0,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={unit.replace(/^store-/, "C0")}
            align="end"
            className="font-mono"
          />
        ),
        cell: ({ row }) => <Cell value={row.original.cells[index] ?? 0} />,
      }),
    ),
    {
      accessorKey: "total_minor",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Total" align="end" />
      ),
      cell: ({ row }) => (
        <span className={cn(row.original.total_minor < 0 && "text-amber-700")}>
          {row.original.total_minor === 0 ? "–" : money(row.original.total_minor)}
        </span>
      ),
    },
  ]
}

/// A zero is a dash.
///
/// Most cells in most of these tables are zero — fourteen units, and a
/// given account is usually live at three of them. Printing "Rp 0" fourteen
/// times a row makes the numbers that matter impossible to find.
function Cell({ value }: { value: number }) {
  return (
    <span
      className={cn(
        value === 0 && "text-muted-foreground/30",
        value < 0 && "text-amber-700",
      )}
    >
      {value === 0 ? "–" : money(value)}
    </span>
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
      <ScreenBody>{children}</ScreenBody>
    </AppShell>
  )
}
