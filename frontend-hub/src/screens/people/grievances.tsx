import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Timeline } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { day, moment } from "@/lib/format"
import {
  defineGrievanceType,
  employerScope,
  fileGrievance,
  grievanceActionLabel,
  grievanceKeys,
  grievanceStateLabel,
  grievanceStateTone,
  investigateGrievance,
  listEmployees,
  listGrievanceTypes,
  listGrievances,
  peopleKeys,
  resolveGrievance,
  retireGrievanceType,
  useReach,
  withdrawGrievance,
  type GrievanceRow,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Quiet } from "@/screens/people/parts"

/// Grievances: the confidential channel, and the reason it is head office's.
///
/// # Why the queue cannot be the store's
///
/// A grievance against a store manager cannot be investigated by that store
/// manager, and in a thirteen-store estate the only place that is nobody's
/// posting is head office. So the queue is HO's — reading it is its own key,
/// finer than the ladder, precisely so the accused supervisor who holds
/// `people.employee.read` does not therefore read the queue. It deliberately
/// does not join the Requests queue, whose rows a place manager reads.
///
/// # Two actors, twice
///
/// Nobody investigates or resolves their own filing, and investigating and
/// resolving are two signatures under two keys — the payroll lesson again.
/// The sheet offers the acts and lets the server answer, which is the claims
/// sheet's rule: a button that appears a moment late is worse than one that
/// is answered honestly.
///
/// # One route, two faces
///
/// For head office the list route answers with the queue, whole. For anybody
/// else the same route answers with their own filings and nothing else — the
/// server branches on the caller, so this screen never re-implements the
/// branch, and a bounded caller's tab is their own record of what they filed
/// and whatever became of it.
///
/// The tab is `useState`, the way `claims.tsx` holds its own: People stays
/// flat, one address, and the thing worth sending is a grievance, which the
/// sheet in the address bar already carries.

const queueColumns: ColumnDef<TableSetup, GrievanceRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.raised_by_name ?? row.raised_by,
    header: "Raised by",
    size: 200,
    // No filter: this is a queue, and narrowing it by one would mean already
    // knowing whose grievance you were looking for.
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.raised_by_name ?? row.original.raised_by}
      </span>
    ),
  },
  {
    id: "against",
    accessorFn: (row) => row.against_name ?? "",
    header: "Against",
    size: 200,
    /// A grievance may be against a policy, not a person — the dash is the
    /// honest cell for that, not a missing name.
    cell: ({ row }) =>
      row.original.against_name ??
      row.original.against_employee ?? <span className="text-mute">—</span>,
  },
  {
    id: "kind",
    accessorFn: (row) => row.type_name,
    header: "Kind",
    size: 160,
    /// The kinds actually open, faceted off the queue: "just the harassment
    /// ones" is the clause this exists for.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.type_name,
  },
  {
    id: "place",
    accessorFn: (row) => row.unit_name ?? row.unit_id,
    header: "Unit",
    size: 160,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.unit_name ?? row.original.unit_id,
  },
  {
    id: "filed",
    accessorKey: "created_at",
    header: "Filed",
    size: 130,
    /// The default sort of the queue is this column ascending: the first
    /// screenful is whoever has been waiting longest. A grievance waiting is
    /// not money aging — it is worse.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    id: "subject",
    accessorFn: (row) => row.subject,
    header: "Subject",
    size: 260,
    cell: ({ row }) => (
      <span className="block truncate text-text">{row.original.subject}</span>
    ),
  },
]

