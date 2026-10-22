/// The few pieces this module needs that `components/ui` does not have.
///
/// `Select` is `<Input>` with a caret, and the two mini-table helpers are the
/// row and cell that `<MiniTable>` deliberately leaves to the caller. They live
/// here rather than in `components/ui` because that directory is shared and
/// this module does not own it — see PATTERN.md. Nothing below invents a token,
/// a size or a colour.

import { Building2 } from "lucide-react"
import { useSyncExternalStore } from "react"

import { DockChoice } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { SubTabs, type SubTab } from "@/components/ui/sub-tabs"
import { monthYear } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { currentMonth, monthTitle, stepMonth } from "@/lib/queries/hr-time"
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

// ── one unit and one month across HR ──────────────────────────────────────

/// The unit and the month HR's pages are narrowed to, held for the tab
/// rather than per screen (owner, 2026-10-17: the unit and period pickers
/// the same on every HR page). Choose Store 01 and October on Claims, open
/// Roster or Payslips, and they are still Store 01 and October.
///
/// `null` is "not chosen": a unit-shaped screen then reads the caller's own
/// posting, a list every unit it may see, and a month-shaped screen its own
/// default month. Written only by a click in the browser, so the server's
/// copy of this module never holds anybody's choice.
type HrContext = { readonly unit: string | null; readonly month: string | null }

const NOTHING_CHOSEN: HrContext = { unit: null, month: null }
const CONTEXT_KEY = "hr-context"
let chosen: HrContext = NOTHING_CHOSEN
let read = false
const listeners = new Set<() => void>()

function readChosen(): HrContext {
  if (!read && typeof window !== "undefined") {
    read = true
    try {
      const raw = JSON.parse(sessionStorage.getItem(CONTEXT_KEY) ?? "null")
      chosen = {
        unit: typeof raw?.unit === "string" ? raw.unit : null,
        month:
          typeof raw?.month === "string" && /^\d{4}-\d{2}$/.test(raw.month)
            ? raw.month
            : null,
      }
    } catch {
      chosen = NOTHING_CHOSEN
    }
  }
  return chosen
}

function choose(next: Partial<HrContext>) {
  chosen = { ...readChosen(), ...next }
  try {
    sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(chosen))
  } catch {
    // A private window keeps the choice for the page instead of the tab.
  }
  for (const listener of listeners) listener()
}

function useHrContext(): HrContext {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readChosen,
    () => NOTHING_CHOSEN
  )
}

/// The month an HR page is about: the one chosen on any HR page, or this
/// page's own default until somebody chooses.
export function useHrMonth(
  fallback: () => string = currentMonth
): readonly [string, (month: string) => void] {
  const month = useHrContext().month ?? fallback()
  return [month, (next: string) => choose({ month: next })]
}

/// The month, the same control on every HR page: on a desk the previous and
/// next month either side of its name (the name goes back to this month); on
/// a phone the chip over the bottom bar and its sheet of months.
export function MonthChoice({
  month,
  onChange,
}: {
  readonly month: string
  readonly onChange: (month: string) => void
}) {
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <DockChoice
        title="Month"
        value={month}
        onChange={onChange}
        options={monthOptions(month).map((value) => ({
          value,
          label: monthTitle(value),
          short: monthYear(value),
        }))}
      />
    )
  return (
    <ButtonGroup>
      <Button
        variant="ghost"
        aria-label="Previous month"
        onClick={() => onChange(stepMonth(month, -1))}
      >
        ‹
      </Button>
      <Button variant="ghost" onClick={() => onChange(currentMonth())}>
        {monthTitle(month)}
      </Button>
      <Button
        variant="ghost"
        aria-label="Next month"
        onClick={() => onChange(stepMonth(month, 1))}
      >
        ›
      </Button>
    </ButtonGroup>
  )
}

