import { useQuery } from "@tanstack/react-query"
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { DockChoice, DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, EmptyState } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { useParam } from "@/lib/params"
import {
  addDays,
  isoDay,
  readDate,
  rosterQuery,
  shiftsQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import {
  cellKey,
  choiceOfRow,
  choiceOfSlot,
  choiceWord,
  daysBefore,
  daysOfWeek,
  isAlready,
  mondayOf,
  splitKey,
  usePlanner,
  weekSheet,
  type Change,
  type Choice,
  type Outcome,
} from "@/lib/queries/schedule"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { Heading } from "@/screens/hr/parts"
import { Board, type Lane } from "@/screens/hr/schedule-board"
import { Cards, Grid, type Picking } from "@/screens/hr/schedule-grid"
import { dayName, spanOf, tintsOf, weekRange } from "@/screens/hr/schedule-look"
import {
  ShiftPicker,
  type PickTarget,
  type Session,
} from "@/screens/hr/schedule-picker"
import { SwapSheet } from "@/screens/hr/swaps"
import {
  personByLogin,
  personName,
  usePendingSwaps,
  useTeam,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { RosterSwapView } from "@itulah/contract"

/// The week, per person — the prototype's store Schedule.
///
/// "Toko menyusun roster dari jenis shift HO": the shop builds its rota out of
/// head office's shift patterns, and cannot invent one. A press on a cell, a
/// name (their whole week) or a day heading (everyone that day) opens a small
/// picker where it landed, listing those shifts with their hours, a day off and
/// a public holiday; Shift- or Cmd-click adds cells to the selection first.
/// Each day it sets is one `POST /employees/{id}/roster` — a store head may
/// plan their own people — and every re-plan is kept as a revision, which the
/// centre counts and the cell marks (↻): a rota changed under somebody is a
/// governance signal rather than an edit.
///
/// # What the prototype had that the centre does not
///
///  - **Publish.** A plan is in force the moment it is saved; there is no
///    draft and no approval state, so there is no button for one.
///  - **Custom hours.** Shifts are head office's and global, so the picker has
///    none.
///  - **Taking a plan away.** A day can be revised, never removed, so Undo
///    puts a day back to what it was and is offered only when every day in the
///    batch HAD a plan (see `lib/queries/schedule.ts`).
///  - **8 hours a day.** Hari's rule, drawn in red where a shift falls under
///    it and counted over the grid; the centre does not know it.
///
/// "Same as last week" fills the days of this week that have no plan from the
/// same weekday of last week and touches nothing already planned — what the
/// centre's own weekly job does, on demand. It cannot overwrite: that would be
/// a revision of every day, each needing a reason.
///
/// Pending shift swaps sit over the grid, where the prototype puts them: they
/// are changes to the very week being read.
///
/// Seven days in one read — `GET /api/v1/roster?unit&from&to` — rather than
/// seven, because the centre answers a range and one request per day would be
/// seven chances for one of them to fail.
///
/// # The phone
///
/// A grid of seven columns does not fit a phone and nothing there scrolls
/// sideways, so the same week is one card per person — the name, the hours
/// planned as the figure, and their seven days as rows a thumb can land on —
/// with a last card for the cover. The week is the dock's choice (a sheet of
/// weeks), the view and "Same as last week" are rows of its ⚙ sheet, and the
/// picker rises from the bottom; on a desk they are the controls over the grid.
export function HrRoster() {
  return <HrWorkspace>{(scope) => <Roster scope={scope} />}</HrWorkspace>
}

type View = "person" | "shift"

const VIEWS = [
  { value: "person", label: "By person" },
  { value: "shift", label: "By shift" },
] as const

/// The weeks the dock offers: four back, six forward, and the one in the URL
/// when it is none of them.
function weekChoices(from: string, thisWeek: string) {
  const base = new Date(`${thisWeek}T00:00:00`)
  const starts = Array.from({ length: 11 }, (_, index) =>
    isoDay(addDays(base, (index - 4) * 7)),
  )
  if (!starts.includes(from)) starts.push(from)
  starts.sort()
  return starts.map((start) => {
    const away = Math.round(
      (new Date(`${start}T00:00:00`).getTime() - base.getTime()) /
        (7 * 86_400_000),
    )
    const near =
      away === 0
        ? "This week"
        : away === 1
          ? "Next week"
          : away === -1
            ? "Last week"
            : undefined
    return {
      value: start,
      label:
        near === undefined ? weekRange(start) : `${near} · ${weekRange(start)}`,
      short: near ?? weekRange(start),
    }
  })
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/// What went wrong with a batch, for the banner over the grid.
interface Failure {
  readonly count: number
  readonly error: unknown
}

function failureOf(outcome: Outcome): Failure | null {
  const first = outcome.failed[0]
  return first === undefined
    ? null
    : { count: outcome.failed.length, error: first.error }
}

function Roster({ scope }: { scope: StoreScope }) {
  const phone = useLayout() === "phone"
  const week = useParam("week")
  const thisWeek = isoDay(mondayOf(new Date()))
  const from = week.value ?? thisWeek
  const days = daysOfWeek(from)
  const to = days[6] as string
  const today = isoDay(new Date())
  const lastDays = daysBefore(from)

  const roster = useQuery(rosterQuery(scope.unit_id, from, to))
  // Last week, for "Same as last week".
  const last = useQuery(
    rosterQuery(scope.unit_id, lastDays[0] as string, lastDays[6] as string),
  )
  const team = useTeam(scope)
  const catalogue = useQuery(shiftsQuery())
  const swaps = usePendingSwaps(scope)
  const planner = usePlanner()

  const [view, setView] = useState<View>("person")
  /// The days the picker is open for — `date|employee` keys.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [session, setSession] = useState<Session | null>(null)
  const [swap, setSwap] = useState<RosterSwapView | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const serial = useRef(0)

  const shiftList = catalogue.data ?? []
  const tint = tintsOf(shiftList)
  const sheet = weekSheet({
    days,
    rows: roster.data ?? [],
    pending: planner.pending,
    active: (team.data?.rows ?? [])
      .filter((person) => person.status === "ACTIVE")
      .map((person) => person.employee_id),
  })

  const closeAll = () => {
    setSession(null)
    setSelected(new Set())
  }
  const go = (next: string | undefined) => {
    closeAll()
    week.set(next)
  }
  const move = (by: number) =>
    go(isoDay(addDays(new Date(`${from}T00:00:00`), by)))
  // One line for the Schedule: a new change replaces the last and restarts
  // its clock — long enough to read a sentence and reach for Undo.
  const say = (text: string, undo?: () => void) =>
    toast(text, {
      id: "hr-schedule",
      duration: 7000,
      action: undo === undefined ? undefined : { label: "Undo", onClick: undo },
    })
  const asked = swaps.data?.rows ?? []

  // ── aiming the picker ─────────────────────────────────────────────────────

  const targetsOf = (keys: ReadonlySet<string>): PickTarget[] =>
    [...keys].map(splitKey).map(({ employeeId, date }) => ({
      employeeId,
      date,
      slot: sheet.slot(employeeId, date),
    }))

  /// What the picker says under its title when it is open for one day: who
  /// planned it, and that it was changed since.
  const captionOf = (targets: readonly PickTarget[]): string | undefined => {
    const one = targets.length === 1 ? targets[0] : undefined
    const slot = one?.slot
    if (slot === undefined || slot.saving) return undefined
    const again =
      slot.revisions > 1
        ? ` · re-planned ${plural(slot.revisions - 1, "time")}`
        : ""
    return `Planned by ${personByLogin(team.data, slot.plannedBy)}${again}`
  }

  const aim = (
    anchor: HTMLElement,
    keys: ReadonlySet<string>,
    title: string,
    more: boolean,
  ) => {
    if (keys.size === 0) {
      closeAll()
      return
    }
    // A shift-press keeps the popup where it is; a plain one draws it afresh
    // at the new target.
    if (!more || session === null) serial.current += 1
    const targets = targetsOf(keys)
    setSelected(keys)
    setSession({
      kind: "set",
      anchor,
      title,
      caption: captionOf(targets),
      serial: serial.current,
      targets,
    })
  }

  const picking: Picking = {
    selected,
    onCell: (event, employeeId, date) => {
      const key = cellKey(employeeId, date)
      const more = event.shiftKey || event.metaKey || event.ctrlKey
      const keys = more ? toggled(selected, key) : new Set([key])
      aim(
        event.currentTarget,
        keys,
        keys.size > 1
          ? plural(keys.size, "day")
          : `${personName(team.data, employeeId)} · ${readDate(date, true)}`,
        more,
      )
    },
    onPerson: (event, employeeId) =>
      aim(
        event.currentTarget,
        new Set(days.map((date) => cellKey(employeeId, date))),
        `${personName(team.data, employeeId)} · whole week`,
        false,
      ),
    onDay: (event, date) =>
      aim(
        event.currentTarget,
        new Set(sheet.people.map((employeeId) => cellKey(employeeId, date))),
        `Everyone · ${readDate(date, true)}`,
        false,
      ),
  }

  /// The board's "+": who could go on this shift this day.
  const onAdd = (
    event: React.MouseEvent<HTMLElement>,
    date: string,
    lane: Lane,
  ) => {
    // A shift head office has retired cannot take anybody new.
    const shift = shiftList.find((one) => one.id === lane.id)
    if (shift === undefined) return
    serial.current += 1
    setSelected(new Set())
    setSession({
      kind: "add",
      anchor: event.currentTarget,
      title: `Add to ${shift.name}`,
      caption: `${spanOf(shift)} · ${readDate(date, true)}`,
      serial: serial.current,
      shift,
      date,
      people: sheet.people
        .map((employeeId) => ({
          employeeId,
          name: personName(team.data, employeeId),
          slot: sheet.slot(employeeId, date),
        }))
        .filter(
          (one) => one.slot === undefined || one.slot.plan !== "SCHEDULED",
        ),
    })
  }

  // ── writing ───────────────────────────────────────────────────────────────

  const take = (outcome: Outcome) => setFailure(failureOf(outcome))

  /// Put the days back as they were: a revision each, filed as such.
  const undo = async (changes: readonly Change[], back: readonly Choice[]) => {
    const outcome = await planner.apply(
      changes.map((one, index) => ({
        employeeId: one.employeeId,
        date: one.date,
        choice: back[index] as Choice,
        reason: "Change taken back",
      })),
    )
    take(outcome)
  }

  const apply = async (
    targets: readonly PickTarget[],
    choice: Choice,
    why: string,
  ) => {
    const moving = targets.filter((one) => !isAlready(one.slot, choice))
    closeAll()
    if (moving.length === 0) return
    setFailure(null)
    // A first plan is filed as the weekly rota; a revision carries the
    // sentence the person gave.
    const reason = why.trim() === "" ? "Weekly rota" : why.trim()
    const changes: Change[] = moving.map((one) => ({
      employeeId: one.employeeId,
      date: one.date,
      choice,
      reason,
    }))
    // What each day was, to go back to. Undo is only honest when every day had
    // a plan: the centre cannot unplan one.
    const back = moving.map((one) => choiceOfSlot(one.slot, shiftList))
    const outcome = await planner.apply(changes)
    take(outcome)

    const first = moving[0]
    const text =
      outcome.failed.length > 0
        ? `${outcome.saved} of ${plural(changes.length, "day")} saved`
        : moving.length === 1 && first !== undefined
          ? `${personName(team.data, first.employeeId)} · ${dayName(first.date)} set to ${choiceWord(choice)}`
          : `${plural(moving.length, "day")} set to ${choiceWord(choice)}`
    const restorable = back.every((one): one is Choice => one !== null)
    say(
      text,
      outcome.failed.length === 0 && restorable
        ? () => void undo(changes, back as Choice[])
        : undefined,
    )
  }

  /// Days of this week with no plan whose weekday last week had one.
  const fillable: Change[] = []
  if (last.data !== undefined) {
    const before = new Map(
      last.data.map((row) => [cellKey(row.employee_id, row.on_date), row]),
    )
    for (const employeeId of sheet.people) {
      days.forEach((date, index) => {
        if (sheet.slot(employeeId, date) !== undefined) return
        const source = before.get(
          cellKey(employeeId, lastDays[index] as string),
        )
        const choice =
          source === undefined ? null : choiceOfRow(source, shiftList)
        if (choice === null) return
        fillable.push({
          employeeId,
          date,
          choice,
          reason: "Same as last week",
        })
      })
    }
  }

  const copy = async () => {
    closeAll()
    setFailure(null)
    const outcome = await planner.apply(fillable)
    take(outcome)
    // No Undo: these days had no plan, and a day cannot be unplanned.
    say(
      outcome.saved === 0
        ? "Nothing was copied"
        : `Copied ${plural(outcome.saved, "day")} from last week`,
    )
  }

  return (
    <>
      {/* The phone's week: a chip over the bottom bar, a sheet of weeks. */}
      <DockChoice
        title="Week"
        value={from}
        options={weekChoices(from, thisWeek)}
        onChange={(next) => go(next === thisWeek ? undefined : next)}
      />
      <DockTools
        views={[
          {
            title: "View",
            value: view,
            options: VIEWS,
            onChange: (next) => setView(next as View),
          },
        ]}
        actions={
          fillable.length > 0
            ? [{ label: "Same as last week", onClick: () => void copy() }]
            : undefined
        }
      />

      <StatStrip>
        <Stat
          label="Working today"
          value={
            roster.data === undefined || !days.includes(today)
              ? "—"
              : sheet.working(today)
          }
        />
        <Stat
          label="Planned this week"
          value={
            roster.data === undefined
              ? "—"
              : sheet.people.filter((id) => sheet.minutesOf(id) > 0).length
          }
        />
        <Stat
          label="Shifts under 8 hours"
          value={roster.data === undefined ? "—" : sheet.short}
          tone={sheet.short > 0 ? "bad" : undefined}
        />
        <Stat
          label="Swap requests"
          value={swaps.data === undefined ? "—" : asked.length}
          tone={asked.length > 0 ? "warn" : undefined}
        />
      </StatStrip>

      {asked.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-warn-fg/25 bg-warn-bg/50 px-3.5 py-2">
          <ArrowLeftRight className="mt-3 size-4 shrink-0 text-warn-fg" />
          <ul className="flex min-w-0 flex-1 flex-col">
            {asked.map((one) => (
              <li key={one.id}>
                <button
                  type="button"
                  onClick={() => setSwap(one)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-meta text-warn-fg"
                >
                  <span className="min-w-0">
                    {personName(team.data, one.employee_id)} asks to swap with{" "}
                    {personName(team.data, one.with_employee_id)} ·{" "}
                    {readDate(one.on_date, true)}
                  </span>
                  <span className="shrink-0 font-semibold">Review</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The desk's week: the range, the view, the copy, and the arrows. */}
      <div className="max-md:hidden">
        <Heading
          action={
            <div className="flex items-center gap-1.5">
              <Segmented
                options={VIEWS}
                value={view}
                onChange={setView}
                className="mr-1.5"
              />
              <Button
                disabled={fillable.length === 0}
                title={fillable.length === 0 ? "Nothing to copy" : undefined}
                onClick={() => void copy()}
              >
                Same as last week
              </Button>
              {from !== thisWeek && (
                <Button variant="quiet" onClick={() => go(undefined)}>
                  This week
                </Button>
              )}
              <Button
                size="icon"
                aria-label="The week before"
                onClick={() => move(-7)}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                aria-label="The week after"
                onClick={() => move(7)}
              >
                <ChevronRight />
              </Button>
            </div>
          }
        >
          {readDate(from)} – {readDate(to)}
        </Heading>
      </div>

      {failure !== null && (
        <Banner tone="bad" className="mb-4" onDismiss={() => setFailure(null)}>
          {plural(failure.count, "day")} could not be saved.{" "}
          {describeCentre(failure.error)}
        </Banner>
      )}

      {centreState(roster, {
        loading: "Reading the rota…",
        what: "this shop's rota",
        render: () =>
          sheet.people.length === 0 ? (
            <EmptyState>Nobody is rostered this week.</EmptyState>
          ) : view === "shift" ? (
            <Board
              week={sheet}
              today={today}
              team={team.data}
              shifts={shiftList}
              tint={tint}
              picking={picking}
              onAdd={onAdd}
            />
          ) : phone ? (
            <Cards
              week={sheet}
              today={today}
              team={team.data}
              picking={picking}
            />
          ) : (
            <Grid
              week={sheet}
              today={today}
              team={team.data}
              tint={tint}
              picking={picking}
              plannedBy={(login) => personByLogin(team.data, login)}
            />
          ),
      })}

      <ShiftPicker
        session={session}
        phone={phone}
        catalogue={shiftList}
        onApply={(targets, choice, why) => void apply(targets, choice, why)}
        onClose={closeAll}
      />
      {swap !== null && (
        <SwapSheet
          key={swap.id}
          swap={swap}
          team={team.data}
          onClose={() => setSwap(null)}
        />
      )}
    </>
  )
}