const listColumns: ColumnDef<TableSetup, GrievanceRow>[] = [
  {
    id: "subject",
    accessorFn: (row) => row.subject,
    header: "Subject",
    size: 240,
    // A grievance has no number; the subject is what one is found by.
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.subject}</span>
    ),
  },
  {
    id: "who",
    accessorFn: (row) => row.raised_by_name ?? row.raised_by,
    header: "Raised by",
    size: 180,
    cell: ({ row }) =>
      row.original.raised_by_name ?? row.original.raised_by,
  },
  {
    id: "against",
    accessorFn: (row) => row.against_name ?? row.against_employee ?? "",
    header: "Against",
    size: 180,
    cell: ({ row }) =>
      row.original.against_name ??
      row.original.against_employee ?? <span className="text-mute">—</span>,
  },
  {
    id: "kind",
    accessorFn: (row) => row.type_name,
    header: "Kind",
    size: 150,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.type_name,
  },
  {
    id: "place",
    accessorFn: (row) => row.unit_name ?? row.unit_id,
    header: "Unit",
    size: 150,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.unit_name ?? row.original.unit_id,
  },
  {
    id: "filed",
    accessorKey: "created_at",
    header: "Filed",
    size: 120,
    /// The list sorts newest first — the opposite of the queue, because the
    /// list is a record and the queue is a desk.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    accessorKey: "state",
    header: "State",
    size: 200,
    /// A fact to read and to narrow by, never a control.
    meta: { filter: { kind: "option", format: grievanceStateLabel } },
    cell: ({ row }) => (
      <Pill tone={grievanceStateTone(row.original.state)}>
        {grievanceStateLabel(row.original.state)}
      </Pill>
    ),
  },
]

export function Grievances() {
  const grievance = useSheet("grievance")
  const reach = useReach()
  const employer = employerScope(reach.data) === true

  const [tab, setTab] = useState<string>("queue")
  const tabs = useMemo(
    () =>
      employer
        ? [
            { value: "queue", label: "Queue" },
            { value: "all", label: "All" },
            { value: "types", label: "Types" },
          ]
        : [{ value: "mine", label: "Mine" }],
    [employer]
  )
  // A tab the caller may no longer be offered falls back rather than rendering
  // nothing — the employer's tabs arrive only once the reach is known.
  const shown = tabs.some((one) => one.value === tab) ? tab : tabs[0]!.value

  // The list reads live here rather than in the tabs, because the sheet has to
  // find its row whichever list it was opened from. The queue is the two live
  // states asked separately and merged — OPEN and INVESTIGATED are both
  // waiting on head office, and the route takes one state per call.
  const openQuery = useQuery({
    queryKey: grievanceKeys.list("OPEN"),
    queryFn: ({ signal }) => listGrievances({ state: "OPEN" }, signal),
  })
  const investigatingQuery = useQuery({
    queryKey: grievanceKeys.list("INVESTIGATED"),
    queryFn: ({ signal }) => listGrievances({ state: "INVESTIGATED" }, signal),
  })
  const all = useQuery({
    queryKey: grievanceKeys.list(null),
    queryFn: ({ signal }) => listGrievances({}, signal),
  })

  const openRows = openQuery.data ?? []
  const investigatingRows = investigatingQuery.data ?? []
  const queueRows = useMemo(
    () =>
      [...openRows, ...investigatingRows].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      ),
    [openRows, investigatingRows]
  )

  // Two reads behind one table: the table's three-way render needs to know
  // whether either half is still coming, and retrying means asking both again.
  const queueQuery = {
    isPending: openQuery.isPending || investigatingQuery.isPending,
    isError: openQuery.isError || investigatingQuery.isError,
    error: openQuery.error ?? investigatingQuery.error,
    data: queueRows,
    refetch: () => {
      void openQuery.refetch()
      void investigatingQuery.refetch()
    },
  }

  const allRows = useMemo(() => all.data ?? [], [all.data])
  // The list a bounded caller reads IS their own — the server branch decides
  // that, and the screen says so in the header rather than filtering here.
  const mineRows = allRows
  const open =
    queueRows.find((row) => row.grievance_id === grievance.value) ??
    allRows.find((row) => row.grievance_id === grievance.value) ??
    null

  const SUB: Record<string, string> = {
    queue: "Open grievances waiting on head office, across every place.",
    all: "Every grievance the caller may see, decided or not.",
    mine: "The grievances you filed, whatever became of them — nobody else's.",
    types:
      "The kinds of grievance a filing may name. Head office defines them; a filing picks from them.",
  }

  return (
    <PageContent>
      <PageHeader crumb="People" title="Grievances" sub={SUB[shown]} />

      <SubTabs tabs={tabs} value={shown} onChange={setTab} />

      {shown === "queue" && (
        <>
          <Banner tone="info" className="mb-4">
            A grievance is read at head office and nowhere else: the person it
            names cannot investigate it, and nobody decides their own filing —
            investigating and resolving are two signatures.
          </Banner>
          <GrievanceTable
            rows={queueRows}
            columns={queueColumns}
            query={queueQuery}
            loading="Reading the queue…"
            sorting={[{ id: "filed", desc: false }]}
            onOpen={grievance.open}
            isSelected={(row) => row.grievance_id === grievance.value}
            emptyNone="Nothing anywhere is waiting on head office."
          />
        </>
      )}

      {shown === "all" && (
        <GrievanceTable
          rows={allRows}
          columns={listColumns}
          query={all}
          loading="Reading the grievances…"
          sorting={[{ id: "filed", desc: true }]}
          onOpen={grievance.open}
          isSelected={(row) => row.grievance_id === grievance.value}
          emptyNone="No grievance has been filed yet."
        />
      )}

      {shown === "mine" && (
        <GrievanceTable
          rows={mineRows}
          columns={listColumns}
          query={all}
          loading="Reading your filings…"
          sorting={[{ id: "filed", desc: true }]}
          onOpen={grievance.open}
          isSelected={(row) => row.grievance_id === grievance.value}
          emptyNone="You have not filed a grievance."
        />
      )}

      {shown === "types" && <GrievanceTypes />}

      <FileGrievance />

      <GrievanceSheet row={open} onClose={grievance.close} />
    </PageContent>
  )
}

