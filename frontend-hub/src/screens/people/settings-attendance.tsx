import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import {
  MAX_DUPLICATE_PUNCH_WINDOW_MINUTES,
  MAX_LATE_GRACE_MINUTES,
  peopleKeys,
  readAttendancePolicy,
  readMinutes,
  setAttendancePolicy,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { CardName } from "@/components/ui/phone-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useOpener } from "@/screens/people/settings-lib"
import { SheetFooter } from "@/screens/people/settings-kit"
import type { PolicyVersionView } from "@itulah/contract"

const NO_VERSIONS: PolicyVersionView[] = []

const stateOf = (row: PolicyVersionView) =>
  row.in_force ? (
    <Pill tone="ok">In force</Pill>
  ) : (
    <span className="text-mute">Superseded</span>
  )

const untilOf = (row: PolicyVersionView) =>
  row.effective_to ? (
    day(row.effective_to)
  ) : (
    <span className="text-mute">Still open</span>
  )

const columns: ColumnDef<TableSetup, PolicyVersionView>[] = [
  {
    id: "version",
    accessorFn: (row) => row.version,
    header: "Version",
    size: 110,
    meta: { mono: true, card: "hide" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">v{row.original.version}</span>
    ),
  },
  {
    id: "from",
    accessorFn: (row) => row.effective_from,
    header: "From",
    size: 150,
    meta: { card: "hide" },
    cell: ({ row }) => day(row.original.effective_from),
  },
  {
    id: "until",
    accessorFn: (row) => row.effective_to ?? "",
    header: "Until",
    size: 150,
    meta: { card: "hide" },
    cell: ({ row }) => untilOf(row.original),
  },
  {
    id: "state",
    accessorFn: (row) => row.in_force,
    header: "State",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => stateOf(row.original),
  },
  {
    accessorKey: "late_grace_minutes",
    header: "Late Grace",
    size: 130,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => readMinutes(row.original.late_grace_minutes),
  },
  {
    accessorKey: "early_leave_grace_minutes",
    header: "Early Leave",
    size: 130,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => readMinutes(row.original.early_leave_grace_minutes),
  },
  {
    accessorKey: "overtime_minimum_minutes",
    header: "Overtime from",
    size: 150,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => readMinutes(row.original.overtime_minimum_minutes),
  },
  {
    accessorKey: "duplicate_punch_window_minutes",
    header: "Duplicate Punch",
    size: 160,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => readMinutes(row.original.duplicate_punch_window_minutes),
  },
  // Two columns that exist only on a card (`cardLead`; a phone): the version
  // over its span and its four tolerances, and where it stands.
  {
    id: "head",
    accessorFn: (row) => row.version,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={`Version ${row.original.version}`}
        line={[
          <>
            {day(row.original.effective_from)} – {untilOf(row.original)}
          </>,
          `Late grace ${readMinutes(row.original.late_grace_minutes)} · Early leave ${readMinutes(row.original.early_leave_grace_minutes)}`,
          `Overtime from ${readMinutes(row.original.overtime_minimum_minutes)} · Duplicate punch ${readMinutes(row.original.duplicate_punch_window_minutes)}`,
        ]}
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.in_force,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => stateOf(row.original),
  },
]

/// Settings › Attendance rules — what "late" means, and who gets to say so.
///
/// Reading the policy is not a privilege: somebody clocking in is entitled to
/// know the tolerance they are measured against. Writing it is head office's,
/// and every version records who decided it and why. A version is never
/// edited — a new one closes the version it supersedes, on the day before it
/// starts, so a month of arrivals can always be judged by the rules of that
/// month.
export function AttendanceRuleSettings() {
  const canWrite = useCanWrite()
  const phone = useLayout() === "phone"
  const sheet = useOpener()
  const [asOf, setAsOf] = useState("")

  const schedule = useQuery({
    queryKey: peopleKeys.policy(asOf === "" ? undefined : asOf),
    queryFn: ({ signal }) =>
      readAttendancePolicy(asOf === "" ? undefined : asOf, signal),
  })

  const rows = useMemo(
    () =>
      [...(schedule.data?.versions ?? [])].sort((a, b) =>
        b.effective_from.localeCompare(a.effective_from)
      ),
    [schedule.data]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows.length === 0 ? NO_VERSIONS : rows,
        columns,
        getRowId: (row: PolicyVersionView) => `${row.policy_id}-${row.version}`,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, foot: phone } },
      }),
      [rows, phone]
    )
  )
  const inForce = rows.find((one) => one.in_force) ?? null
  const openFrom =
    rows.length > 0
      ? rows.reduce(
          (latest, one) =>
            one.effective_from > latest ? one.effective_from : latest,
          rows[0].effective_from
        )
      : null

  return (
    <PageContent>
      {canWrite && <Fab label="New version" onClick={() => sheet.show()} />}
      <PageHeader
        crumb="People"
        title="Attendance Rules"
        sub="The tolerances a month of arrivals is judged against. Anybody signed in may read them; only head office may change them."
        actions={
          !phone &&
          canWrite && (
            <Button variant="primary" onClick={() => sheet.show()}>
              New version
            </Button>
          )
        }
      />

      <Toolbar>
        <Field label="" className="w-52">
          <Day value={asOf} label="As at" onChange={setAsOf} />
        </Field>
        <Toolbar.Spacer />
        {inForce && (
          <span className="text-[0.9375rem] text-mute">
            In force: v{inForce.version}, since {day(inForce.effective_from)}
          </span>
        )}
      </Toolbar>

      {/* `uncovered` is sent rather than derived from the flags, because "no
          version is in force" is the state that matters. */}
      {schedule.data?.uncovered && (
        <Banner tone="bad" className="mb-4">
          No policy version covers {day(schedule.data.as_of)}. Until one does,
          nothing decides whether an arrival that day was late.
        </Banner>
      )}
      {asOf !== "" && (
        <Banner tone="info" className="mb-4" onDismiss={() => setAsOf("")}>
          Showing the schedule as it stood on {day(asOf)}, not today.
        </Banner>
      )}

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(schedule, {
          loading: "Reading the schedule…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Head office has not decided yet. Until the first version is
                written with New version there is no tolerance to measure
                against.
              </EmptyState>
            ) : (
              <DataTable<PolicyVersionView>
                refresh={[schedule]}
                table={table}
                cardsApart
                cardLead
                cardSort={false}
              />
            ),
        })}
      </Card>

      <NewVersionSheet
        key={sheet.n}
        open={sheet.isOpen}
        onClose={sheet.hide}
        openFrom={openFrom}
        current={inForce}
      />
    </PageContent>
  )
}

