import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"

import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { addDays, hrKeys, isoDay, planDay } from "@/lib/queries/hr"
import type { RosterDayView, ShiftView } from "@itulah/contract"

/// What the Schedule screen needs beyond the plain reads in `hr.ts`: the week
/// as seven dates, a person-day as the grid draws it, the shape of a change,
/// and the one hook that writes a batch of them.
///
/// # Every write is one day
///
/// `POST /api/v1/employees/{id}/roster` plans ONE person's ONE day, under
/// `ROSTER_MANAGE`, and answers 400 without a `reason` — on a first plan as on
/// a revision. A picker that sets five cells is five calls, so a batch is run
/// here, a few at a time, and each call stands or falls on its own: the
/// outcome says which days were saved and which were refused (a closed month,
/// a person posted elsewhere), instead of one error standing for all of them.
///
/// # There is no way back to "not planned"
///
/// A roster day is append-only at the centre: it can be revised, never
/// removed. So "undo" can only be a revision back to what the day was, and a
/// day that had NO plan before cannot be undone at all. The screen offers Undo
/// only for a batch where every day had a plan to go back to.

/// Hari's rule of 11 Oct 2026: every person works at least 8 hours a day.
///
/// **The centre has no such rule** — a shift of any length is a legitimate
/// shift pattern — so this is drawn, never enforced: a shift under it is
/// marked red wherever it appears and the week says how many there are, but
/// nothing refuses it. Measured in *paid* minutes (`planned_work_minutes`, the
/// span less the unpaid break), because that is the centre's figure for "worked".
export const MIN_WORK_MINUTES = 8 * 60

/// The three things a planned day can be at the centre.
export type PlanCode = "SCHEDULED" | "REST_DAY" | "PUBLIC_HOLIDAY"

/// What a day is going to be, as the picker states it. Shifts are head
/// office's: a choice carries one from the catalogue, never hours of its own.
export type Choice =
  | { readonly plan: "SCHEDULED"; readonly shift: ShiftView }
  | { readonly plan: "REST_DAY" | "PUBLIC_HOLIDAY" }

/// One person's one day as the grid draws it: the centre's row, or the write
/// that is on its way to becoming one (`saving`).
export interface Slot {
  /// The centre's code. A string, not `PlanCode`: a code this build has not
  /// been taught is shown as itself rather than guessed at.
  readonly plan: string
  readonly shiftId: string | null
  readonly name: string | null
  readonly starts: string | null
  readonly ends: string | null
  readonly crossesMidnight: boolean
  /// Paid minutes; 0 on a day that is not worked.
  readonly minutes: number
  /// How many times the day has been planned. More than one is a governance
  /// signal at the centre, so the grid marks it.
  readonly revisions: number
  readonly plannedBy: string | null
  readonly saving: boolean
}

/// A row from the centre, or — when a write is on its way — what it will say.
export function slotOf(
  row: RosterDayView | undefined,
  pending?: Choice,
): Slot | undefined {
  if (pending !== undefined) {
    const shift = pending.plan === "SCHEDULED" ? pending.shift : null
    return {
      plan: pending.plan,
      shiftId: shift?.id ?? null,
      name: shift?.name ?? null,
      starts: shift?.starts_at ?? null,
      ends: shift?.ends_at ?? null,
      crossesMidnight: shift?.crosses_midnight ?? false,
      minutes: shift?.planned_work_minutes ?? 0,
      revisions: (row?.revision_count ?? 0) + 1,
      plannedBy: null,
      saving: true,
    }
  }
  if (row === undefined) return undefined
  return {
    plan: row.plan,
    shiftId: row.shift_id,
    name: row.shift_name,
    starts: row.starts_at,
    ends: row.ends_at,
    crossesMidnight: row.crosses_midnight,
    minutes: row.planned_work_minutes ?? 0,
    revisions: row.revision_count,
    plannedBy: row.planned_by,
    saving: false,
  }
}

/// A worked day shorter than the 8 hours Hari asks of everyone.
export function isShort(slot: Slot | undefined): boolean {
  return slot?.plan === "SCHEDULED" && slot.minutes < MIN_WORK_MINUTES
}

