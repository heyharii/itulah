import { Card } from "@/components/ui/card"
import { LeadFigure } from "@/components/ui/lead-card"
import { dateText } from "@/lib/format"
import { readDate, readMinutes } from "@/lib/queries/hr"
import {
  cellKey,
  isShort,
  type Slot,
  type WeekSheet,
} from "@/lib/queries/schedule"
import { cn } from "@/lib/utils"
import {
  dayName,
  hoursOf,
  OFF_HATCH,
  type DayNote,
  type NotesOf,
} from "@/screens/hr/schedule-look"
import { personName } from "@/screens/hr/words"
import type { EmployeeList } from "@itulah/contract"

/// The week by person — the prototype's Schedule, option A: a person a row, a
/// day a column, and the shift in the cell.
///
/// A cell, a name and a day header are all pressable, and each says who it
/// means: a cell is one day, a name is that person's whole week, a day is
/// everyone that day. What happens next (the picker opening where the press
/// landed) is the screen's; this file only reports the press and which cells
/// are selected (`Picking`). Shift- or Cmd-click adds to the selection.
///
/// Cells that are under 8 hours worked are marked red — Hari's rule, drawn
/// here and enforced nowhere (`MIN_WORK_MINUTES`).
///
/// A phone gets the same week as a card per person (nothing there scrolls
/// sideways); the cover is a last card, and a day in it is "everyone that day".

export interface Picking {
  readonly selected: ReadonlySet<string>
  readonly onCell: (
    event: React.MouseEvent<HTMLElement>,
    employeeId: string,
    date: string,
  ) => void
  readonly onPerson: (
    event: React.MouseEvent<HTMLElement>,
    employeeId: string,
  ) => void
  readonly onDay: (event: React.MouseEvent<HTMLElement>, date: string) => void
}

/// What a planned day is called in a cell a seventh of a desk wide.
function cellWord(slot: Slot | undefined): string {
  if (slot === undefined) return "—"
  if (slot.plan === "REST_DAY") return "Off"
  if (slot.plan === "PUBLIC_HOLIDAY") return "Holiday"
  if (slot.plan === "SCHEDULED") return slot.name ?? "Shift"
  return slot.plan
}

/// What it is called in a row of a phone's card: the whole word and the hours.
function rowWord(slot: Slot | undefined): string {
  if (slot === undefined) return "Not planned"
  if (slot.plan === "REST_DAY") return "Day off"
  if (slot.plan === "PUBLIC_HOLIDAY") return "Public holiday"
  if (slot.plan === "SCHEDULED") {
    const hours = hoursOf(slot)
    return `${slot.name ?? "Shift"}${hours === "" ? "" : ` ${hours}`}`
  }
  return slot.plan
}

/// The cell's tooltip: what it is, who planned it, and that it was changed.
function titleOf(slot: Slot | undefined, plannedBy: string): string {
  if (slot === undefined) return "Not planned"
  const what = rowWord(slot)
  const short = isShort(slot) ? ` · ${readMinutes(slot.minutes)} worked` : ""
  const who = slot.plannedBy === null ? "" : ` · planned by ${plannedBy}`
  const again =
    slot.revisions > 1 ? ` · re-planned ${slot.revisions - 1} times` : ""
  return `${what}${short}${who}${again}`
}

/// A one-line "Mon 12 Oct 2026" for a screen reader.
function dayLong(date: string): string {
  return `${dateText(new Date(`${date}T00:00:00`), { weekday: "short" })} ${readDate(date)}`
}

function positionOf(team: EmployeeList | undefined, employeeId: string) {
  return team?.rows.find((person) => person.employee_id === employeeId)
    ?.position
}

// ── the desk's grid ─────────────────────────────────────────────────────────

