import {
  isValidElement,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { CellMoney } from "@/components/ui/rows-switch"
import { count, money } from "@/lib/format"
import { useStackLabels } from "@/lib/stack-table"
import {
  useCompactRows,
  useRegisterRowsTable,
  useRowsOffered,
} from "@/lib/table-rows"
import { cn } from "@/lib/utils"

/// The pieces every screen in Finance final shares.
///
/// Two rules hold this module together visually, and both are borrowed rather
/// than invented:
///
/// 1. **Tables are ERPNext-dense.** Hairline rules, no zebra, numbers right and
///    tabular, headings small and muted. The house `DataTable` is built for
///    faceted lists with a filter omnibox — a different job from a ledger,
///    where the reader is scanning a column of figures for the one that is
///    wrong. `finance-lab-2` arrived at the same grid for the same reason; this
///    is that grid, kept identical on purpose so the two never drift.
/// 2. **A missing figure is not zero.** `—` and `Rp 0` are different claims,
///    and a finance screen that renders them the same has told a lie about a
///    period nobody has posted to yet.
///
/// Controls that already exist — `UnitSelect`, `SiteSelect`, `UnitName`,
/// `SiteName`, `AsOfControl`, `WindowControl`, `AccountPicker`,
/// `AccountAndCategory`, `SupplierPicker` — are imported from
/// `@/screens/finance/parts` rather than copied. They are the unit and site
/// dimensions' controls, and a second copy would be a second opinion about
/// what a unit or a site is.
///
/// `AccountAndCategory` matters most of them. An account and the category
/// its family asks for are one answer, not two fields, and a screen here that
/// drew its own pair would be a screen that can post a line the database
/// refuses.

/// One of the figures above a table.
export function NumberCard({
  label,
  value,
  note,
  tone,
  unit = "money",
}: {
  label: string
  value: number | null
  note?: React.ReactNode
  tone?: "bad" | "ok" | "warn"
  /// "count" for a number of things — periods, bills — not rupiah.
  unit?: "money" | "count"
}) {
  return (
    <div
      className={cn(
        "number-card rounded-card border p-3",
        tone === "bad"
          ? "border-bad-fg/25 bg-bad-bg"
          : tone === "warn"
            ? "border-warn-fg/25 bg-warn-bg"
            : tone === "ok"
              ? "border-ok-fg/25 bg-ok-bg"
              : "border-hairline bg-canvas"
      )}
    >
      <div
        className={cn(
          "text-[0.9375rem]",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "warn"
              ? "text-warn-fg"
              : tone === "ok"
                ? "text-ok-fg"
                : "text-mute"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[1.1875rem] font-semibold tabular-nums",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "warn"
              ? "text-warn-fg"
              : tone === "ok"
                ? "text-ok-fg"
                : "text-ink"
        )}
      >
        {value === null ? "—" : unit === "count" ? count(value) : money(value)}
      </div>
      {note !== undefined && (
        <div
          className={cn(
            "mt-0.5 text-[0.9375rem]",
            tone === "bad"
              ? "text-bad-fg"
              : tone === "warn"
                ? "text-warn-fg"
                : "text-mute"
          )}
        >
          {note}
        </div>
      )}
    </div>
  )
}

/// The row those cards sit in. Three across on a wide screen, stacked on a
/// phone — the hub is one UI for desk, tablet and handset.
export function CardRow({
  children,
  columns = 3,
}: {
  children: React.ReactNode
  columns?: 2 | 3 | 4
}) {
  return (
    <div
      className={cn(
        "grid gap-2.5",
        columns === 2
          ? "sm:grid-cols-2"
          : columns === 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-2 lg:grid-cols-3"
      )}
    >
      {children}
    </div>
  )
}

/// A column hidden by its place in the row. Child selectors only, so the table
/// a row opens inside itself is left alone; a row with `data-sub` is a band
/// across the table and has no columns to lose. A row that closes the table
/// (`TotalRow`) says one cell for each column, never a `colSpan`, so the
/// columns still line up when some are gone.
const GIVEN_UP: Readonly<Record<number, string>> = {
  2: "[&>thead>tr>:nth-child(2)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(2)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(2)]:hidden",
  3: "[&>thead>tr>:nth-child(3)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(3)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(3)]:hidden",
  4: "[&>thead>tr>:nth-child(4)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(4)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(4)]:hidden",
  5: "[&>thead>tr>:nth-child(5)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(5)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(5)]:hidden",
  6: "[&>thead>tr>:nth-child(6)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(6)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(6)]:hidden",
  7: "[&>thead>tr>:nth-child(7)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(7)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(7)]:hidden",
  8: "[&>thead>tr>:nth-child(8)]:hidden [&>tbody>tr:not([data-sub])>:nth-child(8)]:hidden [&>tfoot>tr:not([data-sub])>:nth-child(8)]:hidden",
}

/// A dense table, scrolling inside itself rather than widening the page.
///
/// `followRows`: the table answers the Rows switch (`lib/table-rows.ts`) —
/// 38px rows and 12px cell sides in Compact, and the switch is offered on the
/// page. Left off, the table stays as it was drawn.
///
/// `giveUp`: the columns (counted from 2) that step out of a compact table
/// short of room, the first listed going first, until it fits the card
/// instead of scrolling sideways — what `DataTable` does with `meta.priority`.
/// A pair in the list (`[2, 3]`) goes as one step, for two columns that mean
/// nothing apart, such as a debit and its credit.
export function Grid({
  children,
  followRows,
  giveUp,
}: {
  children: React.ReactNode
  followRows?: boolean
  giveUp?: readonly (number | readonly number[])[]
}) {
  // Stacks on a phone rather than scrolling sideways (`useStackLabels`).
  const table = useStackLabels()
  const rows = useCompactRows()
  const offered = useRowsOffered()
  useRegisterRowsTable(followRows === true && offered)
  const compact = followRows === true && rows
  /// How wide the card is, and how many columns have been given up to fit
  /// it; counted again whenever the card is another width.
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  const [budget, setBudget] = useState({ room: 0, gone: 0 })
  const steps = compact ? (giveUp ?? []) : []
  const gone = budget.room === room ? budget.gone : 0
  useEffect(() => {
    const node = box.current
    if (!node || steps.length === 0) return
    const watch = new ResizeObserver((entries) =>
      setRoom(entries[0].contentRect.width)
    )
    watch.observe(node)
    return () => watch.disconnect()
  }, [steps.length])
  useLayoutEffect(() => {
    const node = box.current
    if (!node || steps.length === 0) return
    if (node.scrollWidth > node.clientWidth + 1 && gone < steps.length)
      setBudget({ room, gone: gone + 1 })
  })
  return (
    // Framed like a Card when it stands on the page, as every `DataTable`
    // is; inside a Card already, the Card is the frame and this one steps
    // back rather than drawing a second border inside the first.
    <div
      ref={box}
      className="overflow-x-auto rounded-card border border-hairline-2 bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_14px_rgb(0_0_0/0.04)] in-[.rounded-card]:rounded-none in-[.rounded-card]:border-0 in-[.rounded-card]:bg-transparent in-[.rounded-card]:shadow-none"
    >
      <table
        ref={table}
        // Drawn like `DataTable` (Purchase Invoice and the other lists), so a
        // Finance screen never looks like a second product: a tinted heading
        // row, 52px rows, the same padding and the same hover.
        className={cn(
          "mini-stack w-full border-collapse text-cell [&>tbody>tr:last-child>td]:border-b-0 [&>tbody>tr:not([data-total])]:hover:bg-soft",
          // Compact, as `DataTable`'s `dt-compact`: 38px rows, 12px sides, a
          // 36px heading, the face still 15px. `grid-compact` is for a cell
          // of prose to say `in-[.grid-compact]:whitespace-normal`.
          compact
            ? "grid-compact [&_td]:px-3 [&_td]:py-2 [&_td]:leading-5 [&_th]:h-9 [&_th]:px-3 [&>tbody>tr:not([data-total])]:h-[2.375rem] [&>tbody>tr[data-total]]:h-[2.375rem] [&>tfoot>tr]:h-[2.375rem]"
            : "[&>tbody>tr:not([data-total])]:h-[3.75rem]",
          steps
            .slice(0, gone)
            .flatMap((step) => (typeof step === "number" ? [step] : step))
            .map((column) => GIVEN_UP[column])
        )}
      >
        {children}
      </table>
    </div>
  )
}

export function Th({
  children,
  align,
  width,
}: {
  children?: React.ReactNode
  align?: "right" | "center"
  width?: string
}) {
  return (
    <th
      style={width === undefined ? undefined : { width }}
      className={cn(
        "h-12 border-b border-hairline-2 bg-soft px-4 py-0 text-eyebrow font-medium whitespace-nowrap text-body normal-case",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left"
      )}
    >
      {children}
    </th>
  )
}

const NEGATIVE_MONEY = /^(-|\(|−)\s?Rp/

/// A right-hand cell that holds an amount below zero: a printed "-Rp …", or a
/// `CellMoney`, which a compact table prints without the "Rp" to match on.
function isNegativeMoney(children: React.ReactNode): boolean {
  if (typeof children === "string") return NEGATIVE_MONEY.test(children)
  return (
    isValidElement<{ minor?: number | null }>(children) &&
    children.type === CellMoney &&
    typeof children.props.minor === "number" &&
    children.props.minor < 0
  )
}

export function Td({
  children,
  align,
  className,
  /// Spanning a whole row, for the band that opens a section inside a table.
  ///
  /// A report with two halves — payable above, receivable below — is one table
  /// and not two, because two tables cannot be relied on to put "31–60" at the
  /// same x twice, and a reader comparing the halves is doing it with their
  /// eye down a column.
  colSpan,
}: {
  children?: React.ReactNode
  align?: "right" | "center"
  className?: string
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        // One line per cell, as in `DataTable`: a number or a date broken
        // over two lines is a row twice the height for nothing. A cell of
        // prose says `whitespace-normal`; a cell that should give way says
        // `max-w-0` and truncates.
        "border-b border-hairline px-4 py-3 align-middle whitespace-nowrap text-text",
        align === "right"
          ? "text-right tabular-nums"
          : align === "center"
            ? "text-center"
            : "text-left",
        // A negative amount in the right-hand columns is red: a loss, a
        // credit balance or an outflow is the thing the eye is looking for in
        // a column of figures, and "-Rp" is easy to read past.
        align === "right" && isNegativeMoney(children) && "text-bad-fg",
        className
      )}
    >
      {children}
    </td>
  )
}