/// The table every list tab draws, with the sentence each empty state says.
///
/// "Empty" and "empty because of a filter" are different sentences everywhere
/// in this app, and on the queue the difference is somebody's grievance
/// waiting unanswered behind a clause somebody forgot was there.
function GrievanceTable({
  rows,
  columns,
  query,
  loading,
  sorting: defaultSorting,
  onOpen,
  isSelected,
  emptyNone,
}: {
  rows: GrievanceRow[]
  columns: ColumnDef<TableSetup, GrievanceRow>[]
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    data: GrievanceRow[] | undefined
    refetch: () => void
  }
  loading: string
  sorting: SortingState
  onOpen: (id: string) => void
  isSelected: (row: GrievanceRow) => boolean
  emptyNone: string
}) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: GrievanceRow) => row.grievance_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <>
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(query, {
          loading,
          render: () =>
            rows.length === 0 ? (
              <EmptyState>{emptyNone}</EmptyState>
            ) : (
              <DataTable<GrievanceRow>
                table={table}
                onRowClick={(row) => onOpen(row.grievance_id)}
                isSelected={isSelected}
                empty={
                  <>
                    {rows.length.toLocaleString("id-ID")} grievances are here,
                    and none of them match the filters in force.
                  </>
                }
              />
            ),
        })}
      </Card>
    </>
  )
}

