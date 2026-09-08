import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
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
import { tableSetup, type TableSetup } from "@/lib/table"
import type { PolicyVersionView } from "@itulah/contract"

/// What "late" means, and who gets to say so.
///
/// Reading the policy is not a privilege: somebody clocking in is entitled to
/// know the tolerance they are being measured against, and a rule kept from the
/// people it governs is not a rule but a trap. Writing it is head office's, and
/// every version records who decided it and why — the same authority trail
/// employment changes carry, because this is the number that decides whether a
/// month of arrivals were late.
///
/// A version is never edited. Writing a new one closes the version it
/// supersedes, on the day before this one starts, in the same transaction — a
/// schedule with two open versions does not load back.

const columns: ColumnDef<TableSetup, PolicyVersionView>[] = [
  {
    accessorKey: "version",
    header: "Version",
    size: 100,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        v{row.original.version}
      </span>
    ),
  },
  {
    accessorKey: "effective_from",
    header: "From",
    size: 140,
    cell: ({ row }) => day(row.original.effective_from),
  },
  {
    accessorKey: "effective_to",
    header: "Until",
    size: 140,
    cell: ({ row }) =>
      row.original.effective_to ? (
        day(row.original.effective_to)
      ) : (
        <span className="text-mute">Still open</span>
      ),
  },
  {
    accessorKey: "in_force",
    header: "State",
    size: 120,
    cell: ({ row }) =>
      row.original.in_force ? (
        <Pill tone="ok">In force</Pill>
      ) : (
        <span className="text-mute">Superseded</span>
      ),
  },
  {
    accessorKey: "late_grace_minutes",
    header: "Late grace",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => readMinutes(row.original.late_grace_minutes),
  },
  {
    accessorKey: "early_leave_grace_minutes",
    header: "Early leave",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => readMinutes(row.original.early_leave_grace_minutes),
  },
  {
    accessorKey: "overtime_minimum_minutes",
    header: "Overtime from",
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => readMinutes(row.original.overtime_minimum_minutes),
  },
  {
    accessorKey: "duplicate_punch_window_minutes",
    header: "Duplicate punch",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) => readMinutes(row.original.duplicate_punch_window_minutes),
  },
]

export function AttendancePolicy() {
  const [asOf, setAsOf] = useState("")
  // Newest first, so the version in force on the date being asked about is the
  // first row. There is no other decision on this screen: a superseded version
  // is history, and the one that is open is the one somebody may replace.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "effective_from", desc: true },
  ])

  const schedule = useQuery({
    queryKey: peopleKeys.policy(asOf === "" ? undefined : asOf),
    queryFn: ({ signal }) =>
      readAttendancePolicy(asOf === "" ? undefined : asOf, signal),
  })

  const rows = useMemo(() => schedule.data?.versions ?? [], [schedule.data])
  const inForce = rows.find((one) => one.in_force) ?? null

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PolicyVersionView) => `${row.policy_id}-${row.version}`,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Attendance policy"
        sub="The tolerances a month of arrivals is judged against. Anybody signed in may read them; only head office may change them."
        actions={
          <Field label="" className="w-52">
            <Day value={asOf} label="As at" onChange={setAsOf} />
          </Field>
        }
      />

      {/* `uncovered` is sent rather than derived from the flags, because "no
          version is in force" is the state that matters and a screen working it
          out from an absence would report it as a loading glitch. */}
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

      <div className="grid gap-[1.125rem] lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden">
          {queryState(schedule, {
            loading: "Reading the schedule…",
            render: (view) =>
              view.versions.length === 0 ? (
                <EmptyState>
                  Head office has not decided yet. That is not an error — it is
                  a schedule nobody has written, and until somebody does there
                  is no tolerance to measure against.
                </EmptyState>
              ) : (
                <DataTable<PolicyVersionView>
                  table={table}
                  className="max-h-[calc(100vh-18rem)]"
                />
              ),
          })}
        </Card>

        <div className="flex flex-col gap-[1.125rem]">
          {inForce && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>In force</CardTitle>
                <span className="font-mono text-id text-mute">
                  v{inForce.version}
                </span>
              </CardHeader>
              <div className="border-t border-hairline px-4 pb-3">
                <KeyValue term="Late after">
                  {readMinutes(inForce.late_grace_minutes)}
                </KeyValue>
                <KeyValue term="Early leave after">
                  {readMinutes(inForce.early_leave_grace_minutes)}
                </KeyValue>
                <KeyValue term="Overtime counts from">
                  {readMinutes(inForce.overtime_minimum_minutes)}
                </KeyValue>
                <KeyValue term="Duplicate punch within">
                  {readMinutes(inForce.duplicate_punch_window_minutes)}
                </KeyValue>
                <KeyValue term="Since">{day(inForce.effective_from)}</KeyValue>
              </div>
            </Card>
          )}

          <NewVersion
            openFrom={
              rows.length > 0
                ? rows.reduce(
                    (latest, one) =>
                      one.effective_from > latest ? one.effective_from : latest,
                    rows[0].effective_from
                  )
                : null
            }
            current={inForce}
          />
        </div>
      </div>
    </PageContent>
  )
}

