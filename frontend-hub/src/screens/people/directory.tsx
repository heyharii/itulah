import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { CalendarClock, UserPlus } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExceptionQueue } from "@/components/ui/exception-queue"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Choices } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { Timeline } from "@/components/ui/timeline"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { useDebounced } from "@/lib/use-debounced"
import { count, day, money, moment } from "@/lib/format"
import type { Tone } from "@/lib/format"
import {
  AMENDABLE_FIELDS,
  accountKeys,
  accountTargets,
  addContract,
  amendPersonalData,
  applyTransition,
  assignToPlace,
  boundedTo,
  claimStateLabel,
  claimsOf,
  clearable,
  claimsKeys,
  correctCode,
  daysUntil,
  exitInterviewStateLabel,
  exitInterviewStateTone,
  exitKeys,
  exitStanceLabel,
  fnfKeys,
  fnfStateLabel,
  fnfStateTone,
  leaveBalances,
  leaveKeys,
  leaveRequestsOf,
  leaveStateLabel,
  linkAccount,
  listWorkforce,
  listExitInterviews,
  listFnF,
  openAdvances,
  provisionAccount,
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
  type EmployeeFilters,
  type ContractKind,
  type Transition,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { usePeopleAudience } from "@/screens/people/scope"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type {
  AccountBinding,
  EmployeeSummary,
  EmployeeView,
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
    // No filter on this or on Name: both are looked up rather than narrowed
    // by, and the search box in the header already reads them — at the
    // server, which matches the number and the name.
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
    // Narrowed by the Status filter, which the server counts. Sorting four
    // state names alphabetically groups nothing anybody asked for, and the
    // server offers no such order.
    enableSorting: false,
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
    enableSorting: false,
    cell: ({ row }) =>
      row.original.position ?? <span className="text-mute">—</span>,
  },
  {
    accessorKey: "contract_kind",
    header: "Contract",
    size: 110,
    // PKWT against PKWTT is the Contract filter's question; "Term ends in"
    // beside it is the order that answers "who needs a renewal first".
    enableSorting: false,
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
    /// **Not filterable, because of the accessor directly above.** A permanent
    /// contract has no end date and is stood in for by `PERMANENT` so that it
    /// sorts last. A clause cannot see that substitution: "ends in more than
    /// 90 days" would answer with every permanent employee in the company,
    /// each one reported as a term running out in nine quadrillion days. Ask
    /// Contract instead — PKWT is the set with a term at all — and the
    /// exception queue above already carries the ones running out.
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
    // Narrowed by the Login filter, which the server counts; a column of two
    // words has no order worth asking for.
    enableSorting: false,
    cell: ({ row }) =>
      row.original.username ? (
        <span className="text-text">Linked</span>
      ) : (
        <span className="text-mute">None</span>
      ),
  },
]

/// How many employees one page of the directory asks for. A step, not a
/// ceiling: the list pages as it scrolls, and the server clamps anything above
/// a thousand.
const PAGE = 100

/// The column ids the server can order by, and the word it knows each by.
///
/// Every other column is `enableSorting: false` — a header that offered an
/// order the request cannot carry would sort the pages in hand and call it
/// the workforce.
const SORTS: Record<string, string> = {
  employee_code: "code",
  name: "name",
  expiry: "contract_end",
  place: "place",
}

/// The Login filter's two values, in words rather than as the `1`/`0` the
/// request carries — "Login is 0" is a sentence about a database.
function loginLabel(value: string): string {
  return value === "1" ? "Linked" : "None"
}

/// Contract kinds as the filter shows them. `NONE` is the server's word for
/// somebody with no contract on file.
function contractLabel(value: string): string {
  return value === "NONE" ? "No contract" : value
}

