import { Popover } from "@base-ui/react/popover"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { useRef, useState } from "react"

import { dateOf, monthGrid, today, WEEKDAYS } from "@/lib/calendar"
import { readRange, untilText } from "@/lib/day-parse"
import { POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"

/// A window of days in one box: "01 Oct – 15 Oct".
///
/// `Day`'s sibling, for the questions that are asked as a range — issued
/// between, due between. One box rather than two because the two ends are one
/// thought, and because the calendar can then do what two boxes cannot: show
/// the stretch between them.
///
/// **Typed or clicked.** "15/10 - 30/10", "besok - akhir bulan", "minggu ini",
/// "bulan depan", "kuartal 4", "7 hari terakhir", or one day
/// ("jumat", which is that day alone). In the panel, the first day clicked is
/// taken at once as the start — the list narrows to "from here" straight
/// away — and the second closes the window; clicking the earlier of the two
/// the other way round swaps them. Either end may be left open, so a range
/// can read "from 1 Oct" or "until 15 Oct".
///
/// Values are ISO days, `""` for an open end.
export interface DayWindow {
  readonly from: string
  readonly to: string
}

/// What was typed, as a window — or null when no day can be read in it.
/// "minggu ini", "bulan depan", "kuartal 4", "1-5 okt" and "15/10 - 30/10"
/// are all read by `readRange`.
function readWindow(text: string, reference: string): DayWindow | null {
  return readRange(text, reference)
}

/// How many days a window spans, both ends counted.
function lengthOf(window: DayWindow): number {
  return (
    Math.round(
      (dateOf(window.to).getTime() - dateOf(window.from).getTime()) / 86_400_000
    ) + 1
  )
}

function short(iso: string, withYear: boolean): string {
  return dateOf(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  })
}

/// The box's words: both ends, one end, or nothing. The year is left off while
/// everything stated is this year, because "01 Oct 2026 – 15 Oct 2026" is
/// twice as wide as the question.
function said(value: DayWindow): string {
  const thisYear = String(new Date().getFullYear())
  const withYear = [value.from, value.to].some(
    (one) => one !== "" && !one.startsWith(thisYear)
  )
  if (value.from !== "" && value.to !== "")
    return value.from === value.to
      ? short(value.from, withYear)
      : `${short(value.from, withYear)} – ${short(value.to, withYear)}`
  if (value.from !== "") return `From ${short(value.from, withYear)}`
  if (value.to !== "") return `Until ${short(value.to, withYear)}`
  return ""
}