/// A new version is "and from now on". It cannot be slipped in behind the one
/// already open — the server refuses that, loudly, because a schedule written
/// out of order would accept here and refuse to load afterwards, leaving the
/// rules unreadable until somebody edited SQL.
interface PolicyDraft {
  effectiveFrom: string
  late: string
  early: string
  overtime: string
  duplicate: string
  reason: string
}

/// The ceilings the server enforces, restated so a box refuses before a round
/// trip rather than after one. Not a second source of truth: the server checks
/// them again and its answer is the one that counts.
function policyProblems(
  draft: PolicyDraft,
  openFrom: string | null
): Record<string, string | undefined> {
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

function policyReady(draft: PolicyDraft, openFrom: string | null): boolean {
  return (
    draft.reason.trim() !== "" &&
    Object.values(policyProblems(draft, openFrom)).every(
      (one) => one === undefined
    ) &&
    Number.isInteger(Number(draft.early)) &&
    Number.isInteger(Number(draft.overtime))
  )
}

function NewVersion({
  openFrom,
  current,
}: {
  openFrom: string | null
  current: PolicyVersionView | null
}) {
  const client = useQueryClient()

  const write = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: PolicyDraft) =>
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
      // changes which one is in force on any date after it starts — and the
      // date picker above makes a key per date asked.
      client.invalidateQueries({ queryKey: peopleKeys.policies() })
      // The reason only: the tolerances just written are the ones the next
      // version is most likely a small adjustment of.
      form.setFieldValue("reason", "")
    },
  })

  // The tolerances start at whatever is in force, so a version that changes one
  // of them does not silently reset the other three. `current` arrives with a
  // query rather than at mount, and the form takes it up while nothing has been
  // typed — once somebody edits a box, what they typed stands.
  const form = useForm({
    defaultValues: {
      effectiveFrom: "",
      late: String(current?.late_grace_minutes ?? 15),
      early: String(current?.early_leave_grace_minutes ?? 15),
      overtime: String(current?.overtime_minimum_minutes ?? 30),
      duplicate: String(current?.duplicate_punch_window_minutes ?? 5),
      reason: "",
    } as PolicyDraft,
    onSubmit: ({ value }) => write.mutate(value),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Write a new version</CardTitle>
      </CardHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (policyReady(form.state.values, openFrom) && !write.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5 border-t border-hairline p-4"
      >
        {write.isError && <ErrorState error={write.error} />}
        {write.isSuccess && (
          <Banner tone="ok">
            Written. The version it supersedes was closed the day before this
            one starts, in the same transaction.
          </Banner>
        )}

        <form.Subscribe
          selector={(state) => policyProblems(state.values, openFrom)}
        >
          {(problems) => (
            <>
              <form.Field name="effectiveFrom">
                {(field) => (
                  <Field
                    label="Effective from"
                    hint="The first day the new tolerances apply."
                    problem={problems.from}
                  >
                    <Day
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                    />
                  </Field>
                )}
              </form.Field>

              <div className="grid grid-cols-2 gap-3">
                <form.Field name="late">
                  {(field) => (
                    <Field
                      label="Late grace"
                      hint="minutes"
                      problem={problems.late}
                    >
                      <Input
                        type="number"
                        min={0}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="early">
                  {(field) => (
                    <Field label="Early leave grace" hint="minutes">
                      <Input
                        type="number"
                        min={0}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="overtime">
                  {(field) => (
                    <Field label="Overtime from" hint="minutes">
                      <Input
                        type="number"
                        min={0}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="duplicate">
                  {(field) => (
                    <Field
                      label="Duplicate punch"
                      hint="minutes"
                      problem={problems.duplicate}
                    >
                      <Input
                        type="number"
                        min={0}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </Field>
                  )}
                </form.Field>
              </div>
            </>
          )}
        </form.Subscribe>

        <form.Field name="reason">
          {(field) => (
            <Field
              label="Reason"
              hint="Recorded with the version. The server refuses one without it."
            >
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Why the tolerance is changing"
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => policyReady(state.values, openFrom)}
        >
          {(ready) => (
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={!ready || write.isPending}
            >
              {write.isPending ? "Writing…" : "Write the version"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Card>
  )
}
