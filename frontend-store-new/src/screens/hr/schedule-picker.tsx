import { Popover } from "@base-ui/react/popover"
import { Check, ChevronLeft, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { readMinutes } from "@/lib/queries/hr"
import {
  byStart,
  isAlready,
  MIN_WORK_MINUTES,
  type Choice,
  type Slot,
} from "@/lib/queries/schedule"
import { POP_MOTION } from "@/lib/popup-chrome"
import { cn } from "@/lib/utils"
import { OFF_HATCH, spanOf, tintsOf } from "@/screens/hr/schedule-look"
import type { ShiftView } from "@itulah/contract"

/// The shift picker: where a plan is made.
///
/// Prototype `openSpop`: a small popup that opens WHERE YOU CLICKED — a cell, a
/// name (their whole week), a day (everyone that day) — listing head office's
/// shifts with their hours, Off, and applying at once. Not a bar at the foot of
/// the page: the hand is already on the cell.
///
/// # Two backend rules the prototype did not have
///
///  - Shifts are head office's and global, so there is no "Custom" hours row;
///    the picker lists the catalogue and a day off or a public holiday, which
///    are the three things the centre can plan.
///  - Every plan carries a **Why**, and a revision (a day that already has a
///    plan) is a governance signal at the centre. A first plan needs no
///    sentence asked for — it is filed as "Weekly rota" — but changing a day
///    that is planned asks one, in a second step of the same popup. Choosing
///    comes first and justifying second, so the common path stays one click.
///
/// On a phone the same content rises from the bottom as a sheet (a thumb does
/// not reach a popup hanging off a row in the middle of the glass).

/// One day to plan, with what it is now.
export interface PickTarget {
  readonly employeeId: string
  readonly date: string
  readonly slot: Slot | undefined
}

/// Somebody who could be added to a shift on a day.
export interface Candidate {
  readonly employeeId: string
  readonly name: string
  readonly slot: Slot | undefined
}

interface Anchored {
  /// What the popup hangs off.
  readonly anchor: HTMLElement
  readonly title: string
  readonly caption?: string
  /// Changes when a plain press lands on another target, so the popup is
  /// drawn afresh there; a shift-press keeps it, and its step, as it is.
  readonly serial: number
}

/// What the picker is open for: the days a choice would be applied to, or a
/// shift looking for somebody to put on it.
export type Session =
  | (Anchored & {
      readonly kind: "set"
      readonly targets: readonly PickTarget[]
    })
  | (Anchored & {
      readonly kind: "add"
      readonly shift: ShiftView
      readonly date: string
      readonly people: readonly Candidate[]
    })

export function ShiftPicker({
  session,
  phone,
  catalogue,
  onApply,
  onClose,
}: {
  /// `null` while it is closed; the last one is kept for the way out, so the
  /// popup leaves with the content it had instead of emptying as it goes.
  session: Session | null
  phone: boolean
  catalogue: readonly ShiftView[]
  onApply: (targets: readonly PickTarget[], choice: Choice, why: string) => void
  onClose: () => void
}) {
  const [kept, setKept] = useState<Session | null>(session)
  if (session !== null && session !== kept) setKept(session)
  const shown = session ?? kept
  if (shown === null) return null

  const body =
    shown.kind === "set" ? (
      <SetBody
        key={shown.targets.map((one) => `${one.date}|${one.employeeId}`).join()}
        targets={shown.targets}
        catalogue={catalogue}
        onApply={onApply}
      />
    ) : (
      <AddBody key={shown.serial} session={shown} onApply={onApply} />
    )

  if (phone) {
    return (
      <BottomSheet
        open={session !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={shown.title}
      >
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
          {shown.caption !== undefined && (
            <p className="-mt-1 mb-3 text-[0.875rem] text-mute">
              {shown.caption}
            </p>
          )}
          {body}
        </div>
      </BottomSheet>
    )
  }

  return (
    <Popover.Root
      key={shown.serial}
      open={session !== null}
      onOpenChange={(open, details) => {
        if (open) return
        // A press on another cell is not a dismissal: the click that follows
        // re-aims this popup (or adds to the selection, with shift held).
        if (details.reason === "outside-press") {
          const target = details.event.target
          if (
            target instanceof Element &&
            target.closest("[data-pick-target]")
          ) {
            details.cancel()
            return
          }
        }
        onClose()
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={shown.anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            className={cn(
              "flex max-h-[min(32rem,var(--available-height))] w-[19rem] max-w-[calc(100vw-1rem)] flex-col gap-2.5 overflow-y-auto rounded-card border border-hairline bg-canvas p-3 shadow-pop outline-none",
              POP_MOTION,
            )}
          >
            <div className="flex flex-col px-0.5">
              <Popover.Title className="text-cell font-semibold text-ink">
                {shown.title}
              </Popover.Title>
              {shown.caption !== undefined && (
                <span className="text-[0.875rem] text-mute">
                  {shown.caption}
                </span>
              )}
            </div>
            {body}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ── choosing ────────────────────────────────────────────────────────────────

function SetBody({
  targets,
  catalogue,
  onApply,
}: {
  targets: readonly PickTarget[]
  catalogue: readonly ShiftView[]
  onApply: (targets: readonly PickTarget[], choice: Choice, why: string) => void
}) {
  const [chosen, setChosen] = useState<Choice | null>(null)
  const ordered = [...catalogue].sort(byStart)
  const tint = tintsOf(catalogue)
  const anyShort = ordered.some(
    (shift) => shift.planned_work_minutes < MIN_WORK_MINUTES,
  )

  const moving = (choice: Choice) =>
    targets.filter((one) => !isAlready(one.slot, choice))
  /// Whether a choice is already what every one of the days is.
  const current = (choice: Choice) =>
    targets.length > 0 && moving(choice).length === 0

  const commit = (choice: Choice) => {
    // A day that already has a plan is a revision, and a revision is asked
    // for with a reason; a first plan is not.
    if (moving(choice).some((one) => one.slot !== undefined)) {
      setChosen(choice)
      return
    }
    onApply(targets, choice, "")
  }

  if (chosen !== null) {
    const revised = moving(chosen).filter((one) => one.slot !== undefined)
    return (
      <WhyStep
        headline={
          chosen.plan === "SCHEDULED"
            ? `${chosen.shift.name} ${spanOf(chosen.shift)}`
            : chosen.plan === "REST_DAY"
              ? "Day off"
              : "Public holiday"
        }
        hint={
          revised.length === 1
            ? "Changes a day that is already planned."
            : `Changes ${revised.length} days that are already planned.`
        }
        onBack={() => setChosen(null)}
        onSave={(why) => onApply(targets, chosen, why)}
      />
    )
  }

  return (
    <>
      {ordered.length === 0 ? (
        <p className="px-0.5 text-[0.875rem] text-mute">
          No shifts yet. Head office sets them.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {ordered.map((shift) => {
            const choice: Choice = { plan: "SCHEDULED", shift }
            const short = shift.planned_work_minutes < MIN_WORK_MINUTES
            const here = current(choice)
            return (
              <button
                key={shift.id}
                type="button"
                aria-pressed={here}
                onClick={() => commit(choice)}
                className={cn(
                  "relative flex min-w-0 flex-col items-start rounded-inner px-3 py-1.5 text-left leading-[1.25] ring-1 ring-black/5 transition-[scale,box-shadow] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] pointer-coarse:min-h-11",
                  tint(shift.id),
                  here && "ring-2 ring-accent",
                )}
              >
                <b className="max-w-full truncate text-cell font-semibold text-ink">
                  {shift.name}
                </b>
                <span className="text-[0.875rem] text-body tabular-nums">
                  {spanOf(shift)}
                </span>
                {short && (
                  <span className="text-[0.875rem] font-semibold text-bad-fg tabular-nums">
                    {readMinutes(shift.planned_work_minutes)}
                  </span>
                )}
                {here && (
                  <Check className="absolute top-2 right-2 size-3.5 text-accent" />
                )}
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <OffButton
          label="Day off"
          here={current({ plan: "REST_DAY" })}
          onClick={() => commit({ plan: "REST_DAY" })}
          hatched
        />
        <OffButton
          label="Public holiday"
          here={current({ plan: "PUBLIC_HOLIDAY" })}
          onClick={() => commit({ plan: "PUBLIC_HOLIDAY" })}
        />
      </div>
      {anyShort && (
        <p className="px-0.5 text-[0.875rem] text-bad-fg">
          Red: under 8 hours worked
        </p>
      )}
      <p className="px-0.5 text-[0.875rem] text-mute max-md:hidden pointer-coarse:hidden">
        Shift-click to pick more days
      </p>
    </>
  )
}

function OffButton({
  label,
  here,
  hatched,
  onClick,
}: {
  label: string
  here: boolean
  hatched?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={here}
      onClick={onClick}
      className={cn(
        "relative flex min-h-9 items-center rounded-inner px-3 text-left text-cell font-semibold text-ink ring-1 ring-black/5 transition-[scale,box-shadow] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] pointer-coarse:min-h-11",
        hatched === true ? OFF_HATCH : "bg-warn-bg",
        here && "ring-2 ring-accent",
      )}
    >
      {label}
      {here && (
        <Check className="absolute top-2 right-2 size-3.5 text-accent" />
      )}
    </button>
  )
}

// ── adding to a shift ───────────────────────────────────────────────────────

/// The board's "+": who could be put on this shift this day.
function AddBody({
  session,
  onApply,
}: {
  session: Extract<Session, { kind: "add" }>
  onApply: (targets: readonly PickTarget[], choice: Choice, why: string) => void
}) {
  const [person, setPerson] = useState<Candidate | null>(null)
  const choice: Choice = { plan: "SCHEDULED", shift: session.shift }
  const targetOf = (one: Candidate): PickTarget => ({
    employeeId: one.employeeId,
    date: session.date,
    slot: one.slot,
  })

  if (person !== null) {
    return (
      <WhyStep
        headline={person.name}
        hint="Changes a day that is already planned."
        onBack={() => setPerson(null)}
        onSave={(why) => onApply([targetOf(person)], choice, why)}
      />
    )
  }

  if (session.people.length === 0) {
    return (
      <p className="px-0.5 text-[0.875rem] text-mute">
        Everyone is already on a shift.
      </p>
    )
  }

  return (
    <ul className="flex flex-col">
      {session.people.map((one) => (
        <li key={one.employeeId}>
          <button
            type="button"
            onClick={() =>
              one.slot === undefined
                ? onApply([targetOf(one)], choice, "")
                : setPerson(one)
            }
            className="flex min-h-10 w-full items-center gap-2 rounded-inner px-2.5 text-left transition-colors duration-(--t-hover) hover:bg-soft-2 pointer-coarse:min-h-11"
          >
            <span className="min-w-0 flex-1 truncate text-cell text-ink">
              {one.name}
            </span>
            {one.slot !== undefined && (
              <span className="shrink-0 text-[0.875rem] text-mute">
                {one.slot.plan === "REST_DAY" ? "Day off" : "Holiday"}
              </span>
            )}
            <Plus className="size-4 shrink-0 text-accent" />
          </button>
        </li>
      ))}
    </ul>
  )
}

// ── the sentence ────────────────────────────────────────────────────────────

/// The second step of a revision: the centre keeps every plan with the reason
/// it was made for, and a changed day is asked for one.
function WhyStep({
  headline,
  hint,
  onBack,
  onSave,
}: {
  headline: string
  hint: string
  onBack: () => void
  onSave: (why: string) => void
}) {
  const [why, setWhy] = useState("")
  const blank = why.trim() === ""
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!blank) onSave(why.trim())
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex min-h-8 items-center gap-1 self-start rounded-inner pr-2 text-cell font-semibold text-ink transition-colors duration-(--t-hover) hover:bg-soft-2 pointer-coarse:min-h-11"
      >
        <ChevronLeft className="size-4 text-line-ico" />
        {headline}
      </button>
      <Input
        autoFocus
        aria-label="Why"
        placeholder="Why change it?"
        value={why}
        onChange={(event) => setWhy(event.target.value)}
      />
      <p className="px-0.5 text-[0.875rem] text-mute">{hint}</p>
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary" disabled={blank}>
          Save
        </Button>
      </div>
    </form>
  )
}
