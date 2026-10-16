import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Send } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import {
  adjustmentsQuery,
  attendanceOf,
  hrKeys,
  payComponentsQuery,
  type StoreScope,
} from "@/lib/queries/hr"
import {
  assessed,
  batchSent,
  cancelLines,
  factsSpan,
  monthFacts,
  payMonths,
  refileLines,
  storeLines,
  type PayLine,
} from "@/lib/queries/payroll"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { AdjustDialog, type AdjustTarget } from "@/screens/hr/pay-adjust"
import { PayCard } from "@/screens/hr/pay-card"
import { DockMonth, MonthStepper } from "@/screens/hr/pay-month"
import { RefusedBanner } from "@/screens/hr/refused"
import { teamRows, useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  PayComponentView,
  PayrollAdjustmentRow,
} from "@itulah/contract"

/// Payroll, for a shop — each person's month as a card, the shop's own
/// adjustments on it, and the month sent to head office.
///
/// The owner's design (`store-money-prototype.html`, `renderPay`): pay is
/// worked out at head office from HO's components, and the shop never sees
/// them. A card is a person — name, role, the month's days, lateness and
/// absences — with their total on the right; its foot is what the SHOP added
/// or took off, each line in its own words, and "Adjust" / "Cancel
/// adjustment". "Send to HO" sends the month once, inside a window head office
/// sets; earlier months are stepped back through and read, not changed.
///
/// # What is real here
///
/// Everything drawn is read from the centre; nothing is made up to fill the
/// prototype's shape (`lib/queries/payroll.ts` has the whole mapping):
///
///  - the days, the lateness and the absences are each person's derived
///    attendance over the calendar month, up to today;
///  - the lines are the month's one-offs this shop filed, and Adjust and
///    Cancel adjustment file and withdraw them;
///  - the total is a dash, because the centre does not relay a person's pay
///    to a shop;
///  - "Sent to HO" is said only when a one-off of the month is no longer
///    withdrawable, which is the centre saying its batch was submitted — and
///    with no date, because the date is the run's, and the run is not relayed;
///  - "Send to HO" is drawn where the prototype draws it, and stays off: the
///    centre relays no submission and has no sending window, and the line
///    under it says so.
///
/// # The phone
///
/// The month is the dock's stepper and "Send to HO" the dock's button, at the
/// thumb; the cards are the page. On a desk both sit in the bar over the cards.
export function HrPay() {
  return <HrWorkspace>{(scope) => <Payroll scope={scope} />}</HrWorkspace>
}