interface PolicyDraft {
  effectiveFrom: string
  late: string
  early: string
  overtime: string
  duplicate: string
  reason: string
}

/// The ceilings the server enforces, restated so a box refuses before a round
/// trip rather than after one. The server checks them again.
function problemsOf(
  draft: PolicyDraft,
  openFrom: string | null
): Record<"from" | "late" | "duplicate", string | undefined> {
  const late = Number(draft.late)
  const duplicate = Number(draft.duplicate)
  return {
    from:
      draft.effectiveFrom === ""
        ? "A version starts on a day."
        : openFrom !== null && draft.effectiveFrom <= openFrom
          ? `A version already starts on ${day(openFrom)}. A new one supersedes the current one and cannot be slipped in behind it.`
          : undefined,
    late:
      !Number.isInteger(late) || late < 0 || late > MAX_LATE_GRACE_MINUTES
        ? `Between 0 and ${count(MAX_LATE_GRACE_MINUTES)} minutes.`
        : undefined,
    duplicate:
      !Number.isInteger(duplicate) ||
      duplicate < 0 ||
      duplicate > MAX_DUPLICATE_PUNCH_WINDOW_MINUTES
        ? `Between 0 and ${count(MAX_DUPLICATE_PUNCH_WINDOW_MINUTES)} minutes.`
        : undefined,
  }
}

function NewVersionSheet({
  open,
  onClose,
  openFrom,
  current,
}: {
  open: boolean
  onClose: () => void
  openFrom: string | null
  current: PolicyVersionView | null
}) {
  const client = useQueryClient()
  // The tolerances start at whatever is in force, so a version that changes one
  // of them does not silently reset the other three.
  const [draft, setDraft] = useState<PolicyDraft>({
    effectiveFrom: "",
    late: String(current?.late_grace_minutes ?? 15),
    early: String(current?.early_leave_grace_minutes ?? 15),
    overtime: String(current?.overtime_minimum_minutes ?? 30),
    duplicate: String(current?.duplicate_punch_window_minutes ?? 5),
    reason: "",
  })
  const set = (patch: Partial<PolicyDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }))
  const problems = problemsOf(draft, openFrom)
  const ready =
    draft.reason.trim() !== "" &&
    Object.values(problems).every((one) => one === undefined) &&
    Number.isInteger(Number(draft.early)) &&
    Number.isInteger(Number(draft.overtime))

  const write = useMutation({
    mutationFn: () =>
      setAttendancePolicy({
        effectiveFrom: draft.effectiveFrom,
        lateGraceMinutes: Number(draft.late),
        earlyLeaveGraceMinutes: Number(draft.early),
        overtimeMinimumMinutes: Number(draft.overtime),
        duplicatePunchWindowMinutes: Number(draft.duplicate),
        reason: draft.reason.trim(),
      }),
    onSuccess: () => {
      // Every `as_of` this browser has asked about, because a new version
      // changes which one is in force on any date after it starts.
      void client.invalidateQueries({ queryKey: peopleKeys.policies() })
      onClose()
    },
  })

  const minutes = (
    key: "late" | "early" | "overtime" | "duplicate",
    label: string,
    problem?: string
  ) => (
    <Field label={label} hint="minutes" problem={problem}>
      <Input
        type="number"
        min={0}
        value={draft[key]}
        onChange={(event) => set({ [key]: event.target.value })}
      />
    </Field>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New version"
      footer={
        <SheetFooter
          onCancel={onClose}
          onSave={() => write.mutate()}
          saveLabel="Write the version"
          pendingLabel="Writing…"
          pending={write.isPending}
          disabled={!ready}
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <Problem error={write.error} />
        <Field
          label="Effective from"
          hint="The first day the new tolerances apply."
          required
          problem={problems.from}
        >
          <Day
            value={draft.effectiveFrom}
            onChange={(next) => set({ effectiveFrom: next })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {minutes("late", "Late grace", problems.late)}
          {minutes("early", "Early leave grace")}
          {minutes("overtime", "Overtime from")}
          {minutes("duplicate", "Duplicate punch", problems.duplicate)}
        </div>
        <Field
          label="Reason"
          hint="Recorded with the version. The server refuses one without it."
          required
        >
          <Textarea
            rows={2}
            value={draft.reason}
            onChange={(event) => set({ reason: event.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  )
}
