import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useState } from "react"

import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill, Status } from "@/components/ui/pill"
import { Banner, LoadingState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  decideLeave,
  fileLeave,
  holidays,
  hrKeys,
  isoDay,
  leaveBalancesOf,
  leaveRequestsOf,
  leaveTypes,
  pendingLeaveAt,
  readCentidays,
  readDate,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import {
  dateLead,
  Facts,
  Fenced,
  Person,
  personCard,
  PersonPicker,
  Submit,
  useDecision,
} from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import {
  personByLogin,
  personName,
  requestState,
  useTeam,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  LeaveBalanceRow,
  LeaveRequestView,
} from "@itulah/contract"

/// Leave at this shop — the prototype's store Leave: the requests, the
/// balances, and the calendar they are counted against.
///
/// "Cuti diputuskan kepala toko dan tidak naik ke HO": leave is the store
/// head's to decide, and head office only watches. The one exception is the
/// store head's own leave, which the centre routes up — a manager does not
/// approve their own holiday — and which this screen shows as waiting on head
/// office rather than offering a button that would be refused.
///
/// # Before the menu took the prototype's shape
///
/// This screen used to be one queue of leave, overtime *and* shift swaps. The
/// prototype puts them in three places: overtime has its own screen (where the
/// orders are), and swaps sit on the Roster and under Attendance's fixes. The
/// leave half stayed here, with its decision unchanged: the reason is required
/// by the centre, and the days charged are the centre's count under the
/// holiday calendar in force — a browser counting weekends itself would get
/// *cuti bersama* wrong, and be wrong about somebody's balance.
///
/// # On a phone
///
/// The three slices are the dock's status chip (`PeopleTabs`), every request
/// is a lead-figure card (days is the figure), and the balances — a column per
/// leave type on a desk — are one card per person with their balances as a
/// short list, so nothing scrolls sideways.
export function HrLeave() {
  const [recording, setRecording] = useState(false)
  return (
    <HrWorkspace
      primary={{
        label: "New leave request",
        onClick: () => setRecording(true),
      }}
    >
      {(scope) => (
        <Leave scope={scope} recording={recording} onRecording={setRecording} />
      )}
    </HrWorkspace>
  )
}

type Tab = "requests" | "balances" | "calendar"

function Leave({
  scope,
  recording,
  onRecording,
}: {
  scope: StoreScope
  recording: boolean
  onRecording: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>("requests")
  const team = useTeam(scope)
  const pending = useQuery({
    queryKey: hrKeys.leave(scope.unit_id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.unit_id, signal),
  })

  return (
    <>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "requests",
            label: "Requests",
            count: pending.data?.rows.length,
          },
          { value: "balances", label: "Balances" },
          { value: "calendar", label: "Holidays" },
        ]}
      />
      {tab === "requests" && <Requests scope={scope} team={team.data} />}
      {tab === "balances" && <Balances team={team} />}
      {tab === "calendar" && <Calendar scope={scope} />}

      {recording && (
        <RecordLeave
          scope={scope}
          team={team.data}
          onClose={() => onRecording(false)}
        />
      )}
    </>
  )
}

/// "06 Oct 2026", or "06 Oct 2026 – 08 Oct 2026" for a span of days.
function span(request: LeaveRequestView): string {
  return request.from_date === request.to_date
    ? readDate(request.from_date)
    : `${readDate(request.from_date)} – ${readDate(request.to_date)}`
}

/// "1 day", "2.5 days" — a count of days with its unit.
function daysWord(days: number | string): string {
  return `${days} ${Number(days) === 1 ? "day" : "days"}`
}

// ── requests ────────────────────────────────────────────────────────────────

