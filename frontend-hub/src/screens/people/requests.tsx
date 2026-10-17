import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Status } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { day, moment, money, monthYear, weekday } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  CHANGE_KIND_LABEL,
  DATA_FIELD_LABEL,
  nameOf as nameIn,
  useEveryEmployee,
  useNameOfLogin,
} from "@/lib/queries/hr-employees"
import {
  decideCorrection,
  decideSwap,
  listEmployees,
  nextKeys,
  peopleKeys,
  punchKeys,
  decideLeave,
  leaveKeys,
  rosterKeys,
  useReachableUnits,
  type ClaimRow,
  type PayrollRunView,
  type RosterSwapView,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { everyoneBalancesKey } from "@/lib/queries/hr-time"
import { useCanWrite } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { AppLink } from "@/components/ui/app-link"
import { CardButton, CardName, PhoneCards } from "@/components/ui/phone-cards"
import { usePeopleInbox } from "@/screens/people/badges"
import { changeSummary } from "@/screens/people/change-words"
import { ChangeSheet, DataRequestSheet } from "@/screens/people/changes"
import { ClaimSheet } from "@/screens/people/claims"
import { HireSheet } from "@/screens/people/hire-sheet"
import type {
  CorrectionRow,
  LeaveRequestView,
  PersonalDataRequestView,
} from "@itulah/contract"

/// HR's one inbox, drawn on Overview › Requests: everything waiting on the
/// reader's decision, in one table (owner, 2026-10-16, `hr-doors-prototype.html`
/// — "One inbox: change proposals and detail requests join leave,
/// corrections, swaps; claims decided here too").
///
/// A manager does not have a "leave task" and a "correction task" — they have
/// five minutes and a list of things waiting on them. So every kind is a row
/// of the same table, read the same way (who, what they ask, the day it is
/// about, where), and a row opens the sheet that decides it, on this page.
/// A payroll run is the one exception: it is a month's document, and opens on
/// Pay › Payroll.
///
/// The rows are `usePeopleInbox`'s, the same reads the Overview's badge counts,
/// so the number on the menu is the number of rows here.
///
/// The lists are bounded by the caller's own posting, on the server: a manager
/// posted to store-07 is served store-07's requests and nothing else, and head
/// office every place's. Nothing here re-implements that rule.
///
/// Every decision carries a reason. The server refuses one without it, and
/// refuses a decision by the person who filed the request; the sheet shows
/// that sentence rather than hiding the buttons.

/// A leave request, with the name of the person it is for.
type LeaveRow = LeaveRequestView & { readonly name: string }

/// A swap, with the names of both people whose day it moves.
type SwapRow = RosterSwapView & {
  readonly name: string
  readonly withName: string
}

/// One row of the inbox, whatever kind of request it is.
interface InboxRow {
  /// The sheet's key: the request's own id, unique across kinds.
  readonly id: string
  readonly kind:
    | "LEAVE"
    | "CORRECTION"
    | "SWAP"
    | "CLAIM"
    | "RUN"
    | "CHANGE"
    | "DETAILS"
    | "HIRE"
  /// Who asks — a place, for a payroll run.
  readonly who: string
  readonly asks: string
  readonly detail: string
  /// The day the request is about, for sorting; `when` is how it reads.
  readonly on: string
  readonly when: string
  readonly unit: string
}

const columns: ColumnDef<TableSetup, InboxRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.who,
    header: "Employee",
    size: 210,
  },
  {
    id: "asks",
    accessorFn: (row) => row.asks,
    header: "Asks",
    size: 150,
    /// The kinds actually waiting, faceted off the inbox: five minutes and a
    /// list of things is exactly when "just the time off" is worth one click.
    meta: { filter: { kind: "option" } },
  },
  {
    id: "detail",
    accessorFn: (row) => row.detail,
    header: "Detail",
    size: 280,
  },
  {
    id: "when",
    accessorFn: (row) => row.on,
    header: "Date",
    size: 220,
    cell: ({ row }) => row.original.when,
  },
  {
    id: "unit",
    accessorFn: (row) => row.unit,
    header: "Unit",
    size: 150,
    /// Faceted from the inbox itself: the server has already bounded these
    /// rows to the caller's reach, so the places here are the ones they may
    /// narrow by.
    meta: { filter: { kind: "option" } },
  },
]

