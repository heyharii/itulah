import { Popover } from "@base-ui/react/popover"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"

import {
  FORM_HALO_TRIGGER,
  INVALID,
  useFieldAria,
  useInForm,
} from "@/components/ui/field-state"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { POPUP } from "@/lib/filter-chrome"
import { usePickerSheet } from "@/lib/layout"
import { dateOf, monthGrid, startOfDay, today, WEEKDAYS } from "@/lib/calendar"
import { readDay, untilText, warmDayParser } from "@/lib/day-parse"
import { day, monthYear, weekday } from "@/lib/format"
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
///
/// **It can be typed at.** "besok", "jumat", "15/10", "akhir bulan", "3 hari
/// lagi" — in Indonesian or English, read by chrono through `readDay()` in
/// `lib/day-parse.ts`. A key pressed on the closed field opens it with that
/// key in the box; the reading is shown in full, weekday included, before
/// Enter takes it, and a reading outside `notBefore`/`notAfter` is refused
/// there rather than filed. Clicking through the month still works exactly
/// as it did.
export function Day({
  value,
  onChange,
  presets,
  notBefore,
  notAfter,
  onBlur,
  label,
  disabled,
  clearable = true,
  invalid,
  required,
  className,
}: {
  /// An ISO day, `yyyy-mm-dd`, in the local calendar. `""` is unanswered —
  /// the same emptiness `<Select>` and `<Money>` take, and the same one every
  /// `type="date"` box this replaces already held.
  value: string
  onChange: (value: string) => void
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
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  /// A day must be given. Takes the × away too — see `clearable`.
  required?: boolean
  className?: string
}) {
  // A day box on screen is the signal that chrono may soon be asked for: the
  // import starts at the first render, so the first keystroke already finds
  // it (`lib/day-parse.ts`). Idempotent.
  warmDayParser()
  const [open, setOpen] = useState(false)
  const aria = useFieldAria({ invalid, required })
  // On a form, the form's box (`FORM_BOX` in `field-state.ts`) — spelled out
  // here because its `px` would take the right padding the clear × needs.
  const form = useInForm()
  const formBox = form && [
    "h-[var(--form-box,2.75rem)] pl-3.5 text-[0.9375rem]",
    FORM_HALO_TRIGGER,
  ]
  const canClear =
    value !== "" &&
    clearable &&
    disabled !== true &&
    aria["aria-required"] !== true
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

  /// What is being typed into the box above the month, and the day it reads
  /// as. See `day-parse.ts` for what it understands.
  const [typed, setTyped] = useState("")
  const typeBox = useRef<HTMLInputElement>(null)
  const typeId = useId()
  const bounds = { notBefore, notAfter }
  const read = typed.trim() === "" ? null : readDay(typed, now, bounds)
  const outside = read !== null && isDead(read, notBefore, notAfter)

  const typing = (next: string) => {
    setTyped(next)
    // The grid follows the reading, so the day about to be taken is on screen
    // and lit before Enter takes it.
    const found = next.trim() === "" ? null : readDay(next, now, bounds)
    if (found !== null) setMonth(dateOf(found))
  }

  const changeOpen = (next: boolean, seed = "") => {
    setOpen(next)
    setTyped("")
    // Reopening lands on the chosen month, not wherever the last visit left
    // the grid.
    if (next) {
      setMonth(dateOf(value === "" ? today() : value))
      if (seed !== "") typing(seed)
    } else onBlur?.()
  }

  /// Taking a day, however it was chosen. Through `changeOpen` so the form's
  /// `onBlur` hears about it — a day clicked in the grid used to close the
  /// panel without telling it, so a field validated on blur never was.
  const pick = (iso: string) => {
    onChange(iso)
    changeOpen(false)
  }

  /// A key typed on the closed trigger opens the panel with that key already
  /// in the box: a keyboard user types "besok" at the field, not at a button
  /// they first have to press.
  const typeOnTrigger = (event: React.KeyboardEvent) => {
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
  }

  /// The box a day is typed into, and its reading of what was typed.
  ///
  /// Above the month on a desk, where it takes focus. Below it on a phone,
  /// so the sheet's first stop is the month and not a box that raises the
  /// keyboard over it — and so, when somebody does want to type, the box
  /// sits just above the keys.
  const typeBlock = (touch: boolean) => (
    <div className={touch ? "mt-3 border-t border-hairline pt-3" : undefined}>
      {/* A plain input, not `<Input>`: that one reads the enclosing
        `<Field>`, and context crosses the portal — this box would be
        announced as the field's own required, refused answer. */}
      <input
        ref={typeBox}
        value={typed}
        onChange={(event) => typing(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          // Inside a form, Enter would submit it with the day not yet taken.
          event.preventDefault()
          if (read !== null && !outside) pick(read)
        }}
        aria-label={`Type ${label ?? "a day"}`}
        aria-describedby={typed.trim() === "" ? undefined : `${typeId}-read`}
        aria-invalid={typed.trim() !== "" && (read === null || outside)}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "ui-field w-full rounded-inner border border-hairline-2 bg-canvas px-2.5 text-ink transition-colors outline-none placeholder:text-mute focus:border-accent",
          "aria-[invalid=true]:border-bad",
          touch ? "h-tap text-[1rem]" : "h-10 text-[0.9375rem]"
        )}
      />
      {typed.trim() !== "" && (
        <p
          id={`${typeId}-read`}
          aria-live="polite"
          className={cn(
            "mt-2 min-h-5 px-0.5 text-[0.9375rem]",
            read === null || outside ? "text-bad" : "text-body"
          )}
        >
          {read === null ? (
            "Not a day this can read."
          ) : outside ? (
            <>{longDay(read)} is outside what this field allows.</>
          ) : touch ? (
            <>
              {longDay(read)}
              <span className="text-mute"> · {untilText(read, now)}</span>
            </>
          ) : (
            <>
              {longDay(read)}
              <span className="text-mute">
                {" "}
                · {untilText(read, now)} — Enter to take it
              </span>
            </>
          )}
        </p>
      )}
      {/* A phone's keyboard may not say "Enter" anywhere on it, so the
          reading gets a button of its own. */}
      {touch && read !== null && !outside && (
        <button
          type="button"
          onClick={() => pick(read)}
          className="h-tap w-full rounded-inner bg-cta text-[0.9375rem] font-medium text-cta-fg"
        >
          Take this day
        </button>
      )}
    </div>
  )

  /// The month itself, at two sizes: the desk's 28px days in a popover, or
  /// 44px days a thumb can hit in a sheet from the bottom of a phone.
  const calendar = (touch: boolean) => (
    <>
      {!touch && typeBlock(false)}

      {presets && presets.length > 0 && (
        <div className="mt-3 mb-1 flex flex-wrap gap-2 border-b border-hairline pb-3.5">
          {presets.map((one) => (
            <button
              key={one.label}
              type="button"
              className={cn(
                "rounded-full bg-soft-2 font-medium text-text transition-colors hover:bg-hairline hover:text-ink",
                touch
                  ? "px-3.5 py-2 text-[0.9375rem]"
                  : "px-2.5 py-1 text-[0.9375rem]"
              )}
              onClick={() => pick(one.value)}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className={cn(
            "grid place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink",
            touch ? "size-tap" : "size-8"
          )}
          onClick={() => step(-1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span
          className={cn(
            "font-medium text-ink",
            touch ? "text-[0.9375rem]" : "text-[0.9375rem]"
          )}
        >
          {monthYear(month, true)}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className={cn(
            "grid place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink",
            touch ? "size-tap" : "size-8"
          )}
          onClick={() => step(1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((name) => (
          <span
            key={name}
            className={cn(
              "grid place-items-center font-mono text-eyebrow tracking-[0.04em] text-mute uppercase",
              touch ? "h-8" : "h-8"
            )}
          >
            {name.slice(0, 1)}
          </span>
        ))}
        {grid.map((iso) => {
          const inMonth = dateOf(iso).getMonth() === month.getMonth()
          const dead = isDead(iso, notBefore, notAfter)
          const candidate = read !== null && !outside && iso === read
          return (
            <button
              key={iso}
              type="button"
              disabled={dead}
              className={cn(
                "grid place-items-center rounded-full tabular-nums transition-colors",
                touch ? "h-11 text-[0.9375rem]" : "h-9 text-[0.9375rem]",
                dead
                  ? "cursor-default text-faint"
                  : iso === value
                    ? "bg-ink font-medium text-white"
                    : candidate
                      ? "bg-accent-bg font-medium text-accent ring-1 ring-accent"
                      : cn(
                          "hover:bg-soft-2 hover:text-ink",
                          iso === now && "font-semibold text-accent",
                          !inMonth && iso !== now && "text-faint",
                          inMonth && iso !== now && "text-text"
                        )
              )}
              onClick={() => pick(iso)}
            >
              {dateOf(iso).getDate()}
            </button>
          )
        })}
      </div>

      {touch && typeBlock(true)}
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
            {...aria}
            className={cn(
              // `<Input>`'s chrome, class for class, because that is where this
              // control lives: of the forty-odd boxes it draws, nearly all stand
              // inside a `<Field>` next to a text box, a select or a typeahead.
              // It was the last control still wearing the pre-2026-09-10
              // language — a 36px grey pill with no border — so an expected
              // arrival beside a supplier read as two controls from two
              // different applications. A toolbar still compacts it with `h-8`,
              // and twMerge lets that win.
              "ui-field flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas pl-3 text-left text-[0.9375rem] transition-colors outline-none",
              "hover:border-hairline-strong",
              "focus-visible:border-accent data-[popup-open]:border-accent",
              "disabled:opacity-50",
              formBox,
              INVALID,
              canClear ? "pr-14" : "pr-9",
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
              {value === "" ? "" : day(startOfDay(value))}
            </span>
            <CalendarDays className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
          </button>
          {canClear && (
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
          onOpenChange={(next) => changeOpen(next)}
          title={label ?? "Pick a day"}
        >
          <div className="px-4 pb-4">{calendar(true)}</div>
        </BottomSheet>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => changeOpen(next)}>
      {/* Clearing is a decision and gets its own control — but BESIDE the
          trigger, never inside it: a button nested in a button is announced as
          two controls and activated as one. */}
      <span className={cn("relative flex w-full items-center", className)}>
        <Popover.Trigger
          aria-label={label}
          disabled={disabled}
          onKeyDown={typeOnTrigger}
          {...aria}
          className={cn(
            // `<Input>`'s chrome, class for class, because that is where this
            // control lives: of the forty-odd boxes it draws, nearly all stand
            // inside a `<Field>` next to a text box, a select or a typeahead.
            // It was the last control still wearing the pre-2026-09-10
            // language — a 36px grey pill with no border — so an expected
            // arrival beside a supplier read as two controls from two
            // different applications. A toolbar still compacts it with `h-8`,
            // and twMerge lets that win.
            "ui-field flex h-10 w-full items-center gap-2 rounded-inner border border-hairline-2 bg-canvas pl-3 text-left text-[0.9375rem] transition-colors outline-none",
            "hover:border-hairline-strong",
            "focus-visible:border-accent data-[popup-open]:border-accent",
            "disabled:opacity-50",
            formBox,
            INVALID,
            "aria-[invalid=true]:data-[popup-open]:border-bad",
            canClear ? "pr-14" : "pr-9",
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
            {value === "" ? "" : day(startOfDay(value))}
          </span>
          {/* A calendar, not a chevron. A chevron says "there is a list under
              here"; what is under here is a month grid, and on a box that
              already reads as a text field the icon is the only thing saying
              what pressing it does. The whole trigger opens it — the icon is
              a sign, not the target. */}
          <CalendarDays className="absolute right-3 size-3.5 shrink-0 text-line-ico" />
        </Popover.Trigger>
        {canClear && (
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
          {/* The box takes focus on a desk, so opening and typing is one
              motion. Not on a phone: a keyboard rising over the month is the
              opposite of what a tap on a calendar asked for. */}
          <Popover.Popup
            initialFocus={typeBox}
            // Escape shuts the calendar and nothing under it: a sheet this
            // field stands in must not hear the same key.
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.stopPropagation()
              changeOpen(false)
            }}
            className={cn(POPUP, "w-[20.5rem] p-4")}
          >
            {calendar(false)}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/// Outside the window the field declares. An empty bound is no bound.
function isDead(
  iso: string,
  notBefore: string | null | undefined,
  notAfter: string | null | undefined
): boolean {
  return (
    (notBefore != null && notBefore !== "" && iso < notBefore) ||
    (notAfter != null && notAfter !== "" && iso > notAfter)
  )
}

/// The reading of what was typed, said in full — weekday and all — because
/// the weekday is how somebody checks that "jumat" landed on the Friday they
/// meant.
function longDay(iso: string): string {
  return weekday(iso, true)
}