/// Which unit a list of many units' rows is narrowed to: `null` is every
/// unit the caller may see. Only head office is offered a choice — a
/// manager's lists are their own unit's already, bounded by the server — so
/// `units` is empty for them and `UnitFilter` draws nothing.
export function useUnitFilter(): {
  readonly unitId: string | null
  readonly setUnitId: (unitId: string | null) => void
  readonly units: readonly ReachableUnit[]
} {
  const reach = useReach()
  const employer = employerScope(reach.data) === true
  const reachable = useReachableUnits()
  const units = employer ? (reachable.data ?? []) : []
  const wanted = useHrContext().unit
  return {
    unitId:
      wanted !== null && units.some((one) => one.id === wanted) ? wanted : null,
    setUnitId: (unitId) => choose({ unit: unitId }),
    units,
  }
}

/// The unit, for a list: Every unit, then each unit on offer. The same look
/// as `UnitChoice`, with "everywhere" as its first choice.
export function UnitFilter({
  unitId,
  units,
  onChange,
}: {
  readonly unitId: string | null
  readonly units: readonly ReachableUnit[]
  readonly onChange: (unitId: string | null) => void
}) {
  const phone = useLayout() === "phone"
  if (units.length < 2) return null
  if (phone)
    return (
      <DockChoice
        title="Show"
        value={unitId ?? ""}
        onChange={(next) => onChange(next === "" ? null : next)}
        options={[
          { value: "", label: "Every unit", short: "Every unit" },
          ...units.map((one) => ({
            value: one.id,
            label: `${one.name} · ${one.employees}`,
            short: one.name,
          })),
        ]}
      />
    )
  return (
    <ChoiceMenu
      heading="Unit"
      icon={Building2}
      value={unitId}
      options={[
        { value: null, label: "Every unit" },
        ...units.map((one) => ({
          value: one.id,
          label: `${one.name} · ${one.employees}`,
        })),
      ]}
      onChange={onChange}
    />
  )
}

/// An HR page's bar: its unit and month first, then whatever else the page
/// narrows by. On a desk they are one row; on a phone the unit and the month
/// are chips over the bottom bar — the unit joins the door's button — and
/// only the rest goes into the Filters sheet, so the month is one tap away on
/// every HR page rather than two on some. Without anything else to narrow by
/// a phone draws no Filters button at all.
export function HrScope({
  unit,
  month,
  lead,
  children,
}: {
  readonly unit?: ReturnType<typeof useUnitFilter>
  readonly month?: readonly [string, (month: string) => void]
  /// The page's own tabs, as `Toolbar`'s `lead`.
  readonly lead?: React.ReactNode
  readonly children?: React.ReactNode
}) {
  const phone = useLayout() === "phone"
  const scope = (
    <>
      {unit !== undefined && (
        <UnitFilter
          unitId={unit.unitId}
          units={unit.units}
          onChange={unit.setUnitId}
        />
      )}
      {month !== undefined && (
        <MonthChoice month={month[0]} onChange={month[1]} />
      )}
    </>
  )
  // The bar draws a page's own tabs first and its Filter right after them
  // (by `order`); the unit and the month join the Filter's place, ahead of
  // it, so every HR bar reads tabs · unit · month · the rest.
  if (!phone)
    return (
      <Toolbar lead={lead}>
        <div className="contents [&>*]:-order-1">{scope}</div>
        {children}
      </Toolbar>
    )
  return (
    <>
      {scope}
      {(lead !== undefined || children !== undefined) && (
        <Toolbar lead={lead}>{children}</Toolbar>
      )}
    </>
  )
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
  const wanted = useHrContext().unit

  const offered = employer ? (reachable.data ?? []) : []
  /// The unit chosen on any HR page, while it is one on offer here.
  const chosenHere =
    wanted !== null && offered.some((one) => one.id === wanted) ? wanted : null
  /// Their own posting first, then the first unit on offer.
  ///
  /// The fallback is for head office proper: an HR officer whose login carries
  /// no employment record reaches everywhere and is posted nowhere, and the
  /// screens used to tell them "you are not posted anywhere, so there is no
  /// week to build" — true about them, and useless, because every week in the
  /// company was theirs to read. Landing on a real unit is the answer; the
  /// picker is how they get to the other thirteen.
  const unitId = chosenHere ?? posted ?? offered[0]?.id ?? null

  return {
    unitId,
    setUnitId: (next: string) => choose({ unit: next }),
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