/// The last row of a ledger table: the one the reader checks the others add up
/// to. Heavier rule above it, no rule below — it ends the table.
export function TotalRow({ children }: { children: React.ReactNode }) {
  return (
    <tr
      data-total
      className="h-14 border-t border-hairline-strong bg-soft [&>td]:border-b-0 [&>td]:py-0 [&>td]:font-medium [&>td]:whitespace-nowrap [&>td]:text-ink [&>td]:tabular-nums"
    >
      {children}
    </tr>
  )
}

/// An account code, printed the way a code should be: monospaced, quiet, and
/// never the widest thing in its cell.
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.9375rem] text-mute">{children}</span>
  )
}

/// Says plainly what a screen is standing on when it is not standing on an
/// endpoint of its own.
///
/// Kept from `finance-lab-2`, because the alternative — a convincing screen
/// drawn over invented numbers — is the single way a finance prototype
/// misleads the person deciding whether to build it.
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-inner border border-hairline bg-soft px-3 py-2 text-[0.9375rem] leading-relaxed text-body">
      {children}
    </p>
  )
}

/// A debit/credit pair, drawn so the eye can find the side that is empty.
///
/// Zero is rendered as nothing at all on the side that is not used, which is
/// how every journal on paper has ever been printed and how ERPNext prints it
/// too. Rendering `0.00` in both columns doubles the ink and halves the
/// reader's ability to see which way an entry went.
///
/// `followRows`: the figures are bare in a compact table (`Grid`).
export function DebitCredit({
  debit,
  credit,
  followRows,
}: {
  debit: number
  credit: number
  followRows?: boolean
}) {
  return (
    <>
      <Td align="right">
        {debit === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : followRows === true ? (
          <CellMoney minor={debit} />
        ) : (
          money(debit)
        )}
      </Td>
      <Td align="right">
        {credit === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : followRows === true ? (
          <CellMoney minor={credit} />
        ) : (
          money(credit)
        )}
      </Td>
    </>
  )
}

/// The window a report reads, while the boxes above it are still being worked.
///
/// The boxes answer at once; the report trails them (`useDeferredValue`), and
/// the figures in hand stay on screen, dimmed, until the next are read. A
/// window the boxes cannot make sense of — a date emptied, an end before the
/// start — asks for nothing new: the read stays on the window the page opened
/// on, and `valid` tells the screen to say so instead of drawing it.
///
/// A suspended read hands a refused request to the route's error page, so
/// nothing malformed may reach one; this is where the dates are kept sane.
export function useAskedWindow(range: { from: string; to: string }): {
  from: string
  to: string
  valid: boolean
  /// The boxes are ahead of what is drawn.
  stale: boolean
} {
  const [opened] = useState(() => ({ from: range.from, to: range.to }))
  const valid = range.from !== "" && range.to !== "" && range.from <= range.to
  const wantedFrom = valid ? range.from : opened.from
  const wantedTo = valid ? range.to : opened.to
  const from = useDeferredValue(wantedFrom)
  const to = useDeferredValue(wantedTo)
  return { from, to, valid, stale: from !== wantedFrom || to !== wantedTo }
}