export function RequestQueues() {
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  const request = useSheet("request")
  const canWrite = useCanWrite()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const inbox = usePeopleInbox()
  const nameOf = useNames()
  const unitName = useUnitName()
  const people = useEveryEmployee()

  const leave = useMemo<LeaveRow[]>(
    () =>
      (inbox.leave.data ?? []).map((row) => ({
        ...row,
        name: nameOf(row.employee_id),
      })),
    [inbox.leave.data, nameOf]
  )
  const swaps = useMemo<SwapRow[]>(
    () =>
      (inbox.swaps.data ?? []).map((row) => ({
        ...row,
        name: nameOf(row.employee_id),
        withName: nameOf(row.with_employee_id),
      })),
    [inbox.swaps.data, nameOf]
  )
  const corrections = inbox.corrections.data
  const claims = inbox.claims.data
  const { waitingRuns: runs, waitingChanges: changes } = inbox
  const details = inbox.waitingDetails
  const hires = inbox.waitingHires

  const rows = useMemo<InboxRow[]>(
    () => [
      ...leave.map((row) => ({
        id: row.id,
        kind: "LEAVE" as const,
        who: row.name,
        asks: "Time off",
        detail: `${row.leave_type_name} · ${row.chargeable_days} ${row.chargeable_days === 1 ? "day" : "days"}`,
        on: row.from_date,
        when:
          row.to_date === row.from_date
            ? weekday(row.from_date, true)
            : `${weekday(row.from_date)} – ${weekday(row.to_date, true)}`,
        unit: unitName(row.unit_id),
      })),
      ...(corrections ?? []).map((row) => ({
        id: row.id,
        kind: "CORRECTION" as const,
        who: row.display_name,
        asks: "Correction",
        detail: correctionWords(row),
        on: row.business_date,
        when: weekday(row.business_date, true),
        unit: unitName(row.unit_id),
      })),
      ...swaps.map((row) => ({
        id: row.id,
        kind: "SWAP" as const,
        who: row.name,
        asks: "Swap",
        detail: `With ${row.withName}`,
        on: row.on_date,
        when: weekday(row.on_date, true),
        unit: unitName(row.unit_id),
      })),
      ...(claims ?? []).map((row) => ({
        id: row.claim_id,
        kind: "CLAIM" as const,
        who: row.employee_name ?? row.employee_code ?? row.employee_id,
        asks: "Claim",
        detail: `${row.claim_number} · ${money(row.claimed_minor)}`,
        on: row.posted_on,
        when: weekday(row.posted_on, true),
        unit: row.unit_name ?? unitName(row.unit_id),
      })),
      ...runs.map((row) => ({
        id: row.id,
        kind: "RUN" as const,
        who: unitName(row.unit_id),
        asks: "Payroll",
        detail: runWords(row),
        on: `${row.period}-01`,
        when: monthYear(row.period, true),
        unit: unitName(row.unit_id),
      })),
      ...changes.map((row) => ({
        id: row.id,
        kind: "CHANGE" as const,
        who: nameIn(people.data, row.employee_id),
        asks: CHANGE_KIND_LABEL[row.kind] ?? row.kind,
        detail: changeSummary(row, unitName),
        on: row.effective_on,
        when: `From ${weekday(row.effective_on, true)}`,
        unit: unitName(row.unit_id),
      })),
      ...details.map((row) => ({
        id: row.id,
        kind: "DETAILS" as const,
        who: row.full_name ?? row.employee_code,
        asks: "Detail change",
        detail: `New ${(DATA_FIELD_LABEL[row.field] ?? row.field).toLowerCase()}: ${row.value === "" ? "cleared" : row.value}`,
        on: row.filed_at.slice(0, 10),
        when: weekday(row.filed_at, true),
        unit: row.unit_id === null ? "—" : unitName(row.unit_id),
      })),
      ...hires.map((row) => {
        const terms = row.versions.at(-1)
        return {
          id: row.id,
          kind: "HIRE" as const,
          who: terms?.candidate_name ?? "—",
          asks: row.state === "APPROVED" ? "Account" : "New staff",
          detail: terms
            ? `${terms.position} · ${money(terms.base_pay_minor)}`
            : "",
          on: terms?.start_on ?? row.created_at.slice(0, 10),
          when: terms ? `From ${weekday(terms.start_on, true)}` : "",
          unit: row.unit_name ?? unitName(row.unit_id),
        }
      }),
    ],
    [
      leave,
      corrections,
      swaps,
      claims,
      runs,
      changes,
      details,
      hires,
      people.data,
      unitName,
    ]
  )

  /// The reads every row needs before the inbox says anything — a partly
  /// answered inbox is not evidence that nothing is waiting. Head office's own
  /// three only for head office, the one caller who asks for them.
  const sources = [
    inbox.leave,
    inbox.corrections,
    inbox.swaps,
    inbox.claims,
    ...(inbox.employer
      ? [inbox.runs, inbox.changes, inbox.details, inbox.hires]
      : []),
  ]
  const read = {
    isPending: sources.some((one) => one.isPending),
    isError: sources.some((one) => one.isError),
    error: sources.find((one) => one.isError)?.error ?? null,
    data: rows,
    refetch: () => {
      for (const one of sources) if (one.isError) void one.refetch()
    },
  }

  const filters = useFilters(columns)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: InboxRow) => row.id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  /// A payroll run is a month's document and opens on its own screen; every
  /// other kind is decided in its sheet, here.
  const open = useCallback(
    (row: InboxRow) => {
      if (row.kind === "RUN")
        void navigate({
          to: "/people/payroll",
          search: { payrollRun: row.id },
        } as never)
      else request.open(row.id)
    },
    [navigate, request]
  )

  const id = request.value
  const openLeave = leave.find((row) => row.id === id) ?? null
  const openCorrection = corrections?.find((row) => row.id === id) ?? null
  const openSwap = swaps.find((row) => row.id === id) ?? null
  const openClaim: ClaimRow | null =
    claims?.find((row) => row.claim_id === id) ?? null
  const openChange = changes.find((row) => row.id === id) ?? null
  const openDetails: PersonalDataRequestView | null =
    details.find((row) => row.id === id) ?? null
  /// Read from every proposal, not only the waiting ones: right after Approve
  /// the sheet stays open on the same request to create the account.
  const openHire =
    (inbox.hires.data ?? []).find((row) => row.id === id) ?? null

  return (
    <>
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(read, {
          loading: "Loading requests…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>Nothing is waiting on you.</EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={table.getRowModel().rows.map((one) => one.original)}
                onOpen={open}
                empty="No request matches the filters."
                rowId={(row) => row.id}
                spec={{
                  title: (row) => (
                    <CardName
                      name={row.who}
                      line={[`${row.asks} · ${row.detail}`, row.when]}
                    />
                  ),
                  foot: (row) => row.unit,
                  action: (row) => (
                    <CardButton
                      label="Decide"
                      ariaLabel={`Decide ${row.who}’s ${row.asks.toLowerCase()}`}
                      onClick={() => open(row)}
                    />
                  ),
                }}
              />
            ) : (
              <DataTable<InboxRow>
                refresh={sources}
                table={table}
                onRowClick={open}
                isSelected={(row) => row.id === id}
                empty="No request matches the filters."
              />
            ),
        })}
      </Card>

      <RequestSheet
        key={openLeave?.id}
        request={openLeave}
        onClose={request.close}
      />
      <CorrectionSheet
        key={openCorrection?.id}
        correction={openCorrection}
        onClose={request.close}
      />
      <SwapSheet key={openSwap?.id} swap={openSwap} onClose={request.close} />
      <ClaimSheet row={openClaim} onClose={request.close} />
      <ChangeSheet
        change={openChange}
        canWrite={canWrite}
        who={
          openChange === null ? "" : nameIn(people.data, openChange.employee_id)
        }
        onClose={request.close}
      />
      <DataRequestSheet
        request={openDetails}
        canWrite={canWrite}
        onClose={request.close}
      />
      <HireSheet
        key={openHire?.id}
        proposal={openHire}
        onClose={request.close}
      />
    </>
  )
}

