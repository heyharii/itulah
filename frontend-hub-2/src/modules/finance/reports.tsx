import { BarChart3 } from "lucide-react"
import type { Statement } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, day, rp, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import {
  asPresented,
  ladderLevel,
  periodResult,
} from "@/modules/finance/chart"
import { DayField, SitePicker } from "@/modules/finance/parts"

/// The two statements — the balance sheet and the profit and loss — built from
/// the client's own root classes and printed in their own words.
///
/// ## Why the presentation flips the sign and the ledger does not
///
/// Every figure arrives as the ledger holds it: **debits positive**. That is the
/// honest storage — a balance does not know whether it is about to be printed on
/// a page where liabilities read as positive numbers. A statement does know.
/// Liabilities, equity and income are credit-natured, so they arrive negative
/// and are shown flipped here. Doing it on the server would mean the same number
/// came back differently depending on which screen asked, which is how two
/// reports end up disagreeing about a figure they both got right. See
/// `chart.ts`.
///
/// ## Why "out of balance" is the server's number and not a subtraction here
///
/// A page that subtracted its own visible rows would report "balanced" about a
/// list it had not finished loading. `out_of_balance_minor` is assets minus
/// liabilities, equity **and** the period's result, and zero is the only correct
/// answer.
///
/// ## Why a balance sheet carries a result at all
///
/// Classes 1, 2 and 3 alone do not balance, and that is not a fault: profit
/// earned and not yet closed to equity is sitting in the income and expense
/// classes. The client keeps a line for it — `3013001003 Laba (Rugi) bulan
/// berjalan` — and `result_minor` is that figure, measured inception to date.
///
/// ## What is deliberately not here
///
/// **The per-location spread.** The app this replaces could break a balance
/// sheet out by shop and descend through the code ladder, and it did so from a
/// different endpoint — `GET /finance/balances`, which answers with the
/// IMMEDIATE CHILDREN of one family and nothing below them. It is a second
/// report with its own navigation, its own state and its own three reads, and
/// folding it into a tab of this one is how a screen ends up being two screens
/// wearing one name. It is a screen to write, not a control to add.
///
/// **A chart.** There is no chart component in this app's kit, and a statement
/// is read by walking it. The bars in the old screen ranked five classes that
/// are already five rows in reading order.

const KINDS = [
  { value: "BALANCE_SHEET", label: "Balance sheet" },
  { value: "PROFIT_LOSS", label: "Profit and loss" },
] as const

/// One row of the printed statement.
///
/// A local view type and not a wire one: `section` rows do not exist on the
/// wire — a `StatementSection` is a heading with a total and a list under it,
/// and a single flat table is what lets one set of columns, one virtual window
/// and one summary line serve both reports. Marked as a kind rather than
/// inferred from `depth === 0`, because the client's ladder starts at 1 and a
/// depth test would be a second place the ladder is written down.
interface StatementRow {
  readonly id: string
  readonly heading: boolean
  readonly code: string
  readonly name: string
  readonly indent: number
  readonly group: boolean
  /// Already flipped for presentation — see `asPresented`.
  readonly presented: number
}