/// The chips, as the request that answers them. One value each, because the
/// endpoint compares one column to one value; every field is `single`.
function scopeFromFilters(filters: readonly Filter[]): EmployeeFilters {
  const scope: { -readonly [K in keyof EmployeeFilters]: EmployeeFilters[K] } =
    {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "status") scope.status = values[0]
    else if (column === "place") scope.placeId = values[0]
    else if (column === "contract_kind") scope.contractKind = values[0]
    else if (column === "position") scope.position = values[0]
    else if (column === "account") scope.login = values[0]
  }
  return scope
}

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

  /// What this list can be narrowed by, and only that: each field is a
  /// parameter `GET /employees` answers, so no chip narrows only the rows that
  /// happen to be loaded. The options and their counts arrive with the answer
  /// (see `counted` below).
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "status",
        label: "Status",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          format: statusLabel,
        },
      },
      {
        column: "place",
        label: "Posted to",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "position",
        label: "Job",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "contract_kind",
        label: "Contract",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          format: contractLabel,
        },
      },
      {
        column: "account",
        label: "Login",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          format: loginLabel,
        },
      },
    ],
    []
  )
  const filters = useFilterState(fields)

  /// Search, chips and order, as the one request that answers all three.
  /// Debounced, because every keystroke is a round trip.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<EmployeeFilters>(() => {
    const by = sorting[0]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      sort: by === undefined ? undefined : SORTS[by.id],
      dir: by?.desc === true ? "desc" : undefined,
      limit: PAGE,
    }
  }, [filters.filters, needle, sorting])
  const narrowed = needle !== "" || filters.filters.length > 0

  // The workforce a page at a time, searched, filtered and sorted by the
  // server — so a sort by contract end is the whole company's order and not
  // the order of whatever had loaded.
  const people = useInfiniteQuery({
    queryKey: peopleKeys.workforce(scope),
    queryFn: ({ pageParam, signal }) =>
      listWorkforce({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => people.data?.pages.flatMap((page) => page.rows) ?? [],
    [people.data]
  )
  const head = people.data?.pages[0]

  /// The same fields, carrying the server's own tally over everything the
  /// search and the caller's reach match — not over the rows loaded.
  const counted = useMemo<FilterField[]>(() => {
    const facets = head?.facets
    if (!facets) return fields
    const placeNames = new Map(
      facets.places.map((one) => [one.value, one.label ?? one.value])
    )
    return fields.map((field) => {
      switch (field.column) {
        case "status":
          return { ...field, spec: { ...field.spec, counted: facets.statuses } }
        case "place":
          return {
            ...field,
            spec: {
              ...field.spec,
              counted: facets.places,
              format: (id: string) => placeNames.get(id) ?? id,
            },
          }
        case "position":
          return {
            ...field,
            spec: { ...field.spec, counted: facets.positions },
          }
        case "contract_kind":
          return {
            ...field,
            spec: { ...field.spec, counted: facets.contract_kinds },
          }
        case "account":
          return { ...field, spec: { ...field.spec, counted: facets.logins } }
        default:
          return field
      }
    })
  }, [fields, head])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: EmployeeSummary) => row.employee_id,
        state: { sorting },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort the pages in hand and call it the workforce.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
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
        title="Employees"
        sub={
          bounded === null
            ? "Who works here, under what contract, and where they are posted. Personal data is a different question and a different privilege."
            : `${bounded} only — your own posting is what you may read. Personal data is a different question and a different privilege.`
        }
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search number or name"
              className="h-8 w-48"
            />
            {/* Asking for somebody — a sidebar row until 2026-09-27, and the
                front of the lifecycle this list holds the rest of. A shop
                asks here and head office decides here. */}
            <AppLink to="/people/hire" variant="ghost">
              <UserPlus />
              New employees
            </AppLink>
          </>
        }
      />

      {attention.length > 0 && (
        <ExceptionQueue
          title="Contracts running out"
          exceptions={attention}
          empty="No fixed term ends in the next month."
        />
      )}

      <Toolbar>
        <FilterPanel model={{ ...filters, fields: counted }} />
        {/* The server's count of everything the search and the chips match,
            not of the rows loaded so far. */}
        {head !== undefined && (
          <span className="ml-auto text-[0.8125rem] text-body">
            {count(head.total)} {head.total === 1 ? "employee" : "employees"}
          </span>
        )}
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(people, {
          loading: "Loading the workforce…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {narrowed
                  ? "Nobody matches this search and the filters in force."
                  : "Nobody has been registered yet. An employee record is created with a number, and a name is enrolled onto it afterwards."}
              </EmptyState>
            ) : (
              <DataTable<EmployeeSummary>
                table={table}
                onRowClick={(row) => employee.open(row.employee_id)}
                isSelected={(row) => row.employee_id === employee.value}
                more={people}
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
  { value: "claims", label: "Claims" },
  { value: "contracts", label: "Contracts" },
  { value: "exit", label: "Exit" },
  { value: "change", label: "Change" },
] as const

/// The tabs this caller is actually offered.
///
/// Every form behind **Change** — employment status, posting, contract,
/// employee number, the login, personal data — is an employer act, and every
/// one of the six is `Role::Admin` on the server. A place manager was being
/// shown the tab anyway, so the one screen a store opens daily carried six
/// forms whose Save could only ever answer 403: an offer the app cannot keep.
///
/// Hiding it is not the permission — the routes stay the permission. This only
/// stops the screen promising something it will be refused.
///
/// `null` from the audience hook means "not yet known", and that is read as
/// "not offered": a tab that appears a moment late is better than one that is
/// drawn and then taken away under the reader's cursor.
///
/// The exit tab is a leaver's tab: an exit interview exists for somebody whose
/// employment ended, so it is offered only when the record says TERMINATED —
/// a tab beside an active record promises something that cannot exist.
function tabsFor(
  employer: boolean,
  status?: string
): readonly (typeof TABS)[number][] {
  const base = employer ? TABS : TABS.filter((one) => one.value !== "change")
  return status === "TERMINATED"
    ? base
    : base.filter((one) => one.value !== "exit")
}

function EmployeeSheet({
  id,
  listed,
  onClose,
}: {
  id: string | null
  listed: EmployeeSummary | null
  onClose: () => void
}) {
  const employer = usePeopleAudience() === "employer"

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
          <EmployeeSheetBody
            person={person}
            listed={listed}
            employer={employer}
          />
        ),
      })}
    </Sheet>
  )
}