/// What a correction claims, in the words the inbox reads: "Arrived 08:10".
function correctionWords(row: CorrectionRow): string {
  const arrived =
    row.corrected_arrival === null
      ? null
      : `arrived ${correctedTime(row.corrected_arrival)}`
  const left =
    row.corrected_departure === null
      ? null
      : `left ${correctedTime(row.corrected_departure)}`
  const said = [arrived, left].filter((one) => one !== null).join(", ")
  const words = said === "" ? effectLabel(row.effect).toLowerCase() : said
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/// A run a place has sent, and whether its month is whole yet.
function runWords(row: PayrollRunView): string {
  return row.complete
    ? "Sent for approval"
    : (row.incomplete_because ?? "Sent, incomplete")
}

/// Employee id → name, out of the workforce list the Leave screen already
/// holds under the same key, so on most visits this is a cache hit rather than
/// a request. Somebody the list does not carry — past the thousandth, or no
/// longer active — is shown by id rather than not shown.
function useNames(): (id: string) => string {
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  return useMemo(() => {
    const names = new Map(
      (team.data ?? []).map((person) => [
        person.employee_id,
        person.full_name ?? person.employee_code,
      ])
    )
    return (id: string) => names.get(id) ?? id
  }, [team.data])
}

/// A unit id → its name, out of the units the caller reaches; the id itself
/// for one the list does not carry.
function useUnitName(): (id: string) => string {
  const units = useReachableUnits()
  return useMemo(() => {
    const names = new Map((units.data ?? []).map((one) => [one.id, one.name]))
    return (id: string) => names.get(id) ?? id
  }, [units.data])
}

/// What a correction claims, in words. A code this screen has not been taught
/// is shown as the server spelled it rather than given a guessed name.
function effectLabel(code: string): string {
  switch (code) {
    case "ARRIVAL":
      return "Arrival"
    case "DEPARTURE":
      return "Departure"
    case "ARRIVAL_AND_DEPARTURE":
      return "Arrival and departure"
    case "APPROVED_LEAVE":
      return "Approved leave"
    default:
      return code
  }
}

/// A corrected time as the server writes it — `2026-09-20 08:15`, or
/// `… 02:00+1` for a departure past midnight. The date is the row's own
/// business date, so only the time is drawn; the `+1` is kept in words,
/// because it is the difference between a two-hour shift and a twenty-six.
function correctedTime(value: string | null): string {
  if (value === null) return "—"
  const time = value.slice(value.indexOf(" ") + 1)
  return time.endsWith("+1") ? `${time.slice(0, -2)} next day` : time
}

/// The half of every sheet here that decides: a reason, then one of two verbs.
///
/// One component for three kinds of request because the rule is one rule. The
/// server's refusal is shown as it was written — "the requester may not decide
/// their own swap" is already the sentence the reader needs.
function Verdict({
  reason,
  onReason,
  busy,
  failed,
  onDecide,
}: {
  reason: string
  onReason: (reason: string) => void
  busy: boolean
  failed: string | null
  onDecide: (approve: boolean) => void
}) {
  // On a phone the two verbs are the sheet's foot (`VerdictButtons`), where the
  // thumb is; the reason stays here.
  const phone = useLayout() === "phone"
  return (
    <>
      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => onReason(event.target.value)}
          />
        </Field>
        {!phone && (
          <VerdictButtons reason={reason} busy={busy} onDecide={onDecide} />
        )}
      </div>
    </>
  )
}

