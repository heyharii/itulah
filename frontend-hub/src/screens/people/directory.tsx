import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { CalendarClock } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue } from "@/components/ui/exception-queue"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { Timeline } from "@/components/ui/timeline"
import { count, day, moment } from "@/lib/format"
import type { Tone } from "@/lib/format"
import {
  AMENDABLE_FIELDS,
  addContract,
  amendPersonalData,
  applyTransition,
  assignToPlace,
  boundedTo,
  clearable,
  correctCode,
  daysUntil,
  leaveBalances,
  leaveKeys,
  leaveRequestsOf,
  leaveStateLabel,
  linkAccount,
  listEmployees,
  releaseAccount,
  expiringContracts,
  peopleKeys,
  readContracts,
  readEmployee,
  readDays,
  statusLabel,
  useReach,
  TRANSITIONS,
  type AmendableField,
  type ContractKind,
  type Transition,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type {
  AccountBinding,
  EmployeeSummary,
  ProfileAmendmentView,
} from "@itulah/contract"
import { Quiet } from "@/screens/people/parts"

/// The workforce: who works here, under what contract, and where they are
/// posted.
///
/// This screen never asks for personal data. NIK, address and date of birth
/// live behind their own route and their own privilege, and a directory has no
/// business carrying sixteen digits of national identity number because
/// somebody added a field to a struct. Amending personal data is possible from
/// here — an amendment names the field it changes, so the form that writes a
/// new address never has to display the old one — and the answer is read for
/// its audit trail and nothing else.
///
/// Every write carries a reason. That is not decoration: the server refuses a
/// decision without one, because a record saying what changed but not why is
/// the half of an audit trail that never helps anybody.

/// The workforce statuses, in the shared four-colour grammar.
///
/// `CANDIDATE` is SKY, which this language reserves for *in motion*: somebody
/// taken on and not yet started is exactly that — a normal state for a
/// fortnight and an alarming one for a year. `TERMINATED` is neutral rather
/// than `bad`: a person leaving is not a fault.
function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "ok"
    case "CANDIDATE":
      return "info"
    case "SUSPENDED":
      return "warn"
    default:
      return "neutral"
  }
}

/// A fixed term already past its end date is its own case rather than "very
/// soon": that is not a deadline approaching, it is somebody working without a
/// contract.
const PERMANENT = Number.MAX_SAFE_INTEGER

const columns: ColumnDef<TableSetup, EmployeeSummary>[] = [
  {
    accessorKey: "employee_code",
    header: "Number",
    size: 120,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.employee_code}
      </span>
    ),
  },
  {
    id: "name",
    accessorFn: (row) => row.full_name ?? row.employee_code,
    header: "Name",
    size: 240,
    cell: ({ row }) =>
      row.original.full_name ? (
        <span className="font-medium text-ink">{row.original.full_name}</span>
      ) : (
        // A record can exist before anybody has typed a name into it. Saying so
        // is more useful than an empty cell, which reads as a loading fault.
        <span className="text-mute">Not enrolled yet</span>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 160,
    cell: ({ row }) => (
      <Pill tone={statusTone(row.original.status)}>
        {statusLabel(row.original.status)}
      </Pill>
    ),
  },
  {
    id: "place",
    accessorFn: (row) => row.place_name ?? row.place_id ?? "",
    header: "Posted to",
    size: 160,
    cell: ({ row }) =>
      row.original.place_id ? (
        (row.original.place_name ?? row.original.place_id)
      ) : (
        <span className="text-mute">Unposted</span>
      ),
  },
  {
    accessorKey: "position",
    header: "Job",
    size: 160,
    cell: ({ row }) =>
      row.original.position ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "contract_kind",
    header: "Contract",
    size: 110,
    cell: ({ row }) =>
      row.original.contract_kind ? (
        <Tag tone={row.original.contract_kind === "PKWT" ? "warn" : "neutral"}>
          {row.original.contract_kind}
        </Tag>
      ) : (
        <span className="text-mute">None</span>
      ),
  },
  {
    id: "expiry",
    accessorFn: (row) => daysUntil(row.contract_ends_on) ?? PERMANENT,
    header: "Term ends in",
    size: 140,
    meta: { align: "right" },
    // The decision metric, and why this list sorts by it ascending: the first
    // screenful is whoever needs a renewal — and above them, anybody already
    // working on a term that ran out while nobody was looking.
    cell: ({ row }) => {
      const left = daysUntil(row.original.contract_ends_on)
      if (left === null) return <span className="text-mute">Permanent</span>
      if (left < 0)
        return (
          <span className="font-medium text-bad-fg">
            Ended {count(-left)}d ago
          </span>
        )
      return (
        <span className={left <= 14 ? "font-medium text-warn-fg" : "text-text"}>
          {count(left)} days
        </span>
      )
    },
  },
  {
    id: "account",
    accessorFn: (row) => (row.username === null ? 0 : 1),
    header: "Login",
    size: 100,
    cell: ({ row }) =>
      row.original.username ? (
        <span className="text-text">Linked</span>
      ) : (
        <span className="text-mute">None</span>
      ),
  },
]

