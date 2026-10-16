import { Plus } from "lucide-react"

import { dateText } from "@/lib/format"
import { readDate } from "@/lib/queries/hr"
import {
  byStart,
  cellKey,
  isShort,
  type WeekSheet,
} from "@/lib/queries/schedule"
import { cn } from "@/lib/utils"
import type { Picking } from "@/screens/hr/schedule-grid"
import { OFF_HATCH, spanOf } from "@/screens/hr/schedule-look"
import { personName } from "@/screens/hr/words"
import type { EmployeeList, ShiftView } from "@itulah/contract"

/// The week by shift — the prototype's Schedule, option B: a column a day, in
/// it a lane per shift with the people on it as chips, and a "+" to put
/// somebody else on.
///
/// The same picks as the grid — a chip is one person-day, a day heading is
/// everyone that day — so the picker is the same too. Two lanes the prototype
/// merged are kept apart because the centre keeps them apart: **Off** is a day
/// somebody planned as a rest day or a holiday, **Not planned** is a day
/// nobody has planned at all, and that second one is the gap the board is for.
///
/// A phone gets the days one under the other (nothing there scrolls sideways).

/// A lane: a shift from the catalogue, or — for a day planned on a shift head
/// office has since retired — the shift as the day remembers it.
export interface Lane {
  readonly id: string
  readonly name: string
  readonly span: string
}

export function Board({
  week,
  today,
  team,
  shifts,
  tint,
  picking,
  onAdd,
}: {
  week: WeekSheet
  today: string
  team: EmployeeList | undefined
  shifts: readonly ShiftView[]
  tint: (shiftId: string | null) => string
  picking: Picking
  /// The "+" on a lane: who could be put on this shift this day.
  onAdd: (
    event: React.MouseEvent<HTMLElement>,
    date: string,
    lane: Lane,
  ) => void
}) {
  const lanes: Lane[] = [...shifts]
    .sort(byStart)
    .map((shift) => ({ id: shift.id, name: shift.name, span: spanOf(shift) }))
  for (const used of week.used) {
    if (!lanes.some((lane) => lane.id === used.id)) {
      lanes.push({ id: used.id, name: used.name, span: "" })
    }
  }

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-5 md:grid-cols-[repeat(7,minmax(9.5rem,1fr))] md:overflow-x-auto md:pb-1.5">
      {week.days.map((date) => {
        const parsed = new Date(`${date}T00:00:00`)
        const people = week.people.map((employeeId) => ({
          employeeId,
          slot: week.slot(employeeId, date),
        }))
        const off = people.filter(
          (one) =>
            one.slot !== undefined &&
            (one.slot.plan === "REST_DAY" ||
              one.slot.plan === "PUBLIC_HOLIDAY"),
        )
        const open = people.filter((one) => one.slot === undefined)
        const label = `${dateText(parsed, { weekday: "short" })} ${readDate(date)}`
        return (
          <section key={date} className="flex min-w-0 flex-col gap-2">
            <button
              type="button"
              data-pick-target
              onClick={(event) => picking.onDay(event, date)}
              aria-label={`Everyone, ${label}`}
              className={cn(
                "flex flex-col rounded-inner px-1 py-0.5 text-left transition-colors duration-(--t-hover) hover:bg-soft-2/70",
                date === today && "text-accent",
              )}
            >
              <b className="text-cell font-semibold">
                {dateText(parsed, { weekday: "short" })}{" "}
                <span className="tabular-nums">{date.slice(8)}</span>
              </b>
              <span className="text-[0.875rem] text-mute tabular-nums">
                {week.working(date)} on shift
              </span>
            </button>

            {lanes.map((lane) => {
              const here = people.filter(
                (one) =>
                  one.slot?.plan === "SCHEDULED" &&
                  one.slot.shiftId === lane.id,
              )
              return (
                <div
                  key={lane.id}
                  className={cn(
                    "flex flex-wrap items-center gap-1.5 rounded-card p-2",
                    tint(lane.id),
                  )}
                >
                  <div className="flex w-full items-baseline justify-between gap-2 text-[0.875rem]">
                    <b className="min-w-0 truncate font-semibold text-ink">
                      {lane.name}
                    </b>
                    <span className="shrink-0 text-body tabular-nums">
                      {lane.span}
                    </span>
                  </div>
                  {here.map((one) => (
                    <Chip
                      key={one.employeeId}
                      name={personName(team, one.employeeId)}
                      short={isShort(one.slot)}
                      selected={picking.selected.has(
                        cellKey(one.employeeId, date),
                      )}
                      saving={one.slot?.saving === true}
                      onClick={(event) =>
                        picking.onCell(event, one.employeeId, date)
                      }
                    />
                  ))}
                  <button
                    type="button"
                    data-pick-target
                    onClick={(event) => onAdd(event, date, lane)}
                    aria-label={`Add someone to ${lane.name}, ${label}`}
                    className="grid size-8 place-items-center rounded-inner border border-dashed border-black/20 text-body transition-[scale,background-color] duration-(--t-press) ease-(--ease-out) hover:bg-canvas/60 active:scale-[0.97] pointer-coarse:size-11"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              )
            })}

            <div
              className={cn(
                "flex flex-wrap items-center gap-1.5 rounded-card p-2",
                OFF_HATCH,
              )}
            >
              <div className="flex w-full items-baseline justify-between text-[0.875rem]">
                <b className="font-semibold text-ink">Off</b>
              </div>
              {off.map((one) => (
                <Chip
                  key={one.employeeId}
                  name={personName(team, one.employeeId)}
                  note={
                    one.slot?.plan === "PUBLIC_HOLIDAY" ? "Holiday" : undefined
                  }
                  quiet
                  selected={picking.selected.has(cellKey(one.employeeId, date))}
                  saving={one.slot?.saving === true}
                  onClick={(event) =>
                    picking.onCell(event, one.employeeId, date)
                  }
                />
              ))}
            </div>

            {open.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-dashed border-hairline-2 p-2">
                <div className="flex w-full items-baseline justify-between text-[0.875rem]">
                  <b className="font-semibold text-ink">Not planned</b>
                  <span className="text-mute tabular-nums">{open.length}</span>
                </div>
                {open.map((one) => (
                  <Chip
                    key={one.employeeId}
                    name={personName(team, one.employeeId)}
                    quiet
                    selected={picking.selected.has(
                      cellKey(one.employeeId, date),
                    )}
                    onClick={(event) =>
                      picking.onCell(event, one.employeeId, date)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Chip({
  name,
  note,
  short,
  quiet,
  selected,
  saving,
  onClick,
}: {
  name: string
  /// What else about the day, said after the name.
  note?: string
  /// Under the 8 hours worked.
  short?: boolean
  /// A day that is not a shift: the chip recedes.
  quiet?: boolean
  selected: boolean
  saving?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      data-pick-target
      onClick={onClick}
      title={name}
      aria-pressed={selected}
      className={cn(
        "flex h-8 max-w-full items-center gap-1.5 rounded-inner px-2.5 text-cell font-medium ring-1 transition-[scale,box-shadow,opacity] duration-(--t-press) ease-(--ease-out) select-none active:scale-[0.97] pointer-coarse:h-11",
        quiet === true
          ? "bg-canvas/70 text-body ring-black/5"
          : "bg-canvas text-ink ring-black/10",
        short === true && "text-bad-fg ring-2 ring-bad",
        selected && "ring-2 ring-accent",
        saving === true && "opacity-60",
      )}
    >
      <span className="truncate">{name}</span>
      {note !== undefined && (
        <span className="shrink-0 font-normal text-mute">{note}</span>
      )}
    </button>
  )
}