function Payroll({ scope }: { scope: StoreScope }) {
  const [today] = useState(() => new Date())
  const months = payMonths(today)
  const current = months[months.length - 1] ?? ""
  const [period, setPeriod] = useState(current)

  const team = useTeam(scope)
  const adjustments = useQuery(adjustmentsQuery(scope.unit_id, period))
  // Read with the page rather than when Adjust is pressed, so the dialog opens
  // with its components already there. The same key the Employment changes
  // form reads.
  const catalogue = useQuery(payComponentsQuery())

  const sent = adjustments.isSuccess && batchSent(adjustments.data)
  // Only this month is the shop's to change, as in the prototype: an earlier
  // month is one the shop has sent, or one it can no longer tell about.
  const open = period === current && adjustments.isSuccess && !sent

  // Figures for the month, from the two reads the screen already makes.
  const adjusted = adjustments.data
  const month =
    team.data === undefined || adjusted === undefined
      ? undefined
      : peopleOf(team.data, adjusted).map((person) => ({
          id: person.id,
          lines: storeLines(adjusted, person.id).length,
        }))

  return (
    <>
      <StatStrip>
        <Stat label="People" value={month === undefined ? "—" : month.length} />
        <Stat
          label="With adjustments"
          value={
            month === undefined
              ? "—"
              : month.filter((person) => person.lines > 0).length
          }
        />
        <Stat
          label="Adjustment lines"
          value={
            month === undefined
              ? "—"
              : month.reduce((sum, person) => sum + person.lines, 0)
          }
        />
      </StatStrip>
      <DockMonth months={months} value={period} onChange={setPeriod} />
      {open && (
        // Off, like the desk's (see `Standing`). The press does nothing
        // because there is nothing at the centre for it to do.
        <Fab
          label="Send to HO"
          icon={Send}
          disabled
          onClick={() => undefined}
        />
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3 max-md:hidden">
        <MonthStepper months={months} value={period} onChange={setPeriod} />
        <span className="flex-1" />
        {open && (
          <Button variant="primary" disabled>
            <Send />
            Send to HO
          </Button>
        )}
      </div>
      <Standing sent={sent} />

      {centreState(team, {
        loading: "Reading who works here…",
        what: "this shop's people",
        render: (people) =>
          centreState(adjustments, {
            loading: "Reading the month…",
            what: "this shop's adjustments",
            render: (rows) => (
              <Cards
                // A different month is a different list: what was flashing
                // or waiting to be undone belongs to the one left behind.
                key={period}
                scope={scope}
                period={period}
                today={today}
                team={people}
                rows={rows}
                open={open}
                catalogue={
                  catalogue.isError
                    ? catalogue.error
                    : (catalogue.data ?? undefined)
                }
              />
            ),
          }),
      })}
    </>
  )
}

/// Whether the month has gone to head office.
function Standing({ sent }: { sent: boolean }) {
  if (!sent) return null
  return (
    <div className="mb-3.5">
      <Pill tone="ok" withDot>
        Sent to HO
      </Pill>
    </div>
  )
}

/// The month's cards, one per person.
function Cards({
  scope,
  period,
  today,
  team,
  rows,
  open,
  catalogue,
}: {
  scope: StoreScope
  period: string
  today: Date
  team: EmployeeList
  rows: PayrollAdjustmentRow[]
  open: boolean
  catalogue: readonly PayComponentView[] | Error | undefined
}) {
  const client = useQueryClient()
  const key = hrKeys.adjustments(scope.unit_id, period)
  const people = peopleOf(team, rows)
  const span = factsSpan(period, today)
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.attendanceOf(person.id, span.from, span.to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceOf(person.id, span.from, span.to, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  const backed = assessed(reads.map((read) => read.data))

  // The card that just changed, lit for a moment.
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null)
  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), 900)
    return () => window.clearTimeout(timer)
  }, [flash])

  // The lines a "Cancel adjustment" took off, offered back for a while: there
  // is no toast in this app, so the card that was cancelled says so itself.
  const [undo, setUndo] = useState<{
    employeeId: string
    lines: readonly PayLine[]
  } | null>(null)
  useEffect(() => {
    if (undo === null) return
    const timer = window.setTimeout(() => setUndo(null), 8000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const cancel = useMutation({
    mutationFn: (employeeId: string) =>
      cancelLines({ place: scope.unit_id, period, employeeId }),
    onSuccess: ({ rows: after, cancelled }, employeeId) => {
      client.setQueryData(key, after)
      if (cancelled.length > 0) setUndo({ employeeId, lines: cancelled })
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
  // Putting them back is filing them again, as new one-offs with the same
  // component, total and words.
  const restore = useMutation({
    mutationFn: (gone: { employeeId: string; lines: readonly PayLine[] }) =>
      refileLines({
        place: scope.unit_id,
        period,
        employeeId: gone.employeeId,
        lines: gone.lines,
      }),
    onSuccess: (after, gone) => {
      client.setQueryData(key, after)
      setUndo(null)
      setFlash({ id: gone.employeeId, at: Date.now() })
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })

  // Adjust: who it is open on, and whether it is open. The target outlives the
  // closing so the dialog has something to show while it fades.
  const [target, setTarget] = useState<AdjustTarget | null>(null)
  const [adjusting, setAdjusting] = useState(false)

  if (people.length === 0) {
    return <EmptyState>Nobody is posted here.</EmptyState>
  }

  return (
    <>
      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="this month's attendance" />
      )}
      <div className="flex flex-col gap-3">
        {people.map((person, index) => {
          const read = reads[index]
          const lines = storeLines(rows, person.id)
          const facts = read?.data === undefined ? null : monthFacts(read.data)
          const cancelling = cancel.isPending && cancel.variables === person.id
          const restoring =
            restore.isPending && restore.variables?.employeeId === person.id
          const failed =
            cancel.isError && cancel.variables === person.id
              ? cancel.error
              : restore.isError && restore.variables?.employeeId === person.id
                ? restore.error
                : null
          return (
            <PayCard
              key={person.id}
              title={person.name}
              line={[
                person.role,
                facts === null
                  ? read?.isPending === true
                    ? "…"
                    : null
                  : backed
                    ? `${days(facts.worked)} · late ${facts.late}× · ${facts.absent} absent`
                    : `${facts.rostered} rostered · not assessed`,
              ]
                .filter((part) => part !== null && part !== "")
                .join(" · ")}
              // A person's pay is HO's and is not relayed to a shop.
              total={null}
              lines={lines}
              editable={open}
              cancelled={undo?.employeeId === person.id && lines.length === 0}
              flash={flash?.id === person.id}
              busy={cancelling ? "cancel" : restoring ? "undo" : null}
              problem={failed === null ? null : describeCentre(failed)}
              onAdjust={() => {
                setUndo((was) => (was?.employeeId === person.id ? null : was))
                setTarget({
                  seq: (target?.seq ?? 0) + 1,
                  employeeId: person.id,
                  name: person.name,
                  total: null,
                  lines,
                })
                setAdjusting(true)
              }}
              onCancel={() => cancel.mutate(person.id)}
              onUndo={() => {
                if (undo !== null) restore.mutate(undo)
              }}
            />
          )
        })}
      </div>
      <AdjustDialog
        open={adjusting}
        onClose={() => setAdjusting(false)}
        onSaved={(employeeId) => {
          setAdjusting(false)
          setFlash({ id: employeeId, at: Date.now() })
        }}
        scope={scope}
        period={period}
        target={target}
        catalogue={catalogue}
      />
    </>
  )
}

/// Who gets a card: everybody on this shop's books, and anybody the month's
/// rows name who is not — somebody who has left still has the month they
/// worked.
function peopleOf(
  team: EmployeeList,
  rows: readonly PayrollAdjustmentRow[],
): { id: string; name: string; role: string | null }[] {
  const people = teamRows(team)
    .filter((person) => person.status === "ACTIVE")
    .map((person) => ({
      id: person.employee_id,
      name: person.full_name ?? person.employee_code,
      role: person.position,
    }))
  for (const row of rows) {
    if (people.some((person) => person.id === row.employee_id)) continue
    const known = teamRows(team).find(
      (person) => person.employee_id === row.employee_id,
    )
    people.push({
      id: row.employee_id,
      name: row.full_name ?? known?.full_name ?? row.employee_code,
      role: known?.position ?? null,
    })
  }
  return people
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`
}