export function Directory() {
  const [query, setQuery] = useState("")
  // Whose list this is. The server has already bounded it — a supervisor posted
  // to one shop is served their shop and nothing else — so the screen's job is
  // to say so. A directory that silently showed eight people where the company
  // has ninety would read as a company of eight.
  const reach = useReach()
  const bounded = boundedTo(reach.data)
  const employee = useSheet("employee")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "expiry", desc: false },
  ])

  // The whole workforce in one read, at the server's ceiling. Filtering is done
  // on what is here rather than by re-asking: a directory is read constantly
  // and is small enough to hold, and `<DataTable>` virtualises past 150 rows,
  // so nothing is ever sliced away to make it fast.
  const people = useQuery({
    queryKey: peopleKeys.employees({ limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ limit: 1000 }, signal),
  })

  const rows = useMemo(() => people.data ?? [], [people.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: EmployeeSummary) => row.employee_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  const listed = rows.find((row) => row.employee_id === employee.value) ?? null

  // Asked of the server rather than derived from the rows on screen. The
  // client-side version could only ever see what the current filter had
  // loaded, so a lapsed contract on somebody filtered out of view was a lapsed
  // contract nobody was told about — which is the one case this exists for.
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(30),
    queryFn: ({ signal }) => expiringContracts({ withinDays: 30 }, signal),
  })

  const attention = useMemo(
    () =>
      (expiring.data ?? [])
        .slice()
        // Worst first: already working without a contract, then closest to it.
        .sort((a, b) => a.days_remaining - b.days_remaining)
        .map((row) => ({
          id: row.employee_id,
          title: row.full_name ?? row.employee_code,
          detail: `${row.position} · ends ${day(row.ends_on)}`,
          amount:
            row.days_remaining < 0
              ? `${count(-row.days_remaining)}d over`
              : `${count(row.days_remaining)}d left`,
          severity: (row.days_remaining < 0
            ? "high"
            : row.days_remaining <= 7
              ? "medium"
              : "low") as "high" | "medium" | "low",
          icon: <CalendarClock className="size-4" />,
          onOpen: () => employee.open(row.employee_id),
        })),
    [expiring.data, employee]
  )

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Directory"
        sub={
          bounded === null
            ? "Who works here, under what contract, and where they are posted. Personal data is a different question and a different privilege."
            : `${bounded} only — your own posting is what you may read. Personal data is a different question and a different privilege.`
        }
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      {attention.length > 0 && (
        <ExceptionQueue
          title="Contracts running out"
          exceptions={attention}
          empty="No fixed term ends in the next month."
        />
      )}

      <Card className="overflow-hidden">
        {queryState(people, {
          loading: "Loading the workforce…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nobody has been registered yet. An employee record is created
                with a number, and a name is enrolled onto it afterwards.
              </EmptyState>
            ) : (
              <DataTable<EmployeeSummary>
                table={table}
                onRowClick={(row) => employee.open(row.employee_id)}
                isSelected={(row) => row.employee_id === employee.value}
                empty="Nobody matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <EmployeeSheet
        id={employee.value ?? null}
        listed={listed}
        onClose={employee.close}
      />
    </PageContent>
  )
}

const TABS = [
  { value: "record", label: "Record" },
  { value: "leave", label: "Leave" },
  { value: "contracts", label: "Contracts" },
  { value: "change", label: "Change" },
] as const

function EmployeeSheet({
  id,
  listed,
  onClose,
}: {
  id: string | null
  listed: EmployeeSummary | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<string>("record")

  const detail = useQuery({
    queryKey: peopleKeys.employee(id ?? ""),
    queryFn: ({ signal }) => readEmployee(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "employee", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.employee_code ?? listed?.employee_code}
      title={listed?.full_name ?? detail.data?.employee_code ?? "Employee"}
    >
      {queryState(detail, {
        loading: "Loading the record…",
        render: (person) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={statusTone(person.status)}>
                {statusLabel(person.status)}
              </Pill>
              {!person.selectable && (
                <Pill tone="neutral">Not available for new work</Pill>
              )}
              {person.status !== "ACTIVE" &&
                person.status !== "CANDIDATE" &&
                person.account !== null &&
                person.account.active && (
                  // Ending or suspending employment closes the login as part of
                  // the same act, so this is either a binding made before that
                  // was true or a close that failed. Both are a working
                  // credential for somebody who is not working, which is the
                  // one thing on this sheet worth interrupting somebody about.
                  <Pill tone="bad">Login still open</Pill>
                )}
            </div>

            <Facts>
              <Fact term="Posted to">
                {person.current_place_name ?? person.current_place_id ?? "—"}
              </Fact>
              <Fact term="Login">
                {person.account === null ? (
                  "None"
                ) : person.account.active ? (
                  person.account.username
                ) : (
                  <span className="text-mute">
                    {person.account.username} · closed
                  </span>
                )}
              </Fact>
              <Fact term="Job">{listed?.position ?? "—"}</Fact>
              <Fact term="Registered">{day(person.created_at)}</Fact>
            </Facts>

            <div>
              <SubTabs tabs={TABS} value={tab} onChange={setTab} />

              {tab === "record" && (
                <div className="flex flex-col gap-5">
                  <div>
                    <SubHead>Employment</SubHead>
                    {person.history.length === 0 ? (
                      <Quiet>
                        Nothing has happened to this record yet — not even a
                        hire.
                      </Quiet>
                    ) : (
                      <Timeline
                        events={person.history.map((event, index) => ({
                          id: `${event.transition}-${event.at}-${index}`,
                          title: `${event.transition} — ${event.from} → ${event.to}`,
                          detail: `${event.actor} · ${event.reason}`,
                          at: day(event.effective_on),
                          state:
                            index === person.history.length - 1
                              ? "current"
                              : "done",
                        }))}
                      />
                    )}
                  </div>

                  <div>
                    <SubHead>Postings</SubHead>
                    {person.assignments.length === 0 ? (
                      <Quiet>Never posted anywhere.</Quiet>
                    ) : (
                      <MiniTable
                        head={[
                          "Place",
                          { label: "From", align: "left" },
                          "Until",
                        ]}
                      >
                        {person.assignments.map((assignment) => (
                          <MiniRow
                            key={`${assignment.place_id}-${assignment.valid_from}`}
                          >
                            <MiniCell>
                              <span className="block text-[0.8125rem] text-ink">
                                {assignment.place_name ?? assignment.place_id}
                              </span>
                              <span className="font-mono text-[0.65625rem] text-mute">
                                {assignment.actor} · {assignment.reason}
                              </span>
                            </MiniCell>
                            <MiniCell>{day(assignment.valid_from)}</MiniCell>
                            <MiniCell align="right">
                              {assignment.valid_to
                                ? day(assignment.valid_to)
                                : "open"}
                            </MiniCell>
                          </MiniRow>
                        ))}
                      </MiniTable>
                    )}
                  </div>

                  {person.code_history.length > 0 && (
                    <div>
                      <SubHead>Number corrections</SubHead>
                      <MiniTable
                        head={["Was", { label: "Became", align: "left" }, "By"]}
                      >
                        {person.code_history.map((correction, index) => (
                          <MiniRow key={`${correction.from}-${index}`}>
                            <MiniCell>
                              <span className="font-mono text-id text-mute line-through">
                                {correction.from}
                              </span>
                            </MiniCell>
                            <MiniCell>
                              <span className="font-mono text-id text-ink">
                                {correction.to}
                              </span>
                            </MiniCell>
                            <MiniCell align="right">
                              {correction.actor}
                            </MiniCell>
                          </MiniRow>
                        ))}
                      </MiniTable>
                    </div>
                  )}
                </div>
              )}

              {tab === "leave" && <LeaveTab employeeId={person.employee_id} />}

              {tab === "contracts" && (
                <Contracts employeeId={person.employee_id} />
              )}

              {tab === "change" && (
                <Changes
                  employeeId={person.employee_id}
                  account={person.account}
                />
              )}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

function Contracts({ employeeId }: { employeeId: string }) {
  const contracts = useQuery({
    queryKey: peopleKeys.contracts(employeeId),
    queryFn: ({ signal }) => readContracts(employeeId, signal),
  })

  return queryState(contracts, {
    loading: "Loading the contracts…",
    render: (view) =>
      view.contracts.length === 0 ? (
        <Quiet>No contract has been signed yet.</Quiet>
      ) : (
        <div className="flex flex-col gap-5">
          <MiniTable
            head={["Contract", { label: "Window", align: "left" }, "Job"]}
          >
            {view.contracts.map((contract, index) => (
              <MiniRow key={`${contract.kind}-${contract.starts_on}-${index}`}>
                <MiniCell>
                  <span className="flex items-center gap-1.5">
                    <Tag tone={contract.kind === "PKWT" ? "warn" : "neutral"}>
                      {contract.kind}
                    </Tag>
                    {contract.in_force && <Pill tone="ok">In force</Pill>}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.65625rem] text-mute">
                    {contract.actor} · {contract.reason}
                  </span>
                </MiniCell>
                <MiniCell>
                  {day(contract.starts_on)} →{" "}
                  {contract.ends_on ? day(contract.ends_on) : "no end"}
                </MiniCell>
                <MiniCell align="right">
                  {contract.position} · {contract.grade}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>

          {view.pkwt_run && (
            <div>
              {/* Facts only. Whether a run of fixed terms has converted to
                  permanent employment by operation of law is not this screen's
                  to assert, and the server deliberately does not either. */}
              <SubHead aside="UU 13/2003">Run of fixed terms</SubHead>
              <KeyValue term="Terms back to back">
                {count(view.pkwt_run.terms)}
              </KeyValue>
              <KeyValue term="From">{day(view.pkwt_run.from)}</KeyValue>
              <KeyValue term="To">{day(view.pkwt_run.to)}</KeyValue>
              <KeyValue term="Days">{count(view.pkwt_run.days)}</KeyValue>
            </div>
          )}
        </div>
      ),
  })
}

const ACTIONS = [
  { value: "employment", label: "Employment status" },
  { value: "posting", label: "Where they are posted" },
  { value: "contract", label: "Add a contract" },
  { value: "code", label: "Correct the employee number" },
  { value: "account", label: "The login" },
  { value: "personal", label: "Amend personal data" },
] as const

/// One change at a time, chosen first.
///
/// Six forms stacked would be six ways to click the wrong Save in a panel
/// 27.5rem wide. Picking the change first also makes the reason field mean
/// something specific — it is recorded against that decision and no other.
function Changes({
  employeeId,
  account,
}: {
  employeeId: string
  account: AccountBinding | null
}) {
  const [action, setAction] = useState<string>("employment")

  return (
    <div className="flex flex-col gap-4">
      <Field label="What are you changing?">
        <Select value={action} onChange={(next) => setAction(next)}>
          {ACTIONS.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </Select>
      </Field>

      {action === "employment" && <TransitionForm employeeId={employeeId} />}
      {action === "posting" && <PostingForm employeeId={employeeId} />}
      {action === "contract" && <ContractForm employeeId={employeeId} />}
      {action === "code" && <CodeForm employeeId={employeeId} />}
      {action === "account" && (
        <AccountForm employeeId={employeeId} account={account} />
      )}
      {action === "personal" && <AmendmentForm employeeId={employeeId} />}
    </div>
  )
}

/// The submit row every change form ends with. One black CTA, and this sheet is
/// the only place on the Directory screen that has one.
function Submit({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="primary"
      className="self-start"
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? "Saving…" : label}
    </Button>
  )
}

function Reason({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field
      label="Reason"
      hint="Recorded against this decision. The server refuses one without it."
    >
      <Textarea
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Why this is being changed"
      />
    </Field>
  )
}

/// Today, as a `date` input wants it. The employment routes take a plain date,
/// not an instant: a hire takes effect on a day, everywhere, whatever hour the
/// browser is in.
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface TransitionDraft {
  transition: Transition
  effectiveOn: string
  reason: string
}

function transitionReady(draft: TransitionDraft): boolean {
  return draft.reason.trim() !== "" && draft.effectiveOn !== ""
}

function TransitionForm({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()

  const change = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: TransitionDraft) =>
      applyTransition(
        employeeId,
        draft.transition,
        draft.effectiveOn,
        draft.reason.trim()
      ),
    onSuccess: () => {
      // The record itself, and the directory row — which carries the status.
      client.invalidateQueries({ queryKey: peopleKeys.employee(employeeId) })
      client.invalidateQueries({
        queryKey: peopleKeys.employees({ limit: 1000 }),
      })
      // The reason only: the transition and the date stay, because a batch of
      // hires on the same day is one date typed once.
      form.setFieldValue("reason", "")
    },
  })

  const form = useForm({
    defaultValues: {
      transition: "HIRE",
      effectiveOn: today(),
      reason: "",
    } as TransitionDraft,
    onSubmit: ({ value }) => change.mutate(value),
  })

  return (
    <form
      // The submit control is a plain button, so a date field's Enter would
      // otherwise submit this implicitly, past the gate below.
      onSubmit={(event) => {
        event.preventDefault()
        if (transitionReady(form.state.values) && !change.isPending) {
          form.handleSubmit()
        }
      }}
      className="flex flex-col gap-4"
    >
      {change.isError && <ErrorState error={change.error} />}
      {change.isSuccess && (
        <form.Subscribe selector={(state) => state.values.effectiveOn}>
          {(effectiveOn) => (
            <Banner tone="ok">
              Recorded, effective {day(effectiveOn)}. The timeline above shows
              it.
            </Banner>
          )}
        </form.Subscribe>
      )}

      <form.Field name="transition">
        {(field) => (
          <Field label="Transition">
            <Select
              value={field.state.value}
              onChange={(next) => field.handleChange(next as Transition)}
            >
              {TRANSITIONS.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Field name="effectiveOn">
        {(field) => (
          <Field
            label="Effective on"
            hint="The day it takes effect, which is rarely the day it is typed."
          >
            <Day
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="reason">
        {(field) => (
          <Reason value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => transitionReady(state.values)}>
        {(ready) => (
          <Submit
            label="Record the change"
            busy={change.isPending}
            disabled={!ready}
            onClick={() => form.handleSubmit()}
          />
        )}
      </form.Subscribe>
    </form>
  )
}

interface PostingDraft {
  placeId: string
  validFrom: string
  validTo: string
  reason: string
}

function postingReady(draft: PostingDraft): boolean {
  return (
    draft.placeId.trim() !== "" &&
    draft.reason.trim() !== "" &&
    draft.validFrom !== ""
  )
}

function PostingForm({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()

  const post = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: PostingDraft) =>
      assignToPlace(
        employeeId,
        draft.placeId.trim(),
        draft.validFrom,
        draft.reason.trim(),
        draft.validTo
      ),
    onSuccess: () => {
      // The record's postings, and the directory row's "Posted to".
      client.invalidateQueries({ queryKey: peopleKeys.employee(employeeId) })
      client.invalidateQueries({
        queryKey: peopleKeys.employees({ limit: 1000 }),
      })
      // The reason only: posting a team to the same place on the same day is
      // one place and one date typed once.
      form.setFieldValue("reason", "")
    },
  })

  const form = useForm({
    defaultValues: {
      placeId: "",
      validFrom: today(),
      validTo: "",
      reason: "",
    } as PostingDraft,
    onSubmit: ({ value }) => post.mutate(value),
  })

  return (
    <form
      // The submit control is a plain button, so a date field's Enter would
      // otherwise submit this implicitly, past the gate below.
      onSubmit={(event) => {
        event.preventDefault()
        if (postingReady(form.state.values) && !post.isPending) {
          form.handleSubmit()
        }
      }}
      className="flex flex-col gap-4"
    >
      {post.isError && <ErrorState error={post.error} />}
      {post.isSuccess && <Banner tone="ok">Posting recorded.</Banner>}

      <form.Field name="placeId">
        {(field) => (
          <Field
            label="Place"
            hint="The place id, as the register knows it — ho, jkt-01."
          >
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="ho"
            />
          </Field>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-3">
        <form.Field name="validFrom">
          {(field) => (
            <Field label="From">
              <Day
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="validTo">
          {(field) => (
            <Field label="Until" hint="Open-ended if blank">
              <Day
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
            </Field>
          )}
        </form.Field>
      </div>

      {/* No overlap check here on purpose. The rule fires on the whole timeline
          rather than on the row being written, so the server's refusal names
          both postings — which is more use than a guess made from the one row
          this form can see. */}
      <form.Field name="reason">
        {(field) => (
          <Reason value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => postingReady(state.values)}>
        {(ready) => (
          <Submit
            label="Post them there"
            busy={post.isPending}
            disabled={!ready}
            onClick={() => form.handleSubmit()}
          />
        )}
      </form.Subscribe>
    </form>
  )
}

interface ContractDraft {
  kind: ContractKind
  startsOn: string
  endsOn: string
  position: string
  grade: string
  reason: string
}

/// The pairing UU 13/2003 art. 59 turns on, restated here so the form cannot
/// express what the server is certain to refuse. The server checks it again
/// and its answer is the one that counts.
function needsEnd(draft: ContractDraft): boolean {
  return draft.kind === "PKWT" && draft.endsOn === ""
}

function contractReady(draft: ContractDraft): boolean {
  return (
    !needsEnd(draft) &&
    draft.startsOn !== "" &&
    draft.position.trim() !== "" &&
    draft.grade.trim() !== "" &&
    draft.reason.trim() !== ""
  )
}

function ContractForm({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()

  const add = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ContractDraft) =>
      addContract(employeeId, {
        kind: draft.kind,
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        position: draft.position.trim(),
        grade: draft.grade.trim(),
        reason: draft.reason.trim(),
      }),
    onSuccess: () => {
      // The contracts tab, and the directory row — which carries the kind and
      // the end date this list sorts by.
      client.invalidateQueries({ queryKey: peopleKeys.contracts(employeeId) })
      client.invalidateQueries({
        queryKey: peopleKeys.employees({ limit: 1000 }),
      })
      // The reason only: a renewal on the same terms is the ordinary next
      // contract, and re-typing the grade is how a typo gets in.
      form.setFieldValue("reason", "")
    },
  })

  const form = useForm({
    defaultValues: {
      kind: "PKWT",
      startsOn: today(),
      endsOn: "",
      position: "",
      grade: "",
      reason: "",
    } as ContractDraft,
    onSubmit: ({ value }) => add.mutate(value),
  })

  return (
    <form
      // The submit control is a plain button, so a field's Enter would
      // otherwise submit this implicitly, past the gate below.
      onSubmit={(event) => {
        event.preventDefault()
        if (contractReady(form.state.values) && !add.isPending) {
          form.handleSubmit()
        }
      }}
      className="flex flex-col gap-4"
    >
      {add.isError && <ErrorState error={add.error} />}
      {add.isSuccess && <Banner tone="ok">Contract added.</Banner>}

      <form.Field name="kind">
        {(field) => (
          <Field label="Kind">
            <Select
              value={field.state.value}
              onChange={(next) => field.handleChange(next as ContractKind)}
            >
              <option value="PKWT">PKWT — fixed term</option>
              <option value="PKWTT">PKWTT — permanent</option>
            </Select>
          </Field>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-3">
        <form.Field name="startsOn">
          {(field) => (
            <Field label="Starts on">
              <Day
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
            </Field>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values}>
          {(draft) => (
            <form.Field name="endsOn">
              {(field) => (
                <Field
                  label="Ends on"
                  hint={
                    draft.kind === "PKWT"
                      ? "Required: a fixed term must say when it ends"
                      : "A permanent contract cannot carry one"
                  }
                  problem={
                    needsEnd(draft) ? "A PKWT is a fixed term." : undefined
                  }
                >
                  <Day
                    value={field.state.value}
                    disabled={draft.kind === "PKWTT"}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <form.Field name="position">
          {(field) => (
            <Field label="Position">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="grade">
          {(field) => (
            <Field label="Grade">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <form.Field name="reason">
        {(field) => (
          <Reason value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => contractReady(state.values)}>
        {(ready) => (
          <Submit
            label="Add the contract"
            busy={add.isPending}
            disabled={!ready}
            onClick={() => form.handleSubmit()}
          />
        )}
      </form.Subscribe>
    </form>
  )
}

function CodeForm({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [reason, setReason] = useState("")

  const correct = useMutation({
    mutationFn: () => correctCode(employeeId, code.trim(), reason.trim()),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: peopleKeys.employee(employeeId) })
      client.invalidateQueries({
        queryKey: peopleKeys.employees({ limit: 1000 }),
      })
      setCode("")
      setReason("")
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {correct.isError && <ErrorState error={correct.error} />}
      {correct.isSuccess && (
        <Banner tone="ok">
          Corrected. The old number stays on the record — a correction is not an
          erasure.
        </Banner>
      )}

      <Field label="New employee number">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="EMP-0042"
        />
      </Field>

      <Reason value={reason} onChange={setReason} />

      <Submit
        label="Correct the number"
        busy={correct.isPending}
        disabled={code.trim() === "" || reason.trim() === ""}
        onClick={() => correct.mutate()}
      />
    </div>
  )
}

/// The login this record signs in with: bound here, and released here.
///
/// Two acts behind one entry rather than two, because they are the same
/// decision made in opposite directions and a person who has picked "the login"
/// wants to see the one they have before choosing. What this form deliberately
/// cannot do is *close* an account: a release says the credential is not this
/// person's, and closing somebody's login is either ending their employment —
/// which does it as part of the same act — or an administrator's decision in
/// System > Accounts.
function AccountForm({
  employeeId,
  account,
}: {
  employeeId: string
  account: AccountBinding | null
}) {
  const client = useQueryClient()
  const [username, setUsername] = useState("")
  const [reason, setReason] = useState("")

  const refresh = () => {
    client.invalidateQueries({ queryKey: peopleKeys.employee(employeeId) })
    client.invalidateQueries({
      queryKey: peopleKeys.employees({ limit: 1000 }),
    })
    setUsername("")
    setReason("")
  }

  const link = useMutation({
    mutationFn: () => linkAccount(employeeId, username.trim(), reason.trim()),
    onSuccess: refresh,
  })
  const release = useMutation({
    mutationFn: () => releaseAccount(employeeId, reason.trim()),
    onSuccess: refresh,
  })

  if (account !== null) {
    return (
      <div className="flex flex-col gap-4">
        {release.isError && <ErrorState error={release.error} />}
        {release.isSuccess && (
          <Banner tone="ok">
            Released. The account still exists and still signs in — it is simply
            nobody&rsquo;s until it is bound again.
          </Banner>
        )}

        <Facts>
          <Fact term="Username">{account.username}</Fact>
          <Fact term="Signs in">{account.active ? "Yes" : "No — closed"}</Fact>
          <Fact term="Bound by">
            {account.linked_by === null ? (
              // 0097 did not backfill provenance for bindings made before it
              // existed, and naming somebody who never decided it would be
              // worse than saying nothing.
              <span className="text-mute">Recorded before this was kept</span>
            ) : (
              `${account.linked_by} · ${day(account.linked_at)}`
            )}
          </Fact>
          {account.link_reason !== null && (
            <Fact term="Because">{account.link_reason}</Fact>
          )}
        </Facts>

        <Reason value={reason} onChange={setReason} />

        <Submit
          label="Release the login"
          busy={release.isPending}
          disabled={reason.trim() === ""}
          onClick={() => release.mutate()}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {link.isError && <ErrorState error={link.error} />}
      {link.isSuccess && (
        <Banner tone="ok">Linked. This record now has a way to sign in.</Banner>
      )}

      <Field
        label="Username"
        hint="An account that already exists, and that nobody else is. Creating one is a different privilege and a different screen."
      >
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="siti.rahayu"
        />
      </Field>

      <Reason value={reason} onChange={setReason} />

      <Submit
        label="Link the login"
        busy={link.isPending}
        disabled={username.trim() === "" || reason.trim() === ""}
        onClick={() => link.mutate()}
      />
    </div>
  )
}

/// Amending personal data, without ever reading it.
///
/// An amendment names one field and the new value, so this form has no reason
/// to fetch a NIK or a home address in order to change a phone number. The
/// server answers with the whole `PersonalDataView`; only the amendment trail
/// is kept, and it is kept in this component rather than in the query cache —
/// a screen that had only asked who was on shift must not be able to read
/// somebody's identity number out of a shared cache.
interface AmendmentDraft {
  field: AmendableField
  value: string
  birthDate: string
  reason: string
}

/// A blank value is a clearance on the two fields that may be cleared, and an
/// omission everywhere else.
function amendmentReady(draft: AmendmentDraft): boolean {
  const missing =
    draft.field === "birth_date"
      ? draft.birthDate === ""
      : draft.value.trim() === "" && !clearable(draft.field)
  return !missing && draft.reason.trim() !== ""
}

function AmendmentForm({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  // The server's answer, held here and never in the query cache — see above.
  const [trail, setTrail] = useState<readonly ProfileAmendmentView[]>([])

  const amend = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: AmendmentDraft) =>
      amendPersonalData(employeeId, {
        field: draft.field,
        value: draft.field === "birth_date" ? undefined : draft.value,
        birthDate: draft.field === "birth_date" ? draft.birthDate : undefined,
        reason: draft.reason.trim(),
      }),
    onSuccess: (view) => {
      setTrail(view.amendments)
      // The name shown in the directory is the only thing this app reads that
      // an amendment can change. Nothing else is invalidated because nothing
      // else is held.
      client.invalidateQueries({
        queryKey: peopleKeys.employees({ limit: 1000 }),
      })
      form.setFieldValue("value", "")
      form.setFieldValue("reason", "")
    },
  })

  const form = useForm({
    defaultValues: {
      field: "phone",
      value: "",
      birthDate: "",
      reason: "",
    } as AmendmentDraft,
    onSubmit: ({ value }) => amend.mutate(value),
  })

  return (
    <form
      // The submit control is a plain button, so a field's Enter would
      // otherwise submit this implicitly, past the gate below.
      onSubmit={(event) => {
        event.preventDefault()
        if (amendmentReady(form.state.values) && !amend.isPending) {
          form.handleSubmit()
        }
      }}
      className="flex flex-col gap-4"
    >
      {amend.isError && <ErrorState error={amend.error} />}

      <Banner tone="info">
        One field per amendment. Two at once would be two changes recorded as
        one, and the trail would say less than it appears to.
      </Banner>

      <form.Field name="field">
        {(field) => (
          <Field label="Field">
            <Select
              value={field.state.value}
              onChange={(next) => {
                field.handleChange(next as AmendableField)
                // A phone number left in the box is not an email address.
                form.setFieldValue("value", "")
              }}
            >
              {AMENDABLE_FIELDS.map((one) => (
                <option key={one} value={one}>
                  {one.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.field}>
        {(chosen) =>
          chosen !== "birth_date" ? (
            <form.Field name="value">
              {(field) => (
                <Field
                  label="New value"
                  hint={
                    clearable(chosen)
                      ? "Leave blank to clear it — only phone and email may be cleared."
                      : undefined
                  }
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          ) : (
            <form.Field name="birthDate">
              {(field) => (
                <Field label="Date of birth">
                  <Day
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
          )
        }
      </form.Subscribe>

      <form.Field name="reason">
        {(field) => (
          <Reason value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => amendmentReady(state.values)}>
        {(ready) => (
          <Submit
            label="Amend"
            busy={amend.isPending}
            disabled={!ready}
            onClick={() => form.handleSubmit()}
          />
        )}
      </form.Subscribe>

      {trail.length > 0 && (
        <div>
          <SubHead aside="from the server's answer">Amendments</SubHead>
          <Timeline
            events={trail.map((one, index) => ({
              id: `${one.field}-${one.at}-${index}`,
              title: one.field.replace("_", " "),
              detail: `${one.actor} · ${one.reason}`,
              at: moment(one.at),
              state: index === trail.length - 1 ? "current" : "done",
            }))}
          />
        </div>
      )}
    </form>
  )
}

/// What this person is owed, and what they have asked for.
///
/// Two reads rather than one, because they are two questions with two lifetimes:
/// a balance changes when somebody is granted days or takes them, and the
/// request list changes every time anybody files one. Folding them into a single
/// endpoint would mean re-reading the whole history to learn that a balance
/// moved.
///
/// Amounts arrive as **centidays** and are divided here and nowhere else. A
/// half day is 50 on the wire for the same reason money is an integer of the
/// smallest unit: `0.1 + 0.2 !== 0.3`, and a balance off by 2⁻⁵² fails an
/// equality check nobody can explain.
///
/// Only balance-backed kinds appear. Sick leave is absent rather than shown as
/// zero, and that is the honest answer: UU 13/2003 art. 93 gives it for as long
/// as the certificate says, so "how many are left" is a malformed question
/// rather than one whose answer is none — and `0` is a number somebody can
/// refuse leave with.
function LeaveTab({ employeeId }: { employeeId: string }) {
  const balances = useQuery({
    queryKey: leaveKeys.balances(employeeId),
    queryFn: ({ signal }) => leaveBalances(employeeId, signal),
  })
  const requests = useQuery({
    queryKey: leaveKeys.requests(employeeId),
    queryFn: ({ signal }) => leaveRequestsOf(employeeId, signal),
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Balances</SubHead>
        {queryState(balances, {
          loading: "Reading the ledger…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>
                No kind of leave draws on a balance yet, so there is none to
                report.
              </Quiet>
            ) : (
              <MiniTable
                head={["Kind", { label: "Pending", align: "right" }, "Left"]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.leave_type}>
                    <MiniCell>
                      <span className="block text-[0.8125rem] text-ink">
                        {row.name}
                      </span>
                      <span className="font-mono text-[0.65625rem] text-mute">
                        {row.leave_type}
                      </span>
                    </MiniCell>
                    {/* Asked for and not yet decided. Not deducted, and the
                        number somebody actually plans around. */}
                    <MiniCell align="right">
                      {row.pending_centidays === 0
                        ? "—"
                        : readDays(row.pending_centidays)}
                    </MiniCell>
                    <MiniCell align="right">{readDays(row.centidays)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </div>

      <div>
        <SubHead>Requests</SubHead>
        {queryState(requests, {
          loading: "Reading the requests…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>Never asked for a day off.</Quiet>
            ) : (
              <MiniTable
                head={[
                  "Kind",
                  { label: "From", align: "left" },
                  { label: "Charged", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.id}>
                    <MiniCell>
                      <span className="block text-[0.8125rem] text-ink">
                        {row.leave_type_name}
                      </span>
                      <span className="font-mono text-[0.65625rem] text-mute">
                        {leaveStateLabel(row.state)}
                        {row.decided_by !== null && ` · ${row.decided_by}`}
                      </span>
                    </MiniCell>
                    <MiniCell>{day(row.from_date)}</MiniCell>
                    {/* Not the length of the span: a holiday inside it is
                        already charged by the calendar, and charging it again
                        would take the same day off twice. */}
                    <MiniCell align="right">{row.chargeable_days}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </div>
    </div>
  )
}