/// The queue and the history, as one list.
///
/// The queue (`/leave-requests/pending`) is what is waiting; the history is
/// each person's own list, read per person because that is the only route
/// that answers decided requests. Merged by id, waiting first.
function Requests({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
}) {
  const pending = useQuery({
    queryKey: hrKeys.leave(scope.unit_id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.unit_id, signal),
  })
  const people = (team?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  const histories = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.leaveOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveRequestsOf(person.employee_id, signal),
    })),
  })
  const balances = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.balancesOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveBalancesOf(person.employee_id, signal),
    })),
  })
  const annualLeft = (employeeId: string): string => {
    const index = people.findIndex(
      (person) => person.employee_id === employeeId,
    )
    const rows = balances[index]?.data
    const annual = rows?.find((row) =>
      /annual|tahunan/i.test(`${row.leave_type} ${row.name}`),
    )
    return annual === undefined ? "—" : readCentidays(annual.centidays)
  }
  const [open, setOpen] = useState<LeaveRequestView | null>(null)

  return centreState(pending, {
    loading: "Reading the leave requests…",
    what: "this shop's leave requests",
    render: (queue) => {
      const byId = new Map<string, LeaveRequestView>()
      for (const request of queue.rows) byId.set(request.id, request)
      for (const history of histories) {
        for (const request of history.data ?? []) {
          if (!byId.has(request.id)) byId.set(request.id, request)
        }
      }
      const rows = [...byId.values()].sort((left, right) =>
        left.state === "PENDING" && right.state !== "PENDING"
          ? -1
          : right.state === "PENDING" && left.state !== "PENDING"
            ? 1
            : right.from_date.localeCompare(left.from_date),
      )

      return (
        <>
          <Fenced dropped={queue.elsewhere} place={scope.unit_id} />
          <PeopleTable
            rows={rows}
            rowKey={(request) => request.id}
            onRowClick={setOpen}
            empty="No leave requests."
            card={(request) => {
              const state = requestState(request.state)
              return {
                ...personCard(team, request.employee_id, [
                  `${request.leave_type_name} · ${span(request)}`,
                ]),
                lead: {
                  figure: String(request.chargeable_days),
                  caption: request.chargeable_days === 1 ? "day" : "days",
                },
                foot: {
                  info: <Status tone={state.tone}>{state.label}</Status>,
                  action: {
                    label: request.state === "PENDING" ? "Review" : "Open",
                    onClick: () => setOpen(request),
                  },
                },
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (request) => (
                  <Person team={team} id={request.employee_id} />
                ),
              },
              {
                key: "type",
                header: "Type",
                cell: (request) => request.leave_type_name,
              },
              {
                key: "dates",
                header: "Dates",
                cell: (request) => span(request),
              },
              {
                key: "days",
                header: "Days",
                align: "right",
                cell: (request) => request.chargeable_days,
              },
              {
                key: "left",
                header: "Annual left",
                align: "right",
                cell: (request) => annualLeft(request.employee_id),
              },
              {
                key: "state",
                header: "Status",
                cell: (request) => {
                  const state = requestState(request.state)
                  return <Status tone={state.tone}>{state.label}</Status>
                },
              },
            ]}
          />
          {open !== null && (
            <LeaveSheet
              key={open.id}
              request={open}
              team={team}
              onClose={() => setOpen(null)}
            />
          )}
        </>
      )
    },
  })
}