function longDay(iso: string): string {
  return dateOf(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export function DayRange({
  value,
  onChange,
  label,
  placeholder,
  className,
  quiet = false,
}: {
  value: DayWindow
  onChange: (value: DayWindow) => void
  /// For the screen reader; the visible label is beside the box.
  label?: string
  /// What the box says while no day is chosen.
  placeholder?: string
  className?: string
  /// A toolbar control: set, it takes the accent look of an active filter.
  quiet?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() =>
    dateOf(value.from !== "" ? value.from : today())
  )
  const [typed, setTyped] = useState("")
  /// The first day clicked, while the second is still to come.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const typeBox = useRef<HTMLInputElement>(null)
  const now = today()
  const grid = monthGrid(month.getFullYear(), month.getMonth())
  const set = value.from !== "" || value.to !== ""

  const read = typed.trim() === "" ? null : readWindow(typed, now)

  const changeOpen = (next: boolean, seed = "") => {
    setOpen(next)
    setTyped(seed)
    setAnchor(null)
    setHover(null)
    if (next) {
      setMonth(dateOf(value.from !== "" ? value.from : today()))
      if (seed !== "") typing(seed)
    }
  }

  const typing = (next: string) => {
    setTyped(next)
    const found = next.trim() === "" ? null : readWindow(next, now)
    if (found !== null) setMonth(dateOf(found.from))
  }

  const take = (next: DayWindow) => {
    onChange(next)
    changeOpen(false)
  }

  const click = (iso: string) => {
    if (anchor === null) {
      // The start narrows the list at once; the end is still to choose.
      setAnchor(iso)
      onChange({ from: iso, to: "" })
      return
    }
    take(anchor <= iso ? { from: anchor, to: iso } : { from: iso, to: anchor })
  }

  // What the grid lights: the chosen window, or — mid-click — from the anchor
  // to wherever the pointer is.
  const [lo, hi] =
    anchor !== null
      ? [
          anchor <= (hover ?? anchor) ? anchor : (hover ?? anchor),
          anchor <= (hover ?? anchor) ? (hover ?? anchor) : anchor,
        ]
      : [value.from, value.to !== "" ? value.to : value.from]

  const step = (by: number) =>
    setMonth((was) => new Date(was.getFullYear(), was.getMonth() + by, 1))

  return (
    <Popover.Root open={open} onOpenChange={(next) => changeOpen(next)}>
      <span className={cn("relative flex w-full items-center", className)}>
        <Popover.Trigger
          aria-label={label}
          onKeyDown={(event) => {
            if (
              open ||
              event.key.length !== 1 ||
              event.key === " " ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey
            )
              return
            event.preventDefault()
            changeOpen(true, event.key)
          }}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas pl-3 text-left text-[0.875rem] transition-colors outline-none",
            "hover:border-hairline-strong focus-visible:border-accent data-[popup-open]:border-accent",
            set ? "pr-14" : "pr-9",
            quiet && set && "border-accent/40 bg-accent-bg",
            className
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              set ? (quiet ? "text-accent" : "text-ink") : "text-mute"
            )}
          >
            {set ? said(value) : (placeholder ?? "")}
          </span>
          <CalendarDays className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
        </Popover.Trigger>
        {set && (
          <button
            type="button"
            aria-label={`Clear ${label ?? "dates"}`}
            className="absolute right-8 grid size-5 place-items-center rounded-full text-line-ico transition-colors hover:bg-hairline hover:text-ink"
            onClick={() => onChange({ from: "", to: "" })}
          >
            <X className="size-3.5" />
          </button>
        )}
      </span>

      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup
            initialFocus={typeBox}
            className={cn(POPUP, "w-[20.5rem] p-4")}
          >
            <input
              ref={typeBox}
              value={typed}
              onChange={(event) => typing(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                if (read !== null) take(read)
              }}
              aria-label={`Type ${label ?? "a range of days"}`}
              aria-invalid={typed.trim() !== "" && read === null}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-inner border border-hairline-2 bg-canvas px-2.5 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute focus:border-accent aria-[invalid=true]:border-bad"
            />
            {typed.trim() !== "" && (
              <p
                aria-live="polite"
                className={cn(
                  "mt-2 min-h-5 px-0.5 text-[0.875rem]",
                  read === null ? "text-bad" : "text-body"
                )}
              >
                {read === null ? (
                  "Not a day this can read."
                ) : (
                  <>
                    {read.from === read.to
                      ? longDay(read.from)
                      : `${longDay(read.from)} – ${longDay(read.to)}`}
                    <span className="text-mute">
                      {" "}
                      ·{" "}
                      {read.from === read.to
                        ? untilText(read.from, now)
                        : `${lengthOf(read)} days, starting ${untilText(read.from, now)}`}{" "}
                      — Enter to take it
                    </span>
                  </>
                )}
              </p>
            )}

            <div className="mt-4 mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                className="grid size-8 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                onClick={() => step(-1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-[0.875rem] font-medium text-ink">
                {month.toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                className="grid size-8 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                onClick={() => step(1)}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div
              className="grid grid-cols-7 gap-y-1"
              onPointerLeave={() => setHover(null)}
            >
              {WEEKDAYS.map((name) => (
                <span
                  key={name}
                  className="grid h-8 place-items-center font-mono text-eyebrow tracking-[0.04em] text-mute uppercase"
                >
                  {name.slice(0, 1)}
                </span>
              ))}
              {grid.map((iso) => {
                const inMonth = dateOf(iso).getMonth() === month.getMonth()
                const end = iso === lo || iso === hi
                const between = lo !== "" && iso > lo && iso < hi
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => click(iso)}
                    onPointerEnter={() => setHover(iso)}
                    className={cn(
                      "grid h-9 place-items-center text-[0.875rem] tabular-nums transition-colors",
                      end
                        ? "rounded-full bg-ink font-medium text-white"
                        : between
                          ? "bg-soft-2 text-ink"
                          : cn(
                              "rounded-full hover:bg-soft-2 hover:text-ink",
                              iso === now && "font-semibold text-accent",
                              !inMonth && iso !== now && "text-faint",
                              inMonth && iso !== now && "text-text"
                            )
                    )}
                  >
                    {dateOf(iso).getDate()}
                  </button>
                )
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
