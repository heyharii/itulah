import { Popover } from "@base-ui/react/popover"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { useMemo, useState } from "react"

import { BottomSheet } from "@/components/ui/picker-sheet"
import { POPUP } from "@/lib/filter-chrome"
import { usePickerSheet } from "@/lib/layout"
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
  clearable = true,
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
  /// Whether emptying it is a legal answer. Most days here are optional — a
  /// promotion with no end runs forever — so the default is yes. A payment
  /// term's due date is not one of them: every instalment falls due on a day,
  /// and an × on every row of a schedule is a control offering to make the
  /// document invalid.
  clearable?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const sheet = usePickerSheet()
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

  const changeOpen = (next: boolean) => {
    setOpen(next)
    // Reopening lands on the chosen month, not wherever the last visit left
    // the grid.
    if (next) setMonth(dateOf(value === "" ? today() : value))
    else onBlur?.()
  }

  /// The month itself, at two sizes: the desk's 28px days in a popover, or
  /// 44px days a thumb can hit in a sheet from the bottom of a phone.
  const calendar = (touch: boolean) => (
    <>
      {presets && presets.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 border-b border-hairline pb-2.5">
          {presets.map((one) => (
            <button
              key={one.label}
              type="button"
              className={cn(
                "rounded-full bg-soft-2 font-medium text-text transition-colors hover:bg-hairline hover:text-ink",
                touch
                  ? "px-3.5 py-2 text-[0.875rem]"
                  : "px-2.5 py-1 text-[0.875rem]"
              )}
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
          className={cn(
            "grid place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink",
            touch ? "size-tap" : "size-7"
          )}
          onClick={() => step(-1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span
          className={cn(
            "font-medium text-ink",
            touch ? "text-[0.9375rem]" : "text-[0.875rem]"
          )}
        >
          {month.toLocaleDateString("id-ID", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className={cn(
            "grid place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink",
            touch ? "size-tap" : "size-7"
          )}
          onClick={() => step(1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            className={cn(
              "grid place-items-center font-mono text-eyebrow tracking-[0.04em] text-mute uppercase",
              touch ? "h-8" : "h-6"
            )}
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
                "grid place-items-center rounded-full tabular-nums transition-colors",
                touch ? "h-11 text-[0.9375rem]" : "h-7 text-[0.875rem]",
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
    </>
  )

  // A phone: the month rises from the bottom edge in the same sheet every
  // picker in the app uses, instead of a 17.5rem popover under a field the
  // keyboard may be covering. See `picker-sheet.tsx`.
  if (sheet) {
    return (
      <>
        <span className={cn("relative flex w-full items-center", className)}>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => changeOpen(true)}
            aria-label={label}
            disabled={disabled}
            className={cn(
              // `<Input>`'s chrome, class for class, because that is where this
              // control lives: of the forty-odd boxes it draws, nearly all stand
              // inside a `<Field>` next to a text box, a select or a typeahead.
              // It was the last control still wearing the pre-2026-09-10
              // language — a 36px grey pill with no border — so an expected
              // arrival beside a supplier read as two controls from two
              // different applications. A toolbar still compacts it with `h-8`,
              // and twMerge lets that win.
              "flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas pl-3 text-left text-[0.875rem] transition-colors outline-none",
              "hover:border-hairline-strong",
              "focus-visible:border-accent data-[popup-open]:border-accent",
              "disabled:opacity-50",
              value === "" || !clearable ? "pr-9" : "pr-14",
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
            <CalendarDays className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
          </button>
          {value !== "" && clearable && (
            <button
              type="button"
              aria-label={`Clear ${label}`}
              className="absolute right-8 grid size-9 place-items-center rounded-full text-line-ico"
              onClick={() => onChange("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
        <BottomSheet
          open={open}
          onOpenChange={changeOpen}
          title={label ?? "Pick a day"}
        >
          <div className="px-4 pb-4">{calendar(true)}</div>
        </BottomSheet>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      {/* Clearing is a decision and gets its own control — but BESIDE the
          trigger, never inside it: a button nested in a button is announced as
          two controls and activated as one. */}
      <span className={cn("relative flex w-full items-center", className)}>
        <Popover.Trigger
          aria-label={label}
          disabled={disabled}
          className={cn(
            // `<Input>`'s chrome, class for class, because that is where this
            // control lives: of the forty-odd boxes it draws, nearly all stand
            // inside a `<Field>` next to a text box, a select or a typeahead.
            // It was the last control still wearing the pre-2026-09-10
            // language — a 36px grey pill with no border — so an expected
            // arrival beside a supplier read as two controls from two
            // different applications. A toolbar still compacts it with `h-8`,
            // and twMerge lets that win.
            "flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas pl-3 text-left text-[0.875rem] transition-colors outline-none",
            "hover:border-hairline-strong",
            "focus-visible:border-accent data-[popup-open]:border-accent",
            "disabled:opacity-50",
            value === "" || !clearable ? "pr-9" : "pr-14",
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
          {/* A calendar, not a chevron. A chevron says "there is a list under
              here"; what is under here is a month grid, and on a box that
              already reads as a text field the icon is the only thing saying
              what pressing it does. The whole trigger opens it — the icon is
              a sign, not the target. */}
          <CalendarDays className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
        </Popover.Trigger>
        {value !== "" && clearable && (
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
            {calendar(false)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
