import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill, Status } from "@/components/ui/pill"
import { moment } from "@/lib/format"
import {
  clockOf,
  correctionsAt,
  decideCorrection,
  fileCorrection,
  hrKeys,
  isoDay,
  readDate,
  type CorrectionEffect,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import {
  dateLead,
  Facts,
  Heading,
  Person,
  personCard,
  Submit,
  useDecision,
} from "@/screens/hr/parts"
import { SwapList } from "@/screens/hr/swaps"
import {
  personByLogin,
  personName,
  requestState,
  teamRows,
} from "@/screens/hr/words"
import type { CorrectionRow, EmployeeList } from "@itulah/contract"

/// What a "New correction" sheet opens already filled in — from a day's sheet,
/// the person and the day.
export interface Prefill {
  readonly employeeId?: string
  readonly date?: string
}

/// Attendance › Corrections — the hub's page of the same name
/// (`frontend-hub/src/screens/people/corrections.tsx`) for one shop: every
/// correction filed, decided or not, one row each — who, the day, what they say
/// the reader should have seen, and what became of the ask — and the row opens
/// into the sheet that decides it. A correction states times, never an outcome;
/// the requester and the decider must be different people, and the centre
/// refuses the same name twice. The shop's shift-swap requests ride below it,
/// since a swap is also a change to a day already planned.

/// What a correction says was missed: the hub's "Claims" column.
function claimWord(effect: string): string {
  switch (effect) {
    case "ARRIVAL":
      return "Check-in"
    case "DEPARTURE":
      return "Check-out"
    case "ARRIVAL_AND_DEPARTURE":
      return "Both"
    case "APPROVED_LEAVE":
      return "Approved leave"
    default:
      return effect
  }
}

/// A corrected time as the hub prints it; a dash where the correction leaves
/// that end alone.
function correctedTime(stamp: string | null): string {
  return stamp === null ? "—" : clockOf(stamp)
}

/// What a correction claims, in words.
function effectWord(fix: CorrectionRow): string {
  switch (fix.effect) {
    case "ARRIVAL":
      return `Arrived ${clockOf(fix.corrected_arrival)}`
    case "DEPARTURE":
      return `Left ${clockOf(fix.corrected_departure)}`
    case "ARRIVAL_AND_DEPARTURE":
      return `${clockOf(fix.corrected_arrival)}–${clockOf(fix.corrected_departure)}`
    case "APPROVED_LEAVE":
      return "Was on approved leave"
    default:
      return fix.effect
  }
}

export function Fixes({
  scope,
  team,
  onNew,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  /// Opens the blank correction form.
  onNew: () => void
}) {
  const history = useQuery({
    queryKey: hrKeys.corrections(scope.unit_id, false),
    queryFn: ({ signal }) => correctionsAt(scope.unit_id, false, signal),
  })
  const [open, setOpen] = useState<CorrectionRow | null>(null)

  return (
    <>
      <Heading
        count={history.data?.filter((fix) => fix.state === "PENDING").length}
        action={
          <Button variant="primary" onClick={onNew}>
            New correction
          </Button>
        }
      >
        Corrections
      </Heading>
      {centreState(history, {
        loading: "Reading the corrections…",
        what: "this shop's corrections",
        render: (rows) => (
          <PeopleTable
            rows={[...rows].sort((left, right) =>
              left.state === right.state
                ? right.requested_at.localeCompare(left.requested_at)
                : left.state === "PENDING"
                  ? -1
                  : right.state === "PENDING"
                    ? 1
                    : 0,
            )}
            rowKey={(fix) => fix.id}
            onRowClick={setOpen}
            empty="No corrections filed."
            card={(fix) => {
              const state = requestState(fix.state)
              const known = team?.rows.some(
                (person) => person.employee_id === fix.employee_id,
              )
              const head = personCard(team, fix.employee_id, [effectWord(fix)])
              return {
                ...head,
                // Somebody not on this shop's list any more keeps the name the
                // fix was filed under, not their id.
                title: known
                  ? head.title
                  : fix.display_name || fix.employee_code,
                lead: dateLead(fix.business_date),
                foot: {
                  info: <Status tone={state.tone}>{state.label}</Status>,
                  action: {
                    label: fix.state === "PENDING" ? "Review" : "Open",
                    onClick: () => setOpen(fix),
                  },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (fix) => (
                  <Person
                    team={team}
                    id={fix.employee_id}
                    sub={fix.employee_code}
                  />
                ),
              },
              {
                key: "day",
                header: "Day",
                card: "meta",
                cell: (fix) => readDate(fix.business_date, true),
              },
              {
                key: "claims",
                header: "Claims",
                card: "meta",
                cell: (fix) => claimWord(fix.effect),
              },
              {
                key: "arrived",
                header: "Arrived",
                card: "hide",
                cell: (fix) => correctedTime(fix.corrected_arrival),
              },
              {
                key: "left",
                header: "Left",
                card: "hide",
                cell: (fix) => correctedTime(fix.corrected_departure),
              },
              {
                key: "state",
                header: "State",
                card: "status",
                cell: (fix) => {
                  const state = requestState(fix.state)
                  return <Status tone={state.tone}>{state.label}</Status>
                },
              },
              {
                key: "by",
                header: "Asked by",
                card: "hide",
                cell: (fix) => personByLogin(team, fix.requested_by),
              },
            ]}
          />
        ),
      })}

      <Heading>Shift swaps</Heading>
      <SwapList scope={scope} team={team} />

      {open !== null && (
        <FixSheet
          key={open.id}
          fix={open}
          team={team}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// One fix, and the store head's decision on it.
function FixSheet({
  fix,
  team,
  onClose,
}: {
  fix: CorrectionRow
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const decide = useMutation({
    mutationFn: (input: { approve: boolean; reason: string }) =>
      decideCorrection({ id: fix.id, ...input }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      client.invalidateQueries({
        queryKey: hrKeys.period(fix.unit_id, fix.business_date.slice(0, 7)),
      })
      onClose()
    },
  })
  const state = requestState(fix.state)
  const waiting = fix.state === "PENDING"
  const decision = useDecision({
    placeholder: "Reader was down that morning",
    pending: decide.isPending,
    error: decide.error,
    onDecide: (approve, reason) => decide.mutate({ approve, reason }),
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={fix.employee_code}
      crumb="Attendance fix"
      title={fix.display_name || personName(team, fix.employee_id)}
      sub={`${effectWord(fix)} · ${readDate(fix.business_date, true)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={waiting ? decision.footer : undefined}
    >
      <SheetSection title="The ask">
        <Facts
          rows={[
            ["Day", readDate(fix.business_date, true)],
            ["Fix", effectWord(fix)],
            ["Because", fix.reason, true],
            [
              "Asked by",
              `${personByLogin(team, fix.requested_by)} · ${moment(fix.requested_at)}`,
            ],
            waiting && ["Waiting on", "Store head"],
            fix.supersedes !== null && [
              "Replaces",
              "An earlier fix of the same day",
            ],
          ]}
        />
      </SheetSection>
      {fix.decided_by !== null && (
        <SheetSection title="Decision">
          <Facts
            rows={[
              [
                "By",
                `${personByLogin(team, fix.decided_by)} · ${moment(fix.decided_at)}`,
              ],
              ["Why", fix.decision_reason ?? "—", true],
            ]}
          />
        </SheetSection>
      )}
      {waiting && decision.field}
    </PeopleSheet>
  )
}

/// New attendance fix — the prototype's *Catat perbaikan*. Filed by the shop,
/// decided by the store head (and never by the same person who filed it).
export function RecordFix({
  prefill,
  team,
  onClose,
  onDone,
}: {
  prefill: Prefill
  team: EmployeeList | undefined
  onClose: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState(prefill.employeeId ?? "")
  const [date, setDate] = useState(prefill.date ?? isoDay(new Date()))
  const [effect, setEffect] = useState<CorrectionEffect>(
    prefill.date === undefined ? "ARRIVAL" : "ARRIVAL_AND_DEPARTURE",
  )
  const [arrival, setArrival] = useState("09:00")
  const [departure, setDeparture] = useState("17:00")
  const [reason, setReason] = useState("")

  const file = useMutation({
    mutationFn: () =>
      fileCorrection({
        employeeId,
        businessDate: date,
        effect,
        arrival: effect === "DEPARTURE" ? undefined : arrival,
        departure: effect === "ARRIVAL" ? undefined : departure,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      onDone()
    },
  })

  // Only the active ones: a fix for somebody who has left would be refused.
  const people = teamRows(team).filter((person) => person.status === "ACTIVE")

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Attendance"
      title="New attendance fix"
      foot={
        <Submit
          label="Submit"
          pendingLabel="Submitting…"
          pending={file.isPending}
          disabled={employeeId === "" || date === "" || reason.trim() === ""}
          error={file.error}
          onSubmit={() => file.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Employee" required>
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose a person…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
                {person.position === null ? "" : ` · ${person.position}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" required>
          <Input
            type="date"
            value={date}
            max={isoDay(new Date())}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="What was missed" required>
          <Select
            value={effect}
            onChange={(value) => setEffect(value as CorrectionEffect)}
          >
            <option value="ARRIVAL">The check-in</option>
            <option value="DEPARTURE">The check-out</option>
            <option value="ARRIVAL_AND_DEPARTURE">Both</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {effect !== "DEPARTURE" && (
            <Field label="Arrived at" required>
              <Input
                type="time"
                value={arrival}
                onChange={(event) => setArrival(event.target.value)}
              />
            </Field>
          )}
          {effect !== "ARRIVAL" && (
            <Field label="Left at" required>
              <Input
                type="time"
                value={departure}
                onChange={(event) => setDeparture(event.target.value)}
              />
            </Field>
          )}
        </div>
        <Field label="Reason" required>
          <Input
            value={reason}
            placeholder="The reader was down this morning"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}
