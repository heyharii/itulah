import { Popover } from "@base-ui/react/popover"
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react"
import { useMemo, useState } from "react"

import { POPUP } from "@/lib/filter-chrome"
import { dateOf, monthGrid, startOfDay, today, WEEKDAYS } from "@/lib/calendar"
import { day } from "@/lib/format"
import { cn } from "@/lib/utils"

/// A day, chosen off a calendar this app draws.
///
/// Not `<input type="date">`, for the reason `<Select>` is not a native
/// `<select>`: the panel belongs to the operating system. The same form is a
/// Mac's calendar bubble here and three little spinners on Windows, in that
/// platform's own date order — and nothing in this kit can reach either one.
/// It was written for the Commercial composer and promoted the day somebody
/// counted how many other screens were asking for a day: forty-three boxes
/// across twenty files, every one of them drawn by a machine we do not own.
///
/// A DAY, never an instant. `type="datetime-local"` asked for a minute on
/// every question that only wanted a date, and a promotion has never once
/// started at 14:32. Where an instant is genuinely meant — a price book coming
/// into force — that is still its own control's problem, not this one's.
export function Day({
  value,
  onChange,
  placeholder = "Any day",
  presets,
  notBefore,
  notAfter,
  onBlur,
  label,
  disabled,
  className,
}: {
  /// An ISO day, `yyyy-mm-dd`, in the local calendar. `""` is unanswered —
  /// the same emptiness `<Select>` and `<Money>` take, and the same one every
  /// `type="date"` box this replaces already held.
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /// The two or three answers people actually give, one press each.
  presets?: readonly { readonly label: string; readonly value: string }[]
  /// Days before this one are drawn dead. The end of a window passes the
  /// start, so a window cannot be closed before it opens.
  notBefore?: string | null
  /// And days after it, for the other end of the same window. Both, because a
  /// window has two ends and the boxes this replaces carried `min` and `max`.
  notAfter?: string | null
  /// For the form libraries that count a field as touched only once it has
  /// been left. There is no blur to hand on: the trigger is a button and the
  /// calendar is a popover, so "left it" means the panel shut.
  onBlur?: () => void
  /// For the screen reader, when the visible label is a table header rather
  /// than a `<Field>`. Inside a `<Field>` the wrapping `<label>` already names
  /// the trigger, so most callers leave this alone.
  label?: string
  /// A day that cannot be asked for at all — a PKWTT has no end date, and a
  /// dead box says so better than a box that takes an answer nobody wants.
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() =>
    dateOf(value === "" ? today() : value)
  )
  const now = today()
  const grid = useMemo(
    () => monthGrid(month.getFullYear(), month.getMonth()),
    [month]
  )

  const step = (by: number) =>
    setMonth((was) => new Date(was.getFullYear(), was.getMonth() + by, 1))

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Opening lands on the month being edited, not on wherever the last
        // visit left the calendar.
        if (next) setMonth(dateOf(value === "" ? today() : value))
        else onBlur?.()
      }}
    >
      {/* Clearing is a decision and gets its own control — but BESIDE the
          trigger, never inside it: a button nested in a button is announced as
          two controls and activated as one. */}
      <span className={cn("relative flex w-full items-center", className)}>
        <Popover.Trigger
          aria-label={label}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-full border border-transparent bg-soft-2 pl-3.5 text-left text-[0.84375rem] transition-colors outline-none",
            "hover:border-hairline-2 hover:bg-soft-3",
            "disabled:opacity-50",
            value === "" ? "pr-9" : "pr-14",
            // The caller's classes reach BOTH boxes. A toolbar asks for `h-8`
            // and `w-40`; the height belongs to the control and the width to
            // the space it stands in, and a caller should not have to know
            // which of the two elements is which.
            className
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              value ? "text-ink" : "text-mute"
            )}
          >
            {value === "" ? placeholder : day(startOfDay(value))}
          </span>
          <ChevronDown className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
        </Popover.Trigger>
        {value !== "" && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="absolute right-8 grid size-5 place-items-center rounded-full text-line-ico transition-colors hover:bg-hairline hover:text-ink"
            onClick={() => onChange("")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </span>

      <Popover.Portal>
        {/* `z-50` on the POSITIONER, which is where `<Select>` and `<PickOne>`
            put theirs and where this one did not. A calendar opened from a
            field inside a `<Sheet>` — the sheet's panel is `z-40` — was
            rendered, positioned and interactive, and painted UNDER the sheet:
            clicking a day worked, and nobody could see the day they were
            clicking. The popup's own `z-50` does not save it, because it is
            the positioner that is placed. */}
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup className={cn(POPUP, "w-[17.5rem] p-2.5")}>
            {presets && presets.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 border-b border-hairline pb-2.5">
                {presets.map((one) => (
                  <button
                    key={one.label}
                    type="button"
                    className="rounded-full bg-soft-2 px-2.5 py-1 text-[0.71875rem] font-medium text-text transition-colors hover:bg-hairline hover:text-ink"
                    onClick={() => {
                      onChange(one.value)
                      setOpen(false)
                    }}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-1.5 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                className="grid size-7 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                onClick={() => step(-1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-[0.78125rem] font-medium text-ink">
                {month.toLocaleDateString("id-ID", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                className="grid size-7 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
                onClick={() => step(1)}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((name) => (
                <span
                  key={name}
                  className="grid h-6 place-items-center font-mono text-eyebrow tracking-[0.04em] text-mute uppercase"
                >
                  {name.slice(0, 1)}
                </span>
              ))}
              {grid.map((iso) => {
                const inMonth = dateOf(iso).getMonth() === month.getMonth()
                const dead =
                  (notBefore != null && notBefore !== "" && iso < notBefore) ||
                  (notAfter != null && notAfter !== "" && iso > notAfter)
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={dead}
                    className={cn(
                      "grid h-7 place-items-center rounded-full text-[0.75rem] tabular-nums transition-colors",
                      dead
                        ? "cursor-default text-faint"
                        : iso === value
                          ? "bg-ink font-medium text-white"
                          : cn(
                              "hover:bg-soft-2 hover:text-ink",
                              iso === now && "font-semibold text-accent",
                              !inMonth && iso !== now && "text-faint",
                              inMonth && iso !== now && "text-text"
                            )
                    )}
                    onClick={() => {
                      onChange(iso)
                      setOpen(false)
                    }}
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
