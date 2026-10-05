import { count, money } from "@/lib/format"
import { useStackLabels } from "@/lib/stack-table"
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
        "rounded-card border p-3",
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
          "text-[0.875rem]",
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
            "mt-0.5 text-[0.875rem]",
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

/// A dense table, scrolling inside itself rather than widening the page.
export function Grid({ children }: { children: React.ReactNode }) {
  // Stacks on a phone rather than scrolling sideways (`useStackLabels`).
  const table = useStackLabels()
  return (
    // Framed like a Card when it stands on the page, as every `DataTable`
    // is; inside a Card already, the Card is the frame and this one steps
    // back rather than drawing a second border inside the first.
    <div className="overflow-x-auto rounded-card border border-hairline-2 bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_14px_rgb(0_0_0/0.04)] in-[.rounded-card]:rounded-none in-[.rounded-card]:border-0 in-[.rounded-card]:bg-transparent in-[.rounded-card]:shadow-none">
      <table
        ref={table}
        // Drawn like `DataTable` (Purchase Invoice and the other lists), so a
        // Finance screen never looks like a second product: a tinted heading
        // row, 52px rows, the same padding and the same hover.
        className="mini-stack w-full border-collapse text-cell [&>tbody>tr:last-child>td]:border-b-0 [&>tbody>tr:not([data-total])]:h-[3.75rem] [&>tbody>tr:not([data-total])]:hover:bg-soft"
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
        align === "right" &&
          typeof children === "string" &&
          NEGATIVE_MONEY.test(children) &&
          "text-bad-fg",
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
  return <span className="font-mono text-[0.875rem] text-mute">{children}</span>
}

/// Says plainly what a screen is standing on when it is not standing on an
/// endpoint of its own.
///
/// Kept from `finance-lab-2`, because the alternative — a convincing screen
/// drawn over invented numbers — is the single way a finance prototype
/// misleads the person deciding whether to build it.
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-inner border border-hairline bg-soft px-3 py-2 text-[0.875rem] leading-relaxed text-body">
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
export function DebitCredit({
  debit,
  credit,
}: {
  debit: number
  credit: number
}) {
  return (
    <>
      <Td align="right">
        {debit === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : (
          money(debit)
        )}
      </Td>
      <Td align="right">
        {credit === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : (
          money(credit)
        )}
      </Td>
    </>
  )
}
