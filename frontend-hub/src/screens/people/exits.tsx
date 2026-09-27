import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Timeline } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { day, money, moment } from "@/lib/format"
import {
  cancelFnF,
  completeExitInterview,
  exitInterviewStateLabel,
  exitInterviewStateTone,
  exitKeys,
  exitStanceLabel,
  fileExitInterview,
  fnfActionLabel,
  fnfKeys,
  fnfStateLabel,
  fnfStateTone,
  listEmployees,
  listExitInterviews,
  listFnF,
  openFnFStatement,
  peopleKeys,
  settleFnF,
  type ExitInterviewRow,
  type ExitStance,
  type FnFRow,
  type NewFnFAsset,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Quiet } from "@/screens/people/parts"

/// Exits: the interview and the statement, at the end of an employment.
///
/// The employment machine already terminates with a reason; the exit
/// interview records what the person *said* when they went. It is created
/// automatically as PENDING the day an employment ends, and conducting it is
/// head office's — the store is a party to the exit, never its author.
///
/// # The statement is the money half
///
/// A leaver carries money in both directions, and the full & final statement
/// is the *frozen* answer: the advance and approved-unpaid claim totals are
/// reads of live tables at creation, the settle re-reads them and refuses on
/// drift — naming what moved — and the whole statement is head office's,
/// because it settles across places. The net is the same arithmetic the
/// journal posts: final pay and claims payable out, advances and asset
/// recoveries back.
///
/// # Two tabs, one screen
///
/// Both halves belong to the same leaver and the same desk; two screens would
/// be two places to learn what one person left behind. The tabs are
/// `useState`, the way `claims.tsx` holds its own: People stays flat, one
/// address, and the thing worth sending is a statement or an interview, which
/// the sheets in the address bar already carry.

const interviewColumns: ColumnDef<TableSetup, ExitInterviewRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.employee_name ?? row.employee_code ?? row.employee_id,
    header: "Employee",
    size: 220,
    // No filter: this is a list of leavers, and narrowing it by one would
    // mean already knowing whose interview you were looking for.
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.employee_name ??
          row.original.employee_code ??
          row.original.employee_id}
      </span>
    ),
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
    id: "left",
    accessorKey: "created_at",
    header: "Left",
    size: 130,
    /// The day the interview was opened — which is the day the employment
    /// ended, because the two are the same transaction.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    accessorKey: "state",
    header: "Interview",
    size: 190,
    /// A fact to read and to narrow by, never a control. PENDING is spelled
    /// as what it waits for: the only thing anybody opening this list wants
    /// to know is whose interview is still waiting to be conducted.
    meta: { filter: { kind: "option", format: exitInterviewStateLabel } },
    cell: ({ row }) => (
      <Pill tone={exitInterviewStateTone(row.original.state)}>
        {exitInterviewStateLabel(row.original.state)}
      </Pill>
    ),
  },
  {
    id: "stance",
    accessorFn: (row) =>
      row.state === "COMPLETED" ? row.employee_stance : "",
    header: "Said",
    size: 180,
    /// **Not filterable, and the empty accessor above is exactly why** — the
    /// claims list's sanctioned-column rule again: a clause over "what they
    /// said" would silently gather every uncompleted interview under one
    /// answer. An interview still pending has no stance, which is not the
    /// same fact as one where the person said nothing.
    cell: ({ row }) =>
      row.original.state === "COMPLETED" ? (
        exitStanceLabel(row.original.employee_stance)
      ) : (
        <span className="text-mute">—</span>
      ),
  },
]

const fnfColumns: ColumnDef<TableSetup, FnFRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.employee_name ?? row.employee_code ?? row.employee_id,
    header: "Employee",
    size: 220,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.employee_name ??
          row.original.employee_code ??
          row.original.employee_id}
      </span>
    ),
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
    accessorKey: "transaction_on",
    header: "Transaction",
    size: 130,
    /// The decision metric — the day the leaving is settled on — and why this
    /// list sorts by it descending: the newest leaver is the one whose
    /// statement is most likely still open.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.transaction_on),
  },
  {
    id: "net",
    accessorFn: (row) => row.net_payable_minor,
    header: "Net",
    size: 150,
    /// The same arithmetic the journal posts, shown before the settlement
    /// exists — the figure the leaver walks away with, or owes, from the
    /// frozen totals.
    meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.net_payable_minor)}
      </span>
    ),
  },
  {
    accessorKey: "state",
    header: "State",
    size: 170,
    meta: { filter: { kind: "option", format: fnfStateLabel } },
    cell: ({ row }) => (
      <Pill tone={fnfStateTone(row.original.state)}>
        {fnfStateLabel(row.original.state)}
      </Pill>
    ),
  },
]

