import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  currentMonth,
  fileLeaveFor,
  monthBounds,
  monthTitle,
  stepMonth,
  useActiveEmployees,
} from "@/lib/queries/hr-time"
import {
  decideLeave,
  leaveExtraKeys,
  leaveKeys,
  leaveRequestsOf,
  leaveStateLabel,
  listLeaveTypes,
  pendingLeave,
  teamCalendar,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type { LeaveRequestView } from "@itulah/contract"

/// Time off › Requests — every leave request, with what is waiting on a
/// decision one click away.
///
/// Two views of one list. "Waiting" is the queue the server bounds by the
/// caller's posting (`pendingLeave`); "Month" is who is away in a month, read
/// off the team calendar. The calendar spans carry no request id and no
/// charged days, so each person's own requests are read to fill them in — the
/// server settled those days on the day the request was filed, and a browser
/// counting weekends would get them wrong.

type View = "WAITING" | "MONTH"

/// The most people whose requests are read to put a charged-days figure on
/// the month's rows. Beyond it the figure is found in the sheet instead.
const RESOLVE_LIMIT = 60

interface Row {
  readonly key: string
  readonly employeeId: string
  readonly name: string
  readonly unitId: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly days: number | null
  readonly state: string
  readonly requestId: string | null
  readonly leaveType: string
}

function stateTone(state: string): "ok" | "warn" | "bad" | "neutral" {
  switch (state) {
    case "APPROVED":
      return "ok"
    case "PENDING":
      return "warn"
    case "REJECTED":
      return "bad"
    default:
      return "neutral"
  }
}

export function TimeOffRequests() {
  const [view, setView] = useState<View>("WAITING")
  const [month, setMonth] = useState(currentMonth)
  const [search, setSearch] = useState("")
  const [opened, setOpened] = useState<Row | null>(null)
  const [filing, setFiling] = useState(false)
  const [filed, setFiled] = useState<string | null>(null)
  const { nameOf } = useActiveEmployees()

  const { from, to } = monthBounds(month)
  const waiting = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  const calendar = useQuery({
    queryKey: leaveExtraKeys.calendar(from, to),
    queryFn: ({ signal }) => teamCalendar(from, to, signal),
    enabled: view === "MONTH",
  })

  const spans = useMemo(() => calendar.data?.leave ?? [], [calendar.data])
  const people = useMemo(
    () => [...new Set(spans.map((span) => span.employee_id))],
    [spans]
  )
  const resolvable = view === "MONTH" && people.length <= RESOLVE_LIMIT
  const histories = useQueries({
    queries: people.map((id) => ({
      queryKey: leaveKeys.requests(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        leaveRequestsOf(id, signal),
      enabled: resolvable,
    })),
    combine: (results) => results.map((one) => one.data),
  })

  const waitingRows = useMemo<Row[]>(
    () =>
      (waiting.data ?? []).map((one) => ({
        key: one.id,
        employeeId: one.employee_id,
        name: nameOf(one.employee_id),
        unitId: one.unit_id,
        kind: one.leave_type_name,
        leaveType: one.leave_type,
        from: one.from_date,
        to: one.to_date,
        days: one.chargeable_days,
        state: one.state,
        requestId: one.id,
      })),
    [waiting.data, nameOf]
  )

  const monthRows = useMemo<Row[]>(() => {
    const byPerson = new Map<string, readonly LeaveRequestView[]>()
    people.forEach((id, index) => {
      byPerson.set(id, histories[index] ?? [])
    })
    return spans.map((span) => {
      const match = (byPerson.get(span.employee_id) ?? []).find(
        (one) =>
          one.from_date === span.from_date &&
          one.to_date === span.to_date &&
          one.leave_type === span.leave_type &&
          (one.state === "APPROVED" || one.state === "PENDING")
      )
      return {
        key: `${span.employee_id}-${span.leave_type}-${span.from_date}-${span.to_date}`,
        employeeId: span.employee_id,
        name: span.full_name ?? span.employee_code,
        unitId: span.unit_id,
        kind: span.leave_name,
        leaveType: span.leave_type,
        from: span.from_date,
        to: span.to_date,
        days: match?.chargeable_days ?? null,
        state: span.state,
        requestId: match?.id ?? null,
      }
    })
  }, [spans, people, histories])

  const needle = search.trim().toLowerCase()
  const rows = (view === "WAITING" ? waitingRows : monthRows)
    .filter(
      (row) =>
        needle === "" ||
        row.name.toLowerCase().includes(needle) ||
        row.kind.toLowerCase().includes(needle) ||
        row.unitId.toLowerCase().includes(needle)
    )
    .sort(
      (a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)
    )

  const active = view === "WAITING" ? waiting : calendar
  const source = {
    isPending: active.isPending,
    isError: active.isError,
    error: active.error,
    data: active.data as unknown,
    refetch: () => void active.refetch(),
    dataUpdatedAt: active.dataUpdatedAt,
  }

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Time off"
        sub="Leave requests — what is waiting on a decision, and who is away in a month."
        actions={
          <Button variant="primary" onClick={() => setFiling(true)}>
            Request leave
          </Button>
        }
      />

      {filed !== null && (
        <Banner tone="info" onDismiss={() => setFiled(null)}>
          {filed}
        </Banner>
      )}

      <Toolbar>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            {
              value: "WAITING",
              label: `Waiting${waiting.data ? ` (${waiting.data.length})` : ""}`,
            },
            { value: "MONTH", label: "By month" },
          ]}
        />
        {view === "MONTH" && (
          <ButtonGroup>
            <Button
              variant="ghost"
              aria-label="Previous month"
              onClick={() => setMonth(stepMonth(month, -1))}
            >
              ‹
            </Button>
            <Button variant="ghost" onClick={() => setMonth(currentMonth())}>
              {monthTitle(month)}
            </Button>
            <Button
              variant="ghost"
              aria-label="Next month"
              onClick={() => setMonth(stepMonth(month, 1))}
            >
              ›
            </Button>
          </ButtonGroup>
        )}
        <Toolbar.Spacer />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search person, kind or unit"
          className="h-8 w-60"
          aria-label="Search requests"
        />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(source, {
          loading: "Reading the requests…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {view === "WAITING"
                  ? "No leave is waiting on a decision."
                  : `Nobody is away in ${monthTitle(month)}.`}{" "}
                {needle === ""
                  ? "Use Request leave to file one for somebody."
                  : "Nothing matches that search."}
              </EmptyState>
            ) : (
              <div className="px-4 pt-3 pb-4">
                <MiniTable
                  head={[
                    "Employee",
                    { label: "Kind", align: "left" },
                    { label: "Dates", align: "left" },
                    "Days",
                    { label: "State", align: "left" },
                  ]}
                >
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      tabIndex={0}
                      onClick={() => setOpened(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setOpened(row)
                      }}
                      className={cn(
                        "cursor-pointer border-t border-hairline transition-colors hover:bg-soft",
                        opened?.key === row.key && "bg-soft"
                      )}
                    >
                      <MiniCell>
                        <span className="font-medium text-ink">{row.name}</span>
                        <span className="block text-[0.875rem] text-mute">
                          {row.unitId}
                        </span>
                      </MiniCell>
                      <MiniCell>{row.kind}</MiniCell>
                      <MiniCell>
                        {day(row.from)}
                        {row.to !== row.from && <> – {day(row.to)}</>}
                      </MiniCell>
                      <MiniCell align="right">
                        {row.days === null ? "—" : row.days}
                      </MiniCell>
                      <MiniCell>
                        <Pill tone={stateTone(row.state)}>
                          {leaveStateLabel(row.state)}
                        </Pill>
                      </MiniCell>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            ),
        })}
      </Card>

      <RequestSheet row={opened} onClose={() => setOpened(null)} />
      <FileLeaveSheet
        open={filing}
        onClose={() => setFiling(false)}
        onFiled={(fromDate, name) => {
          // The filer never decides their own filing, so it is not in their
          // Waiting list: show it where it is, in its month, and say so.
          setView("MONTH")
          setMonth(fromDate.slice(0, 7))
          setFiled(
            `Leave filed for ${name}. Somebody other than you approves it — it shows here as pending until then.`
          )
        }}
      />
    </PageContent>
  )
}

