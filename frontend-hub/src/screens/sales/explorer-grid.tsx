import type { ExplorerFigures, ExplorerRow } from "@itulah/contract"
import { useMemo } from "react"

import { CardName, PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { LoadMore, type Pageable } from "@/components/ui/states"
import { count, money, moneyCompact, percent, quantity, sku } from "@/lib/format"
import { FOCUSED, openable } from "@/lib/openable"
import { cn } from "@/lib/utils"
import {
  groupLabel,
  marginOf,
  nameParts,
  noStock,
  noun,
  perReceipt,
  receiptsOf,
  rowOpens,
  rowTint,
  shareOf,
  type GroupKey,
  type MatrixColumn,
  type ViewMode,
} from "@/screens/sales/explorer-model"
import type { SalesExplorer } from "@itulah/contract"

/// The results: a table of totals, or the same rows with every store — or every
/// month — beside them, on a desk; one card to a row on a phone. Both read the same figures
/// the same way — Sales over its pieces, Stock over its acquisition cost,
/// Gross profit over its margin — so a row says one thing on every device.
///
/// One scroll box holds the table (both ways: the heading stays at the top, the
/// first column at the left and, per store or per month, the Totals at the
/// right while the columns scroll between them), because a sticky heading and a sticky column are
/// only reliable in the box that scrolls both. The page does not scroll.

export interface GridProps {
  readonly head: SalesExplorer
  readonly rows: readonly ExplorerRow[]
  readonly group: GroupKey
  readonly view: ViewMode
  /// The stores, or the months, laid beside each row when the view is not
  /// Totals (`storeColumns`, `monthColumns`).
  readonly columns: readonly MatrixColumn[]
  /// Each store (or month) against the others in its row.
  readonly heat: boolean
  /// Cost, profit, margin and stock value are not shown to every reader.
  readonly canCost: boolean
  readonly more: Pageable
  readonly onOpen: (row: ExplorerRow) => void
}

const dash = <span className="text-mute">—</span>

/// The groupings whose rows hold articles, and so can say how many.
const COUNTS_ARTICLES: ReadonlySet<GroupKey> = new Set([
  "division",
  "tag",
  "supplier",
])

/// A row's cells by their column: the store's id, or the month.
const byColumn = (row: ExplorerRow) =>
  new Map(row.cells.map((cell) => [cell.site_id, cell.figures]))

/// Compact rupiah, with or without the "Rp" (the narrow per-store columns leave
/// it off), the exact figure in the tooltip.
function Rp({ minor, cur = true }: { minor: number | null; cur?: boolean }) {
  if (minor === null) return dash
  const text = moneyCompact(minor)
  return (
    <span title={money(minor)} className={cn(minor < 0 && "text-bad-fg")}>
      {cur ? text : text.replace(/^(−?)Rp\s?/, "$1")}
    </span>
  )
}

/// A figure over what it is made of: two lines, right-aligned, the second one
/// quiet.
function Two({
  top,
  under,
  strong = false,
  quiet = false,
}: {
  top: React.ReactNode
  under?: React.ReactNode
  strong?: boolean
  quiet?: boolean
}) {
  return (
    <span className="flex flex-col items-end leading-5">
      <span
        className={cn(
          quiet ? "text-mute" : "text-ink",
          strong && "font-semibold"
        )}
      >
        {top}
      </span>
      {under !== undefined && under !== null && under !== "" && (
        <span className="text-[0.9375rem] text-mute">{under}</span>
      )}
    </span>
  )
}

/// What a row sold, over how much of it: pieces, or for a payment method the
/// transactions it settled.
function underSales(f: ExplorerFigures, group: GroupKey): string | null {
  if (group === "payment") {
    const receipts = receiptsOf(f)
    return receipts === null ? null : `${count(receipts)} trans.`
  }
  return quantity(f.qty)
}

function SalesTwo({
  f,
  group,
  strong = false,
  cur = true,
}: {
  f: ExplorerFigures
  group: GroupKey
  strong?: boolean
  cur?: boolean
}) {
  return (
    <Two
      top={<Rp minor={f.sales_minor} cur={cur} />}
      under={underSales(f, group)}
      strong={strong}
    />
  )
}

function StockTwo({
  f,
  canCost,
  strong = false,
  cur = true,
}: {
  f: ExplorerFigures | undefined
  canCost: boolean
  strong?: boolean
  cur?: boolean
}) {
  if (f === undefined || f.stock === null) return dash
  return (
    <Two
      top={quantity(f.stock)}
      under={
        canCost && f.stock_cost_minor !== null ? (
          <Rp minor={f.stock_cost_minor} cur={cur} />
        ) : null
      }
      strong={strong}
    />
  )
}

function ProfitTwo({
  f,
  strong = false,
}: {
  f: ExplorerFigures
  strong?: boolean
}) {
  if (f.profit_minor === null) return dash
  const margin = marginOf(f)
  return (
    <Two
      top={<Rp minor={f.profit_minor} />}
      under={margin === null ? null : percent(margin, { digits: 1 })}
      strong={strong}
    />
  )
}

function Share({ f, total }: { f: ExplorerFigures; total: ExplorerFigures }) {
  const share = shareOf(f, total)
  return (
    <span className="text-mute">
      {share === null ? "—" : percent(share, { digits: 1 })}
    </span>
  )
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

export function DeskGrid(props: GridProps) {
  const { rows, view, more } = props
  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      {view === "totals" ? (
        <TotalsTable {...props} />
      ) : (
        <MatrixTable {...props} />
      )}
      {rows.length > 0 && <LoadMore query={more} />}
    </div>
  )
}

const TABLE = "w-max min-w-full border-separate border-spacing-0 text-cell"
const ROW = "h-[3.75rem]"
const TH =
  "sticky z-[4] h-10 border-b border-hairline bg-soft px-3.5 py-0 text-right text-[0.9375rem] font-medium whitespace-nowrap text-mute"
const TD =
  "border-b border-hairline px-3.5 py-0 text-right align-middle whitespace-nowrap"
const EDGE = "border-l border-l-hairline"
/// The foot of the table: it stays at the bottom while the rows scroll.
const TF =
  "sticky bottom-0 z-[3] border-t border-hairline-2 border-b-0 bg-soft-2 px-3.5 py-0 text-right align-middle whitespace-nowrap"

function NameTh({ group, rowSpan }: { group: GroupKey; rowSpan?: number }) {
  return (
    <th
      rowSpan={rowSpan}
      className={cn(
        TH,
        "top-0 left-0 z-[6] pl-4 text-left",
        rowSpan !== undefined && "align-bottom"
      )}
    >
      {groupLabel(group)}
    </th>
  )
}

/// The name, and under it the quiet line: the code, and whatever else the row
/// says about itself. It stays at the left.
function NameTd({ group, row }: { group: GroupKey; row: ExplorerRow }) {
  const { title, code, sub } = nameParts(group, row)
  // A division, a tag or a supplier says how many articles it holds, when the
  // server was asked to count them.
  const detail =
    sub ??
    (COUNTS_ARTICLES.has(group) && row.figures.articles > 0
      ? `${count(row.figures.articles)} ${noun("article", row.figures.articles)}`
      : null)
  return (
    <td
      className={cn(
        TD,
        "sticky left-0 z-[2] max-w-72 min-w-56 bg-canvas pl-4 text-left whitespace-normal group-hover/row:bg-soft"
      )}
    >
      <span title={row.label} className="block leading-5 font-medium text-ink">
        {title}
      </span>
      {(code !== null || detail !== null) && (
        <span className="block text-[0.9375rem] leading-5 text-mute">
          {code !== null && <span className="font-mono">{sku(code)}</span>}
          {code !== null && detail !== null && " · "}
          {detail}
        </span>
      )}
    </td>
  )
}

function RowShell({
  row,
  group,
  onOpen,
  children,
}: {
  row: ExplorerRow
  group: GroupKey
  onOpen: GridProps["onOpen"]
  children: React.ReactNode
}) {
  const opens = rowOpens(group)
  return (
    <tr
      {...(opens
        ? { onClick: () => onOpen(row), ...openable(() => onOpen(row)) }
        : {})}
      className={cn(
        ROW,
        "group/row transition-colors duration-(--t-hover) hover:bg-soft",
        opens && cn("cursor-pointer", FOCUSED)
      )}
    >
      {children}
    </tr>
  )
}

// -- Totals -----------------------------------------------------------------

function TotalsTable({ head, rows, group, canCost, onOpen }: GridProps) {
  const total = head.total
  if (group === "payment")
    return (
      <table className={TABLE}>
        <thead>
          <tr>
            <NameTh group={group} />
            <th className={cn(TH, "top-0")}>Transactions</th>
            <th className={cn(TH, "top-0")}>Collected</th>
            <th className={cn(TH, "top-0")}>Per transaction</th>
            <th className={cn(TH, "top-0")}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const each = perReceipt(row.figures)
            return (
              <RowShell key={row.key} row={row} group={group} onOpen={onOpen}>
                <NameTd group={group} row={row} />
                <td className={TD}>
                  {receiptsOf(row.figures) === null
                    ? dash
                    : count(receiptsOf(row.figures))}
                </td>
                <td className={cn(TD, "font-semibold text-ink")}>
                  <Rp minor={row.figures.sales_minor} />
                </td>
                <td className={TD}>
                  {each === null ? dash : money(Math.round(each))}
                </td>
                <td className={TD}>
                  <Share f={row.figures} total={total} />
                </td>
              </RowShell>
            )
          })}
        </tbody>
        <tfoot>
          <tr className={ROW}>
            <td
              className={cn(
                TF,
                "left-0 z-[5] pl-4 text-left font-semibold text-ink"
              )}
            >
              Total
            </td>
            <td className={cn(TF, "font-semibold text-ink")}>
              {receiptsOf(total) === null ? dash : count(receiptsOf(total))}
            </td>
            <td className={cn(TF, "font-semibold text-ink")}>
              <Rp minor={total.sales_minor} />
            </td>
            <td className={cn(TF, "font-semibold text-ink")}>
              {perReceipt(total) === null
                ? dash
                : money(Math.round(perReceipt(total) as number))}
            </td>
            <td className={cn(TF, "font-semibold text-ink")}>100%</td>
          </tr>
        </tfoot>
      </table>
    )

  const stock = !noStock(group)
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <NameTh group={group} />
          <th className={cn(TH, "top-0")} title="After discounts and returns">
            Sales
          </th>
          <th className={cn(TH, "top-0")}>Discount</th>
          {canCost && <th className={cn(TH, "top-0")}>Gross profit</th>}
          {stock && <th className={cn(TH, "top-0")}>Stock · Value</th>}
          <th className={cn(TH, "top-0")}>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <RowShell key={row.key} row={row} group={group} onOpen={onOpen}>
            <NameTd group={group} row={row} />
            <td className={TD}>
              <SalesTwo f={row.figures} group={group} strong />
            </td>
            <td className={cn(TD, "text-mute")}>
              <Rp minor={row.figures.discount_minor} />
            </td>
            {canCost && (
              <td className={TD}>
                <ProfitTwo f={row.figures} />
              </td>
            )}
            {stock && (
              <td className={TD}>
                <StockTwo f={row.figures} canCost={canCost} />
              </td>
            )}
            <td className={TD}>
              <Share f={row.figures} total={total} />
            </td>
          </RowShell>
        ))}
      </tbody>
      <tfoot>
        <tr className={ROW}>
          <td
            className={cn(
              TF,
              "left-0 z-[5] pl-4 text-left font-semibold text-ink"
            )}
          >
            Total
          </td>
          <td className={TF}>
            <SalesTwo f={total} group={group} strong />
          </td>
          <td className={cn(TF, "text-ink")}>
            <Rp minor={total.discount_minor} />
          </td>
          {canCost && (
            <td className={TF}>
              <ProfitTwo f={total} strong />
            </td>
          )}
          {stock && (
            <td className={TF}>
              <StockTwo f={total} canCost={canCost} strong />
            </td>
          )}
          <td className={cn(TF, "font-semibold text-ink")}>100%</td>
        </tr>
      </tfoot>
    </table>
  )
}

