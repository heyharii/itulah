/// The few pieces this module needs that `components/ui` does not have.
///
/// `Select` is `<Input>` with a caret, and the two mini-table helpers are the
/// row and cell that `<MiniTable>` deliberately leaves to the caller. They live
/// here rather than in `components/ui` because that directory is shared and
/// this module does not own it — see PATTERN.md. Nothing below invents a token,
/// a size or a colour.

import { Building2 } from "lucide-react"
import { useState } from "react"

import { DockChoice } from "@/components/shell/dock-tools"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { Segmented } from "@/components/ui/segmented"
import { SubTabs, type SubTab } from "@/components/ui/sub-tabs"
import { useLayout } from "@/lib/layout"
import { currentMonth, stepMonth } from "@/lib/queries/hr-time"
import {
  employerScope,
  useReach,
  useReachableUnits,
  type ReachableUnit,
} from "@/lib/queries/people"

/// The sections of a record inside a sheet. On a desk, the underlined tabs; on
/// a phone the same choice as pills that wrap, because a row of tabs that
/// scrolls sideways hides the sections past the edge. Never the dock's chip
/// (`SubTabs`' default on a phone): the dock sits behind the sheet.
export function SheetTabs({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly SubTab[]
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <div className="mb-[1.125rem]">
        <Segmented
          options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          value={value}
          onChange={onChange}
        />
      </div>
    )
  return <SubTabs tabs={tabs} value={value} onChange={onChange} dock={false} />
}

/// The months a phone's month chip offers: half a year back to a quarter
/// ahead, newest first, and the one on screen if it is further away than that.
export function monthOptions(selected: string): readonly string[] {
  const months = new Set<string>([selected])
  for (let by = -6; by <= 3; by += 1) months.add(stepMonth(currentMonth(), by))
  return [...months].sort().reverse()
}

/// A quiet sentence where a table would be, inside a sheet or a card.
///
/// Not `<EmptyState>`: that owns a whole card and 3.5rem of padding, which
/// inside a sheet tab reads as a broken panel rather than as an answer.
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-meta text-body">{children}</p>
}

/// Which unit a unit-shaped screen is about.
///
/// # Why this exists
///
/// The roster and the period close are screens about **one unit**, and both
/// took that unit from `reach.unit_id` — the caller's own posting. For a
/// store manager that is right and is the whole rule. For head office it was
/// wrong in a way nothing on the screen admitted: an HR officer posted to `ho`
/// was served head office's own roster and head office's own months, and no
/// control anywhere offered Store 01. `PEOPLE-BRIEF.md` says head office
/// *reads* the plan and *reopens* the month; it could do neither for any unit
/// but its own.
///
/// The server was never the limit. `GET /api/v1/roster` and
/// `GET /api/v1/attendance-periods` both take a unit and bound it by the
/// caller's reach, so head office could always have asked — the browser simply
/// never did.
///
/// # The default is the caller's own posting
///
/// So nothing moves for anybody who was already served the right unit, and
/// the picker is reach rather than a new decision to make on arrival. A
/// bounded caller gets no units from the server and therefore no control —
/// they were never choosing.
export function useUnit(): {
  /// The unit the screen is about, by id. `null` only while the reach is in
  /// flight, or for a caller posted nowhere.
  readonly unitId: string | null
  readonly setUnitId: (unitId: string) => void
  readonly units: readonly ReachableUnit[]
  /// What to call the unit on screen. The server's label for it, falling back
  /// to the id, and `null` while the reach is in flight.
  readonly name: string | null
  /// True for head office: the caller whose reach is every unit. This is the
  /// one to test for an *employer* act — reopening a month, approving a run —
  /// and never `choosing`, which is only about whether a picker is worth
  /// drawing. A node with one unit on it would make those two disagree, and
  /// the screen would hand head office the shop's own Close button.
  readonly employer: boolean
  /// True when there is more than one unit on offer, so a picker has work to
  /// do. Presentation, not permission.
  readonly choosing: boolean
} {
  const reach = useReach()
  const posted = reach.data?.unit_id ?? null
  const employer = employerScope(reach.data) === true
  const reachable = useReachableUnits()
  const [chosen, setChosen] = useState<string | null>(null)

  const offered = employer ? (reachable.data ?? []) : []
  /// Their own posting first, then the first unit on offer.
  ///
  /// The fallback is for head office proper: an HR officer whose login carries
  /// no employment record reaches everywhere and is posted nowhere, and the
  /// screens used to tell them "you are not posted anywhere, so there is no
  /// week to build" — true about them, and useless, because every week in the
  /// company was theirs to read. Landing on a real unit is the answer; the
  /// picker is how they get to the other thirteen.
  const unitId = chosen ?? posted ?? offered[0]?.id ?? null

  return {
    unitId,
    setUnitId: setChosen,
    units: offered,
    name:
      offered.find((one) => one.id === unitId)?.name ??
      reach.data?.unit_name ??
      unitId,
    employer,
    choosing: offered.length > 1,
  }
}

/// The picker itself, for a page header. Renders nothing when there is no
/// choice, so a call site needs no condition of its own.
export function UnitChoice({
  unitId,
  units,
  onChange,
}: {
  readonly unitId: string | null
  readonly units: readonly ReachableUnit[]
  readonly onChange: (unitId: string) => void
}) {
  const phone = useLayout() === "phone"
  if (units.length < 2) return null

  // On a phone the unit is the chip over the bottom bar and the sheet it opens
  // (one of a few, like a status), not a control at the top of the page.
  if (phone)
    return (
      // "Show": a unit narrows the screen to one of a few, so inside a door
      // it joins the door's button rather than standing beside it — the dock
      // holds four (owner, 2026-10-16).
      <DockChoice
        title="Show"
        value={unitId ?? ""}
        onChange={onChange}
        options={units.map((one) => ({
          value: one.id,
          label: `${one.name} · ${one.employees}`,
          short: one.name,
        }))}
      />
    )

  return (
    <ChoiceMenu
      heading="Unit"
      icon={Building2}
      value={unitId}
      options={units.map((one) => ({
        value: one.id,
        label: `${one.name} · ${one.employees}`,
      }))}
      // A unit-shaped screen has no "everywhere": one plan, one month, one
      // sign-off. `null` cannot be chosen, so it is never passed on.
      onChange={(next) => next !== null && onChange(next)}
    />
  )
}