/// One person's sheet, once the record is in hand.
///
/// # The tabs depend on the reader AND the record
///
/// The Change forms are head office's, and the exit tab belongs to a leaver —
/// an exit interview exists for somebody whose employment ended, and showing
/// it beside an active record promises something that cannot exist. Both
/// facts arrive with the detail read, so the tabs are computed here rather
/// than in the sheet. A tab the reader may no longer be offered falls back
/// rather than rendering nothing: opening a second person keeps the tab the
/// first one was read on, and that tab may not exist for them.
function EmployeeSheetBody({
  person,
  listed,
  employer,
}: {
  person: EmployeeView
  listed: EmployeeSummary | null
  employer: boolean
}) {
  const [tab, setTab] = useState<string>("record")
  const tabs = tabsFor(employer, person.status)
  const shown = tabs.some((one) => one.value === tab) ? tab : "record"

  return (
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
        <SubTabs tabs={tabs} value={shown} onChange={setTab} />

        {shown === "record" && (
          <div className="flex flex-col gap-5">
            <div>
              <SubHead>Employment</SubHead>
              {person.history.length === 0 ? (
                <Quiet>
                  Nothing has happened to this record yet — not even a hire.
                </Quiet>
              ) : (
                <Timeline
                  events={person.history.map((event, index) => ({
                    id: `${event.transition}-${event.at}-${index}`,
                    title: `${event.transition} — ${event.from} → ${event.to}`,
                    detail: `${event.actor} · ${event.reason}`,
                    at: day(event.effective_on),
                    state:
                      index === person.history.length - 1 ? "current" : "done",
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
                  head={["Place", { label: "From", align: "left" }, "Until"]}
                >
                  {person.assignments.map((assignment) => (
                    <MiniRow
                      key={`${assignment.place_id}-${assignment.valid_from}`}
                    >
                      <MiniCell>
                        <span className="block text-[0.875rem] text-ink">
                          {assignment.place_name ?? assignment.place_id}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
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
                      <MiniCell align="right">{correction.actor}</MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            )}
          </div>
        )}

        {shown === "leave" && <LeaveTab employeeId={person.employee_id} />}

        {shown === "claims" && <ClaimsTab employeeId={person.employee_id} />}

        {shown === "contracts" && <Contracts employeeId={person.employee_id} />}

        {shown === "exit" && (
          <ExitTab employeeId={person.employee_id} employer={employer} />
        )}

        {shown === "change" && (
          <Changes employeeId={person.employee_id} account={person.account} />
        )}
      </div>
    </div>
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
                  <span className="mt-0.5 block font-mono text-[0.875rem] text-mute">
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
      required
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
        queryKey: peopleKeys.lists(),
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
            required
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
        queryKey: peopleKeys.lists(),
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

      <form.Field name="placeId">
        {(field) => (
          <Field
            label="Place"
            required
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
            <Field label="From" required>
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
        queryKey: peopleKeys.lists(),
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
            <Field label="Starts on" required>
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
                  required={draft.kind === "PKWT"}
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
            <Field label="Position" required>
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
            <Field label="Grade" required>
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
        queryKey: peopleKeys.lists(),
      })
      setCode("")
      setReason("")
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {correct.isError && <ErrorState error={correct.error} />}

      <Field label="New employee number" required>
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

/// The login this record signs in with: issued here, bound here, released here.
///
/// Three acts behind one entry rather than three, because they are the same
/// decision in different directions and a person who has picked "the login"
/// wants to see the one they have before choosing.
///
/// # Issuing was the half that had no screen
///
/// `POST /employees/{id}/account/provision` and its `…/account/targets` list
/// have been live since 0097, and nothing in the app had ever called either.
/// So head office could *bind* a login that already existed and could not
/// *create* one — meaning a new hire's credential had to be made in System >
/// Accounts and then found again here by typing the username back in by hand.
/// Two screens and a name retyped, for one act the server already performs
/// atomically, along with the till grant that has to go with it.
///
/// The till grant is why this belongs here rather than in System. Whether
/// somebody signs in at a shop's node, and at what rung, is a fact about their
/// **posting** — it is HR's answer, not the account administrator's, and the
/// targets endpoint exists precisely so this form can ask "which till does this
/// person's place have" without the browser having to know that
/// `org_place.site_id` and `sync_origin_credential.site_id` are one vocabulary.
///
/// What this form still deliberately cannot do is *close* an account: a release
/// says the credential is not this person's, and closing somebody's login is
/// either ending their employment — which does it as part of the same act — or
/// an administrator's decision in System > Accounts.
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
  const [how, setHow] = useState<"link" | "issue">("link")
  const [fresh, setFresh] = useState<FreshLogin>(BLANK_LOGIN)

  const refresh = () => {
    client.invalidateQueries({ queryKey: peopleKeys.employee(employeeId) })
    client.invalidateQueries({
      queryKey: peopleKeys.lists(),
    })
    setUsername("")
    setReason("")
    setFresh(BLANK_LOGIN)
  }

  // Only asked for once issuing is the chosen act. A place with no till has no
  // targets, and asking for them while somebody is typing a username they
  // already have is a request nobody's answer depends on.
  const targets = useQuery({
    queryKey: accountKeys.targets(employeeId),
    queryFn: ({ signal }) => accountTargets(employeeId, signal),
    enabled: account === null && how === "issue",
  })

  const link = useMutation({
    mutationFn: () => linkAccount(employeeId, username.trim(), reason.trim()),
    onSuccess: refresh,
  })
  const issue = useMutation({
    mutationFn: () =>
      provisionAccount(employeeId, {
        username: fresh.username.trim(),
        displayName: fresh.displayName.trim(),
        password: fresh.password,
        role: fresh.role,
        // Omitted rather than sent empty: no grant at all and a grant with no
        // node are different requests, and the server reads the second as a
        // mistake.
        edge:
          fresh.origin === ""
            ? undefined
            : {
                originId: fresh.origin,
                role: fresh.edgeRole,
                edgePassword: fresh.edgePassword,
              },
        reason: reason.trim(),
      }),
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

  const freshAtDc =
    (targets.data ?? []).find((one) => one.origin_id === fresh.origin)
      ?.node_role === "DC"

  const readyToIssue =
    fresh.username.trim() !== "" &&
    fresh.displayName.trim() !== "" &&
    fresh.password !== "" &&
    reason.trim() !== "" &&
    // A store picked but no PIN typed for it is a grant that cannot be used.
    // A DC needs none: the hub signs people in there with this login.
    (fresh.origin === "" || freshAtDc || fresh.edgePassword !== "")

  return (
    <div className="flex flex-col gap-4">
      {link.isError && <ErrorState error={link.error} />}
      {issue.isError && <ErrorState error={issue.error} />}

      <Choices
        label="How this record gets a login"
        options={HOW}
        value={how}
        onChange={setHow}
        columns={1}
      />

      {how === "link" ? (
        <>
          <Field
            label="Username"
            required
            hint="An account that already exists, and that nobody else is."
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
        </>
      ) : (
        <>
          <Field
            label="Username"
            hint="Lower case, and nobody else's."
            required
          >
            <Input
              value={fresh.username}
              onChange={(event) =>
                setFresh({ ...fresh, username: event.target.value })
              }
              placeholder="siti.rahayu"
            />
          </Field>
          <Field label="Display name" required>
            <Input
              value={fresh.displayName}
              onChange={(event) =>
                setFresh({ ...fresh, displayName: event.target.value })
              }
              placeholder="Siti Rahayu"
            />
          </Field>
          <Field
            label="Password"
            required
            hint="Typed once and never echoed back. Hand it over, and have them change it."
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={fresh.password}
              onChange={(event) =>
                setFresh({ ...fresh, password: event.target.value })
              }
            />
          </Field>
          <Field
            label="Rung"
            hint="What they may do in the console. Where they may do it comes from their posting, not from here."
          >
            <Select
              value={fresh.role}
              onChange={(next) =>
                setFresh({ ...fresh, role: next as FreshLogin["role"] })
              }
            >
              {RUNGS.map((rung) => (
                <option key={rung.value} value={rung.value}>
                  {rung.label}
                </option>
              ))}
            </Select>
          </Field>

          {/* The till grant. It lives here rather than in System because
              whether somebody signs in at a shop's node is a fact about their
              posting, and the posting is this module's answer. */}
          {queryState(targets, {
            loading: "Looking up this person's nodes…",
            render: (nodes) =>
              nodes.length === 0 ? (
                <Banner tone="info">
                  This person&rsquo;s place is served by no syncing node, so
                  there is no till to grant. Head office staff usually are not.
                </Banner>
              ) : (
                <>
                  <Field
                    label="Also signs in at"
                    hint="Optional. A place's own node, for somebody who works a till."
                  >
                    <Select
                      value={fresh.origin}
                      onChange={(next) => setFresh({ ...fresh, origin: next })}
                    >
                      <option value="">No node — console only</option>
                      {nodes.map((one) => (
                        <option
                          key={one.origin_id}
                          value={one.origin_id}
                          disabled={one.granted}
                        >
                          {one.label ?? one.origin_id}
                          {one.granted
                            ? ` — already granted${
                                one.granted_role === null
                                  ? ""
                                  : ` (${rungLabel(one.granted_role)})`
                              }`
                            : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {fresh.origin !== "" && (
                    <>
                      <Field label="Rung at that node">
                        <Select
                          value={fresh.edgeRole}
                          onChange={(next) =>
                            setFresh({
                              ...fresh,
                              edgeRole: next as FreshLogin["edgeRole"],
                            })
                          }
                        >
                          {RUNGS.map((rung) => (
                            <option key={rung.value} value={rung.value}>
                              {rung.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label={
                          freshAtDc
                            ? "Offline password at that DC"
                            : "Password at that node"
                        }
                        required={!freshAtDc}
                        hint={
                          freshAtDc
                            ? "Not needed to sign in: the hub uses this login. Set one only for signing in while the DC cannot reach the centre."
                            : "The till is a separate credential — it has to keep working when the shop is offline."
                        }
                      >
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={fresh.edgePassword}
                          onChange={(event) =>
                            setFresh({
                              ...fresh,
                              edgePassword: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                </>
              ),
          })}

          <Reason value={reason} onChange={setReason} />

          <Submit
            label="Issue the login"
            busy={issue.isPending}
            disabled={!readyToIssue}
            onClick={() => issue.mutate()}
          />
        </>
      )}
    </div>
  )
}

/// The two ways a record gets a login, said as two tiles rather than left to a
/// reader to work out from a username box that will refuse a name nobody has.
const HOW = [
  {
    value: "link" as const,
    label: "Link one that exists",
    note: "They already sign in — bind that account to this record.",
  },
  {
    value: "issue" as const,
    label: "Issue a new one",
    note: "Create the credential, and the till grant that goes with their posting, in one act.",
  },
]

const RUNGS = [
  { value: "CASHIER", label: "Cashier" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ADMIN", label: "Admin" },
] as const

function rungLabel(role: string): string {
  return RUNGS.find((rung) => rung.value === role)?.label ?? role
}

interface FreshLogin {
  username: string
  displayName: string
  password: string
  role: "CASHIER" | "SUPERVISOR" | "ADMIN"
  /// Empty means "console only" — no node grant at all.
  origin: string
  edgeRole: "CASHIER" | "SUPERVISOR" | "ADMIN"
  edgePassword: string
}

const BLANK_LOGIN: FreshLogin = {
  username: "",
  displayName: "",
  password: "",
  role: "CASHIER",
  origin: "",
  edgeRole: "CASHIER",
  edgePassword: "",
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
        queryKey: peopleKeys.lists(),
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
                  required={!clearable(chosen)}
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
                <Field label="Date of birth" required>
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
                      <span className="block text-[0.875rem] text-ink">
                        {row.name}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
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
                      <span className="block text-[0.875rem] text-ink">
                        {row.leave_type_name}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
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

/// What this person has asked the petty cash for, and what they are still
/// holding of the company's money.
///
/// Read-only, and deliberately so: deciding a claim is the queue's work, and
/// a sheet that offered a second place to do it would be a second place to
/// get a different answer. The advances underneath are Finance's table (0280)
/// read through the employee route — People does not keep its own answer
/// about who is holding money, and the narrowing to this one employee is the
/// server's. The fold behind it carries every leg money has come back by,
/// recovered-via-gaji included.
function ClaimsTab({ employeeId }: { employeeId: string }) {
  const claims = useQuery({
    queryKey: claimsKeys.of(employeeId),
    queryFn: ({ signal }) => claimsOf(employeeId, signal),
  })
  const advances = useQuery({
    queryKey: claimsKeys.advances(employeeId),
    queryFn: ({ signal }) => openAdvances(employeeId, signal),
  })

  // Approved and unpaid is the number the payout still owes — the debt the
  // ledger already carries between the decision and the petty-cash drawer.
  const owed = (claims.data ?? [])
    .filter((row) => row.state === "APPROVED")
    .reduce((sum, row) => sum + (row.sanctioned_minor ?? 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Claims</SubHead>
        {queryState(claims, {
          loading: "Reading the claims…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>Never asked the petty cash for anything.</Quiet>
            ) : (
              <>
                <KeyValue term="Approved, not yet paid">
                  {owed === 0 ? "nothing" : money(owed)}
                </KeyValue>
                <MiniTable
                  head={[
                    "Claim",
                    { label: "Filed", align: "left" },
                    { label: "Claimed", align: "right" },
                    { label: "Sanctioned", align: "right" },
                  ]}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.claim_id}>
                      <MiniCell>
                        <span className="block font-mono text-[0.875rem] text-ink">
                          {row.claim_number}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {claimStateLabel(row.state)}
                          {row.decided_by !== null && ` · ${row.decided_by}`}
                        </span>
                      </MiniCell>
                      <MiniCell>{day(row.posted_on)}</MiniCell>
                      <MiniCell align="right">
                        {money(row.claimed_minor)}
                      </MiniCell>
                      {/* Absent until decided, and a dash rather than a zero:
                          not yet sanctioned is not the same fact as sanctioned
                          to nothing. */}
                      <MiniCell align="right">
                        {row.sanctioned_minor === null ? (
                          <span className="text-mute">—</span>
                        ) : (
                          money(row.sanctioned_minor)
                        )}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </>
            ),
        })}
      </div>

      <div>
        <SubHead>Advances</SubHead>
        {queryState(advances, {
          loading: "Reading the advances…",
          render: (rows) =>
            rows.length === 0 ? (
              <Quiet>Holding none of the company's money.</Quiet>
            ) : (
              <MiniTable
                head={[
                  "Advance",
                  { label: "Out since", align: "left" },
                  { label: "Settled", align: "right" },
                  { label: "Refunded", align: "right" },
                  { label: "Dipulihkan via gaji", align: "right" },
                  { label: "Outstanding", align: "right" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.advance_id}>
                    <MiniCell>
                      <span className="block font-mono text-[0.875rem] text-ink">
                        {row.advance_number}
                      </span>
                      <span className="font-mono text-[0.875rem] text-mute">
                        {row.status.toLowerCase()}
                      </span>
                    </MiniCell>
                    <MiniCell>{day(row.paid_at)}</MiniCell>
                    <MiniCell align="right">
                      {money(row.settled_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.refunded_minor)}
                    </MiniCell>
                    {/* The wage leg: repaid out of a run the place filed and
                        head office approved. A zero is honest here — nothing
                        recovered yet is a fact a reader checks against the
                        outstanding beside it. */}
                    <MiniCell align="right">
                      {money(row.recovered_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(row.outstanding_minor)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
      </div>
    </div>
  )
}

/// What this person left behind: the interview and the statement.
///
/// Shown only for the terminated — the tab is offered only when the record
/// says TERMINATED — and read-only, like the Claims tab beside which it sits:
/// conducting an interview and settling a statement are the Exits screen's
/// work, and a sheet that offered a second place to do them would be a second
/// place to get a different answer. The statement rows link there, one click,
/// because DESIGN.md asks for no dead ends.
///
/// # The statement is the employer's read
///
/// Reading statements needs `people.fnf.settle`, which is head office's; a
/// place manager's tab shows the interview and stops there, rather than
/// fetching a guaranteed refusal on every open.
function ExitTab({
  employeeId,
  employer,
}: {
  employeeId: string
  employer: boolean
}) {
  const interviews = useQuery({
    queryKey: exitKeys.of(employeeId),
    queryFn: ({ signal }) =>
      listExitInterviews({ employee: employeeId }, signal),
  })
  const statements = useQuery({
    queryKey: fnfKeys.of(employeeId),
    queryFn: ({ signal }) => listFnF(employeeId, signal),
    enabled: employer,
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SubHead>Exit interview</SubHead>
        {queryState(interviews, {
          loading: "Reading the interview…",
          render: (rows) => {
            const one = rows[0] ?? null
            return one === null ? (
              <Quiet>
                No exit interview — they left before the hook existed, and head
                office can open one on the Exits screen.
              </Quiet>
            ) : (
              <>
                <div className="flex items-center gap-2 py-1">
                  <Pill tone={exitInterviewStateTone(one.state)}>
                    {exitInterviewStateLabel(one.state)}
                  </Pill>
                  {one.state === "COMPLETED" && (
                    <span className="text-meta text-body">
                      {exitStanceLabel(one.employee_stance)}
                    </span>
                  )}
                </div>
                <KeyValue term="Left">{day(one.created_at)}</KeyValue>
                {one.completed_at !== null && (
                  <KeyValue term="Conducted">
                    {one.conducted_by} · {moment(one.completed_at)}
                  </KeyValue>
                )}
                {one.state === "CANCELLED" && (
                  <KeyValue term="Cancelled">
                    {one.cancelled_by} · {one.cancel_reason}
                  </KeyValue>
                )}
                {one.interview_summary !== null && (
                  <p className="mt-2 whitespace-pre-wrap text-body">
                    {one.interview_summary}
                  </p>
                )}
              </>
            )
          },
        })}
      </div>

      {employer && (
        <div>
          <SubHead>Full & final</SubHead>
          {queryState(statements, {
            loading: "Reading the statements…",
            render: (rows) =>
              rows.length === 0 ? (
                <Quiet>Nothing settled with this leaver yet.</Quiet>
              ) : (
                <MiniTable
                  head={[
                    "Statement",
                    { label: "State", align: "left" },
                    { label: "Net", align: "right" },
                  ]}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.fnf_id}>
                      <MiniCell>
                        {day(row.transaction_on)}
                        <span className="block font-mono text-[0.875rem] text-mute">
                          {moment(row.created_at)} · {row.created_by}
                        </span>
                      </MiniCell>
                      <MiniCell>
                        <Pill tone={fnfStateTone(row.state)}>
                          {fnfStateLabel(row.state)}
                        </Pill>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="tabular-nums">
                          {money(row.net_payable_minor)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              ),
          })}
        </div>
      )}
    </div>
  )
}