/// One request: its facts, and — while it is waiting — the two verbs.
///
/// The full request is read off the person's own list, because a row from the
/// month's calendar carries only dates. Every decision carries a reason (the
/// server refuses one without), and the server also refuses a decision by the
/// person who filed it; its sentence is shown as written rather than the
/// buttons being hidden, since a screen guessing who filed what would be a
/// second copy of the rule.
function RequestSheet({
  row,
  onClose,
}: {
  row: Row | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const own = useQuery({
    queryKey: leaveKeys.requests(row?.employeeId ?? ""),
    queryFn: ({ signal }) => leaveRequestsOf(row?.employeeId ?? "", signal),
    enabled: row !== null,
  })
  const full =
    row === null
      ? null
      : ((own.data ?? []).find((one) =>
          row.requestId !== null
            ? one.id === row.requestId
            : one.from_date === row.from &&
              one.to_date === row.to &&
              one.leave_type === row.leaveType &&
              (one.state === "APPROVED" || one.state === "PENDING")
        ) ?? null)

  const decide = useMutation({
    mutationFn: (approve: boolean) => {
      if (full === null) throw new Error("this request has not loaded yet")
      return decideLeave(
        full.employee_id,
        full.id,
        approve ? "approve" : "reject",
        reason.trim()
      )
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The queue loses a row, and an approval mints the deduction in the same
      // transaction — so the balance, the person's list and the calendar all
      // move with it.
      void client.invalidateQueries({ queryKey: ["people", "leave"] })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (row === null) return null
  const state = full?.state ?? row.state

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) {
          setReason("")
          setFailed(null)
          onClose()
        }
      }}
      id={full?.id ?? row.requestId ?? undefined}
      title={`${row.name} · ${row.kind}`}
      badge={<Pill tone={stateTone(state)}>{leaveStateLabel(state)}</Pill>}
    >
      <Facts>
        <Fact term="Employee">{row.name}</Fact>
        <Fact term="Unit">{row.unitId}</Fact>
        <Fact term="From">{day(row.from)}</Fact>
        <Fact term="To">{day(row.to)}</Fact>
        {/* Not the length of the span: the server settled which days this
            charges against the calendar when it was filed. */}
        <Fact term="Days charged">
          {full === null ? (row.days ?? "…") : full.chargeable_days}
        </Fact>
        {full !== null && <Fact term="Asked by">{full.requested_by}</Fact>}
        {full !== null && <Fact term="Reason">{full.reason}</Fact>}
        {full?.evidence != null && <Fact term="Evidence">{full.evidence}</Fact>}
        {full?.decided_by != null && (
          <Fact term="Decided by">{full.decided_by}</Fact>
        )}
        {full?.decision_reason != null && (
          <Fact term="They said">{full.decision_reason}</Fact>
        )}
      </Facts>

      {own.isError && (
        <Banner tone="bad" className="mt-4">
          {own.error.message}
        </Banner>
      )}
      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      {state === "PENDING" && full !== null && (
        <div className="mt-4 flex flex-col gap-3">
          <Field
            label="Why"
            hint="Recorded against the decision, and required."
            required
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="toko cukup orang"
            />
          </Field>
          <ButtonGroup>
            <Button
              variant="primary"
              disabled={reason.trim() === "" || decide.isPending}
              onClick={() => decide.mutate(true)}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim() === "" || decide.isPending}
              onClick={() => decide.mutate(false)}
            >
              Reject
            </Button>
          </ButtonGroup>
        </div>
      )}
    </Sheet>
  )
}