/// One leave request, and the store head's decision on it.
///
/// The reason is required because the centre refuses a decision without one
/// — and this one decides whether somebody is paid for the days.
function LeaveSheet({
  request,
  team,
  onClose,
}: {
  request: LeaveRequestView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const balances = useQuery({
    queryKey: hrKeys.balancesOf(request.employee_id),
    queryFn: ({ signal }) => leaveBalancesOf(request.employee_id, signal),
  })
  const decide = useMutation({
    mutationFn: (input: { approve: boolean; reason: string }) =>
      decideLeave({
        employeeId: request.employee_id,
        requestId: request.id,
        decision: input.approve ? "approve" : "reject",
        reason: input.reason,
      }),
    onSuccess: () => {
      // The queue, the person's history and balance, and today's attendance —
      // an approved day off is a day nobody should be marked missing on.
      client.invalidateQueries({ queryKey: hrKeys.queue() })
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      onClose()
    },
  })
  const state = requestState(request.state)
  const waiting = request.state === "PENDING"
  const decision = useDecision({
    placeholder: "Cover is arranged with the afternoon shift",
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
      id={request.id}
      crumb="Leave"
      title={personName(team, request.employee_id)}
      sub={request.leave_type_name}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={waiting ? decision.footer : undefined}
    >
      <Facts
        rows={[
          [
            "Dates",
            `${readDate(request.from_date, true)} – ${readDate(request.to_date, true)}`,
            true,
          ],
          // The centre's count, under the holiday calendar in force when it
          // was filed — never a browser counting weekends.
          ["Days charged", request.chargeable_days],
          ["Asked by", personByLogin(team, request.requested_by)],
          ["Asked on", moment(request.created_at)],
          ["Because", request.reason, true],
          request.evidence !== null && ["Evidence", request.evidence, true],
          request.decided_by !== null && [
            "Decided by",
            personByLogin(team, request.decided_by),
          ],
          request.decided_by !== null && [
            "Decided on",
            moment(request.decided_at),
          ],
          request.decision_reason !== null && [
            "Why",
            request.decision_reason,
            true,
          ],
        ]}
      />
      <SheetSection title="Balance" className="mt-6">
        {centreState(balances, {
          loading: "Reading the leave balance…",
          what: "this person's leave balance",
          render: (rows) => <BalanceFacts rows={rows} />,
        })}
      </SheetSection>
      {waiting && decision.field}
    </PeopleSheet>
  )
}

function BalanceFacts({ rows }: { rows: readonly LeaveBalanceRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-meta text-body">No balance is kept for them yet.</p>
    )
  }
  return (
    <Facts
      rows={rows.map((row) => [
        row.name,
        `${daysWord(readCentidays(row.centidays))} left${row.pending_centidays > 0 ? ` · ${readCentidays(row.pending_centidays)} requested` : ""}`,
      ])}
    />
  )
}

// ── balances ────────────────────────────────────────────────────────────────

/// What everybody has left, per kind of leave.
///
/// On a desk a column per kind. On a phone a column per kind would be a table
/// that scrolls sideways, so each person is a card and their balances are a
/// short list inside it.
function Balances({ team }: { team: UseQueryResult<EmployeeList> }) {
  const people = (team.data?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.balancesOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveBalancesOf(person.employee_id, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  // The kinds anybody here has a balance in, as columns — the prototype's
  // allowance / taken / asked / left, spelled the way the ledger folds it.
  const kinds = [
    ...new Map(
      reads
        .flatMap((read) => read.data ?? [])
        .map((row) => [row.leave_type, row.name] as const),
    ),
  ]
  const rows = people.map((person, index) => ({
    person,
    balances: reads[index]?.data ?? [],
  }))
  // Nothing has come back yet: say so, rather than a table of dashes.
  const reading = reads.length > 0 && reads.every((read) => read.isPending)

  return centreState(team, {
    loading: "Reading the leave balances…",
    what: "this shop's people",
    render: (list) =>
      reading ? (
        <LoadingState>Reading the leave balances…</LoadingState>
      ) : (
        <>
          {refused !== undefined && (
            <RefusedBanner error={refused.error} what="leave balances" />
          )}
          <PeopleTable
            rows={rows}
            rowKey={(row) => row.person.employee_id}
            empty="Nobody is posted here."
            card={(row) => {
              const one = personCard(list, row.person.employee_id)
              return {
                title: one.title,
                lines: [
                  ...one.lines,
                  ...(row.balances.length === 0
                    ? ["No balance is kept for them yet."]
                    : row.balances.map((balance) => (
                        <BalanceLine
                          key={balance.leave_type}
                          balance={balance}
                        />
                      ))),
                ],
              }
            }}
            columns={[
              {
                key: "who",
                header: "Employee",
                cell: (row) => (
                  <Person team={list} id={row.person.employee_id} />
                ),
              },
              ...kinds.map(([code, name]) => ({
                key: code,
                header: name,
                align: "right" as const,
                cell: (row: (typeof rows)[number]) => {
                  const one = row.balances.find(
                    (balance) => balance.leave_type === code,
                  )
                  if (one === undefined)
                    return <span className="text-faint">—</span>
                  return (
                    <span className="inline-flex flex-col items-end">
                      {readCentidays(one.centidays)}
                      {one.pending_centidays > 0 && (
                        <span className="text-meta text-warn-fg">
                          {readCentidays(one.pending_centidays)} requested
                        </span>
                      )}
                    </span>
                  )
                },
              })),
            ]}
          />
        </>
      ),
  })
}

/// One balance, as a row of a person's card: the kind at the left, what is
/// left at the right.
function BalanceLine({ balance }: { balance: LeaveBalanceRow }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate">{balance.name}</span>
      <span className="shrink-0 text-ink tabular-nums">
        {daysWord(readCentidays(balance.centidays))}
        {balance.pending_centidays > 0 && (
          <span className="text-warn-fg">
            {" "}
            · {readCentidays(balance.pending_centidays)} requested
          </span>
        )}
      </span>
    </span>
  )
}

// ── the calendar ────────────────────────────────────────────────────────────

function Calendar({ scope }: { scope: StoreScope }) {
  const year = new Date().getFullYear()
  const calendar = useQuery({
    queryKey: hrKeys.holidays(year),
    queryFn: ({ signal }) => holidays(year, signal),
  })

  return centreState(calendar, {
    loading: "Reading the holiday calendar…",
    what: `the ${year} holiday calendar`,
    render: (view) => {
      // Regional days apply to some UNITS only (`HolidayView.units`); this
      // shop's are the ones with no list at all (a nationwide day) or with
      // the unit this session is posted to on it.
      const days = view.holidays.filter(
        (day) => day.units === null || day.units.includes(scope.unit_id),
      )
      const kindOf = (day: (typeof days)[number]) =>
        day.consumes_annual_leave ? (
          <Status tone="warn">Joint leave · from annual</Status>
        ) : (
          <Status tone="neutral">
            {day.units === null ? "National" : "Regional"}
          </Status>
        )
      return (
        <PeopleTable
          rows={days}
          rowKey={(day) => day.date}
          empty={`No holidays for ${year}.`}
          card={(day) => ({
            title: day.name,
            lead: dateLead(day.date),
            foot: { info: kindOf(day) },
          })}
          columns={[
            {
              key: "name",
              header: "Holiday",
              cell: (day) => (
                <span className="font-medium text-ink">{day.name}</span>
              ),
            },
            {
              key: "date",
              header: "Date",
              cell: (day) => readDate(day.date, true),
            },
            {
              key: "kind",
              header: "Kind",
              cell: kindOf,
            },
          ]}
        />
      )
    },
  })
}

// ── a new leave request ─────────────────────────────────────────────────────

/// File leave on somebody's behalf. Filing is the shop's; deciding is still a
/// separate act, and never by the person who filed it.
function RecordLeave({
  scope,
  team,
  onClose,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const types = useQuery({
    queryKey: hrKeys.leaveTypes(),
    queryFn: ({ signal }) => leaveTypes(signal),
    staleTime: 5 * 60_000,
  })
  const today = isoDay(new Date())
  const [employeeId, setEmployeeId] = useState("")
  const [leaveType, setLeaveType] = useState("")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [evidence, setEvidence] = useState("")
  const [reason, setReason] = useState("")
  const chosen = types.data?.find((type) => type.code === leaveType)

  const file = useMutation({
    mutationFn: () =>
      fileLeave({
        place: scope.unit_id,
        employeeId,
        leaveType,
        from,
        to,
        reason,
        evidence,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.queue() })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New leave request"
      foot={
        <Submit
          label="Create leave request"
          pendingLabel="Creating…"
          pending={file.isPending}
          disabled={
            employeeId === "" ||
            leaveType === "" ||
            from === "" ||
            to === "" ||
            to < from ||
            reason.trim() === "" ||
            (chosen?.requires_evidence === true && evidence.trim() === "")
          }
          error={file.error}
          onSubmit={() => file.mutate()}
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
          required
        />
        <Field label="Kind of leave" required>
          <Select value={leaveType} onChange={setLeaveType}>
            <option value="">Choose…</option>
            {(types.data ?? []).map((type) => (
              <option key={type.code} value={type.code}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required>
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field
            label="To"
            required
            problem={
              to !== "" && to < from ? "Ends before it starts." : undefined
            }
          >
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
        {chosen?.requires_evidence === true && (
          <Field label="Evidence" required>
            <Input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </Field>
        )}
        <Field label="Reason" required>
          <Input
            value={reason}
            placeholder="Family wedding in Solo"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {types.isError && (
          <Banner tone="warn">The leave types could not be read.</Banner>
        )}
      </div>
    </PeopleSheet>
  )
}
