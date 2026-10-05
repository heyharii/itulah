import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Timeline } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, day, money, moment } from "@/lib/format"
import {
  boundedTo,
  claimActionLabel,
  claimStateLabel,
  claimStateTone,
  claimsKeys,
  decideClaim,
  fileClaim,
  listClaimTypes,
  listClaims,
  listEmployees,
  payClaim,
  peopleKeys,
  returnClaim,
  submitClaim,
  useReach,
  withdrawClaim,
  type ClaimRow,
  type NewClaimLine,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Expense claims: petty cash, asked for on paper and sanctioned by two
/// people.
///
/// # The two-actor rule is the screen
///
/// Whoever filed a claim never decides it — the server refuses them by name,
/// the same rule that keeps a payroll's submitter from approving it. And
/// deciding is not paying: approval *writes* what the company owes, the
/// payout *moves* the money out of the place's petty cash, and the days
/// between the two are exactly why the ledger carries an approved-unpaid
/// claim as a debt rather than as a footnote.
///
/// # One list, two filters
///
/// Waiting is what the manager came for; All is everything the caller may
/// see. Loans, yearly allowances and the kinds of expense are pages of their
/// own. Filing a claim is the header button and opens a sheet.

const queueColumns: ColumnDef<TableSetup, ClaimRow>[] = [
  {
    id: "who",
    accessorFn: (row) =>
      row.employee_name ?? row.employee_code ?? row.employee_id,
    header: "Employee",
    size: 220,
    // No filter: this is a queue, and narrowing it by one would mean already
    // knowing whose claim you were looking for.
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.employee_name ?? row.original.employee_code ?? "—"}
      </span>
    ),
  },
  {
    id: "unit",
    accessorFn: (row) => row.unit_name ?? row.unit_id,
    header: "Unit",
    size: 160,
    /// Faceted from the rows the server already bounded to this caller's own
    /// reach — the only list of places that can be right here.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.unit_name ?? row.original.unit_id,
  },
  {
    id: "posted",
    accessorKey: "posted_on",
    header: "Filed",
    size: 130,
    /// The default sort of the queue is this column ascending: the first
    /// screenful is whoever has been waiting longest.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.posted_on),
  },
  {
    id: "lines",
    accessorFn: (row) => row.lines.length,
    header: "Lines",
    size: 100,
    /// A claim with six taxi receipts in it is a different afternoon's reading
    /// from a claim with one, and the queue is where that difference shows.
    meta: { align: "right", filter: { kind: "number", unit: "lines" } },
    cell: ({ row }) => count(row.original.lines.length),
  },
  {
    accessorKey: "claimed_minor",
    header: "Claimed",
    size: 150,
    /// The decision metric: what they say it cost. What it was sanctioned to
    /// does not exist yet — that is what this queue is for.
    meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.claimed_minor)}
      </span>
    ),
  },
]

const listColumns: ColumnDef<TableSetup, ClaimRow>[] = [
  {
    accessorKey: "claim_number",
    header: "Number",
    size: 170,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.claim_number}
      </span>
    ),
  },
  {
    id: "who",
    accessorFn: (row) =>
      row.employee_name ?? row.employee_code ?? row.employee_id,
    header: "Employee",
    size: 200,
    cell: ({ row }) =>
      row.original.employee_name ?? row.original.employee_code ?? "—",
  },
  {
    id: "unit",
    accessorFn: (row) => row.unit_name ?? row.unit_id,
    header: "Unit",
    size: 150,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => row.original.unit_name ?? row.original.unit_id,
  },
  {
    id: "posted",
    accessorKey: "posted_on",
    header: "Filed",
    size: 120,
    /// The list sorts newest first — the opposite of the queue, because the
    /// list is a record and the queue is a desk.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.posted_on),
  },
  {
    accessorKey: "state",
    header: "State",
    size: 190,
    /// A fact to read and to narrow by, never a control — the same discipline
    /// as the overtime list. "The approved-unpaid ones" is the clause this
    /// exists for: that is money owed, and it is the first thing a place
    /// manager wants to find.
    meta: { filter: { kind: "option", format: claimStateLabel } },
    cell: ({ row }) => (
      <Pill tone={claimStateTone(row.original.state)}>
        {claimStateLabel(row.original.state)}
      </Pill>
    ),
  },
  {
    accessorKey: "claimed_minor",
    header: "Claimed",
    size: 140,
    meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
    cell: ({ row }) => (
      <span className="tabular-nums">{money(row.original.claimed_minor)}</span>
    ),
  },
  {
    id: "sanctioned",
    accessorFn: (row) => row.sanctioned_minor ?? 0,
    header: "Sanctioned",
    size: 150,
    /// **Not filterable, and the `?? 0` above is exactly why.** An undecided
    /// claim has no sanctioned figure, which is not the same fact as one
    /// sanctioned to nothing — a number clause would gather up every claim
    /// still waiting and report them as decided for zero. State is what this
    /// list offers instead.
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.sanctioned_minor === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="font-medium text-ink tabular-nums">
          {money(row.original.sanctioned_minor)}
        </span>
      ),
  },
]