/// Filing leave for somebody — a manager covering for a person with no phone
/// to hand, or head office keying in a paper form.
function FileLeaveSheet({
  open,
  onClose,
  onFiled,
}: {
  open: boolean
  onClose: () => void
  onFiled: (fromDate: string, name: string) => void
}) {
  const client = useQueryClient()
  const { people, nameOf } = useActiveEmployees()
  const kinds = useQuery({
    queryKey: leaveKeys.types(),
    queryFn: ({ signal }) => listLeaveTypes(signal),
    enabled: open,
  })
  const [employee, setEmployee] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reason, setReason] = useState("")
  const [evidence, setEvidence] = useState("")

  const chosen = (kinds.data ?? []).find((one) => one.code === kind) ?? null
  const reset = () => {
    setEmployee(null)
    setKind(null)
    setFrom("")
    setTo("")
    setReason("")
    setEvidence("")
  }
  const file = useMutation({
    mutationFn: () =>
      fileLeaveFor(employee ?? "", {
        leaveType: kind ?? "",
        fromDate: from,
        toDate: to === "" ? from : to,
        reason: reason.trim(),
        evidence,
      }),
    onSuccess: (filedRequest) => {
      void client.invalidateQueries({ queryKey: ["people", "leave"] })
      onFiled(
        filedRequest.from_date,
        employee === null ? "them" : nameOf(employee)
      )
      reset()
      onClose()
    },
  })

  const ready =
    employee !== null && kind !== null && from !== "" && reason.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          file.reset()
          onClose()
        }
      }}
      title="Request leave"
      caption="Filed in their name; it waits for a decision like any other."
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
            {file.isPending ? "Filing…" : "File request"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Employee" required>
          <PickOne
            label="Employee"
            placeholder="Choose…"
            choices={people.map((one) => ({
              value: one.employee_id,
              label: one.full_name ?? one.employee_code,
            }))}
            value={employee}
            onChange={setEmployee}
          />
        </Field>
        <Field label="Kind of leave" required>
          <PickOne
            label="Kind of leave"
            placeholder="Choose…"
            choices={(kinds.data ?? []).map((one) => ({
              value: one.code,
              label: one.name,
            }))}
            value={kind}
            onChange={setKind}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="To" aside="same day if left empty">
            <Day value={to} onChange={setTo} />
          </Field>
        </div>
        <Field label="Why" required>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="acara keluarga"
          />
        </Field>
        {chosen?.requires_evidence === true && (
          <Field label="Evidence" hint="Where the document is kept.">
            <Input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="surat dokter"
            />
          </Field>
        )}
        {file.isError && <Banner tone="bad">{file.error.message}</Banner>}
      </div>
    </Sheet>
  )
}