/// Filing, from wherever the truth is.
///
/// # Anybody may raise one
///
/// That is the whole point of the channel: `people.grievance.request_own`
/// sits at the bottom rung, because an employee must be able to complain
/// about their own supervisor without asking them. A manager may file for a
/// member of staff instead — the picker is bounded by the server to the
/// people the caller may file for, so it never offers a name the route would
/// refuse — and "Myself" is always the first option, because the caller's own
/// complaint needs nobody's leave.
///
/// # Against is optional
///
/// A grievance may be against a policy, not a person, and the form says so
/// rather than making the field feel skipped.
function FileGrievance() {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [typeCode, setTypeCode] = useState("")
  const [against, setAgainst] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [cause, setCause] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const types = useQuery({
    queryKey: grievanceKeys.types(),
    queryFn: ({ signal }) => listGrievanceTypes(signal),
  })

  const people = team.data ?? []
  const kinds = (types.data ?? []).filter((one) => one.retired_at === null)

  const file = useMutation({
    mutationFn: () =>
      fileGrievance({
        // Absent means the caller's own — the server's branch, not a flag
        // this form pretends to know.
        employeeId: employeeId === "" ? undefined : employeeId,
        typeCode,
        againstEmployee: against === "" ? undefined : against,
        subject: subject.trim(),
        description: description.trim(),
        cause: cause.trim() === "" ? undefined : cause.trim(),
      }),
    onSuccess: () => {
      setFailed(null)
      setTypeCode("")
      setAgainst("")
      setSubject("")
      setDescription("")
      setCause("")
      // Filed is now waiting on head office somewhere, and the filer's own
      // list has a new row — the module's whole prefix.
      void client.invalidateQueries({ queryKey: ["people", "grievances"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready =
    typeCode !== "" &&
    subject.trim() !== "" &&
    description.trim() !== ""

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader>
        <CardTitle>File a grievance</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {types.isSuccess && kinds.length === 0 && (
          <Banner tone="bad">
            No kinds of grievance are defined, so nothing can be filed. Head
            office names them on the Types tab.
          </Banner>
        )}

        <Field
          label="For"
          hint="Yourself, or a member of your staff. The grievance is read at head office either way."
        >
          <Select value={employeeId} onChange={(next) => setEmployeeId(next)}>
            <option value="">Myself</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={typeCode} onChange={(next) => setTypeCode(next)}>
            <option value="">Choose…</option>
            {kinds.map((kind) => (
              <option key={kind.code} value={kind.code}>
                {kind.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Against"
          hint="Optional — a grievance may be against a policy, not a person."
        >
          <Select value={against} onChange={(next) => setAgainst(next)}>
            <option value="">—</option>
            {people
              .filter((person) => person.employee_id !== employeeId)
              .map((person) => (
                <option key={person.employee_id} value={person.employee_id}>
                  {person.full_name ?? person.employee_code}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Subject">
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Jadwal shift tidak sesuai kontrak"
          />
        </Field>
        <Field
          label="What happened"
          hint="Said plainly. This is read at head office, by somebody who was not there."
        >
          <Textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Cause" hint="Optional — what you believe is behind it.">
          <Input
            value={cause}
            onChange={(event) => setCause(event.target.value)}
            placeholder="Penugasan di luar jam kontrak"
          />
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={!ready || file.isPending}
            onClick={() => file.mutate()}
          >
            File it
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// The grievance itself, and whichever of its three acts the caller may take.
///
/// # The buttons are not the control
///
/// Investigating, resolving and withdrawing are each somebody's own act on
/// the server, under three keys: investigating is not deciding, deciding is
/// not withdrawing, and the filer — whoever they are — can never be the one
/// who decides their own filing. The sheet offers the act and lets the server
/// answer.
function GrievanceSheet({
  row,
  onClose,
}: {
  row: GrievanceRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [note, setNote] = useState("")
  const [detail, setDetail] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const invalidate = () => {
    setFailed(null)
    setNote("")
    setDetail("")
    setReason("")
    // The queue loses a row, the lists gain one, and the filer's own view
    // changes — one prefix covers all of them.
    void client.invalidateQueries({ queryKey: ["people", "grievances"] })
  }

  const investigate = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no grievance is open")
      return investigateGrievance(row.grievance_id, note.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  const resolve = useMutation({
    mutationFn: (valid: boolean) => {
      if (row === null) throw new Error("no grievance is open")
      return resolveGrievance(row.grievance_id, valid, detail.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  const withdraw = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no grievance is open")
      return withdrawGrievance(row.grievance_id, reason.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  if (row === null) return null

  const live = row.state === "OPEN" || row.state === "INVESTIGATED"

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()} id={row.grievance_id} title={row.subject}>
      <Pill tone={grievanceStateTone(row.state)}>
        {grievanceStateLabel(row.state)}
      </Pill>

      <Facts>
        <Fact term="Raised by">
          {row.raised_by_name ?? row.raised_by}
        </Fact>
        <Fact term="Filed by">{row.filed_by}</Fact>
        <Fact term="Against">
          {row.against_name ??
            row.against_employee ?? <span className="text-mute">—</span>}
        </Fact>
        <Fact term="Unit">{row.unit_name ?? row.unit_id}</Fact>
        <Fact term="Kind">{row.type_name}</Fact>
        <Fact term="Filed">{moment(row.created_at)}</Fact>
        {row.investigated_at !== null && (
          <Fact term="Investigated">
            {row.investigated_by} · {moment(row.investigated_at)}
          </Fact>
        )}
        {row.resolved_at !== null && (
          <Fact term="Decided">
            {row.resolved_by} · {moment(row.resolved_at)}
          </Fact>
        )}
        {row.resolved_on !== null && (
          <Fact term="Effective">{day(row.resolved_on)}</Fact>
        )}
        {row.withdrawn_at !== null && (
          <Fact term="Withdrawn">{moment(row.withdrawn_at)}</Fact>
        )}
        {row.cause !== null && <Fact term="Cause">{row.cause}</Fact>}
      </Facts>

      <div className="mt-4">
        <SubHead>What happened</SubHead>
        <p className="text-body whitespace-pre-wrap">{row.description}</p>
      </div>

      {row.investigation_note !== null && (
        <div className="mt-4">
          <SubHead>Investigation</SubHead>
          <p className="text-body whitespace-pre-wrap">
            {row.investigation_note}
          </p>
        </div>
      )}

      {row.resolution_detail !== null && (
        <div className="mt-4">
          <SubHead>Decision</SubHead>
          <p className="text-body whitespace-pre-wrap">
            {row.resolution_detail}
          </p>
        </div>
      )}

      {row.state === "OPEN" && (
        <div className="mt-4 flex flex-col gap-3">
          <SubHead>Investigate</SubHead>
          <Field
            label="What was found"
            hint="Recorded against the investigation, and required. It decides nothing — the decision is the next signature."
          >
            <Textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={note.trim() === "" || investigate.isPending}
              onClick={() => investigate.mutate()}
            >
              Record the investigation
            </Button>
          </div>
        </div>
      )}

      {live && (
        <div className="mt-4 flex flex-col gap-3">
          <SubHead>Decide</SubHead>
          <Field
            label="Decision detail"
            hint="Recorded against the decision, and required."
          >
            <Textarea
              rows={3}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </Field>
          <ButtonGroup>
            <Button
              variant="primary"
              disabled={detail.trim() === "" || resolve.isPending}
              onClick={() => resolve.mutate(true)}
            >
              Uphold
            </Button>
            <Button
              variant="danger"
              disabled={detail.trim() === "" || resolve.isPending}
              onClick={() => resolve.mutate(false)}
            >
              Not uphold
            </Button>
          </ButtonGroup>
        </div>
      )}

      {live && (
        <div className="mt-4 flex flex-col gap-3">
          <Field
            label="Why withdrawn"
            hint="The filer's own act, offered to whoever is looking and refused by the server for anybody else. Required."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="sudah berdamai"
            />
          </Field>
          <div>
            <Button
              variant="danger"
              disabled={reason.trim() === "" || withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}

      {(row.state === "RESOLVED" || row.state === "INVALID") && (
        <p className="mt-4 text-meta text-mute">
          Decided. There is no way back from here, by design — the grievance
          keeps its history below.
        </p>
      )}

      {row.history.length > 0 && (
        <div className="mt-4">
          <SubHead>History</SubHead>
          <Timeline
            events={row.history.map((event, index) => ({
              id: `${event.action}-${event.at}-${index}`,
              title: grievanceActionLabel(event.action),
              detail:
                `${event.actor}${event.reason === null ? "" : ` · ${event.reason}`}` +
                (event.detail ? ` · ${event.detail}` : ""),
              at: moment(event.at),
              state: index === row.history.length - 1 ? "current" : "done",
            }))}
          />
        </div>
      )}

      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}
    </Sheet>
  )
}

/// The vocabulary, beside the readers that use it.
///
/// Head office's alone, on the same screen as the queue for the reason the
/// claims screen gives: naming a kind of grievance and deciding one are two
/// halves of one piece of work, and a menu row of their own would be a screen
/// somebody opens twice a year.
///
/// # No edit and no delete
///
/// The leave-types rule again: redefining a kind would change what every
/// grievance already filed against it meant, and deleting one would leave
/// those grievances pointing at nothing. A kind that should no longer be used
/// is one nobody picks, which is what retiring it says.
function GrievanceTypes() {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [retireCode, setRetireCode] = useState("")
  const [retireWhy, setRetireWhy] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const types = useQuery({
    queryKey: grievanceKeys.types(),
    queryFn: ({ signal }) => listGrievanceTypes(signal),
  })

  const define = useMutation({
    mutationFn: () => defineGrievanceType(code.trim(), name.trim()),
    onSuccess: () => {
      setFailed(null)
      setCode("")
      setName("")
      void client.invalidateQueries({ queryKey: grievanceKeys.types() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const retire = useMutation({
    mutationFn: () => retireGrievanceType(retireCode, retireWhy.trim()),
    onSuccess: () => {
      setFailed(null)
      setRetireCode("")
      setRetireWhy("")
      void client.invalidateQueries({ queryKey: grievanceKeys.types() })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const kinds = types.data ?? []
  const live = kinds.filter((one) => one.retired_at === null)

  return (
    <>
      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Kinds</CardTitle>
        </CardHeader>
        {queryState(types, {
          loading: "Reading the vocabulary…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No kinds of grievance are defined, so nothing can be filed.
              </EmptyState>
            ) : (
              <div className="px-4 pb-4">
                {rows.map((kind) => (
                  <div
                    key={kind.code}
                    className="flex items-baseline gap-3 border-b border-hairline py-2.5 last:border-0"
                  >
                    <span className="font-mono text-id text-body">
                      {kind.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {kind.name}
                    </span>
                    {kind.retired_at !== null ? (
                      <Pill tone="neutral">
                        Cancelled {day(kind.retired_at)}
                      </Pill>
                    ) : null}
                  </div>
                ))}
              </div>
            ),
        })}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Define a kind</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <Field label="Code" hint="Upper-cased, and never changes.">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="SCHEDULE"
              />
            </Field>
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jadwal dan jam kerja"
              />
            </Field>
            <div>
              <Button
                variant="primary"
                disabled={
                  code.trim() === "" || name.trim() === "" || define.isPending
                }
                onClick={() => define.mutate()}
              >
                Define it
              </Button>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Cancel a kind</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {live.length === 0 ? (
              <Quiet>Nothing left to retire.</Quiet>
            ) : (
              <>
                <Field label="Kind">
                  <Select
                    value={retireCode}
                    onChange={(next) => setRetireCode(next)}
                  >
                    <option value="">Choose…</option>
                    {live.map((kind) => (
                      <option key={kind.code} value={kind.code}>
                        {kind.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Why"
                  hint="Recorded against the cancellation, and required."
                >
                  <Input
                    value={retireWhy}
                    onChange={(event) => setRetireWhy(event.target.value)}
                    placeholder="digabung ke PAY"
                  />
                </Field>
                <div>
                  <Button
                    variant="danger"
                    disabled={
                      retireCode === "" ||
                      retireWhy.trim() === "" ||
                      retire.isPending
                    }
                    onClick={() => retire.mutate()}
                  >
                    Cancel it
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}
    </>
  )
}