export function Claims() {
  const claim = useSheet("claim")
  const canWrite = useCanWrite()
  const reach = useReach()
  const bounded = boundedTo(reach.data)
  const [filing, setFiling] = useState(false)

  // Waiting is what a manager comes for; All is the record. A filter on one
  // list rather than two destinations — the other tabs this screen once held
  // (loans, allowances, kinds) are pages of their own under Claims & loans.
  const [show, setShow] = useState<string>("queue")

  // Both reads live here rather than in the table, because the sheet has to
  // find its row whichever filter it was opened from. Claims move at
  // petty-cash volumes; asking for both is cheaper than the gymnastics of a
  // sheet that guesses which one is mounted.
  const queue = useQuery({
    queryKey: claimsKeys.queue(),
    queryFn: ({ signal }) => listClaims({ state: "SUBMITTED" }, signal),
  })
  const all = useQuery({
    queryKey: claimsKeys.list(),
    queryFn: ({ signal }) => listClaims({}, signal),
  })

  const queueRows = useMemo(() => queue.data ?? [], [queue.data])
  const allRows = useMemo(() => all.data ?? [], [all.data])
  const open =
    queueRows.find((row) => row.claim_id === claim.value) ??
    allRows.find((row) => row.claim_id === claim.value) ??
    null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Claims"
        sub={
          show === "queue"
            ? bounded === null
              ? "Claims waiting on a decision, across every place."
              : `Claims waiting on a decision at ${bounded}.`
            : "Every claim the caller may see, decided or not."
        }
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setFiling(true)}>
              File claim
            </Button>
          )
        }
      />

      <SubTabs
        tabs={[
          { value: "queue", label: "Waiting" },
          { value: "all", label: "All" },
        ]}
        value={show}
        onChange={setShow}
      />

      {show === "queue" ? (
        <>
          <Banner tone="info" className="mb-4">
            A claim is sanctioned by two people: whoever filed it never decides
            it, and approving writes what the company owes before the payout
            moves a rupiah.
          </Banner>
          <ClaimTable
            rows={queueRows}
            columns={queueColumns}
            query={queue}
            loading="Reading the queue…"
            sorting={[{ id: "posted", desc: false }]}
            onOpen={claim.open}
            isSelected={(row) => row.claim_id === claim.value}
            emptyNone={
              bounded === null
                ? "Nothing anywhere is waiting on a decision."
                : `Nothing at ${bounded} is waiting on a decision.`
            }
          />
        </>
      ) : (
        <ClaimTable
          rows={allRows}
          columns={listColumns}
          query={all}
          loading="Reading the claims…"
          sorting={[{ id: "posted", desc: true }]}
          onOpen={claim.open}
          isSelected={(row) => row.claim_id === claim.value}
          emptyNone={
            bounded === null
              ? "No claim has been filed yet. Use File claim to add the first."
              : `No claim has been filed at ${bounded} yet. Use File claim to add the first.`
          }
        />
      )}

      {filing && <FileClaimSheet onClose={() => setFiling(false)} />}

      <ClaimSheet row={open} onClose={claim.close} />
    </PageContent>
  )
}

