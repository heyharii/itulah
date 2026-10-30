import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { CashColumn } from "@/lib/queries/money-declaration"
import { TD, TH, BOX } from "@/screens/money/declaration-words"
import { money, units } from "@itulah/contract/money"

/// The pieces the Money declaration's list, run and sheets share.

/// A white capsule: the button that opens a detail (Receipts, Deposits,
/// Print). Blue stays for the actions.
export function Capsule({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-[1.875rem] rounded-full px-3.5 pointer-coarse:h-10",
        className,
      )}
      {...props}
    />
  )
}

/// A figure in the foot's rail: the label over the figure, grey; red and
/// tinted when it is not level.
export function Tile({
  label,
  figure,
  sub,
  bad = false,
  pressed,
  onClick,
}: {
  label: React.ReactNode
  figure: React.ReactNode
  sub?: React.ReactNode
  bad?: boolean
  /// Makes the tile a filter: pressed is the one in force.
  pressed?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="text-meta text-body">{label}</span>
      <b
        className={cn(
          "text-[1.5rem] leading-[1.875rem] font-semibold tabular-nums",
          bad ? "text-bad-fg" : "text-ink",
        )}
      >
        {figure}
      </b>
      {sub !== undefined && (
        <span className="text-meta text-body tabular-nums">{sub}</span>
      )}
    </>
  )
  const style = cn(
    "flex w-full flex-col items-start gap-0.5 rounded-card border px-4 py-2.5 text-left",
    bad ? "border-bad-fg/30 bg-bad-bg" : "border-transparent bg-soft",
  )
  if (onClick === undefined) return <div className={style}>{body}</div>
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        style,
        "transition-[scale,box-shadow] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
        pressed && "border-accent shadow-[inset_0_0_0_1px_var(--accent)]",
      )}
    >
      {body}
    </button>
  )
}

/// The checkout pattern: the table on the left, a rail on the right with the
/// figures stacked and the one button under them. On a phone the rail goes
/// under the table.
export function Checkout({
  table,
  rail,
}: {
  table: React.ReactNode
  rail: React.ReactNode
}) {
  return (
    // The rail runs the sheet's full height behind a hairline, its figures and
    // Submit held at the bottom, beside where the eye ends the table.
    <div className="grid gap-6 md:min-h-full md:grid-cols-[minmax(0,1fr)_16.25rem]">
      <div className="min-w-0">{table}</div>
      <div className="flex flex-col justify-end md:border-l md:border-hairline md:pl-6">
        <div className="flex flex-col gap-3 md:sticky md:bottom-0">{rail}</div>
      </div>
    </div>
  )
}

/// The cashier's cash as a matrix: a row per denomination, a column for the
/// closing and for each temporary deposit, their total when there is more than
/// one, and the admin's count at the far right when the admin counts.
export function CashMatrix({
  columns,
  rows,
  admin,
}: {
  columns: readonly CashColumn[]
  rows: readonly number[]
  /// The admin's pieces by denomination (as typed) and how they change.
  admin?: {
    readonly value: Readonly<Record<number, string>>
    readonly onChange: (value: number, text: string) => void
  }
}) {
  const many = columns.length > 1
  const total = (value: number) =>
    columns.reduce((sum, column) => sum + (column.pieces[value] ?? 0), 0)
  const typed = (value: number) =>
    Number((admin?.value[value] ?? "").replace(/\D/g, "")) || 0
  const adminAmount = rows.reduce((sum, value) => sum + value * typed(value), 0)
  const pcs = (n: number) =>
    n === 0 ? <span className="text-faint">—</span> : units(n)
  return (
    <div className={BOX}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>Note</th>
            {columns.map((column) => (
              <th key={column.label} className={cn(TH, "text-right")}>
                {column.label}
                <div className="text-meta font-normal text-mute">
                  {column.at}
                </div>
              </th>
            ))}
            {many && <th className={cn(TH, "bg-soft-2 text-right")}>Total</th>}
            {admin !== undefined && (
              <th className={cn(TH, "border-l border-hairline text-right")}>
                Admin
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((value) => {
            const off =
              admin !== undefined &&
              (admin.value[value] ?? "") !== "" &&
              typed(value) !== total(value)
            return (
              <tr key={value}>
                <td className={TD}>{money(value)}</td>
                {columns.map((column) => (
                  <td key={column.label} className={cn(TD, "text-right")}>
                    {pcs(column.pieces[value] ?? 0)}
                  </td>
                ))}
                {many && (
                  <td
                    className={cn(
                      TD,
                      "bg-soft text-right font-medium text-ink",
                    )}
                  >
                    {pcs(total(value))}
                  </td>
                )}
                {admin !== undefined && (
                  <td
                    className={cn(TD, "w-40 border-l border-hairline py-1.5")}
                  >
                    <input
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Admin count of ${money(value)}`}
                      value={admin.value[value] ?? ""}
                      onChange={(event) =>
                        admin.onChange(
                          value,
                          event.target.value.replace(/\D/g, ""),
                        )
                      }
                      className={cn(
                        "h-11 w-full rounded-inner border bg-canvas px-3 text-right text-[1.125rem] font-semibold tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/30",
                        off
                          ? "border-bad-fg text-bad-fg"
                          : "border-hairline-2 text-ink",
                      )}
                    />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={cn(TD, "border-b-0 font-semibold text-ink")}>
              Amount
            </td>
            {columns.map((column) => (
              <td
                key={column.label}
                className={cn(
                  TD,
                  "border-b-0 text-right font-semibold text-ink",
                )}
              >
                {money(column.amount)}
              </td>
            ))}
            {many && (
              <td
                className={cn(
                  TD,
                  "border-b-0 bg-soft text-right font-semibold text-ink",
                )}
              >
                {money(columns.reduce((sum, column) => sum + column.amount, 0))}
              </td>
            )}
            {admin !== undefined && (
              <td
                className={cn(
                  TD,
                  "border-b-0 border-l border-hairline text-right font-semibold text-ink",
                )}
              >
                {money(adminAmount)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/// A segmented choice in a table cell. Hovering says what the cashier picked;
/// a choice that differs from it is outlined orange.
export function Seg<T extends string>({
  label,
  options,
  current,
  was,
  onPick,
}: {
  label: string
  options: readonly (readonly [T, string])[]
  current: T | undefined
  /// What the cashier picked; undefined when the node did not record it.
  was: T | undefined
  onPick: (value: T) => void
}) {
  const moved = current !== undefined && current !== was
  const said = options.find((one) => one[0] === was)?.[1] ?? "Not recorded"
  return (
    <div
      role="radiogroup"
      aria-label={label}
      title={`Cashier picked: ${said}`}
      className={cn(
        "inline-flex rounded-inner bg-soft-2 p-0.5",
        moved && "shadow-[0_0_0_2px_var(--warn-fg)]",
      )}
    >
      {options.map(([value, text]) => {
        const on = current === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(value)}
            className={cn(
              "h-8 rounded-[0.375rem] px-2.5 text-meta font-medium whitespace-nowrap transition-colors duration-(--t-hover)",
              on ? "bg-accent text-white" : "text-body hover:text-ink",
            )}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}
