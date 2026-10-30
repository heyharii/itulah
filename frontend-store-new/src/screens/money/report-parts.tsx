import { Popover } from "@base-ui/react/popover"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { useState } from "react"

import { isoDay } from "@/lib/queries"
import {
  setReportFilters,
  type ReportFilters,
} from "@/lib/queries/money-report"
import { POPUP } from "@/lib/popup-chrome"
import { dateText } from "@/lib/format"
import { cn } from "@/lib/utils"
import { rangeWords } from "@/screens/money/report-model"
import { TD, TH } from "@/screens/money/declaration-words"

/// The pieces Sales, Transactions and Payments share: the one-box date range,
/// the type-to-pick filter, the labelled figure in a footer, and the report
/// table's own cells. Drawn after `store-menu-prototype.html`.

const BOX_CHROME =
  "flex h-10 items-center gap-2 rounded-inner border border-hairline-2 bg-canvas text-[0.9375rem] transition-colors outline-none hover:border-hairline-strong focus-within:border-accent"

// ── Date range ──────────────────────────────────────────────────────────────

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// A window of days in one box ("27 Oct – 29 Oct"). The first day clicked
/// starts the window, the second closes it; clicked in reverse they swap.
export function DayRange({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => new Date(`${from}T00:00:00`))
  const [anchor, setAnchor] = useState<string | null>(null)
  const today = isoDay(new Date())
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate()
  const days = Array.from({ length }, (_, index) =>
    isoDay(new Date(month.getFullYear(), month.getMonth(), index + 1)),
  )

  const pick = (iso: string) => {
    if (anchor === null) {
      setAnchor(iso)
      setReportFilters({ from: iso, to: iso })
      return
    }
    const [lo, hi] = anchor <= iso ? [anchor, iso] : [iso, anchor]
    setReportFilters({ from: lo, to: hi })
    setAnchor(null)
    setOpen(false)
  }
  const step = (by: number) =>
    setMonth((was) => new Date(was.getFullYear(), was.getMonth() + by, 1))

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setAnchor(null)
        if (next) setMonth(new Date(`${from}T00:00:00`))
      }}
    >
      <Popover.Trigger
        aria-label="Period"
        className={cn(
          BOX_CHROME,
          "w-[13.5rem] justify-between pr-3 pl-3.5 text-left text-ink data-[popup-open]:border-accent",
        )}
      >
        <span className="whitespace-nowrap tabular-nums">
          {rangeWords(from, to)}
        </span>
        <CalendarDays className="size-4 shrink-0 text-body" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup className={cn(POPUP, "w-[20.5rem] p-4")}>
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                className="grid size-8 place-items-center rounded-full text-body hover:bg-soft-2"
                onClick={() => step(-1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-[0.9375rem] font-medium text-ink">
                {dateText(month, { month: "long", year: "numeric" })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                className="grid size-8 place-items-center rounded-full text-body hover:bg-soft-2"
                onClick={() => step(1)}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {WEEKDAYS.map((name) => (
                <span
                  key={name}
                  className="grid h-8 place-items-center text-[0.9375rem] text-mute uppercase"
                >
                  {name}
                </span>
              ))}
              {Array.from({ length: lead }, (_, index) => (
                <span key={`gap-${index}`} />
              ))}
              {days.map((iso, index) => {
                const end = iso === from || iso === to
                const mid = iso > from && iso < to
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pick(iso)}
                    className={cn(
                      "grid h-9 place-items-center text-[0.9375rem] tabular-nums transition-colors",
                      end
                        ? "rounded-full bg-accent font-medium text-white"
                        : mid
                          ? "bg-accent-bg text-ink"
                          : "rounded-full text-ink hover:bg-soft-2",
                      iso === today && !end && "font-semibold",
                    )}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[0.9375rem] text-mute">
              {anchor === null ? "Pick the first day" : "Pick the last day"}
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ── Type-to-pick ────────────────────────────────────────────────────────────

/// A filter picked the way procurement picks a supplier: type, a list drops
/// under the box, pick one; the × clears it.
export function PickFilter({
  value,
  options,
  show = (name: string) => name,
  placeholder,
  icon: Icon,
  onChange,
}: {
  value: string | null
  options: readonly { readonly name: string; readonly count: number }[]
  /// How a value reads on screen, when it is stored as a code.
  show?: (name: string) => string
  placeholder: string
  icon: React.ComponentType<{ className?: string }>
  onChange: (next: string | null) => void
}) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const shown = options.filter((one) =>
    show(one.name).toLowerCase().includes(text.trim().toLowerCase()),
  )
  return (
    <div className="relative w-[14rem]">
      <label className={cn(BOX_CHROME, "w-full gap-2 px-3")}>
        <Icon className="size-4 shrink-0 text-body" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-label={placeholder}
          autoComplete="off"
          placeholder={placeholder}
          value={open ? text : value ? show(value) : ""}
          onFocus={() => {
            setText("")
            setOpen(true)
          }}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        {value !== null && (
          <button
            type="button"
            aria-label={`Clear ${placeholder}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(null)}
            className="grid size-6 shrink-0 place-items-center rounded-md text-body hover:bg-soft-2"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>
      {open && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1.5 flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-card border border-hairline bg-canvas p-1.5 shadow-pop"
        >
          {shown.length === 0 && (
            <li className="px-3 py-2.5 text-[0.9375rem] text-mute">
              Nothing found
            </li>
          )}
          {shown.map((one) => (
            <li
              key={one.name}
              role="option"
              aria-selected={one.name === value}
              onMouseDown={(event) => {
                event.preventDefault()
                onChange(one.name)
                setOpen(false)
              }}
              className="flex cursor-pointer justify-between gap-3 rounded-lg px-3 py-2.5 text-[0.9375rem] text-ink hover:bg-soft-2"
            >
              <span>{show(one.name)}</span>
              <span className="text-mute tabular-nums">{one.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Table cells ─────────────────────────────────────────────────────────────

/// The light blue band the foot of a report stands on.
const FOOT_TD =
  "h-[4.25rem] bg-[#eef3fe] px-3 align-top pt-3 text-cell whitespace-nowrap text-ink tabular-nums shadow-[inset_0_1.5px_0_#b9cdf7]"

/// A total with its name over it, so the foot reads on its own once the head
/// has scrolled away.
export function Labelled({
  label,
  children,
  right = false,
}: {
  label: string
  children: React.ReactNode
  right?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-col gap-0.5 leading-tight",
        right && "items-end",
      )}
    >
      <span className="text-[0.9375rem] text-body">{label}</span>
      {children}
    </span>
  )
}

export interface Col {
  readonly id: string
  readonly head: string
  readonly right?: boolean
}

/// The report's table: bordered card, head, body rows from the caller, and a
/// foot of labelled figures. Sized to its content (never an ellipsis on a
/// rupiah); `ruled` draws a rule between every column.
export function ReportTable({
  columns,
  foot,
  sticky = false,
  ruled = false,
  children,
}: {
  columns: readonly Col[]
  /// One labelled figure per column id.
  foot: Readonly<Record<string, React.ReactNode>>
  sticky?: boolean
  ruled?: boolean
  children: React.ReactNode
}) {
  const rule = (index: number) =>
    ruled && index > 0 ? "border-l border-hairline" : ""
  return (
    <div className="overflow-x-auto rounded-card border border-hairline">
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr>
            {columns.map((col, index) => (
              <th
                key={col.id}
                className={cn(TH, rule(index), col.right && "text-right")}
              >
                {col.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        <tfoot className={cn(sticky && "sticky bottom-0 z-[2]")}>
          <tr>
            {columns.map((col, index) => (
              <td
                key={col.id}
                className={cn(FOOT_TD, rule(index), col.right && "text-right")}
              >
                {foot[col.id]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export const Red = ({ children }: { children: React.ReactNode }) => (
  <span className="text-bad-fg">{children}</span>
)

export const Nil = () => <span className="text-faint">—</span>

export const Cell = ({
  right = false,
  rowSpan,
  middle = false,
  ruled = false,
  className,
  children,
}: {
  right?: boolean
  rowSpan?: number
  middle?: boolean
  ruled?: boolean
  className?: string
  children?: React.ReactNode
}) => (
  <td
    rowSpan={rowSpan}
    className={cn(
      TD,
      right && "text-right",
      middle && "align-middle",
      ruled && "border-l border-hairline",
      className,
    )}
  >
    {children}
  </td>
)

/// Period / cashier / payment, one line above a report.
export function FilterBar({
  filters,
  children,
}: {
  filters: ReportFilters
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <DayRange from={filters.from} to={filters.to} />
      {children}
    </div>
  )
}