/// Whether a day already is what the choice would make it — a write for it
/// would only add a revision that says nothing.
export function isAlready(slot: Slot | undefined, choice: Choice): boolean {
  if (slot === undefined || slot.plan !== choice.plan) return false
  return choice.plan !== "SCHEDULED" || slot.shiftId === choice.shift.id
}

/// The choice that would put a day back as it is: `null` when the day has no
/// plan, or its shift is no longer in the catalogue (head office retired it).
export function choiceOfSlot(
  slot: Slot | undefined,
  catalogue: readonly ShiftView[],
): Choice | null {
  if (slot === undefined) return null
  if (slot.plan === "REST_DAY" || slot.plan === "PUBLIC_HOLIDAY") {
    return { plan: slot.plan }
  }
  if (slot.plan !== "SCHEDULED") return null
  const shift = catalogue.find((one) => one.id === slot.shiftId)
  return shift === undefined ? null : { plan: "SCHEDULED", shift }
}

/// The same, from a centre row — last week's plan, to be copied.
export function choiceOfRow(
  row: RosterDayView,
  catalogue: readonly ShiftView[],
): Choice | null {
  return choiceOfSlot(slotOf(row), catalogue)
}

/// A choice in a word: the shift's name, or what the day is.
export function choiceWord(choice: Choice): string {
  if (choice.plan === "SCHEDULED") return choice.shift.name
  return choice.plan === "REST_DAY" ? "Day off" : "Public holiday"
}

/// The shifts, in the order a day runs: earliest start first.
export function byStart(left: ShiftView, right: ShiftView): number {
  return (
    left.starts_at.localeCompare(right.starts_at) ||
    left.name.localeCompare(right.name)
  )
}

// ── the week ────────────────────────────────────────────────────────────────

/// Monday. A retail week here is read Monday to Sunday; starting it on Sunday
/// puts the weekend at both ends of the strip.
export function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

/// The seven dates that start on `from`.
export function daysOfWeek(from: string): string[] {
  const start = new Date(`${from}T00:00:00`)
  return Array.from({ length: 7 }, (_, index) => isoDay(addDays(start, index)))
}

/// The seven dates of the week before the one that starts on `from` — what
/// "Same as last week" copies from.
export function daysBefore(from: string): string[] {
  return daysOfWeek(isoDay(addDays(new Date(`${from}T00:00:00`), -7)))
}

/// One person-day's address in a set: the date first, so the person's id may
/// hold any character.
export function cellKey(employeeId: string, date: string): string {
  return `${date}|${employeeId}`
}

export function splitKey(key: string): { employeeId: string; date: string } {
  const cut = key.indexOf("|")
  return { date: key.slice(0, cut), employeeId: key.slice(cut + 1) }
}

// ── the week as a sheet ─────────────────────────────────────────────────────

/// A shift that is in use somewhere this week — one row of the cover.
export interface UsedShift {
  readonly id: string
  readonly name: string
  readonly starts: string
}

/// What a week is made of, read once for every shape it is drawn in.
export interface WeekSheet {
  readonly days: readonly string[]
  readonly people: readonly string[]
  readonly slot: (employeeId: string, date: string) => Slot | undefined
  /// Paid minutes planned for one person across the week.
  readonly minutesOf: (employeeId: string) => number
  /// How many are on a shift that day — all of them, or the ones on `shiftId`.
  readonly working: (date: string, shiftId?: string) => number
  /// The shifts in use this week, earliest first.
  readonly used: readonly UsedShift[]
  /// Days planned under the 8 hours Hari asks of everyone.
  readonly short: number
}

