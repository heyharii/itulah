import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import { Banner } from "@/components/ui/states"
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
import { RefusedBanner } from "@/screens/hr/refused"
import {
  Decision,
  Facts,
  Fenced,
  Heading,
  Person,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import { personName, requestState, useTeam } from "@/screens/hr/words"
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
export function HrLeave() {
  const [recording, setRecording] = useState(false)
  return (
    <HrWorkspace
      sub="Leave is decided by the store head and does not go up to head office. Balances are read from the ledger: allowance, taken, asked for."
      actions={
        <Button variant="primary" onClick={() => setRecording(true)}>
          <Plus />
          Record leave
        </Button>
      }
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
    queryKey: hrKeys.leave(scope.id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.id, signal),
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
      {tab === "balances" && <Balances team={team.data} />}
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
    queryKey: hrKeys.leave(scope.id),
    queryFn: ({ signal }) => pendingLeaveAt(scope.id, signal),
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
    loading: "Reading what is waiting on a decision…",
    what: "this shop's leave queue",
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
          <Fenced dropped={queue.elsewhere} place={scope.id} />
          <PeopleTable
            rows={rows}
            rowKey={(request) => request.id}
            onRowClick={setOpen}
            empty={`No leave has been asked for at ${scope.label}.`}
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
                card: "meta",
                cell: (request) => request.leave_type_name,
              },
              {
                key: "dates",
                header: "Dates",
                card: "meta",
                cell: (request) =>
                  request.from_date === request.to_date
                    ? readDate(request.from_date)
                    : `${readDate(request.from_date)} – ${readDate(request.to_date)}`,
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
                card: "status",
                cell: (request) => {
                  const state = requestState(request.state)
                  return <Pill tone={state.tone}>{state.label}</Pill>
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

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={
        <>
          Leave · <span className="font-mono">{request.id}</span>
        </>
      }
      title={personName(team, request.employee_id)}
      sub={request.leave_type_name}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        request.state === "PENDING" ? (
          <Decision
            placeholder="Cover is arranged with the afternoon shift"
            pending={decide.isPending}
            error={decide.error}
            onDecide={(approve, reason) => decide.mutate({ approve, reason })}
          />
        ) : undefined
      }
    >
      <SheetSection title="The request">
        <Facts
          rows={[
            [
              "Dates",
              `${readDate(request.from_date, true)} – ${readDate(request.to_date, true)}`,
            ],
            // The centre's count, under the holiday calendar in force when it
            // was filed — never a browser counting weekends.
            ["Days charged", request.chargeable_days],
            ["Because", request.reason],
            request.evidence !== null && ["Evidence", request.evidence],
            [
              "Asked by",
              `${request.requested_by} · ${moment(request.created_at)}`,
            ],
            request.decided_by !== null && [
              "Decided",
              `${request.decided_by} · ${moment(request.decided_at)}`,
            ],
            request.decision_reason !== null && [
              "Why",
              request.decision_reason,
            ],
          ]}
        />
      </SheetSection>
      <SheetSection title="Balance">
        {centreState(balances, {
          loading: "Reading the balance…",
          what: "this person's leave balance",
          render: (rows) => <BalanceFacts rows={rows} />,
        })}
      </SheetSection>
      {request.state === "PENDING" && (
        <p className="text-meta text-mute">
          Decided here, not at head office. Approved: the balance and the
          attendance sheet follow at once. The person who filed a request cannot
          also decide it.
        </p>
      )}
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
        `${readCentidays(row.centidays)} days left${row.pending_centidays > 0 ? ` · ${readCentidays(row.pending_centidays)} asked for` : ""}`,
      ])}
    />
  )
}

// ── balances ────────────────────────────────────────────────────────────────

function Balances({ team }: { team: EmployeeList | undefined }) {
  const people = (team?.rows ?? []).filter(
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

  return (
    <>
      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="leave balances" />
      )}
      <PeopleTable
        rows={rows}
        rowKey={(row) => row.person.employee_id}
        empty="Nobody is posted here."
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (row) => <Person team={team} id={row.person.employee_id} />,
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
                <span>
                  {readCentidays(one.centidays)}
                  {one.pending_centidays > 0 && (
                    <span className="text-warn-fg">
                      {" "}
                      (−{readCentidays(one.pending_centidays)})
                    </span>
                  )}
                </span>
              )
            },
          })),
        ]}
      />
      <p className="mt-3 text-meta text-mute">
        Days left, folded to today from the ledger. A figure in brackets is
        asked for and not yet decided. Allowances and carry-over are head
        office's rules.
      </p>
    </>
  )
}

// ── the calendar ────────────────────────────────────────────────────────────

function Calendar({ scope }: { scope: StoreScope }) {
  const year = new Date().getFullYear()
  const calendar = useQuery({
    queryKey: hrKeys.holidays(year),
    queryFn: ({ signal }) => holidays(year, signal),
  })

  return (
    <>
      <Heading>Public holidays {year}</Heading>
      {centreState(calendar, {
        loading: "Reading the holiday calendar…",
        what: `the ${year} holiday calendar`,
        render: (view) => {
          // Regional days apply to some places only; this shop's are the ones
          // with no place list or with this shop on it.
          const days = view.holidays.filter(
            (day) => day.places === null || day.places.includes(scope.id),
          )
          return (
            <PeopleTable
              rows={days}
              rowKey={(day) => day.date}
              empty={`Head office has published no holidays for ${year}.`}
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
                  card: "meta",
                  cell: (day) => readDate(day.date, true),
                },
                {
                  key: "kind",
                  header: "Kind",
                  card: "status",
                  cell: (day) =>
                    day.consumes_annual_leave ? (
                      <Pill tone="warn">Joint leave · from annual</Pill>
                    ) : (
                      <Pill tone="neutral">
                        {day.places === null ? "National" : "Regional"}
                      </Pill>
                    ),
                },
              ]}
            />
          )
        },
      })}
      <p className="mt-3 text-meta text-mute">
        Working on a public holiday is paid as holiday overtime. Joint leave (
        <i>cuti bersama</i>) is taken from the annual allowance. The calendar is
        published by head office.
      </p>
    </>
  )
}

// ── recording leave ─────────────────────────────────────────────────────────

/// Record leave on somebody's behalf. Filing is the shop's; deciding is still
/// a separate act, and never by the person who filed it.
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
        place: scope.id,
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
      crumb="Leave"
      title="Record leave"
      sub="Filed for the person, decided by the store head."
      foot={
        <Submit
          label="File the request"
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
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
        />
        <Field label="Kind of leave">
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
          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field
            label="To"
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
          <Field
            label="Evidence"
            hint="This kind needs it — a doctor's letter number, for example."
          >
            <Input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </Field>
        )}
        <Field label="Why">
          <Input
            value={reason}
            placeholder="Family wedding in Solo"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {types.isError && (
          <Banner tone="warn">
            The kinds of leave could not be read from head office.
          </Banner>
        )}
        <p className="text-meta text-mute">
          Days off on the rota are left out of the count, and head office counts
          the rest under the holiday calendar.
        </p>
      </div>
    </PeopleSheet>
  )
}