export function ReportsScreen() {
  const url = useQueryState()
  const kind = url.one("kind") || "BALANCE_SHEET"
  const asOf = url.one("as_at") || today()
  const from = url.one("from")
  const to = url.one("to")
  const site = url.one("site")
  const isPL = kind === "PROFIT_LOSS"

  // A balance sheet sends only its as-at date. `from` is what makes a statement
  // a period report and a balance sheet is not one — sending one would ask the
  // server for the movement in a window on accounts whose whole meaning is a
  // position.
  //
  // A profit and loss with no `from` is answered as the year so far, and the
  // server echoes the window it chose — which is what the scope line below
  // reads, so the sentence on the page is the server's window and never a guess
  // about what the server did with a blank box.
  const report = useReport<Statement>({
    key: ["finance", "statement"],
    path: "/api/v1/finance/statement",
    params: {
      kind,
      from: isPL ? from || null : null,
      to: isPL ? to || null : asOf,
      site: site || null,
    },
  })

  const data = report.data
  const result = periodResult(data?.result_minor ?? 0)

  // Flattened in the server's own order: sections in class order, lines within
  // a section in code order. Nothing is sorted here and no header offers to —
  // a statement read out of its own order is not a statement.
  const rows: StatementRow[] = []
  for (const section of data?.sections ?? []) {
    rows.push({
      id: `section:${section.root_class}`,
      heading: true,
      code: section.root_class,
      name: section.title,
      indent: 0,
      group: true,
      presented: asPresented(section.total_minor, section.root_class),
    })
    for (const line of section.lines) {
      rows.push({
        id: `${section.root_class}:${line.account_code}`,
        heading: false,
        code: line.account_code,
        name: line.name,
        // One rung in from the section heading above it, so the class and its
        // accounts are not the same column of text.
        indent: ladderLevel(line.depth) + 1,
        group: line.is_group,
        presented: asPresented(line.amount_minor, section.root_class),
      })
    }
  }

  const columns: ColumnDef<TableSetup, StatementRow>[] = [
    {
      id: "line",
      header: "Line",
      size: 72,
      meta: { icon: <BarChart3 className="size-[15px]" />, min: 280 },
      cell: ({ row }) => {
        const line = row.original
        return (
          <span
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: `${line.indent * 1.125}rem` }}
          >
            <span
              className={
                line.heading
                  ? "text-ink min-w-0 truncate font-semibold"
                  : line.group
                    ? "text-ink min-w-0 truncate font-medium"
                    : "text-ink-2 min-w-0 truncate"
              }
            >
              {line.name}
            </span>
            <span className="text-label text-ink-4 shrink-0 font-mono">
              {line.code}
            </span>
          </span>
        )
      },
    },
    {
      id: "amount",
      header: "Amount",
      size: 28,
      meta: { align: "right", min: 150 },
      cell: ({ row }) => {
        const line = row.original
        return (
          <span
            className={
              line.heading
                ? "text-ink font-semibold tabular-nums"
                : line.presented === 0
                  ? "text-ink-4 tabular-nums"
                  : "text-ink-2 tabular-nums"
            }
          >
            {line.presented === 0 ? "—" : amount(line.presented)}
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="General Ledger &amp; Closing"
        title="Reports"
        description="The balance sheet and the profit and loss, from the client's own root classes and their own words."
      />

      {/* Two different datasets, not two slices of one — the columns mean
          different things on each, and a balance sheet stands on a day while a
          profit and loss covers a window. That is a tab, not a filter. */}
      <Tabs
        label="Statement"
        value={kind}
        onChange={(value) => url.set({ kind: value }, false)}
        tabs={KINDS.map((row) => ({ value: row.value, label: row.label }))}
      />

      <ScopeLine
        scope={
          isPL
            ? {
                kind: "during",
                // The server's own window, echoed back — not the two boxes in
                // the toolbar, which are empty until somebody sets them.
                period:
                  data === undefined
                    ? "the period the server chose"
                    : `${data.from === null ? "the beginning" : day(data.from)} — ${day(data.to)}`,
              }
            : { kind: "asAt", date: data?.to ?? asOf }
        }
        unit={site || undefined}
        note={
          isPL ? "movements over the window" : "positions, not movements"
        }
      />

      <Tiles>
        {/* One tile per section, each of them the SERVER's own total for that
            class, flipped for presentation and nothing else. A balance sheet
            has three and a profit and loss five, so the row is never more than
            the five a reader can hold. */}
        {(data?.sections ?? []).map((section) => (
          <Tile
            key={section.root_class}
            // The client's own name for the class, straight off the wire —
            // `StatementSection.title` is read from their chart rather than
            // from a translation table here.
            label={section.title}
            value={asPresented(section.total_minor, section.root_class)}
            note={`class ${section.root_class} · ${count(section.lines.length)} lines`}
          />
        ))}
        {!isPL && data !== undefined && (
          <Tile
            label={result.label}
            value={result.minor}
            tone={result.loss ? "bad" : "ok"}
            note="classes 4–8 netted, inception to date"
          />
        )}
      </Tiles>

      <Toolbar trailing={report.isFetching ? "Loading…" : undefined}>
        {isPL ? (
          <>
            <DayField
              label="From"
              value={from}
              max={today()}
              onChange={(value) => url.set({ from: value || null })}
            />
            <DayField
              label="To"
              value={to}
              max={today()}
              onChange={(value) => url.set({ to: value || null })}
            />
          </>
        ) : (
          <DayField
            label="As at"
            value={asOf}
            max={today()}
            onChange={(value) =>
              url.set({ as_at: value === today() ? null : value })
            }
          />
        )}
        <SitePicker
          value={site}
          onChange={(value) => url.set({ site: value || null }, false)}
        />
      </Toolbar>

      {report.isError ? (
        <Failed
          what="the statement"
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : report.isPending ? (
        <Loading cols={2} />
      ) : rows.length === 0 ? (
        <Empty
          what="lines on this statement"
          detail="Nothing has been posted in this window, so there is nothing to draw."
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption={
            isPL
              ? `Profit and loss ${data?.from ?? ""} to ${data?.to ?? ""}`
              : `Balance sheet as at ${data?.to ?? asOf}`
          }
          foot={{
            // The one figure each report ends on, in the one place a summary
            // line belongs. Both are the server's: `result_minor` is computed
            // from `journal_line` rather than by adding the sections up, so a
            // bug in the tree-rolling shows as a disagreement instead of hiding
            // inside the figure that should catch it.
            line: isPL ? (
              <>
                <b className="text-ink">{result.label}</b> · income less costs
              </>
            ) : (data?.out_of_balance_minor ?? 0) === 0 ? (
              <>
                <b className="text-ok-ink">Balanced</b> · assets less
                liabilities, equity and the result
              </>
            ) : (
              <>
                <b className="text-bad-ink">Out of balance</b> · assets less
                liabilities, equity and the result
              </>
            ),
            amount: isPL ? (
              <b className={result.loss ? "text-bad-ink" : "text-ink"}>
                {rp(result.minor)}
              </b>
            ) : (data?.out_of_balance_minor ?? 0) === 0 ? (
              <b className="text-ok-ink">{rp(0)}</b>
            ) : (
              <b className="text-bad-ink">
                {rp(data?.out_of_balance_minor ?? 0)}
              </b>
            ),
          }}
        />
      )}
    </div>
  )
}