export function Exits() {
  const interview = useSheet("exitInterview")
  const fnf = useSheet("fnf")
  const [tab, setTab] = useState<string>("interviews")
  const tabs = [
    { value: "interviews", label: "Interviews" },
    { value: "fnf", label: "Full & final" },
  ]
  const shown = tabs.some((one) => one.value === tab) ? tab : "interviews"

  // Both reads live here rather than in the tabs, because each tab's sheet
  // has to find its row without guessing which tab is mounted.
  const interviews = useQuery({
    queryKey: exitKeys.list(),
    queryFn: ({ signal }) => listExitInterviews({}, signal),
  })
  const statements = useQuery({
    queryKey: fnfKeys.list(),
    queryFn: ({ signal }) => listFnF(undefined, signal),
  })

  const interviewRows = useMemo(() => interviews.data ?? [], [interviews.data])
  const fnfRows = useMemo(() => statements.data ?? [], [statements.data])

  const openInterview =
    interviewRows.find((row) => row.exit_id === interview.value) ?? null
  const openStatement = fnfRows.find((row) => row.fnf_id === fnf.value) ?? null

  const SUB: Record<string, string> = {
    interviews:
      "Everybody who has left, and what they said when they went. One interview per leaver, opened the day the employment ends.",
    fnf: "What each leaver settled at: the frozen reads at opening, the net the journal posted at settlement.",
  }

  return (
    <PageContent>
      <PageHeader crumb="People" title="Exits" sub={SUB[shown]} />

      <SubTabs tabs={tabs} value={shown} onChange={setTab} />

      {shown === "interviews" && (
        <>
          <ExitTable
            rows={interviewRows}
            columns={interviewColumns}
            query={interviews}
            loading="Reading the exits…"
            sorting={[{ id: "left", desc: true }]}
            onOpen={interview.open}
            isSelected={(row) => row.exit_id === interview.value}
            emptyNone="Nobody has left yet, so there is nothing to interview about."
            getId={(row) => row.exit_id}
            noun="interviews"
          />
          <OpenInterview />
          <InterviewSheet row={openInterview} onClose={interview.close} />
        </>
      )}

      {shown === "fnf" && (
        <>
          <ExitTable
            rows={fnfRows}
            columns={fnfColumns}
            query={statements}
            loading="Reading the statements…"
            sorting={[{ id: "transaction_on", desc: true }]}
            onOpen={fnf.open}
            isSelected={(row) => row.fnf_id === fnf.value}
            emptyNone="No statement has been opened yet."
            getId={(row) => row.fnf_id}
            noun="statements"
          />
          <OpenStatement />
          <StatementSheet row={openStatement} onClose={fnf.close} />
        </>
      )}
    </PageContent>
  )
}

/// The table both tabs draw, with the sentence each empty state says.
///
/// "Empty" and "empty because of a filter" are different sentences everywhere
/// in this app. The row type differs per tab, so the table takes the row's id
/// with it — the alternative is generics cleverness a screen this size does
/// not need.
function ExitTable<TRow extends Record<string, any>>({
  rows,
  columns,
  query,
  loading,
  sorting: defaultSorting,
  onOpen,
  isSelected,
  emptyNone,
  getId,
  noun,
}: {
  rows: TRow[]
  columns: ColumnDef<TableSetup, TRow>[]
  query: {
    isPending: boolean
    isError: boolean
    error: unknown
    data: TRow[] | undefined
    refetch: () => void
  }
  loading: string
  sorting: SortingState
  onOpen: (id: string) => void
  isSelected: (row: TRow) => boolean
  emptyNone: string
  getId: (row: TRow) => string
  noun: string
}) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: getId,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting, getId]
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
              <DataTable<TRow>
                table={table}
                onRowClick={(row) => onOpen(getId(row))}
                isSelected={isSelected}
                empty={
                  <>
                    {rows.length.toLocaleString("id-ID")} {noun} are here, and
                    none of them match the filters in force.
                  </>
                }
              />
            ),
        })}
      </Card>
    </>
  )
}