/// The week from the centre's rows, with the writes that are on their way
/// laid over them.
///
/// Everybody active at this shop is on it, plus anybody rostered who is not on
/// the list (a posting can move mid-week) — so a person nobody has planned yet
/// still has a row to plan them in.
export function weekSheet(input: {
  days: readonly string[]
  rows: readonly RosterDayView[]
  pending: ReadonlyMap<string, Choice>
  active: readonly string[]
}): WeekSheet {
  const { days, rows, pending } = input
  const people = [
    ...new Set([...input.active, ...rows.map((row) => row.employee_id)]),
  ]
  const centre = new Map(
    rows.map((row) => [cellKey(row.employee_id, row.on_date), row]),
  )
  const slots = new Map<string, Slot>()
  for (const employeeId of people) {
    for (const date of days) {
      const key = cellKey(employeeId, date)
      const slot = slotOf(centre.get(key), pending.get(key))
      if (slot !== undefined) slots.set(key, slot)
    }
  }
  const slot = (employeeId: string, date: string) =>
    slots.get(cellKey(employeeId, date))

  const used = new Map<string, UsedShift>()
  let short = 0
  for (const one of slots.values()) {
    if (one.plan !== "SCHEDULED") continue
    if (isShort(one)) short += 1
    if (one.shiftId !== null && !used.has(one.shiftId)) {
      used.set(one.shiftId, {
        id: one.shiftId,
        name: one.name ?? "Shift",
        starts: one.starts ?? "",
      })
    }
  }

  return {
    days,
    people,
    slot,
    minutesOf: (employeeId) =>
      days.reduce(
        (total, date) => total + (slot(employeeId, date)?.minutes ?? 0),
        0,
      ),
    working: (date, shiftId) =>
      people.filter((employeeId) => {
        const one = slot(employeeId, date)
        return (
          one?.plan === "SCHEDULED" &&
          (shiftId === undefined || one.shiftId === shiftId)
        )
      }).length,
    used: [...used.values()].sort(
      (left, right) =>
        left.starts.localeCompare(right.starts) ||
        left.name.localeCompare(right.name),
    ),
    short,
  }
}

// ── writing ─────────────────────────────────────────────────────────────────

/// One day to plan.
export interface Change {
  readonly employeeId: string
  readonly date: string
  readonly choice: Choice
  /// Required by the centre on every plan, first or revised.
  readonly reason: string
}

export interface Outcome {
  readonly saved: number
  readonly failed: readonly {
    readonly change: Change
    readonly error: unknown
  }[]
}

/// How many requests are in flight at once. Enough that a whole week for a
/// shop (seventy days) takes a few round trips, few enough that a slow line is
/// not asked for seventy things in the same breath.
const PARALLEL = 4

/// Plan a batch of days, and keep the grid truthful while it runs.
///
/// `pending` is what each day in the batch WILL be: the grid draws it at once,
/// dimmed, and drops it when the centre's rota has been read again — not when
/// the write returns, which would show the old plan for the moment between.
/// Days refused simply go back to what the centre says.
export function usePlanner() {
  const client = useQueryClient()
  const [pending, setPending] = useState<ReadonlyMap<string, Choice>>(
    () => new Map(),
  )
  const batch = useRef(0)
  /// Which batch last claimed a day, so a slow batch does not clear the
  /// pending write of a newer one on the same day.
  const claims = useRef(new Map<string, number>())

  const apply = useCallback(
    async (changes: readonly Change[]): Promise<Outcome> => {
      if (changes.length === 0) return { saved: 0, failed: [] }
      batch.current += 1
      const mine = batch.current
      const keys = changes.map((one) => cellKey(one.employeeId, one.date))
      keys.forEach((key) => claims.current.set(key, mine))
      setPending((previous) => {
        const next = new Map(previous)
        changes.forEach((one, index) => {
          next.set(keys[index] as string, one.choice)
        })
        return next
      })

      let saved = 0
      const failed: { change: Change; error: unknown }[] = []
      const queue = [...changes]
      const worker = async () => {
        for (let one = queue.shift(); one !== undefined; one = queue.shift()) {
          try {
            await planDay({
              employeeId: one.employeeId,
              onDate: one.date,
              plan: one.choice.plan,
              shiftId:
                one.choice.plan === "SCHEDULED"
                  ? one.choice.shift.id
                  : undefined,
              reason: one.reason,
            })
            saved += 1
          } catch (error) {
            failed.push({ change: one, error })
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL, changes.length) }, worker),
      )

      await client.invalidateQueries({
        queryKey: [CENTRAL_KEY_PREFIX, "hr", "roster"],
      })
      // What a day was can change what it amounted to.
      void client.invalidateQueries({ queryKey: hrKeys.attendance() })
      setPending((previous) => {
        const next = new Map(previous)
        for (const key of keys) {
          if (claims.current.get(key) === mine) {
            next.delete(key)
            claims.current.delete(key)
          }
        }
        return next
      })
      return { saved, failed }
    },
    [client],
  )

  return { pending, apply }
}