// -- Per store, per month ---------------------------------------------------

/// Width of each pinned Totals column, so the second can sit exactly beside
/// the first.
const PIN = 132
const PIN_EDGE =
  "border-l border-l-hairline-2 shadow-[-8px_0_10px_-8px_rgb(16_24_40/16%)]"

/// The rows with a column for every store or every month, the Totals pinned at
/// the right. A store says its stock beside its sales; a month holds no stock,
/// so per month a column is its sales alone.
function MatrixTable({
  head,
  rows,
  group,
  view,
  columns,
  heat,
  canCost,
  onOpen,
}: GridProps) {
  const total = head.total
  const stock = !noStock(group)
  const pay = group === "payment"
  const cellStock = stock && view === "stores"
  // The second pinned column: the row's stock, or for a payment method its
  // transactions.
  const second = stock || pay
  // The column totals: the stores', or by month the months' (`store_totals`
  // holds whichever the question was).
  const totals = useMemo(
    () =>
      new Map(head.store_totals.map((cell) => [cell.site_id, cell.figures])),
    [head.store_totals]
  )
  const pinned = (offset: number) => ({ right: offset, minWidth: PIN })
  return (
    <table className={cn(TABLE, "min-w-max")}>
      <thead>
        <tr>
          <NameTh group={group} rowSpan={2} />
          {columns.map((column) => (
            <th
              key={column.id}
              colSpan={cellStock ? 2 : 1}
              title={column.title}
              className={cn(
                TH,
                "top-0 text-center font-medium text-text",
                EDGE
              )}
            >
              {column.head}
            </th>
          ))}
          <th
            colSpan={second ? 2 : 1}
            style={{ right: 0 }}
            className={cn(
              TH,
              "top-0 z-[7] bg-soft text-center text-text",
              PIN_EDGE
            )}
          >
            Totals
          </th>
        </tr>
        <tr>
          {columns.map((column) =>
            cellStock ? (
              <StoreSubheads key={column.id} />
            ) : (
              <th key={column.id} className={cn(TH, "top-10", EDGE)}>
                Sales
              </th>
            )
          )}
          <th
            style={pinned(second ? PIN : 0)}
            className={cn(TH, "top-10 z-[7]", PIN_EDGE)}
          >
            Sales
          </th>
          {second && (
            <th style={pinned(0)} className={cn(TH, "top-10 z-[7]")}>
              {pay ? "Transactions" : "Stock · Value"}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const cells = byColumn(row)
          const tint = heat
            ? rowTint(columns.map((c) => cells.get(c.id)?.sales_minor ?? null))
            : () => undefined
          return (
            <RowShell key={row.key} row={row} group={group} onOpen={onOpen}>
              <NameTd group={group} row={row} />
              {columns.map((column) => {
                const f = cells.get(column.id)
                return (
                  <StoreCells
                    key={column.id}
                    f={f}
                    group={group}
                    stock={cellStock}
                    canCost={canCost}
                    tint={tint(f?.sales_minor ?? null)}
                  />
                )
              })}
              <td
                style={pinned(second ? PIN : 0)}
                className={cn(
                  TD,
                  "sticky z-[2] bg-soft group-hover/row:bg-soft-2",
                  PIN_EDGE
                )}
              >
                <SalesTwo f={row.figures} group={group} strong />
              </td>
              {second && (
                <td
                  style={pinned(0)}
                  className={cn(
                    TD,
                    "sticky z-[2] bg-soft group-hover/row:bg-soft-2"
                  )}
                >
                  {pay ? (
                    receiptsOf(row.figures) === null ? (
                      dash
                    ) : (
                      count(receiptsOf(row.figures))
                    )
                  ) : (
                    <StockTwo f={row.figures} canCost={canCost} />
                  )}
                </td>
              )}
            </RowShell>
          )
        })}
      </tbody>
      <tfoot>
        <tr className={ROW}>
          <td
            className={cn(
              TF,
              "left-0 z-[5] pl-4 text-left font-semibold text-ink"
            )}
          >
            Total
          </td>
          {columns.map((column) => (
            <StoreCells
              key={column.id}
              f={totals.get(column.id)}
              group={group}
              stock={cellStock}
              canCost={canCost}
              foot
            />
          ))}
          <td
            style={pinned(second ? PIN : 0)}
            className={cn(TF, "right-0 z-[5]", PIN_EDGE)}
          >
            <SalesTwo f={total} group={group} strong />
          </td>
          {second && (
            <td style={pinned(0)} className={cn(TF, "z-[5]")}>
              {pay ? (
                receiptsOf(total) === null ? (
                  dash
                ) : (
                  count(receiptsOf(total))
                )
              ) : (
                <StockTwo f={total} canCost={canCost} strong />
              )}
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  )
}

function StoreSubheads() {
  return (
    <>
      <th className={cn(TH, "top-10", EDGE)}>Stock · Value</th>
      <th className={cn(TH, "top-10")}>Sales</th>
    </>
  )
}

/// One store's cells in a row: its stock over what that stock cost, then its
/// sales over their pieces, tinted against the other stores of the row. A
/// month's cell is its sales alone (`stock` off).
function StoreCells({
  f,
  group,
  stock,
  canCost,
  tint,
  foot = false,
}: {
  f: ExplorerFigures | undefined
  group: GroupKey
  stock: boolean
  canCost: boolean
  tint?: string
  foot?: boolean
}) {
  const cell = foot ? TF : TD
  const none = f === undefined || (f.sales_minor === 0 && f.qty === 0)
  return (
    <>
      {stock && (
        <td className={cn(cell, EDGE)}>
          <StockTwo f={f} canCost={canCost} cur={false} />
        </td>
      )}
      <td
        style={tint === undefined ? undefined : { backgroundColor: tint }}
        className={cn(
          cell,
          !stock && EDGE,
          "transition-[background-color] duration-150 ease-out"
        )}
      >
        {none || f === undefined ? (
          dash
        ) : (
          <SalesTwo f={f} group={group} cur={false} />
        )}
      </td>
    </>
  )
}

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

/// One card to a row: the name and what it sold on the first line, a line of
/// what it is made of under it, and — per store or per month — a short list of
/// the stores (or months) that sold it. Nothing scrolls sideways.
export function PhoneGrid({
  head,
  rows,
  group,
  view,
  columns,
  heat,
  canCost,
  more,
  onOpen,
}: GridProps) {
  const total = head.total
  const stock = !noStock(group)
  const opens = rowOpens(group)
  const laidOut = view !== "totals"
  return (
    <>
      <PhoneList>
        {rows.map((row) => {
          const f = row.figures
          const { title, code, sub } = nameParts(group, row)
          const meta = [
            group === "payment"
              ? receiptsOf(f) === null
                ? null
                : `${count(receiptsOf(f))} trans.`
              : quantity(f.qty),
            canCost && group !== "payment" && f.profit_minor !== null
              ? `profit ${moneyCompact(f.profit_minor)}`
              : null,
            stock && f.stock !== null
              ? `stock ${count(f.stock)}${
                  canCost && f.stock_cost_minor !== null
                    ? ` · worth ${moneyCompact(f.stock_cost_minor)}`
                    : ""
                }`
              : null,
          ].filter((part) => part !== null)
          return (
            <PhoneCard
              key={row.key}
              onOpen={opens ? () => onOpen(row) : undefined}
              head={
                <CardName
                  name={title}
                  code={code === null ? undefined : sku(code)}
                  line={[sub, meta.join(" · ")]}
                />
              }
              lead={
                <span className="text-[1rem] font-semibold whitespace-nowrap text-ink tabular-nums">
                  <Rp minor={f.sales_minor} />
                </span>
              }
              body={
                laidOut ? (
                  <ColumnList
                    row={row}
                    group={group}
                    columns={columns}
                    cellStock={stock && view === "stores"}
                    heat={heat}
                    canCost={canCost}
                    word={view === "months" ? "Month" : "Store"}
                  />
                ) : undefined
              }
            />
          )
        })}
      </PhoneList>
      {rows.length > 0 && <LoadMore query={more} />}
      <div className="mt-2.5 flex items-center justify-between rounded-card bg-soft-2 px-4 py-3 font-semibold text-ink tabular-nums">
        <span>Total</span>
        <Rp minor={total.sales_minor} />
      </div>
    </>
  )
}

/// A row at its stores or its months: the column, sales over pieces, and at a
/// store its stock over acquisition, each tinted against the others.
function ColumnList({
  row,
  group,
  columns,
  cellStock,
  heat,
  canCost,
  word,
}: {
  row: ExplorerRow
  group: GroupKey
  columns: readonly MatrixColumn[]
  cellStock: boolean
  heat: boolean
  canCost: boolean
  /// What the first column's head says: Store, or Month.
  word: string
}) {
  const cells = byColumn(row)
  const present = columns.filter((column) => cells.has(column.id))
  const tint = heat
    ? rowTint(columns.map((c) => cells.get(c.id)?.sales_minor ?? null))
    : () => undefined
  if (present.length === 0)
    return <p className="text-[0.9375rem] text-mute">No sales</p>
  const cols = cellStock
    ? "grid-cols-[3.25rem_1fr_1fr]"
    : "grid-cols-[3.25rem_1fr]"
  return (
    <div className="flex flex-col text-[0.9375rem]">
      <div
        className={cn("grid items-center gap-x-2 px-1.5 py-1 text-mute", cols)}
      >
        <span>{word}</span>
        <span className="text-right">Sales</span>
        {cellStock && <span className="text-right">Stock · Value</span>}
      </div>
      {present.map((column) => {
        const f = cells.get(column.id)
        if (f === undefined) return null
        return (
          <div
            key={column.id}
            style={{ backgroundColor: tint(f.sales_minor) }}
            className={cn(
              "grid items-center gap-x-2 rounded-inner px-1.5 py-1 transition-[background-color] duration-150 ease-out",
              cols
            )}
          >
            <span className="text-mute" title={column.title}>
              {column.head}
            </span>
            <SalesTwo f={f} group={group} />
            {cellStock && <StockTwo f={f} canCost={canCost} />}
          </div>
        )
      })}
    </div>
  )
}