/// The table both list tabs draw, with the sentence each empty state says.
///
/// "Empty" and "empty because of a filter" are different sentences everywhere
/// in this app, and on the queue the difference is somebody's claim waiting
/// unanswered behind a clause somebody forgot was there.
function ClaimTable({
  rows,
  columns,
  query,
  loading,
  sorting: defaultSorting,
  onOpen,
  isSelected,
  emptyNone,
}: {
  rows: ClaimRow[]
  columns: ColumnDef<TableSetup, ClaimRow>[]
  query: UseQueryResult<ClaimRow[]>
  loading: string
  sorting: SortingState
  onOpen: (id: string) => void
  isSelected: (row: ClaimRow) => boolean
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
        getRowId: (row: ClaimRow) => row.claim_id,
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
              <DataTable<ClaimRow>
                table={table}
                onRowClick={(row) => onOpen(row.claim_id)}
                isSelected={isSelected}
                empty={
                  <>
                    {rows.length.toLocaleString("id-ID")} claims are here, and
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

/// Filing, from the desk that has the receipt in hand.
///
/// # One act, not two
///
/// The wire carries filing and submission as two routes because the phone app
/// assembles a claim across a day and sends it when it is done. The hub files
/// and sends in one act: a manager with the receipt in front of them is filing
/// for real, and a draft only one tab can see is a claim waiting to be
/// forgotten.
///
/// # The picker is the reach
///
/// The list is bounded by the server to exactly the people the caller may file
/// for, so the picker never offers a name the route would refuse. With one
/// person in it there is nothing to pick — it is preselected and the control
/// only says whose claim this is.
function FileClaimSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [typeCode, setTypeCode] = useState("")
  const [spentOn, setSpentOn] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const types = useQuery({
    queryKey: claimsKeys.types(),
    queryFn: ({ signal }) => listClaimTypes(signal),
  })

  const people = team.data ?? []
  const kinds = (types.data ?? []).filter((one) => one.retired_at === null)

  // Exactly one person to file for is not a choice, so it is made for the
  // caller — and the field says whose claim this is rather than hiding it.
  const who =
    employeeId !== ""
      ? employeeId
      : people.length === 1
        ? people[0]!.employee_id
        : ""

  const file = useMutation({
    mutationFn: () => {
      const line: NewClaimLine = {
        typeCode,
        description: description.trim(),
        spentOn,
        amountMinor: Number(amount),
      }
      return fileClaim(who, [line], reason.trim()).then((row) =>
        // Filed is not sent. The second half of the act, under the same name.
        submitClaim(row.claim_id, reason.trim())
      )
    },
    onSuccess: () => {
      // A claim now waits on a decision somewhere, and the person's own list
      // on their Directory sheet has a new row — the module's whole prefix.
      void client.invalidateQueries({ queryKey: ["people", "claims"] })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready =
    who !== "" &&
    typeCode !== "" &&
    spentOn !== "" &&
    description.trim() !== "" &&
    reason.trim() !== "" &&
    Number(amount) > 0

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="File claim"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={file.isPending}
            disabled={!ready}
            onClick={() => file.mutate()}
          >
            File and send it
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}
        {types.isSuccess && kinds.length === 0 && (
          <Banner tone="bad">
            No kinds of expense are defined, so nothing can be filed. Head
            office names them under Claim types.
          </Banner>
        )}

        <Field label="For" required>
          <Select value={who} onChange={(next) => setEmployeeId(next)}>
            <option value="">Choose…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind of expense" required>
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
          label="Spent on"
          required
          hint="The day the money went out, not the day the claim is filed."
        >
          <Day value={spentOn} onChange={setSpentOn} />
        </Field>
        <Field
          label="Amount"
          hint="Whole rupiah, as the receipt shows it."
          required
        >
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field
          label="What for"
          hint="Said the way the receipt would say it."
          required
        >
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          label="Why this claim"
          required
          hint="Recorded against the filing and the submission, and required."
        >
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// The claim itself, and whichever of its three acts the caller may take.
///
/// # The buttons are not the control
///
/// Sending in, taking back, deciding and paying are each somebody's own act on
/// the server — the filer submits and withdraws, a decider who is not the
/// filer decides, and paying needs its own grant. The sheet cannot know who is
/// reading it without asking, so it offers the act and lets the server answer,
/// which is the payroll sheet's rule: a button that appears a moment late is
/// worse than one that is answered honestly.
function ClaimSheet({
  row,
  onClose,
}: {
  row: ClaimRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const invalidate = () => {
    setFailed(null)
    setReason("")
    // Submission, withdrawal and payout each change the queue, the list, and
    // the person's own history on their Directory sheet — one prefix covers
    // all three.
    void client.invalidateQueries({ queryKey: ["people", "claims"] })
  }

  const send = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no claim is open")
      return submitClaim(row.claim_id, reason.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  const takeBack = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no claim is open")
      return withdrawClaim(row.claim_id, reason.trim())
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  const pay = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error("no claim is open")
      return payClaim(row.claim_id)
    },
    onSuccess: invalidate,
    onError: (error: Error) => setFailed(error.message),
  })

  if (row === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      id={row.claim_id}
      title={row.claim_number}
    >
      <Pill tone={claimStateTone(row.state)}>{claimStateLabel(row.state)}</Pill>

      {/* A claim that came back says so before anything else on the sheet —
          the reason is the half the filer has to be able to read. */}
      {row.state === "DRAFT" && row.decide_reason !== null && (
        <Banner tone="warn" className="mt-3">
          Sent back by {row.decided_by}: {row.decide_reason}
        </Banner>
      )}

      <Facts>
        <Fact term="Employee">
          {row.employee_name ?? (
            <span className="font-mono text-id">{row.employee_id}</span>
          )}
        </Fact>
        <Fact term="Unit">{row.unit_name ?? row.unit_id}</Fact>
        <Fact term="Filed">{day(row.posted_on)}</Fact>
        <Fact term="Filed by">{row.claimed_by}</Fact>
        <Fact term="Claimed">{money(row.claimed_minor)}</Fact>
        <Fact term="Sanctioned">
          {row.sanctioned_minor === null ? (
            <span className="text-mute">not decided yet</span>
          ) : (
            money(row.sanctioned_minor)
          )}
        </Fact>
        {row.paid_at !== null && (
          <Fact term="Paid">
            {row.paid_by} · {moment(row.paid_at)}
          </Fact>
        )}
      </Facts>

      <div className="mt-4">
        <SubHead>Lines</SubHead>
        <MiniTable
          head={[
            "Kind",
            { label: "Spent", align: "left" },
            { label: "Claimed", align: "right" },
            { label: "Sanctioned", align: "right" },
          ]}
        >
          {row.lines.map((line) => (
            <MiniRow key={line.line_id}>
              <MiniCell>
                <span className="block text-[0.875rem] text-ink">
                  {line.type_name}
                </span>
                <span className="font-mono text-[0.875rem] text-mute">
                  {line.description}
                </span>
              </MiniCell>
              <MiniCell>{day(line.spent_on)}</MiniCell>
              <MiniCell align="right">{money(line.claimed_minor)}</MiniCell>
              <MiniCell align="right">
                {line.sanctioned_minor === null ? (
                  <span className="text-mute">—</span>
                ) : (
                  money(line.sanctioned_minor)
                )}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      </div>

      {row.state === "SUBMITTED" && (
        <DecidePanel key={row.claim_id} row={row} />
      )}

      {row.state === "APPROVED" && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-meta text-body">
            Approved and owed. Paying takes the sanctioned total out of the
            place's petty cash and posts the entry — the act that cannot be
            taken back on its own.
          </p>
          <div>
            <Button
              variant="primary"
              pending={pay.isPending}
              onClick={() => pay.mutate()}
            >
              Pay from petty cash
            </Button>
          </div>
        </div>
      )}

      {(row.state === "DRAFT" || row.state === "SUBMITTED") && (
        <div className="mt-4 flex flex-col gap-3">
          {row.state === "DRAFT" && (
            <div>
              <Button
                variant="primary"
                pending={send.isPending}
                disabled={reason.trim() === ""}
                onClick={() => send.mutate()}
              >
                Send it in
              </Button>
            </div>
          )}
          {/* The filer's own act, offered to whoever is looking and refused by
              the server for anybody else — the sheet cannot know who that is
              without asking. */}
          <Field
            label="Why"
            hint="Recorded against the submission or withdrawal, and required."
            required
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="danger"
              pending={takeBack.isPending}
              disabled={reason.trim() === ""}
              onClick={() => takeBack.mutate()}
            >
              Take it back
            </Button>
          </div>
        </div>
      )}

      {row.state === "REJECTED" && (
        <p className="mt-4 text-meta text-mute">
          Refused. There is no way back from here, by design — the claim keeps
          its history below.
        </p>
      )}

      {row.history.length > 0 && (
        <div className="mt-4">
          <SubHead>History</SubHead>
          <Timeline
            events={row.history.map((event, index) => ({
              id: `${event.action}-${event.at}-${index}`,
              title: claimActionLabel(event.action),
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

/// Sanctioning, one figure per line.
///
/// The decider's arithmetic is per line because the judgement is: a taxi and
/// a medical bill on one claim are not one conversation. Every input starts at
/// what was claimed — refusing to second-guess is the default — and a line
/// sanctioned to nothing stops the form, because the server refuses it by name
/// and the form would rather say so first.
///
/// `key={row.claim_id}` above is what resets this panel between claims: the
/// figures belong to one claim, and a stale sanction carried into the next
/// sheet would be a decision half-made before it was read.
function DecidePanel({ row }: { row: ClaimRow }) {
  const client = useQueryClient()
  const [sanctions, setSanctions] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      row.lines.map((line) => [line.line_id, String(line.claimed_minor)])
    )
  )
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      decideClaim(
        row.claim_id,
        approve,
        reason.trim(),
        row.lines.map((line) => ({
          lineId: line.line_id,
          sanctionedMinor: Number(sanctions[line.line_id] ?? 0),
        }))
      ),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: ["people", "claims"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const sendBack = useMutation({
    mutationFn: () => returnClaim(row.claim_id, reason.trim()),
    onSuccess: () => {
      setFailed(null)
      setReason("")
      void client.invalidateQueries({ queryKey: ["people", "claims"] })
    },
    onError: (error: Error) => setFailed(error.message),
  })

  // A sanction is a positive whole number of rupiah or it is nothing the
  // server will take — the form says so before the ledger does.
  const figures = row.lines.map((line) => Number(sanctions[line.line_id] ?? 0))
  const sane = figures.every((one) => Number.isInteger(one) && one > 0)
  const ready = sane && reason.trim() !== ""

  return (
    <div className="mt-4 flex flex-col gap-3">
      <SubHead>Decide</SubHead>
      {failed !== null && <Banner tone="bad">{failed}</Banner>}
      <MiniTable
        head={[
          "Kind",
          { label: "Claimed", align: "right" },
          { label: "Sanction", align: "right" },
        ]}
      >
        {row.lines.map((line) => (
          <MiniRow key={line.line_id}>
            <MiniCell>
              <span className="block text-[0.875rem] text-ink">
                {line.type_name}
              </span>
              <span className="font-mono text-[0.875rem] text-mute">
                {line.description}
              </span>
            </MiniCell>
            <MiniCell align="right">{money(line.claimed_minor)}</MiniCell>
            <MiniCell align="right">
              <Input
                type="number"
                min={1}
                className="w-28 text-right"
                value={sanctions[line.line_id] ?? ""}
                onChange={(event) =>
                  setSanctions({
                    ...sanctions,
                    [line.line_id]: event.target.value,
                  })
                }
              />
            </MiniCell>
          </MiniRow>
        ))}
      </MiniTable>
      <Field
        label="Why"
        hint="Recorded against the decision, and required."
        required
      >
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <ButtonGroup>
        <Button
          variant="primary"
          pending={decide.isPending}
          disabled={!ready}
          onClick={() => decide.mutate(true)}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          pending={decide.isPending}
          disabled={!ready}
          onClick={() => decide.mutate(false)}
        >
          Refuse
        </Button>
        <Button
          variant="quiet"
          pending={sendBack.isPending}
          disabled={reason.trim() === ""}
          onClick={() => sendBack.mutate()}
        >
          Send back
        </Button>
      </ButtonGroup>
    </div>
  )
}