/// The two verbs of a decision: on a desk fused under the reason, on a phone
/// side by side in the sheet's foot.
function VerdictButtons({
  reason,
  busy,
  onDecide,
}: {
  reason: string
  busy: boolean
  onDecide: (approve: boolean) => void
}) {
  const phone = useLayout() === "phone"
  const ready = reason.trim() !== ""
  const approve = (
    <Button
      variant="primary"
      className={phone ? "flex-1" : undefined}
      disabled={!ready || busy}
      onClick={() => onDecide(true)}
    >
      Approve
    </Button>
  )
  const refuse = (
    <Button
      variant="danger"
      className={phone ? "flex-1" : undefined}
      disabled={!ready || busy}
      onClick={() => onDecide(false)}
    >
      Refuse
    </Button>
  )
  return phone ? (
    <div className="flex gap-2">
      {approve}
      {refuse}
    </div>
  ) : (
    <ButtonGroup>
      {approve}
      {refuse}
    </ButtonGroup>
  )
}

function RequestSheet({
  request,
  onClose,
}: {
  request: LeaveRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const unitName = useUnitName()
  const nameOfLogin = useNameOfLogin()
  const phone = useLayout() === "phone"
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approve: boolean) => {
      if (request === null) throw new Error("no request is open")
      return decideLeave(
        request.employee_id,
        request.id,
        approve ? "approve" : "reject",
        reason.trim()
      )
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The queue loses a row, and the person's own balance and request list
      // both change — an approval mints the deduction in the same transaction,
      // so a stale balance beside a decided request would be visibly wrong.
      void client.invalidateQueries({ queryKey: leaveKeys.pending() })
      void client.invalidateQueries({ queryKey: everyoneBalancesKey() })
      if (request !== null) {
        void client.invalidateQueries({
          queryKey: leaveKeys.balances(request.employee_id),
        })
        void client.invalidateQueries({
          queryKey: leaveKeys.requests(request.employee_id),
        })
      }
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (request === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={request.id}
      footer={
        phone ? (
          <VerdictButtons
            reason={reason}
            busy={decide.isPending}
            onDecide={(approve) => decide.mutate(approve)}
          />
        ) : undefined
      }
      title={request.leave_type_name}
    >
      <Status tone="warn">Waiting on a decision</Status>

      <Facts>
        <Fact term="Employee">{request.name}</Fact>
        <Fact term="Unit">{unitName(request.unit_id)}</Fact>
        <Fact term="From">{day(request.from_date)}</Fact>
        <Fact term="To">{day(request.to_date)}</Fact>
        {/* Not the length of the span. The server settled which days this
            charges against the calendar on the day it was filed, and a holiday
            inside the span is not one of them. */}
        <Fact term="Days charged">{request.chargeable_days}</Fact>
        <Fact term="Asked by">{nameOfLogin(request.requested_by)}</Fact>
        <Fact term="Reason">{request.reason}</Fact>
        {request.evidence !== null && (
          <Fact term="Evidence">{request.evidence}</Fact>
        )}
      </Facts>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}

/// One correction, and the day it is about.
///
/// A correction is judged against the day — the plan, the punches the reader
/// did see — and that lives on the attendance screen, so the sheet links to
/// the person's days rather than restating them. What it carries itself is
/// what the correction claims and why.
function CorrectionSheet({
  correction,
  onClose,
}: {
  correction: CorrectionRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const unitName = useUnitName()
  const nameOfLogin = useNameOfLogin()
  const phone = useLayout() === "phone"
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approve: boolean) => {
      if (correction === null) throw new Error("no correction is open")
      return decideCorrection(correction.id, approve, reason.trim())
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The whole attendance prefix, not just the queue: an approval changes
      // what the day amounted to, and the month's readiness counts the
      // corrections still open.
      void client.invalidateQueries({ queryKey: punchKeys.all })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (correction === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={correction.id}
      footer={
        phone ? (
          <VerdictButtons
            reason={reason}
            busy={decide.isPending}
            onDecide={(approve) => decide.mutate(approve)}
          />
        ) : undefined
      }
      title="Attendance correction"
    >
      <Status tone="warn">Waiting on a decision</Status>

      <Facts>
        <Fact term="Employee">{correction.display_name}</Fact>
        <Fact term="Unit">{unitName(correction.unit_id)}</Fact>
        <Fact term="Day">{day(correction.business_date)}</Fact>
        <Fact term="Claims">{effectLabel(correction.effect)}</Fact>
        {correction.corrected_arrival !== null && (
          <Fact term="Arrived">
            {correctedTime(correction.corrected_arrival)}
          </Fact>
        )}
        {correction.corrected_departure !== null && (
          <Fact term="Left">
            {correctedTime(correction.corrected_departure)}
          </Fact>
        )}
        <Fact term="Asked by">{nameOfLogin(correction.requested_by)}</Fact>
        <Fact term="Asked at">{moment(correction.requested_at)}</Fact>
        <Fact term="Reason">{correction.reason}</Fact>
      </Facts>

      <p className="mt-4 text-body">
        <AppLink
          to="/people/attendance-days"
          sheet={{ key: "attendanceOf", value: correction.employee_id }}
        >
          See their attendance
        </AppLink>
      </p>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}

/// One swap: two people exchanging one day's plan.
///
/// Approving moves both roster days at once, as roster revisions — so the
/// roster answers are dropped with the queue, or the week on the Roster
/// screen would still show each person on the other's shift.
function SwapSheet({
  swap,
  onClose,
}: {
  swap: SwapRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const unitName = useUnitName()
  const nameOfLogin = useNameOfLogin()
  const phone = useLayout() === "phone"
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approved: boolean) => {
      if (swap === null) throw new Error("no swap is open")
      return decideSwap(swap.id, { approved, reason: reason.trim() })
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: nextKeys.swaps() })
      void client.invalidateQueries({ queryKey: rosterKeys.all() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (swap === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={swap.id}
      footer={
        phone ? (
          <VerdictButtons
            reason={reason}
            busy={decide.isPending}
            onDecide={(approve) => decide.mutate(approve)}
          />
        ) : undefined
      }
      title="Roster swap"
    >
      <Status tone="warn">Waiting on a decision</Status>

      <Facts>
        <Fact term="Employee">{swap.name}</Fact>
        <Fact term="Swaps with">{swap.withName}</Fact>
        <Fact term="Unit">{unitName(swap.unit_id)}</Fact>
        <Fact term="Day">{day(swap.on_date)}</Fact>
        <Fact term="Asked by">{nameOfLogin(swap.requested_by)}</Fact>
        <Fact term="Reason">{swap.reason}</Fact>
      </Facts>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}