/// The leavers whose employment ended before the hook existed.
///
/// The interview is created automatically in the same transaction as the
/// TERMINATE event, so this form is for the backlog — terminations that
/// happened before it did. Opening one for a leaver who already has an
/// interview returns the one that exists, which is why the button is safe to
/// press twice: the server is idempotent on purpose.
function OpenInterview() {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const leavers = useQuery({
    queryKey: peopleKeys.employees({ status: "TERMINATED", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "TERMINATED", limit: 1000 }, signal),
  })

  const people = leavers.data ?? []

  const file = useMutation({
    mutationFn: () => fileExitInterview(employeeId),
    onSuccess: () => {
      setFailed(null)
      setEmployeeId("")
      void client.invalidateQueries({ queryKey: ["people", "exits"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Open an interview</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Field
          label="Leaver"
          hint="A person who has left. Opening twice returns the one interview that exists."
        >
          <Select value={employeeId} onChange={(next) => setEmployeeId(next)}>
            <option value="">Choose…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Button
            variant="primary"
            disabled={employeeId === "" || file.isPending}
            onClick={() => file.mutate()}
          >
            Open it
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// The interview, and its one act.
///
/// # The stance is the record
///
/// The interview exists to capture what the person said: whether they wanted
/// to stay, and the summary in their own terms. Completing it is head
/// office's under `people.exit_interview.file`, and it happens once — a
/// completed interview is what the person said at the time, not a document
/// to be revised.
function InterviewSheet({
  row,
  onClose,
}: {
  row: ExitInterviewRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [stance, setStance] = useState<ExitStance | "">("")
  const [summary, setSummary] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const complete = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no interview is open")
      return completeExitInterview(
        row.exit_id,
        stance as ExitStance,
        summary.trim() === "" ? undefined : summary.trim()
      )
    },
    onSuccess: () => {
      setFailed(null)
      setStance("")
      setSummary("")
      // The list and the person's own Directory tab both change.
      void client.invalidateQueries({ queryKey: ["people", "exits"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (row === null) return null

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()} id={row.exit_id} title={row.employee_name ?? row.employee_id}>
      <Pill tone={exitInterviewStateTone(row.state)}>
        {exitInterviewStateLabel(row.state)}
      </Pill>

      {row.state === "CANCELLED" && (
        <Banner tone="warn" className="mt-3">
          Cancelled by {row.cancelled_by}: {row.cancel_reason}
        </Banner>
      )}

      <Facts>
        <Fact term="Employee">
          <span className="font-mono text-id">{row.employee_id}</span>
        </Fact>
        <Fact term="Name">
          {row.employee_name ?? <span className="text-mute">—</span>}
        </Fact>
        <Fact term="Unit">{row.unit_name ?? row.unit_id}</Fact>
        <Fact term="Left">{day(row.created_at)}</Fact>
        {row.completed_at !== null && (
          <Fact term="Conducted">
            {row.conducted_by} · {moment(row.completed_at)}
          </Fact>
        )}
        {row.state === "COMPLETED" && (
          <Fact term="Said">{exitStanceLabel(row.employee_stance)}</Fact>
        )}
      </Facts>

      {row.interview_summary !== null && (
        <div className="mt-4">
          <SubHead>What they said</SubHead>
          <p className="text-body whitespace-pre-wrap">
            {row.interview_summary}
          </p>
        </div>
      )}

      {row.state === "PENDING" && (
        <div className="mt-4 flex flex-col gap-3">
          <SubHead>Conduct the interview</SubHead>
          <Field
            label="Their stance"
            hint="What the person themselves said, not what the company concluded."
          >
            <Select
              value={stance}
              onChange={(next) => setStance(next as ExitStance | "")}
            >
              <option value="">Choose…</option>
              <option value="RETAINED">{exitStanceLabel("RETAINED")}</option>
              <option value="EXIT_CONFIRMED">
                {exitStanceLabel("EXIT_CONFIRMED")}
              </option>
            </Select>
          </Field>
          <Field label="Summary" hint="In their own terms, as close as notes allow.">
            <Textarea
              rows={4}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={stance === "" || complete.isPending}
              onClick={() => complete.mutate()}
            >
              Complete the interview
            </Button>
          </div>
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

/// Opening a statement, and the asset rows only a human can supply.
///
/// The advance and claim totals are the server's reads of live tables — this
/// form sends none of them. What it does send is what no table knows: the
/// final pay figure and the assets the leaver is returning, at agreed
/// figures. Creation freezes everything into the row, and the settle
/// re-reads the sources and refuses if they have drifted.
function OpenStatement() {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [transactionOn, setTransactionOn] = useState("")
  const [finalPay, setFinalPay] = useState("")
  const [assets, setAssets] = useState<NewFnFAsset[]>([])
  const [failed, setFailed] = useState<string | null>(null)

  const leavers = useQuery({
    queryKey: peopleKeys.employees({ status: "TERMINATED", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "TERMINATED", limit: 1000 }, signal),
  })

  const people = leavers.data ?? []

  const open = useMutation({
    mutationFn: () =>
      openFnFStatement({
        employeeId,
        transactionOn,
        finalPayMinor: finalPay === "" ? undefined : Number(finalPay),
        assets: assets.length > 0 ? assets : undefined,
      }),
    onSuccess: () => {
      setFailed(null)
      setEmployeeId("")
      setTransactionOn("")
      setFinalPay("")
      setAssets([])
      void client.invalidateQueries({ queryKey: ["people", "exits"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  // Whole rupiah or nothing: a fraction of a rupiah is not a thing a
  // settlement carries, and the server refuses it — the form says so first.
  const finalPaySane =
    finalPay === "" || (Number.isInteger(Number(finalPay)) && Number(finalPay) >= 0)
  const assetsSane = assets.every(
    (asset) =>
      asset.assetId.trim() !== "" &&
      asset.note.trim() !== "" &&
      Number.isInteger(asset.recoveryMinor) &&
      asset.recoveryMinor >= 0
  )
  const ready =
    employeeId !== "" && transactionOn !== "" && finalPaySane && assetsSane

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Open a statement</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        <Field label="Leaver">
          <Select value={employeeId} onChange={(next) => setEmployeeId(next)}>
            <option value="">Choose…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Transaction on"
          hint="The day the leaving is settled on. One statement per leaver per day."
        >
          <Day value={transactionOn} onChange={setTransactionOn} />
        </Field>
        <Field
          label="Final pay"
          hint="Whole rupiah — the last run's gross, or a stated figure. Leave empty to let the server take the run's."
        >
          <Input
            type="number"
            min={0}
            value={finalPay}
            onChange={(event) => setFinalPay(event.target.value)}
          />
        </Field>

        <div>
          <SubHead aside="optional">Asset recovery</SubHead>
          {assets.length === 0 ? (
            <Quiet>Nothing to recover from the leaver.</Quiet>
          ) : (
            <MiniTable
              head={[
                "Asset id",
                { label: "Note", align: "left" },
                { label: "Recovery", align: "right" },
                "",
              ]}
            >
              {assets.map((asset, index) => (
                <MiniRow key={index}>
                  <MiniCell>
                    <Input
                      className="font-mono"
                      value={asset.assetId}
                      onChange={(event) =>
                        setAssets(
                          assets.map((one, at) =>
                            at === index
                              ? { ...one, assetId: event.target.value }
                              : one
                          )
                        )
                      }
                      placeholder="uuid dari modul aset"
                    />
                  </MiniCell>
                  <MiniCell>
                    <Input
                      value={asset.note}
                      onChange={(event) =>
                        setAssets(
                          assets.map((one, at) =>
                            at === index
                              ? { ...one, note: event.target.value }
                              : one
                          )
                        )
                      }
                      placeholder="laptop serial …"
                    />
                  </MiniCell>
                  <MiniCell align="right">
                    <Input
                      type="number"
                      min={0}
                      className="w-28 text-right"
                      value={asset.recoveryMinor}
                      onChange={(event) =>
                        setAssets(
                          assets.map((one, at) =>
                            at === index
                              ? {
                                  ...one,
                                  recoveryMinor: Number(event.target.value),
                                }
                              : one
                          )
                        )
                      }
                    />
                  </MiniCell>
                  <MiniCell>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        setAssets(assets.filter((_, at) => at !== index))
                      }
                    >
                      Remove
                    </Button>
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          )}
          <div className="mt-2">
            <Button
              variant="quiet"
              onClick={() =>
                setAssets([...assets, { assetId: "", note: "", recoveryMinor: 0 }])
              }
            >
              Add an asset row
            </Button>
          </div>
        </div>

        <div>
          <Button
            variant="primary"
            disabled={!ready || open.isPending}
            onClick={() => open.mutate()}
          >
            Open the statement
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// The statement itself, and whichever of its two acts the caller may take.
///
/// # The totals stop here
///
/// The four figures on this sheet are the frozen reads — what the advances,
/// the approved-unpaid claims, the asset rows and the final pay said when the
/// statement was opened. Settling re-reads the live sources and refuses,
/// naming what moved, because the statement is what Finance settles against:
/// a settlement against figures that changed underneath it would settle
/// against nothing. Cancelling is for drafts only.
function StatementSheet({
  row,
  onClose,
}: {
  row: FnFRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const invalidate = () => {
    setFailed(null)
    setReason("")
    void client.invalidateQueries({ queryKey: ["people", "exits"] })
  }

  const settle = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no statement is open")
      return settleFnF(row.fnf_id)
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  const cancel = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no statement is open")
      return cancelFnF(row.fnf_id, reason.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  if (row === null) return null

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()} id={row.fnf_id} title={row.employee_name ?? row.employee_id}>
      <Pill tone={fnfStateTone(row.state)}>{fnfStateLabel(row.state)}</Pill>

      {row.state === "CANCELLED" && (
        <Banner tone="warn" className="mt-3">
          Cancelled by {row.cancelled_by}: {row.cancel_reason}
        </Banner>
      )}

      <Facts>
        <Fact term="Employee">
          <span className="font-mono text-id">{row.employee_id}</span>
        </Fact>
        <Fact term="Name">
          {row.employee_name ?? <span className="text-mute">—</span>}
        </Fact>
        <Fact term="Unit">{row.unit_name ?? row.unit_id}</Fact>
        <Fact term="Transaction on">{day(row.transaction_on)}</Fact>
        <Fact term="Opened">
          {row.created_by} · {moment(row.created_at)}
        </Fact>
        {row.settled_at !== null && (
          <Fact term="Settled">
            {row.settled_by} · {moment(row.settled_at)}
          </Fact>
        )}
        {row.settled_entry_id !== null && (
          <Fact term="Entry">
            <span className="font-mono text-id">{row.settled_entry_id}</span>
          </Fact>
        )}
      </Facts>

      <div className="mt-4">
        <SubHead>Frozen at opening</SubHead>
        <MiniTable
          head={[
            "Source",
            { label: "Figure", align: "right" },
          ]}
        >
          <MiniRow>
            <MiniCell>Final pay</MiniCell>
            <MiniCell align="right">{money(row.final_pay_minor)}</MiniCell>
          </MiniRow>
          <MiniRow>
            <MiniCell>Approved claims, unpaid</MiniCell>
            <MiniCell align="right">{money(row.claim_payable_minor)}</MiniCell>
          </MiniRow>
          <MiniRow>
            <MiniCell>Advances still out</MiniCell>
            <MiniCell align="right">
              {money(row.advance_outstanding_minor)}
            </MiniCell>
          </MiniRow>
          <MiniRow>
            <MiniCell>Asset recovery</MiniCell>
            <MiniCell align="right">{money(row.asset_recovery_minor)}</MiniCell>
          </MiniRow>
        </MiniTable>
        <KeyValue term="Net payable to the leaver">
          <span
            className={`font-medium tabular-nums ${
              row.net_payable_minor < 0 ? "text-bad-fg" : "text-ink"
            }`}
          >
            {money(row.net_payable_minor)}
          </span>
        </KeyValue>
        {row.net_payable_minor < 0 && (
          <p className="mt-1 text-meta text-mute">
            Negative: the leaver owes the estate this much, and the settlement
            posts the entry the other way.
          </p>
        )}
      </div>

      {row.state === "DRAFT" && (
        <div className="mt-4 flex flex-col gap-3">
          <Banner tone="info">
            Settling re-reads the live sources and refuses — naming what moved
            — if they have drifted from the frozen figures. It posts one
            journal entry for the net; a statement whose net comes to zero is
            refused too, because there is nothing to post.
          </Banner>
          <div>
            <Button
              variant="primary"
              disabled={settle.isPending}
              onClick={() => settle.mutate()}
            >
              Settle it
            </Button>
          </div>
          <Field
            label="Why cancelled"
            hint="Cancelling is for drafts, and the reason is required."
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="duplikat dengan statement lain"
            />
          </Field>
          <div>
            <Button
              variant="danger"
              disabled={reason.trim() === "" || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel the statement
            </Button>
          </div>
        </div>
      )}

      {row.state === "SETTLED" && (
        <p className="mt-4 text-meta text-mute">
          Settled. The figures above are what Finance settled against, and
          there is no way back from here, by design.
        </p>
      )}

      {row.history.length > 0 && (
        <div className="mt-4">
          <SubHead>History</SubHead>
          <Timeline
            events={row.history.map((event, index) => ({
              id: `${event.action}-${event.at}-${index}`,
              title: fnfActionLabel(event.action),
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
