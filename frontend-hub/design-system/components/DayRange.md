# DayRange

A range of days is one 36px box that can be typed at or clicked through; `Day` picks a single day the same way, and on a phone both open a month of 44px days.

## Pick by the question

| The question | Use | Notes |
| --- | --- | --- |
| One day: a delivery date, a start date | `Day` | A form's 40px box (44px under a finger) or a bar's 36px box |
| A window: created between, due between | `DayRange` | One box, never two |
| A named stretch (this month, last month, this year) | `Segmented` of presets, with a "Pick dates" `DayRange` beside it | The Sales explorer |
| An instant, to the minute | Not this control | A day is never an instant |

## Anatomy

- **Box, closed.** In the bar it is 36px (`control`) and 176px wide, padding 0 36px 0 12px, radius 8px, 1px `hairline-2`, `canvas`. Its words are 15px: `mute` for the placeholder ("Created at"), `ink` once set. A 14px calendar glyph in `line-ico` stands 12px from the right. Set, a round 20px × sits 32px from the right and clears it; the text room shrinks to leave it. Open or focused, the border is `accent`.
- **What it says.** "20 Oct – 30 Oct", "From 20 Oct", "Until 15 Nov", or one day alone: "20 Oct". The year is left off while every day stated is this year, because "20 Oct 2026 – 30 Oct 2026" is twice as wide as the question. It is the one place a date goes without its year; outside this year the year is written.
- **Popover.** 328px wide, padding 16px, radius 10px, 1px `hairline`, `shadow-pop`, 6px under the box and aligned to its left edge. From the top:
  1. A 40px type box, focused on open. It reads "20/10 - 30/10", "1-5 okt", "minggu ini", "bulan depan", "kuartal 4" and "7 hari terakhir"; for one day it also reads "besok", "jumat" and "next fri". What people type is Indonesian or English; the screen stays English. Under it the reading, in full: "Tue 20 Oct 2026 – Fri 30 Oct 2026 · 11 days, starting in 3 days — Enter to take it". A phrase that reads as no day says "Not a day this can read." in `bad`.
  2. The month row: 32px round steps in `line-ico`, and "October 2026" at 500 between them.
  3. The weekdays, Monday first, in a 32px row, then six weeks of 36px days, 4px between rows.
- **Days.** 15px, tabular. Today is `accent` at 600. Days of the next and previous month are `faint`. The two ends of the window are filled `ink` with an `on-dark` word at 500; the days between are a `soft-2` band; a day under the pointer is `soft-2`.
- **Clicking.** The first day clicked is taken at once as the start, so the list narrows to "from here". The second closes the window and the popover. Clicking an earlier day second swaps the two. Either end may stay open.
- **Keys.** A key typed on the closed box opens it with that key in the type box. Enter takes the reading. Esc closes the popover.
- **Day** is the same popover for one day: the chosen day is filled `ink`; `presets` add round `soft-2` chips for the two or three answers people give; `notBefore` and `notAfter` draw the days outside them `faint` and dead; the day the typed reading names is lit in `accent-bg` with an `accent` ring until it is taken.

## On a phone

- `Day` opens a bottom sheet. The month comes first, with 44px days, and the type box is under it so the keyboard does not cover the month. Once a reading exists, a 44px "Take this day" button in `cta` appears.
- `DayRange` is a page of the filter sheet (`DayRangePage`): the month row with 36px round steps and 20px glyphs, "October 2026" at 600, 44px days in seven columns 2px apart, and one line in `mute` saying where the pick stands: "Pick the first day", then "From 20 Oct 2026 — pick the last day", then "20 Oct 2026 – 30 Oct 2026". There is no box to type into: a thumb taps a day. The page lets go 200ms after the second tap.

## Rules

- A window is one box. The two ends are one thought, and one calendar can show what lies between them.
- Label the box with the question it answers, in sentence case: "Created at", "Delivery date", "Period". The placeholder repeats the label.
- Values are ISO days (`yyyy-mm-dd`); `""` is an open end. The caller never sees a time.
- Typing is first-class, and the reading is shown in full, weekday and year included, before Enter takes it, so a wrong guess is seen and not filed.
- Never `<input type="date">`: its panel belongs to the operating system.
- Keep `quiet` for a bar control that should take the accent look of an active filter; no screen passes it today.

## Retired

- **A range cut off in its own box.** The PO list gives its two boxes 176px (`w-44`). With the clear and the glyph that leaves 106px, and "20 Oct – 30 Oct" needs 110px, so a set range reads "20 Oct – 30 …". The stock card's 208px (`w-52`) fits. Use 208px in the bar.
- **A calendar that scrolls.** The popover is capped at 22rem (352px), shorter than its own type box, reading, month row and six weeks (about 400px), so it scrolls and the last week hides under the scrollbar. Remove the cap for the calendar.
- **Mono weekday letters.** "M T W T F S S" are drawn in JetBrains Mono, tracked and set to uppercase in the source, because the popover is portalled outside `.shell-page`, where `white.css` turns mono into the face of the words. Draw them in the body face.
- **A box for each end**, and a native date input: 43 boxes across 20 files were replaced by `Day`.

## What you provide

| Part | Props | Notes |
| --- | --- | --- |
| `DayRange` | `value` (`{ from, to }`), `onChange`, `label?`, `placeholder?`, `className?`, `quiet?` | `label` names the box for a screen reader. |
| `Day` | `value`, `onChange`, `presets?`, `notBefore?`, `notAfter?`, `onBlur?`, `label?`, `disabled?`, `clearable?` (true), `invalid?`, `required?`, `className?` | A required day has no ×. |
| `DayRangePage` | `field`, `model`, `onComplete` | The phone's page; it writes `gte` and `lte` clauses. |

Source: `frontend-hub/src/components/ui/day-range.tsx`, `day.tsx`, `day-range-sheet.tsx`; `src/lib/day-parse.ts`, `src/lib/calendar.ts`.