export function Grid({
  week,
  today,
  team,
  tint,
  notes,
  picking,
  plannedBy,
}: {
  week: WeekSheet
  today: string
  team: EmployeeList | undefined
  tint: (shiftId: string | null) => string
  notes: NotesOf
  picking: Picking
  /// A login as a full name, for the tooltip.
  plannedBy: (login: string | null) => string
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-cell">
          <colgroup>
            <col className="w-44" />
            {week.days.map((date) => (
              <col key={date} />
            ))}
            <col className="w-[5.25rem]" />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 h-10 border-b border-hairline bg-soft px-3.5 text-left text-meta font-medium text-body">
                Employee
              </th>
              {week.days.map((date) => (
                <th
                  key={date}
                  className={cn(
                    "h-10 border-b border-hairline p-0 text-center text-meta font-medium",
                    date === today
                      ? "bg-accent-bg text-accent"
                      : "bg-soft text-body",
                  )}
                >
                  <button
                    type="button"
                    data-pick-target
                    onClick={(event) => picking.onDay(event, date)}
                    aria-label={`Everyone, ${dayLong(date)}`}
                    className="h-10 w-full px-1 transition-colors duration-(--t-hover) select-none hover:bg-soft-2/70"
                  >
                    {dateText(new Date(`${date}T00:00:00`), {
                      weekday: "short",
                    })}{" "}
                    <span className="tabular-nums">{date.slice(8)}</span>
                  </button>
                </th>
              ))}
              <th className="h-10 border-b border-hairline bg-soft px-3.5 text-right text-meta font-medium text-body">
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {week.people.map((employeeId) => {
              const position = positionOf(team, employeeId)
              return (
                <tr key={employeeId} className="border-b border-hairline">
                  <th className="sticky left-0 z-10 bg-canvas p-0 text-left font-normal">
                    <button
                      type="button"
                      data-pick-target
                      onClick={(event) => picking.onPerson(event, employeeId)}
                      aria-label={`${personName(team, employeeId)}, the whole week`}
                      className="flex w-full min-w-0 flex-col px-3.5 py-2 text-left transition-colors duration-(--t-hover) select-none hover:bg-soft"
                    >
                      <span className="truncate text-cell font-medium text-ink">
                        {personName(team, employeeId)}
                      </span>
                      {position ? (
                        <span className="truncate text-meta font-normal text-mute">
                          {position}
                        </span>
                      ) : null}
                    </button>
                  </th>
                  {week.days.map((date) => {
                    const slot = week.slot(employeeId, date)
                    const on = picking.selected.has(cellKey(employeeId, date))
                    return (
                      <td
                        key={date}
                        className={cn(
                          "p-1.5 align-middle",
                          date === today && "bg-accent-bg/30",
                        )}
                      >
                        <Cell
                          slot={slot}
                          note={notes(employeeId, date)}
                          tint={tint}
                          selected={on}
                          label={`${personName(team, employeeId)}, ${dayLong(date)}: ${rowWord(slot)}`}
                          title={titleOf(
                            slot,
                            plannedBy(slot?.plannedBy ?? null),
                          )}
                          onClick={(event) =>
                            picking.onCell(event, employeeId, date)
                          }
                        />
                      </td>
                    )
                  })}
                  <td className="px-3.5 py-1.5 text-right text-cell whitespace-nowrap text-body tabular-nums">
                    {readMinutes(week.minutesOf(employeeId))}
                  </td>
                </tr>
              )
            })}
            {/* Cover, per shift and in all. Red when nobody is on a day — the
                prototype's minimum is two, but the minimum is head office's
                rule and this build has no route that states it, so the only
                line drawn is the one nobody could argue with. */}
            {week.used.map((shift) => (
              <tr
                key={shift.id}
                className="border-b border-hairline bg-soft/60"
              >
                <th className="sticky left-0 z-10 bg-soft px-3.5 py-1.5 text-left text-meta font-medium text-body">
                  {shift.name}
                </th>
                {week.days.map((date) => {
                  const count = week.working(date, shift.id)
                  return (
                    <td
                      key={date}
                      className={cn(
                        "px-1 py-1.5 text-center text-meta tabular-nums",
                        count === 0 ? "font-semibold text-bad-fg" : "text-body",
                      )}
                    >
                      {count}
                    </td>
                  )
                })}
                <td />
              </tr>
            ))}
            <tr className="bg-soft/60">
              <th className="sticky left-0 z-10 bg-soft px-3.5 py-2 text-left text-cell font-semibold text-ink">
                On shift
              </th>
              {week.days.map((date) => {
                const count = week.working(date)
                return (
                  <td
                    key={date}
                    className={cn(
                      "px-1 py-2 text-center text-cell font-semibold tabular-nums",
                      count === 0 ? "text-bad-fg" : "text-ink",
                    )}
                  >
                    {count}
                  </td>
                )
              })}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/// One person-day. A button, so the keyboard reaches it; `data-pick-target`
/// tells the picker that a press here is not "outside" it.
function Cell({
  slot,
  note,
  tint,
  selected,
  label,
  title,
  onClick,
}: {
  slot: Slot | undefined
  note: DayNote | undefined
  tint: (shiftId: string | null) => string
  selected: boolean
  label: string
  title: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const worked = slot !== undefined && slot.plan === "SCHEDULED" ? slot : null
  const short = worked !== null && isShort(worked)
  return (
    <button
      type="button"
      data-pick-target
      title={title}
      aria-label={label}
      aria-pressed={selected}
      aria-busy={slot?.saving === true ? true : undefined}
      onClick={onClick}
      className={cn(
        "relative flex min-h-12 w-full flex-col justify-center rounded-inner px-2 py-1 text-left leading-[1.3] tabular-nums select-none",
        "transition-[opacity,scale,box-shadow,background-color] duration-(--t-press) ease-(--ease-out) active:scale-[0.98] pointer-coarse:min-h-12",
        slot === undefined &&
          "items-center border border-dashed border-hairline-2 text-faint hover:bg-soft",
        worked !== null && tint(worked.shiftId),
        slot?.plan === "REST_DAY" && `${OFF_HATCH} text-mute`,
        slot?.plan === "PUBLIC_HOLIDAY" && "bg-warn-bg text-warn-fg",
        short && "ring-1 ring-bad/50",
        selected && "ring-2 ring-accent",
        slot?.saving === true && "opacity-60",
      )}
    >
      {worked !== null ? (
        <>
          <b className="max-w-full truncate text-cell font-semibold text-ink">
            {cellWord(worked)}
          </b>
          <span className="text-[0.9375rem] text-body">{hoursOf(worked)}</span>
          {short && (
            <span className="text-[0.9375rem] font-semibold text-bad-fg">
              {readMinutes(worked.minutes)}
            </span>
          )}
        </>
      ) : (
        <span className="text-cell">{cellWord(slot)}</span>
      )}
      <NoteLines note={note} />
      {slot !== undefined && slot.revisions > 1 && !slot.saving && (
        <span
          aria-label="Re-planned"
          className="absolute top-0.5 right-1.5 text-[0.9375rem] text-warn-fg"
        >
          ↻
        </span>
      )}
    </button>
  )
}

/// Leave and overtime under the plan, in the same cell: leave in the body
/// colour (grey and led by "Waiting" until it is approved), overtime in hours.
function NoteLines({ note }: { note: DayNote | undefined }) {
  if (note === undefined) return null
  return (
    <>
      {note.leave !== null && (
        <span
          title={note.leave}
          className={cn(
            "max-w-full truncate text-meta",
            note.leaveWaiting ? "text-mute" : "text-body",
          )}
        >
          {note.leaveWaiting ? `Waiting · ${note.leave}` : note.leave}
        </span>
      )}
      {note.overtime !== null && (
        <span className="max-w-full truncate text-meta font-medium text-ink">
          Overtime {readMinutes(note.overtime)}
        </span>
      )}
    </>
  )
}

// ── the phone's cards ───────────────────────────────────────────────────────

/// The week on a phone: one card per person, the hours planned as the figure,
/// the seven days as rows of 44px — then the cover. Nothing scrolls sideways.
export function Cards({
  week,
  today,
  team,
  notes,
  picking,
}: {
  week: WeekSheet
  today: string
  team: EmployeeList | undefined
  notes: NotesOf
  picking: Picking
}) {
  return (
    <div className="flex flex-col gap-3">
      {week.people.map((employeeId) => {
        const position = positionOf(team, employeeId)
        const minutes = week.minutesOf(employeeId)
        return (
          <section
            key={employeeId}
            className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
          >
            <button
              type="button"
              data-pick-target
              onClick={(event) => picking.onPerson(event, employeeId)}
              aria-label={`${personName(team, employeeId)}, the whole week`}
              className="flex w-full items-start gap-3 p-4 text-left transition-colors duration-(--t-press) active:bg-soft"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-card-title font-semibold break-words text-ink">
                  {personName(team, employeeId)}
                </span>
                {position ? (
                  <span className="text-[0.9375rem] text-mute">{position}</span>
                ) : null}
              </span>
              <span className="min-w-0 shrink-0">
                <LeadFigure
                  value={minutes === 0 ? "—" : readMinutes(minutes)}
                  caption="planned"
                  muted={minutes === 0}
                />
              </span>
            </button>
            <ul className="border-t border-hairline">
              {week.days.map((date) => {
                const slot = week.slot(employeeId, date)
                const on = picking.selected.has(cellKey(employeeId, date))
                const short = isShort(slot)
                return (
                  <li
                    key={date}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <button
                      type="button"
                      data-pick-target
                      onClick={(event) =>
                        picking.onCell(event, employeeId, date)
                      }
                      aria-pressed={on}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-(--t-press) ease-(--ease-out) active:bg-soft",
                        date === today && "bg-accent-bg/60",
                        on && "bg-accent-bg",
                        slot?.saving === true && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "w-[4.5rem] shrink-0 text-[0.9375rem] tabular-nums",
                          date === today
                            ? "font-semibold text-accent"
                            : "text-body",
                        )}
                      >
                        {dayName(date)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-cell",
                          slot === undefined
                            ? "text-mute"
                            : slot.plan === "SCHEDULED"
                              ? "font-medium text-ink"
                              : "text-body",
                        )}
                      >
                        {rowWord(slot)}
                      </span>
                      <CardNote note={notes(employeeId, date)} />
                      {short && slot !== undefined && (
                        <span className="shrink-0 text-[0.9375rem] font-semibold text-bad-fg tabular-nums">
                          {readMinutes(slot.minutes)}
                        </span>
                      )}
                      {slot !== undefined &&
                        slot.revisions > 1 &&
                        !slot.saving && (
                          <span className="shrink-0 text-[0.9375rem] text-warn-fg">
                            Re-planned
                          </span>
                        )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {/* Cover: who is on, per day — red when nobody is. A day here is
          everyone that day. */}
      <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
        <h3 className="p-4 pb-3 text-card-title font-semibold text-ink">
          On shift
        </h3>
        <ul className="border-t border-hairline">
          {week.days.map((date) => {
            const count = week.working(date)
            return (
              <li
                key={date}
                className="border-b border-hairline last:border-b-0"
              >
                <button
                  type="button"
                  data-pick-target
                  onClick={(event) => picking.onDay(event, date)}
                  aria-label={`Everyone, ${dayLong(date)}`}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-(--t-press) active:bg-soft",
                    date === today && "bg-accent-bg/60",
                  )}
                >
                  <span
                    className={cn(
                      "w-[4.5rem] shrink-0 text-[0.9375rem] tabular-nums",
                      date === today
                        ? "font-semibold text-accent"
                        : "text-body",
                    )}
                  >
                    {dayName(date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-mute">
                    {week.used
                      .map(
                        (shift) =>
                          `${shift.name} ${week.working(date, shift.id)}`,
                      )
                      .join(" · ")}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-cell font-semibold tabular-nums",
                      count === 0 ? "text-bad-fg" : "text-ink",
                    )}
                  >
                    {count}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/// The same leave and overtime, as the tail of a phone row.
function CardNote({ note }: { note: DayNote | undefined }) {
  if (note === undefined) return null
  const words = [
    note.leave === null
      ? null
      : note.leaveWaiting
        ? `Waiting · ${note.leave}`
        : note.leave,
    note.overtime === null ? null : `Overtime ${readMinutes(note.overtime)}`,
  ].filter((word) => word !== null)
  return (
    <span className="max-w-[40%] shrink-0 truncate text-meta text-body">
      {words.join(" · ")}
    </span>
  )
}
